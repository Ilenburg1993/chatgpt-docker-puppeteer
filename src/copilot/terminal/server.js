// @ts-check
/**
 * src/copilot/terminal/server.js
 *
 * Servidor HTTP de injeção do Terminal Permanente LLM-B.
 *
 * Wrapper HTTP raw (node:http, porta 3009) que delega toda a lógica de negócio para `http-handlers.js`. O único código
 * neste arquivo é adaptação de transporte: leitura de body, parsing de URL, escrita de status/cabeçalhos HTTP e
 * tratamento SSE.
 *
 * | Método | Caminho             | Descrição                             |
 * | ------ | ------------------- | ------------------------------------- |
 * | GET    | /health             | Status do agente e do dialog loop     |
 * | GET    | /events             | SSE — stream de eventos da LLM-B      |
 * | GET    | /sessions           | Lista hub_sessions persistidas        |
 * | GET    | /sessions/:id/turns | Turnos de uma sessão específica       |
 * | POST   | /memory             | Armazena uma memória semântica        |
 * | GET    | /memory             | Recupera memórias semânticas          |
 * | DELETE | /memory/:id         | Remove uma memória semântica          |
 * | POST   | /pipeline           | Executa sequência ordenada de turnos  |
 * | POST   | /inject             | Injeta uma mensagem na LLM-B          |
 * | GET    | /gh/issues          | Lista GitHub issues via gh CLI        |
 * | GET    | /gh/prs             | Lista GitHub pull requests via gh CLI |
 * | GET    | /gh/ci              | Lista GitHub CI runs via gh CLI       |
 * | GET    | /git/status         | Git status via spawn                  |
 * | GET    | /git/log            | Git log via spawn                     |
 * | GET    | /config             | Configuração dinâmica da sessão LLM-B |
 *
 * @module copilot/terminal/server
 */

import { log } from '#core/logger';
import http from 'node:http';
import { println } from './dialog.js';
import {
    handleDeleteMemory,
    handleGetConfig,
    handleGhCi,
    handleGhIssues,
    handleGhPrs,
    handleGitLog,
    handleGitStatus,
    handleHealth,
    handleInject,
    handleGetSkills,
    handleGetToolsConfig,
    handleListSessions,
    handleListTurns,
    handlePipeline,
    handleRecallMemories,
    handleSetInfiniteSessionConfig,
    handleSetSkills,
    handleSetToolsConfig,
    handleStoreMemory,
} from './http-handlers.js';
import { getSseClients, getSseCriticalClients } from './state.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

// ─── Rate limiter simples para POST /inject ───────────────────────────────────
// GAP-01 (fix): limitar POST /inject a 10 requisições por IP por janela de 60s
// (previne flood / DDOS acidental no endpoint de injeção)

/** @type {Map<string, { count: number; resetAt: number }>} */
const _injectRateLimiter = new Map();
const INJECT_RATE_MAX = Number(process.env.LLM_B_INJECT_RATE_MAX ?? 10);
const INJECT_RATE_WINDOW_MS = Number(process.env.LLM_B_INJECT_RATE_WINDOW_MS ?? 60_000);

/**
 * Verifica se o IP excedeu o limite de requisições para /inject.
 *
 * @param {string} ip
 * @returns {{ allowed: boolean; remaining: number; resetIn: number }}
 */
function checkInjectRate(ip) {
    const now = Date.now();
    let bucket = _injectRateLimiter.get(ip);
    if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + INJECT_RATE_WINDOW_MS };
        _injectRateLimiter.set(ip, bucket);
    }
    bucket.count++;
    return {
        allowed: bucket.count <= INJECT_RATE_MAX,
        remaining: Math.max(0, INJECT_RATE_MAX - bucket.count),
        resetIn: Math.ceil((bucket.resetAt - now) / 1000),
    };
}

// ─── Helpers de transporte ────────────────────────────────────────────────────

/**
 * Escreve uma resposta JSON no `res` a partir de um `HandlerResult`.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{ status: number; body: unknown; cors?: boolean }} result
 * @returns {void}
 */
function sendJson(res, result) {
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json' };
    if (result.cors) headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(result.status, headers);
    res.end(JSON.stringify(result.body));
}

/**
 * Lê o body de uma requisição HTTP e retorna como string.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
        });
        req.on('end', () => resolve(data));
    });
}

/**
 * Faz parse seguro de JSON — retorna `null` se inválido.
 *
 * @param {string} raw
 * @returns {unknown | null}
 */
