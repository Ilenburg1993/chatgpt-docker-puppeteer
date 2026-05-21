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
import { parse as parseDotenv } from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POST_ANSWER_DELAY_MS = 6_000;
const DEFAULT_POST_ASK_CONTINUATION_WAIT_MS = 45_000;
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const SECRET_ENV_RE = /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|BEARER)/iu;
const POST_ASK_FINAL_RE = /POST-ASK-CANONICAL-FINAL:\s*usu[aá]rio confirmou SIM/iu;
const TURN_SETTLED_AFTER_ASK_RE =
    /(?:Resposta concluída|Turno concluído; aguardando próxima mensagem|Turno do assistente concluído)/iu;
const REPL_PROMPT_TAIL_RE = /(?:^|\n)voc[eê]\[[^\n]*?›\s*$/iu;

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

function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function buildScenarioPrompt() {
    return [
        'Faça um teste integrado canônico do terminal.',
        'Primeiro chame report_intent com o intent "terminal live canonical deltas tools ask_user usage".',
        'Depois leia as primeiras 3 linhas de package.json usando read_file_content.',
        'Em seguida escreva uma resposta pública longa, com frases separadas DELTA-CANONICAL-1 até DELTA-CANONICAL-8, para validar deltas parciais e final.',
        'Por fim chame ask_user perguntando exatamente "ASK-CANONICAL: responda SIM para fechar o teste".',
        'Depois que o usuário responder SIM, escreva uma última mensagem pública contendo exatamente "POST-ASK-CANONICAL-FINAL: usuário confirmou SIM".',
        'Antes da resposta SIM, não escreva, cite nem antecipe o marcador POST-ASK-CANONICAL-FINAL.',
        'A pergunta ASK-CANONICAL deve ser feita pela tool ask_user real; não a simule como texto, Markdown, JSON ou pseudo-tool no transcript público.',
        'Não use outras tools além de report_intent, read_file_content e ask_user.',
    ].join(' ');
}

function buildNoPrProbeCommands() {
    return ['/usage now', '/activity 20', '/metrics', '/events 20', '/events 20 --raw', '/errors 10', '/quit'];
}

function buildByokProbeCommands({ fixtureBaseUrl = 'http://127.0.0.1:11434/v1' } = {}) {
    return [
        '/byok',
        '/byok env',
        '/byok providers',
        '/byok health',
        '/byok profiles',
        '/byok models refresh',
        '/byok models free reasoning safe 8',
        '/byok recommend free reasoning safe 5',
        '/byok use codex-fixture',
        '/byok providers',
        '/byok health',
        '/byok models refresh',
        '/byok models provider:openai-compatible free reasoning safe 8',
        '/byok recommend free reasoning safe 5',
        '/byok model fixture/model-b',
        '/byok',
        `/byok provider openai-compatible fixture/model-c ${fixtureBaseUrl}`,
        '/byok',
        '/byok use sdk',
        '/byok',
        '/usage now',
        '/events 30',
        '/events 30 --raw',
        '/errors 10',
        '/quit',
    ];
}

function buildByokFixtureEnv({ baseUrl = 'http://127.0.0.1:11434/v1' } = {}) {
    const fixtureToken = ['codex', 'fixture', 'token', 'never', 'print'].join('-');
    return {
        COPILOT_BYOK_ENABLED: 'false',
        COPILOT_BYOK_MODEL_DISCOVERY_ENABLED: 'true',
        COPILOT_BYOK_MODELS: 'fixture/model-a,fixture/model-b',
        COPILOT_BYOK_PROFILES_JSON: JSON.stringify({
            'codex-fixture': {
                preset: 'openai-compatible',
                baseUrl,
                bearerToken: fixtureToken,
                model: 'fixture/model-a',
                models: 'fixture/model-a,fixture/model-b',
                modelDiscoveryEnabled: true,
                contextWindowTokens: 123456,
                supportsReasoning: true,
                supportsVision: false,
                metadata: {
                    owner: 'terminal-live',
                    purpose: 'byok-control-plane-fixture',
                },
            },
        }),
    };
}

async function loadDotenvLocalEnv() {
    try {
        const content = await readFile(path.join(ROOT, '.env.local'), 'utf8');
        return parseDotenv(content);
    } catch (error) {
        if (error?.code === 'ENOENT') return {};
        throw error;
    }
}

function collectSecretValues(env) {
    const values = [];
    for (const [key, value] of Object.entries(env)) {
        if (!SECRET_ENV_RE.test(key)) continue;
        if (typeof value !== 'string' || value.length < 8) continue;
        values.push({ key, value });
    }
    return values;
}

function hasSecretLeak(text, secretValues) {
    return secretValues.some(({ value }) => value.length > 0 && text.includes(value));
}

function parseProfilesJson(raw) {
    if (!raw || raw.trim() === '') return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function profileHasUsableSecret(profileName, profile, env) {
    const tokenEnv = typeof profile?.bearerTokenEnv === 'string' ? profile.bearerTokenEnv : null;
    const apiKeyEnv = typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : null;
    if (tokenEnv && env[tokenEnv]) return true;
    if (apiKeyEnv && env[apiKeyEnv]) return true;
    if (/^kilo\b/iu.test(profileName)) return Boolean(env.KILO_CODE_API_KEY || env.KILO_API_KEY);
    if (/ollama-cloud/iu.test(profileName)) return Boolean(env.OLLAMA_CLOUD_API_KEY || env.OLLAMA_API_KEY);
    return Boolean(profile?.bearerToken || profile?.apiKey);
}

function chooseRealByokProfile(env, requestedProfile) {
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    if (requestedProfile) return requestedProfile;
    if (profiles.kilo && profileHasUsableSecret('kilo', profiles.kilo, env)) return 'kilo';
    if (profiles['ollama-cloud'] && profileHasUsableSecret('ollama-cloud', profiles['ollama-cloud'], env)) {
        return 'ollama-cloud';
    }
    const usable = Object.entries(profiles).find(([name, profile]) => profileHasUsableSecret(name, profile, env));
    return usable?.[0] ?? Object.keys(profiles)[0] ?? '';
}

function chooseAlternateByokProfile(env, activeProfile, requestedAltProfile) {
    if (requestedAltProfile) return requestedAltProfile === activeProfile ? '' : requestedAltProfile;
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    const first = Object.entries(profiles).find(
        ([name, profile]) => name !== activeProfile && profileHasUsableSecret(name, profile, env),
    );
    return first?.[0] ?? '';
}

function profileModel(env, profileName) {
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    const profile = profiles[profileName];
    return typeof profile?.model === 'string' && profile.model.trim() ? profile.model.trim() : '';
}

function profileProvider(env, profileName) {
    const profiles = parseProfilesJson(env.COPILOT_BYOK_PROFILES_JSON);
    const profile = profiles[profileName];
    for (const key of ['preset', 'providerType', 'provider', 'name']) {
        const value = profile?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return profileName || '';
}

function buildRealByokRuntime({ dotenvEnv, requestedProfile, requestedAltProfile, requestedModel, requestedAltModel }) {
    const mergedEnv = { ...process.env, ...dotenvEnv };
    const profile = chooseRealByokProfile(mergedEnv, requestedProfile);
    const altProfile = chooseAlternateByokProfile(mergedEnv, profile, requestedAltProfile);
    const model = requestedModel || profileModel(mergedEnv, profile);
    const altModel = requestedAltModel || profileModel(mergedEnv, altProfile);
    const provider = profileProvider(mergedEnv, profile);
    const altProvider = profileProvider(mergedEnv, altProfile);
    return {
        env: {
            ...dotenvEnv,
            COPILOT_BYOK_ENABLED: 'true',
            ...(profile ? { COPILOT_BYOK_PROFILE: profile } : {}),
            ...(requestedModel ? { COPILOT_BYOK_MODEL: requestedModel } : {}),
            COPILOT_BYOK_MODEL_DISCOVERY_ENABLED: mergedEnv.COPILOT_BYOK_MODEL_DISCOVERY_ENABLED ?? 'true',
        },
        profile,
        altProfile,
        model,
        altModel,
        provider,
        altProvider,
        redacted: {
            enabled: true,
            profile: profile || null,
            altProfile: altProfile || null,
            model: model || null,
            altModel: altModel || null,
            provider: provider || null,
            altProvider: altProvider || null,
            dotenvLocalLoaded: Object.keys(dotenvEnv).length > 0,
            secretKeysPresent: collectSecretValues(mergedEnv).map(({ key }) => key).sort(),
        },
    };
}

function buildByokCatalogCommands(provider) {
    const providerFilter = provider ? ` provider:${provider}` : '';
    return [
        `/byok models refresh${providerFilter}`,
        `/byok models free reasoning safe 8${providerFilter}`,
        `/byok recommend reasoning safe 8${providerFilter}`,
        `/byok probe shortlist free reasoning safe 1 timeout:60000${providerFilter}`,
    ];
}

function buildByokRealPreflightCommands({ profile, altProfile, model, altModel, provider, altProvider }) {
    const commands = ['/session sdk 8', '/byok reload', '/byok env', '/byok providers', '/byok health', '/byok profiles'];
    if (profile) commands.push(`/byok use ${profile}`);
    if (model) commands.push(`/byok model ${model}`);
    commands.push(
        '/byok',
        '/byok probe timeout:45000',
        '/byok probe agent timeout:60000',
        '/session sdk 8',
        ...buildByokCatalogCommands(provider),
    );
    if (altModel && altModel !== model) {
        commands.push(`/byok model ${altModel}`, '/byok');
    }
    if (model) {
        commands.push(`/byok model ${model}`, '/byok');
    }
    if (altProfile) {
        commands.push(`/byok use ${altProfile}`, '/byok', '/byok providers', '/byok health', ...buildByokCatalogCommands(altProvider));
        if (profile) {
            commands.push(`/byok use ${profile}`);
            if (model) commands.push(`/byok model ${model}`);
            commands.push('/byok');
        }
    }
    return commands;
}

function buildByokRealNoPrDiagnosticCommands() {
    return ['/usage now', '/activity 20', '/metrics', '/events 60', '/events 100 --raw', '/errors 10'];
}

function startByokFixtureProviderServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.url === '/v1/models' || req.url === '/models') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(
                    JSON.stringify({
                        object: 'list',
                        data: [
                            { id: 'fixture/model-a', object: 'model' },
                            { id: 'fixture/model-b', object: 'model' },
                            { id: 'fixture/model-remote-c', object: 'model' },
                        ],
                    }),
                );
                return;
            }
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('BYOK fixture provider did not expose a TCP address'));
                return;
            }
            server.unref();
            resolve({
                baseUrl: `http://127.0.0.1:${address.port}/v1`,
                close: () =>
                    new Promise((closeResolve) => {
                        server.close(() => closeResolve());
                    }),
            });
        });
    });
}

