// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/shared/nerv/constants.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: Protocol (Linguagem Universal)
   Audit Level: 500 — NERV Protocol Canonical Vocabulary
   Status: CONSTITUTIONAL (Singularity Edition)

   Responsabilidade: Gramática formal do protocolo NERV
   - Define MessageType (ontologia: COMMAND, EVENT, ACK)
   - Define ActionCode (vocabulário semântico extensível)
   - Define ActorRole (identidade dos subsistemas)
   - Estabelece versão do protocolo (PROTOCOL_VERSION: '2.0.0')
========================================================================== */

/**
 * ## PROTOCOL
 *
 * Versão explícita do protocolo IPC. Nunca inferida. Nunca omitida.
 */
const PROTOCOL_VERSION = '2.0.0';

/**
 * ## MESSAGE TYPE (ONTOLOGICAL)
 *
 * Define O QUE a mensagem É. Conjunto fechado. Nunca extensível.
 */
const MessageType = Object.freeze({
    COMMAND: 'COMMAND', // Intenção declarada de ação futura
    EVENT: 'EVENT', // Observação registrada de algo ocorrido
    ACK: 'ACK', // Confirmação técnica de transporte
});

/**
 * ## ACTION CODE (REFERENTIAL)
 *
 * Define SOBRE O QUE a mensagem fala. Extensível apenas por adição explícita. Nunca redefine o tipo ontológico.
 */
