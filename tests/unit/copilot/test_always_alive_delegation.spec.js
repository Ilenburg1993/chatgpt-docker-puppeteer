// @ts-check
/**
 * tests/unit/copilot/test_always_alive_delegation.spec.js
 *
 * F46: Testes de delegação — verificar que always-alive.js delega corretamente para os módulos extraídos (F35-F39).
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, it } from 'vitest';

describe('always-alive.js › delegação para módulos extraídos', () => {
    /** @type {string} */
    let src;

    beforeAll(async () => {
        src = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    // ─── F35: AgentContext ────────────────────────────────────────────────

    it('importa AgentContext de agent-context.js', () => {
        assert.ok(src.includes("from './agent-context.js'"), 'deve importar de agent-context.js');
    });

    it('instancia ctx = new AgentContext(this) no constructor', () => {
        assert.ok(src.includes('new AgentContext(this'), 'constructor deve criar AgentContext com this como emitter');
    });

    // ─── F36: AgentLifecycle ──────────────────────────────────────────────

    it('importa agentStart, agentStop, agentTryReconnect de agent-lifecycle.js', () => {
        assert.ok(src.includes("from './lifecycle/agent-lifecycle.js'"));
        assert.ok(src.includes('agentStart'));
        assert.ok(src.includes('agentStop'));
        assert.ok(src.includes('agentTryReconnect'));
    });

    it('start() delega para agentStart(ctx, this)', () => {
        assert.ok(src.includes('agentStart(this.ctx, this)'));
    });

    it('stop() delega para agentStop(ctx, this)', () => {
        assert.ok(src.includes('agentStop(this.ctx, this'));
    });

    // ─── F37: AgentDialogController ───────────────────────────────────────

    it('importa dialogStart, dialogStop, dialogResume, ensureDialogLoopAttached', () => {
        assert.ok(src.includes("from './dialog/agent-dialog-controller.js'"));
        assert.ok(src.includes('dialogStart'));
        assert.ok(src.includes('dialogStop'));
        assert.ok(src.includes('dialogResume'));
        assert.ok(src.includes('dialogEnsureAttached') || src.includes('ensureDialogLoopAttached'));
    });

    // ─── F38: AgentMessaging ──────────────────────────────────────────────

    it('importa sendMessage, sendMessageDialogBoot, steerMessage, answerPendingQuestion', () => {
        assert.ok(src.includes("from './messaging/agent-messaging.js'"));
        assert.ok(src.includes('msgSend') || src.includes('sendMessage'));
        assert.ok(src.includes('msgSendBoot') || src.includes('sendMessageDialogBoot'));
        assert.ok(src.includes('msgSteer') || src.includes('steerMessage'));
        assert.ok(src.includes('msgAnswer') || src.includes('answerPendingQuestion'));
    });

    it('sendMessage() delega para msgSend(ctx, this, ...)', () => {
        assert.ok(src.includes('msgSend(this.ctx, this'));
    });

    // ─── F39: AgentState ──────────────────────────────────────────────────

    it('importa getStatusSnapshot e listenerDiagnostics de agent-state.js', () => {
        assert.ok(src.includes("from './state/agent-state.js'"));
        assert.ok(src.includes('stateSnapshot') || src.includes('getStatusSnapshot'));
        assert.ok(src.includes('stateDiagnostics') || src.includes('listenerDiagnostics'));
    });

    it('importa o helper de event bridge wiring dedicado', () => {
        assert.ok(src.includes("from './event-bridge-wiring.js'"));
        assert.ok(src.includes('ensureAgentEventBusBridge'));
        assert.ok(src.includes('resetAgentEventBusBridgeWiring'));
    });

    it('delegação de diálogo usa a façade agent-dialog-runtime para send/pause/PR snapshots', () => {
        assert.ok(src.includes("from './facades/agent-dialog-runtime.js'"));
        assert.ok(src.includes('dispatchAgentDialogTurn'));
        assert.ok(src.includes('pauseAgentDialogLoop'));
        assert.ok(src.includes('isAgentDialogLoopPaused'));
        assert.ok(src.includes('readAgentDialogPrMetrics'));
        assert.ok(src.includes('readAgentDialogLastPrInfo'));
    });

    it('delegação de sessionId/shadow passa pela façade de runtime-state', () => {
        assert.ok(src.includes("from './facades/agent-runtime-state.js'"));
        assert.ok(src.includes('readAgentRuntimeSessionId'));
        assert.ok(src.includes('clearAgentRuntimePendingQuestionShadow'));
    });

    it('delegação de status/interação usa a façade agent-runtime-controls', () => {
        assert.ok(src.includes("from './facades/agent-runtime-controls.js'"));
        assert.ok(src.includes('readRuntimeControlState'));
        assert.ok(src.includes('readRuntimeInteractionState'));
        assert.ok(src.includes('getRuntimeHandoffManager'));
        assert.ok(src.includes('readRuntimePermissionMode'));
        assert.ok(src.includes('setRuntimePermissionMode'));
        assert.ok(src.includes('readRuntimePermissionCapability'));
        assert.ok(src.includes('readRuntimeContextFactoryCapabilities'));
        assert.ok(src.includes('readRuntimeToolRegistry'));
        assert.ok(src.includes('readRuntimeToolRegistryEntries'));
    });

    it('getStatusSnapshot() delega para stateSnapshot(ctx, this)', () => {
        assert.ok(src.includes('stateSnapshot(this.ctx, this)'));
    });

    // ─── Getters sem acoplamento direto ao ctx ─────────────────────────────

    it('não mantém chamadas diretas a this.ctx.* no corpo da classe', () => {
        const ctxGets = (src.match(/this\.ctx\./g) || []).length;
        assert.equal(ctxGets, 0, `esperado zero chamadas diretas a this.ctx.*, encontrado: ${ctxGets}`);
    });

    it('apenas 3 métodos privados restam (#setStatus, #processQueue, #tryReconnect)', () => {
        const privateMethodDefs = src.match(/^\s+#\w+\s*\(/gm) || [];
        // #setStatus, #processQueue, #tryReconnect
        assert.ok(privateMethodDefs.length <= 3, `max 3 métodos privados, encontrados: ${privateMethodDefs.length}`);
    });

    it('sendDialogTurn/pauseDialogLoop/dialogPaused/dialogPrMetrics/lastPrInfo não tocam ctx diretamente', () => {
        assert.ok(src.includes('dispatchAgentDialogTurn(this.ctx, message, opts)'));
        assert.ok(src.includes('pauseAgentDialogLoop(this.ctx, this.sessionId)'));
        assert.ok(src.includes('isAgentDialogLoopPaused(this.ctx)'));
        assert.ok(src.includes('readAgentDialogPrMetrics(this.ctx)'));
        assert.ok(src.includes('readAgentDialogLastPrInfo(this.ctx)'));
        assert.ok(!src.includes('this.ctx.sendDialogTurn(message, opts)'));
        assert.ok(!src.includes('this.ctx.pauseDialogLoop(this.sessionId)'));
        assert.ok(!src.includes('this.ctx.isDialogLoopPaused()'));
        assert.ok(!src.includes('this.ctx.getDialogPrMetricsSnapshot()'));
        assert.ok(!src.includes('this.ctx.getLastPrInfoSnapshot()'));
    });

    it('status/dialogLoopActive/queueSize/pendingQuestion/shadow não tocam ctx diretamente', () => {
        assert.ok(src.includes('readRuntimeControlState(this).status'));
        assert.ok(src.includes('readRuntimeControlState(this).dialogLoopActive'));
        assert.ok(src.includes('readRuntimeControlState(this).queueSize'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestion'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionKind'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionShadow'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionShadowKind'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionShadowState'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionShadowExpired'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionShadowAgeMs'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionShadowExpiresAt'));
        assert.ok(src.includes('readRuntimeInteractionState(this).pendingQuestionShadowRemainingMs'));
        assert.ok(src.includes('getRuntimeHandoffManager(this)'));
        assert.ok(!src.includes('this.ctx.getRuntimeStatus()'));
        assert.ok(!src.includes('this.ctx.isDialogLoopActive()'));
        assert.ok(!src.includes('this.ctx.getHandoffManagerSnapshot()'));
        assert.ok(!src.includes('this.ctx.getQueueSnapshot().size'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionForStatusSnapshot()'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionKind()'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionShadowSnapshot()'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionShadowKind()'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionShadowState()'));
        assert.ok(!src.includes('this.ctx.isPendingQuestionShadowExpired()'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionShadowAgeMs()'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionShadowExpiresAt()'));
        assert.ok(!src.includes('this.ctx.getPendingQuestionShadowRemainingMs()'));
    });

    it('permission/capabilities/tool registry não tocam ctx diretamente', () => {
        assert.ok(src.includes('readRuntimePermissionMode(this.ctx)'));
        assert.ok(src.includes('setRuntimePermissionMode(this.ctx, mode, opts)'));
        assert.ok(src.includes('readRuntimePermissionCapability(this.ctx)'));
        assert.ok(src.includes('readRuntimeContextFactoryCapabilities(this.ctx)'));
        assert.ok(src.includes('readRuntimeToolRegistry(this.ctx)'));
        assert.ok(src.includes('readRuntimeToolRegistryEntries(this.ctx)'));
        assert.ok(!src.includes('this.ctx.getPermissionModeSnapshot()'));
        assert.ok(!src.includes('this.ctx.setPermissionMode(mode, opts)'));
        assert.ok(!src.includes('this.ctx.getPermissionCapabilitySnapshot()'));
        assert.ok(!src.includes('this.ctx.getContextFactoryCapabilitiesSnapshot()'));
        assert.ok(!src.includes('this.ctx.getToolRegistrySnapshot()'));
        assert.ok(!src.includes('this.ctx.getToolRegistryEntriesSnapshot()'));
    });
});
