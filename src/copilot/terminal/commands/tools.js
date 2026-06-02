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
        entry.toolCallId ? `chamada ${compactTerminalDiagnosticId(entry.toolCallId)}` : null,
        entry.requestId ? `requisição ${compactTerminalDiagnosticId(entry.requestId)}` : null,
        entry.traceId ? `trace ${compactTerminalDiagnosticId(entry.traceId, 16)}` : null,
    ].filter(Boolean);
    const target = entry.path ?? entry.target;
    const progress = entry.progress !== null ? ` · ${entry.progress}%` : '';
    const duration = entry.durationMs !== null ? ` · ${Math.max(0, Math.round(entry.durationMs))}ms` : '';
    const visualName = getTerminalHumanToolName(entry.toolName);
    const technicalName = visualName === entry.toolName ? null : `técnico ${entry.toolName}`;
    const rawName = entry.rawToolName && entry.rawToolName !== entry.toolName ? `origem SDK ${entry.rawToolName}` : null;
    const operation = entry.operation ? `ação ${entry.operation}` : null;
    const targetLabel = target ? `alvo ${target}` : null;
    const status = renderLifecycleStatusLabel(entry.status);
    const suffix = [operation, targetLabel, technicalName, rawName, ids.join(' · ')].filter(Boolean).join(' · ');
    return `    \x1b[33m${visualName}\x1b[0m  ${status}${progress}${duration}${suffix ? `  \x1b[90m${suffix}\x1b[0m` : ''}`;
}

/**
 * @param {string} status
 * @returns {string}
 */
function renderLifecycleStatusLabel(status) {
    if (status === 'running') return 'em execução';
    if (status === 'completed') return 'concluída';
    if (status === 'failed') return 'falhou';
    if (status === 'waiting-user') return 'aguardando operador';
    return status.replace(/-/gu, ' ');
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
                `    \x1b[33m${visualName}\x1b[0m  chamadas \x1b[36m${calls}\x1b[0m · bloqueios ${blockedColor}${blocked}\x1b[0m · falhas ${errorColor}${errors}\x1b[0m · latência ${latency}`,
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
            println(`      \x1b[90mtipo: ${d.kind}\x1b[0m`);
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
                `    \x1b[33m${cat}\x1b[0m  chamadas \x1b[36m${info.totalCalls ?? 0}\x1b[0m · bloqueios ${info.totalBlocked ?? 0} · falhas ${info.totalErrors ?? 0} · latência ${info.avgLatencyMs ?? 0}ms`,
            );
        }

        const toolLoad = status.toolLoad;
        println('\n  \x1b[36mSuperfícies de tools\x1b[0m');
        println(
            `    \x1b[90marquivos locais ${toolLoad.hasCanonicalLocalFsTools ? 'ativos' : 'ausentes'} · terminal local ${toolLoad.hasCanonicalLocalExecTools ? 'ativo' : 'ausente'} · workspace SDK ${toolLoad.hasSdkWorkspaceTooling ? 'ativo' : 'ausente'} · shell legado ${toolLoad.hasLegacySdkShellToolsLoaded ? 'carregado' : 'não carregado'} · desabilitadas ${toolLoad.disabled.length}\x1b[0m`,
        );
        if (toolLoad.disabled.length > 0) {
            println(`    \x1b[90mdisabled: ${toolLoad.disabled.join(', ')}\x1b[0m`);
        }

        const contract = toolLoad.toolContract;
        const contractColor =
            contract.errorCount > 0 ? '\x1b[31m' : contract.warningCount > 0 ? '\x1b[33m' : '\x1b[32m';
        println('\n  \x1b[36mContrato das ferramentas\x1b[0m');
        println(
            `    ${contractColor}${contract.ok ? 'ok' : 'atenção'}\x1b[0m \x1b[90mfalhas ${contract.errorCount} · avisos ${contract.warningCount}\x1b[0m`,
        );
        println(
            `    \x1b[90mcobertura: descrição ${contract.metadataCoverage.descriptionPct}% · schema ${contract.metadataCoverage.parametersPct}% · categoria ${contract.metadataCoverage.categoryPct}% · tags ${contract.metadataCoverage.tagsPct}% · instruções ${contract.metadataCoverage.instructionsPct}%\x1b[0m`,
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
                `    \x1b[90mativas ${lifecycle.summary.active} · aguardando operador ${lifecycle.summary.waitingUser} · recentes ${lifecycle.summary.recent} · falhas recentes ${lifecycle.summary.failedRecent}\x1b[0m`,
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