const ActionCode = Object.freeze({
    // ---- TASK / EXECUTION ----
    TASK_START: 'TASK_START',
    TASK_CANCEL: 'TASK_CANCEL',
    TASK_RETRY: 'TASK_RETRY',
    TASK_FAILED: 'TASK_FAILED', // Task execution failed
    TASK_REJECTED: 'TASK_REJECTED', // Task rejected by policy
    TASK_OBSERVED: 'TASK_OBSERVED', // Task observation event
    QUEUE_DISPATCH_FAILED: 'QUEUE_DISPATCH_FAILED', // Queue dispatch failure lock release

    // ---- PROPOSAL / POLICY ----
    PROPOSE_TASK: 'PROPOSE_TASK', // Policy engine task proposal

    // ---- ENGINE CONTROL ----
    ENGINE_PAUSE: 'ENGINE_PAUSE',
    ENGINE_RESUME: 'ENGINE_RESUME',
    ENGINE_STOP: 'ENGINE_STOP',

    // ---- DRIVER / TASK EXECUTION ----
    DRIVER_EXECUTE_TASK: 'DRIVER_EXECUTE_TASK',
    DRIVER_ABORT: 'DRIVER_ABORT',
    DRIVER_TASK_STARTED: 'DRIVER_TASK_STARTED',
    DRIVER_TASK_QUEUED: 'DRIVER_TASK_QUEUED',
    DRIVER_TASK_RETRYING: 'DRIVER_TASK_RETRYING',
    DRIVER_TASK_ACCEPTED: 'DRIVER_TASK_ACCEPTED',
    DRIVER_TASK_HEARTBEAT: 'DRIVER_TASK_HEARTBEAT',
    DRIVER_TASK_COMPLETED: 'DRIVER_TASK_COMPLETED',
    DRIVER_TASK_FAILED: 'DRIVER_TASK_FAILED',
    DRIVER_TASK_ABORTED: 'DRIVER_TASK_ABORTED',

    // ---- DRIVER / HEALTH & MONITORING ----
    DRIVER_HEALTH_CHECK: 'DRIVER_HEALTH_CHECK',
    DRIVER_HEALTH_REPORT: 'DRIVER_HEALTH_REPORT',
    DRIVER_STATE_OBSERVED: 'DRIVER_STATE_OBSERVED',
    DRIVER_VITAL: 'DRIVER_VITAL',
    DRIVER_ANOMALY: 'DRIVER_ANOMALY',
    DRIVER_ERROR: 'DRIVER_ERROR',

    // ---- KERNEL / SYSTEM ----
    KERNEL_HEALTH_CHECK: 'KERNEL_HEALTH_CHECK',
    KERNEL_TELEMETRY: 'KERNEL_TELEMETRY',
    KERNEL_INTERNAL_ERROR: 'KERNEL_INTERNAL_ERROR',

    // ---- BROWSER / INFRA ----
    BROWSER_REBOOT: 'BROWSER_REBOOT',
    CACHE_CLEAR: 'CACHE_CLEAR',
    STALL_DETECTED: 'STALL_DETECTED',
    INFRA_EMERGENCY: 'INFRA_EMERGENCY', // ONDA 2: Infrastructure emergency escalation
    INFRA_READY: 'INFRA_READY', // Infrastructure component ready
    INFRA_SHUTDOWN: 'INFRA_SHUTDOWN', // Infrastructure component shutdown
    ARTIFACT_REGISTRATION_FAILED: 'ARTIFACT_REGISTRATION_FAILED', // Artifact registration/linking failure

    // ---- FORENSICS ----
    FORENSICS_DUMP_CREATED: 'FORENSICS_DUMP_CREATED', // ONDA 2: Crash dump evidence ready

    // ---- SECURITY ----
    SECURITY_VIOLATION: 'SECURITY_VIOLATION',

    // ---- TELEMETRY ----
    TELEMETRY_DISCARDED: 'TELEMETRY_DISCARDED',

    // ---- ORCHESTRATION (Mission Orchestration) ----
    ORCHESTRATION_STARTED: 'ORCHESTRATION_STARTED', // Orchestration engine started processing
    ORCHESTRATION_COMPLETED: 'ORCHESTRATION_COMPLETED', // Orchestration completed successfully
    ORCHESTRATION_FAILED: 'ORCHESTRATION_FAILED', // Orchestration failed
    ORCHESTRATION_PAUSED: 'ORCHESTRATION_PAUSED', // Orchestration paused by user
    ORCHESTRATION_RESUMED: 'ORCHESTRATION_RESUMED', // Orchestration resumed after pause

    // ---- SYSTEM (Server / Process) ----
    SERVER_READY: 'SERVER_READY', // Server process ready (published via NERV)

    // ---- ACK / TRANSPORT ----
    ACK_RECEIVED: 'ACK_RECEIVED', // Transport-level acknowledgment received

    // ---- ITERATION (Iterative Execution) ----
    ITERATION_STARTED: 'ITERATION_STARTED', // Iteration attempt started
    ITERATION_COMPLETED: 'ITERATION_COMPLETED', // Iteration completed successfully
    ITERATION_FAILED: 'ITERATION_FAILED', // Iteration failed
    ITERATION_MAX_REACHED: 'ITERATION_MAX_REACHED', // Max iterations reached without success

    // ---- WORKFLOW (Multi-Step Workflows) ----
    WORKFLOW_STARTED: 'WORKFLOW_STARTED', // Workflow execution started
    WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED', // Workflow completed successfully
    WORKFLOW_FAILED: 'WORKFLOW_FAILED', // Workflow failed
    WORKFLOW_STEP_STARTED: 'WORKFLOW_STEP_STARTED', // Workflow step started
    WORKFLOW_STEP_COMPLETED: 'WORKFLOW_STEP_COMPLETED', // Workflow step completed
    WORKFLOW_STEP_FAILED: 'WORKFLOW_STEP_FAILED', // Workflow step failed
    WORKFLOW_STEP_RETRY: 'WORKFLOW_STEP_RETRY', // Workflow step retry triggered

    // ---- VALIDATION (Output Validation) ----
    VALIDATION_STARTED: 'VALIDATION_STARTED', // Validation process started
    VALIDATION_COMPLETED: 'VALIDATION_COMPLETED', // Validation completed
    VALIDATION_FAILED: 'VALIDATION_FAILED', // Validation failed (technical error)
    VALIDATION_PASSED: 'VALIDATION_PASSED', // Validation passed (score >= threshold)
    VALIDATION_SCORE_LOW: 'VALIDATION_SCORE_LOW', // Validation score below threshold

    // ---- CONTEXT (Context Management) ----
    CONTEXT_INITIALIZED: 'CONTEXT_INITIALIZED', // Context initialized for workflow
    CONTEXT_OVERFLOW: 'CONTEXT_OVERFLOW', // Context exceeded limits, triggering chunking/summarization
    CONTEXT_SUMMARIZED: 'CONTEXT_SUMMARIZED', // Context summarized to reduce size
    CONTEXT_CLEARED: 'CONTEXT_CLEARED', // Context cleared (workflow completed)
    CONTEXT_PATTERN_ADDED: 'CONTEXT_PATTERN_ADDED', // Pattern added to memory store

    // ---- CHECKPOINT (Checkpoint Recovery) ----
    CHECKPOINT_SAVED: 'CHECKPOINT_SAVED', // Checkpoint saved for mission
    CHECKPOINT_LOADED: 'CHECKPOINT_LOADED', // Checkpoint loaded for recovery
    CHECKPOINT_DELETED: 'CHECKPOINT_DELETED', // Checkpoint deleted
    CHECKPOINT_RECOVERY_STARTED: 'CHECKPOINT_RECOVERY_STARTED', // Crash recovery started
    CHECKPOINT_RECOVERY_COMPLETED: 'CHECKPOINT_RECOVERY_COMPLETED', // Crash recovery completed

    // ---- FEEDBACK (User Feedback) ----
    FEEDBACK_RECEIVED: 'FEEDBACK_RECEIVED', // User feedback received
    FEEDBACK_PROCESSED: 'FEEDBACK_PROCESSED', // Feedback processed and categorized
    FEEDBACK_INJECTED: 'FEEDBACK_INJECTED', // Feedback injected into task prompt

    // ---- MISSION (Mission Management) ----
    MISSION_CREATED: 'MISSION_CREATED', // Mission created
    MISSION_STARTED: 'MISSION_STARTED', // Mission execution started
    MISSION_COMPLETED: 'MISSION_COMPLETED', // Mission completed successfully
    MISSION_FAILED: 'MISSION_FAILED', // Mission failed
    MISSION_PAUSED: 'MISSION_PAUSED', // Mission paused
    MISSION_RESUMED: 'MISSION_RESUMED', // Mission resumed
    MISSION_CANCELLED: 'MISSION_CANCELLED', // Mission cancelled by user
});

