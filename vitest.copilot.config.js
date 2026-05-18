import { readFileSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Build Vite resolve.alias from package.json "imports" field.
 *
 * @returns {{ find: string | RegExp; replacement: string }[]}
 */
function buildAliasFromImports() {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));
    const imports = pkg.imports ?? {};
    const alias = [];

    const entries = Object.entries(imports)
        .filter(([, value]) => typeof value === 'string')
        .sort((a, b) => b[0].length - a[0].length);

    for (const [pattern, target] of entries) {
        if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -2);
            const targetBase = target.replace('./', '').replace(/\/\*\.(js|mjs|ts)$/, '/');
            const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            alias.push({
                find: new RegExp(`^${escapedPrefix}\\/(.+)$`),
                replacement: resolve(targetBase, '$1'),
            });
            continue;
        }

        const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        alias.push({
            find: new RegExp(`^${escapedPattern}$`),
            replacement: resolve(target.replace('./', '')),
        });
    }

    return alias;
}

const copilotCacheDir = process.env.VITEST_CACHE_DIR ?? `${homedir()}/.cache/vitest/copilot`;

export default defineConfig({
    cacheDir: copilotCacheDir,
    resolve: {
        alias: buildAliasFromImports(),
        extensions: ['.js', '.mjs', '.ts', '.json'],
    },
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['tests/support/setup.js'],
        include: [
            'tests/unit/copilot/**/*.spec.js',
            'tests/integration/copilot/**/*.spec.js',
            'tests/regression/copilot/**/*.spec.js',
        ],
        hookTimeout: 60000,
        testTimeout: 15000,
        pool: process.env.VITEST_POOL ?? 'threads',
        maxWorkers: process.env.VITEST_MAX_WORKERS ?? '50%',
        fileParallelism: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            thresholds: {
                lines: 45,
                branches: 30,
                functions: 40,
            },
        },
        watch: false,
        experimental: {
            fsModuleCache: true,
        },
    },
});
