#!/usr/bin/env node
/**
 * Canonical live runner for `terminal:llm-b`.
 *
 * This is intentionally opt-in and not part of default CI: the default scenario talks to the real SDK and can consume
 * a Premium Request for the explicit user turn. Use `--no-pr` for a boot/resume/control-only probe that validates UX
 * telemetry without sending an LLM turn.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POST_ANSWER_DELAY_MS = 6_000;
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

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
        'Não use outras tools além de report_intent, read_file_content e ask_user.',
    ].join(' ');
}

function buildReport({
    criteria,
    durationMs,
    exitCode,
    outputPath,
    plainOutputPath,
    sseRawPath,
    sseJsonlPath,
    sseSummary,
    startedAt,
    transport,
}) {
    const ok = criteria.every((criterion) => criterion.pass);
    const lines = [
        '# Terminal LLM-B Live Test',
        '',
        `Started: ${startedAt}`,
        `Duration: ${durationMs}ms`,
        `Exit code: ${String(exitCode)}`,
        `Transport: ${transport}`,
        `Status: ${ok ? 'PASS' : 'FAIL'}`,
        '',
        '## Artifacts',
        '',
        `- Raw output: ${outputPath}`,
        `- Plain output: ${plainOutputPath}`,
        `- SSE raw output: ${sseRawPath}`,
        `- SSE JSONL: ${sseJsonlPath}`,
        '',
        '## SSE',
        '',
        `- Connected: ${sseSummary.connected ? 'yes' : 'no'}`,
        `- Events: ${sseSummary.eventCount}`,
        `- Events with id: ${sseSummary.eventsWithId}`,
        `- Errors: ${sseSummary.errors.length}`,
        '',
        '## Criteria',
        '',
        ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function evaluateSseCriteria(sseSummary, { expectPublicEvents }) {
    if (sseSummary.disabled) {
        return [
            {
                id: 'sse-disabled',
                pass: true,
                detail: 'SSE collector disabled by --no-sse',
            },
        ];
    }
    const publicEvents = sseSummary.events.filter((evt) => !['connected', 'heartbeat'].includes(evt.event));
    const ids = publicEvents.map((evt) => evt.id).filter((id) => Number.isFinite(id));
    const monotonic = ids.every((id, index) => index === 0 || id > ids[index - 1]);
    const names = new Set(publicEvents.map((evt) => evt.event));
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
    ];
}

function evaluateOutput(plain, sseSummary) {
    const markerCount = (plain.match(/DELTA-CANONICAL-\d/g) ?? []).length;
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
            pass: /\[LLM-B\] Mensagem[\s\S]*DELTA-CANONICAL-8/.test(plain),
            detail: 'final assistant transcript contains the canonical delta block',
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
            id: 'llm-usage-visible',
            pass: /Uso LLM sem novo PR/.test(plain) || /Último uso LLM/.test(plain),
            detail: 'llm.usage telemetry surfaced separately from PR',
        },
        {
            id: 'no-obvious-duplication',
            pass: !duplicatePathologies.some((pattern) => pattern.test(plain)),
            detail: 'no known duplicate/pathology markers detected',
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
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: true }),
    ];
}

function evaluateNoPrOutput(plain, sseSummary) {
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
            pass: /Último PR:/.test(plain) && /Modo: sdk=/.test(plain),
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
        ...evaluateSseCriteria(sseSummary, { expectPublicEvents: false }),
    ];
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
            return {
                connected,
                statusCode,
                eventCount: events.length,
                eventsWithId: events.filter((evt) => Number.isFinite(evt.id)).length,
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
    const outDir = path.resolve(ROOT, readArg('--out-dir', `artifacts/terminal-live/${nowStamp()}`));
    const requestedTransport = readArg('--transport', 'pty');
    const dryRun = hasFlag('--dry-run');
    const noPr = hasFlag('--no-pr');
    const collectSse = !hasFlag('--no-sse');
    const ssePort = Number(readArg('--sse-port', '3009'));
    const startedAt = new Date().toISOString();

    await mkdir(outDir, { recursive: true });
    const rawPath = path.join(outDir, 'terminal.raw.log');
    const plainPath = path.join(outDir, 'terminal.plain.log');
    const sseRawPath = path.join(outDir, 'terminal.sse.log');
    const sseJsonlPath = path.join(outDir, 'terminal.sse.jsonl');
    const jsonPath = path.join(outDir, 'summary.json');
    const mdPath = path.join(outDir, 'summary.md');

    if (dryRun) {
        const prompt = noPr
            ? '/usage now\n/activity 20\n/metrics\n/errors 10\n/quit'
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
    let exitCode = null;
    let sseCollector = null;
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
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const write = (line) => child.stdin.write(ensureLine(line));
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
                sseCollector = startSseCollector({ port: Number.isFinite(ssePort) ? ssePort : 3009 });
            }
            write('/usage now');
            write('/activity 12');
            if (noPr) {
                write('/metrics');
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
        if (answerSent && !postCommandsSent && /Resposta enviada para pergunta pendente/.test(plain)) {
            postCommandsSent = true;
            setTimeout(() => {
                write('/usage now');
                write('/activity 40');
                write('/tools diag');
                write('/errors 10');
                write('/health');
                write('/quit');
            }, postAnswerDelayMs).unref();
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
        errors: collectSse ? ['collector-not-started'] : [],
        events: [],
        raw: '',
        disabled: !collectSse,
    };
    const criteria = noPr ? evaluateNoPrOutput(plain, sseSummary) : evaluateOutput(plain, sseSummary);
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
            { ok: criteria.every((c) => c.pass), startedAt, durationMs, exitCode, criteria, sse: sseSummary },
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
            outputPath: path.relative(ROOT, rawPath),
            plainOutputPath: path.relative(ROOT, plainPath),
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
