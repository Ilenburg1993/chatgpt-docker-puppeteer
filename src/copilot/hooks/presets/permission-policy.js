// @ts-check
/**
 * Policy helper compartilhado para presets de hooks.
 *
 * Consolida a decisão por nome de tool para evitar drift entre `onPreToolUse` e `onPermissionRequest`.
 *
 * @module copilot/hooks/presets/permission-policy
 */

import { createPermissionHandler } from '#copilot/sdk/session';
import { log } from '../logger.js';

/** @typedef {'allow' | 'deny' | 'ask'} ToolDecision */

/**
 * @param {string[] | undefined} names
 * @returns {Set<string>}
 */
function normalizeNameSet(names) {
    return new Set((names ?? []).map((name) => String(name).trim().toLowerCase()).filter(Boolean));
}

/**
 * @typedef {{
 *     allowTools?: string[];
 *     denyTools?: string[];
 *     askTools?: string[];
 *     defaultDecision?: ToolDecision;
 *     enforceAllowListWhenPresent?: boolean;
 *     label?: string;
 *     auditLog?: boolean;
 *     askFallbackInPermissionRequest?: 'allow' | 'deny';
 * }} ToolPermissionPolicyOptions
 */

/**
 * @param {ToolPermissionPolicyOptions} [opts]
 */
export function createToolPermissionPolicy(opts = {}) {
    const allow = normalizeNameSet(opts.allowTools);
    const deny = normalizeNameSet(opts.denyTools);
    const ask = normalizeNameSet(opts.askTools);
    const defaultDecision = opts.defaultDecision ?? 'allow';
    const enforceAllowListWhenPresent = opts.enforceAllowListWhenPresent === true;
    const askFallbackInPermissionRequest = opts.askFallbackInPermissionRequest ?? 'deny';
    const label = opts.label ?? 'permission-policy';
    const auditLog = opts.auditLog === true;

    /**
     * @param {string} toolName
     * @returns {ToolDecision}
     */
    function decide(toolName) {
        const normalized = String(toolName ?? '')
            .trim()
            .toLowerCase();
        if (!normalized) return defaultDecision;
        if (deny.has(normalized)) return 'deny';
        if (allow.has(normalized)) return 'allow';
        if (ask.has(normalized)) return 'ask';
        if (enforceAllowListWhenPresent && allow.size > 0) return 'ask';
        return defaultDecision;
    }

    const onPermissionRequest = createPermissionHandler({
        onRequest: (request) => {
            const name =
                /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request)?.toolName ??
                /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request)?.tool ??
                /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request)?.name ??
                'unknown';
            const decision = decide(name);
            if (auditLog) {
                log('DEBUG', `[${label}] onPermissionRequest: tool='${name}' decision='${decision}'`);
            }
            if (decision === 'allow') return true;
            if (decision === 'deny') return false;
            return askFallbackInPermissionRequest === 'allow';
        },
    });

    return {
        decide,
        onPermissionRequest,
    };
}
