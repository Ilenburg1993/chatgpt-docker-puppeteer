// @ts-check
/**
 * src/copilot/agent/config.js
 *
 * Configuração centralizada do agente. Cada propriedade lê uma variável de ambiente com fallback para um default
 * razoável. Módulos internos do agent/ devem importar daqui em vez de ler `process.env` diretamente.
 *
 * @module copilot/agent/config
 */

// ── Helpers ──────────────────────────────────────────────────

/** @param {string} key @param {number} fallback */
const envInt = (key, fallback) => Number(process.env[key]) || fallback;

/** @param {string} key @param {string} fallback @returns {string} */
const envStr = (key, fallback) => process.env[key] ?? fallback;

/** @param {string} key @returns {string | undefined} */
const envStrOpt = (key) => process.env[key];

// ── Dialog Loop ──────────────────────────────────────────────

/** Tamanho máximo da fila de diálogo */
export const DIALOG_QUEUE_MAX = envInt('LLM_B_DIALOG_QUEUE_MAX', 10);
/** Timeout de boot do loop (ms) */
export const BOOT_TIMEOUT_MS = envInt('LLM_B_BOOT_TIMEOUT_MS', 30_000);
/** Intervalo do watchdog do loop (ms) */
export const WATCHDOG_INTERVAL_MS = envInt('LLM_B_WATCHDOG_MS', 5 * 60 * 1_000);
/** Stall timeout do watchdog (ms) */
export const WATCHDOG_STALL_MS = envInt('LLM_B_WATCHDOG_STALL_MS', 15 * 60 * 1_000);

// ── Session ──────────────────────────────────────────────────

/** Máximo de bytes para hook context */
export const HOOK_CONTEXT_MAX_BYTES = envInt('AGENT_HOOK_CONTEXT_MAX_BYTES', 8 * 1024);
/** Idade máxima da sessão (ms) */
export const SESSION_MAX_AGE_MS = envInt('AGENT_SESSION_MAX_AGE_MS', 24 * 60 * 60_000);
/** Diretório de trabalho do Copilot */
export const WORKING_DIRECTORY = envStr('COPILOT_WORKING_DIRECTORY', process.cwd());

// ── Session Rotation ─────────────────────────────────────────

/** Utilização máxima antes de rotação */
export const ROTATION_MAX_UTIL = Number(process.env['AGENT_ROTATION_MAX_UTIL'] || 0.9);
/** Idade máxima antes de rotação (ms) */
export const ROTATION_MAX_AGE_MS = envInt('AGENT_ROTATION_MAX_AGE_MS', 4 * 60 * 60_000);
/** Compactações máximas antes de rotação */
export const ROTATION_MAX_COMPACTIONS = envInt('AGENT_ROTATION_MAX_COMPACTIONS', 5);
/** Turnos máximos antes de rotação */
export const ROTATION_MAX_TURNS = envInt('AGENT_ROTATION_MAX_TURNS', 200);

// ── Keepalive ────────────────────────────────────────────────

/** Intervalo de keepalive (ms) */
export const KEEPALIVE_INTERVAL_MS = envInt('AGENT_KEEPALIVE_MS', 10 * 60_000);
/** Threshold de idle para keepalive (ms) */
export const KEEPALIVE_IDLE_THRESHOLD_MS = envInt('AGENT_KEEPALIVE_IDLE_MS', 20 * 60_000);

// ── Snapshots ────────────────────────────────────────────────

/** Diretório de snapshots */
export const SNAPSHOT_DIR = envStrOpt('AGENT_SNAPSHOT_DIR');
/** Número máximo de snapshots */
export const MAX_SNAPSHOTS = envInt('AGENT_MAX_SNAPSHOTS', 10);

// ── State I/O ────────────────────────────────────────────────

/** Arquivo de estado persistente (undefined = usar fallback local) */
export const STATE_FILE = envStrOpt('AGENT_STATE_FILE');

// ── Lifecycle / Entry ────────────────────────────────────────

/** Delay de restart (ms) */
export const RESTART_DELAY_MS = envInt('COPILOT_RESTART_DELAY_MS', 5_000);
/** Modelo Copilot */
export const COPILOT_MODEL = envStr('COPILOT_MODEL', 'gpt-4.1');
/** Reasoning effort */
export const COPILOT_REASONING_EFFORT = envStrOpt('COPILOT_REASONING_EFFORT');

// ── Always-Alive Agent ───────────────────────────────────────

/** TTL do cache de mensagens (ms) */
export const MESSAGES_CACHE_TTL_MS = envInt('AGENT_MESSAGES_CACHE_TTL_MS', 30_000);
/** Max listeners no EventEmitter */
export const MAX_LISTENERS = envInt('AGENT_MAX_LISTENERS', 50);
/** Intervalo de reconexão MCP (ms) */
export const MCP_RECONNECT_MS = envInt('AGENT_MCP_RECONNECT_MS', 5 * 60_000);
/** Intervalo de métricas (ms) */
export const METRICS_INTERVAL_MS = envInt('AGENT_METRICS_INTERVAL_MS', 30_000);
/** TTL do snapshot de status (ms) */
export const STATUS_SNAPSHOT_TTL_MS = envInt('AGENT_STATUS_SNAPSHOT_TTL_MS', 500);

// ── Task Executor ────────────────────────────────────────────

/** Máximo de retries por task */
export const MAX_TASK_RETRIES = envInt('AGENT_MAX_TASK_RETRIES', 3);
/** Timeout padrão de task (ms) */
export const TASK_TIMEOUT_MS = envInt('AGENT_TASK_TIMEOUT_MS', 60_000);

// ── Webhooks ─────────────────────────────────────────────────

/** Timeout de webhook (ms) */
export const WEBHOOK_TIMEOUT_MS = envInt('WEBHOOK_TIMEOUT_MS', 5_000);
/** Máximo de retries de webhook */
export const WEBHOOK_MAX_RETRIES = envInt('WEBHOOK_MAX_RETRIES', 2);
/** Máximo de webhooks registrados */
export const MAX_WEBHOOKS = envInt('MAX_WEBHOOKS', 50);

// ── Status Snapshot ──────────────────────────────────────────

/** Threshold de starvation (ms) */
export const STARVATION_THRESHOLD_MS = envInt('AGENT_STARVATION_THRESHOLD_MS', 60_000);

// ── Tool Audit Logger ────────────────────────────────────────

/** Caminho do log de auditoria de tools (undefined = usar fallback local) */
export const TOOL_AUDIT_LOG = envStrOpt('COPILOT_TOOL_PERMISSIONS_LOG') ?? envStrOpt('COPILOT_AUDIT_LOG_PATH');
/** Tamanho máximo do log (bytes) */
export const TOOL_AUDIT_MAX_LOG_BYTES = envInt('AGENT_TOOL_AUDIT_MAX_LOG_BYTES', 10 * 1024 * 1024);

// ── Permission Controller ────────────────────────────────────

/** Modo de permissão padrão @type {'approve_all' | 'deny_all' | 'interactive'} */
export const PERMISSION_MODE = /** @type {'approve_all' | 'deny_all' | 'interactive'} */ (
    envStr('AGENT_PERMISSION_MODE', 'approve_all')
);
