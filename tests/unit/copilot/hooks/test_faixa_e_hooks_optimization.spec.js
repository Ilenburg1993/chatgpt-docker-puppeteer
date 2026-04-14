// @ts-check
/**
 * tests/unit/copilot/hooks/test_faixa_e_hooks_optimization.spec.js
 *
 * Faixa E: Testes para Hooks Optimization. E1 — Tool filter extraction + dynamic-only handler E2 — Middleware
 * composition + cleanup E3 — Audit trail + compliance
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('#copilot/audit/pipeline', () => ({
    defaultAuditLog: {
        record: vi.fn(),
        getEntries: vi.fn(() => []),
        clear: vi.fn(),
    },
}));

vi.mock(
    '#copilot/config/env',
    () =>
        new Proxy(
            {
                COPILOT_MCP_SERVERS: '',
                COPILOT_CUSTOM_AGENTS: '',
                COPILOT_DISABLED_AGENTS: '',
                COPILOT_MODEL: 'gpt-4o',
                COPILOT_REASONING_EFFORT: '',
                COPILOT_HUB_SOCKET_AUTH_REQUIRED: false,
                DASHBOARD_SOCKET_AUTH_REQUIRED: false,
                AGENT_MAX_LISTENERS: 100,
                CONTEXT_UTIL_WARN_THRESHOLD: 0.9,
                WEBHOOK_ALLOW_PRIVATE_HOSTS: false,
                BRIDGE_ADMIN_TOKEN: 'test',
                SSE_REPLAY_BUFFER_SIZE: 100,
                SSE_MAX_CONCURRENT: 10,
                LLM_B_DIALOG_QUEUE_MAX: 50,
                TERMINAL_MAX_INJECT_HISTORY: 20,
                TERMINAL_MAX_LISTENERS: 50,
                TERMINAL_MAX_ATTACHMENTS: 10,
                TERMINAL_SHOW_STREAMING: true,
                TERMINAL_SHOW_THINKING: true,
                getCopilotFallbackModel: vi.fn(() => null),
            },
            {
                get(target, prop) {
                    return Reflect.get(target, prop);
                },
            },
        ),
);

vi.mock('#copilot/sdk/model-selector', () => ({
    modelSelector: {
        suggestFallback: vi.fn(() => null),
    },
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import {
    AuditTrail,
    composeHandlers,
    conditional,
    createCleanupHandler,
    createHooks,
    extractStaticFilters,
    fallback,
    forTools,
    globalAuditTrail,
    isDynamicOnly,
    loggingMiddleware,
    memoize,
    mergeStaticFilters,
    middleware,
    pipeline,
    raceWithTimeout,
    withErrorAudit,
    withPostToolAudit,
    withPreToolAudit,
} from '../../../../src/copilot/hooks/index.js';

/** @type {import('../../../../src/copilot/hooks/types.js').InvocationContext} */
const INV = { sessionId: 'test-session-001' };

// ═════════════════════════════════════════════════════════════════════════════
// E1 — Tool Filter Extraction
// ═════════════════════════════════════════════════════════════════════════════

describe('E1 — extractStaticFilters', () => {
    it('extrai allowTools → availableTools', () => {
        const result = extractStaticFilters({ allowTools: ['read_file', 'grep'] });
        expect(result.availableTools).toEqual(['read_file', 'grep']);
        expect(result.cleanedConfig.allowTools).toBeUndefined();
    });

    it('extrai denyTools → excludedTools', () => {
        const result = extractStaticFilters({ denyTools: ['rm_rf', 'shell'] });
        expect(result.excludedTools).toEqual(['rm_rf', 'shell']);
        expect(result.cleanedConfig.denyTools).toBeUndefined();
    });

    it('preserva denyPatterns no cleanedConfig (SDK não suporta regex)', () => {
        const pattern = /shell_.*/;
        const result = extractStaticFilters({ denyPatterns: [pattern] });
        expect(result.availableTools).toBeUndefined();
        expect(result.excludedTools).toBeUndefined();
        expect(result.cleanedConfig.denyPatterns).toEqual([pattern]);
    });

    it('preserva auditLog e outros campos no cleanedConfig', () => {
        const result = extractStaticFilters({
            allowTools: ['read_file'],
            denyTools: ['shell'],
            auditLog: true,
            debugTools: true,
        });
        expect(result.availableTools).toEqual(['read_file']);
        expect(result.excludedTools).toEqual(['shell']);
        expect(result.cleanedConfig.auditLog).toBe(true);
        expect(result.cleanedConfig.debugTools).toBe(true);
    });

    it('retorna cleanedConfig vazio quando sem listas', () => {
        const result = extractStaticFilters({ auditLog: true });
        expect(result.availableTools).toBeUndefined();
        expect(result.excludedTools).toBeUndefined();
        expect(result.cleanedConfig.auditLog).toBe(true);
    });

    it('copia arrays (sem referência aos originais)', () => {
        const allow = ['a', 'b'];
        const result = extractStaticFilters({ allowTools: allow });
        allow.push('c');
        expect(result.availableTools).toEqual(['a', 'b']);
    });
});

