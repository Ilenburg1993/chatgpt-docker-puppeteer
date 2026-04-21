// @ts-check
/**
 * @module copilot/presentation/agent-control
 * @file Superfície compartilhada de controle do agente consumida por `server` e `terminal`.
 *
 *   Esta camada concentra os handlers de context, inject, pipeline, dialog control e handoff, preservando o terminal como
 *   interface operacional da LLM-B, mas removendo a dependência direta de `server/` em `terminal/handlers/agent.js`.
 */

import { toError } from '#copilot/core';
import { projectAgentHttpError } from './agent-http-errors.js';
import {
    getAgentHandoffManager,
    getAgentRuntimeControlsTarget,
    pauseAgentDialogLoop,
    resumeAgentDialogLoop,
} from './runtime-controls.js';
import {
    attachmentToRuntimeEmbed,
    embedRuntimeMultiple,
    MAX_EMBED_BYTES,
    readRuntimeFileContext,
    sendRuntimeDialogTurn,
} from './runtime-dialog.js';
import { readAgentRuntimeOverview } from './runtime-overview.js';
import { readRuntimeIdFromParams } from './runtime-targeting.js';
import { recordRuntimeInjectHistory } from './runtime-ui-state.js';

/**
 * @typedef {import('../terminal/handlers/shared.js').HandlerResult} HandlerResult
 */

/**
 * Valores válidos para o campo `from` nos endpoints /inject e /pipeline.
 *
 * @type {ReadonlySet<string>}
 */
const ALLOWED_FROM = new Set(['llm-a', 'user', 'system', 'llm_a']);

/**
 * @param {string | null | undefined} [runtimeId]
 * @returns {import('../agent/always-alive.js').AlwaysAliveAgent}
 */
function getAgent(runtimeId = null) {
    return getAgentRuntimeControlsTarget(runtimeId);
}

/**
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {string | null}
 */
function resolveRuntimeIdParam(params) {
    return readRuntimeIdFromParams(params);
}

/**
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {Record<string, unknown> | null}
 */
