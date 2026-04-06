// @ts-check
/**
 * src/copilot/terminal/handlers-agent.js
 *
 * Handlers para endpoints do agente/dialog: /pipeline, /inject, /dialog/pause, /dialog/resume.
 *
 * @module copilot/terminal/handlers-agent
 * @see module:copilot/terminal/http-handlers
 */

import { alwaysAliveAgent } from '../agent/index.js';
import { sendTurn } from './dialog.js';
import { attachmentToEmbed, embedMultiple, MAX_EMBED_BYTES, readFileContext } from './file-context.js';
import { recordInjectHistory } from './state.js';

// ─── Tipos auxiliares ─────────────────────────────────────────────────────────

/**
 * @typedef {import('./handlers-shared.js').HandlerResult} HandlerResult
 */

/**
 * Valores válidos para o campo `from` nos endpoints /inject e /pipeline.
 *
 * @type {ReadonlySet<string>}
 */
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system', 'llm_a']);

// ─── GET /context ─────────────────────────────────────────────────────────────

/**
 * UPG-04: Endpoint dedicado para monitoramento de uso de contexto.
 *
 * @returns {HandlerResult}
 */
export function handleGetContext() {
    const snapshot = alwaysAliveAgent.getStatusSnapshot();
    const cw = snapshot.contextWindow;
    if (!cw) {
        return {
            status: 200,
            cors: true,
            body: {
                ok: true,
                tokens: 0,
                tokenLimit: 0,
                utilization: 0,
                utilizationPercent: 0,
                lastCheckpointPath: snapshot.lastCheckpointPath,
                warning: 'none',
            },
        };
    }
    const utilization = cw.utilization;
    /** @type {'none' | 'moderate' | 'high' | 'critical'} */
    let warning = 'none';
    if (utilization >= 0.95) warning = 'critical';
    else if (utilization >= 0.8) warning = 'high';
    else if (utilization >= 0.6) warning = 'moderate';
    return {
        status: 200,
        cors: true,
        body: {
            ok: true,
            tokens: cw.tokens,
            tokenLimit: cw.tokenLimit,
            utilization,
            utilizationPercent: Math.round(utilization * 100),
            lastCheckpointPath: snapshot.lastCheckpointPath,
            warning,
        },
    };
}

