// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave16r: server main enforces single realtime source by DASHBOARD_TASK_SYNC_MODE', async () => {
    const filePath = path.join(process.cwd(), 'src/server/main.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.match(content, /dashboardTaskSyncMode/);
    assert.match(content, /dashboardTaskSyncMode\s*===\s*['"]ssot_feed['"]/);
    assert.match(content, /dashboardTaskSyncMode\s*===\s*['"]legacy_bridge['"]/);
    assert.match(content, /DASHBOARD_LEGACY_BRIDGE_CONTINGENCY/);
    assert.match(content, /TaskSyncBridge inicializado \(contingência legacy_bridge\)/);
});
