#!/usr/bin/env node
import './lib/env-bootstrap.mjs';
import path from 'node:path';
import { promises as fs, watch as fsWatch } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ragIndexChanged } from './lib/facade.mjs';

const DEFAULT_DEBOUNCE_MS = Number(process.env.RAG_WATCH_DEBOUNCE_MS || 3000);
const DEFAULT_BATCH_MAX = Number(process.env.RAG_WATCH_BATCH_MAX || 64);
const ROOT_DEFAULT = '/workspaces/chatgpt-docker-puppeteer';

const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'coverage',
    'logs',
    'fila',
    'respostas',
    '.vscode-server',
    'analysis'
]);

function toPosix(relPath) {
    return String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function shouldSkipDir(relDir) {
    const normalized = toPosix(relDir);
    if (!normalized) return false;
    const parts = normalized.split('/').filter(Boolean);
    return parts.some((p) => SKIP_DIRS.has(p));
}

export class RagWatchBatcher {
    constructor({ debounceMs, batchMax, onBatch }) {
        this.debounceMs = Math.max(250, Number(debounceMs || DEFAULT_DEBOUNCE_MS));
        this.batchMax = Math.max(1, Number(batchMax || DEFAULT_BATCH_MAX));
        this.onBatch = onBatch;
        this.pending = new Set();
        this.timer = null;
        this.processing = false;
    }

    enqueue(relPath) {
        const normalized = toPosix(relPath);
        if (!normalized) return;
        this.pending.add(normalized);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, this.debounceMs);
    }

    async flush() {
        if (this.processing) return;
        this.processing = true;
        try {
            while (this.pending.size > 0) {
                const batch = [...this.pending].slice(0, this.batchMax);
                for (const p of batch) this.pending.delete(p);
                await this.onBatch(batch);
            }
        } finally {
            this.processing = false;
        }
    }

    async close() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.flush();
    }
}

async function watchTree(rootAbs, onFsEvent, watchers, relDir = '') {
    if (shouldSkipDir(relDir)) return;

    const absDir = relDir ? path.join(rootAbs, relDir) : rootAbs;
    let entries;
    try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
        return;
    }

    try {
        const watcher = fsWatch(absDir, (eventType, filename) => {
            const file = filename ? String(filename) : '';
            const relPath = toPosix(relDir ? path.posix.join(relDir, file) : file);
            onFsEvent({ eventType, relPath, relDir });
        });
        watchers.set(absDir, watcher);
    } catch (error) {
        console.warn(`[RAG Watch] failed to watch ${absDir}: ${error?.message || error}`);
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const childRel = relDir ? path.posix.join(relDir, entry.name) : entry.name;
        if (shouldSkipDir(childRel)) continue;
        await watchTree(rootAbs, onFsEvent, watchers, childRel);
    }
}

async function ensureDirectoryWatch(rootAbs, relPath, watchers, onFsEvent) {
    if (!relPath) return;
    const abs = path.join(rootAbs, relPath);
    let stat;
    try {
        stat = await fs.stat(abs);
    } catch {
        return;
    }
    if (!stat.isDirectory()) return;
    if (watchers.has(abs)) return;
    await watchTree(rootAbs, onFsEvent, watchers, relPath);
}

async function main() {
    const { values } = parseArgs({
        options: {
            root: { type: 'string' },
            profile: { type: 'string' },
            'include-glob': { type: 'string', multiple: true },
            'exclude-glob': { type: 'string', multiple: true },
            'docs-mode': { type: 'string' },
            'max-file-bytes': { type: 'string' },
            'debounce-ms': { type: 'string' },
            'batch-max': { type: 'string' }
        }
    });

    if (String(process.env.RAG_WATCH_ENABLED || 'true') === 'false') {
        console.log('[RAG Watch] disabled by RAG_WATCH_ENABLED=false');
        process.exit(0);
    }

    const root = path.resolve(values.root || ROOT_DEFAULT);
    const profile = values.profile || process.env.RAG_PROFILE_DEFAULT || 'core';
    const includeGlobs = values['include-glob'];
    const excludeGlobs = values['exclude-glob'];
    const docsMode = values['docs-mode'] || process.env.RAG_DOCS_MODE || 'include';
    const maxFileBytes = values['max-file-bytes'] ? Number(values['max-file-bytes']) : undefined;
    const debounceMs = Number(values['debounce-ms'] || DEFAULT_DEBOUNCE_MS);
    const batchMax = Number(values['batch-max'] || DEFAULT_BATCH_MAX);

    const watchers = new Map();

    const batcher = new RagWatchBatcher({
        debounceMs,
        batchMax,
        onBatch: async (batch) => {
            const started = Date.now();
            const report = await ragIndexChanged({
                root,
                profile,
                includeGlobs,
                excludeGlobs,
                docsMode,
                maxFileBytes,
                changedPaths: batch
            });
            const tookMs = Date.now() - started;
            console.log(
                `[RAG Watch] batch=${batch.length} changed=${report.changed_files} ` +
                `deleted=${report.deleted_files} skipped=${report.skipped_files} chunks=${report.inserted_chunks} ` +
                `mode=incremental took=${tookMs}ms`
            );
        }
    });

    const onFsEvent = ({ eventType, relPath, relDir }) => {
        if (!relPath) {
            return;
        }
        batcher.enqueue(relPath);
        if (eventType === 'rename') {
            void ensureDirectoryWatch(root, relPath, watchers, onFsEvent);
            if (relDir) {
                void ensureDirectoryWatch(root, relDir, watchers, onFsEvent);
            }
        }
    };

    await watchTree(root, onFsEvent, watchers);

    console.log('[RAG Watch] running');
    console.log(`[RAG Watch] root=${root}`);
    console.log(`[RAG Watch] profile=${profile}`);
    console.log(`[RAG Watch] docsMode=${docsMode}`);
    if (includeGlobs?.length) console.log(`[RAG Watch] includeGlobs=${includeGlobs.join(',')}`);
    if (excludeGlobs?.length) console.log(`[RAG Watch] excludeGlobs=${excludeGlobs.join(',')}`);
    console.log(`[RAG Watch] debounce=${debounceMs}ms batchMax=${batchMax}`);

    const shutdown = async (signal) => {
        console.log(`[RAG Watch] stopping (${signal})...`);
        for (const watcher of watchers.values()) {
            try {
                watcher.close();
            } catch {
                // ignore
            }
        }
        watchers.clear();
        await batcher.close();
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    main().catch((error) => {
        console.error('[RAG Watch] fatal:', error?.message || error);
        process.exit(1);
    });
}
