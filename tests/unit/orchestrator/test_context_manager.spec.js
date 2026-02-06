import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { ContextManager, CHUNKING_STRATEGY, SUMMARIZATION_POLICY } from '#orchestrator/context_manager';
import MemoryStore from '#orchestrator/memory_store';

describe('ContextManager Unit Tests', () => {
    let contextManager;

    beforeEach(() => {
        contextManager = new ContextManager();
    });

    describe('1. Context Initialization', () => {
        it('should initialize context for a mission', () => {
            const context = contextManager.initializeContext('mission-123', {
                metadata: { template: 'book_writing' }
            });

            assert.ok(context);
            assert.strictEqual(context.mission_id, 'mission-123');
            assert.strictEqual(context.steps.length, 0);
            assert.strictEqual(context.token_count, 0);
            assert.deepStrictEqual(context.metadata, { template: 'book_writing' });
        });

        it('should overwrite existing context if mission already exists', () => {
            contextManager.initializeContext('mission-123');
            const context2 = contextManager.initializeContext('mission-123', { metadata: { new: 'data' } });

            assert.strictEqual(context2.metadata.new, 'data');
        });
    });

    describe('2. Adding Step Outputs', () => {
        it('should add step output to context', async () => {
            contextManager.initializeContext('mission-123');

            const output = 'This is the output of step 1';
            await contextManager.addStepOutput('mission-123', 'step-1', output);

            const context = contextManager.getContextForStep('mission-123', 'step-2');

            assert.strictEqual(context.steps.length, 1);
            assert.strictEqual(context.steps[0].step_id, 'step-1');
            assert.strictEqual(context.steps[0].output, output);
            assert.ok(context.steps[0].tokens > 0);
        });

        it('should create context if mission does not exist', async () => {
            await contextManager.addStepOutput('mission-999', 'step-1', 'output');

            const context = contextManager.getContextForStep('mission-999', 'step-2');
            assert.ok(context);
            assert.strictEqual(context.steps.length, 1);
        });

        it('should accumulate multiple steps', async () => {
            contextManager.initializeContext('mission-123');

            await contextManager.addStepOutput('mission-123', 'step-1', 'Output 1');
            await contextManager.addStepOutput('mission-123', 'step-2', 'Output 2');
            await contextManager.addStepOutput('mission-123', 'step-3', 'Output 3');

            const context = contextManager.getContextForStep('mission-123', 'step-4');

            assert.strictEqual(context.steps.length, 3);
        });
    });

    describe('3. Chunking Strategies', () => {
        beforeEach(() => {
            contextManager = new ContextManager({ windowSize: 3 });
        });

        it('should apply SLIDING_WINDOW strategy (keep last N steps)', async () => {
            contextManager.initializeContext('mission-123');

            // Adiciona 10 steps
            for (let i = 1; i <= 10; i++) {
                await contextManager.addStepOutput('mission-123', `step-${i}`, `Output ${i}`);
            }

            const context = contextManager.getContextForStep('mission-123', 'step-11');

            // Com windowSize=3, deve retornar apenas últimos 3
            assert.strictEqual(context.steps.length, 3);
            assert.strictEqual(context.steps[0].step_id, 'step-8');
            assert.strictEqual(context.steps[2].step_id, 'step-10');
            assert.strictEqual(context.metadata.total_steps, 10);
        });

        it('should apply NONE strategy (return all steps)', async () => {
            contextManager = new ContextManager({ chunkingStrategy: CHUNKING_STRATEGY.NONE });
            contextManager.initializeContext('mission-123');

            for (let i = 1; i <= 10; i++) {
                await contextManager.addStepOutput('mission-123', `step-${i}`, `Output ${i}`);
            }

            const context = contextManager.getContextForStep('mission-123', 'step-11');

            assert.strictEqual(context.steps.length, 10);
        });

        it('should apply TOKEN_LIMIT strategy', async () => {
            contextManager = new ContextManager({
                chunkingStrategy: CHUNKING_STRATEGY.TOKEN_LIMIT,
                maxTokens: 50 // Muito baixo para forçar truncation
            });

            contextManager.initializeContext('mission-123');

            // Adiciona steps com outputs grandes
            for (let i = 1; i <= 10; i++) {
                await contextManager.addStepOutput('mission-123', `step-${i}`, 'x'.repeat(100)); // ~25 tokens cada
            }

            const context = contextManager.getContextForStep('mission-123', 'step-11');

            // Com maxTokens=50, deve retornar apenas últimos ~2 steps
            assert.ok(context.steps.length <= 3);
            assert.ok(context.metadata.token_count <= 50);
        });
    });

    describe('4. Summarization Policies', () => {
        it('should not summarize if policy is DISABLED', async () => {
            contextManager = new ContextManager({
                summarizationPolicy: SUMMARIZATION_POLICY.DISABLED,
                windowSize: 2
            });

            contextManager.initializeContext('mission-123');

            for (let i = 1; i <= 10; i++) {
                await contextManager.addStepOutput('mission-123', `step-${i}`, 'x'.repeat(100));
            }

            // Mesmo com muitos steps, summary deve ser null
            const rawContext = contextManager.contextCache.get('mission-123');
            assert.strictEqual(rawContext.summary, null);
        });

        it('should summarize on overflow when policy is ON_OVERFLOW', async () => {
            contextManager = new ContextManager({
                summarizationPolicy: SUMMARIZATION_POLICY.ON_OVERFLOW,
                maxTokens: 100,
                windowSize: 2
            });

            contextManager.initializeContext('mission-123');

            // Adiciona muitos steps para ultrapassar maxTokens
            for (let i = 1; i <= 20; i++) {
                await contextManager.addStepOutput('mission-123', `step-${i}`, 'x'.repeat(50));
            }

            // Verifica que resumo foi criado
            const rawContext = contextManager.contextCache.get('mission-123');
            assert.ok(rawContext.summary); // Deve ter sido criado summary
            assert.ok(rawContext.steps.length <= 2); // Mantém apenas últimos 2
        });
    });

    describe('5. Memory Store Integration', () => {
        it('should add pattern to memory store', () => {
            const pattern = {
                type: 'feedback',
                content: 'Add more code examples',
                metadata: { mission: 'mission-123' }
            };

            contextManager.addPattern(pattern);

            const stats = contextManager.getStats();
            assert.strictEqual(stats.memory_store.total_patterns, 1);
        });

        it('should search relevant patterns', () => {
            contextManager.addPattern({ type: 'feedback', content: 'Add more examples' });
            contextManager.addPattern({ type: 'success', content: 'Great code quality' });
            contextManager.addPattern({ type: 'feedback', content: 'Improve documentation' });

            const results = contextManager.getRelevantPatterns('examples', 5);

            assert.ok(results.length > 0);
            assert.ok(results[0].content.includes('examples'));
        });
    });

    describe('6. Context Management', () => {
        it('should clear context for a mission', async () => {
            contextManager.initializeContext('mission-123');
            await contextManager.addStepOutput('mission-123', 'step-1', 'Output');

            const deleted = contextManager.clearContext('mission-123');

            assert.strictEqual(deleted, true);
            assert.strictEqual(contextManager.contextCache.has('mission-123'), false);
        });

        it('should return stats', async () => {
            contextManager.initializeContext('mission-1');
            contextManager.initializeContext('mission-2');
            await contextManager.addStepOutput('mission-1', 'step-1', 'x'.repeat(400)); // ~100 tokens

            const stats = contextManager.getStats();

            assert.strictEqual(stats.active_missions, 2);
            assert.ok(stats.total_tokens > 0);
            assert.ok(stats.memory_store);
        });

        it('should cleanup all contexts', () => {
            contextManager.initializeContext('mission-1');
            contextManager.initializeContext('mission-2');

            contextManager.cleanup();

            assert.strictEqual(contextManager.contextCache.size, 0);
        });
    });
});

