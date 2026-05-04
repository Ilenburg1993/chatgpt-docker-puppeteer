// @ts-check
/**
 * src/copilot/boot/contract.js
 *
 * Contrato declarativo dos entrypoints operacionais do Copilot local.
 *
 * O boot real tem uma única trilha: terminal/bootstrap.js -> bootCopilot() -> startTerminalServer() ->
 * startCopilotServer(). Não existe entrypoint compatível paralelo.
 *
 * @module copilot/boot/contract
 */

export const COPILOT_BOOT_MODE = 'terminal-runtime';

export const COPILOT_CANONICAL_BOOT_ENTRYPOINT = 'src/copilot/terminal/bootstrap.js';

export const COPILOT_CANONICAL_PM2_PROCESS = 'llm-b-terminal';

export const COPILOT_CANONICAL_OTEL_SOURCE_NAME = COPILOT_CANONICAL_PM2_PROCESS;

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
    pm2Ownership: 'PM2 must start only llm-b-terminal for the Copilot runtime.',
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
 *     canonicalPm2Process: string;
 *     canonicalOtelSourceName: string;
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
        canonicalPm2Process: COPILOT_CANONICAL_PM2_PROCESS,
        canonicalOtelSourceName: COPILOT_CANONICAL_OTEL_SOURCE_NAME,
        terminalPm2EnvFlag: COPILOT_TERMINAL_PM2_ENV_FLAG,
        phases: COPILOT_BOOT_PHASES,
        rules: COPILOT_BOOT_RULES,
        sdkBaseline: SDK_VANILLA_CAPABILITY_BASELINE,
    };
}
