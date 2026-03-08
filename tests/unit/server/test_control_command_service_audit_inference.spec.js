// @ts-check
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuditAgentRuntime } from '../../../src/audit_agent/runtime.js';
import { createAuditAgentServer } from '../../../src/audit_agent/server.js';
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

async function listen(/** @type {any} */ server) {
    await /** @type {Promise<void>} */ (
        new Promise((resolve, reject) => {
            server.listen(0, '127.0.0.1', (/** @type {any} */ err) => (err ? reject(err) : resolve()));
        })
    );
    const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
    return { host: addr.address, port: addr.port };
}

test('validateCommand accepts AUDIT_JOB_CREATE and INFERENCE_PROFILE_VALIDATE', () => {
    const a = validateCommand({
        command: COMMANDS.AUDIT_JOB_CREATE,
        payload: { reason: 'test', idempotency_key: `idem_${randomUUID()}`, job: { kind: 'quick_audit' } },
        actor: actor(),
    });
    assert.equal(a.ok, true);

    const b = validateCommand({
        command: COMMANDS.INFERENCE_PROFILE_VALIDATE,
        payload: { reason: 'test', idempotency_key: `idem_${randomUUID()}`, client_tag: 'diagnostics_probe' },
        actor: actor(),
    });
    assert.equal(b.ok, true);
});

test('executeCommand dryRun supports new AUDIT/INFERENCE commands without proxy calls', async () => {
    const auditOut = await executeCommand({
        command: COMMANDS.AUDIT_JOB_CREATE,
        payload: { reason: 'dry', idempotency_key: `idem_${randomUUID()}`, job: { kind: 'quick_audit' } },
        actor: actor(),
        dryRun: true,
    });
    assert.equal(auditOut.success, true);
    assert.equal(auditOut.dry_run, true);
    assert.equal(auditOut.command, COMMANDS.AUDIT_JOB_CREATE);

    const infOut = await executeCommand({
        command: COMMANDS.INFERENCE_PROFILE_VALIDATE,
        payload: { reason: 'dry', idempotency_key: `idem_${randomUUID()}`, client_tag: 'diagnostics_probe' },
        actor: actor(),
        dryRun: true,
    });
    assert.equal(infOut.success, true);
    assert.equal(infOut.dry_run, true);
    assert.equal(infOut.command, COMMANDS.INFERENCE_PROFILE_VALIDATE);
});

test('executeCommand proxies AUDIT_JOB_CREATE and AUDIT_JOB_RUN to local audit-agent', async () => {
    const rt = new AuditAgentRuntime();
    const server = createAuditAgentServer({ runtime: rt });
    const prevHost = process.env.AUDIT_AGENT_HOST;
    const prevPort = process.env.AUDIT_AGENT_PORT;
    const { host, port } = await listen(server);
    process.env.AUDIT_AGENT_HOST = host;
    process.env.AUDIT_AGENT_PORT = String(port);

    try {
        const createOut = await executeCommand({
            command: COMMANDS.AUDIT_JOB_CREATE,
            payload: {
                reason: 'create test job',
                idempotency_key: `idem_${randomUUID()}`,
                job: { kind: 'quick_audit', trigger_type: 'manual' },
            },
            actor: actor(),
            dryRun: false,
        });

        assert.equal(createOut.success, true);
        const jobId =
            createOut?.result?.after?.id ||
            createOut?.result?.metadata?.audit_job_id ||
            createOut?.operation?.result?.entity_id ||
            null;
        assert.ok(jobId, 'jobId deve ser retornado');

        const runOut = await executeCommand({
            command: COMMANDS.AUDIT_JOB_RUN,
            payload: {
                audit_job_id: String(jobId),
                reason: 'run test job',
                idempotency_key: `idem_${randomUUID()}`,
            },
            actor: actor(),
            dryRun: false,
        });

        assert.equal(runOut.success, true);
        assert.equal(runOut?.result?.after?.id, String(jobId));
    } finally {
        if (prevHost === undefined) delete process.env.AUDIT_AGENT_HOST;
        else process.env.AUDIT_AGENT_HOST = prevHost;
        if (prevPort === undefined) delete process.env.AUDIT_AGENT_PORT;
        else process.env.AUDIT_AGENT_PORT = prevPort;
        await /** @type {Promise<void>} */ (
            new Promise((resolve) => {
                server.close(() => resolve());
            })
        );
    }
});

test('executeCommand proxies patch_suggest job and returns WAITING_APPROVAL after run', async () => {
    const rt = new AuditAgentRuntime();
    const server = createAuditAgentServer({ runtime: rt });
    const prevHost = process.env.AUDIT_AGENT_HOST;
    const prevPort = process.env.AUDIT_AGENT_PORT;
    const { host, port } = await listen(server);
    process.env.AUDIT_AGENT_HOST = host;
    process.env.AUDIT_AGENT_PORT = String(port);

    try {
        const createOut = await executeCommand({
            command: COMMANDS.AUDIT_JOB_CREATE,
            payload: {
                reason: 'create patch job',
                idempotency_key: `idem_${randomUUID()}`,
                job: {
                    kind: 'patch_suggest',
                    trigger_type: 'manual',
                    scope: { filePath: 'src/audit_agent/runtime.js', query: 'patch proposal' },
                },
            },
            actor: actor(),
        });
        assert.equal(createOut.success, true);
        const jobId = createOut?.result?.after?.id;
        assert.ok(jobId);

        const runOut = await executeCommand({
            command: COMMANDS.AUDIT_JOB_RUN,
            payload: {
                audit_job_id: jobId,
                reason: 'run patch job',
                idempotency_key: `idem_${randomUUID()}`,
            },
            actor: actor(),
        });

        assert.equal(runOut.success, true);
        assert.equal(runOut?.result?.after?.status, 'WAITING_APPROVAL');
        assert.equal(runOut?.result?.metadata?.action, 'run');
    } finally {
        if (prevHost === undefined) delete process.env.AUDIT_AGENT_HOST;
        else process.env.AUDIT_AGENT_HOST = prevHost;
        if (prevPort === undefined) delete process.env.AUDIT_AGENT_PORT;
        else process.env.AUDIT_AGENT_PORT = prevPort;
        await /** @type {Promise<void>} */ (
            new Promise((resolve) => {
                server.close(() => resolve());
            })
        );
    }
});
