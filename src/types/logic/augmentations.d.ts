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

  export class AdaptiveEngine {
    constructor(config?: AdaptiveConfig);
    learn(input: unknown): Promise<void>;
    predict(input: unknown): Promise<unknown>;
    getState(): AdaptiveState;
    reset(): void;
    [key: string]: unknown;
  }

  const adaptiveEngine: AdaptiveEngine;
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
