// @ts-check
/**
 * src/copilot/tools/introspection-tools.js
 *
 * Custom Tools de introspecção do agente. Permite ao agente listar as ferramentas disponíveis, consultar telemetria de
 * chamadas e obter informações sobre si mesmo.
 *
 * @module copilot/tools/introspection-tools
 * @see module:copilot/agent/status-snapshot
 */

import { defaultMetrics } from '#copilot/observability';
import { log } from '#copilot/observability/logger';
import { getToolStats } from '#copilot/observability/tool-stats';
import { defineTool } from '@github/copilot-sdk';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { withSkipPermission } from './tool-factory.js';

// ─── Estado compartilhado via module-level registry ─────────────────────────

/**
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 */

/**
 * Registry interno de ferramentas acessível pelos introspection tools. Preenchido via registerForIntrospection() antes
 * do uso.
 *
 * @type {Tool[]}
 */
let _registeredTools = [];

/**
 * GAP-TOOLS-004: Set de tools desabilitadas em runtime. O agente pode desabilitar/habilitar tools durante a sessão via
 * toggle_tool. O tool-interceptor consulta isToolDisabled() para bloquear chamadas a tools desabilitadas.
 *
 * @type {Set<string>}
 */
const _disabledTools = new Set();

/**
 * Verifica se uma tool está desabilitada em runtime.
 *
 * @param {string} name - Nome da tool
 * @returns {boolean}
 */
export function isToolDisabled(name) {
    return _disabledTools.has(name.toLowerCase());
}

/**
 * Retorna a lista de tools desabilitadas.
 *
 * @returns {string[]}
 */
export function getDisabledTools() {
    return [..._disabledTools];
}

/**
 * Informa ao módulo quais ferramentas estão registradas na sessão atual. Deve ser chamado pelo AlwaysAliveAgent após
 * montar o array de tools.
 *
 * @param {Tool[]} tools
 * @returns {void}
 */
export function registerForIntrospection(tools) {
    _registeredTools = tools;
    log('DEBUG', `[introspection] ${tools.length} tools registradas para introspecção.`);
}
// TODO(RF-026): derivar categorias do ToolRegistry para evitar manutenção manual.

/**
 * Mapa de categoria → nomes de tools pertencentes a ela. Usado quando o registry completo com metadados não está
 * disponível.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const CATEGORY_TOOL_MAP = Object.freeze({
    code: ['lint_check', 'run_tests', 'typecheck'],
    git: ['git_status', 'git_diff', 'git_commit', 'git_changed_files'],
    session: ['read_briefing', 'write_pending_task'],
    task: ['get_tasks', 'add_task', 'get_session_state', 'get_system_health'],
    hook: ['hook_get_audit_tail', 'request_user_input', 'hook_get_pending_tasks'],
    introspection: ['list_tools', 'get_agent_info', 'get_telemetry'],
});

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Tool: list_tools — lista as ferramentas disponíveis na sessão.
 */
const listToolsTool = defineTool('list_tools', {
    description:
        'Lista todas as ferramentas (Custom Tools) disponíveis nesta sessão. ' +
        'Retorna nome, descrição e parâmetros de cada ferramenta.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ category?: string; search?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                category: z
                    .string()
                    .optional()
                    .describe('Filtrar por categoria (ex: "code", "git", "session", "task", "hook", "introspection")'),
                search: z.string().optional().describe('Filtrar por termo no nome ou descrição da tool'),
            })
        )
    ),
    handler: async (/** @type {{ category?: string; search?: string }} */ { category, search }) => {
        log('INFO', `[introspection/list_tools] category=${category ?? '*'} search=${search ?? '*'}`);

        let tools = _registeredTools;

        // GAP-TOOLS-004: filtrar tools desabilitadas em runtime
        if (_disabledTools.size > 0) {
            tools = tools.filter((t) => !_disabledTools.has(t.name.toLowerCase()));
        }

        if (search) {
            const term = search.toLowerCase();
            tools = tools.filter(
                (t) => t.name.toLowerCase().includes(term) || (t.description ?? '').toLowerCase().includes(term),
            );
        }

        // Categorias heurísticas por nome de tool (ver CATEGORY_TOOL_MAP)
        if (category) {
            const allowed = CATEGORY_TOOL_MAP[category];
            if (allowed) tools = tools.filter((t) => allowed.includes(t.name));
        }

        return {
            count: tools.length,
            tools: tools.map((t) => ({
                name: t.name,
                description: t.description ?? null,
            })),
        };
    },
});

/**
 * Tool: get_agent_info — retorna informações sobre a sessão e o agente atual.
 */
