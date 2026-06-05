// @ts-check

import { describe, expect, it } from 'vitest';

import { auditAssistantToolClaims } from '../../../../src/copilot/terminal/dialog/assistant-tool-claim-audit.js';

/**
 * @param {{ operation: string; toolName?: string; status?: string; success?: boolean | null }[]} tools
 * @returns {ReturnType<import('../../../../src/copilot/terminal/state/turn-trace-state.js').readTerminalTurnTraceProjection>}
 */
function projectionWithTools(tools) {
    return {
        current: {
            traceId: 'turn:1',
            turnId: '1',
            source: 'assistant',
            status: 'active',
            startedAt: 1,
            updatedAt: 2,
            finishedAt: null,
            toolCount: tools.length,
            fileCount: 0,
            userInputCount: 0,
            tools: tools.map((tool) => ({
                toolName: tool.toolName ?? tool.operation,
                operation: /** @type {any} */ (tool.operation),
                path: null,
                target: null,
                source: 'sdk',
                status: /** @type {any} */ (tool.status ?? 'completed'),
                success: tool.success ?? true,
                count: 1,
                updatedAt: 2,
            })),
            files: [],
            userInputs: [],
        },
        recent: [],
    };
}

describe('terminal/dialog/assistant-tool-claim-audit', () => {
    it('não acusa claim de delete_file quando há lifecycle delete concluído', () => {
        const findings = auditAssistantToolClaims({
            reply: 'DELTA-CANONICAL-8: delete_file TERMINAL-PATCH-ROUNDTRIP.txt executed last',
            projection: projectionWithTools([{ operation: 'delete', toolName: 'delete_file' }]),
        });

        expect(findings).toEqual([]);
    });

    it('acusa claim público de delete_file quando o ledger recente não tem delete concluído', () => {
        const findings = auditAssistantToolClaims({
            reply: [
                'DELTA-CANONICAL-6: patch_file applied 1 replacement with status:applied',
                'DELTA-CANONICAL-8: delete_file TERMINAL-PATCH-ROUNDTRIP.txt executed last',
            ].join('\n'),
            projection: projectionWithTools([
                { operation: 'read', toolName: 'read_file_content' },
                { operation: 'write', toolName: 'create_file' },
                { operation: 'edit', toolName: 'patch_file' },
            ]),
        });

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            toolName: 'delete_file',
            operation: 'delete',
            label: 'Exclusão de arquivo',
            lineNumber: 2,
        });
    });

    it('ignora menção negativa ou diagnóstica sem linguagem de sucesso', () => {
        const findings = auditAssistantToolClaims({
            reply: 'DELTA-CANONICAL-5: patch_file expectedHash mismatch before apply',
            projection: projectionWithTools([{ operation: 'read', toolName: 'read_file_content' }]),
        });

        expect(findings).toEqual([]);
    });
});
