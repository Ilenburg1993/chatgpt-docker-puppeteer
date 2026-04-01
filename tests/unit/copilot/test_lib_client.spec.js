// @ts-check
/**
 * Sprint 10 — Testes unitários de src/copilot/lib/sdk-client.js
 *
 * Cobre: buildClientOptions, getClientState (estado inicial), registry de sessoes, e helpers que nao requerem CLI
 * conectado.
 *
 * CopilotClient real NAO e instanciado — testamos apenas as funcoes de estado/registry.
 */
import assert from 'node:assert';
import { afterEach, describe, it } from 'node:test';

// ─── buildClientOptions ──────────────────────────────────────────────────────

describe('lib/sdk-client › buildClientOptions', () => {
    afterEach(() => {
        delete process.env.COPILOT_CLI_URL;
    });

    it('retorna objeto vazio quando COPILOT_CLI_URL nao definida', async () => {
        delete process.env.COPILOT_CLI_URL;
        const { buildClientOptions } = await import('../../../src/copilot/lib/sdk-client.js');
        const opts = buildClientOptions();
        assert.ok(typeof opts === 'object');
        assert.strictEqual(opts.cliUrl, undefined);
    });

    it('inclui cliUrl quando COPILOT_CLI_URL definida', async () => {
        process.env.COPILOT_CLI_URL = 'http://localhost:1234';
        const { buildClientOptions } = await import('../../../src/copilot/lib/sdk-client.js');
        const opts = /** @type {any} */ (buildClientOptions());
        assert.strictEqual(opts.cliUrl, 'http://localhost:1234');
    });

    it('overrides sobrescrevem as opcoes padrao', async () => {
        const { buildClientOptions } = await import('../../../src/copilot/lib/sdk-client.js');
        const opts = buildClientOptions({ logLevel: /** @type {any} */ ('debug') });
        assert.strictEqual(/** @type {any} */ (opts).logLevel, 'debug');
    });
});

// ─── getClientState ──────────────────────────────────────────────────────────

describe('lib/sdk-client › getClientState', () => {
    it('retorna not_started quando client nao foi iniciado', async () => {
        const { getClientState } = await import('../../../src/copilot/lib/sdk-client.js');
        const state = getClientState();
        const valid = ['not_started', 'disconnected', 'connecting', 'connected', 'error'];
        assert.ok(valid.includes(state), `Estado invalido: ${state}`);
    });
});

// ─── registry de sessoes ─────────────────────────────────────────────────────

describe('lib/sdk-client › getClientSession', () => {
    it('retorna undefined para ID inexistente', async () => {
        const { getClientSession } = await import('../../../src/copilot/lib/sdk-client.js');
        assert.strictEqual(getClientSession('nao-existe-abc123'), undefined);
    });
});

describe('lib/sdk-client › listActiveClientSessions', () => {
    it('retorna array', async () => {
        const { listActiveClientSessions } = await import('../../../src/copilot/lib/sdk-client.js');
        const list = listActiveClientSessions();
        assert.ok(Array.isArray(list));
    });

    it('cada entrada tem sessionId, model, createdAt, messagesCount', async () => {
        const { listActiveClientSessions } = await import('../../../src/copilot/lib/sdk-client.js');
        for (const entry of listActiveClientSessions()) {
            assert.ok(typeof entry.sessionId === 'string');
            assert.ok(typeof entry.model === 'string');
            assert.ok(typeof entry.createdAt === 'number');
            assert.ok(typeof entry.messagesCount === 'number');
        }
    });
});

describe('lib/sdk-client › disconnectClientSession', () => {
    it('nao lanca erro para sessao inexistente', async () => {
        const { disconnectClientSession } = await import('../../../src/copilot/lib/sdk-client.js');
        await assert.doesNotReject(() => disconnectClientSession('nao-existe-xyz'));
    });
});

describe('lib/sdk-client › incrementSessionMessageCount', () => {
    it('nao lanca erro para sessao inexistente', async () => {
        const { incrementSessionMessageCount } = await import('../../../src/copilot/lib/sdk-client.js');
        assert.doesNotThrow(() => incrementSessionMessageCount('nao-existe-xyz'));
    });

    it('retorna 0 para sessao inexistente', async () => {
        const { incrementSessionMessageCount } = await import('../../../src/copilot/lib/sdk-client.js');
        const count = incrementSessionMessageCount('nao-existe-xyz');
        assert.strictEqual(count, 0);
    });
});
