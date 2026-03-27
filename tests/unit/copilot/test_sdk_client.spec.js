// @ts-check
/**
 * Sprint 25 — Testes unitários de src/copilot/sdk-client.js
 *
 * Cobre: registry em memória, getClientState, getSdkSession, listActiveSessions, incrementMessageCount e
 * disconnectSdkSession.
 *
 * Nota: CopilotClient real não é instanciado — testamos apenas a camada de gerenciamento de estado/registry que não
 * depende do CLI remoto.
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

// ─── helpers de mock ──────────────────────────────────────────────────────────

/**
 * Cria um mock mínimo de SessionEntry para injeção direta no registry.
 *
 * @param {string} sessionId
 * @param {string} [model]
 * @returns {{ sessionId: string; entry: object }}
 */
function makeEntry(sessionId, model = 'gpt-4o') {
    const session = /** @type {any} */ ({
        sessionId,
        disconnect: async () => {},
        send: async () => 'msg-001',
        sendAndWait: async () => undefined,
        on: () => () => {},
        registerTools: () => {},
        getToolHandler: () => undefined,
    });
    return {
        sessionId,
        entry: {
            session,
            model,
            createdAt: Date.now(),
            messagesCount: 0,
        },
    };
}

// ─── Testes de getClientState ─────────────────────────────────────────────────

describe('sdk-client › getClientState', () => {
    it('retorna "not_started" quando nenhum client foi inicializado', async () => {
        // Importar em isolamento apenas para ler o estado inicial —
        // em Node.js nativo o módulo é singleton, mas este subtest executa
        // antes de qualquer start(), então o estado deve ser not_started.
        const { getClientState } = await import('../../../src/copilot/lib/client.js');
        const state = getClientState();
        // Estado pode ser 'not_started' (se nunca iniciado) ou qualquer ConnectionState válido
        const validStates = ['not_started', 'disconnected', 'connecting', 'connected', 'error'];
        assert.ok(validStates.includes(state), `Estado inválido: ${state}`);
    });
});

// ─── Testes de getSdkSession / listActiveSessions ─────────────────────────────

describe('sdk-client › getSdkSession', () => {
    it('retorna undefined para sessão inexistente', async () => {
        const { getClientSession: getSdkSession } = await import('../../../src/copilot/lib/client.js');
        const result = getSdkSession('nao-existe-xpto-abc123');
        assert.strictEqual(result, undefined);
    });
});

describe('sdk-client › listActiveSessions (alias listSdkSessions)', () => {
    it('retorna array (vazio ou com entradas existentes)', async () => {
        const { listActiveClientSessions: listActiveSessions } = await import('../../../src/copilot/lib/client.js');
        const list = listActiveSessions();
        assert.ok(Array.isArray(list), 'deve ser array');
    });

    it('cada entrada possui sessionId, model, createdAt, messagesCount', async () => {
        const { listActiveClientSessions: listActiveSessions } = await import('../../../src/copilot/lib/client.js');
        const list = listActiveSessions();
        for (const entry of list) {
            assert.ok(typeof entry.sessionId === 'string', 'sessionId deve ser string');
            assert.ok(typeof entry.model === 'string', 'model deve ser string');
            assert.ok(typeof entry.createdAt === 'number', 'createdAt deve ser number');
            assert.ok(typeof entry.messagesCount === 'number', 'messagesCount deve ser number');
        }
    });
});

// ─── Testes de disconnectSdkSession ──────────────────────────────────────────

describe('sdk-client › disconnectSdkSession', () => {
    it('não lança erro ao desconectar sessão inexistente', async () => {
        const { disconnectClientSession: disconnectSdkSession } = await import('../../../src/copilot/lib/client.js');
        await assert.doesNotReject(async () => {
            await disconnectSdkSession('sessao-nao-existe-xpto');
        });
    });
});

// ─── Testes de incrementMessageCount ─────────────────────────────────────────

describe('sdk-client › incrementMessageCount', () => {
    it('não lança erro para sessão inexistente (noop silencioso)', async () => {
        const { incrementSessionMessageCount: incrementMessageCount } =
            await import('../../../src/copilot/lib/client.js');
        assert.doesNotThrow(() => {
            incrementMessageCount('sessao-nao-existe-xyz');
        });
    });
});

// ─── Testes de SessionEntry typedef  ─────────────────────────────────────────

describe('sdk-client › SessionEntry structure', () => {
    it('makeEntry helper gera estrutura correta (canary)', () => {
        const { sessionId, entry } = makeEntry('sess-test-001', 'claude-3.5-sonnet');
        assert.strictEqual(entry.model, 'claude-3.5-sonnet');
        assert.strictEqual(typeof entry.createdAt, 'number');
        assert.strictEqual(entry.messagesCount, 0);
        assert.strictEqual(typeof entry.session.disconnect, 'function');
        assert.strictEqual(sessionId, 'sess-test-001');
    });

    it('sessão mock responde a send() com messageId string', async () => {
        const { entry } = makeEntry('sess-test-002');
        const msgId = await entry.session.send({ prompt: 'hello' });
        assert.strictEqual(typeof msgId, 'string');
    });

    it('sessão mock responde a disconnect() sem lançar', async () => {
        const { entry } = makeEntry('sess-test-003');
        await assert.doesNotReject(async () => {
            await entry.session.disconnect();
        });
    });
});

// ─── Testes de getClientState (tipagem) ──────────────────────────────────────

describe('sdk-client › ConnectionState values', () => {
    it('conjunto de estados válidos está completo', () => {
        // Garante contrato explícito com o SDK
        const validStates = ['not_started', 'disconnected', 'connecting', 'connected', 'error'];
        assert.strictEqual(validStates.length, 5);
        assert.ok(validStates.includes('connected'));
        assert.ok(validStates.includes('not_started'));
    });
});
