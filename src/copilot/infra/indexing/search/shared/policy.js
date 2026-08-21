// @ts-check
/** Search budget and validated target-path policy. */

import { hasNullByte, resolveIoSearchBudget } from '#copilot/infra/internal/policy';

/** @type {ReturnType<typeof resolveIoSearchBudget> | null} */
let _ioSearchBudget = null;

/**
 * @returns {ReturnType<typeof resolveIoSearchBudget>}
 */
export function getIoSearchBudget() {
    return (_ioSearchBudget ??= resolveIoSearchBudget());
}

/**
 * @param {unknown} targetPath
 * @returns {asserts targetPath is string}
 */
export function assertValidTargetPath(targetPath) {
    if (typeof targetPath !== 'string' || hasNullByte(targetPath)) {
        const error = /** @type {TypeError & { code?: string }} */ (
            new TypeError(`Path inválido: ${String(targetPath)}`)
        );
        error.code = 'ERR_INVALID_ARG_VALUE';
        throw error;
    }
}
