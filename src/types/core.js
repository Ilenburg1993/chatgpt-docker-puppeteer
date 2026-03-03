// @ts-check - Type checking rigoroso habilitado

/**
 * @fileoverview Core Type Definitions for JSDoc / TypeScript checking.
 * Centralizing types to reduce use of @type {unknown} across the codebase.
 */

// ============================================================================
// NERV TYPES
// ============================================================================

/**
 * @typedef {object} NERVInstance
 * @property {Function} emit - Sends an event or command.
 * @property {Function} on - Subscribes to events.
 * @property {Function} onReceive - Subscribes to raw inbound envelopes.
 * @property {object} buffers - Inbound/Outbound ring buffers.
 * @property {object} transport - Physical transport layer.
 * @property {object} health - Health monitoring sub-module.
 */

/**
 * NERV Envelope - Message structure for IPC communication
 * @typedef {object} Envelope
 * @property {object} header - Protocol header
 * @property {string} header.version - Protocol version
 * @property {number} header.timestamp - Unix timestamp
 * @property {string} header.source - Actor role
 * @property {object} ids - Message identifiers
 * @property {string} ids.msg_id - Unique message ID
 * @property {string} [ids.correlation_id] - Correlation ID for tracking
 * @property {string} kind - Action code (e.g., TASK_START)
 * @property {object} payload - Message payload
 */

/**
 * Action codes for NERV commands
 * @typedef {string} ActionCode
 */

/**
 * Actor roles in the system
 * @typedef {'SERVER'|'MAESTRO'|'KERNEL'|'DRIVER'|'DASHBOARD'|'MISSION_CONTROL'} ActorRole
 */

/**
 * Message types
 * @typedef {'COMMAND'|'EVENT'|'ACK'|'RESPONSE'} MessageType
 */

// ============================================================================
// BROWSER POOL TYPES
// ============================================================================

/**
 * @typedef {object} BrowserPoolInstance
 * @property {Function} allocate - Allocates a page.
 * @property {Function} release - Releases a page.
 * @property {object} circuitBreaker - Fault detection manager.
 * @property {object} stats - Global usage statistics.
 */

/**
 * Pool allocation result
 * @typedef {object} PoolAllocation
 * @property {object} page - Puppeteer page instance
 * @property {string} poolEntryId - Pool entry identifier
 * @property {string} taskId - Associated task ID
 * @property {number} allocatedAt - Allocation timestamp
 */

/**
 * Health status values
 * @typedef {'HEALTHY'|'UNHEALTHY'|'DEGRADED'|'CRASHED'} HealthStatus
 */

// ============================================================================
// TASK TYPES
// ============================================================================

/**
 * Task V5 - Complete task structure
 * @typedef {object} TaskV5
 * @property {object} meta - Task metadata
 * @property {string} meta.id - Unique Task ID
 * @property {string} [meta.version='5.0'] - Schema version
 * @property {string} [meta.mission_id] - Parent mission ID
 * @property {string} [meta.parent_id] - Parent task ID
 * @property {number} [meta.priority] - Task priority (0-100)
 * @property {object} spec - Task specification
 * @property {string} spec.target - IA Target (chatgpt, gemini, etc)
 * @property {string} [spec.model] - Model to use
 * @property {object} [spec.payload] - Prompt payload
 * @property {string} [spec.payload.user_message] - User message
 * @property {string} [spec.payload.system_message] - System message
 * @property {object} [spec.execution] - Execution config
 * @property {object} [policy] - Task policy
 * @property {string[]} [policy.dependencies] - Task dependencies
 * @property {number} [policy.execute_after] - Execute after timestamp
 * @property {object} [state] - Runtime state
 * @property {string} [state.status] - Current status
 * @property {number} [state.attempts] - Attempt count
 * @property {string} [state.last_error] - Last error message
 */

/**
 * Task status values
 * @typedef {'PENDING'|'RUNNING'|'DONE'|'FAILED'|'CANCELLED'|'PAUSED'} TaskStatus
 */

/**
 * Task stage values
 * @typedef {'DRAFT'|'PROPOSED'|'READY'|'REJECTED'|'ARCHIVED'} TaskStage
 */

// ============================================================================
// MISSION TYPES
// ============================================================================

/**
 * Mission structure
 * @typedef {object} Mission
 * @property {string} id - Mission ID
 * @property {string} name - Mission name
 * @property {string} status - Mission status
 * @property {object} config - Mission configuration
 * @property {string[]} tasks - Task IDs in mission
 * @property {number} created_at - Creation timestamp
 * @property {number} [updated_at] - Last update timestamp
 */

/**
 * Mission status values
 * @typedef {'PENDING'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED'} MissionStatus
 */

// ============================================================================
// DRIVER TYPES
// ============================================================================

/**
 * Driver interface
 * @typedef {object} IDriver
 * @property {string} name - Driver name
 * @property {string} currentDomain - Current domain
 * @property {object|null} page - Puppeteer page instance
 * @property {object|null} signal - AbortSignal
 * @property {Function} execute - Execute prompt
 * @property {Function} destroy - Cleanup resources
 */

/**
 * Driver capabilities
 * @typedef {object} DriverCapabilities
 * @property {boolean} text_generation - Supports text generation
 * @property {boolean} image_generation - Supports image generation
 * @property {boolean} file_upload - Supports file upload
 * @property {boolean} context_reset - Supports context reset
 * @property {boolean} streaming_events - Supports streaming
 * @property {boolean} vision - Supports vision
 * @property {boolean} tools - Supports function calling
 */

// ============================================================================
// API TYPES
// ============================================================================

/**
 * API Response wrapper
 * @typedef {object} ApiResponse
 * @property {boolean} success - Success flag
 * @property {object|null} data - Response data
 * @property {string|null} error - Error message
 * @property {string} [requestId] - Request tracking ID
 */

/**
 * Paginated response
 * @typedef {object} PaginatedResponse
 * @property {Array} items - Array of items
 * @property {number} total - Total count
 * @property {number} page - Current page
 * @property {number} limit - Items per page
 * @property {boolean} hasMore - Has more pages
 */

/**
 * Express Request with typed body
 * @typedef {object} TypedRequest
 * @property {object} params - URL parameters
 * @property {object} query - Query string
 * @property {object} body - Request body
 * @property {object} headers - Request headers
 */

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * System event
 * @typedef {object} SystemEvent
 * @property {string} type - Event type
 * @property {string} action - Event action
 * @property {object} payload - Event data
 * @property {string} [timestamp] - Event timestamp
 * @property {string} [correlationId] - Correlation ID
 */

/**
 * Telemetry event
 * @typedef {object} TelemetryEvent
 * @property {string} name - Event name
 * @property {object} metrics - Event metrics
 * @property {number} timestamp - Event timestamp
 */

// ============================================================================
// CONFIG TYPES
// ============================================================================

/**
 * System configuration
 * @typedef {object} SystemConfig
 * @property {number} poolSize - Browser pool size
 * @property {string} allocationStrategy - Pool allocation strategy
 * @property {number} healthCheckInterval - Health check interval (ms)
 * @property {object} browserEndpoint - Browser connection endpoint
 */

export {};
