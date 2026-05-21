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

    /** @type {string[]} */
    const lines = [
        '',
        '┌─────────────────────────────────────────────────────────────┐',
        '│  Terminal Permanente LLM-B                                  │',
        isStandalone
            ? '│  Modo: STANDALONE  (server 3008 não detectado)              │'
            : `│  Modo: CONECTADO   (MCP: ${String(mcp.toolCount).padEnd(2)} tools via :3008)              │`,
        `│  Inject server: ${opts.serverUrl.padEnd(40).slice(0, 40)} │`,
        '│  Comandos: /help  /status  /queue  /turn  /mailbox         │',
        '│  Sessão SDK: auto-resume padrão; gestão em /session sdk     │',
        '│  Pré-boot seguinte: /session sdk next new|resume|auto       │',
        '└─────────────────────────────────────────────────────────────┘',
        '',
    ];

    if (isStandalone) {
        lines.push('  ⚠  MCP tools indisponíveis — tools locais ativas. Inicie src/server para habilitar.');
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
