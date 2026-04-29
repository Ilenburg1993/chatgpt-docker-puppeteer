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
 * @see module:copilot/tools/tool-factory
 * @see module:copilot/sdk/tools-registry
 */

import { log, wrapWithStats } from '#copilot/observability';
import { buildCustomTools, registerTools } from '#copilot/sdk';
import { codeTools } from './code-tools.js';
import { experimentalRpcTools, setExperimentalSession } from './experimental-rpc-tools.js';
import { fileReadTools, fileWriteTools } from './file/index.js';
import { gitTools } from './git/index.js';
import { configureHookTools, hookTools } from './hook-tools.js';
import { hubTools, setHub } from './hub-tools.js';
import { introspectionTools, registerForIntrospection } from './introspection-tools.js';
import { permissionTools, setPermissionAgent } from './permission-tools.js';
import { sessionRpcTools, setSessionRpc } from './session-rpc-tools.js';
import { sessionTools } from './session-tools.js';
import { shellTools } from './shell/index.js';
import { taskTools } from './task-tools.js';
import { todoReadTools, todoWriteTools } from './todo/index.js';
import { webTools } from './web-tools.js';

/**
 * @typedef {import('#copilot/sdk/tools-registry').ToolRegistry} ToolRegistry
 *
 * @typedef {import('#copilot/sdk/types').Tool} Tool
 */

// R13: configureHookTools, setHub, setPermissionAgent, setSessionRpc, setExperimentalSession exportados diretamente de tools/index.js
// O infra barrel (infra/index.js) re-exporta de tools-bootstrap.js; consumidores devem usar o barrel agent/.
export { configureHookTools, setExperimentalSession, setHub, setPermissionAgent, setSessionRpc };

/**
 * Registra todas as tools estáticas do agente no registry por categoria/tags, e expõe o registry/telemetria para as
 * ferramentas de introspecção.
 *
 * @param {ToolRegistry} registry - Registry de tools da sessão
 * @param {Tool[]} mcpTools - Tools MCP dinâmicas carregadas via bridge (pode ser vazio)
 * @returns {Tool[]} Array consolidado `[...staticTools, ...mcpTools]` pronto para a sessão SDK
 */
export function bootstrapTools(registry, mcpTools) {
    /**
     * G1-ARCH-07: Lista única de pares [tools, opts] usada tanto para registro quanto para buildAllTools. Declarada
     * local à função para evitar TDZ com módulos que exportam via inicialização lazy. Adicionar um novo grupo aqui é
     * suficiente — não há necessidade de duplicar no spread de `allTools`.
     *
     * @type {[import('#copilot/sdk/types').Tool[], Record<string, unknown>][]} }
     */
    const TOOL_GROUPS = [
        [taskTools, { category: 'task', tags: ['queue', 'state'] }],
        [codeTools, { category: 'code', tags: ['lint', 'test', 'typecheck'], readOnly: true }],
        [gitTools, { category: 'git', tags: ['vcs', 'diff', 'commit'] }],
        [sessionTools, { category: 'session', tags: ['hooks', 'briefing'] }],
        [sessionRpcTools, { category: 'session-rpc', tags: ['rpc', 'mode', 'plan', 'agent', 'compaction'] }],
        [hookTools, { category: 'hook', tags: ['audit', 'input', 'hooks'] }],
        [hubTools, { category: 'hub', tags: ['conversation', 'llm-b', 'dialog', 'persistent'] }],
        [introspectionTools, { category: 'introspection', tags: ['meta', 'telemetry'], readOnly: true }],
        [fileReadTools, { category: 'file', tags: ['filesystem', 'io', 'read'], readOnly: true }],
        [fileWriteTools, { category: 'file', tags: ['filesystem', 'io', 'write'] }],
        [shellTools, { category: 'shell', tags: ['exec', 'system', 'npm', 'node'] }],
        [webTools, { category: 'web', tags: ['http', 'fetch', 'ssrf-protected'] }],
        [todoReadTools, { category: 'todo', tags: ['tasks', 'todo', 'management', 'read'], readOnly: true }],
        [todoWriteTools, { category: 'todo', tags: ['tasks', 'todo', 'management', 'write'] }],
        [
            experimentalRpcTools,
            { category: 'experimental', tags: ['rpc', 'fleet', 'agent', 'skills', 'mcp', 'plugins', 'extensions'] },
        ],
        [permissionTools, { category: 'permission', tags: ['approval', 'security', 'runtime-control'] }],
    ];

    // G1-ARCH-07: itera sobre TOOL_GROUPS uma única vez — evita duplicação entre registerTools e allTools
    // C1-FIX: Granular error handling em cada categoria de tools (bootstrap robusto)
    for (const [tools, opts] of TOOL_GROUPS) {
        try {
            registerTools(registry, tools, opts);
        } catch (err) {
            const category = /** @type {Record<string, unknown>} */ (opts)['category'] ?? 'unknown';
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

    const allTools = [...TOOL_GROUPS.flatMap(([t]) => t), ...mcpTools, ...customTools];

    // F7.3: instrumentar todas as tools com wrapWithStats para capturar latência e erros automaticamente
    const instrumentedTools = allTools.map(wrapWithStats);

    // Expõe registry para as ferramentas de introspecção (necessário antes de iniciar sessão)
    registerForIntrospection(instrumentedTools, registry);

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
    for (const [tools, opts] of TOOL_GROUPS) {
        const cat = /** @type {string} */ (/** @type {Record<string, unknown>} */ (opts)['category'] ?? 'unknown');
        categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + tools.length);
    }
    if (mcpTools.length > 0) categoryCount.set('mcp', mcpTools.length);
    if (customTools.length > 0) categoryCount.set('custom', customTools.length);
    const summary = [...categoryCount.entries()].map(([cat, n]) => `${cat}:${n}`).join(', ');
    log('INFO', `[tools-bootstrap] Bootstrap concluído: ${allTools.length} tools registradas (${summary})`);

    return instrumentedTools;
}
