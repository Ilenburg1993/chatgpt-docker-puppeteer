/**
 * Shared system constants Centralized definitions for common values used across multiple modules
 *
 * Audit Level: 40 - Shared Constants
 *
 * @module constants/shared
 */

/**
 * Common status values used throughout the application. These are frozen to prevent accidental modifications.
 *
 * @readonly
 * @enum {string}
 */
const SHARED_STATUS = {
    /** Connection or resource is closed */
    CLOSED: 'CLOSED',

    /** Connection or resource is open */
    OPEN: 'OPEN',

    /** Operation or process is pending */
    PENDING: 'PENDING',

    /** Operation or process is complete */
    DONE: 'DONE',

    /** Operation or process failed */
    FAILED: 'FAILED',

    /** Operation or process succeeded */
    SUCCESS: 'SUCCESS',

    /** Component or resource is active */
    ACTIVE: 'ACTIVE',

    /** Component or resource is inactive */
    INACTIVE: 'INACTIVE',

    /** Component or resource is idle */
    IDLE: 'IDLE',

    /** Component or resource is healthy */
    HEALTHY: 'HEALTHY',

    /** Component or resource is unhealthy */
    UNHEALTHY: 'UNHEALTHY',
};

/**
 * Common timeout values in milliseconds.
 *
 * @readonly
 * @enum {number}
 */
const TIMEOUTS = {
    /** Default short timeout (1 second) */
    SHORT: 1000,

    /** Default medium timeout (5 seconds) */
    MEDIUM: 5000,

    /** Default long timeout (30 seconds) */
    LONG: 30000,

    /** Default extra long timeout (60 seconds) */
    EXTRA_LONG: 60000,

    /** Default very long timeout (5 minutes) */
    VERY_LONG: 300000,
};

/**
 * Common retry configuration values.
 *
 * @readonly
 * @enum {number}
 */
const RETRY_CONFIG = {
    /** Maximum number of retry attempts */
    MAX_ATTEMPTS: 3,

    /** Initial retry delay in milliseconds */
    INITIAL_DELAY_MS: 1000,

    /** Maximum retry delay in milliseconds */
    MAX_DELAY_MS: 30000,

    /** Backoff multiplier */
    BACKOFF_MULTIPLIER: 2,
};

/**
 * Common pagination values.
 *
 * @readonly
 * @enum {number}
 */
const PAGINATION = {
    /** Default page size for lists */
    DEFAULT_PAGE_SIZE: 20,

    /** Maximum page size allowed */
    MAX_PAGE_SIZE: 100,

    /** Default offset for pagination */
    DEFAULT_OFFSET: 0,
};

/**
 * Common character limits.
 *
 * @readonly
 * @enum {number}
 */
const CHAR_LIMITS = {
    /** Small text limit (100 characters) */
    SMALL: 100,

    /** Medium text limit (500 characters) */
    MEDIUM: 500,

    /** Large text limit (2000 characters) */
    LARGE: 2000,

    /** Extra large text limit (10000 characters) */
    EXTRA_LARGE: 10000,
};

/**
 * Driver domain states - used to track the current domain context of browser drivers.
 *
 * @readonly
 * @enum {string}
 */
const DRIVER_DOMAINS = {
    /** Initial driver state before any navigation */
    INITIALIZATION: 'initialization',

    /** Unknown or undefined context */
    UNKNOWN_CONTEXT: 'unknown_context',

    /** Driver is in main page context */
    MAIN_PAGE: 'main_page',

    /** Driver is in iframe context */
    IFRAME: 'iframe',

    /** Driver is in popup context */
    POPUP: 'popup',
};

/**
 * Default counter initial values.
 *
 * @readonly
 * @enum {number}
 */
const COUNTER_DEFAULTS = {
    /** Default initial value for counters */
    INITIAL: 0,

    /** Default minimum value */
    MIN: 0,

    /** Default maximum value for counters */
    MAX_COUNTER: 999999,
};

/**
 * Common error names for custom error classes.
 *
 * @readonly
 * @enum {string}
 */
const ERROR_NAMES = {
    /** Frame navigation error */
    FRAME_NAV_ERROR: 'FrameNavError',

    /** Triage error */
    TRIAGE_ERROR: 'TriageError',

    /** Generic base driver error */
    BASE_DRIVER_ERROR: 'BaseDriverError',

    /** Target driver error */
    TARGET_DRIVER_ERROR: 'TargetDriverError',

    /** ChatGPT driver error */
    CHATGPT_ERROR: 'ChatGPTError',
};

/**
 * Common driver names used across the application.
 *
 * @readonly
 * @enum {string}
 */
const DRIVER_NAMES = {
    /** Base universal driver */
    BASE_UNIVERSAL: 'BaseUniversalDriver',

    /** Generic driver */
    GENERIC: 'Generic',

    /** ChatGPT driver */
    CHATGPT: 'ChatGPT',
};

/**
 * Array of all shared status values
 *
 * @type {ReadonlyArray<string>}
 */
const SHARED_STATUS_ARRAY: ReadonlyArray<string> = Object.values(SHARED_STATUS);

/**
 * Array of all driver domains
 *
 * @type {ReadonlyArray<string>}
 */
const DRIVER_DOMAINS_ARRAY: ReadonlyArray<string> = Object.values(DRIVER_DOMAINS);

/**
 * Frozen objects to prevent accidental modifications
 */
Object.freeze(SHARED_STATUS);
Object.freeze(TIMEOUTS);
Object.freeze(RETRY_CONFIG);
Object.freeze(PAGINATION);
Object.freeze(CHAR_LIMITS);
Object.freeze(DRIVER_DOMAINS);
Object.freeze(COUNTER_DEFAULTS);
Object.freeze(ERROR_NAMES);
Object.freeze(DRIVER_NAMES);

export {
    CHAR_LIMITS,
    COUNTER_DEFAULTS,
    DRIVER_DOMAINS,
    DRIVER_DOMAINS_ARRAY,
    DRIVER_NAMES,
    ERROR_NAMES,
    PAGINATION,
    RETRY_CONFIG,
    SHARED_STATUS,
    SHARED_STATUS_ARRAY,
    TIMEOUTS,
};