/**
 * ## ACTOR ROLE
 *
 * Define QUEM emite a mensagem. Não define soberania. Não define decisão.
 */
const ActorRole = Object.freeze({
    KERNEL: 'KERNEL',
    SERVER: 'SERVER',
    INFRA: 'INFRA',
    OBSERVER: 'OBSERVER',
    MAESTRO: 'MAESTRO', // Policy Engine (decision maker)
    DRIVER: 'DRIVER', // Driver adapters (ChatGPT/Gemini)
});

/**
 * ## CHANNEL STATE (TECHNICAL)
 *
 * Estados técnicos do cliente IPC. Não possuem semântica de mundo.
 */
const ChannelState = Object.freeze({
    INACTIVE: 'INACTIVE',
    HANDSHAKE: 'HANDSHAKE',
    ACTIVE: 'ACTIVE',
    DEGRADED: 'DEGRADED',
    SILENT: 'SILENT',
});

/**
 * ## TECHNICAL CODE (DIAGNOSTIC)
 *
 * Códigos auxiliares puramente técnicos. Nunca utilizados para decisão de negócio.
 */
const TechnicalCode = Object.freeze({
    BUFFERED: 'BUFFERED',
    REPLAYED: 'REPLAYED',
    DELIVERED: 'DELIVERED',
    DROPPED: 'DROPPED',
    HANDSHAKE_FAILED: 'HANDSHAKE_FAILED',
});

/**
 * ## ORCHESTRATION ACTION (DECISION)
 *
 * Decisões internas do orchestrator loop após execução de uma task.
 * Conjunto fechado. Representa a próxima ação sobre a task/workflow.
 */
const OrchestrationAction = Object.freeze({
    /** Reexecutar a task com feedback injetado */
    RETRY: 'RETRY',
    /** Criar nova task para o próximo passo do workflow */
    NEXT_STEP: 'NEXT_STEP',
    /** Finalizar — task/workflow concluído */
    DONE: 'DONE',
});

/**
 * ## TASK CONTROL COMMAND (HTTP API)
 *
 * Comandos de controle de tasks via HTTP API.
 * Extensivel apenas por adição explícita (requer atualizar task_control_service).
 */
const TaskControlCommand = Object.freeze({
    PAUSE: 'PAUSE',
    RESUME: 'RESUME',
    UNBLOCK: 'UNBLOCK', // Alias semântico de RESUME
    RETRY: 'RETRY',
    CANCEL: 'CANCEL',
    PATCH: 'PATCH',
    APPROVE: 'APPROVE',
    REJECT: 'REJECT',
    SET_STAGE: 'SET_STAGE',
    SET_TARGET: 'SET_TARGET',
    SET_PRIORITY: 'SET_PRIORITY',
    SET_EXECUTE_AFTER: 'SET_EXECUTE_AFTER',
    SET_DEPENDENCIES: 'SET_DEPENDENCIES',
    REASSIGN_MISSION: 'REASSIGN_MISSION',
});

export {
    ActionCode,
    ActorRole,
    ChannelState,
    MessageType,
    OrchestrationAction,
    PROTOCOL_VERSION,
    TaskControlCommand,
    TechnicalCode,
};
