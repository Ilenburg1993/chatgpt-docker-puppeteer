// @ts-check
/**
 * src/copilot/sdk/constants.js
 *
 * Constantes centralizadas derivadas do `@github/copilot-sdk`. Elimina magic strings em consumers; garante consistência
 * com a API do SDK.
 *
 * @module copilot/sdk/constants
 * @see EventBus
 */

// ─── Session Modes ────────────────────────────────────────────────────────────

/** Modelo default usado pelo SDK local quando nenhum modelo explícito foi escolhido. */
export const DEFAULT_MODEL = 'auto';

/** Modelo leve para diagnósticos e testes. */
export const DEFAULT_DIAGNOSTIC_MODEL = 'gpt-4.1-mini';

/** Modos de operação da sessão. */
export const SESSION_MODES = /** @type {const} */ ({
    INTERACTIVE: 'interactive',
    PLAN: 'plan',
    AUTOPILOT: 'autopilot',
});

// ─── Reasoning Effort ─────────────────────────────────────────────────────────

/** Níveis de esforço de reasoning. */
export const REASONING_EFFORTS = /** @type {const} */ ({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    XHIGH: 'xhigh',
});

// ─── Connection States ────────────────────────────────────────────────────────

/** Estados de conexão do client com o CLI server. */
export const CONNECTION_STATES = /** @type {const} */ ({
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    ERROR: 'error',
});

// ─── System Prompt Sections ───────────────────────────────────────────────────

/** Nomes das seções do system prompt (subset documentado pelo SDK). */
export const SYSTEM_PROMPT_SECTION_NAMES = /** @type {const} */ ({
    IDENTITY: 'identity',
    TONE: 'tone',
    TOOL_EFFICIENCY: 'tool_efficiency',
    ENVIRONMENT_CONTEXT: 'environment_context',
    CODE_CHANGE_RULES: 'code_change_rules',
    GUIDELINES: 'guidelines',
    SAFETY: 'safety',
    TOOL_INSTRUCTIONS: 'tool_instructions',
    CUSTOM_INSTRUCTIONS: 'custom_instructions',
    LAST_INSTRUCTIONS: 'last_instructions',
});

// ─── Section Override Actions ─────────────────────────────────────────────────

/** Ações disponíveis para override de seção do system prompt. */
export const SECTION_ACTIONS = /** @type {const} */ ({
    REPLACE: 'replace',
    REMOVE: 'remove',
    APPEND: 'append',
    PREPEND: 'prepend',
});

// ─── Permission Request Results ───────────────────────────────────────────────

/** Tipos de permissão solicitados pelo SDK. */
export const PERMISSION_REQUEST_KINDS = /** @type {const} */ ({
    SHELL: 'shell',
    TASK_EXECUTION: 'task-execution',
    WORKSPACE_TRUST: 'workspace-trust',
    CONTENT_EXCLUSION_CHECK: 'content-exclusion-check',
});

/** Valores de resultado de permissão. */
export const PERMISSION_RESULTS = /** @type {const} */ ({
    APPROVE_ONCE: 'approve-once',
    APPROVE_FOR_SESSION: 'approve-for-session',
    APPROVE_FOR_LOCATION: 'approve-for-location',
    REJECT: 'reject',
    USER_NOT_AVAILABLE: 'user-not-available',
    NO_RESULT: 'no-result',
});

/** Result kinds observados em eventos `permission.completed` do SDK. */
export const PERMISSION_COMPLETED_KINDS = /** @type {const} */ ({
    APPROVED: 'approved',
    APPROVED_FOR_SESSION: 'approved-for-session',
    APPROVED_FOR_LOCATION: 'approved-for-location',
    DENIED_BY_RULES: 'denied-by-rules',
    DENIED_NO_APPROVAL_RULE_AND_COULD_NOT_REQUEST_FROM_USER: 'denied-no-approval-rule-and-could-not-request-from-user',
    DENIED_INTERACTIVELY_BY_USER: 'denied-interactively-by-user',
    DENIED_BY_CONTENT_EXCLUSION_POLICY: 'denied-by-content-exclusion-policy',
    DENIED_BY_PERMISSION_REQUEST_HOOK: 'denied-by-permission-request-hook',
});

