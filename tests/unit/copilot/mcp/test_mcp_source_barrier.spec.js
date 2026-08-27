// @ts-check

import { createComposedMcpProcessHost } from '#copilot/mcp/public/composition/process-host';
import { buildMcpRuntimeSourcePromotionEnvironment } from '#copilot/mcp/public/runtime/source-generation';
import {
    captureRepositorySourceBarrier,
    fingerprintRepositorySourceBarrierEntries,
    parseRepositorySourceBarrierJson,
    verifyRepositorySourceBarrier,
} from '#copilot/mcp/public/workspace/repository/integrity';
import { createMcpAuditCapability, readMcpAuditProcessConfig } from '#copilot/testing/mcp/observability';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'vitest';
import {
    collectSourceBarrierWorktreePaths,
    mergeSourceBarrierWorktreePaths,
    parseNulSeparatedGitPaths,
} from '../../../../src/copilot/mcp/scripts/source-barrier.js';

const PROCESS_HOST = createComposedMcpProcessHost({
    hostId: 'mcp-source-barrier-unit-process-host',
    backgroundServices: false,
});
const WORKSPACE = PROCESS_HOST.workspace;
const execFileAsync = promisify(execFile);
const SOURCE_BARRIER_CLI = path.join(process.cwd(), 'src/copilot/mcp/scripts/source-barrier.js');
/** @type {string[]} */
const TEST_DIRS = [];

async function createTestDir() {
    const dir = await fs.mkdtemp(path.join(process.cwd(), 'src/copilot/.ai/jobs/source-barrier-test-'));
    TEST_DIRS.push(dir);
    return dir;
}

/** @param {string | Buffer} value */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

