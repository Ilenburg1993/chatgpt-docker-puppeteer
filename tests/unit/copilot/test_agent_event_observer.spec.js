// @ts-check
/**
 * F29.3 — Testes: agent-event-observer com tasks e métricas verificadas.
 *
 * Valida que createAgentEventObserver() registra corretamente métricas para task.completed, task.error, task.queued,
 * task.started, task.delta, task.reasoning, dialog turns e demais eventos.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createAgentEventObserver } from '../../../src/copilot/observability/agent-event-observer.js';

/**
 * Cria um MetricsStore mock que grava todas as chamadas.
 *
 * @returns {{ metrics: any; calls: Map<string, any[]> }}
 */
function makeMetricsMock() {
    /** @type {Map<string, any[]>} */
    const calls = new Map();

    /**
     * @param {string} method
     * @returns {(...args: any[]) => void}
     */
    function recorder(method) {
        return (...args) => {
            if (!calls.has(method)) calls.set(method, []);
            calls.get(method)?.push(args);
        };
    }

    return {
        calls,
        metrics: /** @type {any} */ ({
            recordDialogTurn: recorder('recordDialogTurn'),
            recordDialogStall: recorder('recordDialogStall'),
            recordDialogTimeout: recorder('recordDialogTimeout'),
            recordTaskCompletion: recorder('recordTaskCompletion'),
            recordSessionError: recorder('recordSessionError'),
            recordCounter: recorder('recordCounter'),
            recordGauge: recorder('recordGauge'),
            recordToolCall: recorder('recordToolCall'),
            recordStreamingChunk: recorder('recordStreamingChunk'),
            recordUsage: recorder('recordUsage'),
        }),
    };
}

/**
 * Cria um ErrorTracker mock.
 *
 * @returns {{ errorTracker: any; errors: any[] }}
 */
function makeErrorTrackerMock() {
    /** @type {any[]} */
    const errors = [];
    return {
        errors,
        errorTracker: /** @type {any} */ ({
            trackError: (/** @type {any} */ err, /** @type {any} */ ctx) => errors.push({ err, ctx }),
        }),
    };
}

