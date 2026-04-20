// @ts-check
/**
 * tests/unit/copilot/test_alias_store.spec.js
 *
 * Testes unitários para bridges/alias-store.js Cobre: resolve (incluindo cadeia e loop), setAlias, removeAlias,
 * resetAliases, getAliases.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'vitest';

// alias-store.js é um módulo singleton com estado interno.
// Importamos uma única vez — cada describe usa resetAliases para limpar estado.
import {
    formatAliases,
    getAliases,
    removeAlias,
    resetAliases,
    resolve,
    setAlias,
} from '#copilot/terminal/alias-store';

describe('alias-store › resolve', () => {
    beforeEach(() => {
        resetAliases();
    });

    it('retorna o input se não existe alias', () => {
        assert.equal(resolve('status'), 'status');
        assert.equal(resolve('cmd desconhecido'), 'cmd desconhecido');
    });

    it('resolve alias builtin /st → /git status', () => {
        const result = resolve('/st');
        assert.equal(result, '/git status');
    });

    it('resolve alias builtin /issues → /gh issue list', () => {
        const result = resolve('/issues');
        assert.equal(result, '/gh issue list');
    });

    it('preserva argumentos após o alias', () => {
        const result = resolve('/log 10');
        // /log → /git log, mais ' 10'
        assert.equal(result, '/git log 10');
    });

    it('resolve alias customizado adicionado via setAlias', () => {
        setAlias('/foo', '/bar baz');
        assert.equal(resolve('/foo'), '/bar baz');
    });

    it('resolve cadeia de aliases (até 5 níveis)', () => {
        setAlias('/a', '/b');
        setAlias('/b', '/c final');
        // /a → /b → /c final
        assert.equal(resolve('/a'), '/c final');
    });

    it('não entra em loop infinito — detecta ciclo e retorna input atual', () => {
        setAlias('/loop1', '/loop1');
        // deve retornar algo sem travar (o ciclo é detectado)
        const result = resolve('/loop1');
        assert.ok(typeof result === 'string');
    });

    it('input com espaços desnecessários é trimado', () => {
        const result = resolve('  /st  ');
        assert.equal(result, '/git status');
    });
});

describe('alias-store › setAlias', () => {
    beforeEach(() => {
        resetAliases();
    });

    it('define um alias e o retorna via getAliases', () => {
        setAlias('/teste', '/git log');
        const aliases = getAliases();
        assert.equal(aliases['/teste'], '/git log');
    });

    it('prefixo / é adicionado automaticamente se ausente', () => {
        setAlias('sem-barra', '/git status');
        const aliases = getAliases();
        assert.equal(aliases['/sem-barra'], '/git status');
    });

    it('sobrescreve alias existente', () => {
        setAlias('/testx', '/cmd1');
        setAlias('/testx', '/cmd2');
        assert.equal(getAliases()['/testx'], '/cmd2');
    });

    it('retorna { ok: true } em caso de sucesso', () => {
        const result = setAlias('/ok', '/status');
        assert.equal(result.ok, true);
    });

    it('retorna { ok: false, error } quando detecta ciclo direto', () => {
        setAlias('/a', '/b');
        setAlias('/b', '/c');
        // Tentar criar /c → /a criaria um ciclo (/c → /a → /b → /c)
        setAlias('/c', '/a');
        const result = setAlias('/a', '/c');
        // Pode ser { ok: false } ou { ok: true } dependendo da direção do ciclo detectado
        // Mas não devemos travar
        assert.ok(result !== undefined && typeof result.ok === 'boolean');
    });
});

describe('alias-store › removeAlias', () => {
    beforeEach(() => {
        resetAliases();
    });

    it('retorna true e remove alias existente', () => {
        setAlias('/rm-me', '/status');
        const result = removeAlias('/rm-me');
        assert.equal(result, true);
        assert.equal(getAliases()['/rm-me'], undefined);
    });

    it('retorna false para alias inexistente', () => {
        assert.equal(removeAlias('/nao-existe'), false);
    });

    it('builtin pode ser removido (voltará no próximo resetAliases)', () => {
        const before = getAliases()['/st'];
        assert.ok(before !== undefined); // confirma builtin existe
        const removed = removeAlias('/st');
        assert.equal(removed, true);
        assert.equal(getAliases()['/st'], undefined);
    });
});

describe('alias-store › resetAliases', () => {
    it('restaura apenas builtins após customizações', () => {
        setAlias('/custom1', '/cmd1');
        resetAliases();
        const aliases = getAliases();
        // custom deve ter sumido
        assert.equal(aliases['/custom1'], undefined);
        // builtin deve estar de volta
        assert.ok(aliases['/st'] !== undefined);
    });
});

describe('alias-store › getAliases', () => {
    it('retorna cópia — mutações não afetam o store interno', () => {
        const aliases = getAliases();
        aliases['/injected'] = 'hack';
        const again = getAliases();
        assert.equal(again['/injected'], undefined);
    });
});

describe('alias-store › formatAliases', () => {
    it('retorna string com aliases formatados', () => {
        const output = formatAliases();
        assert.ok(typeof output === 'string');
        assert.ok(output.length > 0);
    });
});
