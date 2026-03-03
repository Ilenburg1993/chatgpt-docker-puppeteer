// @ts-check
/**
 * Helper utilities for kernel integration tests
 * TODO: Implement actual test helpers
  * @returns {object}
 */

export function createMockKernel() {
    return {};
}

/**
 * Função exportada: sleep.
 * @param {number} ms
 * @returns {object}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
