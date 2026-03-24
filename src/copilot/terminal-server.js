// @ts-check
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
import { llmBridgeClient } from './llm-bridge-client.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

/** Timeout para aguardar resposta da LLM-B por turno (ms). */
const TURN_TIMEOUT_MS = Number(process.env.LLM_B_TURN_TIMEOUT ?? 120_000);

/** Boot prompt enviado ao iniciar o dialog loop. null = sem prompt inicial. */
const BOOT_PROMPT = process.env.LLM_B_BOOT_PROMPT ?? null;

const BANNER = `
╔══════════════════════════════════════════════════════════════════════════╗
║            Terminal LLM-B — Sessão Permanente Aberta                    ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Comandos: /status · /history [n] · /who · /clear · /quit               ║
║  Injeção LLM-A: POST http://localhost:${String(INJECT_PORT).padEnd(5)} /inject               ║
╚══════════════════════════════════════════════════════════════════════════╝
`;

const PROMPT_USER = 'você> ';
const PROMPT_WAITING = '      ';

// ─── Estado global do terminal ────────────────────────────────────────────────

/** Mutex simples: evita dois turnos simultâneos. @type {boolean} */
let _busy = false;

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
 * Exibe resposta da LLM-B com formatação de ator.
 *
 * @param {string} actor - Ator que enviou ('user' | 'llm-a')
 * @param {string} message - Mensagem enviada
 * @param {string} reply - Resposta da LLM-B
 * @param {number} durationMs - Duração da chamada
 * @returns {void}
 */
function printExchange(actor, message, reply, durationMs) {
    const actorLabel = actor === 'llm-a' ? '🤖 LLM-A' : '👤 User';
    println(`\n${actorLabel}: ${message}`);
    println(`🧠 LLM-B: ${reply}`);
    println(`   [${durationMs}ms]`);
}

/**
 * Exibe snapshot de status do agente.
 *
 * @returns {void}
 */
function cmdStatus() {
    const snap = /** @type {any} */ (alwaysAliveAgent.getStatusSnapshot());
    println('\n── Status do Agente ──');
    println(`  status:           ${snap.status}`);
    println(`  dialogLoopActive: ${alwaysAliveAgent.dialogLoopActive}`);
    println(`  turnCount (hub):  ${llmBridgeClient.turnCount}`);
    println(`  taskId atual:     ${snap.currentTaskId ?? '(nenhum)'}`);
    println('─────────────────────');
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
        println('[boot] Iniciando AlwaysAliveAgent…');
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

    println('[boot] Ativando dialog loop com LLM-B…');
    await llmBridgeClient.startDialogMode(BOOT_PROMPT ?? undefined, {
        onReady: () => println('[llm-b] ✅ LLM-B sinalizada READY — terminal ativo.'),
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
        println('[terminal] Aguarde — LLM-B está processando...');
        return null;
    }
    _busy = true;
    if (_rl) _rl.setPrompt(PROMPT_WAITING);

    const t0 = Date.now();
    try {
        await ensureDialogLoop();
        const reply = await llmBridgeClient.dialogTurn(message, { timeout: TURN_TIMEOUT_MS });
        const durationMs = Date.now() - t0;
        printExchange(actor, message, reply, durationMs);
        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);
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
                }),
            );
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
        const q = evt?.question ?? '';
        const choices = evt?.choices ?? [];
        rl.pause();
        println(`\n⚡ PERGUNTA DO MODELO: "${q}"`);
        if (choices.length > 0) {
            println(`   Opções: ${choices.join(' | ')}`);
        }
        println('   Use /answer <resposta> para responder.');
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
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: PROMPT_USER,
    });
    _rl = rl;

    const cleanup = setupAgentListeners(rl);

    println(BANNER);
    println('[boot] Inicializando sessão com LLM-B…');

    try {
        await ensureDialogLoop();
    } catch (/** @type {any} */ e) {
        println(`[boot] Erro ao inicializar: ${e.message}`);
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
                case 'who':
                    println(
                        `[who] Atores: 👤 você (stdin) · 🤖 LLM-A (POST :${INJECT_PORT}/inject) · 🧠 LLM-B (AlwaysAliveAgent)`,
                    );
                    break;
                case 'clear':
                    llmBridgeClient.clearHistory();
                    println('[clear] Histórico local limpo.');
                    break;
                case 'answer': {
                    const ok = alwaysAliveAgent.answerPendingQuestion(arg);
                    println(ok ? `[answer] Resposta enviada: "${arg}"` : '[answer] Nenhuma pergunta pendente.');
                    break;
                }
                case 'restart':
                    println('[restart] Reiniciando dialog loop…');
                    try {
                        await llmBridgeClient.stopDialogMode();
                    } catch {
                        /* já estava parado */
                    }
                    await ensureDialogLoop();
                    println('[restart] Dialog loop reiniciado.');
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
                        `[cli] Comando desconhecido: /${cmd}. Use /status, /history [n], /who, /clear, /answer, /restart ou /quit.`,
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
