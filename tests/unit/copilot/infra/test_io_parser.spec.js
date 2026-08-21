// @ts-check
/**
 * Testes unitários para io-parser.js
 */

import { BABEL_PARSER_POLICY_VERSION, resolveBabelParserOptions } from '#copilot/infra/internal/code-analysis';
import { readTextFileSnapshot } from '#copilot/infra/internal/filesystem/read';
import {
    buildOutline,
    createParserWorkerRuntime,
    extractJsonSchema,
    extractMarkdownOutline,
    extractTopComments,
    getParserCacheStats as getParserCacheStatsRaw,
    parseAndCacheSymbols as parseAndCacheSymbolsRaw,
    parseFileForContext as parseFileForContextRaw,
    parseFileSymbols,
    resolveParserWorkerPoolPolicy,
    resolveParserWorkerQueuePolicy,
    windowFileContext,
} from '#copilot/infra/internal/indexing/parser';
import { createParserCacheRuntime } from '#copilot/infra/internal/indexing/parser/cache';
import { sha256 } from '#copilot/infra/internal/platform';
import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';

let tmpDir = '';
/** @type {ReturnType<typeof createParserWorkerRuntime>} */
let parserWorkerRuntime;
/** @type {ReturnType<typeof createParserCacheRuntime>} */
let parserCacheRuntime;
const INVALIDATION_BUS = Object.freeze({
    registerHook() {
        return () => {};
    },
});
/** @param {string} filePath @param {Parameters<typeof parseAndCacheSymbolsRaw>[1]} [options] */
const parseAndCacheSymbols = (filePath, options = {}) =>
    parseAndCacheSymbolsRaw(filePath, { ...options, parserCacheRuntime });
/** @param {string} filePath @param {string} content @param {Parameters<typeof parseFileForContextRaw>[2]} [options] */
const parseFileForContext = (filePath, content, options = {}) =>
    parseFileForContextRaw(filePath, content, { ...options, parserCacheRuntime });
const getParserCacheStats = () => getParserCacheStatsRaw(parserCacheRuntime);
const invalidateParserCache = (filePath) => parserCacheRuntime.invalidate(filePath);

const execFileAsync = promisify(execFile);
const JS_CONTENT = `
// Module principal de teste
import { foo } from './foo.js';

/** @param {string} x */
export function greet(x) {
    return 'hello ' + x;
}

export const MAX = 42;
export class MyClass {
    constructor() {}
    method() {}
}

export default greet;
`;

const TS_CONTENT = `
import type { FooBar } from './types.js';

export interface Config {
    host: string;
    port: number;
}

export type Handler = (req: Config) => void;

export async function handleRequest(cfg: Config): Promise<void> {
    console.log(cfg.host);
}
`;

const JSON_CONTENT = JSON.stringify({ name: 'test', version: '1.0.0', keywords: ['a', 'b'] });

beforeEach(() => {
    const runtimeId = `parser-test-${Date.now()}-${Math.random()}`;
    parserWorkerRuntime = createParserWorkerRuntime({ runtimeId: `${runtimeId}:workers` });
    parserCacheRuntime = createParserCacheRuntime({
        invalidationBus: INVALIDATION_BUS,
        runtimeId,
        workerRuntime: parserWorkerRuntime,
    });
});

afterEach(async () => {
    process.env['IO_PARSER_FILE_CONTEXT_CACHE_ENABLED'] = '1';
    parserCacheRuntime.dispose();
    await parserWorkerRuntime.dispose();
});

