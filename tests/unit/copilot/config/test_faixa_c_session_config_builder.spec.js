// @ts-check
/**
 * tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js
 *
 * Faixa C: Testes para SessionConfigBuilder e ClientOptionsBuilder.
 */

import { describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
}));

vi.mock('#copilot/observability/logger', () => ({
    log: mocks.log,
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

vi.mock('#copilot/boot', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        resolvePersistentConfigFile: vi.fn((name) => `/tmp/${name}`),
        COPILOT_PACKAGE_ROOT: '/workspace',
        WORKSPACE_ROOT: '/workspace',
        resolveHooksStateDir: vi.fn(() => '/workspace/.github/hooks/state'),
        resolveWorkspacePath: vi.fn((...parts) => ['/workspace', ...parts].join('/').replace(/\/+/g, '/')),
        readBootSkillConfig: vi.fn(() => ({ enableSkillDiscovery: true })),
    };
});

vi.mock(
    '#copilot/testing/config/env',
    () =>
        new Proxy(
            {
                COPILOT_MCP_SERVERS: '',
                COPILOT_CUSTOM_AGENTS: '',
                COPILOT_DISABLED_AGENTS: '',
                COPILOT_OPERATIONAL_PROFILE: 'production',
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
            },
            {
                get(target, prop) {
                    return Reflect.get(target, prop);
                },
            },
        ),
);

vi.mock('../../../../src/copilot/config/sdk-config-port.js', async () => {
    const clientOptions = /** @type {Record<string, unknown>} */ (
        await import('../../../../src/copilot/sdk/session/client-options.js')
    );
    return {
        BUILTIN_HANDLER_MAP: new Map(),
        ClientOptionsBuilder: clientOptions['ClientOptionsBuilder'],
        buildCopilotClientOptionsFromEnv: clientOptions['buildCopilotClientOptionsFromEnv'],
        buildServerCopilotClientOptions: clientOptions['buildServerCopilotClientOptions'],
        buildTerminalCopilotClientOptions: clientOptions['buildTerminalCopilotClientOptions'],
        SYSTEM_MESSAGE_SECTIONS: {},
        SYSTEM_PROMPT_SECTIONS: {},
        INFINITE_SESSION_DEFAULTS: {
            BACKGROUND_COMPACTION_THRESHOLD: 0.8,
        },
        REASONING_EFFORTS: {
            LOW: 'low',
            MEDIUM: 'medium',
            HIGH: 'high',
            XHIGH: 'xhigh',
        },
        approveAll: vi.fn(async () => ({ behavior: 'allow', updatedInput: undefined })),
        createConfiguredPermissionHandler: vi.fn(() => vi.fn(async () => ({ kind: 'approve-once' }))),
        getCustomToolDefinitions: vi.fn(() => []),
        getToolsConfig: vi.fn(async () => ({ allowlist: null, denylist: [] })),
        patchToolsConfig: vi.fn(async () => ({ success: true })),
        registerCustomTool: vi.fn(async () => ({ success: true })),
        removeCustomTool: vi.fn(async () => ({ success: true })),
        validateProviderConfig: vi.fn((value) => {
            const provider = /** @type {{ type?: string; baseUrl?: string }} */ (value);
            if (provider.type === 'openai' && !provider.baseUrl) {
                throw new Error('baseUrl is required');
            }
            return {
                ...provider,
                ...(typeof provider.baseUrl === 'string' ? { baseUrl: provider.baseUrl.replace(/\/+$/, '') } : {}),
            };
        }),
        resolvePersistentConfigFile: vi.fn((name) => `/tmp/${name}`),
    };
});

// ─── Imports ────────────────────────────────────────────────────────────────

import {
    ClientOptionsBuilder,
    buildCopilotClientOptionsFromEnv,
    buildServerCopilotClientOptions,
    buildTerminalCopilotClientOptions,
} from '../../../../src/copilot/config/client-options.js';
import { ResumeSessionConfigBuilder } from '../../../../src/copilot/config/resume-session-config.js';
import { SessionConfigBuilder } from '../../../../src/copilot/config/session-config.js';

// ═════════════════════════════════════════════════════════════════════════════
// C1 — SessionConfigBuilder
// ═════════════════════════════════════════════════════════════════════════════

describe('SessionConfigBuilder', () => {
    it('build() retorna config com defaults (onPermissionRequest + streaming)', () => {
        const config = new SessionConfigBuilder().build();
        expect(config.onPermissionRequest).toBeDefined();
        expect(typeof config.onPermissionRequest).toBe('function');
        expect(config.streaming).toBe(true);
    });

    it('build() registra a política default quando onPermissionRequest não é fornecido', () => {
        new SessionConfigBuilder().build();
        expect(mocks.log).toHaveBeenCalledWith(
            'INFO',
            expect.stringContaining("política padrão configurável 'approve_all'"),
        );
    });

    it('model() define o modelo', () => {
        const config = new SessionConfigBuilder().model('gpt-4.1').build();
        expect(config.model).toBe('gpt-4.1');
    });

    it('clientName() define o nome do client', () => {
        const config = new SessionConfigBuilder().clientName('my-app').build();
        expect(config.clientName).toBe('my-app');
    });

    it('workingDirectory() define o diretório de trabalho', () => {
        const config = new SessionConfigBuilder().workingDirectory('/tmp/work').build();
        expect(config.workingDirectory).toBe('/tmp/work');
    });

    it('configDir() define o diretório de configuração', () => {
        const config = new SessionConfigBuilder().configDir('/tmp/config').build();
        expect(config.configDirectory).toBe('/tmp/config');
    });

    it('streaming(false) desativa streaming', () => {
        const config = new SessionConfigBuilder().streaming(false).build();
        expect(config.streaming).toBe(false);
    });

    it('sessionLimits() configura soft cap explícito de AI Credits', () => {
        const config = new SessionConfigBuilder().sessionLimits({ maxAiCredits: 250 }).build();
        expect(config.sessionLimits).toEqual({ maxAiCredits: 250 });
    });

    it('sessionLimits() rejeita caps não positivos ou não finitos', () => {
        expect(() => new SessionConfigBuilder().sessionLimits({ maxAiCredits: 0 })).toThrow(/maxAiCredits/u);
        expect(() => new SessionConfigBuilder().sessionLimits({ maxAiCredits: Number.NaN })).toThrow(/maxAiCredits/u);
    });

    it('tools() define ferramentas', () => {
        const tools = [{ name: 'my_tool', description: 'Test' }];
        const config = new SessionConfigBuilder().tools(/** @type {any} */ (tools)).build();
        expect(config.tools).toEqual(tools);
    });

    it('availableTools() define allowlist', () => {
        const config = new SessionConfigBuilder().availableTools(['tool_a', 'tool_b']).build();
        expect(config.availableTools).toEqual(['tool_a', 'tool_b']);
    });

    it('excludedTools() define denylist', () => {
        const config = new SessionConfigBuilder().excludedTools(['powershell']).build();
        expect(config.excludedTools).toEqual(['powershell']);
    });

    it('availableTools() e excludedTools() aceitam ToolSet do SDK 1.0', () => {
        const toolSet = { toArray: () => ['builtin:read_file'] };
        const config = new SessionConfigBuilder()
            .availableTools(/** @type {any} */ (toolSet))
            .excludedTools(/** @type {any} */ (toolSet))
            .build();
        expect(config.availableTools).toBe(toolSet);
        expect(config.excludedTools).toBe(toolSet);
    });

    it('skillDirectories() define diretórios de skills', () => {
        const config = new SessionConfigBuilder().skillDirectories(['.github/skills']).build();
        expect(config.skillDirectories).toEqual(['.github/skills']);
    });

    it('disabledSkills() define skills desabilitadas', () => {
        const config = new SessionConfigBuilder().disabledSkills(['my-skill']).build();
        expect(config.disabledSkills).toEqual(['my-skill']);
    });

    it('agent() define agente customizado', () => {
        const config = new SessionConfigBuilder().agent('diagnostic').build();
        expect(config.agent).toBe('diagnostic');
    });

    it('customAgents() define configuração de agentes', () => {
        const agents = [{ name: 'task', model: 'gpt-4.1' }];
        const config = new SessionConfigBuilder().customAgents(/** @type {any} */ (agents)).build();
        expect(config.customAgents).toEqual(agents);
    });

    it('mcpServers() define servidores MCP', () => {
        const servers = { myServer: { command: 'node', args: ['server.js'] } };
        const config = new SessionConfigBuilder().mcpServers(/** @type {any} */ (servers)).build();
        expect(config.mcpServers).toEqual(servers);
    });

    it('systemMessage() define configuração de system message', () => {
        const msg = { mode: /** @type {const} */ ('replace'), sections: {} };
        const config = new SessionConfigBuilder().systemMessage(/** @type {any} */ (msg)).build();
        expect(config.systemMessage).toEqual(msg);
    });

    it('infiniteSessions() aplica defaults canônicos', () => {
        const config = new SessionConfigBuilder().infiniteSessions({ enabled: true }).build();
        expect(config.infiniteSessions).toBeDefined();
        expect(config.infiniteSessions?.enabled).toBe(true);
        expect(config.infiniteSessions?.backgroundCompactionThreshold).toBe(0.8);
    });

    it('infiniteSessions() respeita threshold customizado', () => {
        const config = new SessionConfigBuilder()
            .infiniteSessions({ enabled: true, backgroundCompactionThreshold: 0.5 })
            .build();
        expect(config.infiniteSessions?.backgroundCompactionThreshold).toBe(0.5);
    });

    it('reasoningEffort() com valor válido é aceito', () => {
        const config = new SessionConfigBuilder().reasoningEffort('high').build();
        expect(config.reasoningEffort).toBe('high');
    });

    it('reasoningEffort() com valor inválido emite WARN', () => {
        mocks.log.mockClear();
        new SessionConfigBuilder().reasoningEffort(/** @type {any} */ ('invalid')).build();
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining("'invalid' inválido"));
    });

    it('onPermissionRequest() define handler explícito', () => {
        const handler = vi.fn();
        const config = new SessionConfigBuilder().onPermissionRequest(handler).build();
        expect(config.onPermissionRequest).toBe(handler);
    });

    it('onEvent() define event handler', () => {
        const handler = vi.fn();
        const config = new SessionConfigBuilder().onEvent(handler).build();
        expect(config.onEvent).toBe(handler);
    });

    it('commands() define slash commands da sessão', () => {
        const commands = [{ name: 'deploy', handler: vi.fn() }];
        const config = new SessionConfigBuilder().commands(/** @type {any} */ (commands)).build();
        expect(config.commands).toEqual(commands);
    });

    it('onElicitationRequest() define handler provider-side', () => {
        const handler = vi.fn();
        const config = new SessionConfigBuilder().onElicitationRequest(/** @type {any} */ (handler)).build();
        expect(config.onElicitationRequest).toBe(handler);
    });

    it('enableConfigDiscovery() e includeSubAgentStreamingEvents() passam pela build', () => {
        const config = new SessionConfigBuilder()
            .enableConfigDiscovery(true)
            .includeSubAgentStreamingEvents(false)
            .build();
        expect(config.enableConfigDiscovery).toBe(true);
        expect(config.includeSubAgentStreamingEvents).toBe(false);
    });

    it('defaultAgent() e modelCapabilities() passam pela build', () => {
        const defaultAgent = { excludedTools: ['shell'] };
        const modelCapabilities = { supports: { reasoningEffort: false } };
        const config = new SessionConfigBuilder()
            .defaultAgent(/** @type {any} */ (defaultAgent))
            .modelCapabilities(/** @type {any} */ (modelCapabilities))
            .build();
        expect(config.defaultAgent).toEqual(defaultAgent);
        expect(config.modelCapabilities).toEqual(modelCapabilities);
    });

    it('merge() aplica overrides parciais', () => {
        const config = new SessionConfigBuilder()
            .model('gpt-4.1')
            .merge({ model: 'claude-sonnet-4-5', streaming: false })
            .build();
        expect(config.model).toBe('claude-sonnet-4-5');
        expect(config.streaming).toBe(false);
    });

    it('encadeamento fluent funciona corretamente', () => {
        const handler = vi.fn();
        const config = new SessionConfigBuilder()
            .model('gpt-4.1')
            .clientName('test')
            .streaming(true)
            .workingDirectory('/tmp')
            .onPermissionRequest(handler)
            .excludedTools(['powershell'])
            .build();

        expect(config.model).toBe('gpt-4.1');
        expect(config.clientName).toBe('test');
        expect(config.streaming).toBe(true);
        expect(config.workingDirectory).toBe('/tmp');
        expect(config.onPermissionRequest).toBe(handler);
        expect(config.excludedTools).toEqual(['powershell']);
    });

    it('buildForResume() inclui disableResume', () => {
        const config = new SessionConfigBuilder().model('gpt-4.1').disableResume(true).buildForResume();
        expect(config.suppressResumeEvent).toBe(true);
    });

    it('buildForResume() inclui openCanvases sem vazar em build()', () => {
        const openCanvases = [{ id: 'canvas-1', title: 'Canvas 1' }];
        const builder = new SessionConfigBuilder().openCanvases(/** @type {any} */ (openCanvases));
        expect('openCanvases' in builder.build()).toBe(false);
        expect(builder.buildForResume().openCanvases).toEqual(openCanvases);
    });

    it('build() e buildForResume() não expõem cloud sem fluxo cloud/remote UX explícito', () => {
        const builder = new SessionConfigBuilder().merge(
            /** @type {any} */ ({
                cloud: { workspaceId: 'remote-workspace-1' },
            }),
        );

        expect('cloud' in builder.build()).toBe(false);
        expect('cloud' in builder.buildForResume()).toBe(false);
    });

    it('build() não vaza disableResume em SessionConfig', () => {
        const config = new SessionConfigBuilder().model('gpt-4.1').disableResume(true).build();
        expect('disableResume' in config).toBe(false);
    });

    it('buildForResume() remove sessionId do payload de retomada', () => {
        const config = new SessionConfigBuilder()
            .sessionId('should-not-leak')
            .model('gpt-4.1')
            .disableResume(true)
            .buildForResume();
        expect('sessionId' in config).toBe(false);
        expect(config.model).toBe('gpt-4.1');
        expect(config.suppressResumeEvent).toBe(true);
    });

    it('provider() define BYOK config', () => {
        const provider = { type: 'openai', baseUrl: 'http://localhost:11434/v1/' };
        const config = new SessionConfigBuilder().provider(/** @type {any} */ (provider)).build();
        expect(config.provider).toEqual({ type: 'openai', baseUrl: 'http://localhost:11434/v1' });
    });

    it('provider() valida config inválido', () => {
        expect(() =>
            new SessionConfigBuilder().provider(/** @type {any} */ ({ type: 'openai', baseUrl: '' })).build(),
        ).toThrow('baseUrl is required');
    });

    it('gitHubToken() define token por sessão', () => {
        const config = new SessionConfigBuilder().gitHubToken('ghs_session_token').build();
        expect(config.gitHubToken).toBe('ghs_session_token');
    });

    it('createSessionFsHandler() define handler de session filesystem', () => {
        const handler = vi.fn();
        const config = new SessionConfigBuilder().createSessionFsHandler(/** @type {any} */ (handler)).build();
        expect(config.createSessionFsProvider).toBe(handler);
    });

    it('ResumeSessionConfigBuilder.openCanvases() preserva canvases abertos no resume', () => {
        const openCanvases = [{ id: 'canvas-1', title: 'Canvas 1' }];
        const config = new ResumeSessionConfigBuilder().openCanvases(/** @type {any} */ (openCanvases)).build();
        expect(config.openCanvases).toEqual(openCanvases);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// C3 — ClientOptionsBuilder
// ═════════════════════════════════════════════════════════════════════════════

describe('ClientOptionsBuilder', () => {
    it('build() retorna objeto vazio para builder vazio', () => {
        const opts = new ClientOptionsBuilder().build();
        expect(opts).toBeDefined();
        expect(typeof opts).toBe('object');
    });

    it('cliUrl() define URL do CLI existente', () => {
        const opts = new ClientOptionsBuilder().cliUrl('localhost:8080').build();
        expect(opts.connection).toMatchObject({ kind: 'uri', url: 'localhost:8080' });
        expect('cliUrl' in opts).toBe(false);
    });

    it('cliPath() define executável CLI', () => {
        const opts = new ClientOptionsBuilder().cliPath('/usr/bin/copilot').build();
        expect(opts.connection).toMatchObject({ kind: 'stdio', path: '/usr/bin/copilot' });
        expect('cliPath' in opts).toBe(false);
    });

    it('cwd() define diretório de trabalho do processo CLI', () => {
        const opts = new ClientOptionsBuilder().cwd('/workspace/project').build();
        expect(opts.workingDirectory).toBe('/workspace/project');
        expect('cwd' in opts).toBe(false);
    });

    it('logLevel() define nível de log', () => {
        const opts = new ClientOptionsBuilder().logLevel('debug').build();
        expect(opts.logLevel).toBe('debug');
    });

    it('logLevelFromEnv() mapeia LOG_LEVEL do env', () => {
        const original = process.env['LOG_LEVEL'];
        try {
            process.env['LOG_LEVEL'] = 'DEBUG';
            const opts = new ClientOptionsBuilder().logLevelFromEnv().build();
            expect(opts.logLevel).toBe('debug');
        } finally {
            if (original !== undefined) {
                process.env['LOG_LEVEL'] = original;
            } else {
                delete process.env['LOG_LEVEL'];
            }
        }
    });

    it('logLevelFromEnv() mapeia WARN → warning', () => {
        const original = process.env['LOG_LEVEL'];
        try {
            process.env['LOG_LEVEL'] = 'WARN';
            const opts = new ClientOptionsBuilder().logLevelFromEnv().build();
            expect(opts.logLevel).toBe('warning');
        } finally {
            if (original !== undefined) {
                process.env['LOG_LEVEL'] = original;
            } else {
                delete process.env['LOG_LEVEL'];
            }
        }
    });

    it('githubToken() define token', () => {
        const opts = new ClientOptionsBuilder().githubToken('ghp_test123').build();
        expect(opts.gitHubToken).toBe('ghp_test123');
    });

    it('githubTokenFromEnv() lê GITHUB_TOKEN', () => {
        const original = process.env['GITHUB_TOKEN'];
        try {
            process.env['GITHUB_TOKEN'] = 'ghp_from_env';
            const opts = new ClientOptionsBuilder().githubTokenFromEnv().build();
            expect(opts.gitHubToken).toBe('ghp_from_env');
        } finally {
            if (original !== undefined) {
                process.env['GITHUB_TOKEN'] = original;
            } else {
                delete process.env['GITHUB_TOKEN'];
            }
        }
    });

    it('envPassthrough() filtra variáveis seguras', () => {
        const original = { ...process.env };
        try {
            process.env['COPILOT_CLI_URL'] = 'test';
            process.env['GITHUB_TOKEN'] = 'ghp';
            process.env['COPILOT_BYOK_API_KEY'] = 'byok-secret';
            process.env['SECRET_KEY'] = 'should-not-pass';
            const opts = new ClientOptionsBuilder().envPassthrough().build();
            expect(opts.env).toBeDefined();
            expect(opts.env?.['COPILOT_CLI_URL']).toBe('test');
            expect(opts.env?.['GITHUB_TOKEN']).toBe('ghp');
            expect(opts.env?.['COPILOT_BYOK_API_KEY']).toBeUndefined();
            expect(opts.env?.['SECRET_KEY']).toBeUndefined();
            expect(opts.env?.['PATH']).toBeDefined();
        } finally {
            // Restaurar env original (apenas as chaves adicionadas)
            delete process.env['COPILOT_CLI_URL'];
            delete process.env['COPILOT_BYOK_API_KEY'];
            delete process.env['SECRET_KEY'];
            if (original['GITHUB_TOKEN'] !== undefined) {
                process.env['GITHUB_TOKEN'] = original['GITHUB_TOKEN'];
            } else {
                delete process.env['GITHUB_TOKEN'];
            }
        }
    });

    it('envPassthrough() inclui extraKeys', () => {
        const original = process.env['MY_CUSTOM'];
        try {
            process.env['MY_CUSTOM'] = 'value';
            const opts = new ClientOptionsBuilder().envPassthrough(['MY_CUSTOM']).build();
            expect(opts.env?.['MY_CUSTOM']).toBe('value');
        } finally {
            if (original !== undefined) {
                process.env['MY_CUSTOM'] = original;
            } else {
                delete process.env['MY_CUSTOM'];
            }
        }
    });

    it('envPassthrough() normaliza conflito NO_COLOR/FORCE_COLOR e injeta disable-warning no child CLI', () => {
        const original = { ...process.env };
        try {
            process.env['FORCE_COLOR'] = '1';
            process.env['NO_COLOR'] = '1';
            delete process.env['COPILOT_CLI_DISABLE_EXPERIMENTAL_WARNING'];

            const opts = new ClientOptionsBuilder().envPassthrough().build();

            expect(opts.env?.['FORCE_COLOR']).toBe('1');
            expect(opts.env?.['NO_COLOR']).toBeUndefined();
            expect(opts.env?.['NODE_OPTIONS']).toContain('--disable-warning=ExperimentalWarning');
        } finally {
            process.env = original;
        }
    });

    it('onListModels() define handler BYOK', () => {
        const handler = vi.fn(() => []);
        const opts = new ClientOptionsBuilder().onListModels(handler).build();
        expect(opts.onListModels).toBe(handler);
    });

    it('sessionFs() define config de session filesystem', () => {
        const sessionFs = {
            initialCwd: '/workspace',
            sessionStatePath: '.copilot/session-state',
            conventions: /** @type {const} */ ('posix'),
        };
        const opts = new ClientOptionsBuilder().sessionFs(/** @type {any} */ (sessionFs)).build();
        expect(opts.sessionFs).toEqual(sessionFs);
    });

    it('sessionIdleTimeoutSeconds() define timeout de idle do server', () => {
        const opts = new ClientOptionsBuilder().sessionIdleTimeoutSeconds(600).build();
        expect(opts.sessionIdleTimeoutSeconds).toBe(600);
    });

    it('telemetry() define config OTel', () => {
        const config = /** @type {any} */ ({ otlpEndpoint: 'http://localhost:4317' });
        const opts = new ClientOptionsBuilder().telemetry(config).build();
        expect(opts.telemetry).toEqual(config);
    });

    it('telemetryFromEnv() lê OTEL_EXPORTER_OTLP_ENDPOINT', () => {
        const original = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
        try {
            process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://localhost:4317';
            const opts = new ClientOptionsBuilder().telemetryFromEnv().build();
            expect(opts.telemetry).toBeDefined();
        } finally {
            if (original !== undefined) {
                process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = original;
            } else {
                delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
            }
        }
    });

    it('merge() aplica overrides', () => {
        const opts = new ClientOptionsBuilder().logLevel('info').merge({ logLevel: 'debug', autoStart: false }).build();
        expect(opts.logLevel).toBe('debug');
        expect('autoStart' in opts).toBe(false);
    });

    it('port() e useStdio(false) materializam conexão TCP', () => {
        const opts = new ClientOptionsBuilder().port(8080).useStdio(false).build();
        expect(opts.connection).toMatchObject({ kind: 'tcp', port: 8080 });
        expect('port' in opts).toBe(false);
        expect('useStdio' in opts).toBe(false);
    });

    it('useStdio(true) materializa conexão stdio e ignora isChildProcess legado', () => {
        const opts = new ClientOptionsBuilder().useStdio(true).isChildProcess(true).build();
        expect(opts.connection).toMatchObject({ kind: 'stdio' });
        expect('useStdio' in opts).toBe(false);
        expect('isChildProcess' in opts).toBe(false);
    });

    it('autoRestart() é alias legado e não vaza para CopilotClientOptions 1.0', () => {
        const opts = new ClientOptionsBuilder().autoRestart(false).build();
        expect('autoRestart' in opts).toBe(false);
    });

    it('encadeamento fluent funciona', () => {
        const opts = new ClientOptionsBuilder().cliUrl('localhost:9000').logLevel('info').autoStart(true).build();
        expect(opts.connection).toMatchObject({ kind: 'uri', url: 'localhost:9000' });
        expect(opts.logLevel).toBe('info');
        expect('autoStart' in opts).toBe(false);
    });

    it('buildCopilotClientOptionsFromEnv centraliza cliUrl e omite transporte conflitante', () => {
        const original = { ...process.env };
        try {
            process.env['COPILOT_CLI_URL'] = 'http://127.0.0.1:9010';
            process.env['COPILOT_CLI_PATH'] = '/bin/copilot';
            process.env['COPILOT_USE_STDIO'] = 'false';
            process.env['COPILOT_CLI_PORT'] = '9011';
            process.env['COPILOT_LOG_LEVEL'] = 'DEBUG';
            const opts = buildCopilotClientOptionsFromEnv();
            expect(opts.connection).toMatchObject({ kind: 'uri', url: 'http://127.0.0.1:9010' });
            expect('cliUrl' in opts).toBe(false);
            expect('cliPath' in opts).toBe(false);
            expect('useStdio' in opts).toBe(false);
            expect('port' in opts).toBe(false);
            expect(opts.logLevel).toBe('debug');
        } finally {
            process.env = original;
        }
    });

    it('buildCopilotClientOptionsFromEnv cobre spawn, auth e telemetria do SDK', () => {
        const original = { ...process.env };
        try {
            delete process.env['COPILOT_CLI_URL'];
            process.env['COPILOT_CLI_PATH'] = '/opt/copilot';
            process.env['COPILOT_CLI_ARGS'] = '["--stdio"]';
            process.env['COPILOT_CLI_CWD'] = '/workspace/copilot';
            process.env['COPILOT_USE_STDIO'] = 'true';
            process.env['COPILOT_CLI_IS_CHILD_PROCESS'] = 'false';
            process.env['COPILOT_AUTO_START'] = 'false';
            process.env['COPILOT_AUTO_RESTART'] = 'false';
            process.env['COPILOT_GITHUB_TOKEN'] = 'ghp_env';
            process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://localhost:4318';
            process.env['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'] = 'true';
            process.env['FORCE_COLOR'] = '1';
            process.env['NO_COLOR'] = '1';
            const opts = buildCopilotClientOptionsFromEnv();
            expect(opts.connection).toMatchObject({ kind: 'stdio', path: '/opt/copilot', args: ['--stdio'] });
            expect(opts.workingDirectory).toBe('/workspace/copilot');
            expect('cliPath' in opts).toBe(false);
            expect('cliArgs' in opts).toBe(false);
            expect('cwd' in opts).toBe(false);
            expect('useStdio' in opts).toBe(false);
            expect('isChildProcess' in opts).toBe(false);
            expect('autoStart' in opts).toBe(false);
            expect('autoRestart' in opts).toBe(false);
            expect(opts.gitHubToken).toBe('ghp_env');
            expect(opts.useLoggedInUser).toBe(false);
            expect(opts.env?.['NO_COLOR']).toBeUndefined();
            expect(opts.env?.['NODE_OPTIONS']).toContain('--disable-warning=ExperimentalWarning');
            expect(opts.telemetry).toMatchObject({
                otlpEndpoint: 'http://localhost:4318',
                sourceName: 'llm-b-terminal',
                captureContent: true,
            });
        } finally {
            process.env = original;
        }
    });

    it('modela modos explícitos para terminal local e server multiusuário', () => {
        const original = { ...process.env };
        try {
            process.env['COPILOT_CLIENT_MODE'] = 'empty';

            expect(buildTerminalCopilotClientOptions().mode).toBe('copilot-cli');
            expect(buildServerCopilotClientOptions().mode).toBe('empty');
            expect(buildTerminalCopilotClientOptions({ mode: 'empty' }).mode).toBe('empty');
            expect(buildServerCopilotClientOptions({ mode: 'copilot-cli' }).mode).toBe('copilot-cli');
        } finally {
            process.env = original;
        }
    });

    it('buildCopilotClientOptionsFromEnv registra onListModels BYOK seguro', async () => {
        const original = { ...process.env };
        try {
            delete process.env['COPILOT_CLI_URL'];
            process.env['COPILOT_BYOK_ENABLED'] = 'true';
            process.env['COPILOT_BYOK_BASE_URL'] = 'https://provider.example/v1';
            process.env['COPILOT_BYOK_MODEL'] = 'provider-model';
            process.env['COPILOT_BYOK_MODELS'] = 'provider-model,provider-model-2';
            process.env['COPILOT_BYOK_API_KEY'] = 'secret';
            process.env['COPILOT_BYOK_MODEL_DISCOVERY_ENABLED'] = 'false';

            const opts = buildCopilotClientOptionsFromEnv();

            expect(opts.onListModels).toBeTypeOf('function');
            await expect(opts.onListModels?.()).resolves.toHaveLength(2);
            expect(opts.env?.['COPILOT_BYOK_API_KEY']).toBeUndefined();
        } finally {
            process.env = original;
        }
    });

    it('permite que o terminal injete onListModels canônico do model-gateway sobre o fallback BYOK', async () => {
        const original = { ...process.env };
        try {
            delete process.env['COPILOT_CLI_URL'];
            process.env['COPILOT_BYOK_ENABLED'] = 'true';
            process.env['COPILOT_BYOK_BASE_URL'] = 'https://provider.example/v1';
            process.env['COPILOT_BYOK_MODEL'] = 'provider-model';
            process.env['COPILOT_BYOK_MODELS'] = 'provider-model,provider-model-2';
            process.env['COPILOT_BYOK_API_KEY'] = 'secret';
            process.env['COPILOT_BYOK_MODEL_DISCOVERY_ENABLED'] = 'false';
            const gatewayHandler = vi.fn(async () => [
                {
                    id: 'gateway-model',
                    name: 'Gateway Model',
                    capabilities: {
                        supports: { vision: false, reasoningEffort: false },
                        limits: { max_context_window_tokens: 128000 },
                    },
                },
            ]);

            const opts = buildTerminalCopilotClientOptions({ onListModels: gatewayHandler });

            expect(opts.onListModels).toBe(gatewayHandler);
            await expect(opts.onListModels?.()).resolves.toEqual([
                {
                    id: 'gateway-model',
                    name: 'Gateway Model',
                    capabilities: {
                        supports: { vision: false, reasoningEffort: false },
                        limits: { max_context_window_tokens: 128000 },
                    },
                },
            ]);
            expect(gatewayHandler).toHaveBeenCalledTimes(1);
        } finally {
            process.env = original;
        }
    });
});

describe('ResumeSessionConfigBuilder', () => {
    it('expõe apenas a superfície de resume e preserva disableResume', () => {
        const handler = vi.fn();
        const config = new ResumeSessionConfigBuilder()
            .clientName('resume-client')
            .model('gpt-4.1')
            .workingDirectory('/tmp/resume')
            .onPermissionRequest(handler)
            .disableResume(true)
            .build();

        expect(config.clientName).toBe('resume-client');
        expect(config.model).toBe('gpt-4.1');
        expect(config.workingDirectory).toBe('/tmp/resume');
        expect(config.onPermissionRequest).toBe(handler);
        expect(config.suppressResumeEvent).toBe(true);
        expect('sessionId' in config).toBe(false);
    });

    it('merge() sanitiza campos exclusivos de criação', () => {
        const config = new ResumeSessionConfigBuilder()
            .merge(
                /** @type {any} */ ({
                    sessionId: 'create-only',
                    clientName: 'resume-client',
                    disableResume: true,
                }),
            )
            .build();

        expect(config.clientName).toBe('resume-client');
        expect(config.suppressResumeEvent).toBe(true);
        expect('sessionId' in config).toBe(false);
    });

    it('não expõe sessionId() como API do builder dedicado', () => {
        expect('sessionId' in new ResumeSessionConfigBuilder()).toBe(false);
    });
});
