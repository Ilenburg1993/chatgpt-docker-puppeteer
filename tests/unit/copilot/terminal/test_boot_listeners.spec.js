// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { shouldRegisterTerminalSighupHandler } from '../../../../src/copilot/terminal/terminal-phases/boot-listeners.js';

describe('terminal/terminal-phases/boot-listeners', () => {
    it('registra SIGHUP apenas em plataformas com semântica POSIX confiável', () => {
        assert.equal(shouldRegisterTerminalSighupHandler('linux'), true);
        assert.equal(shouldRegisterTerminalSighupHandler('darwin'), true);
        assert.equal(shouldRegisterTerminalSighupHandler('win32'), false);
    });
});
