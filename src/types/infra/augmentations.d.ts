/**
 * Infra System - Module Augmentations
 *
 * Declara tipos para módulos de infraestrutura.
 */

// ============================================================
// IO Module
// ============================================================

declare module '#infra/io' {
    // Task operations
    export function findLast(projectId: string): Promise<unknown>;
    export function findFirstByTag(projectId: string, tag: string): Promise<unknown>;
    export function findLastByTag(projectId: string, tag: string): Promise<unknown>;
    export function findById(id: string): Promise<unknown>;
    export function loadResponse(id: string, signal?: AbortSignal): Promise<string>;
    export function synchronize(): Promise<void>;
    export function loadAllTasks(projectId?: string): Promise<unknown[]>;
    export function getTargetRules(target: string): Promise<unknown>;

    // Identity operations
    export function getIdentity(): Promise<{ robot_id?: string; [key: string]: unknown } | null>;
    export function saveIdentity(identity: unknown): Promise<void>;

    // DNA operations
    export function getDna(): Promise<{
        version?: number;
        evolution_count?: number;
        targets?: Record<string, unknown>;
        selectors?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
        [key: string]: unknown;
    }>;
    export function saveDna(dna: unknown): Promise<void>;
    export function getDnaHistory(): Promise<unknown[]>;
    export function rollbackDna(version: number): Promise<void>;
    export function getEvolutionStats(): Record<string, number>;
    export function evolveWithSadiProtocol(
        protocol: { selector?: string; confidence?: number; [key: string]: unknown },
        domain: string,
        intent: string
    ): Promise<{ accepted: boolean; reason?: string; stats?: unknown; error?: string; [key: string]: unknown }>;

    // Queue operations
    export function getQueue(filter?: unknown): Promise<unknown[]>;
    export function saveTask(task: unknown): Promise<void>;
    export function deleteTask(taskId: string): Promise<void>;
    export function bulkRetryFailed(): Promise<number>;
    export function clearQueue(): Promise<{ deleted: number; preserved: number }>;

    // FileSystem operations
    export function safeReadJSON(filePath: string): Promise<unknown>;
    export function atomicWrite(filePath: string, data: unknown, encoding?: string): Promise<void>;
    export function setCacheDirty(): void;

    // Constants
    export const RESPONSE_DIR: string;
    export const QUEUE_DIR: string;
}

// ============================================================
// SADI Analyzer
// ============================================================

declare module '#shared/sadi/analyzer' {
    export interface SADICandidate {
        selector: string;
        confidence: number;
        score?: number;
        type?: string;
        [key: string]: unknown;
    }

    export interface SADIAnalysisResult {
        inputSelector?: string;
        buttonSelector?: string;
        candidates?: SADICandidate[];
        bestCandidate?: SADICandidate;
        [key: string]: unknown;
    }

    export function analyze(page: unknown, options?: Record<string, unknown>): Promise<SADIAnalysisResult>;
    export function validateCandidateInteractivity(page: unknown, candidate: SADICandidate | unknown): Promise<boolean>;

    export type SADIProtocol = {
        selector: string;
        framePath?: string[];
        context?: string;
        [key: string]: unknown;
    };

    export type SADIDetectionResult = {
        protocol: SADIProtocol;
        confidence: number;
        candidates_count?: number;
        detection_time_ms?: number;
        [key: string]: unknown;
    };

    export function findChatInputSelector(page: unknown, langCode?: string): Promise<SADIDetectionResult | null>;
    export function findInputSelector(page: unknown, langCode?: string): Promise<SADIDetectionResult | null>;
    export function findSendButtonSelector(
        page: unknown,
        inputProtocol?: SADIProtocol | null
    ): Promise<SADIDetectionResult | null>;
    export function findResponseArea(page: unknown, langCode?: string): Promise<SADIDetectionResult | null>;
    export function findFrameByPath(page: unknown, framePath?: string[] | string): Promise<unknown>;
}

// ============================================================
// Connection Orchestrator
// ============================================================

declare module '#infra/ConnectionOrchestrator' {
    export interface ConnectionOptions {
        url?: string;
        wsEndpoint?: string;
        browserWSEndpoint?: string;
        browserEndpoint?: string;
        timeout?: number;
        headless?: boolean;
        webSocketDebuggerUrl?: string;
        [key: string]: unknown;
    }

    export interface ConnectionResult {
        browser: unknown;
        page: unknown;
        wsEndpoint: string;
        success: boolean;
        [key: string]: unknown;
    }

