#!/usr/bin/env node
import './lib/env-bootstrap.mjs';
import { ragIndex } from './lib/facade.mjs';

const BATCH_SIZE = 50; // Process 50 files at a time
const BATCH_DELAY_MS = 5000; // 5 second pause between batches

/**
 * Incremental indexing with batching to avoid CPU overload
 */
async function indexIncremental() {
    const excludeDirs = ['analysis', 'node_modules', '.git', 'coverage', 'dist'];

    console.log('[RAG Incremental] Starting...');
    console.log(`[RAG Incremental] Batch size: ${BATCH_SIZE} files`);
    console.log(`[RAG Incremental] Batch delay: ${BATCH_DELAY_MS}ms`);
    console.log(`[RAG Incremental] Excluding: ${excludeDirs.join(', ')}\n`);

    try {
        const report = await ragIndex({
            root: '/workspaces/chatgpt-docker-puppeteer',
            maxFileBytes: 5 * 1024 * 1024, // 5MB limit per file
            profile: process.env.RAG_PROFILE_DEFAULT || 'core'
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
