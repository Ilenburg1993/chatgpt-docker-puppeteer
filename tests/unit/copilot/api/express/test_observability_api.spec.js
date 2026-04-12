// @ts-check
/**
 * @file Faixa 38 — API Observability Routes Test Suite (F205-F212)
 *
 *   Testes para src/copilot/api/express/observability.js:
 *
 *   - GET /observability/health
 *   - GET /observability/metrics
 *   - GET /observability/quota
 *   - GET /observability/errors + /errors/stats
 *   - GET /observability/logs
 *   - POST /observability/errors/clear
 *   - POST /observability/log-level
 *   - GET /observability/audit + /audit-tail
 *   - POST /observability/audit/flush
 *   - GET /observability/otel-status
 *   - GET /observability/events/catalog + /events/dead-letter
 */

import observabilityRouterModule from '#copilot/api/express/observability';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

const {
    mockGetSummary,
    mockGetErrors,
    mockGetStats,
    mockClearErrors,
    mockGetRecentLogs,
    mockLog,
    mockGetStatusSnapshot,
    mockGetMcpStatus,
    mockIsNervMounted,
    mockGetLastQuotaSnapshots,
    mockGetCatalog,
    mockGetDeadLetters,
    mockGetAuditTail,
    mockDefaultAuditLog,
} = vi.hoisted(() => ({
    mockGetSummary: vi.fn(() => ({
        tools: { tool1: { calls: 5 } },
        tokens: { inputTokens: 100, outputTokens: 200 },
        counters: { 'tool.a': 1, 'tool.b': 2, 'other.x': 3 },
        sessions: { active: 1 },
        gauges: {},
    })),
    mockGetErrors: vi.fn((n) => []),
    mockGetStats: vi.fn(() => ({ total: 0, buffered: 0, byType: {} })),
    mockClearErrors: vi.fn(),
    mockGetRecentLogs: vi.fn((n, level) => []),
    mockLog: Object.assign(vi.fn(), { setLevel: vi.fn() }),
    mockGetStatusSnapshot: vi.fn(() => ({ status: 'idle' })),
    mockGetMcpStatus: vi.fn(() => ({ available: true, circuitOpen: false })),
    mockIsNervMounted: vi.fn(() => true),
    mockGetLastQuotaSnapshots: vi.fn(() => ({ snapshots: {}, ts: null })),
    mockGetCatalog: vi.fn(() => ({})),
    mockGetDeadLetters: vi.fn(() => []),
    mockGetAuditTail: vi.fn(() => []),
    mockDefaultAuditLog: { getLast: vi.fn(() => []), flush: vi.fn() },
}));

vi.mock('#copilot/observability/metrics', () => ({
    defaultMetrics: { getSummary: mockGetSummary },
}));

vi.mock('#copilot/observability/error-tracker', () => ({
    defaultErrorTracker: {
        getErrors: mockGetErrors,
        getStats: mockGetStats,
        clearErrors: mockClearErrors,
    },
}));

