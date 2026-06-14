// @ts-check
/**
 * Testes unitários para io-parser.js
 */

import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import {
    buildOutline,
    extractJsonSchema,
    extractMarkdownOutline,
    extractTopComments,
    getParserCacheStats,
    invalidateParserCache,
    parseAndCacheSymbols,
    parseFileForContext,
    parseFileSymbols,
    resetParserCacheForTest,
    resolveParserWorkerPoolPolicy,
    resolveParserWorkerQueuePolicy,
} from '../../../../src/copilot/infra/io-parser.js';

let tmpDir = '';
const IO_PARSER_MODULE_URL = pathToFileURL(path.resolve('src/copilot/infra/io-parser.js')).href;
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

afterEach(async () => {
    process.env['IO_PARSER_FILE_CONTEXT_CACHE_ENABLED'] = '1';
    await resetParserCacheForTest();
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
    await resetParserCacheForTest({ teardownWorkers: true });
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('parseFileSymbols - JavaScript', () => {
    it('extrai funções, classes e constantes exportadas', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'module.js'), JS_CONTENT);
        assert.ok(result !== null);
        assert.ok(Array.isArray(result.symbols));
        const names = result.symbols.map(/** @param {any} s */ (s) => s.name);
        assert.ok(names.includes('greet'), `symbols=${JSON.stringify(names)}`);
        assert.ok(names.includes('MAX'), `symbols=${JSON.stringify(names)}`);
        assert.ok(names.includes('MyClass'), `symbols=${JSON.stringify(names)}`);
    });

    it('detecta imports', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'module.js'), JS_CONTENT);
        assert.ok(result.imports.length > 0, 'deve detectar imports');
        const sources = result.imports.map(/** @param {any} i */ (i) => i.source);
        assert.ok(sources.includes('./foo.js'), `imports=${JSON.stringify(sources)}`);
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
            import { parseFileSymbols, resetParserCacheForTest } from ${JSON.stringify(IO_PARSER_MODULE_URL)};
            const result = await parseFileSymbols('/tmp/cr-only.js', 'a\\rb\\rc\\rd');
            await resetParserCacheForTest({ teardownWorkers: true });
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
            import { parseFileSymbols, resetParserCacheForTest } from ${JSON.stringify(IO_PARSER_MODULE_URL)};
            const content = "export const before = 1;\\n// 🚀🚀🚀🚀🚀🚀🚀🚀\\nexport const afterBudget = 1;";
            const result = await parseFileSymbols('/tmp/byte-budget.js', content);
            await resetParserCacheForTest({ teardownWorkers: true });
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
});

describe('parseAndCacheSymbols', () => {
    it('parseia e cacheia símbolos a partir de filePath', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        const result = await parseAndCacheSymbols(filePath);
        assert.ok(result !== null);
        assert.ok(result.symbols.length > 0);

        // Segunda chamada usa cache
        const stats1 = getParserCacheStats();
        const _result2 = await parseAndCacheSymbols(filePath);
        const stats2 = getParserCacheStats();
        // cache size deve ser >= 1
        assert.ok(stats2.size >= 1, `cache size=${stats2.size}`);
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
        assert.ok(stats.workerQueueMax >= 0);
        assert.ok(stats.workerQueueLength >= 0);
    });

    it('rejeita backlog quando a fila de workers atinge o limite configurado', async () => {
        const script = `
            import { getParserCacheStats, parseFileSymbols, resetParserCacheForTest } from ${JSON.stringify(IO_PARSER_MODULE_URL)};
            const content = ${JSON.stringify(JS_CONTENT)};
            const results = await Promise.all(
                Array.from({ length: 8 }, (_, index) => parseFileSymbols('/tmp/queued-' + index + '.js', content)),
            );
            const stats = getParserCacheStats();
            await resetParserCacheForTest({ teardownWorkers: true });
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
            },
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
        });
        const result = JSON.parse(stdout);

        assert.ok(
            result.parseErrors.some((parseError) => String(parseError ?? '').includes('parser worker queue full')),
            `result=${stdout}`,
        );
        assert.ok(result.workerQueueRejected > 0, `result=${stdout}`);
        assert.equal(result.workerQueueMax, 0);
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

    it('cacheia FileContext por path e conteúdo', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        await resetParserCacheForTest();

        const first = await parseFileForContext(filePath, JS_CONTENT);
        const afterFirst = getParserCacheStats();
        const second = await parseFileForContext(filePath, JS_CONTENT);
        const afterSecond = getParserCacheStats();

        assert.equal(second, first);
        assert.equal(afterFirst.fileContext.misses, 1);
        assert.equal(afterFirst.fileContext.sets, 1);
        assert.equal(afterSecond.fileContext.hits, 1);
        assert.equal(afterSecond.fileContext.size, 1);
    });

    it('invalida FileContext quando invalidateParserCache é chamado', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        await resetParserCacheForTest();

        await parseFileForContext(filePath, JS_CONTENT);
        assert.equal(getParserCacheStats().fileContext.size, 1);
        invalidateParserCache(filePath);

        assert.equal(getParserCacheStats().fileContext.size, 0);
        assert.equal(getParserCacheStats().fileContext.clears, 1);
    });

    it('suporta kill-switch do FileContext cache', async () => {
        const filePath = path.join(tmpDir, 'module.js');
        process.env['IO_PARSER_FILE_CONTEXT_CACHE_ENABLED'] = '0';
        await resetParserCacheForTest();

        const first = await parseFileForContext(filePath, JS_CONTENT);
        const second = await parseFileForContext(filePath, JS_CONTENT);
        const stats = getParserCacheStats();

        assert.notEqual(second, first);
        assert.equal(stats.fileContext.enabled, false);
        assert.equal(stats.fileContext.bypasses, 2);
        assert.equal(stats.fileContext.size, 0);
    });

    it('preserva linha real dos headings markdown no parse simbólico', async () => {
        const result = await parseFileSymbols(path.join(tmpDir, 'README.md'), MD_CONTENT);
        const section = result.symbols.find((symbol) => symbol.name.includes('Seção 1'));
        assert.ok(section);
        assert.equal(section.line, 3);
    });
});
