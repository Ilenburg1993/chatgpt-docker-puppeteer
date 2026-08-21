// @ts-check

import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { parseFileSymbols } from '#copilot/infra/internal/indexing/parser';
import { ensureIoIndexSchema, IO_INDEX_SCHEMA_VERSION } from '../../../../src/copilot/db/io-index-schema.js';
import {
    buildIndexPathTreeRange,
    createIoIndexSqlite,
} from '../../../../src/copilot/infra/indexing/registry/sqlite/index.js';

/** @param {Parameters<typeof createIoIndexSqlite>[0]} options */
function createPreparedIoIndex(options) {
    ensureIoIndexSchema(options.db);
    return createIoIndexSqlite(options);
}

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';

const REPLACE_TEXT_CHILD = `
import { rename, writeFile } from 'node:fs/promises';
process.on('message', async (message) => {
    try {
        const tempPath = message.filePath + '.external-replacement';
        await writeFile(tempPath, message.content, 'utf8');
        await rename(tempPath, message.filePath);
        process.send?.({ ok: true });
        process.exit(0);
    } catch (error) {
        process.send?.({ ok: false, message: error instanceof Error ? error.message : String(error) });
        process.exit(1);
    }
});
`;

/** @type {string | null} */
let tmpDir = null;

/**
 * @param {string} filePath
 * @param {string} content
 */
async function replaceTextFromChild(filePath, content) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', REPLACE_TEXT_CHILD], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('message', (message) => {
            const result = /** @type {{ ok?: boolean; message?: string }} */ (message);
            if (result.ok) resolve(undefined);
            else reject(new Error(result.message ?? 'external replacement failed'));
        });
        child.send({ filePath, content });
    });
}

/**
 * @param {Database.Database} db
 * @param {string} content
 */
