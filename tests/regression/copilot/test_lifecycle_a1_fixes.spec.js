// @ts-nocheck -- regression test with mocks
/**
 * Testes de regressão — Fase A1 (BUG-03, BUG-06, BUG-10)
 *
 * Valida que lifecycle.js:
 *
 * - BUG-03: buildSessionConfig produz objeto tipado (sem Record<string,unknown>)
 * - BUG-06: reasoningEffort inválido emite WARN log
 * - BUG-10: infiniteSessions usa INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD (0.8)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLog, mockCreateSession, mockResumeSession, mockApproveAll } = vi.hoisted(() => ({
    mockLog: vi.fn(),
    mockCreateSession: vi.fn(),
    mockResumeSession: vi.fn(),
    mockApproveAll: vi.fn(() => 'approved'),
}));

// ─── Mock: logger (lifecycle.js importa de '../logger.js' → resolve para sdk/logger.js) ───
vi.mock('#copilot/sdk/logger', async () => {
    return {
        log: mockLog,
        setSdkLogger: vi.fn(),
    };
});
// Fallback para o path relativo que vitest pode resolver
vi.mock('../../../../src/copilot/sdk/logger.js', async () => {
    return {
        log: mockLog,
        setSdkLogger: vi.fn(),
    };
});

// ─── Mock: error-handlers ──────────────────────────────────────────────────
vi.mock('../../../../src/core/error-handlers.js', () => ({
    toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

// ─── Mock: SDK ─────────────────────────────────────────────────────────────
vi.mock('@github/copilot-sdk', () => ({
    CopilotClient: vi.fn(),
    approveAll: mockApproveAll,
    defineTool: vi.fn(),
    SYSTEM_PROMPT_SECTIONS: {
        guidelines: { name: 'guidelines' },
        identity: { name: 'identity' },
        context: { name: 'context' },
        safety: { name: 'safety' },
        responseFormat: { name: 'responseFormat' },
        tools: { name: 'tools' },
        abilities: { name: 'abilities' },
        instructions: { name: 'instructions' },
        conversationRules: { name: 'conversationRules' },
        errorHandling: { name: 'errorHandling' },
    },
}));

import { createSession, resumeSession } from '../../../../src/copilot/sdk/session/lifecycle.js';

// ─── Helper: fake client ───────────────────────────────────────────────────

function fakeClient() {
    return {
        createSession: mockCreateSession.mockResolvedValue({
            sessionId: 'sess-test-a1',
            rpc: {},
        }),
        resumeSession: mockResumeSession.mockResolvedValue({
            sessionId: 'sess-test-a1',
            rpc: {},
        }),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('Fase A1 — Regressão lifecycle.js', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── BUG-03: Tipagem SessionConfig ─────────────────────────────────

    describe('BUG-03: buildSessionConfig tipado', () => {
        it('createSession passa config com propriedades tipadas (não string-indexed)', async () => {
            const client = fakeClient();
            await createSession(client, {
                model: 'gpt-4.1',
                streaming: false,
                workingDirectory: '/tmp/test',
            });

            expect(mockCreateSession).toHaveBeenCalledOnce();
            const config = mockCreateSession.mock.calls[0][0];

            // Propriedades diretas (não via cfg['key'])
            expect(config.model).toBe('gpt-4.1');
            expect(config.streaming).toBe(false);
            expect(config.workingDirectory).toBe('/tmp/test');
            expect(config.onPermissionRequest).toBeDefined();
        });

        it('resumeSession passa config sem campos de create (model, workingDirectory)', async () => {
            const client = fakeClient();
            await resumeSession(client, 'sess-123', {
                streaming: true,
            });

            expect(mockResumeSession).toHaveBeenCalledOnce();
            const config = mockResumeSession.mock.calls[0][1];

            expect(config.streaming).toBe(true);
            expect(config.onPermissionRequest).toBeDefined();
            // Campos de create NÃO devem estar presentes
            expect(config.model).toBeUndefined();
            expect(config.workingDirectory).toBeUndefined();
        });

        it('disableResume só é incluído em modo resume', async () => {
            const client = fakeClient();
            await resumeSession(client, 'sess-456', {
                disableResume: true,
            });

            const config = mockResumeSession.mock.calls[0][1];
            expect(config.disableResume).toBe(true);
        });

        it('mcpServers e customAgents são passados corretamente em create', async () => {
            const client = fakeClient();
            const mcpServers = { local: { command: 'node', args: ['server.js'] } };
            const customAgents = [{ name: 'test-agent', prompt: 'You are a test agent' }];

            await createSession(client, {
                mcpServers,
                customAgents,
            });

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.mcpServers).toEqual(mcpServers);
            expect(config.customAgents).toEqual(customAgents);
        });
    });

    // ─── BUG-06: Validação reasoningEffort ──────────────────────────────

    describe('BUG-06: reasoningEffort validado', () => {
        it('valor válido não emite WARN de reasoningEffort', async () => {
            const client = fakeClient();
            await createSession(client, { reasoningEffort: 'high', onPermissionRequest: mockApproveAll });

            const warnCalls = mockLog.mock.calls.filter(
                ([level, msg]) => level === 'WARN' && String(msg).includes('reasoningEffort'),
            );
            expect(warnCalls).toHaveLength(0);

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.reasoningEffort).toBe('high');
        });

        it('xhigh (válido no SDK) não emite WARN de reasoningEffort', async () => {
            const client = fakeClient();
            await createSession(client, { reasoningEffort: 'xhigh', onPermissionRequest: mockApproveAll });

            const warnCalls = mockLog.mock.calls.filter(
                ([level, msg]) => level === 'WARN' && String(msg).includes('reasoningEffort'),
            );
            expect(warnCalls).toHaveLength(0);
        });

        it('valor inválido emite WARN mas ainda passa ao SDK', async () => {
            const client = fakeClient();
            await createSession(client, {
                reasoningEffort: /** @type {any} */ ('maximum'),
                onPermissionRequest: mockApproveAll,
            });

            // Deve ter emitido WARN
            const warnCalls = mockLog.mock.calls.filter(([level]) => level === 'WARN');
            expect(warnCalls.length).toBeGreaterThanOrEqual(1);
            expect(warnCalls[0][1]).toContain('maximum');
            expect(warnCalls[0][1]).toContain('inválido');

            // Valor ainda é passado (SDK pode ter razões para aceitar)
            const config = mockCreateSession.mock.calls[0][0];
            expect(config.reasoningEffort).toBe('maximum');
        });
    });

    // ─── BUG-10: Compaction threshold alinhado ──────────────────────────

    describe('BUG-10: infiniteSessions threshold alinhado com SDK', () => {
        it('default backgroundCompactionThreshold é 0.8 (INFINITE_SESSION_DEFAULTS)', async () => {
            const client = fakeClient();
            await createSession(client, {
                infiniteSessions: { enabled: true },
            });

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.infiniteSessions).toBeDefined();
            expect(config.infiniteSessions.enabled).toBe(true);
            // BUG-10: era 0.75. Agora deve ser 0.8 (INFINITE_SESSION_DEFAULTS)
            expect(config.infiniteSessions.backgroundCompactionThreshold).toBe(0.8);
        });

        it('override explícito de threshold é respeitado', async () => {
            const client = fakeClient();
            await createSession(client, {
                infiniteSessions: {
                    enabled: true,
                    backgroundCompactionThreshold: 0.9,
                },
            });

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.infiniteSessions.backgroundCompactionThreshold).toBe(0.9);
        });

        it('bufferExhaustionThreshold é incluído quando explícito', async () => {
            const client = fakeClient();
            await createSession(client, {
                infiniteSessions: {
                    enabled: true,
                    bufferExhaustionThreshold: 0.95,
                },
            });

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.infiniteSessions.bufferExhaustionThreshold).toBe(0.95);
        });

        it('infiniteSessions NÃO é incluído quando não fornecido', async () => {
            const client = fakeClient();
            await createSession(client, { model: 'gpt-4.1' });

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.infiniteSessions).toBeUndefined();
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fase A2 — Regressão SessionConfig faltantes + approveAll
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fase A2 — Regressão lifecycle.js', () => {
    beforeEach(() => {
        mockLog.mockClear();
        mockCreateSession.mockClear();
        mockResumeSession.mockClear();
    });

    // ─── A2.2: clientName passado ao SDK ────────────────────────────────

    describe('A2.2: clientName é passado ao SDK', () => {
        it('clientName aparece na config quando fornecido', async () => {
            const client = fakeClient();
            await createSession(client, {
                clientName: 'chatgpt-docker-puppeteer',
                onPermissionRequest: mockApproveAll,
            });

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.clientName).toBe('chatgpt-docker-puppeteer');
        });

        it('clientName ausente NÃO aparece na config', async () => {
            const client = fakeClient();
            await createSession(client, {
                model: 'gpt-4.1',
                onPermissionRequest: mockApproveAll,
            });

            const config = mockCreateSession.mock.calls[0][0];
            expect(config.clientName).toBeUndefined();
        });
    });

    // ─── A2.3: WARN ao usar approveAll fallback ─────────────────────────

    describe('A2.3: approveAll fallback emite WARN', () => {
        it('sem onPermissionRequest emite WARN de fallback', async () => {
            const client = fakeClient();
            await createSession(client, { model: 'gpt-4.1' });

            const warnCalls = mockLog.mock.calls.filter(
                ([level, msg]) => level === 'WARN' && String(msg).includes('approveAll'),
            );
            expect(warnCalls).toHaveLength(1);
        });

        it('com onPermissionRequest NÃO emite WARN de fallback', async () => {
            const client = fakeClient();
            await createSession(client, {
                model: 'gpt-4.1',
                onPermissionRequest: mockApproveAll,
            });

            const warnCalls = mockLog.mock.calls.filter(
                ([level, msg]) => level === 'WARN' && String(msg).includes('approveAll'),
            );
            expect(warnCalls).toHaveLength(0);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fase A3 — boot-wiring lifecycle, novos campos SessionConfig
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fase A3 — boot-wiring lifecycle + SessionConfig fields', () => {
    beforeEach(() => {
        mockLog.mockClear();
        mockCreateSession.mockClear();
        mockResumeSession.mockClear();
    });

    // ─── A3.1: boot-wiring importa e usa client-events.js ──────────────

    describe('A3.1: boot-wiring usa onLifecycleEvents de client-events.js', () => {
        it('boot-wiring.js importa onLifecycleEvents e LIFECYCLE_EVENTS', async () => {
            const fs = await import('node:fs');
            const src = fs.readFileSync(
                new URL('../../../src/copilot/agent/session/boot-wiring.js', import.meta.url),
                'utf-8',
            );
            expect(src).toContain('import { LIFECYCLE_EVENTS, onLifecycleEvents }');
            expect(src).toContain("from '../../sdk/session/client-events.js'");
        });

        it('boot-wiring.js NÃO usa SESSION_LIFECYCLE_EVENTS diretamente em client.on()', async () => {
            const fs = await import('node:fs');
            const src = fs.readFileSync(
                new URL('../../../src/copilot/agent/session/boot-wiring.js', import.meta.url),
                'utf-8',
            );
            // Seção 3 não deve mais ter client.on(SESSION_LIFECYCLE_EVENTS.X, ...)
            const section3Match = src.match(/\/\/ ── 3\. Client lifecycle[\s\S]*?\/\/ ── 4\./);
            if (section3Match) {
                expect(section3Match[0]).not.toMatch(/client\.on\(SESSION_LIFECYCLE_EVENTS\./);
                expect(section3Match[0]).toContain('onLifecycleEvents');
            }
        });
    });

    // ─── A3 — Novos campos SessionConfig passados ao SDK ────────────────

    describe('A3: novos campos SessionConfig passados ao SDK', () => {
        const newFields = [
            'availableTools',
            'excludedTools',
            'configDir',
            'onEvent',
            'agent',
            'skillDirectories',
            'disabledSkills',
        ];

        for (const field of newFields) {
            it(`campo '${field}' é passado ao SDK quando fornecido`, async () => {
                const client = fakeClient();
                const testValue = field === 'onEvent' ? vi.fn() : `test-${field}`;
                await createSession(client, {
                    model: 'gpt-4.1',
                    onPermissionRequest: mockApproveAll,
                    [field]: testValue,
                });

                const config = mockCreateSession.mock.calls[0][0];
                expect(config[field]).toBe(testValue);
            });

            it(`campo '${field}' ausente NÃO aparece na config`, async () => {
                const client = fakeClient();
                await createSession(client, {
                    model: 'gpt-4.1',
                    onPermissionRequest: mockApproveAll,
                });

                const config = mockCreateSession.mock.calls[0][0];
                expect(config[field]).toBeUndefined();
            });
        }
    });
});
