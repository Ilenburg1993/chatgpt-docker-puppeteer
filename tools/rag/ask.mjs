// @ts-check
import { parseArgs } from 'node:util';
import './lib/env-bootstrap.mjs';
import { ragAsk } from './lib/facade.mjs';

const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
        topk: { type: 'string' },
        ext: { type: 'string' },
        'path-prefix': { type: 'string' },
        tag: { type: 'string', multiple: true },
        profile: { type: 'string' },
        mode: { type: 'string' },
        diagnostics: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        'ollama-base-url': { type: 'string' },
        model: { type: 'string' },
    },
});

const query = positionals.join(' ').trim();
if (!query) {
    console.error('Usage: node tools/rag/ask.mjs "your query" [--topk 8] [--ext .js] [--path-prefix src/] [--tag ts]');
    process.exit(2);
}

const { markdown, result } = await ragAsk({
    query,
    topK: values.topk ? Number(values.topk) : 8,
    profile: values.profile || process.env.RAG_PROFILE_DEFAULT || 'core',
    mode: values.mode || 'auto',
    includeDiagnostics: values.diagnostics,
    filters: {
        pathPrefix: values['path-prefix'],
        ext: values.ext,
        tags: values.tag || [],
    },
    ollamaBaseUrl: values['ollama-base-url'],
    model: values.model,
});

if (values.json) {
    console.log(JSON.stringify(result, null, 2));
} else {
    console.log(markdown);
}
