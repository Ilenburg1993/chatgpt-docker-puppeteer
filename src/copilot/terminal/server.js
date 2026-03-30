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
 * | GET    | /metrics            | Métricas Prometheus (text/plain)      |
 * | GET    | /context            | Uso de contexto/tokens em tempo real  |
 * | GET    | /events             | SSE — stream de eventos da LLM-B      |
 * | GET    | /sessions           | Lista hub_sessions persistidas        |
 * | GET    | /sessions/:id/turns | Turnos de uma sessão específica       |
 * | POST   | /memory             | Armazena uma memória semântica        |
 * | GET    | /memory             | Recupera memórias semânticas          |
 * | DELETE | /memory/:id         | Remove uma memória semântica          |
 * | POST   | /pipeline           | Executa sequência ordenada de turnos  |
 * | POST   | /inject             | Injeta uma mensagem na LLM-B          |
 * | POST   | /dialog/pause       | Pausa o dialog loop (NEW-PAUSE)       |
 * | POST   | /dialog/resume      | Retoma o dialog loop (NEW-PAUSE)      |
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
import { MAX_SSE_CLIENTS } from '../core/constants.js';
import { println } from './dialog.js';
import {
    handleDeleteCustomTool,
    handleDeleteMemory,
    handleGetConfig,
    handleGetContext,
    handleGetCustomTools,
    handleGetSkills,
    handleGetToolsConfig,
    handleGhCi,
    handleGhIssues,
    handleGhPrs,
    handleGitLog,
    handleGitStatus,
    handleHealth,
    handleInject,
    handleListSessions,
    handleListTurns,
    handleMetrics,
    handlePipeline,
    handleRecallMemories,
    handleRegisterCustomTool,
    handleSetInfiniteSessionConfig,
    handleSetSkills,
    handleSetToolsConfig,
    handleStoreMemory,
    handleDialogPause,
    handleDialogResume,
} from './http-handlers.js';
import { getSseClients, getSseCriticalClients } from './state.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

// ─── Rate limiter simples para POST /inject ───────────────────────────────────
// GAP-01 (fix): limitar POST /inject a 10 requisições por IP por janela de 60s
// (previne flood / DDOS acidental no endpoint de injeção)

// SEC-V06: rate limiter em memória — contadores são zerados a cada restart do processo.
// Em produção, use redis ou implemente na camada de reverse proxy (nginx/Caddy) para persistência.

/**
 * Cria um rate limiter em memória por chave (IP, IP+endpoint, etc.).
 *
 * @param {number} max - Máximo de requisições permitidas por janela
 * @param {number} windowMs - Duração da janela em ms
 * @returns {{ check: (key: string) => { allowed: boolean; remaining: number; resetIn: number } }}
 */
function createRateLimiter(max, windowMs) {
    /** @type {Map<string, { count: number; resetAt: number }>} */
    const store = new Map();
    return {
        check(key) {
            const now = Date.now();
            // BUG-N03 (fix): purgar entradas expiradas para evitar memory leak em uptime longo
            for (const [k, bucket] of store) {
                if (now >= bucket.resetAt) store.delete(k);
            }
            let bucket = store.get(key);
            if (!bucket || now >= bucket.resetAt) {
                bucket = { count: 0, resetAt: now + windowMs };
                store.set(key, bucket);
            }
            bucket.count++;
            return {
                allowed: bucket.count <= max,
                remaining: Math.max(0, max - bucket.count),
                resetIn: Math.ceil((bucket.resetAt - now) / 1000),
            };
        },
    };
}

const INJECT_RATE_MAX = Number(process.env.LLM_B_INJECT_RATE_MAX ?? 10);
const INJECT_RATE_WINDOW_MS = Number(process.env.LLM_B_INJECT_RATE_WINDOW_MS ?? 60_000);
const _injectRateLimiter = createRateLimiter(INJECT_RATE_MAX, INJECT_RATE_WINDOW_MS);

/**
 * Verifica se o IP excedeu o limite de requisições para /inject.
 *
 * @param {string} ip
 * @returns {{ allowed: boolean; remaining: number; resetIn: number }}
 */
function checkInjectRate(ip) {
    return _injectRateLimiter.check(ip);
}

// SEC-N02 (fix): rate-limit por endpoint para /pipeline, /memory (write), /attach
const WRITE_RATE_MAX = 5; // mais restritivo que /inject
const WRITE_RATE_WINDOW_MS = 60_000;
const _writeRateLimiter = createRateLimiter(WRITE_RATE_MAX, WRITE_RATE_WINDOW_MS);

/**
 * Verifica rate-limit para endpoints de escrita (/pipeline, /memory, /attach, /context-send).
 *
 * @param {string} ipEndpoint - Combinação de IP + endpoint key para isolamento por rota
 * @returns {{ allowed: boolean; remaining: number; resetIn: number }}
 */
function checkWriteRate(ipEndpoint) {
    return _writeRateLimiter.check(ipEndpoint);
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
    // NEW-06: CORS wildcard é seguro aqui porque o server faz bind em 127.0.0.1 (loopback only).
    // Apenas código local pode alcançar esta porta — não há exposição externa.
    if (result.cors) headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(result.status, headers);
    res.end(JSON.stringify(result.body));
}

