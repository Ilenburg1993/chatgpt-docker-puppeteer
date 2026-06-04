// @ts-check

import { describe, expect, it } from 'vitest';

import {
    formatTerminalIsoTimestamp,
    formatTerminalIsoTimestampSeconds,
    formatTerminalTimeParts,
    formatTerminalTimeLabel,
    formatTerminalTimestamp,
    resolveTerminalTimeDisplayMode,
} from '../../../../src/copilot/terminal/state/time-format.js';

describe('terminal/time-format', () => {
    const instant = '2026-06-03T16:30:45.678-03:00';
    const now = Date.parse('2026-06-03T16:31:50.000-03:00');

    it('formata ISO local com precisão configurável', () => {
        expect(formatTerminalIsoTimestamp(instant, { precision: 'milliseconds' })).toBe(
            '2026-06-03T16:30:45.678-03:00',
        );
        expect(formatTerminalIsoTimestampSeconds(instant)).toBe('2026-06-03T16:30:45-03:00');
    });

    it('combina ISO até segundos e tempo relativo no modo dual', () => {
        expect(formatTerminalTimeLabel(instant, { now, mode: 'dual' })).toBe(
            '2026-06-03T16:30:45-03:00 (há 1m)',
        );
        expect(formatTerminalTimestamp(instant, { now })).toBe('2026-06-03T16:30:45-03:00 (há 1m)');
    });

    it('permite alternar o modo sem refatorar callers', () => {
        expect(formatTerminalTimeLabel(instant, { now, mode: 'relative' })).toBe('há 1m');
        expect(formatTerminalTimeLabel(instant, { now, mode: 'iso' })).toBe('2026-06-03T16:30:45-03:00');
        expect(formatTerminalTimeLabel(instant, { now, mode: 'elapsed' })).toBe('1m');
        expect(resolveTerminalTimeDisplayMode('desconhecido')).toBe('dual');
    });

    it('expõe partes canônicas para layouts compostos sem reparsear timestamp', () => {
        expect(formatTerminalTimeParts(instant, { now, mode: 'dual' })).toEqual({
            value: instant,
            timestamp: Date.parse(instant),
            valid: true,
            mode: 'dual',
            iso: '2026-06-03T16:30:45-03:00',
            relative: 'há 1m',
            elapsed: '1m',
            label: '2026-06-03T16:30:45-03:00 (há 1m)',
        });
    });

    it('mantém inválidos legíveis sem produzir idade relativa enganosa', () => {
        expect(formatTerminalTimeParts('não é data', { now, mode: 'dual' })).toMatchObject({
            timestamp: null,
            valid: false,
            iso: 'tempo inválido',
            relative: 'tempo relativo indisponível',
            elapsed: '0s',
            label: 'tempo inválido',
        });
    });

    it('aceita timestamp numérico recebido como string', () => {
        expect(formatTerminalTimeLabel(String(Date.parse(instant)), { now, mode: 'dual' })).toBe(
            '2026-06-03T16:30:45-03:00 (há 1m)',
        );
    });
});
