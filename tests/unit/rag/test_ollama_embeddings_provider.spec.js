// @ts-check
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { OllamaEmbeddingsProvider } from '../../../tools/rag/lib/embeddings/ollama.mjs';

describe('OllamaEmbeddingsProvider baseURL resolution', () => {
    it('never builds undefined/v1 when env is missing', () => {
        const prev = process.env.OLLAMA_LOCAL_BASE_URL;
        try {
            delete process.env.OLLAMA_LOCAL_BASE_URL;
            const provider = new OllamaEmbeddingsProvider();
            assert.ok(provider.baseURL);
            assert.ok(!provider.baseURL.includes('undefined/v1'));
            assert.ok(provider.baseURL.endsWith('/v1'));
        } finally {
            if (prev === undefined) {
                delete process.env.OLLAMA_LOCAL_BASE_URL;
            } else {
                process.env.OLLAMA_LOCAL_BASE_URL = prev;
            }
        }
    });

    it('normalizes env URL without /v1 suffix', () => {
        const prev = process.env.OLLAMA_LOCAL_BASE_URL;
        try {
            process.env.OLLAMA_LOCAL_BASE_URL = 'http://localhost:11434';
            const provider = new OllamaEmbeddingsProvider();
            assert.strictEqual(provider.baseURL, 'http://localhost:11434/v1');
        } finally {
            if (prev === undefined) {
                delete process.env.OLLAMA_LOCAL_BASE_URL;
            } else {
                process.env.OLLAMA_LOCAL_BASE_URL = prev;
            }
        }
    });

    it('normalizes options.baseURL and keeps priority over env', () => {
        const prev = process.env.OLLAMA_LOCAL_BASE_URL;
        try {
            process.env.OLLAMA_LOCAL_BASE_URL = 'http://localhost:11434';
            const provider = new OllamaEmbeddingsProvider({ baseURL: 'http://host.docker.internal:22434/' });
            assert.strictEqual(provider.baseURL, 'http://host.docker.internal:22434/v1');
        } finally {
            if (prev === undefined) {
                delete process.env.OLLAMA_LOCAL_BASE_URL;
            } else {
                process.env.OLLAMA_LOCAL_BASE_URL = prev;
            }
        }
    });

    it('uses OLLAMA_EMBED_MAX_CHARS and truncates when input exceeds configured limit', async () => {
        const prevMax = process.env.OLLAMA_EMBED_MAX_CHARS;
        const prevFetch = global.fetch;
        let receivedInputLength = 0;
        try {
            process.env.OLLAMA_EMBED_MAX_CHARS = '50';
            /** @type {any} */ (global).fetch = async (/** @type {any} */ _url, /** @type {any} */ options = {}) => {
                const body = JSON.parse(options.body || '{}');
                if (typeof body.input === 'string') {
                    receivedInputLength = body.input.length;
                }
                return {
                    ok: true,
                    async json() {
                        return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
                    },
                };
            };
            const provider = new OllamaEmbeddingsProvider();
            await provider.embed('x'.repeat(120));
            assert.strictEqual(provider.maxChars, 50);
            assert.strictEqual(receivedInputLength, 50);
        } finally {
            global.fetch = prevFetch;
            if (prevMax === undefined) {
                delete process.env.OLLAMA_EMBED_MAX_CHARS;
            } else {
                process.env.OLLAMA_EMBED_MAX_CHARS = prevMax;
            }
        }
    });

    it('falls back to default max chars when OLLAMA_EMBED_MAX_CHARS is invalid', () => {
        const prevMax = process.env.OLLAMA_EMBED_MAX_CHARS;
        try {
            process.env.OLLAMA_EMBED_MAX_CHARS = 'invalid';
            const provider = new OllamaEmbeddingsProvider();
            assert.strictEqual(provider.maxChars, 8000);
        } finally {
            if (prevMax === undefined) {
                delete process.env.OLLAMA_EMBED_MAX_CHARS;
            } else {
                process.env.OLLAMA_EMBED_MAX_CHARS = prevMax;
            }
        }
    });

    it('auto-reduces payload when Ollama reports context length overflow', async () => {
        const prevMax = process.env.OLLAMA_EMBED_MAX_CHARS;
        const prevFastShrink = process.env.OLLAMA_EMBED_CONTEXT_FAST_SHRINK;
        const prevFetch = global.fetch;
        /** @type {any[]} */ const attempts = [];
        try {
            process.env.OLLAMA_EMBED_MAX_CHARS = '8000';
            process.env.OLLAMA_EMBED_CONTEXT_FAST_SHRINK = 'true';
            /** @type {any} */ (global).fetch = async (/** @type {any} */ _url, /** @type {any} */ options = {}) => {
                const body = JSON.parse(options.body || '{}');
                const size = String(body.input || '').length;
                attempts.push(size);
                if (size > 2000) {
                    return {
                        ok: false,
                        status: 400,
                        async text() {
                            return '{"error":{"message":"the input length exceeds the context length"}}';
                        },
                    };
                }
                return {
                    ok: true,
                    async json() {
                        return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
                    },
                };
            };
            const provider = new OllamaEmbeddingsProvider();
            const vector = await provider.embed('x'.repeat(6000));
            assert.deepStrictEqual(vector, [0.1, 0.2, 0.3]);
            assert.deepStrictEqual(
                attempts.filter((size) => size > 2000),
                [6000, 4200, 2940, 2058],
                'context overflow must shrink immediately without retrying same size',
            );
            assert.strictEqual(provider.runtimeSafeChars, 1440);

            attempts.length = 0;
            const vector2 = await provider.embed('y'.repeat(6000));
            assert.deepStrictEqual(vector2, [0.1, 0.2, 0.3]);
            assert.strictEqual(attempts[0], 1440, 'subsequent calls should reuse learned runtime_safe_chars');
        } finally {
            global.fetch = prevFetch;
            if (prevMax === undefined) {
                delete process.env.OLLAMA_EMBED_MAX_CHARS;
            } else {
                process.env.OLLAMA_EMBED_MAX_CHARS = prevMax;
            }
            if (prevFastShrink === undefined) {
                delete process.env.OLLAMA_EMBED_CONTEXT_FAST_SHRINK;
            } else {
                process.env.OLLAMA_EMBED_CONTEXT_FAST_SHRINK = prevFastShrink;
            }
        }
    });
});
