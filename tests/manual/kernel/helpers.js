/**
 * Helper utilities for kernel integration tests
 * TODO: Implement actual test helpers
 */

export function createMockKernel() {
    return {};
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
