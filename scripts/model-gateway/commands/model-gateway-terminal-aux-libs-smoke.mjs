#!/usr/bin/env node
// @ts-check
/**
 * Smoke read-only dos adapters de libs auxiliares do Terminal LLM-B.
 *
 * O objetivo e provar, sem TUI e sem LLM, que os renderers externos sao opcionais e que o fallback JS permanece
 * funcional quando `PATH` esta vazio. O script nao modifica arquivos do projeto; fixtures vivem em diretorio temporario.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const jsonMode = args.has('--json');
const strictMode = args.has('--strict');
const ANSI_OR_OSC_RE = new RegExp(
    '\\u001B(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\u0007]*(?:\\u0007|\\u001B\\\\)|[@-Z\\\\-_])',
    'u',
);

/** @type {null | (() => void)} */
let clearCapabilityCache = null;

const SAMPLE_DIFF = [
    'diff --git a/example.txt b/example.txt',
    'index 1111111..2222222 100644',
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
].join('\n');

/**
 * @typedef {{
 *     id: string;
 *     label: string;
 *     renderer: string;
 *     expected: string;
 *     status: 'pass' | 'degraded' | 'fail';
 *     detail: string;
 * }} SmokeCheck
 */

/**
 * @param {string} value
 * @returns {string}
 */
function compact(value) {
    return value.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} renderer
 * @param {string} expected
 * @param {boolean} pass
 * @param {string} detail
 * @returns {SmokeCheck}
 */
function check(id, label, renderer, expected, pass, detail) {
    return {
        id,
        label,
        renderer,
        expected,
        status: pass ? 'pass' : 'fail',
        detail,
    };
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} renderer
 * @param {string} expected
 * @param {boolean} available
 * @param {string | null} fallbackReason
 * @returns {SmokeCheck}
 */
function externalCheck(id, label, renderer, expected, available, fallbackReason) {
    if (!available) {
        return {
            id,
            label,
            renderer,
            expected,
            status: renderer === 'js' ? 'pass' : 'fail',
            detail: fallbackReason ? `ferramenta ausente; fallback ${fallbackReason}` : 'ferramenta ausente; fallback JS',
        };
    }
    if (renderer === expected) {
        return { id, label, renderer, expected, status: 'pass', detail: 'renderer externo exercido' };
    }
    return {
        id,
        label,
        renderer,
        expected,
        status: 'degraded',
        detail: fallbackReason ? `renderer externo degradou para fallback: ${fallbackReason}` : 'renderer externo degradou',
    };
}

/**
 * @param {string} pathValue
 * @returns {void}
 */
function setPath(pathValue) {
    process.env['PATH'] = pathValue;
    clearCapabilityCache?.();
}

/**
 * @param {SmokeCheck[]} checks
 * @returns {boolean}
 */
