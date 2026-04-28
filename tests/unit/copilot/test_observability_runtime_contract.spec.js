// @ts-check
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'vitest';

const root = '/workspaces/chatgpt-docker-puppeteer/src/copilot';

function read(/** @type {string} */ relPath) {
    return readFileSync(path.join(root, relPath), 'utf8');
}

describe('observability runtime contract', () => {
    it('bootstrap usa o runtime canônico do EventBus', () => {
        const src = read('observability/bootstrap.js');
        assert.match(src, /attachObservabilityBusRuntime/);
    });

    it('bootstrap projeta métricas SDK no bridge observável canônico', () => {
        const bootstrapSrc = read('observability/bootstrap.js');
        const bridgeSrc = read('observability/sdk-metric-bridge.js');
        assert.match(bootstrapSrc, /projectSdkOperationMetric/);
        assert.match(bridgeSrc, /type: 'sdk:operation:metric'/);
    });

    it('event-bus-observers (shim legado) foi removido', () => {
        const shimPath = path.join(root, 'observability/event-bus-observers.js');
        assert.equal(existsSync(shimPath), false);
    });

    it('health-registry registra health do módulo observability', () => {
        const src = read('server/routes/health-registry.js');
        assert.match(src, /registerModuleHealth\('observability'/);
        assert.match(src, /getObservabilityBusDiagnostics/);
    });

    it('agent-event-observer não usa dummyAgent em attachToBus (T-OBS-06)', () => {
        const src = read('observability/agent-event-observer.js');
        // dummyAgent foi removido — bus mode usa agent: null
        assert.doesNotMatch(src, /dummyAgent/);
        // attachToBus passa agent: null explicitamente
        assert.match(src, /agent: null/);
        // ObserverContext.agent aceita null (tipo alargado)
        const ctx = read('observability/observers/context.js');
        assert.match(ctx, /EventEmitter \| null/);
    });
});
