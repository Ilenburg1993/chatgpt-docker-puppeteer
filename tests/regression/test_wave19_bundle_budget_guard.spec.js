// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

test('wave19: vite build mantém split/lazy e guardrails de bundle', async () => {
    const viteConfig = await fs.readFile(path.join(process.cwd(), 'src/dashboard-ui/vite.config.js'), 'utf8');
    const taskDetail = await fs.readFile(path.join(process.cwd(), 'src/dashboard-ui/src/views/TaskDetail.vue'), 'utf8');
    const missionDetail = await fs.readFile(
        path.join(process.cwd(), 'src/dashboard-ui/src/views/MissionDetail.vue'),
        'utf8',
    );

    assert.match(viteConfig, /chunkSizeWarningLimit:\s*1000/);
    assert.match(viteConfig, /manualChunks/);
    assert.match(viteConfig, /return 'vis'/);
    assert.match(viteConfig, /return `view-\$\{viewName\.toLowerCase\(\)\}`/);
    assert.match(viteConfig, /cssCodeSplit:\s*true/);

    assert.match(taskDetail, /defineAsyncComponent/);
    assert.match(taskDetail, /import\('@\/components\/graphs\/VisGraph\.vue'\)/);
    assert.match(missionDetail, /defineAsyncComponent/);
    assert.match(missionDetail, /import\('@\/components\/graphs\/VisGraph\.vue'\)/);
});
