// @ts-check
/**
 * tests/unit/copilot/test_status_snapshot.spec.js
 *
 * G2-TEST-06/07: Testes para buildStatusSnapshot() — função pura de construção do snapshot. Cobre campos obrigatórios,
 * starvationAlert e integração com getStatusSnapshot() do agente.
 */

import assert from 'node:assert/strict';
import { beforeAll, describe, it } from 'vitest';

/** @type {typeof import('#copilot/observability/snapshots').buildStatusSnapshot} */
let buildStatusSnapshot;

/** @returns {import('../../../src/copilot/agent/types.js').PendingQuestion} */
function makePendingQuestion() {
    return {
        question: 'Vous avez une question?',
        choices: ['sim', 'não'],
        allowFreeform: true,
        resolve: () => {},
        askedAt: Date.now(),
        kind: 'question',
        protocolControlled: false,
    };
}

/**
 * @param {string} id
 * @param {number} enqueuedAt
 * @returns {import('../../../src/copilot/agent/types.js').AgentTask}
 */
function makeTask(id, enqueuedAt) {
    return {
        id,
        message: 'test',
        resolve: () => {},
        reject: () => {},
        enqueuedAt,
    };
}

beforeAll(async () => {
    ({ buildStatusSnapshot } = await import('#copilot/observability/snapshots'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: campos obrigatórios (G2-TEST-06)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildStatusSnapshot() › campos obrigatórios', () => {
    /** @returns {import('#copilot/observability/snapshots').SnapshotParams} */
    const baseParams = () => ({
        status: 'idle',
        sessionId: null,
        model: 'gpt-4o',
        reasoningEffort: undefined,
        queueSize: 0,
        queueOldest: undefined,
        pendingQuestion: null,
        isResumed: false,
        resumeCount: 0,
        sendCount: 0,
        startedAt: null,
        contextWindow: null,
        lastCheckpointPath: null,
        permissionMode: 'approve_all',
    });

    it('deve retornar objeto com campos status, sessionId, model', () => {
        const snap = buildStatusSnapshot(baseParams());
        assert.ok('status' in snap, 'snapshot deve conter status');
        assert.ok('sessionId' in snap, 'snapshot deve conter sessionId');
        assert.ok('model' in snap, 'snapshot deve conter model');
    });

    it('status deve ser repassado inalterado', () => {
        const snap = buildStatusSnapshot({ ...baseParams(), status: 'processing' });
        assert.equal(snap.status, 'processing');
    });

    it('queueSize deve ser repassado inalterado', () => {
        const snap = buildStatusSnapshot({ ...baseParams(), queueSize: 3 });
        assert.equal(snap.queueSize, 3);
    });

    it('pendingQuestion null deve resultar em snap.pendingQuestion null', () => {
        const snap = buildStatusSnapshot(baseParams());
        assert.strictEqual(snap.pendingQuestion, null);
    });

    it('pendingQuestion com objeto deve ser mapeado corretamente', () => {
        const snap = buildStatusSnapshot({
            ...baseParams(),
            pendingQuestion: makePendingQuestion(),
        });
        assert.ok(snap.pendingQuestion !== null, 'pendingQuestion deve estar presente');
        assert.equal(snap.pendingQuestion.question, 'Vous avez une question?');
        assert.deepEqual(snap.pendingQuestion.choices, ['sim', 'não']);
    });

    it('permissionMode deve ser repassado corretamente', () => {
        const snap = buildStatusSnapshot({ ...baseParams(), permissionMode: 'selective' });
        assert.equal(snap.permissionMode, 'selective');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: starvationAlert (G2-TEST-07)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildStatusSnapshot() › starvationAlert', () => {
    it('starvationAlert deve ser false se fila vazia', () => {
        const snap = buildStatusSnapshot({
            status: 'idle',
            sessionId: null,
            model: 'gpt-4o',
            reasoningEffort: undefined,
            queueSize: 0,
            queueOldest: undefined,
            pendingQuestion: null,
            isResumed: false,
            resumeCount: 0,
            sendCount: 0,
            startedAt: null,
            contextWindow: null,
            lastCheckpointPath: null,
            permissionMode: 'approve_all',
        });
        assert.equal(snap.starvationAlert, false, 'fila vazia não deve alertar starvation');
    });

    it('starvationAlert deve ser false para tarefa recente', () => {
        const snap = buildStatusSnapshot({
            status: 'processing',
            sessionId: 's1',
            model: 'gpt-4o',
            reasoningEffort: undefined,
            queueSize: 1,
            queueOldest: makeTask('x1', Date.now() - 100),
            pendingQuestion: null,
            isResumed: false,
            resumeCount: 0,
            sendCount: 1,
            startedAt: Date.now() - 1000,
            contextWindow: null,
            lastCheckpointPath: null,
            permissionMode: 'approve_all',
        });
        assert.equal(snap.starvationAlert, false, 'tarefa recente não deve alertar starvation');
    });

    it('starvationAlert deve ser true para tarefa muito antiga', () => {
        const snap = buildStatusSnapshot({
            status: 'processing',
            sessionId: 's1',
            model: 'gpt-4o',
            reasoningEffort: undefined,
            queueSize: 1,
            // 2 minutos atrás — acima do default de 60s
            queueOldest: makeTask('x2', Date.now() - 120_000),
            pendingQuestion: null,
            isResumed: false,
            resumeCount: 0,
            sendCount: 5,
            startedAt: Date.now() - 200_000,
            contextWindow: null,
            lastCheckpointPath: null,
            permissionMode: 'approve_all',
        });
        assert.equal(snap.starvationAlert, true, 'tarefa antiga deve alertar starvation');
    });

    it('oldestTaskWaitMs deve refletir a idade da tarefa mais antiga', () => {
        const enqueuedAt = Date.now() - 5000;
        const snap = buildStatusSnapshot({
            status: 'processing',
            sessionId: 's1',
            model: 'gpt-4o',
            reasoningEffort: undefined,
            queueSize: 1,
            queueOldest: makeTask('x3', enqueuedAt),
            pendingQuestion: null,
            isResumed: false,
            resumeCount: 0,
            sendCount: 1,
            startedAt: null,
            contextWindow: null,
            lastCheckpointPath: null,
            permissionMode: 'approve_all',
        });
        assert.ok(
            snap.oldestTaskWaitMs >= 4990 && snap.oldestTaskWaitMs <= 6000,
            `oldestTaskWaitMs deve ser ~5000ms, recebido ${snap.oldestTaskWaitMs}`,
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: integração com AlwaysAliveAgent.getStatusSnapshot()
// ─────────────────────────────────────────────────────────────────────────────

describe('AlwaysAliveAgent.getStatusSnapshot() › integração', async () => {
    /** @type {import('../../../src/copilot/agent/always-alive.js').AlwaysAliveAgent} */
    let agent;

    beforeAll(async () => {
        const { AlwaysAliveAgent } = await import('../../../src/copilot/agent/always-alive.js');
        agent = new AlwaysAliveAgent();
    });

    it('deve retornar snapshot com status string inicialmente', () => {
        const snap = agent.getStatusSnapshot();
        assert.ok(typeof snap.status === 'string' && snap.status.length > 0, 'status deve ser string não vazia');
    });

    it('snapshot deve ter campo model', () => {
        const snap = agent.getStatusSnapshot();
        assert.ok(typeof snap.model === 'string', 'model deve ser string');
    });

    it('snapshot deve ter campo queueSize >= 0', () => {
        const snap = agent.getStatusSnapshot();
        assert.ok(typeof snap.queueSize === 'number' && snap.queueSize >= 0);
    });

    it('snapshot idêntico deve ser retornado dentro do TTL (cache)', () => {
        const s1 = agent.getStatusSnapshot();
        const s2 = agent.getStatusSnapshot();
        assert.strictEqual(s1, s2, 'snapshots dentro do TTL devem ser a mesma referência (cache)');
    });
});
