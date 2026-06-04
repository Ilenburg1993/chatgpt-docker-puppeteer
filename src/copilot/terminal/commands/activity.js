// @ts-check

import { readTerminalIoActivityProjection } from '../events/index.js';
import { readTerminalActivityProjection } from '../frontend/index.js';
import {
    formatTerminalElapsedDuration,
    formatTerminalTimeLabel,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeWrappedRow,
} from '../state/ui/index.js';
import {
    buildTerminalToolActivityPresentation,
    compactTerminalDiagnosticId,
    compactTerminalOperatorToolText,
    formatTerminalToolPathForOperator,
    humanizeTerminalToolSurfaceText,
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
 * @param {string | null | undefined} status
 * @returns {'success' | 'warn' | 'error' | 'muted'}
 */
function renderStatusRole(status) {
    if (status === 'active' || status === 'running' || status === 'started') return 'warn';
    if (status === 'completed' || status === 'done' || status === 'success') return 'success';
    if (status === 'failed' || status === 'error') return 'error';
    return 'muted';
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
    if (phase === 'streaming') return 'streaming';
    if (phase === 'question') return 'pergunta';
    if (phase === 'task') return 'tarefa';
    if (phase === 'boot') return 'inicialização';
    if (phase === 'system') return 'sistema';
    if (phase === 'compaction') return 'compactação';
    if (phase === 'subagent') return 'subagente';
    if (phase === 'error') return 'erro';
    return phase;
}

/**
 * @param {string | null | undefined} severity
 * @returns {'success' | 'warn' | 'error'}
 */
function renderActivitySeverityRole(severity) {
    if (severity === 'error') return 'error';
    if (severity === 'warn') return 'warn';
    return 'success';
}

/**
 * @param {unknown} source
 * @returns {string}
 */
function renderSourceLabel(source) {
    const normalized = typeof source === 'string' ? source.trim().toLowerCase() : '';
    if (!normalized) return 'terminal';
    if (normalized === 'sdk' || normalized.startsWith('sdk/')) return 'SDK';
    if (normalized === 'agent' || normalized.startsWith('agent/')) return 'agente';
    if (normalized === 'dialog' || normalized.startsWith('dialog')) return 'diálogo';
    if (normalized === 'io') return 'I/O';
    if (normalized.includes('terminal')) return 'terminal';
    return compactHumanText(source);
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
    if (operation === 'search') return 'busca';
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
 * @param {number} value
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function pluralPt(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * @param {number} timestamp
 * @param {{ detail: boolean; now: number }} opts
 * @returns {string}
 */
function renderActivityTime(timestamp, opts) {
    return opts.detail
        ? `[${formatTerminalTimeLabel(timestamp, { now: opts.now, mode: 'dual' })}]`
        : formatTerminalTimeLabel(timestamp, { now: opts.now, mode: 'dual' });
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
    return compactTerminalOperatorToolText(text.replace(/\s+/gu, ' ').trim(), 96);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function compactOperatorDetail(value) {
    return humanizeTerminalToolSurfaceText(compactHumanText(value), { preserveProtocolNames: true })
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
    return humanizeTerminalToolSurfaceText(compactHumanText(value));
}

/**
 * @param {{ phase: string; label: string; progress?: number | null }} entry
 * @returns {string}
 */
function renderTimelineEntryHeading(entry) {
    const phase = renderActivityPhaseLabel(entry.phase);
    const label = compactActivityLabel(entry.label);
    const progress = typeof entry.progress === 'number' ? ` (${entry.progress}%)` : '';
    const lowerLabel = label.toLowerCase();
    const labelAlreadyCarriesPhase =
        lowerLabel.startsWith(`${phase} `) ||
        (entry.phase === 'tool' && /^(ferramenta|integra[cç][aã]o|arquivo|i\/o)\b/iu.test(label)) ||
        (entry.phase === 'question' && /^(pergunta|resposta)\b/iu.test(label)) ||
        (entry.phase === 'turn' && /^(turno|inten[cç][aã]o|mensagem|resposta)\b/iu.test(label)) ||
        (entry.phase === 'system' && /^(uso|configura[cç][aã]o|warning|erro|modelo|resposta)\b/iu.test(label));
    return `${labelAlreadyCarriesPhase ? label : `${phase} · ${label}`}${progress}`;
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
            : compactTerminalOperatorToolText(targetCandidate, 72)
        : null;
    return { name: presentation.displayToolName, target };
}

/**
 * @param {Array<{ path: string; operation: string; source?: string | null; count?: number; updatedAt?: number }>} files
 * @returns {Array<{ path: string; operation: string; source?: string | null; count?: number; updatedAt?: number }>}
 */
function aggregateTurnTraceFiles(files) {
    /** @type {Map<string, { path: string; operation: string; source?: string | null; count?: number; updatedAt?: number; repeatedRows: number }>} */
    const groups = new Map();
    for (const file of files) {
        const displayPath = formatTerminalToolPathForOperator(file.path);
        const key = `${file.operation}\u0000${displayPath}`;
        const existing = groups.get(key);
        const count = typeof file.count === 'number' && Number.isFinite(file.count) ? Math.max(1, file.count) : 1;
        if (!existing) {
            groups.set(key, { ...file, path: displayPath, count, repeatedRows: 1 });
            continue;
        }
        existing.repeatedRows += 1;
        existing.updatedAt = Math.max(existing.updatedAt ?? 0, file.updatedAt ?? 0) || existing.updatedAt;
        if (existing.source !== file.source) existing.source = 'múltiplas origens';
        const previousCount = existing.count ?? 1;
        existing.count = previousCount > 1 || count > 1 ? Math.max(previousCount, count) : previousCount + count;
    }
    return [...groups.values()].map(({ repeatedRows: _repeatedRows, ...file }) => file);
}

/**
 * @param {{ phase?: string; label?: string; severity?: string }} entry
 * @returns {boolean}
 */
function isRoutineDefaultTimelineEntry(entry) {
    const label = compactHumanText(entry.label ?? '').toLowerCase();
    if (entry.severity === 'error' || entry.severity === 'warn') return false;
    if (entry.phase === 'boot') return true;
    if (entry.phase === 'idle') return true;
    if (entry.phase === 'streaming') return true;
    if (entry.phase === 'system' && label.includes('uso byok sem premium request')) return true;
    if (entry.phase === 'turn' && label.includes('processando mensagem')) return true;
    return false;
}

/**
 * @param {any[]} history
 * @param {number} limit
 * @returns {any[]}
 */
function selectDefaultTimelineEntries(history, limit) {
    const maxRows = Math.min(limit, 12);
    const operational = history.filter((entry) => !isRoutineDefaultTimelineEntry(entry));
    return (operational.length > 0 ? operational : history).slice(0, maxRows);
}

/**
 * @param {ActivityContext['println']} println
 * @param {string} title
 * @param {any} trace
 * @param {{ detail: boolean }} opts
 * @returns {void}
 */
function printTurnTraceSummary(println, title, trace, opts) {
    const aggregatedFiles = aggregateTurnTraceFiles(Array.isArray(trace.files) ? trace.files : []);
    const rawFileCount = Math.max(Number(trace.fileCount ?? 0), Array.isArray(trace.files) ? trace.files.length : 0);
    const uniqueFileCount = aggregatedFiles.length;
    const fileCountLabel =
        opts.detail && rawFileCount > uniqueFileCount
            ? `${pluralPt(uniqueFileCount, 'arquivo único', 'arquivos únicos')} · ${pluralPt(rawFileCount, 'registro', 'registros')}`
            : String(uniqueFileCount || rawFileCount);
    println(terminalThemeHeadline('assistant', title));
    println(terminalThemeDivider(37));
    println(terminalThemeRow('Estado', renderStatusLabel(trace.status), { role: renderStatusRole(trace.status) }));
    println(terminalThemeRow('Ferramentas', String(trace.toolCount)));
    println(terminalThemeRow('Arquivos', fileCountLabel));
    println(terminalThemeRow('Operador', String(trace.userInputCount ?? trace.userInputs?.length ?? 0)));
    if (opts.detail) {
        println(terminalThemeRow('Trace', compactTerminalDiagnosticId(trace.traceId) ?? String(trace.traceId ?? 'sem trace')));
    }

    if (aggregatedFiles.length > 0) {
        println(terminalThemeHeadline('assistant', 'Arquivos tocados'));
        for (const file of aggregatedFiles.slice(0, 5)) {
            const source = opts.detail ? ` · ${renderSourceLabel(file.source)}` : '';
            println(
                terminalThemeRow(
                    'Arquivo',
                    `${renderOperationLabel(file.operation)} · ${formatTerminalToolPathForOperator(file.path)}${file.count > 1 ? ` ×${file.count}` : ''}${source}`,
                ),
            );
        }
    }

    if (trace.tools.length > 0) {
        println(terminalThemeHeadline('assistant', 'Ferramentas'));
        for (const tool of trace.tools.slice(0, 5)) {
            const rendered = renderToolSummary(tool, opts);
            const status = tool.status ? ` · ${renderStatusLabel(tool.status)}` : '';
            const source = opts.detail ? ` · ${renderSourceLabel(tool.source)}` : '';
            println(
                terminalThemeRow(
                    'Ferramenta',
                    `${rendered.name} · ${renderOperationLabel(tool.operation)}${rendered.target ? ` · ${rendered.target}` : ''}${status}${source}`,
                ),
            );
        }
    }

    const userInputs = Array.isArray(trace.userInputs) ? trace.userInputs : [];
    if (userInputs.length > 0) {
        println(terminalThemeHeadline('assistant', 'Interações humanas'));
        for (const userInput of userInputs.slice(0, 5)) {
            const choices =
                Array.isArray(userInput.choices) && userInput.choices.length > 0
                    ? ` · opções ${userInput.choices.join('|')}`
                    : '';
            const answer = userInput.answerPreview ? ` · resposta ${userInput.answerPreview}` : '';
            const requestId = opts.detail && userInput.requestId ? ` · req=${compactTerminalDiagnosticId(userInput.requestId)}` : '';
            const source = opts.detail ? ` · ${renderSourceLabel(userInput.source ?? 'sdk')}` : '';
            println(
                terminalThemeRow(
                    'Pergunta',
                    `${renderStatusLabel(userInput.status)}${requestId} · ${compactHumanText(userInput.question)}${choices}${answer}${source}`,
                ),
            );
        }
    }

    println(terminalThemeDivider(37));
}

/**
 * @param {any[]} recent
 * @returns {any | null}
 */
function pickMostUsefulRecentTurnTrace(recent) {
    return pickRecentFailedTurnTrace(recent) ?? pickRecentOperationalTurnTrace(recent) ?? pickRecentHumanTurnTrace(recent) ?? recent[0] ?? null;
}

/**
 * @param {any[]} recent
 * @returns {any | null}
 */
function pickRecentFailedTurnTrace(recent) {
    return (
        recent.find(
            (entry) =>
                (Array.isArray(entry.tools) &&
                    entry.tools.some(
                        /** @param {{ status?: string; success?: boolean | null }} tool */ (tool) =>
                            tool.status === 'failed' || tool.success === false,
                    )) ||
                (entry.status === 'failed' &&
                    (Number(entry.toolCount ?? 0) > 0 ||
                        Number(entry.fileCount ?? 0) > 0 ||
                        Number(entry.userInputCount ?? 0) > 0)),
        ) ?? null
    );
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
    println(terminalThemeHeadline('assistant', 'Streaming público'));
    println(
        terminalThemeRow(
            'Deltas',
            `aceitos=${c.deltaAccepted} · normalizados=${c.deltaNormalized} · suprimidos=${c.deltaSuppressed} (sup=${suppressedPct}% · norm=${normalizedPct}%)`,
        ),
    );
    println(
        terminalThemeRow(
            'Causal',
            `aceitos=${c.deltaCausalAccepted} · duplicados=${c.deltaCausalDuplicateSuppressed} · fallback temporal=${c.deltaTemporalFallbackSuppressed}`,
        ),
    );
    println(
        terminalThemeRow(
            'Cumulativo',
            `normalizados=${c.deltaCumulativeNormalized} · suprimidos=${c.deltaCumulativeSuppressed} · overlap=${c.deltaOverlapNormalized} · sufixo dup=${c.deltaDuplicateSuppressed}`,
        ),
    );
    println(
        terminalThemeRow(
            'Final',
            `ok=${c.finalAlreadyStreamed} · sufixo=${c.finalSuffix} · mismatch=${c.finalMismatch} · sem-delta=${c.finalNoVisibleStream} · vazio=${c.finalEmpty}`,
        ),
    );
    if (diagnostics.recent.length > 0) {
        println(terminalThemeHeadline('assistant', 'Decisões recentes'));
        for (const entry of diagnostics.recent.slice(0, 5)) {
            const ts = formatTerminalTimeLabel(entry.timestamp, { mode: 'dual' });
            if (entry.kind === 'delta') {
                const role = entry.action === 'suppressed' ? 'warn' : entry.action === 'normalized' ? 'assistant' : 'muted';
                println(
                    terminalThemeRow(
                        'Delta',
                        `[${ts}] ${entry.action}/${entry.reason} · ${entry.source} · raw=${entry.rawChars} norm=${entry.normalizedChars}`,
                        { role },
                    ),
                );
            } else {
                const role = entry.severity === 'warn' ? 'warn' : entry.severity === 'error' ? 'error' : 'muted';
                println(
                    terminalThemeRow(
                        'Final',
                        `[${ts}] ${entry.mode}/${entry.reason} · stream=${entry.streamingVisibleChars} final=${entry.finalChars}`,
                        { role },
                    ),
                );
            }
        }
    }
    println(terminalThemeDivider(37));
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
    const now = Date.now();
    const projection = readTerminalActivityProjection(limit);
    const recentIo = readTerminalIoActivityProjection(limit);
    const current = projection.current;
    const activeTurnTrace = projection.turnTrace.current;
    const recentNonCurrent = projection.turnTrace.recent.filter((entry) => entry.traceId !== activeTurnTrace?.traceId);
    const latestCompletedTurnTrace = pickMostUsefulRecentTurnTrace(recentNonCurrent);
    const latestHumanTurnTrace = pickRecentHumanTurnTrace(recentNonCurrent);
    const progressLabel = typeof current.progress === 'number' ? ` · ${current.progress}%` : '';
    println('');
    println(terminalThemeHeadline('assistant', 'Atividade Atual da LLM-B'));
    println(terminalThemeDivider(37));
    println(
        terminalThemeRow('Estado', renderActivityPhaseLabel(current.phase), {
            role: renderActivitySeverityRole(current.severity),
        }),
    );
    println(terminalThemeRow('Evento', `${compactActivityLabel(current.label)}${progressLabel}`));
    println(terminalThemeRow('Detalhe', current.detail ? compactOperatorDetail(current.detail) : '(nenhum)'));
    println(terminalThemeRow('Idade', formatTerminalElapsedDuration(current.ageMs)));
    println(terminalThemeDivider(37));
    if (detail) {
        println(terminalThemeRow('Origem', current.source));
    }
    if (!detail) {
        println(terminalThemeRow('Drill-down', '/activity detail mostra origem, trace, engine e streaming.', { role: 'command' }));
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
        println(terminalThemeHeadline('assistant', 'I/O real recente'));
        for (const entry of recentIo.slice(0, 8)) {
            const ts = renderActivityTime(entry.timestamp, { detail, now });
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
                terminalThemeWrappedRow(
                    'Operação',
                    `${ts} · ${renderIoOperationLabel(entry.operation)} · ${compactHumanText(entry.target)}${bytes}${duration}${engineDetail}`,
                    { role: entry.success ? 'muted' : 'error' },
                ),
            );
        }
        println(terminalThemeDivider(37));
    }

    if (detail) {
        printStreamDiagnostics(println, projection.streamDiagnostics);
    }

    if (projection.history.length === 0) {
        println(terminalThemeRow('Timeline', 'Sem histórico de atividade ainda.'));
        println('');
        return;
    }

    const timelineEntries = detail ? projection.history : selectDefaultTimelineEntries(projection.history, limit);
    println(terminalThemeHeadline('assistant', detail ? 'Timeline completa' : 'Timeline operacional'));
    for (const entry of timelineEntries) {
        const ts = renderActivityTime(entry.ts, { detail, now });
        const extra = entry.detail ? ` — ${compactOperatorDetail(entry.detail)}` : '';
        println(
            terminalThemeWrappedRow('Evento', `${ts} · ${renderTimelineEntryHeading(entry)}${extra}`, {
                role: renderActivitySeverityRole(entry.severity),
            }),
        );
    }
    if (!detail && projection.history.length > timelineEntries.length) {
        println(terminalThemeRow('Completo', '/activity detail mostra timeline completa.', { role: 'command' }));
    }
    println('');
}
