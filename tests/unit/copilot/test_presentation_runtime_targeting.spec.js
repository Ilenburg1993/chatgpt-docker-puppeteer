// @ts-check

import { describe, expect, it } from 'vitest';

import {
    hasRuntimeId,
    normalizeRuntimeId,
    pickRuntimeId,
    readRuntimeIdFromParams,
} from '../../../src/copilot/presentation/runtime-targeting.js';

describe('presentation/runtime-targeting.js', () => {
    it('normalizeRuntimeId limpa whitespace e invalida vazios', () => {
        expect(normalizeRuntimeId('  alt  ')).toBe('alt');
        expect(normalizeRuntimeId('   ')).toBeNull();
        expect(normalizeRuntimeId(null)).toBeNull();
    });

    it('hasRuntimeId reflete a semântica canônica de ids explícitos', () => {
        expect(hasRuntimeId('alt')).toBe(true);
        expect(hasRuntimeId('')).toBe(false);
        expect(hasRuntimeId(undefined)).toBe(false);
    });

    it('pickRuntimeId escolhe o primeiro candidato válido', () => {
        expect(pickRuntimeId(undefined, '  ', 'header-alt', 'body-alt')).toBe('header-alt');
        expect(pickRuntimeId(null, '', '   ')).toBeNull();
    });

    it('readRuntimeIdFromParams cobre top-level e body de handlers compartilhados', () => {
        expect(readRuntimeIdFromParams({ runtimeId: '  alt  ' })).toBe('alt');
        expect(readRuntimeIdFromParams({ body: { runtimeId: 'nested-alt' } })).toBe('nested-alt');
        expect(readRuntimeIdFromParams({ body: { runtimeId: '   ' } })).toBeNull();
    });
});
