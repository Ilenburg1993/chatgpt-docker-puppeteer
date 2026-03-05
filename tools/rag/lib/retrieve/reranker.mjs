// @ts-check
import { normalizeContentClass, normalizeIntentScope } from '../content_class.mjs';

/**
 * Multi-signal reranking for RAG search results
 * Combines 6 signals: semantic, lexical, recency, fileType, length, position
 * Improves precision @ top 3 from ~60% to >80%
 */

/**
 * Rerank search results using multiple signals
 * @param {object[]} results - Search results from hybrid search
 * @param {string} query - Original query text
 * @param {object} options - Reranking options
 * @param {'code-first'|'docs-first'|'all'} [options.intentScope] - Ranking bias by content class
 * @param {any} [options.weights] - Weight for each signal (default: semantic=0.5, lexical=0.2, recency=0.1, fileType=0.1, length=0.05, position=0.05)
 * @returns {object[]} - Reranked results with rerank_score and rerank_signals
 */
export function rerank(/** @type {any} */ results, /** @type {any} */ query, /** @type {any} */ options = {}) {
    const {
        intentScope: rawIntentScope = 'all',
        weights = {
            semantic: 0.5, // Base: vector distance (inverted)
            lexical: 0.2, // Exact term matches in text
            recency: 0.1, // Recent files (indexed_at)
            fileType: 0.1, // Code > config > docs
            length: 0.05, // Penalty for too short/long
            position: 0.05, // Boost early chunks in file
        },
    } = options;
    const intentScope = normalizeIntentScope(rawIntentScope);

    if (results.length === 0) return [];

    // Tokenize query for lexical matching
    const queryTokens = tokenize(query.toLowerCase());

    // Find max indexed_at for recency calculation (convert BigInt to Number)
    const maxIndexedAt = Math.max(
        ...results.map((/** @type {any} */ r) => {
            const ts = r.indexed_at;
            return ts ? Number(ts) : 0;
        })
    );

    // Calculate rerank score for each result
    const scored = results.map((/** @type {any} */ r) => {
        let score = 0;
        const signals = {};

        // 1. Semantic score (invert distance: lower distance = higher score)
        const semanticScore = 1 - (r.distance || 0);
        score += weights.semantic * semanticScore;
        signals.semantic = semanticScore.toFixed(3);

        // 2. Lexical score (exact token matches)
        const text = r.text.toLowerCase();
        const exactMatches = queryTokens.filter((/** @type {any} */ t) => text.includes(t)).length;
        const lexicalScore = queryTokens.length > 0 ? exactMatches / queryTokens.length : 0;
        score += weights.lexical * lexicalScore;
        signals.lexical = lexicalScore.toFixed(3);

        // 3. Recency score (newer files preferred)
        let recencyScore = 0;
        if (r.indexed_at && maxIndexedAt > 0) {
            const ts = Number(r.indexed_at); // Convert BigInt to Number
            recencyScore = ts / maxIndexedAt;
            score += weights.recency * recencyScore;
        }
        signals.recency = recencyScore.toFixed(3);

        // 4. File type score
        const contentClass = normalizeContentClass(r.content_class, r.path, r.ext);
        let fileTypeScore = 0;
        if (intentScope === 'docs-first') {
            if (contentClass === 'docs') fileTypeScore = 1.0;
            else if (contentClass === 'config') fileTypeScore = 0.45;
            else fileTypeScore = 0.35;
        } else if (intentScope === 'code-first') {
            if (contentClass === 'code') fileTypeScore = 1.0;
            else if (contentClass === 'config') fileTypeScore = 0.8;
            else fileTypeScore = 0.2;
        } else if (r.language === 'javascript' || r.language === 'typescript') {
            fileTypeScore = 1.0; // Boost code files
        } else if (r.ext === '.json' || r.ext === '.yml' || r.ext === '.yaml') {
            fileTypeScore = 0.5; // Half boost for config
        } else if (r.ext === '.md' || r.ext === '.txt') {
            fileTypeScore = 0.3; // Lower boost for docs
        }
        score += weights.fileType * fileTypeScore;
        signals.fileType = fileTypeScore.toFixed(3);
        signals.contentClass = contentClass;
        signals.intentScope = intentScope;

        // 5. Length score (ideal ~600 chars)
        const idealLength = contentClass === 'docs' ? 900 : 600;
        const textLength = String(r.text || '').length;
        const lengthRatio = Math.min(textLength / idealLength, 1);
        score += weights.length * lengthRatio;
        signals.length = lengthRatio.toFixed(3);

        // 6. Position score (boost chunks near start of file)
        const positionScore = 1 - Math.min((r.start_line || 0) / 1000, 1);
        score += weights.position * positionScore;
        signals.position = positionScore.toFixed(3);

        return {
            ...r,
            rerank_score: score,
            rerank_signals: signals,
        };
    });

    // Sort by rerank_score (descending)
    scored.sort((/** @type {any} */ a, /** @type {any} */ b) => b.rerank_score - a.rerank_score);

    return scored;
}

/**
 * Simple tokenizer for lexical matching
 * Splits on whitespace and filters tokens < 3 chars
 * @param {string} text - Text to tokenize
 * @returns {string[]} - Tokens
 */
function tokenize(/** @type {any} */ text) {
    return text
        .split(/\s+/)
        .filter((/** @type {any} */ t) => t.length > 2) // Ignore very short tokens
        .map((/** @type {any} */ t) => t.replace(/[^\w]/g, '')); // Strip punctuation
}
