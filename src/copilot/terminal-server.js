// @ts-check
// O terminal LLM-B sempre requer o subsistema Copilot SDK habilitado.
// Configuramos antes dos imports para que todos os módulos vejam o valor correto.
if (!process.env.COPILOT_SDK_ENABLED) process.env.COPILOT_SDK_ENABLED = 'true';

/**
 * src/copilot/terminal-server.js
 *
 * Terminal Permanente LLM-B — sessão aberta, multi-ator.
 *
 * Mantém uma sessão de diálogo sempre ativa com a LLM-B (AlwaysAliveAgent no modo dialog loop). Dois atores podem
 * enviar mensagens:
 *
 * 1. **Usuário humano** via readline stdin/stdout (interface interativa no terminal)
 * 2. **LLM-A** via HTTP POST `http://localhost:<LLM_B_TERMINAL_PORT>/inject` (também disponível via `POST /api/hub/inject`
 *    no servidor principal)
 *
 * Comportamento:
 *
 * - Ao iniciar, o agente sobe automaticamente e o dialog loop é ativado
 * - Cada mensagem de qualquer fonte é roteada para `alwaysAliveAgent.sendDialogTurn()`
 * - A resposta é exibida no stdout com prefixo do ator: [user], [llm-a], [llm-b]
 * - Ctrl+C pausa readline mas NÃO encerra o dialog loop (LLM-B fica aguardando)
 * - `/quit` encerra o loop e o processo
 *
 * @module copilot/terminal-server
 *
 * @example
 *     ```bash
 *     # Iniciar diretamente:
 *     node --strip-types src/copilot/terminal-server.js
 *
 *     # Injetar mensagem de LLM-A (com servidor ativo):
 *     curl -X POST http://localhost:3009/inject \
 *       -H 'Content-Type: application/json' \
 *       -d '{"message": "Olá LLM-B!", "from": "llm-a"}'
 *     ```;
 */

import { log } from '#core/logger';
import http from 'node:http';
import readline from 'node:readline';
import { alwaysAliveAgent } from './always-alive.js';
import { conversationStore } from './conversation-hub/store.js';
import { llmBridgeClient } from './llm-bridge-client.js';

/** ID da hub_session permanente criada no boot. @type {string | null} */
let _hubSessionId = null;
// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

/** Timeout para aguardar resposta da LLM-B por turno (ms). */
const TURN_TIMEOUT_MS = Number(process.env.LLM_B_TURN_TIMEOUT ?? 120_000);

/**
 * Boot prompt padrão enviado à LLM-B ao iniciar o dialog loop. Pode ser sobrescrito pela variável de ambiente
 * `LLM_B_BOOT_PROMPT`.
 */
const DEFAULT_BOOT_PROMPT = `Você é a LLM-B — assistente técnico interno do projeto chatgpt-docker-puppeteer.

Contexto do projeto:
- Node.js 24+ ESM; arquitetura orientada a eventos via barramento NERV
- Camadas principais: kernel, driver, orchestrator, agent, infra, server, missions
- Você opera como agente contínuo de longa duração, nunca encerra sessões

Seu papel:
- Responder perguntas técnicas sobre o codebase, arquitetura e decisões de design
- Ajudar na análise de bugs, código e logs quando solicitado
- Colaborar criticamente com o desenvolvedor e com a LLM-A (seu parceiro de raciocínio)

Protocolo OBRIGATÓRIO de comunicação via ask_user:
1. Chame ask_user("READY: aguardando próxima mensagem") para sinalizar prontidão.
2. Ao receber uma mensagem, processe-a e formule uma resposta completa.
3. Chame ask_user("REPLY: " + sua_resposta) para enviar a resposta.
4. Retorne ao passo 1. NUNCA encerre o loop. Sempre use ask_user para comunicar.

Se receber "STOP_DIALOG", responda com ask_user("STOPPED") e então pode encerrar.`;

/** Boot prompt efetivo: env var sobrescreve o padrão. */
const BOOT_PROMPT = process.env.LLM_B_BOOT_PROMPT ?? DEFAULT_BOOT_PROMPT;

