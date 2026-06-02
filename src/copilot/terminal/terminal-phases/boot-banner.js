// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-banner
 * @file Helpers de banner do boot do terminal.
 *
 *   Mantém a narrativa de modo de operação (standalone vs conectado) fora da fase de listeners, permitindo
 *   evolução/testes sem reabrir o composition root do boot.
 */

import { getMcpStatus } from '#copilot/bridges';
import { println } from '../dialog/index.js';

/**
 * @param {{
 *     serverUrl: string;
 *     bootPreflight?: { warnings?: string[] | null; [key: string]: unknown } | null;
 * }} opts
 * @param {{
 *     getMcpStatusFn?: () => { available?: boolean; toolCount?: number; circuitOpen?: boolean };
 * }} [deps]
 * @returns {{
 *     lines: string[];
 *     operationMode: 'standalone' | 'connected';
 *     mcpToolCount: number;
 * }}
 */
export function buildTerminalStandaloneBannerView(opts, deps = {}) {
    const getMcpStatusFn = deps.getMcpStatusFn ?? getMcpStatus;
    const mcp = getMcpStatusFn();
    const isStandalone = !mcp.available;
    const bootPreflight = opts.bootPreflight ?? null;
    const warnings = Array.isArray(bootPreflight?.warnings) ? bootPreflight.warnings : [];

    const modeLine = isStandalone
        ? 'STANDALONE · MCP remoto ausente · tools locais ativas'
        : `CONECTADO · MCP :3008 · ${Number(mcp.toolCount ?? 0)} tools`;
    /** @type {string[]} */
    const lines = [
        '',
        `  Terminal LLM-B · ${modeLine}`,
        `  inject ${opts.serverUrl} · /help · /status · /queue · /turn · /session sdk`,
        '  Sessão SDK: auto-resume · next new|resume|auto',
        '',
    ];

    if (isStandalone) {
        lines.push('  Registry local ativo. Diagnóstico: /tools · /health.');
        lines.push('');
    }
    if (warnings.length > 0) {
        lines.push(`  ⚠  Preflight SDK: ${warnings[0]}`);
        lines.push('');
    }

    return {
        lines,
        operationMode: isStandalone ? 'standalone' : 'connected',
        mcpToolCount: Number(mcp.toolCount ?? 0),
    };
}

/**
 * Imprime o banner de diagnóstico do modo de operação do terminal host.
 *
 * @param {{
 *     serverUrl: string;
 *     bootPreflight?: { warnings?: string[] | null; [key: string]: unknown } | null;
 * }} opts
 * @param {{
 *     printlnFn?: typeof println;
 *     getMcpStatusFn?: () => { available?: boolean; toolCount?: number; circuitOpen?: boolean };
 * }} [deps]
 * @returns {void}
 */
export function printStandaloneBanner(opts, deps = {}) {
    const printlnFn = deps.printlnFn ?? println;
    const view = buildTerminalStandaloneBannerView(opts, deps);
    for (const line of view.lines) printlnFn(line);
}
