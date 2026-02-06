/**
 * MMR (Maximal Marginal Relevance) for result diversification
 * Promotes results from different files/locations
 * Avoids returning multiple redundant chunks from the same file
 */

/**
 * Apply MMR (Maximal Marginal Relevance) for diversity
 * Promotes results from different files/locations
 * @param {object[]} results - Reranked results (must have rerank_score)
 * @param {object} options - MMR options
 * @param {number} options.lambda - Balance between relevance and diversity (1.0 = only relevance, 0.0 = only diversity, default: 0.7)
 * @param {number} options.topK - Number of results to return (default: 8)
 * @returns {object[]} - Diversified results
 */
export function maximalMarginalRelevance(results, options = {}) {
    const {
        lambda = 0.7,   // 1.0 = only relevance, 0.0 = only diversity
        topK = 8
    } = options;

    if (results.length === 0) return [];
    if (results.length <= topK) return results;

    // Select top result first (most relevant)
    const selected = [results[0]];
    const remaining = results.slice(1);

    // Iteratively select most relevant + diverse
    while (selected.length < topK && remaining.length > 0) {
        let bestIdx = 0;
        let bestScore = -Infinity;

        for (let i = 0; i < remaining.length; i++) {
            const candidate = remaining[i];

            // Relevance (rerank_score from previous step)
            const relevance = candidate.rerank_score || 0;

            // Diversity (dissimilarity to already selected)
            let minSimilarity = Infinity;
            for (const sel of selected) {
                const similarity = calculateSimilarity(candidate, sel);
                minSimilarity = Math.min(minSimilarity, similarity);
            }
            const diversity = 1 - minSimilarity;

            // MMR score = λ * relevance + (1-λ) * diversity
            const mmrScore = lambda * relevance + (1 - lambda) * diversity;

            if (mmrScore > bestScore) {
                bestScore = mmrScore;
                bestIdx = i;
            }
        }

        // Add best candidate to selected
        selected.push(remaining[bestIdx]);
        remaining.splice(bestIdx, 1);
    }

    return selected;
}

/**
 * Calculate similarity between two results
 * Higher similarity = more redundant (same file, close line numbers)
 * @param {object} a - First result
 * @param {object} b - Second result
 * @returns {number} - Similarity score [0, 1] (1 = identical, 0 = completely different)
 */
function calculateSimilarity(a, b) {
    // Path similarity
    const pathSim = a.path === b.path ? 1.0 : 0.0;

    // Line distance similarity (only if same file)
    let lineSim = 0.0;
    if (a.path === b.path) {
        const lineDist = Math.abs((a.start_line || 0) - (b.start_line || 0));
        // Close chunks (< 100 lines apart) are very similar
        lineSim = Math.max(0, 1 - lineDist / 100);
    }

    // Combined similarity (path is more important than line distance)
    return pathSim * 0.7 + lineSim * 0.3;
}
