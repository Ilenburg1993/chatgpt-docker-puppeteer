#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ragHybridSearch } from './lib/facade.mjs';

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        topk: { type: 'string' },
        ext: { type: 'string' },
        'path-prefix': { type: 'string' },
        tag: { type: 'string', multiple: true },
        json: { type: 'boolean', default: false },
        'ollama-base-url': { type: 'string' },
        model: { type: 'string' }
    }
});

const query = positionals.join(' ').trim();
if (!query) {
    console.error('Usage: npm run rag:hybrid -- "<query>" [options]');
    console.error('');
    console.error('Options:');
    console.error('  --topk N              Number of results (default: 8)');
    console.error('  --ext .js             Filter by file extension');
    console.error('  --path-prefix src/    Filter by path prefix');
    console.error('  --tag <tag>           Filter by tag (can be repeated)');
    console.error('  --json                Output JSON format');
    console.error('  --ollama-base-url     Ollama API base URL');
    console.error('  --model               Embedding model name');
    console.error('');
    console.error('Examples:');
    console.error('  npm run rag:hybrid -- "CHROME_PROXY_PORT"');
    console.error('  npm run rag:hybrid -- "kernel loop 20Hz" --topk 5');
    console.error('  npm run rag:hybrid -- "adaptive throttler" --path-prefix src/');
    console.error('');
    process.exit(2);
}

const result = await ragHybridSearch({
    query,
    topK: values.topk ? Number(values.topk) : 8,
    pathPrefix: values['path-prefix'],
    ext: values.ext,
    tags: values.tag || [],
    ollamaBaseUrl: values['ollama-base-url'],
    model: values.model
});

if (values.json) {
    console.log(JSON.stringify(result, null, 2));
} else {
    console.log(`\n[RAG Hybrid Search] Query: "${result.query}"`);
    console.log(`Model: ${result.model} (${result.dim}D)`);
    console.log(`Found ${result.results.length} results:\n`);

    for (const [idx, r] of result.results.entries()) {
        console.log(`[${idx + 1}] 📄 ${r.path}:${r.start_line}-${r.end_line}`);
        const score = typeof r.score === 'number' ? r.score.toFixed(4) : 'N/A';
        const distance = typeof r.distance === 'number' ? r.distance.toFixed(4) : 'N/A';
        console.log(`    Score: ${score} | Distance: ${distance}`);
        console.log(`    Language: ${r.language || 'unknown'} | Size: ${r.text.length} chars`);

        // Preview first 120 chars
        const preview = r.text.slice(0, 120).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(`    Preview: ${preview}${r.text.length > 120 ? '...' : ''}`);
        console.log('');
    }

    if (result.results.length === 0) {
        console.log('💡 No results found. Try:');
        console.log('   - Increase topK: --topk 15');
        console.log('   - Remove filters: --path-prefix or --ext');
        console.log('   - Try different query terms');
    }
}