const getAgentInfoTool = defineTool('get_agent_info', {
    description:
        'Retorna informações sobre o agente atual: versão do SDK, modelo configurado, status da sessão, ' +
        'quantidade de tools registradas e variáveis de ambiente relevantes.',
    parameters: z.object({}),
    handler: async () => {
        log('INFO', '[introspection/get_agent_info] Coletando informações do agente.');

        const sdkVersion = (() => {
            try {
                const _req = createRequire(import.meta.url);
                const pkg = _req('@github/copilot-sdk/package.json');
                return /** @type {string} */ (pkg.version) ?? 'unknown';
            } catch {
                return 'unknown';
            }
        })();

        return {
            sdkVersion,
            nodeVersion: process.version,
            model: process.env['COPILOT_MODEL'] ?? 'gpt-4.1',
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            toolsRegistered: _registeredTools.length,
            toolNames: _registeredTools.map((t) => t.name),
            hasTelemetry: true,
            env: {
                COPILOT_MCP_SERVERS: process.env['COPILOT_MCP_SERVERS'] ?? '',
                NODE_ENV: process.env['NODE_ENV'] ?? '',
                COPILOT_SDK_ENABLED: process.env['COPILOT_SDK_ENABLED'] ?? '',
            },
        };
    },
});

/**
 * Tool: get_telemetry — retorna o sumário de telemetria de chamadas de ferramentas desta sessão.
 */
const getTelemetryTool = defineTool('get_telemetry', {
    description:
        'Retorna o sumário de telemetria da sessão: total de chamadas, taxa de sucesso, tools mais usadas, ' +
        'chamadas recentes e sessões registradas.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ recent?: number; toolName?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                recent: z
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .optional()
                    .default(10)
                    .describe('Número de chamadas recentes a incluir no resultado'),
                toolName: z.string().optional().describe('Filtrar histórico por nome específico de tool'),
            })
        )
    ),
    handler: async (/** @type {{ recent?: number; toolName?: string }} */ { toolName }) => {
        const summary = defaultMetrics.getSummary();
        const toolsMap = summary.tools ?? {};

        const toolValues = Object.values(toolsMap);
        const totalCalls = toolValues.reduce((acc, t) => acc + (t.totalCalls ?? 0), 0);
        const successCalls = toolValues.reduce((acc, t) => acc + (t.successCount ?? 0), 0);
        const errorCalls = toolValues.reduce((acc, t) => acc + (t.errorCount ?? 0), 0);

        const topTools = toolName
            ? toolsMap[toolName]
                ? [{ name: toolName, count: toolsMap[toolName].totalCalls }]
                : []
            : Object.entries(toolsMap)
                  .sort(([, a], [, b]) => (b.totalCalls ?? 0) - (a.totalCalls ?? 0))
                  .slice(0, 10)
                  .map(([name, t]) => ({ name, count: t.totalCalls ?? 0 }));

        return {
            available: true,
            summary: {
                total: totalCalls,
                success: successCalls,
                errors: errorCalls,
                successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0,
            },
            topTools,
            dialog: summary.dialog ?? {},
            sessions: summary.sessions ?? {},
            tasks: summary.tasks ?? {},
        };
    },
});

/**
 * Tool: report_intent — registra em log a intenção da LLM antes de executar uma ação sensível. Análogo ao
 * `report_intent` built-in do GitHub Copilot CLI. Garante auditabilidade e rastreabilidade.
 */
const reportIntentTool = defineTool('report_intent', {
    description:
        'Registra a intenção do agente antes de executar uma ação sensível (ex: deletar arquivo, fazer push, ' +
        'executar comando destrutivo). Use ANTES de chamar uma tool que modifique estado externo irreversível. ' +
        'Não executa nenhuma ação — apenas registra e retorna confirmação de auditoria.',
    overridesBuiltInTool: true,
    parameters:
        /** @type {import('@github/copilot-sdk').ZodSchema<{ intent: string; tool: string; risk?: string }>} */ (
            /** @type {unknown} */ (
                z.object({
                    intent: z
                        .string()
                        .describe('Descrição clara da intenção (o que o agente pretende fazer e por quê)'),
                    tool: z.string().describe('Nome da tool que será chamada em seguida'),
                    risk: z.string().optional().describe('Nível de risco estimado: low | medium | high'),
                })
            )
        ),
    handler: async (/** @type {{ intent: string; tool: string; risk?: string }} */ { intent, tool, risk }) => {
        const level = risk === 'high' ? 'WARN' : 'INFO';
        log(level, `[intent] tool=${tool} risk=${risk ?? 'low'} | ${intent}`);
        return {
            recorded: true,
            intent,
            tool,
            risk: risk ?? 'low',
            timestamp: new Date().toISOString(),
        };
    },
});

/**
 * GAP-TOOLS-004: Tool toggle_tool — permite ao agente desabilitar/habilitar tools em runtime. Tools desabilitadas são
 * bloqueadas pelo tool-interceptor e não aparecem em list_tools. Tools de introspecção (list_tools, get_agent_info,
 * toggle_tool) não podem ser desabilitadas.
 */
const PROTECTED_TOOLS = new Set(['list_tools', 'get_agent_info', 'get_telemetry', 'report_intent', 'toggle_tool']);

