/**
 * Browser and connection-related constants
 * Centralized definitions for browser pool, connection modes, and orchestration
 *
 * Audit Level: 35 - Core Constants
 * @module constants/browser
 */

/**
 * Connection mode types for browser orchestration
 * Defines how the system connects to and manages browser instances
 * @readonly
 * @enum {string}
 */
const CONNECTION_MODES = {
    /** Hybrid mode - combines launcher and external capabilities */
    HYBRID: 'hybrid',

    /** Local mode - uses local browser instance */
    LOCAL: 'local',

    /** Auto mode - automatically selects best connection strategy */
    AUTO: 'auto',

    /** Launcher mode - launches new browser instances */
    LAUNCHER: 'launcher',

    /** Remote mode - connects to remote browser */
    REMOTE: 'remote',

    /** Singularity mode - single shared browser instance */
    SINGULARITY: 'singularity'
};

/**
 * Browser pool states
 * Represents the current state of browser instances in the pool
 * @readonly
 * @enum {string}
 */
const BROWSER_STATES = {
    /** Browser is healthy and operational */
    HEALTHY: 'HEALTHY',

    /** Browser is in unhealthy state */
    UNHEALTHY: 'UNHEALTHY',

    /** Browser has crashed */
    CRASHED: 'CRASHED',

    /** Browser is idle and available */
    IDLE: 'IDLE'
};

/**
 * Array of all valid connection modes (for validation)
 * @type {ReadonlyArray<string>}
 */
const CONNECTION_MODES_ARRAY = Object.values(CONNECTION_MODES);

/**
 * Array of all valid browser states (for validation)
 * @type {ReadonlyArray<string>}
 */
const BROWSER_STATES_ARRAY = Object.values(BROWSER_STATES);

/**
 * Connection modes frozen object (immutable)
 */
Object.freeze(CONNECTION_MODES);

/**
 * Browser states frozen object (immutable)
 */
Object.freeze(BROWSER_STATES);

module.exports = {
    CONNECTION_MODES,
    BROWSER_STATES,
    CONNECTION_MODES_ARRAY,
    BROWSER_STATES_ARRAY
};
