// @ts-check
/**
 * src/copilot/terminal/server.js
 *
 * Servidor HTTP de injeção do Terminal Permanente LLM-B.
 *
 * Cria e gerencia o servidor HTTP interno (porta LLM_B_TERMINAL_PORT, padrão 3009)
 * que expõe os seguintes endpoints:
 *
 * | Método | Caminho              | Descrição                                      |
 * |--------|----------------------|------------------------------------------------|
 * | GET    | /health              | Status do agente e do dialog loop              |
 * | GET    | /events              | SSE — stream de eventos da LLM-B               |
 * | GET    | /sessions            | Lista hub_sessions persistidas                 |
 * | GET    | /sessions/:id/turns  | Turnos de uma sessão específica                |
 * | POST   | /memory              | Armazena uma memória semântica                 |
 * | GET    | /memory              | Recupera memórias semânticas                   |
 * | DELETE | /memory/:id          | Remove uma memória semântica                   |
 * | POST   | /pipeline            | Executa sequência ordenada de turnos           |
 * | POST   | /inject              | Injeta uma mensagem na LLM-B                   |
 * | GET    | /gh/issues           | Lista GitHub issues via gh CLI                 |
 * | GET    | /gh/prs              | Lista GitHub pull requests via gh CLI          |
 * | GET    | /gh/ci               | Lista GitHub CI runs via gh CLI                |
 * | GET    | /git/status          | Git status via spawn                           |
 * | GET    | /git/log             | Git log via spawn                              |
 *
 * @module copilot/terminal/server
 */

import { log } from '#core/logger';
import http from 'node:http';
import { alwaysAliveAgent } from '../always-alive.js';
import { conversationStore } from '../conversation-hub/store.js';
import { listIssues, listPrs, listRuns } from '../gh-bridge.js';
import { gitLog, gitStatus } from '../git-bridge.js';
import { println, sendTurn } from './dialog.js';
import { getBusy, getHubSessionId, getSseCriticalClients, getSseClients } from './state.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

// ─── Servidor HTTP ────────────────────────────────────────────────────────────

/**
 * Cria o servidor HTTP interno para injeção de mensagens de LLM-A e consulta de estado.
 *
 * @returns {http.Server} Servidor HTTP iniciado na porta `INJECT_PORT`
 */
export function createInjectServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost:${INJECT_PORT}`);

        // ── GET /health ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    ok: true,
                    dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
                    agentStatus: alwaysAliveAgent.status,
                    busy: getBusy(),
                    hubSessionId: getHubSessionId(),
                    sseClients: getSseClients().size,
                }),
            );
            return;
        }

        // ── GET /events ───────────────────────────────────────────────────
        // GET /events           → stream completo: "reply", "ready", "stalled", "system"
        // GET /events?level=critical → apenas eventos críticos: "stalled", "fatal", "system"
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
                res.end(JSON.stringify({ ok: true, sessions, current: getHubSessionId() }));
            } catch (/** @type {any} */ e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
            return;
        }

        // ── GET /sessions/:id/turns ───────────────────────────────────────
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

        // ── POST /memory ──────────────────────────────────────────────────
        if (req.method === 'POST' && url.pathname === '/memory') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                try {
                    const parsed = /** @type {{ tag?: string; content?: string }} */ (JSON.parse(body));
                    if (!parsed.content) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: '"content" obrigatório' }));
                        return;
                    }
                    const _hubSessionId = getHubSessionId();
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

        // ── GET /memory ───────────────────────────────────────────────────
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

        // ── DELETE /memory/:id ────────────────────────────────────────────
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

        // ── POST /pipeline ────────────────────────────────────────────────
        if (req.method === 'POST' && url.pathname === '/pipeline') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
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

                    if (reply === null) {
                        res.writeHead(409, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            ok: false,
                            error: `Step ${i + 1} retornou null (LLM-B ocupada) — pipeline interrompido`,
                            results,
                        }));
                        return;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, results }));
            });
            return;
        }

        // ── POST /inject ──────────────────────────────────────────────────
        if (req.method === 'POST' && url.pathname === '/inject') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
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
                        res.end(JSON.stringify({
                            ok: reply !== null,
                            reply: reply ?? null,
                            durationMs: Date.now() - t0,
                            from,
                        }));
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
