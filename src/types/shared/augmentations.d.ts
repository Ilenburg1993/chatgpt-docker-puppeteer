/**
 * Shared Utilities - Module Augmentations
 *
 * Declara tipos para utilitários compartilhados entre módulos.
 */

// ============================================================
// Execution Context Filler
// ============================================================

declare module '#shared/utils/execution_context_filler' {
  export function fillExecutionContext(context: unknown, data: unknown): Promise<string>;
  export function prepareContext(context: unknown): Promise<unknown>;
}

// ============================================================
// Page Stability
// ============================================================

declare module '#shared/page_stability/stabilizer' {
  export interface StabilityOptions {
    timeout?: number;
    checkInterval?: number;
    [key: string]: unknown;
  }

  export function waitForStability(page: unknown, options?: StabilityOptions): Promise<void>;
  export function checkPageStability(page: unknown): Promise<boolean>;
}

// ============================================================
// Biomechanics (Human-like interactions)
// ============================================================

declare module '#shared/biomechanics/human' {
  export interface HumanOptions {
    variability?: number;
    speed?: number;
    [key: string]: unknown;
  }

  export function simulateHumanTyping(element: unknown, text: string, options?: HumanOptions): Promise<void>;
  export function simulateHumanClick(element: unknown, options?: HumanOptions): Promise<void>;
  export function simulateHumanScroll(page: unknown, options?: HumanOptions): Promise<void>;
}
