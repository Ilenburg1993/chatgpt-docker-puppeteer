// @ts-check
/**
 * tests/unit/copilot/test_dialog_watchdog.spec.js
 *
 * G2-TEST-02/03: Testes para G2-ARCH-11 (stop() com shutdownTimeoutMs) e G2-ARCH-20 (boot timeout emite
 * dialog.turn_timeout).
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: análise estrutural — stop() com shutdownTimeoutMs
// ─────────────────────────────────────────────────────────────────────────────

describe('DialogLoopManager › G2-ARCH-11: stop() com shutdownTimeoutMs', async () => {
    /** @type {string} */
    let src = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        src = await readFile(resolve(dir, '../../../src/copilot/agent/dialog-loop-manager.js'), 'utf8');
    });

    it('stop() deve aceitar parâmetro shutdownTimeoutMs', () => {
        assert.ok(src.includes('shutdownTimeoutMs'), 'stop() deve ter parâmetro shutdownTimeoutMs');
    });

    it('stop() deve chamar forceDeactivate() no timeout', () => {
        // Encontrar o bloco do método stop() usando lastIndexOf para pegar a declaração
        const idx = src.lastIndexOf('async stop(');
        assert.ok(idx >= 0, 'stop() deve existir no source');
        const stopBody = src.slice(idx, idx + 1000);
        assert.ok(stopBody.includes('forceDeactivate'), 'stop() deve chamar forceDeactivate() no bloco de timeout');
    });

    it('forceTimer deve ser cancelado após encerramento normal', () => {
        const idx = src.lastIndexOf('async stop(');
        assert.ok(idx >= 0, 'stop() deve existir no source');
        const stopBody = src.slice(idx, idx + 1500);
        assert.ok(
            stopBody.includes('clearTimeout(shutdownTimer)') ||
                stopBody.includes('clearTimeout(forceTimer)') ||
                stopBody.includes('clearTimeout'),
            'stop() deve limpar o timer de força após encerramento normal',
        );
    });

    it('shutdownTimeoutMs deve ter valor default de 30_000', () => {
        assert.ok(src.includes('30_000') || src.includes('30000'), 'shutdownTimeoutMs deve ter default de 30 segundos');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: G2-ARCH-20 — boot timeout emite dialog.turn_timeout
// ─────────────────────────────────────────────────────────────────────────────

describe('DialogLoopManager › G2-ARCH-20: boot timeout emite turn_timeout', async () => {
    /** @type {string} */
    let src = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        src = await readFile(resolve(dir, '../../../src/copilot/agent/dialog-loop-manager.js'), 'utf8');
    });

    it('deve emitir turn_timeout quando o boot falha com DIALOG_TIMEOUT', () => {
        assert.ok(
            src.includes("emit('turn_timeout'"),
            "dialog-loop-manager deve emitir 'turn_timeout' no handler de erro de boot",
        );
    });

    it('deve verificar se o erro é DIALOG_TIMEOUT antes de emitir', () => {
        assert.ok(
            src.includes("'DIALOG_TIMEOUT'"),
            "deve verificar code === 'DIALOG_TIMEOUT' antes de emitir turn_timeout",
        );
    });

    it('always-alive.js deve reemitir turn_timeout como dialog.turn_timeout', async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        const aaSrc = await readFile(resolve(dir, '../../../src/copilot/agent/always-alive.js'), 'utf8');
        assert.ok(aaSrc.includes('dialog.turn_timeout'), "always-alive deve reemitir 'dialog.turn_timeout'");
    });
});
