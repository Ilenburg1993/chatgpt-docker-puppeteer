// @ts-check
/**
 * @module copilot/tools/bootstrap
 * @file Inicialização de tools do agente — registro por categoria e tags.
 *
 *   Extrai a lógica repetitiva de `registerTools(registry, grupo, opts)` do método `start()` de `AlwaysAliveAgent`,
 *   tornando-a testável e legível de forma independente.
 *
 *   **Limitação conhecida — remoção dinâmica de tools:** O array de tools é montado uma única vez em `bootstrapTools()` e
 *   passado ao SDK na criação da sessão. O Copilot SDK não oferece API para adicionar ou remover tools de uma sessão já
 *   ativa. Para desabilitar uma categoria de tools em runtime (ex.: `shellTools`), a sessão precisa ser recriada via
 *   `stop()` + `start()`. Um futuro `unregisterTool(name)` no `ToolRegistry` poderia manter o registro em sincronia,
 *   mas a limitação real está no SDK.
 * @see EventBus
 * @see module:copilot/tools/infra/tool-factory
 * @see module:copilot/sdk/tools-registry
 */

import { buildCustomTools, getAllTools as getRegistryTools, registerTools } from '#copilot/sdk/tools';
import { log } from '../observability/logger.js';
import { wrapWithStats } from '../observability/tool-stats.js';
import { codeReadTools, codeTools, codeWriteTools } from './code/index.js';
import { fileReadTools, fileWriteTools, indexTools, scopeTools } from './file/index.js';
import { searchTools } from './search/index.js';
import { gitTools } from './git/index.js';
import { configureHookTools, hookTools } from './hook/index.js';
import { hubTools, setHub } from './hub/index.js';
import { modelGatewayReadTools, modelGatewayWriteTools } from './model-gateway/index.js';
import {
    introspectionTools,
    registerForIntrospection,
    setToolBootstrapHealth,
    setToolContractReport,
    verifyToolRegistryContracts,
} from './introspection/index.js';
import { permissionTools, setPermissionAgent } from './permission/index.js';
import {
    experimentalRpcTools,
    reloadAgentProcessTool,
    sessionRpcTools,
    sessionTools,
    setExperimentalSession,
    setSessionRpc,
} from './session/index.js';
import { shellTools } from './shell/index.js';
import { taskTools } from './task/index.js';
import { todoReadTools, todoWriteTools } from './todo/index.js';
import { webTools } from './web/index.js';

/**
 * @typedef {import('#copilot/sdk/types').ToolRegistry} ToolRegistry
 *
 * @typedef {import('#copilot/sdk/types').Tool} Tool
 *
 * @typedef {{ tools: import('#copilot/sdk/types').Tool[]; category: string; tags: string[]; readOnly?: boolean }} ToolGroupConfig
 */

// R13: configureHookTools, setHub, setPermissionAgent, setSessionRpc, setExperimentalSession exportados diretamente de tools/index.js
// O infra barrel (infra/index.js) re-exporta de tools-bootstrap.js; consumidores devem usar o barrel agent/.
export { configureHookTools, setExperimentalSession, setHub, setPermissionAgent, setSessionRpc };

// ─── getAllTools flat — array de todas as tools para consumers externos (ex.: server/routes/sdk/deps.js) ─────

/** @type {import('#copilot/sdk/types').Tool[] | undefined} */
let _allToolsCache;

/**
 * Retorna o array flat de todas as tools estáticas registráveis. Usa cache após primeira chamada (lazy singleton).
 *
 * Consumidores externos (ex.: `server/routes/sdk/deps.js`) que precisam enumerar as tools sem registry SDK devem usar
 * esta função.
 *
 * @returns {import('#copilot/sdk/types').Tool[]}
 */
export function getAllStaticTools() {
    if (!_allToolsCache) {
        _allToolsCache = [
            ...taskTools,
            ...codeTools,
            ...gitTools,
            ...sessionTools,
            ...sessionRpcTools,
            reloadAgentProcessTool,
            ...hookTools,
            ...hubTools,
            ...modelGatewayReadTools,
            ...modelGatewayWriteTools,
            ...introspectionTools,
            ...(fileReadTools ?? []),
            ...(indexTools ?? []),
            ...(scopeTools ?? []),
            ...(fileWriteTools ?? []),
            ...searchTools,
            ...shellTools,
            ...webTools,
            ...todoReadTools,
            ...todoWriteTools,
            ...permissionTools,
            ...experimentalRpcTools,
        ];
    }
    return _allToolsCache;
}

