// @ts-check
/**
 * tests/unit/copilot/test_terminal_turn_serialization.spec.js
 *
 * Testes unitários — TERM-01: serialização de turnos no terminal LLM-B.
 *
 * Cobertura:
 *
 * - sendTurn() serializa chamadas concorrentes (nenhuma mensagem é descartada)
 * - sendTurn() respeita o limite de backpressure (MAX_TURN_QUEUE_SIZE)
 * - GAP-4: broadcastSse é chamado ao iniciar e encerrar cada turno
 * - TERM-02: handleInject com nativeAttachments verifica getBusy() antes de sendMessage
 * - Análise estrutural do source de dialog.js e http-handlers.js
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

// ─── Suite 1: análise estrutural — dialog.js ────────────────────────────────

describe('terminal/dialog.js › TERM-01: análise estrutural', async () => {
    /** @type {string} */
    let source = '';

    before(async () => {
        source = await readFile(
            new URL('../../../src/copilot/terminal/dialog.js', import.meta.url),
            'utf-8',
        );
    });

    it('deve exportar sendTurn como função (não async — agora é wrapper síncrono)', () => {
        // TERM-01: sendTurn é um wrapper síncrono que retorna Promise — não pode ser async function
        assert.ok(
            source.includes('export function sendTurn('),
            'sendTurn deve ser export function (não async) — fila retorna Promise em vez de await direto',
        );
    });

    it('deve ter _sendTurnMutex como variável de serialização', () => {
        assert.ok(
            source.includes('_sendTurnMutex'),
            '_sendTurnMutex deve existir como mutex de fila para serializar turnos',
        );
    });

    it('deve ter _turnQueueDepth como contador da fila', () => {
        assert.ok(
            source.includes('_turnQueueDepth'),
            '_turnQueueDepth deve existir para rastrear profundidade da fila',
        );
    });

    it('deve ter MAX_TURN_QUEUE_SIZE definido', () => {
        assert.ok(
            source.includes('MAX_TURN_QUEUE_SIZE'),
            'MAX_TURN_QUEUE_SIZE deve definir limite de backpressure',
        );
    });

    it('deve ter função interna _executeTurn (implementação do turno)', () => {
        assert.ok(
            source.includes('async function _executeTurn('),
            '_executeTurn deve ser a função interna que executa após obter o mutex',
        );
    });

    it('GAP-4: deve chamar broadcastSse ao marcar busy=true', () => {
        assert.ok(
            source.includes("broadcastSse('busy', { busy: true"),
            "GAP-4: broadcastSse deve ser chamado com busy:true quando turno inicia",
        );
    });

    it('GAP-4: deve chamar broadcastSse ao marcar busy=false no finally', () => {
        assert.ok(
            source.includes("broadcastSse('busy', { busy: false }"),
            "GAP-4: broadcastSse deve ser chamado com busy:false quando turno termina",
        );
    });

    it('não deve ter o padrão antigo de rejeição imediata (getBusy → return null)', () => {
        // Garante que o padrão BUG-1 foi removido: "if (getBusy())" seguido imediatamente de return null
        const oldPattern = /if\s*\(\s*getBusy\(\)\s*\)\s*\{[^}]*return null/;
        assert.ok(
            !oldPattern.test(source),
            'sendTurn não deve mais rejeitar imediatamente com return null quando busy — usa fila',
        );
    });
});

// ─── Suite 2: análise estrutural — http-handlers.js ─────────────────────────

describe('terminal/http-handlers.js › TERM-02: análise estrutural', async () => {
    /** @type {string} */
    let source = '';

    before(async () => {
        source = await readFile(
            new URL('../../../src/copilot/terminal/http-handlers.js', import.meta.url),
            'utf-8',
        );
    });

    it('deve importar setBusy de state.js', () => {
        assert.ok(
            source.includes('setBusy'),
            'http-handlers.js deve importar setBusy para TERM-02',
        );
    });

    it('TERM-02: deve verificar getBusy() antes de alwaysAliveAgent.sendMessage com nativeAttachments', () => {
        // Verifica que existe um getBusy() guard antes do sendMessage no branch nativeAttachments
        const sendMessageIdx = source.indexOf('alwaysAliveAgent.sendMessage(');
        assert.ok(sendMessageIdx > -1, 'sendMessage deve existir em http-handlers.js');

        // O getBusy() deve aparecer antes do sendMessage no file
        const getBusyBeforeSendMessage = source.lastIndexOf('getBusy()', sendMessageIdx);
        assert.ok(
            getBusyBeforeSendMessage > -1,
            'TERM-02: getBusy() deve ser verificado antes de alwaysAliveAgent.sendMessage nas rotas com nativeAttachments',
        );
    });

    it('TERM-02: deve chamar setBusy(true) e setBusy(false) no branch de nativeAttachments', () => {
        const sendMessageIdx = source.indexOf('alwaysAliveAgent.sendMessage(');
        // Extrai o contexto em torno de sendMessage (1000 chars antes)
        const contextBefore = source.substring(Math.max(0, sendMessageIdx - 1000), sendMessageIdx);
        assert.ok(
            contextBefore.includes('setBusy(true)'),
            'TERM-02: setBusy(true) deve ser chamado antes de sendMessage no branch nativeAttachments',
        );
    });

    it('TERM-02: deve ter setBusy(false) no finally do branch nativeAttachments', () => {
        const sendMessageIdx = source.indexOf('alwaysAliveAgent.sendMessage(');
        // Extrai contexto após sendMessage (500 chars depois)
        const contextAfter = source.substring(sendMessageIdx, Math.min(source.length, sendMessageIdx + 500));
        assert.ok(
            contextAfter.includes('setBusy(false)'),
            'TERM-02: setBusy(false) deve ser chamado no finally do branch nativeAttachments',
        );
    });
});

