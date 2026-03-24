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
import { loadAliases, resolve } from './alias-store.js';
import { alwaysAliveAgent } from './always-alive.js';
import { conversationStore } from './conversation-hub/store.js';
import { listIssues, listPrs, listRuns } from './gh-bridge.js';
import { gitLog, gitStatus } from './git-bridge.js';
import { llmBridgeClient } from './llm-bridge-client.js';
import {
    cmdAlias as _cmdAlias,
    cmdAnswer as _cmdAnswer,
    cmdClear as _cmdClear,
    cmdCount as _cmdCount,
    cmdDbHistory as _cmdDbHistory,
    cmdDbSessions as _cmdDbSessions,
    cmdForget as _cmdForget,
    cmdGh as _cmdGh,
    cmdGit as _cmdGit,
    cmdHelp as _cmdHelp,
    cmdHistory as _cmdHistory,
    cmdRecall as _cmdRecall,
    cmdRemember as _cmdRemember,
    cmdStatus as _cmdStatus,
    cmdWho as _cmdWho,
} from './terminal/commands/index.js';

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
  \x1b[33m/status\x1b[0m · \x1b[33m/history [n]\x1b[0m · \x1b[33m/db-history [n]\x1b[0m · \x1b[33m/db-sessions [n]\x1b[0m · \x1b[33m/who\x1b[0m · \x1b[33m/clear\x1b[0m · \x1b[33m/restart\x1b[0m
  \x1b[33m/remember [tag:] texto\x1b[0m · \x1b[33m/recall [tag]\x1b[0m · \x1b[33m/recall ?busca\x1b[0m · \x1b[33m/forget <id>\x1b[0m · \x1b[33m/count\x1b[0m
  \x1b[36m/gh issue list\x1b[0m · \x1b[36m/gh pr list\x1b[0m · \x1b[36m/gh run list\x1b[0m · \x1b[36m/git status\x1b[0m · \x1b[36m/git log\x1b[0m · \x1b[36m/alias\x1b[0m · \x1b[36m/help\x1b[0m
  \x1b[90mPOST :${INJECT_PORT}/inject  ·  POST :${INJECT_PORT}/pipeline  ·  GET :${INJECT_PORT}/events  ·  GET :${INJECT_PORT}/sessions  ·  POST/GET/DELETE :${INJECT_PORT}/memory\x1b[0m
  \x1b[90mGET :${INJECT_PORT}/gh/issues  ·  GET :${INJECT_PORT}/gh/prs  ·  GET :${INJECT_PORT}/gh/ci  ·  GET :${INJECT_PORT}/git/status  ·  GET :${INJECT_PORT}/git/log\x1b[0m
`;

const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';
const PROMPT_WAITING = '     ';

// ─── Estado global do terminal ────────────────────────────────────────────────

/** Mutex simples: evita dois turnos simultâneos. @type {boolean} */
let _busy = false;

/** Clientes SSE conectados ao endpoint GET /events (todos os eventos). @type {Set<import('node:http').ServerResponse>} */
const _sseClients = new Set();

/**
 * Clientes SSE que pedem apenas eventos críticos (?level=critical) — stalled, fatal, system. @type
 * {Set<import('node:http').ServerResponse>}
 */
const _sseCriticalClients = new Set();

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
 * @param {string} actor - Ator que enviou ('user' | 'llm-a')
 * @param {string} message - Mensagem enviada
 * @param {string} reply - Resposta da LLM-B
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
// ─── Wrappers de comandos (delegam para terminal/commands/) ──────────────────

/** @returns {void} */
function cmdStatus() { _cmdStatus({ hubSessionId: _hubSessionId, injectPort: INJECT_PORT, println }); }

/** @param {number} [n] @returns {void} */
function cmdHistory(n = 10) { _cmdHistory({ println }, n); }

/** @param {number} [n] @returns {void} */
function cmdDbHistory(n = 20) { _cmdDbHistory({ hubSessionId: _hubSessionId, println }, n); }

/** @param {number} [n] @returns {void} */
function cmdDbSessions(n = 10) { _cmdDbSessions({ hubSessionId: _hubSessionId, println }, n); }

/** @param {string[]} args @returns {Promise<void>} */
async function cmdGh(args) { return _cmdGh(args, { println }); }

/** @param {string[]} args @returns {Promise<void>} */
async function cmdGit(args) { return _cmdGit(args, { println }); }

/** @param {string[]} args @returns {void} */
function cmdAlias(args) { _cmdAlias(args, { println }); }

/** @returns {void} */
function cmdHelp() { _cmdHelp({ println, injectPort: INJECT_PORT }); }

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

/** Eventos considerados críticos para clientes em modo ?level=critical. */
const CRITICAL_EVENTS = new Set(['stalled', 'fatal', 'system']);

/**
 * Transmite um evento SSE para todos os clientes conectados ao endpoint GET /events. Clientes em modo `?level=critical`
 * recebem apenas eventos em CRITICAL_EVENTS.
 *
 * @param {string} event - Tipo do evento (ex: 'reply', 'ready', 'stalled')
 * @param {object} data - Payload JSON serializável
 * @returns {void}
 */
function broadcastSse(event, data) {
    if (_sseClients.size === 0 && _sseCriticalClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of _sseClients) {
        try {
            client.write(payload);
        } catch {
            _sseClients.delete(client);
        }
    }
    if (CRITICAL_EVENTS.has(event)) {
        for (const client of _sseCriticalClients) {
            try {
                client.write(payload);
            } catch {
                _sseCriticalClients.delete(client);
            }
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
        // GET /events           → stream completo: "reply", "ready", "stalled", "system"
        // GET /events?level=critical → apenas eventos críticos: "stalled", "fatal", "system"
        if (req.method === 'GET' && url.pathname === '/events') {
            const isCriticalOnly = url.searchParams.get('level') === 'critical';
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            });
            res.write(`: connected (level=${isCriticalOnly ? 'critical' : 'all'})\n\n`);
            if (isCriticalOnly) {
                _sseCriticalClients.add(res);
                req.on('close', () => _sseCriticalClients.delete(res));
            } else {
                _sseClients.add(res);
                req.on('close', () => _sseClients.delete(res));
            }
            return;
        }

        // P9: Lista hub_sessions — auditoria
        // GET /sessions → JSON array de sessions persistidas
        if (req.method === 'GET' && url.pathname === '/sessions') {
            try {
                const limit = Number(url.searchParams.get('limit') ?? '20');
                const offset = Number(url.searchParams.get('offset') ?? '0');
                const status = url.searchParams.get('status') ?? undefined;
                const sessions = conversationStore.listHubSessions({
                    limit: isNaN(limit) ? 20 : limit,
                    offset: isNaN(offset) ? 0 : offset,
                    status: /** @type {any} */ (status),
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, sessions, current: _hubSessionId }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // P9: Turnos de uma sessão específica — via REST
        // GET /sessions/:id/turns → JSON array de turns
        if (req.method === 'GET' && /^\/sessions\/[^/]+\/turns$/.test(url.pathname)) {
            const sessionId = url.pathname.split('/')[2] ?? '';
            try {
                const limit = Number(url.searchParams.get('limit') ?? '50');
                const offset = Number(url.searchParams.get('offset') ?? '0');
                const turns = conversationStore.readTurns(sessionId, {
                    limit: isNaN(limit) ? 50 : limit,
                    offset: isNaN(offset) ? 0 : offset,
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, turns, sessionId }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // P5: Memória semântica
        // POST /memory  Body: { tag?: string; content: string }
        // GET  /memory?tag=X&search=X&limit=N
        if (req.method === 'POST' && url.pathname === '/memory') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                try {
                    const parsed = /** @type {{ tag?: string; content?: string }} */ (JSON.parse(body));
                    if (!parsed.content) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: '"content" obrigatório' }));
                        return;
                    }
                    const id = conversationStore.storeMemory({
                        content: parsed.content,
                        tag: parsed.tag ?? 'geral',
                        ...(_hubSessionId ? { hubSessionId: _hubSessionId } : {}),
                    });
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, id }));
                } catch (/** @type {any} */ e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'GET' && url.pathname === '/memory') {
            try {
                const tagParam = url.searchParams.get('tag');
                const searchParam = url.searchParams.get('search');
                const limitParam = Number(url.searchParams.get('limit') ?? '20');
                const memories = conversationStore.recallMemories({
                    ...(tagParam ? { tag: tagParam } : {}),
                    ...(searchParam ? { search: searchParam } : {}),
                    limit: isNaN(limitParam) ? 20 : limitParam,
                });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, memories }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // DELETE /memory/:id  — remove uma memória semântica pelo id
        if (req.method === 'DELETE' && /^\/memory\/[^/]+$/.test(url.pathname)) {
            const memoryId = url.pathname.split('/')[2] ?? '';
            try {
                const deleted = conversationStore.deleteMemory(memoryId);
                res.writeHead(deleted ? 200 : 404, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(JSON.stringify({ ok: deleted, id: memoryId }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // P6: Pipeline orchestration — executa uma sequência ordenada de mensagens para LLM-B
        // POST /pipeline  Body: { steps: [{ prompt: string; waitMs?: number; from?: string }]; from?: string }
        // Resposta: { ok: true; results: [{ step: number; prompt: string; reply: string; durationMs: number }] }
        if (req.method === 'POST' && url.pathname === '/pipeline') {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', async () => {
                /** @type {{ steps?: { prompt: string; waitMs?: number; from?: string }[]; from?: string } | null} */
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'JSON inválido' }));
                    return;
                }

                if (!Array.isArray(parsed?.steps) || parsed.steps.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: '"steps" deve ser um array não vazio' }));
                    return;
                }

                const globalFrom = parsed.from ?? 'llm-a';
                const results = [];

                for (let i = 0; i < parsed.steps.length; i++) {
                    const step = parsed.steps[i];
                    if (!step?.prompt) continue;
                    const from = step.from ?? globalFrom;

                    if (step.waitMs && step.waitMs > 0) {
                        await new Promise((r) => setTimeout(r, step.waitMs));
                    }

                    const t0 = Date.now();
                    const reply = await sendTurn(step.prompt, from).catch(() => null);
                    results.push({
                        step: i + 1,
                        prompt: step.prompt,
                        reply: reply ?? null,
                        durationMs: Date.now() - t0,
                    });

                    // Se reply for null (busy), abortar pipeline
                    if (reply === null) {
                        res.writeHead(409, { 'Content-Type': 'application/json' });
                        res.end(
                            JSON.stringify({
                                ok: false,
                                error: `Step ${i + 1} retornou null (LLM-B ocupada) — pipeline interrompido`,
                                results,
                            }),
                        );
                        return;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, results }));
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

        // ── GET /gh/issues ────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/issues') {
            const state = url.searchParams.get('state') ?? 'open';
            const limit = Number(url.searchParams.get('limit') ?? '15');
            listIssues({ state: /** @type {any} */ (state), limit })
                .then((issues) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, issues }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /gh/prs ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/prs') {
            const state = url.searchParams.get('state') ?? 'open';
            const limit = Number(url.searchParams.get('limit') ?? '15');
            listPrs({ state: /** @type {any} */ (state), limit })
                .then((prs) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, prs }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /gh/ci ────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/ci') {
            const limit = Number(url.searchParams.get('limit') ?? '15');
            listRuns({ limit })
                .then((runs) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, runs }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /git/status ───────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/git/status') {
            gitStatus()
                .then((entries) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, entries }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                });
            return;
        }

        // ── GET /git/log ──────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/git/log') {
            const n = Number(url.searchParams.get('n') ?? '20');
            gitLog({ n })
                .then((entries) => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, entries }));
                })
                .catch((/** @type {any} */ e) => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
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
            // Resolve aliases antes do dispatch (ex: /st → /git status)
            const resolved = resolve(trimmed);
            const [cmd, ...rest] = resolved.slice(1).split(' ');
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
                case 'db-sessions': {
                    const n = Number(arg) || 10;
                    cmdDbSessions(n);
                    break;
                }
                case 'remember': {
                    _cmdRemember({ hubSessionId: _hubSessionId, println }, arg);
                    break;
                }
                case 'recall': {
                    _cmdRecall({ hubSessionId: _hubSessionId, println }, arg);
                    break;
                }
                case 'who':
                    _cmdWho({ injectPort: INJECT_PORT, println });
                    break;
                case 'clear':
                    _cmdClear({ println });
                    break;
                case 'answer': {
                    _cmdAnswer({ println }, arg);
                    break;
                }
                case 'forget': {
                    _cmdForget({ hubSessionId: _hubSessionId, println }, arg);
                    break;
                }
                case 'count': {
                    _cmdCount({ hubSessionId: _hubSessionId, println });
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
                case 'gh':
                    await cmdGh(rest);
                    break;
                case 'git':
                    await cmdGit(rest);
                    break;
                case 'alias':
                    cmdAlias(rest);
                    break;
                case 'help':
                    cmdHelp();
                    break;
                default:
                    println(`\x1b[90m  Comando desconhecido: /${cmd}. Use /help para ver todos os comandos.\x1b[0m`);
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

    // Carregar aliases customizados
    loadAliases();

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

    // P7: Reflection loop periódico — LLM-B avalia o histórico recente e emite insights
    // Ativado apenas se a env var LLM_B_REFLECTION_INTERVAL_MIN estiver definida (> 0)
    const reflectionIntervalMin = Number(process.env.LLM_B_REFLECTION_INTERVAL_MIN ?? '0');
    if (reflectionIntervalMin > 0) {
        const reflectionIntervalMs = reflectionIntervalMin * 60 * 1000;
        log('INFO', `[TerminalServer] Reflection loop ativado: a cada ${reflectionIntervalMin}min.`);

        const runReflection = () => {
            if (!alwaysAliveAgent.dialogLoopActive || _busy) return;
            log('INFO', '[TerminalServer] Executando reflection loop…');
            sendTurn(
                '[REFLEXÃO] Faça uma breve reflexão sobre as últimas mensagens desta conversa: o que foi discutido, o que está pendente, e se você tem alguma sugestão ou insight que ainda não mencionou. Seja conciso.',
                'llm-a',
            ).catch((/** @type {any} */ e) => log('WARN', `[TerminalServer] Reflection loop falhou: ${e.message}`));
        };

        const reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
        // Garantir que o timer não impede o processo de encerrar
        if (typeof reflectionTimer.unref === 'function') reflectionTimer.unref();
    }

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
