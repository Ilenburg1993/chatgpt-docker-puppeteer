// @ts-check
/**
 * src/copilot/config/agent.js
 *
 * Configuração centralizada do agente. Importa variáveis base de `config/env.js` (SSOT) e re-exporta com nomes
 * semânticos para o subsistema agent/. Constantes derivadas (não-env) permanecem aqui.
 *
 * @module copilot/config/agent
 * @see EventBus
 */

import {
    COPILOT_MODEL as _COPILOT_MODEL,
    COPILOT_REASONING_EFFORT as _COPILOT_REASONING_EFFORT,
    AGENT_HOOK_CONTEXT_MAX_BYTES,
    AGENT_KEEPALIVE_IDLE_MS,
    AGENT_KEEPALIVE_MS,
    AGENT_MAX_LISTENERS,
    AGENT_MAX_SNAPSHOTS,
    AGENT_MAX_TASK_RETRIES,
    AGENT_MCP_RECONNECT_MS,
    AGENT_MESSAGES_CACHE_TTL_MS,
    AGENT_METRICS_INTERVAL_MS,
    AGENT_PERMISSION_MODE,
    AGENT_ROTATION_MAX_AGE_MS,
    AGENT_ROTATION_MAX_COMPACTIONS,
    AGENT_ROTATION_MAX_TURNS,
    AGENT_ROTATION_MAX_UTIL,
    AGENT_SESSION_MAX_AGE_MS,
    AGENT_SNAPSHOT_DIR,
    AGENT_STARVATION_THRESHOLD_MS,
    AGENT_STATE_FILE,
    AGENT_STATUS_SNAPSHOT_TTL_MS,
    AGENT_TASK_TIMEOUT_MS,
    AGENT_TOOL_AUDIT_MAX_LOG_BYTES,
    COPILOT_AUDIT_LOG_PATH,
    COPILOT_RESTART_DELAY_MS,
    COPILOT_TOOL_PERMISSIONS_LOG,
    COPILOT_WORKING_DIRECTORY,
    LLM_B_BOOT_TIMEOUT_MS,
    LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK,
    LLM_B_DIALOG_QUEUE_MAX,
    LLM_B_WATCHDOG_MS,
    LLM_B_WATCHDOG_STALL_MS,
    MAX_WEBHOOKS,
    WEBHOOK_MAX_RETRIES,
    WEBHOOK_TIMEOUT_MS,
} from './env.js';

// ── Dialog Loop ──────────────────────────────────────────────

/** @typedef {'ready' | 'reply' | 'stopped' | 'question'} DialogMessageKind */

/**
 * Mapa de thresholds de stall (ms) do DialogWatchdog por tipo de tarefa. Tarefas mais longas recebem threshold maior
 * para evitar watchdog kills prematuros.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const WATCHDOG_THRESHOLDS = Object.freeze({
    default: 15 * 60_000,
    analysis: 45 * 60_000,
    refactor: 30 * 60_000,
    simple: 8 * 60_000,
    codegen: 20 * 60_000,
    test: 20 * 60_000,
});

/** Tamanho máximo da fila de diálogo */
export const DIALOG_QUEUE_MAX = LLM_B_DIALOG_QUEUE_MAX;
/** Timeout de boot do loop (ms) */
export const BOOT_TIMEOUT_MS = LLM_B_BOOT_TIMEOUT_MS;
/** Fallback automático de boot recovery para `startDialogLoop()` com PR. Default: bloqueado. */
export const DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK = LLM_B_DIALOG_BOOT_RECOVERY_ALLOW_PR_FALLBACK;
/** Janela zero-PR para aceitar READY/REPLY tardio depois do timeout nominal de boot. */
export const BOOT_LATE_PROTOCOL_GRACE_MS = Math.min(30_000, Math.max(5_000, Math.round(BOOT_TIMEOUT_MS * 0.25)));
/** Intervalo do watchdog do loop (ms) */
export const WATCHDOG_INTERVAL_MS = LLM_B_WATCHDOG_MS;
/** Stall timeout do watchdog (ms) */
export const WATCHDOG_STALL_MS = LLM_B_WATCHDOG_STALL_MS;

