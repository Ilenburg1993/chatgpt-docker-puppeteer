// @ts-check
import { COPILOT_MCP_SERVERS, COPILOT_MODEL, COPILOT_SDK_ENABLED } from '#copilot/config';
import { readIoRuntimeHealthSnapshot } from '#copilot/infra/public/health';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { getSummary as getMetricsSummary, getToolStats } from '../infra/metrics-proxy.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
import { summarizeToolParameterSchema } from '../infra/tool-feedback.js';
import { buildToolDefinitionMetadata } from './tool-metadata.js';
import { createEmptyToolContractReport } from './tool-contract-verifier.js';
/**
 * src/copilot/tools/introspection/introspection-tools.js
 *
 * Custom Tools de introspecção do agente. Permite ao agente listar as ferramentas disponíveis, consultar telemetria de
 * chamadas e obter informações sobre si mesmo.
 *
 * @module copilot/tools/introspection/introspection-tools
 * @see EventBus
 * @see module:copilot/agent/status-snapshot
 */

// ─── Estado compartilhado via registry canônico ─────────────────────────────

/**
 * @typedef {import('#copilot/sdk/types').Tool} Tool
 *
 * @typedef {import('#copilot/sdk/types').ToolRegistry} ToolRegistry
 *
 * @typedef {import('#copilot/sdk/types').ToolEntry} ToolEntry
 *
 * @typedef {{
 *     category: string;
 *     tags: string[];
 *     readOnly: boolean;
 * }} ToolIntrospectionMetadata
 *
 * @typedef {{
 *     name: string;
 *     source: 'runtime' | 'session';
 *     reason: string;
 *     disabledAt: string;
 * }} DisabledToolRecord
 */

/**
 * Referência ao ToolRegistry canônico da sessão atual. A introspecção deriva nomes, categorias e metadados direto deste
 * registry para evitar estado paralelo stale.
 *
 * @type {ToolRegistry | null}
 */
let _introspectionRegistry = null;

/**
 * GAP-TOOLS-004: Set de tools desabilitadas em runtime. O agente pode desabilitar/habilitar tools durante a sessão via
 * toggle_tool. O tool-interceptor consulta isToolDisabled() para bloquear chamadas a tools desabilitadas.
 *
 * @type {Set<string>}
 */
const _disabledTools = new Set();

/**
 * Metadados das tools desabilitadas dinamicamente via `toggle_tool`.
 *
 * @type {Map<string, DisabledToolRecord>}
 */
const _disabledToolRecords = new Map();

/**
 * Tools excluídas estaticamente na configuração da sessão SDK (`excludedTools`).
 *
 * Essas tools devem permanecer indisponíveis para o modelo mesmo quando `toggle_tool` tenta habilitá-las.
 *
 * @type {Set<string>}
 */
const _sessionExcludedTools = new Set();

/**
 * Metadados das tools excluídas na criação/configuração da sessão.
 *
 * @type {Map<string, DisabledToolRecord>}
 */
const _sessionExcludedToolRecords = new Map();

/**
 * @param {string} name
 * @param {'runtime' | 'session'} source
 * @param {string | null | undefined} reason
 * @returns {DisabledToolRecord}
 */
function createDisabledToolRecord(name, source, reason) {
    return {
        name,
        source,
        reason:
            typeof reason === 'string' && reason.trim()
                ? reason.trim()
                : source === 'session'
                  ? 'excludedTools da sessão SDK'
                  : 'toggle_tool runtime',
        disabledAt: new Date().toISOString(),
    };
}

/**
 * Atualiza o snapshot de tools excluídas estaticamente na sessão atual.
 *
 * @param {string[] | null | undefined} toolNames
 * @returns {void}
 */
export function setSessionExcludedTools(toolNames) {
    _sessionExcludedTools.clear();
    _sessionExcludedToolRecords.clear();
    if (!Array.isArray(toolNames)) return;
    for (const toolName of toolNames) {
        if (typeof toolName !== 'string') continue;
        const normalized = toolName.trim().toLowerCase();
        if (!normalized) continue;
        _sessionExcludedTools.add(normalized);
        _sessionExcludedToolRecords.set(normalized, createDisabledToolRecord(normalized, 'session', undefined));
    }
}

