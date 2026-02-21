import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave16r: dashboard auth does not contain hardcoded users/passwords', async () => {
    const filePath = path.join(process.cwd(), 'src/server/api/controllers/dashboard.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.doesNotMatch(content, /admin123|user123|const\s+validUsers\s*=\s*\{/);
    assert.match(content, /DASHBOARD_AUTH_USERNAME/);
    assert.match(content, /DASHBOARD_AUTH_PASSWORD/);
});