function createLegacyIoIndex(db, content) {
    db.exec(`
        CREATE TABLE copilot_io_index_files (
            file_path TEXT PRIMARY KEY,
            workspace_root TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            extension TEXT NOT NULL,
            content_kind TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            mtime_ms REAL NOT NULL,
            ctime_ms REAL,
            content_hash TEXT,
            line_count INTEGER NOT NULL DEFAULT 0,
            symbol_count INTEGER NOT NULL DEFAULT 0,
            import_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            parse_error TEXT,
            indexed_at_ms INTEGER NOT NULL,
            refreshed_at_ms INTEGER NOT NULL,
            metadata_json TEXT
        ) STRICT;
        CREATE TABLE copilot_io_index_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            UNIQUE(file_path, chunk_index)
        ) STRICT;
        CREATE VIRTUAL TABLE copilot_io_index_fts USING fts5(
            file_path UNINDEXED,
            relative_path,
            content
        );
    `);
    db.prepare(
        `
        INSERT INTO copilot_io_index_files(
            file_path, workspace_root, relative_path, file_name, extension, content_kind,
            size_bytes, mtime_ms, line_count, status, indexed_at_ms, refreshed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
        '/workspace/legacy.md',
        '/workspace',
        'legacy.md',
        'legacy.md',
        '.md',
        'markdown',
        Buffer.byteLength(content),
        1,
        content.split('\n').length,
        'fresh',
        1,
        1,
    );
    db.prepare('INSERT INTO copilot_io_index_fts(file_path, relative_path, content) VALUES (?, ?, ?)').run(
        '/workspace/legacy.md',
        'legacy.md',
        content,
    );
}

beforeEach(async () => {
    tmpDir = mkdtempSync(join(WORKSPACE, 'tmp', '.io-index-'));
    await mkdir(join(tmpDir, 'nested'), { recursive: true });
    await writeFile(
        join(tmpDir, 'alpha.js'),
        "import { betaValue } from './nested/beta.js';\nexport function alphaHelper() { return betaValue; }\n",
        'utf8',
    );
    await writeFile(join(tmpDir, 'nested', 'beta.js'), 'export const betaValue = 42;\n', 'utf8');
    await writeFile(join(tmpDir, 'notes.md'), '# Alpha Notes\n\nsemantic index token\n', 'utf8');
});

afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
});

describe('createIoIndexSqlite', () => {
    it('consome schema preparado pelo owner DB, inclusive após migração dev/ino', () => {
        const db = new Database(':memory:');
        db.exec(`
            CREATE TABLE copilot_io_index_files (
                file_path TEXT PRIMARY KEY,
                workspace_root TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                content_kind TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mtime_ms REAL NOT NULL,
                ctime_ms REAL,
                content_hash TEXT,
                line_count INTEGER NOT NULL DEFAULT 0,
                symbol_count INTEGER NOT NULL DEFAULT 0,
                import_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                parse_error TEXT,
                indexed_at_ms INTEGER NOT NULL,
                refreshed_at_ms INTEGER NOT NULL,
                metadata_json TEXT
            ) STRICT;
        `);

        createPreparedIoIndex({ db });

        const columns = db
            .prepare('PRAGMA table_info(copilot_io_index_files)')
            .all()
            .map((column) => /** @type {{ name: string }} */ (column).name);
        expect(columns).toEqual(expect.arrayContaining(['dev', 'ino']));
        expect(
            db
                .prepare('SELECT version FROM copilot_io_index_schema_migrations ORDER BY version')
                .all()
                .map((row) => /** @type {{ version: number }} */ (row).version),
        ).toEqual([1, IO_INDEX_SCHEMA_VERSION]);
        expect(
            db
                .prepare('PRAGMA table_info(copilot_io_index_fts)')
                .all()
                .map((column) => /** @type {{ name: string }} */ (column).name),
        ).toEqual(['relative_path', 'content']);
    });

    it('migra conteúdo FTS legado para chunks sem perder busca', () => {
        const db = new Database(':memory:');
        const content = Array.from({ length: 205 }, (_, index) =>
            index === 202 ? 'legacy migration token' : `legacy line ${index + 1}`,
        ).join('\n');
        createLegacyIoIndex(db, content);

        expect(ensureIoIndexSchema(db)).toBe(IO_INDEX_SCHEMA_VERSION);

        const chunks = db
            .prepare(
                `
                SELECT chunk_index AS chunkIndex, start_line AS startLine, end_line AS endLine
                FROM copilot_io_index_chunks
                ORDER BY chunk_index
            `,
            )
            .all();
        expect(chunks).toEqual([
            { chunkIndex: 0, startLine: 1, endLine: 200 },
            { chunkIndex: 1, startLine: 201, endLine: 205 },
        ]);
        const hit = db
            .prepare(
                `
                SELECT chunks.start_line AS startLine, chunks.end_line AS endLine
                FROM copilot_io_index_fts
                JOIN copilot_io_index_chunks AS chunks ON chunks.id = copilot_io_index_fts.rowid
                WHERE copilot_io_index_fts MATCH ?
            `,
            )
            .get('"migration"');
        expect(hit).toEqual({ startLine: 201, endLine: 205 });
    });

    it('reverte integralmente a migração do FTS quando o registro da versão falha', () => {
        const db = new Database(':memory:');
        createLegacyIoIndex(db, 'legacy rollback token');
        db.exec(`
            CREATE TABLE copilot_io_index_schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at_ms INTEGER NOT NULL
            ) STRICT;
            INSERT INTO copilot_io_index_schema_migrations(version, name, applied_at_ms)
            VALUES (1, 'create_legacy_io_index', 1);
            CREATE TRIGGER reject_io_index_v2
            BEFORE INSERT ON copilot_io_index_schema_migrations
            WHEN NEW.version = 2
            BEGIN
                SELECT RAISE(ABORT, 'forced migration failure');
            END;
        `);

        expect(() => ensureIoIndexSchema(db)).toThrow(/forced migration failure/u);

        expect(
            db
                .prepare('PRAGMA table_info(copilot_io_index_fts)')
                .all()
                .map((column) => /** @type {{ name: string }} */ (column).name),
        ).toEqual(['file_path', 'relative_path', 'content']);
        expect(db.prepare('SELECT COUNT(*) AS total FROM copilot_io_index_fts').get()).toEqual({ total: 1 });
        expect(db.prepare('SELECT COUNT(*) AS total FROM copilot_io_index_chunks').get()).toEqual({ total: 0 });
        expect(
            db
                .prepare('PRAGMA table_info(copilot_io_index_files)')
                .all()
                .map((column) => /** @type {{ name: string }} */ (column).name),
        ).not.toContain('dev');
    });

    it('indexa diretório com metadados, FTS, símbolos e imports', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });

        const result = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });

        expect(result.available).toBe(true);
        expect(result.indexed).toBe(3);
        expect(result.failed).toBe(0);

        const stats = index.getStats();
        expect(stats.available).toBe(true);
        expect(stats.schemaVersion).toBe(IO_INDEX_SCHEMA_VERSION);
        expect(stats.files).toBe(3);
        expect(stats.symbols).toBeGreaterThanOrEqual(2);
        expect(stats.imports).toBeGreaterThanOrEqual(1);
        expect(stats.chunks).toBe(3);
        expect(stats.bytesIndexed).toBeGreaterThan(0);

        const textResults = index.search('semantic index token');
        expect(textResults.length).toBeGreaterThanOrEqual(1);
        expect(textResults[0]?.relativePath).toContain('notes.md');
        expect(textResults[0]).toMatchObject({ chunkIndex: 0, startLine: 1, endLine: 4 });

        const symbols = index.findSymbol('alphaHelper');
        expect(symbols.length).toBeGreaterThanOrEqual(1);
        expect(symbols[0]?.symbolName).toBe('alphaHelper');
    });

    it('busca substring literal exata no conteúdo bruto sem depender da tokenização FTS', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        const root = /** @type {string} */ (tmpDir);
        await index.indexDirectory(root, { extensions: ['.js', '.md'], recursive: true });

        const exact = index.searchLiteral('betaValue = 42', { caseSensitive: true });
        expect(exact).toHaveLength(1);
        expect(exact[0]?.relativePath).toContain('nested/beta.js');
        expect(exact[0]?.snippet).toContain('betaValue = 42');

        expect(index.searchLiteral('BETAVALUE = 42', { caseSensitive: true })).toEqual([]);
        expect(index.searchLiteral('BETAVALUE = 42', { caseSensitive: false })).toHaveLength(1);

        const scoped = index.searchLiteral('betaValue', {
            pathPrefix: join(root, 'alpha.js'),
            caseSensitive: true,
        });
        expect(scoped).toHaveLength(1);
        expect(scoped[0]?.relativePath).toBe('alpha.js');
    });

    it('retorna o chunk e a faixa de linhas que contêm o match', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        const content = Array.from({ length: 450 }, (_, index) =>
            index === 204 ? 'localized chunk search token' : `line ${index + 1}`,
        ).join('\n');

        await index.indexTextFile({
            filePath: join(/** @type {string} */ (tmpDir), 'long.md'),
            workspaceRoot: /** @type {string} */ (tmpDir),
            content,
            sizeBytes: Buffer.byteLength(content),
            mtimeMs: 1,
            ctimeMs: null,
        });

        expect(index.search('localized chunk search token')).toEqual([
            expect.objectContaining({
                relativePath: 'long.md',
                chunkIndex: 1,
                startLine: 201,
                endLine: 400,
            }),
        ]);
    });

    it('busca símbolo com filtro SQL scoped antes de aplicar limit', async () => {
        expect(tmpDir).toBeTruthy();
        const root = /** @type {string} */ (tmpDir);
        await mkdir(join(root, 'many'), { recursive: true });
        await mkdir(join(root, 'wanted'), { recursive: true });
        for (let i = 0; i < 12; i += 1) {
            await writeFile(
                join(root, 'many', `outside-${i}.js`),
                'export function sharedSymbol() { return 1; }\n',
                'utf8',
            );
        }
        await writeFile(join(root, 'wanted', 'inside.js'), 'export function sharedSymbol() { return 2; }\n', 'utf8');

        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await index.indexDirectory(root, { extensions: ['.js'], recursive: true });

        const symbols = index.findSymbol('sharedSymbol', {
            pathPrefix: join(root, 'wanted'),
            exactMatch: true,
            kind: 'function',
            maxResults: 1,
        });

        expect(symbols).toHaveLength(1);
        expect(symbols[0]?.relativePath).toContain('wanted/inside.js');
    });

    it('respeita exactMatch case-insensitive no índice simbólico', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js'], recursive: true });

        const symbols = index.findSymbol('alphahelper', {
            pathPrefix: /** @type {string} */ (tmpDir),
            exactMatch: true,
            caseSensitive: false,
        });

        expect(symbols.length).toBeGreaterThanOrEqual(1);
        expect(symbols[0]?.symbolName).toBe('alphaHelper');
    });

    it('invalida path indexado', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js'], recursive: true });

        expect(index.findSymbol('alphaHelper').length).toBeGreaterThanOrEqual(1);
        expect(index.invalidatePath(join(/** @type {string} */ (tmpDir), 'alpha.js'))).toBe(true);
        expect(index.findSymbol('alphaHelper')).toEqual([]);
    });

    it('invalida subárvore quando o path é diretório', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        expect(index.getStats().files).toBe(3);
        expect(index.invalidatePath(/** @type {string} */ (tmpDir))).toBe(true);

        expect(index.getStats().files).toBe(0);
        expect(index.search('semantic index token')).toEqual([]);
        expect(index.findSymbol('betaValue')).toEqual([]);
    });

    it('pula reindex quando fingerprint mtime/size continua fresco', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });

        const first = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });
        const second = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });

        expect(first.indexed).toBe(3);
        expect(second.indexed).toBe(0);
        expect(second.unchanged).toBe(3);
        expect(second.skipped).toBeGreaterThanOrEqual(3);
        expect(second).toMatchObject({
            unchangedFingerprintFastPath: 3,
            unchangedSnapshotRechecks: 0,
        });
    });

    it('reprojeta símbolos quando a policy Babel muda mesmo com fingerprint idêntico', async () => {
        expect(tmpDir).toBeTruthy();
        const root = /** @type {string} */ (tmpDir);
        const filePath = join(root, 'alpha.js');
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await index.indexDirectory(root, { extensions: ['.js'], recursive: true });

        const before = /** @type {{ metadataJson: string }} */ (
            db
                .prepare('SELECT metadata_json AS metadataJson FROM copilot_io_index_files WHERE file_path = ?')
                .get(filePath)
        );
        expect(JSON.parse(before.metadataJson).parserPolicyVersion).toBe(BABEL_PARSER_POLICY_VERSION);
        db.prepare(
            'UPDATE copilot_io_index_files SET metadata_json = json_set(metadata_json, ?, ?) WHERE file_path = ?',
        ).run('$.parserPolicyVersion', 'legacy-policy', filePath);

        const second = await index.indexDirectory(root, { extensions: ['.js'], recursive: true });
        expect(second).toMatchObject({ indexed: 1, unchanged: 1, parserPolicyRefreshes: 1 });

        const after = /** @type {{ metadataJson: string }} */ (
            db
                .prepare('SELECT metadata_json AS metadataJson FROM copilot_io_index_files WHERE file_path = ?')
                .get(filePath)
        );
        expect(JSON.parse(after.metadataJson).parserPolicyVersion).toBe(BABEL_PARSER_POLICY_VERSION);
    });

    it('rejeita projeção FileSymbols produzida por policy Babel antiga', async () => {
        expect(tmpDir).toBeTruthy();
        const root = /** @type {string} */ (tmpDir);
        const filePath = join(root, 'alpha.js');
        const content =
            "import { betaValue } from './nested/beta.js';\nexport function alphaHelper() { return betaValue; }\n";
        const fileStat = await stat(filePath);
        const currentSymbols = await parseFileSymbols(filePath, content);
        const staleSymbols = {
            ...currentSymbols,
            parserPolicyVersion: 'legacy-policy',
            symbols: [{ kind: /** @type {const} */ ('variable'), name: 'staleOnly', exported: true, line: 1 }],
            exports: ['staleOnly'],
        };
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });

        await index.indexTextFile(
            {
                filePath,
                workspaceRoot: root,
                content,
                sizeBytes: Buffer.byteLength(content),
                mtimeMs: fileStat.mtimeMs,
                ctimeMs: fileStat.ctimeMs,
                dev: Number(fileStat.dev),
                ino: Number(fileStat.ino),
            },
            { parsedSymbols: staleSymbols },
        );

        expect(index.findSymbol('staleOnly')).toEqual([]);
        expect(index.findSymbol('alphaHelper')).toHaveLength(1);
        expect(index.getStats().parsedSymbolPolicyRejects).toBe(1);
    });

    it('mantém second-stat estrito como opção explícita para unchanged fingerprints', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'freshness-strict-recheck');
        await mkdir(root);
        await writeFile(join(root, 'freshness.md'), 'stable\n', 'utf8');
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db, recheckUnchangedSnapshot: true });
        await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        const second = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(second).toMatchObject({
            indexed: 0,
            unchanged: 1,
            unchangedFingerprintFastPath: 0,
            unchangedSnapshotRechecks: 1,
            freshnessPolicy: { recheckUnchangedSnapshot: true },
        });
    });

    it('reindexa mudança externa same-size/same-mtime detectada por ctime e identidade', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'freshness-ctime');
        const filePath = join(root, 'freshness.md');
        await mkdir(root);
        await writeFile(filePath, 'oldfresh\n', 'utf8');
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db, hashVerifyMaxBytes: 1 });
        await index.indexDirectory(root, { extensions: ['.md'], recursive: false });
        const before = await stat(filePath);

        await new Promise((resolve) => setTimeout(resolve, 10));
        await writeFile(filePath, 'newfresh\n', 'utf8');
        await utimes(filePath, before.atime, before.mtime);
        const after = await stat(filePath);
        expect(after.size).toBe(before.size);
        expect(after.mtimeMs).toBeCloseTo(before.mtimeMs, 0);
        expect(after.ctimeMs).not.toBe(before.ctimeMs);

        const second = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(second.indexed).toBe(1);
        expect(index.search('oldfresh')).toEqual([]);
        expect(index.search('newfresh')).toHaveLength(1);
    });

    it('usa hash periódico bounded quando metadata parece indistinguível', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'freshness-hash');
        const filePath = join(root, 'freshness.md');
        await mkdir(root);
        await writeFile(filePath, 'oldfresh\n', 'utf8');
        let currentTime = 1_000;
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({
            db,
            now: () => currentTime,
            hashVerifyIntervalMs: 100,
            hashVerifyMaxBytes: 1024,
        });
        await index.indexDirectory(root, { extensions: ['.md'], recursive: false });
        const before = await stat(filePath);

        await writeFile(filePath, 'newfresh\n', 'utf8');
        await utimes(filePath, before.atime, before.mtime);
        const after = await stat(filePath);
        db.prepare(
            `
            UPDATE copilot_io_index_files
            SET mtime_ms = ?, ctime_ms = ?, size_bytes = ?, dev = ?, ino = ?
            WHERE file_path = ?
        `,
        ).run(after.mtimeMs, after.ctimeMs, after.size, Number(after.dev), Number(after.ino), filePath);
        currentTime = 1_101;

        const second = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(second.indexed).toBe(1);
        expect(second.hashVerifiedUnchanged).toBe(0);
        expect(second).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 0,
            hashVerificationMisses: 1,
        });
        expect(index.getStats()).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 0,
            hashVerificationMisses: 1,
            freshnessPolicy: {
                strategy: 'mtime-size-ctime-dev-ino-parser-policy-periodic-hash',
                hashVerifyMaxBytes: 1024,
                hashVerifyIntervalMs: 100,
            },
        });
        expect(index.search('newfresh')).toHaveLength(1);
    });

    it('renova fingerprint periódico sem refazer FTS quando hash não mudou', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'freshness-hash-hit');
        await mkdir(root);
        await writeFile(join(root, 'freshness.md'), 'samefresh\n', 'utf8');
        let currentTime = 2_000;
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({
            db,
            now: () => currentTime,
            hashVerifyIntervalMs: 100,
            hashVerifyMaxBytes: 1024,
        });
        await index.indexDirectory(root, { extensions: ['.md'], recursive: false });
        currentTime = 2_101;

        const second = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(second.indexed).toBe(0);
        expect(second.unchanged).toBe(1);
        expect(second.hashVerifiedUnchanged).toBe(1);
        expect(second).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 1,
            hashVerificationMisses: 0,
        });
        expect(index.getStats()).toMatchObject({
            hashVerifications: 1,
            hashVerificationHits: 1,
            hashVerificationMisses: 0,
        });
    });

    it('repete snapshot quando processo externo substitui arquivo antes do commit', async () => {
        expect(tmpDir).toBeTruthy();
        const root = join(/** @type {string} */ (tmpDir), 'external-race');
        const filePath = join(root, 'race.md');
        await mkdir(root);
        await writeFile(filePath, 'old-token\n', 'utf8');
        let replaced = false;
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({
            db,
            onPhase: async (phase, details) => {
                if (
                    phase !== 'before-file-commit-validation' ||
                    details['action'] !== 'index' ||
                    details['attempt'] !== 1 ||
                    details['filePath'] !== filePath ||
                    replaced
                ) {
                    return;
                }
                replaced = true;
                await replaceTextFromChild(filePath, 'new-token\n');
            },
        });

        const result = await index.indexDirectory(root, { extensions: ['.md'], recursive: false });

        expect(result).toMatchObject({ indexed: 1, failed: 0, snapshotConflicts: 1 });
        expect(index.search('old-token')).toEqual([]);
        expect(index.search('new-token')).toHaveLength(1);
        expect(index.getStats().snapshotConflicts).toBe(1);
    });

    it('remove do índice arquivos deletados em build completo', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        await rm(join(/** @type {string} */ (tmpDir), 'notes.md'));
        const second = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            recursive: true,
        });

        expect(second.pruned).toBe(1);
        expect(index.getStats().files).toBe(2);
        expect(index.search('semantic index token')).toEqual([]);
    });

    it('filtra busca FTS por pathPrefix no SQL', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await writeFile(
            join(/** @type {string} */ (tmpDir), 'nested', 'notes-nested.md'),
            '# Nested\n\nsemantic index token\n',
            'utf8',
        );
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.md'], recursive: true });

        const rootResults = index.search('semantic index token', { pathPrefix: /** @type {string} */ (tmpDir) });
        const nestedResults = index.search('semantic index token', {
            pathPrefix: join(/** @type {string} */ (tmpDir), 'nested'),
        });

        expect(rootResults.length).toBeGreaterThanOrEqual(2);
        expect(nestedResults.length).toBe(1);
        expect(nestedResults[0]?.relativePath).toContain('nested/notes-nested.md');

        const range = buildIndexPathTreeRange(join(/** @type {string} */ (tmpDir), 'nested'));
        const plan = db
            .prepare(
                `
                EXPLAIN QUERY PLAN
                SELECT id
                FROM copilot_io_index_chunks
                WHERE file_path = ? OR (file_path >= ? AND file_path < ?)
            `,
            )
            .all(range.exact, range.descendantStart, range.descendantEnd)
            .map((row) => String(/** @type {{ detail?: unknown }} */ (row).detail ?? ''));
        expect(plan.some((detail) => detail.includes('idx_io_index_chunks_file'))).toBe(true);
        expect(plan.some((detail) => detail === 'SCAN copilot_io_index_chunks')).toBe(false);
    });

    it('limita busca FTS e símbolos com janela explícita', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await writeFile(join(/** @type {string} */ (tmpDir), 'one.md'), 'semantic index token\n', 'utf8');
        await writeFile(join(/** @type {string} */ (tmpDir), 'two.md'), 'semantic index token\n', 'utf8');
        await writeFile(join(/** @type {string} */ (tmpDir), 'gamma-a.js'), 'export const gammaAlpha = 1;\n', 'utf8');
        await writeFile(join(/** @type {string} */ (tmpDir), 'gamma-b.js'), 'export const gammaBeta = 2;\n', 'utf8');
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        expect(index.search('semantic index token', { maxResults: 1 })).toHaveLength(1);
        expect(index.findSymbol('gamma', { maxResults: 1 })).toHaveLength(1);
    });

    it('não poda entradas fora de build parcial com include', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });
        await index.indexDirectory(/** @type {string} */ (tmpDir), { extensions: ['.js', '.md'], recursive: true });

        const second = await index.indexDirectory(/** @type {string} */ (tmpDir), {
            extensions: ['.js', '.md'],
            include: ['alpha.js'],
            recursive: true,
        });

        expect(second.pruned).toBe(0);
        expect(index.getStats().files).toBe(3);
        expect(index.search('semantic index token').length).toBeGreaterThanOrEqual(1);
    });

    it('persiste status failed quando parser retorna parseError no objeto', async () => {
        expect(tmpDir).toBeTruthy();
        const db = new Database(':memory:');
        const index = createPreparedIoIndex({ db });

        const result = await index.indexTextFile({
            filePath: join(/** @type {string} */ (tmpDir), 'broken.js'),
            workspaceRoot: /** @type {string} */ (tmpDir),
            content: 'export function {',
            sizeBytes: Buffer.byteLength('export function {', 'utf8'),
            mtimeMs: Date.now(),
            ctimeMs: null,
        });

        expect(result.parseError).toBeTruthy();
        const stats = index.getStats();
        expect(stats.files).toBe(1);
        expect(stats.failedFiles).toBe(1);
        expect(stats.freshFiles).toBe(0);
    });
});
