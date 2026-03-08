// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const filePath = path.join(process.cwd(), 'src/infra/ConnectionOrchestrator.js');

test('wave20: fast-path failures preserve fallback guard with autoFallback gate', async () => {
    const content = await fs.readFile(filePath, 'utf8');
    const guards = content.match(/if\s*\(!this\.config\.autoFallback\)\s*\{/g) || [];

    assert.ok(
        guards.length >= 3,
        'ConnectionOrchestrator should guard fast-path throw with autoFallback in browserURL/wsEndpoint paths',
    );
});

test('wave20: wsEndpoint resolution paths clear timeout timers in finally blocks', async () => {
    const content = await fs.readFile(filePath, 'utf8');

    const timeoutFinallyBlocks = content.match(
        /let\s+timeoutId\s*=\s*null[\s\S]*?finally\s*\{[\s\S]*?clearTimeout\(timeoutId\);[\s\S]*?\}/g,
    );

    assert.ok(
        Array.isArray(timeoutFinallyBlocks) && timeoutFinallyBlocks.length >= 2,
        'wsEndpoint fast-path and fallback fetch blocks must clear timeout timers in finally',
    );
});