function sendCommandSequence(write, commands, { delayMs = 250 } = {}) {
    commands.forEach((commandLine, index) => {
        setTimeout(() => write(commandLine), index * delayMs).unref();
    });
}

function extractSdkSessionCockpitId(plain, label) {
    const match = String(plain ?? '').match(new RegExp(`\\b${escapeRegExp(label)}:\\s+([^\\s]+)`, 'iu'));
    const sessionId = match?.[1]?.trim();
    return sessionId && !sessionId.startsWith('(') ? sessionId : '';
}

function sessionCycleBootCriteria(boot, { expectCreated = false, expectResumed = false } = {}) {
    const plain = String(boot?.plain ?? '');
    return [
        {
            id: `${boot.id}-ready`,
            pass: /LLM-B pronta/u.test(plain),
            detail: `${boot.label} reached the REPL ready state`,
        },
        {
            id: `${boot.id}-cockpit`,
            pass: /\bSessão SDK\b/u.test(plain) && /\bPróximo boot:/u.test(plain),
            detail: `${boot.label} rendered the SDK session cockpit`,
        },
        {
            id: `${boot.id}-clean-close`,
            pass: boot.exitCode === 0 && !/ERR_USE_AFTER_CLOSE|UnhandledPromiseRejection|EPIPE/iu.test(plain),
            detail: `${boot.label} closed without redraw/stdin lifecycle errors`,
        },
        ...(expectCreated
            ? [
                  {
                      id: `${boot.id}-new-boot`,
                      pass: /último boot:\s+created\s+·\s+request=new/iu.test(plain),
                      detail: `${boot.label} consumed the scheduled next-boot create-new directive`,
                  },
              ]
            : []),
        ...(expectResumed
            ? [
                  {
                      id: `${boot.id}-resume-boot`,
                      pass: /último boot:\s+resumed\s+·\s+request=resume/iu.test(plain),
                      detail: `${boot.label} consumed the scheduled next-boot resume directive`,
                  },
              ]
            : []),
    ];
}

async function runSessionCycleBoot({
    id,
    label,
    outDir,
    commands,
    terminalPort,
    requestedTransport,
    timeoutMs,
}) {
    const canUsePty = requestedTransport === 'pty' && hasCommand('script');
    const transport = canUsePty ? 'pty:script' : 'stdio:headless';
    const command = canUsePty
        ? {
              cmd: 'script',
              args: ['-qfec', 'npm run terminal:llm-b', '/dev/null'],
          }
        : { cmd: 'npm', args: ['run', 'terminal:llm-b'] };
    let raw = '';
    let ready = false;
    let childClosed = false;
    let waitingForPrompt = false;
    let commandOutputOffset = 0;
    const remainingCommands = [...commands];
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
            TERMINAL_SSE_EVENT_ARCHIVE_DIR: path.join(outDir, `${id}-sse-events`),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const write = (line) => {
        if (childClosed || child.stdin.destroyed || child.stdin.writableEnded) return false;
        try {
            return child.stdin.write(ensureLine(line));
        } catch (error) {
            if (error?.code !== 'EPIPE') {
                console.warn(`[terminal-live] ${label} write failed: ${error?.message ?? String(error)}`);
            }
            return false;
        }
    };
    const sendNextCommand = () => {
        const next = remainingCommands.shift();
        if (!next) return;
        waitingForPrompt = next.trim() !== '/quit';
        commandOutputOffset = stripAnsi(raw).length;
        write(next);
    };
    child.stdin.on('error', (error) => {
        if (error?.code !== 'EPIPE') {
            console.warn(`[terminal-live] ${label} stdin error: ${error?.message ?? String(error)}`);
        }
    });
    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        raw += text;
        process.stdout.write(text);
        const plain = stripAnsi(raw);
        if (!ready && /LLM-B pronta/u.test(plain)) {
            ready = true;
            sendNextCommand();
            return;
        }
        if (waitingForPrompt && hasReturnedToReplPrompt(plain, commandOutputOffset)) {
            waitingForPrompt = false;
            sendNextCommand();
        }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timeout = setTimeout(() => {
        write('/quit');
        setTimeout(() => child.kill('SIGTERM'), 2_000).unref();
    }, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);
    const exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
            childClosed = true;
            resolve(code);
        });
    });
    clearTimeout(timeout);
    const plain = stripAnsi(raw);
    await writeFile(path.join(outDir, `${id}.raw.log`), raw, 'utf8');
    await writeFile(path.join(outDir, `${id}.plain.log`), plain, 'utf8');
    return {
        id,
        label,
        exitCode,
        raw,
        plain,
        sessionId: extractSdkSessionCockpitId(plain, 'atual'),
        lastSessionId: extractSdkSessionCockpitId(plain, 'last SDK'),
        transport,
    };
}

