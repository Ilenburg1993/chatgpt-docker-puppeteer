/**
 * Logging categories constants
 * Centralized definitions for logger categories throughout the application
 *
 * Audit Level: 35 - Core Constants
 * @module constants/logging
 */

/**
 * Logger category identifiers
 * Used for categorizing log messages throughout the application
 * @readonly
 * @enum {string}
 */
const LOG_CATEGORIES = {
    // ===== HIGH-FREQUENCY CATEGORIES (10+ uses) =====
    /** Application boot sequence */
    BOOT: 'BOOT',

    /** Component lifecycle events */
    LIFECYCLE: 'LIFECYCLE',

    /** Driver version 500 operations */
    V500: 'V500',

    /** Connection orchestrator operations */
    ORCH: 'ORCH',

    /** Driver factory operations */
    FACTORY: 'FACTORY',

    // ===== MEDIUM-FREQUENCY CATEGORIES (5-9 uses) =====
    /** Application shutdown sequence */
    SHUTDOWN: 'SHUTDOWN',

    /** Task API operations */
    API_TASKS: 'API_TASKS',

    /** Policy engine operations */
    POLICY: 'POLICY',

    /** Driver version 700 operations */
    V700: 'V700',

    /** Driver version 800 operations */
    V800: 'V800',

    /** Recovery system operations */
    RECOVERY: 'RECOVERY',

    /** PM2 bridge operations */
    PM2_BRIDGE: 'PM2_BRIDGE',

    /** State reconciliation operations */
    RECONCILER: 'RECONCILER',

    /** System API operations */
    API_SYSTEM: 'API_SYSTEM',

    /** Log tail streaming */
    LOG_TAIL: 'LOG_TAIL',

    /** Filesystem watcher operations */
    FS_WATCHER: 'FS_WATCHER',

    /** Task queue loader */
    LOADER: 'LOADER',

    /** DNA storage operations */
    DNA_STORE: 'DNA_STORE',

    /** Signal handling */
    SIGNAL: 'SIGNAL',

    /** Log file watcher */
    LOG_WATCHER: 'LOG_WATCHER',

    // ===== STANDARD CATEGORIES (2-4 uses) =====
    /** Configuration operations */
    CONFIG: 'CONFIG',

    /** Forensics/crash analysis */
    FORENSICS: 'FORENSICS',

    /** Identity management */
    IDENTITY: 'IDENTITY',

    /** Frame navigation operations */
    FRAME_NAV: 'FRAME_NAV',

    /** Handle management */
    HANDLES: 'HANDLES',

    /** Form submission operations */
    SUBMISSION: 'SUBMISSION',

    /** System-level operations */
    SYSTEM: 'SYSTEM',

    /** Adaptive logic */
    ADAPTIVE: 'ADAPTIVE',

    /** Validation operations */
    VALIDATOR: 'VALIDATOR',

    /** Crash handling */
    CRASH: 'CRASH',

    /** DNA API operations */
    API_DNA: 'API_DNA',

    /** Server engine operations */
    ENGINE: 'ENGINE',

    /** Hardware telemetry */
    TELEMETRY_HW: 'TELEMETRY_HW',

    /** Transport layer operations */
    TRANSPORT: 'TRANSPORT',

    /** Driver version 510 operations */
    V510: 'V510',

    /** Logger internal operations */
    LOGGER: 'LOGGER',

    /** Task healer operations */
    HEALER: 'HEALER',

    /** Base driver operations */
    DRIVER: 'DRIVER',

    /** Target-specific driver operations */
    TARGET_DRIVER: 'TARGET_DRIVER',

    /** Driver version 730 operations */
    V730: 'V730',

    /** Buffer operations */
    BUFFER: 'BUFFER',

    /** Cache operations */
    CACHE: 'CACHE',

    /** Optimization operations */
    OPTIMIZATION: 'OPTIMIZATION',

    /** Task storage operations */
    TASK_STORE: 'TASK_STORE',

    /** Main process operations */
    MAIN: 'MAIN',

    /** Backpressure management */
    BACKPRESSURE: 'BACKPRESSURE',

    /** API gateway operations */
    GATEWAY: 'GATEWAY',

    /** Schema validation guard */
    GUARD: 'GUARD',

    /** Remediation operations */
    REMEDIATION: 'REMEDIATION'
};

/**
 * Array of all valid log categories (for validation)
 * @type {ReadonlyArray<string>}
 */
const LOG_CATEGORIES_ARRAY = Object.values(LOG_CATEGORIES);

/**
 * Log categories frozen object (immutable)
 */
Object.freeze(LOG_CATEGORIES);

module.exports = {
    LOG_CATEGORIES,
    LOG_CATEGORIES_ARRAY
};
