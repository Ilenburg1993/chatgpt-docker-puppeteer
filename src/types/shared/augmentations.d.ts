/**
 * Shared Utilities - Module Augmentations
 *
 * Declara tipos para utilitários compartilhados entre módulos.
 */

// ============================================================
// Execution Context Filler
// ============================================================

declare module '#shared/utils/execution_context_filler' {
    export interface ExecutionContext {
        driver: {
            type: string;
            version: string;
            connection_mode: string;
            browser_pool_health: string;
        };
        environment: {
            platform: NodeJS.Platform;
            node_version: string;
            container: boolean;
            chrome_version: string;
        };
        retry: {
            tactical_attempts: number;
            strategic_attempts: number;
            errors_recovered: string[];
            total_backoff_ms: number;
        };
    }

    export interface ExecutionContextTask {
        meta: { id: string; [key: string]: unknown };
        execution?: Partial<ExecutionContext>;
        [key: string]: unknown;
    }

    export interface FillExecutionContextOptions {
        driver?: { name?: string; version?: string; connectionMode?: string };
        browserPool?: {
            getHealth?: () => string;
            browser?: { version?: () => Promise<string> };
        };
        tacticalAttempts?: number;
        strategicAttempts?: number;
        errorsRecovered?: string[];
        totalBackoffMs?: number;
    }

    export function fillExecutionContext<TTask extends ExecutionContextTask>(
        task: TTask,
        options?: FillExecutionContextOptions,
    ): Promise<TTask & { execution: ExecutionContext }>;
    export function incrementTacticalAttempts(
        task: ExecutionContextTask,
        errorRecovered?: string,
        backoffMs?: number,
    ): void;
    export function incrementStrategicAttempts(
        task: ExecutionContextTask,
        errorRecovered?: string,
        backoffMs?: number,
    ): void;
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

    export function waitForStability(
        driverOrPage: unknown,
        timeoutMs?: number,
        signal?: AbortSignal | null,
    ): Promise<{
        success?: boolean;
        timeout?: boolean;
        duration?: number;
        phasesFailed?: string[];
        finalLag?: number;
        [key: string]: unknown;
    }>;
    export function checkPageStability(page: unknown): Promise<boolean>;
    export function getPageLoadStatus(page: unknown, retries?: number): Promise<boolean>;
    export function measureEventLoopLag(page: unknown, retries?: number): Promise<number>;
    export const STABILIZER_CONFIG: Record<string, unknown>;
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

    export function humanType(
        driver: unknown,
        selector: string,
        text: string,
        opts?: HumanOptions & { profile?: string; signal?: AbortSignal | null },
    ): Promise<boolean>;
    export function humanType(
        page: unknown,
        ctx: unknown,
        selector: string,
        text: string,
        currentLag?: number,
        signal?: AbortSignal | null,
        onPulse?: ((payload: unknown) => void) | null,
        profile?: string,
    ): Promise<boolean>;
    export function humanClick(
        driver: unknown,
        selector: string,
        opts?: HumanOptions & { signal?: AbortSignal | null },
    ): Promise<boolean>;
    export function humanClick(
        page: unknown,
        ctx: unknown,
        selector: string,
        offsetX?: number,
        offsetY?: number,
        signal?: AbortSignal | null,
        onPulse?: ((payload: unknown) => void) | null,
    ): Promise<boolean>;
    export function wakeUpMove(page: unknown): Promise<void>;
    export function gaussian(mean?: number, stdev?: number): number;
    export const HUMAN_CONFIG: Record<string, unknown>;

    export function simulateHumanTyping(element: unknown, text: string, options?: HumanOptions): Promise<void>;
    export function simulateHumanClick(element: unknown, options?: HumanOptions): Promise<void>;
    export function simulateHumanScroll(page: unknown, options?: HumanOptions): Promise<void>;
}