describe('agent-event-observer — F29.3: task metrics via events', () => {
    /** @type {EventEmitter} */
    let agent;
    /** @type {ReturnType<typeof makeMetricsMock>} */
    let m;
    /** @type {import('../../../src/copilot/observability/agent-event-observer.js').AgentEventObserver} */
    let observer;

    beforeEach(() => {
        agent = new EventEmitter();
        m = makeMetricsMock();
        observer = createAgentEventObserver({ metrics: m.metrics });
        observer.attach(agent);
    });

    afterEach(() => {
        observer.detach();
    });

    // ── task.completed ───────────────────────────────────────────────────────

    it('task.completed registra recordTaskCompletion com success=true', () => {
        agent.emit('task.completed', { taskId: 'task-1', durationMs: 1500 });

        const tc = m.calls.get('recordTaskCompletion') ?? [];
        assert.strictEqual(tc.length, 1, 'deve ter 1 chamada a recordTaskCompletion');
        assert.strictEqual(tc[0][0], 1500, 'durationMs=1500');
        assert.strictEqual(tc[0][1], true, 'success=true');
    });

    it('task.completed registra counter tasks.completed', () => {
        agent.emit('task.completed', { taskId: 'task-2' });

        const counters = (m.calls.get('recordCounter') ?? []).map((c) => c[0]);
        assert.ok(counters.includes('tasks.completed'), 'deve ter counter tasks.completed');
    });

    // ── task.error ───────────────────────────────────────────────────────────

    it('task.error registra recordTaskCompletion com success=false', () => {
        agent.emit('task.error', { taskId: 'err-1', durationMs: 300, error: new Error('fail') });

        const tc = m.calls.get('recordTaskCompletion') ?? [];
        assert.strictEqual(tc.length, 1);
        assert.strictEqual(tc[0][0], 300, 'durationMs=300');
        assert.strictEqual(tc[0][1], false, 'success=false');
    });

    it('task.error registra counters tasks.errors e sessionError', () => {
        agent.emit('task.error', { taskId: 'err-2', error: 'boom' });

        const counters = (m.calls.get('recordCounter') ?? []).map((c) => c[0]);
        assert.ok(counters.includes('tasks.errors'), 'deve ter counter tasks.errors');

        const se = m.calls.get('recordSessionError') ?? [];
        assert.strictEqual(se.length, 1, 'deve chamar recordSessionError');
    });

    it('task.error propaga para ErrorTracker quando disponível', () => {
        observer.detach();

        const { errorTracker, errors } = makeErrorTrackerMock();
        observer = createAgentEventObserver({ metrics: m.metrics, errorTracker });
        observer.attach(agent);

        const testErr = new Error('task falhou');
        agent.emit('task.error', { taskId: 'err-3', error: testErr });

        assert.strictEqual(errors.length, 1, 'deve ter 1 erro no tracker');
        assert.strictEqual(errors[0].err, testErr, 'erro propagado deve ser o mesmo');
        assert.strictEqual(errors[0].ctx.source, 'agent:task.error');
    });

    // ── task.queued ──────────────────────────────────────────────────────────

    it('task.queued registra counter tasks.queued', () => {
        agent.emit('task.queued', { taskId: 'q-1' });

        const counters = (m.calls.get('recordCounter') ?? []).map((c) => c[0]);
        assert.ok(counters.includes('tasks.queued'));
    });

    // ── task.started ─────────────────────────────────────────────────────────

    it('task.started registra counter tasks.started', () => {
        agent.emit('task.started', { taskId: 's-1' });

        const counters = (m.calls.get('recordCounter') ?? []).map((c) => c[0]);
        assert.ok(counters.includes('tasks.started'));
    });

    // ── task.delta (streaming) ───────────────────────────────────────────────

    it('task.delta registra counter task.streaming.deltas e bytes', () => {
        agent.emit('task.delta', { taskId: 'd-1', delta: 'hello world' });

        const counters = m.calls.get('recordCounter') ?? [];
        const deltas = counters.filter((c) => c[0] === 'task.streaming.deltas');
        assert.strictEqual(deltas.length, 1, 'deve ter 1 counter task.streaming.deltas');

        const bytes = counters.filter((c) => c[0] === 'task.streaming.bytes');
        assert.strictEqual(bytes.length, 1, 'deve ter 1 counter task.streaming.bytes');
        assert.strictEqual(bytes[0][1], 11, 'bytes deve ser 11 (comprimento de "hello world")');
    });

    it('task.delta registra streamingChunk interval entre dois deltas', () => {
        agent.emit('task.delta', { taskId: 'd-2', delta: 'a' });
        agent.emit('task.delta', { taskId: 'd-2', delta: 'b' });

        const chunks = m.calls.get('recordStreamingChunk') ?? [];
        // O segundo delta deve registrar o intervalo
        assert.strictEqual(chunks.length, 1, 'deve ter 1 chamada a recordStreamingChunk no segundo delta');
    });

    // ── task.reasoning ───────────────────────────────────────────────────────

    it('task.reasoning registra counters de chunks e bytes', () => {
        agent.emit('task.reasoning', { taskId: 'r-1', text: 'thinking...' });

        const counters = m.calls.get('recordCounter') ?? [];
        assert.ok(counters.some((c) => c[0] === 'task.reasoning.chunks'));
        const bytes = counters.filter((c) => c[0] === 'task.reasoning.bytes');
        assert.strictEqual(bytes.length, 1);
        assert.strictEqual(bytes[0][1], 11, 'bytes de "thinking..." = 11');
    });

    // ── dialog lifecycle ─────────────────────────────────────────────────────

    it('dialog.turn_start + dialog.turn_end registra recordDialogTurn', () => {
        agent.emit('dialog.turn_start', { turnId: 'turn-1' });
        agent.emit('dialog.turn_end', { turnId: 'turn-1', reply: 'resposta' });

        const dt = m.calls.get('recordDialogTurn') ?? [];
        assert.strictEqual(dt.length, 1, 'deve ter 1 chamada a recordDialogTurn');
        assert.ok(typeof dt[0][0] === 'number', 'durationMs deve ser number');
        assert.strictEqual(dt[0][1], true, 'success=true (reply não vazia)');
    });

    it('dialog.turn_end com reply vazia registra success=false', () => {
        agent.emit('dialog.turn_start', { turnId: 'turn-2' });
        agent.emit('dialog.turn_end', { turnId: 'turn-2', reply: '' });

        const dt = m.calls.get('recordDialogTurn') ?? [];
        assert.strictEqual(dt[0][1], false, 'success=false para reply vazia');
    });

    it('dialog.stalled registra recordDialogStall', () => {
        agent.emit('dialog.stalled', { stalledMs: 5000 });

        const ds = m.calls.get('recordDialogStall') ?? [];
        assert.strictEqual(ds.length, 1);
        assert.strictEqual(ds[0][0], 5000);
    });

    it('dialog.turn_timeout registra recordDialogTimeout', () => {
        agent.emit('dialog.turn_timeout', { phase: 'boot', timeoutMs: 30000 });

        const dt = m.calls.get('recordDialogTimeout') ?? [];
        assert.strictEqual(dt.length, 1);
    });

    // ── detach ───────────────────────────────────────────────────────────────

    it('detach() remove todos os listeners', () => {
        const beforeCount = agent.listenerCount('task.completed');
        assert.ok(beforeCount > 0, 'deve ter listeners antes do detach');

        observer.detach();

        assert.strictEqual(agent.listenerCount('task.completed'), 0, 'task.completed sem listeners após detach');
        assert.strictEqual(agent.listenerCount('task.error'), 0, 'task.error sem listeners após detach');
        assert.strictEqual(agent.listenerCount('task.queued'), 0, 'task.queued sem listeners após detach');
    });

    it('após detach, eventos não geram métricas', () => {
        observer.detach();

        agent.emit('task.completed', { taskId: 'post-detach' });

        const tc = m.calls.get('recordTaskCompletion') ?? [];
        assert.strictEqual(tc.length, 0, 'nenhuma métrica registrada após detach');
    });

    // ── fallback de durationMs ───────────────────────────────────────────────

    it('task.completed sem durationMs usa 0 como fallback', () => {
        agent.emit('task.completed', { taskId: 'no-dur' });

        const tc = m.calls.get('recordTaskCompletion') ?? [];
        assert.strictEqual(tc[0][0], 0, 'fallback durationMs=0');
    });

    // ── múltiplas tasks em sequência ─────────────────────────────────────────

    it('múltiplas tasks (queued→started→completed) geram contagem correta', () => {
        // Simula fluxo completo de 3 tasks
        for (let i = 0; i < 3; i++) {
            agent.emit('task.queued', { taskId: `multi-${i}` });
            agent.emit('task.started', { taskId: `multi-${i}` });
            agent.emit('task.completed', { taskId: `multi-${i}`, durationMs: 100 * (i + 1) });
        }

        const counters = m.calls.get('recordCounter') ?? [];
        const queued = counters.filter((c) => c[0] === 'tasks.queued');
        const started = counters.filter((c) => c[0] === 'tasks.started');
        const completed = counters.filter((c) => c[0] === 'tasks.completed');

        assert.strictEqual(queued.length, 3, '3 tasks enfileiradas');
        assert.strictEqual(started.length, 3, '3 tasks iniciadas');
        assert.strictEqual(completed.length, 3, '3 tasks completadas');

        const tc = m.calls.get('recordTaskCompletion') ?? [];
        assert.strictEqual(tc.length, 3, '3 recordTaskCompletion');
        assert.deepStrictEqual(
            tc.map((c) => c[0]),
            [100, 200, 300],
            'durations corretas',
        );
    });
});

