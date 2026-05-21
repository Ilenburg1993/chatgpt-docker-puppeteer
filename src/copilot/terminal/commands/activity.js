// @ts-check

import { readTerminalIoActivityProjection } from '../events/index.js';
import { readTerminalActivityProjection } from '../frontend/index.js';

/**
 * @typedef {{ println: (text: string) => void }} ActivityContext
 */

/**
 * @param {ActivityContext['println']} println
 * @param {string} title
 * @param {any} trace
 * @returns {void}
 */
function printTurnTraceSummary(println, title, trace) {
    const stateColor = trace.status === 'active' ? '\x1b[33m' : trace.status === 'completed' ? '\x1b[32m' : '\x1b[31m';
    println(`  \x1b[36m${title}\x1b[0m
  ─────────────────────────────────────
  trace           \x1b[90m${trace.traceId}\x1b[0m
  status          ${stateColor}${trace.status}\x1b[0m
  tools           \x1b[90m${trace.toolCount}\x1b[0m
  arquivos        \x1b[90m${trace.fileCount}\x1b[0m
  input humano    \x1b[90m${trace.userInputCount ?? trace.userInputs?.length ?? 0}\x1b[0m`);

    if (trace.files.length > 0) {
        println('  arquivos tocados');
        for (const file of trace.files.slice(0, 5)) {
            println(
                `    - ${file.operation} · ${file.path}${file.count > 1 ? ` ×${file.count}` : ''} · ${file.source}`,
            );
        }
    }

    if (trace.tools.length > 0) {
        println('  tools');
        for (const tool of trace.tools.slice(0, 5)) {
            const target = tool.path ?? tool.target;
            println(
                `    - ${tool.toolName} · ${tool.operation}${target ? ` · ${target}` : ''}${tool.status ? ` · ${tool.status}` : ''} · ${tool.source}`,
            );
        }
    }

    const userInputs = Array.isArray(trace.userInputs) ? trace.userInputs : [];
    if (userInputs.length > 0) {
        println('  interações humanas');
        for (const userInput of userInputs.slice(0, 5)) {
            const choices =
                Array.isArray(userInput.choices) && userInput.choices.length > 0
                    ? ` · opções=${userInput.choices.join('|')}`
                    : '';
            const answer = userInput.answerPreview ? ` · resposta=${userInput.answerPreview}` : '';
            const requestId = userInput.requestId ? ` · ${userInput.requestId}` : '';
            println(
                `    - ${userInput.kind ?? 'question'} · ${userInput.status ?? 'requested'}${requestId} · ${userInput.question}${choices}${answer} · ${userInput.source ?? 'sdk'}`,
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
            const ts = new Date(entry.timestamp).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
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
    const limit = Number(arg);
    const projection = readTerminalActivityProjection(Number.isFinite(limit) && limit > 0 ? limit : 10);
    const recentIo = readTerminalIoActivityProjection(Number.isFinite(limit) && limit > 0 ? limit : 10);
    const current = projection.current;
    const activeTurnTrace = projection.turnTrace.current;
    const recentNonCurrent = projection.turnTrace.recent.filter((entry) => entry.traceId !== activeTurnTrace?.traceId);
    const latestCompletedTurnTrace = pickMostUsefulRecentTurnTrace(recentNonCurrent);
    const latestHumanTurnTrace = pickRecentHumanTurnTrace(recentNonCurrent);
    const severityColor =
        current.severity === 'error' ? '\x1b[31m' : current.severity === 'warn' ? '\x1b[33m' : '\x1b[32m';
    const progressLabel = typeof current.progress === 'number' ? ` · ${current.progress}%` : '';
    println(`
  \x1b[36mAtividade Atual da LLM-B\x1b[0m
  ─────────────────────────────────────
  fase            ${severityColor}${current.phase}\x1b[0m
  label           ${current.label}${progressLabel}
  detalhe         ${current.detail ?? '\x1b[90m(nenhum)\x1b[0m'}
  source          \x1b[90m${current.source}\x1b[0m
  idade           \x1b[90m${Math.round(current.ageMs / 1000)}s\x1b[0m
  ─────────────────────────────────────`);

    if (activeTurnTrace) {
        printTurnTraceSummary(println, 'Resumo do turno atual', activeTurnTrace);
    }

    if (latestCompletedTurnTrace && latestCompletedTurnTrace.traceId !== activeTurnTrace?.traceId) {
        printTurnTraceSummary(println, 'Último turno concluído', latestCompletedTurnTrace);
    }

    if (
        latestHumanTurnTrace &&
        latestHumanTurnTrace.traceId !== latestCompletedTurnTrace?.traceId &&
        latestHumanTurnTrace.traceId !== activeTurnTrace?.traceId
    ) {
        printTurnTraceSummary(println, 'Interação humana recente', latestHumanTurnTrace);
    }

    if (recentIo.length > 0) {
        println('  \x1b[36mI/O real recente\x1b[0m');
        for (const entry of recentIo.slice(0, 8)) {
            const ts = new Date(entry.timestamp).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            const sev = entry.success ? '\x1b[90m' : '\x1b[31m';
            const bytes =
                typeof entry.bytesRead === 'number'
                    ? ` · read=${entry.bytesRead}B`
                    : typeof entry.bytesWritten === 'number'
                      ? ` · write=${entry.bytesWritten}B`
                      : '';
            const duration = typeof entry.durationMs === 'number' ? ` · ${entry.durationMs}ms` : '';
            const engine = entry.engine ? ` · ${entry.engine}` : '';
            println(`  ${sev}[${ts}]\x1b[0m ${entry.operation} · ${entry.target}${bytes}${duration}${engine}`);
        }
        println('  ─────────────────────────────────────');
    }

    printStreamDiagnostics(println, projection.streamDiagnostics);

    if (projection.history.length === 0) {
        println('  \x1b[90mSem histórico de atividade ainda.\x1b[0m\n');
        return;
    }

    println('  \x1b[36mTimeline recente\x1b[0m');
    for (const entry of projection.history) {
        const ts = new Date(entry.ts).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const sev = entry.severity === 'error' ? '\x1b[31m' : entry.severity === 'warn' ? '\x1b[33m' : '\x1b[90m';
        const extra = entry.detail ? ` — ${entry.detail}` : '';
        const progress = typeof entry.progress === 'number' ? ` (${entry.progress}%)` : '';
        println(`  ${sev}[${ts}]\x1b[0m ${entry.phase} · ${entry.label}${progress}${extra}`);
    }
    println('');
}
