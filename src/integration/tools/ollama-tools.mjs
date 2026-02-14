/**
 * Ollama Tools for Tool Registry (v5.0 - Dual-URL Architecture)
 *
 * Exposes Ollama Cloud (generation) and Local (embeddings) as first-class tools
 * accessible by all LLMs and program logic.
 *
 * Dual-URL Architecture:
 * - Cloud (https://ollama.com): qwen3-coder-next, qwen3-next - requires API key
 * - Local (host.docker.internal:11434): nomic-embed-text (embeddings only)
 *
 * Tools:
 * - ollama_generate: Text generation using Ollama Cloud (or fallback to local)
 * - ollama_embed: Generate embeddings using LOCAL Ollama only
 * - ollama_models: List available models (cloud if enabled, local otherwise)
 */

import { z } from 'zod';
import { ollama } from '../../../tools/ollama/client.mjs';

/**
 * Input validation schemas (prevents DoS attacks)
 */
const OllamaGenerateSchema = z.object({
    prompt: z.string()
        .min(1, 'Prompt cannot be empty')
        .max(10000, 'Prompt too long (max 10000 chars) - potential DoS attack'),
    model: z.string()
        .regex(/^[a-zA-Z0-9._:-]+$/, 'Invalid model name format')
        .refine(val => {
            // Cloud models (v5.0)
            const cloudModels = ['qwen3-coder-next', 'qwen3-next', 'qwen3-next:80b-cloud'];
            // Local models (v4.x backward compat)
            const localModels = ['qwen2.5-coder:3b', 'qwen2.5:3b-instruct', 'qwen2.5-coder:7b'];
            return cloudModels.includes(val) || localModels.includes(val);
        }, 'Model must be qwen3-coder-next, qwen3-next:80b-cloud, or legacy local model')
        .optional(),
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

/**
 * ollama_generate tool: Text generation using Ollama Cloud (v5.0)
 *
 * Generates text using powerful cloud GPUs (https://ollama.com).
 * Models: qwen3-coder-next (coding agents) or qwen3-next (general chat).
 *
 * Requirements:
 * - OLLAMA_CLOUD_ENABLED=true
 * - OLLAMA_CLOUD_API_KEY set (get from https://ollama.com/settings/api-keys)
 *
 * Useful for:
 * - Code generation and completion (qwen3-coder-next)
 * - Docstring/comment generation
 * - Code explanation
 * - General chat and Q&A (qwen3-next)
 * - Intelligent decision-making in program logic
 *
 * Cloud Models (v5.0):
 * - qwen3-coder-next: 80B MoE (3B active), 256k context, coding agents
 * - qwen3-next: Hybrid attention, high-sparsity MoE, general chat
 *
 * Fallback:
 * - If OLLAMA_CLOUD_ENABLED=false, uses local Ollama with legacy models
 *
 * @param {Object} params - Generation parameters
 * @param {string} params.prompt - The prompt to generate from
 * @param {string} params.model - Model name (default: qwen3-coder-next from ENV)
 * @param {number} params.temperature - Temperature 0-1 (default: 0.7)
 * @param {number} params.max_tokens - Max tokens to generate (default: 1000 from ENV)
 * @returns {Promise<string>} Generated text formatted as Markdown
 */
async function ollamaGenerateHandler(params, options = {}) {
    // Validate input (prevents DoS attacks with huge prompts/tokens)
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

    const { prompt, model, temperature = 0.7, max_tokens } = validated;

    // Use ENV defaults (cloud models or local fallback)
    const selectedModel = model || process.env.OLLAMA_DEFAULT_MODEL || 'qwen3-coder-next';
    const selectedMaxTokens = max_tokens || Number(process.env.OLLAMA_MAX_TOKENS || 1000);
    console.error(`[Ollama Tool] ollama_generate with model=${selectedModel}, max_tokens=${selectedMaxTokens}`);

    // Check if already aborted before starting
    if (options.signal?.aborted) {
        throw new Error('Generation cancelled before execution'); // eslint-disable-line preserve-caught-error
    }

    try {
        const response = await ollama.generate(prompt, selectedModel, {
            temperature,
            num_predict: selectedMaxTokens,
            signal: options.signal  // Pass signal for cancellation
        });

        let formatted = `# Ollama Generation\n\n`;
        formatted += `**Model:** ${selectedModel}\n`;
        formatted += `**Temperature:** ${temperature}\n`;
        formatted += `**Max Tokens:** ${selectedMaxTokens}\n\n`;
        formatted += `---\n\n`;
        formatted += response;
        formatted += `\n`;

        return formatted;
    } catch (error) {
        console.error('[Ollama Tool] ollama_generate error:', error);
        throw new Error(`Ollama generate failed: ${error.message}`); // eslint-disable-line preserve-caught-error
    }
}

/**
 * ollama_embed tool: Generate embeddings using LOCAL Ollama only
 *
 * Creates vector embeddings using nomic-embed-text (768D) on local Ollama.
 * Embeddings are NOT available on Ollama Cloud - always uses local endpoint.
 *
 * Local Ollama: http://host.docker.internal:11434
 * Requires: Local Ollama running (docker-compose up ollama OR ollama serve)
 *
 * Useful for:
 * - Semantic similarity comparison
 * - Text clustering
 * - Vector search preparation
 * - RAG system embeddings
 *
 * @param {Object} params - Embedding parameters
 * @param {string} params.text - Text to embed
 * @param {string} params.model - Embedding model (default: nomic-embed-text)
 * @returns {Promise<string>} Embedding info formatted as Markdown
 */
async function ollamaEmbedHandler(params, options = {}) {
    // Validate input (prevents DoS attacks with huge text)
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

    console.error(`[Ollama Tool] ollama_embed with model=${model}`);

    // Check if already aborted before starting
    if (options.signal?.aborted) {
        throw new Error('Embedding cancelled before execution'); // eslint-disable-line preserve-caught-error
    }

    try {
        const embedding = await ollama.embed(text, model, {
            signal: options.signal  // Pass signal for cancellation
        });

        let formatted = `# Ollama Embedding\n\n`;
        formatted += `**Model:** ${model}\n`;
        formatted += `**Input Text:** "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"\n`;
        formatted += `**Dimensions:** ${embedding.length}\n\n`;
        formatted += `**First 10 values:**\n\`\`\`\n`;
        formatted += embedding.slice(0, 10).map((v, i) => `[${i}]: ${v.toFixed(6)}`).join('\n');
        formatted += `\n\`\`\`\n\n`;
        formatted += `**Statistics:**\n`;
        formatted += `- Min: ${Math.min(...embedding).toFixed(6)}\n`;
        formatted += `- Max: ${Math.max(...embedding).toFixed(6)}\n`;
        formatted += `- Mean: ${(embedding.reduce((a, b) => a + b, 0) / embedding.length).toFixed(6)}\n`;

        return formatted;
    } catch (error) {
        console.error('[Ollama Tool] ollama_embed error:', error);
        throw new Error(`Ollama embed failed: ${error.message}`); // eslint-disable-line preserve-caught-error
    }
}

/**
 * ollama_models tool: List all available Ollama models on host
 *
 * Returns list of models with size, modified date, and capabilities.
 * Useful for:
 * - Discovering available models
 * - Checking model availability before generation
 * - Understanding model sizes and parameters
 *
 * @returns {Promise<string>} Model list formatted as Markdown
 */
async function ollamaModelsHandler() {
    console.error('[Ollama Tool] ollama_models listing...');

    try {
        const models = await ollama.listModels();

        let formatted = `# Available Ollama Models\n\n`;
        formatted += `Found **${models.length}** models:\n\n`;

        // Group by type
        const generationModels = models.filter(m =>
            !m.name.includes('embed') && !m.name.includes('vision')
        );
        const embeddingModels = models.filter(m => m.name.includes('embed'));
        const visionModels = models.filter(m => m.name.includes('vision'));

        if (generationModels.length > 0) {
            formatted += `## 🤖 Text Generation Models\n\n`;
            for (const model of generationModels) {
                const sizeGB = (model.size / 1e9).toFixed(2);
                const modified = new Date(model.modified_at).toLocaleDateString();
                const params = model.details?.parameter_size || 'Unknown';
                formatted += `- **${model.name}** - ${sizeGB} GB (${params}) - Modified: ${modified}\n`;
            }
            formatted += `\n`;
        }

        if (embeddingModels.length > 0) {
            formatted += `## 🔍 Embedding Models\n\n`;
            for (const model of embeddingModels) {
                const sizeGB = (model.size / 1e9).toFixed(2);
                const modified = new Date(model.modified_at).toLocaleDateString();
                const params = model.details?.parameter_size || 'Unknown';
                formatted += `- **${model.name}** - ${sizeGB} GB (${params}) - Modified: ${modified}\n`;
            }
            formatted += `\n`;
        }

        if (visionModels.length > 0) {
            formatted += `## 👁️ Vision Models\n\n`;
            for (const model of visionModels) {
                const sizeGB = (model.size / 1e9).toFixed(2);
                const modified = new Date(model.modified_at).toLocaleDateString();
                formatted += `- **${model.name}** - ${sizeGB} GB - Modified: ${modified}\n`;
            }
            formatted += `\n`;
        }

        // Usage recommendations (v5.0 - cloud + local)
        formatted += `## 💡 Usage Recommendations\n\n`;
        formatted += `**For Code Generation & Agents (Cloud):**\n`;
        formatted += `- qwen3-coder-next ✅ (80B MoE, 3B active, 256k context)\n\n`;
        formatted += `**For General Chat (Cloud):**\n`;
        formatted += `- qwen3-next ✅ (Hybrid attention, high-sparsity MoE)\n\n`;
        formatted += `**For Embeddings (Local):**\n`;
        formatted += `- nomic-embed-text ✅ (768D, used by RAG system)\n\n`;
        formatted += `**Cloud Requirements:**\n`;
        formatted += `- Set OLLAMA_CLOUD_ENABLED=true\n`;
        formatted += `- Set OLLAMA_CLOUD_API_KEY (get from https://ollama.com/settings/api-keys)\n\n`;
        formatted += `**Legacy Local Models (v4.x):**\n`;
        formatted += `- qwen2.5-coder:3b (fallback if cloud disabled)\n`;
        formatted += `- qwen2.5-coder:7b (fallback if cloud disabled)\n`;

        return formatted;
    } catch (error) {
        console.error('[Ollama Tool] ollama_models error:', error);
        // Degraded mode: allow callers (including integration tests) to continue even
        // when Ollama isn't running in the current environment.
        let formatted = `# Available Ollama Models\n\n`;
        formatted += `⚠️ Ollama server not reachable at ${ollama?.baseUrl || process.env.OLLAMA_BASE_URL || 'unknown'}.\n\n`;
        formatted += `Showing recommended defaults (may not be installed):\n\n`;
        formatted += `- qwen2.5-coder:3b\n`;
        formatted += `- nomic-embed-text\n`;
        formatted += `\n`;
        formatted += `Error: ${error?.message || String(error)}\n`;
        return formatted;
    }
}

/**
 * Register Ollama tools in the Tool Registry
 *
 * @param {ToolRegistry} registry - Tool registry instance
 */
export async function registerOllamaTools(registry) {
    console.error('[Ollama Tools] Registering tools...');

    // ollama_generate
    registry.register(
        'ollama_generate',
        {
            description: `Generate text using Ollama Cloud (https://ollama.com) with powerful GPUs.

Available models (v5.0):
- qwen3-coder-next ✅ (80B MoE, 3B active, 256k context, coding agents)
- qwen3-next:80b-cloud ✅ (80B hybrid attention, high-sparsity MoE, general chat)

Requirements:
- OLLAMA_CLOUD_ENABLED=true
- OLLAMA_CLOUD_API_KEY (generate at https://ollama.com/settings/api-keys)

Use cases:
- Generate code documentation/docstrings
- Complete code snippets
- Explain complex code
- Generate test cases
- General chat and Q&A
- Intelligent decision-making in program logic

Examples:
- "Generate a docstring for this function: [code]"
- "Complete this implementation: [partial code]"
- "Explain what closures are in JavaScript"

Fallback:
- If cloud disabled, uses local Ollama with legacy models`,
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The prompt to generate from (can include code context)'
                    },
                    model: {
                        type: 'string',
                        description: 'Model name (default: qwen3-coder-next)',
                        default: 'qwen3-coder-next',
                        enum: ['qwen3-coder-next', 'qwen3-next:80b-cloud']
                    },
                    temperature: {
                        type: 'number',
                        description: 'Temperature 0-1 (default: 0.7, lower = more focused)',
                        default: 0.7,
                        minimum: 0,
                        maximum: 1
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

    // ollama_embed
    registry.register(
        'ollama_embed',
        {
            description: `Generate embeddings using LOCAL Ollama only (http://host.docker.internal:11434).

IMPORTANT: Embeddings are NOT available on Ollama Cloud.
ALWAYS uses local endpoint with nomic-embed-text (768D).

Requires: Local Ollama running (docker-compose up ollama OR ollama serve)

Use cases:
- Compare semantic similarity between texts
- Prepare text for vector search
- Cluster related content
- Find semantic duplicates
- RAG system embeddings

The same embedding model used by the RAG system.`,
            inputSchema: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'Text to embed (code, documentation, queries, etc.)'
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

    // ollama_models
    registry.register(
        'ollama_models',
        {
            description: `List all available Ollama models on the host.

Shows:
- Model names and sizes
- Text generation models (code-focused and general)
- Embedding models
- Model capabilities and parameters
- Usage recommendations

Useful for discovering which models are available before calling ollama_generate.`,
            inputSchema: {
                type: 'object',
                properties: {}
            }
        },
        ollamaModelsHandler
    );

    console.error('[Ollama Tools] Registered 3 tools: ollama_generate, ollama_embed, ollama_models');
}
