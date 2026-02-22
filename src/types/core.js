// @ts-check - Type checking rigoroso habilitado

/**
 * @fileoverview Core Type Definitions for JSDoc / TypeScript checking.
 * Centralizing types to reduce use of @type {any} across the codebase.
 */

// ============================================================================
// NERV TYPES
// ============================================================================

/**
 * @typedef {Object} NERVInstance
 * @property {Function} emit - Sends an event or command.
 * @property {Function} on - Subscribes to events.
 * @property {Function} onReceive - Subscribes to raw inbound envelopes.
 * @property {Object} buffers - Inbound/Outbound ring buffers.
 * @property {Object} transport - Physical transport layer.
 * @property {Object} health - Health monitoring sub-module.
 */

/**
 * NERV Envelope - Message structure for IPC communication
 * @typedef {Object} Envelope
 * @property {Object} header - Protocol header
 * @property {string} header.version - Protocol version
 * @property {number} header.timestamp - Unix timestamp
 * @property {string} header.source - Actor role
 * @property {Object} ids - Message identifiers
 * @property {string} ids.msg_id - Unique message ID
 * @property {string} [ids.correlation_id] - Correlation ID for tracking
 * @property {string} kind - Action code (e.g., TASK_START)
 * @property {Object} payload - Message payload
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
 * @typedef {Object} BrowserPoolInstance
 * @property {Function} allocate - Allocates a page.
 * @property {Function} release - Releases a page.
 * @property {Object} circuitBreaker - Fault detection manager.
 * @property {Object} stats - Global usage statistics.
 */

/**
 * Pool allocation result
 * @typedef {Object} PoolAllocation
 * @property {Object} page - Puppeteer page instance
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
 * @typedef {Object} TaskV5
 * @property {Object} meta - Task metadata
 * @property {string} meta.id - Unique Task ID
 * @property {string} [meta.version='5.0'] - Schema version
 * @property {string} [meta.mission_id] - Parent mission ID
 * @property {string} [meta.parent_id] - Parent task ID
 * @property {number} [meta.priority] - Task priority (0-100)
 * @property {Object} spec - Task specification
 * @property {string} spec.target - IA Target (chatgpt, gemini, etc)
 * @property {string} [spec.model] - Model to use
 * @property {Object} [spec.payload] - Prompt payload
 * @property {string} [spec.payload.user_message] - User message
 * @property {string} [spec.payload.system_message] - System message
 * @property {Object} [spec.execution] - Execution config
 * @property {Object} [policy] - Task policy
 * @property {string[]} [policy.dependencies] - Task dependencies
 * @property {number} [policy.execute_after] - Execute after timestamp
 * @property {Object} [state] - Runtime state
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
 * @typedef {Object} Mission
 * @property {string} id - Mission ID
 * @property {string} name - Mission name
 * @property {string} status - Mission status
 * @property {Object} config - Mission configuration
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
 * @typedef {Object} IDriver
 * @property {string} name - Driver name
 * @property {string} currentDomain - Current domain
 * @property {Object|null} page - Puppeteer page instance
 * @property {Object|null} signal - AbortSignal
 * @property {Function} execute - Execute prompt
 * @property {Function} destroy - Cleanup resources
 */

/**
 * Driver capabilities
 * @typedef {Object} DriverCapabilities
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
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Success flag
 * @property {Object|null} data - Response data
 * @property {string|null} error - Error message
 * @property {string} [requestId] - Request tracking ID
 */

/**
 * Paginated response
 * @typedef {Object} PaginatedResponse
 * @property {Array} items - Array of items
 * @property {number} total - Total count
 * @property {number} page - Current page
 * @property {number} limit - Items per page
 * @property {boolean} hasMore - Has more pages
 */

/**
 * Express Request with typed body
 * @typedef {Object} TypedRequest
 * @property {Object} params - URL parameters
 * @property {Object} query - Query string
 * @property {Object} body - Request body
 * @property {Object} headers - Request headers
 */

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * System event
 * @typedef {Object} SystemEvent
 * @property {string} type - Event type
 * @property {string} action - Event action
 * @property {Object} payload - Event data
 * @property {string} [timestamp] - Event timestamp
 * @property {string} [correlationId] - Correlation ID
 */

/**
 * Telemetry event
 * @typedef {Object} TelemetryEvent
 * @property {string} name - Event name
 * @property {Object} metrics - Event metrics
 * @property {number} timestamp - Event timestamp
 */

// ============================================================================
// CONFIG TYPES
// ============================================================================

/**
 * System configuration
 * @typedef {Object} SystemConfig
 * @property {number} poolSize - Browser pool size
 * @property {string} allocationStrategy - Pool allocation strategy
 * @property {number} healthCheckInterval - Health check interval (ms)
 * @property {Object} browserEndpoint - Browser connection endpoint
 */

export {};
