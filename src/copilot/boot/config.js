// @ts-check
/**
 * src/copilot/boot/config.js
 *
 * Painel canonico de configuracao do boot Copilot.
 *
 * Variaveis de boot devem entrar aqui primeiro. Modulos de runtime consomem `readCopilotBootConfig()`, sem decidir
 * localmente workspace, portas, skills ou entrypoints.
 *
 * @module copilot/boot/config
 */

import { resolve } from 'node:path';
import { readCopilotBootContract } from './contract.js';
import { readCopilotSessionFsBootConfig, SESSION_FS_ENV_KEYS } from './session-fs.js';
import { readBootSkillConfig } from './skills.js';
import {
    COPILOT_PACKAGE_ROOT,
    COPILOT_SOURCE_ROOT,
    getWorkspaceContext,
    resolveHooksStateDir,
    resolvePersistentConfigFile,
    WORKSPACE_ROOT,
} from './workspace.js';

export const BOOT_CONFIG_ENV_KEYS = Object.freeze([
    'COPILOT_WORKING_DIRECTORY',
    'COPILOT_SKILL_DIRECTORIES',
    'COPILOT_PINNED_CONTEXT_DIRS',
    'COPILOT_DISABLED_SKILLS',
    'COPILOT_ENABLE_CONFIG_DISCOVERY',
    'COPILOT_INCLUDE_SUBAGENT_STREAMING_EVENTS',
    'COPILOT_CLI_URL',
    'COPILOT_CLI_PATH',
    'COPILOT_CLI_ARGS',
    'COPILOT_CLI_CWD',
    'COPILOT_CLI_PORT',
    'COPILOT_USE_STDIO',
    'COPILOT_AUTO_START',
    'COPILOT_USE_LOGGED_IN_USER',
    'COPILOT_CLI_LOG_LEVEL',
    'COPILOT_LOG_LEVEL',
    'COPILOT_GITHUB_TOKEN',
    'GITHUB_TOKEN',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'COPILOT_OTEL_FILE_EXPORTER_PATH',
    'COPILOT_OTEL_EXPORTER_TYPE',
    'COPILOT_OTEL_SOURCE_NAME',
    'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT',
    ...SESSION_FS_ENV_KEYS,
    'COPILOT_SDK_ENABLED',
    'COPILOT_TERMINAL_ENABLED',
    'LLM_B_TERMINAL_HOST',
    'LLM_B_TERMINAL_PORT',
    'LLM_B_TERMINAL_TOKEN',
    'LLM_B_BOOT_TIMEOUT_MS',
]);

/**
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function envStr(key, fallback) {
    const value = process.env[key];
    return value === undefined || value === '' ? fallback : value;
}

/**
 * @param {string} key
 * @returns {string | null}
 */
function envOpt(key) {
    const value = process.env[key];
    return value === undefined || value === '' ? null : value;
}

/**
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function envInt(key, fallback) {
    const value = process.env[key];
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {string} key
 * @param {boolean} fallback
 * @returns {boolean}
 */
function envBool(key, fallback) {
    const value = process.env[key];
    if (value === undefined || value === '') return fallback;
    return value === 'true' || value === '1';
}

/**
 * @returns {{
 *     mode: string;
 *     envKeys: readonly string[];
 *     workspace: {
 *         root: string;
 *         gitRoot: string | null;
 *         currentBranch: string | null;
 *         packageRoot: string;
 *         sourceRoot: string;
 *         hooksStateDir: string;
 *     };
 *     paths: {
 *         skillsConfigFile: string;
 *         pluginsDir: string;
 *         sessionFsRootDir: string;
 *         toolsConfigFile: string;
 *         customToolsFile: string;
 *     };
 *     server: {
 *         host: string;
 *         port: number;
 *         token: string | null;
 *         url: string;
 *     };
 *     sdk: {
 *         enabled: boolean;
 *         cliUrl: string | null;
 *         cliPath: string | null;
 *         cliArgs: string | null;
 *         cliCwd: string | null;
 *         cliPort: number | null;
 *         useStdio: boolean | null;
 *         autoStart: boolean | null;
 *         useLoggedInUser: boolean | null;
 *         logLevel: string | null;
 *         githubTokenConfigured: boolean;
 *         telemetry: {
 *             otlpEndpoint: string | null;
 *             filePath: string | null;
 *             exporterType: string | null;
 *             sourceName: string | null;
 *             captureContent: boolean | null;
 *         };
 *         sessionFs: {
 *             enabled: boolean;
 *             initialCwd: string;
 *             sessionStatePath: string;
 *             conventions: 'windows' | 'posix';
 *             storageRootDir: string;
 *         };
 *         sessionIdleTimeoutSeconds: number | null;
 *         baseline: readonly string[];
 *     };
 *     sessionDefaults: {
 *         workingDirectory: string;
 *         skillDirectories: string[];
 *         disabledSkills: string[];
 *         enableConfigDiscovery: boolean;
 *         includeSubAgentStreamingEvents: boolean;
 *         streaming: boolean;
 *     };
 *     terminal: {
 *         enabled: boolean;
 *         bootTimeoutMs: number;
 *     };
 *     pm2: {
 *         canonicalProcess: string;
 *         terminalEnabled: boolean;
 *     };
 *     skills: ReturnType<import('./skills.js').readBootSkillConfig>;
 *     entrypoints: {
 *         canonical: string;
 *     };
 *     phases: readonly string[];
 *     rules: Readonly<Record<string, string>>;
 * }}
 */
