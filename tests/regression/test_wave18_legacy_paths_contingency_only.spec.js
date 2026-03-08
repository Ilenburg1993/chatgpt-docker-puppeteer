// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave18: caminhos legados permanecem em contingência explícita', async () => {
    const serverMain = await fs.readFile(path.join(process.cwd(), 'src/server/main.js'), 'utf8');
    const config = await fs.readFile(path.join(process.cwd(), 'src/core/config.js'), 'utf8');
    const envExample = await fs.readFile(path.join(process.cwd(), '.env.example'), 'utf8');

    assert.match(serverMain, /DASHBOARD_LEGACY_BRIDGE_CONTINGENCY/);
    assert.match(
        serverMain,
        /dashboardTaskSyncMode\s*=\s*requestedSyncMode\s*===\s*'legacy_bridge'\s*&&\s*legacyBridgeContingency/,
    );

    assert.match(config, /LEGACY_PATHS_CONTINGENCY/);
    assert.match(envExample, /LEGACY_PATHS_CONTINGENCY=false/);
});