/**
 * @deprecated Use `getAllStaticTools()` — mantido por compatibilidade para consumers existentes de `#copilot/tools`.
 * @returns {import('#copilot/sdk/types').Tool[]}
 */
export function getAllTools() {
    return getAllStaticTools();
}

/**
 * @deprecated Use `getAllTools()` — proxy histórico mantido para compatibilidade.
 * @type {import('#copilot/sdk/types').Tool[]}
 */
export const allTools = /** @type {any} */ (
    new Proxy([], {
        get(_, prop) {
            const arr = getAllTools();
            const val = Reflect.get(arr, prop);
            return typeof val === 'function' ? val.bind(arr) : val;
        },
        has(_, prop) {
            return Reflect.has(getAllTools(), prop);
        },
        ownKeys() {
            return Reflect.ownKeys(getAllTools());
        },
        getOwnPropertyDescriptor(_, prop) {
            return Object.getOwnPropertyDescriptor(getAllTools(), prop);
        },
    })
);

/**
 * @param {{ category: string; error: string; toolCount: number }[]} failedToolCategories
 * @param {number} [generatedAt]
 */
export function buildToolBootstrapHealth(failedToolCategories, generatedAt = Date.now()) {
    return {
        generatedAt,
        bootstrapDegraded: failedToolCategories.length > 0,
        failedToolCategories,
        failedToolCategoryNames: failedToolCategories.map((record) => record.category),
    };
}

const PRIMARY_TOOL_CATEGORIES = new Set(['code', 'file', 'search', 'shell', 'introspection']);

/**
 * @param {{ category: string; error: string; toolCount: number }[]} failedToolCategories
 * @returns {{ category: string; error: string; toolCount: number }[]}
 */
export function findFailedPrimaryToolCategories(failedToolCategories) {
    return failedToolCategories.filter((record) => PRIMARY_TOOL_CATEGORIES.has(record.category));
}

/**
 * @param {{ category: string; error: string; toolCount: number }[]} failedToolCategories
 * @param {{ strict?: boolean }} [options]
 */
export function assertPrimaryToolCategoriesHealthy(failedToolCategories, options = {}) {
    const strict =
        options.strict === true || process.env['CI'] === 'true' || process.env['COPILOT_BOOTSTRAP_STRICT_CI'] === '1';
    if (!strict) return;
    const failedPrimaryCategories = findFailedPrimaryToolCategories(failedToolCategories);
    if (failedPrimaryCategories.length === 0) return;
    throw new Error(
        `Categorias primárias de tools falharam no bootstrap: ${failedPrimaryCategories
            .map((record) => `${record.category}(${record.error})`)
            .join(', ')}`,
    );
}

/**
 * @param {ToolRegistry} registry
 * @param {ToolGroupConfig[]} toolGroups
 * @param {(registry: ToolRegistry, tools: Tool[], options: { category: string; tags: string[]; readOnly?: boolean }) => void} [registerFn]
 * @returns {{ category: string; error: string; toolCount: number }[]}
 */
export function registerToolGroupsCollectFailures(registry, toolGroups, registerFn = registerTools) {
    /** @type {{ category: string; error: string; toolCount: number }[]} */
    const failedToolCategories = [];
    for (const group of toolGroups) {
        try {
            registerFn(registry, group.tools, {
                category: group.category,
                tags: group.tags,
                ...(group.readOnly !== undefined ? { readOnly: group.readOnly } : {}),
            });
        } catch (err) {
            const category = group.category;
            const error = /** @type {Error} */ (err);
            log('ERROR', `[tools-bootstrap] Erro ao registrar categoria '${category}': ${error.message}`);
            failedToolCategories.push({ category, error: error.message, toolCount: group.tools.length });
        }
    }
    return failedToolCategories;
}

/**
 * Registra todas as tools estáticas do agente no registry por categoria/tags, e expõe o registry/telemetria para as
 * ferramentas de introspecção.
 *
 * @param {ToolRegistry} registry - Registry de tools da sessão
 * @param {Tool[]} mcpTools - Tools MCP dinâmicas carregadas via bridge (pode ser vazio)
 * @returns {Tool[]} Array consolidado `[...staticTools, ...mcpTools]` pronto para a sessão SDK
 */
