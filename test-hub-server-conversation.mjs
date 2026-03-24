/**
 * test-hub-server-conversation.mjs
 *
 * Testa a conversa LLM-A ↔ LLM-B via servidor HTTP (meio "oficial"). Fluxo:
 *
 * 1. Inicia o servidor Express como subprocesso (COPILOT_SDK_ENABLED=true)
 * 2. Aguarda server + auto-start do AlwaysAliveAgent
 * 3. POST /api/copilot/dialog/start — inicia dialog loop
 * 4. POST /api/hub/sessions — cria hub session
 * 5. POST /api/hub/sessions/:id/send — multi-turn conversation
 * 6. GET /api/hub/sessions/:id/turns — verifica histórico
 * 7. Encerra tudo graciosamente
 *
 * USO: node test-hub-server-conversation.mjs
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = 3008;
const BASE = `http://localhost:${PORT}`;

// ── Utilidade HTTP simplificada (sem dependências externas) ─────────────────

/**
 * @param {'GET' | 'POST'} method
 * @param {string} path
 * @param {object} [body]
 * @returns {Promise<{ status: number; body: any }>}
 */
async function req(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const payload = body ? JSON.stringify(body) : undefined;
        const options = {
            hostname: url.hostname,
            port: parseInt(url.port),
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        };
        const httpReq = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode ?? 0, body: data });
                }
            });
        });
        httpReq.on('error', reject);
        if (payload) httpReq.write(payload);
        httpReq.end();
    });
}

// ── Helpers de log ──────────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    gray: '\x1b[90m',
};

const step = (n, msg) => console.log(`\n${c.blue}${c.bold}[STEP ${n}]${c.reset} ${msg}`);
const ok = (msg) => console.log(`${c.green}  ✅ ${msg}${c.reset}`);
const info = (msg) => console.log(`${c.gray}  ℹ️  ${msg}${c.reset}`);
const llmA = (msg) => console.log(`\n${c.cyan}  LLM-A →${c.reset} ${msg}`);
const llmB = (msg) => console.log(`\n${c.yellow}  LLM-B ←${c.reset} ${msg}`);
const logErr = (msg) => console.error(`${c.red}  ❌ ${msg}${c.reset}`);

// ── Tópicos da conversa ──────────────────────────────────────────────────────
const CONVERSATION_TURNS = [
    'Você é LLM-B (GitHub Copilot), eu sou LLM-A. Esta é nossa primeira sessão oficial via ConversationHub. Em uma frase: qual sua principal vantagem em projetos Node.js?',

    'Certo. Em uma frase: qual padrão recomendas para filas assíncronas em Node.js 24+?',

    'Este sistema usa NERV (event bus central). Em uma frase: como isso afeta a testabilidade dos módulos?',

    'Última questão: em uma frase, qual seria sua sugestão principal de resiliência para o AlwaysAliveAgent?',
];

// ── Processo do servidor ─────────────────────────────────────────────────────
let serverProcess = null;
let _serverOutput = '';

function startServerProcess() {
    step(1, `Iniciando servidor Express como subprocesso (porta ${PORT})...`);
    return new Promise((resolve, reject) => {
        serverProcess = spawn('node', ['src/server/main.js'], {
            env: {
                ...process.env,
                COPILOT_SDK_ENABLED: 'true',
                COPILOT_AGENT_AUTOSTART: 'true',
                LOG_LEVEL: 'INFO',
                NODE_ENV: 'development',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        serverProcess.stdout?.on('data', (d) => {
            const s = d.toString();
            _serverOutput += s;
            // Mostrar logs relevantes do servidor
            if (
                s.includes('COPILOT') ||
                s.includes('AlwaysAlive') ||
                s.includes('ConversationHub') ||
                s.includes('BOOT')
            ) {
                process.stdout.write(`${c.gray}  [SERVER] ${s.trim()}${c.reset}\n`);
            }
        });
        serverProcess.stderr?.on('data', (d) => {
            const s = d.toString();
            _serverOutput += s;
            if (!s.includes('ExperimentalWarning') && !s.includes('node:')) {
                process.stderr.write(`${c.gray}  [SERVER ERR] ${s.trim()}${c.reset}\n`);
            }
        });
        serverProcess.on('error', reject);
        serverProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                reject(new Error(`Servidor encerrou inesperadamente (code=${code})`));
            }
        });

        // Aguardar o servidor responder
        let attempts = 0;
        const poll = async () => {
            try {
                const r = await req('GET', '/api/copilot/health');
                if (r.status < 600) {
                    ok(`Servidor ativo na porta ${PORT} (HTTP ${r.status})`);
                    resolve(serverProcess);
                    return;
                }
            } catch {
                /* ainda subindo */
            }
            attempts++;
            if (attempts >= 25) {
                reject(new Error(`Servidor não respondeu após ${attempts * 1.2}s`));
                return;
            }
            setTimeout(poll, 1200);
        };
        setTimeout(poll, 2000); // aguarda 2s inicial para cold start
    });
}

