// @ts-check
/**
 * Contract tests para a policy finita das file tools.
 *
 * Validam o comportamento observável dos truncamentos policy-driven sem alterar os defaults LLM-B first.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

const WORKSPACE = '/workspaces/chatgpt-docker-puppeteer';
const LIMIT_ENV_KEYS = [
    'COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES',
    'COPILOT_FILE_TOOLS_MAX_SEARCH_OUTPUT_BYTES',
    'COPILOT_FILE_TOOLS_MAX_LIST_ENTRIES',
    'COPILOT_FILE_TOOLS_MAX_DIFF_OUTPUT_BYTES',
];

/** @type {Record<string, string | undefined>} */
let previousEnv;
/** @type {string} */
let tmpDir;
/** @type {string} */
let longFile;
/** @type {string} */
let diffFileA;
/** @type {string} */
let diffFileB;

/**
 * @param {string} toolName
 * @returns {Promise<Function>}
 */
async function loadToolHandler(toolName) {
    vi.resetModules();
    const mod = await import('../../../../../src/copilot/tools/file/read-tools.js');
    const tools = [
        mod.readFileContentTool,
        mod.listDirectoryTool,
        mod.searchInFilesTool,
        mod.diffFilesTool,
        mod.workspaceSymbolSearchTool,
    ];
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
        throw new Error(`Tool não encontrada: ${toolName}`);
    }
    return /** @type {any} */ (tool).handler ?? /** @type {any} */ (tool).execute ?? /** @type {any} */ (tool).run;
}

beforeEach(() => {
    previousEnv = Object.fromEntries(LIMIT_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of LIMIT_ENV_KEYS) {
        delete process.env[key];
    }
    tmpDir = fs.mkdtempSync(path.join(WORKSPACE, 'tmp', '.readtools-policy-'));
    longFile = path.join(tmpDir, 'long.txt');
    diffFileA = path.join(tmpDir, 'diff-a.txt');
    diffFileB = path.join(tmpDir, 'diff-b.txt');

    fs.writeFileSync(longFile, '0123456789abcdef'.repeat(16));
    fs.writeFileSync(diffFileA, 'alpha\n'.repeat(40));
    fs.writeFileSync(diffFileB, 'beta\n'.repeat(40));
    for (let index = 0; index < 5; index++) {
        fs.writeFileSync(path.join(tmpDir, `entry-${index}.txt`), `entry ${index}`);
    }
});

afterEach(() => {
    for (const key of LIMIT_ENV_KEYS) {
        if (previousEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = previousEnv[key];
        }
    }
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('tools/file policy-driven finite limits', () => {
    it('read_file_content explicita truncamento quando max content bytes é finito', async () => {
        process.env.COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES = '48';
        const handler = await loadToolHandler('read_file_content');

        const result = await handler({ path: longFile, encoding: 'utf8' });

        expect(result.success).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.configuredLimitBytes).toBe(48);
        expect(result.originalContentBytes).toBeGreaterThan(48);
        expect(result.content).toContain('[conteúdo truncado por política');
    });

    it('list_directory aplica limite explícito de entries quando configurado', async () => {
        process.env.COPILOT_FILE_TOOLS_MAX_LIST_ENTRIES = '2';
        const handler = await loadToolHandler('list_directory');

        const result = await handler({ path: tmpDir, recursive: false, depth: 3, showHidden: false });

        expect(result.success).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.configuredLimitEntries).toBe(2);
        expect(result.totalEntries).toBeGreaterThan(2);
        expect(result.entries).toHaveLength(2);
    });

    it('diff_files explicita truncamento quando max diff output bytes é finito', async () => {
        process.env.COPILOT_FILE_TOOLS_MAX_DIFF_OUTPUT_BYTES = '64';
        const handler = await loadToolHandler('diff_files');

        const result = await handler({ path_a: diffFileA, path_b: diffFileB, context_lines: 3 });

        expect(result.success).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.configuredLimitBytes).toBe(64);
        expect(result.originalDiffBytes).toBeGreaterThan(64);
        expect(result.diff).toContain('[diff truncado por política');
    });
});