const BANNER = `
\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗
║            Terminal LLM-B — Sessão Permanente Aberta                    ║
╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m
  Comandos: \x1b[33m/status\x1b[0m · \x1b[33m/history [n]\x1b[0m · \x1b[33m/db-history [n]\x1b[0m · \x1b[33m/who\x1b[0m · \x1b[33m/clear\x1b[0m · \x1b[33m/restart\x1b[0m
  Injeção:  \x1b[90mPOST http://localhost:${INJECT_PORT}/inject\x1b[0m
`;

const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';
const PROMPT_WAITING = '     ';

// ─── Estado global do terminal ────────────────────────────────────────────────

/** Mutex simples: evita dois turnos simultâneos. @type {boolean} */
let _busy = false;

/** Clientes SSE conectados no endpoint GET /events. @type {Set<import('node:http').ServerResponse>} */
const _sseClients = new Set();

/** Interface readline ativa. @type {readline.Interface | null} */
let _rl = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escreve linha no stdout preservando o estado do prompt.
 *
 * @param {string} text - Texto a exibir
 * @returns {void}
 */
function println(text) {
    process.stdout.write(`\r${text}\n`);
}

/**
 * Exibe um turno completo (mensagem + resposta) com formatação visual limpa.
 *
 * @param {string} actor     - Ator que enviou ('user' | 'llm-a')
 * @param {string} message   - Mensagem enviada
 * @param {string} reply     - Resposta da LLM-B
 * @param {number} durationMs - Duração da chamada em ms
 * @returns {void}
 */
function printExchange(actor, message, reply, durationMs) {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const secs = (durationMs / 1000).toFixed(1);

    // Cabeçalho do ator
    if (actor === 'llm-a') {
        println(`\n  🤖  \x1b[34mLLM-A\x1b[0m  \x1b[90m[${ts}]\x1b[0m`);
        println(`  ${message}`);
    }
    // (mensagens do usuário já visíveis no REPL — não repetimos)

    // Separador + resposta LLM-B
    println(`\n  🧠  \x1b[32mLLM-B\x1b[0m  \x1b[90m[${ts}] ${secs}s\x1b[0m`);

    // Exibe cada linha da resposta com recuo
    for (const line of reply.split('\n')) {
        println(`  ${line}`);
    }
    println('');
}

/**
 * Exibe snapshot de status do agente.
 *
 * @returns {void}
 */
function cmdStatus() {
    const snap = /** @type {any} */ (alwaysAliveAgent.getStatusSnapshot());
    const active = alwaysAliveAgent.dialogLoopActive;
    const statusColor = snap.status === 'waiting_for_input' ? '\x1b[32m' : snap.status === 'idle' ? '\x1b[33m' : '\x1b[31m';
    println(`
  \x1b[36mStatus do Terminal LLM-B\x1b[0m
  ─────────────────────────────────────
  agente          ${statusColor}${snap.status}\x1b[0m
  dialog loop     ${active ? '\x1b[32m● ativo\x1b[0m' : '\x1b[31m○ inativo\x1b[0m'}
  turnos (memória) ${llmBridgeClient.turnCount}
  hub session     \x1b[90m${_hubSessionId ?? '(sem hub)'}\x1b[0m
  inject port     ${INJECT_PORT}
  ─────────────────────────────────────
`);
}

/**
 * Exibe o histórico de conversa local.
 *
 * @param {number} n - Número de pares a exibir
 * @returns {void}
 */
function cmdHistory(n = 10) {
    const hist = llmBridgeClient.history;
    if (hist.length === 0) {
        println('[history] Histórico vazio.');
        return;
    }
    const slice = hist.slice(-n * 2);
    println(`\n── Histórico (últimos ${Math.floor(slice.length / 2)} pares) ──`);
    for (const turn of slice) {
        const ts = new Date(turn.timestamp).toLocaleTimeString('pt-BR');
        const roleLabel = turn.role === 'user' ? '👤' : '🧠';
        const preview = turn.content.slice(0, 160) + (turn.content.length > 160 ? '…' : '');
        println(`  [${ts}] ${roleLabel} ${preview}`);
    }
    println('─────────────────────────────────');
}