function tryParseJson(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────

/**
 * Cria o servidor HTTP interno para injeção de mensagens de LLM-A e consulta de estado.
 *
 * @returns {http.Server} Servidor HTTP iniciado na porta `INJECT_PORT`
 */
export function createInjectServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${INJECT_PORT}`);

        // ── GET /health ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/health') {
            sendJson(res, handleHealth());
            return;
        }

        // ── GET /config ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/config') {
            sendJson(res, handleGetConfig());
            return;
        }

        // ── PUT /config/infinite-session (AC.1) ──────────────────────────
        if (req.method === 'PUT' && url.pathname === '/config/infinite-session') {
            readBody(req)
                .then((raw) => {
                    const body = raw ? JSON.parse(raw) : {};
                    sendJson(res, handleSetInfiniteSessionConfig(body));
                })
                .catch((err) => sendJson(res, { status: 400, body: { ok: false, error: err.message } }));
            return;
        }

        // ── GET /config/skills (AG.3) ─────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/config/skills') {
            sendJson(res, handleGetSkills());
            return;
        }

        // ── PUT /config/skills (AG.3) ─────────────────────────────────────
        if (req.method === 'PUT' && url.pathname === '/config/skills') {
            readBody(req)
                .then((raw) => {
                    const body = raw ? JSON.parse(raw) : {};
                    sendJson(res, handleSetSkills(body));
                })
                .catch((err) => sendJson(res, { status: 400, body: { ok: false, error: err.message } }));
            return;
        }

        // ── GET /config/tools (AH.2) ──────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/config/tools') {
            sendJson(res, handleGetToolsConfig());
            return;
        }

        // ── PUT /config/tools (AH.2) ──────────────────────────────────────
        if (req.method === 'PUT' && url.pathname === '/config/tools') {
            readBody(req)
                .then((raw) => {
                    const body = raw ? JSON.parse(raw) : {};
                    sendJson(res, handleSetToolsConfig(body));
                })
                .catch((err) => sendJson(res, { status: 400, body: { ok: false, error: err.message } }));
            return;
        }

        // ── GET /events ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/events') {
            const isCriticalOnly = url.searchParams.get('level') === 'critical';
            const _sseClients = getSseClients();
            const _sseCriticalClients = getSseCriticalClients();
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

        // ── GET /sessions ─────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/sessions') {
            const rawStatus = url.searchParams.get('status');
            sendJson(
                res,
                handleListSessions({
                    limit: Number(url.searchParams.get('limit') ?? '20'),
                    offset: Number(url.searchParams.get('offset') ?? '0'),
                    ...(rawStatus !== null ? { status: rawStatus } : {}),
                }),
            );
            return;
        }

        // ── GET /sessions/:id/turns ───────────────────────────────────────
        if (req.method === 'GET' && /^\/sessions\/[^/]+\/turns$/.test(url.pathname)) {
            const sessionId = url.pathname.split('/')[2] ?? '';
            sendJson(
                res,
                handleListTurns({
                    sessionId,
                    limit: Number(url.searchParams.get('limit') ?? '50'),
                    offset: Number(url.searchParams.get('offset') ?? '0'),
                }),
            );
            return;
        }

        // ── POST /memory ──────────────────────────────────────────────────
        if (req.method === 'POST' && url.pathname === '/memory') {
            const raw = await readBody(req);
            const parsed = /** @type {{ tag?: string; content?: string } | null} */ (tryParseJson(raw));
            if (!parsed) {
                sendJson(res, { status: 400, body: { ok: false, error: 'JSON inválido' } });
                return;
            }
            sendJson(res, handleStoreMemory(parsed));
            return;
        }

        // ── GET /memory ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/memory') {
            sendJson(
                res,
                handleRecallMemories({
                    tag: url.searchParams.get('tag'),
                    search: url.searchParams.get('search'),
                    limit: Number(url.searchParams.get('limit') ?? '20'),
                }),
            );
            return;
        }

        // ── DELETE /memory/:id ────────────────────────────────────────────
        if (req.method === 'DELETE' && /^\/memory\/[^/]+$/.test(url.pathname)) {
            const memoryId = url.pathname.split('/')[2] ?? '';
            sendJson(res, handleDeleteMemory({ memoryId }));
            return;
        }

        // ── POST /pipeline ────────────────────────────────────────────────
        if (req.method === 'POST' && url.pathname === '/pipeline') {
            const raw = await readBody(req);
            const parsed =
                /** @type {{ steps?: { prompt: string; waitMs?: number; from?: string }[]; from?: string } | null} */ (
                    tryParseJson(raw)
                );
            if (!parsed) {
                sendJson(res, { status: 400, body: { ok: false, error: 'JSON inválido' } });
                return;
            }
            sendJson(res, await handlePipeline(parsed));
            return;
        }

        // ── POST /inject ──────────────────────────────────────────────────
        if (req.method === 'POST' && url.pathname === '/inject') {
            // GAP-01 (fix): rate limiting por IP
            const clientIp = req.socket.remoteAddress ?? 'unknown';
            const rateCheck = checkInjectRate(clientIp);
            if (!rateCheck.allowed) {
                res.writeHead(429, {
                    'Content-Type': 'application/json',
                    'Retry-After': String(rateCheck.resetIn),
                });
                res.end(
                    JSON.stringify({
                        ok: false,
                        error: `Rate limit excedido. Tente novamente em ${rateCheck.resetIn}s.`,
                    }),
                );
                return;
            }
            const raw = await readBody(req);
            const parsed = /** @type {{ message?: string; from?: string } | null} */ (tryParseJson(raw));
            if (!parsed) {
                sendJson(res, { status: 400, body: { ok: false, error: 'JSON inválido' } });
                return;
            }
            sendJson(res, await handleInject(parsed));
            return;
        }

        // ── GET /gh/issues ────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/issues') {
            sendJson(
                res,
                await handleGhIssues({
                    state: url.searchParams.get('state') ?? 'open',
                    limit: Number(url.searchParams.get('limit') ?? '15'),
                }),
            );
            return;
        }

        // ── GET /gh/prs ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/prs') {
            sendJson(
                res,
                await handleGhPrs({
                    state: url.searchParams.get('state') ?? 'open',
                    limit: Number(url.searchParams.get('limit') ?? '15'),
                }),
            );
            return;
        }

        // ── GET /gh/ci ────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/gh/ci') {
            sendJson(
                res,
                await handleGhCi({
                    limit: Number(url.searchParams.get('limit') ?? '15'),
                }),
            );
            return;
        }

        // ── GET /git/status ───────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/git/status') {
            sendJson(res, await handleGitStatus());
            return;
        }

        // ── GET /git/log ──────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/git/log') {
            sendJson(
                res,
                await handleGitLog({
                    n: Number(url.searchParams.get('n') ?? '20'),
                }),
            );
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
