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

import { readTerminalStatusProjection, readTerminalToolStatsProjection } from '../frontend/index.js';
import { readTerminalToolRegistrySnapshot } from '../frontend/gateways/index.js';
import { compactTerminalDiagnosticId, getTerminalHumanToolName } from '../events/tool-activity-presenter.js';

/**
 * @typedef {object} ToolsContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

/**
 * @param {import('../state/tool-lifecycle-state.js').TerminalToolLifecycleDiagnostic} entry
 * @returns {string}
 */
function renderLifecycleDiagnosticLine(entry) {
    const ids = [
        entry.toolCallId ? `call=${compactTerminalDiagnosticId(entry.toolCallId)}` : null,
        entry.requestId ? `req=${compactTerminalDiagnosticId(entry.requestId)}` : null,
        entry.traceId ? `trace=${compactTerminalDiagnosticId(entry.traceId, 16)}` : null,
    ].filter(Boolean);
    const target = entry.path ?? entry.target;
    const progress = entry.progress !== null ? ` · ${entry.progress}%` : '';
    const duration = entry.durationMs !== null ? ` · ${Math.max(0, Math.round(entry.durationMs))}ms` : '';
    const visualName = getTerminalHumanToolName(entry.toolName);
    const technicalName = visualName === entry.toolName ? null : `tool=${entry.toolName}`;
    const rawName = entry.rawToolName && entry.rawToolName !== entry.toolName ? `raw=${entry.rawToolName}` : null;
    const suffix = [entry.operation, target, technicalName, rawName, ids.join(' · ')].filter(Boolean).join(' · ');
    return `    \x1b[33m${visualName}\x1b[0m  ${entry.status}${progress}${duration}${suffix ? `  \x1b[90m${suffix}\x1b[0m` : ''}`;
}

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
        println('\n  \x1b[33mNenhuma ferramenta observada ainda.\x1b[0m');
        println('  \x1b[90mQuando a LLM-B usar arquivos, terminal ou SDK, o resumo aparece aqui.\x1b[0m\n');
        return;
    }

    if (wantsRaw || wantsDiag) {
        println(`\n  \x1b[36m🔧 ${entries.length} tool(s) ${wantsRaw ? 'observada(s) [raw]' : 'agregada(s)'}:\x1b[0m\n`);
    } else {
        println(`\n  \x1b[36mFerramentas observadas\x1b[0m`);
        println(`  \x1b[90m${entries.length} grupo(s) de ação já apareceram nesta sessão.\x1b[0m\n`);
    }

    for (const [name, data] of entries) {
        const d = /** @type {{
    calls?: number;
    errors?: number;
    blocked?: number;
    avgLatencyMs?: number;
    aliases?: string[];
    kind?: string;
}} */ (data);
        const calls = d.calls ?? 0;
        const errors = d.errors ?? 0;
        const blocked = d.blocked ?? 0;
        const latency = typeof d.avgLatencyMs === 'number' ? `${d.avgLatencyMs.toFixed(0)}ms` : '?';
        const errorColor = errors > 0 ? '\x1b[31m' : '\x1b[32m';
        const blockedColor = blocked > 0 ? '\x1b[33m' : '\x1b[90m';
        const visualName = wantsRaw ? name : getTerminalHumanToolName(name);
        if (wantsRaw || wantsDiag) {
            println(
                `    \x1b[33m${visualName}\x1b[0m  calls=\x1b[36m${calls}\x1b[0m  blocked=${blockedColor}${blocked}\x1b[0m  errors=${errorColor}${errors}\x1b[0m  avg=${latency}`,
            );
        } else {
            const healthLabel = errors > 0 ? `${errorColor}${errors} falha(s)${C_RESET}` : `${errorColor}sem falhas${C_RESET}`;
            const blockedLabel =
                blocked > 0 ? `${blockedColor}${blocked} bloqueio(s)${C_RESET}` : `${blockedColor}sem bloqueios${C_RESET}`;
            println(
                `    \x1b[33m${visualName}\x1b[0m  uso \x1b[36m${calls}\x1b[0m · ${blockedLabel} · ${healthLabel} · ${latency}`,
            );
        }
        if (!wantsRaw && wantsDiag && visualName !== name) {
            println(`      \x1b[90mtool técnico: ${name}\x1b[0m`);
        }
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
            const info = /** @type {{
    totalCalls?: number;
    totalErrors?: number;
    totalBlocked?: number;
    avgLatencyMs?: number;
}} */ (agg);
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
        const detailedContract = readTerminalToolRegistrySnapshot().toolContract;
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

        const lifecycle = projection.lifecycle;
        if (lifecycle) {
            println('\n  \x1b[36mLifecycle recente\x1b[0m');
            println(
                `    \x1b[90mactive=${lifecycle.summary.active} · waitingUser=${lifecycle.summary.waitingUser} · recent=${lifecycle.summary.recent} · failedRecent=${lifecycle.summary.failedRecent}\x1b[0m`,
            );
            const active = lifecycle.active.slice(0, 8);
            if (active.length > 0) {
                println('    \x1b[90mem voo:\x1b[0m');
                for (const entry of active) println(renderLifecycleDiagnosticLine(entry));
            }
            if (lifecycle.recent.length > 0) {
                println('    \x1b[90mrecentes:\x1b[0m');
                for (const entry of lifecycle.recent.slice(0, 8)) println(renderLifecycleDiagnosticLine(entry));
            }
        }
    }

    println(
        wantsRaw || wantsDiag
            ? '  \x1b[90mUso: /tools [diag|all|raw]\x1b[0m'
            : '  \x1b[90mDetalhes técnicos: /tools diag · nomes crus: /tools raw\x1b[0m',
    );
    println('');
}

const C_RESET = '\x1b[0m';
