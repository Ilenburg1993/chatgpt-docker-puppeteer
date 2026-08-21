// @ts-check

import { describe, expect, it } from 'vitest';

import {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    buildIoRollbackPlan,
    createIoRollbackToken,
    failIoChangeSet,
    parseIoRollbackToken,
    rollbackIoChangeSet,
    serializeIoRollbackToken,
    verifyIoRollbackToken,
} from '#copilot/infra/internal/operations';
import { sha256 } from '../../../../src/copilot/infra/platform/hash.js';

describe('infra/operations transaction + rollback', () => {
    it('abre changeSet, agrega entradas e finaliza aplicado', () => {
        const started = beginIoChangeSet({ capability: 'file.write', targets: ['/tmp/a.txt'] });
        expect(started.status).toBe('open');
        expect(started.entries).toHaveLength(0);

        const withEntry = appendIoChangeSetEntry(started, {
            action: 'write',
            targets: ['/tmp/a.txt'],
            rollback: {
                action: 'write',
                target: '/tmp/a.txt',
                previousHash: 'old-hash',
                contentHash: 'new-hash',
                bytes: 12,
            },
            evidence: { tool: 'write_file_content' },
        });

        expect(withEntry.entries).toHaveLength(1);
        expect(withEntry.entries[0]?.rollback?.previousHash).toBe('old-hash');

        const applied = applyIoChangeSet(withEntry, { traceId: 'trace-change-set' });
        expect(applied.status).toBe('applied');
        expect(applied.closedAtMs).toBeTypeOf('number');
        expect(applied.operation.status).toBe('applied');
        expect(applied.operation.traceId).toBe('trace-change-set');
    });

    it('marca failure e rollback lógico com evidência', () => {
        const started = beginIoChangeSet({ capability: 'file.patch' });
        const failed = failIoChangeSet(started, new Error('boom'));

        expect(failed.status).toBe('failed');
        expect(failed.operation.status).toBe('failed');
        expect(failed.operation.error).toContain('boom');

        const rolledBack = rollbackIoChangeSet(failed, { evidence: { rollbackReason: 'test' } });
        expect(rolledBack.status).toBe('rolled-back');
        expect(rolledBack.operation.evidence['rolledBack']).toBe(true);
        expect(rolledBack.operation.evidence['rollbackReason']).toBe('test');
    });

    it('permite abortar changeSet aberto como dry-run', () => {
        const started = beginIoChangeSet({ capability: 'file.copy' });
        const aborted = abortIoChangeSet(started, 'dry run');

        expect(aborted.status).toBe('aborted');
        expect(aborted.operation.status).toBe('dry-run');
        expect(aborted.operation.evidence['aborted']).toBe(true);
    });

    it('gera plano rollback reverso e token serializável verificável', () => {
        const started = beginIoChangeSet({ capability: 'file.batch' });
        const withEntries = appendIoChangeSetEntry(
            appendIoChangeSetEntry(started, {
                action: 'write',
                targets: ['/tmp/a.txt'],
                rollback: {
                    action: 'write',
                    target: '/tmp/a.txt',
                    previousHash: 'h1',
                    contentHash: 'h2',
                },
            }),
            {
                action: 'move',
                targets: ['/tmp/a.txt', '/tmp/b.txt'],
                rollback: {
                    action: 'move',
                    target: '/tmp/b.txt',
                    previousHash: 'h3',
                    contentHash: 'h4',
                    snapshotSidecar: {
                        version: 1,
                        path: '/tmp/rollback/sidecar.rollback',
                        contentHash: 'a'.repeat(64),
                        bytes: 512_000,
                        createdAtMs: 100,
                        expiresAtMs: 200,
                    },
                },
            },
        );

        const applied = applyIoChangeSet(withEntries);
        const plan = buildIoRollbackPlan(applied);
        expect(plan).toHaveLength(2);
        expect(plan[0]?.action).toBe('move');
        expect(plan[0]?.snapshotSidecar?.path).toBe('/tmp/rollback/sidecar.rollback');
        expect(plan[1]?.action).toBe('write');

        const token = createIoRollbackToken(applied);
        expect(token.version).toBe(3);
        expect(token.stepCount).toBe(2);
        expect(verifyIoRollbackToken(token)).toBe(true);

        const serialized = serializeIoRollbackToken(token);
        const parsed = parseIoRollbackToken(serialized);
        expect(parsed.changeSetId).toBe(token.changeSetId);
        expect(parsed.digest).toBe(token.digest);
        expect(parsed.steps[0]?.snapshotSidecar?.contentHash).toBe('a'.repeat(64));
    });

    it('continua verificando tokens v1 sem campo de sidecar', () => {
        const changeSetId = 'legacy-change-set';
        const steps = [
            {
                order: 1,
                entryId: 'legacy-entry',
                action: /** @type {'write'} */ ('write'),
                target: '/tmp/legacy.txt',
                previousHash: 'old',
                contentHash: 'new',
                bytes: 3,
                snapshotBase64: 'b2xk',
            },
        ];
        const legacyToken = {
            version: 1,
            tokenId: 'legacy-token',
            changeSetId,
            createdAtMs: 1,
            stepCount: 1,
            steps,
            digest: sha256(JSON.stringify({ changeSetId, steps })),
        };

        expect(verifyIoRollbackToken(/** @type {any} */ (legacyToken))).toBe(true);
        expect(parseIoRollbackToken(serializeIoRollbackToken(/** @type {any} */ (legacyToken))).version).toBe(1);
    });

    it('isola evidence/rollback de mutações externas após append', () => {
        const started = beginIoChangeSet({ capability: 'file.write' });
        const evidence = { nested: { source: 'write_file_content' } };
        const rollback = {
            action: /** @type {'write'} */ ('write'),
            target: '/tmp/a.txt',
            previousHash: 'old',
        };

        const withEntry = appendIoChangeSetEntry(started, {
            action: 'write',
            targets: ['/tmp/a.txt'],
            evidence,
            rollback,
        });

        evidence.nested.source = 'mutated';
        rollback.previousHash = 'changed';

        expect(withEntry.entries[0]?.evidence).toEqual({ nested: { source: 'write_file_content' } });
        expect(withEntry.entries[0]?.rollback?.previousHash).toBe('old');
    });
});
