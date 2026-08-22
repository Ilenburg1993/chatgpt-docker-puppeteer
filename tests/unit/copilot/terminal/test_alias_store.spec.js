// @ts-check
/**
 * tests/unit/copilot/terminal/test_alias_store.spec.js
 *
 * F184: Testes para alias-store.js — resolve, setAlias, removeAlias, resetAliases, formatAliases.
 *
 * Usa mocks de fs para isolar persistência.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    appendTextConfigured,
    deleteFileConfigured,
    listDirectoryNamesFreshConfigured,
    lstatPathConfigured,
    mkdirPathConfigured,
    moveFileConfigured,
    readBytesFreshConfigured,
    readBytesRangeFreshConfigured,
    readTextFreshConfigured,
    statPathConfigured,
    watchPathConfigured,
    withPathLockConfigured,
    writeFileAtomicConfigured,
} = vi.hoisted(() => ({
    appendTextConfigured: vi.fn(() => Promise.resolve()),
    deleteFileConfigured: vi.fn(() => Promise.resolve()),
    listDirectoryNamesFreshConfigured: vi.fn(() => Promise.resolve({ entries: [] })),
    lstatPathConfigured: vi.fn(() => Promise.resolve({ stats: { size: 0 } })),
    mkdirPathConfigured: vi.fn(() => Promise.resolve()),
    moveFileConfigured: vi.fn(() => Promise.resolve()),
    readBytesFreshConfigured: vi.fn(() => Promise.resolve({ content: Buffer.alloc(0) })),
    readBytesRangeFreshConfigured: vi.fn(() => Promise.resolve({ content: Buffer.alloc(0), startByte: 0, endByte: 0 })),
    readTextFreshConfigured: vi.fn(() => Promise.resolve({ content: '{}' })),
    statPathConfigured: vi.fn(() => Promise.resolve({ stats: { size: 0 } })),
    watchPathConfigured: vi.fn(() => ({ close: vi.fn() })),
    withPathLockConfigured: vi.fn((_, __, callback) => callback()),
    writeFileAtomicConfigured: vi.fn(() => Promise.resolve()),
}));

vi.mock('#copilot/infra/public/composition/filesystem/configured', () => ({
    createConfiguredFsGrant: vi.fn((declaration) => declaration),
    createConfiguredFsIo: vi.fn(() => ({
        appendText: appendTextConfigured,
        deleteFile: deleteFileConfigured,
        listDirectoryNamesFresh: listDirectoryNamesFreshConfigured,
        lstatPath: lstatPathConfigured,
        mkdirPath: mkdirPathConfigured,
        moveFile: moveFileConfigured,
        readBytesFresh: readBytesFreshConfigured,
        readBytesRangeFresh: readBytesRangeFreshConfigured,
        readTextFresh: readTextFreshConfigured,
        statPath: statPathConfigured,
        watchPath: watchPathConfigured,
        withPathLock: withPathLockConfigured,
        writeFileAtomic: writeFileAtomicConfigured,
    })),
}));

import {
    flushAliasPersistence,
    formatAliases,
    getAliases,
    removeAlias,
    resetAliases,
    resolve,
    setAlias,
} from '../../../../src/copilot/terminal/stores/alias-store.js';

describe('alias-store resolve', () => {
    beforeEach(() => resetAliases());

    it('resolve alias builtin /st → /git status', () => {
        const result = resolve('/st');
        expect(result).toBe('/git status');
    });

    it('resolve alias builtin /issues → /gh issue list', () => {
        const result = resolve('/issues');
        expect(result).toBe('/gh issue list');
    });

    it('retorna input inalterado se não é alias', () => {
        expect(resolve('/desconhecido')).toBe('/desconhecido');
    });

    it('preserva argumentos após alias', () => {
        const result = resolve('/st --short');
        expect(result).toBe('/git status --short');
    });

    it('resolve cadeia de aliases (até 5 níveis)', () => {
        // /a → /b → /builtin
        setAlias('/b', '/st');
        setAlias('/a', '/b');
        const result = resolve('/a');
        expect(result).toBe('/git status');
    });

    it('detecta loop e para sem crash', () => {
        // forçar loop: /x → /y → /x
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setAlias('/x', '/y');
        setAlias('/y', '/x');
        const result = resolve('/x');
        // deve retornar algo sem lançar erro
        expect(typeof result).toBe('string');
        warnSpy.mockRestore();
    });
});

describe('alias-store setAlias', () => {
    beforeEach(() => resetAliases());

    it('define alias customizado e aparece em getAliases', () => {
        const r = setAlias('/myalias', '/git log 5');
        expect(r.ok).toBe(true);
        expect(getAliases()['/myalias']).toBe('/git log 5');
    });

    it('sobrescreve builtin', () => {
        setAlias('/st', '/git status --short');
        expect(getAliases()['/st']).toBe('/git status --short');
    });

    it('prefixo / é adicionado automaticamente', () => {
        setAlias('noslash', '/git log');
        expect(getAliases()['/noslash']).toBe('/git log');
    });

    it('rejeita loop direto com error', () => {
        setAlias('/a', '/b');
        const r = setAlias('/b', '/a');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('Loop');
    });

    it('serializa snapshots fire-and-forget e persiste o estado mais novo por último', async () => {
        await flushAliasPersistence();
        writeFileAtomicConfigured.mockClear();
        let releaseFirst = () => {};
        writeFileAtomicConfigured.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseFirst = resolve;
                }),
        );

        setAlias('/first', '/echo first');
        setAlias('/second', '/echo second');
        await vi.waitFor(() => expect(writeFileAtomicConfigured).toHaveBeenCalledTimes(1));
        releaseFirst();
        await flushAliasPersistence();

        expect(writeFileAtomicConfigured).toHaveBeenCalledTimes(2);
        const firstSnapshot = String(/** @type {unknown[]} */ (writeFileAtomicConfigured.mock.calls[0] ?? [])[1]);
        const secondSnapshot = String(/** @type {unknown[]} */ (writeFileAtomicConfigured.mock.calls[1] ?? [])[1]);
        expect(firstSnapshot).toContain('/first');
        expect(firstSnapshot).not.toContain('/second');
        expect(secondSnapshot).toContain('/first');
        expect(secondSnapshot).toContain('/second');
        expect(writeFileAtomicConfigured).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), {
            mode: 0o600,
        });
    });
});

describe('alias-store removeAlias', () => {
    beforeEach(() => resetAliases());

    it('remove alias existente', () => {
        setAlias('/tmp', '/echo foo');
        expect(removeAlias('/tmp')).toBe(true);
        expect(getAliases()['/tmp']).toBeUndefined();
    });

    it('retorna false para alias inexistente', () => {
        expect(removeAlias('/nope')).toBe(false);
    });
});

describe('alias-store resetAliases', () => {
    it('restaura apenas builtins', () => {
        setAlias('/custom', '/echo custom');
        resetAliases();
        const all = getAliases();
        expect(all['/custom']).toBeUndefined();
        expect(all['/st']).toBeDefined();
    });
});

describe('alias-store formatAliases', () => {
    beforeEach(() => resetAliases());

    it('retorna string formatada não-vazia', () => {
        const output = formatAliases();
        expect(typeof output).toBe('string');
        expect(output.length).toBeGreaterThan(0);
        expect(output).not.toContain('\x1b[');
    });

    it('contém tags [builtin] para entries built-in', () => {
        const output = formatAliases();
        expect(output).toContain('[builtin]');
    });

    it('contém tag [custom] para entries customizados', () => {
        setAlias('/mytest', '/echo test');
        const output = formatAliases();
        expect(output).toContain('[custom]');
    });
});
