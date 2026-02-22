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

    export interface AdaptiveState {
        metrics: Record<string, number>;
        history: unknown[];
        lastUpdate: number;
        [key: string]: unknown;
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

    export class AdaptiveEngine {
        constructor(config?: AdaptiveConfig);
        learn(input: unknown): Promise<void>;
        predict(input: unknown): Promise<unknown>;
        getState(): AdaptiveState;
        reset(): void;
        [key: string]: unknown;
    }

    export function getAdjustedTimeout(
        target: string,
        attempt?: number,
        phase?: string
    ): Promise<AdaptiveTimeoutResult>;
    export function getToolTimeout(
        tool?: string,
        options?: { contextSize?: number; [key: string]: unknown }
    ): Promise<AdaptiveTimeoutResult>;
    export function recordMetric(type: string, ms: number, target?: string): Promise<void>;
    export function getStabilityMetrics(target?: string): Promise<{ score: number; status: string; samples: number }>;
    export function getHealthStatus(): Promise<Record<string, unknown>>;
    export function getPercentileTimeout(stats: { avg: number; var: number }, percentile?: number): number;
    export const getSnapshot: () => Record<string, unknown>;
    export const forcePersist: () => Promise<void>;
    export const values: Record<string, number>;

    const adaptiveEngine: AdaptiveEngine & Record<string, unknown>;
    export default adaptiveEngine;
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
