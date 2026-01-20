/**
 * Task-related constants
 * Centralized definitions for task states and status values
 *
 * Audit Level: 35 - Core Constants
 * @module constants/tasks
 */

/**
 * Task lifecycle states
 * @readonly
 * @enum {string}
 */
const TASK_STATES = {
    /** Task is actively being executed */
    ACTIVE: 'ACTIVE',

    /** Task has been created but not yet started */
    CREATED: 'CREATED',

    /** Task connection was lost */
    DISCONNECTED: 'DISCONNECTED',

    /** Task execution has been suspended */
    SUSPENDED: 'SUSPENDED'
};

/**
 * Task execution status values
 * @readonly
 * @enum {string}
 */
const STATUS_VALUES = {
    /** Task is waiting to be executed */
    PENDING: 'PENDING',

    /** Task is currently running */
    RUNNING: 'RUNNING',

    /** Task/component is in healthy state */
    HEALTHY: 'HEALTHY',

    /** Task execution failed */
    FAILED: 'FAILED',

    /** Task/component is idle */
    IDLE: 'IDLE',

    /** Task completed successfully */
    SUCCESS: 'SUCCESS',

    /** Task was accepted for processing */
    ACCEPTED: 'ACCEPTED',

    /** Task was rejected */
    REJECTED: 'REJECTED',

    /** Task/component is in unhealthy state */
    UNHEALTHY: 'UNHEALTHY',

    /** Task/component has crashed */
    CRASHED: 'CRASHED',

    /** Task was skipped */
    SKIPPED: 'SKIPPED'
};

/**
 * Array of all valid task states (for validation)
 * @type {ReadonlyArray<string>}
 */
const TASK_STATES_ARRAY = Object.values(TASK_STATES);

/**
 * Array of all valid status values (for validation)
 * @type {ReadonlyArray<string>}
 */
const STATUS_VALUES_ARRAY = Object.values(STATUS_VALUES);

/**
 * Task states frozen object (immutable)
 */
Object.freeze(TASK_STATES);

/**
 * Status values frozen object (immutable)
 */
Object.freeze(STATUS_VALUES);

module.exports = {
    TASK_STATES,
    STATUS_VALUES,
    TASK_STATES_ARRAY,
    STATUS_VALUES_ARRAY
};
