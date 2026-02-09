/**
 * Ollama Tools for Tool Registry
 *
 * Exposes Ollama server (host.docker.internal:11434) as first-class tools
 * accessible by all LLMs and program logic.
 *
 * Tools:
 * - ollama_generate: Text generation using local models
 * - ollama_embed: Generate embeddings for arbitrary text
 * - ollama_models: List all available Ollama models
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
 * ollama_generate tool: Text generation using local Ollama models
 *
 * Generate text using models like qwen2.5-coder:3b (CPU-optimized default).
 * Useful for:
 * - Code generation and completion
 * - Docstring/comment generation
 * - Code explanation
 * - Intelligent decision-making in program logic
 *
 * CPU Optimization (v4.1):
 * - Default model: qwen2.5-coder:3b (2x faster than 7b on CPU)
 * - Max tokens: 1000 (reduced from 2000 for faster responses)
 * - Timeout: 60s (prevents long waits on CPU-only systems)
 *
 * @param {Object} params - Generation parameters
 * @param {string} params.prompt - The prompt to generate from
 * @param {string} params.model - Model name (default: qwen2.5-coder:3b from ENV)
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
            throw new Error(`Invalid input: ${message}`);
        }
        throw error;
    }

    const { prompt, model, temperature = 0.7, max_tokens } = validated;

    // Use ENV defaults for CPU optimization
    const selectedModel = model || process.env.OLLAMA_DEFAULT_MODEL || 'qwen2.5-coder:3b';
    const selectedMaxTokens = max_tokens || Number(process.env.OLLAMA_MAX_TOKENS || 1000);
    console.error(`[Ollama Tool] ollama_generate with model=${selectedModel}, max_tokens=${selectedMaxTokens}`);

    // Check if already aborted before starting
    if (options.signal?.aborted) {
        throw new Error('Generation cancelled before execution');
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
        throw new Error(`Ollama generate failed: ${error.message}`);
    }
}

/**
 * ollama_embed tool: Generate embeddings for arbitrary text
 *
 * Creates vector embeddings using nomic-embed-text (768D).
 * Useful for:
 * - Semantic similarity comparison
 * - Text clustering
 * - Vector search preparation
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
            throw new Error(`Invalid input: ${message}`);
        }
        throw error;
    }

    const { text, model = 'nomic-embed-text' } = validated;

    console.error(`[Ollama Tool] ollama_embed with model=${model}`);

    // Check if already aborted before starting
    if (options.signal?.aborted) {
        throw new Error('Embedding cancelled before execution');
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
        throw new Error(`Ollama embed failed: ${error.message}`);
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

        // Usage recommendations
        formatted += `## 💡 Usage Recommendations\n\n`;
        formatted += `**For Code Generation (CPU-optimized):**\n`;
        formatted += `- qwen2.5-coder:3b ✅ (default, 2x faster on CPU)\n`;
        formatted += `- qwen2.5-coder:7b (best quality, but slow on CPU)\n\n`;
        formatted += `**For General Chat:**\n`;
        formatted += `- qwen2.5:3b-instruct\n\n`;
        formatted += `**For Embeddings (RAG):**\n`;
        formatted += `- nomic-embed-text ✅ (768D, used by RAG system)\n`;

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
            description: `Generate text using local Ollama models.

Available models (CPU-optimized):
- qwen2.5-coder:3b ✅ (default, 3.1B params, 2x faster on CPU)
- qwen2.5-coder:7b (best quality, 7.6B params, slower on CPU)
- qwen2.5:3b-instruct (general chat)

Use cases:
- Generate code documentation/docstrings
- Complete code snippets
- Explain complex code
- Generate test cases
- Intelligent decision-making in program logic

Examples:
- "Generate a docstring for this function: [code]"
- "Complete this implementation: [partial code]"
- "Explain what this code does: [code]"`,
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: 'The prompt to generate from (can include code context)'
                    },
                    model: {
                        type: 'string',
                        description: 'Model name (default: qwen2.5-coder:3b, CPU-optimized)',
                        default: 'qwen2.5-coder:3b',
                        enum: ['qwen2.5-coder:3b', 'qwen2.5-coder:7b', 'qwen2.5:3b-instruct']
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
                        description: 'Maximum tokens to generate (default: 1000, CPU-optimized)',
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
            description: `Generate embeddings for text using nomic-embed-text (768D).

Use cases:
- Compare semantic similarity between texts
- Prepare text for vector search
- Cluster related content
- Find semantic duplicates

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