// ── Session ──────────────────────────────────────────────────

/** Máximo de bytes para hook context */
export const HOOK_CONTEXT_MAX_BYTES = AGENT_HOOK_CONTEXT_MAX_BYTES;
/** Idade máxima da sessão (ms) */
export const SESSION_MAX_AGE_MS = AGENT_SESSION_MAX_AGE_MS;
/** Diretório de trabalho do Copilot */
export const WORKING_DIRECTORY = COPILOT_WORKING_DIRECTORY;

// ── Session Rotation ─────────────────────────────────────────

/** Utilização máxima antes de rotação */
export const ROTATION_MAX_UTIL = AGENT_ROTATION_MAX_UTIL;
/** Idade máxima antes de rotação (ms) */
export const ROTATION_MAX_AGE_MS = AGENT_ROTATION_MAX_AGE_MS;
/** Compactações máximas antes de rotação */
export const ROTATION_MAX_COMPACTIONS = AGENT_ROTATION_MAX_COMPACTIONS;
/** Turnos máximos antes de rotação */
export const ROTATION_MAX_TURNS = AGENT_ROTATION_MAX_TURNS;

// ── Keepalive ────────────────────────────────────────────────

/** Intervalo de keepalive (ms) */
export const KEEPALIVE_INTERVAL_MS = AGENT_KEEPALIVE_MS;
/** Threshold de idle para keepalive (ms) */
export const KEEPALIVE_IDLE_THRESHOLD_MS = AGENT_KEEPALIVE_IDLE_MS;

// ── Snapshots ────────────────────────────────────────────────

/** Diretório de snapshots */
export const SNAPSHOT_DIR = AGENT_SNAPSHOT_DIR;
/** Número máximo de snapshots */
export const MAX_SNAPSHOTS = AGENT_MAX_SNAPSHOTS;

// ── State I/O ────────────────────────────────────────────────

/** Arquivo de estado persistente (undefined = usar fallback local) */
export const STATE_FILE = AGENT_STATE_FILE;

// ── Lifecycle / Entry ────────────────────────────────────────

/** Delay de restart (ms) */
export const RESTART_DELAY_MS = COPILOT_RESTART_DELAY_MS;
/** Modelo default canônico do runtime LLM-B. Set to 'auto' para seleção automática via ModelSelector (F40.2). */
export const DEFAULT_COPILOT_MODEL = 'auto';
/** Reasoning effort default canônico do runtime LLM-B. */
export const DEFAULT_COPILOT_REASONING_EFFORT = 'high';
/** Modelo Copilot */
export const COPILOT_MODEL = _COPILOT_MODEL ?? DEFAULT_COPILOT_MODEL;
/** Reasoning effort */
export const COPILOT_REASONING_EFFORT = /** @type {'low' | 'medium' | 'high' | 'xhigh'} */ (
    _COPILOT_REASONING_EFFORT ?? DEFAULT_COPILOT_REASONING_EFFORT
);

// ── Always-Alive Agent ───────────────────────────────────────

/** TTL do cache de mensagens (ms) */
export const MESSAGES_CACHE_TTL_MS = AGENT_MESSAGES_CACHE_TTL_MS;
/** Max listeners no EventEmitter */
export const MAX_LISTENERS = AGENT_MAX_LISTENERS;
/** Intervalo de reconexão MCP (ms) */
export const MCP_RECONNECT_MS = AGENT_MCP_RECONNECT_MS;
/** Intervalo de métricas (ms) */
export const METRICS_INTERVAL_MS = AGENT_METRICS_INTERVAL_MS;
/** TTL do snapshot de status (ms) */
export const STATUS_SNAPSHOT_TTL_MS = AGENT_STATUS_SNAPSHOT_TTL_MS;

// ── Task Executor ────────────────────────────────────────────

/** Máximo de retries por task */
export const MAX_TASK_RETRIES = AGENT_MAX_TASK_RETRIES;
/** Timeout padrão de task (ms) */
export const TASK_TIMEOUT_MS = AGENT_TASK_TIMEOUT_MS;

