// @ts-check

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readTextFreshConfigured: vi.fn(),
    writeFileAtomicConfigured: vi.fn(),
    log: vi.fn(),
    logSwallowed: vi.fn(),
}));

vi.mock('#copilot/infra/public/composition/filesystem/configured', () => ({
    createConfiguredFsGrant: vi.fn((declaration) => declaration),
    createConfiguredFsIo: vi.fn(() => ({
        readTextFresh: mocks.readTextFreshConfigured,
        writeFileAtomic: mocks.writeFileAtomicConfigured,
    })),
}));

vi.mock('#copilot/observability/swallowed', () => ({
    logSwallowed: mocks.logSwallowed,
    toError: (/** @type {unknown} */ error) => (error instanceof Error ? error : new Error(String(error))),
}));

vi.mock('#copilot/infra/public/platform/json', () => ({
    parseJsonResult: vi.fn((raw) => {
        try {
            return { ok: true, data: JSON.parse(raw) };
        } catch {
            return { ok: false, data: null };
        }
    }),
}));

vi.mock('../../../../src/copilot/sdk/tools/schemas.js', () => ({
    ToolsConfigSchema: {
        safeParse: vi.fn((data) => ({ success: true, data })),
    },
}));

vi.mock('../../../../src/copilot/sdk/logger.js', () => ({
    log: mocks.log,
}));

describe('sdk/tools/state', () => {
    beforeEach(() => {
        mocks.readTextFreshConfigured.mockReset();
        mocks.readTextFreshConfigured.mockResolvedValue({ content: '{}' });
        mocks.writeFileAtomicConfigured.mockReset();
        mocks.writeFileAtomicConfigured.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('loadToolsConfigAsync trata ENOENT como opcional', async () => {
        mocks.readTextFreshConfigured.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        const mod = await import('../../../../src/copilot/sdk/tools/state.js');

        await mod.loadToolsConfigAsync();

        expect(mocks.log).toHaveBeenCalledWith('DEBUG', expect.stringContaining('tools-config.json ausente'));
        expect(mocks.logSwallowed).not.toHaveBeenCalled();
    });

    it('serializa patches concorrentes e persiste o estado final por último', async () => {
        const mod = await import('../../../../src/copilot/sdk/tools/state.js');
        mod.resetToolsConfigForTests();
        /** @type {((value?: void | PromiseLike<void>) => void) | undefined} */
        let releaseFirst;
        mocks.writeFileAtomicConfigured
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        releaseFirst = resolve;
                    }),
            )
            .mockResolvedValueOnce(undefined);

        const first = mod.patchToolsConfig({ allowlist: ['read_file'] });
        await Promise.resolve();
        const second = mod.patchToolsConfig({ denylist: ['shell'] });
        await Promise.resolve();

        expect(mocks.writeFileAtomicConfigured).toHaveBeenCalledTimes(1);
        releaseFirst?.();
        await Promise.all([first, second]);

        expect(mocks.writeFileAtomicConfigured).toHaveBeenCalledTimes(2);
        const firstPayload = JSON.parse(String(mocks.writeFileAtomicConfigured.mock.calls[0]?.[1]));
        const secondPayload = JSON.parse(String(mocks.writeFileAtomicConfigured.mock.calls[1]?.[1]));
        expect(firstPayload).toEqual({ allowlist: ['read_file'], denylist: [] });
        expect(secondPayload).toEqual({ allowlist: ['read_file'], denylist: ['shell'] });
        expect(mocks.writeFileAtomicConfigured.mock.calls[1]?.[2]).toEqual({ mode: 0o600 });
    });
});