// ─── Motor de diálogo ─────────────────────────────────────────────────────────

/**
 * Exibe o histórico de conversa persistido no SQLite Hub (sobrevive a restarts).
 *
 * @param {number} [n] - Número de turnos a exibir (padrão: 20)
 * @returns {void}
 */
function cmdDbHistory(n = 20) {
    if (!_hubSessionId) {
        println('[db-history] Hub session não disponível (sem persistência).');
        return;
    }
    try {
        const turns = conversationStore.readTurns(_hubSessionId, { limit: n });
        if (turns.length === 0) {
            println('[db-history] Nenhum turno persistido ainda.');
            return;
        }
        println(`\n── DB-Histórico (últimos ${turns.length} turnos) ──`);
        for (const t of turns) {
            const ts = new Date(t.created_at).toLocaleTimeString('pt-BR');
            const emoji = t.role === 'llm_b' ? '🧠' : t.role === 'llm_a' ? '🤖' : '👤';
            const preview = t.content.slice(0, 160) + (t.content.length > 160 ? '…' : '');
            println(`  [${ts}] ${emoji} ${preview}`);
        }
        println('─────────────────────────────────');
    } catch (/** @type {any} */ e) {
        println(`[db-history] Erro ao ler DB: ${e.message}`);
    }
}

// ─── Motor de diálogo ─────────────────────────────────────────────────────────

/**
 * Garante que o dialog loop está ativo. Se não estiver, inicia-o.
 *
 * @returns {Promise<void>}
 */
