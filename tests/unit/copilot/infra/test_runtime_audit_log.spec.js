// @ts-check

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    buildIoMutationAuditRecord,
    completeIoOperationEnvelope,
    createIoOperationEnvelope,
    getIoMutationAuditLogPath,
    recordIoMutationAudit,
} from '#copilot/infra/internal/operations';

/** @type {string[]} */
const TEMP_DIRS = [];

afterEach(async () => {
    delete process.env['COPILOT_IO_MUTATION_AUDIT_LOG_PATH'];
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe('infra/operations/audit-log', () => {
    it('fica desabilitado quando env de audit não está definido', async () => {
        expect(getIoMutationAuditLogPath()).toBe(null);
        const envelope = completeIoOperationEnvelope(createIoOperationEnvelope({ capability: 'file.write' }));

        await expect(recordIoMutationAudit(envelope)).resolves.toEqual({ enabled: false, path: null, written: false });
    });

    it('monta e persiste JSONL append-only quando env está definido', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-runtime-audit-'));
        TEMP_DIRS.push(dir);
        const logPath = join(dir, 'io-mutations.jsonl');
        process.env['COPILOT_IO_MUTATION_AUDIT_LOG_PATH'] = logPath;
        const envelope = completeIoOperationEnvelope(
            createIoOperationEnvelope({
                capability: 'file.patch',
                riskClass: 'high',
                targets: ['/tmp/a.txt'],
                evidence: { tool: 'patch_file', contentHash: 'abc' },
            }),
            { traceId: 'trace-1' },
        );

        const record = buildIoMutationAuditRecord(envelope, { tool: 'patch_file', result: { path: '/tmp/a.txt' } });
        expect(record).toMatchObject({
            schemaVersion: 1,
            kind: 'copilot.io.mutation',
            capability: 'file.patch',
            tool: 'patch_file',
            traceId: 'trace-1',
        });

        const audit = await recordIoMutationAudit(envelope, { tool: 'patch_file', result: { path: '/tmp/a.txt' } });

        expect(audit).toMatchObject({ enabled: true, path: logPath, written: true });
        const lines = (await readFile(logPath, 'utf8')).trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
            kind: 'copilot.io.mutation',
            operationId: envelope.operationId,
            capability: 'file.patch',
            status: 'applied',
        });
    });
});
