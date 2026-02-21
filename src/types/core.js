/**
 * @fileoverview Core Type Definitions for JSDoc / TypeScript checking.
 * Centralizing types to reduce use of @type {any} across the codebase.
 */

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
 * @typedef {Object} BrowserPoolInstance
 * @property {Function} allocate - Allocates a page.
 * @property {Function} release - Releases a page.
 * @property {Object} circuitBreaker - Fault detection manager.
 * @property {Object} stats - Global usage statistics.
 */

/**
 * @typedef {Object} TaskV5
 * @property {Object} meta - Task metadata.
 * @property {string} meta.id - Unique Task ID.
 * @property {Object} spec - Task specification / requirements.
 * @property {string} spec.target - IA Target (chatgpt, etc).
 * @property {Object} [state] - Current runtime state.
 */

export {};
