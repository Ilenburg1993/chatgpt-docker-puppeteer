// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ─────────────────────────────────────────────────────────

const { mockClientOn, mockGetClient } = vi.hoisted(() => ({
    mockClientOn: vi.fn(),
    mockGetClient: vi.fn(),
}));

// ─── SDK mock (padrão obrigatório) ─────────────────────────────────────────

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_PROMPT_SECTIONS = Object.freeze({
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
    return { SYSTEM_PROMPT_SECTIONS };
});

vi.mock('#copilot/sdk/client', () => ({
    getClient: mockGetClient,
}));

// ─── Imports sob teste ─────────────────────────────────────────────────────

import {
    LIFECYCLE_EVENTS,
    isLifecycleEventType,
    onAllLifecycleEvents,
    onLifecycleEvent,
    onLifecycleEvents,
    onSessionBackground,
    onSessionCreated,
    onSessionDeleted,
    onSessionForeground,
    onSessionUpdated,
} from '#copilot/sdk/client-events';

// ─── Helper ────────────────────────────────────────────────────────────────

function setupMockClient() {
    const unsub = vi.fn();
    mockClientOn.mockReturnValue(unsub);
    const client = { on: mockClientOn };
    mockGetClient.mockReturnValue(client);
    return { client, unsub };
}

// ═════════════════════════════════════════════════════════════════════════════
// F63 — LIFECYCLE_EVENTS constant & isLifecycleEventType
// ═════════════════════════════════════════════════════════════════════════════