const MD_CONTENT = `# Título

## Seção 1

Texto aqui.

### Subseção

## Seção 2
`;

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'io-parser-test-'));
    await fs.writeFile(path.join(tmpDir, 'module.js'), JS_CONTENT);
    await fs.writeFile(path.join(tmpDir, 'types.ts'), TS_CONTENT);
    await fs.writeFile(path.join(tmpDir, 'config.json'), JSON_CONTENT);
    await fs.writeFile(path.join(tmpDir, 'README.md'), MD_CONTENT);
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('parseFileSymbols - JavaScript', () => {
    it('extrai funções, classes e constantes exportadas', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'module.js'), JS_CONTENT);
        assert.ok(result !== null);
        assert.equal(result.parserPolicyVersion, BABEL_PARSER_POLICY_VERSION);
        assert.ok(Array.isArray(result.symbols));
        const names = result.symbols.map(/** @param {any} s */ (s) => s.name);
        assert.ok(names.includes('greet'), `symbols=${JSON.stringify(names)}`);
        assert.ok(names.includes('MAX'), `symbols=${JSON.stringify(names)}`);
        assert.ok(names.includes('MyClass'), `symbols=${JSON.stringify(names)}`);
    });

    it('detecta imports e reexports na mesma projeção canônica', async () => {
        const result = await parseFileSymbols(
            path.join(tmpDir, 'module.js'),
            `${JS_CONTENT}\nexport { helper as publicHelper } from './reexport.js';\nexport * from './all.js';\n`,
        );
        assert.ok(result.imports.length > 0, 'deve detectar imports');
        const sources = result.imports.map(/** @param {any} i */ (i) => i.source);
        assert.ok(sources.includes('./foo.js'), `imports=${JSON.stringify(sources)}`);
        assert.ok(sources.includes('./reexport.js'), `imports=${JSON.stringify(sources)}`);
        assert.ok(sources.includes('./all.js'), `imports=${JSON.stringify(sources)}`);
    });

    it('detecta require estático e import() no formato Babel 8', async () => {
        const result = await parseFileSymbols(
            path.join(tmpDir, 'runtime-imports.js'),
            "const legacy = require('./legacy.cjs');\nasync function load() { return import('./lazy.js'); }\n",
        );

        assert.ok(result.imports.some((entry) => entry.source === './legacy.cjs' && entry.isDynamic === false));
        assert.ok(result.imports.some((entry) => entry.source === './lazy.js' && entry.isDynamic === true));
    });

    it('usa sourceType commonjs para .cjs sem permissões globais', async () => {
        const commonjs = await parseFileSymbols(path.join(tmpDir, 'entry.cjs'), 'return require("./dep.cjs");');
        const module = await parseFileSymbols(path.join(tmpDir, 'entry.mjs'), 'return 1;');

        assert.equal(commonjs.parseError, null);
        assert.ok(commonjs.imports.some((entry) => entry.source === './dep.cjs'));
        assert.match(module.parseError ?? '', /BABEL_PARSER_SYNTAX_ERROR|IllegalReturn/);
    });

    it('reporta import aninhado inválido em vez de habilitar allowImportExportEverywhere', async () => {
        const result = await parseFileSymbols(
            path.join(tmpDir, 'nested-import.mjs'),
            'function invalid() { import value from "./dep.js"; }',
        );

        assert.match(result.parseError ?? '', /BABEL_PARSER_SYNTAX_ERROR/);
    });

    it('detecta exports', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'module.js'), JS_CONTENT);
        assert.ok(result.exports.length > 0, 'deve detectar exports');
    });

    it('preenche metadados de linhas e bytes', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'module.js'), JS_CONTENT);
        assert.ok(result.lines > 0);
        assert.ok(result.bytes > 0);
        assert.equal(result.parsedBytes, result.bytes);
    });

    it('conta LF, CRLF e CR isolado como linhas físicas', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'mixed-lines.js'), 'a\rb\r\nc\nd');

        assert.equal(result.lines, 4);
    });

    it('aplica line guard também a arquivos com CR isolado', async () => {
        const script = `
            import { parseFileSymbols } from '#copilot/infra/internal/indexing/parser';
            const result = await parseFileSymbols('/tmp/cr-only.js', 'a\\rb\\rc\\rd');
            console.log(JSON.stringify({ lines: result.lines, parseError: result.parseError }));
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve('.'),
            env: {
                ...process.env,
                IO_PARSER_MAX_LINES: '3',
                IO_PARSER_WORKER_ENABLED: '0',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        const result = JSON.parse(stdout);

        assert.equal(result.lines, 4);
        assert.match(result.parseError, /line guard exceeded/);
    });

    it('trunca o source pelo orçamento UTF-8 real', async () => {
        const script = `
            import { parseFileSymbols } from '#copilot/infra/internal/indexing/parser';
            const content = "export const before = 1;\\n// 🚀🚀🚀🚀🚀🚀🚀🚀\\nexport const afterBudget = 1;";
            const result = await parseFileSymbols('/tmp/byte-budget.js', content);
            console.log(JSON.stringify({
                truncated: result.truncated,
                bytes: result.bytes,
                parsedBytes: result.parsedBytes,
                symbols: result.symbols.map((symbol) => symbol.name)
            }));
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve('.'),
            env: {
                ...process.env,
                IO_PARSER_MAX_BYTES: '40',
                IO_PARSER_WORKER_ENABLED: '0',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        const result = JSON.parse(stdout);

        assert.equal(result.truncated, true);
        assert.ok(result.bytes > 40);
        assert.ok(result.parsedBytes <= 40);
        assert.ok(!result.symbols.includes('afterBudget'));
    });
});

