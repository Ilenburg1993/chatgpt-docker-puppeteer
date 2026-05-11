// @ts-check
/**
 * src/copilot/terminal/commands/tools.js
 *
 * Comando `/tools` do REPL terminal LLM-B.
 *
 * Lista a telemetria canônica das tools/superfícies observadas (invocações, bloqueios, erros, latência).
 *
 * @module copilot/terminal/commands/tools
 * @see EventBus
 */

import { readIntrospectionRegistrySnapshot } from '#copilot/tools';
import { readTerminalStatusProjection, readTerminalToolStatsProjection } from '../frontend/index.js';

/**
 * @typedef {object} ToolsContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * Comando `/tools`.
 *
 * - Sem argumento: lista tools agregadas por nome canônico.
 * - raw: lista nomes observados brutos (sem agregação canônica).
 * - diag|all: inclui categorias, aliases e diagnóstico de superfícies.
 *
 * @param {ToolsContext} ctx
 * @param {string} [arg=''] Default is `''`
 * @returns {void}
 */
export function cmdTools({ println }, arg = '') {
    const mode = String(arg || '')
        .trim()
        .toLowerCase();
    const wantsRaw = mode === 'raw';
    const wantsDiag = mode === 'diag' || mode === 'all';
    const projection = readTerminalToolStatsProjection();
    const status = readTerminalStatusProjection();
    const entries = wantsRaw ? projection.entries : projection.canonicalEntries;

    if (entries.length === 0) {
        println('\n  \x1b[33m⚠️  Nenhuma tool observada ainda.\x1b[0m\n');
        return;
    }

    println(
        `\n  \x1b[36m🔧 ${entries.length} tool(s) ${wantsRaw ? 'observada(s) [raw]' : 'agregada(s) [canônico]'}:\x1b[0m\n`,
    );

    for (const [name, data] of entries) {
        const d =
            /** @type {{ calls?: number; errors?: number; blocked?: number; avgLatencyMs?: number; aliases?: string[]; kind?: string }} */ (
                data
            );
        const calls = d.calls ?? 0;
        const errors = d.errors ?? 0;
        const blocked = d.blocked ?? 0;
        const latency = typeof d.avgLatencyMs === 'number' ? `${d.avgLatencyMs.toFixed(0)}ms` : '?';
        const errorColor = errors > 0 ? '\x1b[31m' : '\x1b[32m';
        const blockedColor = blocked > 0 ? '\x1b[33m' : '\x1b[90m';
        println(
            `    \x1b[33m${name}\x1b[0m  calls=\x1b[36m${calls}\x1b[0m  blocked=${blockedColor}${blocked}\x1b[0m  errors=${errorColor}${errors}\x1b[0m  avg=${latency}`,
        );
        if (!wantsRaw && wantsDiag && Array.isArray(d.aliases) && d.aliases.length > 1) {
            println(`      \x1b[90maliases: ${d.aliases.join(', ')}\x1b[0m`);
        }
        if (wantsDiag && typeof d.kind === 'string' && d.kind.length > 0) {
            println(`      \x1b[90mkind: ${d.kind}\x1b[0m`);
        }
    }

    if (wantsDiag) {
        const categories = projection.byCategory ?? {};
        const categoryEntries = Object.entries(categories).sort((a, b) => {
            const callsA = Number(/** @type {Record<string, unknown>} */ (a[1])['totalCalls'] ?? 0);
            const callsB = Number(/** @type {Record<string, unknown>} */ (b[1])['totalCalls'] ?? 0);
            return callsB - callsA;
        });
        println('\n  \x1b[36mCategorias de telemetria\x1b[0m');
        for (const [cat, agg] of categoryEntries) {
            const info =
                /** @type {{ totalCalls?: number; totalErrors?: number; totalBlocked?: number; avgLatencyMs?: number }} */ (
                    agg
                );
            println(
                `    \x1b[33m${cat}\x1b[0m  calls=\x1b[36m${info.totalCalls ?? 0}\x1b[0m  blocked=${info.totalBlocked ?? 0}  errors=${info.totalErrors ?? 0}  avg=${info.avgLatencyMs ?? 0}ms`,
            );
        }

        const toolLoad = status.toolLoad;
        println('\n  \x1b[36mSuperfícies de tools\x1b[0m');
        println(
            `    \x1b[90mfsCanônico=${toolLoad.hasCanonicalLocalFsTools} · execCanônico=${toolLoad.hasCanonicalLocalExecTools} · sdkWorkspace=${toolLoad.hasSdkWorkspaceTooling} · legacyShellLoaded=${toolLoad.hasLegacySdkShellToolsLoaded} · disabled=${toolLoad.disabled.length}\x1b[0m`,
        );
        if (toolLoad.disabled.length > 0) {
            println(`    \x1b[90mdisabled: ${toolLoad.disabled.join(', ')}\x1b[0m`);
        }

        const contract = toolLoad.toolContract;
        const contractColor =
            contract.errorCount > 0 ? '\x1b[31m' : contract.warningCount > 0 ? '\x1b[33m' : '\x1b[32m';
        println('\n  \x1b[36mTool Contract Verifier\x1b[0m');
        println(
            `    ${contractColor}${contract.ok ? 'ok' : 'attention'}\x1b[0m \x1b[90merrors=${contract.errorCount} · warnings=${contract.warningCount}\x1b[0m`,
        );
        println(
            `    \x1b[90mcoverage: description=${contract.metadataCoverage.descriptionPct}% · schema=${contract.metadataCoverage.parametersPct}% · category=${contract.metadataCoverage.categoryPct}% · tags=${contract.metadataCoverage.tagsPct}% · instructions=${contract.metadataCoverage.instructionsPct}%\x1b[0m`,
        );
        const detailedContract = readIntrospectionRegistrySnapshot().toolContract;
        if (detailedContract.issues.length > 0) {
            println('    \x1b[90mtop issues:\x1b[0m');
            for (const issue of detailedContract.issues.slice(0, 10)) {
                const color = issue.severity === 'error' ? '\x1b[31m' : '\x1b[33m';
                println(
                    `      ${color}${issue.severity.toUpperCase()}\x1b[0m \x1b[90m${issue.code}\x1b[0m ${issue.toolName} — ${issue.message}`,
                );
            }
            if (detailedContract.issues.length > 10) {
                println(`      \x1b[90m... ${detailedContract.issues.length - 10} issues adicionais\x1b[0m`);
            }
        }
    }

    println('  \x1b[90mUso: /tools [diag|all|raw]\x1b[0m');
    println('');
}
