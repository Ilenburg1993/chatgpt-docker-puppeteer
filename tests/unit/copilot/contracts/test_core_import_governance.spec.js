// @ts-check
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    readCoreExtinctionBaseline,
    readCoreExtinctionTargets,
    validateCoreExtinctionRatchet,
} from '../../../../scripts/ci/check-copilot-core-extinction.mjs';

/** @type {ReturnType<typeof validateCoreExtinctionRatchet>} */
let extinctionResult;

describe('Core extinction governance', () => {
    beforeAll(() => {
        extinctionResult = validateCoreExtinctionRatchet();
    });

    it('enforces the completed extinction invariant: no tree, aliases or dependencies may return', () => {
        const result = extinctionResult;
        expect(result.extinctionComplete).toBe(true);
        expect(result.current).toEqual([]);
        expect(result.packageAliases).toEqual([]);
        expect(result.physicalModules).toEqual([]);
        expect(result.additions).toEqual([]);
        expect(result.newAliases).toEqual([]);
        expect(result.unclassifiedModules).toEqual([]);
        expect(existsSync('src/copilot/core')).toBe(false);
    });

    it('preserves the migration baseline and target map as historical audit evidence', () => {
        const baseline = readCoreExtinctionBaseline();
        const targets = readCoreExtinctionTargets();
        expect(baseline.policy).toBe('copilot-core-extinction-monotonic-ratchet');
        expect(baseline.dependencies.length).toBeGreaterThan(0);
        expect(baseline.packageAliases.length).toBeGreaterThan(0);
        expect(targets.policy).toBe('copilot-core-extinction-target-owners');
        expect(new Set(targets.modules.map((entry) => entry.module)).size).toBe(targets.modules.length);
        for (const entry of targets.modules) {
            expect(entry.disposition).toBeTruthy();
            expect(entry.owner).toBeTruthy();
            expect(entry.disposition.toLowerCase()).not.toContain('tbd');
            expect(entry.owner.toLowerCase()).not.toContain('tbd');
        }
    });

    it('scanner remains active after extinction and therefore detects any future reintroduction', () => {
        expect(extinctionResult.current).toEqual([]);
    });
});