function extractRequestBody(params) {
    if (!params || typeof params !== 'object') return null;
    const body = params['body'];
    return body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {Record<string, unknown>}
 */
function resolveAgentControlInput(params) {
    return extractRequestBody(params) ?? (params && typeof params === 'object' ? params : {});
}

/**
 * UPG-04: Endpoint dedicado para monitoramento de uso de contexto.
 *
 * @returns {HandlerResult}
 */
export function handleGetContext(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    const { snap: snapshot, contextWindow: cw } = readAgentRuntimeOverview(runtimeId);
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

/**
 * Executa uma sequência ordenada de turnos (pipeline).
 *
 * @param {Record<string, unknown> | null | undefined} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handlePipeline(params = {}) {
    const body = resolveAgentControlInput(params);
    const runtimeId = resolveRuntimeIdParam(params);
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
            const MAX_WAIT_MS = 30_000;
            await new Promise((r) => setTimeout(r, Math.min(step.waitMs ?? 0, MAX_WAIT_MS)));
        }

        const t0 = Date.now();
        try {
            const reply = await sendRuntimeDialogTurn(step.prompt, from, undefined, getAgent(runtimeId));
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
        } catch (e) {
            const projection = projectAgentHttpError(e);
            return {
                status: projection.status,
                body: {
                    ...projection.body,
                    step: i + 1,
                    results,
                },
            };
        }
    }

    return { status: 200, body: { ok: true, results } };
}

/**
 * Injeta uma mensagem na LLM-B e aguarda resposta.
 *
 * @param {{
 *           runtimeId?: string;
 *           body?: {
 *               runtimeId?: string;
 *               message?: string;
 *               content?: string;
 *               from?: string;
 *               timeout?: number;
 *               context_files?: string[];
 *               attachments?: {
 *                   type?: string;
 *                   content?: string;
 *                   path?: string;
 *                   displayName?: string;
 *                   filePath?: string;
 *                   selection?: object;
 *                   text?: string;
 *               }[];
 *           };
 *           message?: string;
 *           content?: string;
 *           from?: string;
 *           timeout?: number;
 *           context_files?: string[];
 *           attachments?: {
 *               type?: string;
 *               content?: string;
 *               path?: string;
 *               displayName?: string;
 *               filePath?: string;
 *               selection?: object;
 *               text?: string;
 *           }[];
 *       }
 *     | null
 *     | undefined} [params]
 * @returns {Promise<HandlerResult>}
 */
export async function handleInject(params = {}) {
    const body = resolveAgentControlInput(params);
    const runtimeId = resolveRuntimeIdParam(params);
    const rawMessage =
        typeof body?.message === 'string' ? body.message : typeof body?.content === 'string' ? body.content : '';
    const message = rawMessage.trim();
    if (!message) {
        return { status: 400, body: { ok: false, error: '"message" é obrigatório' } };
    }

    const rawFrom = body?.from ?? 'llm-a';
    const from = typeof rawFrom === 'string' && ALLOWED_FROM.has(rawFrom) ? rawFrom : 'llm-a';

    let enrichedMessage = message;
    const contextFiles = Array.isArray(body?.context_files) ? body.context_files : [];
    if (contextFiles.length > 0) {
        try {
            const ctxs = await Promise.all(contextFiles.map(readRuntimeFileContext));
            enrichedMessage = embedRuntimeMultiple(ctxs, message);
        } catch (embedErr) {
            return {
                status: 400,
                body: { ok: false, error: `Falha ao processar context_files: ${toError(embedErr).message}` },
            };
        }
    }

    const rawAttachments = Array.isArray(body?.attachments) ? body.attachments : [];
    if (rawAttachments.length > 0) {
        let embedParts;
        try {
            embedParts = await Promise.all(rawAttachments.map(attachmentToRuntimeEmbed));
        } catch (attErr) {
            return {
                status: 400,
                body: { ok: false, error: `Falha ao processar attachments: ${toError(attErr).message}` },
            };
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
        const reply = await sendRuntimeDialogTurn(enrichedMessage, from, undefined, getAgent(runtimeId));
        const durationMs = Date.now() - t0;
        recordRuntimeInjectHistory({
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
    } catch (e) {
        recordRuntimeInjectHistory({
            ts: t0,
            from,
            message: message.slice(0, 200),
            replySnippet: null,
            durationMs: Date.now() - t0,
            ok: false,
        });
        return projectAgentHttpError(e);
    }
}

/**
 * Handler para POST /dialog/pause.
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogPause(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    if (!getAgent(runtimeId).dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop não está ativo.' } };
    }
    try {
        await pauseAgentDialogLoop(runtimeId);
        return {
            status: 200,
            body: { ok: true, message: 'Dialog loop pausado. Use POST /dialog/resume para retomar.' },
        };
    } catch (e) {
        return projectAgentHttpError(e);
    }
}

/**
 * Handler para POST /dialog/resume.
 *
 * @returns {Promise<{ status: number; body: object }>}
 */
export async function handleDialogResume(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    if (getAgent(runtimeId).dialogLoopActive) {
        return { status: 409, body: { ok: false, error: 'Dialog loop já está ativo.' } };
    }
    try {
        await resumeAgentDialogLoop(runtimeId);
        return { status: 200, body: { ok: true, message: 'Dialog loop retomado.' } };
    } catch (e) {
        return projectAgentHttpError(e);
    }
}

/**
 * GET /handoff — lista handoffs pendentes e histórico.
 *
 * @returns {HandlerResult}
 */
export function handleGetHandoffs(params = {}) {
    const runtimeId = resolveRuntimeIdParam(params);
    const handoffMgr = getAgentHandoffManager(runtimeId);
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
 * @param {{ runtimeId?: string; handoffId?: string } | null | undefined} params
 * @returns {HandlerResult}
 */
export function handleAcceptHandoff(params) {
    const runtimeId = resolveRuntimeIdParam(params);
    const handoffMgr = getAgentHandoffManager(runtimeId);
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
 * @param {{ runtimeId?: string; handoffId?: string } | null | undefined} params
 * @param {{ reason?: string }} [body]
 * @returns {HandlerResult}
 */
export function handleRejectHandoff(params, body) {
    const runtimeId = resolveRuntimeIdParam(params);
    const handoffMgr = getAgentHandoffManager(runtimeId);
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
