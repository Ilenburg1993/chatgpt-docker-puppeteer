import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRuntimeFindings } from '../../../scripts/audit/collectors/runtime.mjs';

/**
 * @param {string} stepId
 */
async function mockExec(stepId) {
    if (stepId === 'runtime.mcp_diagnose') {
        return {
            ok: true,
            exitCode: 0,
            stdout: JSON.stringify({
                ok: true,
                lsp_tools_present: true,
                lsp_functional_ok: true,
            }),
            stderr: '',
            durationMs: 10,
            timedOut: false,
            command: 'mock',
        };
    }
    if (stepId === 'runtime.rag_health') {
        return {
            ok: true,
            exitCode: 0,
            stdout: JSON.stringify({ ok: true, available: true }),
            stderr: "(node:1) Warning: The 'NO_COLOR' env is ignored",
            durationMs: 10,
            timedOut: false,
            command: 'mock',
        };
    }
    if (stepId === 'runtime.lsp_health') {
        return {
            ok: true,
            exitCode: 0,
            stdout: JSON.stringify({
                ok: true,
                lsp_tools_present: true,
                lsp_functional_ok: false,
                issues: ['lsp_definition failed'],
            }),
            stderr: '',
            durationMs: 10,
            timedOut: false,
            command: 'mock',
        };
    }
    return {
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 10,
        timedOut: false,
        command: 'mock',
    };
}

test('runtime collector ignores noisy warning when rag health JSON is healthy', async () => {
    const contracts = [
        {
            id: 'CONTRACT-RUNTIME-RAG-HEALTH',
            domain: 'runtime',
            description: 'rag',
            owner: 'infra-rag',
            status: 'active',
            kind: 'operational',
            severity_default: 'P1',
            type_default: 'gap',
            matcher: { signals: ['runtime.rag_health.failed'] },
            test_recipe: ['npm run rag:health -- --json'],
            enforcement: { level: 'warn' },
            title: 'rag',
            version: 1,
        },
        {
            id: 'CONTRACT-RUNTIME-LSP-FUNCTIONAL',
            domain: 'runtime',
            description: 'lsp',
            owner: 'infra-lsp',
            status: 'active',
            kind: 'operational',
            severity_default: 'P1',
            type_default: 'falha de contrato',
            matcher: { signals: ['runtime.lsp_functional.failed'] },
            test_recipe: ['npm run lsp:health -- --json'],
            enforcement: { level: 'p1' },
            title: 'lsp',
            version: 1,
        },
    ];

    const result = await collectRuntimeFindings({
        profile: 'quick',
        contracts,
        exec: mockExec,
    });

    assert.equal(result.telemetry.rag.ok, true);
    assert.equal(result.findings.some(item => item.rule === 'runtime.rag_health.failed'), false);
    assert.equal(result.findings.some(item => item.rule === 'runtime.lsp_functional.failed'), true);
});
