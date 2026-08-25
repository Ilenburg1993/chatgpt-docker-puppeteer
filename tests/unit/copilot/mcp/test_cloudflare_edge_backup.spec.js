import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import {
    buildCloudflareEdgeBackupFileName,
    createCloudflareEdgeBackupStore,
} from '#copilot/mcp/public/cloudflare/edge';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string | undefined} */
let tempDir;

afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
});

describe('mcp/cloudflare/edge-backup', () => {
    it('normalizes deterministic backup filenames', () => {
        const fileName = buildCloudflareEdgeBackupFileName(new Date('2026-05-24T17:45:01.123Z'), 'before-rate-limit');

        expect(fileName).toBe('cloudflare-edge-snapshot-2026-05-24T17-45-01-123Z-before-rate-limit.json');
    });

    it('writes and lists local Cloudflare edge snapshot backups', async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-cloudflare-edge-backup-'));
        const io = createConfiguredFsIo(
            createConfiguredFsGrant({
                id: 'test.mcp.cloudflare.edge-backup',
                roots: [tempDir],
                operations: ['list', 'read', 'stat', 'write'],
                symlinkPolicy: 'deny',
                durability: ['file-and-directory'],
            }),
        );
        const store = createCloudflareEdgeBackupStore({ dir: tempDir, io });
        const result = await store.write(
            {
                ok: true,
                capturedAt: '2026-05-24T17:45:01.123Z',
                endpoint: { publicMcpUrl: 'https://mcp.aurelin.org/mcp' },
                readiness: { mutationReady: true, criticalCount: 0 },
                policyDiff: { summary: { diffCount: 3, criticalDiffs: 0 } },
            },
            {
                label: 'Before Rate Limit!',
                now: new Date('2026-05-24T17:45:01.123Z'),
            },
        );

        expect(result.ok).toBe(true);
        expect(result['backupWritten']).toBe(true);
        expect(result['backup']).toMatchObject({
            label: 'before-rate-limit',
            fileName: 'cloudflare-edge-snapshot-2026-05-24T17-45-01-123Z-before-rate-limit.json',
        });

        const backup = /** @type {{ relativePath: string }} */ (result['backup']);
        const persisted = JSON.parse(await readFile(String(backup.relativePath), 'utf8'));
        expect(persisted.kind).toBe('cloudflare-edge-snapshot-backup');
        expect(persisted.snapshot.readiness.mutationReady).toBe(true);
        expect((await stat(String(backup.relativePath))).mode & 0o777).toBe(0o600);

        await symlink(
            path.basename(String(backup.relativePath)),
            path.join(tempDir, 'cloudflare-edge-snapshot-symlink.json'),
        );
        const listed = await store.list({ limit: 10 });
        expect(listed.ok).toBe(true);
        expect(listed['total']).toBe(1);
        expect(/** @type {Array<Record<string, unknown>>} */ (listed['backups'])).toHaveLength(1);
        expect(listed['backups']).toEqual([
            expect.objectContaining({
                valid: true,
                label: 'before-rate-limit',
                endpoint: { publicMcpUrl: 'https://mcp.aurelin.org/mcp' },
            }),
        ]);
    });
});
