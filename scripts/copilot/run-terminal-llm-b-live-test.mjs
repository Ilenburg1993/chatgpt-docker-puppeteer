#!/usr/bin/env node
/**
 * Canonical live runner for `terminal:llm-b`.
 *
 * This is intentionally opt-in and not part of default CI: the default scenario talks to the real SDK and can consume
 * a Premium Request for the explicit user turn. Use `--no-pr` for a boot/resume/control-only probe that validates UX
 * telemetry without sending an LLM turn.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POST_ANSWER_DELAY_MS = 6_000;
const DEFAULT_POST_ASK_CONTINUATION_WAIT_MS = 45_000;
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const POST_ASK_FINAL_RE =
    /(?:POST-ASK-CANONICAL-FINAL|Teste can[oô]nico|Usu[aá]rio confirmou SIM|confirmou SIM|respondeu SIM|Sistema operacional)/iu;

function stripAnsi(value) {
    return String(value ?? '').replace(ANSI_RE, '');
}

function readArg(name, fallback) {
    const prefix = `${name}=`;
    const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function hasCommand(name) {
    const result = spawnSync('sh', ['-lc', `command -v ${name}`], { stdio: 'ignore' });
    return result.status === 0;
}

function canListenOnPort(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen(port, host, () => {
            server.close(() => resolve(true));
        });
    });
}

async function resolveLiveTerminalPort(preferredPort, { scanLimit = 50 } = {}) {
    const preferred = Number.isFinite(preferredPort) && preferredPort >= 0 ? Math.trunc(preferredPort) : 3009;
    if (preferred === 0) return 0;
    for (let offset = 0; offset <= scanLimit; offset += 1) {
        const candidate = preferred + offset;
        if (await canListenOnPort(candidate)) return candidate;
    }
    return preferred;
}

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureLine(input) {
    return input.endsWith('\n') ? input : `${input}\n`;
}

function buildScenarioPrompt() {
    return [
        'Faça um teste integrado canônico do terminal.',
        'Primeiro chame report_intent com o intent "terminal live canonical deltas tools ask_user usage".',
        'Depois leia as primeiras 3 linhas de package.json usando read_file_content.',
        'Em seguida escreva uma resposta pública longa, com frases separadas DELTA-CANONICAL-1 até DELTA-CANONICAL-8, para validar deltas parciais e final.',
        'Por fim chame ask_user perguntando exatamente "ASK-CANONICAL: responda SIM para fechar o teste".',
        'Depois que o usuário responder SIM, escreva uma última mensagem pública contendo exatamente "POST-ASK-CANONICAL-FINAL: usuário confirmou SIM".',
        'Não use outras tools além de report_intent, read_file_content e ask_user.',
    ].join(' ');
}

function buildReport({
    criteria,
    durationMs,
    exitCode,
    blocker,
    outputPath,
    plainOutputPath,
    exportPath,
    exportSummary,
    sseRawPath,
    sseJsonlPath,
    sseSummary,
    startedAt,
    transport,
}) {
    const ok = criteria.every((criterion) => criterion.pass);
    const status = blocker ? 'BLOCKED' : ok ? 'PASS' : 'FAIL';
    const lines = [
        '# Terminal LLM-B Live Test',
        '',
        `Started: ${startedAt}`,
        `Duration: ${durationMs}ms`,
        `Exit code: ${String(exitCode)}`,
        `Transport: ${transport}`,
        `Status: ${status}`,
        ...(blocker ? [`Blocker: ${blocker.id} · ${blocker.detail}`] : []),
        '',
        '## Artifacts',
        '',
        `- Raw output: ${outputPath}`,
        `- Plain output: ${plainOutputPath}`,
        `- Exported Markdown: ${exportPath ?? '-'}`,
        `- SSE raw output: ${sseRawPath}`,
        `- SSE JSONL: ${sseJsonlPath}`,
        '',
        '## SSE',
        '',
        `- Connected: ${sseSummary.connected ? 'yes' : 'no'}`,
        `- Events: ${sseSummary.eventCount}`,
        `- Events with id: ${sseSummary.eventsWithId}`,
        `- Events with source: ${sseSummary.eventsWithSource ?? 0}`,
        `- Events with traceId: ${sseSummary.eventsWithTraceId ?? 0}`,
        `- TraceIds: ${(sseSummary.traceIds ?? []).slice(0, 8).join(', ') || '-'}`,
        `- Errors: ${sseSummary.errors.length}`,
        `- Export: ${exportSummary?.ok ? 'ok' : exportSummary ? 'failed' : 'n/a'}${exportSummary?.detail ? ` · ${exportSummary.detail}` : ''}`,
        '',
        '## Criteria',
        '',
        ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function detectLiveBlocker(plain) {
    const rateLimitMatch = plain.match(
        /You've hit your rate limit\.[^\n]*(?:reset in ([^.]+)\.)?[^\n]*(?:Request ID: ([^)]+))?/i,
    );
    if (rateLimitMatch) {
        return {
            id: 'sdk-rate-limit',
            detail: `GitHub Copilot SDK rate limit${rateLimitMatch[1] ? ` · reset em ${rateLimitMatch[1].trim()}` : ''}${rateLimitMatch[2] ? ` · request=${rateLimitMatch[2].trim()}` : ''}`,
        };
    }
    if (/\[rate_limit\]/i.test(plain)) {
        return { id: 'sdk-rate-limit', detail: 'GitHub Copilot SDK rate limit' };
    }
    return null;
}

function isObjectPayload(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function summarizeSseEvents(events) {
    const publicEvents = events.filter((evt) => !['connected', 'heartbeat'].includes(evt.event));
    const ids = publicEvents.map((evt) => evt.id).filter((id) => Number.isFinite(id));
    const names = new Set(publicEvents.map((evt) => evt.event));
    const payloadObjects = publicEvents.filter((evt) => isObjectPayload(evt.data));
    const sourceEvents = payloadObjects.filter((evt) => typeof evt.data.source === 'string' && evt.data.source.length > 0);
    const eventSourceEvents = payloadObjects.filter(
        (evt) => typeof evt.data.eventSource === 'string' && evt.data.eventSource.length > 0,
    );
    const sourceEnvelopeEvents = payloadObjects.filter(
        (evt) =>
            (typeof evt.data.source === 'string' && evt.data.source.length > 0) ||
            (typeof evt.data.eventSource === 'string' && evt.data.eventSource.length > 0),
    );
    const traceEvents = payloadObjects.filter(
        (evt) => typeof evt.data.traceId === 'string' && evt.data.traceId.length > 0,
    );
    const traceIds = [...new Set(traceEvents.map((evt) => evt.data.traceId))].sort();
    const criticalEvents = payloadObjects.filter((evt) =>
        ['delta', 'assistant.message', 'dialog.reply', 'tool.lifecycle', 'user_input.requested', 'user_input.completed'].includes(
            evt.event,
        ),
    );
    return {
        publicEvents,
        ids,
        names,
        payloadObjects,
        sourceEvents,
        eventSourceEvents,
        sourceEnvelopeEvents,
        traceEvents,
        traceIds,
        criticalEvents,
    };
}

function extractArchiveRawEvents(plain) {
    const entries = [];
    for (const line of plain.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') || !trimmed.endsWith('}') || !trimmed.includes('"schemaVersion"')) continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && typeof parsed.event === 'string') {
                entries.push(parsed);
            }
        } catch {
            // Saida humana pode conter linhas parciais; o runner ignora e reporta pelos criterios agregados.
        }
    }
    return entries;
}

function extractPlainTraceIds(plain) {
    const ids = new Set();
    for (const match of plain.matchAll(/\btrace(?:Id)?\s*[=:]?\s*(turn:[A-Za-z0-9_.:-]+)/giu)) {
        ids.add(match[1]);
    }
    return [...ids].sort();
}

function evaluateSseCriteria(sseSummary, { expectPublicEvents, plain = '' }) {
    if (sseSummary.disabled) {
        return [
            {
                id: 'sse-disabled',
                pass: true,
                detail: 'SSE collector disabled by --no-sse',
            },
        ];
    }
    const summary = summarizeSseEvents(sseSummary.events);
    const { publicEvents, ids, names, payloadObjects, sourceEnvelopeEvents, traceEvents, traceIds, criticalEvents } = summary;
    const monotonic = ids.every((id, index) => index === 0 || id > ids[index - 1]);
    const plainTraceIds = extractPlainTraceIds(plain);
    const traceOverlap = traceIds.filter((traceId) => plainTraceIds.includes(traceId));
    const criticalWithSource = criticalEvents.filter(
        (evt) => typeof evt.data.source === 'string' || typeof evt.data.eventSource === 'string',
    );
    return [
        {
            id: 'sse-connected',
            pass: sseSummary.connected && sseSummary.errors.length === 0,
            detail: `SSE collector connected with ${sseSummary.errors.length} error(s)`,
        },
        {
            id: 'sse-no-internal-envelope',
            pass: !sseSummary.raw.includes('__terminalSseEventId'),
            detail: 'internal replay envelope metadata was not exposed to SSE clients',
        },
        {
            id: 'sse-event-ids-monotonic',
            pass: publicEvents.length === 0 || (ids.length > 0 && monotonic),
            detail: `observed ${ids.length}/${publicEvents.length} public SSE events with monotonic ids`,
        },
        {
            id: 'sse-public-events',
            pass:
                !expectPublicEvents ||
                names.has('delta') ||
                names.has('assistant.message') ||
                names.has('tool.lifecycle') ||
                names.has('user_input.requested'),
            detail: `observed public SSE events: ${[...names].slice(0, 8).join(', ') || 'none'}`,
        },
        {
            id: 'sse-source-envelope',
            pass: payloadObjects.length === 0 || sourceEnvelopeEvents.length === payloadObjects.length,
            detail: `${sourceEnvelopeEvents.length}/${payloadObjects.length} object payload events include source/eventSource`,
        },
        {
            id: 'sse-critical-events-sourced',
            pass: criticalEvents.length === 0 || criticalWithSource.length === criticalEvents.length,
            detail: `${criticalWithSource.length}/${criticalEvents.length} critical transcript/tool/user-input events include source/eventSource`,
        },
        {
            id: 'sse-trace-envelope',
            pass: !expectPublicEvents || traceEvents.length > 0,
            detail: `${traceEvents.length}/${payloadObjects.length} object payload events include traceId; traceIds=${traceIds.slice(0, 5).join(', ') || '-'}`,
        },
        {
            id: 'sse-stdout-trace-overlap',
            pass: !expectPublicEvents || traceIds.length === 0 || traceOverlap.length > 0,
            detail: `stdout traceIds=${plainTraceIds.slice(0, 5).join(', ') || '-'} · sse traceIds=${traceIds.slice(0, 5).join(', ') || '-'} · overlap=${traceOverlap.slice(0, 5).join(', ') || '-'}`,
        },
    ];
}

function evaluateOutput(plain, sseSummary, exportSummary) {
    const markerCount = (plain.match(/DELTA-CANONICAL-\d/g) ?? []).length;
    const preEventsPlain = plain.split(/\n\s*voc[eê]\[[^\n]*?›\s+\/events\b/i)[0] ?? plain;
    const archiveRawEvents = extractArchiveRawEvents(plain);
    const sseIds = summarizeSseEvents(sseSummary.events).ids;
    const archiveIds = archiveRawEvents.map((evt) => evt.eventId).filter((id) => Number.isFinite(id));
    const archiveSseOverlap = archiveIds.filter((id) => sseIds.includes(id));
    const askRenderedByQuestionPending = /\[(?:QUESTION|ASK:[^\]]+)\]\s+LLM-B perguntou:\s*"ASK-CANONICAL: responda SIM para fechar o teste"/.test(
        preEventsPlain,
    );
    const askRenderedBySdk = /\[ASK\]\s+ASK-CANONICAL: responda SIM para fechar o teste/.test(preEventsPlain);
    const liveDeltaBlockVisible = /\[[^\]\n]*\]\s+🧠\s+LLM-B[\s\S]{0,2200}DELTA-CANONICAL-8/.test(
        preEventsPlain,
    );
    const assistantMessageDeltaBlockVisible = /\[LLM-B\]\s+Mensagem[\s\S]{0,2200}DELTA-CANONICAL-8/.test(
        preEventsPlain,
    );
    const postAskFinalMarker = String.raw`(?:POST-ASK-CANONICAL-FINAL|Teste can[oô]nico|Usu[aá]rio confirmou SIM|confirmou SIM|respondeu SIM|Sistema operacional)`;
    const finalRenderedByLiveTurn = new RegExp(
        String.raw`\[[^\]\n]*\]\s+🧠\s+LLM-B[\s\S]{0,1800}${postAskFinalMarker}`,
        'iu',
    ).test(preEventsPlain);
    const finalRenderedByAssistantMessage = new RegExp(
        String.raw`\[LLM-B\]\s+Mensagem[\s\S]{0,1800}${postAskFinalMarker}`,
        'iu',
    ).test(preEventsPlain);
    const taskDeltaActivityDuringDialog =
        /task\s+·\s+Executando tarefa interna\s+—\s+delta/.test(preEventsPlain) ||
        /"label":"Executando tarefa interna","detail":"delta/.test(preEventsPlain);
    const duplicatePathologies = [
        /__anonymous__/,
        /hook:error_occurred/,
    ];
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal reached ready state',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal ran with an interactive REPL/TTY surface',
        },
        {
            id: 'partial-deltas',
            pass: markerCount >= 8,
            detail: `observed ${markerCount} DELTA-CANONICAL markers`,
        },
        {
            id: 'final-delta-block',
            pass: liveDeltaBlockVisible || assistantMessageDeltaBlockVisible,
            detail: `canonical delta block visible live=${liveDeltaBlockVisible ? 'yes' : 'no'} assistant.message=${assistantMessageDeltaBlockVisible ? 'yes' : 'no'}`,
        },
        {
            id: 'tool-start-done',
            pass: /\[TOOL\].*read_file_content/s.test(plain) && /✅ \[DONE\] read_file_content/s.test(plain),
            detail: 'read_file_content start and done were rendered',
        },
        {
            id: 'ask-user-visible',
            pass: /\[ASK\] ASK-CANONICAL: responda SIM para fechar o teste/.test(plain),
            detail: 'ask_user prompt rendered persistently',
        },
        {
            id: 'ask-user-single-source',
            pass: askRenderedBySdk && !askRenderedByQuestionPending,
            detail: `ask_user rendered by sdk=${askRenderedBySdk ? 'yes' : 'no'} question.pending=${askRenderedByQuestionPending ? 'yes' : 'no'}`,
        },
        {
            id: 'ask-user-answer',
            pass: /Resposta enviada para pergunta pendente/.test(plain) || /resposta=SIM/.test(plain),
            detail: 'human answer was registered',
        },
        {
            id: 'ask-user-answer-not-assistant-echo',
            pass:
                !/\[LLM-B\] Mensagem[\s\S]{0,240}\n\s*│\s+SIM(?:\s|$)/.test(plain) &&
                !/\]\s+🧠\s+LLM-B[\s\S]{0,240}\n\s*│\s+SIM(?:\s|$)/.test(plain),
            detail: 'human answer was not rendered as an LLM-B authored transcript or live delta',
        },
        {
            id: 'post-ask-final-visible',
            pass: finalRenderedByLiveTurn || finalRenderedByAssistantMessage,
            detail: `post-ask final visible live=${finalRenderedByLiveTurn ? 'yes' : 'no'} assistant.message=${finalRenderedByAssistantMessage ? 'yes' : 'no'}`,
        },
        {
            id: 'llm-usage-visible',
            pass:
                /Telemetria LLM sem Premium Request/.test(plain) ||
                /Última telemetria LLM/.test(plain) ||
                /Premium Request classificada/.test(plain),
            detail: 'llm.usage telemetry surfaced separately from PR',
        },
        {
            id: 'sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo=/.test(plain),
            detail: '/events rendered the durable public SSE archive tail',
        },
        {
            id: 'sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw exposed ${archiveRawEvents.length} archived event(s)`,
        },
        {
            id: 'sse-archive-http-overlap',
            pass: sseIds.length === 0 || archiveSseOverlap.length > 0,
            detail: `archiveIds=${archiveIds.slice(0, 8).join(', ') || '-'} · httpIds=${sseIds.slice(0, 8).join(', ') || '-'} · overlap=${archiveSseOverlap.slice(0, 8).join(', ') || '-'}`,
        },
        {
            id: 'no-obvious-duplication',
            pass: !duplicatePathologies.some((pattern) => pattern.test(plain)),
            detail: 'no known duplicate/pathology markers detected',
        },
        {
            id: 'no-final-delta-duplication',
            pass: !(finalRenderedByLiveTurn && finalRenderedByAssistantMessage),
            detail: `final rendered live=${finalRenderedByLiveTurn ? 'yes' : 'no'} assistant.message=${finalRenderedByAssistantMessage ? 'yes' : 'no'}`,
        },
        {
            id: 'no-parallel-task-delta-after-dialog',
            pass:
                !/delta suppressed\/(?:duplicate_suffix|causal_duplicate)\s+·\s+task\.delta/.test(plain) &&
                !(liveDeltaBlockVisible && taskDeltaActivityDuringDialog),
            detail: `dialog.delta is canonical; task.delta activity=${taskDeltaActivityDuringDialog ? 'yes' : 'no'}`,
        },
        {
            id: 'no-terminal-errors',
            pass: /Nenhum erro recente/.test(plain) && !/\bERROR\b/.test(plain),
            detail: 'terminal error tracker stayed clean',
        },
        {
            id: 'clean-quit',
            pass: /readline fechado/.test(plain),
            detail: 'terminal exited through /quit',
        },
        {
            id: 'export-created',
            pass: Boolean(exportSummary?.ok),
            detail: exportSummary?.detail ?? 'conversation export was not inspected',
        },
        {
            id: 'export-transcript',
            pass: Boolean(exportSummary?.hasTranscript),
            detail: 'exported Markdown contains the assistant transcript',
        },
        {
            id: 'export-streaming-diagnostics',
            pass: Boolean(exportSummary?.hasStreamingDiagnostics),
            detail: 'exported Markdown contains streaming/final reconciliation diagnostics',
        },
        {
            id: 'export-envelope',
            pass: Boolean(exportSummary?.hasEnvelope),
            detail: 'exported Markdown contains source/trace envelope data',
        },
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: true, plain }),
    ];
}

function evaluateNoPrOutput(plain, sseSummary) {
    const archiveRawEvents = extractArchiveRawEvents(plain);
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal reached ready state',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal ran with an interactive REPL/TTY surface',
        },
        {
            id: 'no-explicit-turn',
            pass: !/\[intervene→turn\]/.test(plain) && !/Processando mensagem/.test(plain),
            detail: 'no explicit LLM turn was opened during --no-pr probe',
        },
        {
            id: 'usage-visible',
            pass: /Premium Request:|Última Premium Request classificada:/.test(plain) && /Modo: sdk=/.test(plain),
            detail: '/usage now rendered context, PR and SDK mode telemetry',
        },
        {
            id: 'activity-visible',
            pass: /Atividade Atual da LLM-B/.test(plain) && /Streaming público/.test(plain),
            detail: '/activity rendered activity and streaming diagnostics sections',
        },
        {
            id: 'metrics-visible',
            pass: /Métricas da Sessão/.test(plain) && /Streaming público/.test(plain),
            detail: '/metrics rendered session and public streaming counters',
        },
        {
            id: 'sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo=/.test(plain),
            detail: '/events rendered the durable public SSE archive tail without opening a turn',
        },
        {
            id: 'sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw exposed ${archiveRawEvents.length} archived control event(s) without opening a turn`,
        },
        {
            id: 'no-tools-started',
            pass: !/\[TOOL\]/.test(plain) && !/\[DONE\]/.test(plain),
            detail: 'probe did not invoke tools',
        },
        {
            id: 'no-terminal-errors',
            pass: /Nenhum erro recente/.test(plain) && !/\bERROR\b/.test(plain),
            detail: 'terminal error tracker stayed clean',
        },
        {
            id: 'clean-quit',
            pass: /readline fechado/.test(plain),
            detail: 'terminal exited through /quit',
        },
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: false, plain }),
    ];
}

function evaluateBlockedOutput(plain, sseSummary, blocker) {
    return [
        {
            id: 'ready',
            pass: /LLM-B pronta/.test(plain),
            detail: 'terminal reached ready state before blocker',
        },
        {
            id: 'interactive-repl',
            pass: !/Modo headless detectado/.test(plain),
            detail: 'terminal ran with an interactive REPL/TTY surface',
        },
        {
            id: 'blocked-by-sdk-rate-limit',
            pass: false,
            detail: blocker.detail,
        },
        {
            id: 'sse-connected',
            pass: sseSummary.connected,
            detail: `SSE collector ${sseSummary.connected ? 'connected' : 'did not connect'} before blocker`,
        },
        {
            id: 'root-cause-not-ux-duplication',
            pass: true,
            detail: 'scenario criteria skipped because SDK did not produce assistant/tool/ask_user events',
        },
    ];
}

async function inspectExportedMarkdown(exportPath) {
    try {
        const content = await readFile(exportPath, 'utf8');
        return {
            ok: true,
            detail: `${content.length} chars`,
            hasTranscript: /DELTA-CANONICAL-8/.test(content) || /ASK-CANONICAL/.test(content),
            hasStreamingDiagnostics: /streaming=/.test(content),
            hasEnvelope: /envelope=/.test(content),
            content,
        };
    } catch (error) {
        return {
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
            hasTranscript: false,
            hasStreamingDiagnostics: false,
            hasEnvelope: false,
            content: '',
        };
    }
}

function parseSseFrame(frame) {
    const lines = frame.split(/\r?\n/u);
    let event = 'message';
    let id = null;
    const dataLines = [];
    for (const line of lines) {
        if (line.startsWith('event:')) {
            event = line.slice('event:'.length).trim();
        } else if (line.startsWith('id:')) {
            const parsed = Number(line.slice('id:'.length).trim());
            id = Number.isFinite(parsed) ? parsed : null;
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
        }
    }
    const dataRaw = dataLines.join('\n');
    let data = dataRaw;
    if (dataRaw) {
        try {
            data = JSON.parse(dataRaw);
        } catch {
            data = dataRaw;
        }
    }
    return { id, event, data };
}

function startSseCollector({ port = 3009, pathname = '/events' } = {}) {
    let raw = '';
    let buffer = '';
    let connected = false;
    let statusCode = null;
    const errors = [];
    const events = [];

    const req = http.request(
        {
            host: '127.0.0.1',
            port,
            path: pathname,
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
        },
        (res) => {
            statusCode = res.statusCode ?? null;
            connected = statusCode === 200;
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                raw += chunk;
                buffer += chunk;
                const frames = buffer.split(/\r?\n\r?\n/u);
                buffer = frames.pop() ?? '';
                for (const frame of frames) {
                    if (!frame.trim()) continue;
                    events.push(parseSseFrame(frame));
                }
            });
        },
    );
    req.on('error', (err) => {
        errors.push(err instanceof Error ? err.message : String(err));
    });
    req.end();

    return {
        get raw() {
            return raw;
        },
        events,
        errors,
        close() {
            req.destroy();
        },
        summary() {
            const correlation = summarizeSseEvents(events);
            return {
                connected,
                statusCode,
                eventCount: events.length,
                eventsWithId: events.filter((evt) => Number.isFinite(evt.id)).length,
                eventsWithSource: correlation.sourceEnvelopeEvents.length,
                eventsWithTraceId: correlation.traceEvents.length,
                traceIds: correlation.traceIds,
                errors: [...errors],
                events: [...events],
                raw,
            };
        },
    };
}

async function main() {
    const timeoutMs = Number(readArg('--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
    const postAnswerDelayMs = Number(readArg('--post-answer-delay-ms', String(DEFAULT_POST_ANSWER_DELAY_MS)));
    const postAskContinuationWaitMs = Number(
        readArg('--post-ask-continuation-wait-ms', String(DEFAULT_POST_ASK_CONTINUATION_WAIT_MS)),
    );
    const outDir = path.resolve(ROOT, readArg('--out-dir', `artifacts/terminal-live/${nowStamp()}`));
    const requestedTransport = readArg('--transport', 'pty');
    const dryRun = hasFlag('--dry-run');
    const noPr = hasFlag('--no-pr');
    const collectSse = !hasFlag('--no-sse');
    const requestedTerminalPort = readArg('--terminal-port', '');
    const requestedSsePort = readArg('--sse-port', '');
    const preferredPort = Number(requestedTerminalPort || requestedSsePort || '3009');
    const terminalPort =
        requestedTerminalPort || requestedSsePort ? preferredPort : await resolveLiveTerminalPort(preferredPort);
    const ssePort = Number(requestedSsePort || String(terminalPort));
    const startedAt = new Date().toISOString();

    await mkdir(outDir, { recursive: true });
    const rawPath = path.join(outDir, 'terminal.raw.log');
    const plainPath = path.join(outDir, 'terminal.plain.log');
    const exportPath = path.join(outDir, 'conversation-export.md');
    const exportArg = path.relative(ROOT, exportPath).replaceAll(path.sep, '/');
    const sseRawPath = path.join(outDir, 'terminal.sse.log');
    const sseJsonlPath = path.join(outDir, 'terminal.sse.jsonl');
    const jsonPath = path.join(outDir, 'summary.json');
    const mdPath = path.join(outDir, 'summary.md');

    if (dryRun) {
        const prompt = noPr
            ? '/usage now\n/activity 20\n/metrics\n/events 20\n/events 20 --raw\n/errors 10\n/quit'
            : buildScenarioPrompt();
        await writeFile(path.join(outDir, 'prompt.txt'), `${prompt}\n`, 'utf8');
        console.log(`[terminal-live] dry-run prompt written to ${path.relative(ROOT, path.join(outDir, 'prompt.txt'))}`);
        return;
    }

    const canUsePty = requestedTransport === 'pty' && hasCommand('script');
    const transport = canUsePty ? 'pty:script' : 'stdio:headless';
    if (requestedTransport === 'pty' && !canUsePty) {
        console.warn('[terminal-live] comando `script` indisponível; usando stdio headless como fallback diagnóstico.');
    }

    let raw = '';
    let readySent = false;
    let answerSent = false;
    let postCommandsSent = false;
    let quitSent = false;
    let exitCode = null;
    let sseCollector = null;
    let postAskContinuationObserved = false;
    let postAnswerCommandTimer = null;
    const command = canUsePty
        ? {
              cmd: 'script',
              args: ['-qfec', 'npm run terminal:llm-b', '/dev/null'],
          }
        : { cmd: 'npm', args: ['run', 'terminal:llm-b'] };

    const child = spawn(command.cmd, command.args, {
        cwd: ROOT,
        env: {
            ...process.env,
            COPILOT_MODEL: 'auto',
            COPILOT_REASONING_EFFORT: 'high',
            TERMINAL_DISPLAY_PRESET: 'full',
            COPILOT_SDK_ENABLED: 'true',
            COPILOT_OPERATIONAL_PROFILE: 'production',
            LLM_B_TERMINAL_PORT: String(terminalPort),
            TERMINAL_SSE_EVENT_ARCHIVE_DIR: path.join(outDir, 'sse-events'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const write = (line) => child.stdin.write(ensureLine(line));
    const schedulePostAnswerDiagnostics = (delayMs = postAnswerDelayMs) => {
        if (postCommandsSent) return;
        postCommandsSent = true;
        if (postAnswerCommandTimer) {
            clearTimeout(postAnswerCommandTimer);
            postAnswerCommandTimer = null;
        }
        setTimeout(() => {
            write('/usage now');
            write('/activity 40');
            write('/tools diag');
            write('/events 60');
            write('/events 100 --raw');
            write('/errors 10');
            write('/health');
            write(`/export ${exportArg}`);
            setTimeout(() => {
                if (!quitSent) {
                    quitSent = true;
                    write('/quit');
                }
            }, 2_000).unref();
        }, Math.max(0, delayMs)).unref();
    };
    const timeout = setTimeout(() => {
        write('/quit');
        setTimeout(() => child.kill('SIGTERM'), 2_000).unref();
    }, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);

    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        raw += text;
        process.stdout.write(text);
        const plain = stripAnsi(raw);
        if (/Modo headless detectado/.test(plain) && !canUsePty && !readySent) {
            console.warn(
                '[terminal-live] terminal entrou em modo headless; comandos REPL não serão exercitados neste transporte.',
            );
        }
        if (!readySent && /LLM-B pronta/.test(plain)) {
            readySent = true;
            if (collectSse) {
                sseCollector = startSseCollector({ port: Number.isFinite(ssePort) ? ssePort : terminalPort });
            }
            write('/usage now');
            write('/activity 12');
            if (noPr) {
                write('/metrics');
                write('/events 20');
                write('/events 20 --raw');
                write('/errors 10');
                write('/quit');
                return;
            }
            write(buildScenarioPrompt());
        }
        if (!answerSent && /\[ASK\] ASK-CANONICAL: responda SIM para fechar o teste/.test(plain)) {
            answerSent = true;
            setTimeout(() => write('SIM'), 500).unref();
        }
        if (answerSent && !postAskContinuationObserved && POST_ASK_FINAL_RE.test(plain)) {
            postAskContinuationObserved = true;
            schedulePostAnswerDiagnostics(500);
        }
        if (answerSent && !postCommandsSent && /Resposta enviada para pergunta pendente/.test(plain)) {
            postAnswerCommandTimer = setTimeout(() => {
                schedulePostAnswerDiagnostics(0);
            }, Math.max(1_000, postAskContinuationWaitMs)).unref();
        }
        if (!postCommandsSent && /Erro de sessão \[query\]|session\.error|CAPIError|Failed to get response from the AI model/.test(plain)) {
            postCommandsSent = true;
            if (postAnswerCommandTimer) {
                clearTimeout(postAnswerCommandTimer);
                postAnswerCommandTimer = null;
            }
            setTimeout(() => {
                write('/activity 40');
                write('/events 100 --raw');
                write('/errors 10');
                if (!quitSent) {
                    quitSent = true;
                    write('/quit');
                }
            }, 1_000).unref();
        }
        if (!quitSent && /Exportado:/.test(plain)) {
            quitSent = true;
            setTimeout(() => write('/quit'), 500).unref();
        }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    exitCode = await new Promise((resolve) => {
        child.on('close', (code) => resolve(code));
    });
    clearTimeout(timeout);
    sseCollector?.close();

    const plain = stripAnsi(raw);
    const sseSummary = sseCollector?.summary() ?? {
        connected: false,
        statusCode: null,
        eventCount: 0,
        eventsWithId: 0,
        eventsWithSource: 0,
        eventsWithTraceId: 0,
        traceIds: [],
        errors: collectSse ? ['collector-not-started'] : [],
        events: [],
        raw: '',
        disabled: !collectSse,
    };
    const blocker = noPr ? null : detectLiveBlocker(plain);
    const exportSummary = noPr || blocker ? null : await inspectExportedMarkdown(exportPath);
    const criteria = blocker
        ? evaluateBlockedOutput(plain, sseSummary, blocker)
        : noPr
          ? evaluateNoPrOutput(plain, sseSummary)
          : evaluateOutput(plain, sseSummary, exportSummary);
    const durationMs = Date.now() - Date.parse(startedAt);
    await writeFile(rawPath, raw, 'utf8');
    await writeFile(plainPath, plain, 'utf8');
    await writeFile(sseRawPath, sseSummary.raw, 'utf8');
    await writeFile(
        sseJsonlPath,
        `${sseSummary.events.map((evt) => JSON.stringify(evt)).join('\n')}${sseSummary.events.length ? '\n' : ''}`,
        'utf8',
    );
    await writeFile(
        jsonPath,
        `${JSON.stringify(
            {
                ok: criteria.every((c) => c.pass),
                blocked: Boolean(blocker),
                blocker,
                startedAt,
                durationMs,
                exitCode,
                criteria,
                sse: sseSummary,
                export: exportSummary
                    ? {
                          ok: exportSummary.ok,
                          detail: exportSummary.detail,
                          hasTranscript: exportSummary.hasTranscript,
                          hasStreamingDiagnostics: exportSummary.hasStreamingDiagnostics,
                          hasEnvelope: exportSummary.hasEnvelope,
                          path: path.relative(ROOT, exportPath),
                      }
                    : null,
            },
            null,
            2,
        )}\n`,
        'utf8',
    );
    await writeFile(
        mdPath,
        buildReport({
            criteria,
            durationMs,
            exitCode,
            blocker,
            outputPath: path.relative(ROOT, rawPath),
            plainOutputPath: path.relative(ROOT, plainPath),
            exportPath: noPr ? null : path.relative(ROOT, exportPath),
            exportSummary,
            sseRawPath: path.relative(ROOT, sseRawPath),
            sseJsonlPath: path.relative(ROOT, sseJsonlPath),
            sseSummary,
            startedAt,
            transport,
        }),
        'utf8',
    );
    const failed = criteria.filter((criterion) => !criterion.pass);
    console.log(`[terminal-live] summary: ${path.relative(ROOT, mdPath)}`);
    if (failed.length > 0 || exitCode !== 0) {
        console.error(`[terminal-live] FAIL: ${failed.map((criterion) => criterion.id).join(', ') || 'exitCode'}`);
        process.exitCode = 1;
    }
}

await main();