/**
 * Lê o body de uma requisição HTTP e retorna como string. Rejeita payloads acima de MAX_BODY_BYTES (proteção contra
 * DoS).
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
    const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
    return new Promise((resolve, reject) => {
        let data = '';
        let bytes = 0;
        req.on('data', (chunk) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > MAX_BODY_BYTES) {
                req.destroy();
                reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
                return;
            }
            data += chunk;
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
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
    // GAP-N03/UPG-N04 (fix): autenticação por token estático opcional no terminal LLM-B
    const TERMINAL_TOKEN = process.env.LLM_B_TERMINAL_TOKEN ?? null;

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${INJECT_PORT}`);
        // UPG-N23 (fix): propagar X-Request-ID para rastreabilidade de requests
        const requestId = req.headers['x-request-id']
            ? String(req.headers['x-request-id']).slice(0, 64)
            : `llmb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        res.setHeader('X-Request-ID', requestId);
        try {
            // ── GET /health ───────────────────────────────────────────────────
            // /health é isento de auth para permitir healthchecks sem token
            if (req.method === 'GET' && url.pathname === '/health') {
                sendJson(res, handleHealth());
                return;
            }

            // ── GET /metrics ──────────────────────────────────────────────────
            // UPG-PROP-08 (fix): /metrics é isento de auth (compatibilidade com Prometheus scrape)
            if (req.method === 'GET' && url.pathname === '/metrics') {
                const result = handleMetrics();
                res.writeHead(result.status, { 'Content-Type': result.contentType });
                res.end(result.body);
                return;
            }

            // Verificar token se configurado (todos os outros endpoints)
            if (TERMINAL_TOKEN) {
                const authHeader = req.headers['authorization'] ?? '';
                if (authHeader !== `Bearer ${TERMINAL_TOKEN}`) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
                    return;
                }
            }

            // ── GET /context (UPG-04) ─────────────────────────────────────────
            if (req.method === 'GET' && url.pathname === '/context') {
                sendJson(res, handleGetContext());
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

            // ── GET /config/tools/custom (AI.2) ───────────────────────────────
            if (req.method === 'GET' && url.pathname === '/config/tools/custom') {
                sendJson(res, handleGetCustomTools());
                return;
            }

            // ── POST /config/tools/custom (AI.2) ──────────────────────────────
            if (req.method === 'POST' && url.pathname === '/config/tools/custom') {
                readBody(req)
                    .then((raw) => {
                        const body = raw ? JSON.parse(raw) : {};
                        sendJson(res, handleRegisterCustomTool(body));
                    })
                    .catch((err) => sendJson(res, { status: 400, body: { ok: false, error: err.message } }));
                return;
            }

            // ── DELETE /config/tools/custom/:name (AI.2) ──────────────────────
            if (req.method === 'DELETE' && url.pathname.startsWith('/config/tools/custom/')) {
                const name = url.pathname.slice('/config/tools/custom/'.length);
                sendJson(res, handleDeleteCustomTool(decodeURIComponent(name)));
                return;
            }

            // ── GET /events ───────────────────────────────────────────────────
            if (req.method === 'GET' && url.pathname === '/events') {
                const isCriticalOnly = url.searchParams.get('level') === 'critical';
                const _sseClients = getSseClients();
                const _sseCriticalClients = getSseCriticalClients();
                const totalSse = _sseClients.size + _sseCriticalClients.size;
                if (totalSse >= MAX_SSE_CLIENTS) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Limite de clientes SSE atingido' }));
                    return;
                }
                // SEC-VULN-06 (fix): sliding window por IP — máximo de 5 conexões SSE por IP
                const sseIp = req.socket?.remoteAddress ?? 'unknown';
                const sseIpRate = checkWriteRate(`sse:${sseIp}`);
                if (!sseIpRate.allowed) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(
                        JSON.stringify({ ok: false, error: `Muitas conexões SSE. Tente em ${sseIpRate.resetIn}s.` }),
                    );
                    return;
                }
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
                // SEC-N02 (fix): rate-limit em /memory write (5 req/min por IP)
                const memIp = req.socket.remoteAddress ?? 'unknown';
                const memRate = checkWriteRate(`${memIp}:memory`);
                if (!memRate.allowed) {
                    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(memRate.resetIn) });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: `Rate limit excedido em /memory. Tente em ${memRate.resetIn}s.`,
                        }),
                    );
                    return;
                }
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
                // SEC-N02 (fix): rate-limit em /pipeline (5 req/min por IP)
                const pipelineIp = req.socket.remoteAddress ?? 'unknown';
                const pipelineRate = checkWriteRate(`${pipelineIp}:pipeline`);
                if (!pipelineRate.allowed) {
                    res.writeHead(429, {
                        'Content-Type': 'application/json',
                        'Retry-After': String(pipelineRate.resetIn),
                    });
                    res.end(
                        JSON.stringify({
                            ok: false,
                            error: `Rate limit excedido em /pipeline. Tente em ${pipelineRate.resetIn}s.`,
                        }),
                    );
                    return;
                }
                const raw = await readBody(req);
                const parsed = /**
                 * @type {{
                 *     steps?: { prompt: string; waitMs?: number; from?: string }[];
                 *     from?: string;
                 * } | null}
                 */ (tryParseJson(raw));
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

            // ── POST /dialog/pause — NEW-PAUSE ────────────────────────────────
            if (req.method === 'POST' && url.pathname === '/dialog/pause') {
                sendJson(res, await handleDialogPause());
                return;
            }

            // ── POST /dialog/resume — NEW-PAUSE ───────────────────────────────
            if (req.method === 'POST' && url.pathname === '/dialog/resume') {
                sendJson(res, await handleDialogResume());
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
        } catch (/** @type {any} */ err) {
            if (err?.code === 'PAYLOAD_TOO_LARGE') {
                if (!res.headersSent) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Payload too large (máx 2 MB)' }));
                }
            } else {
                log('ERROR', `[TerminalServer] Erro não tratado: ${err?.message ?? err}`);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
                }
            }
        }
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
