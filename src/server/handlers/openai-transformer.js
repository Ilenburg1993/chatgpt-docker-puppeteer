/**
 * OpenAI ↔ Ollama Schema Transformer
 *
 * Pure functions for bidirectional schema translation between:
 * - OpenAI Chat Completions API format
 * - Ollama /api/generate format
 *
 * Philosophy:
 * - All functions are pure (no side-effects, no IO)
 * - Only data transformation - easy to test
 * - Validation happens early (fail-fast)
 *
 * Used by: openai-handler.js (Express endpoints)
 */

/**
 * Validates OpenAI Chat Completions request body
 *
 * @param {Object} body - Request body from client
 * @throws {Error} with openaiError property if validation fails
 * @returns {true} if validation passes
 *
 * @example
 * validateOpenAIRequest({ messages: [{ role: 'user', content: 'Hi' }] })
 * // Returns: true
 *
 * validateOpenAIRequest({ messages: [] })
 * // Throws: Error with openaiError property
 */
export function validateOpenAIRequest(body) {
    // 1. Check messages array exists and is not empty
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        throw buildValidationError('messages array is required and must not be empty');
    }

    // 2. Reject multiple completions (n > 1)
    if (body.n && body.n > 1) {
        throw buildValidationError(
            `Multiple completions not supported (n=${body.n}). Set n=1 or omit the parameter.`
        );
    }

    // 3. Check for vision content (array format with images)
    for (const msg of body.messages) {
        if (Array.isArray(msg.content)) {
            throw buildValidationError(
                'Vision content (images) not supported. Only text messages are supported.'
            );
        }
    }

    return true;
}

/**
 * Translates OpenAI Chat Completions request to Ollama /api/generate format
 *
 * @param {Object} openaiReq - OpenAI request body
 * @param {Array<{role: string, content: string}>} openaiReq.messages - Messages array
 * @param {string} [openaiReq.model] - Model name
 * @param {number} [openaiReq.temperature] - Temperature (0-1)
 * @param {number} [openaiReq.max_tokens] - Max tokens to generate
 * @param {number} [openaiReq.top_p] - Top-p sampling (0-1)
 * @returns {Object} Ollama request body
 *
 * @example
 * translateRequestToOllama({
 *   messages: [
 *     { role: 'system', content: 'You are helpful' },
 *     { role: 'user', content: 'Say hi' }
 *   ],
 *   model: 'qwen3-coder-next',
 *   temperature: 0.7
 * })
 * // Returns: {
 * //   model: 'qwen3-coder-next',
 * //   prompt: 'System: You are helpful\nUser: Say hi',
 * //   stream: false,
 * //   options: { temperature: 0.7, num_predict: 1000, top_p: 0.9 }
 * // }
 */
export function translateRequestToOllama(openaiReq) {
    const { messages, model, temperature, max_tokens, top_p } = openaiReq;

    // Concatenate all messages into single prompt with role prefixes
    // Format: "Role: content\nRole: content\n..."
    const prompt = messages
        .map(msg => {
            // Map OpenAI roles to readable prefixes
            const rolePrefix = msg.role === 'system' ? 'System' :
                             msg.role === 'assistant' ? 'Assistant' :
                             'User';

            return `${rolePrefix}: ${msg.content}`;
        })
        .join('\n');

    return {
        model: model || 'qwen3-coder-next',
        prompt,
        stream: false,  // V1.0: no streaming support
        options: {
            temperature: temperature ?? 0.7,
            num_predict: max_tokens ?? 1000,
            top_p: top_p ?? 0.9
        }
    };
}

/**
 * Translates Ollama /api/generate response to OpenAI Chat Completions format
 *
 * @param {Object} ollamaResp - Ollama response body
 * @param {string} ollamaResp.response - Generated text
 * @param {string} ollamaResp.model - Model used
 * @param {Object} originalReq - Original OpenAI request (for token estimation)
 * @param {Array} originalReq.messages - Messages array
 * @returns {Object} OpenAI Chat Completions response
 *
 * @example
 * translateResponseToOpenAI(
 *   { response: 'Hello!', model: 'qwen3-coder-next' },
 *   { messages: [{ role: 'user', content: 'Hi' }] }
 * )
 * // Returns: {
 * //   id: 'chatcmpl-abc123',
 * //   object: 'chat.completion',
 * //   created: 1672531200,
 * //   model: 'qwen3-coder-next',
 * //   choices: [{
 * //     index: 0,
 * //     message: { role: 'assistant', content: 'Hello!' },
 * //     finish_reason: 'stop'
 * //   }],
 * //   usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
 * // }
 */
export function translateResponseToOpenAI(ollamaResp, originalReq) {
    const { response, model } = ollamaResp;

    // Estimate tokens using rough heuristic: words * 1.3
    // (Ollama doesn't return exact token counts)
    const promptWords = originalReq.messages.reduce((sum, msg) => {
        const content = msg.content || '';
        const words = content.split(/\s+/).filter(w => w.length > 0).length;
        return sum + words;
    }, 0);

    const completionWords = response.split(/\s+/).filter(w => w.length > 0).length;

    const promptTokens = Math.ceil(promptWords * 1.3);
    const completionTokens = Math.ceil(completionWords * 1.3);

    return {
        // Generate OpenAI-compatible ID
        id: `chatcmpl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'qwen3-coder-next',
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: response
            },
            finish_reason: 'stop'  // Ollama always completes fully (no length limit)
        }],
        usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
        }
    };
}

/**
 * Builds OpenAI-compatible error response
 *
 * @param {string} message - Error message
 * @param {string} [type='invalid_request_error'] - Error type
 * @param {number} [code=400] - HTTP status code
 * @returns {Object} OpenAI error object
 *
 * @example
 * buildOpenAIError('Missing model parameter', 'invalid_request_error', 400)
 * // Returns: {
 * //   error: {
 * //     message: 'Missing model parameter',
 * //     type: 'invalid_request_error',
 * //     code: 400
 * //   }
 * // }
 */
export function buildOpenAIError(message, type = 'invalid_request_error', code = 400) {
    return {
        error: {
            message,
            type,
            code
        }
    };
}

/**
 * Helper: Creates validation error with OpenAI error format attached
 * @private
 */
function buildValidationError(message) {
    const err = new Error(message);
    err.openaiError = buildOpenAIError(message, 'invalid_request_error', 400);
    err.statusCode = 400;
    return err;
}
