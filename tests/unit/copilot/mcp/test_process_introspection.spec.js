// @ts-check

import { describe, expect, it } from 'vitest';
import {
    DEFAULT_LINUX_PROCESS_CMDLINE_MAX_BYTES,
    MAX_LINUX_PROCESS_CMDLINE_MAX_BYTES,
    readLinuxProcessArgv,
} from '../../../../src/copilot/mcp/control-plane/process-introspection.js';

describe('MCP process introspection', () => {
    it('rejects invalid pid and oversized budgets before touching /proc', async () => {
        await expect(readLinuxProcessArgv(0)).rejects.toMatchObject({ code: 'ERR_PROCESS_PID_INVALID' });
        await expect(
            readLinuxProcessArgv(process.pid, { maxBytes: MAX_LINUX_PROCESS_CMDLINE_MAX_BYTES + 1 }),
        ).rejects.toMatchObject({ code: 'ERR_PROCESS_CMDLINE_BUDGET_INVALID' });
        expect(DEFAULT_LINUX_PROCESS_CMDLINE_MAX_BYTES).toBeLessThanOrEqual(MAX_LINUX_PROCESS_CMDLINE_MAX_BYTES);
    });

    it.skipIf(process.platform !== 'linux')(
        'reads current Linux argv through a bounded pid-only primitive',
        async () => {
            const result = await readLinuxProcessArgv(process.pid);

            expect(result.pid).toBe(process.pid);
            expect(result.truncated).toBe(false);
            expect(result.bytesRead).toBeGreaterThan(0);
            expect(result.argv.length).toBeGreaterThan(0);
            expect(result.argv[0]).toBeTruthy();
        },
    );

    it.skipIf(process.platform !== 'linux')(
        'reports truncation instead of trusting a partial command line',
        async () => {
            const result = await readLinuxProcessArgv(process.pid, { maxBytes: 1 });
            expect(result.truncated).toBe(true);
            expect(result.bytesRead).toBe(2);
        },
    );
});