/**
 * Verifica se uma tool está desabilitada em runtime.
 *
 * @param {string} name - Nome da tool
 * @returns {boolean}
 */
export function isToolDisabled(name) {
    const normalized = name.toLowerCase();
    return _disabledTools.has(normalized) || _sessionExcludedTools.has(normalized);
}

/**
 * Retorna a lista de tools desabilitadas.
 *
 * @returns {string[]}
 */
export function getDisabledTools() {
    return [...new Set([..._sessionExcludedTools, ..._disabledTools])];
}

/**
 * Retorna registros ricos das tools desabilitadas, preservando compatibilidade de `getDisabledTools()`.
 *
 * @returns {DisabledToolRecord[]}
 */
export function getDisabledToolRecords() {
    return [..._sessionExcludedToolRecords.values(), ..._disabledToolRecords.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
    );
}

/**
 * Retorna somente as tools desabilitadas dinamicamente em runtime (via `toggle_tool`).
 *
 * @returns {string[]}
 */
function getRuntimeDisabledTools() {
    return [..._disabledTools];
}

/**
 * @returns {DisabledToolRecord[]}
 */
function getRuntimeDisabledToolRecords() {
    return [..._disabledToolRecords.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Retorna somente as tools excluídas estaticamente pela configuração da sessão SDK.
 *
 * @returns {string[]}
 */
function getSessionExcludedTools() {
    return [..._sessionExcludedTools];
}

/**
 * @returns {DisabledToolRecord[]}
 */
function getSessionExcludedToolRecords() {
    return [..._sessionExcludedToolRecords.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** @type {import('./tool-contract-verifier.js').ToolContractReport} */
let _toolContractReport = createEmptyToolContractReport();

/**
 * Provedor narrow do contexto de agente para enriquecer `get_agent_info` com estado live (modelo negociado e
 * reasoning).
 *
 * @typedef {{
 *     getModelSnapshot: () => string | undefined;
 *     getReasoningEffortSnapshot: () => string | undefined;
 *     getLastPrInfoSnapshot?: () => Record<string, unknown> | null;
 * }} AgentInfoProvider
 */

/** @type {AgentInfoProvider | null} */
let _agentInfoProvider = null;

/**
 * Injeta o provedor narrow do AgentContext para expor `liveModel` e `reasoningEffort` em `get_agent_info`.
 *
 * Deve ser chamado pelo wiring de sessão após `finalizeSessionInit` e limpo em `unbindAgentSessionTools`.
 *
 * @param {AgentInfoProvider | null} provider
 * @returns {void}
 */
export function setAgentInfoProvider(provider) {
    _agentInfoProvider = provider;
}

/**
 * Lista as entradas do ToolRegistry canônico atualmente conectado à introspecção.
 *
 * @returns {ToolEntry[]}
 */
function listRegistryEntries() {
    if (!_introspectionRegistry?.entries) return [];
    return Array.from(_introspectionRegistry.entries.values());
}

/**
 * Lista as tools atualmente registradas no ToolRegistry canônico.
 *
 * @returns {Tool[]}
 */
function listRegisteredTools() {
    return listRegistryEntries().map((entry) => entry.tool);
}

/**
 * Retorna o mapa de categorias derivado do ToolRegistry canônico.
 *
 * @returns {Record<string, string[]>}
 */
function getCategoryToolMap() {
    /** @type {Record<string, string[]>} */
    const categoryMap = {};
    for (const entry of listRegistryEntries()) {
        const category = entry.category ?? 'unknown';
        if (!categoryMap[category]) {
            categoryMap[category] = [];
        }
        categoryMap[category].push(entry.tool.name);
    }
    return categoryMap;
}

/**
 * @param {string} toolName
 * @returns {ToolIntrospectionMetadata}
 */
function getToolMetadata(toolName) {
    const normalized = toolName.toLowerCase();
    for (const [name, entry] of _introspectionRegistry?.entries ?? []) {
        if (name.toLowerCase() === normalized) {
            return {
                category: entry.category,
                tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
                readOnly: entry.readOnly === true,
            };
        }
    }
    return { category: 'unknown', tags: [], readOnly: false };
}

/**
 * @param {Tool} tool
 * @returns {{
 *     legacy: ToolIntrospectionMetadata;
 *     metadata: import('./tool-metadata.js').ToolDefinitionMetadata;
 * }}
 */
function getToolMetadataEnvelope(tool) {
    for (const [name, entry] of _introspectionRegistry?.entries ?? []) {
        if (name.toLowerCase() !== tool.name.toLowerCase()) continue;
        return {
            legacy: getToolMetadata(tool.name),
            metadata:
                _toolContractReport.metadataByName?.[tool.name] ??
                buildToolDefinitionMetadata(name, entry, {
                    permissionMode: _toolContractReport.permissionMode ?? 'selective',
                }),
        };
    }
    return {
        legacy: getToolMetadata(tool.name),
        metadata:
            _toolContractReport.metadataByName?.[tool.name] ??
            buildToolDefinitionMetadata(tool.name, { tool, category: 'unknown', tags: [], readOnly: false }, {
                permissionMode: _toolContractReport.permissionMode ?? 'selective',
            }),
    };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function summarizeToolInstructionText(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim().replace(/\s+/gu, ' ');
    if (!text) return null;
    return text.length > 640 ? `${text.slice(0, 640)}...` : text;
}

/**
 * Resolve uma entrada de telemetria por nome canônico ou alias observado.
 *
 * @param {Record<string, Record<string, unknown>>} stats
 * @param {string} toolName
 * @returns {{ key: string; entry: Record<string, unknown> } | null}
 */
function findTelemetryEntryByName(stats, toolName) {
    if (!toolName) return null;
    if (toolName in stats) {
        return {
            key: toolName,
            entry: stats[toolName] ?? {},
        };
    }

    const normalizedWanted = toolName.toLowerCase();
    for (const [key, entry] of Object.entries(stats)) {
        const aliases = Array.isArray(entry['aliases']) ? /** @type {string[]} */ (entry['aliases']) : [];
        if (
            key.toLowerCase() === normalizedWanted ||
            aliases.some((alias) => alias.toLowerCase() === normalizedWanted)
        ) {
            return {
                key,
                entry,
            };
        }
    }
    return null;
}

/**
 * Informa ao módulo qual ToolRegistry canônico está ativo na sessão atual.
 *
 * @param {ToolRegistry | null | undefined} registry
 * @returns {void}
 */
export function registerForIntrospection(registry) {
    if (!registry?.entries) {
        log('ERROR', `[introspection] registerForIntrospection recebeu registry inválido: ${typeof registry}.`);
        _introspectionRegistry = null;
        return;
    }

    if (registry.entries.size === 0) {
        log('WARN', '[introspection] registerForIntrospection chamado com registry vazio.');
    }

    _introspectionRegistry = registry;
    log('DEBUG', `[introspection] ${registry.entries.size} tools registradas para introspecção.`);
}

/**
 * Atualiza o último relatório de contrato de tools produzido no bootstrap.
 *
 * @param {import('./tool-contract-verifier.js').ToolContractReport} report
 * @returns {void}
 */
export function setToolContractReport(report) {
    _toolContractReport = report;
}

/**
 * Retorna o último relatório de contrato de tools.
 *
 * @returns {import('./tool-contract-verifier.js').ToolContractReport}
 */
export function readToolContractReport() {
    return _toolContractReport;
}

/**
 * Retorna snapshot canônico do estado de carga de tools observado pela introspecção.
 *
 * Útil para `/status`, `/diagnose` e validação de boot/load sem executar uma tool em loop.
 *
 * @returns {{
 *     total: number;
 *     names: string[];
 *     categories: Record<string, number>;
 *     disabled: string[];
 *     disabledRecords: DisabledToolRecord[];
 *     runtimeDisabled: string[];
 *     runtimeDisabledRecords: DisabledToolRecord[];
 *     sessionExcluded: string[];
 *     sessionExcludedRecords: DisabledToolRecord[];
 *     hasCanonicalLocalFsTools: boolean;
 *     hasCanonicalLocalExecTools: boolean;
 *     hasSdkWorkspaceTooling: boolean;
 *     hasLegacySdkShellToolsLoaded: boolean;
 *     toolContract: import('./tool-contract-verifier.js').ToolContractReport;
 *     metadataByName: Record<string, import('./tool-metadata.js').ToolDefinitionMetadata>;
 * }}
 */
export function readIntrospectionRegistrySnapshot() {
    const names = listRegisteredTools()
        .map((tool) => tool.name)
        .sort((a, b) => a.localeCompare(b));
    /** @type {Record<string, number>} */
    const categories = {};
    for (const entry of listRegistryEntries()) {
        categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    }
    const requiredLocalFs = [
        'list_directory',
        'read_file_content',
        'search_in_files',
        'create_file',
        'write_file_content',
        'patch_file',
    ];
    const hasCanonicalLocalFsTools = requiredLocalFs.every((name) => names.includes(name));
    const hasCanonicalLocalExecTools = names.includes('exec_command');
    const hasSdkWorkspaceTooling = names.includes('workspace_read') || names.includes('workspace_write');
    const hasLegacySdkShellToolsLoaded = ['bash', 'write_bash', 'read_bash', 'stop_bash'].some((name) =>
        names.includes(name),
    );
    return {
        total: names.length,
        names,
        categories,
        disabled: getDisabledTools(),
        disabledRecords: getDisabledToolRecords(),
        hasCanonicalLocalFsTools,
        hasCanonicalLocalExecTools,
        hasSdkWorkspaceTooling,
        hasLegacySdkShellToolsLoaded,
        toolContract: _toolContractReport,
        metadataByName: _toolContractReport.metadataByName ?? {},
        runtimeDisabled: getRuntimeDisabledTools(),
        runtimeDisabledRecords: getRuntimeDisabledToolRecords(),
        sessionExcluded: getSessionExcludedTools(),
        sessionExcludedRecords: getSessionExcludedToolRecords(),
    };
}
/**
 * Reseta o estado de introspecção para isolamento de testes.
 *
 * @returns {void}
 */
export function resetIntrospectionStateForTests() {
    _introspectionRegistry = null;
    _disabledTools.clear();
    _disabledToolRecords.clear();
    _sessionExcludedTools.clear();
    _sessionExcludedToolRecords.clear();
    _toolContractReport = createEmptyToolContractReport();
    _agentInfoProvider = null;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * Tool: list_tools — lista as ferramentas disponíveis na sessão.
 */
const listToolsTool = buildTool({
    name: 'list_tools',
    description:
        'Lista todas as ferramentas (Custom Tools) disponíveis nesta sessão. ' +
        'Retorna nome, descrição e parâmetros de cada ferramenta.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{
     *     category?: string;
     *     search?: string;
     *     operation?: string;
     *     risk?: string;
     *     sideEffect?: string;
     *     capability?: string;
     *     detailed?: boolean;
     *     includeSchema?: boolean;
     *     includeInstructions?: boolean;
     * }>} */ (
        /** @type {unknown} */ (
            z.object({
                category: z
                    .string()
                    .optional()
                    .describe('Filtrar por categoria (ex: "code", "git", "session", "task", "hook", "introspection")'),
                search: z.string().optional().describe('Filtrar por termo no nome ou descrição da tool'),
                operation: z
                    .string()
                    .optional()
                    .describe('Filtrar por operação canônica: read, patch, write, delete, search, shell, web etc.'),
                risk: z.string().optional().describe('Filtrar por risco canônico: low, medium, high, destructive.'),
                sideEffect: z
                    .string()
                    .optional()
                    .describe('Filtrar por efeito colateral: none, filesystem, process, network, session etc.'),
                capability: z
                    .string()
                    .optional()
                    .describe('Filtrar por capability booleana: dryRun, rollback, hashPrecondition, pagination, streaming, diff, preview.'),
                detailed: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Se true, inclui metadata canônica, schema resumido e instructions quando solicitado.'),
                includeSchema: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Se true, inclui resumo sanitizado de parameters. Implica detailed=true.'),
                includeInstructions: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Se true, inclui instructions sanitizadas. Implica detailed=true.'),
            })
        )
    ),
    handler: async (
        /** @type {{
         *     category?: string;
         *     search?: string;
         *     operation?: string;
         *     risk?: string;
         *     sideEffect?: string;
         *     capability?: string;
         *     detailed?: boolean;
         *     includeSchema?: boolean;
         *     includeInstructions?: boolean;
         * }} */ {
            category,
            search,
            operation,
            risk,
            sideEffect,
            capability,
            detailed,
            includeSchema,
            includeInstructions,
        },
    ) => {
        log(
            'INFO',
            `[introspection/list_tools] category=${category ?? '*'} search=${search ?? '*'} operation=${operation ?? '*'} risk=${risk ?? '*'}`,
        );

        let tools = listRegisteredTools();

        // GAP-TOOLS-004: filtrar tools desabilitadas em runtime
        if (_disabledTools.size > 0 || _sessionExcludedTools.size > 0) {
            tools = tools.filter((t) => !isToolDisabled(t.name));
        }

        if (search) {
            const term = search.toLowerCase();
            tools = tools.filter(
                (t) => t.name.toLowerCase().includes(term) || (t.description ?? '').toLowerCase().includes(term),
            );
        }

        // Categorias derivadas dinamicamente (fallback para map heurístico se não houver bootstrap)
        if (category) {
            const allowed = getCategoryToolMap()[category];
            if (allowed) tools = tools.filter((t) => allowed.includes(t.name));
        }

        const effectiveDetailed = detailed === true || includeSchema === true || includeInstructions === true;
        const normalizedOperation = typeof operation === 'string' ? operation.trim().toLowerCase() : '';
        const normalizedRisk = typeof risk === 'string' ? risk.trim().toLowerCase() : '';
        const normalizedSideEffect = typeof sideEffect === 'string' ? sideEffect.trim().toLowerCase() : '';
        const normalizedCapability = typeof capability === 'string' ? capability.trim() : '';

        if (normalizedOperation) {
            tools = tools.filter((t) => getToolMetadataEnvelope(t).metadata.operation === normalizedOperation);
        }
        if (normalizedRisk) {
            tools = tools.filter((t) => getToolMetadataEnvelope(t).metadata.risk === normalizedRisk);
        }
        if (normalizedSideEffect) {
            tools = tools.filter((t) => getToolMetadataEnvelope(t).metadata.sideEffect === normalizedSideEffect);
        }
        if (normalizedCapability) {
            tools = tools.filter((t) => {
                const capabilities = getToolMetadataEnvelope(t).metadata.capabilities;
                return capabilities[/** @type {keyof typeof capabilities} */ (normalizedCapability)] === true;
            });
        }

        return {
            count: tools.length,
            tools: tools.map((t) => {
                const envelope = getToolMetadataEnvelope(t);
                const base = {
                    ...envelope.legacy,
                    name: t.name,
                    description: t.description ?? null,
                    disabled: isToolDisabled(t.name),
                    disabledRecord:
                        getDisabledToolRecords().find((record) => record.name === t.name.toLowerCase()) ?? null,
                    operation: envelope.metadata.operation,
                    risk: envelope.metadata.risk,
                    sideEffect: envelope.metadata.sideEffect,
                    effectiveSkipPermission: envelope.metadata.effectiveSkipPermission,
                };
                if (!effectiveDetailed) return base;
                return {
                    ...base,
                    metadata: envelope.metadata,
                    ...(includeSchema ? { parameters: summarizeToolParameterSchema(t.parameters) } : {}),
                    ...(includeInstructions
                        ? { instructions: summarizeToolInstructionText(/** @type {{ instructions?: unknown }} */ (t).instructions) }
                        : {}),
                };
            }),
        };
    },
});

/**
 * Tool: get_agent_info — retorna informações sobre a sessão e o agente atual.
 */
const getAgentInfoTool = buildTool({
    name: 'get_agent_info',
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

        const _lastPrInfo = _agentInfoProvider?.getLastPrInfoSnapshot?.() ?? null;
        const liveModel =
            (typeof _lastPrInfo?.['effectiveModel'] === 'string' ? _lastPrInfo['effectiveModel'] : null) ??
            (typeof _lastPrInfo?.['model'] === 'string' ? _lastPrInfo['model'] : null) ??
            _agentInfoProvider?.getModelSnapshot() ??
            null;

        const ioHealth = readIoRuntimeHealthSnapshot();

        return {
            sdkVersion,
            nodeVersion: process.version,
            model: COPILOT_MODEL ?? 'auto',
            liveModel,
            reasoningEffort: _agentInfoProvider?.getReasoningEffortSnapshot() ?? null,
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            toolsRegistered: listRegistryEntries().length,
            toolNames: listRegisteredTools().map((t) => t.name),
            categories: Object.fromEntries(
                Object.entries(getCategoryToolMap()).map(([toolCategory, toolNames]) => [
                    toolCategory,
                    toolNames.length,
                ]),
            ),
            disabledTools: getDisabledTools(),
            runtimeDisabledTools: getRuntimeDisabledTools(),
            sessionExcludedTools: getSessionExcludedTools(),
            disabledToolRecords: getDisabledToolRecords(),
            runtimeDisabledToolRecords: getRuntimeDisabledToolRecords(),
            sessionExcludedToolRecords: getSessionExcludedToolRecords(),
            hasTelemetry: true,
            io: {
                generatedAt: ioHealth.generatedAt,
                cache: {
                    hitRatio: ioHealth.cache.aggregate.hitRatio,
                    hits: ioHealth.cache.aggregate.hits,
                    misses: ioHealth.cache.aggregate.misses,
                    l2Enabled: Boolean(ioHealth.cache.l2?.['enabled']),
                },
                index: {
                    available: Boolean(ioHealth.index?.available),
                    freshFiles:
                        ioHealth.index && typeof ioHealth.index === 'object' && 'freshFiles' in ioHealth.index
                            ? Number(/** @type {{ freshFiles?: number }} */ (ioHealth.index).freshFiles ?? 0)
                            : 0,
                },
                scopes: {
                    active: ioHealth.scopes.active,
                },
                latency: ioHealth.latency,
            },
            env: {
                COPILOT_MCP_SERVERS: COPILOT_MCP_SERVERS,
                NODE_ENV: process.env['NODE_ENV'] ?? '',
                COPILOT_SDK_ENABLED: String(COPILOT_SDK_ENABLED),
            },
        };
    },
});

/**
 * Tool: get_telemetry — retorna o sumário de telemetria de chamadas de ferramentas desta sessão.
 */
const getTelemetryTool = buildTool({
    name: 'get_telemetry',
    description:
        'Retorna o sumário de telemetria da sessão: total de chamadas, taxa de sucesso, tools mais usadas, ' +
        'chamadas recentes e sessões registradas.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ recent?: number; toolName?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                recent: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .default(10)
                    .describe('Número sugerido de chamadas recentes a incluir no resultado'),
                toolName: z.string().optional().describe('Filtrar histórico por nome específico de tool'),
            })
        )
    ),
    handler: async (/** @type {{ recent?: number; toolName?: string }} */ { toolName }) => {
        const summary = getMetricsSummary();
        const toolsMap = /** @type {Record<string, Record<string, unknown>>} */ (summary.tools ?? {});

        const toolValues = /** @type {Record<string, unknown>[]} */ (Object.values(toolsMap));
        const totalCalls = toolValues.reduce((acc, t) => acc + Number(t['totalCalls'] ?? 0), 0);
        const successCalls = toolValues.reduce((acc, t) => acc + Number(t['successCount'] ?? 0), 0);
        const errorCalls = toolValues.reduce((acc, t) => acc + Number(t['errorCount'] ?? 0), 0);
        const blockedCalls = toolValues.reduce((acc, t) => acc + Number(t['blockedCount'] ?? 0), 0);

        /** @type {{ name: string; count: number; blocked: number; aliases: string[] }[]} */
        let topTools = [];
        if (toolName) {
            const match = findTelemetryEntryByName(toolsMap, toolName);
            if (match) {
                topTools = [
                    {
                        name: match.key,
                        count: Number(match.entry['totalCalls'] ?? 0),
                        blocked: Number(match.entry['blockedCount'] ?? 0),
                        aliases: Array.isArray(match.entry['aliases'])
                            ? /** @type {string[]} */ (match.entry['aliases'])
                            : [],
                    },
                ];
            }
        } else {
            topTools = Object.entries(toolsMap)
                .sort(([, a], [, b]) => Number(b['totalCalls'] ?? 0) - Number(a['totalCalls'] ?? 0))
                .slice(0, 10)
                .map(([name, t]) => ({
                    name,
                    count: Number(t['totalCalls'] ?? 0),
                    blocked: Number(t['blockedCount'] ?? 0),
                    aliases: Array.isArray(t['aliases']) ? /** @type {string[]} */ (t['aliases']) : [],
                }));
        }

        return {
            available: true,
            summary: {
                total: totalCalls,
                success: successCalls,
                errors: errorCalls,
                blocked: blockedCalls,
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
 * Tool: report_intent_local — logging local de intenção.
 *
 * A built-in do CLI (`report_intent`) deve prevalecer quando disponível. Este fallback local é mantido para runtimes
 * sem a built-in.
 */
const reportIntentTool = buildTool({
    name: 'report_intent_local',
    description:
        'Intent logging local. Prefira a built-in do CLI: "report_intent" quando disponível. ' +
        'Registra a intenção do agente antes de executar uma ação sensível (ex: deletar arquivo, fazer push, ' +
        'executar comando destrutivo). Use ANTES de chamar uma tool que modifique estado externo irreversível. ' +
        'Não executa nenhuma ação — apenas registra e retorna confirmação de auditoria.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ intent: string; tool: string; risk?: string }>} */ (
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
 * GAP-TOOLS-004: Tool toggle_tool — permite ao agente desabilitar/habilitar tools em runtime. Tools desabilitadas são
 * bloqueadas pelo tool-interceptor e não aparecem em list_tools. Tools de introspecção (list_tools, get_agent_info,
 * toggle_tool) não podem ser desabilitadas.
 */
const PROTECTED_TOOLS = new Set([
    'list_tools',
    'get_agent_info',
    'get_telemetry',
    'report_intent_local',
    'toggle_tool',
]);

const toggleToolTool = buildTool({
    name: 'toggle_tool',
    description:
        'Desabilita ou habilita uma tool em runtime. Tools desabilitadas são bloqueadas e não aparecem em list_tools. ' +
        'Use para restringir temporariamente o acesso a tools durante operações sensíveis. ' +
        'As tools de introspecção não podem ser desabilitadas.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ toolName: string; enabled: boolean; reason?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                toolName: z.string().describe('Nome da tool a habilitar/desabilitar'),
                enabled: z.boolean().describe('true para habilitar, false para desabilitar'),
                reason: z
                    .string()
                    .optional()
                    .describe('Motivo operacional curto para auditoria quando enabled=false.'),
            })
        )
    ),
    handler: async (/** @type {{ toolName: string; enabled: boolean; reason?: string }} */ { toolName, enabled, reason }) => {
        const normalized = toolName.toLowerCase();

        if (PROTECTED_TOOLS.has(normalized)) {
            log('WARN', `[introspection/toggle_tool] tool protegida não pode ser desabilitada: ${toolName}`);
            return { success: false, reason: 'tool protegida', toolName, enabled: true };
        }

        // Verificar se a tool existe
        const exists = listRegisteredTools().some((t) => t.name.toLowerCase() === normalized);
        if (!exists) {
            return { success: false, reason: 'tool não encontrada', toolName, enabled };
        }

        if (enabled) {
            if (_sessionExcludedTools.has(normalized)) {
                return {
                    success: false,
                    reason: 'tool excluída pela configuração da sessão (excludedTools)',
                    toolName,
                    enabled: false,
                    sessionExcludedTools: getSessionExcludedTools(),
                };
            }
            _disabledTools.delete(normalized);
            _disabledToolRecords.delete(normalized);
            log('INFO', `[introspection/toggle_tool] tool habilitada: ${toolName}`);
        } else {
            _disabledTools.add(normalized);
            _disabledToolRecords.set(normalized, createDisabledToolRecord(normalized, 'runtime', reason));
            log('INFO', `[introspection/toggle_tool] tool desabilitada: ${toolName}${reason ? ` · ${reason}` : ''}`);
        }

        return {
            success: true,
            toolName,
            enabled,
            disabledTools: getDisabledTools(),
            runtimeDisabledTools: getRuntimeDisabledTools(),
            sessionExcludedTools: getSessionExcludedTools(),
            disabledToolRecords: getDisabledToolRecords(),
            runtimeDisabledToolRecords: getRuntimeDisabledToolRecords(),
            sessionExcludedToolRecords: getSessionExcludedToolRecords(),
        };
    },
});

/**
 * Tool: get_tool_health — retorna métricas de uso por tool: chamadas, erros, latência e status.
 *
 * F7.3: introspecção por tool individual para diagnóstico de saúde.
 */
const getToolHealthTool = buildTool({
    name: 'get_tool_health',
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
            limit: z.number().int().min(1).optional().default(20).describe('Número sugerido de tools no resultado'),
        })
    ),
    handler: async (
        /** @type {{ tool_name?: string; sort_by?: 'calls' | 'errors' | 'latency' | 'error_rate'; limit?: number }} */ {
            tool_name,
            sort_by = 'calls',
            limit,
        },
    ) => {
        const stats = /** @type {Record<string, Record<string, unknown>>} */ (getToolStats());

        if (tool_name) {
            const match = findTelemetryEntryByName(stats, tool_name);
            if (!match) return { found: false, tool: tool_name };
            return { found: true, tool: match.key, requestedTool: tool_name, stats: match.entry };
        }

        /** @type {keyof ReturnType<typeof getToolStats>[string]} */
        const sortKey = sort_by === 'latency' ? 'avgLatencyMs' : sort_by === 'error_rate' ? 'errorRate' : sort_by;

        const entries = Object.entries(stats)
            .sort(([, a], [, b]) => {
                const av = /** @type {number} */ (a[/** @type {keyof typeof a} */ (sortKey)] ?? 0);
                const bv = /** @type {number} */ (b[/** @type {keyof typeof b} */ (sortKey)] ?? 0);
                return bv - av;
            })
            .slice(0, typeof limit === 'number' ? limit : undefined)
            .map(([name, s]) => ({ name, ...s }));

        const total = Object.values(stats).reduce((acc, s) => acc + Number(s['calls'] ?? 0), 0);
        const totalErrors = Object.values(stats).reduce((acc, s) => acc + Number(s['errors'] ?? 0), 0);
        const totalBlocked = Object.values(stats).reduce((acc, s) => acc + Number(s['blocked'] ?? 0), 0);

        log('DEBUG', `[get_tool_health] stats=${Object.keys(stats).length} tools tracked`);
        return {
            tracked: Object.keys(stats).length,
            totalCalls: total,
            totalErrors,
            totalBlocked,
            overallErrorRate: total > 0 ? parseFloat(((totalErrors / total) * 100).toFixed(1)) : 0,
            topTools: entries,
        };
    },
});

