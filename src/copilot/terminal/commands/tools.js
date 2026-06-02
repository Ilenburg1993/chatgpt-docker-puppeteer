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
import { terminalThemeHeadline, terminalThemeRow, terminalThemeText } from '../state/ui/index.js';

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
    return `  ${terminalThemeText('command', visualName.padEnd(22))} ${status}${progress}${duration}${suffix ? `  ${terminalThemeText('muted', suffix)}` : ''}`;
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
        println('');
        println(terminalThemeRow('Ferramentas', 'Nenhuma ferramenta observada ainda', { role: 'warn' }));
        println(terminalThemeText('muted', '  Quando a LLM-B usar arquivos, terminal ou SDK, o resumo aparece aqui.'));
        println('');
        return;
    }

    if (wantsRaw || wantsDiag) {
        println('');
        println(terminalThemeHeadline('tool', 'Ferramentas', [`${entries.length} ${entries.length === 1 ? 'ferramenta' : 'ferramentas'}`, wantsRaw ? 'nomes crus' : 'agregadas']));
        println('');
    } else {
        println('');
        println(terminalThemeHeadline('tool', 'Ferramentas observadas'));
        println(terminalThemeText('muted', `  ${entries.length} grupo(s) de ação já apareceram nesta sessão.`));
        println('');
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
        const visualName = wantsRaw ? name : getTerminalHumanToolName(name);
        if (wantsRaw || wantsDiag) {
            println(
                `  ${terminalThemeText('command', visualName.padEnd(22))} chamadas ${terminalThemeText('info', String(calls))} · bloqueios ${terminalThemeText(blocked > 0 ? 'warn' : 'muted', String(blocked))} · falhas ${terminalThemeText(errors > 0 ? 'error' : 'success', String(errors))} · latência ${latency}`,
            );
        } else {
            const healthLabel =
                errors > 0 ? terminalThemeText('error', `${errors} falha(s)`) : terminalThemeText('success', 'sem falhas');
            const blockedLabel =
                blocked > 0 ? terminalThemeText('warn', `${blocked} bloqueio(s)`) : terminalThemeText('muted', 'sem bloqueios');
            println(
                `  ${terminalThemeText('command', visualName.padEnd(22))} uso ${terminalThemeText('info', String(calls))} · ${blockedLabel} · ${healthLabel} · ${latency}`,
            );
        }
        if (!wantsRaw && wantsDiag && visualName !== name) {
            println(terminalThemeRow('nome técnico:', name, { role: 'muted' }));
        }
        if (!wantsRaw && wantsDiag && Array.isArray(d.aliases) && d.aliases.length > 1) {
            println(terminalThemeRow('Aliases', d.aliases.join(', '), { role: 'muted' }));
        }
        if (wantsDiag && typeof d.kind === 'string' && d.kind.length > 0) {
            println(terminalThemeRow('tipo', d.kind, { role: 'muted', width: 4 }));
        }
    }

    if (wantsDiag) {
        const categories = projection.byCategory ?? {};
        const categoryEntries = Object.entries(categories).sort((a, b) => {
            const callsA = Number(/** @type {Record<string, unknown>} */ (a[1])['totalCalls'] ?? 0);
            const callsB = Number(/** @type {Record<string, unknown>} */ (b[1])['totalCalls'] ?? 0);
            return callsB - callsA;
        });
        println('');
        println(terminalThemeHeadline('tool', 'Categorias de telemetria'));
        for (const [cat, agg] of categoryEntries) {
            const info = /** @type {{
    totalCalls?: number;
    totalErrors?: number;
    totalBlocked?: number;
    avgLatencyMs?: number;
}} */ (agg);
            println(
                `  ${terminalThemeText('command', cat.padEnd(22))} chamadas ${terminalThemeText('info', String(info.totalCalls ?? 0))} · bloqueios ${info.totalBlocked ?? 0} · falhas ${info.totalErrors ?? 0} · latência ${info.avgLatencyMs ?? 0}ms`,
            );
        }

        const toolLoad = status.toolLoad;
        println('');
        println(terminalThemeHeadline('tool', 'Superfícies de tools'));
        println(
            terminalThemeRow('Superfícies', `arquivos locais ${toolLoad.hasCanonicalLocalFsTools ? 'ativos' : 'ausentes'} · terminal local ${toolLoad.hasCanonicalLocalExecTools ? 'ativo' : 'ausente'} · workspace SDK ${toolLoad.hasSdkWorkspaceTooling ? 'ativo' : 'ausente'} · shell legado ${toolLoad.hasLegacySdkShellToolsLoaded ? 'carregado' : 'não carregado'} · desabilitadas ${toolLoad.disabled.length}`, {
                role: 'muted',
            }),
        );
        if (toolLoad.disabled.length > 0) {
            println(terminalThemeRow('Desabilitadas', toolLoad.disabled.join(', '), { role: 'muted' }));
        }

        const contract = toolLoad.toolContract;
        const contractRole = contract.errorCount > 0 ? 'error' : contract.warningCount > 0 ? 'warn' : 'success';
        println('');
        println(terminalThemeHeadline('tool', 'Contrato das ferramentas'));
        println(terminalThemeRow('Status', `${contract.ok ? 'ok' : 'atenção'} · falhas ${contract.errorCount} · avisos ${contract.warningCount}`, {
            role: contractRole,
        }));
        println(
            terminalThemeRow('Cobertura', `descrição ${contract.metadataCoverage.descriptionPct}% · schema ${contract.metadataCoverage.parametersPct}% · categoria ${contract.metadataCoverage.categoryPct}% · tags ${contract.metadataCoverage.tagsPct}% · instruções ${contract.metadataCoverage.instructionsPct}%`, {
                role: 'muted',
            }),
        );
        const detailedContract = readTerminalToolRegistrySnapshot().toolContract;
        if (detailedContract.issues.length > 0) {
            println(terminalThemeRow('Top issues', `${Math.min(10, detailedContract.issues.length)} exibida(s)`, { role: 'muted' }));
            for (const issue of detailedContract.issues.slice(0, 10)) {
                println(
                    `  ${terminalThemeText(issue.severity === 'error' ? 'error' : 'warn', issue.severity.toUpperCase().padEnd(7))} ${terminalThemeText('muted', issue.code)} ${issue.toolName} — ${issue.message}`,
                );
            }
            if (detailedContract.issues.length > 10) {
                println(terminalThemeText('muted', `  ... ${detailedContract.issues.length - 10} issues adicionais`));
            }
        }

        const lifecycle = projection.lifecycle;
        if (lifecycle) {
            println('');
            println(terminalThemeHeadline('tool', 'Lifecycle recente'));
            println(
                terminalThemeRow('Resumo', `ativas ${lifecycle.summary.active} · aguardando operador ${lifecycle.summary.waitingUser} · recentes ${lifecycle.summary.recent} · falhas recentes ${lifecycle.summary.failedRecent}`, {
                    role: 'muted',
                }),
            );
            const active = lifecycle.active.slice(0, 8);
            if (active.length > 0) {
                println(terminalThemeText('muted', '  em voo:'));
                for (const entry of active) println(renderLifecycleDiagnosticLine(entry));
            }
            if (lifecycle.recent.length > 0) {
                println(terminalThemeText('muted', '  recentes:'));
                for (const entry of lifecycle.recent.slice(0, 8)) println(renderLifecycleDiagnosticLine(entry));
            }
        }
    }

    println(
        wantsRaw || wantsDiag
            ? terminalThemeText('muted', '  Comandos: /tools diag · /tools all · /tools raw')
            : terminalThemeText('muted', '  Detalhes técnicos: /tools diag · nomes crus: /tools raw'),
    );
    println('');
}