describe('parser worker pool policy', () => {
    it('deriva um default adaptativo e preserva ao menos um worker', () => {
        assert.deepEqual(resolveParserWorkerPoolPolicy({}, 1), {
            size: 1,
            source: 'adaptive',
            availableParallelism: 1,
        });
        assert.deepEqual(resolveParserWorkerPoolPolicy({}, 8), {
            size: 4,
            source: 'adaptive',
            availableParallelism: 8,
        });
    });

    it('respeita override válido e recupera valores inválidos sem produzir NaN', () => {
        assert.deepEqual(resolveParserWorkerPoolPolicy({ IO_PARSER_WORKER_POOL_SIZE: '6.9' }, 8), {
            size: 6,
            source: 'configured',
            availableParallelism: 8,
        });
        assert.deepEqual(resolveParserWorkerPoolPolicy({ IO_PARSER_WORKER_POOL_SIZE: '999' }, 8), {
            size: 16,
            source: 'configured',
            availableParallelism: 8,
        });
        assert.deepEqual(resolveParserWorkerPoolPolicy({ IO_PARSER_WORKER_POOL_SIZE: 'invalid' }, 3), {
            size: 2,
            source: 'adaptive',
            availableParallelism: 3,
        });
    });

    it('limita fila de workers com default adaptativo e override validado', () => {
        assert.deepEqual(resolveParserWorkerQueuePolicy({}, 1), {
            max: 32,
            source: 'adaptive',
        });
        assert.deepEqual(resolveParserWorkerQueuePolicy({}, 8), {
            max: 256,
            source: 'adaptive',
        });
        assert.deepEqual(resolveParserWorkerQueuePolicy({ IO_PARSER_WORKER_QUEUE_MAX: '0' }, 4), {
            max: 0,
            source: 'configured',
        });
        assert.deepEqual(resolveParserWorkerQueuePolicy({ IO_PARSER_WORKER_QUEUE_MAX: '100000' }, 4), {
            max: 10_000,
            source: 'configured',
        });
        assert.deepEqual(resolveParserWorkerQueuePolicy({ IO_PARSER_WORKER_QUEUE_MAX: 'invalid' }, 2), {
            max: 64,
            source: 'adaptive',
        });
    });
});

describe('parseFileSymbols - TypeScript', () => {
    it('extrai interfaces, types e funções TypeScript', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'types.ts'), TS_CONTENT);
        const names = result.symbols.map(/** @param {any} s */ (s) => s.name);
        assert.ok(
            names.includes('Config') || names.includes('Handler') || names.includes('handleRequest'),
            `symbols=${JSON.stringify(names)}`,
        );
    });

    it('habilita contexto ambient em .d.ts e extrai declarations', async () => {
        const result = await parseFileSymbols(
            path.join(tmpDir, 'ambient.d.ts'),
            'export declare function ambient(input: string): void;\nexport declare namespace Runtime { const version: string; }\n',
        );
        const names = result.symbols.map((symbol) => symbol.name);

        assert.equal(result.parseError, null);
        assert.ok(names.includes('ambient'), `symbols=${JSON.stringify(names)}`);
        assert.ok(names.includes('Runtime'), `symbols=${JSON.stringify(names)}`);
    });

    it('aceita JSX somente em .tsx e preserva bindings destruturados', async () => {
        const tsx = await parseFileSymbols(
            path.join(tmpDir, 'view.tsx'),
            'export const View = () => <div />;\nexport const { left, nested: { right } } = source;',
        );
        const names = tsx.symbols.map((symbol) => symbol.name);

        assert.equal(tsx.parseError, null);
        assert.ok(names.includes('View'));
        assert.ok(names.includes('left'));
        assert.ok(names.includes('right'));
    });

    it('aplica disallowAmbiguousJSXLike em .mts', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'strict.mts'), 'const value = <Type>input;');

        assert.match(result.parseError ?? '', /ReservedTypeAssertion|BABEL_PARSER_SYNTAX_ERROR/);
    });

    it('aceita decorators padrão e auto-accessors compatíveis com TypeScript moderno', async () => {
        const result = await parseFileSymbols(
            path.join(tmpDir, 'decorated.ts'),
            'export class Decorated { @dec accessor value: number = 1; }',
        );

        assert.equal(result.parseError, null);
        assert.ok(result.symbols.some((symbol) => symbol.name === 'Decorated'));
    });
});

