// @ts-check

import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
        for (const facade of [
            'cache.js',
            'events.js',
            'health.js',
            'indexing.js',
            'io.js',
            'runtime.js',
            'session.js',
            'testing.js',
        ]) {
            expect(getInfraModuleDescriptor('public/')?.summary).toContain('Facades públicas');
            expect(readdirSync(join(INFRA_ROOT, 'public'))).toContain(facade);
        }
    });

    it('scorecard expõe hotspots de IO para orientar novas ondas', () => {
        const scorecard = buildInfraModuleScorecard();

        expect(scorecard.total).toBe(INFRA_MODULE_LAYOUT.length);
        expect(scorecard.hotspots).toEqual(
            expect.arrayContaining(['io-engine.js', 'io-index-sqlite.js', 'io-scanner.js']),
        );
        expect(scorecard.byRole['public-facade']).toBe(1);
        expect(scorecard.drift.available).toBe(true);
        expect(scorecard.drift.missingInLayout).toEqual([]);
        expect(scorecard.drift.staleInLayout).toEqual([]);
    });

    it('storage compat não depende da engine larga de IO', async () => {
        const source = await readFile(join(INFRA_ROOT, 'storage.js'), 'utf8');

        expect(source).not.toContain('./io-engine.js');
        expect(source).toContain('./storage/index.js');
    });

    it('parse/ permanece puro sem dependências de IO/cache/session', async () => {
        const parseFiles = readdirSync(join(INFRA_ROOT, 'parse')).filter((name) => name.endsWith('.js'));
        const violations = [];
        for (const file of parseFiles) {
            const source = await readFile(join(INFRA_ROOT, 'parse', file), 'utf8');
            if (/from ['"]\.\.\/(?:io|io-cache|io-index|io-session|io-prefetch)/.test(source)) {
                violations.push(file);
            }
        }

        expect(violations).toEqual([]);
    });
});
