// @ts-check
/**
 * tests/unit/copilot/test_always_alive_dialog_loop.spec.js
 *
 * Testes unitários para o Sprint 8 — Modo Diálogo Direto (Dialog Loop):
 *
 * O Dialog Loop implementa o padrão §15.8 — "Agente SDK Sempre Vivo" onde a LLM usa ask_user em loop para comunicação
 * bidirecional com 0 PRs adicionais.
 *
 * E.1 Update: após extração do DialogLoopManager, os testes de análise estrutural agora verificam:
 *
 * - always-alive.js: API pública (métodos de delegação) + referência ao DialogLoopManager
 * - dialog-loop-manager.js: implementação interna (mutex, watchdog, protocolo)
 *
 * Cobre:
 *
 * - startDialogLoop() existe e é uma função assíncrona
 * - sendDialogTurn() existe como método público
 * - stopDialogLoop() existe como método público
 * - Eventos dialog.ready, dialog.reply, dialog.stopped são emitidos corretamente
 * - Interceptação de READY:, REPLY:, DONE:, STOPPED no #handleUserInputRequest
 * - DialogLoopManager delega estado operacional para DialogLoopStateMachine
 * - startDialogLoop() lança erro se status não é 'idle'
 * - sendDialogTurn() lança erro se dialog loop não está ativo
 */

import assert from 'node:assert/strict';
import { beforeAll, describe, it } from 'vitest';

import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─── Suite: análise estrutural do source ─────────────────────────────────────

