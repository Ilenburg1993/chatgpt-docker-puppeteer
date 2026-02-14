/**
 * Ollama Tools for Tool Registry (v5.1 - Cloud-first non-embedding)
 *
 * Policy:
 * - ollama_generate: cloud-first by default (runtime=auto), local optional
 * - ollama_embed: local-only (cloud has no embeddings)
 * - ollama_models: explicit cloud/local inventory + policy metadata
 */

import { z } from 'zod';
import { ollama } from '../../../tools/ollama/client.mjs';

const OllamaGenerateSchema = z.object({
    prompt: z.string()
        .min(1, 'Prompt cannot be empty')
        .max(10000, 'Prompt too long (max 10000 chars) - potential DoS attack'),
    model: z.string()
        .regex(/^[a-zA-Z0-9._:-]+$/, 'Invalid model name format')
        .optional(),
    runtime: z.enum(['auto', 'cloud', 'local']).optional(),
    temperature: z.number()
        .min(0, 'Temperature must be >= 0')
        .max(2, 'Temperature must be <= 2')
        .optional(),
    max_tokens: z.number()
        .int('max_tokens must be an integer')
        .min(1, 'max_tokens must be >= 1')
        .max(4000, 'max_tokens cannot exceed 4000 - potential DoS attack')
        .optional()
});

const OllamaEmbedSchema = z.object({
    text: z.string()
        .min(1, 'Text cannot be empty')
        .max(8000, 'Text too long (max 8000 chars) - potential DoS attack'),
    model: z.string()
        .regex(/^[a-zA-Z0-9._:-]+$/, 'Invalid model name format')
        .optional()
});

function formatModelBlock(models) {
    if (!Array.isArray(models) || models.length === 0) {
        return '- (none)\n';
    }

    let out = '';
    for (const model of models) {
        const sizeGB = Number.isFinite(model?.size) ? `${(model.size / 1e9).toFixed(2)} GB` : 'Unknown size';
        const params = model?.details?.parameter_size || 'Unknown params';
        const modified = model?.modified_at ? new Date(model.modified_at).toLocaleDateString() : 'Unknown date';
        out += `- **${model?.name || 'unknown'}** - ${sizeGB} (${params}) - Modified: ${modified}\n`;
    }

    return out;
}

async function ollamaGenerateHandler(params, options = {}) {
    let validated;
    try {
        validated = OllamaGenerateSchema.parse(params);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const issues = error.issues ?? error.errors ?? [];
            const message =
                Array.isArray(issues) && issues.length > 0
                    ? issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
                    : 'validation failed';
            throw new Error(`Invalid input: ${message}`); // eslint-disable-line preserve-caught-error
        }
        throw error;
    }

    const {
        prompt,
        model,
        runtime = 'auto',
        temperature = 0.7,
        max_tokens
    } = validated;

    const selectedModel = model || process.env.OLLAMA_DEFAULT_MODEL || 'qwen3-coder-next';
    const selectedMaxTokens = max_tokens || Number(process.env.OLLAMA_MAX_TOKENS || 1000);

    if (options.signal?.aborted) {
        throw new Error('Generation cancelled before execution'); // eslint-disable-line preserve-caught-error
    }

    try {
        const generated = await ollama.generateWithMetadata(prompt, selectedModel, {
            temperature,
            num_predict: selectedMaxTokens,
            runtime,
            signal: options.signal
        });

        let formatted = '# Ollama Generation\n\n';
        formatted += `**Model:** ${selectedModel}\n`;
        formatted += `**Runtime Requested:** ${runtime}\n`;
        formatted += `**Runtime Used:** ${generated.runtime}\n`;
        formatted += `**Fallback Used:** ${generated.fallbackUsed ? 'yes' : 'no'}\n`;
        formatted += `**Attempts:** ${generated.attempts.join(' -> ')}\n`;
        formatted += `**Temperature:** ${temperature}\n`;
        formatted += `**Max Tokens:** ${selectedMaxTokens}\n\n`;
        formatted += '---\n\n';
        formatted += generated.response;
        formatted += '\n';

        return formatted;
    } catch (error) {
        console.error('[Ollama Tool] ollama_generate error:', error);
        throw new Error(`Ollama generate failed: ${error.message}`); // eslint-disable-line preserve-caught-error
    }
}

