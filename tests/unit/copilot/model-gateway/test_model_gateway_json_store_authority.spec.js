// @ts-check

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { JsonModelGatewayCatalogStore, JsonModelGatewayRegistryStore } from '#copilot/model-gateway';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** @type {string[]} */
const cleanup = [];

afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

/** @param {string} filePath @param {string} id */
function exactJsonIo(filePath, id) {
    return createConfiguredFsIo(
        createConfiguredFsGrant({
            id,
            exactPaths: [filePath],
            operations: ['read', 'stat', 'write'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
}

describe('model-gateway JSON store authority', () => {
    it('recusa path alternativo sem IO previamente autorizado', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'model-gateway-json-authority-'));
        cleanup.push(directory);
        const catalogPath = join(directory, 'catalog.json');
        const registryPath = join(directory, 'registry.json');

        expect(() => new JsonModelGatewayCatalogStore({ filePath: catalogPath })).toThrow(/already-authorized IO/u);
        expect(() => new JsonModelGatewayRegistryStore({ filePath: registryPath })).toThrow(/already-authorized IO/u);
    });

    it('aceita path alternativo somente quando o caller injeta capability exact-bound', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'model-gateway-json-authority-'));
        cleanup.push(directory);
        const catalogPath = join(directory, 'catalog.json');
        const registryPath = join(directory, 'registry.json');
        const catalog = new JsonModelGatewayCatalogStore({
            filePath: catalogPath,
            io: exactJsonIo(catalogPath, 'test.model-gateway.catalog-authority'),
        });
        const registry = new JsonModelGatewayRegistryStore({
            filePath: registryPath,
            io: exactJsonIo(registryPath, 'test.model-gateway.registry-authority'),
        });

        await catalog.writeSnapshot({ source: 'authority-test', sources: [], projections: [] });
        await registry.writeSnapshot({ source: 'authority-test', providers: [], models: [] });

        await expect(catalog.readSnapshot()).resolves.toMatchObject({ source: 'authority-test' });
        const loadedRegistry = await registry.loadRegistry();
        expect(loadedRegistry.listProviders()).toEqual([]);
        expect(loadedRegistry.listModels()).toEqual([]);
    });
});
