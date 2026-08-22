// @ts-check

import { describe, expect, it } from 'vitest';

import {
    abortIoChangeSet,
    appendIoChangeSetEntry,
    applyIoChangeSet,
    beginIoChangeSet,
    buildIoRollbackPlan,
    createIoRollbackCapabilityRuntime,
    failIoChangeSet,
    rollbackIoChangeSet,
    serializeIoRollbackToken,
} from '#copilot/infra/internal/operations';
import { sha256 } from '../../../../src/copilot/infra/platform/hash.js';

const TEST_POLICY = Object.freeze({
    enabled: true,
    directory: '/tmp/copilot-rollback-capability-test',
    ttlMs: 60_000,
    maxEntries: 32,
    maxBytes: 32 * 1024 * 1024,
});

function appliedChangeSet() {
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
                source: '/tmp/b.txt',
                destination: '/tmp/a.txt',
                previousHash: 'h3',
                contentHash: 'h4',
                snapshotSidecar: {
                    version: 1,
                    path: '/tmp/copilot-rollback-capability-test/sidecar.rollback',
                    contentHash: 'a'.repeat(64),
                    bytes: 512_000,
                    createdAtMs: 100,
                    expiresAtMs: 200,
                },
            },
        },
    );
    return applyIoChangeSet(withEntries);
}

