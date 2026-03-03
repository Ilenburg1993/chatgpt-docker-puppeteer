// @ts-check
/**
 * Helper utilities for kernel integration tests
 * TODO: Implement actual test helpers
  * @returns {any}
 */

export function createMockKernel() {
    return {};
}

/**
 * Função exportada: sleep.
 * @returns {any}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
