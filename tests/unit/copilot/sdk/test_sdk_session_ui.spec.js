// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    getSessionCapabilities,
    isSessionUiElicitationAvailable,
    sessionUiConfirm,
    sessionUiElicitation,
    sessionUiInput,
    sessionUiSelect,
} from '../../../../src/copilot/sdk/session/ui.js';
import { setSdkMetricEmitter } from '../../../../src/copilot/sdk/telemetry/operation-metrics.js';

function fakeSession() {
    return /** @type {any} */ ({
        sessionId: 's1',
        capabilities: { ui: { elicitation: true } },
        rpc: {
            ui: { elicitation: vi.fn(async (params) => ({ action: 'accept', content: { value: params.message } })) },
        },
        ui: {
            elicitation: vi.fn(async (params) => ({ action: 'accept', content: { answer: params.message } })),
            confirm: vi.fn(async () => true),
            select: vi.fn(async (_message, options) => options[0] ?? null),
            input: vi.fn(async (message) => message),
        },
    });
}

function fakeFallbackSession() {
    return /** @type {any} */ ({
        sessionId: 's-fallback',
        capabilities: { ui: { elicitation: true } },
        rpc: {
            ui: {
                elicitation: vi.fn(async (params) => {
                    const valueField = params.requestedSchema?.properties?.value;
                    const confirmedField = params.requestedSchema?.properties?.confirmed;
                    if (confirmedField) {
                        return { action: 'accept', content: { confirmed: true } };
                    }
                    if (valueField?.enum) {
                        return { action: 'accept', content: { value: valueField.enum[0] } };
                    }
                    return { action: 'accept', content: { value: 'fallback-value' } };
                }),
            },
        },
    });
}

describe('sdk/session/ui', () => {
    /** @type {import('../../../../src/copilot/sdk/types.js').SdkOperationMetric[]} */
    let metrics;

    beforeEach(() => {
        metrics = [];
        setSdkMetricEmitter((metric) => metrics.push(metric));
    });

    afterEach(() => {
        setSdkMetricEmitter(null);
    });

    it('lê capabilities e disponibilidade de elicitation', () => {
        const session = fakeSession();
        expect(getSessionCapabilities(session)).toEqual({ ui: { elicitation: true } });
        expect(isSessionUiElicitationAvailable(session)).toBe(true);
    });

    it('expõe wrappers de session.ui.*', async () => {
        const session = fakeSession();
        await expect(
            sessionUiElicitation(session, { message: 'Dados?', requestedSchema: { type: 'object', properties: {} } }),
        ).resolves.toEqual({ action: 'accept', content: { answer: 'Dados?' } });
        await expect(sessionUiConfirm(session, 'Confirma?')).resolves.toBe(true);
        await expect(sessionUiSelect(session, 'Selecione', ['dev', 'prod'])).resolves.toBe('dev');
        await expect(sessionUiInput(session, 'Nome?')).resolves.toBe('Nome?');
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining([
                'session.ui.elicitation:started',
                'session.ui.elicitation:succeeded',
                'session.ui.confirm:started',
                'session.ui.confirm:succeeded',
                'session.ui.select:started',
                'session.ui.select:succeeded',
                'session.ui.input:started',
                'session.ui.input:succeeded',
            ]),
        );
    });

    it('emula confirm/select/input quando apenas rpc.ui.elicitation está disponível', async () => {
        const session = fakeFallbackSession();

        await expect(sessionUiConfirm(session, 'Confirma?')).resolves.toBe(true);
        await expect(sessionUiSelect(session, 'Selecione', ['dev', 'prod'])).resolves.toBe('dev');
        await expect(sessionUiInput(session, 'Nome?', { title: 'Nome' })).resolves.toBe('fallback-value');
        await expect(
            sessionUiElicitation(session, { message: 'Dados?', requestedSchema: { type: 'object', properties: {} } }),
        ).resolves.toEqual({ action: 'accept', content: { value: 'fallback-value' } });
    });

    it('emite métrica failed quando a operação falha', async () => {
        const session = fakeSession();
        session.ui.confirm.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

        await expect(sessionUiConfirm(session, 'Confirma?')).rejects.toThrow('timeout');
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining(['session.ui.confirm:started', 'session.ui.confirm:failed']),
        );
    });
});
