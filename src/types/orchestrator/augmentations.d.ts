/**
 * Orchestrator System - Module Augmentations
 *
 * Declara tipos para o sistema de orquestração de tarefas.
 */

// ============================================================
// Orchestrator Engine
// ============================================================

declare module '#orchestrator/engine' {
  export interface TaskDescriptor {
    id: string;
    type: string;
    payload?: unknown;
    priority?: number;
    [key: string]: unknown;
  }

  export interface ExecutionResult {
    success: boolean;
    data?: unknown;
    error?: Error;
    [key: string]: unknown;
  }

  export class OrchestratorEngine {
    constructor(config?: unknown);
    execute(task: TaskDescriptor): Promise<ExecutionResult>;
    enqueue(task: TaskDescriptor): Promise<void>;
    getStatus(): unknown;
    [key: string]: unknown;
  }

  const orchestrator: OrchestratorEngine;
  export default orchestrator;
}

// ============================================================
// Task Queue
// ============================================================

declare module '#orchestrator/task_queue' {
  export interface QueueOptions {
    maxSize?: number;
    priorityLevels?: number;
    [key: string]: unknown;
  }

  export class TaskQueue {
    constructor(options?: QueueOptions);
    push(task: unknown): void;
    pop(): unknown;
    size(): number;
    [key: string]: unknown;
  }
}

// ============================================================
// Execution Context
// ============================================================

declare module '#orchestrator/execution_context' {
  export interface ExecutionContext {
    taskId: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export function createContext(taskId: string): ExecutionContext;
  export function getContext(): ExecutionContext | null;
}