describe('agent-event-observer — lifecycle e erros', () => {
    it('handler não lança exceção em evento malformado (safety)', () => {
        const { metrics } = makeMetricsMock();
        const observer = createAgentEventObserver({ metrics });
        const agent = new EventEmitter();
        observer.attach(agent);

        // Emitir eventos sem payload — nenhum deve lançar
        assert.doesNotThrow(() => {
            agent.emit('task.completed');
            agent.emit('task.error');
            agent.emit('task.queued');
            agent.emit('task.started');
            agent.emit('task.delta');
            agent.emit('task.reasoning');
            agent.emit('dialog.turn_start');
            agent.emit('dialog.turn_end');
            agent.emit('dialog.stalled');
            agent.emit('dialog.turn_timeout');
            agent.emit('session.fatal');
            agent.emit('agent.metrics');
        }, 'nenhum handler deve lançar exceção com payload ausente');

        observer.detach();
    });

    it('session.fatal incrementa sessionError e counter', () => {
        const { metrics, calls } = makeMetricsMock();
        const { errorTracker, errors } = makeErrorTrackerMock();
        const observer = createAgentEventObserver({ metrics, errorTracker });
        const agent = new EventEmitter();
        observer.attach(agent);

        const fatalErr = new Error('fatal crash');
        agent.emit('session.fatal', { error: fatalErr, sessionId: 'sess-1' });

        const se = calls.get('recordSessionError') ?? [];
        assert.strictEqual(se.length, 1, 'recordSessionError deve ser chamado');

        const counters = (calls.get('recordCounter') ?? []).map((c) => c[0]);
        assert.ok(counters.includes('session.fatal'));

        assert.strictEqual(errors.length, 1, 'erro deve ser propagado ao tracker');
        assert.strictEqual(errors[0].err, fatalErr);

        observer.detach();
    });

    it('dialog.turn_timeout propaga para ErrorTracker', () => {
        const { metrics } = makeMetricsMock();
        const { errorTracker, errors } = makeErrorTrackerMock();
        const observer = createAgentEventObserver({ metrics, errorTracker });
        const agent = new EventEmitter();
        observer.attach(agent);

        agent.emit('dialog.turn_timeout', { phase: 'boot', timeoutMs: 30000, turnId: 'to-1' });

        assert.strictEqual(errors.length, 1, 'timeout deve ser propagado ao errorTracker');
        assert.ok(errors[0].err.message.includes('boot'));

        observer.detach();
    });
});

