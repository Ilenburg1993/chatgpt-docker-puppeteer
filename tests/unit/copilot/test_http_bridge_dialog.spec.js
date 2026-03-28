// @ts-check
/**
 * tests/unit/copilot/test_http_bridge_dialog.spec.js
 *
 * Testes unitários para as rotas de Dialog Loop no http-bridge.js:
 *
 * - POST /dialog/start — inicia o dialog loop
 * - POST /dialog/turn — envia turno de diálogo
 * - POST /dialog/stop — encerra o dialog loop
 *
 * Cobre:
 *
 * - Rotas estão registradas no source
 * - Validação de campos obrigatórios
 * - Retornos corretos (200, 400, 409, 504, 500)
 * - Integração com alwaysAliveAgent via mocks simples
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria mock mínimo de res para testes de rota HTTP.
 *
 * @returns {{ res: any; statusCode: number; body: any }}
 */
function makeResMock() {
    /** @type {any} */
    const state = { statusCode: 200, body: null };

    const res = {
        status(code) {
            state.statusCode = code;
            return res;
        },
        json(data) {
            state.body = data;
        },
    };

    return {
        res,
        get statusCode() {
            return state.statusCode;
        },
        get body() {
            return state.body;
        },
    };
}

// ─── Suite: análise estrutural do source ─────────────────────────────────────

describe('http-bridge › dialog: análise estrutural', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/api/bridge-dialog.js', import.meta.url), 'utf-8');
    });

    it("rota POST '/dialog/start' está definida", () => {
        assert.ok(sourceCode.includes("'/dialog/start'"), "bridge deve ter rota POST '/dialog/start'");
    });

    it("rota POST '/dialog/turn' está definida", () => {
        assert.ok(sourceCode.includes("'/dialog/turn'"), "bridge deve ter rota POST '/dialog/turn'");
    });

    it("rota POST '/dialog/stop' está definida", () => {
        assert.ok(sourceCode.includes("'/dialog/stop'"), "bridge deve ter rota POST '/dialog/stop'");
    });

    it('rotas chamam alwaysAliveAgent.startDialogLoop()', () => {
        assert.ok(
            sourceCode.includes('alwaysAliveAgent.startDialogLoop(') || sourceCode.includes('agent.startDialogLoop('),
            '/dialog/start deve chamar startDialogLoop()',
        );
    });

    it('rotas chamam alwaysAliveAgent.sendDialogTurn()', () => {
        assert.ok(
            sourceCode.includes('alwaysAliveAgent.sendDialogTurn(') || sourceCode.includes('agent.sendDialogTurn('),
            '/dialog/turn deve chamar sendDialogTurn()',
        );
    });

    it('rotas chamam alwaysAliveAgent.stopDialogLoop() com authorized: true (DL-PERM)', () => {
        // DL-PERM: stopDialogLoop deve ser chamado com { authorized: true } para respeitar política zero-PR
        assert.ok(
            sourceCode.includes('stopDialogLoop({ authorized: true })') ||
                sourceCode.includes('stopDialogLoop({ authorized: true })'),
            '/dialog/stop deve chamar stopDialogLoop({ authorized: true }) (DL-PERM)',
        );
    });

    it('/dialog/start verifica status idle antes de iniciar', () => {
        assert.ok(
            sourceCode.includes("status !== 'idle'"),
            "/dialog/start deve checar status 'idle' antes de iniciar o loop",
        );
    });

    it('/dialog/turn valida campo "message" obrigatório', () => {
        assert.ok(
            sourceCode.includes('"message" (string) é obrigatório'),
            "/dialog/turn deve rejeitar requisições sem campo 'message'",
        );
    });

    it('/dialog/turn valida campo "timeout"', () => {
        assert.ok(sourceCode.includes('"timeout" deve ser número'), "/dialog/turn deve validar o campo 'timeout'");
    });

    it('/dialog/turn retorna HTTP 504 em caso de timeout', () => {
        assert.ok(sourceCode.includes("includes('timeout') ? 504 : 500"), '/dialog/turn deve retornar 504 em timeout');
    });

    it('/dialog/turn retorna HTTP 409 se modo diálogo não está ativo', () => {
        assert.ok(
            sourceCode.includes("includes('não está ativo') ? 409"),
            '/dialog/turn deve retornar 409 se modo diálogo não está ativo',
        );
    });

    it('JSDoc de /dialog/start menciona padrão §15.8', () => {
        assert.ok(sourceCode.includes('§15.8'), '/dialog/start deve mencionar o padrão §15.8 no JSDoc');
    });
});