describe('E1 — isDynamicOnly', () => {
    it('true quando sem listas estáticas', () => {
        expect(isDynamicOnly({})).toBe(true);
        expect(isDynamicOnly({ auditLog: true })).toBe(true);
    });

    it('false quando tem allowTools', () => {
        expect(isDynamicOnly({ allowTools: ['read'] })).toBe(false);
    });

    it('false quando tem denyTools', () => {
        expect(isDynamicOnly({ denyTools: ['shell'] })).toBe(false);
    });

    it('false quando tem denyPatterns', () => {
        expect(isDynamicOnly({ denyPatterns: [/test/] })).toBe(false);
    });

    it('true com arrays vazios', () => {
        expect(isDynamicOnly({ allowTools: [], denyTools: [], denyPatterns: [] })).toBe(true);
    });
});

describe('E1 — mergeStaticFilters', () => {
    it('interseção de availableTools quando ambos definidos', () => {
        const a = { availableTools: ['a', 'b', 'c'], cleanedConfig: {} };
        const b = { availableTools: ['b', 'c', 'd'], cleanedConfig: {} };
        const result = mergeStaticFilters(a, b);
        expect(result.availableTools).toEqual(['b', 'c']);
    });

    it('union quando apenas um define availableTools', () => {
        const a = { availableTools: ['a', 'b'], cleanedConfig: {} };
        const b = { cleanedConfig: {} };
        const result = mergeStaticFilters(a, b);
        expect(result.availableTools).toEqual(['a', 'b']);
    });

    it('union de excludedTools', () => {
        const a = { excludedTools: ['x'], cleanedConfig: {} };
        const b = { excludedTools: ['x', 'y'], cleanedConfig: {} };
        const result = mergeStaticFilters(a, b);
        expect(result.excludedTools).toEqual(['x', 'y']);
    });

    it('ambos undefined → resultado sem campos', () => {
        const result = mergeStaticFilters({ cleanedConfig: {} }, { cleanedConfig: {} });
        expect(result.availableTools).toBeUndefined();
        expect(result.excludedTools).toBeUndefined();
    });
});

