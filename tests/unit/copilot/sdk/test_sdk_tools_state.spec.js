// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    log: vi.fn(),
    logSwallowed: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
}));

vi.mock('../../../../src/copilot/core/error-handlers.js', () => ({
    logSwallowed: mocks.logSwallowed,
    toError: (/** @type {unknown} */ error) => (error instanceof Error ? error : new Error(String(error))),
}));

vi.mock('../../../../src/copilot/core/safe-json.js', () => ({
    safeJsonParse: vi.fn((raw) => {
        try {
            return { ok: true, data: JSON.parse(raw) };
        } catch {
            return { ok: false, data: null };
        }
    }),
}));

vi.mock('../../../../src/copilot/core/schemas.js', () => ({
    ToolsConfigSchema: {
        safeParse: vi.fn((data) => ({ success: true, data })),
    },
}));

vi.mock('../../../../src/copilot/sdk/logger.js', () => ({
    log: mocks.log,
}));

describe('sdk/tools/state', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loadToolsConfigAsync trata ENOENT como opcional', async () => {
        mocks.readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        const mod = await import('../../../../src/copilot/sdk/tools/state.js');

        await mod.loadToolsConfigAsync();

        expect(mocks.log).toHaveBeenCalledWith('DEBUG', expect.stringContaining('tools-config.json ausente'));
        expect(mocks.logSwallowed).not.toHaveBeenCalled();
    });
});