export function readCopilotBootConfig() {
    const contract = readCopilotBootContract();
    const workspace = getWorkspaceContext();
    const sessionFs = readCopilotSessionFsBootConfig();
    const skills = readBootSkillConfig();
    const host = envStr('LLM_B_TERMINAL_HOST', '127.0.0.1');
    const port = envInt('LLM_B_TERMINAL_PORT', 3009);
    return {
        mode: contract.mode,
        envKeys: BOOT_CONFIG_ENV_KEYS,
        workspace: {
            root: WORKSPACE_ROOT,
            gitRoot: workspace.gitRoot,
            currentBranch: workspace.currentBranch,
            packageRoot: COPILOT_PACKAGE_ROOT,
            sourceRoot: COPILOT_SOURCE_ROOT,
            hooksStateDir: resolveHooksStateDir(),
        },
        paths: {
            skillsConfigFile: resolvePersistentConfigFile('skills.json'),
            pluginsDir: resolve(COPILOT_SOURCE_ROOT, 'plugins'),
            sessionFsRootDir: sessionFs.storageRootDir,
            toolsConfigFile: resolvePersistentConfigFile('tools-config.json'),
            customToolsFile: resolvePersistentConfigFile('custom-tools.json'),
        },
        server: {
            host,
            port,
            token: envOpt('LLM_B_TERMINAL_TOKEN'),
            url: `http://${host}:${port}`,
        },
        sdk: {
            enabled: envBool('COPILOT_SDK_ENABLED', true),
            cliUrl: envOpt('COPILOT_CLI_URL'),
            cliPath: envOpt('COPILOT_CLI_PATH'),
            cliArgs: envOpt('COPILOT_CLI_ARGS'),
            cliCwd: envOpt('COPILOT_CLI_CWD'),
            cliPort: envOpt('COPILOT_CLI_PORT') === null ? null : envInt('COPILOT_CLI_PORT', 0),
            useStdio: envOpt('COPILOT_USE_STDIO') === null ? null : envBool('COPILOT_USE_STDIO', true),
            autoStart: envOpt('COPILOT_AUTO_START') === null ? null : envBool('COPILOT_AUTO_START', true),
            useLoggedInUser:
                envOpt('COPILOT_USE_LOGGED_IN_USER') === null ? null : envBool('COPILOT_USE_LOGGED_IN_USER', true),
            logLevel: envOpt('COPILOT_CLI_LOG_LEVEL') ?? envOpt('COPILOT_LOG_LEVEL'),
            githubTokenConfigured: Boolean(envOpt('COPILOT_GITHUB_TOKEN') ?? envOpt('GITHUB_TOKEN')),
            telemetry: {
                otlpEndpoint: envOpt('OTEL_EXPORTER_OTLP_ENDPOINT'),
                filePath: envOpt('COPILOT_OTEL_FILE_EXPORTER_PATH'),
                exporterType: envOpt('COPILOT_OTEL_EXPORTER_TYPE'),
                sourceName: envOpt('COPILOT_OTEL_SOURCE_NAME'),
                captureContent:
                    envOpt('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT') === null
                        ? null
                        : envBool('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT', false),
            },
            sessionFs: {
                enabled: sessionFs.enabled,
                initialCwd: sessionFs.initialCwd,
                sessionStatePath: sessionFs.sessionStatePath,
                conventions: sessionFs.conventions,
                storageRootDir: sessionFs.storageRootDir,
            },
            sessionIdleTimeoutSeconds: sessionFs.sessionIdleTimeoutSeconds,
            baseline: contract.sdkBaseline,
        },
        sessionDefaults: {
            workingDirectory: WORKSPACE_ROOT,
            skillDirectories: [...skills.skillDirectories],
            disabledSkills: [...skills.disabledSkills],
            enableConfigDiscovery: envBool('COPILOT_ENABLE_CONFIG_DISCOVERY', false),
            includeSubAgentStreamingEvents: envBool('COPILOT_INCLUDE_SUBAGENT_STREAMING_EVENTS', false),
            streaming: true,
        },
        terminal: {
            enabled: envBool('COPILOT_TERMINAL_ENABLED', true),
            bootTimeoutMs: envInt('LLM_B_BOOT_TIMEOUT_MS', 90_000),
        },
        pm2: {
            canonicalProcess: contract.canonicalPm2Process,
            terminalEnabled: envBool(contract.terminalPm2EnvFlag, false),
        },
        skills,
        entrypoints: {
            canonical: contract.canonicalEntrypoint,
        },
        phases: contract.phases,
        rules: contract.rules,
    };
}
