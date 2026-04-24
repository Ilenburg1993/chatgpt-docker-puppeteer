// @ts-check
/**
 * src/copilot/boot/contract.js
 *
 * Contrato declarativo dos entrypoints operacionais do Copilot local.
 *
 * O boot real tem uma unica trilha: terminal/bootstrap.js -> bootCopilot() -> startTerminalServer() ->
 * startCopilotServer(). Entrypoints historicos podem existir para automacao/PM2, mas nao representam segundo runtime.
 *
 * @module copilot/boot/contract
 */

export const COPILOT_BOOT_MODE = 'terminal-runtime';

export const COPILOT_CANONICAL_BOOT_ENTRYPOINT = 'src/copilot/terminal/bootstrap.js';

export const COPILOT_COMPAT_BOOT_ENTRYPOINT = 'src/copilot/agent.js';

export const COPILOT_CANONICAL_PM2_PROCESS = 'llm-b-terminal';

export const COPILOT_COMPAT_PM2_PROCESS = 'copilot-sdk-agent';

export const COPILOT_COMPAT_PM2_ENV_FLAG = 'COPILOT_SDK_AGENT_COMPAT_ENABLED';

export const COPILOT_TERMINAL_PM2_ENV_FLAG = 'COPILOT_TERMINAL_ENABLED';

export const COPILOT_BOOT_PHASES = Object.freeze([
    'observability',
    'late-deps',
    'runtime-wiring',
    'terminal-host',
    'copilot-http-server',
    'repl',
]);

export const COPILOT_BOOT_RULES = Object.freeze({
    singleRuntimeOwner: 'terminal/bootstrap.js is the only canonical executable boot owner.',
    serverOwnership: 'server/index.js owns HTTP/Socket.IO only; it never starts terminal UX or the agent by itself.',
    terminalOwnership:
        'terminal/index.js owns REPL/SSE UX and composes the server through injected startCopilotServer.',
    compatEntrypoint:
        'agent.js is an operational compatibility entrypoint and must delegate to bootCopilot without creating a second mode.',
    pm2Compatibility:
        'copilot-sdk-agent is opt-in compatibility only and must not be enabled together with llm-b-terminal.',
    bootConfigOwnership:
        'boot/config.js is the canonical place for workspace, skill directories, host, port and boot variable policy.',
});

export const SDK_VANILLA_CAPABILITY_BASELINE = Object.freeze([
    'client.start',
    'client.stop',
    'client.forceStop',
    'client.ping',
    'client.getState',
    'client.getStatus',
    'client.getAuthStatus',
    'client.listModels',
    'client.listSessions',
    'client.getLastSessionId',
    'client.deleteSession',
    'client.getForegroundSessionId',
    'client.setForegroundSessionId',
    'client.lifecycleEvents',
    'session.create',
    'session.resume',
    'session.send',
    'session.sendAndWait',
    'session.streamEvents',
    'session.getMessages',
    'session.abort',
    'session.setModel',
    'session.log',
    'session.disconnect',
    'session.asyncDispose',
    'session.rpc',
    'session.permissions',
    'session.userInput',
    'session.hooks',
    'session.customTools',
    'session.systemMessage.append',
    'session.systemMessage.replace',
    'session.systemMessage.customize',
    'session.infiniteSessions',
    'session.attachments.file',
    'session.attachments.directory',
    'session.attachments.selection',
    'session.attachments.blob',
    'session.customProvider',
    'session.mcpServers',
    'session.customAgents',
    'session.skills',
    'telemetry.otel',
    'telemetry.traceContext',
]);

/**
 * @returns {{
 *     mode: string;
 *     canonicalEntrypoint: string;
 *     compatEntrypoint: string;
 *     canonicalPm2Process: string;
 *     compatPm2Process: string;
 *     compatPm2EnvFlag: string;
 *     terminalPm2EnvFlag: string;
 *     phases: readonly string[];
 *     rules: Readonly<Record<string, string>>;
 *     sdkBaseline: readonly string[];
 * }}
 */
export function readCopilotBootContract() {
    return {
        mode: COPILOT_BOOT_MODE,
        canonicalEntrypoint: COPILOT_CANONICAL_BOOT_ENTRYPOINT,
        compatEntrypoint: COPILOT_COMPAT_BOOT_ENTRYPOINT,
        canonicalPm2Process: COPILOT_CANONICAL_PM2_PROCESS,
        compatPm2Process: COPILOT_COMPAT_PM2_PROCESS,
        compatPm2EnvFlag: COPILOT_COMPAT_PM2_ENV_FLAG,
        terminalPm2EnvFlag: COPILOT_TERMINAL_PM2_ENV_FLAG,
        phases: COPILOT_BOOT_PHASES,
        rules: COPILOT_BOOT_RULES,
        sdkBaseline: SDK_VANILLA_CAPABILITY_BASELINE,
    };
}