async function waitForAgentReady() {
    step(2, 'Aguardando AlwaysAliveAgent ficar ativo...');

    // Verificar status primeiro — se já foi iniciado (autostart), aguardar `idle`
    // Se ainda `stopped`, tentar iniciar via API
    let currentStatus = 'unknown';
    try {
        const r = await req('GET', '/api/copilot/status');
        currentStatus = r.body?.status ?? 'unknown';
    } catch {
        /* ignore */
    }

    if (currentStatus === 'stopped') {
        // Se autostart falhou, tentar iniciar via API
        info('Autostart não funcionou — chamando POST /api/copilot/start explicitamente...');
        try {
            const startR = await req('POST', '/api/copilot/start');
            if (startR.status === 200 && startR.body?.ok) {
                info(`Agente iniciado via /start: status=${startR.body.status ?? 'iniciando'}`);
            } else {
                info(`/start respondeu: HTTP ${startR.status} — ${JSON.stringify(startR.body).slice(0, 100)}`);
            }
        } catch (/** @type {any} */ e) {
            info(`/start falhou: ${e.message}`);
        }
    }

    // Aguardar agente atingir status `idle` (não apenas != stopped)
    for (let i = 0; i < 40; i++) {
        try {
            const r = await req('GET', '/api/copilot/status');
            const s = r.body?.status;
            if (r.status === 200 && s === 'idle') {
                ok(`Agente ativo: status=idle, sessionId=${r.body.sessionId ?? 'n/a'}`);
                return r.body;
            }
            if (s === 'error') throw new Error(`AlwaysAliveAgent entrou em estado 'error'`);
            info(`Aguardando idle... status=${s ?? '?'} (${i + 1}/40)`);
        } catch (/** @type {any} */ e) {
            if (e.message.startsWith('AlwaysAlive')) throw e;
            /* retry */
        }
        await sleep(1000);
    }
    throw new Error('AlwaysAliveAgent não ficou idle em 40s');
}

async function startDialogLoop() {
    step(3, 'Iniciando Dialog Loop via POST /api/copilot/dialog/start...');
    const r = await req('POST', '/api/copilot/dialog/start', { bootPrompt: null });
    if (r.status !== 200) throw new Error(`dialog/start falhou: HTTP ${r.status} — ${JSON.stringify(r.body)}`);
    ok('Dialog Loop iniciado — aguardando 4s para dialog.ready...');
    await sleep(4000);
}

async function createHubSession() {
    step(4, 'Criando Hub Session via POST /api/hub/sessions...');
    const title = `Conversa Oficial LLM-A ↔ LLM-B — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const r = await req('POST', '/api/hub/sessions', { title });
    if (r.status !== 201)
        throw new Error(`POST /api/hub/sessions falhou: HTTP ${r.status} — ${JSON.stringify(r.body)}`);
    const sessionId = r.body.session?.hubSessionId ?? r.body.session?.id;
    if (!sessionId) throw new Error(`sessionId ausente na resposta: ${JSON.stringify(r.body)}`);
    ok(`Hub session criada: ${sessionId}`);
    info(`Título: "${title}"`);
    return sessionId;
}

async function conductConversation(hubSessionId) {
    step(5, `Conduzindo ${CONVERSATION_TURNS.length} turnos de conversa...`);
    console.log(`  ${c.gray}Hub Session ID: ${hubSessionId}${c.reset}\n`);

    let completedTurns = 0;
    for (let i = 0; i < CONVERSATION_TURNS.length; i++) {
        const message = CONVERSATION_TURNS[i];
        llmA(message);

        try {
            const r = await req('POST', `/api/hub/sessions/${hubSessionId}/send`, {
                message,
                timeoutMs: 90_000,
                useStructured: false,
            });

            if (r.status !== 200) {
                logErr(`Turno ${i + 1} falhou: HTTP ${r.status} — ${JSON.stringify(r.body)}`);
                continue;
            }

            const reply = r.body.content ?? '';
            llmB(reply.slice(0, 500) + (reply.length > 500 ? '...' : ''));
            info(`Turno #${r.body.turnNumber}, duração: ${r.body.durationMs}ms`);
            completedTurns++;
        } catch (/** @type {any} */ e) {
            logErr(`Turno ${i + 1} erro: ${e.message}`);
        }
    }
    return completedTurns;
}

