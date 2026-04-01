// @ts-check
/**
 * tests/unit/copilot/test_tool_audit_logger.spec.js
 *
 * G2-TEST-10: Testes para tool-audit-logger.js
 *
 * - isHighRiskTool() — classificação de risco
 * - HIGH_RISK_TOOLS configurável via env (G2-SEC-04)
 * - logToolAudit() — fire-and-forget sem lançar exceção
 * - buildAuditingPermissionHandler() — wrapping base handler
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/** @type {typeof import('../../../src/copilot/agent/tool-audit-logger.js')} */
let mod;

before(async () => {
    mod = await import('../../../src/copilot/agent/tool-audit-logger.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: isHighRiskTool (G2-TEST-10a)
// ─────────────────────────────────────────────────────────────────────────────

describe('isHighRiskTool()', () => {
    it('deve retornar true para "bash"', () => {
        assert.equal(mod.isHighRiskTool('bash'), true);
    });

    it('deve retornar true para "edit"', () => {
        assert.equal(mod.isHighRiskTool('edit'), true);
    });

    it('deve retornar true para "run_shell_command"', () => {
        assert.equal(mod.isHighRiskTool('run_shell_command'), true);
    });

    it('deve retornar false para "get_file_contents"', () => {
        assert.equal(mod.isHighRiskTool('get_file_contents'), false);
    });

    it('deve retornar false para string vazia', () => {
        assert.equal(mod.isHighRiskTool(''), false);
    });

    it('deve retornar false para tool desconhecida', () => {
        assert.equal(mod.isHighRiskTool('minha_tool_personalizada'), false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: análise estrutural — env vars (G2-SEC-04, G2-DX-11, G2-SEC-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('tool-audit-logger › análise estrutural', async () => {
    /** @type {string} */
    let src = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        src = await readFile(resolve(dir, '../../../src/copilot/agent/tool-audit-logger.js'), 'utf8');
    });

    it('HIGH_RISK_TOOLS deve ser configurável via COPILOT_HIGH_RISK_TOOLS (G2-SEC-04)', () => {
        assert.ok(src.includes('COPILOT_HIGH_RISK_TOOLS'), 'deve usar process.env.COPILOT_HIGH_RISK_TOOLS');
    });

    it('MAX_LOG_BYTES deve ser configurável via AGENT_TOOL_AUDIT_MAX_LOG_BYTES (G2-DX-11)', () => {
        assert.ok(src.includes('AGENT_TOOL_AUDIT_MAX_LOG_BYTES'), 'deve usar AGENT_TOOL_AUDIT_MAX_LOG_BYTES env');
    });

    it('TOOL_AUDIT_LOG deve ser configurável via COPILOT_AUDIT_LOG_PATH (G2-SEC-05)', () => {
        assert.ok(src.includes('COPILOT_AUDIT_LOG_PATH'), 'deve usar COPILOT_AUDIT_LOG_PATH env');
    });

    it('logToolAudit() deve ser fire-and-forget (não retorna Promise)', () => {
        // Verificar que a função tem retorno void (void async IIFE)
        assert.ok(
            src.includes('void (async') || src.includes('void(async'),
            'logToolAudit deve usar void para fire-and-forget',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: logToolAudit — não lança exceção (G2-TEST-10c)
// ─────────────────────────────────────────────────────────────────────────────

describe('logToolAudit() › não deve lançar exceção', () => {
    it('deve ser chamável sem lançar erro síncrono', () => {
        assert.doesNotThrow(() => {
            mod.logToolAudit({ tool: 'bash', decision: 'approved', highRisk: true });
        });
    });

    it('deve ser chamável com decision: denied sem erro', () => {
        assert.doesNotThrow(() => {
            mod.logToolAudit({ tool: 'get_file_contents', decision: 'denied', highRisk: false });
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: buildAuditingPermissionHandler (G2-TEST-10d)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildAuditingPermissionHandler()', () => {
    it('deve retornar uma função (handler)', () => {
        const handler = mod.buildAuditingPermissionHandler(undefined);
        assert.equal(typeof handler, 'function');
    });

    it('deve chamar o baseHandler fornecido', async () => {
        let called = false;
        /** @type {import('@github/copilot-sdk').PermissionHandler} */
        const base = async (req, inv) => {
            called = true;
            return { behavior: 'allow' };
        };
        const handler = mod.buildAuditingPermissionHandler(base);
        await handler(/** @type {any} */ ({ toolName: 'list_files' }), /** @type {any} */ ({}));
        assert.equal(called, true, 'baseHandler deve ser invocado');
    });

    it('deve fazer fallback para approveAll se baseHandler lança exceção', async () => {
        /** @type {import('@github/copilot-sdk').PermissionHandler} */
        const failingBase = async () => {
            throw new Error('teste: falha intencional');
        };
        const handler = mod.buildAuditingPermissionHandler(failingBase);
        // Não deve lançar — deve fazer fallback silencioso
        let result;
        await assert.doesNotReject(async () => {
            result = await handler(/** @type {any} */ ({ toolName: 'bash' }), /** @type {any} */ ({}));
        });
        assert.ok(result !== undefined, 'handler deve retornar resultado mesmo com exceção no baseHandler');
    });
});
