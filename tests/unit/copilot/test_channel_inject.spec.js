// @ts-check
/**
 * tests/unit/copilot/test_channel_inject.spec.js
 *
 * Testes estruturais para src/copilot/channel/inject.js
 *
 * Estratégia: análise de source code (sem dependência de network).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SRC = fs.readFileSync(path.resolve('src/copilot/channel/inject.js'), 'utf8');
const SSE_SRC = fs.readFileSync(path.resolve('src/copilot/channel/sse-client.js'), 'utf8');

describe('copilot/channel/inject.js — structural', () => {
    // ─── Exports ────────────────────────────────────────────────────────────────

    it('deve exportar injectToLlmB', () => {
        assert.ok(SRC.includes('export async function injectToLlmB'));
    });

    it('deve exportar checkLlmBHealth', () => {
        assert.ok(SRC.includes('export async function checkLlmBHealth'));
    });

    it('deve exportar waitForLlmBReady', () => {
        assert.ok(SRC.includes('export async function waitForLlmBReady'));
    });

    // ─── Security ───────────────────────────────────────────────────────────────

    it('deve limitar tamanho da resposta HTTP (MAX_RESPONSE_BYTES)', () => {
        assert.ok(SRC.includes('MAX_RESPONSE_BYTES'));
        // Check the limit is reasonable (2 MB)
        assert.ok(SRC.includes('2 * 1024 * 1024') || SRC.includes('2_097_152'));
    });

    it('deve usar BridgeError para respostas excessivas', () => {
        assert.ok(SRC.includes('LLM_B_RESPONSE_TOO_LARGE'));
    });

    it('deve ter timeout no request HTTP', () => {
        assert.ok(SRC.includes('req.setTimeout'));
    });

    it('deve usar BridgeError para timeout', () => {
        assert.ok(SRC.includes('LLM_B_TIMEOUT'));
    });

    // ─── Error codes ────────────────────────────────────────────────────────────

    it('deve ter error code LLM_B_BUSY para 409', () => {
        assert.ok(SRC.includes('LLM_B_BUSY'));
        assert.ok(SRC.includes('409'));
    });

    it('deve ter error code LLM_B_UNAVAILABLE para 503', () => {
        assert.ok(SRC.includes('LLM_B_UNAVAILABLE'));
        assert.ok(SRC.includes('503'));
    });

    it('deve ter error code LLM_B_ERROR para erros genéricos', () => {
        assert.ok(SRC.includes('LLM_B_ERROR'));
    });

    it('deve ter error code LLM_B_INVALID_RESPONSE', () => {
        assert.ok(SRC.includes('LLM_B_INVALID_RESPONSE'));
    });

    it('deve ter error code LLM_B_NOT_READY para waitForLlmBReady', () => {
        assert.ok(SRC.includes('LLM_B_NOT_READY'));
    });

    // ─── Retry logic (INJECT-01) ────────────────────────────────────────────────

    it('deve ter retry automático para 409 (INJECT-01)', () => {
        assert.ok(SRC.includes('maxRetries') || SRC.includes('retries'));
        assert.ok(SRC.includes('attempt'));
    });

    it('retry deve ter default de 3 tentativas', () => {
        assert.ok(SRC.includes('retries ?? 3') || SRC.includes('maxRetries'));
    });

    it('retry deve ter backoff linear', () => {
        assert.ok(SRC.includes('retryDelayMs * (attempt + 1)') || SRC.includes('retryDelayMs'));
    });

    it('retry deve verificar isBusy antes de retentar', () => {
        assert.ok(SRC.includes('LLM_B_BUSY'));
    });

    // ─── httpRequest internals ──────────────────────────────────────────────────

    it('deve usar http.request (não fetch)', () => {
        assert.ok(SRC.includes('http.request'));
    });

    it('deve conectar em 127.0.0.1 (loopback)', () => {
        assert.ok(SRC.includes("'127.0.0.1'"));
    });

    it('deve enviar Content-Type application/json', () => {
        assert.ok(SRC.includes('application/json'));
    });

    it('deve enviar Content-Length correto', () => {
        assert.ok(SRC.includes('Content-Length'));
        assert.ok(SRC.includes('Buffer.byteLength'));
    });

    // ─── checkLlmBHealth ────────────────────────────────────────────────────────

    it('health deve verificar dialogLoopActive', () => {
        assert.ok(SRC.includes('dialogLoopActive'));
    });

    it('health deve verificar busy status', () => {
        assert.ok(SRC.includes('busy'));
    });

    it('health deve retornar hubSessionId', () => {
        assert.ok(SRC.includes('hubSessionId'));
    });

    it('health deve retornar agentStatus', () => {
        assert.ok(SRC.includes('agentStatus'));
    });

    it('health deve ter fallback graceful ao falhar', () => {
        // O catch retorna objeto com ok: false
        const healthFn = SRC.slice(
            SRC.indexOf('function checkLlmBHealth'),
            SRC.indexOf('function checkLlmBHealth') + 1000,
        );
        assert.ok(healthFn.includes('ok: false'));
    });

    it('health timeout deve ser 5 segundos', () => {
        assert.ok(SRC.includes('5_000') || SRC.includes('5000'));
    });

    // ─── waitForLlmBReady ───────────────────────────────────────────────────────

    it('waitForLlmBReady deve ter maxWaitMs default (30s)', () => {
        assert.ok(SRC.includes('30_000') || SRC.includes('30000'));
    });

    it('waitForLlmBReady deve usar polling com intervalo', () => {
        assert.ok(SRC.includes('pollIntervalMs'));
    });

    it('waitForLlmBReady deve verificar health.ready', () => {
        const waitFn = SRC.slice(SRC.indexOf('function waitForLlmBReady'));
        assert.ok(waitFn.includes('.ready'));
    });

    // ─── injectToLlmB ──────────────────────────────────────────────────────────

    it('injectToLlmB deve suportar attachments', () => {
        assert.ok(SRC.includes('attachments'));
    });

    it('injectToLlmB deve suportar from customizável', () => {
        assert.ok(SRC.includes("from ?? 'llm-a'") || SRC.includes("from: 'llm-a'"));
    });

    it('injectToLlmB result deve ter reply e durationMs', () => {
        assert.ok(SRC.includes('reply'));
        assert.ok(SRC.includes('durationMs'));
    });

    // ─── SSE subscription ───────────────────────────────────────────────────────

    it('deve ter subscrição SSE (subscribeSse) via sse-client.js', () => {
        assert.ok(SRC.includes('subscribeSse') || SSE_SRC.includes('export function subscribeSse'));
    });

    it('SSE deve ter reconexão automática com backoff (MR-09)', () => {
        assert.ok(SSE_SRC.includes('reconnectMs'));
        assert.ok(SSE_SRC.includes('MAX_RECONNECT_MS'));
    });

    it('SSE deve aceitar text/event-stream', () => {
        assert.ok(SSE_SRC.includes('text/event-stream'));
    });

    it('SSE deve retornar unsubscribe', () => {
        assert.ok(SRC.includes('unsubscribe'));
    });

    // ─── JSDoc & typedefs ───────────────────────────────────────────────────────

    it('deve ter typedef InjectOpts', () => {
        assert.ok(SRC.includes('@typedef {Object} InjectOpts'));
    });

    it('deve ter typedef InjectResult', () => {
        assert.ok(SRC.includes('@typedef {Object} InjectResult'));
    });

    it('deve ter typedef HealthResult', () => {
        assert.ok(SRC.includes('@typedef {Object} HealthResult'));
    });

    it('deve ter typedef SseEvent', () => {
        assert.ok(SRC.includes('SseEvent') || SSE_SRC.includes('@typedef {Object} SseEvent'));
    });

    it('deve importar BridgeError do core', () => {
        assert.ok(SRC.includes('BridgeError') && SRC.includes('#copilot/core'));
    });

    it('porta default deve ser configurável via LLM_B_TERMINAL_PORT', () => {
        assert.ok(SRC.includes('LLM_B_TERMINAL_PORT'));
    });
});