export function bootstrapTools(registry, mcpTools) {
    /** @type {ToolGroupConfig[]} */
    const TOOL_GROUPS = [
        { tools: taskTools, category: 'task', tags: ['queue', 'state'] },
        { tools: codeReadTools, category: 'code', tags: ['lint', 'test', 'typecheck'], readOnly: true },
        { tools: codeWriteTools, category: 'code', tags: ['lint', 'fix', 'filesystem', 'write'], readOnly: false },
        { tools: gitTools, category: 'git', tags: ['vcs', 'diff', 'commit'] },
        { tools: sessionTools, category: 'session', tags: ['hooks', 'briefing'] },
        { tools: sessionRpcTools, category: 'session-rpc', tags: ['rpc', 'mode', 'plan', 'agent', 'compaction'] },
        { tools: [reloadAgentProcessTool], category: 'process', tags: ['reload', 'restart', 'process'] },
        { tools: hookTools, category: 'hook', tags: ['audit', 'input', 'hooks'] },
        { tools: hubTools, category: 'hub', tags: ['conversation', 'llm-b', 'dialog', 'persistent'] },
        {
            tools: modelGatewayReadTools,
            category: 'model-gateway',
            tags: ['models', 'catalog', 'byok', 'routing', 'read'],
            readOnly: true,
        },
        {
            tools: modelGatewayWriteTools,
            category: 'model-gateway',
            tags: ['models', 'byok', 'runtime', 'switch', 'write'],
            readOnly: false,
        },
        { tools: introspectionTools, category: 'introspection', tags: ['meta', 'telemetry'], readOnly: true },
        { tools: searchTools, category: 'search', tags: ['filesystem', 'io', 'search'], readOnly: true },
        { tools: fileReadTools, category: 'file', tags: ['filesystem', 'io', 'read'], readOnly: true },
        { tools: indexTools, category: 'file-index', tags: ['filesystem', 'io', 'index'], readOnly: true },
        { tools: scopeTools, category: 'file-scope', tags: ['filesystem', 'io', 'scope'], readOnly: true },
        { tools: fileWriteTools, category: 'file', tags: ['filesystem', 'io', 'write'] },
        { tools: shellTools, category: 'shell', tags: ['exec', 'system', 'npm', 'node'] },
        { tools: webTools, category: 'web', tags: ['http', 'fetch', 'ssrf-protected'], readOnly: true },
        { tools: todoReadTools, category: 'todo', tags: ['tasks', 'todo', 'management', 'read'], readOnly: true },
        { tools: todoWriteTools, category: 'todo', tags: ['tasks', 'todo', 'management', 'write'] },
        {
            tools: experimentalRpcTools,
            category: 'experimental',
            tags: ['rpc', 'fleet', 'agent', 'skills', 'mcp', 'plugins', 'extensions'],
        },
        { tools: permissionTools, category: 'permission', tags: ['approval', 'security', 'runtime-control'] },
    ];

    // G1-ARCH-07: itera sobre TOOL_GROUPS uma única vez — evita duplicação entre registerTools e allTools
    // C1-FIX: Granular error handling em cada categoria de tools (bootstrap robusto)
    const failedToolCategories = registerToolGroupsCollectFailures(registry, TOOL_GROUPS);

    if (mcpTools.length > 0) {
        try {
            registerTools(registry, mcpTools, { category: 'mcp', tags: ['mcp', 'external'] });
        } catch (err) {
            const error = /** @type {Error} */ (err);
            log('ERROR', `[tools-bootstrap] Erro ao registrar MCP tools: ${error.message}`);
            failedToolCategories.push({ category: 'mcp', error: error.message, toolCount: mcpTools.length });
        }
    }

    // Tools declarativas customizadas registradas via /config/tools/custom.
    const customTools = buildCustomTools();
    if (customTools.length > 0) {
        try {
            registerTools(registry, customTools, { category: 'custom', tags: ['runtime', 'declarative'] });
        } catch (err) {
            const error = /** @type {Error} */ (err);
            log('ERROR', `[tools-bootstrap] Erro ao registrar custom tools: ${error.message}`);
            failedToolCategories.push({ category: 'custom', error: error.message, toolCount: customTools.length });
        }
    }

    // Ajustes finos de readOnly para tools de consulta sem efeito colateral, mantendo execução livre por padrão.
    const forceReadOnlyTools = ['invoke_skill', 'hook_get_audit_tail'];
    for (const toolName of forceReadOnlyTools) {
        const entry = registry.entries.get(toolName);
        if (!entry) continue;
        registry.entries.set(toolName, {
            ...entry,
            readOnly: true,
            tool: entry.tool.skipPermission === true ? entry.tool : { ...entry.tool, skipPermission: true },
        });
    }

    const allTools = getRegistryTools(registry);
    const permissionMode = readBootstrapPermissionMode();
    const sdkSessionTools = applySessionToolPermissionPolicy(allTools, permissionMode);

    // F7.3: instrumentar todas as tools com wrapWithStats para capturar latência e erros automaticamente
    const instrumentedTools = sdkSessionTools.map(wrapWithStats);

    assertPrimaryToolCategoriesHealthy(failedToolCategories);
    setToolBootstrapHealth(buildToolBootstrapHealth(failedToolCategories));

    // Expõe registry para as ferramentas de introspecção (necessário antes de iniciar sessão)
    registerForIntrospection(registry);

    const contractReport = verifyToolRegistryContracts(registry, { permissionMode });
    setToolContractReport(contractReport);
    if (contractReport.errorCount > 0 || contractReport.warningCount > 0) {
        log(
            contractReport.errorCount > 0 ? 'WARN' : 'INFO',
            `[tools-bootstrap] Tool Contract Verifier: total=${contractReport.totalTools} errors=${contractReport.errorCount} warnings=${contractReport.warningCount} ` +
                `(desc=${contractReport.metadataCoverage.descriptionPct}% schema=${contractReport.metadataCoverage.parametersPct}% category=${contractReport.metadataCoverage.categoryPct}% tags=${contractReport.metadataCoverage.tagsPct}% instructions=${contractReport.metadataCoverage.instructionsPct}%)`,
        );
    }

    // Detecta colisões de nome entre tools. Cada tool com sobreposição potencial com built-ins do CLI
    // deve declarar `overridesBuiltInTool` explicitamente; não forçar globalmente para não mascarar conflitos.
    const nameCount = /** @type {Map<string, number>} */ (new Map());
    for (const t of allTools) {
        nameCount.set(t.name, (nameCount.get(t.name) ?? 0) + 1);
    }
    for (const [name, count] of nameCount) {
        if (count > 1) {
            log('WARN', `[tools-bootstrap] Tool "${name}" registrada ${count}× — verifique sobreposição acidental.`);
        }
    }

    // G2-DX-18: log de summary do bootstrap com count por categoria.
    /** @type {Map<string, number>} */
    const categoryCount = new Map();
    for (const group of TOOL_GROUPS) {
        categoryCount.set(group.category, (categoryCount.get(group.category) ?? 0) + group.tools.length);
    }
    if (mcpTools.length > 0) categoryCount.set('mcp', mcpTools.length);
    if (customTools.length > 0) categoryCount.set('custom', customTools.length);
    const summary = [...categoryCount.entries()].map(([cat, n]) => `${cat}:${n}`).join(', ');
    log(
        'INFO',
        `[tools-bootstrap] Bootstrap concluído: ${allTools.length} tools registradas (${summary}); permissionMode=${permissionMode}; sdkSkipPermission=${shouldSkipSdkPermissionPrompts(permissionMode) ? 'yes' : 'no'}`,
    );

    return instrumentedTools;
}

