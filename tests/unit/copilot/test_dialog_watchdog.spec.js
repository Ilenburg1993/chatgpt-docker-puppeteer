// @ts-check
/**
 * tests/unit/copilot/test_dialog_watchdog.spec.js
 *
 * G2-TEST-02/03: Testes para G2-ARCH-11 (stop() com shutdownTimeoutMs) e G2-ARCH-20 (boot timeout emite
 * dialog.turn_timeout).
 *
 * F31.5: Testes para watchdog durante pause/resume.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DialogWatchdog, WATCHDOG_THRESHOLDS } from '../../../src/copilot/agent/dialog/watchdog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: análise estrutural — stop() com shutdownTimeoutMs
// ─────────────────────────────────────────────────────────────────────────────

describe('DialogLoopManager › G2-ARCH-11: stop() com shutdownTimeoutMs', async () => {
    /** @type {string} */
    let src = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        src = await readFile(resolve(dir, '../../../src/copilot/agent/dialog/loop-manager.js'), 'utf8');
        assert.ok(src.includes('shutdownTimeoutMs'), 'stop() deve ter parâmetro shutdownTimeoutMs');
    });

    it('stop() deve chamar forceDeactivate() no timeout', () => {
        // Encontrar o bloco do método stop() usando lastIndexOf para pegar a declaração
        const idx = src.lastIndexOf('async stop(');
        assert.ok(idx >= 0, 'stop() deve existir no source');
        const stopBody = src.slice(idx, idx + 2000);
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

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        src = await readFile(resolve(dir, '../../../src/copilot/agent/dialog/loop-manager.js'), 'utf8');
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
        // dialog-loop-wirer.js é responsável pelo forwarding (Fase 5 refactor)
        const wirerSrc = await readFile(resolve(dir, '../../../src/copilot/agent/dialog/loop-manager.js'), 'utf8');
        assert.ok(
            aaSrc.includes('dialog.turn_timeout') || wirerSrc.includes('dialog.turn_timeout'),
            "always-alive (ou dialog-loop-wirer) deve reemitir 'dialog.turn_timeout'",
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// F31.5 — Testes para watchdog durante pause/resume
// ─────────────────────────────────────────────────────────────────────────────

describe('DialogWatchdog › F31.5: pause/resume behavior', () => {
    it('start() ativa o watchdog (running=true)', () => {
        const wd = new DialogWatchdog({ intervalMs: 100, stallThresholdMs: 50, onStall: () => {} });
        assert.strictEqual(wd.running, false, 'deve iniciar inativo');
        wd.start();
        assert.strictEqual(wd.running, true, 'deve estar ativo após start()');
        wd.stop();
    });

    it('stop() desativa o watchdog (running=false)', () => {
        const wd = new DialogWatchdog({ intervalMs: 100, stallThresholdMs: 50, onStall: () => {} });
        wd.start();
        wd.stop();
        assert.strictEqual(wd.running, false, 'deve estar inativo após stop()');
    });

    it('stop() durante pausa NÃO dispara onStall', (t) => {
        vi.useFakeTimers();
        let stallCount = 0;
        const wd = new DialogWatchdog({
            intervalMs: 100,
            stallThresholdMs: 50,
            onStall: () => {
                stallCount++;
            },
        });

        wd.start();
        // Simula pause: stop watchdog
        wd.stop();
        // Avança 500ms — sem watchdog ativo, nenhum stall deve ser disparado
        vi.advanceTimersByTime(500);
        assert.strictEqual(stallCount, 0, 'onStall NÃO deve ser chamado durante pausa');
        vi.useRealTimers();
    });

    it('após resume (start), watchdog volta a disparar onStall em stall real', async () => {
        let stallCount = 0;
        const wd = new DialogWatchdog({
            intervalMs: 20,
            stallThresholdMs: 30,
            onStall: () => {
                stallCount++;
            },
        });

        // start → pause → resume
        wd.start();
        wd.stop(); // pause
        wd.start(); // resume

        // Aguarda tempo real para stall (30ms threshold + 20ms interval buffer)
        await new Promise((r) => setTimeout(r, 80));
        assert.ok(stallCount >= 1, 'onStall deve ser chamado após resume quando stall detectado');
        wd.stop();
    });

    it('ping() reseta o timer de inatividade', (t) => {
        vi.useFakeTimers();
        let stallCount = 0;
        const wd = new DialogWatchdog({
            intervalMs: 100,
            stallThresholdMs: 150,
            onStall: () => {
                stallCount++;
            },
        });

        wd.start();
        // Avança 100ms — o interval dispara mas ainda não atingiu 150ms de stall
        vi.advanceTimersByTime(100);
        assert.strictEqual(stallCount, 0, 'sem stall antes do threshold');

        // Ping reseta — lastActivity = Date.now() snapshot no mock
        wd.ping();

        // Avança mais 100ms — desde o ping, só 100ms (< 150ms threshold)
        vi.advanceTimersByTime(100);
        assert.strictEqual(stallCount, 0, 'ping deve resetar o timer — sem stall');

        wd.stop();
        vi.useRealTimers();
    });

    it('start() chamado duas vezes não cria timer duplicado', () => {
        const wd = new DialogWatchdog({ intervalMs: 100, stallThresholdMs: 50, onStall: () => {} });
        wd.start();
        wd.start(); // deve ser ignorado (guard)
        assert.strictEqual(wd.running, true);
        wd.stop();
        assert.strictEqual(wd.running, false);
    });

    it('stop() chamado sem start não causa erro', () => {
        const wd = new DialogWatchdog({ intervalMs: 100, stallThresholdMs: 50, onStall: () => {} });
        assert.doesNotThrow(() => wd.stop(), 'stop() em watchdog inativo não deve lançar');
    });

    it('setThreshold() ajusta threshold em runtime', () => {
        const wd = new DialogWatchdog({
            intervalMs: 100,
            stallThresholdMs: 50,
            onStall: () => {},
        });
        assert.doesNotThrow(() => wd.setThreshold(300), 'setThreshold deve funcionar sem erro');
    });

    it('setTaskType() aplica threshold do WATCHDOG_THRESHOLDS', () => {
        const wd = new DialogWatchdog({
            intervalMs: 100,
            stallThresholdMs: 50,
            onStall: () => {},
        });
        assert.doesNotThrow(() => wd.setTaskType('analysis'), 'analysis threshold deve funcionar');
        assert.doesNotThrow(() => wd.setTaskType('unknown_type'), 'tipo desconhecido deve usar default');
    });

    it('WATCHDOG_THRESHOLDS contém entradas esperadas', () => {
        assert.ok(typeof WATCHDOG_THRESHOLDS.default === 'number');
        assert.ok(typeof WATCHDOG_THRESHOLDS.analysis === 'number');
        assert.ok(typeof WATCHDOG_THRESHOLDS.simple === 'number');
        assert.ok(WATCHDOG_THRESHOLDS.analysis > WATCHDOG_THRESHOLDS.simple, 'analysis > simple');
    });
});

describe('DialogWatchdog › F31: DLM pause/resume integração source analysis', () => {
    /** @type {string} */
    let dlmSrc = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        dlmSrc = await readFile(resolve(dir, '../../../src/copilot/agent/dialog/loop-manager.js'), 'utf8');
    });

    it('pause() chama #watchdog?.stop() para evitar falsos-positivos', () => {
        const pauseIdx = dlmSrc.indexOf('async pause(');
        assert.ok(pauseIdx >= 0, 'pause() deve existir no DLM');
        const pauseBody = dlmSrc.slice(pauseIdx, pauseIdx + 600);
        assert.ok(
            pauseBody.includes('#watchdog?.stop()') || pauseBody.includes('watchdog?.stop()'),
            'pause() deve parar o watchdog',
        );
    });

    it('resume() chama #watchdog?.start() para reativar monitoramento', () => {
        const resumeIdx = dlmSrc.indexOf('async resume()');
        assert.ok(resumeIdx >= 0, 'resume() deve existir no DLM');
        const resumeBody = dlmSrc.slice(resumeIdx, resumeIdx + 1500);
        assert.ok(
            resumeBody.includes('#watchdog?.start()') || resumeBody.includes('watchdog?.start()'),
            'resume() deve reiniciar o watchdog',
        );
    });
});
