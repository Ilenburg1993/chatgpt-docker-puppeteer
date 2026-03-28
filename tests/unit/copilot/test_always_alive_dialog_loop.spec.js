// @ts-check
/**
 * tests/unit/copilot/test_always_alive_dialog_loop.spec.js
 *
 * Testes unitários para o Sprint 8 — Modo Diálogo Direto (Dialog Loop):
 *
 * O Dialog Loop implementa o padrão §15.8 — "Agente SDK Sempre Vivo" onde a LLM usa ask_user em loop para comunicação
 * bidirecional com 0 PRs adicionais.
 *
 * Cobre:
 *
 * - startDialogLoop() existe e é uma função assíncrona
 * - sendDialogTurn() existe como método público
 * - stopDialogLoop() existe como método público
 * - Eventos dialog.ready, dialog.reply, dialog.stopped são emitidos corretamente
 * - Interceptação de READY:, REPLY:, DONE:, STOPPED no #handleUserInputRequest
 * - #dialogLoopActive campo privado está definido no source
 * - startDialogLoop() lança erro se status não é 'idle'
 * - sendDialogTurn() lança erro se dialog loop não está ativo
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─── Suite: análise estrutural do source ─────────────────────────────────────

describe('always-alive › dialog loop: análise estrutural', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    it('startDialogLoop() deve estar definido como método público async', () => {
        assert.ok(sourceCode.includes('async startDialogLoop('), 'startDialogLoop() deve ser método público async');
    });

    it('sendDialogTurn() deve estar definido como método público', () => {
        assert.ok(sourceCode.includes('sendDialogTurn('), 'sendDialogTurn() deve ser método público');
    });

    it('stopDialogLoop() deve estar definido como método público async', () => {
        assert.ok(sourceCode.includes('async stopDialogLoop('), 'stopDialogLoop() deve ser método público async');
    });

    it('#dialogLoopActive campo privado está definido', () => {
        assert.ok(
            sourceCode.includes('#dialogLoopActive = false'),
            '#dialogLoopActive deve ser inicializado como false',
        );
    });

    it('padrão READY: é interceptado no handler do ask_user', () => {
        assert.ok(
            sourceCode.includes("startsWith('READY:')") || sourceCode.includes("'READY:'"),
            "handler deve interceptar padrão 'READY:' do dialog loop",
        );
    });

    it('padrão REPLY: é interceptado no handler do ask_user', () => {
        assert.ok(
            sourceCode.includes("startsWith('REPLY:')") || sourceCode.includes("'REPLY:'"),
            "handler deve interceptar padrão 'REPLY:' do dialog loop",
        );
    });

    it('padrão DONE: é interceptado no handler do ask_user', () => {
        assert.ok(
            sourceCode.includes("startsWith('DONE:')") || sourceCode.includes("'DONE:'"),
            "handler deve interceptar padrão 'DONE:' do dialog loop",
        );
    });

    it("evento 'dialog.ready' é emitido no handler", () => {
        assert.ok(
            sourceCode.includes("emit('dialog.ready'"),
            "handler deve emitir 'dialog.ready' quando modelo sinalizar READY",
        );
    });

    it("evento 'dialog.reply' é emitido no handler", () => {
        assert.ok(
            sourceCode.includes("emit('dialog.reply'"),
            "handler deve emitir 'dialog.reply' quando modelo enviar REPLY:",
        );
    });

    it("evento 'dialog.stopped' é emitido no handler e no stopDialogLoop()", () => {
        assert.ok(
            sourceCode.includes("emit('dialog.stopped'"),
            "handler deve emitir 'dialog.stopped' quando modelo enviar STOPPED",
        );
    });

    it('meta-prompt de boot inclui instrução READY e REPLY', () => {
        assert.ok(
            sourceCode.includes('READY') && sourceCode.includes('REPLY:'),
            'meta-prompt deve instruir o modelo a usar READY e REPLY:',
        );
    });
});

// ─── Suite: comportamento observável via eventos ──────────────────────────────

describe('always-alive › dialog loop: comportamento via eventos', () => {
    it('startDialogLoop() tipo é função', () => {
        assert.equal(typeof alwaysAliveAgent.startDialogLoop, 'function');
    });

    it('sendDialogTurn() tipo é função', () => {
        assert.equal(typeof alwaysAliveAgent.sendDialogTurn, 'function');
    });

    it('stopDialogLoop() tipo é função', () => {
        assert.equal(typeof alwaysAliveAgent.stopDialogLoop, 'function');
    });

    it('stopDialogLoop() é idempotente quando loop não está ativo', async () => {
        // Não deve lançar quando chamado sem loop ativo
        await assert.doesNotReject(() => alwaysAliveAgent.stopDialogLoop());
    });

    it('sendDialogTurn() lança se dialog loop não está ativo', async () => {
        await assert.rejects(
            () => alwaysAliveAgent.sendDialogTurn('Olá', { timeout: 100 }),
            /Modo diálogo não está ativo/,
            'sendDialogTurn() deve rejeitar se loop não está ativo',
        );
    });

    it('startDialogLoop() lança se status não é idle (agente stopped)', async () => {
        // alwaysAliveAgent está 'stopped' no ambiente de teste (não foi start()ed)
        assert.equal(alwaysAliveAgent.status, 'stopped');
        await assert.rejects(
            () => alwaysAliveAgent.startDialogLoop(),
            /startDialogLoop\(\) requer status 'idle'/,
            'startDialogLoop() deve rejeitar se agente não está idle',
        );
    });

    it('eventos dialog.ready, dialog.reply, dialog.stopped podem ser subscritados', () => {
        const events = ['dialog.ready', 'dialog.reply', 'dialog.stopped'];
        for (const evt of events) {
            const h = () => {};
            alwaysAliveAgent.on(evt, h);
            assert.ok(alwaysAliveAgent.listenerCount(evt) >= 1, `evento '${evt}' deve ser subscritável`);
            alwaysAliveAgent.off(evt, h);
        }
    });
});

// ─── Suite: protocolo do dialog loop ─────────────────────────────────────────

describe('always-alive › dialog loop: protocolo 0-PR', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    it('startDialogLoop() usa sendMessage() para boot (não sendAndWait direto)', () => {
        // O método usa sendMessage() que coloca na fila, não session.sendAndWait diretamente.
        // Aceita qualquer chamada que inicie com this.sendMessage(metaPrompt), com ou sem opções extras.
        assert.ok(
            sourceCode.includes('this.sendMessage(metaPrompt'),
            'startDialogLoop deve usar this.sendMessage() para o boot prompt',
        );
    });

    it('sendDialogTurn() usa answerPendingQuestion() para responder ao modelo', () => {
        assert.ok(
            sourceCode.includes('this.answerPendingQuestion(message)'),
            'sendDialogTurn deve usar answerPendingQuestion() para alimentar o ask_user',
        );
    });

    it('startDialogLoop() aguarda evento dialog.ready antes de resolver', () => {
        assert.ok(
            sourceCode.includes("'dialog.ready'") && sourceCode.includes('bootPromise'),
            'startDialogLoop deve aguardar dialog.ready via promise antes de resolver',
        );
    });

    it('sendDialogTurn() tem timeout configurável (padrão 60000ms)', () => {
        assert.ok(
            sourceCode.includes('timeout = 60_000') || sourceCode.includes('timeout = 60000'),
            'sendDialogTurn deve ter timeout padrão de 60000ms',
        );
    });

    it('stopDialogLoop() chama answerPendingQuestion com STOP_DIALOG', () => {
        assert.ok(
            sourceCode.includes("answerPendingQuestion('STOP_DIALOG')"),
            "stopDialogLoop deve enviar 'STOP_DIALOG' para o modelo",
        );
    });

    it('#dialogTurnMutex é declarado como campo privado', () => {
        assert.ok(
            sourceCode.includes('#dialogTurnMutex'),
            '#dialogTurnMutex deve existir para serializar chamadas concorrentes a sendDialogTurn()',
        );
    });

    it('#executeDialogTurn é declarado como método privado', () => {
        assert.ok(
            sourceCode.includes('#executeDialogTurn('),
            '#executeDialogTurn deve existir como implementação interna serializada',
        );
    });

    it('sendDialogTurn() encadeia no #dialogTurnMutex antes de executar', () => {
        // Verifica o padrão do mutex: prev.then(() => this.#executeDialogTurn(...))
        assert.ok(
            sourceCode.includes('this.#dialogTurnMutex') && sourceCode.includes('prev.then'),
            'sendDialogTurn deve encadear chamadas via #dialogTurnMutex para serializar execução',
        );
    });
});

// ─── Suite: DL-PERM hardening — watchdog e restart ───────────────────────────

describe('always-alive › dialog loop: DL-PERM hardening', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
    });

    it('DL-PERM-04: sendDialogTurn() pinga watchdog antes de serializar o turno', () => {
        // DL-PERM-04: #watchdog?.ping() deve ocorrer dentro de sendDialogTurn, antes do
        // encadeamento no mutex (const prev = this.#dialogTurnMutex).
        // Usar as posições exatas das duas linhas no sendDialogTurn (após a declaração de class).
        const pingIdx = sourceCode.indexOf('#watchdog?.ping()');
        const prevMutexIdx = sourceCode.indexOf('const prev = this.#dialogTurnMutex');
        assert.ok(pingIdx !== -1, 'sendDialogTurn deve chamar this.#watchdog?.ping()');
        assert.ok(prevMutexIdx !== -1, 'sendDialogTurn deve ter "const prev = this.#dialogTurnMutex"');
        assert.ok(
            pingIdx < prevMutexIdx,
            '#watchdog?.ping() deve ocorrer antes de "const prev = this.#dialogTurnMutex"',
        );
    });

    it('DL-PERM-05: stopDialogLoop() aceita campo reason', () => {
        // reason: 'watchdog_restart' | 'authorized_stop' — distingue restart automático de encerramento definitivo
        assert.ok(
            sourceCode.includes("'watchdog_restart'") || sourceCode.includes('watchdog_restart'),
            "stopDialogLoop deve suportar reason: 'watchdog_restart'",
        );
        assert.ok(
            sourceCode.includes("'authorized_stop'") || sourceCode.includes('authorized_stop'),
            "stopDialogLoop deve suportar reason: 'authorized_stop'",
        );
    });

    it('DL-PERM-05: stopDialogLoop() emite dialog.stopped com campo reason', () => {
        // O evento emitido deve incluir { reason, authorized: true }
        assert.ok(sourceCode.includes("emit('dialog.stopped'"), "stopDialogLoop deve emitir 'dialog.stopped'");
        // Verificar que reason está no objeto emitido — o emit deve incluir { reason, authorized: true }
        assert.ok(
            sourceCode.includes('{ reason, authorized: true }') ||
                sourceCode.includes('{ reason: effectiveReason') ||
                (sourceCode.includes("emit('dialog.stopped'") && sourceCode.includes('reason')),
            "stopDialogLoop deve emitir dialog.stopped com campo 'reason'",
        );
    });

    it('DL-PERM-05: #executeDialogTurn distingue stop definitivo de restart ao receber dialog.stopped', () => {
        // onStopOuter deve checar authorized (true = definitivo) vs false (restart → retry)
        assert.ok(
            sourceCode.includes('stopEvt?.authorized') || sourceCode.includes('stoppedEvt?.authorized'),
            '#executeDialogTurn deve verificar authorized para distinguir stop definitivo de restart',
        );
    });

    it('DL-PERM-05: #executeDialogTurn aguarda dialog.ready para retry após restart não-definitivo', () => {
        // Implementação do DL-PERM-09: ao receber dialog.stopped com authorized=false,
        // o turno deve aguardar dialog.ready antes de retentar
        assert.ok(
            sourceCode.includes("'dialog.ready'") && sourceCode.includes('onRetryReady'),
            '#executeDialogTurn deve aguardar dialog.ready e reenviar ao reencarar após restart',
        );
    });

    it('DL-PERM-05: boot prompt não contém instrução STOP_DIALOG (DL-PERM-06)', () => {
        // Boot prompt não deve instruir o modelo a responder ao comando STOP_DIALOG
        // (conflito com a política DL-PERM de loop eterno)
        // Verificar que a string STOP_DIALOG SÓ aparece em código funcional (answerPendingQuestion),
        // não no meta-prompt de boot
        const stopDialogIdx = sourceCode.indexOf('STOP_DIALOG');
        const metaPromptIdx = sourceCode.indexOf('metaPrompt');
        // O metaPrompt de boot não deve referenciar STOP_DIALOG dentro de sua string
        const metaPromptSection = sourceCode.slice(metaPromptIdx, metaPromptIdx + 600);
        assert.ok(
            !metaPromptSection.includes('STOP_DIALOG'),
            'metaPrompt de boot não deve instruir modelo a responder ao comando STOP_DIALOG',
        );
        // ... mas answerPendingQuestion('STOP_DIALOG') ainda deve existir
        assert.ok(
            stopDialogIdx !== -1 && sourceCode.includes("answerPendingQuestion('STOP_DIALOG')"),
            "answerPendingQuestion('STOP_DIALOG') deve existir no stopDialogLoop()",
        );
    });
});