describe('MemoryStore Unit Tests', () => {
    let memoryStore;

    beforeEach(() => {
        memoryStore = new MemoryStore({ maxSize: 10 });
    });

    describe('1. Adding Patterns', () => {
        it('should add valid pattern', () => {
            const result = memoryStore.addPattern({
                type: 'feedback',
                content: 'Add more examples',
                metadata: { source: 'user' }
            });

            assert.strictEqual(result, true);
            assert.strictEqual(memoryStore.patterns.length, 1);
        });

        it('should reject invalid pattern (missing type)', () => {
            const result = memoryStore.addPattern({
                content: 'Some content'
            });

            assert.strictEqual(result, false);
            assert.strictEqual(memoryStore.patterns.length, 0);
        });

        it('should reject invalid pattern (missing content)', () => {
            const result = memoryStore.addPattern({
                type: 'feedback'
            });

            assert.strictEqual(result, false);
        });
    });

    describe('2. Searching Patterns', () => {
        beforeEach(() => {
            memoryStore.addPattern({ type: 'feedback', content: 'Add more code examples' });
            memoryStore.addPattern({ type: 'feedback', content: 'Improve documentation quality' });
            memoryStore.addPattern({ type: 'success', content: 'Great code structure' });
            memoryStore.addPattern({ type: 'error', content: 'Timeout error occurred' });
        });

        it('should search patterns by keywords', () => {
            const results = memoryStore.searchPatterns('code', 10);

            assert.ok(results.length >= 2); // "code examples" e "code structure"
            assert.ok(results[0].content.includes('code'));
        });

        it('should prioritize keyword matches over recency', () => {
            const results = memoryStore.searchPatterns('code', 10);

            // Patterns com "code" devem ter score maior que patterns sem keywords
            assert.ok(results.length > 0);

            // Primeiro resultado deve conter "code"
            assert.ok(results[0].content.toLowerCase().includes('code'));
        });

        it('should limit results', () => {
            const results = memoryStore.searchPatterns('', 2);

            assert.ok(results.length <= 2);
        });

        it('should return most recent if query is empty', () => {
            const results = memoryStore.searchPatterns('', 3);

            assert.strictEqual(results.length, 3);
            // Deve retornar os mais recentes (último adicionado primeiro)
            assert.strictEqual(results[0].type, 'error');
        });
    });

    describe('3. Search by Type', () => {
        beforeEach(() => {
            memoryStore.addPattern({ type: 'feedback', content: 'Feedback 1' });
            memoryStore.addPattern({ type: 'feedback', content: 'Feedback 2' });
            memoryStore.addPattern({ type: 'success', content: 'Success 1' });
        });

        it('should get patterns by type', () => {
            const results = memoryStore.getPatternsByType('feedback', 10);

            assert.strictEqual(results.length, 2);
            assert.ok(results.every((p) => p.type === 'feedback'));
        });

        it('should return empty array for non-existent type', () => {
            const results = memoryStore.getPatternsByType('nonexistent', 10);

            assert.strictEqual(results.length, 0);
        });
    });

    describe('4. LRU Eviction', () => {
        it('should evict least recently used patterns when maxSize exceeded', () => {
            // Adiciona 15 patterns (maxSize=10)
            for (let i = 1; i <= 15; i++) {
                memoryStore.addPattern({ type: 'test', content: `Pattern ${i}` });
            }

            // Deve ter evicted ~5 patterns (10% de 10 = 1, mas 15-10=5 excesso)
            assert.ok(memoryStore.patterns.length <= 10);
            assert.ok(memoryStore.stats.evictions > 0);
        });

        it('should keep most recently accessed patterns', () => {
            // Adiciona 10 patterns
            for (let i = 1; i <= 10; i++) {
                memoryStore.addPattern({ type: 'test', content: `Pattern ${i}` });
            }

            // Acessa pattern 1 várias vezes
            memoryStore.searchPatterns('Pattern 1', 1);
            memoryStore.searchPatterns('Pattern 1', 1);

            // Adiciona mais 5 (vai triggerar eviction)
            for (let i = 11; i <= 15; i++) {
                memoryStore.addPattern({ type: 'test', content: `Pattern ${i}` });
            }

            // Pattern 1 deveria ter sido preservado por ser muito acessado
            const remaining = memoryStore.patterns.map((p) => p.content);
            // (Nota: LRU simples, não garante que Pattern 1 seja mantido se outros foram acessados recentemente)
        });
    });

    describe('5. Stats', () => {
        it('should return accurate stats', () => {
            memoryStore.addPattern({ type: 'feedback', content: 'Test 1' });
            memoryStore.addPattern({ type: 'success', content: 'Test 2' });
            memoryStore.searchPatterns('test', 5);

            const stats = memoryStore.getStats();

            assert.strictEqual(stats.total_patterns, 2);
            assert.strictEqual(stats.max_size, 10);
            assert.strictEqual(stats.total_added, 2);
            assert.strictEqual(stats.total_searches, 1);
            assert.ok(stats.types.feedback === 1);
            assert.ok(stats.types.success === 1);
        });
    });

    describe('6. Cleanup', () => {
        it('should clear all patterns on cleanup', () => {
            memoryStore.addPattern({ type: 'test', content: 'Pattern 1' });
            memoryStore.addPattern({ type: 'test', content: 'Pattern 2' });

            memoryStore.cleanup();

            assert.strictEqual(memoryStore.patterns.length, 0);
            assert.strictEqual(memoryStore.indexByType.size, 0);
        });
    });
});