async function verifyHistory(hubSessionId) {
    step(6, 'Verificando histórico via GET /api/hub/sessions/:id/turns...');
    const r = await req('GET', `/api/hub/sessions/${hubSessionId}/turns?limit=20`);
    if (r.status !== 200) throw new Error(`GET turns falhou: HTTP ${r.status} — ${JSON.stringify(r.body)}`);

    const turns = r.body.turns ?? [];
    const total = r.body.total ?? 0;
    ok(`${total} turn(s) persistidos no ConversationStore — exibindo ${turns.length}:`);
    console.log('');

    for (const turn of turns) {
        const preview = String(turn.content ?? '')
            .slice(0, 120)
            .replace(/\n/g, ' ');
        const role = turn.role === 'llm_a' ? `${c.cyan}LLM-A${c.reset}` : `${c.yellow}LLM-B ${c.reset}`;
        console.log(
            `    ${c.gray}#${String(turn.turn_number).padEnd(3)}${c.reset} [${role}] ${preview}${(turn.content?.length ?? 0) > 120 ? '...' : ''}`,
        );
    }
    return total;
}

async function shutdown() {
    step(7, 'Encerrando dialog loop e servidor...');
    try {
        await req('POST', '/api/copilot/dialog/stop');
        ok('Dialog loop encerrado');
    } catch {
        info('Dialog loop já encerrado ou inacessível');
    }

    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
        await sleep(1500);
        if (!serverProcess.killed) serverProcess.kill('SIGKILL');
        ok('Servidor encerrado');
    }
}

// ── Execução principal ───────────────────────────────────────────────────────
console.log(`
${c.bold}${c.blue}╔═══════════════════════════════════════════════════════════════════╗
║          CONVERSA OFICIAL VIA SERVIDOR — ConversationHub         ║
║          LLM-A (GitHub Copilot) ↔ LLM-B (Copilot SDK)           ║
╚═══════════════════════════════════════════════════════════════════╝${c.reset}
`);

let hubSessionId = null;
let completedTurns = 0;
let totalPersisted = 0;

try {
    await startServerProcess();
    await waitForAgentReady();
    await startDialogLoop();
    hubSessionId = await createHubSession();
    completedTurns = await conductConversation(hubSessionId);
    totalPersisted = await verifyHistory(hubSessionId);
    await shutdown();

    const success = completedTurns > 0 && totalPersisted > 0;
    console.log(`
${success ? c.green : c.yellow}${c.bold}
╔══════════════════════════════════════════════════════════════╗
║  ${success ? '🎯 CONVERSA OFICIAL VIA SERVIDOR CONCLUÍDA!' : '⚠️  CONVERSA PARCIAL — VERIFICAR LOGS'}${' '.repeat(success ? 7 : 8)}║
║                                                              ║
║  Hub Session: ${String(hubSessionId ?? '')
        .slice(0, 32)
        .padEnd(32, ' ')}   ║
║  Turnos completados:  ${String(completedTurns).padEnd(4)} / ${CONVERSATION_TURNS.length}                      ║
║  Turns persistidos:   ${String(totalPersisted).padEnd(4)}                            ║
║                                                              ║
║  ✅ POST /api/hub/sessions                                  ║
║  ✅ POST /api/hub/sessions/:id/send                         ║
║  ✅ GET  /api/hub/sessions/:id/turns                        ║
╚══════════════════════════════════════════════════════════════╝
${c.reset}`);
} catch (/** @type {any} */ e) {
    logErr(`Erro fatal: ${e.message}`);
    if (e.stack) info(e.stack.split('\n').slice(1, 4).join('\n'));
    try {
        await shutdown();
    } catch {
        /* seguro */
    }
    process.exit(1);
}
