// @ts-check
/**
 * src/copilot/terminal/http-handlers.js
 *
 * Handlers de lógica pura para os endpoints do Terminal LLM-B.
 *
 * Cada handler recebe parâmetros tipados e retorna `{ status, body }` (ou `null` para endpoints de streaming SSE, que
 * exigem acesso direto ao `res`). Isso permite reutilização por:
 *
 * - `terminal/server.js` — servidor HTTP raw (porta 3009, node:http)
 * - futuro Express router em `api/copilot-router.js` — fachada REST unificada
 *
 * Padrão: **Command Pattern** — cada função encapsula uma intenção de domínio.
 *
 * @module copilot/terminal/http-handlers
 */

import { alwaysAliveAgent } from '../agent/always-alive.js';
import { listIssues, listPrs, listRuns } from '../bridges/gh-bridge.js';
import { gitLog, gitStatus } from '../bridges/git-bridge.js';
import { conversationStore } from '../conversation-hub/store.js';
import { sendTurn } from './dialog.js';
import { embedMultiple, readFileContext } from './file-context.js';
import { getBusy, getHubSessionId, getPlanMode, getSseClients, getSseCriticalClients } from './state.js';

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

/**
 * Resultado padrão de um handler HTTP.
 *
 * @typedef {{ status: number; body: unknown; cors?: boolean }} HandlerResult
 */

// ─── GET /health ──────────────────────────────────────────────────────────────

/**
 * Retorna o status atual do agente e do dialog loop.
 *
 * @returns {HandlerResult}
 */
export function handleHealth() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    return {
        status: 200,
        body: {
            ok: true,
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            agentStatus: alwaysAliveAgent.status,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            sseClients: getSseClients().size,
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
            // AA.5: expor dados reais de uso de contexto
            contextWindow: snapshot.contextWindow,
        },
    };
}

// ─── GET /sessions ────────────────────────────────────────────────────────────

/**
 * Lista hub_sessions persistidas.
 *
 * @param {{ limit?: number; offset?: number; status?: string }} params
 * @returns {HandlerResult}
 */
