// @ts-check

import { describe, expect, it } from 'vitest';

import {
    formatTerminalIsoTimestamp,
    formatTerminalIsoTimestampSeconds,
    formatTerminalTimeLabel,
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
    });

    it('permite alternar o modo sem refatorar callers', () => {
        expect(formatTerminalTimeLabel(instant, { now, mode: 'relative' })).toBe('há 1m');
        expect(formatTerminalTimeLabel(instant, { now, mode: 'iso' })).toBe('2026-06-03T16:30:45-03:00');
        expect(formatTerminalTimeLabel(instant, { now, mode: 'elapsed' })).toBe('1m');
        expect(resolveTerminalTimeDisplayMode('desconhecido')).toBe('dual');
    });

    it('aceita timestamp numérico recebido como string', () => {
        expect(formatTerminalTimeLabel(String(Date.parse(instant)), { now, mode: 'dual' })).toBe(
            '2026-06-03T16:30:45-03:00 (há 1m)',
        );
    });
});
