// @ts-check
/**
 * OpenAI-compatible provider-family specs.
 *
 * Keep one file per provider family so endpoint metadata, account overlays, and catalog importers can evolve without
 * turning the adapter itself back into a provider knowledge base.
 *
 * @module copilot/model-gateway/providers/specs
 */

import { CEREBRAS_PROVIDER_SPEC } from './cerebras.js';
import { CHUTES_PROVIDER_SPEC } from './chutes.js';
import { CLOUDFLARE_WORKERS_AI_PROVIDER_SPEC } from './cloudflare-workers-ai.js';
import { GROQ_PROVIDER_SPEC } from './groq.js';
import { HUGGINGFACE_PROVIDER_SPEC } from './huggingface.js';
import { KILO_PROVIDER_SPEC } from './kilo.js';
import { MISTRAL_PROVIDER_SPEC } from './mistral.js';
import { NVIDIA_NIM_PROVIDER_SPEC } from './nvidia-nim.js';
import { OPENAI_PROVIDER_SPEC } from './openai.js';
import { OPENCODE_PROVIDER_SPEC } from './opencode.js';
import { ZAI_PROVIDER_SPEC } from './zai.js';

/** @type {readonly import('../openai-provider-family-adapter.js').OpenAIProviderFamilySpec[]} */
export const OPENAI_PROVIDER_FAMILY_SPECS = Object.freeze([
    OPENAI_PROVIDER_SPEC,
    KILO_PROVIDER_SPEC,
    GROQ_PROVIDER_SPEC,
    MISTRAL_PROVIDER_SPEC,
    HUGGINGFACE_PROVIDER_SPEC,
    CLOUDFLARE_WORKERS_AI_PROVIDER_SPEC,
    NVIDIA_NIM_PROVIDER_SPEC,
    OPENCODE_PROVIDER_SPEC,
    CEREBRAS_PROVIDER_SPEC,
    CHUTES_PROVIDER_SPEC,
    ZAI_PROVIDER_SPEC,
]);

export {
    CEREBRAS_PROVIDER_SPEC,
    CHUTES_PROVIDER_SPEC,
    CLOUDFLARE_WORKERS_AI_PROVIDER_SPEC,
    GROQ_PROVIDER_SPEC,
    HUGGINGFACE_PROVIDER_SPEC,
    KILO_PROVIDER_SPEC,
    MISTRAL_PROVIDER_SPEC,
    NVIDIA_NIM_PROVIDER_SPEC,
    OPENAI_PROVIDER_SPEC,
    OPENCODE_PROVIDER_SPEC,
    ZAI_PROVIDER_SPEC,
};
