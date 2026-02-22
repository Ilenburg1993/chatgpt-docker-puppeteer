/**
 * Core System - Module Augmentations
 *
 * Declara tipos para módulos core do projeto.
 */

// ============================================================
// Configuration
// ============================================================

declare module '#core/config' {
  export interface ConfigurationManager {
    // Browser Pool
    BROWSER_POOL_SIZE?: number;
    ALLOCATION_STRATEGY?: string;
    HEALTH_CHECK_INTERVAL?: number;

    // Debug
    DEBUG_PORT?: string;

    // Timeouts (used in queue/task loader)
    RUNNING_RECOVERY_MS?: number;

    // ConnectionOrchestrator config
    mode?: string;
    ports?: number[];
    hosts?: string[];
    connectionStrategies?: string[];
    retryDelayMs?: number;
    maxRetryDelayMs?: number;
    maxConnectionAttempts?: number;
    connectionTimeout?: number;
    pageScanIntervalMs?: number;
    allowedDomains?: string[];
    pageSelectionPolicy?: string;
    stateHistorySize?: number;
    autoFallback?: boolean;
    browserEndpoint?: string;
    browserWSEndpoint?: string;
    webSocketDebuggerUrl?: string;

    // Authority
    authority?: {
      mode?: 'standalone' | 'delegated';
      [key: string]: unknown;
    };

    // Catch-all
    [key: string]: unknown;

    // Raw consolidated config object (validated + passthrough keys)
    all?: Record<string, unknown>;

    // Generic accessor used by server lifecycle/bridges
    get?(key: string, defaultValue?: unknown): unknown;
  }

  class ConfigurationManager {
    DEBUG_PORT?: string;
    BROWSER_POOL_SIZE?: number;
    ALLOCATION_STRATEGY?: string;
    HEALTH_CHECK_INTERVAL?: number;
    browserEndpoint?: string;
    [key: string]: unknown;

    all?: Record<string, unknown>;

    get(key: string, defaultValue?: unknown): unknown;
  }

  const config: ConfigurationManager;
  export default config;
  export { ConfigurationManager };
}

// ============================================================
// Constants
// ============================================================

declare module '#core/constants' {
  export const DRIVER_DOMAINS: {
    readonly INITIALIZATION: 'initialization';
    readonly UNKNOWN_CONTEXT: 'unknown_context';
    readonly MAIN_PAGE: 'main_page';
    readonly IFRAME: 'iframe';
    readonly POPUP: 'popup';
  };

  export const ERROR_NAMES: {
    readonly FRAME_NAV_ERROR: 'FrameNavError';
    readonly TRIAGE_ERROR: 'TriageError';
    readonly BASE_DRIVER_ERROR: 'BaseDriverError';
    readonly TARGET_DRIVER_ERROR: 'TargetDriverError';
    readonly CHATGPT_ERROR: 'ChatGPTError';
  };

  export const DRIVER_NAMES: {
    readonly BASE_UNIVERSAL: 'BaseUniversalDriver';
    readonly GENERIC: 'Generic';
    readonly CHATGPT: 'ChatGPT';
  };

  export const DRIVER_STATES: {
    readonly PENDING: 'PENDING';
    readonly RUNNING: 'RUNNING';
    readonly HEALTHY: 'HEALTHY';
    readonly FAILED: 'FAILED';
    readonly IDLE: 'IDLE';
    readonly STALLED: 'STALLED';
    readonly UNATTACHED: 'UNATTACHED';
    readonly PAUSED: 'PAUSED';
    readonly DONE: 'DONE';
    readonly SUCCESS: 'SUCCESS';
    readonly ACCEPTED: 'ACCEPTED';
    readonly REJECTED: 'REJECTED';
    readonly UNHEALTHY: 'UNHEALTHY';
    readonly CRASHED: 'CRASHED';
    readonly SKIPPED: 'SKIPPED';
  };

  export const PROCESS_TYPES: {
    readonly KERNEL: 'KERNEL';
    readonly SERVER: 'SERVER';
    readonly INFRA: 'INFRA';
    readonly OBSERVER: 'OBSERVER';
    readonly MAESTRO: 'MAESTRO';
    readonly DRIVER: 'DRIVER';
    readonly MISSION_CONTROL: 'MISSION_CONTROL';
  };

  export const CONSTANTS: {
    DRIVER_STATES: typeof DRIVER_STATES;
    PROCESS_TYPES: typeof PROCESS_TYPES;
    DRIVER_DOMAINS?: typeof DRIVER_DOMAINS;
    ERROR_NAMES?: typeof ERROR_NAMES;
    DRIVER_NAMES?: typeof DRIVER_NAMES;
    [key: string]: unknown;
  };
}

// ============================================================
// Authority
// ============================================================

declare module '#core/authority' {
  export type AuthorityMode = 'standalone' | 'delegated';

  export const SERVER_AUTHORITIES: Readonly<{
    STANDALONE: 'standalone';
    DELEGATED: 'delegated';
  }>;

  export function resolveAuthority(explicitAuthority?: string | null): AuthorityMode;
  export function isDelegated(authority: unknown): boolean;
  export function isStandalone(authority: unknown): boolean;
}

// ============================================================
// Identity Manager
// ============================================================

declare module '#core/identity_manager' {
  export interface Identity {
    robot_id: string;
    name?: string;
    created?: number;
    [key: string]: unknown;
  }

  export function getIdentity(): Promise<Identity>;
  export function saveIdentity(identity: Identity): Promise<void>;
  export function getRobotId(): string;
}

// ============================================================
// Doctor (Health Checks)
// ============================================================

declare module '#core/doctor' {
  export interface HealthCheckResult {
    status: 'ok' | 'error' | 'warning';
    message?: string;
    details?: unknown;
    [key: string]: unknown;
  }

  export function runFullCheck(): Promise<HealthCheckResult & Record<string, unknown>>;
  export function getHardwareMetrics(): {
    cpu_load: string;
    cpu_usage_percent: string;
    cpu_load_1min: string;
    cpu_load_5min: string;
    cpu_load_15min: string;
    cpu_cores: number;
    ram_usage_pct: string;
    ram_free_gb: string;
    ts: number;
    [key: string]: unknown;
  };
  export function probeChromeConnection(): Promise<Record<string, unknown>>;
}

// ============================================================
// Context Engine
// ============================================================

declare module '#core/context/engine/context_engine' {
  export interface ContextMeta {
    timestamp?: number;
    version?: number;
    source?: string;
    [key: string]: unknown;
  }

  export interface ContextSpec {
    type?: string;
    schema?: unknown;
    constraints?: unknown;
    [key: string]: unknown;
  }

  export interface ContextData {
    meta?: ContextMeta;
    spec?: ContextSpec;
    payload?: unknown;
    [key: string]: unknown;
  }

  export class ContextEngine {
    constructor(config?: unknown);
    process(data: ContextData): Promise<unknown>;
    validate(data: ContextData): boolean;
    [key: string]: unknown;
  }
}
