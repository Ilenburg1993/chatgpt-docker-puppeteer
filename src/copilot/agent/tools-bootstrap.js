// @ts-check
/**
 * @module copilot/agent/tools-bootstrap
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
 */

import { log } from '#core/logger';
import { buildCustomTools } from '../config/tools/registry.js';
import { registerTools } from '../lib/tools-registry.js';
import {
    codeTools,
    fileReadTools,
    fileWriteTools,
    gitTools,
    hookTools,
    hubTools,
    introspectionTools,
    permissionTools,
    registerForIntrospection,
    sessionRpcTools,
    sessionTools,
    setTelemetryStore,
    shellTools,
    taskTools,
    todoReadTools,
    todoWriteTools,
    webTools,
} from '../tools/index.js';

/**
 * @typedef {import('#copilot/lib/tools-registry').ToolRegistry} ToolRegistry
 *
 * @typedef {import('#copilot/lib/telemetry').TelemetryStore} TelemetryStore
 *
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 */

export { configureHookTools, setHub, setSessionRpc } from '../tools/index.js';

/**
 * Registra todas as tools estáticas do agente no registry por categoria/tags, e expõe o registry/telemetria para as
 * ferramentas de introspecção.
 *
 * @param {ToolRegistry} registry - Registry de tools da sessão
 * @param {TelemetryStore} telemetry - Store de telemetria da sessão
 * @param {Tool[]} mcpTools - Tools MCP dinâmicas carregadas via bridge (pode ser vazio)
 * @returns {Tool[]} Array consolidado `[...staticTools, ...mcpTools]` pronto para a sessão SDK
 */
export function bootstrapTools(registry, telemetry, mcpTools) {
    /**
     * G1-ARCH-07: Lista única de pares [tools, opts] usada tanto para registro quanto para buildAllTools. Declarada
     * local à função para evitar TDZ com módulos que exportam via inicialização lazy. Adicionar um novo grupo aqui é
     * suficiente — não há necessidade de duplicar no spread de `allTools`.
     *
     * @type {[import('@github/copilot-sdk').Tool[], Record<string, any>][]}
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
        [permissionTools, { category: 'permission', tags: ['approval', 'security', 'runtime-control'] }],
    ];

    // G1-ARCH-07: itera sobre TOOL_GROUPS uma única vez — evita duplicação entre registerTools e allTools
    for (const [tools, opts] of TOOL_GROUPS) {
        registerTools(registry, tools, opts);
    }

    if (mcpTools.length > 0) {
        registerTools(registry, mcpTools, { category: 'mcp', tags: ['mcp', 'external'] });
    }

    // Tools declarativas customizadas registradas via /config/tools/custom.
    const customTools = buildCustomTools();
    if (customTools.length > 0) {
        registerTools(registry, customTools, { category: 'custom', tags: ['runtime', 'declarative'] });
    }

    const allTools = [...TOOL_GROUPS.flatMap(([t]) => t), ...mcpTools, ...customTools];

    // Expõe registry/telemetria para as ferramentas de introspecção (necessário antes de iniciar sessão)
    registerForIntrospection(allTools);
    setTelemetryStore(telemetry);

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

    return allTools;
}
