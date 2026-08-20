// @ts-check
/**
 * tests/unit/copilot/terminal/test_file_context.spec.js
 *
 * F183: Testes para file-context.js — funções puras de detecção, extração e embedding.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { invalidateIoCachePath } from '../../../../src/copilot/infra/public/cache.js';
import {
    attachmentToEmbed,
    clearFileCache,
    detectLang,
    embedContextBlock,
    embedMultiple,
    extractAtReferences,
    getFileCacheStats,
    readDirectoryContextDetailed,
    readFileContext,
} from '../../../../src/copilot/presentation/files/context.js';

describe('file-context detectLang', () => {
    it('mapeia .js para js', () => expect(detectLang('foo.js')).toBe('js'));
    it('mapeia .ts para ts', () => expect(detectLang('bar.ts')).toBe('ts'));
    it('mapeia .py para python', () => expect(detectLang('script.py')).toBe('python'));
    it('mapeia .json para json', () => expect(detectLang('config.json')).toBe('json'));
    it('mapeia .sh para bash', () => expect(detectLang('run.sh')).toBe('bash'));
    it('mapeia .md para md', () => expect(detectLang('README.md')).toBe('md'));
    it('extensão desconhecida retorna text', () => expect(detectLang('data.xyz')).toBe('text'));
    it('sem extensão retorna text', () => expect(detectLang('Makefile')).toBe('text'));
});

describe('file-context extractAtReferences', () => {
    it('extrai @path simples', () => {
        const { paths, strippedMessage } = extractAtReferences('veja @src/main.js e continue');
        expect(paths).toEqual(['src/main.js']);
        expect(strippedMessage).toContain('veja');
        expect(strippedMessage).not.toContain('@src');
    });

    it('extrai @"path com espaço"', () => {
        const { paths } = extractAtReferences('arquivo @"meu diretório/file.js" aqui');
        expect(paths).toEqual(['meu diretório/file.js']);
    });

    it('múltiplas referências', () => {
        const { paths } = extractAtReferences('@src/a.js e @src/b.ts');
        expect(paths.length).toBe(2);
    });

    it('ignora emails (@user@domain.com)', () => {
        const { paths, strippedMessage } = extractAtReferences('contato @user@host.com e @src/file.js');
        // T-11: rejeita patterns que parecem emails/domínios
        expect(paths).toEqual(['src/file.js']);
        expect(strippedMessage).toContain('@user@host.com');
    });

    it('ignora menções simples que não parecem path', () => {
        const { paths, strippedMessage } = extractAtReferences('fale com @alice e leia @config.json');
        expect(paths).toEqual(['config.json']);
        expect(strippedMessage).toContain('@alice');
        expect(strippedMessage).not.toContain('@config.json');
    });

    it('retorna vazio se sem referências', () => {
        const { paths } = extractAtReferences('mensagem normal sem @');
        expect(paths.length).toBe(0);
    });
});

describe('file-context embedContextBlock', () => {
    it('prepende bloco markdown à mensagem', () => {
        /** @type {import('../../../../src/copilot/presentation/files/context.js').FileContext} */
        const ctx = { path: 'test.js', content: 'const x = 1;', size: 12, lang: 'js' };
        const result = embedContextBlock(ctx, 'analisar este código');
        expect(result).toContain('```js');
        expect(result).toContain('const x = 1;');
        expect(result).toContain('analisar este código');
    });
});

describe('file-context embedMultiple', () => {
    it('embute múltiplos arquivos em ordem', () => {
        const ctxs = [
            { path: 'a.js', content: 'a', size: 1, lang: 'js' },
            { path: 'b.ts', content: 'b', size: 1, lang: 'ts' },
        ];
        const result = embedMultiple(ctxs, 'msg');
        expect(result).toContain('a.js');
        expect(result).toContain('b.ts');
        expect(result.endsWith('msg')).toBe(true);
    });

    it('mantém arquivos grandes porque MAX_EMBED_BYTES é apenas informativo', () => {
        const bigCtx = { path: 'big.js', content: 'x'.repeat(70_000), size: 70_000, lang: 'js' };
        const result = embedMultiple([bigCtx], 'msg');
        expect(result).toContain('big.js');
        expect(result).toContain('x'.repeat(1_000));
        expect(result.endsWith('msg')).toBe(true);
    });

    it('retorna apenas mensagem se lista vazia', () => {
        expect(embedMultiple([], 'msg')).toBe('msg');
    });
});

describe('file-context readFileContext + cache', () => {
    beforeEach(() => {
        clearFileCache();
    });

    it('lê arquivo real e retorna contexto', async () => {
        const ctx = await readFileContext('package.json');
        expect(ctx.content).toContain('"name"');
        expect(ctx.lang).toBe('json');
        expect(ctx.size).toBeGreaterThan(0);
    });

    it('cache hit na segunda leitura', async () => {
        await readFileContext('package.json');
        const before = getFileCacheStats();
        await readFileContext('package.json');
        const after = getFileCacheStats();
        expect(after.hits).toBe(before.hits + 1);
    });

    it('invalida cache por path após mutação de IO', async () => {
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-file-context-cache-'));
        const filePath = join(tempDir, 'context.js');
        const relativePath = relative(process.cwd(), filePath);
        try {
            await writeFile(filePath, 'export const value = 1;\n');
            const first = await readFileContext(relativePath);
            expect(first.content).toContain('value = 1');

            await writeFile(filePath, 'export const value = 2;\n');
            invalidateIoCachePath(relativePath);

            const second = await readFileContext(relativePath);
            expect(second.content).toContain('value = 2');
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('mantém limite efetivo de entradas frescas no cache', async () => {
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-file-context-cache-limit-'));
        try {
            const maxEntries = getFileCacheStats().maxEntries;
            for (let index = 0; index < maxEntries + 5; index += 1) {
                const filePath = join(tempDir, `file-${index}.txt`);
                await writeFile(filePath, `file ${index}\n`);
                await readFileContext(relative(process.cwd(), filePath));
            }
            expect(getFileCacheStats().size).toBeLessThanOrEqual(maxEntries);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('limita contexto de diretório e informa truncamento no embed', async () => {
        const tempDir = await mkdtemp(join(process.cwd(), '.tmp-file-context-dir-limit-'));
        try {
            for (let index = 0; index < 55; index += 1) {
                await writeFile(join(tempDir, `file-${index}.txt`), `conteudo ${index}\n`);
            }

            const relativeDir = relative(process.cwd(), tempDir);
            const detailed = await readDirectoryContextDetailed(relativeDir, { maxFiles: 2 });
            expect(detailed.contexts).toHaveLength(2);
            expect(detailed.truncated).toBe(true);
            expect(detailed.maxFiles).toBe(2);

            const embedded = await attachmentToEmbed({ type: 'directory', path: relativeDir });
            expect(embedded).toContain('Contexto de diretório');
            expect(embedded).toContain('file-0.txt');
            expect(embedded).toContain('Diretório truncado');
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });
});