describe('repository source barrier', () => {
    afterEach(async () => {
        await Promise.all(TEST_DIRS.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    });

    it('parses and merges NUL-delimited Git path discovery deterministically', () => {
        assert.deepEqual(parseNulSeparatedGitPaths('b.js\0a.js\0'), ['b.js', 'a.js']);
        assert.deepEqual(mergeSourceBarrierWorktreePaths(['./b.js', 'a.js'], ['b.js', 'c\\d.js']), [
            'a.js',
            'b.js',
            'c/d.js',
        ]);
    });

    it('discovers staged, unstaged, untracked, deleted and both sides of renames for worktree capture', async () => {
        const dir = await createTestDir();
        await execFileAsync('git', ['init', '-q'], { cwd: dir });
        await execFileAsync('git', ['config', 'user.name', 'Source Barrier Test'], { cwd: dir });
        await execFileAsync('git', ['config', 'user.email', 'source-barrier@example.invalid'], { cwd: dir });
        await fs.writeFile(path.join(dir, 'keep.js'), 'export const keep = 1;\n', 'utf8');
        await fs.writeFile(path.join(dir, 'delete.js'), 'export const remove = 1;\n', 'utf8');
        await fs.writeFile(path.join(dir, 'rename-old.js'), 'export const rename = 1;\n', 'utf8');
        await execFileAsync('git', ['add', '.'], { cwd: dir });
        await execFileAsync('git', ['commit', '-qm', 'baseline'], { cwd: dir });

        await fs.writeFile(path.join(dir, 'keep.js'), 'export const keep = 2;\n', 'utf8');
        await fs.unlink(path.join(dir, 'delete.js'));
        await execFileAsync('git', ['mv', 'rename-old.js', 'rename-new.js'], { cwd: dir });
        await fs.writeFile(path.join(dir, 'untracked.js'), 'export const untracked = true;\n', 'utf8');

        assert.deepEqual(collectSourceBarrierWorktreePaths(dir), [
            'delete.js',
            'keep.js',
            'rename-new.js',
            'rename-old.js',
            'untracked.js',
        ]);
    });

    it('produces a deterministic path-sorted fingerprint and verifies unchanged bytes', async () => {
        const dir = await createTestDir();
        const a = path.join(dir, 'a.txt');
        const b = path.join(dir, 'b.txt');
        await fs.writeFile(a, 'alpha\n', 'utf8');
        await fs.writeFile(b, 'beta\n', 'utf8');

        const reversed = await captureRepositorySourceBarrier(WORKSPACE, [b, a]);
        const ordered = await captureRepositorySourceBarrier(WORKSPACE, [a, b]);

        assert.deepEqual(
            reversed.entries.map((entry) => path.basename(entry.path)),
            ['a.txt', 'b.txt'],
        );
        assert.equal(reversed.version, 2);
        assert.equal(reversed.domain, 'copilot.repository-source-barrier.v2');
        assert.ok(reversed.entries.every((entry) => 'kind' in entry && entry.kind === 'file'));
        assert.equal(reversed.fingerprint, ordered.fingerprint);
        assert.equal(fingerprintRepositorySourceBarrierEntries(reversed.entries), reversed.fingerprint);
        const verified = await verifyRepositorySourceBarrier(WORKSPACE, reversed);
        assert.equal(verified.ok, true);
        assert.equal(verified.currentFingerprint, reversed.fingerprint);
    });

    it('captures absent-path tombstones and rejects a later unexpected file', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'absent.txt');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);

        assert.equal(barrier.version, 2);
        assert.deepEqual(barrier.entries, [
            {
                kind: 'absent',
                path: WORKSPACE.toRelativePath(file).replaceAll('\\', '/'),
            },
        ]);
        const verified = await verifyRepositorySourceBarrier(WORKSPACE, barrier);
        assert.equal(verified.currentFingerprint, barrier.fingerprint);

        await fs.writeFile(file, '', 'utf8');
        const presentBarrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        assert.notEqual(presentBarrier.fingerprint, barrier.fingerprint);
        await assert.rejects(
            () => verifyRepositorySourceBarrier(WORKSPACE, barrier),
            /** @param {unknown} error */ (error) => {
                const candidate = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (error);
                assert.equal(candidate.code, 'ERR_SOURCE_DRIFT');
                const rows = /** @type {Record<string, unknown>[]} */ (candidate.details?.['drift']);
                assert.equal(rows[0]?.['kind'], 'unexpected-file');
                assert.equal(rows[0]?.['expectedSha256'], null);
                assert.match(String(rows[0]?.['actualSha256']), /^[a-f0-9]{64}$/u);
                return true;
            },
        );
    });

    it('parses and verifies legacy v1 manifests without changing their fingerprint domain', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'legacy.txt');
        const content = 'legacy-source\n';
        await fs.writeFile(file, content, 'utf8');
        const current = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        const currentEntry = current.entries[0];
        assert.equal(currentEntry?.kind, 'file');
        if (!currentEntry || currentEntry.kind !== 'file') throw new Error('Expected v2 file entry.');
        const legacyEntry = Object.freeze({
            path: currentEntry.path,
            sha256: currentEntry.sha256,
            bytes: currentEntry.bytes,
        });
        const legacy = {
            schema: 'copilot.repository-source-barrier',
            version: 1,
            algorithm: 'sha256',
            domain: 'copilot.repository-source-barrier.v1',
            capturedAt: '2026-08-27T00:00:00.000Z',
            entryCount: 1,
            fingerprint: fingerprintRepositorySourceBarrierEntries([legacyEntry]),
            entries: [legacyEntry],
        };

        const parsed = parseRepositorySourceBarrierJson(JSON.stringify(legacy));
        assert.equal(parsed.version, 1);
        assert.equal(parsed.fingerprint, legacy.fingerprint);
        const verified = await verifyRepositorySourceBarrier(WORKSPACE, parsed);
        assert.equal(verified.currentFingerprint, legacy.fingerprint);
        assert.equal(verified.fingerprint, legacy.fingerprint);
    });

    it('fails closed with ERR_SOURCE_DRIFT on a same-length external overwrite', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'shared.txt');
        await fs.writeFile(file, 'editor-A\n', 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);

        await fs.writeFile(file, 'editor-B\n', 'utf8');

        await assert.rejects(
            () => verifyRepositorySourceBarrier(WORKSPACE, barrier),
            /** @param {unknown} error */ (error) => {
                const candidate = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (error);
                assert.equal(candidate.code, 'ERR_SOURCE_DRIFT');
                assert.equal(candidate.details?.['promotionAllowed'], false);
                const rows = /** @type {Record<string, unknown>[]} */ (candidate.details?.['drift']);
                assert.equal(rows.length, 1);
                assert.equal(rows[0]?.['kind'], 'content-changed');
                assert.equal(rows[0]?.['provenance'], 'unattributed');
                assert.notEqual(rows[0]?.['expectedSha256'], rows[0]?.['actualSha256']);
                return true;
            },
        );
    });

    it('reports matching MCP provenance without allowing a stale barrier to pass', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'controlled.txt');
        const before = 'before\n';
        const after = 'after!\n';
        await fs.writeFile(file, before, 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        await fs.writeFile(file, after, 'utf8');

        await assert.rejects(
            () =>
                verifyRepositorySourceBarrier(WORKSPACE, barrier, {
                    transitions: [
                        {
                            path: barrier.entries[0]?.path,
                            previousHash: sha256(before),
                            contentHash: sha256(after),
                            traceId: 'io-source-barrier-test',
                        },
                    ],
                }),
            /** @param {unknown} error */ (error) => {
                const candidate = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (error);
                assert.equal(candidate.code, 'ERR_SOURCE_DRIFT');
                const rows = /** @type {Record<string, unknown>[]} */ (candidate.details?.['drift']);
                assert.equal(rows[0]?.['provenance'], 'controlled-mcp-transition');
                assert.equal(rows[0]?.['traceId'], 'io-source-barrier-test');
                assert.equal(candidate.details?.['promotionAllowed'], false);
                return true;
            },
        );
    });

    it('automatically attributes drift from the persisted MCP audit, including patch-batch target transitions', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'audited.txt');
        const auditFile = path.join(dir, 'audit.jsonl');
        const before = 'before-audit\n';
        const after = 'after-audit!\n';
        await fs.writeFile(file, before, 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        await fs.writeFile(file, after, 'utf8');
        const audit = createMcpAuditCapability(
            readMcpAuditProcessConfig({ COPILOT_MCP_AUDIT_FILE: auditFile, COPILOT_MCP_AUDIT_SYNC: 'true' }),
        );
        await audit.append({
            event: 'repo_apply_patch_batch_applied',
            tool: 'repo_apply_patch_batch',
            targetTransitions: [
                {
                    path: barrier.entries[0]?.path,
                    previousHash: sha256(before),
                    contentHash: sha256(after),
                    traceId: 'io-persisted-batch-transition',
                },
            ],
        });

        try {
            await assert.rejects(
                () => verifyRepositorySourceBarrier(WORKSPACE, barrier, { audit }),
                /** @param {unknown} error */ (error) => {
                    const candidate = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (
                        error
                    );
                    assert.equal(candidate.code, 'ERR_SOURCE_DRIFT');
                    const rows = /** @type {Record<string, unknown>[]} */ (candidate.details?.['drift']);
                    assert.equal(rows[0]?.['provenance'], 'controlled-mcp-transition');
                    assert.equal(rows[0]?.['traceId'], 'io-persisted-batch-transition');
                    const evidence = /** @type {Record<string, unknown>} */ (candidate.details?.['provenanceEvidence']);
                    assert.equal(evidence['attempted'], true);
                    assert.equal(evidence['available'], true);
                    assert.equal(evidence['relevantTransitions'], 1);
                    assert.equal(candidate.details?.['promotionAllowed'], false);
                    return true;
                },
            );
        } finally {
            await audit.flush();
        }
    });

    it('runs a harmless child under one fingerprint and verifies the same source before and after', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'stable-child.txt');
        const manifest = path.join(dir, 'barrier.json');
        await fs.writeFile(file, 'stable-child\n', 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        await fs.writeFile(manifest, `${JSON.stringify(barrier, null, 2)}\n`, 'utf8');

        const child = await execFileAsync(process.execPath, [
            SOURCE_BARRIER_CLI,
            'run',
            '--manifest',
            manifest,
            '--expected-fingerprint',
            barrier.fingerprint,
            '--',
            process.execPath,
            '-e',
            'process.exit(0)',
        ]);
        const result = JSON.parse(child.stdout.trim());
        assert.equal(result.success, true);
        assert.equal(result.command, 'run');
        assert.equal(result.fingerprint, barrier.fingerprint);
        assert.equal(result.currentFingerprint, barrier.fingerprint);
        assert.equal(result.child.exitCode, 0);
    });

    it('relays only the exact controlled-promotion binding through the source-barrier child boundary', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'promotion-child.txt');
        const manifest = path.join(dir, 'barrier.json');
        const observedEnvPath = path.join(dir, 'promotion-env.json');
        await fs.writeFile(file, 'promotion-child\n', 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        await fs.writeFile(manifest, `${JSON.stringify(barrier, null, 2)}\n`, 'utf8');
        const manifestRelative = path.relative(process.cwd(), manifest).split(path.sep).join('/');
        const promotionEnv = buildMcpRuntimeSourcePromotionEnvironment({
            requestId: 'mcp-reload-dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            sourceBarrierFingerprint: barrier.fingerprint,
            sourceBarrierManifestPath: manifestRelative,
        });

        const child = await execFileAsync(
            process.execPath,
            [
                SOURCE_BARRIER_CLI,
                'run',
                '--manifest',
                manifest,
                '--expected-fingerprint',
                barrier.fingerprint,
                '--',
                process.execPath,
                '--input-type=module',
                '-e',
                `import fs from 'node:fs'; fs.writeFileSync(process.argv[1], JSON.stringify({ requestId: process.env.COPILOT_MCP_PROMOTION_REQUEST_ID ?? null, fingerprint: process.env.COPILOT_MCP_PROMOTED_SOURCE_FINGERPRINT ?? null, manifestPath: process.env.COPILOT_MCP_PROMOTED_MANIFEST_PATH ?? null, futureSecretPresent: Object.hasOwn(process.env, 'FUTURE_UNKNOWN_SECRET') }));`,
                observedEnvPath,
            ],
            {
                env: {
                    ...process.env,
                    ...promotionEnv,
                    FUTURE_UNKNOWN_SECRET: 'must-not-cross-source-barrier',
                },
            },
        );
        const result = JSON.parse(child.stdout.trim());
        const observed = JSON.parse(await fs.readFile(observedEnvPath, 'utf8'));
        assert.equal(result.success, true);
        assert.deepEqual(observed, {
            requestId: 'mcp-reload-dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            fingerprint: barrier.fingerprint,
            manifestPath: manifestRelative,
            futureSecretPresent: false,
        });
    });

    it('source-barrier run detects source mutation performed by the child after the initial verify', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'child-drift.txt');
        const manifest = path.join(dir, 'barrier.json');
        await fs.writeFile(file, 'before-child\n', 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        await fs.writeFile(manifest, `${JSON.stringify(barrier, null, 2)}\n`, 'utf8');

        await assert.rejects(
            () =>
                execFileAsync(process.execPath, [
                    SOURCE_BARRIER_CLI,
                    'run',
                    '--manifest',
                    manifest,
                    '--expected-fingerprint',
                    barrier.fingerprint,
                    '--',
                    process.execPath,
                    '--input-type=module',
                    '-e',
                    "import fs from 'node:fs'; fs.writeFileSync(process.argv[1], 'after-child!\\n');",
                    file,
                ]),
            /** @param {unknown} error */ (error) => {
                const candidate = /** @type {Error & { code?: number | string; stderr?: string }} */ (error);
                assert.equal(candidate.code, 2);
                const failure = JSON.parse(String(candidate.stderr ?? '').trim());
                assert.equal(failure.code, 'ERR_SOURCE_DRIFT');
                assert.equal(failure.details?.promotionAllowed, false);
                return true;
            },
        );
        assert.equal(await fs.readFile(file, 'utf8'), 'after-child!\n');
    });

    it('source-barrier verify rejects a valid manifest when the caller carries a different certified fingerprint', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'wrong-fingerprint.txt');
        const manifest = path.join(dir, 'barrier.json');
        await fs.writeFile(file, 'same-source\n', 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        await fs.writeFile(manifest, `${JSON.stringify(barrier, null, 2)}\n`, 'utf8');
        const wrongFingerprint = barrier.fingerprint === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64);

        await assert.rejects(
            () =>
                execFileAsync(process.execPath, [
                    SOURCE_BARRIER_CLI,
                    'verify',
                    '--manifest',
                    manifest,
                    '--expected-fingerprint',
                    wrongFingerprint,
                ]),
            /** @param {unknown} error */ (error) => {
                const candidate = /** @type {Error & { code?: number | string; stderr?: string }} */ (error);
                assert.equal(candidate.code, 2);
                const failure = JSON.parse(String(candidate.stderr ?? '').trim());
                assert.equal(failure.code, 'ERR_SOURCE_BARRIER_FINGERPRINT_MISMATCH');
                assert.equal(failure.details?.promotionAllowed, false);
                return true;
            },
        );
    });

    it('treats deletion after capture as source drift', async () => {
        const dir = await createTestDir();
        const file = path.join(dir, 'deleted.txt');
        await fs.writeFile(file, 'present\n', 'utf8');
        const barrier = await captureRepositorySourceBarrier(WORKSPACE, [file]);
        await fs.unlink(file);

        await assert.rejects(
            () => verifyRepositorySourceBarrier(WORKSPACE, barrier),
            /** @param {unknown} error */ (error) => {
                const candidate = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (error);
                assert.equal(candidate.code, 'ERR_SOURCE_DRIFT');
                const rows = /** @type {Record<string, unknown>[]} */ (candidate.details?.['drift']);
                assert.equal(rows[0]?.['kind'], 'missing-or-unreadable');
                return true;
            },
        );
    });
});