describe('E1.2 — createHooks dynamic-only path', () => {
    it('permite todas as tools quando sem listas estáticas', async () => {
        const hooks = createHooks({ auditLog: true });
        const result = await hooks.onPreToolUse?.({ toolName: 'any_tool', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        expect(result).toEqual({ permissionDecision: 'allow' });
    });

    it('askHandler nega quando retorna false', async () => {
        const hooks = createHooks({
            onPermissionAsk: async () => false,
        });
        const result = await hooks.onPreToolUse?.({ toolName: 'shell', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        expect(result?.permissionDecision).toBe('deny');
    });

    it('argsModifier retorna modifiedArgs', async () => {
        const hooks = createHooks({
            argsModifier: (name, args) => ({ ...args, injected: true }),
        });
        const result = await hooks.onPreToolUse?.(
            { toolName: 'test', toolArgs: { foo: 1 }, timestamp: 0, cwd: '/' },
            INV,
        );
        expect(result?.permissionDecision).toBe('allow');
        expect(result?.modifiedArgs).toEqual({ foo: 1, injected: true });
    });

    it('static path: denyTools nega tool listada', async () => {
        const hooks = createHooks({ denyTools: ['rm_rf'] });
        const result = await hooks.onPreToolUse?.({ toolName: 'rm_rf', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        expect(result?.permissionDecision).toBe('deny');
    });

    it('static path: allowTools nega tool não listada', async () => {
        const hooks = createHooks({ allowTools: ['read_file'] });
        const result = await hooks.onPreToolUse?.({ toolName: 'shell', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        expect(result?.permissionDecision).toBe('deny');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// E2 — Composer improvements
// ═════════════════════════════════════════════════════════════════════════════

describe('E2.1 — middleware composition', () => {
    it('executa middlewares em sequência com next()', async () => {
        /** @type {string[]} */
        const order = [];

        const hook = middleware(
            async (input, inv, next) => {
                order.push('mw1-before');
                const r = await next(input, inv);
                order.push('mw1-after');
                return r;
            },
            async (input, inv, next) => {
                order.push('mw2-before');
                const r = await next(input, inv);
                order.push('mw2-after');
                return r;
            },
            async () => {
                order.push('terminal');
                return { permissionDecision: 'allow' };
            },
        );

        const result = await hook({ toolName: 'test', toolArgs: {} }, INV);
        expect(order).toEqual(['mw1-before', 'mw2-before', 'terminal', 'mw2-after', 'mw1-after']);
        expect(result).toEqual({ permissionDecision: 'allow' });
    });

    it('rejeita se next() chamado múltiplas vezes', async () => {
        const hook = middleware(
            async (input, inv, next) => {
                await next(input, inv);
                return next(input, inv);
            },
            async () => ({ ok: true }),
        );

        await expect(hook({}, INV)).rejects.toThrow('next() chamado múltiplas vezes');
    });

    it('retorna undefined se não há handlers', async () => {
        const hook = middleware();
        expect(await hook({}, INV)).toBeUndefined();
    });
});

describe('E2.1 — loggingMiddleware', () => {
    it('não altera o resultado', async () => {
        const hook = middleware(loggingMiddleware('test'), async () => ({ permissionDecision: 'allow' }));
        const result = await hook({ toolName: 'x' }, INV);
        expect(result).toEqual({ permissionDecision: 'allow' });
    });
});

describe('E2.1 — forTools', () => {
    it('aplica middleware apenas para tools específicas', async () => {
        const spy = vi.fn(async (_input, _inv, next) => {
            return { permissionDecision: 'deny' };
        });

        const hook = middleware(forTools(['shell'], spy), async () => ({ permissionDecision: 'allow' }));

        // shell → spy intercepta
        const r1 = await hook({ toolName: 'shell', toolArgs: {} }, INV);
        expect(r1?.permissionDecision).toBe('deny');
        expect(spy).toHaveBeenCalledTimes(1);

        // read_file → bypassed
        const r2 = await hook({ toolName: 'read_file', toolArgs: {} }, INV);
        expect(r2?.permissionDecision).toBe('allow');
        expect(spy).toHaveBeenCalledTimes(1); // não chamou novamente
    });

    it('case insensitive por toolName', async () => {
        const spy = vi.fn(async () => ({ permissionDecision: 'deny' }));
        const hook = middleware(forTools(['Shell'], spy), async () => ({}));
        await hook({ toolName: 'SHELL', toolArgs: {} }, INV);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('E2.1 — existing composers still work', () => {
    it('composeHandlers: primeiro com decisão vence', async () => {
        const h = composeHandlers(
            async () => ({ permissionDecision: 'deny' }),
            async () => ({ permissionDecision: 'allow' }),
        );
        const r = await h({ toolName: 't' }, INV);
        expect(r.permissionDecision).toBe('deny');
    });

    it('pipeline: merge de todos os resultados', async () => {
        const h = pipeline(
            async () => ({ additionalContext: 'a' }),
            async () => ({ additionalContext: 'b' }),
        );
        const r = await h({}, INV);
        expect(r.additionalContext).toBe('b'); // segundo sobrescreve
    });

    it('conditional: executa handler correto', async () => {
        const h = conditional(
            (input) => /** @type {any} */ (input).flag === true,
            async () => ({ yes: true }),
            async () => ({ no: true }),
        );
        expect(await h({ flag: true }, INV)).toEqual({ yes: true });
        expect(await h({ flag: false }, INV)).toEqual({ no: true });
    });

    it('fallback: usa fallback em caso de erro', async () => {
        const h = fallback(
            async () => {
                throw new Error('boom');
            },
            async () => ({ fallback: true }),
        );
        expect(await h({}, INV)).toEqual({ fallback: true });
    });

    it('raceWithTimeout: retorna undefined se timeout', async () => {
        const slow = async () => new Promise((r) => setTimeout(() => r({ ok: true }), 5000));
        const h = raceWithTimeout(slow, 10);
        expect(await h({}, INV)).toBeUndefined();
    });

    it('memoize: retorna cache na segunda chamada', async () => {
        const spy = vi.fn(async () => ({ cached: true }));
        const h = memoize(spy, (input) => /** @type {any} */ (input).key);
        await h({ key: 'k1' }, INV);
        await h({ key: 'k1' }, INV);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// E2.2 — Cleanup handler
// ═════════════════════════════════════════════════════════════════════════════

describe('E2.2 — createCleanupHandler', () => {
    it('executa todos os cleanups em sequência', async () => {
        /** @type {string[]} */
        const calls = [];
        const handler = createCleanupHandler([
            async (sid) => {
                calls.push(`clean1:${sid}`);
            },
            async (sid) => {
                calls.push(`clean2:${sid}`);
            },
        ]);

        await handler({ reason: 'shutdown', timestamp: 0, cwd: '/' }, { sessionId: 'abc' });
        expect(calls).toEqual(['clean1:abc', 'clean2:abc']);
    });

    it('continua após erro em um cleanup', async () => {
        /** @type {string[]} */
        const calls = [];
        const handler = createCleanupHandler([
            async () => {
                throw new Error('falha');
            },
            async (sid) => {
                calls.push(`ok:${sid}`);
            },
        ]);

        await handler({ reason: 'error', timestamp: 0, cwd: '/' }, { sessionId: 'x' });
        expect(calls).toEqual(['ok:x']);
    });

    it('funciona com 0 cleanups', async () => {
        const handler = createCleanupHandler([]);
        await expect(handler({ reason: 'done', timestamp: 0, cwd: '/' }, { sessionId: 'z' })).resolves.toBeUndefined();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// E3 — Audit Trail
// ═════════════════════════════════════════════════════════════════════════════

describe('E3.1 — AuditTrail', () => {
    /** @type {import('../../../../src/copilot/hooks/audit-trail.js').AuditTrail} */
    let trail;

    afterEach(() => {
        globalAuditTrail.clear();
    });

    it('registra e retorna decisões', () => {
        trail = new AuditTrail({ maxSize: 10 });
        trail.record({
            hookName: 'onPreToolUse',
            decision: 'allow',
            sessionId: 's1',
            toolName: 'read_file',
            timestamp: 1000,
        });
        expect(trail.size).toBe(1);
        const [first] = trail.tail(1);
        expect(first.toolName).toBe('read_file');
        expect(first.decision).toBe('allow');
    });

    it('respeita maxSize (ring buffer)', () => {
        trail = new AuditTrail({ maxSize: 3 });
        for (let i = 0; i < 5; i++) {
            trail.record({
                hookName: 'test',
                decision: 'allow',
                sessionId: 's',
                toolName: `tool-${i}`,
                timestamp: i,
            });
        }
        expect(trail.size).toBe(3);
        const all = trail.tail();
        expect(all.map((d) => d.toolName)).toEqual(['tool-4', 'tool-3', 'tool-2']);
    });

    it('query filtra por hookName', () => {
        trail = new AuditTrail();
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's', timestamp: 1 });
        trail.record({ hookName: 'post', decision: 'enrich', sessionId: 's', timestamp: 2 });
        const result = trail.query({ hookName: 'pre' });
        expect(result).toHaveLength(1);
        expect(result[0].hookName).toBe('pre');
    });

    it('query filtra por decision', () => {
        trail = new AuditTrail();
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's', timestamp: 1 });
        trail.record({ hookName: 'pre', decision: 'deny', sessionId: 's', timestamp: 2 });
        expect(trail.query({ decision: 'deny' })).toHaveLength(1);
    });

    it('query filtra por sessionId', () => {
        trail = new AuditTrail();
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's1', timestamp: 1 });
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's2', timestamp: 2 });
        expect(trail.query({ sessionId: 's2' })).toHaveLength(1);
    });

    it('query filtra por since', () => {
        trail = new AuditTrail();
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's', timestamp: 100 });
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's', timestamp: 200 });
        expect(trail.query({ since: 150 })).toHaveLength(1);
    });

    it('stats retorna contagens corretas', () => {
        trail = new AuditTrail();
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's', timestamp: 1 });
        trail.record({ hookName: 'pre', decision: 'allow', sessionId: 's', timestamp: 2 });
        trail.record({ hookName: 'pre', decision: 'deny', sessionId: 's', timestamp: 3 });
        trail.record({ hookName: 'error', decision: 'abort', sessionId: 's', timestamp: 4 });

        const s = trail.stats();
        expect(s.total).toBe(4);
        expect(s.allowedCount).toBe(2);
        expect(s.deniedCount).toBe(1);
        expect(s.errorCount).toBe(1);
        expect(s.byHook['pre']).toBe(3);
        expect(s.byHook['error']).toBe(1);
    });

    it('toJSON retorna decisions + stats', () => {
        trail = new AuditTrail();
        trail.record({ hookName: 'a', decision: 'allow', sessionId: 's', timestamp: 1 });
        const json = trail.toJSON();
        expect(json.decisions).toHaveLength(1);
        expect(json.stats.total).toBe(1);
    });

    it('clear limpa tudo', () => {
        trail = new AuditTrail();
        trail.record({ hookName: 'a', decision: 'allow', sessionId: 's', timestamp: 1 });
        trail.clear();
        expect(trail.size).toBe(0);
        expect(trail.tail()).toHaveLength(0);
    });
});

describe('E3.1 — withPreToolAudit', () => {
    afterEach(() => {
        globalAuditTrail.clear();
    });

    it('registra decisão allow no trail', async () => {
        const trail = new AuditTrail();
        const handler = withPreToolAudit(async () => ({ permissionDecision: /** @type {'allow'} */ ('allow') }), trail);
        await handler({ toolName: 'read', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        expect(trail.size).toBe(1);
        const [d] = trail.tail();
        expect(d.decision).toBe('allow');
        expect(d.toolName).toBe('read');
    });

    it('registra decisão deny no trail', async () => {
        const trail = new AuditTrail();
        const handler = withPreToolAudit(
            async () => ({
                permissionDecision: /** @type {'deny'} */ ('deny'),
                additionalContext: 'blocked by policy',
            }),
            trail,
        );
        await handler({ toolName: 'shell', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        const [d] = trail.tail();
        expect(d.decision).toBe('deny');
        expect(d.reason).toBe('blocked by policy');
    });

    it('registra modify quando modifiedArgs presente', async () => {
        const trail = new AuditTrail();
        const handler = withPreToolAudit(
            async () => ({ permissionDecision: /** @type {'allow'} */ ('allow'), modifiedArgs: { x: 1 } }),
            trail,
        );
        await handler({ toolName: 't', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        const [d] = trail.tail();
        expect(d.decision).toBe('modify');
    });
});

describe('E3.1 — withPostToolAudit', () => {
    it('registra enrich quando additionalContext presente', async () => {
        const trail = new AuditTrail();
        const handler = withPostToolAudit(async () => ({ additionalContext: 'extra info' }), trail);
        await handler({ toolName: 'test', toolArgs: {}, toolResult: 'ok', timestamp: 0, cwd: '/' }, INV);
        const [d] = trail.tail();
        expect(d.decision).toBe('enrich');
    });

    it('registra allow quando sem additionalContext', async () => {
        const trail = new AuditTrail();
        const handler = withPostToolAudit(async () => ({}), trail);
        await handler({ toolName: 'test', toolArgs: {}, toolResult: 'ok', timestamp: 0, cwd: '/' }, INV);
        const [d] = trail.tail();
        expect(d.decision).toBe('allow');
    });
});

describe('E3.1 — withErrorAudit', () => {
    it('registra decisão de erro no trail', async () => {
        const trail = new AuditTrail();
        const handler = withErrorAudit(
            async () => ({ errorHandling: /** @type {'retry'} */ ('retry'), retryCount: 3 }),
            trail,
        );
        await handler(
            { error: 'rate limit', errorContext: 'model_call', recoverable: true, timestamp: 0, cwd: '/' },
            INV,
        );
        const [d] = trail.tail();
        expect(d.decision).toBe('retry');
        expect(d.hookName).toBe('onErrorOccurred');
        expect(d.metadata).toEqual({ recoverable: true });
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// E3.2 — globalAuditTrail singleton
// ═════════════════════════════════════════════════════════════════════════════

describe('E3.2 — globalAuditTrail', () => {
    afterEach(() => {
        globalAuditTrail.clear();
    });

    it('é uma instância de AuditTrail', () => {
        expect(globalAuditTrail).toBeInstanceOf(AuditTrail);
    });

    it('withPreToolAudit usa globalAuditTrail por default', async () => {
        const handler = withPreToolAudit(async () => ({ permissionDecision: /** @type {'allow'} */ ('allow') }));
        await handler({ toolName: 'read', toolArgs: {}, timestamp: 0, cwd: '/' }, INV);
        expect(globalAuditTrail.size).toBe(1);
    });
});
