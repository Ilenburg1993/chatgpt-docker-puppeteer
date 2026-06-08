// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── SDK mock (padrão obrigatório) ───────────────────────────────────────────

const { mockOn } = vi.hoisted(() => ({
    mockOn: vi.fn(),
}));

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_MESSAGE_SECTIONS = Object.freeze({
        identity: 'identity',
        tone: 'tone',
        tool_efficiency: 'tool_efficiency',
        environment_context: 'environment_context',
        code_change_rules: 'code_change_rules',
        guidelines: 'guidelines',
        safety: 'safety',
        instructions: 'instructions',
        docs: 'docs',
        context: 'context',
    });
    return {
        SYSTEM_MESSAGE_SECTIONS,
        SYSTEM_PROMPT_SECTIONS: SYSTEM_MESSAGE_SECTIONS,
    };
});

// ─── Imports sob teste ───────────────────────────────────────────────────────

import {
    ALL_EVENT_TYPES,
    createEventFilter,
    getEventPayload,
    getEventType,
    isKnownEventType,
    normalizeCanvasOpenedEvent,
    normalizeCanvasRegistryChangedEvent,
    normalizeHookProgressEvent,
    normalizeModelCallFailureEvent,
    normalizePermissionsChangedEvent,
    onAllSessionEvents,
    onSessionEvent,
    onSessionEvents,
} from '#copilot/sdk/session';

import { SESSION_EVENTS } from '#copilot/sdk/constants';

// ─── Helper: criar session mock ──────────────────────────────────────────────

/** @returns {{ on: import('vitest').Mock }} */
function createMockSession() {
    const unsub = vi.fn();
    mockOn.mockReturnValue(unsub);
    return { on: mockOn };
}

// ═════════════════════════════════════════════════════════════════════════════
// F57 — SESSION_EVENTS constant map + ALL_EVENT_TYPES
// ═════════════════════════════════════════════════════════════════════════════

describe('F57 — ALL_EVENT_TYPES & isKnownEventType', () => {
    it('ALL_EVENT_TYPES é um array frozen com 74+ valores', () => {
        expect(Array.isArray(ALL_EVENT_TYPES)).toBe(true);
        expect(ALL_EVENT_TYPES.length).toBeGreaterThanOrEqual(70);
        expect(Object.isFrozen(ALL_EVENT_TYPES)).toBe(true);
    });

    it('ALL_EVENT_TYPES contém todos os valores de SESSION_EVENTS', () => {
        const eventValues = Object.values(SESSION_EVENTS);
        for (const val of eventValues) {
            expect(ALL_EVENT_TYPES).toContain(val);
        }
    });

    it('isKnownEventType retorna true para event types válidos', () => {
        expect(isKnownEventType('session.start')).toBe(true);
        expect(isKnownEventType('assistant.message')).toBe(true);
        expect(isKnownEventType('tool.execution_start')).toBe(true);
    });

    it('isKnownEventType retorna false para event types desconhecidos', () => {
        expect(isKnownEventType('foo.bar')).toBe(false);
        expect(isKnownEventType('')).toBe(false);
        expect(isKnownEventType('unknown')).toBe(false);
    });

    it('ALL_EVENT_TYPES inclui categorias principais: session, assistant, tool, hook', () => {
        const types = new Set(ALL_EVENT_TYPES);
        expect(types.has('session.start')).toBe(true);
        expect(types.has('assistant.turn_start')).toBe(true);
        expect(types.has('tool.execution_start')).toBe(true);
        expect(types.has('hook.start')).toBe(true);
    });
});

