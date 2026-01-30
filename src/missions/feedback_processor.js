/* ==========================================================================
   src/missions/feedback_processor.js
   Audit Level: 100 — Feedback Processing Engine (V2.0)
   Status: PRODUCTION READY
   Responsabilidade: Processar feedback textual, extrair patterns, injetar em steps.

   Funcionalidades:
   - Processar e categorizar feedback do usuário
   - Extrair action items e patterns reutilizáveis
   - Integração com MemoryStore via ContextManager
   - Injeção inteligente de feedback em prompts
========================================================================== */

const logger = require('@core/logger');

/**
 * Categorias de feedback reconhecidas pelo sistema.
 */
const FEEDBACK_CATEGORY = {
    TECHNICAL: 'TECHNICAL',       // Bugs, errors, technical issues
    STYLE: 'STYLE',               // Format, tone, writing style
    CONTENT: 'CONTENT',           // Add content, examples, details
    STRUCTURE: 'STRUCTURE',       // Organization, sections, flow
    QUALITY: 'QUALITY',           // Improve overall quality
    GENERAL: 'GENERAL'            // Uncategorized feedback
};

/**
 * Formatos de injeção de feedback em prompts.
 */
const INJECTION_FORMAT = {
    DEFAULT: 'default',           // Feedback em seção separada
    INLINE: 'inline',             // Feedback inline no prompt
    STRUCTURED: 'structured'      // Feedback estruturado com action items
};

/**
 * FeedbackProcessor - Processa feedback do usuário e integra com sistema.
 *
 * Responsabilidades:
 * 1. Receber feedback textual bruto
 * 2. Normalizar e categorizar
 * 3. Extrair action items
 * 4. Identificar patterns reutilizáveis
 * 5. Armazenar no MemoryStore (via ContextManager)
 * 6. Injetar de forma inteligente em prompts
 *
 * Integração:
 * - MissionManager.addFeedback() → FeedbackProcessor.processFeedback()
 * - FeedbackProcessor → ContextManager.addPattern() → MemoryStore
 * - Task generation → FeedbackProcessor.injectIntoStep()
 */
class FeedbackProcessor {
    /**
     * @param {Object} options
     * @param {Object} [options.contextManager] - ContextManager para armazenar patterns
     */
    constructor({ contextManager = null } = {}) {
        this.contextManager = contextManager;

        // Keywords para categorização automática
        this.categoryKeywords = {
            [FEEDBACK_CATEGORY.TECHNICAL]: [
                'bug', 'error', 'fix', 'issue', 'crash', 'fail', 'broken',
                'exception', 'timeout', 'undefined', 'null'
            ],
            [FEEDBACK_CATEGORY.STYLE]: [
                'format', 'style', 'tone', 'voice', 'casual', 'formal',
                'professional', 'friendly', 'concise', 'verbose'
            ],
            [FEEDBACK_CATEGORY.CONTENT]: [
                'add', 'include', 'more', 'detail', 'example', 'explain',
                'describe', 'expand', 'elaborate', 'cover', 'missing'
            ],
            [FEEDBACK_CATEGORY.STRUCTURE]: [
                'organize', 'structure', 'section', 'chapter', 'order',
                'arrangement', 'hierarchy', 'flow', 'sequence'
            ],
            [FEEDBACK_CATEGORY.QUALITY]: [
                'improve', 'enhance', 'better', 'quality', 'polish',
                'refine', 'optimize', 'upgrade'
            ]
        };

        // Regex patterns para extração de patterns
        this.patternRegexes = [
            { regex: /add (?:more )?(.+?)(?:\.|$)/gi, template: 'Add: {match}' },
            { regex: /include (.+?)(?:\.|$)/gi, template: 'Include: {match}' },
            { regex: /improve (.+?)(?:\.|$)/gi, template: 'Improve: {match}' },
            { regex: /(?:use|prefer) (.+?)(?:\.|$)/gi, template: 'Use: {match}' },
            { regex: /avoid (.+?)(?:\.|$)/gi, template: 'Avoid: {match}' },
            { regex: /remove (.+?)(?:\.|$)/gi, template: 'Remove: {match}' },
            { regex: /fix (.+?)(?:\.|$)/gi, template: 'Fix: {match}' },
            { regex: /change (.+?)(?:\.|$)/gi, template: 'Change: {match}' }
        ];

        // Verbos imperativos comuns em feedback
        this.imperativeVerbs = [
            'add', 'include', 'improve', 'fix', 'change', 'remove', 'update',
            'enhance', 'avoid', 'use', 'prefer', 'ensure', 'make', 'create',
            'explain', 'describe', 'organize', 'refactor', 'optimize'
        ];

        logger.info('[FeedbackProcessor] Initialized with ContextManager support');
    }

