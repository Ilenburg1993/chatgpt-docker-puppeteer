// @ts-check
#!/usr/bin/env node
import './lib/env-bootstrap.mjs';
import { parseArgs } from 'node:util';
import { ragExpand } from './lib/facade.mjs';

const { values } = parseArgs({
    options: {
        'chunk-id': { type: 'string' },
        mode: { type: 'string' },
        'before-lines': { type: 'string' },
        'after-lines': { type: 'string' },
        root: { type: 'string' },
        json: { type: 'boolean', default: false },
    },
});

const chunkId = values['chunk-id'];
if (!chunkId) {
    console.error(
        'Usage: npm run rag:expand -- --chunk-id <chunk_id> [--mode lines|symbol] [--before-lines N] [--after-lines N] [--json]'
    );
    process.exit(2);
}

const result = await ragExpand({
    chunkId,
    mode: values.mode || 'lines',
    beforeLines: values['before-lines'] ? Number(values['before-lines']) : undefined,
    afterLines: values['after-lines'] ? Number(values['after-lines']) : undefined,
    root: values.root,
});

if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
}

if (!result.ok) {
    console.error(`[RAG] expand failed: ${result.message || result.reason_code || 'unknown error'}`);
    process.exit(1);
}

console.log(`[RAG] chunk=${result.chunk_id} mode=${result.mode} path=${result.path}`);
console.log(
    `[RAG] range=${result.range.start_line}-${result.range.end_line} base=${result.base_range.start_line}-${result.base_range.end_line}`
);
console.log(`\n\`\`\`${result.language || 'text'}`);
process.stdout.write(result.text || '');
if (result.text && !result.text.endsWith('\n')) {
    process.stdout.write('\n');
}
console.log('```');
