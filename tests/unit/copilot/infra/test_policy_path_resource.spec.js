// @ts-check

import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    assertValidIoFilePath,
    hasNullByte,
    isPathInsideWorkspace,
    normalizePathResourceKey,
    normalizeWorkspaceRoot,
    resolveWorkspaceCandidate,
} from '../../../../src/copilot/infra/policy/path-resource.js';

describe('infra/policy/path-resource', () => {
    it('normaliza resource keys de path e preserva sentinelas lógicas', () => {
        expect(normalizePathResourceKey('<global>')).toBe('<global>');
        expect(normalizePathResourceKey('./src/../src/copilot')).toBe(normalizeWorkspaceRoot('src/copilot'));
    });

    it('resolve candidatos relativos dentro da raiz normalizada', () => {
        const root = normalizeWorkspaceRoot(process.cwd());
        const candidate = resolveWorkspaceCandidate('src/copilot', root);

        expect(relative(root, candidate).replace(/\\/g, '/')).toBe('src/copilot');
    });

    it('detecta paths fora do workspace sem depender de prefix string ingênuo', () => {
        const root = normalizeWorkspaceRoot('/tmp/work/project');

        expect(isPathInsideWorkspace('/tmp/work/project/src/a.js', root)).toBe(true);
        expect(isPathInsideWorkspace('/tmp/work/project-evil/src/a.js', root)).toBe(false);
        expect(isPathInsideWorkspace('../outside.txt', root)).toBe(false);
    });

    it('detecta byte nulo para boundaries de path', () => {
        expect(hasNullByte('a\u0000b')).toBe(true);
        expect(hasNullByte('ab')).toBe(false);
    });

    it('valida path de IO válido sem lançar', () => {
        expect(() => assertValidIoFilePath('/tmp/work/project/src/index.js')).not.toThrow();
    });

    it('rejeita path inválido com null-byte', () => {
        expect(() => assertValidIoFilePath('src/evil\u0000file.js')).toThrowError(/inválido/i);
        expect(() => assertValidIoFilePath('src/evil\u0000file.js')).toThrowError(/ERR_INVALID_ARG_VALUE|inválido/i);
    });

    it('rejeita path vazio', () => {
        expect(() => assertValidIoFilePath('')).toThrowError(/inválido/i);
    });
});
