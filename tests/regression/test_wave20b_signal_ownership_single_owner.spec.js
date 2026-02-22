import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('wave20b: wrapper PM2 do chrome-proxy mantém ownership único de sinais', async () => {
    const wrapperPath = path.join(process.cwd(), 'scripts/chrome-proxy-service.js');
    const source = await readFile(wrapperPath, 'utf8');

    assert.match(source, /AUTO_HANDLE_SIGNALS:\s*false/, 'wrapper deve desabilitar handlers internos no serviço');
    assert.doesNotMatch(
        source,
        /process\.removeAllListeners\s*\(/,
        'wrapper não deve usar cleanup global de listeners'
    );
});
