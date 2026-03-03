// @ts-check - Type checking rigoroso habilitado (arquivo core)
/**
 * OpenAI-Compatible Handler for Express
 *
 * Exposes Ollama via OpenAI Chat Completions API for GitHub Copilot.
 * Mounted at: POST /v1/chat/completions, GET /v1/models
 *
 * Architecture:
 * - Follows mcp-handler.js pattern (setup function + internal handlers)
 * - Uses OllamaClient directly (no Tool Registry - lower latency)
 * - Pure transformation via openai-transformer.js (testable)
 * - Reuses existing infrastructure (circuit breaker, adaptive timeout)
 *
 * Used by: src/server/api/router.js (conditional setup)
 */

import { ollama } from '../../../tools/ollama/client.mjs';
import {
    validateOpenAIRequest,
    translateRequestToOllama,
    translateResponseToOpenAI,
    buildOpenAIError,
} from './openai-transformer.js';

/**
 * Setup OpenAI-compatible endpoints in Express app
 *
 * @param {Express.Application} app - Express app instance
 *
 * Registers:
 * - POST /v1/chat/completions (OpenAI Chat Completions API)
 * - GET /v1/models (List available models)
 *
 * @example
 * const { setupOpenAIHandler } = await import('./openai-handler.js');
 * setupOpenAIHandler(app);
  * @returns {object}
 */
export function setupOpenAIHandler(app) {
    console.error('[OpenAI Handler] setupOpenAIHandler() called, registering routes...');

    // Debug: Test route
    app.get('/v1/test', (req, res) => {
        console.error('[OpenAI Handler] TEST ROUTE CALLED!');
        res.json({ message: 'Test route works!' });
    });

    /**
     * POST /v1/chat/completions
     *
     * Main endpoint for chat completions (OpenAI-compatible)
     *
     * Request body (OpenAI format):
     * {
     *   "model": "qwen3-coder-next",
     *   "messages": [
     *     { "role": "user", "content": "Hello" }
     *   ],
     *   "temperature": 0.7,
     *   "max_tokens": 1000
     * }
     *
     * Response (OpenAI format):
     * {
     *   "id": "chatcmpl-abc123",
     *   "object": "chat.completion",
     *   "created": 1672531200,
     *   "model": "qwen3-coder-next",
     *   "choices": [{
     *     "index": 0,
     *     "message": { "role": "assistant", "content": "Hi!" },
     *     "finish_reason": "stop"
     *   }],
     *   "usage": { "prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7 }
     * }
     */
    app.post('/v1/chat/completions', async (req, res) => {
        console.error('[OpenAI Handler] POST /v1/chat/completions called');
        const startTime = Date.now();

        try {
            // 1. Validate request (fail-fast)
            validateOpenAIRequest(req.body);

            // 2. Log warnings for unsupported features (but proceed)
            if (req.body.tools || req.body.tool_choice) {
                console.warn(
                    '[OpenAI Handler] Tool calling requested but not supported - ignoring. ' +
                        'Set toolCalling:false in VSCode customOAIModels config to avoid this warning.'
                );
            }

            if (req.body.stream) {
                console.warn(
                    '[OpenAI Handler] Streaming requested but not supported in v1.0 - ' +
                        'will return complete response instead.'
                );
            }

            // 3. Translate OpenAI request → Ollama format
            const ollamaReq = translateRequestToOllama(req.body);

            console.error(
                `[OpenAI Handler] Generating with model=${ollamaReq.model}, ` +
                    `prompt_length=${ollamaReq.prompt.length} chars, ` +
                    `temperature=${ollamaReq.options.temperature}`
            );

            // 4. Call Ollama (uses OllamaClient with circuit breaker, adaptive timeout)
            // OllamaClient handles:
            // - Cloud vs local routing (OLLAMA_CLOUD_ENABLED)
            // - API key authentication (OLLAMA_CLOUD_API_KEY)
            // - Timeouts (OLLAMA_GENERATE_TIMEOUT)
            // - Error handling (auth failures, network errors)
            const ollamaResponse = await ollama.generate(ollamaReq.prompt, ollamaReq.model, ollamaReq.options);

            // 5. Translate Ollama response → OpenAI format
            const openaiResponse = translateResponseToOpenAI(
                { response: ollamaResponse, model: ollamaReq.model },
                req.body
            );

            const duration = Date.now() - startTime;
            console.error(
                `[OpenAI Handler] Completed in ${duration}ms, ` +
                    `tokens=${openaiResponse.usage.total_tokens} ` +
                    `(prompt=${openaiResponse.usage.prompt_tokens}, ` +
                    `completion=${openaiResponse.usage.completion_tokens})`
            );

            // 6. Return OpenAI-compatible response
            res.json(openaiResponse);
        } catch (error) {
            const duration = Date.now() - startTime;

            // Handle validation errors (already formatted as OpenAI errors)
            if (error.openaiError) {
                console.error(`[OpenAI Handler] Validation error (${duration}ms): ${error.message}`);
                return res.status(error.statusCode || 400).json(error.openaiError);
            }

            // Handle Ollama errors (translate to OpenAI format)
            console.error(`[OpenAI Handler] Error (${duration}ms):`, error.message);

            // Map error types to appropriate HTTP status codes
            const statusCode = error.message.includes('timeout')
                ? 504 // Gateway Timeout
                : error.message.includes('cancelled')
                  ? 499 // Client Closed Request
                  : error.message.includes('authentication')
                    ? 401 // Unauthorized
                    : error.message.includes('Cloud')
                      ? 502 // Bad Gateway
                      : 500; // Internal Server Error

            const errorType =
                statusCode === 401 ? 'authentication_error' : statusCode === 504 ? 'timeout_error' : 'internal_error';

            res.status(statusCode).json(buildOpenAIError(error.message, errorType, statusCode));
        }
    });

    /**
     * GET /v1/models
     *
     * Lists available models (OpenAI-compatible)
     *
     * Response (OpenAI format):
     * {
     *   "object": "list",
     *   "data": [
     *     {
     *       "id": "qwen3-coder-next",
     *       "object": "model",
     *       "created": 1672531200,
     *       "owned_by": "ollama"
     *     }
     *   ]
     * }
     *
     * Note: Ollama's /api/tags endpoint has different format,
     * so we return hardcoded list for simplicity.
     */
    app.get('/v1/models', async (req, res) => {
        console.error('[OpenAI Handler] GET /v1/models called');
        try {
            // Return hardcoded list of models
            // (Ollama /api/tags has different schema - not worth adapting)
            const models = [
                {
                    id: 'qwen3-coder-next',
                    object: 'model',
                    created: 1672531200,
                    owned_by: 'ollama',
                    permission: [],
                    root: 'qwen3-coder-next',
                    parent: null,
                },
            ];

            res.json({
                object: 'list',
                data: models,
            });
        } catch (error) {
            console.error('[OpenAI Handler] Error listing models:', error.message);
            res.status(500).json(buildOpenAIError('Failed to list models', 'internal_error', 500));
        }
    });
}
