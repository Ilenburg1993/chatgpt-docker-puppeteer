// @ts-check
/**
 * tests/unit/copilot/terminal/test_file_context.spec.js
 *
 * F183: Testes para file-context.js — funções puras de detecção, extração e embedding.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearFileCache,
    detectLang,
    embedContextBlock,
    embedMultiple,
    extractAtReferences,
    getFileCacheStats,
    readFileContext,
} from '../../../../src/copilot/terminal/file-context.js';

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
        const { paths } = extractAtReferences('contato @user@host.com e @src/file.js');
        // T-11: rejeita patterns que parecem emails/domínios
        expect(paths).toContain('src/file.js');
    });

    it('retorna vazio se sem referências', () => {
        const { paths } = extractAtReferences('mensagem normal sem @');
        expect(paths.length).toBe(0);
    });
});

describe('file-context embedContextBlock', () => {
    it('prepende bloco markdown à mensagem', () => {
        /** @type {import('../../../../src/copilot/terminal/file-context.js').FileContext} */
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

    it('respeita MAX_EMBED_BYTES — trunca quando excede', () => {
        const bigCtx = { path: 'big.js', content: 'x'.repeat(70_000), size: 70_000, lang: 'js' };
        const result = embedMultiple([bigCtx], 'msg');
        // 70KB excede 64KB, então não deve incluir o arquivo
        expect(result).toBe('msg');
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
});