/**
 * Tool: get_tool_contract_report — retorna o relatório completo do verificador de contrato de tools.
 */
const getToolContractReportTool = buildTool({
    name: 'get_tool_contract_report',
    description:
        'Retorna o relatório do Tool Contract Verifier com erros, warnings e cobertura de metadados das tools ' +
        'registradas no runtime atual.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ maxIssues?: number }>} */ (
        /** @type {unknown} */ (
            z.object({
                maxIssues: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .optional()
                    .default(50)
                    .describe('Quantidade máxima de issues retornadas'),
            })
        )
    ),
    handler: async (/** @type {{ maxIssues?: number }} */ { maxIssues }) => {
        const report = readToolContractReport();
        const limit = typeof maxIssues === 'number' ? maxIssues : 50;
        return {
            ...report,
            issues: report.issues.slice(0, limit),
            totalIssues: report.issues.length,
            issuesTruncated: report.issues.length > limit,
        };
    },
});

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const introspectionTools = [
    withSkipPermission(listToolsTool),
    withSkipPermission(getAgentInfoTool),
    withSkipPermission(getTelemetryTool),
    withSkipPermission(reportIntentTool),
    withSkipPermission(toggleToolTool),
    withSkipPermission(getToolHealthTool),
    withSkipPermission(getToolContractReportTool),
];