async function ensureDialogLoop() {
    if (alwaysAliveAgent.dialogLoopActive) {
        return;
    }

    const status = alwaysAliveAgent.status;
    if (status === 'stopped') {
        println('\x1b[90m  Iniciando AlwaysAliveAgent…\x1b[0m');
        await alwaysAliveAgent.start();
        // Aguarda idle
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout aguardando idle')), 30_000);
            const check = () => {
                if (alwaysAliveAgent.status === 'idle') {
                    clearTimeout(timeout);
                    resolve(undefined);
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    println('\x1b[90m  Conectando ao agente…\x1b[0m');
    await llmBridgeClient.startDialogMode(BOOT_PROMPT ?? undefined, {
        onReady: () => println('\n  \x1b[32m●\x1b[0m  LLM-B pronta — pode começar\n'),
    });
}

/**
 * Envia um turno de diálogo para a LLM-B e exibe a resposta.
 *
 * @param {string} message - Mensagem a enviar
 * @param {string} [actor] - Quem está enviando ('user' | 'llm-a')
 * @returns {Promise<string | null>} Resposta da LLM-B, ou null se busy
 */
async function sendTurn(message, actor = 'user') {
    if (_busy) {
        println('\x1b[33m  ⏳ Aguarde — LLM-B está processando...\x1b[0m');
        return null;
    }
    _busy = true;
    if (_rl) {
        process.stdout.write(`\x1b[90m  …\x1b[0m`);
        _rl.setPrompt(PROMPT_WAITING);
    }

    const t0 = Date.now();
    try {
        await ensureDialogLoop();
        const reply = await llmBridgeClient.dialogTurn(message, { timeout: TURN_TIMEOUT_MS });
        const durationMs = Date.now() - t0;
        printExchange(actor, message, reply, durationMs);
        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);

        // Persistir no ConversationHub (best-effort)
        if (_hubSessionId) {
            try {
                /** @type {'user' | 'llm_a'} */
                const senderRole = actor === 'llm-a' ? 'llm_a' : 'user';
                conversationStore.writeTurn(_hubSessionId, { role: senderRole, content: message });
                conversationStore.writeTurn(_hubSessionId, { role: 'llm_b', content: reply, durationMs });
            } catch (/** @type {any} */ hubErr) {
                log('WARN', `[TerminalServer] Hub writeTurn falhou: ${hubErr.message}`);
            }
        }

        return reply;
    } catch (/** @type {any} */ e) {
        println(`[erro] ${e.message}`);
        log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${e.message}`);
        return null;
    } finally {
        _busy = false;
        if (_rl) {
            _rl.setPrompt(PROMPT_USER);
            _rl.prompt();
        }
    }
}

// ─── Servidor HTTP de injeção ─────────────────────────────────────────────────

/**
 * Transmite um evento SSE para todos os clientes conectados ao endpoint GET /events.
 *
 * @param {string} event - Tipo do evento (ex: 'reply', 'ready', 'stalled')
 * @param {object} data - Payload JSON serializável
 * @returns {void}
 */
function broadcastSse(event, data) {
    if (_sseClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of _sseClients) {
        try {
            client.write(payload);
        } catch {
            _sseClients.delete(client);
        }
    }
}

/**
 * Cria HTTP server interno para injeção de mensagens de LLM-A.
 *
 * Endpoint: POST /inject Body JSON: { "message": "...", "from": "llm-a" } Resposta: { "reply": "...", "durationMs":
 * 123, "ok": true }
 *
 * @returns {http.Server} Servidor HTTP iniciado
 */
function createInjectServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${INJECT_PORT}`);

        // Health check
        if (req.method === 'GET' && url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: true,
                    dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
                    agentStatus: alwaysAliveAgent.status,
                    busy: _busy,
                    hubSessionId: _hubSessionId,
                    sseClients: _sseClients.size,
                }),
            );
            return;
        }

        // Canal de subscrição LLM-A: SSE — ouve respostas da LLM-B em tempo real
        // GET /events → stream de eventos: "reply", "ready", "stalled"
        if (req.method === 'GET' && url.pathname === '/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            });
            res.write(': connected\n\n');
            _sseClients.add(res);
            req.on('close', () => {
                _sseClients.delete(res);
            });
            return;
        }

        // Injeção de mensagem
        if (req.method === 'POST' && url.pathname === '/inject') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                /** @type {{ message?: string; from?: string } | null} */
                let parsed = null;
                try {
                    parsed = /** @type {{ message?: string; from?: string }} */ (JSON.parse(body));
                } catch {
                    /* JSON inválido tratado abaixo */
                }
                if (!parsed) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
                    return;
                }

                const message = parsed.message?.trim();
                const from = parsed.from ?? 'llm-a';

                if (!message) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: '"message" é obrigatório' }));
                    return;
                }

                const t0 = Date.now();
                sendTurn(message, from)
                    .then((reply) => {
                        res.writeHead(reply !== null ? 200 : 409, { 'Content-Type': 'application/json' });
                        res.end(
                            JSON.stringify({
                                ok: reply !== null,
                                reply: reply ?? null,
                                durationMs: Date.now() - t0,
                                from,
                            }),
                        );
                    })
                    .catch((/** @type {any} */ e) => {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: e.message }));
                    });
                return;
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });

    server.listen(INJECT_PORT, '127.0.0.1', () => {
        log('INFO', `[TerminalServer] Inject server ativo em http://127.0.0.1:${INJECT_PORT}`);
        println(`[inject] Servidor de injeção ativo em http://127.0.0.1:${INJECT_PORT}`);
    });

    server.on('error', (/** @type {any} */ e) => {
        log('ERROR', `[TerminalServer] Inject server erro: ${e.message}`);
        println(`[inject] Erro no servidor de injeção: ${e.message}`);
    });

    return server;
}

