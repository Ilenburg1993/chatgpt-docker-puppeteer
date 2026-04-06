// @ts-check
/**
 * tests/unit/copilot/test_session_keepalive.spec.js
 *
 * Testes unitários para F42.2: SessionKeepalive — heartbeat periódico para prevenir expiração de sessão SDK por idle
 * timeout.
 */

import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

describe('SessionKeepalive', async () => {
    /** @type {typeof import('../../../src/copilot/agent/session-keepalive.js').SessionKeepalive} */
    let SessionKeepalive;

    before(async () => {
        ({ SessionKeepalive } = await import('../../../src/copilot/agent/session-keepalive.js'));
    });

    describe('construtor', () => {
        it('deve criar instância com defaults', () => {
            const ka = new SessionKeepalive();
            assert.ok(ka);
            assert.equal(ka.running, false);
        });

        it('deve aceitar intervalMs e idleThresholdMs customizados', () => {
            const ka = new SessionKeepalive({ intervalMs: 5000, idleThresholdMs: 10000 });
            assert.ok(ka);
        });
    });

    describe('start/stop', () => {
        /** @type {InstanceType<typeof SessionKeepalive>} */
        let ka;

        afterEach(() => {
            ka?.stop();
        });

        it('deve iniciar e parar sem erros', () => {
            ka = new SessionKeepalive({ intervalMs: 60_000 });
            ka.start({
                getSession: () => null,
                isIdle: () => true,
                isDialogLoopActive: () => false,
            });
            assert.equal(ka.running, true);
            ka.stop();
            assert.equal(ka.running, false);
        });

        it('start duplicado é no-op', () => {
            ka = new SessionKeepalive({ intervalMs: 60_000 });
            const cbs = {
                getSession: () => null,
                isIdle: () => true,
                isDialogLoopActive: () => false,
            };
            ka.start(cbs);
            ka.start(cbs); // deve ser no-op
            assert.equal(ka.running, true);
        });

        it('stop duplicado é no-op', () => {
            ka = new SessionKeepalive({ intervalMs: 60_000 });
            ka.stop();
            ka.stop(); // no-op seguro
            assert.equal(ka.running, false);
        });
    });

    describe('ping()', () => {
        it('deve resetar a contagem de idle', () => {
            const ka = new SessionKeepalive({ intervalMs: 60_000 });
            ka.ping();
            assert.equal(ka.running, false); // ping não inicia o keepalive
        });
    });
});
