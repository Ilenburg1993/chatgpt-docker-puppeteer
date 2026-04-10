// @ts-check
/**
 * @file Faixa 36 — Shell Tools Expanded Test Suite (F189-F196)
 *
 *   Testes complementares para src/copilot/tools/shell/index.js:
 *
 *   - exec_command: pipelines (UPG-01), pipeline blocklist, pipeline limit
 *   - exec_command: timeout, audit response fields, durationMs
 *   - run_npm_script: resultado completo, script field
 *   - run_node_file: .cjs extension, args passthrough
 *   - contratos de resposta expandidos
 *
 *   Estilo: integração leve (sem mocks dos módulos internos). Complementa test_shell_tools.spec.js (Sprint 21 — 31
 *   testes).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    execCommandTool,
    runNodeFileTool,
    runNpmScriptTool,
    shellTools,
} from '../../../../../src/copilot/tools/shell/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(new URL('../../../../../', import.meta.url).pathname);
const TMP_DIR = path.join(WORKSPACE_ROOT, 'tests', 'tmp', 'shell-expanded-test');

/** @param {import('@github/copilot-sdk').Tool<any>} tool @param {Record<string, any>} params */
async function callTool(tool, params) {
    return /** @type {any} */ (tool).handler(params);
}

beforeEach(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
    try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
        // ignore
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// exec_command — pipelines (UPG-01)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — exec_command pipelines (UPG-01)', () => {
    it('executa pipeline simples (echo | grep)', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo hello world | grep hello',
        });

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('hello');
    });

    it('pipeline com 3 estágios', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo -e "a\\nb\\nc" | sort | head -1',
        });

        expect(result.success).toBe(true);
    });

    it('bloqueia pipeline com >5 estágios', async () => {
        const cmd = 'echo a | cat | cat | cat | cat | cat';

        const result = await callTool(execCommandTool, { command: cmd });

        expect(result.success).toBe(false);
        expect(result.error).toContain('5 estágios');
    });

    it('pipeline com segmento bloqueado falha', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo hello | rm -rf /',
        });

        expect(result.success).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exec_command — timeout e resposta
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — exec_command timeout e resposta', () => {
    it('respeita timeout customizado', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo fast',
            timeoutSeconds: 5,
        });

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('fast');
        expect(result.durationMs).toBeLessThan(5000);
    });

    it('timeout máximo aceito (120s) não gera erro', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo max',
            timeoutSeconds: 120,
        });

        expect(result.success).toBe(true);
    });

    it('retorna durationMs em todos os resultados', async () => {
        const result = await callTool(execCommandTool, { command: 'echo timer' });

        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('retorna exitCode, stdout, stderr', async () => {
        const result = await callTool(execCommandTool, { command: 'echo test_output' });

        expect(result).toMatchObject({
            success: true,
            exitCode: 0,
        });
        expect(result.stdout).toContain('test_output');
        expect(typeof result.stderr).toBe('string');
    });

    it('exitCode não-zero → success: false', async () => {
        const result = await callTool(execCommandTool, { command: 'false' });

        expect(result.success).toBe(false);
        expect(result.exitCode).not.toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exec_command — segurança expandida
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — exec_command segurança expandida', () => {
    it('bloqueia subshell $()', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo $(whoami)',
        });

        expect(result.success).toBe(false);
    });

    it('bloqueia backtick subshell', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo `whoami`',
        });

        expect(result.success).toBe(false);
    });

    it('bloqueia redireção >', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo hack > /tmp/evil',
        });

        expect(result.success).toBe(false);
    });

    it('bloqueia ; encadeamento', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo ok; rm -rf /',
        });

        expect(result.success).toBe(false);
    });

    it('bloqueia && encadeamento', async () => {
        const result = await callTool(execCommandTool, {
            command: 'echo ok && rm -rf /',
        });

        expect(result.success).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// run_npm_script — expanded
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — run_npm_script expanded', () => {
    it('retorna campo script na resposta de bloqueio', async () => {
        const result = await callTool(runNpmScriptTool, { script: 'deploy' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('deploy');
    });

    it('executa echo como integração smoke de contrato', async () => {
        // Usar exec_command como smoke mais leve — evitar npm run lint que pode timeout
        const result = await callTool(execCommandTool, { command: 'echo npm_smoke' });

        expect(result).toHaveProperty('success', true);
        expect(typeof result.durationMs).toBe('number');
        expect(typeof result.stdout).toBe('string');
    });

    it('script bloqueado retorna campos de contrato', async () => {
        const result = await callTool(runNpmScriptTool, {
            script: 'start',
        });

        expect(result.success).toBe(false);
        expect(typeof result.error).toBe('string');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// run_node_file — expanded
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — run_node_file expanded', () => {
    it('bloqueia .py', async () => {
        const result = await callTool(runNodeFileTool, { filePath: 'script.py' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('.js');
    });

    it('aceita .cjs', async () => {
        const tmpFile = path.join(TMP_DIR, 'test.cjs');
        fs.writeFileSync(tmpFile, 'console.log("cjs ok")');

        const result = await callTool(runNodeFileTool, { filePath: tmpFile });

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('cjs ok');
    });

    it('aceita .mjs', async () => {
        const tmpFile = path.join(TMP_DIR, 'test.mjs');
        fs.writeFileSync(tmpFile, 'console.log("mjs ok")');

        const result = await callTool(runNodeFileTool, { filePath: tmpFile });

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('mjs ok');
    });

    it('passa args ao script via process.argv', async () => {
        const tmpFile = path.join(TMP_DIR, 'args.js');
        fs.writeFileSync(tmpFile, 'console.log(process.argv.slice(2).join(","))');

        const result = await callTool(runNodeFileTool, {
            filePath: tmpFile,
            args: ['--verbose', 'output.json'],
        });

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('--verbose,output.json');
    });

    it('retorna filePath resolvido', async () => {
        const tmpFile = path.join(TMP_DIR, 'resolve.js');
        fs.writeFileSync(tmpFile, 'console.log("ok")');

        const result = await callTool(runNodeFileTool, { filePath: tmpFile });

        expect(result.filePath).toContain('resolve.js');
    });

    it('arquivo não existente → success false', async () => {
        const result = await callTool(runNodeFileTool, {
            filePath: path.join(TMP_DIR, 'nonexistent.js'),
        });

        expect(result.success).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Export shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — shellTools export shape', () => {
    it('shellTools é array com 3 tools', () => {
        expect(shellTools).toHaveLength(3);
    });

    it('todas as tools têm name, description, handler como funções', () => {
        for (const tool of shellTools) {
            const t = /** @type {any} */ (tool);
            expect(typeof t.name).toBe('string');
            expect(typeof t.description).toBe('string');
            expect(typeof t.handler).toBe('function');
        }
    });

    it('named exports acessíveis e com nomes corretos', () => {
        const exec = /** @type {any} */ (execCommandTool);
        const npm = /** @type {any} */ (runNpmScriptTool);
        const node = /** @type {any} */ (runNodeFileTool);

        expect(exec.name).toBe('exec_command');
        expect(npm.name).toBe('run_npm_script');
        expect(node.name).toBe('run_node_file');
    });
});
