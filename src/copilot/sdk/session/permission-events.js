// @ts-check
/**
 * Normalização canônica de eventos de permission (`permission.requested` / `permission.completed`).
 *
 * @module copilot/sdk/session/permission-events
 */

import { PERMISSION_COMPLETED_KINDS, PERMISSION_RESULTS } from '../constants.js';

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function objectOrEmpty(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(value, fallback) {
    return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function boolOrNull(value) {
    return typeof value === 'boolean' ? value : null;
}

/**
 * @param {string | null | undefined} kind
 * @param {boolean | null | undefined} granted
 * @returns {'approved' | 'denied' | 'unknown'}
 */
export function classifyPermissionDecision(kind, granted) {
    if (kind === PERMISSION_RESULTS.APPROVE_ONCE) return 'approved';
    if (kind === PERMISSION_RESULTS.APPROVE_FOR_SESSION) return 'approved';
    if (kind === PERMISSION_RESULTS.APPROVE_FOR_LOCATION) return 'approved';
    if (kind === PERMISSION_COMPLETED_KINDS.APPROVED) return 'approved';
    if (kind === PERMISSION_COMPLETED_KINDS.APPROVED_FOR_SESSION) return 'approved';
    if (kind === PERMISSION_COMPLETED_KINDS.APPROVED_FOR_LOCATION) return 'approved';

    if (kind === PERMISSION_RESULTS.REJECT) return 'denied';
    if (kind === PERMISSION_RESULTS.USER_NOT_AVAILABLE) return 'denied';
    if (kind === PERMISSION_RESULTS.NO_RESULT) return 'denied';
    if (kind === PERMISSION_COMPLETED_KINDS.DENIED_BY_RULES) return 'denied';
    if (kind === PERMISSION_COMPLETED_KINDS.DENIED_BY_CONTENT_EXCLUSION_POLICY) return 'denied';
    if (kind === PERMISSION_COMPLETED_KINDS.DENIED_BY_PERMISSION_REQUEST_HOOK) return 'denied';
    if (kind === PERMISSION_COMPLETED_KINDS.DENIED_INTERACTIVELY_BY_USER) return 'denied';
    if (kind === PERMISSION_COMPLETED_KINDS.DENIED_NO_APPROVAL_RULE_AND_COULD_NOT_REQUEST_FROM_USER) return 'denied';

    if (granted === true) return 'approved';
    if (granted === false) return 'denied';
    return 'unknown';
}

/**
 * @param {unknown} eventOrData
 * @returns {{
 *     requestId: string | null;
 *     permissionType: string;
 *     runtimeId: string | null;
 *     data: Record<string, unknown>;
 *     ts: number;
 * }}
 */
export function normalizePermissionRequestedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);
    const requestId = stringOr(data['requestId'], '') || stringOr(root['requestId'], '') || null;
    const permissionType =
        stringOr(data['permissionType'], '') ||
        stringOr(data['type'], '') ||
        stringOr(root['permissionType'], '') ||
        stringOr(root['type'], 'unknown');
    const runtimeId =
        stringOr(root['runtimeId'], '') ||
        stringOr(root['sourceRuntime'], '') ||
        stringOr(data['runtimeId'], '') ||
        stringOr(data['sourceRuntime'], '') ||
        null;
    const ts =
        typeof root['timestamp'] === 'number'
            ? root['timestamp']
            : typeof root['ts'] === 'number'
              ? root['ts']
              : Date.now();
    return {
        requestId,
        permissionType,
        runtimeId,
        data: Object.keys(data).length > 0 ? data : root,
        ts,
    };
}

/**
 * @param {unknown} eventOrData
 * @returns {{
 *     requestId: string | null;
 *     permissionType: string;
 *     runtimeId: string | null;
 *     resultKind: string | null;
 *     granted: boolean | null;
 *     decision: 'approved' | 'denied' | 'unknown';
 *     data: Record<string, unknown>;
 *     ts: number;
 * }}
 */
export function normalizePermissionCompletedEvent(eventOrData) {
    const root = objectOrEmpty(eventOrData);
    const data = objectOrEmpty(root['data']);
    const requestId = stringOr(root['requestId'], '') || stringOr(data['requestId'], '') || null;
    const permissionType =
        stringOr(root['permissionType'], '') ||
        stringOr(data['permissionType'], '') ||
        stringOr(root['type'], '') ||
        stringOr(data['type'], 'unknown');
    const runtimeId =
        stringOr(root['runtimeId'], '') ||
        stringOr(root['sourceRuntime'], '') ||
        stringOr(data['runtimeId'], '') ||
        stringOr(data['sourceRuntime'], '') ||
        null;
    const resultKind = stringOr(root['result'], '') || stringOr(data['result'], '') || null;
    const granted =
        boolOrNull(root['granted']) ??
        boolOrNull(root['approved']) ??
        boolOrNull(data['granted']) ??
        boolOrNull(data['approved']);
    const decision = classifyPermissionDecision(resultKind, granted);
    const ts =
        typeof root['timestamp'] === 'number'
            ? root['timestamp']
            : typeof root['ts'] === 'number'
              ? root['ts']
              : Date.now();
    return {
        requestId,
        permissionType,
        runtimeId,
        resultKind,
        granted,
        decision,
        data: Object.keys(data).length > 0 ? data : root,
        ts,
    };
}
