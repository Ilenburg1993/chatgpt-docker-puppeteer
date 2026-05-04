// @ts-check
/**
 * src/copilot/config/env.js
 *
 * SSOT (Single Source of Truth) para variáveis de ambiente do subsistema Copilot SDK. Todos os módulos devem importar
 * daqui em vez de ler `process.env` diretamente.
 *
 * Exceções aceitas:
 *
 * - `process.env['NODE_ENV']` em guards condicionais (ex: `!== 'test'`)
 * - `agent/config.js` que adiciona constantes derivadas sobre este módulo
 *
 * @module copilot/config/env
 * @see EventBus
 */

import { resolve } from 'node:path';
import { COPILOT_CANONICAL_OTEL_SOURCE_NAME } from '../boot/contract.js';

// ── Helpers ──────────────────────────────────────────────────

/** @param {string} key @param {number} fallback @returns {number} */
const envInt = (key, fallback) => {
    const v = process.env[key];
    if (v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/** @param {string} key @param {string} fallback @returns {string} */
const envStr = (key, fallback) => process.env[key] ?? fallback;

/** @param {string} key @returns {string | undefined} */
const envOpt = (key) => process.env[key];

/** @param {string} key @param {boolean} fallback @returns {boolean} */
const envBool = (key, fallback) => {
    const v = process.env[key];
    if (v === undefined) return fallback;
    return v === 'true' || v === '1';
};

const DEFAULT_WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');

// ── Agent ────────────────────────────────────────────────────

export const AGENT_DENY_SHELL_TOOLS = envOpt('AGENT_DENY_SHELL_TOOLS');
export const AGENT_HOOK_CONTEXT_MAX_BYTES = envInt('AGENT_HOOK_CONTEXT_MAX_BYTES', 8 * 1024);
export const AGENT_KEEPALIVE_MS = envInt('AGENT_KEEPALIVE_MS', 10 * 60_000);
export const AGENT_KEEPALIVE_IDLE_MS = envInt('AGENT_KEEPALIVE_IDLE_MS', 20 * 60_000);
export const AGENT_MAX_LISTENERS = envInt('AGENT_MAX_LISTENERS', 50);
export const AGENT_MAX_SNAPSHOTS = envInt('AGENT_MAX_SNAPSHOTS', 10);
export const AGENT_MAX_TASK_RETRIES = envInt('AGENT_MAX_TASK_RETRIES', 3);
export const AGENT_MCP_RECONNECT_MS = envInt('AGENT_MCP_RECONNECT_MS', 5 * 60_000);
export const AGENT_MESSAGES_CACHE_TTL_MS = envInt('AGENT_MESSAGES_CACHE_TTL_MS', 30_000);
export const AGENT_METRICS_INTERVAL_MS = envInt('AGENT_METRICS_INTERVAL_MS', 30_000);
export const AGENT_PERMISSION_MODE = envStr('AGENT_PERMISSION_MODE', 'approve_all');
export const AGENT_ROTATION_MAX_AGE_MS = envInt('AGENT_ROTATION_MAX_AGE_MS', 4 * 60 * 60_000);
export const AGENT_ROTATION_MAX_COMPACTIONS = envInt('AGENT_ROTATION_MAX_COMPACTIONS', 5);
export const AGENT_ROTATION_MAX_TURNS = envInt('AGENT_ROTATION_MAX_TURNS', 200);
export const AGENT_ROTATION_MAX_UTIL = Number(process.env['AGENT_ROTATION_MAX_UTIL'] || 0.9);
export const AGENT_SESSION_MAX_AGE_MS = envInt('AGENT_SESSION_MAX_AGE_MS', 24 * 60 * 60_000);
export const AGENT_SNAPSHOT_DIR = envOpt('AGENT_SNAPSHOT_DIR');
export const AGENT_STARVATION_THRESHOLD_MS = envInt('AGENT_STARVATION_THRESHOLD_MS', 60_000);
export const AGENT_STATE_FILE = envOpt('AGENT_STATE_FILE');
export const AGENT_STATUS_SNAPSHOT_TTL_MS = envInt('AGENT_STATUS_SNAPSHOT_TTL_MS', 500);
export const AGENT_TASK_TIMEOUT_MS = envInt('AGENT_TASK_TIMEOUT_MS', 60_000);
export const AGENT_TOOL_AUDIT_MAX_LOG_BYTES = envInt('AGENT_TOOL_AUDIT_MAX_LOG_BYTES', 10 * 1024 * 1024);
export const COPILOT_ALLOWED_EXECUTABLES = envOpt('COPILOT_ALLOWED_EXECUTABLES');
export const COPILOT_AUDIT_LOG_PATH = envOpt('COPILOT_AUDIT_LOG_PATH');
export const COPILOT_FALLBACK_MODEL = envOpt('COPILOT_FALLBACK_MODEL') ?? null;
export const COPILOT_HIGH_RISK_TOOLS = envOpt('COPILOT_HIGH_RISK_TOOLS');
export const COPILOT_MODEL = envOpt('COPILOT_MODEL');
export const COPILOT_NPM_SCRIPT_ALLOWLIST = envOpt('COPILOT_NPM_SCRIPT_ALLOWLIST');
export const COPILOT_REASONING_EFFORT = envOpt('COPILOT_REASONING_EFFORT');
export const COPILOT_RESTART_DELAY_MS = envInt('COPILOT_RESTART_DELAY_MS', 5_000);
export const COPILOT_RPC_TIMEOUT_MS = envInt('COPILOT_RPC_TIMEOUT_MS', 30_000);
export const COPILOT_SDK_ENABLED = envBool('COPILOT_SDK_ENABLED', false);
export const COPILOT_SKILL_DIRECTORIES = envStr('COPILOT_SKILL_DIRECTORIES', '.github/skills');
export const COPILOT_PINNED_CONTEXT_DIRS = envStr('COPILOT_PINNED_CONTEXT_DIRS', '.github/skills,.github/instructions');
export const COPILOT_DISABLED_SKILLS = envStr('COPILOT_DISABLED_SKILLS', '');
export const COPILOT_TOOL_PERMISSIONS_LOG = envOpt('COPILOT_TOOL_PERMISSIONS_LOG');
export const COPILOT_WORKING_DIRECTORY = envStr('COPILOT_WORKING_DIRECTORY', DEFAULT_WORKSPACE_ROOT);
export const LLM_B_BOOT_TIMEOUT_MS = envInt('LLM_B_BOOT_TIMEOUT_MS', 90_000);
export const LLM_B_DIALOG_QUEUE_MAX = envInt('LLM_B_DIALOG_QUEUE_MAX', 10);
export const LLM_B_WATCHDOG_MS = envInt('LLM_B_WATCHDOG_MS', 5 * 60 * 1_000);
export const LLM_B_WATCHDOG_STALL_MS = envInt('LLM_B_WATCHDOG_STALL_MS', 15 * 60 * 1_000);
export const MAX_WEBHOOKS = envInt('MAX_WEBHOOKS', 50);
export const WEB_SEARCH_DISABLED = envBool('WEB_SEARCH_DISABLED', false);
export const WEBHOOK_ALLOW_PRIVATE_HOSTS = envBool('WEBHOOK_ALLOW_PRIVATE_HOSTS', false);
export const WEBHOOK_MAX_RETRIES = envInt('WEBHOOK_MAX_RETRIES', 2);
export const WEBHOOK_TIMEOUT_MS = envInt('WEBHOOK_TIMEOUT_MS', 5_000);

// ── SDK Client ───────────────────────────────────────────────

export const COPILOT_CLI_URL = envOpt('COPILOT_CLI_URL');

// ── Bridge / API ─────────────────────────────────────────────

export const BRIDGE_ADMIN_TOKEN = envOpt('BRIDGE_ADMIN_TOKEN');
export const BRIDGE_EXPOSE_DIAGNOSTICS = envBool('BRIDGE_EXPOSE_DIAGNOSTICS', false);
export const SDK_API_TOKEN = envOpt('SDK_API_TOKEN') ?? null;

// ── Config: Custom Agents ────────────────────────────────────

export const COPILOT_CUSTOM_AGENTS = envStr(
    'COPILOT_CUSTOM_AGENTS',
    'task,explore,diagnostic,planner,git-ops,shell-ops',
);
export const COPILOT_DISABLED_AGENTS = envStr('COPILOT_DISABLED_AGENTS', '');

// ── Config: MCP Servers ──────────────────────────────────────

export const COPILOT_MCP_STDIO_TIMEOUT_MS = envInt('COPILOT_MCP_STDIO_TIMEOUT_MS', 30_000);
export const COPILOT_MCP_HTTP_TIMEOUT_MS = envInt('COPILOT_MCP_HTTP_TIMEOUT_MS', 15_000);
export const COPILOT_MCP_SERVERS = envStr('COPILOT_MCP_SERVERS', '');
export const GITHUB_TOKEN = envStr('GITHUB_TOKEN', '');
export const MCP_PORT = envStr('MCP_PORT', envStr('PORT', '3008'));
export const MCP_PORT_PROBE_TIMEOUT_MS = envInt('MCP_PORT_PROBE_TIMEOUT_MS', 1_500);
export const SERVER_PORT = envStr('PORT', '3008');

// ── Conversation Hub ─────────────────────────────────────────

export const COPILOT_HUB_SOCKET_AUTH_REQUIRED = envOpt('COPILOT_HUB_SOCKET_AUTH_REQUIRED');
export const DASHBOARD_SOCKET_AUTH_REQUIRED = envOpt('DASHBOARD_SOCKET_AUTH_REQUIRED');

// ── Database ─────────────────────────────────────────────────

export const COPILOT_DB_PATH = envOpt('COPILOT_DB_PATH') || null;

// ── Hooks / Audit ────────────────────────────────────────────

export const COPILOT_AUDIT_BUFFER_SIZE = envInt('COPILOT_AUDIT_BUFFER_SIZE', 500);
export const COPILOT_AUDIT_RING_SIZE = envInt('COPILOT_AUDIT_RING_SIZE', 200);

// ── Observability: Logging ───────────────────────────────────

export const COPILOT_LOG_DIR = envOpt('COPILOT_LOG_DIR');
export const COPILOT_LOG_LEVEL = envStr('COPILOT_LOG_LEVEL', envStr('LOG_LEVEL', 'INFO')).toUpperCase();
export const COPILOT_LOG_MAX_ARCHIVES = envOpt('COPILOT_LOG_MAX_ARCHIVES')
    ? parseInt(/** @type {string} */ (envOpt('COPILOT_LOG_MAX_ARCHIVES')), 10)
    : 5;

// ── Observability: Metrics ───────────────────────────────────

export const COPILOT_METRICS_SNAPSHOT_INTERVAL = envInt('COPILOT_METRICS_SNAPSHOT_INTERVAL', 300_000);
export const COPILOT_EVENTS_MAX_BYTES = envInt('COPILOT_EVENTS_MAX_BYTES', 5 * 1024 * 1024);

// ── Observability: OTel ──────────────────────────────────────

export const COPILOT_OTEL_DISABLED = envBool('COPILOT_OTEL_DISABLED', false);
export const COPILOT_OTEL_ENDPOINT = envOpt('COPILOT_OTEL_ENDPOINT');
export const COPILOT_OTEL_EXPORTER_TYPE = envOpt('COPILOT_OTEL_EXPORTER_TYPE');
export const COPILOT_OTEL_SOURCE_NAME = envStr('COPILOT_OTEL_SOURCE_NAME', COPILOT_CANONICAL_OTEL_SOURCE_NAME);
export const COPILOT_OTEL_CAPTURE_CONTENT = envBool('COPILOT_OTEL_CAPTURE_CONTENT', false);
export const OTEL_EXPORTER_OTLP_ENDPOINT = envOpt('OTEL_EXPORTER_OTLP_ENDPOINT');

// ── SSE ──────────────────────────────────────────────────────

export const MAX_SSE_CLIENTS = envInt('MAX_SSE_CLIENTS', 50);
export const MAX_SSE_CONTENT_CHARS = envInt('MAX_SSE_CONTENT_CHARS', 64_000);
export const MAX_SSE_LIFETIME_MS = envInt('MAX_SSE_LIFETIME_MS', 24 * 60 * 60 * 1000);
export const SSE_REPLAY_BUFFER_SIZE = envInt('SSE_REPLAY_BUFFER_SIZE', 500);

// ── Terminal LLM-B ───────────────────────────────────────────

export const LLM_B_TERMINAL_PORT = envInt('LLM_B_TERMINAL_PORT', 3009);
export const LLM_B_TERMINAL_HOST = envStr('LLM_B_TERMINAL_HOST', '127.0.0.1');
export const LLM_B_TERMINAL_TOKEN = envOpt('LLM_B_TERMINAL_TOKEN') ?? null;
export const LLM_B_TURN_TIMEOUT_MS = envInt('LLM_B_TURN_TIMEOUT_MS', envInt('LLM_B_TURN_TIMEOUT', 120_000));
export const LLM_B_BOOT_PROMPT = envOpt('LLM_B_BOOT_PROMPT');
export const LLM_B_REFLECTION_INTERVAL_MIN = envInt('LLM_B_REFLECTION_INTERVAL_MIN', 0);
export const LLM_B_INJECT_RATE_MAX = envInt('LLM_B_INJECT_RATE_MAX', 10);
export const LLM_B_INJECT_RATE_WINDOW_MS = envInt('LLM_B_INJECT_RATE_WINDOW_MS', 60_000);
export const LLM_B_SSE_RATE_MAX = envInt('LLM_B_SSE_RATE_MAX', 10);
export const LLM_B_SSE_RATE_WINDOW_MS = envInt('LLM_B_SSE_RATE_WINDOW_MS', 60_000);
export const LLM_B_ALIASES_FILE = envOpt('LLM_B_ALIASES_FILE');
export const LLM_B_GH_TIMEOUT_MS = envInt('LLM_B_GH_TIMEOUT_MS', 15_000);
export const LLM_B_GH_DEFAULT_REPO = envStr('LLM_B_GH_DEFAULT_REPO', '');
export const COPILOT_READY_WEBHOOK = envOpt('COPILOT_READY_WEBHOOK');

// ── Terminal State ───────────────────────────────────────────

export const TERMINAL_SHOW_THINKING = envBool('TERMINAL_SHOW_THINKING', false);
export const TERMINAL_SHOW_USAGE = envBool('TERMINAL_SHOW_USAGE', false);
export const TERMINAL_SHOW_STREAMING = process.env['TERMINAL_SHOW_STREAMING'] !== 'false';
export const TERMINAL_SHOW_TOOL_ACTIVITY = process.env['TERMINAL_SHOW_TOOL_ACTIVITY'] !== 'false';
export const TERMINAL_SHOW_INTENT_ACTIVITY = process.env['TERMINAL_SHOW_INTENT_ACTIVITY'] !== 'false';
export const TERMINAL_MAX_INJECT_HISTORY = envInt('TERMINAL_MAX_INJECT_HISTORY', 100);
export const TERMINAL_MAX_LISTENERS = envInt('TERMINAL_MAX_LISTENERS', 25);
export const TERMINAL_MAX_ATTACHMENTS = envInt('TERMINAL_MAX_ATTACHMENTS', 50);

// ── Queue / Internal Limits ──────────────────────────────────

/**
 * Tamanho máximo da fila de mensagens do AlwaysAliveAgent. Quando a fila atinge este limite, novas mensagens são
 * rejeitadas.
 *
 * @type {number}
 */
export const MAX_QUEUE_SIZE = 100;

/**
 * Retorna o modelo de fallback do Copilot para situações de rate_limit/quota. Lido em runtime (não import-time) para
 * permitir configuração dinâmica via `process.env`.
 *
 * @returns {string | null}
 */
export function getCopilotFallbackModel() {
    return process.env['COPILOT_FALLBACK_MODEL'] ?? null;
}

// ─── IConfigProvider singleton (Faixa 3.2 — AC-5-06) ────────────────────────

/**
 * Adapter sobre `process.env` que implementa a interface `IConfigProvider`.
 *
 * Permite que consumidores aceitem um contrato estável em vez de acessar `process.env` diretamente, facilitando
 * substituição em testes.
 *
 * @type {import('../core/interfaces.js').IConfigProvider}
 */
export const envProvider = {
    /** @param {string} key */
    getString: (key) => process.env[key] || undefined,
    /** @param {string} key @param {number} fallback */
    getInt: (key, fallback) => envInt(key, fallback),
    /** @param {string} key */
    getBool: (key) => {
        const v = process.env[key];
        return v === 'true' || v === '1' || v === 'yes';
    },
    /** @param {string} key */
    has: (key) => process.env[key] !== undefined && process.env[key] !== '',
};
