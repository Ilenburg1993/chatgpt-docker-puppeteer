// @ts-check
import { parseArgs } from 'node:util';
import './lib/env-bootstrap.mjs';
import { ragIndex } from './lib/facade.mjs';

const { values } = parseArgs({
    options: {
        root: { type: 'string' },
        'ollama-base-url': { type: 'string' },
        model: { type: 'string' },
        profile: { type: 'string' },
        'include-glob': { type: 'string', multiple: true },
        'exclude-glob': { type: 'string', multiple: true },
        'docs-mode': { type: 'string' },
        'max-file-bytes': { type: 'string' },
        json: { type: 'boolean', default: false },
    },
});

const maxFileBytes = values['max-file-bytes'] ? Number(values['max-file-bytes']) : undefined;

const report = /** @type {any} */ (
    await ragIndex({
        root: values.root,
        ollamaBaseUrl: values['ollama-base-url'],
        model: values.model,
        profile: values.profile || process.env.RAG_PROFILE_DEFAULT || 'core',
        includeGlobs: values['include-glob'],
        excludeGlobs: values['exclude-glob'],
        docsMode: values['docs-mode'],
        maxFileBytes,
    })
);

if (values.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`[RAG] indexed root=${report.root}`);
    console.log(
        `[RAG] scanned=${report.scanned_files} changed=${report.changed_files} skipped=${report.skipped_files} embedded=${report.embedded_chunks} inserted=${report.inserted_chunks}`,
    );
}
