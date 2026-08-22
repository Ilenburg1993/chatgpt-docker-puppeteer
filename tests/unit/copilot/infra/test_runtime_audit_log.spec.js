// @ts-check

import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    buildIoMutationAuditRecord,
    completeIoOperationEnvelope,
    createIoOperationEnvelope,
} from '#copilot/infra/internal/operations';

/** @type {string[]} */
const TEMP_DIRS = [];
/** @type {ReturnType<typeof createInfraRuntime>[]} */
const RUNTIMES = [];

afterEach(async () => {
    while (RUNTIMES.length > 0) {
        const runtime = RUNTIMES.pop();
        if (runtime) await runtime.dispose().catch(() => {});
    }
    delete process.env['COPILOT_IO_MUTATION_AUDIT_LOG_PATH'];
    while (TEMP_DIRS.length > 0) {
        const dir = TEMP_DIRS.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

describe('infra/operations/audit-log', () => {
    it('fica desabilitado quando env de audit não está definido', async () => {
        const envelope = completeIoOperationEnvelope(createIoOperationEnvelope({ capability: 'file.write' }));
        const runtime = createInfraRuntime({ runtimeId: 'audit-disabled', env: {} });
        RUNTIMES.push(runtime);

        await expect(runtime.mutationAudit.record(envelope)).resolves.toEqual({
            enabled: false,
            path: null,
            written: false,
        });
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

        const runtime = createInfraRuntime({ runtimeId: 'audit-env-enabled', env: process.env });
        RUNTIMES.push(runtime);
        const audit = await runtime.mutationAudit.record(envelope, {
            tool: 'patch_file',
            result: { path: '/tmp/a.txt' },
        });

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

    it('InfraRuntime captura configuração uma vez e snapshot/dispose não materializam persistence', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-runtime-audit-config-'));
        TEMP_DIRS.push(dir);
        const firstPath = join(dir, 'first.jsonl');
        const laterPath = join(dir, 'later.jsonl');
        process.env['COPILOT_IO_MUTATION_AUDIT_LOG_PATH'] = firstPath;

        const runtime = createInfraRuntime({ runtimeId: 'audit-config-capture', env: process.env });
        RUNTIMES.push(runtime);
        process.env['COPILOT_IO_MUTATION_AUDIT_LOG_PATH'] = laterPath;

        expect(runtime.mutationAudit.path).toBe(firstPath);
        expect(runtime.mutationAudit.snapshot()).toMatchObject({
            runtimeId: 'audit-config-capture:mutation-audit',
            enabled: true,
            path: firstPath,
            materialized: false,
            disposed: false,
            writer: null,
        });
        await expect(readFile(firstPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

        const firstDispose = runtime.mutationAudit.dispose();
        const secondDispose = runtime.mutationAudit.dispose();
        expect(firstDispose).toBe(secondDispose);
        await firstDispose;
        expect(runtime.mutationAudit.snapshot()).toMatchObject({ materialized: false, disposed: true });
        await expect(readFile(firstPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(laterPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('isola writers e materialização entre InfraRuntimes concorrentes', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-runtime-audit-isolation-'));
        TEMP_DIRS.push(dir);
        const firstPath = join(dir, 'first.jsonl');
        const secondPath = join(dir, 'second.jsonl');
        const first = createInfraRuntime({ runtimeId: 'audit-runtime-a', mutationAuditLogPath: firstPath });
        const second = createInfraRuntime({ runtimeId: 'audit-runtime-b', mutationAuditLogPath: secondPath });
        RUNTIMES.push(first, second);
        const firstEnvelope = completeIoOperationEnvelope(
            createIoOperationEnvelope({ capability: 'file.write', targets: ['/tmp/a.txt'] }),
            { traceId: 'audit-a' },
        );
        const secondEnvelope = completeIoOperationEnvelope(
            createIoOperationEnvelope({ capability: 'file.patch', targets: ['/tmp/b.txt'] }),
            { traceId: 'audit-b' },
        );

        expect(first.mutationAudit.snapshot().materialized).toBe(false);
        expect(second.mutationAudit.snapshot().materialized).toBe(false);
        await expect(first.mutationAudit.record(firstEnvelope, { tool: 'write_file_content' })).resolves.toMatchObject({
            enabled: true,
            path: firstPath,
            written: true,
        });

        expect(first.mutationAudit.snapshot()).toMatchObject({
            materialized: true,
            writer: { persistedLines: 1, queueDepth: 0 },
        });
        expect(second.mutationAudit.snapshot()).toMatchObject({ materialized: false, writer: null });
        await expect(readFile(secondPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(second.mutationAudit.record(secondEnvelope, { tool: 'patch_file' })).resolves.toMatchObject({
            enabled: true,
            path: secondPath,
            written: true,
        });
        const firstRow = JSON.parse((await readFile(firstPath, 'utf8')).trim());
        const secondRow = JSON.parse((await readFile(secondPath, 'utf8')).trim());
        expect(firstRow).toMatchObject({ operationId: firstEnvelope.operationId, capability: 'file.write' });
        expect(secondRow).toMatchObject({ operationId: secondEnvelope.operationId, capability: 'file.patch' });
        expect(firstRow.operationId).not.toBe(secondRow.operationId);
    });
});
