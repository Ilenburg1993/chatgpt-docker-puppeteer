// @ts-check
/**
 * @module copilot/agent/tools-bootstrap
 * @file Inicialização de tools do agente — registro por categoria e tags.
 *
 *   Extrai a lógica repetitiva de `registerTools(registry, grupo, opts)` do método `start()` de `AlwaysAliveAgent`,
 *   tornando-a testável e legível de forma independente.
 */

import { buildCustomTools } from '../config/custom-tools-registry.js';
import { registerTools } from '../lib/tools-registry.js';
import {
    codeTools,
    fileReadTools,
    fileWriteTools,
    gitTools,
    hookTools,
    hubTools,
    introspectionTools,
    registerForIntrospection,
    sessionTools,
    setTelemetryStore,
    shellTools,
    taskTools,
} from '../tools/index.js';

/**
 * @typedef {import('#copilot/lib/tools-registry').ToolRegistry} ToolRegistry
 *
 * @typedef {import('#copilot/lib/telemetry').TelemetryStore} TelemetryStore
 *
 * @typedef {import('@github/copilot-sdk').Tool} Tool
 */

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
    registerTools(registry, taskTools, { category: 'task', tags: ['queue', 'state'] });
    registerTools(registry, codeTools, {
        category: 'code',
        tags: ['lint', 'test', 'typecheck'],
        readOnly: true,
    });
    registerTools(registry, gitTools, { category: 'git', tags: ['vcs', 'diff', 'commit'] });
    registerTools(registry, sessionTools, { category: 'session', tags: ['hooks', 'briefing'] });
    registerTools(registry, hookTools, { category: 'hook', tags: ['audit', 'input', 'hooks'] });
    registerTools(registry, hubTools, {
        category: 'hub',
        tags: ['conversation', 'llm-b', 'dialog', 'persistent'],
    });
    registerTools(registry, introspectionTools, {
        category: 'introspection',
        tags: ['meta', 'telemetry'],
        readOnly: true,
    });
    registerTools(registry, fileReadTools, {
        category: 'file',
        tags: ['filesystem', 'io', 'read'],
        readOnly: true,
    });
    registerTools(registry, fileWriteTools, {
        category: 'file',
        tags: ['filesystem', 'io', 'write'],
    });
    registerTools(registry, shellTools, {
        category: 'shell',
        tags: ['exec', 'system', 'npm', 'node'],
    });

    if (mcpTools.length > 0) {
        registerTools(registry, mcpTools, { category: 'mcp', tags: ['mcp', 'external'] });
    }

    // AI.2: custom tools declarativas registradas via /config/tools/custom
    const customTools = buildCustomTools();
    if (customTools.length > 0) {
        registerTools(registry, customTools, { category: 'custom', tags: ['runtime', 'declarative'] });
    }

    const allTools = [
        ...taskTools,
        ...codeTools,
        ...gitTools,
        ...sessionTools,
        ...hookTools,
        ...hubTools,
        ...introspectionTools,
        ...fileReadTools,
        ...fileWriteTools,
        ...shellTools,
        ...mcpTools,
        ...customTools,
    ];

    // Expõe registry/telemetria para as ferramentas de introspecção (necessário antes de iniciar sessão)
    registerForIntrospection(allTools);
    setTelemetryStore(telemetry);

    return allTools;
}
