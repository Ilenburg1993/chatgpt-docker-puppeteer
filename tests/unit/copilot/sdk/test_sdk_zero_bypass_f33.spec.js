// @ts-check
/**
 * SDK zero-bypass governance.
 *
 * The package map, SDK alias inventory and layer-access policy are the authorities. Runtime/dynamic usages are parsed
 * with the shared package-import parser; JSDoc/type-only imports are governed by exact package resolution separately.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectCopilotImportUsages } from '../../../../scripts/lib/copilot-package-imports.mjs';
import {
    SDK_ALIAS_LAYOUT,
    classifySdkLayerAccess,
    resolveSdkConsumerLayer,
} from '../../../../src/copilot/sdk/module-map.js';

const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/u, '');
const SRC_COPILOT = join(ROOT, 'src', 'copilot');

function packageSdkAliases() {
    const pkg = /** @type {{imports?:Record<string,unknown>}} */ (
        JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    );
    return Object.keys(pkg.imports ?? {})
        .filter((alias) => alias === '#copilot/sdk' || alias.startsWith('#copilot/sdk/'))
        .sort();
}

function runtimeSdkUsages() {
    return collectCopilotImportUsages({ roots: [SRC_COPILOT], relativeTo: ROOT }).usages.filter(
        (usage) =>
            usage.kind !== 'jsdoc' &&
            (usage.specifier === '#copilot/sdk' || usage.specifier.startsWith('#copilot/sdk/')) &&
            !usage.file.startsWith('src/copilot/sdk/'),
    );
}

describe('SDK package surface governance', () => {
    it('mantém bijeção entre SDK_ALIAS_LAYOUT e package.json#imports', () => {
        const declared = SDK_ALIAS_LAYOUT.map((entry) => entry.alias).sort();
        expect(packageSdkAliases()).toEqual(declared);
    });

    it('todo acesso runtime/dynamic externo ao SDK é classificado pela policy da camada', () => {
        const violations = [];
        for (const usage of runtimeSdkUsages()) {
            const layer = resolveSdkConsumerLayer(usage.file);
            const classification = layer ? classifySdkLayerAccess(layer, usage.specifier) : 'forbidden';
            if (!layer || classification === 'forbidden') {
                violations.push(`${usage.file}: ${usage.specifier} (${usage.kind}; layer=${layer ?? 'unmapped'})`);
            }
        }
        expect(violations, `Acessos SDK fora da policy:\n${violations.join('\n')}`).toEqual([]);
    });

    it('reserva o root #copilot/sdk exclusivamente ao boot validation path', () => {
        const rootUsages = runtimeSdkUsages().filter((usage) => usage.specifier === '#copilot/sdk');
        expect(rootUsages).toEqual([
            {
                file: 'src/copilot/boot/runtime-bootstrap.js',
                specifier: '#copilot/sdk',
                kind: 'dynamic',
            },
        ]);
    });

    it('mantém experimental RPC explícito e nunca o promove implicitamente a preferred', () => {
        const experimental = runtimeSdkUsages().filter((usage) => usage.specifier === '#copilot/sdk/rpc/experimental');
        expect(experimental.length).toBeGreaterThan(0);
        for (const usage of experimental) {
            const layer = resolveSdkConsumerLayer(usage.file);
            expect(layer).not.toBeNull();
            const classification = classifySdkLayerAccess(
                /** @type {NonNullable<typeof layer>} */ (layer),
                usage.specifier,
            );
            expect(['allowed', 'discouraged']).toContain(classification);
            expect(classification).not.toBe('preferred');
        }
    });
});
