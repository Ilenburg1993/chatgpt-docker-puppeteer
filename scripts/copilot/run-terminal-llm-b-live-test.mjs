#!/usr/bin/env node
/**
 * Canonical live runner for `terminal:llm-b`.
 *
 * This is intentionally opt-in and not part of default CI: it talks to the real SDK and can consume a Premium Request
 * for the explicit user turn. It exists to make terminal validation repeatable instead of relying on ad hoc visual
 * inspection.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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

function buildReport({ criteria, durationMs, exitCode, outputPath, plainOutputPath, startedAt, transport }) {
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
        '',
        '## Criteria',
        '',
        ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function evaluateOutput(plain) {
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
    ];
}

async function main() {
    const timeoutMs = Number(readArg('--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
    const postAnswerDelayMs = Number(readArg('--post-answer-delay-ms', String(DEFAULT_POST_ANSWER_DELAY_MS)));
    const outDir = path.resolve(ROOT, readArg('--out-dir', `artifacts/terminal-live/${nowStamp()}`));
    const requestedTransport = readArg('--transport', 'pty');
    const dryRun = hasFlag('--dry-run');
    const startedAt = new Date().toISOString();

    await mkdir(outDir, { recursive: true });
    const rawPath = path.join(outDir, 'terminal.raw.log');
    const plainPath = path.join(outDir, 'terminal.plain.log');
    const jsonPath = path.join(outDir, 'summary.json');
    const mdPath = path.join(outDir, 'summary.md');

    if (dryRun) {
        const prompt = buildScenarioPrompt();
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
            write('/usage now');
            write('/activity 12');
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

    const plain = stripAnsi(raw);
    const criteria = evaluateOutput(plain);
    const durationMs = Date.now() - Date.parse(startedAt);
    await writeFile(rawPath, raw, 'utf8');
    await writeFile(plainPath, plain, 'utf8');
    await writeFile(
        jsonPath,
        `${JSON.stringify({ ok: criteria.every((c) => c.pass), startedAt, durationMs, exitCode, criteria }, null, 2)}\n`,
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