describe('infra/operations transaction + authenticated rollback capability', () => {
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

    it('emite somente v4 autenticado, bound ao runtime/workspace e com expiração obrigatória', () => {
        const applied = appliedChangeSet();
        const plan = buildIoRollbackPlan(applied);
        expect(plan).toHaveLength(2);
        expect(plan[0]?.action).toBe('move');
        expect(plan[1]?.action).toBe('write');

        const runtime = createIoRollbackCapabilityRuntime({
            runtimeId: 'rollback-auth-runtime',
            ttlMs: TEST_POLICY.ttlMs,
            secret: Buffer.alloc(32, 7),
        });
        const capability = runtime.bindWorkspace({
            workspaceId: 'rollback-auth-workspace',
            workspaceRoot: '/tmp',
            policy: TEST_POLICY,
        });
        try {
            const issued = capability.issue(applied, { nowMs: 10_000 });
            expect(issued.token).toMatchObject({
                version: 4,
                audience: 'copilot.file.rollback',
                runtimeId: 'rollback-auth-runtime',
                workspaceId: 'rollback-auth-workspace',
                createdAtMs: 10_000,
                expiresAtMs: 70_000,
                stepCount: 2,
            });
            expect(issued.token.authTag).toMatch(/^[A-Za-z0-9_-]+$/u);
            expect(capability.verify(issued.token, { nowMs: 10_001 })).toBe(true);
            expect(capability.parse(issued.serialized, { nowMs: 10_001 }).tokenId).toBe(issued.token.tokenId);
        } finally {
            runtime.dispose();
        }
    });

    it('rejeita token fabricado mesmo quando o caller recalcula corretamente o checksum de conteúdo', () => {
        const runtime = createIoRollbackCapabilityRuntime({
            runtimeId: 'rollback-forgery-runtime',
            ttlMs: TEST_POLICY.ttlMs,
            secret: Buffer.alloc(32, 9),
        });
        const capability = runtime.bindWorkspace({
            workspaceId: 'rollback-forgery-workspace',
            workspaceRoot: '/tmp',
            policy: TEST_POLICY,
        });
        try {
            const issued = capability.issue(appliedChangeSet(), { nowMs: 20_000 });
            const forgedSteps = issued.token.steps.map((step, index) =>
                index === 0 ? { ...step, target: '/tmp/caller-forged.txt' } : { ...step },
            );
            const forged = {
                ...issued.token,
                steps: forgedSteps,
                digest: sha256(JSON.stringify({ changeSetId: issued.token.changeSetId, steps: forgedSteps })),
            };
            expect(capability.verify(/** @type {any} */ (forged), { nowMs: 20_001 })).toBe(false);
            expect(() =>
                capability.parse(serializeIoRollbackToken(/** @type {any} */ (forged)), { nowMs: 20_001 }),
            ).toThrow(/invalid|expired|runtime|workspace/iu);
        } finally {
            runtime.dispose();
        }
    });

    it('rejeita cross-workspace, cross-runtime, token expirado e formato legado', () => {
        const runtime = createIoRollbackCapabilityRuntime({
            runtimeId: 'rollback-isolation-runtime',
            ttlMs: TEST_POLICY.ttlMs,
            secret: Buffer.alloc(32, 11),
        });
        const owner = runtime.bindWorkspace({
            workspaceId: 'workspace-owner',
            workspaceRoot: '/tmp',
            policy: TEST_POLICY,
        });
        const sibling = runtime.bindWorkspace({
            workspaceId: 'workspace-sibling',
            workspaceRoot: '/tmp',
            policy: TEST_POLICY,
        });
        const peerRuntime = createIoRollbackCapabilityRuntime({
            runtimeId: 'rollback-peer-runtime',
            ttlMs: TEST_POLICY.ttlMs,
            secret: Buffer.alloc(32, 11),
        });
        const peer = peerRuntime.bindWorkspace({
            workspaceId: 'workspace-owner',
            workspaceRoot: '/tmp',
            policy: TEST_POLICY,
        });
        try {
            const issued = owner.issue(appliedChangeSet(), { nowMs: 30_000 });
            expect(sibling.verify(issued.token, { nowMs: 30_001 })).toBe(false);
            expect(peer.verify(issued.token, { nowMs: 30_001 })).toBe(false);
            expect(owner.verify(issued.token, { nowMs: 90_001 })).toBe(false);
            expect(() => owner.parse(issued.serialized, { nowMs: 90_001 })).toThrow(/invalid|expired/iu);

            const legacy = Buffer.from(
                JSON.stringify({
                    version: 3,
                    tokenId: 'legacy-token',
                    changeSetId: 'legacy-change-set',
                    createdAtMs: 1,
                    stepCount: 0,
                    steps: [],
                    digest: sha256(JSON.stringify({ changeSetId: 'legacy-change-set', steps: [] })),
                }),
            ).toString('base64url');
            expect(() => owner.parse(legacy, { nowMs: 30_001 })).toThrow(/inválid|invalid|versão|version/iu);
        } finally {
            peerRuntime.dispose();
            runtime.dispose();
        }
    });

    it('recusa emitir capability para steps fora do workspace bound', () => {
        const runtime = createIoRollbackCapabilityRuntime({
            runtimeId: 'rollback-path-bound-runtime',
            ttlMs: TEST_POLICY.ttlMs,
            secret: Buffer.alloc(32, 12),
        });
        const capability = runtime.bindWorkspace({
            workspaceId: 'rollback-path-bound-workspace',
            workspaceRoot: '/tmp/workspace-bound',
            policy: TEST_POLICY,
        });
        let changeSet = beginIoChangeSet({ capability: 'file.rollback.outside' });
        changeSet = appendIoChangeSetEntry(changeSet, {
            action: 'delete',
            targets: ['/etc/passwd'],
            rollback: {
                action: 'delete',
                target: '/etc/passwd',
                contentHash: 'a'.repeat(64),
            },
        });
        try {
            expect(() => capability.issue(applyIoChangeSet(changeSet), { nowMs: 35_000 })).toThrow(
                expect.objectContaining({ code: 'EROLLBACKPATHCLAIM' }),
            );
        } finally {
            runtime.dispose();
        }
    });

    it('zera a autoridade de verificação quando o runtime é disposed', () => {
        const runtime = createIoRollbackCapabilityRuntime({
            runtimeId: 'rollback-dispose-runtime',
            ttlMs: TEST_POLICY.ttlMs,
            secret: Buffer.alloc(32, 13),
        });
        const capability = runtime.bindWorkspace({
            workspaceId: 'rollback-dispose-workspace',
            workspaceRoot: '/tmp',
            policy: TEST_POLICY,
        });
        const issued = capability.issue(appliedChangeSet(), { nowMs: 40_000 });
        runtime.dispose();
        expect(capability.verify(issued.token, { nowMs: 40_001 })).toBe(false);
        expect(() => capability.parse(issued.serialized, { nowMs: 40_001 })).toThrow(/disposed/iu);
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
