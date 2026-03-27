// @ts-check
/**
 * src/copilot/tools/introspection-tools.js
 *
 * Custom Tools de introspecção do agente. Permite ao agente listar as ferramentas disponíveis, consultar telemetria de
 * chamadas e obter informações sobre si mesmo.
 *
 * @module copilot/tools/introspection-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { createRequire } from 'node:module';
import { z } from 'zod';

/**
 * Marca uma tool como skip-permission (SDK v0.2.0+). Forward-compat: campo ignorado silenciosamente em SDK v0.1.x.
 *
 * @template {import('@github/copilot-sdk').Tool<any>} T
 * @param {T} tool
 * @returns {T}
 */
const withSkipPermission = (tool) => Object.assign(tool, /** @type {any} */ ({ skipPermission: true }));

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
 * Store de telemetria injetado externamente (AlwaysAliveAgent).
 *
 * @type {import('#copilot/lib/telemetry').TelemetryStore | null}
 */
let _telemetryStore = null;

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

/**
 * Injeta o store de telemetria para uso pelos introspection tools.
 *
 * @param {import('#copilot/lib/telemetry').TelemetryStore} store
 * @returns {void}
 */
export function setTelemetryStore(store) {
    _telemetryStore = store;
}

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

        if (search) {
            const term = search.toLowerCase();
            tools = tools.filter(
                (t) => t.name.toLowerCase().includes(term) || (t.description ?? '').toLowerCase().includes(term),
            );
        }

        // Categorias heurísticas por prefixo de nome
        if (category) {
            const prefixMap = /** @type {Record<string, string[]>} */ ({
                code: ['lint_check', 'run_tests', 'typecheck'],
                git: ['git_status', 'git_diff', 'git_commit', 'git_changed_files'],
                session: ['read_briefing', 'write_pending_task'],
                task: ['get_tasks', 'add_task', 'get_session_state', 'get_system_health'],
                hook: ['hook_get_audit_tail', 'request_user_input', 'hook_get_pending_tasks'],
                introspection: ['list_tools', 'get_agent_info', 'get_telemetry'],
            });
            const allowed = prefixMap[category];
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
            model: process.env.COPILOT_MODEL ?? 'gpt-4.1',
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            toolsRegistered: _registeredTools.length,
            toolNames: _registeredTools.map((t) => t.name),
            hasTelemetry: _telemetryStore !== null,
            env: {
                COPILOT_MCP_SERVERS: process.env.COPILOT_MCP_SERVERS ?? '',
                NODE_ENV: process.env.NODE_ENV ?? '',
                COPILOT_SDK_ENABLED: process.env.COPILOT_SDK_ENABLED ?? '',
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
    handler: async (/** @type {{ recent?: number; toolName?: string }} */ { recent = 10, toolName }) => {
        if (!_telemetryStore) {
            return { available: false, message: 'Telemetria não inicializada nesta sessão.' };
        }

        const store = _telemetryStore;
        const calls = toolName
            ? store.toolCalls.filter((c) => c.toolName === toolName)
            : store.toolCalls.slice(-recent);

        const total = store.toolCalls.length;
        const success = store.toolCalls.filter((c) => c.success).length;
        const errors = total - success;
        const avgDuration =
            total > 0 ? Math.round(store.toolCalls.reduce((acc, c) => acc + c.durationMs, 0) / total) : 0;

        /** @type {Record<string, number>} */
        const byTool = {};
        for (const c of store.toolCalls) {
            byTool[c.toolName] = (byTool[c.toolName] ?? 0) + 1;
        }

        return {
            available: true,
            summary: {
                total,
                success,
                errors,
                avgDurationMs: avgDuration,
                successRate: total > 0 ? Math.round((success / total) * 100) : 0,
            },
            topTools: Object.entries(byTool)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([name, count]) => ({ name, count })),
            recent: calls.slice(-recent).map((c) => ({
                toolName: c.toolName,
                timestamp: c.timestamp,
                durationMs: c.durationMs,
                success: c.success,
                error: c.error ?? null,
            })),
            activeSessions: store.sessions.filter((s) => s.status === 'active').length,
        };
    },
});

/**
 * Tool: report_intent — registra em log a intenção da LLM antes de executar uma ação sensível.
 * Análogo ao `report_intent` built-in do GitHub Copilot CLI. Garante auditabilidade e rastreabilidade.
 */
const reportIntentTool = defineTool('report_intent', {
    description:
        'Registra a intenção do agente antes de executar uma ação sensível (ex: deletar arquivo, fazer push, ' +
        'executar comando destrutivo). Use ANTES de chamar uma tool que modifique estado externo irreversível. ' +
        'Não executa nenhuma ação — apenas registra e retorna confirmação de auditoria.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ intent: string; tool: string; risk?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                intent: z.string().describe('Descrição clara da intenção (o que o agente pretende fazer e por quê)'),
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
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const introspectionTools = [
    withSkipPermission(listToolsTool),
    withSkipPermission(getAgentInfoTool),
    withSkipPermission(getTelemetryTool),
    withSkipPermission(reportIntentTool),
];
