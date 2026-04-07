import { defineConfig } from 'vitest/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Build Vite resolve.alias from package.json "imports" field.
 * Vite does not natively support Node.js subpath imports (#foo/*),
 * so we translate them into resolve.alias entries.
 *
 * Wildcard entries: #foo/* → ./src/foo/*.EXT  become regex aliases
 * that try multiple extensions (.js, .mjs, .ts).
 */
function buildAliasFromImports() {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));
    const imports = pkg.imports ?? {};
    const alias = [];

    // Process more-specific (longer) patterns first to avoid conflicts
    const entries = Object.entries(imports)
        .filter(([, v]) => typeof v === 'string')
        .sort((a, b) => b[0].length - a[0].length);

    for (const [pattern, target] of entries) {
        if (pattern.endsWith('/*')) {
            // Wildcard: #foo/* → ./src/foo/*.js
            const prefix = pattern.slice(0, -2);
            const targetBase = target
                .replace('./', '')
                .replace(/\/\*\.(js|mjs|ts)$/, '/');
            const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            alias.push({
                find: new RegExp(`^${escapedPrefix}\\/(.+)$`),
                replacement: resolve(targetBase, '$1'),
            });
        } else {
            // Exact: #foo → ./src/foo/index.js
            alias.push({
                find: pattern,
                replacement: resolve(target.replace('./', '')),
            });
        }
    }
    return alias;
}

export default defineConfig({
    resolve: {
        alias: buildAliasFromImports(),
        extensions: ['.js', '.mjs', '.ts', '.json'],
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.spec.js'],
        testTimeout: 15000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
        },
        watch: false,
    },
});
