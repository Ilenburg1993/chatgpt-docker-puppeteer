export function formatMarkdownResults(queryResult) {
    const lines = [];
    lines.push(`# RAG Context`);
    lines.push('');
    lines.push(`Query: ${queryResult.query}`);
    lines.push(`Model: ${queryResult.embedding_model}`);
    lines.push(`TopK: ${queryResult.topK}`);
    lines.push('');

    for (const r of queryResult.results) {
        const scoreStr = typeof r.distance === 'number' ? `distance=${r.distance}` : `score=${r.score}`;
        lines.push(`## ${r.path}:${r.start_line}-${r.end_line} (${scoreStr})`);
        if (r.indexed_at_iso) {
            lines.push(`IndexedAt: ${r.indexed_at_iso}`);
        }
        lines.push('');
        lines.push('```');
        lines.push(r.text);
        lines.push('```');
        lines.push('');
    }

    return lines.join('\n');
}
