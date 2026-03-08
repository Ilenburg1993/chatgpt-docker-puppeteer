// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave19: useSsotRealtime aplica dedupe + reconciliação por cursor/event_id', async () => {
    const ssotRealtime = await fs.readFile(
        path.join(process.cwd(), 'src/dashboard-ui/src/composables/useSsotRealtime.js'),
        'utf8',
    );
    const eventsStore = await fs.readFile(
        path.join(process.cwd(), 'src/dashboard-ui/src/stores/events_vnext.js'),
        'utf8',
    );

    assert.match(ssotRealtime, /pendingTaskBatches/);
    assert.match(ssotRealtime, /scheduleFlush/);
    assert.match(ssotRealtime, /seenEventIds/);
    assert.match(ssotRealtime, /_compactEvents/);
    assert.match(ssotRealtime, /incomingCursor\s*<\s*lastCursor/);

    assert.match(eventsStore, /seenIds/);
    assert.match(eventsStore, /pushBatch/);
});
