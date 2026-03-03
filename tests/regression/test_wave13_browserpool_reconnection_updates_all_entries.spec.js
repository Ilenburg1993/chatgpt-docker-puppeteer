// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

test('wave13: reconnection flow updates all pool entries and circuit breaker recovery', async () => {
    const filePath = path.join(ROOT, 'src/infra/browser_pool/pool_manager.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.match(
        content,
        /for\s*\(const\s+poolEntry\s+of\s+this\.pool\)\s*\{\s*poolEntry\.browser\s*=\s*newBrowser;/s,
        'reconnection success should propagate newBrowser to all pool entries'
    );

    assert.match(
        content,
        /for\s*\(const\s+poolEntry\s+of\s+this\.pool\)\s*\{\s*this\.circuitBreaker\.registerRecovery\(poolEntry\.id\);/s,
        'reconnection success should register circuit-breaker recovery for all entries'
    );
});
