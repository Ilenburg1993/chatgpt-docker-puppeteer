// @ts-check

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    buildInfraModuleScorecard,
    getInfraModuleDescriptor,
    INFRA_MODULE_LAYOUT,
    listInfraModulesByRole,
} from '#copilot/infra';

const INFRA_ROOT = resolve(process.cwd(), 'src/copilot/infra');

describe('infra barrel governance', () => {
    it('module-map cobre todas as entradas raiz de infra', () => {
        const actual = readdirSync(INFRA_ROOT, { withFileTypes: true })
            .filter((entry) => entry.name === 'README.md' || entry.name.endsWith('.js') || entry.isDirectory())
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .sort();
        const mapped = INFRA_MODULE_LAYOUT.map((entry) => entry.path).sort();

        expect(mapped).toEqual(actual);
    });

    it('facades públicas são a borda primária para consumidores externos', () => {
        const publicFacades = listInfraModulesByRole('public-facade');

        expect(publicFacades.map((entry) => entry.path)).toEqual(['public/']);
        expect(publicFacades.every((entry) => entry.public && entry.tier === 'primary')).toBe(true);
        for (const facade of ['cache.js', 'events.js', 'health.js', 'indexing.js', 'io.js', 'session.js', 'testing.js']) {
            expect(getInfraModuleDescriptor('public/')?.summary).toContain('Facades públicas');
            expect(readdirSync(join(INFRA_ROOT, 'public'))).toContain(facade);
        }
    });

    it('scorecard expõe hotspots de IO para orientar novas ondas', () => {
        const scorecard = buildInfraModuleScorecard();

        expect(scorecard.total).toBe(INFRA_MODULE_LAYOUT.length);
        expect(scorecard.hotspots).toEqual(expect.arrayContaining(['io-engine.js', 'io-index-sqlite.js', 'io-scanner.js']));
        expect(scorecard.byRole['public-facade']).toBe(1);
    });
});