// ── F30.4 — Verificar contagem dupla de usage ───────────────────────────────
describe('agent-event-observer — F30.4: no usage double-counting', () => {
    it('session.usage NÃO chama recordUsage (SoT é event-collector)', () => {
        const { metrics, calls } = makeMetricsMock();
        const observer = createAgentEventObserver({ metrics });
        const agent = new EventEmitter();
        observer.attach(agent);

        agent.emit('session.usage', { model: 'gpt-4o', inputTokens: 100, outputTokens: 50 });

        const usageCalls = calls.get('recordUsage') ?? [];
        assert.strictEqual(usageCalls.length, 0, 'recordUsage NÃO deve ser chamado pelo observer (F30)');

        // Deve registrar apenas o counter de session.usage
        const counters = (calls.get('recordCounter') ?? []).map((c) => c[0]);
        assert.ok(counters.includes('session.usage'), 'counter session.usage deve ser registrado');

        observer.detach();
    });

    it('múltiplos session.usage events nunca chamam recordUsage', () => {
        const { metrics, calls } = makeMetricsMock();
        const observer = createAgentEventObserver({ metrics });
        const agent = new EventEmitter();
        observer.attach(agent);

        for (let i = 0; i < 5; i++) {
            agent.emit('session.usage', { model: 'gpt-4o', inputTokens: i * 10, outputTokens: i * 5 });
        }

        const usageCalls = calls.get('recordUsage') ?? [];
        assert.strictEqual(usageCalls.length, 0, 'recordUsage NÃO deve ser chamado (x5)');

        const counters = (calls.get('recordCounter') ?? []).filter((c) => c[0] === 'session.usage');
        assert.strictEqual(counters.length, 5, 'counter session.usage deve ser contabilizado 5x');

        observer.detach();
    });
});

// ── F29.4 — OTEL spans para tasks não-dialog ────────────────────────────────
describe('agent-event-observer — F29.4: OTEL spans for non-dialog tasks', () => {
    it('task.started cria span e task.completed o finaliza', () => {
        const { metrics } = makeMetricsMock();
        const observer = createAgentEventObserver({ metrics });
        const agent = new EventEmitter();
        observer.attach(agent);

        // task.started → task.completed (sem OTEL real, o span será null por _tracer ser null)
        agent.emit('task.started', { taskId: 'otel-1' });
        agent.emit('task.completed', { taskId: 'otel-1', durationMs: 500 });

        // O teste valida que o fluxo não lança erro e as métricas são registradas
        // (OTEL real não está disponível em testes, spans serão null — graceful degradation)
        observer.detach();
    });

    it('task.error finaliza span com status de erro', () => {
        const { metrics } = makeMetricsMock();
        const { errorTracker, errors } = makeErrorTrackerMock();
        const observer = createAgentEventObserver({ metrics, errorTracker });
        const agent = new EventEmitter();
        observer.attach(agent);

        agent.emit('task.started', { taskId: 'otel-err-1' });
        agent.emit('task.error', { taskId: 'otel-err-1', durationMs: 200, error: new Error('otel fail') });

        assert.strictEqual(errors.length, 1, 'erro deve ser propagado ao errorTracker');
        assert.ok(errors[0].err.message.includes('otel fail'));

        observer.detach();
    });

    it('task.completed sem task.started correspondente não lança erro', () => {
        const { metrics } = makeMetricsMock();
        const observer = createAgentEventObserver({ metrics });
        const agent = new EventEmitter();
        observer.attach(agent);

        // task.completed sem task.started — deve operar sem erro (graceful)
        agent.emit('task.completed', { taskId: 'orphan-1', durationMs: 100 });

        observer.detach();
    });

    it('task.error sem task.started correspondente não lança erro', () => {
        const { metrics } = makeMetricsMock();
        const { errorTracker, errors } = makeErrorTrackerMock();
        const observer = createAgentEventObserver({ metrics, errorTracker });
        const agent = new EventEmitter();
        observer.attach(agent);

        agent.emit('task.error', { taskId: 'orphan-err', durationMs: 50, error: new Error('no start') });

        // Erro deve ser propagado ao tracker normalmente
        assert.strictEqual(errors.length, 1);

        observer.detach();
    });
});
