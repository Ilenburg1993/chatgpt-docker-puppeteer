// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

test('wave13: browserpool allocate retry loop is iterative and bounded', async () => {
    const filePath = path.join(ROOT, 'src/infra/browser_pool/pool_manager.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.doesNotMatch(content, /return\s+this\.allocate\(/, 'allocate() should not use recursive retry anymore');

    assert.match(
        content,
        /for\s*\(let\s+attempt\s*=\s*1;\s*attempt\s*<=\s*maxAttempts;\s*attempt\+\+\)/,
        'allocate() should use a bounded attempt loop'
    );
});
