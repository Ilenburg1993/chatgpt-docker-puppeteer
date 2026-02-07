/**
 * Missions System - Module Augmentations
 *
 * Declara tipos para o sistema de missões e objetivos.
 */

// ============================================================
// Mission Definition
// ============================================================

declare module '#missions/types' {
  export interface Mission {
    id: string;
    name: string;
    objective: string;
    steps?: MissionStep[];
    status?: 'pending' | 'in_progress' | 'completed' | 'failed';
    [key: string]: unknown;
  }

  export interface MissionStep {
    id: string;
    action: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface MissionResult {
    missionId: string;
    success: boolean;
    data?: unknown;
    error?: string;
    [key: string]: unknown;
  }
}

// ============================================================
// Mission Executor
// ============================================================

declare module '#missions/executor' {
  import type { Mission, MissionResult } from '#missions/types';

  export class MissionExecutor {
    constructor(config?: unknown);
    execute(mission: Mission): Promise<MissionResult>;
    pause(): void;
    resume(): void;
    stop(): void;
    [key: string]: unknown;
  }

  const executor: MissionExecutor;
  export default executor;
}
