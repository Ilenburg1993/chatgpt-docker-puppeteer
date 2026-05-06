// @ts-check
/**
 * src/copilot/sdk/models/known-models.js
 *
 * Catálogo estático de modelos conhecidos com metadata expandida. Usado como fallback pelo ModelRegistry quando o SDK
 * não fornece capabilities completas.
 *
 * @module copilot/sdk/models/known-models
 * @see EventBus
 */

/**
 * @typedef {import('./registry.js').CostTier} CostTier
 *
 * @typedef {import('./registry.js').SpeedTier} SpeedTier
 *
 * @typedef {import('./registry.js').ModelMeta} ModelMeta
 */

/**
 * Catálogo de modelos conhecidos com capabilities expandidas.
 *
 * @type {ReadonlyArray<ModelMeta>}
 */
export const KNOWN_MODELS = Object.freeze([
    {
        id: 'gpt-5',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 128_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: ['gpt5'],
    },
    {
        id: 'gpt-5.2',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 400_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['gpt52', 'gpt-5-2'],
    },
    {
        id: 'gpt-5.2-codex',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 400_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: ['gpt52-codex', 'gpt-5-2-codex'],
    },
    {
        id: 'gpt-5.3-codex',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 400_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: ['gpt53-codex', 'gpt-5-3-codex'],
    },
    {
        id: 'gpt-5.4',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 400_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['gpt54', 'gpt-5-4'],
    },
    {
        id: 'gpt-5.4-mini',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 400_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['gpt54-mini', 'gpt-5-4-mini'],
    },
    {
        id: 'gpt-5.4-nano',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: ['gpt54-nano', 'gpt-5-4-nano'],
    },
    {
        id: 'gpt-5.5',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 400_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['gpt55', 'gpt-5-5'],
    },
    {
        id: 'gpt-5-mini',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 128_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: ['gpt5-mini', '5-mini'],
    },
    {
        id: 'gpt-4.1',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 1_047_576,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['gpt4.1'],
    },
    {
        id: 'gpt-4.1-mini',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 1_047_576,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['gpt4.1-mini', 'mini'],
    },
    {
        id: 'gpt-4.1-nano',
        costTier: /** @type {CostTier} */ ('free'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 1_047_576,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['nano'],
    },
    {
        id: 'gpt-4o',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 128_000,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['4o'],
    },
    {
        id: 'gpt-4o-mini',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 128_000,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['4o-mini'],
    },
    {
        id: 'o3',
        costTier: /** @type {CostTier} */ ('premium'),
        speedTier: /** @type {SpeedTier} */ ('slow'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: [],
    },
    {
        id: 'o3-mini',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: [],
    },
    {
        id: 'o4-mini',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: [],
    },
    {
        id: 'claude-sonnet-4-5',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.5-sonnet', 'claude-sonnet-4.5', 'sonnet-4.5'],
    },
    {
        id: 'claude-sonnet-4.5',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.5-sonnet', 'claude-sonnet-4-5', 'sonnet-4.5'],
    },
    {
        id: 'claude-sonnet-4.6',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.6-sonnet', 'claude-sonnet-4-6', 'sonnet-4.6'],
    },
    {
        id: 'claude-opus-4-5',
        costTier: /** @type {CostTier} */ ('premium'),
        speedTier: /** @type {SpeedTier} */ ('slow'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.5-opus', 'claude-opus-4.5', 'opus-4.5'],
    },
    {
        id: 'claude-opus-4.5',
        costTier: /** @type {CostTier} */ ('premium'),
        speedTier: /** @type {SpeedTier} */ ('slow'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.5-opus', 'claude-opus-4-5', 'opus-4.5'],
    },
    {
        id: 'claude-opus-4.6',
        costTier: /** @type {CostTier} */ ('premium'),
        speedTier: /** @type {SpeedTier} */ ('slow'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.6-opus', 'claude-opus-4-6', 'opus-4.6'],
    },
    {
        id: 'claude-opus-4.7',
        costTier: /** @type {CostTier} */ ('premium'),
        speedTier: /** @type {SpeedTier} */ ('slow'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.7-opus', 'claude-opus-4-7', 'opus-4.7'],
    },
    {
        id: 'claude-haiku-4-5',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.5-haiku', 'claude-haiku-4.5', 'haiku-4.5'],
    },
    {
        id: 'claude-haiku-4.5',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-4.5-haiku', 'claude-haiku-4-5', 'haiku-4.5'],
    },
    {
        id: 'claude-sonnet-4',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 200_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['claude-sonnet', 'sonnet'],
    },
    {
        id: 'claude-3.5-sonnet',
        costTier: /** @type {CostTier} */ ('medium'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 200_000,
        supportsReasoning: false,
        supportsVision: true,
        aliases: ['sonnet-3.5'],
    },
    {
        id: 'gemini-2.5-pro',
        costTier: /** @type {CostTier} */ ('high'),
        speedTier: /** @type {SpeedTier} */ ('medium'),
        contextWindow: 1_000_000,
        supportsReasoning: true,
        supportsVision: true,
        aliases: ['gemini-pro'],
    },
    {
        id: 'grok-code-fast-1',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 256_000,
        supportsReasoning: false,
        supportsVision: false,
        aliases: ['grok-fast', 'grok-code-fast'],
    },
    {
        id: 'raptor-mini',
        costTier: /** @type {CostTier} */ ('low'),
        speedTier: /** @type {SpeedTier} */ ('fast'),
        contextWindow: 128_000,
        supportsReasoning: true,
        supportsVision: false,
        aliases: ['raptor'],
    },
]);

/** @type {Record<import('./registry.js').CostTier, number>} */
export const COST_ORDER = { free: 0, low: 1, medium: 2, high: 3, premium: 4 };

/** @type {Record<import('./registry.js').SpeedTier, number>} */
export const SPEED_ORDER = { slow: 0, medium: 1, fast: 2 };
