/**
 * Logic System - Module Augmentations
 *
 * Declara tipos para o sistema de lógica adaptativa.
 */

// ============================================================
// Adaptive Logic
// ============================================================

declare module '#logic/adaptive' {
    export interface AdaptiveConfig {
        learningRate?: number;
        threshold?: number;
        maxHistory?: number;
        [key: string]: unknown;
    }

    export interface AdaptiveStats {
        avg: number;
        var: number;
        count: number;
    }

    export interface AdaptiveTargetProfile {
        ttft: AdaptiveStats;
        stream: AdaptiveStats;
        echo: AdaptiveStats;
        tool_execution?: AdaptiveStats;
        last_update: number;
    }

    export interface AdaptiveSnapshot {
        targets: Record<string, AdaptiveTargetProfile>;
        infra: AdaptiveStats;
        last_adjustment_at: number;
    }

    export interface AdaptiveTimeoutResult {
        timeout: number;
        circuit_broken?: boolean;
        breakdown?: Record<string, unknown>;
        phase?: string;
        target?: string;
        warning?: string;
        [key: string]: unknown;
    }

    export interface AdaptiveHealthStatus {
        status: 'HEALTHY' | 'NOT_READY';
        state_file: string;
        targets_count: number;
        stale_targets_count: number;
        stale_targets: string[];
        circuit_broken_count: number;
        circuit_broken_targets: Array<{ target: string; avg: number }>;
        infra_health: 'SUFFICIENT_DATA' | 'INSUFFICIENT_DATA';
        infra_samples: number;
        last_adjustment: string;
        persist_locked: boolean;
        pending_persist: boolean;
    }

    export function getAdjustedTimeout(
        target: string,
        attempt?: number,
        phase?: string,
    ): Promise<AdaptiveTimeoutResult>;
    export function getToolTimeout(
        tool?: string,
        options?: { contextSize?: number; [key: string]: unknown },
    ): Promise<AdaptiveTimeoutResult>;
    export function recordMetric(type: string, ms: number, target?: string): Promise<void>;
    export function getStabilityMetrics(target?: string): Promise<{ score: number; status: string; samples: number }>;
    export function getHealthStatus(): Promise<AdaptiveHealthStatus>;
    export function getPercentileTimeout(stats: AdaptiveStats, percentile?: number): number;
    export const getSnapshot: () => AdaptiveSnapshot;
    export const forcePersist: () => Promise<void>;
    export const values: Record<string, number>;
}

// ============================================================
// Decision Tree
// ============================================================

declare module '#logic/decision_tree' {
    export interface DecisionNode {
        id: string;
        condition: unknown;
        trueNode?: DecisionNode;
        falseNode?: DecisionNode;
        action?: unknown;
        [key: string]: unknown;
    }

    export class DecisionTree {
        constructor(root?: DecisionNode);
        evaluate(context: unknown): Promise<unknown>;
        addNode(node: DecisionNode): void;
        removeNode(nodeId: string): void;
        [key: string]: unknown;
    }
}