/**
 * Lê o modo de permissão sem importar `#copilot/config`, porque o bootstrap de tools é uma raiz de composição e precisa
 * evitar ciclos ESM com módulos que também dependem de `#copilot/tools`.
 *
 * @returns {'approve_all' | 'audit_only' | 'selective'}
 */
function readBootstrapPermissionMode() {
    const mode = process.env['AGENT_PERMISSION_MODE'];
    if (mode === 'audit_only' || mode === 'selective') return mode;
    return 'approve_all';
}

/**
 * Em modo operacional approve_all/audit_only, o handler de permissão continua existindo para auditoria, mas a sessão SDK
 * não deve abrir prompts/janelas para cada tool. Em selective, preservamos o contrato original para que a policy granular
 * continue tendo oportunidade de intervir.
 *
 * @param {Tool[]} tools
 * @param {'approve_all' | 'audit_only' | 'selective'} permissionMode
 * @returns {Tool[]}
 */
export function applySessionToolPermissionPolicy(tools, permissionMode = 'approve_all') {
    if (!shouldSkipSdkPermissionPrompts(permissionMode)) return tools;
    return tools.map((tool) => (tool.skipPermission === true ? tool : { ...tool, skipPermission: true }));
}

/**
 * @param {'approve_all' | 'audit_only' | 'selective'} permissionMode
 * @returns {boolean}
 */
export function shouldSkipSdkPermissionPrompts(permissionMode = 'approve_all') {
    return permissionMode === 'approve_all' || permissionMode === 'audit_only';
}
