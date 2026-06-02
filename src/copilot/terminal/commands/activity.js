// @ts-check

import { readTerminalIoActivityProjection } from '../events/index.js';
import { readTerminalActivityProjection } from '../frontend/index.js';
import { formatTerminalIsoTimestamp, terminalThemeText } from '../state/ui/index.js';
import {
    buildTerminalToolActivityPresentation,
    compactTerminalDiagnosticId,
    compactTerminalToolText,
    isTerminalInternalCallIdentifier,
} from '../events/tool-activity-presenter.js';

/**
 * @typedef {{ println: (text: string) => void }} ActivityContext
 */

/**
 * @param {string} operation
 * @returns {string}
 */
function renderOperationLabel(operation) {
    if (operation === 'ask') return 'pergunta';
    if (operation === 'intent') return 'intenção';
    if (operation === 'read') return 'leitura';
    if (operation === 'write') return 'criação';
    if (operation === 'edit') return 'edição';
    if (operation === 'copy') return 'cópia';
    if (operation === 'move') return 'movimento';
    if (operation === 'delete') return 'exclusão';
    if (operation === 'list') return 'listagem';
    if (operation === 'run') return 'execução';
    if (operation === 'inspect') return 'inspeção';
    return operation;
}

/**
 * @param {string | null | undefined} status
 * @returns {string}
 */
function renderStatusLabel(status) {
    if (status === 'active' || status === 'running' || status === 'started') return 'em andamento';
    if (status === 'completed' || status === 'done' || status === 'success') return 'concluída';
    if (status === 'failed' || status === 'error') return 'falhou';
    if (status === 'requested' || status === 'pending') return 'pendente';
    if (status === 'answered') return 'respondida';
    return status ?? 'registrada';
}

/**
 * @param {string} phase
 * @returns {string}
 */
function renderActivityPhaseLabel(phase) {
    if (phase === 'idle') return 'pronto';
    if (phase === 'tool') return 'ferramenta';
    if (phase === 'turn') return 'turno';
    if (phase === 'thinking') return 'pensando';
    if (phase === 'error') return 'erro';
    return phase;
}

/**
 * @param {string} source
 * @returns {string}
 */
function renderSourceLabel(source) {
    const normalized = source.trim().toLowerCase();
    if (!normalized) return 'terminal';
    if (normalized === 'sdk' || normalized.startsWith('sdk/')) return 'SDK';
    if (normalized === 'agent' || normalized.startsWith('agent/')) return 'agente';
    if (normalized === 'dialog' || normalized.startsWith('dialog')) return 'diálogo';
    if (normalized === 'io') return 'I/O';
    if (normalized.includes('terminal')) return 'terminal';
    return source;
}

/**
 * @param {string} operation
 * @returns {string}
 */
