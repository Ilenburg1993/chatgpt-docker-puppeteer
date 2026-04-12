// @ts-check
import { describe, it, beforeEach } from 'node:test';
/**
 * tests/unit/copilot/tools/test_git_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/git/index.js.
 *
 * Valida:
 *
 * - gitTools exporta array com 9 tools
 * - safeGitArgs: trunca stdout a 4000 chars, captura stderr/exitCode
 * - git_status: combina status --short + log --oneline -5
 * - git_diff: --staged, filePath, trunca a 200 linhas
 * - git_commit: add + commit, paths/all, nenhum arquivo staged → erro
 * - git_changed_files: diff --name-status HEAD
 * - git_push: sanitiza remote, setUpstream
 * - git_create_branch: sanitiza nome, base, checkout=false
 * - git_log: n, oneline
 * - git_current_branch: rev-parse --abbrev-ref HEAD
 * - git_is_dirty: isDirty true/false, changedFiles count
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

vi.mock('../../../../src/copilot/tools/tool-factory.js', () => ({
    withSkipPermission: vi.fn((tool) => tool),
}));

/** Resultado padrão do execFile mockado */
let execFileMockImpl = vi.fn();

vi.mock('node:child_process', () => ({
    execFile: (...args) => {
        // promisify precisa do callback-style
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
            const result = execFileMockImpl(args[0], args[1], args[2]);
            if (result instanceof Error) {
                cb(result);
            } else {
                cb(null, result);
            }
        }
    },
}));

