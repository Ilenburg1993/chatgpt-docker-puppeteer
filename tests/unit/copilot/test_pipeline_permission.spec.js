// @ts-check

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
    appendFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ size: 0 })),
}));

describe('audit/pipeline-permission buildAuditingPermissionHandler', () => {
    it('classifica approve-once como approved (semântica SDK)', async () => {
        /** @type {Record<string, unknown>[]} */
        const events = [];
        const { buildAuditingPermissionHandler, setAuditBus } =
            await import('../../../src/copilot/audit/pipeline-permission.js');
        setAuditBus({
            emitHook: (_name, _sessionId, _input, output) =>
                events.push(
                    output && typeof output === 'object' ? /** @type {Record<string, unknown>} */ (output) : {},
                ),
        });

        const handler = buildAuditingPermissionHandler(async () => ({ kind: 'approve-once' }));
        await handler(/** @type {any} */ ({ toolName: 'read_file' }), /** @type {any} */ ({ sessionId: 'sess-1' }));

        expect(events.at(-1)).toMatchObject({ decision: 'approved' });
    });

    it('classifica reject como denied', async () => {
        /** @type {Record<string, unknown>[]} */
        const events = [];
        const { buildAuditingPermissionHandler, setAuditBus } =
            await import('../../../src/copilot/audit/pipeline-permission.js');
        setAuditBus({
            emitHook: (_name, _sessionId, _input, output) =>
                events.push(
                    output && typeof output === 'object' ? /** @type {Record<string, unknown>} */ (output) : {},
                ),
        });

        const handler = buildAuditingPermissionHandler(async () => ({ kind: 'reject' }));
        await handler(
            /** @type {any} */ ({ toolName: 'run_shell_command' }),
            /** @type {any} */ ({ sessionId: 'sess-2' }),
        );

        expect(events.at(-1)).toMatchObject({ decision: 'denied' });
    });
});