function renderIoOperationLabel(operation) {
    if (operation === 'read') return 'leitura';
    if (operation === 'write') return 'escrita';
    if (operation === 'mkdir') return 'criação de pasta';
    if (operation === 'rename') return 'renomeação';
    if (operation === 'unlink') return 'exclusão';
    if (operation === 'stat') return 'inspeção';
    return renderOperationLabel(operation);
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function renderBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {string | undefined} arg
 * @returns {{ limit: number; detail: boolean }}
 */
function parseActivityArg(arg = '') {
    const tokens = String(arg).trim().split(/\s+/u).filter(Boolean);
    let limit = 10;
    let detail = false;
    for (const token of tokens) {
        if (/^\d+$/u.test(token)) {
            limit = Math.min(100, Math.max(1, Number(token)));
        } else if (token === 'detail' || token === '--detail' || token === 'debug' || token === '--debug') {
            detail = true;
        }
    }
    return { limit, detail };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactHumanText(value) {
    const text = typeof value === 'string' ? value : value == null ? '' : String(value);
    return compactTerminalToolText(text.replace(/\s+/gu, ' ').trim(), 96);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactOperatorDetail(value) {
    return compactHumanText(value)
        .replace(/\bmodelo=/giu, 'modelo ')
        .replace(/\bcusto=/giu, 'custo ')
        .replace(/\bstatus=success\b/giu, 'concluída')
        .replace(/\bstatus=completed\b/giu, 'concluída')
        .replace(/\bstatus=failed\b/giu, 'falhou')
        .replace(/\bchoices=/giu, 'opções ')
        .replace(/\bdisplay=/giu, 'tela ')
        .replace(/\breasoning=/giu, 'raciocínio ')
        .replace(/\bsource=/giu, 'origem ')
        .replace(/\bread\s+·/giu, 'leitura ·')
        .replace(/\bwrite\s+·/giu, 'escrita ·');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactActivityLabel(value) {
    return compactHumanText(value)
        .replace(/^Tool concluída\b/iu, 'Ferramenta concluída')
        .replace(/^Tool falhou\b/iu, 'Ferramenta falhou')
        .replace(/^I\/O read concluído\b/iu, 'I/O leitura concluída')
        .replace(/^I\/O write concluído\b/iu, 'I/O escrita concluída')
        .replace(/^ask_user SDK solicitado\b/iu, 'Pergunta ao operador solicitada');
}

/**
 * @param {{ toolName: string; operation: string; path?: string | null; target?: string | null }} tool
 * @param {{ detail: boolean }} opts
 * @returns {{ name: string; target: string | null }}
 */
function renderToolSummary(tool, opts) {
    const targetCandidate = tool.path ?? tool.target ?? null;
    const targetIsInternal = isTerminalInternalCallIdentifier(targetCandidate);
    const presentation = buildTerminalToolActivityPresentation(
        {
            toolName: tool.toolName,
            operation: tool.operation,
            args: targetCandidate && !targetIsInternal ? { path: targetCandidate } : {},
        },
        tool.toolName,
    );
    const target = targetCandidate
        ? targetIsInternal
            ? opts.detail
                ? `id ${compactTerminalDiagnosticId(targetCandidate)}`
                : null
            : compactTerminalToolText(targetCandidate, 72)
        : null;
    return { name: presentation.displayToolName, target };
}

/**
 * @param {ActivityContext['println']} println
 * @param {string} title
 * @param {any} trace
 * @param {{ detail: boolean }} opts
 * @returns {void}
 */
function printTurnTraceSummary(println, title, trace, opts) {
    const stateColor = trace.status === 'active' ? '\x1b[33m' : trace.status === 'completed' ? '\x1b[32m' : '\x1b[31m';
    println(`  \x1b[36m${title}\x1b[0m
  ─────────────────────────────────────
  estado          ${stateColor}${renderStatusLabel(trace.status)}\x1b[0m
  ferramentas     \x1b[90m${trace.toolCount}\x1b[0m
  arquivos        \x1b[90m${trace.fileCount}\x1b[0m
  input humano    \x1b[90m${trace.userInputCount ?? trace.userInputs?.length ?? 0}\x1b[0m`);
    if (opts.detail) {
        println(`  trace           \x1b[90m${compactTerminalDiagnosticId(trace.traceId)}\x1b[0m`);
    }

    if (trace.files.length > 0) {
        println('  arquivos tocados');
        for (const file of trace.files.slice(0, 5)) {
            const source = opts.detail ? ` · ${renderSourceLabel(file.source)}` : '';
            println(
                `    - ${renderOperationLabel(file.operation)} · ${compactHumanText(file.path)}${file.count > 1 ? ` ×${file.count}` : ''}${source}`,
            );
        }
    }

    if (trace.tools.length > 0) {
        println('  ferramentas');
        for (const tool of trace.tools.slice(0, 5)) {
            const rendered = renderToolSummary(tool, opts);
            const status = tool.status ? ` · ${renderStatusLabel(tool.status)}` : '';
            const source = opts.detail ? ` · ${renderSourceLabel(tool.source)}` : '';
            println(
                `    - ${rendered.name} · ${renderOperationLabel(tool.operation)}${rendered.target ? ` · ${rendered.target}` : ''}${status}${source}`,
            );
        }
    }

    const userInputs = Array.isArray(trace.userInputs) ? trace.userInputs : [];
    if (userInputs.length > 0) {
        println('  interações humanas');
        for (const userInput of userInputs.slice(0, 5)) {
            const choices =
                Array.isArray(userInput.choices) && userInput.choices.length > 0
                    ? ` · opções ${userInput.choices.join('|')}`
                    : '';
            const answer = userInput.answerPreview ? ` · resposta=${userInput.answerPreview}` : '';
            const requestId = opts.detail && userInput.requestId ? ` · req=${compactTerminalDiagnosticId(userInput.requestId)}` : '';
            const source = opts.detail ? ` · ${renderSourceLabel(userInput.source ?? 'sdk')}` : '';
            println(
                `    - pergunta · ${renderStatusLabel(userInput.status)}${requestId} · ${compactHumanText(userInput.question)}${choices}${answer}${source}`,
            );
        }
    }

    println('  ─────────────────────────────────────');
}

/**
 * @param {any[]} recent
 * @returns {any | null}
 */
function pickMostUsefulRecentTurnTrace(recent) {
    return pickRecentOperationalTurnTrace(recent) ?? pickRecentHumanTurnTrace(recent) ?? recent[0] ?? null;
}

/**
 * @param {any[]} recent
 * @returns {any | null}
 */
function pickRecentOperationalTurnTrace(recent) {
    return (
        recent.find(
            (entry) =>
                entry.fileCount > 0 ||
                entry.tools.some(
                    /** @param {{ operation?: string; path?: string | null; target?: string | null }} tool */ (tool) =>
                        tool.operation !== 'unknown' || Boolean(tool.path) || Boolean(tool.target),
                ),
        ) ?? null
    );
}

/**
 * @param {any[]} recent
 * @returns {any | null}
 */
function pickRecentHumanTurnTrace(recent) {
    return recent.find((entry) => Array.isArray(entry.userInputs) && entry.userInputs.length > 0) ?? null;
}

/**
 * @param {ActivityContext['println']} println
 * @param {any} diagnostics
 * @returns {void}
 */
function printStreamDiagnostics(println, diagnostics) {
    if (!diagnostics?.counters || !diagnostics?.totals) return;
    const c = diagnostics.counters;
    const suppressedPct = (diagnostics.totals.suppressedRatio * 100).toFixed(0);
    const normalizedPct = (diagnostics.totals.normalizedRatio * 100).toFixed(0);
    println('  \x1b[36mStreaming público\x1b[0m');
    println(
        `  deltas          aceitos=${c.deltaAccepted} · normalizados=${c.deltaNormalized} · suprimidos=${c.deltaSuppressed} \x1b[90m(sup=${suppressedPct}% · norm=${normalizedPct}%)\x1b[0m`,
    );
    println(
        `  causal          aceitos=${c.deltaCausalAccepted} · duplicados=${c.deltaCausalDuplicateSuppressed} · fallback temporal=${c.deltaTemporalFallbackSuppressed}`,
    );
    println(
        `  cumulativo      normalizados=${c.deltaCumulativeNormalized} · suprimidos=${c.deltaCumulativeSuppressed} · overlap=${c.deltaOverlapNormalized} · sufixo dup=${c.deltaDuplicateSuppressed}`,
    );
    println(
        `  final           ok=${c.finalAlreadyStreamed} · sufixo=${c.finalSuffix} · mismatch=${c.finalMismatch} · sem-delta=${c.finalNoVisibleStream} · vazio=${c.finalEmpty}`,
    );
    if (diagnostics.recent.length > 0) {
        println('  decisões recentes');
        for (const entry of diagnostics.recent.slice(0, 5)) {
            const ts = formatTerminalIsoTimestamp(entry.timestamp);
            if (entry.kind === 'delta') {
                const color =
                    entry.action === 'suppressed' ? '\x1b[33m' : entry.action === 'normalized' ? '\x1b[36m' : '\x1b[90m';
                println(
                    `    ${color}[${ts}]\x1b[0m delta · ${entry.action}/${entry.reason} · ${entry.source} · raw=${entry.rawChars} norm=${entry.normalizedChars}`,
                );
            } else {
                const color = entry.severity === 'warn' ? '\x1b[33m' : entry.severity === 'error' ? '\x1b[31m' : '\x1b[90m';
                println(
                    `    ${color}[${ts}]\x1b[0m final · ${entry.mode}/${entry.reason} · stream=${entry.streamingVisibleChars} final=${entry.finalChars}`,
                );
            }
        }
    }
    println('  ─────────────────────────────────────');
}

/**
 * Exibe a atividade atual do terminal + timeline recente.
 *
 * @param {ActivityContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdActivity({ println }, arg) {
    const { limit, detail } = parseActivityArg(arg);
    const projection = readTerminalActivityProjection(limit);
    const recentIo = readTerminalIoActivityProjection(limit);
    const current = projection.current;
    const activeTurnTrace = projection.turnTrace.current;
    const recentNonCurrent = projection.turnTrace.recent.filter((entry) => entry.traceId !== activeTurnTrace?.traceId);
    const latestCompletedTurnTrace = pickMostUsefulRecentTurnTrace(recentNonCurrent);
    const latestHumanTurnTrace = pickRecentHumanTurnTrace(recentNonCurrent);
    const severityColor =
        current.severity === 'error' ? '\x1b[31m' : current.severity === 'warn' ? '\x1b[33m' : '\x1b[32m';
    const progressLabel = typeof current.progress === 'number' ? ` · ${current.progress}%` : '';
    println(`
  ${terminalThemeText('assistant', 'Atividade Atual da LLM-B')}
  ─────────────────────────────────────
  estado          ${severityColor}${renderActivityPhaseLabel(current.phase)}\x1b[0m
  evento          ${compactActivityLabel(current.label)}${progressLabel}
  detalhe         ${current.detail ? compactOperatorDetail(current.detail) : '\x1b[90m(nenhum)\x1b[0m'}
  idade           \x1b[90m${Math.round(current.ageMs / 1000)}s\x1b[0m
  ─────────────────────────────────────`);
    if (detail) {
        println(`  origem          \x1b[90m${current.source}\x1b[0m`);
    }
    if (!detail) {
        println('  \x1b[90mDetalhes técnicos ficam em /activity detail.\x1b[0m');
    }

    if (activeTurnTrace) {
        printTurnTraceSummary(println, 'Resumo do turno atual', activeTurnTrace, { detail });
    }

    if (latestCompletedTurnTrace && latestCompletedTurnTrace.traceId !== activeTurnTrace?.traceId) {
        printTurnTraceSummary(println, 'Último turno concluído', latestCompletedTurnTrace, { detail });
    }

    if (
        latestHumanTurnTrace &&
        latestHumanTurnTrace.traceId !== latestCompletedTurnTrace?.traceId &&
        latestHumanTurnTrace.traceId !== activeTurnTrace?.traceId
    ) {
        printTurnTraceSummary(println, 'Interação humana recente', latestHumanTurnTrace, { detail });
    }

    if (recentIo.length > 0) {
        println('  \x1b[36mI/O real recente\x1b[0m');
        for (const entry of recentIo.slice(0, 8)) {
            const ts = formatTerminalIsoTimestamp(entry.timestamp);
            const sev = entry.success ? '\x1b[90m' : '\x1b[31m';
            const bytes =
                typeof entry.bytesRead === 'number'
                    ? ` · ${renderBytes(entry.bytesRead)} lidos`
                    : typeof entry.bytesWritten === 'number'
                      ? ` · ${renderBytes(entry.bytesWritten)} escritos`
                      : '';
            const duration = typeof entry.durationMs === 'number' ? ` · ${entry.durationMs}ms` : '';
            const engine = entry.engine ? ` · ${entry.engine}` : '';
            const engineDetail = detail ? engine : '';
            println(
                `  ${sev}[${ts}]\x1b[0m ${renderIoOperationLabel(entry.operation)} · ${compactHumanText(entry.target)}${bytes}${duration}${engineDetail}`,
            );
        }
        println('  ─────────────────────────────────────');
    }

    if (detail) {
        printStreamDiagnostics(println, projection.streamDiagnostics);
    }

    if (projection.history.length === 0) {
        println('  \x1b[90mSem histórico de atividade ainda.\x1b[0m\n');
        return;
    }

    println(`  ${terminalThemeText('assistant', 'Timeline recente')}`);
    for (const entry of projection.history) {
        const ts = formatTerminalIsoTimestamp(entry.ts);
        const sev = entry.severity === 'error' ? '\x1b[31m' : entry.severity === 'warn' ? '\x1b[33m' : '\x1b[90m';
        const extra = entry.detail ? ` — ${compactOperatorDetail(entry.detail)}` : '';
        const progress = typeof entry.progress === 'number' ? ` (${entry.progress}%)` : '';
        println(
            `  ${sev}[${ts}]\x1b[0m ${renderActivityPhaseLabel(entry.phase)} · ${compactActivityLabel(entry.label)}${progress}${extra}`,
        );
    }
    println('');
}