// ── Webhooks ─────────────────────────────────────────────────

/** Timeout de webhook (ms) */
export { WEBHOOK_TIMEOUT_MS };
/** Máximo de retries de webhook */
export { WEBHOOK_MAX_RETRIES };
/** Máximo de webhooks registrados */
export { MAX_WEBHOOKS };

// ── Status Snapshot ──────────────────────────────────────────

/** Threshold de starvation (ms) */
export const STARVATION_THRESHOLD_MS = AGENT_STARVATION_THRESHOLD_MS;

// ── Tool Audit Logger ────────────────────────────────────────

/** Caminho do log de auditoria de tools (undefined = usar fallback local) */
export const TOOL_AUDIT_LOG = COPILOT_TOOL_PERMISSIONS_LOG ?? COPILOT_AUDIT_LOG_PATH;
/** Tamanho máximo do log (bytes) */
export const TOOL_AUDIT_MAX_LOG_BYTES = AGENT_TOOL_AUDIT_MAX_LOG_BYTES;

// ── Permission Controller ────────────────────────────────────

/** Modo de permissão padrão @type {'approve_all' | 'audit_only' | 'selective'} */
export const PERMISSION_MODE = /** @type {'approve_all' | 'audit_only' | 'selective'} */ (AGENT_PERMISSION_MODE);

// ── Context Utilization Thresholds ───────────────────────────

/** Utilização de contexto acima da qual o dialog loop NÃO inicia (bloqueio) */
export const CONTEXT_UTIL_BLOCK_THRESHOLD = 0.95;
/** Utilização de contexto acima da qual emite warning mas prossegue */
export const CONTEXT_UTIL_WARN_THRESHOLD = 0.8;

// ── Agent Timeouts ───────────────────────────────────────────

/** Timeout para tarefas de longa duração (dialog loop) — 24h em ms */
export const LONG_TASK_TIMEOUT_MS = 24 * 60 * 60 * 1000;
/** Delay de boot recovery após resume (ms) */
export const BOOT_RECOVERY_DELAY_MS = 5_000;
/** Timeout máximo de shutdown padrão (ms) */
export const SHUTDOWN_TIMEOUT_MS = 10_000;
/** Timeout para aguardar boot durante stop() (ms) */
export const STOP_BOOT_WAIT_MS = 15_000;
/** Timeout padrão para drain de writes (ms) */
export const DRAIN_WRITES_TIMEOUT_MS = 3_000;
/** Timeout de ping para health check (ms) */
export const PING_TIMEOUT_MS = 15_000;
/** Timeout para aguardar question.pending em resume (ms) */
export const RESUME_QUESTION_WAIT_MS = 5_000;
/** TTL da shadow persistida de ask_user do tipo `ready` (ms) */
export const PENDING_QUESTION_SHADOW_TTL_READY_MS = 5 * 60 * 1000;
/** TTL da shadow persistida de ask_user do tipo `question` (ms) */
export const PENDING_QUESTION_SHADOW_TTL_QUESTION_MS = 15 * 60 * 1000;
/** TTL default/back-compat da shadow persistida de ask_user restaurada do disco (ms) */
export const PENDING_QUESTION_SHADOW_TTL_MS = PENDING_QUESTION_SHADOW_TTL_QUESTION_MS;
/** Janela em que uma shadow recém-restaurada ainda é tratada como "fresh" (ms) */
export const PENDING_QUESTION_SHADOW_FRESH_MS = 30_000;
/** Piso mínimo para classificar uma shadow como "expiring_soon" (ms) */
export const PENDING_QUESTION_SHADOW_EXPIRING_SOON_MIN_MS = 60_000;

// ── Boot ─────────────────────────────────────────────────────

/** Máximo de tentativas de boot antes de desistir */
export const BOOT_MAX_RETRIES = 5;

// ── Webhook Retry ────────────────────────────────────────────

/** Base do backoff exponencial de webhook retry (ms) */
export const WEBHOOK_RETRY_BASE_MS = 500;
