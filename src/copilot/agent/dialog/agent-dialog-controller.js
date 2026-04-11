// @ts-check
/**
 * src/copilot/agent/dialog/agent-dialog-controller.js
 *
 * F37: Controle do dialog loop — funções extraídas de always-alive.js.
 *
 * Gerencia start/stop/pause/resume do dialog loop, com validações de estado, health checks de contexto, e wiring de
 * eventos.
 *
 * @module copilot/agent/dialog/agent-dialog-controller
 * @see EventBus
 * @internal
 */

import { SessionError } from '#copilot/core';
import { defaultMetrics, log } from '#copilot/observability';
import { CONTEXT_UTIL_BLOCK_THRESHOLD, CONTEXT_UTIL_WARN_THRESHOLD } from '../config.js';
import { wireDialogLoopEvents } from './loop-manager.js';

/**
 * @typedef {import('../agent-context.js').AgentContext} AgentContext
 */

/** @typedef {import('../types.js').DialogHost} DialogHost */

/**
 * Inicia o dialog loop com validações de estado e health check de contexto.
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 * @param {string} [bootPrompt]
 * @returns {Promise<void>}
 */
export async function dialogStart(ctx, host, bootPrompt) {
    if (ctx.status !== 'idle') {
        throw new SessionError(
            `[AlwaysAlive] startDialogLoop() requer status 'idle'. Status atual: '${ctx.status}'`,
            'INVALID_STATE',
        );
    }
    // F44.1 (GAP-SD-08): health check pre-boot
    if (ctx.contextState) {
        const utilization = ctx.contextState.utilization ?? 0;
        if (utilization >= CONTEXT_UTIL_BLOCK_THRESHOLD) {
            throw new SessionError(
                `[AlwaysAlive] startDialogLoop() bloqueado: utilização de contexto em ${Math.round(utilization * 100)}% (≥95%). Solicite compaction antes de iniciar.`,
                'CONTEXT_EXHAUSTED',
            );
        }
        if (utilization >= CONTEXT_UTIL_WARN_THRESHOLD) {
            log(
                'WARN',
                `[AlwaysAlive] F44.1: Utilização de contexto em ${Math.round(utilization * 100)}% — dialog loop prosseguindo com cautela.`,
            );
        }
    }
    ensureDialogLoopAttached(ctx, host);
    // F42.2: pausar keepalive enquanto dialog loop está ativo
    ctx.keepalive.stop();
    await ctx.dialogLoop.start(bootPrompt);
    host.emit('dialog.loop.changed', { active: true, ts: Date.now() });
}

/**
 * Para o dialog loop e reinicia o keepalive da sessão.
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 * @param {{
 *     authorized?: boolean;
 *     reason?: 'watchdog_restart' | 'authorized_stop';
 *     shutdownTimeoutMs?: number;
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function dialogStop(ctx, host, opts) {
    await ctx.dialogLoop.stop(opts);
    // F42.2: reiniciar keepalive quando dialog loop para
    if (ctx.status !== 'stopped' && ctx.session) {
        ctx.keepalive.start({
            getSession: () => ctx.session,
            getClient: () => ctx.client,
            isIdle: () => ctx.status === 'idle',
            isDialogLoopActive: () => ctx.dialogLoop.active,
            onKeepalive: (/** @type {number} */ ts) => {
                defaultMetrics.recordKeepalivePing();
                host.emit('session.keepalive', { ts });
            },
        });
    }
}

/**
 * Retoma o dialog loop com validação de estado.
 *
 * @param {AgentContext} ctx
 * @returns {Promise<void>}
 */
export async function dialogResume(ctx) {
    if (ctx.status !== 'idle' && ctx.status !== 'waiting_for_input') {
        throw new SessionError(
            `[AlwaysAlive] resumeDialogLoop() requer status 'idle' ou 'waiting_for_input'. Status atual: '${ctx.status}'`,
            'INVALID_STATE',
        );
    }
    await ctx.dialogLoop.resume();
}

/**
 * Garante que o DialogLoopManager está vinculado ao host. Wiring de eventos ocorre apenas na primeira chamada (guard de
 * idempotência).
 *
 * @param {AgentContext} ctx
 * @param {DialogHost} host
 */
export function ensureDialogLoopAttached(ctx, host) {
    /** @type {import('./loop-manager.js').AgentHost} */
    const agentHost = {
        sendMessage: (msg, opts) => host.sendMessage(msg, opts),
        sendMessageDialogBoot: (msg, opts) => host.sendMessageDialogBoot(msg, opts),
        answerPendingQuestion: (answer) => host.answerPendingQuestion(answer),
        getSessionId: () => host.sessionId,
        getModel: () => ctx.model,
        setModel: (modelId) => {
            ctx.model = modelId;
            // F72: propagar ao SDK se sessão estiver ativa (mesma lógica do always-alive.setModel)
            const sdkSess = /** @type {{ setModel?: (id: string) => void }} */ (ctx.session);
            if (sdkSess && typeof sdkSess.setModel === 'function') {
                try {
                    sdkSess.setModel(modelId);
                } catch (_) {
                    /* SDK opcional */
                }
            }
        },
        getPendingQuestion: () => ctx.pendingQuestion,
    };
    // Sempre atualiza host — necessário após reconexão.
    ctx.dialogLoop.attach(agentHost);
    // Wiring de eventos: somente na primeira vez.
    if (ctx.dialogLoopAttached) return;
    ctx.dialogLoopAttached = true;
    wireDialogLoopEvents(ctx.dialogLoop, (event, payload) => host.emit(event, payload));

    // F31.3/F31.4: Proxy token_budget_warning → DLM
    host.on('session.token_budget_warning', (/** @type {any} */ evt) => {
        const ratio = typeof evt?.ratio === 'number' ? evt.ratio : 0;
        const currentTokens = typeof evt?.currentTokens === 'number' ? evt.currentTokens : 0;
        const tokenLimit = typeof evt?.tokenLimit === 'number' ? evt.tokenLimit : 0;
        ctx.dialogLoop.handleTokenBudget({ currentTokens, tokenLimit, ratio });
    });

    // F31.3: Reset compaction flag
    host.on('session.compaction_complete', (/** @type {any} */ evt) => {
        if (evt?.success) ctx.dialogLoop.resetCompactionFlag();
    });
}