    export class ConnectionOrchestrator {
        connect(options: ConnectionOptions): Promise<ConnectionResult>;
        disconnect(): Promise<void>;
        getStats(): unknown;
        static synchronize(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
        [key: string]: unknown;
    }
    export const STATES: Record<string, string>;
}

// ============================================================
// Browser Pool
// ============================================================

declare module '#infra/browser_pool/circuit_breaker' {
    export type CircuitBreakerState = 'OPEN' | 'CLOSED' | 'HALF_OPEN' | 'CIRCUIT_OPEN' | 'DEGRADED' | 'OPERATIONAL';

    export class CircuitBreaker {
        constructor(options?: { threshold?: number; timeout?: number; resetTimeout?: number });
        execute<T>(fn: () => Promise<T>): Promise<T>;
        getState(): CircuitBreakerState;
        state: CircuitBreakerState;
        [key: string]: unknown;
    }
}

declare module '#infra/browser_pool/puppeteer_guard' {
    export class PuppeteerGuard {
        static ensure(): Promise<void>;
        static isAvailable(): boolean;
    }
}

declare module '#infra/browser_pool/pool_manager' {
    export interface PoolConfig {
        size?: number;
        poolSize?: number;
        maxSize?: number;
        minSize?: number;
        strategy?: 'round-robin' | 'least-used' | 'random';
        allocationStrategy?: 'round-robin' | 'least-loaded' | 'target-affinity';
        healthCheckInterval?: number;
        timeout?: number;
        browserEndpoint?: { url?: string; wsEndpoint?: string; [key: string]: unknown };
        [key: string]: unknown;
    }

    export interface PoolStats {
        total: number;
        active: number;
        idle: number;
        pending: number;
        [key: string]: unknown;
    }

    export class BrowserPoolManager {
        constructor(config?: PoolConfig);
        allocate(options?: unknown): Promise<unknown>;
        release(resource: unknown): Promise<void>;
        getStats(): PoolStats;
        cleanup(): Promise<void>;
        initialize?(): Promise<void>;
        shutdown?(): Promise<void>;
        removePageFromPool?(taskId: string): void;
        getHealth?(): Promise<{ healthy: number; poolSize: number; [key: string]: unknown }>;
        initialized?: boolean;
        shuttingDown?: boolean;
        stats?: Record<string, any>;
        pool?: Array<{
            id: string;
            browser: any;
            pages: Map<string, any>;
            health: { status: string; lastCheck: number; consecutiveFailures: number };
            stats: { allocations: number; activeTasks: number; totalUptime: number };
        }>;
        browser?: any;
        nerv?: { emit?: (event: unknown) => void; [key: string]: any } | null;
        circuitBreaker?: {
            state?: string;
            getState?: () => unknown;
            shouldPauseSystem?: () => boolean;
            registerFailure?: (instanceId: string, error: Error, context?: Record<string, unknown>) => unknown;
            registerRecovery?: (instanceId: string) => unknown;
            getStatus?: () => { state?: string; lastCause?: string; [key: string]: unknown };
            [key: string]: any;
        } | null;
        [key: string]: any;
    }
    export default BrowserPoolManager;
}

// ============================================================
// Chrome Proxy Service
// ============================================================

declare module '#infra/proxy/chromeProxyService' {
    export interface ProxyConfig {
        port?: number;
        host?: string;
        timeout?: number;
        retries?: number;
        [key: string]: unknown;
    }

    export interface ProxyStatus {
        running: boolean;
        port: number;
        pid?: number;
        uptime?: number;
        [key: string]: unknown;
    }

    export class ChromeProxyService {
        constructor(config?: ProxyConfig);
        start(): Promise<void>;
        stop(): Promise<void>;
        restart(): Promise<void>;
        getStatus(): ProxyStatus;
        isRunning(): boolean;
        getEndpoint(): string;
        [key: string]: unknown;
    }
    export default ChromeProxyService;
}

// ============================================================
// Storage - DNA Evolution
// ============================================================

declare module '#infra/storage/dna_evolution' {
    export interface DnaVersion {
        version: number;
        timestamp: number;
        data: unknown;
        author?: string;
        reason?: string;
        [key: string]: unknown;
    }

    export function saveDnaVersion(data: unknown, reason?: string): Promise<void>;
    export function getDnaHistory(): Promise<DnaVersion[]>;
    export function rollbackTo(version: number): Promise<unknown>;
    export function getCurrentVersion(): Promise<DnaVersion | null>;
}

declare module '#infra/storage/response_store_v2' {
    export interface ResponseMetadata {
        taskId: string;
        timestamp: number;
        size: number;
        [key: string]: unknown;
    }

    export function saveResponse(taskId: string, data: string): Promise<void>;
    export function loadResponse(taskId: string): Promise<string | null>;
    export function deleteResponse(taskId: string): Promise<void>;
    export function listResponses(): Promise<ResponseMetadata[]>;
}
