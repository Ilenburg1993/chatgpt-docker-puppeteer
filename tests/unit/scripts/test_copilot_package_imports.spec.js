// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectCopilotImportUsagesFromSource } from '../../../scripts/lib/copilot-package-imports.mjs';

describe('copilot package-import parser', () => {
    it('collects runtime, dynamic, mock and JSDoc imports without treating arbitrary strings as imports', () => {
        const source = `
            import { a } from '#copilot/core';
            export { b } from '#copilot/sdk/types';
            const c = await import('#copilot/events/sdk-events');
            vi.mock('#copilot/config/env', () => ({}));
            const fixture = "#copilot/not-an-import";
            const regex = /#copilot\\/also-not-an-import/;
            /** @type {import('#copilot/boot/application-infra').ApplicationInfraHost} */
            const host = null;
        `;
        const usages = collectCopilotImportUsagesFromSource(source, 'fixture.js');
        assert.deepEqual(
            usages.map(({ specifier, kind }) => [specifier, kind]),
            [
                ['#copilot/core', 'runtime'],
                ['#copilot/sdk/types', 'runtime'],
                ['#copilot/events/sdk-events', 'dynamic'],
                ['#copilot/config/env', 'mock'],
                ['#copilot/boot/application-infra', 'jsdoc'],
            ],
        );
    });
});