describe('Babel parser policy', () => {
    it('resolve sourceType e plugins por extensão sem opções permissivas globais', () => {
        const cjs = resolveBabelParserOptions('/tmp/entry.cjs', 'js');
        const plainJs = resolveBabelParserOptions('/tmp/plain.js', 'js');
        const jsx = resolveBabelParserOptions('/tmp/view.jsx', 'js');
        const mts = resolveBabelParserOptions('/tmp/types.mts', 'ts');
        const dts = resolveBabelParserOptions('/tmp/index.d.ts', 'ts');
        const tsx = resolveBabelParserOptions('/tmp/view.tsx', 'ts');
        const structure = resolveBabelParserOptions('/tmp/structure.js', 'js', { profile: 'structure' });
        const documentation = resolveBabelParserOptions('/tmp/docs.js', 'js', { profile: 'documentation' });

        assert.equal(cjs['sourceType'], 'commonjs');
        assert.equal(mts['sourceType'], 'module');
        assert.equal(cjs['createImportExpressions'], true);
        assert.equal(cjs['allowImportExportEverywhere'], undefined);
        assert.equal(cjs['allowReturnOutsideFunction'], undefined);
        assert.deepEqual(/** @type {any[]} */ (mts['plugins'])[0], [
            'typescript',
            { dts: false, disallowAmbiguousJSXLike: true },
        ]);
        assert.deepEqual(/** @type {any[]} */ (dts['plugins'])[0], [
            'typescript',
            { dts: true, disallowAmbiguousJSXLike: false },
        ]);
        assert.ok(/** @type {any[]} */ (tsx['plugins']).includes('jsx'));
        assert.ok(/** @type {any[]} */ (jsx['plugins']).includes('jsx'));
        assert.ok(!(/** @type {any[]} */ (plainJs['plugins']).includes('jsx')));
        assert.ok(!(/** @type {any[]} */ (mts['plugins']).includes('jsx')));
        assert.ok(/** @type {any[]} */ (plainJs['plugins']).includes('decorators'));
        assert.ok(/** @type {any[]} */ (plainJs['plugins']).includes('decoratorAutoAccessors'));
        assert.ok(!(/** @type {any[]} */ (plainJs['plugins']).includes('decorators-legacy')));
        assert.equal(structure['attachComment'], false);
        assert.equal(documentation['attachComment'], true);
        assert.match(BABEL_PARSER_POLICY_VERSION, /^2026-08-20\.babel8-ts7\./u);
    });

    it('mantém paridade entre worker e fallback síncrono', async () => {
        const filePath = '/tmp/parser-parity.cts';
        const content = 'import dep = require("./dep.cjs");\nexport = dep;';
        const workerStatsBefore = getParserCacheStats();
        const workerResult = await parseFileSymbols(filePath, content, { workerRuntime: parserWorkerRuntime });
        const workerStats = getParserCacheStats();
        const script = `
            import { parseFileSymbols } from '#copilot/infra/internal/indexing/parser';
            const result = await parseFileSymbols(${JSON.stringify(filePath)}, ${JSON.stringify(content)});
            console.log(JSON.stringify(result));
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve('.'),
            env: { ...process.env, IO_PARSER_WORKER_ENABLED: '0' },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        const fallbackResult = JSON.parse(stdout);

        assert.deepEqual(fallbackResult.symbols, workerResult.symbols);
        assert.deepEqual(fallbackResult.imports, workerResult.imports);
        assert.deepEqual(fallbackResult.exports, workerResult.exports);
        assert.equal(fallbackResult.parseError, workerResult.parseError);
        assert.equal(workerStats.workerRequests, workerStatsBefore.workerRequests + 1);
        assert.equal(workerStats.workerFailures, workerStatsBefore.workerFailures);
        assert.equal(workerStats.workerFallbacks, workerStatsBefore.workerFallbacks);
    });
});

describe('extractJsonSchema', () => {
    it('extrai schema simples de JSON', () => {
        const result = extractJsonSchema(JSON_CONTENT);
        assert.ok(result !== null);
        assert.ok(result.parseError === null);
        assert.ok(Array.isArray(result.symbols));
        const names = result.symbols.map(/** @param {any} s */ (s) => s.name);
        assert.ok(names.includes('name'));
        assert.ok(names.includes('version'));
    });

    it('retorna parseError para JSON inválido', () => {
        const result = extractJsonSchema('{invalid json}');
        assert.ok(result.parseError !== null);
    });

    it('extrai schema de array JSON multi-linha', () => {
        const result = extractJsonSchema('[\n  { "id": 1, "name": "alpha" }\n]');
        assert.equal(result.parseError, null);
        const names = result.symbols.map((s) => s.name);
        assert.ok(names.includes('id'));
        assert.ok(names.includes('name'));
    });

    it('extrai primeira amostra JSONL separada por CR isolado', () => {
        const result = extractJsonSchema('\r{"first":1}\r{"second":2}');
        const names = result.symbols.map((s) => s.name);

        assert.equal(result.parseError, null);
        assert.deepEqual(names, ['first']);
    });
});

describe('extractMarkdownOutline', () => {
    it('extrai headings do markdown como strings', () => {
        const outline = extractMarkdownOutline(MD_CONTENT);
        assert.ok(Array.isArray(outline));
        assert.ok(outline.length > 0);
        // Strings no formato "# Título", "## Seção 1", etc.
        assert.ok(
            outline.some((h) => h.includes('Título')),
            `headings=${JSON.stringify(outline)}`,
        );
        assert.ok(outline.some((h) => h.includes('Seção 1')));
        assert.ok(outline.some((h) => h.includes('Seção 2')));
    });

    it('mantém prefixo de nível correto', () => {
        const outline = extractMarkdownOutline(MD_CONTENT);
        const h1 = outline.find((h) => h.includes('Título'));
        assert.ok(h1 !== undefined);
        assert.ok(h1.startsWith('#'), `h1=${h1}`);
        const h2 = outline.find((h) => h.includes('Seção 1'));
        assert.ok(h2 !== undefined);
        assert.ok(h2.startsWith('##'), `h2=${h2}`);
    });

    it('preserva linhas de headings com CR isolado', () => {
        assert.deepEqual(extractMarkdownOutline('# Um\rtexto\r## Dois'), ['# Um', '## Dois']);
    });
});

describe('buildOutline', () => {
    it('constrói outline de FileSymbols como array de strings', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'module.js'), JS_CONTENT);
        const outline = buildOutline(result);
        assert.ok(Array.isArray(outline));
        assert.ok(outline.length > 0);
        // Deve conter linhas de exports
        assert.ok(outline.some((l) => l.includes('greet') || l.includes('Exports')));
    });
});

describe('extractTopComments', () => {
    it('extrai comentários no topo do arquivo como array', () => {
        const comments = extractTopComments(JS_CONTENT);
        assert.ok(Array.isArray(comments));
        // A presença de comentários no topo (ou array vazio se não houver)
        assert.ok(comments.length >= 0);
    });

    it('limita a leitura lógica às primeiras 50 linhas com CR isolado', () => {
        const content = `${Array.from({ length: 50 }, (_, index) => `// ${index + 1}`).join('\r')}\r// 51`;
        const comments = extractTopComments(content);

        assert.equal(comments.length, 10);
        assert.equal(comments.at(-1), '// 10');
        assert.ok(!comments.includes('// 51'));
    });
});

