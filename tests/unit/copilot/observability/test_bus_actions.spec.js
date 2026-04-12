// @ts-check
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { createEventBus } from '../../../../src/copilot/core/event-bus.js';
import { createHealthUpdater } from '../../../../src/copilot/observability/bus-actions/health-updater.js';
import { createActivityTracker } from '../../../../src/copilot/observability/bus-actions/activity-tracker.js';
import { createCorrelationTracer } from '../../../../src/copilot/observability/bus-actions/correlation-tracer.js';
import { createErrorAlerterAction } from '../../../../src/copilot/observability/bus-actions/error-alerter.js';

describe('bus-actions (FAIXA-L15)', () => {
    /** @type {ReturnType<typeof createEventBus>} */
    let bus;

    beforeEach(() => {
        bus = createEventBus();
    });

    describe('HealthUpdater', () => {
        it('inicia com score 100 e status healthy', () => {
            const hu = createHealthUpdater({ bus });
            const h = hu.getHealth();
            assert.equal(h.score, 100);
            assert.equal(h.status, 'healthy');
            hu.unsub();
        });

        it('degrada com erros', () => {
            const hu = createHealthUpdater({ bus });
            bus.emit({ type: 'agent:session:fatal', timestamp: Date.now() });
            assert.equal(hu.getHealth().score, 70);
            bus.emit({ type: 'agent:task:error', timestamp: Date.now() });
            assert.equal(hu.getHealth().score, 60);
            hu.unsub();
        });

        it('recupera com eventos de sucesso', () => {
            const hu = createHealthUpdater({ bus });
            bus.emit({ type: 'agent:session:fatal', timestamp: Date.now() });
            assert.equal(hu.getHealth().score, 70);
            bus.emit({ type: 'agent:ready', timestamp: Date.now() });
            assert.equal(hu.getHealth().score, 80);
            assert.equal(hu.getHealth().status, 'healthy');
            hu.unsub();
        });

        it('unsub para de rastrear', () => {
            const hu = createHealthUpdater({ bus });
            hu.unsub();
            bus.emit({ type: 'agent:session:fatal', timestamp: Date.now() });
            assert.equal(hu.getHealth().score, 100);
        });
    });

    describe('ActivityTracker', () => {
        it('rastreia última atividade', () => {
            const at = createActivityTracker({ bus });
            const before = Date.now();
            bus.emit({ type: 'agent:dialog:turn_start', timestamp: before });
            const snap = at.getSnapshot();
            assert.equal(snap.lastEventType, 'agent:dialog:turn_start');
            assert.equal(snap.eventCount, 1);
            assert.ok(snap.idleMs >= 0);
            at.unsub();
        });
    });

    describe('CorrelationTracer', () => {
        it('indexa por correlationId', () => {
            const ct = createCorrelationTracer({ bus });
            bus.emit({ type: 'agent:dialog:turn_start', timestamp: Date.now(), correlationId: 'abc-123' });
            bus.emit({ type: 'agent:dialog:turn_end', timestamp: Date.now(), correlationId: 'abc-123' });
            const traces = ct.getTraces('abc-123');
            assert.equal(traces.length, 2);
            assert.equal(traces[0].type, 'agent:dialog:turn_start');
            ct.unsub();
        });

        it('getRecentTraces retorna últimos eventos', () => {
            const ct = createCorrelationTracer({ bus });
            for (let i = 0; i < 5; i++) {
                bus.emit({ type: `test:event:${i}`, timestamp: Date.now() });
            }
            const recent = ct.getRecentTraces(3);
            assert.equal(recent.length, 3);
            ct.unsub();
        });
    });

    describe('ErrorAlerter', () => {
        it('chama onAlert quando detecta evento de erro', () => {
            /** @type {any[]} */
            const alerts = [];
            const ea = createErrorAlerterAction({ bus, onAlert: (evt) => alerts.push(evt) });
            bus.emit({ type: 'agent:task:error', timestamp: Date.now() });
            bus.emit({ type: 'agent:session:fatal', timestamp: Date.now() });
            assert.equal(alerts.length, 2);
            ea.unsub();
        });

        it('unsub para alertas', () => {
            /** @type {any[]} */
            const alerts = [];
            const ea = createErrorAlerterAction({ bus, onAlert: (evt) => alerts.push(evt) });
            ea.unsub();
            bus.emit({ type: 'agent:task:error', timestamp: Date.now() });
            assert.equal(alerts.length, 0);
        });
    });

    describe('hasAction contract', () => {
        it('todos os bus-actions expõem hasAction: true', () => {
            const hu = createHealthUpdater({ bus });
            const at = createActivityTracker({ bus });
            const ct = createCorrelationTracer({ bus });
            /** @type {any[]} */
            const alerts = [];
            const ea = createErrorAlerterAction({ bus, onAlert: (e) => alerts.push(e) });

            assert.equal(hu.hasAction, true);
            assert.equal(at.hasAction, true);
            assert.equal(ct.hasAction, true);
            assert.equal(ea.hasAction, true);

            hu.unsub(); at.unsub(); ct.unsub(); ea.unsub();
        });
    });
});
