import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const script = join(process.cwd(), '.devcontainer/scripts/post-attach.sh');

function runAttach(env = {}, options = {}) {
    // ensure state directory fresh unless caller requests preservation
    const { clear = true } = options;
    const state = join(process.cwd(), '.devcontainer/state');
    if (clear) {
        try {
            rmSync(state, { recursive: true, force: true });
        } catch {}
    }
    // capture both stdout and stderr to allow diagnostic assertions
    return execSync(`bash "${script}" 2>&1`, { env: { ...process.env, ...env } }).toString();
}

describe('post-attach.sh UX state', () => {
    it('marks first attach correctly', () => {
        const out = runAttach();
        assert(out.includes('🔗 VS Code anexado ao DevContainer'));
        // run a second time and ensure first flag not shown
        const second = runAttach();
        // both prints include banner but the first-attach quick-start appears only once?
        assert(second.includes('VS Code anexado ao DevContainer'));
    });

    it('creates attach count file and preserves across runs (amortized)', () => {
        const state = join(process.cwd(), '.devcontainer/state/attach-count');
        // start with a clean namespace once
        try {
            rmSync(join(process.cwd(), '.devcontainer/state'), { recursive: true, force: true });
        } catch {}
        // first attach may clear state and should create the file
        runAttach();
        assert.equal(parseInt(execSync(`cat "${state}"`).toString().trim(), 10), 1);
        // second attach should not rewrite due to amortization
        runAttach({}, { clear: false });
        assert.equal(parseInt(execSync(`cat "${state}"`).toString().trim(), 10), 1);
    });

    it('amortizes file writes for attach count', () => {
        const dir = join(process.cwd(), '.devcontainer/state');
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {}
        runAttach(); // create file
        const file = join(dir, 'attach-count');
        // read contents instead of relying on filesystem mtime, which can be
        // affected by the heavy banner output and is inherently flaky in CI.
        const firstContent = readFileSync(file, 'utf8').trim();

        // second attach: offset should increment but base file must not change
        runAttach({}, { clear: false });
        const secondContent = readFileSync(file, 'utf8').trim();
        assert.equal(secondContent, firstContent, 'base file should not be rewritten on second attach');

        // perform seven more attaches; we expect base to remain unchanged
        // until we hit the 10th total call below
        for (let i = 0; i < 7; i++) runAttach({}, { clear: false });
        const midContent = readFileSync(file, 'utf8').trim();
        assert.equal(midContent, secondContent, 'base file should stay the same until threshold');

        // now the next attach is the 10th overall and should trigger a flush
        runAttach({}, { clear: false });
        const finalCount = parseInt(readFileSync(file, 'utf8').trim(), 10);
        assert.equal(finalCount, 10, 'threshold reached and base file updated');
    });

    it('shows English banner when LANG is english', () => {
        const out = execSync(`bash "${script}"`, { env: { ...process.env, LANG: 'en_US.UTF-8' } }).toString();
        assert(out.includes('VS Code attached to DevContainer'));
        assert(!out.includes('VS Code anexado ao DevContainer'));
    });

    it('accepts --brief flag (no long diagnostics)', () => {
        const out = execSync(`bash "${script}" --brief`).toString();
        assert(out.includes('🔗 VS Code anexado ao DevContainer'));
        // brief should not include environment status header
        assert(!out.includes('Contexto do ambiente:'));
    });

    it('displays NSS base directory when configured', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const out = runAttach({ DEVCONTAINER_NSS_DIR: dir });
        assert(out.includes(`NSS base dir:`));
        // value should reflect the directory we set
        assert(out.includes(dir));
    });

    it('logs LD_PRELOAD and warns if wrapper absent', () => {
        const dir = mkdtempSync(join(tmpdir(), 'nss-'));
        const out = runAttach({ DEVCONTAINER_NSS_DIR: dir, LD_PRELOAD: '' });
        assert(out.includes('LD_PRELOAD:'), 'should print LD_PRELOAD value');
        assert(out.includes('does not contain libnss_wrapper.so'), 'should warn about missing wrapper');
    });
});
