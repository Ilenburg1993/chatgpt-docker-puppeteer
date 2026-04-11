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
 * | GET    | /quota              | Dados de cota de PRs em tempo real    |
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
 * @see EventBus
 * @see module:copilot/terminal/route-table
 * @see module:copilot/terminal/repl
 */

import { defaultAuditLog } from '#copilot/audit';
import {
    COPILOT_READY_WEBHOOK,
    LLM_B_INJECT_RATE_MAX,
    LLM_B_INJECT_RATE_WINDOW_MS,
    LLM_B_SSE_RATE_MAX,
    LLM_B_SSE_RATE_WINDOW_MS,
    LLM_B_TERMINAL_PORT,
    LLM_B_TERMINAL_TOKEN,
    MAX_SSE_CLIENTS,
} from '#copilot/config';
import { log } from '#copilot/observability';
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { println } from './dialog.js';
import { handleMetrics } from './handlers/system-metrics.js';
import { registerClearRateLimiters } from './rate-limiter-state.js';
import { matchRoute } from './route-table.js';
import { getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from './state.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = LLM_B_TERMINAL_PORT;

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
 * @returns {{ check: (key: string) => { allowed: boolean; remaining: number; resetIn: number }; clear: () => void }}
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
        clear() {
            store.clear();
        },
    };
}

const INJECT_RATE_MAX = LLM_B_INJECT_RATE_MAX;
const INJECT_RATE_WINDOW_MS = LLM_B_INJECT_RATE_WINDOW_MS;
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

// F6.2 (BUG-MOD-04): rate limiter SSE separado — conexões persistentes têm padrão distinto de writes
const SSE_RATE_MAX = LLM_B_SSE_RATE_MAX;
const SSE_RATE_WINDOW_MS = LLM_B_SSE_RATE_WINDOW_MS;
const _sseRateLimiter = createRateLimiter(SSE_RATE_MAX, SSE_RATE_WINDOW_MS);

// F16.2 — registra função de limpeza para o módulo rate-limiter-state (sem circular dep)
registerClearRateLimiters(() => {
    _injectRateLimiter.clear();
    _writeRateLimiter.clear();
    _sseRateLimiter.clear();
    log('INFO', '[TerminalServer] Rate limiters resetados por emergency-reset.');
});

/**
 * Verifica rate-limit para conexões SSE (/events, /events/critical) — janela e limite independentes dos endpoints de
 * escrita.
 *
 * @param {string} ip - IP do cliente
 * @returns {{ allowed: boolean; remaining: number; resetIn: number }}
 */
function checkSseRate(ip) {
    return _sseRateLimiter.check(`sse:${ip}`);
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
 * F16.1 — Dispara o ready webhook (fire-and-forget) se `COPILOT_READY_WEBHOOK` estiver definido.
 *
 * @param {number} port - Porta em que o servidor está escutando
 * @returns {void}
 */
function _fireReadyWebhook(port) {
    const webhookUrl = COPILOT_READY_WEBHOOK;
    if (!webhookUrl) return;
    try {
        const parsed = new URL(webhookUrl);
        const payload = JSON.stringify({ ok: true, port, ts: Date.now() });
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            },
            (res) => log('INFO', `[TerminalServer] Ready webhook respondeu: ${res.statusCode}`),
        );
        req.on('error', (e) => log('WARN', `[TerminalServer] Ready webhook erro: ${e.message}`));
        req.setTimeout(5000, () => req.destroy());
        req.write(payload);
        req.end();
    } catch (/** @type {any} */ e) {
        log('WARN', `[TerminalServer] Ready webhook URL inválida: ${e?.message ?? e}`);
    }
}

/**
 * Cria o servidor HTTP interno para injeção de mensagens de LLM-A e consulta de estado.
 *
 * @returns {http.Server} Servidor HTTP iniciado na porta `INJECT_PORT`
 */
