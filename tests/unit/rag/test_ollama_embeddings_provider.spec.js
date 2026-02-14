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
});
