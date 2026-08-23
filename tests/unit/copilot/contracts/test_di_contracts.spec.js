// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const EXTINCT_FILES = [
    'src/copilot/core/di.js',
    'src/copilot/core/di-container.js',
    'src/copilot/core/di-tokens.js',
    'src/copilot/core/event-bus.js',
    'src/copilot/sdk/di-tokens.js',
    'src/copilot/hooks/di-tokens.js',
    'src/copilot/agent/di-tokens.js',
    'src/copilot/bridges/di-tokens.js',
    'src/copilot/audit/di-tokens.js',
    'src/copilot/tools/infra/di-tokens.js',
    'src/copilot/channel/di-tokens.js',
    'src/copilot/plugins/di-tokens.js',
];

describe('service-locator extinction governance', () => {
    it('keeps deleted DI/token implementations physically absent', () => {
        for (const file of EXTINCT_FILES) assert.equal(existsSync(resolve(ROOT, file)), false, file);
    });

    it('keeps package aliases free of Core DI and old EventBus paths', () => {
        const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
        const keys = Object.keys(pkg.imports ?? {});
        assert.equal(
            keys.some((key) => /#copilot\/core\/(?:di|di-tokens|event-bus)/u.test(key)),
            false,
        );
        assert.equal(keys.includes('#copilot/sdk/di'), false);
        assert.equal(pkg.imports?.['#copilot/events/runtime'], './src/copilot/events/runtime/index.js');
    });

    it('keeps the former Core owner physically absent instead of retaining an empty facade', () => {
        assert.equal(existsSync(resolve(ROOT, 'src/copilot/core')), false);
    });

    it('keeps runtime source free of generic service-locator vocabulary', () => {
        const result = spawnSync(
            'rg',
            [
                '-n',
                String.raw`\bcontainer\.(?:resolve|register|has|validateRequired)\b|createContainer|createToken`,
                'src/copilot',
                '--glob',
                '*.js',
            ],
            { cwd: ROOT, encoding: 'utf8' },
        );
        assert.ok(result.status === 0 || result.status === 1);
        assert.equal(String(result.stdout ?? '').trim(), '');
    });
});
