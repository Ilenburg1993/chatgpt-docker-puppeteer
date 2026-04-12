// @ts-check
/**
 * tests/unit/copilot/test_event_wiring.spec.js
 *
 * F61.4: Testes unitários para wireDialogLoopEvents (event-wiring.js)
 */
import EventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DLM_EVENTS, EVENT_MAP, wireDialogLoopEvents } from '../../../src/copilot/agent/dialog/event-wiring.js';

describe('wireDialogLoopEvents', () => {
    it('deve registrar listeners para todos os 13 eventos DLM', () => {
        const dlm = new EventEmitter();
        const emitFn = vi.fn();
        wireDialogLoopEvents(/** @type {any} */ (dlm), emitFn);

        for (const event of DLM_EVENTS) {
            expect(dlm.listenerCount(event)).toBe(1);
        }
    });

    it('deve encaminhar cada evento DLM para o nome correto do agente', () => {
        const dlm = new EventEmitter();
        const emitFn = vi.fn();
        wireDialogLoopEvents(/** @type {any} */ (dlm), emitFn);

        for (const [src, dest] of EVENT_MAP) {
            const payload = { test: src };
            dlm.emit(src, payload);
            expect(emitFn).toHaveBeenCalledWith(dest, payload);
        }
        expect(emitFn).toHaveBeenCalledTimes(EVENT_MAP.length);
    });

    it('deve remover listeners existentes antes de registrar novos', () => {
        const dlm = new EventEmitter();
        const emitFn1 = vi.fn();
        const emitFn2 = vi.fn();

        wireDialogLoopEvents(/** @type {any} */ (dlm), emitFn1);
        wireDialogLoopEvents(/** @type {any} */ (dlm), emitFn2);

        dlm.emit('ready', { x: 1 });
        // emitFn1 NÃO deve ter sido chamado (removido)
        expect(emitFn1).not.toHaveBeenCalled();
        expect(emitFn2).toHaveBeenCalledWith('dialog.ready', { x: 1 });
    });

    it('DLM_EVENTS deve ter 13 entradas', () => {
        expect(DLM_EVENTS).toHaveLength(13);
    });

    it('EVENT_MAP deve mapear model.fallback → pr.fallback_model', () => {
        const entry = EVENT_MAP.find(([src]) => src === 'model.fallback');
        expect(entry).toBeDefined();
        expect(entry?.[1]).toBe('pr.fallback_model');
    });
});