async function ollamaEmbedHandler(params, options = {}) {
    let validated;
    try {
        validated = OllamaEmbedSchema.parse(params);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const issues = error.issues ?? error.errors ?? [];
            const message =
                Array.isArray(issues) && issues.length > 0
                    ? issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
                    : 'validation failed';
            throw new Error(`Invalid input: ${message}`); // eslint-disable-line preserve-caught-error
        }
        throw error;
    }

    const { text, model = 'nomic-embed-text' } = validated;

    if (options.signal?.aborted) {
        throw new Error('Embedding cancelled before execution'); // eslint-disable-line preserve-caught-error
    }

    try {
        const embedding = await ollama.embed(text, model, {
            signal: options.signal
        });

        let formatted = '# Ollama Embedding\n\n';
        formatted += `**Model:** ${model}\n`;
        formatted += '**Runtime Used:** local (forced for embeddings)\n';
        formatted += `**Input Text:** "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"\n`;
        formatted += `**Dimensions:** ${embedding.length}\n\n`;
        formatted += '**First 10 values:**\n```\n';
        formatted += embedding.slice(0, 10).map((v, i) => `[${i}]: ${v.toFixed(6)}`).join('\n');
        formatted += '\n```\n\n';
        formatted += '**Statistics:**\n';
        formatted += `- Min: ${Math.min(...embedding).toFixed(6)}\n`;
        formatted += `- Max: ${Math.max(...embedding).toFixed(6)}\n`;
        formatted += `- Mean: ${(embedding.reduce((a, b) => a + b, 0) / embedding.length).toFixed(6)}\n`;

        return formatted;
    } catch (error) {
        console.error('[Ollama Tool] ollama_embed error:', error);
        throw new Error(`Ollama embed failed: ${error.message}`); // eslint-disable-line preserve-caught-error
    }
}

async function ollamaModelsHandler() {
    console.error('[Ollama Tool] ollama_models listing...');

    try {
        const inventory = await ollama.listModelsDetailed();

        let formatted = '# Available Ollama Models\n\n';
        formatted += `**priority:** ${inventory.priority}\n`;
        formatted += `**cloud_enabled:** ${inventory.cloud_enabled}\n`;
        formatted += `**fallback_local_enabled:** ${inventory.fallback_local_enabled}\n`;
        formatted += `**non_embedding_runtime:** ${inventory.non_embedding_runtime}\n`;
        formatted += `**local_model_profile:** ${inventory.local_model_profile}\n\n`;

        formatted += '## cloud_models\n\n';
        formatted += formatModelBlock(inventory.cloud_models);
        formatted += '\n';

        formatted += '## local_models\n\n';
        formatted += formatModelBlock(inventory.local_models);
        formatted += '\n';

        if (inventory.errors.cloud || inventory.errors.local) {
            formatted += '## Runtime Errors\n\n';
            if (inventory.errors.cloud) {
                formatted += `- cloud: ${inventory.errors.cloud}\n`;
            }
            if (inventory.errors.local) {
                formatted += `- local: ${inventory.errors.local}\n`;
            }
            formatted += '\n';
        }

        formatted += '## Policy\n\n';
        formatted += '- Non-embedding defaults to cloud-first\n';
        formatted += '- Embeddings are local-only\n';
        formatted += '- Local non-embedding remains available for fallback/specific objectives\n';

        return formatted;
    } catch (error) {
        console.error('[Ollama Tool] ollama_models error:', error);
        let formatted = '# Available Ollama Models\n\n';
        formatted += '**priority:** cloud-first-non-embedding\n\n';
        formatted += `Error: ${error?.message || String(error)}\n`;
        return formatted;
    }
}

/**
 * Register Ollama tools in the Tool Registry
 *
 * @param {ToolRegistry} registry
 */
export async function registerOllamaTools(registry) {
    console.error('[Ollama Tools] Registering tools...');

    registry.register(
        'ollama_generate',
        {
            description: `Generate text with cloud-first runtime policy.

Policy:
- runtime=auto (default): cloud first, local fallback if enabled
- runtime=cloud: cloud only
- runtime=local: local only (subject to local model profile)

Embeddings remain local-only in a separate tool (ollama_embed).`,
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The prompt to generate from'
                    },
                    model: {
                        type: 'string',
                        description: 'Model name (default: OLLAMA_DEFAULT_MODEL)'
                    },
                    runtime: {
                        type: 'string',
                        description: 'Runtime policy for non-embedding (default: auto = cloud-first)',
                        enum: ['auto', 'cloud', 'local'],
                        default: 'auto'
                    },
                    temperature: {
                        type: 'number',
                        description: 'Temperature 0-2 (default: 0.7)',
                        default: 0.7,
                        minimum: 0,
                        maximum: 2
                    },
                    max_tokens: {
                        type: 'number',
                        description: 'Maximum tokens to generate (default: 1000)',
                        default: 1000,
                        minimum: 1,
                        maximum: 4000
                    }
                },
                required: ['prompt']
            }
        },
        ollamaGenerateHandler
    );

    registry.register(
        'ollama_embed',
        {
            description: `Generate embeddings using LOCAL Ollama only.

Important:
- Embeddings are not available in Ollama Cloud
- Runtime is always local for this tool`,
            inputSchema: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'Text to embed (code, docs, query, etc.)'
                    },
                    model: {
                        type: 'string',
                        description: 'Embedding model (default: nomic-embed-text)',
                        default: 'nomic-embed-text'
                    }
                },
                required: ['text']
            }
        },
        ollamaEmbedHandler
    );

    registry.register(
        'ollama_models',
        {
            description: `List model inventory with explicit separation:
- cloud_models
- local_models
- priority (cloud-first-non-embedding)

Also reports runtime errors per backend when unavailable.`,
            inputSchema: {
                type: 'object',
                properties: {}
            }
        },
        ollamaModelsHandler
    );

    console.error('[Ollama Tools] Registered 3 tools: ollama_generate, ollama_embed, ollama_models');
}