describe('always-alive › dialog loop: análise estrutural', async () => {
    /** @type {string} */
    let sourceCode = '';
    /** @type {string} */
    let dlmSourceCode = '';
    /** @type {string} */
    let wirerSourceCode = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/agent/always-alive.js', import.meta.url), 'utf-8');
        dlmSourceCode = await readFile(
            new URL('../../../src/copilot/agent/dialog/loop-manager.js', import.meta.url),
            'utf-8',
        );
        wirerSourceCode = await readFile(
            new URL('../../../src/copilot/agent/dialog/event-wiring.js', import.meta.url),
            'utf-8',
        );
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

    it('DialogLoopManager delega estado operacional para DialogLoopStateMachine', () => {
        assert.ok(
            dlmSourceCode.includes('DialogLoopStateMachine') && dlmSourceCode.includes('#state'),
            'DialogLoopManager deve usar DialogLoopStateMachine para active/stopping/paused/resuming',
        );
        assert.ok(
            sourceCode.includes('#dialogLoop') || sourceCode.includes('DialogLoopManager'),
            'always-alive.js deve usar DialogLoopManager via #dialogLoop',
        );
    });

    it('padrão READY: é interceptado no handler do ask_user', () => {
        // RF-D01 (E.1): a lógica foi movida para DialogLoopManager.handleProtocolInput()
        // always-alive.js delega via #dialogLoop.handleProtocolInput()
        assert.ok(
            dlmSourceCode.includes("=== 'ready'") ||
                dlmSourceCode.includes('DialogProtocol.classify') ||
                dlmSourceCode.includes("kind === 'ready'"),
            "DialogLoopManager deve interceptar padrão 'READY:' via DialogProtocol",
        );
    });

    it('padrão REPLY: é interceptado no handler do ask_user', () => {
        // RF-D01 (E.1): lógica em DialogLoopManager
        assert.ok(
            dlmSourceCode.includes("=== 'reply'") ||
                dlmSourceCode.includes('DialogProtocol.classify') ||
                dlmSourceCode.includes("kind === 'reply'"),
            "DialogLoopManager deve interceptar padrão 'REPLY:' via DialogProtocol",
        );
    });

    it('padrão DONE: é interceptado no handler do ask_user', () => {
        // RF-D01 (E.1): DONE: é classificado como 'reply' pelo DialogProtocol
        assert.ok(
            dlmSourceCode.includes("=== 'reply'") ||
                dlmSourceCode.includes('DialogProtocol.classify') ||
                dlmSourceCode.includes("kind === 'reply'"),
            "DialogLoopManager deve interceptar padrão 'DONE:' (classificado como 'reply') via DialogProtocol",
        );
    });

    it("evento 'dialog.ready' é emitido no handler", () => {
        // E.1: always-alive.js propaga via wireDialogLoopEvents (dialog-loop-wirer.js)
        assert.ok(
            sourceCode.includes("emit('dialog.ready'") ||
                (sourceCode.includes("'dialog.ready'") && sourceCode.includes('#dialogLoop')) ||
                wirerSourceCode.includes("'dialog.ready'"),
            "handler deve emitir 'dialog.ready' quando modelo sinalizar READY",
        );
    });

    it("evento 'dialog.reply' é emitido no handler", () => {
        assert.ok(
            sourceCode.includes("emit('dialog.reply'") ||
                (sourceCode.includes("'dialog.reply'") && sourceCode.includes('#dialogLoop')) ||
                wirerSourceCode.includes("'dialog.reply'"),
            "handler deve emitir 'dialog.reply' quando modelo enviar REPLY:",
        );
    });

    it("evento 'dialog.stopped' é emitido no handler e no stopDialogLoop()", () => {
        assert.ok(
            sourceCode.includes("emit('dialog.stopped'") || wirerSourceCode.includes("'dialog.stopped'"),
            "handler deve emitir 'dialog.stopped' quando modelo enviar STOPPED",
        );
    });

    it('meta-prompt de boot inclui instrução READY e REPLY', () => {
        // E.1: o meta-prompt é gerado por DialogProtocol.buildBootPrompt() — verificar no DLM ou dialog-protocol.js
        assert.ok(
            dlmSourceCode.includes('buildBootPrompt') || sourceCode.includes('buildBootPrompt'),
            'startDialogLoop deve usar DialogProtocol.buildBootPrompt()',
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
            /não está ativo|DIALOG_NOT_ACTIVE/,
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
    let dlmSourceCode = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        dlmSourceCode = await readFile(
            new URL('../../../src/copilot/agent/dialog/loop-manager.js', import.meta.url),
            'utf-8',
        );
    });

    it('DialogLoopManager usa sendMessage() do host para boot (não sendAndWait direto)', () => {
        // E.1: DLM usa host.sendMessage() que coloca na fila
        assert.ok(
            dlmSourceCode.includes('host.sendMessage(') || dlmSourceCode.includes('this.#host.sendMessage('),
            'DialogLoopManager deve usar host.sendMessage() para o boot prompt',
        );
    });

    it('DialogLoopManager usa answerPendingQuestion() do host para responder ao modelo', () => {
        assert.ok(
            dlmSourceCode.includes('answerPendingQuestion(message)') ||
                dlmSourceCode.includes('host.answerPendingQuestion('),
            'DialogLoopManager deve usar host.answerPendingQuestion() para alimentar o ask_user',
        );
    });

    it('DialogLoopManager aguarda evento ready antes de resolver start()', () => {
        assert.ok(
            dlmSourceCode.includes("'ready'") && dlmSourceCode.includes('bootPromise'),
            'DialogLoopManager.start() deve aguardar ready via promise antes de resolver',
        );
    });

    it('sendTurn() tem timeout configurável (padrão 60000ms)', () => {
        assert.ok(
            dlmSourceCode.includes('timeout = 60_000') || dlmSourceCode.includes('timeout = 60000'),
            'sendTurn deve ter timeout padrão de 60000ms',
        );
    });

    it('DialogLoopManager envia STOP_DIALOG ao parar o loop', () => {
        assert.ok(
            dlmSourceCode.includes("'STOP_DIALOG'") || dlmSourceCode.includes('"STOP_DIALOG"'),
            "stop() do DialogLoopManager deve enviar 'STOP_DIALOG' ao modelo",
        );
    });

    it('#turnQueue é declarado como campo privado no DialogLoopManager (F59: extraído para TurnQueue)', () => {
        assert.ok(
            dlmSourceCode.includes('#turnQueue'),
            '#turnQueue deve existir para serializar chamadas concorrentes a sendTurn() via TurnQueue',
        );
    });

    it('#executeTurn é declarado como método privado no DialogLoopManager', () => {
        assert.ok(
            dlmSourceCode.includes('#executeTurn('),
            '#executeTurn deve existir como implementação interna serializada',
        );
    });

    it('sendTurn() delega para #turnQueue.enqueue() para serializar execução (F59)', () => {
        assert.ok(
            dlmSourceCode.includes('#turnQueue.enqueue('),
            'sendTurn deve delegar para #turnQueue.enqueue() para serializar execução',
        );
    });
});

// ─── Suite: DL-PERM hardening — watchdog e restart ───────────────────────────

describe('always-alive › dialog loop: DL-PERM hardening', async () => {
    /** @type {string} */
    let dlmSourceCode = '';
    /** @type {string} */
    let turnExecutorCode = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        dlmSourceCode = await readFile(
            new URL('../../../src/copilot/agent/dialog/loop-manager.js', import.meta.url),
            'utf-8',
        );
        // #executeTurn foi extraído para dialog-turn-executor.js na Fase 5
        turnExecutorCode = await readFile(
            new URL('../../../src/copilot/agent/dialog/turn-executor.js', import.meta.url),
            'utf-8',
        );
    });

    it('DL-PERM-04: sendTurn() pinga watchdog antes de serializar o turno', () => {
        // DL-PERM-04: ping do watchdog deve ocorrer dentro de sendTurn, antes do enqueue
        const pingIdx = dlmSourceCode.indexOf('#watchdogSupervisor.ping()');
        const enqueueIdx = dlmSourceCode.indexOf('#turnQueue.enqueue(');
        assert.ok(pingIdx !== -1, 'sendTurn deve chamar this.#watchdogSupervisor.ping()');
        assert.ok(enqueueIdx !== -1, 'sendTurn deve delegar para #turnQueue.enqueue()');
        assert.ok(pingIdx < enqueueIdx, '#watchdogSupervisor.ping() deve ocorrer antes de #turnQueue.enqueue()');
    });

    it('DL-PERM-05: stop() aceita campo reason', () => {
        assert.ok(
            dlmSourceCode.includes("'watchdog_restart'") || dlmSourceCode.includes('watchdog_restart'),
            "stop() deve suportar reason: 'watchdog_restart'",
        );
        assert.ok(
            dlmSourceCode.includes("'authorized_stop'") || dlmSourceCode.includes('authorized_stop'),
            "stop() deve suportar reason: 'authorized_stop'",
        );
    });

    it('DL-PERM-05: stop() emite stopped com campo reason', () => {
        assert.ok(dlmSourceCode.includes("emit('stopped'"), "stop() deve emitir 'stopped'");
        assert.ok(
            dlmSourceCode.includes('{ reason, authorized: true }') ||
                (dlmSourceCode.includes("emit('stopped'") && dlmSourceCode.includes('reason')),
            "stop() deve emitir stopped com campo 'reason'",
        );
    });

    it('DL-PERM-05: #executeTurn distingue stop definitivo de restart ao receber stopped', () => {
        assert.ok(
            dlmSourceCode.includes('stopEvt?.authorized') ||
                dlmSourceCode.includes('stoppedEvt?.authorized') ||
                turnExecutorCode.includes('stopEvt?.authorized') ||
                turnExecutorCode.includes('stoppedEvt?.authorized'),
            '#executeTurn deve verificar authorized para distinguir stop definitivo de restart',
        );
    });

    it('DL-PERM-05: #executeTurn aguarda ready para retry após restart não-definitivo', () => {
        assert.ok(
            (dlmSourceCode.includes("'ready'") && dlmSourceCode.includes('onRetryReady')) ||
                (turnExecutorCode.includes("'ready'") && turnExecutorCode.includes('onRetryReady')),
            '#executeTurn deve aguardar ready e reenviar ao reencontrar após restart',
        );
    });

    it('DL-PERM-05: boot prompt não contém instrução STOP_DIALOG (DL-PERM-06)', () => {
        // metaPrompt de boot não deve referenciar STOP_DIALOG
        const metaPromptIdx = dlmSourceCode.indexOf('metaPrompt');
        const metaPromptSection = dlmSourceCode.slice(metaPromptIdx, metaPromptIdx + 600);
        assert.ok(
            !metaPromptSection.includes('STOP_DIALOG'),
            'metaPrompt de boot não deve instruir modelo a responder ao comando STOP_DIALOG',
        );
        // STOP_DIALOG deve existir no stop() / answerPendingQuestion
        assert.ok(
            dlmSourceCode.includes("'STOP_DIALOG'") || dlmSourceCode.includes('"STOP_DIALOG"'),
            'STOP_DIALOG deve existir no stop() do DialogLoopManager',
        );
    });
});
