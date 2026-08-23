// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { listStaticModuleSpecifiers } from '#copilot/infra/internal/governance';

describe('infra public API static import parser', () => {
    it('captures multiline imports and reexports while excluding dynamic imports', () => {
        const source = `
            import {
                alpha,
                beta,
            } from '#copilot/example/multiline';
            import '#copilot/example/side-effect';
            export {
                gamma,
            } from '#copilot/example/reexport';
            export * from '#copilot/example/star';
            const lazy = () => import('#copilot/example/lazy');
        `;

        assert.deepEqual(listStaticModuleSpecifiers(source), [
            '#copilot/example/multiline',
            '#copilot/example/side-effect',
            '#copilot/example/reexport',
            '#copilot/example/star',
        ]);
    });
});
