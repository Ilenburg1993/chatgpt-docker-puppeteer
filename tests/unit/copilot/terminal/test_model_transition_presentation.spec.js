// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildTerminalModelTransitionPresentation,
    renderTerminalModelTransitionSourceLabel,
} from '../../../../src/copilot/terminal/events/model-transition-presentation.js';

describe('terminal/events/model-transition-presentation', () => {
    it('humaniza origens técnicas de troca de modelo sem vazar ids internos na superfície humana', () => {
        expect(renderTerminalModelTransitionSourceLabel('terminal.byok_model')).toBe('terminal /byok model');
        expect(renderTerminalModelTransitionSourceLabel('terminal.byok_auto')).toBe('automação BYOK');
        expect(renderTerminalModelTransitionSourceLabel('sdk/session.model_changed')).toBe('SDK');
        expect(renderTerminalModelTransitionSourceLabel('model_gateway:route_decision')).toBe('model-gateway');
    });

    it('renderiza detalhe canônico de pedido BYOK com origem humana e ISO 8601 completo', () => {
        const presentation = buildTerminalModelTransitionPresentation({
            from: 'kilo-auto/free',
            to: 'anthropic/claude-sonnet-4.5',
            kind: 'requested',
            reason: 'solicitação manual /byok model',
            source: 'terminal.byok_model',
            timestamp: '2026-06-05T12:34:56.789Z',
        });

        expect(presentation.detail).toContain('solicitado: kilo-auto/free → anthropic/claude-sonnet-4.5');
        expect(presentation.detail).toContain('origem terminal /byok model');
        expect(presentation.detail).toContain('2026-06-05T12:34:56.789Z');
        expect(presentation.detail).not.toContain('terminal.byok_model');
    });
});
