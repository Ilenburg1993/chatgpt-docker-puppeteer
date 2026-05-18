// @ts-check
/**
 * tests/unit/copilot/test_agent_context.spec.js
 *
 * F41.1: Testes unitários para AgentContext (F35).
 */

import { EMITTER_PROCESS_QUEUE } from '#copilot/events';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'vitest';
import { AgentContext } from '../../../src/copilot/agent/agent-context.js';
import { PENDING_QUESTION_SHADOW_TTL_MS } from '../../../src/copilot/config/agent.js';

describe('AgentContext', () => {
    it('construção com defaults popula campos essenciais', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        assert.ok(ctx.sessionState, 'sessionState deve existir');
        assert.ok(ctx.dialogState, 'dialogState deve existir');
        assert.ok(ctx.configState, 'configState deve existir');
        assert.ok(ctx.metricsState, 'metricsState deve existir');
        assert.ok(ctx.runtimeState, 'runtimeState deve existir');
        assert.ok(ctx.ioState, 'ioState deve existir');
        assert.equal(ctx.status, 'stopped');
        assert.equal(ctx.client, null);
        assert.equal(ctx.session, null);
        assert.equal(ctx.isReconnecting, false);
        assert.equal(ctx.isResumed, false);
        assert.equal(ctx.sendCount, 0);
        assert.equal(ctx.pendingQuestion, null);
        assert.equal(ctx.statusSnapshotCache, null);
        assert.equal(ctx.lastPrInfo, null);
        assert.equal(ctx.contextState, null);
        assert.equal(ctx.lastCheckpointPath, null);
        assert.equal(ctx.metricsTimer, null);
        assert.equal(ctx.mcpReconnectCancel, null);
        assert.equal(ctx.dialogLoopAttached, false);
        assert.equal(ctx.agentObserver, null);
        assert.ok(typeof ctx.model === 'string', 'model deve ser string');
        assert.equal(ctx.runtimeState.status, 'stopped');
        assert.equal(ctx.ioState.client, null);
        assert.equal(ctx.sessionState.session, null);
        assert.equal(ctx.configState.model, ctx.model);
    });

    it('construção com options.model personaliza modelo', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter, { model: 'gpt-4.1' });

        assert.equal(ctx.model, 'gpt-4.1');
    });

    it('construção com options.reasoningEffort personaliza reasoning', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter, { reasoningEffort: 'high' });

        assert.equal(ctx.reasoningEffort, 'high');
    });

    it('managers são instanciados automaticamente', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        assert.ok(ctx.dialogLoop, 'dialogLoop deve existir');
        assert.ok(ctx.messageQueue, 'messageQueue deve existir');
        assert.ok(ctx.webhooks, 'webhooks deve existir');
        assert.ok(ctx.permissions, 'permissions deve existir');
        assert.ok(ctx.toolsRegistry, 'toolsRegistry deve existir');
        assert.ok(ctx.keepalive, 'keepalive deve existir');
        assert.ok(ctx.handoff, 'handoff deve existir');
        assert.ok(ctx.messagesCache, 'messagesCache deve existir');
        assert.ok(ctx.backgroundTasks, 'backgroundTasks deve existir');
    });

    it('manager boundary API expõe permissões, registry e handoff sem acesso cru obrigatório', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        const initialHandler = ctx.getPermissionHandlerSnapshot();
        assert.equal(typeof initialHandler, 'function');
        assert.equal(ctx.getPermissionModeSnapshot(), ctx.permissions.getMode());

        ctx.setPermissionMode('selective', { denyShell: true });
        assert.equal(ctx.getPermissionModeSnapshot(), 'selective');
        assert.equal(ctx.getPermissionHandlerSnapshot(), initialHandler, 'handler SDK deve ser referência estável');
        assert.equal(
            (await initialHandler(/** @type {any} */ ({ kind: 'shell' }), { sessionId: 'ctx-session' })).kind,
            'reject',
        );

        const originalRegistry = ctx.getToolRegistrySnapshot();
        const nextRegistry = ctx.resetToolsRegistry();
        assert.notEqual(nextRegistry, originalRegistry);
        assert.equal(ctx.getToolRegistrySnapshot(), nextRegistry);
        nextRegistry.entries.set('demo_tool', {
            tool: /** @type {any} */ ({
                name: 'demo_tool',
                description: 'Demo tool',
                skipPermission: true,
                handler: async () => 'ok',
            }),
            category: 'demo',
            tags: ['test'],
            readOnly: true,
        });
        assert.deepEqual(ctx.getToolRegistryEntriesSnapshot(), [
            {
                name: 'demo_tool',
                description: 'Demo tool',
                category: 'demo',
                tags: ['test'],
                readOnly: true,
                skipPermission: true,
                hasParameters: false,
            },
        ]);

        assert.equal(ctx.getHandoffManagerSnapshot(), ctx.handoff);
    });

    it('aceita factory de permission capability sem construir controller concreto no contexto', async () => {
        const emitter = new EventEmitter();
        /** @type {'approve_all' | 'audit_only' | 'selective'} */
        let mode = 'approve_all';
        /** @type {import('../../../src/copilot/sdk/types.js').PermissionHandler} */
        const injectedHandler = async (/** @type {any} */ _request, /** @type {any} */ _invocation) =>
            mode === 'selective'
                ? /** @type {import('../../../src/copilot/sdk/types.js').PermissionRequestResult} */ ({
                      kind: 'reject',
                  })
                : /** @type {import('../../../src/copilot/sdk/types.js').PermissionRequestResult} */ ({
                      kind: 'approve-once',
                  });

        const ctx = new AgentContext(emitter, {
            factories: {
                createPermissions: () => ({
                    getMode: () => mode,
                    setMode: (nextMode, _opts) => {
                        mode = nextMode;
                    },
                    get handler() {
                        return injectedHandler;
                    },
                }),
            },
        });

        assert.equal(ctx.getPermissionHandlerSnapshot(), injectedHandler);
        assert.deepEqual(
            {
                mode: ctx.getPermissionCapabilitySnapshot().mode,
                handlerAvailable: ctx.getPermissionCapabilitySnapshot().handlerAvailable,
            },
            { mode: 'approve_all', handlerAvailable: true },
        );
        assert.equal(
            (await ctx.getPermissionHandlerSnapshot()(/** @type {any} */ ({ kind: 'shell' }), { sessionId: 's1' }))
                .kind,
            'approve-once',
        );
        ctx.setPermissionMode('selective', { denyShell: true });
        assert.equal(ctx.getPermissionModeSnapshot(), 'selective');
        assert.equal(ctx.getPermissionCapabilitySnapshot().mode, 'selective');
        assert.equal(
            (await injectedHandler(/** @type {any} */ ({ kind: 'shell' }), { sessionId: 's1' })).kind,
            'reject',
        );
    });

    it('expõe metadata defensiva do factory set para capability map', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        const metadata = ctx.getContextFactoryCapabilitiesSnapshot();
        assert.equal(metadata['governance.permissions']?.runtimeAuthority, 'agent');
        assert.equal(metadata['governance.permissions']?.sdkFirst, true);
        assert.equal(metadata['tools.registry']?.provider, 'sdk/tools-registry');
        assert.equal(metadata['tools.registry']?.sdkFirst, true);
        assert.equal(metadata['dialog.loop']?.provider, 'agent/dialog/loop-manager');

        metadata['dialog.loop'] = { provider: 'mutated' };
        assert.equal(ctx.getContextFactoryCapabilitiesSnapshot()['dialog.loop']?.provider, 'agent/dialog/loop-manager');
    });

    it('backgroundTasks emite completed e idle via emitter', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        /** @type {Record<string, unknown>[]} */
        const completed = [];
        /** @type {Record<string, unknown>[]} */
        const idle = [];

        emitter.on('agent.background.completed', (evt) => completed.push(/** @type {Record<string, unknown>} */ (evt)));
        emitter.on('agent.background.idle', (evt) => idle.push(/** @type {Record<string, unknown>} */ (evt)));

        await ctx.backgroundTasks.track(Promise.resolve('ok'), {
            label: 'test.background',
            description: 'Background task de teste',
        });

        assert.equal(completed.length, 1);
        assert.equal(completed[0]?.label, 'test.background');
        assert.equal(completed[0]?.status, 'success');
        assert.equal(idle.length, 1);
        assert.equal(idle[0]?.pendingCount, 0);
    });

    it('messageQueue.onEnqueue emite __processQueue no emitter', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        let emitted = false;
        emitter.on(EMITTER_PROCESS_QUEUE, () => {
            emitted = true;
        });

        // Enqueue dispara onEnqueue callback
        const task = {
            id: 'test-1',
            message: 'hello',
            resolve: () => {},
            reject: () => {},
            enqueuedAt: Date.now(),
        };
        ctx.messageQueue.enqueue(task);
        assert.ok(emitted, 'EMITTER_PROCESS_QUEUE deve ser emitido quando task é enfileirada');
    });

    it('messageQueue.onChanged invalida statusSnapshotCache', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        // Simular cache existente
        ctx.statusSnapshotCache = /** @type {any} */ ({ snapshot: {}, at: Date.now() });
        assert.ok(ctx.statusSnapshotCache !== null);

        // Enqueue muda o estado da fila → onChanged deve invalidar cache
        const task = {
            id: 'test-2',
            message: 'hello',
            resolve: () => {},
            reject: () => {},
            enqueuedAt: Date.now(),
        };
        ctx.messageQueue.enqueue(task);
        assert.equal(ctx.statusSnapshotCache, null, 'statusSnapshotCache deve ser invalidado após enqueue');
    });

    it('setStatus muda status, invalida cache e emite evento', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        ctx.statusSnapshotCache = /** @type {any} */ ({ snapshot: {}, at: Date.now() });

        let emittedStatus = '';
        emitter.on('status', (s) => {
            emittedStatus = s;
        });

        ctx.setStatus('starting', emitter);
        ctx.setStatus('idle', emitter);

        assert.equal(ctx.status, 'idle');
        assert.equal(ctx.runtimeState.status, 'idle');
        assert.equal(ctx.statusSnapshotCache, null);
        assert.equal(emittedStatus, 'idle');
    });

    it('helpers semânticos invalidam snapshot e atualizam subestado', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        ctx.statusSnapshotCache = /** @type {any} */ ({ snapshot: {}, at: Date.now() });
        ctx.incrementSendCount();
        assert.equal(ctx.sendCount, 1);
        assert.equal(ctx.statusSnapshotCache, null);

        ctx.setPendingQuestion({
            question: 'Q?',
            allowFreeform: true,
            resolve: () => {},
            askedAt: Date.now(),
            kind: 'question',
            protocolControlled: false,
        });
        assert.equal(ctx.pendingQuestion?.question, 'Q?');
        assert.equal(ctx.getPendingQuestionKind(), 'question');
        assert.equal(ctx.hasPendingQuestionShadow(), false);

        ctx.clearPendingQuestion();
        assert.equal(ctx.pendingQuestion, null);

        ctx.setPendingQuestionShadow({
            question: 'READY: aguardando próxima mensagem',
            meta: {
                kind: 'ready',
                askedAt: Date.now(),
                allowFreeform: true,
                protocolControlled: true,
            },
            restoredAt: Date.now(),
            expiresAt: Date.now() + PENDING_QUESTION_SHADOW_TTL_MS,
        });
        assert.equal(ctx.hasPendingQuestionShadow(), true);
        assert.equal(ctx.getPendingQuestionKind(), null);
        assert.equal(ctx.getPendingQuestionShadowKind(), 'ready');
        assert.equal(ctx.getPendingQuestionShadowState(), 'fresh');
        assert.equal(ctx.isPendingQuestionShadowExpired(), false);
        assert.ok((ctx.getPendingQuestionShadowExpiresAt() ?? 0) > Date.now());
        assert.ok((ctx.getPendingQuestionShadowAgeMs() ?? -1) >= 0);
        assert.ok((ctx.getPendingQuestionShadowRemainingMs() ?? -1) > 0);

        ctx.setPendingQuestion({
            question: 'Pergunta viva',
            allowFreeform: true,
            resolve: () => {},
            askedAt: Date.now(),
            kind: 'question',
            protocolControlled: false,
        });
        assert.equal(ctx.hasPendingQuestionShadow(), false);
    });

    it('expõe snapshots semânticos de pendingQuestion e session unsubscribers', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        const unsubA = () => {};
        const unsubB = () => {};
        ctx.setSessionEventUnsubscribers([unsubA, unsubB]);

        const unsubscribers = ctx.getSessionEventUnsubscribersSnapshot();
        assert.deepEqual(unsubscribers, [unsubA, unsubB]);
        assert.notEqual(unsubscribers, ctx.sessionEventUnsubscribers);

        ctx.setPendingQuestion({
            question: 'Confirmar ação?',
            allowFreeform: false,
            resolve: () => {},
            askedAt: 123,
            kind: 'question',
            protocolControlled: true,
            choices: ['A', 'B'],
        });

        assert.deepEqual(ctx.getPendingQuestionSnapshot(), {
            question: 'Confirmar ação?',
            allowFreeform: false,
            askedAt: 123,
            kind: 'question',
            protocolControlled: true,
            choices: ['A', 'B'],
        });
    });

    it('detecta shadow expirada semanticamente', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);
        const askedAt = Date.now() - (PENDING_QUESTION_SHADOW_TTL_MS + 1000);

        ctx.setPendingQuestionShadow({
            question: 'READY: aguardando próxima mensagem',
            meta: {
                kind: 'ready',
                askedAt,
                allowFreeform: true,
                protocolControlled: true,
            },
            restoredAt: Date.now(),
            expiresAt: askedAt + PENDING_QUESTION_SHADOW_TTL_MS,
        });

        assert.equal(ctx.hasPendingQuestionShadow(), true);
        assert.equal(ctx.isPendingQuestionShadowExpired(), true);
        assert.equal(ctx.getPendingQuestionShadowState(), 'expired');
        assert.ok((ctx.getPendingQuestionShadowAgeMs() ?? 0) > PENDING_QUESTION_SHADOW_TTL_MS);
    });

    it('mutation API expandida governa session/client/model/context/boot report', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        ctx.setClient(/** @type {any} */ ({ id: 'client-1' }));
        ctx.setSession(/** @type {any} */ ({ sessionId: 'sess-1' }));
        ctx.setModel('gpt-5');
        ctx.setReasoningEffort('high');
        ctx.setIsResumed(true);
        ctx.setSendCount(12);
        ctx.setDialogLoopAttached(true);
        ctx.setContextState({ tokens: 10, tokenLimit: 100, utilization: 0.1 });
        ctx.setLastCheckpointPath('/tmp/ckpt.json');
        ctx.setBootReport({
            startedAt: 1,
            completedAt: 2,
            ok: true,
            stepCount: 1,
            degradedCount: 0,
            failedCount: 0,
            steps: [],
        });
        ctx.cacheStatusSnapshot(/** @type {any} */ ({ status: 'idle' }));

        assert.equal(/** @type {any} */ (ctx.client)?.id, 'client-1');
        assert.equal(ctx.session?.sessionId, 'sess-1');
        assert.equal(ctx.model, 'gpt-5');
        assert.equal(ctx.reasoningEffort, 'high');
        assert.equal(ctx.isResumed, true);
        assert.equal(ctx.sendCount, 12);
        assert.equal(ctx.dialogLoopAttached, true);
        assert.deepEqual(ctx.contextState, { tokens: 10, tokenLimit: 100, utilization: 0.1 });
        assert.equal(ctx.lastCheckpointPath, '/tmp/ckpt.json');
        assert.deepEqual(ctx.bootReport, {
            startedAt: 1,
            completedAt: 2,
            ok: true,
            stepCount: 1,
            degradedCount: 0,
            failedCount: 0,
            steps: [],
        });
        assert.equal(ctx.hasClient(), true);
        assert.equal(ctx.hasActiveSession(), true);
        assert.equal(/** @type {any} */ (ctx.getClientSnapshot())?.id, 'client-1');
        assert.equal(ctx.getSessionSnapshot()?.sessionId, 'sess-1');
        assert.equal(ctx.hasPendingQuestion(), false);
        assert.equal(ctx.getBackgroundPendingCount(), 0);
        assert.deepEqual(ctx.getLastPrInfoSnapshot(), null);
        assert.deepEqual(ctx.getContextStateSnapshot(), { tokens: 10, tokenLimit: 100, utilization: 0.1 });
        assert.equal(ctx.getLastCheckpointPathSnapshot(), '/tmp/ckpt.json');
        assert.deepEqual(ctx.getBootReportSnapshot(), {
            startedAt: 1,
            completedAt: 2,
            ok: true,
            stepCount: 1,
            degradedCount: 0,
            failedCount: 0,
            steps: [],
        });
        assert.deepEqual(ctx.statusSnapshotCache, { snapshot: { status: 'idle' }, at: ctx.statusSnapshotCache?.at });

        ctx.clearSession();
        ctx.clearClient();
        assert.equal(ctx.session, null);
        assert.equal(ctx.client, null);
    });

    it('accessors semânticos governam status, fila, cache e background sem expor subestado cru', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        ctx.setRuntimeStatus('idle');
        assert.equal(ctx.getRuntimeStatus(), 'idle');
        assert.equal(ctx.isIdle(), true);
        assert.equal(ctx.isStopped(), false);

        ctx.cacheStatusSnapshot(/** @type {any} */ ({ status: 'idle', queueSize: 0 }));
        assert.deepEqual(ctx.getFreshStatusSnapshotCache(1_000), /** @type {any} */ ({ status: 'idle', queueSize: 0 }));
        assert.deepEqual(ctx.getQueueSnapshot(), { size: 0, oldest: undefined });

        const task = {
            id: 'semantic-task',
            message: 'hello',
            resolve: () => {},
            reject: () => {},
            enqueuedAt: Date.now(),
        };
        ctx.enqueueMessageTask(task);
        assert.equal(ctx.hasQueuedMessages(), true);
        assert.equal(ctx.getQueueSnapshot().size, 1);
        assert.equal(ctx.getQueueSnapshot().oldest?.id, 'semantic-task');
        assert.equal(ctx.shiftMessageTask()?.id, 'semantic-task');

        ctx.unshiftMessageTask(task);
        const drained = ctx.drainMessageQueue(new Error('drain'));
        assert.deepEqual(
            drained.map((queuedTask) => queuedTask.id),
            ['semantic-task'],
        );
        assert.equal(ctx.hasQueuedMessages(), false);

        await ctx.trackBackgroundTask(Promise.resolve('ok'), {
            label: 'semantic.background',
            description: 'semantic background task',
        });
        assert.equal(await ctx.drainBackgroundTasks(10), true);
    });

    it('startKeepalive usa accessors semânticos e falha sem sessão ativa', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        /**
         * @type {{
         *     getSession: () => { sessionId?: string } | null;
         *     getClient?: () => { id?: string } | null;
         *     isIdle: () => boolean;
         *     isDialogLoopActive: () => boolean;
         *     onKeepalive?: (ts: number) => void;
         * } | null}
         */
        let captured = null;
        ctx.keepalive.start = /** @param {any} callbacks */ (callbacks) => {
            captured = callbacks;
        };

        assert.equal(ctx.startKeepalive(), false);

        ctx.setStatus('starting', emitter);
        ctx.setStatus('idle', emitter);
        ctx.setClient(/** @type {any} */ ({ id: 'client-keepalive' }));
        ctx.setSession(/** @type {any} */ ({ sessionId: 'sess-keepalive' }));

        const onKeepalive = () => {};
        assert.equal(ctx.startKeepalive({ onKeepalive }), true);
        assert.ok(captured, 'callbacks do keepalive devem ser capturados');
        if (!captured) {
            throw new Error('callbacks do keepalive não foram capturados');
        }
        const keepaliveCallbacks = /**
         * @type {{
         *     performKeepalive: () => Promise<'client.ping' | 'session.send' | null>;
         *     isIdle: () => boolean;
         *     isDialogLoopActive: () => boolean;
         *     onKeepalive?: (info: { ts: number; strategy: 'client.ping' | 'session.send' }) => void;
         * }}
         */ (captured);
        assert.equal(typeof keepaliveCallbacks.performKeepalive, 'function');
        assert.equal(keepaliveCallbacks.isIdle(), true);
        assert.equal(keepaliveCallbacks.isDialogLoopActive(), false);
        assert.equal(keepaliveCallbacks.onKeepalive, onKeepalive);
    });

    it('resolvePendingQuestion e getBackgroundPendingLabels centralizam operações semânticas', async () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        /** @type {string[]} */
        const answers = [];
        ctx.setPendingQuestion({
            question: 'Qual o status?',
            allowFreeform: true,
            resolve: (answer) => {
                answers.push(answer);
            },
            askedAt: Date.now(),
            kind: 'ready',
            protocolControlled: true,
        });

        assert.equal(ctx.resolvePendingQuestion('Tudo certo'), true);
        assert.deepEqual(answers, ['Tudo certo']);
        assert.equal(ctx.pendingQuestion, null);
        assert.equal(ctx.resolvePendingQuestion('Nada a resolver'), false);

        await ctx.backgroundTasks.track(Promise.resolve('ok'), {
            label: 'bg.one',
            description: 'primeira task',
        });
        assert.deepEqual(ctx.getBackgroundPendingLabels(), []);
        assert.equal(ctx.getPendingQuestionKind(), null);
        assert.equal(ctx.getPendingQuestionShadowKind(), null);
    });

    it('accessors compatíveis refletem e atualizam subestados', () => {
        const emitter = new EventEmitter();
        const ctx = new AgentContext(emitter);

        ctx.model = 'gpt-5';
        ctx.reasoningEffort = 'high';
        ctx.sendCount = 7;
        ctx.dialogLoopAttached = true;
        ctx.isResumed = true;
        ctx.lastCheckpointPath = '/tmp/checkpoint.json';

        assert.equal(ctx.configState.model, 'gpt-5');
        assert.equal(ctx.configState.reasoningEffort, 'high');
        assert.equal(ctx.metricsState.sendCount, 7);
        assert.equal(ctx.dialogState.dialogLoopAttached, true);
        assert.equal(ctx.sessionState.isResumed, true);
        assert.equal(ctx.sessionState.lastCheckpointPath, '/tmp/checkpoint.json');

        ctx.runtimeState.status = 'idle';
        ctx.ioState.client = /** @type {any} */ ({ id: 'fake-client' });

        assert.equal(ctx.status, 'idle');
        assert.deepEqual(ctx.client, { id: 'fake-client' });
    });
});
