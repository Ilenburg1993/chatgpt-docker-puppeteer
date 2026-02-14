import assert from 'node:assert';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanWorkspace } from '../../../tools/rag/lib/scan.mjs';

describe('RAG Workspace Scanning', () => {
    it('scans allowed file types', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));
        
        try {
            // Create test files
            await fs.writeFile(path.join(tmpDir, 'test.js'), 'export const x = 1;', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'test.md'), '# Hello', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'test.json'), '{}', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'package.json'), '{"name":"test"}', 'utf8');

            const files = await scanWorkspace(tmpDir);

            assert.ok(files.length >= 3, 'Should find multiple files');
            const paths = files.map(f => f.relPath);
            assert.ok(paths.some(p => p.endsWith('.js')));
            assert.ok(paths.some(p => p.endsWith('.md')));
            assert.ok(paths.some(p => p.endsWith('.json')));
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('excludes node_modules directory', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));
        
        try {
            await fs.mkdir(path.join(tmpDir, 'node_modules'));
            await fs.writeFile(path.join(tmpDir, 'node_modules', 'test.js'), 'code', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'valid.js'), 'code', 'utf8');

            const files = await scanWorkspace(tmpDir);

            const paths = files.map(f => f.relPath);
            assert.ok(!paths.some(p => p.includes('node_modules')), 'Should exclude node_modules');
            assert.ok(paths.some(p => p === 'valid.js'), 'Should include valid files');
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('excludes .env but allows .env.example', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));
        
        try {
            await fs.writeFile(path.join(tmpDir, '.env'), 'SECRET=abc', 'utf8');
            await fs.writeFile(path.join(tmpDir, '.env.local'), 'SECRET=xyz', 'utf8');
            await fs.writeFile(path.join(tmpDir, '.env.example'), 'SECRET=', 'utf8');

            const files = await scanWorkspace(tmpDir);

            const paths = files.map(f => f.relPath);
            assert.ok(!paths.includes('.env'), 'Should exclude .env');
            assert.ok(!paths.includes('.env.local'), 'Should exclude .env.local');
            assert.ok(paths.includes('.env.example'), 'Should allow .env.example');
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('respects .gitignore', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));
        
        try {
            await fs.writeFile(path.join(tmpDir, '.gitignore'), 'ignored.txt\n*.log\n', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'ignored.txt'), 'data', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'test.log'), 'log', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'valid.js'), 'code', 'utf8');

            const files = await scanWorkspace(tmpDir);

            const paths = files.map(f => f.relPath);
            assert.ok(!paths.includes('ignored.txt'), 'Should respect .gitignore');
            assert.ok(!paths.includes('test.log'), 'Should respect .gitignore patterns');
            assert.ok(paths.includes('valid.js'), 'Should include valid files');
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('respects maxFileBytes limit', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));
        
        try {
            // Create a small file
            await fs.writeFile(path.join(tmpDir, 'small.js'), 'x', 'utf8');
            // Create a large file (>1MB)
            const largeContent = 'x'.repeat(2000000);
            await fs.writeFile(path.join(tmpDir, 'large.js'), largeContent, 'utf8');

            const files = await scanWorkspace(tmpDir, { maxFileBytes: 1000000 });

            const paths = files.map(f => f.relPath);
            assert.ok(paths.includes('small.js'), 'Should include small file');
            assert.ok(!paths.includes('large.js'), 'Should exclude large file');
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns sorted results', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));
        
        try {
            await fs.writeFile(path.join(tmpDir, 'z.js'), 'code', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'a.js'), 'code', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'm.js'), 'code', 'utf8');

            const files = await scanWorkspace(tmpDir);

            const paths = files.map(f => f.relPath);
            // Should be sorted alphabetically
            assert.deepStrictEqual(paths, [...paths].sort());
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('supports profile=core filtering', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));

        try {
            await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
            await fs.mkdir(path.join(tmpDir, 'scripts'), { recursive: true });
            await fs.writeFile(path.join(tmpDir, 'src', 'ok.ts'), 'export const x = 1;', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'scripts', 'skip.mjs'), 'console.log(1)', 'utf8');

            const files = await scanWorkspace(tmpDir, { profile: 'core' });
            const paths = files.map(f => f.relPath);
            assert.ok(paths.includes('src/ok.ts'));
            assert.ok(!paths.includes('scripts/skip.mjs'));
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('supports includeGlobs and excludeGlobs overrides', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-scan-'));

        try {
            await fs.mkdir(path.join(tmpDir, 'custom'), { recursive: true });
            await fs.writeFile(path.join(tmpDir, 'custom', 'a.js'), 'console.log(1)', 'utf8');
            await fs.writeFile(path.join(tmpDir, 'custom', 'b.js'), 'console.log(2)', 'utf8');

            const files = await scanWorkspace(tmpDir, {
                profile: 'core',
                includeGlobs: ['custom/**'],
                excludeGlobs: ['custom/b.js']
            });
            const paths = files.map(f => f.relPath);
            assert.ok(paths.includes('custom/a.js'));
            assert.ok(!paths.includes('custom/b.js'));
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });
});
