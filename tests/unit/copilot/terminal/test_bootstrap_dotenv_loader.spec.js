// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    loadTerminalDotenvLocal,
    TERMINAL_DOTENV_LOCAL_PATH,
} from '../../../../src/copilot/terminal/bootstrap-dotenv-loader.js';

describe('terminal/bootstrap-dotenv-loader', () => {
    it('carrega .env.local sem sobrescrever env explícito', () => {
        const load = vi.fn(() => ({ parsed: { COPILOT_BYOK_ENABLED: 'true', COPILOT_BYOK_PROFILE: 'kilo' } }));

        const result = loadTerminalDotenvLocal({ env: {}, load });

        expect(load).toHaveBeenCalledWith({ path: TERMINAL_DOTENV_LOCAL_PATH, override: false, quiet: true });
        expect(result).toMatchObject({
            loaded: true,
            skipped: false,
            missing: false,
            keys: ['COPILOT_BYOK_ENABLED', 'COPILOT_BYOK_PROFILE'],
            error: null,
        });
    });

    it('permite desligar carregamento local por env explícito', () => {
        const load = vi.fn();

        const result = loadTerminalDotenvLocal({
            env: { COPILOT_TERMINAL_LOAD_DOTENV_LOCAL: 'false' },
            load,
        });

        expect(load).not.toHaveBeenCalled();
        expect(result).toMatchObject({ loaded: false, skipped: true, missing: false, error: null });
    });

    it('trata .env.local ausente como estado normal', () => {
        const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
        const load = vi.fn(() => ({ error }));

        const result = loadTerminalDotenvLocal({ env: {}, load });

        expect(result).toMatchObject({ loaded: false, skipped: false, missing: true, error: null });
    });
});
