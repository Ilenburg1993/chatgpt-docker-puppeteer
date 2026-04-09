// @ts-check
/**
 * tests/unit/copilot/terminal/test_file_context.spec.js
 *
 * F183: Testes para file-context.js — funções puras de detecção, extração e embedding.
 */

import assert from 'node:assert/strict';

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
    it('mapeia .js para js', () => assert.strictEqual(detectLang('foo.js'), 'js'));
    it('mapeia .ts para ts', () => assert.strictEqual(detectLang('bar.ts'), 'ts'));
    it('mapeia .py para python', () => assert.strictEqual(detectLang('script.py'), 'python'));
    it('mapeia .json para json', () => assert.strictEqual(detectLang('config.json'), 'json'));
    it('mapeia .sh para bash', () => assert.strictEqual(detectLang('run.sh'), 'bash'));
    it('mapeia .md para md', () => assert.strictEqual(detectLang('README.md'), 'md'));
    it('extensão desconhecida retorna text', () => assert.strictEqual(detectLang('data.xyz'), 'text'));
    it('sem extensão retorna text', () => assert.strictEqual(detectLang('Makefile'), 'text'));
});

describe('file-context extractAtReferences', () => {
    it('extrai @path simples', () => {
        const { paths, strippedMessage } = extractAtReferences('veja @src/main.js e continue');
        assert.deepStrictEqual(paths, ['src/main.js']);
        assert.ok(strippedMessage.includes('veja'));
        assert.ok(!strippedMessage.includes('@src'));
    });

    it('extrai @"path com espaço"', () => {
        const { paths } = extractAtReferences('arquivo @"meu diretório/file.js" aqui');
        assert.deepStrictEqual(paths, ['meu diretório/file.js']);
    });

    it('múltiplas referências', () => {
        const { paths } = extractAtReferences('@src/a.js e @src/b.ts');
        assert.strictEqual(paths.length, 2);
    });

    it('ignora emails (@user@domain.com)', () => {
        const { paths } = extractAtReferences('contato @user@host.com e @src/file.js');
        // T-11: rejeita patterns que parecem emails/domínios
        assert.ok(paths.includes('src/file.js'));
    });

    it('retorna vazio se sem referências', () => {
        const { paths } = extractAtReferences('mensagem normal sem @');
        assert.strictEqual(paths.length, 0);
    });
});

describe('file-context embedContextBlock', () => {
    it('prepende bloco markdown à mensagem', () => {
        /** @type {import('../../../../src/copilot/terminal/file-context.js').FileContext} */
        const ctx = { path: 'test.js', content: 'const x = 1;', size: 12, lang: 'js' };
        const result = embedContextBlock(ctx, 'analisar este código');
        assert.ok(result.includes('```js'));
        assert.ok(result.includes('const x = 1;'));
        assert.ok(result.includes('analisar este código'));
    });
});

describe('file-context embedMultiple', () => {
    it('embute múltiplos arquivos em ordem', () => {
        const ctxs = [
            { path: 'a.js', content: 'a', size: 1, lang: 'js' },
            { path: 'b.ts', content: 'b', size: 1, lang: 'ts' },
        ];
        const result = embedMultiple(ctxs, 'msg');
        assert.ok(result.includes('a.js'));
        assert.ok(result.includes('b.ts'));
        assert.ok(result.endsWith('msg'));
    });

    it('respeita MAX_EMBED_BYTES — trunca quando excede', () => {
        const bigCtx = { path: 'big.js', content: 'x'.repeat(70_000), size: 70_000, lang: 'js' };
        const result = embedMultiple([bigCtx], 'msg');
        // 70KB excede 64KB, então não deve incluir o arquivo
        assert.strictEqual(result, 'msg');
    });

    it('retorna apenas mensagem se lista vazia', () => {
        assert.strictEqual(embedMultiple([], 'msg'), 'msg');
    });
});

describe('file-context readFileContext + cache', () => {
    it('lê arquivo real e retorna contexto', async () => {
        clearFileCache();
        const ctx = await readFileContext('package.json');
        assert.ok(ctx.content.includes('"name"'));
        assert.strictEqual(ctx.lang, 'json');
        assert.ok(ctx.size > 0);
    });

    it('cache hit na segunda leitura', async () => {
        clearFileCache();
        await readFileContext('package.json');
        const before = getFileCacheStats();
        await readFileContext('package.json');
        const after = getFileCacheStats();
        assert.strictEqual(after.hits, before.hits + 1);
    });
});
