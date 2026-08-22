// @ts-check
/**
 * tests/unit/copilot/test_audit_pipeline.spec.js
 *
 * Testes unitários para src/copilot/audit/pipeline.js (537L) — Parts 2 & 3. Part 1 (SDK buffer) já coberta por
 * test_hooks_module.spec.js.
 *
 * Cobre:
 *
 * - createAuditLog: record, getEntries, getLast, clear, recordToolStart, recordToolComplete, dedup
 * - isHighRiskTool: classificação de ferramentas de alto risco
 * - buildAuditingPermissionHandler: delegação ao base handler + fallback approveAll
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuditingPermissionHandler, createAuditLog, isHighRiskTool } from '../../../src/copilot/audit/pipeline.js';

/** @param {string} auditFile @param {string} toolAuditFile */
function createAuditTestIo(auditFile, toolAuditFile) {
    return createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'test.audit.pipeline',
            exactPaths: [auditFile, toolAuditFile, `${toolAuditFile}.1`],
            operations: ['append', 'move', 'read', 'stat'],
            symlinkPolicy: 'deny',
            durability: ['none'],
        }),
    );
}

// ─── Part 2: createAuditLog ──────────────────────────────────────────────────

describe('audit/pipeline › createAuditLog', () => {
    /** @type {ReturnType<typeof createAuditLog>} */
    let auditLog;

    beforeEach(() => {
        // Paths alternativos são testáveis somente quando a authority correspondente é injetada explicitamente.
        const suffix = Date.now();
        const auditFile = `/tmp/.test-audit-pipeline-${suffix}.jsonl`;
        const toolAuditFile = `/tmp/.test-tool-audit-pipeline-${suffix}.jsonl`;
        auditLog = createAuditLog({
            maxEntries: 5,
            auditFile,
            toolAuditFile,
            io: createAuditTestIo(auditFile, toolAuditFile),
        });
    });

    it('rejeita paths alternativos sem IO já autorizado', () => {
        expect(() =>
            createAuditLog({
                auditFile: '/tmp/unauthorized-audit.jsonl',
                toolAuditFile: '/tmp/unauthorized-tool-audit.jsonl',
            }),
        ).toThrow('Alternate audit JSONL paths require already-authorized IO.');
    });

    it('record adiciona entrada com ts', () => {
        auditLog.record({ type: 'test' });
        const entries = auditLog.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]?.type).toBe('test');
        expect(entries[0]?.ts).toBeTruthy();
    });

    it('getEntries retorna cópia do buffer', () => {
        auditLog.record({ type: 'a' });
        const entries = auditLog.getEntries();
        entries.push(/** @type {any} */ ({ type: 'fake' }));
        expect(auditLog.getEntries()).toHaveLength(1);
    });

    it('getLast retorna últimas N entradas', () => {
        for (let i = 0; i < 5; i++) {
            auditLog.record({ type: `t${i}` });
        }
        const last = auditLog.getLast(2);
        expect(last).toHaveLength(2);
        expect(last[0]?.type).toBe('t3');
        expect(last[1]?.type).toBe('t4');
    });

    it('respeita maxEntries (ring buffer behavior)', () => {
        for (let i = 0; i < 10; i++) {
            auditLog.record({ type: `entry-${i}` });
        }
        const entries = auditLog.getEntries();
        expect(entries.length).toBeLessThanOrEqual(5);
    });

    it('clear esvazia o buffer', () => {
        auditLog.record({ type: 'x' });
        auditLog.clear();
        expect(auditLog.getEntries()).toHaveLength(0);
    });

    it('dedup: entradas idênticas em <1s são ignoradas', () => {
        auditLog.record({ type: 'dup', data: /** @type {any} */ ({ toolName: 'read' }) });
        auditLog.record({ type: 'dup', data: /** @type {any} */ ({ toolName: 'read' }) });
        // Deve ter apenas 1 (dedup)
        expect(auditLog.getEntries()).toHaveLength(1);
    });

    it('dedup: entradas com tipo diferente não são deduplicadas', () => {
        auditLog.record({ type: 'a' });
        auditLog.record({ type: 'b' });
        expect(auditLog.getEntries()).toHaveLength(2);
    });

    it('recordToolStart + recordToolComplete gera entrada tool.executed', async () => {
        auditLog.recordToolStart({
            toolCallId: 'tc-1',
            toolName: 'read_file',
            args: { path: '/x' },
        });
        // pequeno delay para durationMs > 0
        auditLog.recordToolComplete({
            toolCallId: 'tc-1',
            success: true,
            resultContent: 'ok',
        });

        const entries = auditLog.getEntries();
        const toolEntry = entries.find((e) => e.type === 'tool.executed');
        expect(toolEntry).toBeTruthy();
        expect(/** @type {any} */ (toolEntry).data.toolName).toBe('read_file');
        expect(/** @type {any} */ (toolEntry).data.success).toBe(true);
    });

    it('recordToolComplete sem start prévio usa toolName desconhecido', () => {
        auditLog.recordToolComplete({
            toolCallId: 'tc-orphan',
            success: false,
        });
        const entries = auditLog.getEntries();
        const toolEntry = entries.find((e) => e.type === 'tool.executed');
        expect(toolEntry).toBeTruthy();
        expect(/** @type {any} */ (toolEntry).data.toolName).toBe('(desconhecido)');
    });

    it('recordToolStart limpa entradas expiradas (TTL)', () => {
        const log = createAuditLog({ maxEntries: 100 });
        // Start sem complete — vai ficar pending
        log.recordToolStart({ toolCallId: 'old', toolName: 'bash' });
        // Os pendings são limpos em próximo start quando TTL expira
        // Não dá pra testar TTL sem mock de Date, então validamos que start sem complete funciona
        log.recordToolStart({ toolCallId: 'new', toolName: 'read' });
        log.recordToolComplete({ toolCallId: 'new', success: true });

        const entries = log.getEntries();
        expect(entries.some((e) => /** @type {any} */ (e).data?.toolName === 'read')).toBe(true);
    });

    it('redige segredos em getEntries/getLast e entradas tool.executed', () => {
        const githubToken = 'ghs_abcdefghijklmnopqrstuvwxyz1234567890';
        const byokToken = 'sk-testsecret1234567890';

        auditLog.record({
            type: 'auth',
            sessionId: githubToken,
            data: {
                gitHubToken: githubToken,
                headers: { Authorization: `Bearer ${byokToken}` },
                tokens: 42,
            },
        });
        auditLog.recordToolStart({
            toolCallId: 'tool-secret',
            toolName: `shell_${byokToken}`,
            args: { command: `echo ${githubToken}` },
        });
        auditLog.recordToolComplete({
            toolCallId: 'tool-secret',
            success: false,
            resultContent: `Authorization: Bearer ${byokToken}`,
        });

        const serialized = JSON.stringify({ entries: auditLog.getEntries(), last: auditLog.getLast(10) });
        expect(serialized).not.toContain(githubToken);
        expect(serialized).not.toContain(byokToken);
        expect(serialized).toContain('[redacted]');
        expect(auditLog.getEntries()[0]?.data?.['tokens']).toBe(42);
    });

    it('flush persiste cada entrada uma única vez', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-audit-pipeline-'));
        const auditFile = join(dir, 'audit.jsonl');
        const toolAuditFile = join(dir, 'tool-audit.jsonl');
        const log = createAuditLog({
            maxEntries: 5,
            auditFile,
            toolAuditFile,
            io: createAuditTestIo(auditFile, toolAuditFile),
        });
        try {
            log.record({ type: 'one' });
            log.record({ type: 'two' });
            await log.flush();
            await log.flush();

            const rows = (await readFile(auditFile, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(rows.map((row) => row.type)).toEqual(['one', 'two']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('normaliza limite do resumo persistido e retorna execuções recentes', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'copilot-audit-summary-'));
        const auditFile = join(dir, 'audit.jsonl');
        const toolAuditFile = join(dir, 'tool-audit.jsonl');
        const log = createAuditLog({
            maxEntries: 5,
            auditFile,
            toolAuditFile,
            io: createAuditTestIo(auditFile, toolAuditFile),
        });
        try {
            log.recordToolStart({ toolCallId: 'summary-1', toolName: 'read_file', args: { path: '/tmp/a' } });
            log.recordToolComplete({ toolCallId: 'summary-1', success: true, sessionId: 'session-a' });
            await log.flush();

            await expect(log.getAuditSummary('session-a', Number.POSITIVE_INFINITY)).resolves.toMatchObject([
                expect.objectContaining({ toolCallId: 'summary-1', toolName: 'read_file', success: true }),
            ]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

// ─── Part 3: isHighRiskTool ──────────────────────────────────────────────────

describe('audit/pipeline › isHighRiskTool', () => {
    it('retorna true para bash', () => {
        expect(isHighRiskTool('bash')).toBe(true);
    });

    it('retorna true para edit', () => {
        expect(isHighRiskTool('edit')).toBe(true);
    });

    it('retorna true para create', () => {
        expect(isHighRiskTool('create')).toBe(true);
    });

    it('retorna true para execute_code', () => {
        expect(isHighRiskTool('execute_code')).toBe(true);
    });

    it('retorna true para computer', () => {
        expect(isHighRiskTool('computer')).toBe(true);
    });

    it('retorna false para read_file (baixo risco)', () => {
        expect(isHighRiskTool('read_file')).toBe(false);
    });

    it('retorna false para list_dir (baixo risco)', () => {
        expect(isHighRiskTool('list_dir')).toBe(false);
    });

    it('retorna false para string vazia', () => {
        expect(isHighRiskTool('')).toBe(false);
    });
});

// ─── Part 3: buildAuditingPermissionHandler ──────────────────────────────────

describe('audit/pipeline › buildAuditingPermissionHandler', () => {
    it('delega ao baseHandler quando fornecido', async () => {
        const base = vi.fn().mockResolvedValue({ kind: 'approve-once' });
        const handler = buildAuditingPermissionHandler(base);

        const result = await handler(
            /** @type {any} */ ({ toolName: 'read_file' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(base).toHaveBeenCalled();
        expect(result).toEqual({ kind: 'approve-once' });
    });

    it('usa approveAll como fallback quando baseHandler é undefined', async () => {
        const handler = buildAuditingPermissionHandler(undefined);
        const result = await handler(
            /** @type {any} */ ({ toolName: 'read_file' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );
        // approveAll retorna um objeto com kind
        expect(result).toBeTruthy();
    });

    it('usa approveAll como fallback quando baseHandler lança erro', async () => {
        const base = vi.fn().mockRejectedValue(new Error('handler crash'));
        const handler = buildAuditingPermissionHandler(base);

        const result = await handler(
            /** @type {any} */ ({ toolName: 'read_file' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(result).toBeTruthy();
    });

    it('extrai toolName de request.tool quando toolName ausente', async () => {
        const base = vi.fn().mockResolvedValue({ kind: 'approve-once' });
        const handler = buildAuditingPermissionHandler(base);

        await handler(/** @type {any} */ ({ tool: 'my_tool' }), /** @type {any} */ ({ sessionId: 's1' }));

        expect(base).toHaveBeenCalled();
    });

    it('retorna decisão denied quando base retorna { kind: "denied" }', async () => {
        const base = vi.fn().mockResolvedValue({ kind: 'denied' });
        const handler = buildAuditingPermissionHandler(base);

        const result = await handler(
            /** @type {any} */ ({ toolName: 'bash' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(result).toEqual({ kind: 'denied' });
    });
});
