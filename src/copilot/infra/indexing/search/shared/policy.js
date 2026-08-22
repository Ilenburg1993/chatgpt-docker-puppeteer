// @ts-check
/** Search budget and validated target-path policy. */

import { getActiveIoSearchBudget, hasNullByte } from '#copilot/infra/internal/policy';

/**
 * Stateless search services consume the process generation's resolved default; no first search can capture env.
 * @returns {ReturnType<typeof getActiveIoSearchBudget>}
 */
export function getIoSearchBudget() {
    return getActiveIoSearchBudget();
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
