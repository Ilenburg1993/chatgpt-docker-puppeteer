import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave17: server/main exige contingência explícita para bridge legado', async () => {
    const content = await fs.readFile(path.join(process.cwd(), 'src/server/main.js'), 'utf8');
    assert.match(content, /DASHBOARD_LEGACY_BRIDGE_CONTINGENCY/);
    assert.match(content, /requestedSyncMode/);
    assert.match(content, /dashboardTaskSyncMode/);
    assert.match(content, /TaskSyncBridge inicializado \(contingência legacy_bridge\)/);
});

test('wave17: SSOT feed só emite eventos compat quando flag explícita está ativa', async () => {
    const content = await fs.readFile(path.join(process.cwd(), 'src/server/realtime/ssot_event_feed.js'), 'utf8');
    assert.match(content, /function _isCompatEmitEnabled/);
    assert.match(content, /if \(_isCompatEmitEnabled\(\)\)\s*{\s*for \(const u of updates\)\s*{\s*io\.to\('dashboards'\)\.emit\('task:updated'/s);
    assert.match(content, /if \(_isCompatEmitEnabled\(\)\)\s*{\s*for \(const u of updates\)\s*{\s*io\.to\('dashboards'\)\.emit\('mission:updated'/s);
});