function summarizeOk(checks) {
    if (checks.some((item) => item.status === 'fail')) return false;
    return strictMode ? checks.every((item) => item.status === 'pass') : true;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasUnsafeTerminalText(value) {
    if (typeof value === 'string') {
        return ANSI_OR_OSC_RE.test(value) || hasUnsafeControlCode(value) || /\r(?!\n)/u.test(value);
    }
    if (Array.isArray(value)) return value.some((item) => hasUnsafeTerminalText(item));
    if (value && typeof value === 'object') {
        return Object.values(/** @type {Record<string, unknown>} */ (value)).some((item) => hasUnsafeTerminalText(item));
    }
    return false;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasUnsafeControlCode(value) {
    return [...value].some((char) => {
        const code = char.charCodeAt(0);
        return (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    });
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const originalConsoleLog = console.log;
    /** @type {Awaited<ReturnType<typeof importCapabilitiesModule>>} */
    let api;
    try {
        console.log = () => {};
        api = await importCapabilitiesModule();
    } finally {
        console.log = originalConsoleLog;
    }
    const {
        clearTerminalExternalToolCapabilityCache,
        readTerminalExternalToolCapabilities,
        renderTerminalDiffPreview,
        renderTerminalFilePreview,
        renderTerminalMarkdownPreview,
        renderTerminalStructuredPreview,
    } = api;
    clearCapabilityCache = clearTerminalExternalToolCapabilityCache;
    console.log = originalConsoleLog;

    const originalPath = process.env['PATH'] ?? '';
    const dir = await mkdtemp(join(tmpdir(), 'terminal-aux-libs-smoke-'));
    const textPath = join(dir, 'example.js');
    const markdownPath = join(dir, 'example.md');
    const jsonPath = join(dir, 'example.json');
    const yamlPath = join(dir, 'example.yml');
    await writeFile(textPath, 'const value = 42;\nconsole.log(value);\n', 'utf8');
    await writeFile(markdownPath, '# Smoke\n\n- terminal aux libs\n', 'utf8');
    await writeFile(jsonPath, '{"scripts":{"smoke":"ok"},"b":2}\n', 'utf8');
    await writeFile(yamlPath, 'jobs:\n  test:\n    runs-on: ubuntu-latest\n', 'utf8');

    /** @type {SmokeCheck[]} */
    const checks = [];
    try {
        setPath('');
        const fallbackFile = renderTerminalFilePreview(textPath, 'const value = 42;\n', {
            color: 'never',
        });
        checks.push(
            check(
                'fallback-file-preview',
                'file preview sem PATH',
                fallbackFile.renderer,
                'js',
                fallbackFile.renderer === 'js' && /bat\/batcat ausente/u.test(fallbackFile.fallbackReason ?? ''),
                fallbackFile.fallbackReason ?? 'sem fallbackReason',
            ),
        );
        const fallbackMarkdown = renderTerminalMarkdownPreview('# Smoke', { color: 'never' });
        checks.push(
            check(
                'fallback-markdown-preview',
                'markdown sem PATH',
                fallbackMarkdown.renderer,
                'js',
                fallbackMarkdown.renderer === 'js' && /glow ausente/u.test(fallbackMarkdown.fallbackReason ?? ''),
                fallbackMarkdown.fallbackReason ?? 'sem fallbackReason',
            ),
        );
        const fallbackDiff = renderTerminalDiffPreview(SAMPLE_DIFF, { color: 'never' });
        checks.push(
            check(
                'fallback-diff-preview',
                'diff sem PATH',
                fallbackDiff.renderer,
                'js',
                fallbackDiff.renderer === 'js' && /delta ausente/u.test(fallbackDiff.fallbackReason ?? ''),
                fallbackDiff.fallbackReason ?? 'sem fallbackReason',
            ),
        );
        const fallbackJson = renderTerminalStructuredPreview('{"a":1}', { format: 'json', color: 'never' });
        checks.push(
            check(
                'fallback-json-preview',
                'json sem PATH',
                fallbackJson.renderer,
                'js',
                fallbackJson.renderer === 'js' && /jq ausente/u.test(fallbackJson.fallbackReason ?? ''),
                fallbackJson.fallbackReason ?? 'sem fallbackReason',
            ),
        );
        const fallbackYaml = renderTerminalStructuredPreview('a: 1\n', { format: 'yaml', color: 'never' });
        checks.push(
            check(
                'fallback-yaml-preview',
                'yaml sem PATH',
                fallbackYaml.renderer,
                'js',
                fallbackYaml.renderer === 'js' && /yq ausente/u.test(fallbackYaml.fallbackReason ?? ''),
                fallbackYaml.fallbackReason ?? 'sem fallbackReason',
            ),
        );

        setPath(originalPath);
        const capabilities = readTerminalExternalToolCapabilities({ refresh: true });
        const hasTool = (/** @type {string} */ id) => capabilities.some((tool) => tool.id === id && tool.available);
        const realFile = renderTerminalFilePreview(textPath, '', { color: 'never' });
        checks.push(
            externalCheck(
                'real-file-preview',
                'file preview PATH real',
                realFile.renderer,
                'bat',
                hasTool('bat'),
                realFile.fallbackReason,
            ),
        );
        const realMarkdown = renderTerminalMarkdownPreview('# Smoke\n\n- ok\n', { color: 'never' });
        checks.push(
            externalCheck(
                'real-markdown-preview',
                'markdown PATH real',
                realMarkdown.renderer,
                'glow',
                hasTool('glow'),
                realMarkdown.fallbackReason,
            ),
        );
        const realDiff = renderTerminalDiffPreview(SAMPLE_DIFF, { color: 'always' });
        checks.push(
            externalCheck('real-diff-preview', 'diff PATH real', realDiff.renderer, 'delta', hasTool('delta'), realDiff.fallbackReason),
        );
        const realJson = renderTerminalStructuredPreview('{"scripts":{"smoke":"ok"},"b":2}', {
            format: 'json',
            query: '.scripts',
            color: 'never',
        });
        checks.push(
            externalCheck('real-json-preview', 'json PATH real', realJson.renderer, 'jq', hasTool('jq'), realJson.fallbackReason),
        );
        const realYaml = renderTerminalStructuredPreview('jobs:\n  test:\n    runs-on: ubuntu-latest\n', {
            format: 'yaml',
            query: '.jobs',
            color: 'never',
        });
        checks.push(
            externalCheck('real-yaml-preview', 'yaml PATH real', realYaml.renderer, 'yq', hasTool('yq'), realYaml.fallbackReason),
        );

        const availableTools = capabilities
            .filter((tool) => tool.available)
            .map((tool) => ({ id: tool.id, command: tool.command, version: tool.version }));
        checks.push(
            check(
                'json-envelope-clean',
                'envelope JSON sem controle',
                'js',
                'js',
                !hasUnsafeTerminalText({ availableTools, checks }),
                'versões, detalhes e checks sem ANSI/OSC/CR solto/controles',
            ),
        );

        const ok = summarizeOk(checks);
        const summary = {
            schema: 'terminal-auxiliary-libs-smoke',
            ok,
            strict: strictMode,
            generatedAt: new Date().toISOString(),
            availableTools,
            checks,
        };
        if (jsonMode) {
            console.log(JSON.stringify(summary, null, 2));
        } else {
            console.log(`Terminal auxiliary libs smoke: ${ok ? 'PASS' : 'FAIL'}${strictMode ? ' (strict)' : ''}`);
            for (const item of checks) {
                const marker = item.status === 'pass' ? '[x]' : item.status === 'degraded' ? '[~]' : '[ ]';
                console.log(`${marker} ${item.id} · ${item.renderer}/${item.expected} · ${compact(item.detail)}`);
            }
        }
        process.exitCode = ok ? 0 : 1;
    } finally {
        setPath(originalPath);
        await rm(dir, { recursive: true, force: true });
    }
}

await main();

/**
 * @returns {Promise<typeof import('../../../src/copilot/terminal/capabilities/index.js')>}
 */
function importCapabilitiesModule() {
    return import('../../../src/copilot/terminal/capabilities/index.js');
}