    /**
     * Processa feedback textual bruto do usuário.
     *
     * @param {string} feedbackText - Texto do feedback
     * @param {Object} [metadata={}] - Metadata adicional (mission_id, step_id, etc)
     * @returns {Object} Feedback processado com categorização e patterns
     *
     * @example
     * const processed = feedbackProcessor.processFeedback(
     *     'Add more code examples and improve the explanations',
     *     { mission_id: 'mission-123', step_id: 'step-2' }
     * );
     * // {
     * //   id: 'feedback-1643000000-abc123',
     * //   original: 'Add more code examples...',
     * //   normalized: 'add more code examples and improve the explanations',
     * //   category: 'CONTENT',
     * //   actionItems: ['Add more code examples', 'Improve the explanations'],
     * //   patterns: ['Add: more code examples', 'Improve: the explanations'],
     * //   metadata: { mission_id: 'mission-123', processed_at: 1643000000 }
     * // }
     */
    processFeedback(feedbackText, metadata = {}) {
        if (!feedbackText || typeof feedbackText !== 'string') {
            logger.warn('[FeedbackProcessor] Invalid feedback text provided');
            return null;
        }

        const normalized = this._normalize(feedbackText);

        const processed = {
            id: this._generateId(),
            original: feedbackText,
            normalized,
            category: this._categorize(normalized),
            actionItems: this._extractActionItems(normalized),
            patterns: this.extractPatterns(normalized),
            metadata: {
                ...metadata,
                processed_at: Date.now()
            }
        };

        // Se tem ContextManager, salva patterns no MemoryStore
        if (this.contextManager && processed.patterns.length > 0) {
            for (const pattern of processed.patterns) {
                this.contextManager.addPattern({
                    type: 'FEEDBACK',
                    content: pattern,
                    metadata: {
                        category: processed.category,
                        source: 'user_feedback',
                        mission_id: metadata.mission_id,
                        step_id: metadata.step_id
                    }
                });
            }

            logger.info(
                `[FeedbackProcessor] Stored ${processed.patterns.length} patterns in MemoryStore (category: ${processed.category})`
            );
        }

        logger.info(
            `[FeedbackProcessor] Processed feedback: ${processed.actionItems.length} action items, ${processed.patterns.length} patterns`
        );

        return processed;
    }

    /**
     * Extrai patterns reutilizáveis do feedback usando regex.
     *
     * @param {string} feedbackText - Texto do feedback
     * @returns {string[]} Lista de patterns extraídos
     *
     * @example
     * extractPatterns('Add more examples and avoid technical jargon')
     * // ['Add: more examples', 'Avoid: technical jargon']
     */
    extractPatterns(feedbackText) {
        const patterns = [];

        for (const { regex, template } of this.patternRegexes) {
            let match;
            const regexCopy = new RegExp(regex.source, regex.flags); // Clone regex to reset lastIndex

            while ((match = regexCopy.exec(feedbackText)) !== null) {
                const extractedText = match[1].trim();
                if (extractedText.length > 0) {
                    patterns.push(template.replace('{match}', extractedText));
                }
            }
        }

        return [...new Set(patterns)]; // Remove duplicatas
    }

