// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildQualityGateResultEnvelope,
    extractQualityGateFailingFiles,
    summarizeQualityGateText,
} from '../../../../src/copilot/tools/code/quality-gate-output.js';

describe('quality-gate-output', () => {
    it('preserva saída curta e expõe metadados de bytes/chars', () => {
        const summary = summarizeQualityGateText('ok\n', 100);

        expect(summary).toMatchObject({
            text: 'ok\n',
            truncated: false,
            originalChars: 3,
            returnedChars: 3,
        });
        expect(summary.originalBytes).toBe(3);
        expect(summary.returnedBytes).toBe(3);
    });

    it('trunca saída longa com marcador explícito e mantém bytes originais', () => {
        const original = 'x'.repeat(200);
        const summary = summarizeQualityGateText(original, 80);

        expect(summary.truncated).toBe(true);
        expect(summary.text).toContain('[truncated by quality_gate]');
        expect(summary.originalChars).toBe(200);
        expect(summary.originalBytes).toBe(200);
        expect(summary.returnedChars).toBeLessThan(summary.originalChars);
    });

    it('extrai arquivos falhos de stdout/stderr removendo duplicatas e normalizando barras', () => {
        const files = extractQualityGateFailingFiles(
            'src/copilot/tools/code/code-tools.js:10:1 error\n',
            'tests\\unit\\copilot\\tools\\test_quality_gate_output.spec.js:5:1 failed\n' +
                'src/copilot/tools/code/code-tools.js:10:1 again\n',
        );

        expect(files).toEqual([
            'src/copilot/tools/code/code-tools.js',
            'tests/unit/copilot/tools/test_quality_gate_output.spec.js',
        ]);
    });

    it('constrói envelope de sucesso com schema estável', () => {
        const result = buildQualityGateResultEnvelope({
            gate: 'typecheck',
            scope: 'src/copilot',
            script: 'typecheck:strict:src.copilot',
            command: 'npm run typecheck:strict:src.copilot',
            description: 'TypeScript strict',
            stdout: 'ok\n',
            exitCode: 0,
            durationMs: 123,
        });

        expect(result).toMatchObject({
            success: true,
            ok: true,
            gate: 'typecheck',
            scope: 'src/copilot',
            script: 'typecheck:strict:src.copilot',
            command: 'npm run typecheck:strict:src.copilot',
            durationMs: 123,
            exitCode: 0,
            output: 'ok\n',
            error: '',
            outputTruncated: false,
            errorTruncated: false,
            checks: [{ name: 'typecheck', ok: true, exitCode: 0 }],
            failingFiles: [],
            artifacts: [],
            terminalSummary: 'quality_gate typecheck passou.',
        });
    });

    it('constrói envelope de falha com arquivos e artefatos', () => {
        const result = buildQualityGateResultEnvelope({
            gate: 'unit',
            scope: 'src/copilot',
            script: 'test:copilot:unit',
            command: 'npm run test:copilot:unit',
            description: 'Unit tests',
            artifacts: ['artifacts/test-runs/copilot'],
            stdout: 'tests/unit/copilot/tools/test_quality_gate_output.spec.js:42:1 failed\n',
            error: 'src/copilot/tools/code/code-tools.js:1:1 error\n',
            exitCode: 1,
            durationMs: 456,
        });

        expect(result).toMatchObject({
            success: false,
            ok: false,
            gate: 'unit',
            exitCode: 1,
            checks: [{ name: 'unit', ok: false, exitCode: 1 }],
            artifacts: ['artifacts/test-runs/copilot'],
            terminalSummary: 'quality_gate unit falhou com exitCode=1.',
        });
        expect(result.failingFiles).toEqual([
            'tests/unit/copilot/tools/test_quality_gate_output.spec.js',
            'src/copilot/tools/code/code-tools.js',
        ]);
    });

    it('representa duração excedida como falha explícita', () => {
        const result = buildQualityGateResultEnvelope({
            gate: 'mcp-full',
            scope: 'mcp',
            script: 'mcp:stateful:validate:full',
            command: 'npm run mcp:stateful:validate:full',
            description: 'MCP full validation',
            stdout: '',
            error: 'process timed out',
            exitCode: 0,
            durationMs: 900_000,
            timedOut: true,
        });

        expect(result).toMatchObject({
            success: false,
            ok: false,
            gate: 'mcp-full',
            exitCode: 0,
            timedOut: true,
            terminalSummary: 'quality_gate mcp-full excedeu timeout com exitCode=0.',
        });
    });
});