vi.mock('#copilot/observability/logger', () => ({
    log: mockLog,
    getRecentLogs: mockGetRecentLogs,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('#copilot/agent', () => ({
    alwaysAliveAgent: { getStatusSnapshot: mockGetStatusSnapshot },
}));

vi.mock('#copilot/bridges/mcp-tool-bridge', () => ({
    getMcpStatus: mockGetMcpStatus,
}));

vi.mock('#copilot/bridges/nerv-bridge', () => ({
    isMounted: mockIsNervMounted,
}));

vi.mock('#copilot/config/env', () => ({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));

vi.mock('#copilot/observability/event-collector', () => ({
    getLastQuotaSnapshots: mockGetLastQuotaSnapshots,
}));

vi.mock('#copilot/observability/event-catalog', () => ({
    getCatalog: mockGetCatalog,
    getDeadLetters: mockGetDeadLetters,
}));

vi.mock('#copilot/observability/otel', () => ({
    isOtelEnabled: vi.fn(() => true),
    DEFAULT_OTEL_FILE: '/tmp/otel-traces.json',
}));

vi.mock('#copilot/audit/pipeline', () => ({
    defaultAuditLog: mockDefaultAuditLog,
    getAuditTail: mockGetAuditTail,
}));

vi.mock('#copilot/config', () => ({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));

vi.mock('#copilot/core/error-handlers', () => ({
    logSwallowed: vi.fn(),
}));

vi.mock('#copilot/bridges', () => ({
    getMcpStatus: mockGetMcpStatus,
    isMounted: mockIsNervMounted,
}));

vi.mock('#copilot/services', () => ({
    createAuditService: vi.fn(() => ({
        getDefaultLog: () => mockDefaultAuditLog,
        getTail: (n) => mockGetAuditTail(n),
        flush: vi.fn(),
    })),
}));

vi.mock('#copilot/observability', () => ({
    log: mockLog,
    getRecentLogs: mockGetRecentLogs,
    LOG_DIR: '/tmp/test-logs',
    defaultMetrics: { getSummary: mockGetSummary },
    defaultErrorTracker: {
        getErrors: mockGetErrors,
        getStats: mockGetStats,
        clearErrors: mockClearErrors,
    },
    getLastQuotaSnapshots: mockGetLastQuotaSnapshots,
    getCatalog: mockGetCatalog,
    getDeadLetters: mockGetDeadLetters,
    isOtelEnabled: vi.fn(() => true),
    DEFAULT_OTEL_FILE: '/tmp/otel-traces.json',
}));

// ─── Test App ────────────────────────────────────────────────────────────────

function createApp() {
    const app = express();
    app.use(express.json());
    const router = observabilityRouterModule({ agent: { getStatusSnapshot: mockGetStatusSnapshot } });
    app.use('/api/sdk', router);
    return app;
}

let app = createApp();

beforeEach(() => {
    vi.clearAllMocks();
    mockGetSummary.mockReturnValue({
        tools: { tool1: { calls: 5 } },
        tokens: { inputTokens: 100, outputTokens: 200 },
        counters: { 'tool.a': 1, 'tool.b': 2, 'other.x': 3 },
        sessions: { active: 1 },
        gauges: {},
    });
    mockGetErrors.mockReturnValue([]);
    mockGetStats.mockReturnValue({ total: 0, buffered: 0, byType: {} });
    mockGetRecentLogs.mockReturnValue([]);
    mockGetStatusSnapshot.mockReturnValue({ status: 'idle' });
    mockGetMcpStatus.mockReturnValue({ available: true, circuitOpen: false });
    mockIsNervMounted.mockReturnValue(true);
    mockGetLastQuotaSnapshots.mockReturnValue({ snapshots: {}, ts: null });
    mockGetCatalog.mockReturnValue({});
    mockGetDeadLetters.mockReturnValue([]);
    mockGetAuditTail.mockReturnValue([]);
    mockDefaultAuditLog.getLast.mockReturnValue([]);
    mockDefaultAuditLog.flush.mockReset();
    app = createApp();
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/health
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/health', () => {
    it('retorna 200 com todos componentes healthy', async () => {
        const res = await request(app).get('/api/sdk/observability/health');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.status).toBe('healthy');
        expect(res.body.components).toBeDefined();
        expect(res.body.components.agent.status).toBe('healthy');
        expect(res.body.components.mcp_bridge.status).toBe('healthy');
        expect(res.body.components.nerv_bridge.status).toBe('healthy');
    });

    it('retorna 503 quando agent não disponível', async () => {
        mockGetStatusSnapshot.mockImplementation(() => {
            throw new Error('not started');
        });

        const res = await request(app).get('/api/sdk/observability/health');

        expect(res.status).toBe(503);
        expect(res.body.ok).toBe(false);
        expect(res.body.components.agent.status).toBe('unhealthy');
    });

    it('marca nerv_bridge unhealthy quando não montado', async () => {
        mockIsNervMounted.mockReturnValue(false);

        const res = await request(app).get('/api/sdk/observability/health');

        expect(res.body.components.nerv_bridge.status).toBe('unhealthy');
    });

    it('marca mcp_bridge degraded quando circuit open', async () => {
        mockGetMcpStatus.mockReturnValue({ available: true, circuitOpen: true });

        const res = await request(app).get('/api/sdk/observability/health');

        expect(res.body.components.mcp_bridge.status).toBe('degraded');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/metrics
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/metrics', () => {
    it('retorna métricas completas', async () => {
        const res = await request(app).get('/api/sdk/observability/metrics');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.tools).toHaveProperty('tool1');
    });

    it('filtra counters por prefix', async () => {
        const res = await request(app).get('/api/sdk/observability/metrics').query({ prefix: 'tool.' });

        expect(res.status).toBe(200);
        expect(res.body.counters).toHaveProperty('tool.a');
        expect(res.body.counters).toHaveProperty('tool.b');
        expect(res.body.counters).not.toHaveProperty('other.x');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/quota
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/quota', () => {
    it('retorna quota vazia por padrão', async () => {
        const res = await request(app).get('/api/sdk/observability/quota');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.hasData).toBe(false);
    });

    it('retorna quota com dados', async () => {
        mockGetLastQuotaSnapshots.mockReturnValue({
            snapshots: { default: { remainingPercentage: 80 } },
            ts: Date.now(),
        });

        const res = await request(app).get('/api/sdk/observability/quota');

        expect(res.body.hasData).toBe(true);
        expect(res.body.quotaSnapshots.default.remainingPercentage).toBe(80);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/errors + /errors/stats
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/errors', () => {
    it('retorna erros recentes com default n=20', async () => {
        mockGetErrors.mockReturnValue([{ msg: 'err1', source: 'agent' }]);

        const res = await request(app).get('/api/sdk/observability/errors');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
        expect(mockGetErrors).toHaveBeenCalledWith(20, undefined);
    });

    it('filtra por source', async () => {
        mockGetErrors.mockReturnValue([]);

        const res = await request(app).get('/api/sdk/observability/errors').query({ source: 'agent', n: 5 });

        expect(mockGetErrors).toHaveBeenCalledWith(5, 'agent');
    });
});

describe('F38 — GET /observability/errors/stats', () => {
    it('retorna stats de erros', async () => {
        mockGetStats.mockReturnValue({ total: 10, buffered: 5, byType: { Error: 10 } });

        const res = await request(app).get('/api/sdk/observability/errors/stats');

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(10);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /observability/errors/clear
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — POST /observability/errors/clear', () => {
    it('limpa buffer de erros', async () => {
        const res = await request(app).post('/api/sdk/observability/errors/clear');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(mockClearErrors).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/logs
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/logs', () => {
    it('retorna logs com default n=50', async () => {
        mockGetRecentLogs.mockReturnValue([{ level: 'INFO', msg: 'hello' }]);

        const res = await request(app).get('/api/sdk/observability/logs');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
        expect(mockGetRecentLogs).toHaveBeenCalledWith(50, undefined);
    });

    it('filtra por level', async () => {
        const res = await request(app).get('/api/sdk/observability/logs').query({ level: 'error', n: 10 });

        expect(mockGetRecentLogs).toHaveBeenCalledWith(10, 'ERROR');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /observability/log-level
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — POST /observability/log-level', () => {
    it('rejeita nível inválido', async () => {
        const res = await request(app).post('/api/sdk/observability/log-level').send({ level: 'TRACE' });

        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });

    it('aceita nível válido', async () => {
        const res = await request(app).post('/api/sdk/observability/log-level').send({ level: 'DEBUG' });

        expect(res.status).toBe(200);
        expect(res.body.level).toBe('DEBUG');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/audit + /audit-tail + POST /audit/flush
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/audit', () => {
    it('retorna audit entries', async () => {
        mockDefaultAuditLog.getLast.mockReturnValue([{ type: 'tool_call', ts: 1000 }]);

        const res = await request(app).get('/api/sdk/observability/audit');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
    });

    it('filtra por type', async () => {
        mockDefaultAuditLog.getLast.mockReturnValue([
            { type: 'tool_call', ts: 1000 },
            { type: 'session_start', ts: 2000 },
        ]);

        const res = await request(app).get('/api/sdk/observability/audit').query({ type: 'tool_call' });

        expect(res.body.count).toBe(1);
    });
});

describe('F38 — GET /observability/audit-tail', () => {
    it('retorna tail com filtro sessionId', async () => {
        mockGetAuditTail.mockReturnValue([
            { sessionId: 's1', toolName: 't1' },
            { sessionId: 's2', toolName: 't2' },
        ]);

        const res = await request(app).get('/api/sdk/observability/audit-tail').query({ sessionId: 's1' });

        expect(res.body.count).toBe(1);
        expect(res.body.entries[0].sessionId).toBe('s1');
    });
});

describe('F38 — POST /observability/audit/flush', () => {
    it('faz flush do audit log', async () => {
        const res = await request(app).post('/api/sdk/observability/audit/flush');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(mockDefaultAuditLog.flush).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/otel-status
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/otel-status', () => {
    it('retorna status do OpenTelemetry', async () => {
        const res = await request(app).get('/api/sdk/observability/otel-status');

        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(true);
        expect(res.body.endpoint).toBe('http://localhost:4318');
        expect(res.body.traceFile).toBe('/tmp/otel-traces.json');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /observability/events/catalog + /events/dead-letter
// ═══════════════════════════════════════════════════════════════════════════════

describe('F38 — GET /observability/events/catalog', () => {
    it('retorna catálogo de eventos', async () => {
        mockGetCatalog.mockReturnValue({ 'session.start': { count: 5 } });

        const res = await request(app).get('/api/sdk/observability/events/catalog');

        expect(res.status).toBe(200);
        expect(res.body.catalog).toHaveProperty('session.start');
    });
});

describe('F38 — GET /observability/events/dead-letter', () => {
    it('retorna dead letters', async () => {
        mockGetDeadLetters.mockReturnValue([{ event: 'unknown', ts: 1000 }]);

        const res = await request(app).get('/api/sdk/observability/events/dead-letter');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
    });

    it('respeita limit query param', async () => {
        const res = await request(app).get('/api/sdk/observability/events/dead-letter').query({ limit: 5 });

        expect(res.status).toBe(200);
        expect(mockGetDeadLetters).toHaveBeenCalledWith(5);
    });
});