const toggleToolTool = defineTool('toggle_tool', {
    description:
        'Desabilita ou habilita uma tool em runtime. Tools desabilitadas são bloqueadas e não aparecem em list_tools. ' +
        'Use para restringir temporariamente o acesso a tools durante operações sensíveis. ' +
        'As tools de introspecção não podem ser desabilitadas.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ toolName: string; enabled: boolean }>} */ (
        /** @type {unknown} */ (
            z.object({
                toolName: z.string().describe('Nome da tool a habilitar/desabilitar'),
                enabled: z.boolean().describe('true para habilitar, false para desabilitar'),
            })
        )
    ),
    handler: async (/** @type {{ toolName: string; enabled: boolean }} */ { toolName, enabled }) => {
        const normalized = toolName.toLowerCase();

        if (PROTECTED_TOOLS.has(normalized)) {
            log('WARN', `[introspection/toggle_tool] tool protegida não pode ser desabilitada: ${toolName}`);
            return { success: false, reason: 'tool protegida', toolName, enabled: true };
        }

        // Verificar se a tool existe
        const exists = _registeredTools.some((t) => t.name.toLowerCase() === normalized);
        if (!exists) {
            return { success: false, reason: 'tool não encontrada', toolName, enabled };
        }

        if (enabled) {
            _disabledTools.delete(normalized);
            log('INFO', `[introspection/toggle_tool] tool habilitada: ${toolName}`);
        } else {
            _disabledTools.add(normalized);
            log('INFO', `[introspection/toggle_tool] tool desabilitada: ${toolName}`);
        }

        return {
            success: true,
            toolName,
            enabled,
            disabledTools: [..._disabledTools],
        };
    },
});

/**
 * Tool: get_tool_health — retorna métricas de uso por tool: chamadas, erros, latência e status.
 *
 * F7.3: introspecção por tool individual para diagnóstico de saúde.
 */
const getToolHealthTool = defineTool('get_tool_health', {
    description:
        'Retorna métricas de saúde por ferramenta: total de chamadas, taxa de erro, latência média e última execução. ' +
        'Útil para identificar tools com alta taxa de falha ou lentidão. ' +
        'Filtre por nome específico ou receba todas com sort por chamadas.',
    parameters: /**
     * @type {import('zod').ZodType<{
     *     tool_name?: string;
     *     sort_by?: 'calls' | 'errors' | 'latency' | 'error_rate';
     *     limit?: number;
     * }>}
     */ (
        z.object({
            tool_name: z.string().optional().describe('Nome da tool para detalhar (omitir = todas)'),
            sort_by: z
                .enum(['calls', 'errors', 'latency', 'error_rate'])
                .optional()
                .default('calls')
                .describe('Campo para ordenação descendente'),
            limit: z
                .number()
                .int()
                .min(1)
                .max(50)
                .optional()
                .default(20)
                .describe('Número máximo de tools no resultado'),
        })
    ),
    handler: async (
        /** @type {{ tool_name?: string; sort_by?: 'calls' | 'errors' | 'latency' | 'error_rate'; limit?: number }} */ {
            tool_name,
            sort_by = 'calls',
            limit = 20,
        },
    ) => {
        const stats = getToolStats();

        if (tool_name) {
            const s = stats[tool_name];
            if (!s) return { found: false, tool: tool_name };
            return { found: true, tool: tool_name, stats: s };
        }

        /** @type {keyof ReturnType<typeof getToolStats>[string]} */
        const sortKey = sort_by === 'latency' ? 'avgLatencyMs' : sort_by === 'error_rate' ? 'errorRate' : sort_by;

        const entries = Object.entries(stats)
            .sort(([, a], [, b]) => {
                const av = /** @type {number} */ (a[/** @type {keyof typeof a} */ (sortKey)] ?? 0);
                const bv = /** @type {number} */ (b[/** @type {keyof typeof b} */ (sortKey)] ?? 0);
                return bv - av;
            })
            .slice(0, limit)
            .map(([name, s]) => ({ name, ...s }));

        const total = Object.values(stats).reduce((acc, s) => acc + s.calls, 0);
        const totalErrors = Object.values(stats).reduce((acc, s) => acc + s.errors, 0);

        log('DEBUG', `[get_tool_health] stats=${Object.keys(stats).length} tools tracked`);
        return {
            tracked: Object.keys(stats).length,
            totalCalls: total,
            totalErrors,
            overallErrorRate: total > 0 ? parseFloat(((totalErrors / total) * 100).toFixed(1)) : 0,
            topTools: entries,
        };
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const introspectionTools = [
    withSkipPermission(listToolsTool),
    withSkipPermission(getAgentInfoTool),
    withSkipPermission(getTelemetryTool),
    withSkipPermission(reportIntentTool),
    withSkipPermission(toggleToolTool),
    withSkipPermission(getToolHealthTool),
];
