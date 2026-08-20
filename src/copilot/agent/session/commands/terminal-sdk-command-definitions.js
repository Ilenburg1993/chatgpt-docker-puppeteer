// @ts-check
/**
 * src/copilot/agent/session/commands/terminal-sdk-command-definitions.js
 *
 * Primeira ponte canonica entre comandos operacionais do terminal e `CommandDefinition[]` do SDK.
 *
 * Esta camada nao reimplementa o REPL local. Ela registra comandos SDK seguros que materializam uma solicitacao
 * observavel no runtime. A execucao efetiva continua pertencendo ao nucleo local do terminal ate o catalogo unico de
 * comandos substituir as tabelas manuais de `/help`, `/menu` e `CMD_ROUTES`.
 *
 * @module copilot/agent/session/commands/terminal-sdk-command-definitions
 */

import { listTerminalSdkCommandSpecs } from '#copilot/config';
import { EMITTER_SDK_COMMAND_EXECUTED } from '#copilot/events';

/**
 * @typedef {import('#copilot/sdk/types').CommandContext} CommandContext
 *
 * @typedef {import('#copilot/sdk/types').CommandDefinition} CommandDefinition
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeArgs(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(/\s+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * @param {{ emit: (event: string, payload: object) => unknown }} host
 * @param {{ name: string; description: string; localCommand: string; safe: boolean }} spec
 * @returns {(context: CommandContext) => void}
 */
function createTerminalSdkCommandHandler(host, spec) {
    return (context) => {
        const args = normalizeArgs(context?.args);
        host.emit(EMITTER_SDK_COMMAND_EXECUTED, {
            commandName: normalizeString(context?.commandName) ?? spec.name,
            command: normalizeString(context?.command) ?? spec.localCommand,
            sessionId: normalizeString(context?.sessionId),
            args,
            localCommand: spec.localCommand,
            description: spec.description,
            safe: spec.safe,
            timestamp: Date.now(),
        });
    };
}

/**
 * @param {{ emit: (event: string, payload: object) => unknown }} host
 * @returns {CommandDefinition[]}
 */
export function buildTerminalSdkCommandDefinitions(host) {
    if (!host || typeof host.emit !== 'function') {
        return [];
    }
    return listTerminalSdkCommandSpecs().map((spec) => ({
        name: spec.name,
        description: spec.description,
        handler: createTerminalSdkCommandHandler(host, spec),
    }));
}