export function createInjectServer() {
    // GAP-N03/UPG-N04 (fix): autenticação por token estático opcional no terminal LLM-B
    const TERMINAL_TOKEN = LLM_B_TERMINAL_TOKEN;

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${INJECT_PORT}`);
        // UPG-N23 (fix): propagar X-Request-ID para rastreabilidade de requests
        const requestId = req.headers['x-request-id']
            ? String(req.headers['x-request-id']).slice(0, 64)
            : `llmb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        res.setHeader('X-Request-ID', requestId);
        try {
            const route = matchRoute(req.method ?? 'GET', url.pathname);

            // T-04/T-16: responder preflight CORS OPTIONS antes de qualquer auth/route check
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-ID',
                    'Access-Control-Max-Age': '86400',
                });
                res.end();
                return;
            }

            // ── Rotas não encontradas ─────────────────────────────────────────
            if (!route) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Not found' }));
                return;
            }

            // ── Auth bypass para rotas isentas (health, metrics, hub-health) ──
            // Demais rotas verificam token se configurado
            if (!route.skipAuth && TERMINAL_TOKEN) {
                // SEC-04 + T-18 fix: timingSafeEqual sem short-circuit para evitar timing leak
                const authHeader = req.headers['authorization'] ?? '';
                const expected = `Bearer ${TERMINAL_TOKEN}`;
                // Normalizar tamanho dos buffers para timingSafeEqual (requer mesma length)
                const maxLen = Math.max(authHeader.length, expected.length);
                const providedBuf = Buffer.from(authHeader.padEnd(maxLen));
                const expectedBuf = Buffer.from(expected.padEnd(maxLen));
                // Bitwise AND evita short-circuit — timingSafeEqual sempre executa
                const lengthMatch = authHeader.length === expected.length;
                const tokenMatch = timingSafeEqual(providedBuf, expectedBuf) && lengthMatch;
                if (!tokenMatch) {
                    // F15.3: registrar falha de autenticação no audit log
                    defaultAuditLog.record({
                        type: 'auth.failure',
                        data: { ip: req.socket?.remoteAddress ?? 'unknown', path: url.pathname, requestId },
                    });
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
                    return;
                }
            }

            // ── Rate limiting (por IP + endpoint key) ─────────────────────────
            if (route.rateLimiter) {
                const clientIp = req.socket?.remoteAddress ?? 'unknown';
                let rateResult;
                if (route.rateLimiter === 'inject') {
                    rateResult = checkInjectRate(clientIp);
                } else if (route.rateLimiter === 'write') {
                    rateResult = checkWriteRate(`${clientIp}:${route.rateLimiterKey ?? 'default'}`);
                } else if (route.rateLimiter === 'sse') {
                    rateResult = checkSseRate(clientIp);
                }
                if (rateResult && !rateResult.allowed) {
                    const msg =
                        route.rateLimiter === 'sse'
                            ? `Muitas conexões SSE. Tente em ${rateResult.resetIn}s.`
                            : `Rate limit excedido. Tente em ${rateResult.resetIn}s.`;
                    res.writeHead(429, {
                        'Content-Type': 'application/json',
                        'Retry-After': String(rateResult.resetIn),
                    });
                    res.end(JSON.stringify({ ok: false, error: msg }));
                    return;
                }
            }

            // ── Custom routes: /metrics (contentType especial) ────────────────
            if (route.custom && url.pathname === '/metrics') {
                const result = handleMetrics();
                res.writeHead(result.status, { 'Content-Type': result.contentType });
                res.end(result.body);
                return;
            }

            // ── Custom routes: /events (SSE) ─────────────────────────────────
            if (route.custom && url.pathname === '/events') {
                const isCriticalOnly = url.searchParams.get('level') === 'critical';
                const _sseClients = getSseClients();
                const _sseCriticalClients = getSseCriticalClients();
                const totalSse = _sseClients.size + _sseCriticalClients.size;
                if (totalSse >= MAX_SSE_CLIENTS) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Limite de clientes SSE atingido' }));
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                });
                res.write(`: connected (level=${isCriticalOnly ? 'critical' : 'all'})\n\n`);

                // FASE-12.2: replay de eventos perdidos via Last-Event-ID
                const lastEventId = Number(req.headers['last-event-id']) || 0;
                if (lastEventId > 0) {
                    const replayBuffer = getTerminalReplayBuffer();
                    const missed = replayBuffer.getAfter(lastEventId);
                    for (const evt of missed) {
                        if (res.writableEnded) break;
                        const safeEvent = String(evt.event).replace(/[\r\n]/g, '_');
                        res.write(`id: ${evt.id}\nevent: ${safeEvent}\ndata: ${JSON.stringify(evt.data)}\n\n`);
                    }
                }

                // PHASE-9: heartbeat periódico para manter conexão viva (proxy/LB timeout)
                const heartbeat = setInterval(() => {
                    try {
                        if (!res.writableEnded) res.write(`: heartbeat\n\n`);
                    } catch {
                        clearInterval(heartbeat);
                    }
                }, 30_000);
                if (isCriticalOnly) {
                    _sseCriticalClients.add(res);
                    req.on('close', () => {
                        clearInterval(heartbeat);
                        _sseCriticalClients.delete(res);
                    });
                } else {
                    _sseClients.add(res);
                    req.on('close', () => {
                        clearInterval(heartbeat);
                        _sseClients.delete(res);
                    });
                }
                return;
            }

            // ── Generic dispatch: body parsing + params + handler call ────────
            const handlerArg =
                route.body === 'json'
                    ? await readBody(req).then(tryParseJson)
                    : route.params
                      ? route.params(url, url.pathname)
                      : undefined;

            // Body parsing failed
            if (route.body === 'json' && handlerArg === null) {
                sendJson(res, { status: 400, body: { ok: false, error: 'JSON inválido' } });
                return;
            }

            const result = route.async ? await route.handler(handlerArg) : route.handler(handlerArg);
            sendJson(res, result);
        } catch (/** @type {any} */ err) {
            if (err?.code === 'PAYLOAD_TOO_LARGE') {
                if (!res.headersSent) {
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: 'Payload too large (máx 2 MB)' }));
                }
            } else {
                // F133: Em produção, não logar stack traces completos (apenas mensagem)
                const logMsg =
                    process.env.NODE_ENV === 'production'
                        ? `[TerminalServer] Erro interno: ${err?.message ?? 'unknown'}`
                        : `[TerminalServer] Erro não tratado: ${err?.stack ?? err?.message ?? err}`;
                log('ERROR', logMsg);
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
        _fireReadyWebhook(INJECT_PORT);
    });

    server.on('error', (/** @type {NodeJS.ErrnoException} */ e) => {
        log('ERROR', `[TerminalServer] Inject server erro: ${e.message}`);
        println(`[inject] Erro no servidor de injeção: ${e.message}`);
    });

    return server;
}
