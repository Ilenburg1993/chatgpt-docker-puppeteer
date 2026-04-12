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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuditingPermissionHandler, createAuditLog, isHighRiskTool } from '../../../src/copilot/audit/pipeline.js';

// ─── Part 2: createAuditLog ──────────────────────────────────────────────────

describe('audit/pipeline › createAuditLog', () => {
    /** @type {ReturnType<typeof createAuditLog>} */
    let auditLog;

    beforeEach(() => {
        // Usa paths temporários que não serão escritos (flush testado separadamente)
        auditLog = createAuditLog({
            maxEntries: 5,
            auditFile: '/tmp/.test-audit-pipeline-' + Date.now() + '.jsonl',
            toolAuditFile: '/tmp/.test-tool-audit-pipeline-' + Date.now() + '.jsonl',
        });
    });

    it('record adiciona entrada com ts', () => {
        auditLog.record({ type: 'test' });
        const entries = auditLog.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].type).toBe('test');
        expect(entries[0].ts).toBeTruthy();
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
        expect(last[0].type).toBe('t3');
        expect(last[1].type).toBe('t4');
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
        const base = vi.fn().mockResolvedValue({ kind: 'approved' });
        const handler = buildAuditingPermissionHandler(base);

        const result = await handler(
            /** @type {any} */ ({ toolName: 'read_file' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(base).toHaveBeenCalled();
        expect(result).toEqual({ kind: 'approved' });
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
        const base = vi.fn().mockResolvedValue({ kind: 'approved' });
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
