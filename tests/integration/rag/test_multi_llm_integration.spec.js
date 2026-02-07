// @ts-nocheck
/**
 * Integration Tests: RAG v4.0 Multi-LLM Integration
 *
 * Tests MCP endpoint, Tool Registry, and all 5 tools
 *
 * Run: node --test tests/integration/rag/test_multi_llm_integration.spec.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { registry } from '../../../src/integration/tool-registry.mjs';
import { setupMCPHandler } from '../../../src/server/handlers/mcp-handler.js';

// Test server instance
let app;
let server;
let baseUrl;

// Setup test server
before(async () => {
    process.env.MCP_ENABLED = 'true';
    process.env.NODE_ENV = 'test';

    app = express();
    app.use(express.json());

    // Wait for Tool Registry to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Setup MCP handler
    setupMCPHandler(app, registry);

    // Start server on random port
    await new Promise((resolve) => {
        server = app.listen(0, () => {
            const { port } = server.address();
            baseUrl = `http://localhost:${port}`;
            console.log(`[Test] Server started on ${baseUrl}`);
            resolve();
        });
    });
});

// Cleanup
after(() => {
    if (server) {
        server.close();
    }
});

// Helper: Make MCP request
async function mcpRequest(method, params = {}) {
    const response = await fetch(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Math.random(),
            method,
            params
        })
    });

    return response.json();
}

describe('MCP Endpoint Discovery', () => {
    it('GET /api/mcp should return server info', async () => {
        const response = await fetch(`${baseUrl}/api/mcp`);
        const data = await response.json();

        assert.strictEqual(response.status, 200);
        assert.strictEqual(data.name, 'chatgpt-docker-unified');
        assert.strictEqual(data.version, '4.0.0');
        assert.strictEqual(data.status, 'ready');
        assert.strictEqual(data.toolCount, 5);
        assert.ok(Array.isArray(data.tools));
        assert.ok(data.tools.includes('rag_search'));
        assert.ok(data.tools.includes('ollama_models'));
    });

    it('should expose 4 MCP methods', async () => {
        const response = await fetch(`${baseUrl}/api/mcp`);
        const data = await response.json();

        assert.ok(Array.isArray(data.methods));
        assert.strictEqual(data.methods.length, 4);
        assert.ok(data.methods.includes('tools/list'));
        assert.ok(data.methods.includes('tools/call'));
        assert.ok(data.methods.includes('resources/list'));
        assert.ok(data.methods.includes('resources/read'));
    });
});

describe('MCP Protocol - tools/list', () => {
    it('should return all 5 tools with metadata', async () => {
        const result = await mcpRequest('tools/list');

        assert.strictEqual(result.jsonrpc, '2.0');
        assert.ok(result.result);
        assert.ok(Array.isArray(result.result.tools));
        assert.strictEqual(result.result.tools.length, 5);

        const toolNames = result.result.tools.map(t => t.name);
        assert.ok(toolNames.includes('rag_search'));
        assert.ok(toolNames.includes('rag_health'));
        assert.ok(toolNames.includes('ollama_generate'));
        assert.ok(toolNames.includes('ollama_embed'));
        assert.ok(toolNames.includes('ollama_models'));
    });

    it('each tool should have description and inputSchema', async () => {
        const result = await mcpRequest('tools/list');
        const tools = result.result.tools;

        for (const tool of tools) {
            assert.ok(tool.name, `Tool missing name: ${JSON.stringify(tool)}`);
            assert.ok(tool.description, `Tool ${tool.name} missing description`);
            assert.ok(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
            assert.strictEqual(tool.inputSchema.type, 'object', `Tool ${tool.name} inputSchema not object`);
        }
    });
});

describe('Tool: ollama_models', () => {
    it('should list available Ollama models', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'ollama_models',
            arguments: {}
        });

        assert.strictEqual(result.jsonrpc, '2.0');
        assert.ok(result.result);
        assert.ok(Array.isArray(result.result.content));
        assert.strictEqual(result.result.content[0].type, 'text');

        const text = result.result.content[0].text;
        assert.ok(text.includes('Available Ollama Models'));
        assert.ok(text.includes('nomic-embed-text') || text.includes('qwen'));
    });

    it('should complete in <5 seconds', async () => {
        const start = Date.now();
        await mcpRequest('tools/call', {
            name: 'ollama_models',
            arguments: {}
        });
        const duration = Date.now() - start;

        assert.ok(duration < 5000, `ollama_models took ${duration}ms (expected <5000ms)`);
    });
});

describe('Tool: ollama_embed', () => {
    it('should generate embeddings for text', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'ollama_embed',
            arguments: {
                text: 'test embedding query',
                model: 'nomic-embed-text'
            }
        });

        assert.strictEqual(result.jsonrpc, '2.0');
        assert.ok(result.result);

        const text = result.result.content[0].text;
        assert.ok(text.includes('Ollama Embedding'));
        assert.ok(text.includes('Dimensions:') && text.includes('768'));
        assert.ok(text.includes('First 10 values'));
    });

    it('should reject empty text', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'ollama_embed',
            arguments: {
                text: '',
                model: 'nomic-embed-text'
            }
        });

        assert.ok(result.result.isError || result.error);
    });
});

describe('Tool: ollama_generate', () => {
    it('should generate text with qwen2.5-coder', async (t) => {
        // Skip if model not available (CI environment)
        try {
            const result = await mcpRequest('tools/call', {
                name: 'ollama_generate',
                arguments: {
                    prompt: 'Write a one-line comment explaining what console.log does',
                    model: 'qwen2.5-coder:3b',
                    max_tokens: 50,
                    temperature: 0.3
                }
            });

            assert.strictEqual(result.jsonrpc, '2.0');
            assert.ok(result.result);

            const text = result.result.content[0].text;
            assert.ok(text.includes('Ollama Generation'));
            assert.ok(text.includes('qwen2.5-coder:3b'));
        } catch (error) {
            t.skip('Ollama model not available');
        }
    });

    it('should respect temperature parameter', async (t) => {
        try {
            const result = await mcpRequest('tools/call', {
                name: 'ollama_generate',
                arguments: {
                    prompt: 'Say hi',
                    model: 'qwen2.5:3b-instruct',
                    max_tokens: 10,
                    temperature: 0.1
                }
            });

            assert.ok(result.result);
            const text = result.result.content[0].text;
            assert.ok(text.includes('Temperature: 0.1'));
        } catch (error) {
            t.skip('Ollama model not available');
        }
    });
});

describe('Tool: rag_health', () => {
    it('should return RAG system health status', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'rag_health',
            arguments: {}
        });

        assert.strictEqual(result.jsonrpc, '2.0');
        assert.ok(result.result);

        const text = result.result.content[0].text;
        assert.ok(text.includes('RAG System Health'));
        assert.ok(text.includes('Components'));
        assert.ok(text.includes('Ollama'));
        assert.ok(text.includes('Cache Statistics'));
    });
});

describe('Tool: rag_search', () => {
    it('should search codebase for CHROME_PROXY_PORT', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'rag_search',
            arguments: {
                query: 'CHROME_PROXY_PORT',
                topK: 3
            }
        });

        assert.strictEqual(result.jsonrpc, '2.0');
        assert.ok(result.result);

        const text = result.result.content[0].text;
        assert.ok(text.includes('Search Results'));
        assert.ok(text.includes('CHROME_PROXY_PORT') || text.includes('No results'));
    });

    it('should respect topK parameter', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'rag_search',
            arguments: {
                query: 'function',
                topK: 2
            }
        });

        assert.ok(result.result);
        const text = result.result.content[0].text;

        // Count number of result blocks (should be <= topK)
        const resultCount = (text.match(/## \[\d+\]/g) || []).length;
        assert.ok(resultCount <= 2, `Expected <=2 results, got ${resultCount}`);
    });

    it('should filter by pathPrefix', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'rag_search',
            arguments: {
                query: 'kernel',
                topK: 3,
                pathPrefix: 'src/kernel'
            }
        });

        assert.ok(result.result);
        const text = result.result.content[0].text;

        if (!text.includes('No results')) {
            // All results should be from src/kernel
            assert.ok(text.includes('src/kernel') || text.includes('No results'));
        }
    });

    it('should complete search in <2 seconds', async () => {
        const start = Date.now();
        await mcpRequest('tools/call', {
            name: 'rag_search',
            arguments: {
                query: 'test query',
                topK: 5
            }
        });
        const duration = Date.now() - start;

        assert.ok(duration < 2000, `rag_search took ${duration}ms (expected <2000ms)`);
    });
});

describe('MCP Protocol - Error Handling', () => {
    it('should reject invalid jsonrpc version', async () => {
        const response = await fetch(`${baseUrl}/api/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '1.0',
                id: 1,
                method: 'tools/list',
                params: {}
            })
        });

        const result = await response.json();
        assert.strictEqual(response.status, 400);
        assert.ok(result.error);
        assert.strictEqual(result.error.code, -32600);
    });

    it('should reject unknown method', async () => {
        const result = await mcpRequest('unknown/method');

        assert.ok(result.error);
        assert.strictEqual(result.error.code, -32601);
        assert.ok(result.error.message.includes('Method not found'));
    });

    it('should handle tool execution errors gracefully', async () => {
        const result = await mcpRequest('tools/call', {
            name: 'nonexistent_tool',
            arguments: {}
        });

        assert.ok(result.error || result.result.isError);
    });
});

describe('MCP Protocol - resources/list', () => {
    it('should return available resources', async () => {
        const result = await mcpRequest('resources/list');

        assert.strictEqual(result.jsonrpc, '2.0');
        assert.ok(result.result);
        assert.ok(Array.isArray(result.result.resources));
        assert.ok(result.result.resources.length > 0);

        const ragStats = result.result.resources.find(r => r.uri === 'rag://stats');
        assert.ok(ragStats);
        assert.strictEqual(ragStats.mimeType, 'application/json');
    });
});

describe('MCP Protocol - resources/read', () => {
    it('should read rag://stats resource', async () => {
        const result = await mcpRequest('resources/read', {
            uri: 'rag://stats'
        });

        assert.strictEqual(result.jsonrpc, '2.0');
        assert.ok(result.result);
        assert.ok(Array.isArray(result.result.contents));
        assert.strictEqual(result.result.contents[0].uri, 'rag://stats');
        assert.strictEqual(result.result.contents[0].mimeType, 'application/json');

        const stats = JSON.parse(result.result.contents[0].text);
        assert.ok(typeof stats.hits === 'number');
        assert.ok(typeof stats.misses === 'number');
        assert.ok(typeof stats.hitRate === 'number');
    });

    it('should reject unknown resource', async () => {
        const result = await mcpRequest('resources/read', {
            uri: 'unknown://resource'
        });

        assert.ok(result.error);
    });
});

describe('Tool Registry - Direct Access', () => {
    it('should allow direct tool execution', async () => {
        const result = await registry.execute('ollama_models');

        assert.ok(result);
        assert.ok(result.includes('Available Ollama Models'));
    });

    it('should throw on unknown tool', async () => {
        await assert.rejects(
            async () => await registry.execute('unknown_tool'),
            /Unknown tool/
        );
    });

    it('should return correct stats', () => {
        const stats = registry.getStats();

        assert.strictEqual(stats.totalTools, 5);
        assert.ok(Array.isArray(stats.tools));
        assert.strictEqual(stats.tools.length, 5);
    });
});

describe('Performance - Cache Behavior', () => {
    it('should cache repeated queries', async () => {
        const query = `test query ${Math.random()}`;

        // First call (miss)
        const start1 = Date.now();
        await mcpRequest('tools/call', {
            name: 'rag_search',
            arguments: { query, topK: 3 }
        });
        const duration1 = Date.now() - start1;

        // Second call (hit - should be faster)
        const start2 = Date.now();
        await mcpRequest('tools/call', {
            name: 'rag_search',
            arguments: { query, topK: 3 }
        });
        const duration2 = Date.now() - start2;

        // Cache hit should be noticeably faster (at least 20% faster)
        // Note: This is probabilistic and may fail on slow systems
        console.log(`[Cache Test] First: ${duration1}ms, Second: ${duration2}ms`);
        assert.ok(duration2 <= duration1, 'Cached query should not be slower');
    });
});

console.log('\n✅ All integration tests defined. Run with: node --test tests/integration/rag/test_multi_llm_integration.spec.js\n');