// ─── Tool Result Types ────────────────────────────────────────────────────────

/** Tipos de resultado de tool. */
export const TOOL_RESULT_TYPES = /** @type {const} */ ({
    SUCCESS: 'success',
    FAILURE: 'failure',
    REJECTED: 'rejected',
    DENIED: 'denied',
});

// ─── Session Lifecycle Events ─────────────────────────────────────────────────

/** Tipos de evento de lifecycle de sessão (emitidos pelo client). */
export const SESSION_LIFECYCLE_EVENTS = /** @type {const} */ ({
    CREATED: 'session.created',
    DELETED: 'session.deleted',
    UPDATED: 'session.updated',
    FOREGROUND: 'session.foreground',
    BACKGROUND: 'session.background',
});

// ─── Session Events ───────────────────────────────────────────────────────────

/**
 * Tipos de evento de sessão (emitidos pela sessão via `session.on(type, handler)`). Mapeamento completo dos 72+ event
 * types do SDK.
 */
export const SESSION_EVENTS = /** @type {const} */ ({
    // ── Session ──
    SESSION_START: 'session.start',
    SESSION_IDLE: 'session.idle',
    SESSION_ERROR: 'session.error',
    SESSION_RESUME: 'session.resume',
    SESSION_INFO: 'session.info',
    SESSION_WARNING: 'session.warning',
    SESSION_SHUTDOWN: 'session.shutdown',
    SESSION_MODE_CHANGED: 'session.mode_changed',
    SESSION_MODEL_CHANGE: 'session.model_change',
    SESSION_PLAN_CHANGED: 'session.plan_changed',
    SESSION_TITLE_CHANGED: 'session.title_changed',
    SESSION_CONTEXT_CHANGED: 'session.context_changed',
    SESSION_TOOLS_UPDATED: 'session.tools_updated',
    SESSION_COMPACTION_START: 'session.compaction_start',
    SESSION_COMPACTION_COMPLETE: 'session.compaction_complete',
    SESSION_TRUNCATION: 'session.truncation',
    SESSION_USAGE_INFO: 'session.usage_info',
    SESSION_TASK_COMPLETE: 'session.task_complete',
    SESSION_HANDOFF: 'session.handoff',
    SESSION_SNAPSHOT_REWIND: 'session.snapshot_rewind',
    SESSION_SKILLS_LOADED: 'session.skills_loaded',
    SESSION_MCP_SERVERS_LOADED: 'session.mcp_servers_loaded',
    SESSION_MCP_SERVER_STATUS_CHANGED: 'session.mcp_server_status_changed',
    SESSION_EXTENSIONS_LOADED: 'session.extensions_loaded',
    SESSION_BACKGROUND_TASKS_CHANGED: 'session.background_tasks_changed',
    SESSION_WORKSPACE_FILE_CHANGED: 'session.workspace_file_changed',

    // ── Assistant ──
    ASSISTANT_TURN_START: 'assistant.turn_start',
    ASSISTANT_TURN_END: 'assistant.turn_end',
    ASSISTANT_MESSAGE_START: 'assistant.message_start',
    ASSISTANT_MESSAGE: 'assistant.message',
    ASSISTANT_MESSAGE_DELTA: 'assistant.message_delta',
    ASSISTANT_STREAMING_DELTA: 'assistant.streaming_delta',
    ASSISTANT_INTENT: 'assistant.intent',
    ASSISTANT_REASONING: 'assistant.reasoning',
    ASSISTANT_REASONING_DELTA: 'assistant.reasoning_delta',
    ASSISTANT_USAGE: 'assistant.usage',

    // ── User ──
    USER_MESSAGE: 'user.message',

    // ── Tool ──
    TOOL_EXECUTION_START: 'tool.execution_start',
    TOOL_EXECUTION_COMPLETE: 'tool.execution_complete',
    TOOL_EXECUTION_PROGRESS: 'tool.execution_progress',
    TOOL_EXECUTION_PARTIAL_RESULT: 'tool.execution_partial_result',
    TOOL_USER_REQUESTED: 'tool.user_requested',

    // ── Hook ──
    HOOK_START: 'hook.start',
    HOOK_END: 'hook.end',

    // ── Sampling ──
    SAMPLING_REQUESTED: 'sampling.requested',
    SAMPLING_COMPLETED: 'sampling.completed',

    // ── Skill ──
    SKILL_INVOKED: 'skill.invoked',

    // ── Subagent ──
    SUBAGENT_STARTED: 'subagent.started',
    SUBAGENT_COMPLETED: 'subagent.completed',
    SUBAGENT_FAILED: 'subagent.failed',
    SUBAGENT_SELECTED: 'subagent.selected',
    SUBAGENT_DESELECTED: 'subagent.deselected',

    // ── Agent ──
    AGENT_IDLE: 'agent_idle',
    AGENT_COMPLETED: 'agent_completed',

    // ── Permission ──
    PERMISSION_REQUESTED: 'permission.requested',
    PERMISSION_COMPLETED: 'permission.completed',
    CAPABILITIES_CHANGED: 'capabilities.changed',

    // ── User Input / Elicitation ──
    USER_INPUT_REQUESTED: 'user_input.requested',
    USER_INPUT_COMPLETED: 'user_input.completed',
    ELICITATION_REQUESTED: 'elicitation.requested',
    ELICITATION_COMPLETED: 'elicitation.completed',

    // ── Command ──
    COMMAND_QUEUED: 'command.queued',
    COMMAND_EXECUTE: 'command.execute',
    COMMAND_COMPLETED: 'command.completed',
    COMMANDS_CHANGED: 'commands.changed',

    // ── Plan Mode ──
    EXIT_PLAN_MODE_REQUESTED: 'exit_plan_mode.requested',
    EXIT_PLAN_MODE_COMPLETED: 'exit_plan_mode.completed',

    // ── Auto Mode Switch ──
    AUTO_MODE_SWITCH_REQUESTED: 'auto_mode_switch.requested',
    AUTO_MODE_SWITCH_COMPLETED: 'auto_mode_switch.completed',

    // ── Shell ──
    SHELL_COMPLETED: 'shell_completed',
    SHELL_DETACHED_COMPLETED: 'shell_detached_completed',

    // ── External Tool ──
    EXTERNAL_TOOL_REQUESTED: 'external_tool.requested',
    EXTERNAL_TOOL_COMPLETED: 'external_tool.completed',

    // ── MCP ──
    MCP_OAUTH_REQUIRED: 'mcp.oauth_required',
    MCP_OAUTH_COMPLETED: 'mcp.oauth_completed',

    // ── System ──
    SYSTEM_MESSAGE: 'system.message',
    SYSTEM_NOTIFICATION: 'system.notification',

    // ── Pending Messages ──
    PENDING_MESSAGES_MODIFIED: 'pending_messages.modified',

    // ── Abort ──
    ABORT: 'abort',

    // ── Custom ──
    CUSTOM: 'custom',
});

// ─── Infinite Session Defaults ────────────────────────────────────────────────

/** Thresholds default para sessão infinita (compaction). */
export const INFINITE_SESSION_DEFAULTS = /** @type {const} */ ({
    BACKGROUND_COMPACTION_THRESHOLD: 0.8,
    BUFFER_EXHAUSTION_THRESHOLD: 0.95,
});

// ─── Provider Types ───────────────────────────────────────────────────────────

/** Tipos de provider BYOK suportados. */
export const PROVIDER_TYPES = /** @type {const} */ ({
    OPENAI: 'openai',
    AZURE: 'azure',
    ANTHROPIC: 'anthropic',
});