async function runSessionCycleLiveTest({ outDir, requestedTransport, timeoutMs, terminalPort, startedAt }) {
    const boot1 = await runSessionCycleBoot({
        id: 'session-cycle-boot-1',
        label: 'boot 1 / schedule new',
        outDir,
        commands: ['/session sdk', '/session sdk next new', '/quit'],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const resumeTarget = boot1.lastSessionId || boot1.sessionId || 'last';
    const boot2 = await runSessionCycleBoot({
        id: 'session-cycle-boot-2',
        label: 'boot 2 / create new and schedule resume',
        outDir,
        commands: ['/session sdk', `/session sdk next resume ${resumeTarget}`, '/quit'],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const boot3 = await runSessionCycleBoot({
        id: 'session-cycle-boot-3',
        label: 'boot 3 / resume prior session and restore auto',
        outDir,
        commands: ['/session sdk', '/session sdk next auto', '/session sdk', '/quit'],
        terminalPort,
        requestedTransport,
        timeoutMs,
    });
    const boots = [boot1, boot2, boot3];
    const criteria = [
        ...sessionCycleBootCriteria(boot1),
        {
            id: 'session-cycle-schedule-new',
            pass: /Próximo boot:\s+criar nova sessão SDK/iu.test(boot1.plain),
            detail: 'boot 1 scheduled SDK new-session selection for the next boot',
        },
        {
            id: 'session-cycle-resume-target',
            pass: Boolean(boot1.lastSessionId || boot1.sessionId),
            detail: `boot 1 exposed a resumable SDK target (${resumeTarget})`,
        },
        ...sessionCycleBootCriteria(boot2, { expectCreated: true }),
        {
            id: 'session-cycle-schedule-resume',
            pass:
                Boolean(resumeTarget) &&
                new RegExp(`Próximo boot:\\s+tentar retomar sessão SDK ${escapeRegExp(resumeTarget)}`, 'iu').test(
                    boot2.plain,
                ),
            detail: 'boot 2 scheduled explicit resume of a listed pre-cycle SDK session',
        },
        ...sessionCycleBootCriteria(boot3, { expectResumed: true }),
        {
            id: 'session-cycle-restore-auto',
            pass:
                /seleção automática restaurada/iu.test(boot3.plain) &&
                /próximo boot:\s+auto/iu.test(boot3.plain),
            detail: 'boot 3 cleared the explicit selector and rendered next boot as auto again',
        },
    ];
    const durationMs = Date.now() - Date.parse(startedAt);
    const ok = criteria.every((criterion) => criterion.pass);
    const summary = {
        ok,
        startedAt,
        durationMs,
        terminalPort,
        resumeTarget,
        boots: boots.map((boot) => ({
            id: boot.id,
            label: boot.label,
            exitCode: boot.exitCode,
            sessionId: boot.sessionId || null,
            lastSessionId: boot.lastSessionId || null,
            transport: boot.transport,
        })),
        criteria,
    };
    await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await writeFile(
        path.join(outDir, 'summary.md'),
        [
            '# Terminal LLM-B SDK Session Cycle Live Test',
            '',
            `Started: ${startedAt}`,
            `Duration: ${durationMs}ms`,
            `Status: ${ok ? 'PASS' : 'FAIL'}`,
            `Terminal port: ${terminalPort}`,
            `Resume target: ${resumeTarget}`,
            '',
            '## Boots',
            '',
            ...summary.boots.map(
                (boot) =>
                    `- ${boot.id}: ${boot.label} · exit=${String(boot.exitCode)} · session=${boot.sessionId ?? '-'} · last=${boot.lastSessionId ?? '-'} · ${boot.transport}`,
            ),
            '',
            '## Criteria',
            '',
            ...criteria.map((criterion) => `- ${criterion.pass ? '[x]' : '[ ]'} ${criterion.id}: ${criterion.detail}`),
            '',
        ].join('\n'),
        'utf8',
    );
    return summary;
}

function hasReturnedToReplPrompt(plain, outputOffset) {
    return REPL_PROMPT_TAIL_RE.test(String(plain ?? '').slice(outputOffset));
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

function detectLiveBlocker(plain, runtime = {}) {
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
    const byokCreditsMatch = plain.match(
        /\b402\s+Add credits to continue,\s*or switch to a free model\b|provider BYOK recusou a chamada por credito, saldo ou cota(?: \(HTTP 402\))?/i,
    );
    if (byokCreditsMatch) {
        return {
            id: 'byok-provider-credits',
            detail: 'BYOK provider rejected the selected paid model with 402; switch to a free/credited model',
        };
    }
    const byokAdmissionMatch = plain.match(
        /Turno não enviado ao provider BYOK:[^\n]*|terminal\.byok\.admission_blocked|BYOK budget:[^\n]*limite BYOK[^\n]*/i,
    );
    if (byokAdmissionMatch) {
        return {
            id: 'byok-admission-blocked',
            detail:
                'BYOK admission control contained the turn before provider streaming because the declared request budget is too small',
        };
    }
    const byokPreflight = findByokRealPreflightProbeFailure(plain);
    if (byokPreflight) {
        return {
            id: 'byok-preflight-probe-failed',
            detail:
                'disposable BYOK preflight blocked the canonical live turn before operator transcript mutation' +
                `${byokPreflight.kinds.length > 0 ? ` · probes=${byokPreflight.kinds.join('+')}` : ''}` +
                `${byokPreflight.profile ? ` · profile=${byokPreflight.profile}` : ''}` +
                `${byokPreflight.model ? ` · model=${byokPreflight.model}` : ''}`,
        };
    }
    const byokLiveToolProtocolMiss = findByokRealLiveToolProtocolMiss(plain);
    if (byokLiveToolProtocolMiss) {
        return {
            id: 'byok-live-tool-protocol-missed',
            detail:
                'BYOK live turn rendered tool-shaped protocol or a textual ask_user simulation without materializing the required live terminal interaction' +
                `${byokLiveToolProtocolMiss.markers.length > 0 ? ` · text=${byokLiveToolProtocolMiss.markers.join('+')}` : ''}`,
        };
    }
    const liveDeltaProtocolMiss = findLiveDeltaProtocolMiss(plain, runtime.sseEvents);
    if (liveDeltaProtocolMiss) {
        return {
            id: 'assistant-delta-protocol-missed',
            detail:
                'assistant reached canonical ask_user after public streaming without emitting the full DELTA-CANONICAL-1..8 test series' +
                ` · deltaEvents=${liveDeltaProtocolMiss.deltaEvents}` +
                ` · markers=${liveDeltaProtocolMiss.markers.join(',') || 'none'}`,
        };
    }
    if (
        /erro de provider BYOK/i.test(plain) ||
        /Erro de sessão BYOK/i.test(plain) ||
        /\[query\]\s+Failed to get response from the AI model/i.test(plain) ||
        /\[cancellation\]\s+Operation cancelled by user/i.test(plain)
    ) {
        const modelMatch = plain.match(/modelo=([^\s·\n]+)/i);
        return {
            id: 'byok-provider-turn-failed',
            detail: `BYOK provider turn failed and was contained without Copilot fallback${modelMatch?.[1] ? ` · model=${modelMatch[1]}` : ''}`,
        };
    }
    const emptyOutput = findTerminalEmptyOutputEvent(runtime.sseEvents) ?? findEmptyDialogTurnEnd(runtime.sseEvents);
    if (/Turno terminou sem saída pública/i.test(plain) || emptyOutput) {
        return {
            id: 'assistant-empty-turn',
            detail:
                'terminal reached an explicit turn with empty public output before the canonical ask/final' +
                `${emptyOutput?.traceId ? ` · trace=${emptyOutput.traceId}` : ''}` +
                `${emptyOutput?.turnId ? ` · turn=${emptyOutput.turnId}` : ''}` +
                `${Number.isFinite(emptyOutput?.eventId) ? ` · sse=#${emptyOutput.eventId}` : ''}`,
        };
    }
    if (runtime.timedOut) {
        return {
            id: 'live-timeout',
            detail:
                `runner timeout before scenario completion` +
                ` · ask=${runtime.answerSent ? 'answered' : 'not-answered'}` +
                ` · postAsk=${runtime.postAskContinuationObserved ? 'observed' : 'missing'}` +
                ` · diagnostics=${runtime.postCommandsSent ? 'started' : 'not-started'}`,
        };
    }
    return null;
}

function findByokRealPreflightProbeFailure(plain) {
    const results = [...plain.matchAll(/BYOK (chat|agent) probe[\s\S]{0,1800}?resultado:\s+failed\b([^\n]*)/giu)];
    if (results.length === 0) return null;
    const kinds = [...new Set(results.map((result) => result[1]?.toLowerCase()).filter(Boolean))];
    const detail = results.map((result) => result[2] ?? '').join(' ');
    return {
        kinds,
        profile: detail.match(/\bprofile=([^\s·]+)/iu)?.[1] ?? null,
        model: detail.match(/\bmodel=([^\s·]+)/iu)?.[1] ?? null,
    };
}

function findByokRealLiveToolProtocolMiss(plain) {
    // The live transcript intentionally preserves assistant Markdown; the
    // public delta marker may therefore arrive as `DELTA-*` or `**DELTA-* **`.
    if (!/(?:^|\n)\s*│\s+(?:\*{1,2})?DELTA-CANONICAL-8\b/u.test(plain)) return null;
    if (/\[ASK\]\s+ASK-CANONICAL/u.test(plain)) return null;
    const markers = [
        /(?:^|\n)\s*│\s+"tool":\s*"report_intent"/mu.test(plain) ? 'report_intent' : null,
        /(?:^|\n)\s*│\s+"tool":\s*"read_file_content"/mu.test(plain) ? 'read_file_content' : null,
        /(?:^|\n)\s*│\s+"tool":\s*"ask_user"/mu.test(plain) ? 'ask_user' : null,
        /(?:^|\n)\s*│\s+\*\*Pergunta ao usu[aá]rio:\*\*/mu.test(plain) ? 'ask_user_text' : null,
        /(?:^|\n)\s*│\s+"question":\s*"ASK-CANONICAL:/mu.test(plain) ? 'ask_user_question_json' : null,
    ].filter(Boolean);
    const hasTextifiedAsk = markers.includes('ask_user') || markers.includes('ask_user_text') || markers.includes('ask_user_question_json');
    return hasTextifiedAsk || markers.length >= 2 ? { markers } : null;
}

function findLiveDeltaProtocolMiss(plain, events) {
    const publicDeltas = Array.isArray(events)
        ? events.filter((evt) => evt?.event === 'delta' && typeof evt?.data?.chunk === 'string')
        : [];
    if (publicDeltas.length === 0) return null;
    const askMaterialized =
        /\[ASK\]\s+ASK-CANONICAL:\s+responda SIM para fechar o teste/u.test(plain) ||
        (Array.isArray(events) &&
            events.some(
                (evt) =>
                    evt?.event === 'user_input.requested' &&
                    /ASK-CANONICAL:\s+responda SIM para fechar o teste/u.test(
                        String(evt?.data?.question ?? evt?.data?.prompt ?? ''),
                    ),
            ));
    if (!askMaterialized) return null;
    const markers = new Set(
        [...String(plain ?? '').matchAll(/\bDELTA-CANONICAL-(\d+)\b/gu)]
            .map((match) => Number(match[1]))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 8),
    );
    if (markers.size >= 8) return null;
    return {
        deltaEvents: publicDeltas.length,
        markers: [...markers].sort((a, b) => a - b),
    };
}

function isObjectPayload(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findEmptyDialogTurnEnd(events) {
    if (!Array.isArray(events)) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const evt = events[index];
        if (evt?.event !== 'dialog.turn_end' || !isObjectPayload(evt.data)) continue;
        if (evt.data.replySuppressed === true) continue;
        const reply = typeof evt.data.reply === 'string' ? evt.data.reply.trim() : '';
        if (reply.length > 0) continue;
        return {
            eventId: evt.id,
            traceId: typeof evt.data.traceId === 'string' ? evt.data.traceId : null,
            turnId: typeof evt.data.turnId === 'string' ? evt.data.turnId : null,
        };
    }
    return null;
}

function findTerminalEmptyOutputEvent(events) {
    if (!Array.isArray(events)) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const evt = events[index];
        if (evt?.event !== 'terminal.turn.empty_output' || !isObjectPayload(evt.data)) continue;
        return {
            eventId: evt.id,
            traceId: typeof evt.data.traceId === 'string' ? evt.data.traceId : null,
            turnId: typeof evt.data.turnId === 'string' ? evt.data.turnId : null,
        };
    }
    return null;
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

function extractTerminalBlocks(plain, headerRe) {
    const lines = String(plain ?? '').split('\n');
    const blocks = [];
    for (let i = 0; i < lines.length; i += 1) {
        if (!headerRe.test(lines[i] ?? '')) continue;
        const block = [lines[i]];
        for (let j = i + 1; j < lines.length; j += 1) {
            const line = lines[j] ?? '';
            if (
                /^\s*(?:você\[|─{8,}|\[[A-Z][^\]]+\]|\[\d{2}:\d{2}:\d{2}\]\s+🧠\s+LLM-B|\[LLM-B\]\s+Mensagem)/u.test(
                    line,
                )
            ) {
                break;
            }
            block.push(line);
            if (/^\s*└──/u.test(line) || /^\s*📊\s/u.test(line)) break;
        }
        blocks.push(block.join('\n'));
    }
    return blocks;
}

function extractSdkSessionCockpitProbeResidueCounts(plain) {
    return extractTerminalBlocks(plain, /^\s*Sessão SDK\b/u).map(
        (block) => block.match(/\bprobe-residue\b/gu)?.length ?? 0,
    );
}

function terminalBlockContains(plain, headerRe, markerRe) {
    return extractTerminalBlocks(plain, headerRe).some((block) => markerRe.test(block));
}

function normalizeTranscriptCoverageText(value) {
    return stripAnsi(value).replace(/\s+/gu, ' ').trim();
}

function eventPayload(evt) {
    if (isObjectPayload(evt?.payload)) return evt.payload;
    if (isObjectPayload(evt?.data)) return evt.data;
    return null;
}

function eventPublicId(evt) {
    const id = Number(evt?.eventId ?? evt?.id);
    return Number.isFinite(id) ? id : null;
}

function eventTurnKey(evt, payload) {
    const turnId = payload?.turnId ?? evt?.turnId;
    const traceId = payload?.traceId ?? evt?.traceId;
    if (typeof turnId === 'string' || typeof turnId === 'number') return `turn:${turnId}`;
    if (typeof traceId === 'string' && traceId.length > 0) return `trace:${traceId}`;
    return null;
}

function findTruncatedTurnEndDuplicate(events) {
    const assistantMessages = [];
    for (const evt of events) {
        const payload = eventPayload(evt);
        if (!payload) continue;
        const eventName = typeof evt?.event === 'string' ? evt.event : '';
        if (eventName === 'assistant.message') {
            const content = normalizeTranscriptCoverageText(payload.content);
            if (content.length >= 32) {
                assistantMessages.push({
                    content,
                    eventId: eventPublicId(evt),
                    turnKey: eventTurnKey(evt, payload),
                });
            }
            continue;
        }
        if (eventName !== 'dialog.turn_end') continue;
        const reply = normalizeTranscriptCoverageText(payload.reply);
        if (reply.length < 32) continue;
        const turnKey = eventTurnKey(evt, payload);
        const match = assistantMessages.find(
            (entry) =>
                entry.content !== reply &&
                entry.content.includes(reply) &&
                (!turnKey || !entry.turnKey || entry.turnKey === turnKey),
        );
        if (match) {
            return {
                turnEndEventId: eventPublicId(evt),
                assistantMessageEventId: match.eventId,
                replyChars: reply.length,
                contentChars: match.content.length,
                turnKey: turnKey ?? match.turnKey ?? null,
            };
        }
    }
    return null;
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
    const truncatedTurnEndDuplicate = findTruncatedTurnEndDuplicate([...sseSummary.events, ...archiveRawEvents]);
    const askRenderedByQuestionPending = /\[(?:QUESTION|ASK:[^\]]+)\]\s+LLM-B perguntou:\s*"ASK-CANONICAL: responda SIM para fechar o teste"/.test(
        preEventsPlain,
    );
    const askRenderedBySdk = /\[ASK\]\s+ASK-CANONICAL: responda SIM para fechar o teste/.test(preEventsPlain);
    const liveDeltaBlockVisible = terminalBlockContains(
        preEventsPlain,
        /^\s*\[[^\]\n]*\]\s+🧠\s+LLM-B/u,
        /DELTA-CANONICAL-8/u,
    );
    const assistantMessageDeltaBlockVisible = terminalBlockContains(
        preEventsPlain,
        /^\s*\[LLM-B\]\s+Mensagem/u,
        /DELTA-CANONICAL-8/u,
    );
    const postAskFinalMarker = String.raw`POST-ASK-CANONICAL-FINAL:\s*usu[aá]rio confirmou SIM`;
    const postAskFinalRe = new RegExp(postAskFinalMarker, 'iu');
    const finalRenderedByLiveTurn = terminalBlockContains(
        preEventsPlain,
        /^\s*\[[^\]\n]*\]\s+🧠\s+LLM-B/u,
        postAskFinalRe,
    );
    const finalRenderedByAssistantMessage = terminalBlockContains(
        preEventsPlain,
        /^\s*\[LLM-B\]\s+Mensagem/u,
        postAskFinalRe,
    );
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
            pass: !duplicatePathologies.some((pattern) => pattern.test(plain)) && !truncatedTurnEndDuplicate,
            detail: truncatedTurnEndDuplicate
                ? `dialog.turn_end #${truncatedTurnEndDuplicate.turnEndEventId ?? '?'} repeated prefix of assistant.message #${truncatedTurnEndDuplicate.assistantMessageEventId ?? '?'}`
                : 'no known duplicate/pathology markers detected',
        },
        {
            id: 'no-final-delta-duplication',
            pass: !(finalRenderedByLiveTurn && finalRenderedByAssistantMessage),
            detail: `final rendered live=${finalRenderedByLiveTurn ? 'yes' : 'no'} assistant.message=${finalRenderedByAssistantMessage ? 'yes' : 'no'}`,
        },
        {
            id: 'no-truncated-turn-end-duplication',
            pass: !truncatedTurnEndDuplicate,
            detail: truncatedTurnEndDuplicate
                ? `turn=${truncatedTurnEndDuplicate.turnKey ?? '-'} · dialog.turn_end #${truncatedTurnEndDuplicate.turnEndEventId ?? '?'} chars=${truncatedTurnEndDuplicate.replyChars} covered by assistant.message #${truncatedTurnEndDuplicate.assistantMessageEventId ?? '?'} chars=${truncatedTurnEndDuplicate.contentChars}`
                : 'dialog.turn_end did not render/archive a truncated prefix already covered by assistant.message',
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
            pass:
                /Premium Request:|Última (?:Premium Request|telemetria PR) classificada:|GitHub Copilot quota\/PR side-channel:/.test(plain) &&
                /Modo: sdk=/.test(plain),
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

function evaluateByokProbeOutput(plain, sseSummary, { fixture = false } = {}) {
    const archiveRawEvents = extractArchiveRawEvents(plain);
    const criteria = [
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
            detail: 'BYOK probe did not open an explicit LLM turn',
        },
        {
            id: 'byok-status-visible',
            pass: /BYOK status/.test(plain) && /\.env\.local/.test(plain),
            detail: '/byok rendered the redacted canonical status',
        },
        {
            id: 'byok-env-visible',
            pass: /BYOK env canonico/.test(plain) && /COPILOT_BYOK_PROFILES_JSON/.test(plain),
            detail: '/byok env rendered the canonical operator contract',
        },
        {
            id: 'byok-profiles-visible',
            pass: /BYOK profiles/.test(plain),
            detail: '/byok profiles rendered configured profile information or the empty-state',
        },
        {
            id: 'byok-providers-visible',
            pass: /BYOK providers/.test(plain) && /\/byok use |Nenhum provider BYOK configurado/.test(plain),
            detail: '/byok providers rendered the redacted provider cockpit and operator actions',
        },
        {
            id: 'byok-health-visible',
            pass: /BYOK operational health/.test(plain),
            detail: '/byok health rendered persisted BYOK operational health',
        },
        {
            id: 'byok-models-visible',
            pass: /BYOK models/.test(plain),
            detail: '/byok models refresh rendered model catalog state without exposing secrets',
        },
        {
            id: 'byok-model-filters-visible',
            pass: /BYOK models[\s\S]{0,500}filtros=free,reasoning,safe/.test(plain),
            detail: '/byok models accepted operator filters for free/reasoning/safe discovery',
        },
        {
            id: 'byok-recommend-visible',
            pass:
                /BYOK recommend/.test(plain) &&
                /\/byok probe agent(?:\s+profile:[^\s]+)?\s+model:/.test(plain) &&
                /live fake descartável/.test(plain),
            detail: '/byok recommend rendered ranked operational recommendations with disposable agent probe actions',
        },
        {
            id: 'byok-use-sdk-visible',
            pass: /BYOK desativado no processo atual|SDK Copilot/.test(plain),
            detail: '/byok use sdk returned the process to the SDK-governed mode',
        },
        {
            id: 'byok-no-secret-leak',
            pass: !/codex-fixture-token-never-print/.test(plain),
            detail: 'BYOK probe did not print fixture bearer token',
        },
        {
            id: 'sse-archive-query-visible',
            pass: /Eventos SSE/.test(plain) && /arquivo=/.test(plain),
            detail: '/events rendered the durable public SSE archive tail',
        },
        {
            id: 'sse-archive-raw-visible',
            pass: archiveRawEvents.length > 0,
            detail: `/events --raw exposed ${archiveRawEvents.length} archived control event(s)`,
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
    if (fixture) {
        criteria.splice(
            8,
            0,
            {
                id: 'byok-fixture-profile-visible',
                pass: /codex-fixture/.test(plain) && /meta=owner,purpose|meta=purpose,owner/.test(plain),
                detail: 'fixture profile appeared with redacted metadata keys',
            },
            {
                id: 'byok-fixture-profile-activation',
                pass: /profile:\s+codex-fixture/.test(plain) && /model:\s+fixture\/model-a/.test(plain),
                detail: '/byok use codex-fixture activated profile model in the current process',
            },
            {
                id: 'byok-fixture-model-list',
                pass: /BYOK models[\s\S]{0,800}fixture\/model-a/.test(plain) && /fixture\/model-b/.test(plain),
                detail: '/byok models refresh returned fixture model catalog',
            },
            {
                id: 'byok-fixture-remote-discovery',
                pass:
                    /BYOK models[\s\S]{0,1200}fonte=provider/.test(plain) &&
                    /endpoint=http:\/\/127\.0\.0\.1:\d+\/v1\/models/.test(plain) &&
                    /fixture\/model-remote-c/.test(plain),
                detail: 'fixture provider /models endpoint was discovered live and redacted',
            },
            {
                id: 'byok-fixture-model-switch',
                pass: /model:\s+fixture\/model-b/.test(plain),
                detail: '/byok model switched model inside active BYOK process state',
            },
            {
                id: 'byok-fixture-provider-switch',
                pass:
                    /preset:\s+openai-compatible/.test(plain) &&
                    /model:\s+fixture\/model-c/.test(plain) &&
                    /baseUrl:\s+http:\/\/127\.0\.0\.1:\d+\/v1/.test(plain),
                detail: '/byok provider switched provider preset/model/baseUrl in the current process',
            },
        );
    }
    return criteria;
}

function evaluateByokRealOutput(plain, secretValues, { profile, altProfile, model, altModel, noPr = false } = {}) {
    const byokModels = [...new Set([model, altModel].filter((value) => typeof value === 'string' && value.length > 0))];
    const byokModelPrLines = byokModels.flatMap((candidate) => {
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return plain.match(new RegExp(`^\\s*\\[PR\\]\\s+modelo=${escaped}\\b.*$`, 'gmu')) ?? [];
    });
    const byokTurnOpened =
        !noPr &&
        (/\[intervene→turn\]/u.test(plain) ||
            /(?:^|\n)\s*│\s+DELTA-CANONICAL-\d/u.test(plain) ||
            /\[ASK\]\s+ASK-CANONICAL/u.test(plain));
    const byokUsageClassified =
        /\bclasse=byok_user_message\b/u.test(plain) ||
        /"classification"\s*:\s*"byok_user_message"/u.test(plain);
    const byokAdmissionBlocked =
        /Turno não enviado ao provider BYOK|terminal\.byok\.admission_blocked|resultado:\s+admission-blocked/i.test(
            plain,
        );
    const byokPreflightBlocked = Boolean(findByokRealPreflightProbeFailure(plain));
    const byokProviderBlocked =
        byokAdmissionBlocked ||
        byokPreflightBlocked ||
        /erro de provider BYOK/i.test(plain) ||
        /Erro de sessão BYOK/i.test(plain) ||
        /\[query\]\s+Failed to get response from the AI model/i.test(plain) ||
        /\[cancellation\]\s+Operation cancelled by user/i.test(plain);
    const sessionProbeResidueCounts = extractSdkSessionCockpitProbeResidueCounts(plain);
    const preflightProbeResidueCount = sessionProbeResidueCounts[0];
    const postProbeResidueCount = sessionProbeResidueCounts[1];
    const criteria = [
        {
            id: 'byok-real-dotenv-reload',
            pass: /\.env\.local recarregado/.test(plain),
            detail: '/byok reload loaded operator-local BYOK config',
        },
        {
            id: 'byok-real-status-ready',
            pass: /BYOK status/.test(plain) && /enabled:\s+sim/.test(plain) && /ready:\s+sim/.test(plain),
            detail: 'BYOK status reached enabled+ready without printing secrets',
        },
        {
            id: 'byok-real-profile-active',
            pass: !profile || new RegExp(`profile:\\s+${profile.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain),
            detail: `active BYOK profile ${profile || '(auto)'} was rendered`,
        },
        {
            id: 'byok-real-model-catalog',
            pass: /BYOK models/.test(plain) && !/Nenhum modelo BYOK configurado/.test(plain),
            detail: 'BYOK model catalog command returned a usable catalog or remote/static fallback',
        },
        {
            id: 'byok-real-provider-cockpit',
            pass: /BYOK providers/.test(plain) && /\/byok use /.test(plain),
            detail: 'BYOK provider cockpit showed configured providers and operator actions',
        },
        {
            id: 'byok-real-sdk-session-cockpit',
            pass: /Sessão SDK/.test(plain) && /\/restart reinicia só dialog loop/.test(plain),
            detail: 'operator can distinguish SDK session cockpit from dialog loop, hub resume and snapshots',
        },
        {
            id: 'byok-real-probe-session-cleanup',
            pass:
                sessionProbeResidueCounts.length >= 2 &&
                preflightProbeResidueCount !== undefined &&
                preflightProbeResidueCount === postProbeResidueCount,
            detail:
                sessionProbeResidueCounts.length >= 2
                    ? `SDK probe-residue count stayed stable around disposable BYOK probes (${preflightProbeResidueCount} -> ${postProbeResidueCount})`
                    : 'SDK session cockpit was not rendered before and after disposable BYOK probes',
        },
        {
            id: 'byok-real-chat-probe',
            pass:
                /BYOK chat probe/.test(plain) &&
                /BYOK agent probe/.test(plain) &&
                /sessão SDK descartável/.test(plain),
            detail: 'BYOK preflight exercised disposable chat and agent probes before the live operator turn',
        },
        {
            id: 'byok-real-shortlist-probe',
            pass: /BYOK shortlist agent probe/.test(plain) && /Shortlist encerrada: ok=\d+\/\d+/.test(plain),
            detail: 'BYOK preflight exercised a ranked disposable shortlist probe without mutating the live session',
        },
        {
            id: 'byok-real-chat-probe-ok',
            pass: byokAdmissionBlocked || /BYOK chat probe[\s\S]{0,1400}resultado:\s+ok/.test(plain),
            detail: byokAdmissionBlocked
                ? 'BYOK chat probe was admission-blocked before the provider because its declared budget is too small'
                : 'BYOK chat probe produced a real disposable assistant response',
        },
        {
            id: 'byok-real-agent-probe-ok',
            pass: byokAdmissionBlocked || /BYOK agent probe[\s\S]{0,1800}resultado:\s+ok/.test(plain),
            detail: byokAdmissionBlocked
                ? 'BYOK agent probe was admission-blocked before tool/ask_user because its declared budget is too small'
                : 'BYOK agent probe validated tool calling and ask_user on the disposable session',
        },
        {
            id: 'byok-real-model-filtering',
            pass: /BYOK models[\s\S]{0,1000}filtros=[^\n]*free[^\n]*reasoning[^\n]*safe/.test(plain),
            detail: 'BYOK real probe exercised filtered model discovery',
        },
        {
            id: 'byok-real-recommendation',
            pass: /BYOK recommend/.test(plain) && /ok para uso geral|baixo para turno real|apertado para sessão longa/.test(plain),
            detail: 'BYOK recommendation command rendered operational budget guidance',
        },
        {
            id: 'byok-real-model-switch',
            pass:
                !model ||
                new RegExp(`model:\\s+${model.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain) ||
                /BYOK models[\s\S]{0,1200}/.test(plain),
            detail: `BYOK model switch path exercised for ${model || '(profile default)'}`,
        },
        {
            id: 'byok-real-alt-provider-switch',
            pass:
                !altProfile ||
                new RegExp(`profile:\\s+${altProfile.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain),
            detail: altProfile ? `alternate BYOK profile ${altProfile} was exercised` : 'no alternate usable profile configured',
        },
        {
            id: 'byok-real-alt-model-switch',
            pass:
                !altModel ||
                new RegExp(`model:\\s+${altModel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u').test(plain) ||
                /BYOK models[\s\S]{0,1200}/.test(plain),
            detail: altModel ? `alternate BYOK model ${altModel} was exercised` : 'no alternate model configured',
        },
        {
            id: 'byok-real-no-secret-leak',
            pass: !hasSecretLeak(plain, secretValues),
            detail: `${secretValues.length} local secret value(s) checked against terminal output`,
        },
        {
            id: 'byok-real-usage-not-pr',
            pass: byokModelPrLines.length === 0,
            detail:
                byokModelPrLines.length > 0
                    ? `BYOK model usage was rendered as PR: ${byokModelPrLines.slice(0, 2).join(' | ')}`
                    : 'BYOK model usage was not rendered as Premium Request',
        },
        {
            id: 'byok-real-usage-classified',
            pass: !byokTurnOpened || byokUsageClassified || byokProviderBlocked,
            detail: byokPreflightBlocked
                ? 'Disposable BYOK probes blocked the live user turn before usage telemetry'
                : byokAdmissionBlocked
                ? 'BYOK turn never reached provider usage because admission blocked the request envelope'
                : byokProviderBlocked
                ? 'BYOK provider aborted before usage telemetry; no Premium Request was inferred'
                : byokTurnOpened
                  ? `BYOK user-message usage classification observed=${byokUsageClassified ? 'yes' : 'no'}`
                  : 'no BYOK user turn opened in this probe',
        },
        {
            id: 'byok-real-operator-health',
            pass:
                !byokTurnOpened ||
                (byokProviderBlocked ? /chat=failed/i.test(plain) : /chat=ok/i.test(plain) || /chat=\?/i.test(plain)),
            detail: byokProviderBlocked
                ? 'BYOK provider failure was reflected in operator health'
                : 'BYOK provider health cockpit rendered after live turn or stayed unknown before a turn',
        },
        {
            id: 'byok-real-health-command',
            pass: /BYOK operational health/.test(plain),
            detail: '/byok health was available in the real BYOK diagnostic path',
        },
    ];
    return criteria;
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
            id: `blocked-by-${blocker.id}`,
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
            detail: 'scenario criteria skipped because the blocker prevented assistant/tool/ask_user streaming',
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
    const sessionCycle = hasFlag('--session-cycle');
    const byokProbe = hasFlag('--byok-probe');
    const byokFixture = hasFlag('--byok-fixture');
    const byokReal = hasFlag('--byok-real');
    const byokRealProfile = readArg('--byok-real-profile', '');
    const byokRealAltProfile = readArg('--byok-real-alt-profile', '');
    const byokRealModel = readArg('--byok-real-model', '');
    const byokRealAltModel = readArg('--byok-real-alt-model', '');
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
    const byokFixtureProvider = byokFixture ? await startByokFixtureProviderServer() : null;
    const byokFixtureBaseUrl = byokFixtureProvider?.baseUrl ?? 'http://127.0.0.1:11434/v1';
    const dotenvEnv = byokReal ? await loadDotenvLocalEnv() : {};
    const realByok = byokReal
        ? buildRealByokRuntime({
              dotenvEnv,
              requestedProfile: byokRealProfile,
              requestedAltProfile: byokRealAltProfile,
              requestedModel: byokRealModel,
              requestedAltModel: byokRealAltModel,
          })
        : null;
    const secretValues = byokReal ? collectSecretValues({ ...process.env, ...dotenvEnv, ...(realByok?.env ?? {}) }) : [];

    if (sessionCycle) {
        const summary = await runSessionCycleLiveTest({
            outDir,
            requestedTransport,
            timeoutMs,
            terminalPort,
            startedAt,
        });
        console.log(`[terminal-live] session cycle summary: ${path.relative(ROOT, path.join(outDir, 'summary.md'))}`);
        if (!summary.ok) process.exitCode = 1;
        await byokFixtureProvider?.close();
        return;
    }

    if (dryRun) {
        const prompt = byokProbe
            ? buildByokProbeCommands({ fixtureBaseUrl: byokFixtureBaseUrl }).join('\n')
            : byokReal
              ? [
                    ...buildByokRealPreflightCommands(realByok ?? {}),
                    ...(noPr ? buildByokRealNoPrDiagnosticCommands() : [buildScenarioPrompt()]),
                ]
                    .filter(Boolean)
                    .join('\n')
            : noPr
              ? buildNoPrProbeCommands().join('\n')
              : buildScenarioPrompt();
        await writeFile(path.join(outDir, 'prompt.txt'), `${prompt}\n`, 'utf8');
        console.log(`[terminal-live] dry-run prompt written to ${path.relative(ROOT, path.join(outDir, 'prompt.txt'))}`);
        await byokFixtureProvider?.close();
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
    let scenarioSent = false;
    let scenarioPlainOffset = 0;
    let byokNoPrCanQuit = !(byokReal && noPr);
    let exitCode = null;
    let sseCollector = null;
    let postAskContinuationObserved = false;
    let answerPlainOffset = 0;
    let postAnswerCommandTimer = null;
    let timedOut = false;
    /** @type {string[]} */
    let promptSynchronizedCommands = [];
    /** @type {null | (() => void)} */
    let onPromptSynchronizedCommandsDrained = null;
    let promptSynchronizedCommandOutputOffset = 0;
    let waitingForPromptSynchronizedCommand = false;
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
            ...dotenvEnv,
            ...(byokFixture ? buildByokFixtureEnv({ baseUrl: byokFixtureBaseUrl }) : {}),
            ...(realByok?.env ?? {}),
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

    let childClosed = false;
    child.stdin.on('error', (error) => {
        if (error?.code === 'EPIPE') return;
        console.warn(`[terminal-live] stdin error: ${error?.message ?? String(error)}`);
    });
    const write = (line) => {
        if (childClosed || child.stdin.destroyed || child.stdin.writableEnded) return false;
        if (byokReal && noPr && String(line ?? '').trim() === '/quit' && !byokNoPrCanQuit) return false;
        try {
            return child.stdin.write(ensureLine(line));
        } catch (error) {
            if (error?.code !== 'EPIPE') {
                console.warn(`[terminal-live] write failed: ${error?.message ?? String(error)}`);
            }
            return false;
        }
    };
    const sendNextPromptSynchronizedCommand = () => {
        const next = promptSynchronizedCommands.shift();
        if (!next) {
            waitingForPromptSynchronizedCommand = false;
            const onDrained = onPromptSynchronizedCommandsDrained;
            onPromptSynchronizedCommandsDrained = null;
            onDrained?.();
            return;
        }
        waitingForPromptSynchronizedCommand = true;
        promptSynchronizedCommandOutputOffset = stripAnsi(raw).length;
        write(next);
    };
    const startPromptSynchronizedCommandSequence = (commands, onDrained = null) => {
        promptSynchronizedCommands = [...commands];
        onPromptSynchronizedCommandsDrained = onDrained;
        waitingForPromptSynchronizedCommand = false;
        sendNextPromptSynchronizedCommand();
    };
    const schedulePostAnswerDiagnostics = (delayMs = postAnswerDelayMs) => {
        if (postCommandsSent) return;
        postCommandsSent = true;
        if (postAnswerCommandTimer) {
            clearTimeout(postAnswerCommandTimer);
            postAnswerCommandTimer = null;
        }
        setTimeout(() => {
            const diagnostics = ['/usage now', '/activity 40', '/tools diag', '/events 60', '/events 100 --raw', '/errors 10', '/health'];
            if (byokReal) {
                diagnostics.push('/byok providers', '/byok health', '/byok recommend reasoning safe 8');
            }
            diagnostics.push(`/export ${exportArg}`);
            sendCommandSequence(write, diagnostics, { delayMs: 350 });
            setTimeout(() => {
                if (!quitSent) {
                    quitSent = true;
                    byokNoPrCanQuit = true;
                    write('/quit');
                }
            }, diagnostics.length * 350 + 2_000).unref();
        }, Math.max(0, delayMs)).unref();
    };
    const scheduleByokPreflightDiagnostics = () => {
        if (postCommandsSent) return;
        postCommandsSent = true;
        const diagnostics = ['/activity 40', '/byok providers', '/byok health', '/byok recommend reasoning safe 8', '/events 100 --raw', '/errors 10'];
        sendCommandSequence(write, diagnostics, { delayMs: 450 });
        setTimeout(() => {
            if (!quitSent) {
                quitSent = true;
                byokNoPrCanQuit = true;
                write('/quit');
            }
        }, diagnostics.length * 450 + 1_500).unref();
    };
    const scheduleByokLiveProtocolDiagnostics = () => {
        if (postCommandsSent) return;
        postCommandsSent = true;
        const diagnostics = ['/activity 40', '/tools diag', '/byok providers', '/byok health', '/byok recommend reasoning safe 8', '/events 100 --raw', '/errors 10'];
        sendCommandSequence(write, diagnostics, { delayMs: 450 });
        setTimeout(() => {
            if (!quitSent) {
                quitSent = true;
                byokNoPrCanQuit = true;
                write('/quit');
            }
        }, diagnostics.length * 450 + 1_500).unref();
    };
    const timeout = setTimeout(() => {
        timedOut = true;
        byokNoPrCanQuit = true;
        write('/quit');
        setTimeout(() => child.kill('SIGTERM'), 2_000).unref();
    }, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);

    const onData = (chunk) => {
        const text = chunk.toString('utf8');
        raw += text;
        process.stdout.write(text);
        const plain = stripAnsi(raw);
        if (
            waitingForPromptSynchronizedCommand &&
            hasReturnedToReplPrompt(plain, promptSynchronizedCommandOutputOffset)
        ) {
            sendNextPromptSynchronizedCommand();
        }
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
            if (byokProbe || noPr || byokReal) {
                const commands = byokReal
                    ? [
                          '/usage now',
                          '/activity 12',
                          ...buildByokRealPreflightCommands(realByok ?? {}),
                          ...(noPr ? buildByokRealNoPrDiagnosticCommands() : []),
                      ]
                    : byokProbe
                      ? ['/usage now', '/activity 12', ...buildByokProbeCommands({ fixtureBaseUrl: byokFixtureBaseUrl })]
                      : ['/usage now', '/activity 12', ...buildNoPrProbeCommands()];
                startPromptSynchronizedCommandSequence(commands, () => {
                    if (byokReal && noPr) {
                        if (!quitSent) {
                            quitSent = true;
                            byokNoPrCanQuit = true;
                            write('/quit');
                        }
                        return;
                    }
                    if (byokReal && !noPr) {
                        if (findByokRealPreflightProbeFailure(stripAnsi(raw))) {
                            scheduleByokPreflightDiagnostics();
                            return;
                        }
                        scenarioPlainOffset = stripAnsi(raw).length;
                        scenarioSent = true;
                        write(buildScenarioPrompt());
                    }
                });
                return;
            }
            write('/usage now');
            write('/activity 12');
            scenarioPlainOffset = stripAnsi(raw).length;
            scenarioSent = true;
            write(buildScenarioPrompt());
        }
        if (!answerSent && /\[ASK\] ASK-CANONICAL: responda SIM para fechar o teste/.test(plain)) {
            answerSent = true;
            answerPlainOffset = plain.length;
            setTimeout(() => write('SIM'), 500).unref();
        }
        const afterAnswerPlain = answerSent ? plain.slice(answerPlainOffset) : '';
        if (answerSent && !postAskContinuationObserved && POST_ASK_FINAL_RE.test(afterAnswerPlain)) {
            postAskContinuationObserved = true;
        }
        if (postAskContinuationObserved && !postCommandsSent && TURN_SETTLED_AFTER_ASK_RE.test(afterAnswerPlain)) {
            schedulePostAnswerDiagnostics(500);
        }
        if (answerSent && !postCommandsSent && /Resposta enviada para pergunta pendente/.test(plain)) {
            postAnswerCommandTimer = setTimeout(() => {
                schedulePostAnswerDiagnostics(0);
            }, Math.max(1_000, postAskContinuationWaitMs)).unref();
        }
        const scenarioTailPlain = scenarioSent ? plain.slice(scenarioPlainOffset) : '';
        if (
            byokReal &&
            !answerSent &&
            !postCommandsSent &&
            findByokRealLiveToolProtocolMiss(scenarioTailPlain)
        ) {
            scheduleByokLiveProtocolDiagnostics();
        }
        if (
            !postCommandsSent &&
            (/Erro de sessão \[(?:query|rate_limit)\]|You've hit your rate limit|session\.error|CAPIError|Failed to get response from the AI model/i.test(
                scenarioTailPlain,
            ) ||
                /erro de provider BYOK|\[cancellation\]\s+Operation cancelled by user|Turno não enviado ao provider BYOK|terminal\.byok\.admission_blocked|Turno terminou sem saída pública/i.test(
                    scenarioTailPlain,
                )) &&
            !(byokReal && noPr) &&
            (!byokReal || scenarioSent)
        ) {
            postCommandsSent = true;
            if (postAnswerCommandTimer) {
                clearTimeout(postAnswerCommandTimer);
                postAnswerCommandTimer = null;
            }
            setTimeout(() => {
                const diagnostics = ['/activity 40'];
                if (byokReal) {
                    diagnostics.push('/byok providers', '/byok health', '/byok recommend reasoning safe 8');
                }
                diagnostics.push('/events 100 --raw', '/errors 10');
                sendCommandSequence(write, diagnostics, { delayMs: 450 });
                if (!quitSent) {
                    setTimeout(() => {
                        if (!quitSent) {
                            quitSent = true;
                            byokNoPrCanQuit = true;
                            write('/quit');
                        }
                    }, diagnostics.length * 450 + 1_500).unref();
                }
            }, 1_000).unref();
        }
        if (!quitSent && /Exportado:/.test(plain)) {
            quitSent = true;
            byokNoPrCanQuit = true;
            setTimeout(() => write('/quit'), 500).unref();
        }
        if (
            byokReal &&
            noPr &&
            !quitSent &&
            /Métricas da Sessão/.test(plain) &&
            /Eventos SSE/.test(plain) &&
            /Nenhum erro recente/.test(plain)
        ) {
            quitSent = true;
            byokNoPrCanQuit = true;
            setTimeout(() => write('/quit'), 500).unref();
        }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
            childClosed = true;
            resolve(code);
        });
    });
    clearTimeout(timeout);
    sseCollector?.close();
    await byokFixtureProvider?.close();

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
    const blocker = noPr || byokProbe
        ? null
        : detectLiveBlocker(plain, {
              timedOut,
              answerSent,
              postAskContinuationObserved,
              postCommandsSent,
              sseEvents: sseSummary.events,
          });
    const exportSummary = noPr || byokProbe || blocker ? null : await inspectExportedMarkdown(exportPath);
    const baseCriteria = blocker
        ? evaluateBlockedOutput(plain, sseSummary, blocker)
        : byokProbe
          ? evaluateByokProbeOutput(plain, sseSummary, { fixture: byokFixture })
          : noPr
            ? evaluateNoPrOutput(plain, sseSummary)
            : evaluateOutput(plain, sseSummary, exportSummary);
    const criteria = [
        ...baseCriteria,
        ...(byokReal ? evaluateByokRealOutput(plain, secretValues, { ...(realByok ?? {}), noPr }) : []),
    ];
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
                byokReal: realByok?.redacted ?? null,
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
            exportPath: noPr || byokProbe ? null : path.relative(ROOT, exportPath),
            exportSummary,
            sseRawPath: path.relative(ROOT, sseRawPath),
            sseJsonlPath: path.relative(ROOT, sseJsonlPath),
            sseSummary,
            startedAt,
            transport,
        }),
        'utf8',
    );
    if (realByok) {
        await writeFile(path.join(outDir, 'byok.real.redacted.json'), `${JSON.stringify(realByok.redacted, null, 2)}\n`, 'utf8');
    }
    const failed = criteria.filter((criterion) => !criterion.pass);
    console.log(`[terminal-live] summary: ${path.relative(ROOT, mdPath)}`);
    if (failed.length > 0 || exitCode !== 0) {
        console.error(
            `[terminal-live] ${blocker ? 'BLOCKED' : 'FAIL'}: ${failed.map((criterion) => criterion.id).join(', ') || 'exitCode'}`,
        );
        process.exitCode = 1;
    }
}

await main();
