/**
 * Driver System - Type Contracts
 *
 * Contratos de tipos base para o sistema de drivers.
 * NÃO contém module augmentations - apenas interfaces e types.
 */

// ============================================================
// Enums e Union Types
// ============================================================

export type DriverState =
  | 'PENDING'
  | 'RUNNING'
  | 'HEALTHY'
  | 'FAILED'
  | 'IDLE'
  | 'STALLED'
  | 'UNATTACHED';

/** Timeout em milliseconds com brand para type safety */
export type TimeoutMs = number & { readonly __brand?: "TimeoutMs" };

/** Type-level defaults (sem valor runtime) */
export type DefaultTimeouts = readonly [500, 1000, 1500];

/** Config genérico de driver */
export type DriverConfig = Record<string, unknown>;

/** Execution context (Puppeteer ExecutionContext) */
export type ExecutionContext = {
  ctx: unknown;
  depth?: number;
  type?: string;
  [key: string]: unknown;
};

/** Element handle (Puppeteer ElementHandle) */
export type ElementHandleLike = unknown;

// ============================================================
// Submódulos do Driver - Interfaces
// ============================================================

export interface IInputResolver {
  resolve(input?: unknown, options?: DriverConfig): Promise<InputResolutionProto>;
  cacheSize: number;
  cache: ReadonlyMap<string, unknown>;
  clearCache(): void;
}

export type InputResolutionProto = {
  selector: string;
  confidence?: number | string;
  [key: string]: unknown;
};

export interface IHandleManager {
  register(handle: unknown): void;
  clear(handle: unknown): void;
  clearAll(): void;
  getStats(): { handlesRegistered: number; handlesCleared: number };
}

export interface IRecoverySystem {
  recover(error: Error, context?: unknown): Promise<void>;
  applyTier(error: Error, attempts: number, taskId?: string): Promise<void>;
}

export interface IFrameNavigator {
  navigate(frame: unknown): Promise<void>;
  getExecutionContext(proto?: unknown): Promise<ExecutionContext>;
}

export interface IBiomechanicsEngine {
  simulate(action: string, options?: DriverConfig): Promise<void>;
  waitIfBusy(taskId?: string): Promise<void>;
  prepareElement(execContext: ExecutionContext, selector: string): Promise<ElementHandleLike>;
  clearInput(context: ExecutionContext, selector: string): Promise<void>;
  typeText(context: ExecutionContext, selector: string, text: string, signal?: AbortSignal): Promise<void>;
  releaseModifiers(): Promise<void>;
}

export interface ISubmissionController {
  submit(ctx: ExecutionContext, selector: string, taskId: string): Promise<void>;
  isLocked(): boolean;
  clearLock(): void;
}

export interface IPageSessionTracker {
  recordTurn(): number;
  getTurnCount(): number;
}

export interface IDriverReadinessGuard {
  waitUntilReady(options?: { timeout?: TimeoutMs; phases?: readonly string[] }): Promise<void>;
  isReady(): boolean;
}

// ============================================================
// IDriver - Interface principal
// ============================================================

/**
 * Interface base que todos os drivers implementam.
 *
 * Propriedades opcionais (`?`) porque são criadas progressivamente
 * durante o constructor.
 */
export interface IDriver {
  /** Página Puppeteer atual */
  page: import("puppeteer-core").Page | null;

  /** Métodos de vitalidade */
  _emitVital: (event: string, data?: unknown) => void;
  _assertPageAlive: () => void;

  /** Identificação */
  correlationId: string;
  driverId?: string;

  /** Domínio atual */
  currentDomain?: string;

  /** Configuração */
  config?: DriverConfig;

  /** Timestamp de criação */
  _createdAt?: number;

  /** Flag de temporariedade */
  _isTemporary?: boolean;

  /** Submódulos (criados progressivamente no constructor) */
  inputResolver?: IInputResolver;
  recovery?: IRecoverySystem;
  handles?: IHandleManager;
  frameNavigator?: IFrameNavigator;
  biomechanics?: IBiomechanicsEngine;
  submission?: ISubmissionController;
  sessionTracker?: IPageSessionTracker;
  readinessGuard?: IDriverReadinessGuard;

  /** Métodos principais */
  sendPrompt?(text: string, taskId?: string, signal?: AbortSignal): Promise<unknown>;
  close?(): Promise<void>;
}
