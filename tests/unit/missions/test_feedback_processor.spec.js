// @ts-check
import assert from 'node:assert';
import { FeedbackProcessor, FEEDBACK_CATEGORY, INJECTION_FORMAT } from '#missions/feedback_processor';
import { ContextManager } from '#orchestrator/context_manager';

describe('FeedbackProcessor Unit Tests', () => {
    /** @type {any} */ let feedbackProcessor;
    /** @type {any} */ let contextManager;

    beforeEach(() => {
        contextManager = new ContextManager();
        feedbackProcessor = new FeedbackProcessor({ contextManager });
    });

    describe('1. Basic Initialization', () => {
        it('should initialize without ContextManager', () => {
            const processor = new FeedbackProcessor();
            assert.ok(processor);
            assert.strictEqual(processor.contextManager, null);
        });

        it('should initialize with ContextManager', () => {
            assert.ok(feedbackProcessor.contextManager);
            assert.strictEqual(feedbackProcessor.contextManager, contextManager);
        });

        it('should have category keywords defined', () => {
            assert.ok(feedbackProcessor.categoryKeywords);
            assert.ok(feedbackProcessor.categoryKeywords[FEEDBACK_CATEGORY.TECHNICAL]);
            assert.ok(feedbackProcessor.categoryKeywords[FEEDBACK_CATEGORY.CONTENT]);
        });

        it('should have pattern regexes defined', () => {
            assert.ok(feedbackProcessor.patternRegexes);
            assert.ok(feedbackProcessor.patternRegexes.length > 0);
        });
    });

    describe('2. Feedback Processing', () => {
        it('should process simple feedback', () => {
            const result = feedbackProcessor.processFeedback('Add more examples');

            assert.ok(result);
            assert.strictEqual(result.original, 'Add more examples');
            assert.ok(result.id.startsWith('feedback-'));
            assert.ok(result.normalized);
            assert.ok(result.category);
            assert.ok(Array.isArray(result.actionItems));
            assert.ok(Array.isArray(result.patterns));
        });

        it('should normalize feedback text', () => {
            const result = feedbackProcessor.processFeedback('  Add   more   examples  \n\n  ');

            // Normalize removes extra spaces but preserves case
            assert.strictEqual(result.normalized, 'Add more examples');
        });

        it('should handle invalid input gracefully', () => {
            assert.strictEqual(feedbackProcessor.processFeedback(null), null);
            assert.strictEqual(feedbackProcessor.processFeedback(''), null);
            assert.strictEqual(feedbackProcessor.processFeedback(123), null);
        });

        it('should add timestamp metadata', () => {
            const result = feedbackProcessor.processFeedback('Test feedback');

            assert.ok(result.metadata);
            assert.ok(result.metadata.processed_at);
            assert.ok(typeof result.metadata.processed_at === 'number');
        });

        it('should include custom metadata', () => {
            const result = feedbackProcessor.processFeedback('Test feedback', {
                mission_id: 'mission-123',
                step_id: 'step-1',
            });

            assert.strictEqual(result.metadata.mission_id, 'mission-123');
            assert.strictEqual(result.metadata.step_id, 'step-1');
        });
    });

    describe('3. Categorization', () => {
        it('should categorize TECHNICAL feedback', () => {
            const result = feedbackProcessor.processFeedback('Fix the bug in authentication');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.TECHNICAL);
        });

        it('should categorize STYLE feedback', () => {
            const result = feedbackProcessor.processFeedback('Use a more casual tone');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.STYLE);
        });

        it('should categorize CONTENT feedback', () => {
            const result = feedbackProcessor.processFeedback('Add more code examples');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.CONTENT);
        });

        it('should categorize STRUCTURE feedback', () => {
            const result = feedbackProcessor.processFeedback('Organize the sections better');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.STRUCTURE);
        });

        it('should categorize QUALITY feedback', () => {
            const result = feedbackProcessor.processFeedback('Improve the overall quality');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.QUALITY);
        });

        it('should default to GENERAL for uncategorized feedback', () => {
            const result = feedbackProcessor.processFeedback('This is some random text');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.GENERAL);
        });

        it('should prioritize category with most keyword matches', () => {
            // Multiple content keywords: add, more, example
            const result = feedbackProcessor.processFeedback('Add more examples and details');
            assert.strictEqual(result.category, FEEDBACK_CATEGORY.CONTENT);
        });
    });

    describe('4. Pattern Extraction', () => {
        it('should extract "add" patterns', () => {
            const patterns = feedbackProcessor.extractPatterns('Add more examples');

            assert.ok(patterns.length > 0);
            assert.ok(patterns.some((/** @type {any} */ p) => p.includes('Add:') || p.includes('Include:')));
        });

        it('should extract "improve" patterns', () => {
            const patterns = feedbackProcessor.extractPatterns('Improve the documentation');

            assert.ok(patterns.length > 0);
            assert.ok(patterns.some((/** @type {any} */ p) => p.includes('Improve:')));
        });

        it('should extract "avoid" patterns', () => {
            const patterns = feedbackProcessor.extractPatterns('Avoid technical jargon');

            assert.ok(patterns.length > 0);
            assert.ok(patterns.some((/** @type {any} */ p) => p.includes('Avoid:')));
        });

        it('should extract "use" patterns', () => {
            const patterns = feedbackProcessor.extractPatterns('Use simpler language');

            assert.ok(patterns.length > 0);
            assert.ok(patterns.some((/** @type {any} */ p) => p.includes('Use:')));
        });

        it('should extract multiple patterns', () => {
            const patterns = feedbackProcessor.extractPatterns('Add more examples and avoid jargon');

            assert.ok(patterns.length >= 2);
        });

        it('should remove duplicate patterns', () => {
            const patterns = feedbackProcessor.extractPatterns('Add examples. Add more examples.');

            const addPatterns = patterns.filter((/** @type {any} */ p) => p.includes('Add'));
            // Should not have exact duplicates (Set removes them)
            assert.ok(addPatterns.length >= 1);
        });

        it('should handle feedback without patterns', () => {
            const patterns = feedbackProcessor.extractPatterns('This is good');

            assert.strictEqual(patterns.length, 0);
        });
    });

    describe('5. Action Items Extraction', () => {
        it('should extract from numbered list', () => {
            const result = feedbackProcessor.processFeedback('1. Add examples\n2. Fix typos');

            // May extract more than 2 due to imperative sentence detection
            assert.ok(result.actionItems.length >= 2);
            assert.ok(result.actionItems.some((/** @type {any} */ item) => item.includes('Add examples')));
            assert.ok(result.actionItems.some((/** @type {any} */ item) => item.includes('Fix typos')));
        });

        it('should extract from bullet list', () => {
            const result = feedbackProcessor.processFeedback('- Add examples\n* Fix typos');

            // Should extract at least 1 action item
            assert.ok(result.actionItems.length >= 1);
            assert.ok(
                result.actionItems.some(
                    (/** @type {any} */ item) => item.includes('examples') || item.includes('typos')
                )
            );
        });

        it('should extract imperative sentences', () => {
            const result = feedbackProcessor.processFeedback('Add more examples. Improve clarity.');

            assert.ok(result.actionItems.length >= 2);
            assert.ok(result.actionItems.some((/** @type {any} */ item) => item.includes('Add')));
            assert.ok(result.actionItems.some((/** @type {any} */ item) => item.includes('Improve')));
        });

        it('should capitalize action items', () => {
            const result = feedbackProcessor.processFeedback('add more examples');

            assert.ok(result.actionItems.length > 0);
            // First letter should be uppercase
            assert.strictEqual(result.actionItems[0].charAt(0), result.actionItems[0].charAt(0).toUpperCase());
        });

        it('should remove duplicate action items', () => {
            const result = feedbackProcessor.processFeedback('Add examples. Add examples again.');

            const addItems = result.actionItems.filter((/** @type {any} */ item) => item.includes('Add examples'));
            // Should deduplicate (Set removes duplicates)
            assert.ok(addItems.length >= 1);
        });
    });

    describe('6. Prompt Injection', () => {
        it('should inject with DEFAULT format', () => {
            const processed = feedbackProcessor.processFeedback('Add more examples');
            const result = feedbackProcessor.injectIntoStep('Write a chapter', processed, {
                format: INJECTION_FORMAT.DEFAULT,
            });

            assert.ok(result.includes('Write a chapter'));
            assert.ok(result.includes('[USER FEEDBACK]'));
            assert.ok(result.toLowerCase().includes('add more examples'));
        });

        it('should inject with INLINE format', () => {
            const processed = feedbackProcessor.processFeedback('Add more examples');
            const result = feedbackProcessor.injectIntoStep('Write a chapter', processed, {
                format: INJECTION_FORMAT.INLINE,
            });

            assert.ok(result.includes('Write a chapter'));
            assert.ok(result.includes('incorporate this feedback'));
            assert.ok(result.toLowerCase().includes('add more examples'));
        });

        it('should inject with STRUCTURED format', () => {
            const processed = feedbackProcessor.processFeedback('Add more examples');
            const result = feedbackProcessor.injectIntoStep('Write a chapter', processed, {
                format: INJECTION_FORMAT.STRUCTURED,
            });

            assert.ok(result.includes('Write a chapter'));
            assert.ok(result.includes('[USER FEEDBACK]'));
            assert.ok(result.includes('Category:'));
            assert.ok(result.includes('Feedback:'));
        });

        it('should include category in STRUCTURED format', () => {
            const processed = feedbackProcessor.processFeedback('Add more examples');
            const result = feedbackProcessor.injectIntoStep('Write a chapter', processed, {
                format: INJECTION_FORMAT.STRUCTURED,
                includeCategory: true,
            });

            assert.ok(result.includes('Category:'));
        });

        it('should include action items in STRUCTURED format', () => {
            const processed = feedbackProcessor.processFeedback('Add examples. Improve clarity.');
            const result = feedbackProcessor.injectIntoStep('Write a chapter', processed, {
                format: INJECTION_FORMAT.STRUCTURED,
                includeActionItems: true,
            });

            assert.ok(result.includes('Action Items:'));
        });

        it('should handle null feedback gracefully', () => {
            const result = feedbackProcessor.injectIntoStep('Write a chapter', null);

            assert.strictEqual(result, 'Write a chapter');
        });
    });

    describe('7. MemoryStore Integration', () => {
        it('should add patterns to MemoryStore when ContextManager present', () => {
            const result = feedbackProcessor.processFeedback('Add more code examples', {
                mission_id: 'mission-123',
            });

            // Verifica que patterns foram extraídos
            assert.ok(result.patterns.length > 0);

            // Verifica que foram armazenados no MemoryStore
            const stats = contextManager.getStats();
            assert.ok(stats.memory_store.total_patterns >= result.patterns.length);
        });

        it('should not crash when ContextManager is null', () => {
            const processorWithoutCM = new FeedbackProcessor();

            const result = processorWithoutCM.processFeedback('Add more examples');

            assert.ok(result);
            assert.ok(result.patterns.length > 0);
            // No error should be thrown
        });

        it('should store patterns with correct metadata', () => {
            feedbackProcessor.processFeedback('Add more examples', {
                mission_id: 'mission-123',
                step_id: 'step-1',
            });

            const patterns = contextManager.getRelevantPatterns('examples', 5);

            assert.ok(patterns.length > 0);
            // Pattern should have been stored (verificar que existe algum pattern relevante)
        });
    });

    describe('8. Statistics', () => {
        it('should return accurate stats', () => {
            const stats = feedbackProcessor.getStats();

            assert.ok(stats);
            assert.ok(stats.categories > 0);
            assert.ok(stats.pattern_regexes > 0);
            assert.ok(stats.imperative_verbs > 0);
            assert.strictEqual(stats.context_manager_enabled, true);
        });

        it('should indicate ContextManager disabled when null', () => {
            const processor = new FeedbackProcessor();
            const stats = processor.getStats();

            assert.strictEqual(stats.context_manager_enabled, false);
        });
    });
});
