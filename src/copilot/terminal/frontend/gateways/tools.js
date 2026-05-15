// @ts-check
/**
 * Gateway terminal-owned para capacidades de tools.
 *
 * `terminal/` não compõe tools diretamente em comandos/projections; a borda local concentra esse acoplamento aqui para
 * manter comandos finos e auditáveis.
 *
 * @module copilot/terminal/frontend/gateways/tools
 */

import { fileReadTools, fileWriteTools, readIntrospectionRegistrySnapshot } from '#copilot/tools';

/**
 * @typedef {{ name: string; handler?: Function; [key: string]: unknown }} TerminalTool
 */

/**
 * @returns {TerminalTool[]}
 */
export function listTerminalFileReadTools() {
    return /** @type {TerminalTool[]} */ (/** @type {unknown} */ (fileReadTools));
}

/**
 * @returns {TerminalTool[]}
 */
export function listTerminalFileWriteTools() {
    return /** @type {TerminalTool[]} */ (/** @type {unknown} */ (fileWriteTools));
}

/**
 * @param {'read' | 'write'} family
 * @param {string} name
 * @returns {TerminalTool}
 */
export function requireTerminalFileTool(family, name) {
    const tools = family === 'read' ? listTerminalFileReadTools() : listTerminalFileWriteTools();
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new TypeError(`[terminal/tools] tool canônica ausente: ${family}:${name}`);
    return tool;
}

/**
 * @returns {ReturnType<typeof readIntrospectionRegistrySnapshot>}
 */
export function readTerminalToolRegistrySnapshot() {
    return readIntrospectionRegistrySnapshot();
}
