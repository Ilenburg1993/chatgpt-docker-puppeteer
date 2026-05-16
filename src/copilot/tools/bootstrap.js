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

import { log, wrapWithStats } from '#copilot/observability';
import { buildCustomTools, getAllTools as getRegistryTools, registerTools } from '#copilot/sdk/tools';
import { codeTools } from './code/index.js';
import { fileReadTools, fileWriteTools, indexTools, scopeTools } from './file/index.js';
import { searchTools } from './search/index.js';
import { gitTools } from './git/index.js';
import { configureHookTools, hookTools } from './hook/index.js';
import { hubTools, setHub } from './hub/index.js';
import {
    introspectionTools,
    registerForIntrospection,
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
        { tools: codeTools, category: 'code', tags: ['lint', 'test', 'typecheck'], readOnly: true },
        { tools: gitTools, category: 'git', tags: ['vcs', 'diff', 'commit'] },
        { tools: sessionTools, category: 'session', tags: ['hooks', 'briefing'] },
        { tools: sessionRpcTools, category: 'session-rpc', tags: ['rpc', 'mode', 'plan', 'agent', 'compaction'] },
        { tools: [reloadAgentProcessTool], category: 'process', tags: ['reload', 'restart', 'process'] },
        { tools: hookTools, category: 'hook', tags: ['audit', 'input', 'hooks'] },
        { tools: hubTools, category: 'hub', tags: ['conversation', 'llm-b', 'dialog', 'persistent'] },
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
    for (const group of TOOL_GROUPS) {
        try {
            registerTools(registry, group.tools, {
                category: group.category,
                tags: group.tags,
                ...(group.readOnly !== undefined ? { readOnly: group.readOnly } : {}),
            });
        } catch (err) {
            const category = group.category;
            const error = /** @type {Error} */ (err);
            log('ERROR', `[tools-bootstrap] Erro ao registrar categoria '${category}': ${error.message}`);
            // Não relançar — permitir que outras categorias sejam registradas
        }
    }

    if (mcpTools.length > 0) {
        try {
            registerTools(registry, mcpTools, { category: 'mcp', tags: ['mcp', 'external'] });
        } catch (err) {
            const error = /** @type {Error} */ (err);
            log('ERROR', `[tools-bootstrap] Erro ao registrar MCP tools: ${error.message}`);
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

    // F7.3: instrumentar todas as tools com wrapWithStats para capturar latência e erros automaticamente
    const instrumentedTools = allTools.map(wrapWithStats);

    // Expõe registry para as ferramentas de introspecção (necessário antes de iniciar sessão)
    registerForIntrospection(registry);

    const contractReport = verifyToolRegistryContracts(registry);
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
    log('INFO', `[tools-bootstrap] Bootstrap concluído: ${allTools.length} tools registradas (${summary})`);

    return instrumentedTools;
}