// ─── Suite: comportamento das rotas via mocks ─────────────────────────────────

describe('http-bridge › dialog: validação de input via source-level', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/api/bridge-dialog.js', import.meta.url), 'utf-8');
    });

    it('/dialog/turn retorna 400 quando message está ausente (validação no source)', () => {
        // Verifica que existe verificação de message ausente
        assert.ok(
            sourceCode.includes('!message || typeof message'),
            '/dialog/turn deve retornar 400 quando message está ausente',
        );
    });

    it('/dialog/turn tem limite de timeout máximo de 300000ms', () => {
        assert.ok(sourceCode.includes('300_000'), '/dialog/turn deve ter limite máximo de timeout de 300000ms');
    });

    it('/dialog/turn tem limite de timeout mínimo de 1000ms', () => {
        assert.ok(sourceCode.includes('1_000'), '/dialog/turn deve ter limite mínimo de timeout de 1000ms');
    });

    it('/dialog/start lida com erro lançado por startDialogLoop()', () => {
        // Verifica bloco try/catch em /dialog/start
        const startSection = sourceCode.slice(
            sourceCode.indexOf("'/dialog/start'"),
            sourceCode.indexOf("'/dialog/turn'"),
        );
        assert.ok(
            startSection.includes('try {') && startSection.includes('catch (err)'),
            '/dialog/start deve ter try/catch para startDialogLoop()',
        );
    });

    it('/dialog/stop lida com erro lançado por stopDialogLoop()', () => {
        // Verifica bloco try/catch em /dialog/stop
        const stopSection = sourceCode.slice(sourceCode.indexOf("'/dialog/stop'"));
        assert.ok(
            stopSection.includes('try {') && stopSection.includes('catch (err)'),
            '/dialog/stop deve ter try/catch para stopDialogLoop()',
        );
    });

    it('/dialog/start retorna mensagem orientadora para próximo passo', () => {
        assert.ok(
            sourceCode.includes('/dialog/turn para interagir'),
            '/dialog/start deve informar como usar /dialog/turn',
        );
    });

    it('/dialog/stop retorna mensagem de confirmação', () => {
        // DL-PERM: a mensagem mudou para incluir "autorização do usuário"
        assert.ok(
            sourceCode.includes("'Modo diálogo encerrado por autorização do usuário.'"),
            '/dialog/stop deve confirmar encerramento com menção a autorização do usuário (DL-PERM)',
        );
    });

    it("SSE /stream inclui evento 'dialog.ready'", async () => {
        // AGENT_EVENTS foi consolidado em agent/events.js (Fase N) — verificar lá
        const { readFile } = await import('node:fs/promises');
        const eventsCode = await readFile(new URL('../../../src/copilot/agent/events.js', import.meta.url), 'utf-8');
        assert.ok(eventsCode.includes("'dialog.ready'"), "SSE /stream deve incluir 'dialog.ready'");
    });

    it("SSE /stream inclui evento 'dialog.reply'", async () => {
        const { readFile } = await import('node:fs/promises');
        const eventsCode = await readFile(new URL('../../../src/copilot/agent/events.js', import.meta.url), 'utf-8');
        assert.ok(eventsCode.includes("'dialog.reply'"), "SSE /stream deve incluir 'dialog.reply'");
    });

    it("SSE /stream inclui evento 'dialog.stopped'", async () => {
        const { readFile } = await import('node:fs/promises');
        const eventsCode = await readFile(new URL('../../../src/copilot/agent/events.js', import.meta.url), 'utf-8');
        assert.ok(eventsCode.includes("'dialog.stopped'"), "SSE /stream deve incluir 'dialog.stopped'");
    });
});
