export type TsserverToolOperation =
  | 'definition'
  | 'references'
  | 'hover'
  | 'document_symbols'
  | 'workspace_symbols'
  | 'diagnostics'
  | 'code_actions'
  | 'completion'
  | 'updateFile'
  | 'apply_code_action';

export interface TsserverDaemonOptions {
  rootDir?: string;
  timeoutMs?: number;
}

export interface TsserverExecuteOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface TsserverStartResult {
  started: true;
  rootDir: string;
  timeoutMs: number;
}

export interface TsserverStopResult {
  stopped: true;
}

export interface TsserverDaemonFacade {
  timeoutMs: number;
  start(): Promise<TsserverStartResult>;
  stop(): Promise<TsserverStopResult>;
  execute(
    operation: TsserverToolOperation,
    params?: Record<string, unknown>,
    options?: TsserverExecuteOptions
  ): Promise<any>;
}
