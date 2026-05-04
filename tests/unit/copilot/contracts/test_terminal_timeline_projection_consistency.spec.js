// @ts-check

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TIMELINE_SRC = readFileSync(
    new URL('../../../../src/copilot/terminal/frontend/projections/timeline.js', import.meta.url),
    'utf8',
);
const EXPORT_SRC = readFileSync(
    new URL('../../../../src/copilot/terminal/commands/export.js', import.meta.url),
    'utf8',
);
const STATUS_SRC = readFileSync(
    new URL('../../../../src/copilot/terminal/frontend/projections/status.js', import.meta.url),
    'utf8',
);
const CONTEXT_SRC = readFileSync(
    new URL('../../../../src/copilot/terminal/commands/context.js', import.meta.url),
    'utf8',
);

describe('terminal timeline governance (E3)', () => {
    it('mantém uma projection canônica dedicada para timeline', () => {
        expect(TIMELINE_SRC).toMatch(/export function readTerminalTimelineProjection\(/);
        expect(TIMELINE_SRC).toMatch(/export function readTerminalContextProjection\(/);
        expect(TIMELINE_SRC).toMatch(/export function readTerminalDbHistoryProjection\(/);
    });

    it('comandos e status consomem a timeline canônica em vez do feed cru do bridge', () => {
        expect(EXPORT_SRC).toMatch(/readTerminalTimelineProjection/);
        expect(EXPORT_SRC).not.toMatch(/readTerminalHistoryFeed/);
        expect(STATUS_SRC).toMatch(/readTerminalTimelineProjection/);
        expect(CONTEXT_SRC).toMatch(/Timeline canônica/);
    });
});