vi.mock('#copilot/sdk', () => ({
    createTool: vi.fn((config) => ({
        name: config.name,
        description: config.description,
        handler: config.handler,
        parameters: config.parameters,
    })),
    defineTool: vi.fn((name, config) => ({
        name,
        description: config.description,
        handler: config.handler,
        parameters: config.parameters,
    })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockGitOutput(stdout = '', stderr = '') {
    execFileMockImpl.mockImplementation(() => ({ stdout, stderr }));
}

function mockGitError(stderr = 'error', code = 1, stdout = '') {
    execFileMockImpl.mockImplementation(() => {
        const err = new Error(stderr);
        /** @type {any} */ (err).stderr = stderr;
        /** @type {any} */ (err).stdout = stdout;
        /** @type {any} */ (err).code = code;
        throw err;
    });
}

/**
 * Configura sequência de respostas do git (para commands que chamam safeGitArgs múltiplas vezes).
 *
 * @param {{ stdout?: string; stderr?: string; error?: boolean; code?: number }[]} seq
 */
function mockGitSequence(seq) {
    let idx = 0;
    execFileMockImpl.mockImplementation(() => {
        const curr = seq[idx++] || { stdout: '' };
        if (curr.error) {
            const err = new Error(curr.stderr || 'fail');
            /** @type {any} */ (err).stderr = curr.stderr || '';
            /** @type {any} */ (err).stdout = curr.stdout || '';
            /** @type {any} */ (err).code = curr.code || 1;
            throw err;
        }
        return { stdout: curr.stdout || '', stderr: curr.stderr || '' };
    });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('git-tools', () => {
    /** @type {typeof import('../../../../src/copilot/tools/git/index.js')} */
    let mod;

    beforeEach(async () => {
        vi.resetModules();
        // Reset mock
        execFileMockImpl = vi.fn();
        mockGitOutput('');
        mod = await import('../../../../src/copilot/tools/git/index.js');
    });

    // ── Exports ───────────────────────────────────────────────────────────

    describe('exports', () => {
        it('gitTools é array com 9 tools', () => {
            expect(Array.isArray(mod.gitTools)).toBe(true);
            expect(mod.gitTools.length).toBe(9);
        });

        it('contém todas as tools esperadas', () => {
            const names = mod.gitTools.map((t) => t.name);
            expect(names).toContain('git_status');
            expect(names).toContain('git_diff');
            expect(names).toContain('git_commit');
            expect(names).toContain('git_changed_files');
            expect(names).toContain('git_push');
            expect(names).toContain('git_create_branch');
            expect(names).toContain('git_log');
            expect(names).toContain('git_current_branch');
            expect(names).toContain('git_is_dirty');
        });
    });

    // ── git_status ────────────────────────────────────────────────────────

    describe('git_status', () => {
        /** @returns {any} */
        const find = () => mod.gitTools.find((t) => t.name === 'git_status');

        it('combina status --short + log --oneline', async () => {
            mockGitSequence([
                { stdout: 'M  src/file.js\n?? new.txt' },
                { stdout: 'abc1234 fix bug\ndef5678 add feature' },
            ]);

            const result = await find().handler({});

            expect(result.output).toContain('M  src/file.js');
            expect(result.output).toContain('abc1234 fix bug');
        });

        it('retorna error de comando', async () => {
            mockGitSequence([{ error: true, stderr: 'not a git repo' }, { stdout: '' }]);

            const result = await find().handler({});
            expect(result.error).toMatch(/not a git repo/);
        });
    });

    // ── git_diff ──────────────────────────────────────────────────────────

    describe('git_diff', () => {
        /** @returns {any} */
        const find = () => mod.gitTools.find((t) => t.name === 'git_diff');

        it('retorna diff completo', async () => {
            mockGitOutput('diff --git a/file.js b/file.js\n+new line');
            const result = await find().handler({});

            expect(result.output).toContain('+new line');
        });

        it('aceita staged=true', async () => {
            mockGitOutput('+staged change');
            const result = await find().handler({ staged: true });

            expect(result.output).toContain('+staged change');
            // Verifica que args contêm --staged
            expect(execFileMockImpl).toHaveBeenCalled();
            const args = execFileMockImpl.mock.calls[0];
            expect(args[1]).toContain('--staged');
        });

        it('aceita caminho específico', async () => {
            mockGitOutput('+change in file');
            await find().handler({ path: 'src/test.js' });

            const args = execFileMockImpl.mock.calls[0];
            expect(args[1]).toContain('--');
            expect(args[1]).toContain('src/test.js');
        });

        it('trunca a 200 linhas', async () => {
            const lines = Array.from({ length: 300 }, (_, i) => `line-${i}`).join('\n');
            mockGitOutput(lines);

            const result = await find().handler({});
            const outputLines = result.output.split('\n');
            expect(outputLines.length).toBeLessThanOrEqual(200);
        });
    });

    // ── git_commit ────────────────────────────────────────────────────────

    describe('git_commit', () => {
        /** @returns {any} */
        const find = () => mod.gitTools.find((t) => t.name === 'git_commit');

        it('comita com all=true', async () => {
            mockGitSequence([
                { stdout: '' }, // git add -A
                { stdout: 'file.js\n' }, // diff --cached --name-only
                { stdout: '[main abc1234] feat: test' }, // commit
            ]);

            const result = await find().handler({ message: 'feat: test', all: true });
            expect(result.success).toBe(true);
            expect(result.output).toContain('[main abc1234]');
        });

        it('comita com paths específicos', async () => {
            mockGitSequence([
                { stdout: '' }, // git add -- pathA pathB
                { stdout: 'pathA\npathB\n' }, // diff --cached
                { stdout: '[main 123] fix' }, // commit
            ]);

            const result = await find().handler({ message: 'fix: x', paths: ['pathA', 'pathB'] });
            expect(result.success).toBe(true);
        });

        it('retorna erro se nenhum arquivo staged', async () => {
            mockGitSequence([
                { stdout: '' }, // nenhum staged
            ]);

            const result = await find().handler({ message: 'empty' });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/nenhum arquivo staged/i);
        });

        it('retorna erro quando commit falha', async () => {
            mockGitSequence([
                { stdout: '' }, // git add -A
                { stdout: 'staged.js\n' }, // diff --cached
                { error: true, stderr: 'nothing to commit' }, // commit falha
            ]);

            const result = await find().handler({ message: 'fail', all: true });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/nothing to commit/);
        });
    });

    // ── git_changed_files ─────────────────────────────────────────────────

    describe('git_changed_files', () => {
        it('lista arquivos alterados', async () => {
            mockGitOutput('M\tsrc/file.js\nA\tnew.js');
            const tool = mod.gitTools.find((t) => t.name === 'git_changed_files');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.output).toContain('M\tsrc/file.js');
            expect(result.output).toContain('A\tnew.js');
        });
    });

    // ── git_push ──────────────────────────────────────────────────────────

    describe('git_push', () => {
        /** @returns {any} */
        const find = () => mod.gitTools.find((t) => t.name === 'git_push');

        it('push para origin padrão', async () => {
            mockGitOutput('Everything up-to-date');
            const result = await find().handler({});

            expect(result.success).toBe(true);
            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('push');
            expect(args).toContain('origin');
        });

        it('push com setUpstream', async () => {
            mockGitOutput('ok');
            await find().handler({ setUpstream: true });

            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('--set-upstream');
        });

        it('sanitiza remote perigoso', async () => {
            mockGitOutput('');
            await find().handler({ remote: 'evil;rm -rf /' });

            const args = execFileMockImpl.mock.calls[0][1];
            const remote = args[args.length - 1];
            expect(remote).not.toContain(';');
            expect(remote).not.toContain(' ');
        });
    });

    // ── git_create_branch ─────────────────────────────────────────────────

    describe('git_create_branch', () => {
        /** @returns {any} */
        const find = () => mod.gitTools.find((t) => t.name === 'git_create_branch');

        it('cria branch com checkout', async () => {
            mockGitOutput('Switched to new branch feat/test');
            const result = await find().handler({ name: 'feat/test' });

            expect(result.success).toBe(true);
            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('checkout');
            expect(args).toContain('-b');
            expect(args).toContain('feat/test');
        });

        it('cria branch sem checkout', async () => {
            mockGitOutput('');
            await find().handler({ name: 'feat/test', checkout: false });

            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('branch');
            expect(args).not.toContain('checkout');
        });

        it('aceita base branch', async () => {
            mockGitOutput('');
            await find().handler({ name: 'feat/test', base: 'develop' });

            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('develop');
        });

        it('rejeita nome de branch com caracteres inválidos', async () => {
            const result = await find().handler({ name: 'bad branch; rm -rf /' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/inválido/);
            expect(execFileMockImpl).not.toHaveBeenCalled();
        });

        it('rejeita base com caracteres inválidos', async () => {
            const result = await find().handler({ name: 'feat/ok', base: 'bad base; echo' });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/inválida/i);
        });
    });

    // ── git_log ───────────────────────────────────────────────────────────

    describe('git_log', () => {
        /** @returns {any} */
        const find = () => mod.gitTools.find((t) => t.name === 'git_log');

        it('retorna log --oneline por default', async () => {
            mockGitOutput('abc1234 fix stuff\ndef5678 add thing');
            const result = await find().handler({});

            expect(result.output).toContain('abc1234 fix stuff');
            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('--oneline');
            expect(args).toContain('-10');
        });

        it('aceita n customizado', async () => {
            mockGitOutput('log');
            await find().handler({ n: 5 });

            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('-5');
        });

        it('aceita oneline=false', async () => {
            mockGitOutput('hash author date msg');
            await find().handler({ oneline: false });

            const args = execFileMockImpl.mock.calls[0][1];
            expect(args).toContain('--pretty=format:%h %an %ar %s');
            expect(args).not.toContain('--oneline');
        });
    });

    // ── git_current_branch ────────────────────────────────────────────────

    describe('git_current_branch', () => {
        it('retorna nome do branch atual', async () => {
            mockGitOutput('main\n');
            const tool = mod.gitTools.find((t) => t.name === 'git_current_branch');
            const result = await /** @type {any} */ (tool).handler({});

            expect(result.branch).toBe('main');
        });
    });

    // ── git_is_dirty ──────────────────────────────────────────────────────

    describe('git_is_dirty', () => {
        /** @returns {any} */
        const find = () => mod.gitTools.find((t) => t.name === 'git_is_dirty');

        it('retorna isDirty=true quando há mudanças', async () => {
            mockGitOutput('M src/file.js\n?? untracked.txt');
            const result = await find().handler({});

            expect(result.isDirty).toBe(true);
            expect(result.changedFiles).toBe(2);
            expect(result.summary).toContain('2');
        });

        it('retorna isDirty=false quando working tree limpa', async () => {
            mockGitOutput('');
            const result = await find().handler({});

            expect(result.isDirty).toBe(false);
            expect(result.changedFiles).toBe(0);
            expect(result.summary).toContain('limpa');
        });
    });
});
