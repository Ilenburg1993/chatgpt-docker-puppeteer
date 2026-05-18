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
    /** @type {string} */
    let surfaceSrc;
    /** @type {string} */
    let singletonSrc;

    beforeAll(async () => {
        src = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
        surfaceSrc = await readFile(
            new URL('../../../src/copilot/agent/runtime/root-surface/index.js', import.meta.url),
            'utf-8',
        );
        singletonSrc = await readFile(
            new URL('../../../src/copilot/agent/always-alive-singleton.js', import.meta.url),
            'utf-8',
        );
    });

    // ─── F35: AgentContext ────────────────────────────────────────────────

    it('importa AgentContext do barrel canônico de context', () => {
        assert.ok(src.includes("from './context/index.js'"), 'deve importar do barrel de context');
    });

    it('instancia ctx = new AgentContext(this) no constructor', () => {
        assert.ok(src.includes('new AgentContext(this'), 'constructor deve criar AgentContext com this como emitter');
    });

    // ─── F36: AgentLifecycle ──────────────────────────────────────────────

    it('importa agentStart, agentStop, agentTryReconnect pela superfície runtime', () => {
        assert.ok(src.includes("from './runtime/root-surface/index.js'"));
        assert.ok(surfaceSrc.includes("from '../../lifecycle/orchestrators/agent-lifecycle.js'"));
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
        assert.ok(src.includes("from './runtime/root-surface/index.js'"));
        assert.ok(surfaceSrc.includes("from '../../dialog/controllers/agent-dialog-controller.js'"));
        assert.ok(src.includes('dialogStart'));
        assert.ok(src.includes('dialogStop'));
        assert.ok(src.includes('dialogResume'));
        assert.ok(src.includes('dialogEnsureAttached') || src.includes('ensureDialogLoopAttached'));
    });

    // ─── F38: AgentMessaging ──────────────────────────────────────────────

    it('importa sendMessage, sendMessageDialogBoot, steerMessage, answerPendingQuestion', () => {
        assert.ok(src.includes("from './runtime/root-surface/index.js'"));
        assert.ok(surfaceSrc.includes("from '../../messaging/agent-messaging.js'"));
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
        assert.ok(src.includes("from './runtime/root-surface/index.js'"));
        assert.ok(surfaceSrc.includes("from '../../state/agent-state.js'"));
        assert.ok(src.includes('stateSnapshot') || src.includes('getStatusSnapshot'));
        assert.ok(src.includes('stateDiagnostics') || src.includes('listenerDiagnostics'));
    });

    it('importa o helper de event bridge wiring dedicado', () => {
        assert.ok(!surfaceSrc.includes("from './event-bridge-wiring.js'"));
        assert.ok(singletonSrc.includes("from './event-bridge/index.js'"));
        assert.ok(singletonSrc.includes('ensureAgentEventBusBridge'));
        assert.ok(singletonSrc.includes('resetAgentEventBusBridgeWiring'));
    });

    it('delegação de diálogo usa a façade agent-dialog-runtime para send/pause/PR snapshots', () => {
        assert.ok(src.includes("from './runtime/root-surface/index.js'"));
        assert.ok(surfaceSrc.includes("from '../../facades/agent-dialog-runtime.js'"));
        assert.ok(src.includes('dispatchAgentDialogTurn'));
        assert.ok(src.includes('pauseAgentDialogLoop'));
        assert.ok(src.includes('isAgentDialogLoopPaused'));
        assert.ok(src.includes('readAgentDialogPrMetrics'));
        assert.ok(src.includes('readAgentDialogLastPrInfo'));
    });

    it('delegação de sessionId/shadow agora passa pela StateQueryFacade', () => {
        assert.ok(src.includes("from './facades/index.js'"));
        assert.ok(src.includes('StateQueryFacade'));
        assert.ok(src.includes('this.#stateQueryFacade = new StateQueryFacade(this.ctx)'));
        assert.ok(src.includes('return this.#stateQueryFacade.sessionId'));
    });

    it('delegação de status/interação usa a StateQueryFacade', () => {
        assert.ok(src.includes('StateQueryFacade'));
        assert.ok(src.includes('return this.#stateQueryFacade.status'));
        assert.ok(src.includes('return this.#stateQueryFacade.dialogLoopActive'));
        assert.ok(src.includes('return this.#stateQueryFacade.queueSize'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestion'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadow'));
    });

    it('getStatusSnapshot() delega para HealthFacade', () => {
        assert.ok(src.includes('HealthFacade'));
        assert.ok(src.includes('this.#healthFacade = new HealthFacade(this.ctx, this)'));
        assert.ok(src.includes('return this.#healthFacade.getStatusSnapshot()'));
    });

    // ─── Getters sem acoplamento direto ao ctx ─────────────────────────────

    it('usa this.ctx apenas como argumento para façades, não para chamadas cruas de método', () => {
        assert.ok(!src.includes('this.ctx.getPermissionModeSnapshot()'));
        assert.ok(!src.includes('this.ctx.setPermissionMode('));
        assert.ok(!src.includes('this.ctx.getPermissionCapabilitySnapshot()'));
        assert.ok(!src.includes('this.ctx.getPermissionPolicySnapshot()'));
        assert.ok(!src.includes('this.ctx.getContextFactoryCapabilitiesSnapshot()'));
        assert.ok(!src.includes('this.ctx.toolSessionContext'));
        assert.ok(!src.includes('this.ctx.getToolRegistrySnapshot()'));
        assert.ok(!src.includes('this.ctx.getToolRegistryEntriesSnapshot()'));
        assert.ok(!src.includes('this.ctx.getRuntimeStatus()'));
        assert.ok(!src.includes('this.ctx.isDialogLoopActive()'));
        assert.ok(!src.includes('this.ctx.getHandoffManagerSnapshot()'));
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
        assert.ok(src.includes('return this.#stateQueryFacade.status'));
        assert.ok(src.includes('return this.#stateQueryFacade.dialogLoopActive'));
        assert.ok(src.includes('return this.#stateQueryFacade.queueSize'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestion'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionKind'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadow'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadowKind'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadowState'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadowExpired'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadowAgeMs'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadowExpiresAt'));
        assert.ok(src.includes('return this.#stateQueryFacade.pendingQuestionShadowRemainingMs'));
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

    it('usa AgentContext nas façades de runtime-controls para evitar recursão via getters do próprio agent', () => {
        assert.ok(!src.includes('readRuntimeControlState(this).status'));
        assert.ok(!src.includes('readRuntimeControlState(this).dialogLoopActive'));
        assert.ok(!src.includes('readRuntimeControlState(this).queueSize'));
        assert.ok(!src.includes('readRuntimeInteractionState(this).pendingQuestion'));
        assert.ok(!src.includes('readRuntimeInteractionState(this).pendingQuestionShadow'));
        assert.ok(!src.includes('getRuntimeHandoffManager(this)'));
    });

    it('permission/capabilities/tool registry não tocam ctx diretamente', () => {
        assert.ok(src.includes('PermissionToolsFacade'));
        assert.ok(src.includes('this.#permissionToolsFacade = new PermissionToolsFacade(this.ctx)'));
        assert.ok(src.includes('return this.#permissionToolsFacade.getPermissionMode()'));
        assert.ok(src.includes('this.#permissionToolsFacade.setPermissionMode(mode, opts)'));
        assert.ok(src.includes('return this.#permissionToolsFacade.getPermissionCapabilitySnapshot()'));
        assert.ok(src.includes('return this.#permissionToolsFacade.getContextFactoryCapabilitiesSnapshot()'));
        assert.ok(src.includes('return this.#permissionToolsFacade.getToolRegistrySnapshot()'));
        assert.ok(src.includes('return this.#permissionToolsFacade.getToolRegistryEntriesSnapshot()'));
        assert.ok(!src.includes('this.ctx.getPermissionModeSnapshot()'));
        assert.ok(!src.includes('this.ctx.setPermissionMode(mode, opts)'));
        assert.ok(!src.includes('this.ctx.getPermissionCapabilitySnapshot()'));
        assert.ok(!src.includes('this.ctx.getContextFactoryCapabilitiesSnapshot()'));
        assert.ok(!src.includes('this.ctx.getToolRegistrySnapshot()'));
        assert.ok(!src.includes('this.ctx.getToolRegistryEntriesSnapshot()'));
    });
});
