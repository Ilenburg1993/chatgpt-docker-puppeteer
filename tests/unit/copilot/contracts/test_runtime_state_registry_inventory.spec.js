// @ts-check

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const SERVER_RUNTIME_STATE_ROOT = join(ROOT, 'server', 'runtime-state');

const EXPECTED_RUNTIME_STATE_FILES = [
    'README.md',
    'copilot-api-dialog.js',
    'copilot-api-stream.js',
    'sdk-session-rate-limit.js',
    'sdk-agent-stream.js',
    'sdk-hooks-stream.js',
    'sdk-session-stream.js',
].sort();

/**
 * @param {string} relPath
 * @returns {string}
 */
function readSrc(relPath) {
    return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('contracts/runtime-state-registry-inventory — registries explícitos de estado vivo server-side', () => {
    it('server/runtime-state contém exatamente os registries documentados desta onda', () => {
        const actual = readdirSync(SERVER_RUNTIME_STATE_ROOT).sort();
        assert.deepEqual(actual, EXPECTED_RUNTIME_STATE_FILES);
    });

    it('rotas críticas não declaram mais Map local para concorrência/stream multi-runtime', () => {
        const files = [
            'server/routes/copilot-api/dialog.js',
            'server/routes/copilot-api/stream.js',
            'server/routes/sdk/agent.js',
            'server/routes/sdk/hooks.js',
            'server/routes/sdk/session-core-routes.js',
            'server/routes/sdk/session-messaging.js',
            'server/routes/sdk/session-stream-state.js',
        ];
        const violations = files.filter((rel) => /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m.test(readSrc(rel)));
        assert.deepEqual(
            violations,
            [],
            `Rotas críticas devem usar registries explícitos, não Maps locais:\n${violations.join('\n')}`,
        );
    });

    it('rotas críticas importam seus registries explícitos correspondentes', () => {
        assert.match(readSrc('server/routes/copilot-api/dialog.js'), /runtime-state\/copilot-api-dialog\.js/);
        assert.match(readSrc('server/routes/copilot-api/stream.js'), /runtime-state\/copilot-api-stream\.js/);
        assert.match(readSrc('server/routes/sdk/agent.js'), /runtime-state\/sdk-agent-stream\.js/);
        assert.match(readSrc('server/routes/sdk/hooks.js'), /runtime-state\/sdk-hooks-stream\.js/);
        assert.match(readSrc('server/routes/sdk/session-core-routes.js'), /session-stream-state\.js/);
        assert.match(readSrc('server/routes/sdk/session-stream-state.js'), /runtime-state\/sdk-session-stream\.js/);
        assert.match(readSrc('server/routes/sdk/session-middleware.js'), /runtime-state\/sdk-session-rate-limit\.js/);
        assert.doesNotMatch(
            readSrc('server/routes/sdk/session-middleware.js'),
            /^\s*(?:const|let)\s+\w+\s*=\s*new Map\(/m,
        );
    });

    it('registries continuam explicitamente chaveados por runtime ou runtime:session', () => {
        const dialogSrc = readSrc('server/runtime-state/copilot-api-dialog.js');
        const streamSrc = readSrc('server/runtime-state/copilot-api-stream.js');
        const agentSrc = readSrc('server/runtime-state/sdk-agent-stream.js');
        const hooksSrc = readSrc('server/runtime-state/sdk-hooks-stream.js');
        const sessionSrc = readSrc('server/runtime-state/sdk-session-stream.js');

        assert.match(dialogSrc, /normalizeRuntimeKey/);
        assert.match(streamSrc, /normalizeRuntimeKey/);
        assert.match(agentSrc, /normalizeRuntimeKey/);
        assert.match(hooksSrc, /normalizeRuntimeKey/);
        assert.match(sessionSrc, /buildSdkSessionStreamKey/);
        assert.match(sessionSrc, /`\$\{runtimeId \|\| 'default'\}:\$\{sessionId\}`/);
    });
});
