// @ts-check
/**
 * Core Type Definitions Centralized type definitions for the entire project Use these types across all modules for
 * consistency
 *
 * @module types/core
 * @version 1.0.0
 */

/**
 * Result wrapper for operations that can succeed or fail
 *
 * @template T - The type of the success data
 */
export interface Result<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Pagination parameters for list queries
 *
 * @typedef {Object} PaginationParams
 * @property {number} page - Page number (0-indexed)
 * @property {number} pageSize - Items per page
 * @property {string} [sortBy] - Sort field
 * @property {'asc' | 'desc'} [sortOrder] - Sort direction
 */
export interface PaginationParams {
    page: number;
    pageSize: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

/**
 * Connection mode types for browser orchestration
 *
 * @typedef {'HYBRID' | 'LOCAL' | 'AUTO' | 'LAUNCHER' | 'REMOTE' | 'SINGULARITY'} ConnectionMode
 */

/**
 * Browser pool states
 *
 * @typedef {'HEALTHY' | 'UNHEALTHY' | 'CRASHED' | 'IDLE'} BrowserState
 */

/**
 * Driver domain states
 *
 * @typedef {'INITIALIZATION' | 'UNKNOWN_CONTEXT' | 'MAIN_PAGE' | 'IFRAME' | 'POPUP'} DriverDomain
 */

/**
 * Task execution status
 *
 * @typedef {'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SUSPENDED' | 'TERMINATED'} TaskStatus
 */

/**
 * Modifier keys for keyboard shortcuts
 *
 * @typedef {'CONTROL' | 'META' | 'SHIFT' | 'ALT'} ModifierKey
 */

/**
 * Base configuration interface
 *
 * @typedef {Object} BaseConfig
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {number} createdAt - Creation timestamp
 * @property {number} [updatedAt] - Last update timestamp
 */

/**
 * Configuration object for browser pool
 *
 * @typedef {Object} BrowserPoolConfig
 * @property {number} maxSize - Maximum number of browsers
 * @property {number} minSize - Minimum number of browsers
 * @property {number} idleTimeout - Idle timeout in ms
 * @property {ConnectionMode} mode - Connection mode
 */

/**
 * Task execution result
 *
 * @typedef {Object} TaskResult
 * @property {string} taskId - Unique task identifier
 * @property {TaskStatus} status - Task status
 * @property {unknown} [data] - Task result data
 * @property {string} [error] - Error message if failed
 * @property {number} [startedAt] - Start timestamp
 * @property {number} [completedAt] - Completion timestamp
 */

/**
 * Driver state representation
 *
 * @typedef {Object} DriverState
 * @property {string} driverId - Driver identifier
 * @property {string} [currentDomain] - Current domain context
 * @property {BrowserState} state - Current state
 * @property {number} createdAt - Creation timestamp
 * @property {number} [lastActivityAt] - Last activity timestamp
 */

/**
 * Connection metadata
 *
 * @typedef {Object} ConnectionInfo
 * @property {string} id - Connection identifier
 * @property {ConnectionMode} mode - Connection mode
 * @property {boolean} isActive - Active status
 * @property {number} connectedAt - Connection timestamp
 * @property {number} [disconnectedAt] - Disconnection timestamp
 */

/**
 * Error with context
 *
 * @typedef {Object} ContextError
 * @property {string} message - Error message
 * @property {string} [code] - Error code
 * @property {unknown} [cause] - Original error
 * @property {Record<string, unknown>} [context] - Additional context
 */

/**
 * Event payload
 *
 * @template T - Event data type
 * @typedef {Object} EventPayload<T>
 * @property {string} type - Event type
 * @property {T} data - Event data
 * @property {number} timestamp - Event timestamp
 * @property {string} [correlationId] - Correlation ID for tracing
 */

/**
 * Retry configuration
 *
 * @typedef {Object} RetryConfig
 * @property {number} maxAttempts - Maximum retry attempts
 * @property {number} initialDelayMs - Initial delay in milliseconds
 * @property {number} maxDelayMs - Maximum delay in milliseconds
 * @property {number} backoffMultiplier - Backoff multiplier
 */

/**
 * Health check result
 *
 * @typedef {Object} HealthCheckResult
 * @property {boolean} healthy - Overall health status
 * @property {string} [message] - Health message
 * @property {Record<string, unknown>} [details] - Additional details
 * @property {number} timestamp - Check timestamp
 */

// Export type aliases for convenience
export type { Result as AsyncResult } from './types';

/**
 * Type guard for checking if a value is a Result
 *
 * @param {unknown} value - Value to check
 * @returns {value is Result<unknown>}
 */
export function isResult(value: unknown): value is { success: boolean; data?: unknown; error?: string };

/**
 * Type guard for checking if a value is a valid ConnectionMode
 *
 * @param {unknown} value - Value to check
 * @returns {boolean}
 */
export function isConnectionMode(value: unknown): boolean;

// ============================================================================
// ADDITIONAL ROBUST TYPES (replacing 'any' with specific types)
// ============================================================================

/**
 * HTTP Request/Response types
 */
export interface HttpRequest {
    body?: Record<string, unknown> | unknown[];
    query?: Record<string, string>;
    params?: Record<string, string>;
    headers?: Record<string, string>;
}

export interface HttpResponse {
    statusCode: number;
    body?: unknown;
    headers?: Record<string, string>;
}

/**
 * Page/Frame types for Puppeteer
 */
export interface PuppeteerPage {
    url(): Promise<string>;
    goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
    evaluate(fn: (...args: unknown[]) => unknown, ...args: unknown[]): Promise<unknown>;
    close(): Promise<void>;
    isClosed(): boolean;
}

export interface PuppeteerFrame {
    url(): Promise<string>;
    evaluate(fn: (...args: unknown[]) => unknown, ...args: unknown[]): Promise<unknown>;
}

/**
 * Protocol types for CDP (Chrome DevTools Protocol)
 */
export interface ProtocolCommand {
    method: string;
    params?: Record<string, unknown>;
    id?: number;
}

export interface ProtocolResponse {
    id: number;
    result?: Record<string, unknown>;
    error?: { code: string; message: string };
}

/**
 * Socket/Event types
 */
export interface SocketData {
    event: string;
    payload: unknown;
    timestamp: number;
}

/**
 * Queue/Worker types
 */
export interface QueueTask {
    id: string;
    type: string;
    payload: unknown;
    status: TaskStatus;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
}

/**
 * Database types
 */
export interface DbRow {
    id: string;
    [key: string]: unknown;
}

export interface DbQueryResult {
    rows: DbRow[];
    rowCount: number;
}

/**
 * Validation types
 */
export interface ValidationError {
    field: string;
    message: string;
    code?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors?: ValidationError[];
}

/**
 * Callback and Promise types
 */
export type Callback<T> = (error: Error | null, result?: T) => void;
export type AsyncCallback<T> = (error: Error | null, result?: T) => Promise<void>;
export type PromiseResolver<T> = (value: T | PromiseLike<T>) => void;
export type PromiseRejecter = (reason?: unknown) => void;

/**
 * Configuration with generic type
 *
 * @template T - Configuration object type
 */
export interface ConfigWithDefaults<T extends Record<string, unknown>> {
    config: T;
    defaults: Partial<T>;
    validate(): ValidationResult;
}

// ============================================================================
// DRIVER & CHATGPT TYPES
// ============================================================================

/**
 * ChatGPT Driver specific types
 */
export interface ChatGPTTaskContext {
    taskId: string;
    targetUrl: string;
    inputSelector?: string;
    sendButtonSelector?: string;
    responseAreaSelector?: string;
}

export interface ChatGPTResponse {
    content: string;
    tokenCount?: number;
    model?: string;
    finishReason?: string;
}

export interface LLMInterfaceValidation {
    hasInput: boolean;
    hasSendButton: boolean;
    hasResponseArea: boolean;
    selectors: {
        input?: string;
        sendButton?: string;
        responseArea?: string;
    };
}

export interface ChatGPTCapabilities {
    supportsVision: boolean;
    supportsStreaming: boolean;
    maxTokens: number;
    supportedModels: string[];
}

/**
 * Biomechanics types
 */
export interface BiomechanicsConfig {
    maxWaitIterations: number;
    keepAliveIntervalMs: number;
    waitPollIntervalMs: number;
    stableRectMaxAttempts: number;
    stableRectTolerancePx: number;
    stableRectPollMs: number;
    stableRectTimeoutMs: number;
    scrollOffsetRatio: number;
    scrollMaxOffsetRatio: number;
    postScrollDelayMs: number;
    zenModeThresholdChars: number;
    zenModeTimeoutMs: number;
    modifierCacheTtlMs: number;
}

export interface BiomechanicsAction {
    type: 'type' | 'click' | 'scroll' | 'clear' | 'wait';
    selector?: string;
    text?: string;
    delay?: number;
}

export interface HumanBehaviorConfig {
    minDelay: number;
    maxDelay: number;
    errorRate: number;
    correctionProbability: number;
}

/**
 * Triage system types
 */
export type TriageErrorType =
    | 'TIMEOUT'
    | 'ABORTED'
    | 'INVALID_PAGE'
    | 'SCAN_FAILED'
    | 'LAG_MEASUREMENT_FAILED'
    | 'NETWORK_ERROR'
    | 'SELECTOR_FAILED'
    | 'UNKNOWN';

export interface TriageResult {
    errorType: TriageErrorType;
    recoverable: boolean;
    suggestedAction?: 'retry' | 'skip' | 'abort';
    context?: Record<string, unknown>;
}

export interface TriageConfig {
    lagThresholdMs: number;
    maxRetries: number;
    timeoutMs: number;
}

/**
 * Extractor types
 */
export interface StructuredExtractorResult {
    data: Record<string, unknown>;
    confidence: number;
    metadata?: {
        extractionTime: number;
        selectorUsed?: string;
    };
}

export interface SelectorCandidate {
    selector: string;
    confidence: number;
    elementCount: number;
    estimatedReliability: number;
}

/**
 * Recovery system types
 */
export type RecoveryTier = 1 | 2 | 3 | 4;

export interface RecoveryContext {
    taskId: string;
    attemptNumber: number;
    error: Error;
    previousRecoveryAttempts: number;
}

export interface RecoveryAction {
    tier: RecoveryTier;
    action: 'retry' | 'reinitialize' | 'fallback' | 'abort';
    parameters?: Record<string, unknown>;
}

/**
 * Guard types
 */
export interface ReadinessPhase {
    name: string;
    timeout: number;
    required: boolean;
}

export interface ReadinessConfig {
    phases: ReadinessPhase[];
    defaultTimeout: number;
    retryOnFailure: boolean;
}

export interface ReadinessResult {
    ready: boolean;
    completedPhases: string[];
    failedPhase?: string;
    error?: Error;
}