describe('SDK 1.0 event normalizers', () => {
    it('normaliza model.call_failure com IDs de diagnóstico', () => {
        const normalized = normalizeModelCallFailureEvent({
            type: 'model.call_failure',
            timestamp: '2026-06-08T05:00:00.000Z',
            data: {
                source: 'top_level',
                model: 'gpt-5.4',
                statusCode: 429,
                durationMs: 1234,
                errorMessage: 'rate limited',
                providerCallId: 'gh-req',
                serviceRequestId: 'svc-req',
            },
        });
        expect(normalized).toMatchObject({
            source: 'top_level',
            model: 'gpt-5.4',
            statusCode: 429,
            durationMs: 1234,
            errorMessage: 'rate limited',
            providerCallId: 'gh-req',
            serviceRequestId: 'svc-req',
            timestamp: '2026-06-08T05:00:00.000Z',
        });
        expect(normalized.ts).toBe(Date.parse('2026-06-08T05:00:00.000Z'));
    });

    it('normaliza session.permissions_changed com transição humana', () => {
        expect(
            normalizePermissionsChangedEvent({
                data: { previousAllowAllPermissions: false, allowAllPermissions: true },
            }),
        ).toMatchObject({
            previousAllowAllPermissions: false,
            allowAllPermissions: true,
            transition: 'enabled',
        });
    });

    it('normaliza eventos de canvas e hook progress', () => {
        expect(
            normalizeCanvasOpenedEvent({
                timestamp: '2026-06-08T05:01:00.000Z',
                data: {
                    canvasId: 'preview',
                    instanceId: 'inst-1',
                    extensionId: 'github-app:demo',
                    title: 'Preview',
                    availability: 'ready',
                    reopen: true,
                },
            }),
        ).toMatchObject({
            canvasId: 'preview',
            instanceId: 'inst-1',
            title: 'Preview',
            availability: 'ready',
            reopen: true,
        });
        expect(
            normalizeCanvasRegistryChangedEvent({
                data: {
                    canvases: [
                        {
                            canvasId: 'preview',
                            displayName: 'Preview',
                            description: 'Render preview',
                            extensionId: 'github-app:demo',
                            actions: [{ name: 'reload' }],
                        },
                    ],
                },
            }),
        ).toMatchObject({
            count: 1,
            canvases: [expect.objectContaining({ canvasId: 'preview', actionCount: 1 })],
        });
        expect(normalizeHookProgressEvent({ data: { message: 'rodando hook' } })).toMatchObject({
            message: 'rodando hook',
        });
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F58 — onSessionEvent (typed single handler)
// ═════════════════════════════════════════════════════════════════════════════

describe('F58 — onSessionEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('chama session.on(eventType, handler) e retorna unsubscribe', () => {
        const session = createMockSession();
        const handler = vi.fn();
        const unsub = onSessionEvent(/** @type {any} */ (session), 'assistant.message', handler);

        expect(mockOn).toHaveBeenCalledWith('assistant.message', handler);
        expect(typeof unsub).toBe('function');
    });

    it('lança erro se session é null', () => {
        expect(() => onSessionEvent(/** @type {any} */ (null), 'session.start', vi.fn())).toThrow(
            'session is required',
        );
    });

    it('lança erro se session não tem .on()', () => {
        expect(() => onSessionEvent(/** @type {any} */ ({}), 'session.start', vi.fn())).toThrow('.on()');
    });

    it('lança erro se eventType é vazio', () => {
        const session = createMockSession();
        expect(() => onSessionEvent(/** @type {any} */ (session), '', vi.fn())).toThrow(
            'eventType must be a non-empty string',
        );
    });

    it('lança erro se handler não é função', () => {
        const session = createMockSession();
        expect(() =>
            onSessionEvent(/** @type {any} */ (session), 'session.start', /** @type {any} */ ('notfn')),
        ).toThrow('handler must be a function');
    });

    it('aceita event types arbitrários (forward-compatible)', () => {
        const session = createMockSession();
        const handler = vi.fn();
        onSessionEvent(/** @type {any} */ (session), 'custom.future.event', handler);

        expect(mockOn).toHaveBeenCalledWith('custom.future.event', handler);
    });

    it('funciona com SESSION_EVENTS constantes', () => {
        const session = createMockSession();
        const handler = vi.fn();
        onSessionEvent(/** @type {any} */ (session), SESSION_EVENTS.TOOL_EXECUTION_COMPLETE, handler);

        expect(mockOn).toHaveBeenCalledWith('tool.execution_complete', handler);
    });

    it('retorna o valor retornado por session.on()', () => {
        const customUnsub = vi.fn();
        mockOn.mockReturnValue(customUnsub);
        const session = { on: mockOn };
        const result = onSessionEvent(/** @type {any} */ (session), 'session.idle', vi.fn());

        expect(result).toBe(customUnsub);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F59 — onSessionEvents (multi-handler registration)
// ═════════════════════════════════════════════════════════════════════════════

describe('F59 — onSessionEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('registra múltiplos handlers e retorna unsubscribe composito', () => {
        const unsub1 = vi.fn();
        const unsub2 = vi.fn();
        mockOn.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);
        const session = { on: mockOn };
        const handler1 = vi.fn();
        const handler2 = vi.fn();

        const unsubAll = onSessionEvents(/** @type {any} */ (session), {
            'assistant.message': handler1,
            'session.error': handler2,
        });

        expect(mockOn).toHaveBeenCalledTimes(2);
        expect(typeof unsubAll).toBe('function');

        // Chamar unsubscribe
        unsubAll();
        expect(unsub1).toHaveBeenCalledOnce();
        expect(unsub2).toHaveBeenCalledOnce();
    });

    it('lança erro se session é null', () => {
        expect(() => onSessionEvents(/** @type {any} */ (null), {})).toThrow('session is required');
    });

    it('lança erro se handlerMap é null', () => {
        const session = createMockSession();
        expect(() => onSessionEvents(/** @type {any} */ (session), /** @type {any} */ (null))).toThrow(
            'handlerMap must be a non-null object',
        );
    });

    it('lança erro se handlerMap está vazio', () => {
        const session = createMockSession();
        expect(() => onSessionEvents(/** @type {any} */ (session), {})).toThrow('must have at least one entry');
    });

    it('lança erro se um handler não é função', () => {
        const session = createMockSession();
        expect(() =>
            onSessionEvents(/** @type {any} */ (session), {
                'session.start': /** @type {any} */ ('notfn'),
            }),
        ).toThrow("handler for 'session.start' must be a function");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F58b — onAllSessionEvents (wildcard)
// ═════════════════════════════════════════════════════════════════════════════

describe('F58b — onAllSessionEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('chama session.on(handler) sem eventType e retorna unsubscribe', () => {
        const session = createMockSession();
        const handler = vi.fn();
        const unsub = onAllSessionEvents(/** @type {any} */ (session), handler);

        expect(mockOn).toHaveBeenCalledWith(handler);
        expect(typeof unsub).toBe('function');
    });

    it('lança erro se session é null', () => {
        expect(() => onAllSessionEvents(/** @type {any} */ (null), vi.fn())).toThrow('session is required');
    });

    it('lança erro se handler não é função', () => {
        const session = createMockSession();
        expect(() => onAllSessionEvents(/** @type {any} */ (session), /** @type {any} */ (42))).toThrow(
            'handler must be a function',
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F60 — getEventPayload & getEventType
// ═════════════════════════════════════════════════════════════════════════════

describe('F60 — getEventPayload & getEventType', () => {
    it('getEventPayload extrai .data do evento', () => {
        const event = { type: 'assistant.message', data: { content: 'hello' }, id: '1', timestamp: '2024-01-01' };
        const payload = getEventPayload(/** @type {any} */ (event));
        expect(payload).toEqual({ content: 'hello' });
    });

    it('getEventPayload retorna undefined se evento não tem .data', () => {
        const event = { type: 'session.idle', id: '1', timestamp: '2024-01-01' };
        const payload = getEventPayload(/** @type {any} */ (event));
        expect(payload).toBeUndefined();
    });

    it('getEventPayload lança erro se event é null', () => {
        expect(() => getEventPayload(/** @type {any} */ (null))).toThrow('event must be a non-null object');
    });

    it('getEventType extrai .type do evento', () => {
        const event = { type: 'tool.execution_start', data: {}, id: '1', timestamp: '2024-01-01' };
        expect(getEventType(/** @type {any} */ (event))).toBe('tool.execution_start');
    });

    it('getEventType lança erro se event é null', () => {
        expect(() => getEventType(/** @type {any} */ (null))).toThrow('event must be a non-null object');
    });

    it('getEventPayload funciona com payloads complexos', () => {
        const event = {
            type: 'session.start',
            data: {
                sessionId: 'abc-123',
                version: 1,
                producer: 'copilot-agent',
                copilotVersion: '1.0.0',
                startTime: '2024-01-01T00:00:00Z',
                context: { cwd: '/workspace', gitRoot: '/workspace', branch: 'main' },
            },
            id: '1',
            timestamp: '2024-01-01',
        };
        const payload = getEventPayload(/** @type {any} */ (event));
        expect(payload).toHaveProperty('sessionId', 'abc-123');
        expect(payload).toHaveProperty('context.branch', 'main');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F60b — createEventFilter
// ═════════════════════════════════════════════════════════════════════════════

describe('F60b — createEventFilter', () => {
    it('cria handler filtrado que só passa eventos permitidos', () => {
        const handler = vi.fn();
        const filtered = createEventFilter(['assistant.message', 'session.error'], handler);

        filtered(/** @type {any} */ ({ type: 'assistant.message', data: { content: 'hi' } }));
        filtered(/** @type {any} */ ({ type: 'session.idle', data: {} }));
        filtered(/** @type {any} */ ({ type: 'session.error', data: { message: 'err' } }));

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[0]?.[0]?.type).toBe('assistant.message');
        expect(handler.mock.calls[1]?.[0]?.type).toBe('session.error');
    });

    it('lança erro se allowedTypes está vazio', () => {
        expect(() => createEventFilter([], vi.fn())).toThrow('allowedTypes must be a non-empty array');
    });

    it('lança erro se handler não é função', () => {
        expect(() => createEventFilter(['session.start'], /** @type {any} */ ('notfn'))).toThrow(
            'handler must be a function',
        );
    });

    it('funciona com SESSION_EVENTS constantes como filtro', () => {
        const handler = vi.fn();
        const filtered = createEventFilter(
            [SESSION_EVENTS.TOOL_EXECUTION_START, SESSION_EVENTS.TOOL_EXECUTION_COMPLETE],
            handler,
        );

        filtered(/** @type {any} */ ({ type: 'tool.execution_start', data: {} }));
        filtered(/** @type {any} */ ({ type: 'assistant.message', data: {} }));
        filtered(/** @type {any} */ ({ type: 'tool.execution_complete', data: {} }));

        expect(handler).toHaveBeenCalledTimes(2);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F62 — Barrel re-exports
// ═════════════════════════════════════════════════════════════════════════════

describe('F62 — Barrel re-exports (sdk/index.js)', () => {
    it('re-exporta todas as 8 funções do events.js', async () => {
        const barrel = await import('#copilot/sdk');

        expect(barrel.ALL_EVENT_TYPES).toBeDefined();
        expect(barrel.isKnownEventType).toBeTypeOf('function');
        expect(barrel.onSessionEvent).toBeTypeOf('function');
        expect(barrel.onSessionEvents).toBeTypeOf('function');
        expect(barrel.onAllSessionEvents).toBeTypeOf('function');
        expect(barrel.getEventPayload).toBeTypeOf('function');
        expect(barrel.getEventType).toBeTypeOf('function');
        expect(barrel.createEventFilter).toBeTypeOf('function');
    });
});