export function handleListSessions({ limit = 20, offset = 0, status } = {}) {
    try {
        const sessions = conversationStore.listHubSessions({
            limit: isNaN(limit) ? 20 : limit,
            offset: isNaN(offset) ? 0 : offset,
            status: /** @type {any} */ (status),
        });
        return { status: 200, cors: true, body: { ok: true, sessions, current: getHubSessionId() } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /sessions/:id/turns ──────────────────────────────────────────────────

/**
 * Retorna os turnos de uma sessão específica.
 *
 * @param {{ sessionId: string; limit?: number; offset?: number }} params
 * @returns {HandlerResult}
 */
export function handleListTurns({ sessionId, limit = 50, offset = 0 }) {
    try {
        const turns = conversationStore.readTurns(sessionId, {
            limit: isNaN(limit) ? 50 : limit,
            offset: isNaN(offset) ? 0 : offset,
        });
        return { status: 200, cors: true, body: { ok: true, turns, sessionId } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── POST /memory ─────────────────────────────────────────────────────────────

/**
 * Armazena uma memória semântica.
 *
 * @param {{ content?: string; tag?: string }} body
 * @returns {HandlerResult}
 */
export function handleStoreMemory(body) {
    if (!body?.content) {
        return { status: 400, body: { ok: false, error: '"content" obrigatório' } };
    }
    try {
        const _hubSessionId = getHubSessionId();
        const id = conversationStore.storeMemory({
            content: body.content,
            tag: body.tag ?? 'geral',
            ...(_hubSessionId ? { hubSessionId: _hubSessionId } : {}),
        });
        return { status: 201, body: { ok: true, id } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /memory ──────────────────────────────────────────────────────────────

/**
 * Recupera memórias semânticas.
 *
 * @param {{ tag?: string | null; search?: string | null; limit?: number }} params
 * @returns {HandlerResult}
 */
export function handleRecallMemories({ tag, search, limit = 20 } = {}) {
    try {
        const memories = conversationStore.recallMemories({
            ...(tag ? { tag } : {}),
            ...(search ? { search } : {}),
            limit: isNaN(/** @type {number} */ (limit)) ? 20 : /** @type {number} */ (limit),
        });
        return { status: 200, cors: true, body: { ok: true, memories } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── DELETE /memory/:id ───────────────────────────────────────────────────────

/**
 * Remove uma memória semântica.
 *
 * @param {{ memoryId: string }} params
 * @returns {HandlerResult}
 */
export function handleDeleteMemory({ memoryId }) {
    try {
        const deleted = conversationStore.deleteMemory(memoryId);
        return { status: deleted ? 200 : 404, cors: true, body: { ok: deleted, id: memoryId } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── POST /pipeline ───────────────────────────────────────────────────────────

/**
 * Executa uma sequência ordenada de turnos (pipeline).
 *
 * @param {{ steps?: { prompt: string; waitMs?: number; from?: string }[]; from?: string } | null} body
 * @returns {Promise<HandlerResult>}
 */
export async function handlePipeline(body) {
    if (!Array.isArray(body?.steps) || body.steps.length === 0) {
        return { status: 400, body: { ok: false, error: '"steps" deve ser um array não vazio' } };
    }

    const globalFrom = body.from ?? 'llm-a';
    /** @type {{ step: number; prompt: string; reply: string | null; durationMs: number }[]} */
    const results = [];

    for (let i = 0; i < body.steps.length; i++) {
        const step = body.steps[i];
        if (!step?.prompt) continue;
        const from = step.from ?? globalFrom;

        if (step.waitMs && step.waitMs > 0) {
            await new Promise((r) => setTimeout(r, step.waitMs));
        }

        const t0 = Date.now();
        const reply = await sendTurn(step.prompt, from).catch(() => null);
        results.push({ step: i + 1, prompt: step.prompt, reply: reply ?? null, durationMs: Date.now() - t0 });

        if (reply === null) {
            return {
                status: 409,
                body: {
                    ok: false,
                    error: `Step ${i + 1} retornou null (LLM-B ocupada) — pipeline interrompido`,
                    results,
                },
            };
        }
    }

    return { status: 200, body: { ok: true, results } };
}

// ─── POST /inject ─────────────────────────────────────────────────────────────

/**
 * Injeta uma mensagem na LLM-B e aguarda resposta.
 *
 * Aceita opcionalmente:
 *
 * - `context_files: string[]` — lê o conteúdo de cada arquivo e o embute como bloco markdown antes da mensagem.
 * - `attachments: Array<{type: 'file'|'content', path?: string, content?: string, mimeType?: string}>` — contexto extra
 *   embutido como bloco markdown na mensagem (MELHORIA-03: suporte a attachments do SDK emulado via embed).
 *
 * @param {{
 *     message?: string;
 *     from?: string;
 *     timeout?: number;
 *     context_files?: string[];
 *     attachments?: { type?: string; content?: string; path?: string }[];
 * } | null} body
 * @returns {Promise<HandlerResult>}
 */
export async function handleInject(body) {
    const message = body?.message?.trim();
    if (!message) {
        return { status: 400, body: { ok: false, error: '"message" é obrigatório' } };
    }

    const from = body?.from ?? 'llm-a';

    // Embed de context_files, se fornecidos
    let enrichedMessage = message;
    const contextFiles = Array.isArray(body?.context_files) ? body.context_files : [];
    if (contextFiles.length > 0) {
        try {
            const ctxs = await Promise.all(contextFiles.map(readFileContext));
            enrichedMessage = embedMultiple(ctxs, message);
        } catch (/** @type {any} */ embedErr) {
            return {
                status: 400,
                body: { ok: false, error: `Falha ao processar context_files: ${embedErr.message}` },
            };
        }
    }
    // MELHORIA-03 (fix): suporte a attachments via embed de conteúdo inline
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    for (const attachment of attachments) {
        if (attachment && typeof attachment.content === 'string') {
            const label = attachment.path ?? 'attachment';
            enrichedMessage = `\`\`\`\n${attachment.content}\n\`\`\`\n*(${label})*\n\n${enrichedMessage}`;
        }
    }
    const t0 = Date.now();
    try {
        const reply = await sendTurn(enrichedMessage, from);
        return {
            status: reply !== null ? 200 : 409,
            body: { ok: reply !== null, reply: reply ?? null, durationMs: Date.now() - t0, from },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/issues ───────────────────────────────────────────────────────────

/**
 * Lista GitHub issues via gh CLI.
 *
 * @param {{ state?: string; limit?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhIssues({ state = 'open', limit = 15 } = {}) {
    try {
        const issues = await listIssues({ state: /** @type {any} */ (state), limit });
        return { status: 200, cors: true, body: { ok: true, issues } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/prs ──────────────────────────────────────────────────────────────

/**
 * Lista GitHub pull requests via gh CLI.
 *
 * @param {{ state?: string; limit?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhPrs({ state = 'open', limit = 15 } = {}) {
    try {
        const prs = await listPrs({ state: /** @type {any} */ (state), limit });
        return { status: 200, cors: true, body: { ok: true, prs } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /gh/ci ───────────────────────────────────────────────────────────────

/**
 * Lista GitHub CI runs via gh CLI.
 *
 * @param {{ limit?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGhCi({ limit = 15 } = {}) {
    try {
        const runs = await listRuns({ limit });
        return { status: 200, cors: true, body: { ok: true, runs } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /git/status ──────────────────────────────────────────────────────────

/**
 * Retorna o status do git.
 *
 * @returns {Promise<HandlerResult>}
 */
export async function handleGitStatus() {
    try {
        const entries = await gitStatus();
        return { status: 200, cors: true, body: { ok: true, entries } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── GET /git/log ─────────────────────────────────────────────────────────────

/**
 * Retorna o log do git.
 *
 * @param {{ n?: number }} params
 * @returns {Promise<HandlerResult>}
 */
export async function handleGitLog({ n = 20 } = {}) {
    try {
        const entries = await gitLog({ n });
        return { status: 200, cors: true, body: { ok: true, entries } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── Utilitários SSE ──────────────────────────────────────────────────────────

/**
 * Obtém os conjuntos de clientes SSE (leitura apenas, sem lógica de registro). O registro/remoção de clientes permanece
 * em `server.js` pois requer `req`/`res`.
 *
 * @returns {{ all: Set<import('node:http').ServerResponse>; critical: Set<import('node:http').ServerResponse> }}
 */
export function getSseClientSets() {
    return { all: getSseClients(), critical: getSseCriticalClients() };
}

// ─── GET /config ──────────────────────────────────────────────────────────────

/**
 * Retorna configuração dinâmica atual da sessão LLM-B.
 *
 * @returns {HandlerResult}
 */
export function handleGetConfig() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
            planMode: getPlanMode(),
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            busy: getBusy(),
            hubSessionId: getHubSessionId(),
            port: Number(process.env.LLM_B_TERMINAL_PORT ?? 3009),
            // AA.5: expor dados reais de uso de contexto
            contextWindow: snapshot.contextWindow,
        },
    };
}
