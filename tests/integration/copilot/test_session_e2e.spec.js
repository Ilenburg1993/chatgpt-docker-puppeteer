// @ts-check
/**
 * tests/integration/copilot/test_session_e2e.spec.js
 *
 * Teste de integração E2E do ciclo completo de sessão Copilot SDK.
 *
 * Requisito: Copilot Language Server deve estar disponível e autenticado. Este teste conecta ao CLI real, abre sessão,
 * envia mensagem e recebe resposta.
 *
 * Executar isolado: node --strip-types --test tests/integration/copilot/test_session_e2e.spec.js
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { CopilotClient, approveAll } from '@github/copilot-sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout padrão para respostas do modelo */
const MODEL_TIMEOUT_MS = 60_000;

/** Modelo a usar nos testes (pode ser sobrescrito pela env COPILOT_TEST_MODEL) */
const TEST_MODEL = process.env.COPILOT_TEST_MODEL ?? 'gpt-4.1';

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────

describe('Copilot SDK › E2E › ciclo completo de sessão', { timeout: MODEL_TIMEOUT_MS * 3 }, () => {
    /** @type {CopilotClient} */
    let client;

    before(async () => {
        client = new CopilotClient();
        await client.start();
        assert.equal(client.getState(), 'connected', 'Cliente deve estar connected após start()');
    });

    after(async () => {
        if (client) {
            const errors = await client.stop();
            if (errors.length > 0) {
                console.warn(
                    '[test] Erros ao parar cliente:',
                    errors.map((e) => e.message),
                );
            }
        }
    });

    // ─── Teste 1: Criar sessão e verificar atributos ──────────────────────

    it('deve criar sessão com sessionId válido', async () => {
        const session = await client.createSession({
            model: TEST_MODEL,
            onPermissionRequest: approveAll,
        });

        assert.ok(session, 'session deve existir');
        assert.ok(typeof session.sessionId === 'string', 'sessionId deve ser string');
        assert.ok(session.sessionId.length > 0, 'sessionId não pode ser vazio');

        await session.disconnect();
    });

    // ─── Teste 2: Enviar mensagem simples e receber resposta ──────────────

    it('deve receber resposta de mensagem simples', { timeout: MODEL_TIMEOUT_MS }, async () => {
        const session = await client.createSession({
            model: TEST_MODEL,
            onPermissionRequest: approveAll,
        });

        const event = await session.sendAndWait({ prompt: 'Responda somente com a palavra: pong' }, MODEL_TIMEOUT_MS);

        assert.ok(event, 'evento de resposta deve existir');
        assert.equal(event.type, 'assistant.message', 'type deve ser assistant.message');
        assert.ok(typeof event.data?.content === 'string', 'content deve ser string');
        assert.ok(event.data.content.trim().length > 0, 'resposta não pode ser vazia');

        // O modelo deve responder com algo próximo de "pong"
        const lower = event.data.content.toLowerCase();
        assert.ok(lower.includes('pong'), `Resposta esperada conter "pong", recebido: "${event.data.content}"`);

        await session.disconnect();
    });

    // ─── Teste 3: Múltiplas mensagens na mesma sessão (contexto) ─────────

    it('deve manter contexto entre mensagens na mesma sessão', { timeout: MODEL_TIMEOUT_MS * 2 }, async () => {
        const session = await client.createSession({
            model: TEST_MODEL,
            onPermissionRequest: approveAll,
        });

        // 1ª mensagem: estabelecer contexto
        const ev1 = await session.sendAndWait(
            { prompt: 'Lembre-se desta palavra secreta: XAVANTE. Responda com: entendido.' },
            MODEL_TIMEOUT_MS,
        );
        assert.ok(
            ev1?.data?.content?.toLowerCase().includes('entendido'),
            `Esperado "entendido", recebido: "${ev1?.data?.content}"`,
        );

        // 2ª mensagem: testar recuperação de contexto
        const ev2 = await session.sendAndWait(
            { prompt: 'Qual era a palavra secreta que você deveria lembrar?' },
            MODEL_TIMEOUT_MS,
        );
        assert.ok(ev2?.data?.content, 'segunda resposta deve existir');
        const content2 = ev2.data.content.toUpperCase();
        assert.ok(
            content2.includes('XAVANTE'),
            `Contexto não preservado. Esperado "XAVANTE" na resposta, recebido: "${ev2.data.content}"`,
        );

        await session.disconnect();
    });

    // ─── Teste 4: Resumo de sessão (session persistence) ─────────────────

    it('deve retomar sessão por sessionId e manter contexto', { timeout: MODEL_TIMEOUT_MS * 2 }, async () => {
        // Cria sessão original
        const session1 = await client.createSession({
            model: TEST_MODEL,
            onPermissionRequest: approveAll,
        });
        const { sessionId } = session1;

        // Envia mensagem inicial
        await session1.sendAndWait(
            { prompt: 'Lembre-se: código de acesso é ALFA-42. Diga apenas: registrado.' },
            MODEL_TIMEOUT_MS,
        );

        // Desconecta (sem deletar dados)
        await session1.disconnect();

        // Retoma a sessão com o mesmo ID
        const session2 = await client.resumeSession(sessionId, {
            onPermissionRequest: approveAll,
        });

        assert.equal(session2.sessionId, sessionId, 'sessionId deve ser preservado no resume');

        // Verifica contexto preservado
        const ev = await session2.sendAndWait(
            { prompt: 'Qual era o código de acesso que você registrou?' },
            MODEL_TIMEOUT_MS,
        );

        assert.ok(ev?.data?.content, 'resposta na sessão retomada deve existir');
        assert.ok(
            ev.data.content.toUpperCase().includes('ALFA') || ev.data.content.includes('42'),
            `Contexto não preservado após resume. Resposta recebida: "${ev.data.content}"`,
        );

        await session2.disconnect();
    });

    // ─── Teste 5: sendAndWait vs send assíncrono ──────────────────────────

    it('deve suportar send() assíncrono com messageId', async () => {
        const session = await client.createSession({
            model: TEST_MODEL,
            onPermissionRequest: approveAll,
        });

        // send() retorna messageId imediatamente
        const messageId = await session.send({ prompt: 'Apenas calcule: 2 + 2' });

        assert.ok(messageId, 'messageId deve ser retornado');
        assert.ok(
            typeof messageId === 'string' || typeof messageId === 'number',
            'messageId deve ser string ou number',
        );

        await session.disconnect();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite de teste via lib/sdk-client.js (módulo interno do projeto)
// ─────────────────────────────────────────────────────────────────────────────

describe('Copilot SDK › E2E › via lib/sdk-client.js (módulo interno)', { timeout: MODEL_TIMEOUT_MS * 2 }, () => {
    /** @type {import('../../../src/copilot/lib/sdk-client.js')} */
    let sdkClient;

    before(async () => {
        sdkClient = await import('../../../src/copilot/lib/sdk-client.js');
    });

    after(async () => {
        // Parar cliente após testes desta suite
        await sdkClient.stopClient();
    });

    it('deve criar sessão via createClientSession e enviar mensagem', { timeout: MODEL_TIMEOUT_MS }, async () => {
        const session = await sdkClient.createClientSession({
            model: TEST_MODEL,
        });

        assert.ok(session, 'session deve existir');
        const { sessionId } = session;
        assert.ok(typeof sessionId === 'string' && sessionId.length > 0, 'sessionId inválido');

        // Enviar mensagem usando a sessão retornada
        const event = await session.sendAndWait({ prompt: 'Responda somente: ativo' }, MODEL_TIMEOUT_MS);

        assert.ok(event?.data?.content, 'resposta deve existir');
        const lower = event.data.content.toLowerCase();
        assert.ok(lower.includes('ativo'), `Esperado "ativo", recebido: "${event.data.content}"`);

        // Verificar registro no registry interno
        const entry = sdkClient.getClientSession(sessionId);
        assert.ok(entry, 'sessão deve estar no registry interno');
        assert.ok(entry.messagesCount >= 0, 'messagesCount deve existir');

        await sdkClient.disconnectClientSession(sessionId);

        // Após desconectar, não deve mais estar no registry
        const afterDisconnect = sdkClient.getClientSession(sessionId);
        assert.equal(afterDisconnect, undefined, 'sessão deve ser removida do registry após disconnect');
    });

    it('listActiveClientSessions deve refletir sessões ativas', async () => {
        const initial = sdkClient.listActiveClientSessions();

        const session = await sdkClient.createClientSession({ model: TEST_MODEL });
        const { sessionId } = session;

        const afterCreate = sdkClient.listActiveClientSessions();
        assert.ok(afterCreate.length > initial.length, 'deve ter mais sessões após criar');
        assert.ok(
            afterCreate.some((s) => s.sessionId === sessionId),
            'nova sessão deve aparecer em listActiveClientSessions',
        );

        await sdkClient.disconnectClientSession(sessionId);

        const afterDisconnect = sdkClient.listActiveClientSessions();
        assert.ok(
            !afterDisconnect.some((s) => s.sessionId === sessionId),
            'sessão desconectada não deve aparecer em listActiveClientSessions',
        );
    });
});