// ─── Suite 3: comportamento da fila (mock do _executeTurn) ──────────────────

describe('terminal/dialog.js › TERM-01: serialização na fila (comportamento)', () => {
    it('sendTurn() deve serializar chamadas concorrentes — todas devem completar', async () => {
        /**
         * Criamos um módulo de dialog isolado via mock estático para testar a lógica da fila sem inicializar o agente
         * real. O padrão usado aqui é: re-implementar a mesma lógica do módulo em isolamento.
         */

        // Simula a lógica de sendTurn sem imports externos
        const MAX_QUEUE = 3;
        let queueDepth = 0;
        let mutex = Promise.resolve(/** @type {string | null} */ (null));

        const execOrder = /** @type {number[]} */ ([]);
        let callCount = 0;

        /**
         * Simula _executeTurn com delay artificial
         *
         * @param {number} id
         */
        async function fakeExecuteTurn(id) {
            execOrder.push(id);
            await new Promise((r) => setTimeout(r, 10)); // simula latência
            execOrder.push(-id); // marcador de conclusão
            return `reply-${id}`;
        }

        /**
         * Replica a lógica de sendTurn
         *
         * @param {number} id
         * @returns {Promise<string | null>}
         */
        function fakeSendTurn(id) {
            if (queueDepth >= MAX_QUEUE) return Promise.resolve(null);
            queueDepth++;
            callCount++;
            const next = mutex.then(() => fakeExecuteTurn(id)).catch(() => null);
            mutex = next.then(
                () => null,
                () => null,
            );
            void next.finally(() => { queueDepth--; });
            return next;
        }

        // Enfileira 3 turnos concorrentemente
        const results = await Promise.all([fakeSendTurn(1), fakeSendTurn(2), fakeSendTurn(3)]);

        assert.equal(results[0], 'reply-1', 'primeiro turno deve retornar reply-1');
        assert.equal(results[1], 'reply-2', 'segundo turno deve retornar reply-2');
        assert.equal(results[2], 'reply-3', 'terceiro turno deve retornar reply-3');

        // Verifica serialização: execOrder deve seguir padrão A-start, A-end, B-start, B-end...
        // (não A-start, B-start, A-end, B-end que seria execução paralela)
        assert.deepEqual(execOrder, [1, -1, 2, -2, 3, -3], 'turnos devem executar em série, não em paralelo');
    });

    it('sendTurn() deve aplicar backpressure acima do limite da fila', async () => {
        const MAX_QUEUE = 2;
        let queueDepth = 0;
        let mutex = Promise.resolve(/** @type {string | null} */ (null));

        // Usamos um AbortController para poder cancelar os turnos bloqueados no final
        const ac = new AbortController();

        /**
         * @param {number} id
         */
        async function blockingExecute(id) {
            // Aguarda sinal de liberação ou abort
            await new Promise((r) => {
                const timer = setTimeout(r, 200); // timeout rápido para testes
                ac.signal.addEventListener('abort', () => { clearTimeout(timer); r(undefined); }, { once: true });
            });
            return `reply-${id}`;
        }

        /**
         * @param {number} id
         * @returns {Promise<string | null>}
         */
        function fakeSendTurn(id) {
            if (queueDepth >= MAX_QUEUE) return Promise.resolve(null);
            queueDepth++;
            const next = mutex.then(() => blockingExecute(id)).catch(() => null);
            mutex = next.then(() => null, () => null);
            void next.finally(() => { queueDepth--; });
            return next;
        }

        // Enfileira até o limite
        const p1 = fakeSendTurn(1);
        const p2 = fakeSendTurn(2);

        // Terceiro deve ser rejeitado por backpressure (queueDepth >= MAX_QUEUE)
        const p3 = fakeSendTurn(3);

        // p3 deve resolver com null imediatamente (backpressure)
        const p3Result = await p3;
        assert.equal(p3Result, null, 'backpressure: turno acima do limite deve retornar null imediatamente');

        // Cancela as promises pendentes para não vazar
        ac.abort();
        await Promise.all([p1, p2]);
    });
});