// ─── POST /pipeline ─────────────────────────────────────────────────────────

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

    const MAX_PIPELINE_STEPS = 20;
    if (body.steps.length > MAX_PIPELINE_STEPS) {
        return {
            status: 400,
            body: {
                ok: false,
                error: `Máximo ${MAX_PIPELINE_STEPS} steps por pipeline (recebido: ${body.steps.length})`,
            },
        };
    }

    const rawGlobalFrom = body.from ?? 'llm-a';
    const globalFrom = typeof rawGlobalFrom === 'string' && ALLOWED_FROM.has(rawGlobalFrom) ? rawGlobalFrom : 'llm-a';
    /** @type {{ step: number; prompt: string; reply: string | null; durationMs: number }[]} */
    const results = [];

    for (let i = 0; i < body.steps.length; i++) {
        const step = body.steps[i];
        if (!step?.prompt) continue;
        const rawStepFrom = step.from ?? globalFrom;
        const from = ALLOWED_FROM.has(rawStepFrom) ? rawStepFrom : globalFrom;

        if (step.waitMs && step.waitMs > 0) {
            // T-06: limite máximo de 30s por step wait para evitar DoS ou bloqueio indefinido
            const MAX_WAIT_MS = 30_000;
            await new Promise((r) => setTimeout(r, Math.min(step.waitMs ?? 0, MAX_WAIT_MS)));
        }

        const t0 = Date.now();
        const reply = await sendTurn(step.prompt, from).catch(() => null);
        results.push({ step: i + 1, prompt: step.prompt, reply: reply ?? null, durationMs: Date.now() - t0 });

        if (reply === null) {
            return {
                status: 409,
                body: {
                    ok: false,
                    error: `Step ${i + 1} retornou null (erro interno na LLM-B) — pipeline interrompido`,
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
 * @param {{
 *     message?: string;
 *     from?: string;
 *     timeout?: number;
 *     context_files?: string[];
 *     attachments?: {
 *         type?: string;
 *         content?: string;
 *         path?: string;
 *         displayName?: string;
 *         filePath?: string;
 *         selection?: object;
 *         text?: string;
 *     }[];
 * } | null} body
 * @returns {Promise<HandlerResult>}
 */
export async function handleInject(body) {
    const message = body?.message?.trim();
    if (!message) {
        return { status: 400, body: { ok: false, error: '"message" é obrigatório' } };
    }

    const rawFrom = body?.from ?? 'llm-a';
    const from = typeof rawFrom === 'string' && ALLOWED_FROM.has(rawFrom) ? rawFrom : 'llm-a';

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

    const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
    if (rawAttachments.length > 0) {
        let embedParts;
        try {
            // T-07: capturar erros de attachment individualmente para não mascarar falhas
            embedParts = await Promise.all(rawAttachments.map(attachmentToEmbed));
        } catch (/** @type {any} */ attErr) {
            return { status: 400, body: { ok: false, error: `Falha ao processar attachments: ${attErr.message}` } };
        }
        const validParts = embedParts.filter(/** @type {(s: string | null) => s is string} */ (s) => s !== null);
        if (validParts.length > 0) {
            let totalBytes = 0;
            const limitedParts = [];
            for (const part of validParts) {
                const partBytes = Buffer.byteLength(part, 'utf8');
                if (totalBytes + partBytes > MAX_EMBED_BYTES) break;
                limitedParts.push(part);
                totalBytes += partBytes;
            }
            if (limitedParts.length > 0) {
                enrichedMessage = limitedParts.join('\n\n') + '\n\n' + enrichedMessage;
            }
        }
    }

    const t0 = Date.now();
    try {
        const reply = await sendTurn(enrichedMessage, from);
        const durationMs = Date.now() - t0;
        recordInjectHistory({
            ts: t0,
            from,
            message: message.slice(0, 200),
            replySnippet: reply ? reply.slice(0, 200) : null,
            durationMs,
            ok: reply !== null,
        });
        return {
            status: reply !== null ? 200 : 409,
            body: { ok: reply !== null, reply: reply ?? null, durationMs, from },
        };
    } catch (/** @type {any} */ e) {
        recordInjectHistory({
            ts: t0,
            from,
            message: message.slice(0, 200),
            replySnippet: null,
            durationMs: Date.now() - t0,
            ok: false,
        });
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── Pause / Resume ───────────────────────────────────────────────────────────

/**
 * Handler para POST /dialog/pause.
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogPause() {
    if (!alwaysAliveAgent.dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop não está ativo.' } };
    }
    try {
        await alwaysAliveAgent.pauseDialogLoop();
        return {
            status: 200,
            body: { ok: true, message: 'Dialog loop pausado. Use POST /dialog/resume para retomar.' },
        };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

/**
 * Handler para POST /dialog/resume.
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogResume() {
    if (alwaysAliveAgent.dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop já está ativo.' } };
    }
    try {
        await alwaysAliveAgent.resumeDialogLoop();
        return { status: 200, body: { ok: true, message: 'Dialog loop retomado.' } };
    } catch (/** @type {any} */ e) {
        return { status: 500, body: { ok: false, error: e.message } };
    }
}

// ─── F45.3: Handoff API ──────────────────────────────────────────────────────

/**
 * GET /handoff — lista handoffs pendentes e histórico.
 *
 * @returns {HandlerResult}
 */
export function handleGetHandoffs() {
    const handoffMgr = alwaysAliveAgent.getHandoffManager?.();
    if (!handoffMgr) {
        return { status: 501, body: { ok: false, error: 'HandoffManager não disponível.' } };
    }
    return {
        status: 200,
        body: {
            ok: true,
            pending: handoffMgr.getPending(),
            history: handoffMgr.getHistory(),
        },
    };
}

/**
 * POST /handoff/:id/accept — aceita um handoff pendente.
 *
 * @param {{ handoffId?: string }} params
 * @returns {HandlerResult}
 */
export function handleAcceptHandoff(params) {
    const handoffMgr = alwaysAliveAgent.getHandoffManager?.();
    if (!handoffMgr) {
        return { status: 501, body: { ok: false, error: 'HandoffManager não disponível.' } };
    }
    const id = params?.handoffId;
    if (!id) {
        return { status: 400, body: { ok: false, error: 'handoffId é obrigatório.' } };
    }
    const result = handoffMgr.accept(id);
    return { status: result.accepted ? 200 : 404, body: { ok: result.accepted, ...result } };
}

/**
 * POST /handoff/:id/reject — rejeita um handoff pendente.
 *
 * @param {{ handoffId?: string }} params
 * @param {{ reason?: string }} [body]
 * @returns {HandlerResult}
 */
export function handleRejectHandoff(params, body) {
    const handoffMgr = alwaysAliveAgent.getHandoffManager?.();
    if (!handoffMgr) {
        return { status: 501, body: { ok: false, error: 'HandoffManager não disponível.' } };
    }
    const id = params?.handoffId;
    if (!id) {
        return { status: 400, body: { ok: false, error: 'handoffId é obrigatório.' } };
    }
    const result = handoffMgr.reject(id, body?.reason);
    return { status: 200, body: { ok: true, ...result } };
}
