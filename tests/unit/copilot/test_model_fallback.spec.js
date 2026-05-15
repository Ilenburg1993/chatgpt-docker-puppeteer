// @ts-check
/**
 * tests/unit/copilot/test_model_fallback.spec.js
 *
 * F60.4: Testes unitários para ModelFallbackState
 */
import { describe, expect, it, vi } from 'vitest';
import { ModelFallbackState } from '../../../src/copilot/agent/dialog/policies/model-fallback.js';

describe('ModelFallbackState', () => {
    it('deve iniciar sem fallback pendente', () => {
        const state = new ModelFallbackState({ defaultModel: 'auto' });
        expect(state.pending).toBe(false);
    });

    it('setPending() deve marcar fallback como pendente', () => {
        const state = new ModelFallbackState({ defaultModel: 'auto' });
        state.setPending();
        expect(state.pending).toBe(true);
    });

    it('schedule() deve marcar pendente e logar', () => {
        const state = new ModelFallbackState({ defaultModel: null });
        state.schedule('claude-sonnet');
        expect(state.pending).toBe(true);
    });

    it('applyIfPending() deve aplicar modelo no host e emitir evento', () => {
        const state = new ModelFallbackState({ defaultModel: 'auto' });
        state.setPending();

        const host = {
            getModel: () => 'gpt-4o-mini',
            setModel: vi.fn(),
        };
        const emitFn = vi.fn();

        const result = state.applyIfPending(host, emitFn);
        expect(result.applied).toBe(true);
        expect(result.previousModel).toBe('gpt-4o-mini');
        expect(result.newModel).toBe('auto');
        expect(host.setModel).toHaveBeenCalledWith('auto');
        expect(emitFn).toHaveBeenCalledWith(
            'model.fallback',
            expect.objectContaining({
                previousModel: 'gpt-4o-mini',
                newModel: 'auto',
            }),
        );
        // Após aplicar, pending deve ser false
        expect(state.pending).toBe(false);
    });

    it('applyIfPending() sem pendência deve retornar applied=false', () => {
        const state = new ModelFallbackState({ defaultModel: 'auto' });
        const host = { getModel: () => 'gpt-4o-mini' };
        const emitFn = vi.fn();

        const result = state.applyIfPending(host, emitFn);
        expect(result.applied).toBe(false);
        expect(emitFn).not.toHaveBeenCalled();
    });

    it('applyIfPending() com modelo null não deve aplicar', () => {
        const state = new ModelFallbackState({ defaultModel: null });
        state.setPending();
        const host = { getModel: () => 'gpt-4o-mini' };
        const emitFn = vi.fn();

        const result = state.applyIfPending(host, emitFn);
        expect(result.applied).toBe(false);
    });
});
