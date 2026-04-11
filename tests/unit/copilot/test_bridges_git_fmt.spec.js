// @ts-check
/**
 * tests/unit/copilot/test_bridges_git_fmt.spec.js
 *
 * Testes para as funções de formatação puramente de git-bridge (formatLog, formatStatus, formatBranch).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('git-bridge — funções de formatação', () => {
    it('formatLog é função exportada por bridges', async () => {
        const { formatLog } = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof formatLog, 'function', 'formatLog deve ser função');
    });

    it('formatStatus é função exportada por bridges', async () => {
        const { formatStatus } = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof formatStatus, 'function', 'formatStatus deve ser função');
    });

    it('formatBranch é função exportada por bridges', async () => {
        const { formatBranch } = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof formatBranch, 'function', 'formatBranch deve ser função');
    });

    it('gitStash e gitStashList são funções exportadas', async () => {
        const { gitStash, gitStashList } = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof gitStash, 'function');
        assert.equal(typeof gitStashList, 'function');
    });

    it('gitBranch, gitCheckout, gitCreateBranch são funções exportadas', async () => {
        const mod = await import('../../../src/copilot/bridges/index.js');
        assert.equal(typeof mod.gitBranch, 'function');
        assert.equal(typeof mod.gitCheckout, 'function');
        assert.equal(typeof mod.gitCreateBranch, 'function');
    });
});