    /**
     * Injeta feedback processado em prompt de step.
     *
     * @param {string} stepPrompt - Prompt original do step
     * @param {Object} processedFeedback - Feedback processado (resultado de processFeedback)
     * @param {Object} [options={}] - Opções de injeção
     * @param {string} [options.format='default'] - Formato: 'default', 'inline', 'structured'
     * @param {boolean} [options.includeCategory=true] - Incluir categoria do feedback
     * @param {boolean} [options.includeActionItems=true] - Incluir action items
     * @returns {string} Prompt com feedback injetado
     *
     * @example
     * const augmented = feedbackProcessor.injectIntoStep(
     *     'Write a chapter about Rust memory management',
     *     processedFeedback,
     *     { format: 'structured' }
     * );
     */
    injectIntoStep(stepPrompt, processedFeedback, options = {}) {
        const {
            format = INJECTION_FORMAT.DEFAULT,
            includeCategory = true,
            includeActionItems = true
        } = options;

        if (!processedFeedback) {
            return stepPrompt;
        }

        let augmentedPrompt = stepPrompt;

        switch (format) {
            case INJECTION_FORMAT.INLINE:
                augmentedPrompt = `${stepPrompt}\n\nPlease incorporate this feedback: ${processedFeedback.normalized}`;
                break;

            case INJECTION_FORMAT.STRUCTURED:
                augmentedPrompt += `\n\n[USER FEEDBACK]`;

                if (includeCategory) {
                    augmentedPrompt += `\nCategory: ${processedFeedback.category}`;
                }

                augmentedPrompt += `\nFeedback: ${processedFeedback.normalized}`;

                if (includeActionItems && processedFeedback.actionItems.length > 0) {
                    augmentedPrompt += `\n\nAction Items:`;
                    processedFeedback.actionItems.forEach((item, i) => {
                        augmentedPrompt += `\n${i + 1}. ${item}`;
                    });
                }

                augmentedPrompt += `\n\nPlease address the feedback above in your response.`;
                break;

            case INJECTION_FORMAT.DEFAULT:
            default:
                augmentedPrompt += `\n\n[USER FEEDBACK]: ${processedFeedback.normalized}`;
                break;
        }

        return augmentedPrompt;
    }

    /**
     * Normaliza texto do feedback (lowercase, remove espaços extras).
     */
    _normalize(text) {
        return text
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, ' ');
    }

    /**
     * Categoriza feedback com base em keywords.
     */
    _categorize(normalizedText) {
        const lowerText = normalizedText.toLowerCase();

        // Conta matches de cada categoria
        const categoryScores = {};
        for (const category of Object.keys(this.categoryKeywords)) {
            categoryScores[category] = 0;
        }

        for (const [category, keywords] of Object.entries(this.categoryKeywords)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword)) {
                    categoryScores[category]++;
                }
            }
        }

        // Retorna categoria com mais matches
        const maxScore = Math.max(...Object.values(categoryScores));
        if (maxScore === 0) {
            return FEEDBACK_CATEGORY.GENERAL;
        }

        for (const [category, score] of Object.entries(categoryScores)) {
            if (score === maxScore) {
                return category;
            }
        }

        return FEEDBACK_CATEGORY.GENERAL;
    }

    /**
     * Extrai action items do feedback.
     *
     * Detecta:
     * - Listas numeradas ou bullet points
     * - Sentenças imperativas (começam com verbo)
     */
    _extractActionItems(normalizedText) {
        const items = [];

        // 1. Detecta listas numeradas ou com bullet points
        const listMatches = normalizedText.match(/(?:^|\n)(?:\d+\.|[-*•])\s*(.+?)(?=\n|$)/g);
        if (listMatches) {
            items.push(...listMatches.map(item => item.replace(/^(?:\d+\.|[-*•])\s*/, '').trim()));
        }

        // 2. Detecta sentenças imperativas (começam com verbo)
        const sentences = normalizedText.split(/[.!;]\s+/);

        for (const sentence of sentences) {
            const trimmed = sentence.trim();
            if (trimmed.length === 0) continue;

            const firstWord = trimmed.split(' ')[0].toLowerCase();

            if (this.imperativeVerbs.includes(firstWord)) {
                // Capitaliza primeira letra
                const actionItem = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
                items.push(actionItem);
            }
        }

        return [...new Set(items)]; // Remove duplicatas
    }

    /**
     * Gera ID único para feedback.
     */
    _generateId() {
        return `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Retorna estatísticas do processador.
     */
    getStats() {
        return {
            categories: Object.keys(this.categoryKeywords).length,
            pattern_regexes: this.patternRegexes.length,
            imperative_verbs: this.imperativeVerbs.length,
            context_manager_enabled: !!this.contextManager
        };
    }
}

module.exports = {
    FeedbackProcessor,
    FEEDBACK_CATEGORY,
    INJECTION_FORMAT
};