describe('F63 — LIFECYCLE_EVENTS & isLifecycleEventType', () => {
    it('LIFECYCLE_EVENTS tem exatamente 5 entries', () => {
        expect(Object.keys(LIFECYCLE_EVENTS)).toHaveLength(5);
    });

    it('LIFECYCLE_EVENTS contém os 5 tipos corretos', () => {
        expect(LIFECYCLE_EVENTS.CREATED).toBe('session.created');
        expect(LIFECYCLE_EVENTS.DELETED).toBe('session.deleted');
        expect(LIFECYCLE_EVENTS.UPDATED).toBe('session.updated');
        expect(LIFECYCLE_EVENTS.FOREGROUND).toBe('session.foreground');
        expect(LIFECYCLE_EVENTS.BACKGROUND).toBe('session.background');
    });

    it('LIFECYCLE_EVENTS é frozen', () => {
        expect(Object.isFrozen(LIFECYCLE_EVENTS)).toBe(true);
    });

    it('isLifecycleEventType retorna true para tipos válidos', () => {
        expect(isLifecycleEventType('session.created')).toBe(true);
        expect(isLifecycleEventType('session.deleted')).toBe(true);
        expect(isLifecycleEventType('session.foreground')).toBe(true);
    });

    it('isLifecycleEventType retorna false para tipos inválidos', () => {
        expect(isLifecycleEventType('session.start')).toBe(false);
        expect(isLifecycleEventType('foo')).toBe(false);
        expect(isLifecycleEventType('')).toBe(false);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F64 — onLifecycleEvent (typed single handler)
// ═════════════════════════════════════════════════════════════════════════════

describe('F64 — onLifecycleEvent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('chama client.on(eventType, handler) e retorna unsubscribe', () => {
        const { client, unsub } = setupMockClient();
        const handler = vi.fn();

        const result = onLifecycleEvent('session.created', handler, /** @type {any} */ (client));
        expect(mockClientOn).toHaveBeenCalledWith('session.created', handler);
        expect(result).toBe(unsub);
    });

    it('usa getClient() quando client não é fornecido', () => {
        setupMockClient();
        const handler = vi.fn();

        onLifecycleEvent('session.deleted', handler);
        expect(mockGetClient).toHaveBeenCalled();
        expect(mockClientOn).toHaveBeenCalledWith('session.deleted', handler);
    });

    it('lança erro se client é null e getClient retorna null', () => {
        mockGetClient.mockReturnValue(null);
        expect(() => onLifecycleEvent('session.created', vi.fn())).toThrow('client is required');
    });

    it('lança erro se eventType é vazio', () => {
        const { client } = setupMockClient();
        expect(() => onLifecycleEvent('', vi.fn(), /** @type {any} */ (client))).toThrow(
            'eventType must be a non-empty string',
        );
    });

    it('lança erro se handler não é função', () => {
        const { client } = setupMockClient();
        expect(() => onLifecycleEvent('session.created', /** @type {any} */ (42), /** @type {any} */ (client))).toThrow(
            'handler must be a function',
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F64b — onAllLifecycleEvents (wildcard)
// ═════════════════════════════════════════════════════════════════════════════

describe('F64b — onAllLifecycleEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('chama client.on(handler) sem eventType', () => {
        const { client } = setupMockClient();
        const handler = vi.fn();

        onAllLifecycleEvents(handler, /** @type {any} */ (client));
        expect(mockClientOn).toHaveBeenCalledWith(handler);
    });

    it('lança erro se handler não é função', () => {
        const { client } = setupMockClient();
        expect(() => onAllLifecycleEvents(/** @type {any} */ ('notfn'), /** @type {any} */ (client))).toThrow(
            'handler must be a function',
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F64c — onLifecycleEvents (multi-handler)
// ═════════════════════════════════════════════════════════════════════════════

describe('F64c — onLifecycleEvents', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('registra múltiplos handlers e unsubscribe composito funciona', () => {
        const unsub1 = vi.fn();
        const unsub2 = vi.fn();
        mockClientOn.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);
        const client = { on: mockClientOn };
        mockGetClient.mockReturnValue(client);

        const h1 = vi.fn();
        const h2 = vi.fn();
        const unsubAll = onLifecycleEvents(
            {
                'session.created': h1,
                'session.deleted': h2,
            },
            /** @type {any} */ (client),
        );

        expect(mockClientOn).toHaveBeenCalledTimes(2);
        unsubAll();
        expect(unsub1).toHaveBeenCalledOnce();
        expect(unsub2).toHaveBeenCalledOnce();
    });

    it('lança erro se handlerMap está vazio', () => {
        const { client } = setupMockClient();
        expect(() => onLifecycleEvents({}, /** @type {any} */ (client))).toThrow('must have at least one entry');
    });

    it('lança erro se handler individual não é função', () => {
        const { client } = setupMockClient();
        expect(() =>
            onLifecycleEvents({ 'session.created': /** @type {any} */ ('notfn') }, /** @type {any} */ (client)),
        ).toThrow("handler for 'session.created' must be a function");
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F65 — Typed convenience handlers (5 lifecycle events)
// ═════════════════════════════════════════════════════════════════════════════

describe('F65 — Typed convenience handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('onSessionCreated subscreve a session.created', () => {
        const { client } = setupMockClient();
        const handler = vi.fn();
        onSessionCreated(handler, /** @type {any} */ (client));
        expect(mockClientOn).toHaveBeenCalledWith('session.created', handler);
    });

    it('onSessionDeleted subscreve a session.deleted', () => {
        const { client } = setupMockClient();
        const handler = vi.fn();
        onSessionDeleted(handler, /** @type {any} */ (client));
        expect(mockClientOn).toHaveBeenCalledWith('session.deleted', handler);
    });

    it('onSessionUpdated subscreve a session.updated', () => {
        const { client } = setupMockClient();
        const handler = vi.fn();
        onSessionUpdated(handler, /** @type {any} */ (client));
        expect(mockClientOn).toHaveBeenCalledWith('session.updated', handler);
    });

    it('onSessionForeground subscreve a session.foreground', () => {
        const { client } = setupMockClient();
        const handler = vi.fn();
        onSessionForeground(handler, /** @type {any} */ (client));
        expect(mockClientOn).toHaveBeenCalledWith('session.foreground', handler);
    });

    it('onSessionBackground subscreve a session.background', () => {
        const { client } = setupMockClient();
        const handler = vi.fn();
        onSessionBackground(handler, /** @type {any} */ (client));
        expect(mockClientOn).toHaveBeenCalledWith('session.background', handler);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F66 — Barrel re-exports
// ═════════════════════════════════════════════════════════════════════════════

describe('F66 — Barrel re-exports (sdk/index.js)', () => {
    it('re-exporta todas as 10 exports do client-events.js', async () => {
        const barrel = await import('#copilot/sdk/index');

        expect(barrel.LIFECYCLE_EVENTS).toBeDefined();
        expect(barrel.isLifecycleEventType).toBeTypeOf('function');
        expect(barrel.onLifecycleEvent).toBeTypeOf('function');
        expect(barrel.onAllLifecycleEvents).toBeTypeOf('function');
        expect(barrel.onLifecycleEvents).toBeTypeOf('function');
        expect(barrel.onSessionCreated).toBeTypeOf('function');
        expect(barrel.onSessionDeleted).toBeTypeOf('function');
        expect(barrel.onSessionUpdated).toBeTypeOf('function');
        expect(barrel.onSessionForeground).toBeTypeOf('function');
        expect(barrel.onSessionBackground).toBeTypeOf('function');
    });
});
