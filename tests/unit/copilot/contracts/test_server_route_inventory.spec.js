// @ts-check

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const ROUTES_ROOT = join(ROOT, 'server', 'routes');

const SERVER_ROUTE_INVENTORY = {
    runtimeAware: [
        'agent-health.js',
        'copilot-api/control.js',
        'copilot-api/dialog.js',
        'copilot-api/stream.js',
        'copilot-api/tasks.js',
        'health.js',
        'sdk/agent.js',
        'sdk/client.js',
        'sdk/hooks.js',
        'sdk/observability.js',
        'sdk/session-core-routes.js',
        'sdk/session-crud.js',
        'sdk/session-rpc-routes.js',
        'sdk/session-ui-routes.js',
        'sdk/session-workspace-routes.js',
        'webhooks.js',
    ],
    hubOnly: ['sessions.js', 'sse.js'],
    serverOnly: ['health-modules.js', 'health-registry.js'],
    presentationBridge: ['agent.js', 'config.js', 'git.js', 'memory.js', 'observability.js'],
    routeAdapter: ['presentation-route.js'],
    routerInfra: [
        'copilot-api/index.js',
        'module-map.js',
        'sdk/deps.js',
        'sdk/index.js',
        'sdk/middleware.js',
        'sdk/session-messaging.js',
        'sdk/session-middleware.js',
        'sdk/session-route-helpers.js',
        'sdk/session-schemas.js',
        'sdk/session-send-helpers.js',
        'sdk/session-stream-state.js',
        'sdk/session-workspace-helpers.js',
        'sdk/sessions.js',
    ],
};

/**
 * @param {string} dirAbs
 * @returns {string[]}
 */
function listJsFilesRecursive(dirAbs) {
    /** @type {string[]} */
    const out = [];
    for (const entry of readdirSync(dirAbs)) {
        const abs = join(dirAbs, entry);
        const st = statSync(abs);
        if (st.isDirectory()) {
            out.push(...listJsFilesRecursive(abs));
            continue;
        }
        if (st.isFile() && entry.endsWith('.js')) {
            out.push(
                abs
                    .replace(ROUTES_ROOT, '')
                    .replace(/^[/\\]/, '')
                    .replace(/\\/g, '/'),
            );
        }
    }
    return out.sort();
}

/**
 * @param {string} relPath
 * @returns {string}
 */
function readRoute(relPath) {
    return readFileSync(join(ROUTES_ROOT, relPath), 'utf8');
}

describe('contracts/server-route-inventory — rotas agent-runtime vs hub/server-only', () => {
    it('todo arquivo de server/routes está classificado em exatamente uma categoria', () => {
        const files = listJsFilesRecursive(ROUTES_ROOT);
        const categories = Object.entries(SERVER_ROUTE_INVENTORY);
        const classified = categories.flatMap(([, entries]) => entries).sort();
        const duplicates = classified.filter((entry, index) => classified.indexOf(entry) !== index);

        assert.deepEqual(duplicates, [], `Rotas duplicadas no inventário:\n${duplicates.join('\n')}`);
        assert.deepEqual(classified, files, 'Inventário deve cobrir exatamente src/copilot/server/routes/**/*.js.');
    });

    it('rotas hub/server-only não carregam metadata runtime nem agent público', () => {
        const files = [...SERVER_ROUTE_INVENTORY.hubOnly, ...SERVER_ROUTE_INVENTORY.serverOnly];
        const violations = files.filter((rel) => {
            const src = readRoute(rel);
            return /runtime-meta|runtime-request|#copilot\/agent/.test(src);
        });

        assert.deepEqual(
            violations,
            [],
            `Rotas hub/server-only não devem parecer dívida de runtime agent:\n${violations.join('\n')}`,
        );
    });

    it('health.js mantém /health/agent runtime-aware separado de /ws/info server-only', () => {
        const src = readRoute('health.js');

        assert.match(src, /router\.get\(['"]\/health\/agent['"]/);
        assert.match(src, /buildAgentHealthHttpResponse\(resolveRequestedRuntimeId\(req\)\)/);
        assert.match(src, /router\.get\(['"]\/ws\/info['"]/);
        assert.match(src, /getCopilotNamespace\(\)/);
    });

    it('sessions.js é adapter HTTP fino sobre presentation/conversation-hub', () => {
        const src = readRoute('sessions.js');

        assert.match(src, /presentation\/conversation-hub\.js/);
        assert.match(src, /createPresentationRoute\(handleGetHubSession/);
        assert.match(src, /createPresentationRoute\(handleCreateHubSession/);
        assert.match(src, /createPresentationRoute\(handleCloseHubSession/);
        assert.doesNotMatch(src, /CONVERSATION_STORE/);
        assert.doesNotMatch(src, /container/);
        assert.doesNotMatch(src, /getSharedSdkSessionId/);
        assert.doesNotMatch(src, /sanitizeHttpErrorMessage/);
    });

    it('presentationBridge routes delegam domínio para presentation e não reabrem estado/runtime local', () => {
        const forbidden = [
            /#copilot\/agent/,
            /#copilot\/observability/,
            /container(?:\.resolve)?/,
            /CONVERSATION_STORE/,
            /getSharedSdkSessionId/,
        ];

        const violations = SERVER_ROUTE_INVENTORY.presentationBridge.flatMap((rel) => {
            const src = readRoute(rel);
            const hasPresentation = /\.\.\/\.\.\/presentation\//.test(src);
            if (!hasPresentation) {
                return [`${rel} -> sem import de presentation/*`];
            }
            return forbidden.filter((pattern) => pattern.test(src)).map((pattern) => `${rel} -> ${pattern}`);
        });

        assert.deepEqual(
            violations,
            [],
            `Rotas presentationBridge devem permanecer adapters finos:\n${violations.join('\n')}`,
        );
    });
});