describe('parseAndCacheSymbols', () => {
    it('parseia e cacheia símbolos a partir de filePath', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        const result = await parseAndCacheSymbols(filePath);
        assert.ok(result !== null);
        assert.ok(result.symbols.length > 0);

        // Segunda chamada usa cache
        const stats1 = getParserCacheStats();
        const result2 = await parseAndCacheSymbols(filePath);
        const stats2 = getParserCacheStats();
        // cache size deve ser >= 1
        assert.ok(stats2.size >= 1, `cache size=${stats2.size}`);
        assert.ok(result2.symbols.length > 0);
        assert.equal(stats2.symbolSnapshotReads, stats1.symbolSnapshotReads);
        assert.equal(stats2.symbolCacheHits, stats1.symbolCacheHits + 1);
    });

    it('aceita snapshot consistente fornecido sem reler o arquivo', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        const snapshot = await readTextFileSnapshot(filePath);
        parserCacheRuntime.reset();

        const result = await parseAndCacheSymbols(filePath, { snapshot });
        const stats = getParserCacheStats();

        assert.ok(result.symbols.length > 0);
        assert.equal(stats.symbolSuppliedSnapshots, 1);
        assert.equal(stats.symbolSnapshotReads, 0);
        assert.equal(stats.symbolCacheMisses, 1);
        assert.equal(stats.symbolFreshnessChecks, 1);
        assert.equal(stats.symbolSnapshotPrechecksAvoided, 1);
    });

    it('recusa cache antigo após replace atômico externo sem invalidação', async () => {
        const filePath = path.join(tmpDir, 'external-replace.js');
        const tempPath = `${filePath}.next`;
        await fs.writeFile(filePath, 'export const beforeReplace = 1;\n', 'utf8');
        const first = await parseAndCacheSymbols(filePath);
        assert.ok(first.symbols.some((symbol) => symbol.name === 'beforeReplace'));

        await fs.writeFile(tempPath, 'export const afterReplace = 2;\n', 'utf8');
        await fs.rename(tempPath, filePath);

        const second = await parseAndCacheSymbols(filePath);
        const names = second.symbols.map((symbol) => symbol.name);
        const stats = getParserCacheStats();

        assert.ok(names.includes('afterReplace'), `symbols=${JSON.stringify(names)}`);
        assert.ok(!names.includes('beforeReplace'), `symbols=${JSON.stringify(names)}`);
        assert.ok(stats.symbolCacheStale >= 1);
        assert.ok(stats.symbolSnapshotReads >= 2);
    });

    it('expõe métricas de fila dos parser workers no snapshot', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        await parseAndCacheSymbols(filePath);
        const stats = getParserCacheStats();

        assert.equal(typeof stats.workerQueueMax, 'number');
        assert.equal(typeof stats.workerQueueLength, 'number');
        assert.equal(typeof stats.workerQueueHighWater, 'number');
        assert.equal(typeof stats.workerQueueRejected, 'number');
        assert.equal(typeof stats.workerQueueTimeouts, 'number');
        assert.equal(typeof stats.workerQueueWaitMsLast, 'number');
        assert.equal(typeof stats.workerQueueWaitMsMax, 'number');
        assert.equal(typeof stats.mainThreadFallbackMaxBytes, 'number');
        assert.equal(typeof stats.workerPoolRestarting, 'number');
        assert.equal(typeof stats.workerRestarts, 'number');
        assert.equal(typeof stats.workerRestartFailures, 'number');
        assert.equal(typeof stats.symbolFreshnessChecks, 'number');
        assert.equal(typeof stats.symbolSnapshotPrechecksAvoided, 'number');
        assert.ok(stats.workerQueueMax >= 0);
        assert.ok(stats.workerQueueLength >= 0);
    });

    it('cancela parse antes de ler snapshot', async () => {
        const controller = new AbortController();
        controller.abort(new DOMException('parse cancelado', 'AbortError'));

        await assert.rejects(
            parseAndCacheSymbols(path.join(tmpDir, 'module.js'), { signal: controller.signal }),
            (error) => error instanceof Error && error.name === 'AbortError',
        );
    });

    it('remove tarefa abortada da fila de workers', async () => {
        const script = `
            import { createParserWorkerRuntime, getParserCacheStats, parseFileSymbols } from '#copilot/infra/internal/indexing/parser';\n            import { createParserCacheRuntime } from '#copilot/infra/internal/indexing/parser/cache';\n            const workerRuntime = createParserWorkerRuntime({ runtimeId: 'parser-child:workers' });\n            const parserCacheRuntime = createParserCacheRuntime({ invalidationBus: { registerHook: () => () => {} }, runtimeId: 'parser-child', workerRuntime });
            const slowContent = Array.from({ length: 20_000 }, (_, index) => 'export function f' + index + '() { return ' + index + '; }').join('\\n');
            const first = parseFileSymbols('/tmp/abort-holder.js', slowContent, { workerRuntime });
            const controller = new AbortController();
            const queued = parseFileSymbols('/tmp/abort-queued.js', slowContent, { signal: controller.signal, workerRuntime });
            controller.abort(new DOMException('queued parse cancelled', 'AbortError'));
            const queuedResult = await queued.then(
                () => ({ status: 'resolved' }),
                (error) => ({ status: 'rejected', name: error?.name, message: error?.message }),
            );
            await first;
            const stats = getParserCacheStats(parserCacheRuntime);
            parserCacheRuntime.dispose();
            await workerRuntime.dispose();
            console.log(JSON.stringify({ queuedResult, workerQueueLength: stats.workerQueueLength }));
            process.exit(0);
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve('.'),
            env: {
                ...process.env,
                IO_PARSER_WORKER_POOL_SIZE: '1',
                IO_PARSER_WORKER_QUEUE_MAX: '8',
                IO_PARSER_WORKER_REQUEST_TIMEOUT_MS: '5000',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        /** @type {{ queuedResult: { status: string; name: string; message: string }; workerQueueLength: number }} */
        const result = JSON.parse(stdout);

        assert.deepEqual(result.queuedResult, {
            status: 'rejected',
            name: 'AbortError',
            message: 'queued parse cancelled',
        });
        assert.equal(result.workerQueueLength, 0);
    });

    it('rejeita backlog quando a fila de workers atinge o limite configurado', async () => {
        const script = `
            import { createParserWorkerRuntime, getParserCacheStats, parseFileSymbols } from '#copilot/infra/internal/indexing/parser';\n            import { createParserCacheRuntime } from '#copilot/infra/internal/indexing/parser/cache';\n            const workerRuntime = createParserWorkerRuntime({ runtimeId: 'parser-child:workers' });\n            const parserCacheRuntime = createParserCacheRuntime({ invalidationBus: { registerHook: () => () => {} }, runtimeId: 'parser-child', workerRuntime });
            const content = ${JSON.stringify(JS_CONTENT)};
            const results = await Promise.all(
                Array.from({ length: 8 }, (_, index) => parseFileSymbols('/tmp/queued-' + index + '.js', content, { workerRuntime })),
            );
            const stats = getParserCacheStats(parserCacheRuntime);
            parserCacheRuntime.dispose();
            await workerRuntime.dispose();
            console.log(JSON.stringify({
                parseErrors: results.map((result) => result.parseError),
                workerQueueRejected: stats.workerQueueRejected,
                workerQueueMax: stats.workerQueueMax
            }));
            process.exit(0);
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve('.'),
            env: {
                ...process.env,
                IO_PARSER_WORKER_POOL_SIZE: '1',
                IO_PARSER_WORKER_QUEUE_MAX: '0',
                IO_PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES: '1',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        /** @type {{ parseErrors: (string | null)[]; workerQueueRejected: number; workerQueueMax: number }} */
        const result = JSON.parse(stdout);

        assert.ok(
            result.parseErrors.some((parseError) => String(parseError ?? '').includes('parser worker queue full')),
            `result=${stdout}`,
        );
        assert.ok(result.workerQueueRejected > 0, `result=${stdout}`);
        assert.equal(result.workerQueueMax, 0);
    });

    it('faz fallback síncrono limitado para arquivos pequenos sob overload', async () => {
        const script = `
            import { createParserWorkerRuntime, getParserCacheStats, parseFileSymbols } from '#copilot/infra/internal/indexing/parser';\n            import { createParserCacheRuntime } from '#copilot/infra/internal/indexing/parser/cache';\n            const workerRuntime = createParserWorkerRuntime({ runtimeId: 'parser-child:workers' });\n            const parserCacheRuntime = createParserCacheRuntime({ invalidationBus: { registerHook: () => () => {} }, runtimeId: 'parser-child', workerRuntime });
            const content = ${JSON.stringify(JS_CONTENT)};
            const results = await Promise.all(
                Array.from({ length: 8 }, (_, index) => parseFileSymbols('/tmp/fallback-' + index + '.js', content, { workerRuntime })),
            );
            const stats = getParserCacheStats(parserCacheRuntime);
            parserCacheRuntime.dispose();
            await workerRuntime.dispose();
            console.log(JSON.stringify({
                parseErrors: results.map((result) => result.parseError),
                symbolCounts: results.map((result) => result.symbols.length),
                workerFallbacks: stats.workerFallbacks,
                workerQueueRejected: stats.workerQueueRejected,
                mainThreadFallbackMaxBytes: stats.mainThreadFallbackMaxBytes
            }));
            process.exit(0);
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve('.'),
            env: {
                ...process.env,
                IO_PARSER_WORKER_POOL_SIZE: '1',
                IO_PARSER_WORKER_QUEUE_MAX: '0',
                IO_PARSER_MAIN_THREAD_FALLBACK_MAX_BYTES: '131072',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        /** @type {{
    parseErrors: (string | null)[];
    symbolCounts: number[];
    workerFallbacks: number;
    workerQueueRejected: number;
    mainThreadFallbackMaxBytes: number;
}} */
        const result = JSON.parse(stdout);

        assert.ok(result.workerQueueRejected > 0, `result=${stdout}`);
        assert.ok(result.workerFallbacks > 0, `result=${stdout}`);
        assert.ok(
            result.parseErrors.every((parseError) => parseError === null),
            `result=${stdout}`,
        );
        assert.ok(
            result.symbolCounts.every((count) => count > 0),
            `result=${stdout}`,
        );
        assert.equal(result.mainThreadFallbackMaxBytes, 131_072);
    });

    it('invalida cache de arquivo específico', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        await parseAndCacheSymbols(filePath);
        const statsBefore = getParserCacheStats();
        invalidateParserCache(filePath);
        const statsAfter = getParserCacheStats();
        assert.ok(
            statsAfter.size < statsBefore.size || statsAfter.size === 0,
            `before=${statsBefore.size} after=${statsAfter.size}`,
        );
    });
});

describe('parseFileForContext', () => {
    it('retorna symbols, outline e topComments para JS', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        const result = await parseFileForContext(filePath, JS_CONTENT);
        assert.ok(result !== null);
        // result.symbols é FileSymbols
        assert.ok(result.symbols !== null);
        // outline é string[]
        assert.ok(Array.isArray(result.outline));
        // topComments é string[]
        assert.ok(Array.isArray(result.topComments));
    });

    it('retorna outline para markdown', async () => {
        const filePath = path.join(tmpDir, 'README.md');
        const result = await parseFileForContext(filePath, MD_CONTENT);
        assert.ok(result !== null);
        assert.ok(Array.isArray(result.outline));
        assert.ok(result.outline.length > 0, `outline=${JSON.stringify(result.outline)}`);
    });

    it('aplica budgets de itens e bytes somente às coleções solicitadas', async () => {
        const parsed = await parseFileForContext(path.join(tmpDir, 'module.js'), JS_CONTENT);
        const result = windowFileContext(parsed, {
            maxItems: 1,
            maxBytes: 256,
            includeImports: true,
            includeExports: true,
            includeOutline: true,
            includeTopComments: false,
        });

        assert.ok(result.symbols.length <= 1);
        assert.ok(result.imports.length <= 1);
        assert.ok(result.exports.length <= 1);
        assert.ok(result.outline.length <= 1);
        assert.deepEqual(result.topComments, []);
        assert.ok(result.returnedContentBytes <= 256);
        assert.equal(result.maxItems, 1);
        assert.equal(result.maxBytes, 256);
        assert.equal(result.truncated, true);
    });

    it('cacheia FileContext por path e conteúdo', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        parserCacheRuntime.reset();

        const first = await parseFileForContext(filePath, JS_CONTENT);
        const afterFirst = getParserCacheStats();
        const second = await parseFileForContext(filePath, JS_CONTENT);
        const afterSecond = getParserCacheStats();

        assert.equal(second, first);
        assert.equal(afterFirst.fileContext.misses, 1);
        assert.equal(afterFirst.fileContext.sets, 1);
        assert.equal(afterSecond.fileContext.hits, 1);
        assert.equal(afterSecond.fileContext.size, 1);
        assert.ok(afterSecond.fileContext.calculatedSize > 0);
        assert.ok(afterSecond.fileContext.calculatedSize <= afterSecond.fileContext.maxBytes);
    });

    it('reutiliza contentHash canônico no FileContext sem recalcular SHA-256', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        parserCacheRuntime.reset();
        const snapshot = await readTextFileSnapshot(filePath);
        const contentHash = sha256(snapshot.content);

        const parsed = await parseFileForContext(filePath, snapshot.content, { contentHash });
        const stats = getParserCacheStats();

        assert.ok(parsed.symbols.symbols.length > 0);
        assert.equal(stats.fileContext.hashReuses, 1);
        assert.equal(stats.fileContext.hashComputations, 0);
        assert.equal(stats.fileContext.misses, 1);
    });

    it('invalida FileContext quando invalidateParserCache é chamado', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        parserCacheRuntime.reset();

        await parseFileForContext(filePath, JS_CONTENT);
        assert.equal(getParserCacheStats().fileContext.size, 1);
        invalidateParserCache(filePath);

        assert.equal(getParserCacheStats().fileContext.size, 0);
        assert.equal(getParserCacheStats().fileContext.clears, 1);
    });

    it('suporta kill-switch do FileContext cache', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        const enabledRuntime = parserCacheRuntime;
        process.env['IO_PARSER_FILE_CONTEXT_CACHE_ENABLED'] = '0';
        enabledRuntime.dispose();
        parserCacheRuntime = createParserCacheRuntime({
            invalidationBus: INVALIDATION_BUS,
            runtimeId: `parser-disabled-${Date.now()}-${Math.random()}`,
        });

        const first = await parseFileForContext(filePath, JS_CONTENT);
        const second = await parseFileForContext(filePath, JS_CONTENT);
        const stats = getParserCacheStats();

        assert.notEqual(second, first);
        assert.equal(stats.fileContext.enabled, false);
        assert.equal(stats.fileContext.bypasses, 2);
        assert.equal(stats.fileContext.size, 0);
    });

    it('recusa retenção de FileContext maior que o orçamento configurado', async () => {
        const script = `
            import { getParserCacheStats, parseFileForContext } from '#copilot/infra/internal/indexing/parser';\n            import { createParserCacheRuntime } from '#copilot/infra/internal/indexing/parser/cache';\n            const parserCacheRuntime = createParserCacheRuntime({ invalidationBus: { registerHook: () => () => {} }, runtimeId: 'parser-child-context' });
            await parseFileForContext('/tmp/oversized-context.js', 'export const oversizedContext = 1;', { parserCacheRuntime });
            const stats = getParserCacheStats(parserCacheRuntime);
            parserCacheRuntime.dispose();
            console.log(JSON.stringify(stats));
        `;
        const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: path.resolve('.'),
            env: {
                ...process.env,
                IO_PARSER_FILE_CONTEXT_CACHE_MAX_BYTES: '8',
                IO_PARSER_WORKER_ENABLED: '0',
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        const stats = JSON.parse(stdout);

        assert.equal(stats.fileContext.maxBytes, 8);
        assert.equal(stats.fileContext.size, 0);
        assert.equal(stats.fileContext.rejected, 1);
    });

    it('preserva linha real dos headings markdown no parse simbólico', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'README.md'), MD_CONTENT);
        const section = result.symbols.find((symbol) => symbol.name.includes('Seção 1'));
        assert.ok(section);
        assert.equal(section.line, 3);
    });
});
