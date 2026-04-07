// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave16r: useSocket keeps shared module-level reactive state', async () => {
    const filePath = path.join(process.cwd(), 'src/dashboard-ui/src/composables/useSocket.js');
    const content = await fs.readFile(filePath, 'utf8');

    assert.match(content, /const isConnected = ref\(false\)/);
    assert.match(content, /const error = ref\(null\)/);
    assert.match(content, /const reconnectAttempts = ref\(0\)/);
    assert.match(content, /return \{[\s\S]*isConnected[\s\S]*error[\s\S]*reconnectAttempts[\s\S]*\}/);
    assert.doesNotMatch(content, /export function useSocket[\s\S]*const isConnected = ref\(false\)/);
});
