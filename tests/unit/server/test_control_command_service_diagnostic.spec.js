// @ts-check
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RBAC_PERMISSIONS } from '../../../src/infra/db/rbac_repo.js';
import { COMMANDS, executeCommand, validateCommand } from '../../../src/server/domain/control_command_service.js';

function actor() {
    return {
        id: 'usr-test',
        username: 'tester',
        role: 'admin',
        permissions: [RBAC_PERMISSIONS.CONTROL_EXECUTE, RBAC_PERMISSIONS.CONTROL_VALIDATE],
    };
}

test('validateCommand accepts DIAGNOSTIC_JOB_CREATE', () => {
    const result = validateCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_CREATE,
        payload: { reason: 'test', idempotency_key: `idem_${randomUUID()}`, job: { kind: 'infrastructure_check' } },
        actor: actor(),
    });
    assert.equal(result.ok, true);
});

test('validateCommand accepts DIAGNOSTIC_JOB_RUN', () => {
    const result = validateCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_RUN,
        payload: { reason: 'test', idempotency_key: `idem_${randomUUID()}`, diagnostic_job_id: 'test-123' },
        actor: actor(),
    });
    assert.equal(result.ok, true);
});

test('validateCommand accepts DIAGNOSTIC_JOB_CANCEL', () => {
    const result = validateCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_CANCEL,
        payload: { reason: 'test', idempotency_key: `idem_${randomUUID()}`, diagnostic_job_id: 'test-123' },
        actor: actor(),
    });
    assert.equal(result.ok, true);
});

test('validateCommand accepts DIAGNOSTIC_JOB_RETRY', () => {
    const result = validateCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_RETRY,
        payload: { reason: 'test', idempotency_key: `idem_${randomUUID()}`, diagnostic_job_id: 'test-123' },
        actor: actor(),
    });
    assert.equal(result.ok, true);
});

test('executeCommand dryRun supports DIAGNOSTIC_JOB_CREATE without proxy calls', async () => {
    const result = await executeCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_CREATE,
        payload: { reason: 'dry', idempotency_key: `idem_${randomUUID()}`, job: { kind: 'infrastructure_check' } },
        actor: actor(),
        dryRun: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.command, COMMANDS.DIAGNOSTIC_JOB_CREATE);
});

test('executeCommand dryRun supports DIAGNOSTIC_JOB_RUN without proxy calls', async () => {
    const result = await executeCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_RUN,
        payload: { reason: 'dry', idempotency_key: `idem_${randomUUID()}`, diagnostic_job_id: 'test-123' },
        actor: actor(),
        dryRun: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.command, COMMANDS.DIAGNOSTIC_JOB_RUN);
});

test('executeCommand dryRun supports DIAGNOSTIC_JOB_CANCEL without proxy calls', async () => {
    const result = await executeCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_CANCEL,
        payload: { reason: 'dry', idempotency_key: `idem_${randomUUID()}`, diagnostic_job_id: 'test-123' },
        actor: actor(),
        dryRun: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.command, COMMANDS.DIAGNOSTIC_JOB_CANCEL);
});

test('executeCommand dryRun supports DIAGNOSTIC_JOB_RETRY without proxy calls', async () => {
    const result = await executeCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_RETRY,
        payload: { reason: 'dry', idempotency_key: `idem_${randomUUID()}`, diagnostic_job_id: 'test-123' },
        actor: actor(),
        dryRun: true,
    });
    assert.equal(result.success, true);
    assert.equal(result.dry_run, true);
    assert.equal(result.command, COMMANDS.DIAGNOSTIC_JOB_RETRY);
});

test('executeCommand routing: DIAGNOSTIC_JOB_CREATE agora roteia para Audit Agent (Audit Agent não disponível)', async () => {
    const prevHost = process.env.AUDIT_AGENT_HOST;
    const prevPort = process.env.AUDIT_AGENT_PORT;

    // Define servidor inexistente (Audit Agent não rodando)
    process.env.AUDIT_AGENT_HOST = '127.0.0.1';
    process.env.AUDIT_AGENT_PORT = '19998';

    try {
        // Deve falhar porque o Audit Agent não está disponível
        // O comando DIAGNOSTIC_* agora é roteado para o Audit Agent
        await assert.rejects(
            async () => {
                await executeCommand({
                    command: COMMANDS.DIAGNOSTIC_JOB_CREATE,
                    payload: {
                        reason: 'create test job',
                        idempotency_key: `idem_${randomUUID()}`,
                        job: { kind: 'infrastructure_check', trigger_type: 'manual' },
                    },
                    actor: actor(),
                    dryRun: false,
                });
            },
            { code: 'DIAGNOSTIC_TO_AUDIT_AGENT_ROUTING_FAILED' },
        );
    } finally {
        if (prevHost === undefined) delete process.env.AUDIT_AGENT_HOST;
        else process.env.AUDIT_AGENT_HOST = prevHost;
        if (prevPort === undefined) delete process.env.AUDIT_AGENT_PORT;
        else process.env.AUDIT_AGENT_PORT = prevPort;
    }
});

test('validateCommand rejects DIAGNOSTIC_JOB_RUN without job_id', () => {
    const result = validateCommand({
        command: COMMANDS.DIAGNOSTIC_JOB_RUN,
        payload: { reason: 'test', idempotency_key: `idem_${randomUUID()}` },
        actor: actor(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONTROL_ENTITY_ID_REQUIRED');
});
