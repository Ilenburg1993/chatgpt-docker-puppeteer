import assert from 'node:assert';
import { describe, it } from 'node:test';
import { resolveRagScopeConfig } from '../../../tools/rag/lib/scope_config.mjs';

describe('RAG scope config resolver', () => {
    it('uses compatible defaults', () => {
        const resolved = resolveRagScopeConfig({});
        assert.strictEqual(resolved.profile, 'core');
        assert.strictEqual(resolved.docsMode, 'include');
        assert.strictEqual(resolved.maxFileBytes, 2_000_000);
        assert.ok(typeof resolved.scopeHash === 'string' && resolved.scopeHash.length > 0);
    });

    it('parses env values and applies docsMode=exclude', () => {
        const prevProfile = process.env.RAG_PROFILE_DEFAULT;
        const prevDocsMode = process.env.RAG_DOCS_MODE;
        const prevInclude = process.env.RAG_INCLUDE_GLOBS;
        const prevExclude = process.env.RAG_EXCLUDE_GLOBS;
        const prevMax = process.env.RAG_INDEX_MAX_FILE_BYTES;

        try {
            process.env.RAG_PROFILE_DEFAULT = 'full';
            process.env.RAG_DOCS_MODE = 'exclude';
            process.env.RAG_INCLUDE_GLOBS = 'src/**, tests/**';
            process.env.RAG_EXCLUDE_GLOBS = 'logs/**';
            process.env.RAG_INDEX_MAX_FILE_BYTES = '1234567';

            const resolved = resolveRagScopeConfig({});
            assert.strictEqual(resolved.profile, 'full');
            assert.strictEqual(resolved.docsMode, 'exclude');
            assert.strictEqual(resolved.maxFileBytes, 1234567);
            assert.deepStrictEqual(resolved.includeGlobs, ['src/**', 'tests/**']);
            assert.ok(resolved.excludeGlobs.includes('logs/**'));
            assert.ok(resolved.excludeGlobs.includes('**/*.md'));
            assert.ok(resolved.excludeGlobs.includes('**/*.mdx'));
        } finally {
            if (prevProfile === undefined) delete process.env.RAG_PROFILE_DEFAULT;
            else process.env.RAG_PROFILE_DEFAULT = prevProfile;
            if (prevDocsMode === undefined) delete process.env.RAG_DOCS_MODE;
            else process.env.RAG_DOCS_MODE = prevDocsMode;
            if (prevInclude === undefined) delete process.env.RAG_INCLUDE_GLOBS;
            else process.env.RAG_INCLUDE_GLOBS = prevInclude;
            if (prevExclude === undefined) delete process.env.RAG_EXCLUDE_GLOBS;
            else process.env.RAG_EXCLUDE_GLOBS = prevExclude;
            if (prevMax === undefined) delete process.env.RAG_INDEX_MAX_FILE_BYTES;
            else process.env.RAG_INDEX_MAX_FILE_BYTES = prevMax;
        }
    });

    it('input options override env values', () => {
        const prevDocsMode = process.env.RAG_DOCS_MODE;
        try {
            process.env.RAG_DOCS_MODE = 'include';
            const resolved = resolveRagScopeConfig({
                docsMode: 'only',
                includeGlobs: ['docs/**'],
                excludeGlobs: ['tmp/**'],
                maxFileBytes: 3333,
                profile: 'dev',
            });

            assert.strictEqual(resolved.docsMode, 'only');
            assert.strictEqual(resolved.profile, 'dev');
            assert.strictEqual(resolved.maxFileBytes, 3333);
            assert.deepStrictEqual(resolved.includeGlobs, ['docs/**']);
            assert.deepStrictEqual(resolved.excludeGlobs, ['tmp/**']);
        } finally {
            if (prevDocsMode === undefined) delete process.env.RAG_DOCS_MODE;
            else process.env.RAG_DOCS_MODE = prevDocsMode;
        }
    });

    it('produces stable scope hash regardless of glob order', () => {
        const a = resolveRagScopeConfig({
            includeGlobs: ['src/**', 'tests/**'],
            excludeGlobs: ['logs/**', 'coverage/**'],
            profile: 'full',
            docsMode: 'exclude',
            maxFileBytes: 2_000_000,
        });
        const b = resolveRagScopeConfig({
            includeGlobs: ['tests/**', 'src/**'],
            excludeGlobs: ['coverage/**', 'logs/**'],
            profile: 'full',
            docsMode: 'exclude',
            maxFileBytes: 2_000_000,
        });

        assert.strictEqual(a.scopeHash, b.scopeHash);
    });
});