// ─── REPL readline ────────────────────────────────────────────────────────────

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no terminal.
 *
 * @param {readline.Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup
 */
function setupAgentListeners(rl) {
    const onQuestion = (/** @type {any} */ evt) => {
        const q = /** @type {string} */ (evt?.question ?? '');
        const choices = /** @type {string[]} */ (evt?.choices ?? []);

        // Filtra mensagens internas do protocolo dialog loop (READY:/REPLY:/DONE:/STOPPED)
        // O usuário nunca precisa interagir com elas — são tratadas automaticamente.
        if (/^(READY[:\s]|REPLY[:\s]|DONE[:\s]|STOPPED|STOP_DIALOG)/i.test(q.trim())) {
            return;
        }

        // Pergunta real do LLM-B (fora do protocolo READY/REPLY)
        rl.pause();
        println(`\n⚡ LLM-B perguntou: "${q}"`);
        if (choices.length > 0) {
            println(`   Opções: ${choices.join(' | ')}`);
        }
        println('   → Responda digitando normalmente. Sua próxima mensagem será a resposta.');
        rl.resume();
        rl.prompt();
    };

    const onStopped = () => {
        println('[llm-b] ⚠️  Agente parado. Use /restart para reiniciar.');
    };

    alwaysAliveAgent.on('question.pending', onQuestion);
    alwaysAliveAgent.once('stopped', onStopped);

    return () => {
        alwaysAliveAgent.off('question.pending', onQuestion);
        alwaysAliveAgent.off('stopped', onStopped);
    };
}

/**
 * Inicia o REPL readline do terminal permanente.
 *
 * @param {http.Server} injectServer - Servidor HTTP de injeção (para fechar no /quit)
 * @returns {Promise<void>}
 */
async function startRepl(injectServer) {
    // Modo headless: stdin não é um TTY (background, PM2 stdin:false, /dev/null)
    // Neste caso, não criamos readline e usamos apenas o inject server HTTP.
    if (!process.stdin.isTTY) {
        println('[boot] Modo headless detectado — REPL desativado. Use POST :' + INJECT_PORT + '/inject.');
        await ensureDialogLoop();
        // O inject server mantém o event loop ativo indefinidamente
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: PROMPT_USER,
    });
    _rl = rl;

    const cleanup = setupAgentListeners(rl);

    println(BANNER);
    println('\x1b[90m  Iniciando sessão com LLM-B…\x1b[0m');

    try {
        await ensureDialogLoop();
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  [erro de boot] ${e.message}\x1b[0m`);
        log('ERROR', `[TerminalServer] Boot error: ${e.message}`);
    }

    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }

        // Comandos especiais
        if (trimmed.startsWith('/')) {
            const [cmd, ...rest] = trimmed.slice(1).split(' ');
            const arg = rest.join(' ');

            switch (cmd?.toLowerCase()) {
                case 'status':
                    cmdStatus();
                    break;
                case 'history': {
                    const n = Number(arg) || 10;
                    cmdHistory(n);
                    break;
                }
                case 'db-history': {
                    const n = Number(arg) || 20;
                    cmdDbHistory(n);
                    break;
                }
                case 'who':
                    println(`
  \x1b[36mAtores ativos nesta sessão:\x1b[0m
  👤  \x1b[32mVocê\x1b[0m          — stdin (digitar diretamente aqui)
  🤖  \x1b[34mLLM-A\x1b[0m         — POST http://localhost:${INJECT_PORT}/inject
  🧠  \x1b[35mLLM-B\x1b[0m         — AlwaysAliveAgent (GPT-4.1 Copilot SDK)
  📡  \x1b[90mSSE stream\x1b[0m    — GET  http://localhost:${INJECT_PORT}/events
`);
                    break;
                case 'clear':
                    llmBridgeClient.clearHistory();
                    println('\x1b[90m  Histórico em memória limpo.\x1b[0m');
                    break;
                case 'answer': {
                    const ok = alwaysAliveAgent.answerPendingQuestion(arg);
                    println(ok ? `[answer] Resposta enviada: "${arg}"` : '[answer] Nenhuma pergunta pendente.');
                    break;
                }
                case 'restart':
                    println('\x1b[90m  Reiniciando dialog loop…\x1b[0m');
                    try {
                        await llmBridgeClient.stopDialogMode();
                    } catch {
                        /* já estava parado */
                    }
                    await ensureDialogLoop();
                    println('\x1b[32m  Dialog loop reiniciado.\x1b[0m');
                    break;
                case 'quit':
                case 'exit':
                    println('[terminal] Encerrando sessão…');
                    cleanup();
                    try {
                        await llmBridgeClient.stopDialogMode();
                    } catch {
                        /* ignora */
                    }
                    rl.close();
                    injectServer.close();
                    _rl = null;
                    return;
                default:
                    println(
                        `[cli] Comando desconhecido: /${cmd}. Use /status, /history [n], /db-history [n], /who, /clear, /restart ou /quit.`,
                    );
            }
            rl.prompt();
            return;
        }

        // Mensagem normal → envia ao LLM-B via dialog loop
        await sendTurn(trimmed, 'user');
    });

    rl.on('close', () => {
        cleanup();
        _rl = null;
        println('[terminal] readline fechado. Inject server continua ativo.');
        log('INFO', '[TerminalServer] readline encerrado.');
    });

    // Ctrl+C: pausa readline mas mantém o dialog loop ativo
    rl.on('SIGINT', () => {
        println('\n[terminal] Ctrl+C detectado. Dialog loop mantido ativo. Use /quit para encerrar.');
        rl.prompt();
    });
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

/**
 * Inicia o Terminal Permanente LLM-B.
 *
 * @returns {Promise<void>}
 */
export async function startTerminalServer() {
    log('INFO', '[TerminalServer] Iniciando terminal permanente LLM-B…');

    const injectServer = createInjectServer();

    // Criar hub_session permanente no ConversationStore (best-effort; não depende de Socket.io)
    try {
        conversationStore.init();
        _hubSessionId = conversationStore.createHubSession({
            title: 'Terminal Permanente LLM-B',
            metadata: { source: 'terminal-server', startedAt: new Date().toISOString() },
        });
        log('INFO', `[TerminalServer] Hub session criada: ${_hubSessionId}`);
    } catch (/** @type {any} */ e) {
        log('WARN', `[TerminalServer] Hub storage indisponível, continua sem persistência: ${e.message}`);
    }

    // Registrar watchdog: ao detectar dialog loop travado, reiniciar automaticamente
    alwaysAliveAgent.on('dialog.stalled', (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        println(`\n[watchdog] ⚠️  Dialog loop inativo há ${secs}s — reiniciando automaticamente…`);
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo). Reiniciando dialog loop.`);
        if (_hubSessionId) {
            try {
                conversationStore.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Watchdog: dialog loop inativo por ${secs}s — reinício automático.`,
                });
            } catch {
                /* best-effort */
            }
        }
        // Reinicia de forma assíncrona
        llmBridgeClient
            .stopDialogMode()
            .catch(() => {})
            .then(() => ensureDialogLoop())
            .catch((/** @type {any} */ e) =>
                log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop: ${e.message}`),
            );
        // Notifica clientes SSE
        broadcastSse('stalled', { stalledMs: evt.stalledMs });
    });

    // SSE: transmitir respostas da LLM-B para clientes subscritos (canal LLM-A proativo)
    alwaysAliveAgent.on('dialog.reply', (/** @type {{ reply: string }} */ evt) => {
        broadcastSse('reply', { content: evt.reply, timestamp: Date.now() });
    });
    alwaysAliveAgent.on('dialog.ready', () => {
        broadcastSse('ready', { timestamp: Date.now() });
    });

    // P4: persiste eventos de sistema no Hub (reconexões, falhas fatais)
    alwaysAliveAgent.on(
        'ready',
        (/** @type {{ sessionId: string; isResumed: boolean; reconected?: boolean }} */ evt) => {
            if (!_hubSessionId || !evt.reconected) return; // evita registrar boot normal
            try {
                conversationStore.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Session reconectada: ${evt.sessionId} (retomada: ${evt.isResumed})`,
                });
            } catch {
                /* best-effort */
            }
        },
    );
    alwaysAliveAgent.on('session.fatal', (/** @type {{ originalError: string; attempts: number }} */ evt) => {
        if (!_hubSessionId) return;
        try {
            conversationStore.writeTurn(_hubSessionId, {
                role: 'user',
                content: `[SISTEMA] session.fatal após ${evt.attempts} tentativas: ${evt.originalError}`,
            });
        } catch {
            /* best-effort */
        }
    });

    await startRepl(injectServer);
}

// Executa diretamente quando chamado via `node terminal-server.js`
const isMain = process.argv[1]?.endsWith('terminal-server.js') ?? false;
if (isMain) {
    startTerminalServer().catch((e) => {
        console.error('[TerminalServer] Erro fatal:', e);
        process.exit(1);
    });
}
