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
            },
            {
                get(target, prop) {
                    return Reflect.get(target, prop);
                },
            },
        ),
);

// ─── Imports ────────────────────────────────────────────────────────────────

import {
    ClientOptionsBuilder,
    buildCopilotClientOptionsFromEnv,
} from '../../../../src/copilot/config/client-options.js';
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

    it('build() emite WARN quando onPermissionRequest não fornecido', () => {
        new SessionConfigBuilder().build();
        expect(mocks.log).toHaveBeenCalledWith('WARN', expect.stringContaining('onPermissionRequest não fornecido'));
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
        expect(config.configDir).toBe('/tmp/config');
    });

    it('streaming(false) desativa streaming', () => {
        const config = new SessionConfigBuilder().streaming(false).build();
        expect(config.streaming).toBe(false);
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
        expect(config.disableResume).toBe(true);
    });

    it('provider() define BYOK config', () => {
        const provider = { type: /** @type {const} */ ('openai'), baseUrl: 'http://localhost:11434/v1' };
        const config = new SessionConfigBuilder().provider(/** @type {any} */ (provider)).build();
        expect(config.provider).toEqual(provider);
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
        expect(opts.cliUrl).toBe('localhost:8080');
    });

    it('cliPath() define executável CLI', () => {
        const opts = new ClientOptionsBuilder().cliPath('/usr/bin/copilot').build();
        expect(opts.cliPath).toBe('/usr/bin/copilot');
    });

    it('logLevel() define nível de log', () => {
        const opts = new ClientOptionsBuilder().logLevel('debug').build();
        expect(opts.logLevel).toBe('debug');
    });

    it('logLevelFromEnv() mapeia LOG_LEVEL do env', () => {
        const original = process.env.LOG_LEVEL;
        try {
            process.env.LOG_LEVEL = 'DEBUG';
            const opts = new ClientOptionsBuilder().logLevelFromEnv().build();
            expect(opts.logLevel).toBe('debug');
        } finally {
            if (original !== undefined) {
                process.env.LOG_LEVEL = original;
            } else {
                delete process.env.LOG_LEVEL;
            }
        }
    });

    it('logLevelFromEnv() mapeia WARN → warning', () => {
        const original = process.env.LOG_LEVEL;
        try {
            process.env.LOG_LEVEL = 'WARN';
            const opts = new ClientOptionsBuilder().logLevelFromEnv().build();
            expect(opts.logLevel).toBe('warning');
        } finally {
            if (original !== undefined) {
                process.env.LOG_LEVEL = original;
            } else {
                delete process.env.LOG_LEVEL;
            }
        }
    });

    it('githubToken() define token', () => {
        const opts = new ClientOptionsBuilder().githubToken('ghp_test123').build();
        expect(opts.githubToken).toBe('ghp_test123');
    });

    it('githubTokenFromEnv() lê GITHUB_TOKEN', () => {
        const original = process.env.GITHUB_TOKEN;
        try {
            process.env.GITHUB_TOKEN = 'ghp_from_env';
            const opts = new ClientOptionsBuilder().githubTokenFromEnv().build();
            expect(opts.githubToken).toBe('ghp_from_env');
        } finally {
            if (original !== undefined) {
                process.env.GITHUB_TOKEN = original;
            } else {
                delete process.env.GITHUB_TOKEN;
            }
        }
    });

    it('envPassthrough() filtra variáveis seguras', () => {
        const original = { ...process.env };
        try {
            process.env.COPILOT_CLI_URL = 'test';
            process.env.GITHUB_TOKEN = 'ghp';
            process.env.SECRET_KEY = 'should-not-pass';
            const opts = new ClientOptionsBuilder().envPassthrough().build();
            expect(opts.env).toBeDefined();
            expect(opts.env?.COPILOT_CLI_URL).toBe('test');
            expect(opts.env?.GITHUB_TOKEN).toBe('ghp');
            expect(opts.env?.SECRET_KEY).toBeUndefined();
            expect(opts.env?.PATH).toBeDefined();
        } finally {
            // Restaurar env original (apenas as chaves adicionadas)
            delete process.env.COPILOT_CLI_URL;
            delete process.env.SECRET_KEY;
            if (original.GITHUB_TOKEN !== undefined) {
                process.env.GITHUB_TOKEN = original.GITHUB_TOKEN;
            } else {
                delete process.env.GITHUB_TOKEN;
            }
        }
    });

    it('envPassthrough() inclui extraKeys', () => {
        const original = process.env.MY_CUSTOM;
        try {
            process.env.MY_CUSTOM = 'value';
            const opts = new ClientOptionsBuilder().envPassthrough(['MY_CUSTOM']).build();
            expect(opts.env?.MY_CUSTOM).toBe('value');
        } finally {
            if (original !== undefined) {
                process.env.MY_CUSTOM = original;
            } else {
                delete process.env.MY_CUSTOM;
            }
        }
    });

    it('onListModels() define handler BYOK', () => {
        const handler = vi.fn(() => []);
        const opts = new ClientOptionsBuilder().onListModels(handler).build();
        expect(opts.onListModels).toBe(handler);
    });

    it('telemetry() define config OTel', () => {
        const config = /** @type {any} */ ({ otlpEndpoint: 'http://localhost:4317' });
        const opts = new ClientOptionsBuilder().telemetry(config).build();
        expect(opts.telemetry).toEqual(config);
    });

    it('telemetryFromEnv() lê OTEL_EXPORTER_OTLP_ENDPOINT', () => {
        const original = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        try {
            process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
            const opts = new ClientOptionsBuilder().telemetryFromEnv().build();
            expect(opts.telemetry).toBeDefined();
        } finally {
            if (original !== undefined) {
                process.env.OTEL_EXPORTER_OTLP_ENDPOINT = original;
            } else {
                delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
            }
        }
    });

    it('merge() aplica overrides', () => {
        const opts = new ClientOptionsBuilder().logLevel('info').merge({ logLevel: 'debug', autoStart: false }).build();
        expect(opts.logLevel).toBe('debug');
        expect(opts.autoStart).toBe(false);
    });

    it('port() e useStdio() são mutuamente exclusivos (builder aceita ambos)', () => {
        const opts = new ClientOptionsBuilder().port(8080).useStdio(false).build();
        expect(opts.port).toBe(8080);
        expect(opts.useStdio).toBe(false);
    });

    it('encadeamento fluent funciona', () => {
        const opts = new ClientOptionsBuilder().cliUrl('localhost:9000').logLevel('info').autoStart(true).build();
        expect(opts.cliUrl).toBe('localhost:9000');
        expect(opts.logLevel).toBe('info');
        expect(opts.autoStart).toBe(true);
    });

    it('buildCopilotClientOptionsFromEnv centraliza cliUrl e omite transporte conflitante', () => {
        const original = { ...process.env };
        try {
            process.env.COPILOT_CLI_URL = 'http://127.0.0.1:9010';
            process.env.COPILOT_CLI_PATH = '/bin/copilot';
            process.env.COPILOT_USE_STDIO = 'false';
            process.env.COPILOT_CLI_PORT = '9011';
            process.env.COPILOT_LOG_LEVEL = 'DEBUG';
            const opts = buildCopilotClientOptionsFromEnv();
            expect(opts.cliUrl).toBe('http://127.0.0.1:9010');
            expect(opts.cliPath).toBeUndefined();
            expect(opts.useStdio).toBeUndefined();
            expect(opts.port).toBeUndefined();
            expect(opts.logLevel).toBe('debug');
        } finally {
            process.env = original;
        }
    });

    it('buildCopilotClientOptionsFromEnv cobre spawn, auth e telemetria do SDK', () => {
        const original = { ...process.env };
        try {
            delete process.env.COPILOT_CLI_URL;
            process.env.COPILOT_CLI_PATH = '/opt/copilot';
            process.env.COPILOT_CLI_ARGS = '["--stdio"]';
            process.env.COPILOT_USE_STDIO = 'true';
            process.env.COPILOT_AUTO_START = 'false';
            process.env.COPILOT_GITHUB_TOKEN = 'ghp_env';
            process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
            process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = 'true';
            const opts = buildCopilotClientOptionsFromEnv();
            expect(opts.cliPath).toBe('/opt/copilot');
            expect(opts.cliArgs).toEqual(['--stdio']);
            expect(opts.useStdio).toBe(true);
            expect(opts.autoStart).toBe(false);
            expect(opts.githubToken).toBe('ghp_env');
            expect(opts.useLoggedInUser).toBe(false);
            expect(opts.telemetry).toMatchObject({
                otlpEndpoint: 'http://localhost:4318',
                captureContent: true,
            });
        } finally {
            process.env = original;
        }
    });
});
