#!/usr/bin/env node
import './lib/env-bootstrap.mjs';
import { ragIndex } from './lib/facade.mjs';
import { resolveRagScopeConfig } from './lib/scope_config.mjs';

const BATCH_SIZE = 50; // Process 50 files at a time
const BATCH_DELAY_MS = 5000; // 5 second pause between batches

/**
 * Incremental indexing with batching to avoid CPU overload
 */
async function indexIncremental() {
    const excludeDirs = ['analysis', 'node_modules', '.git', 'coverage', 'dist'];
    const scope = resolveRagScopeConfig({
        profile: process.env.RAG_PROFILE_DEFAULT || 'core',
        includeGlobs: process.env.RAG_INCLUDE_GLOBS,
        excludeGlobs: process.env.RAG_EXCLUDE_GLOBS,
        docsMode: process.env.RAG_DOCS_MODE,
        maxFileBytes: process.env.RAG_INDEX_MAX_FILE_BYTES
    });

    console.log('[RAG Incremental] Starting...');
    console.log(`[RAG Incremental] Batch size: ${BATCH_SIZE} files`);
    console.log(`[RAG Incremental] Batch delay: ${BATCH_DELAY_MS}ms`);
    console.log(`[RAG Incremental] Excluding: ${excludeDirs.join(', ')}\n`);
    console.log(`[RAG Incremental] Scope profile=${scope.profile} docsMode=${scope.docsMode}`);
    if (scope.includeGlobs.length > 0) console.log(`[RAG Incremental] Include globs: ${scope.includeGlobs.join(', ')}`);
    if (scope.excludeGlobs.length > 0) console.log(`[RAG Incremental] Exclude globs: ${scope.excludeGlobs.join(', ')}`);

    try {
        const report = await ragIndex({
            root: '/workspaces/chatgpt-docker-puppeteer',
            maxFileBytes: scope.maxFileBytes,
            profile: scope.profile,
            includeGlobs: scope.includeGlobs,
            excludeGlobs: scope.excludeGlobs,
            docsMode: scope.docsMode
        });

        console.log('\n[RAG Incremental] ✅ Complete!');
        console.log(`  Files scanned: ${report.scanned_files}`);
        console.log(`  Files changed: ${report.changed_files}`);
        console.log(`  Files skipped: ${report.skipped_files}`);
        console.log(`  Chunks embedded: ${report.embedded_chunks}`);
        console.log(`  Chunks inserted: ${report.inserted_chunks}`);

        process.exit(0);
    } catch (error) {
        console.error('\n[RAG Incremental] ❌ Error:', error.message);
        process.exit(1);
    }
}

indexIncremental();
