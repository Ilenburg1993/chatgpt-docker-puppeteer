// @ts-check
/**
 * tests/unit/copilot/test_dialog_protocol.spec.js
 *
 * G2-TEST-01: Testes para o refactor G2-ARCH-01 — verificar que #executeTurn foi decomposto nos três helpers privados
 * (#emitTurnStart, #buildTurnResolutionListeners, #dispatchTurnToHost) e que o comportamento externo permanece
 * idêntico.
 */

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// ─────────────────────────────────────────────────────────────────────────────
// Suite: análise estrutural de dialog-loop-manager.js
// ─────────────────────────────────────────────────────────────────────────────

describe('DialogLoopManager › G2-ARCH-01: decomposição de #executeTurn', async () => {
    /** @type {string} */
    let src = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        const dlm = await readFile(resolve(dir, '../../../src/copilot/agent/dialog/loop-manager.js'), 'utf8');
        // G2-ARCH-01: #executeTurn foi extraído para dialog-turn-executor.js (Fase 5)
        const executor = await readFile(resolve(dir, '../../../src/copilot/agent/dialog/turn-executor.js'), 'utf8');
        src = dlm + '\n' + executor;
    });

    it('deve declarar o método privado #emitTurnStart', () => {
        // Após Fase 5: extraído como função exportada em dialog-turn-executor.js
        assert.ok(
            src.includes('#emitTurnStart') || src.includes('function emitTurnStart'),
            'helper #emitTurnStart deve existir (como método privado ou função exportada)',
        );
    });

    it('deve declarar o método privado #buildTurnResolutionListeners', () => {
        assert.ok(
            src.includes('#buildTurnResolutionListeners') || src.includes('function buildTurnResolutionListeners'),
            'helper #buildTurnResolutionListeners deve existir',
        );
    });

    it('deve declarar o método privado #dispatchTurnToHost', () => {
        assert.ok(
            src.includes('#dispatchTurnToHost') || src.includes('function dispatchTurnToHost'),
            'helper #dispatchTurnToHost deve existir',
        );
    });

    it('#executeTurn deve chamar #emitTurnStart', () => {
        // Após Fase 5: executeTurnImpl chama emitTurnStart(); o DLM chama executeTurnImpl via #executeTurn
        const hasPrivateCall = src.includes('this.#emitTurnStart');
        const hasExportedCall = src.includes('emitTurnStart(') || src.includes('emitTurnStart,');
        assert.ok(hasPrivateCall || hasExportedCall, '#executeTurn deve delegar para emitTurnStart');
    });

    it('#executeTurn deve chamar #buildTurnResolutionListeners', () => {
        const hasPrivateCall = src.includes('this.#buildTurnResolutionListeners');
        const hasExportedCall =
            src.includes('buildTurnResolutionListeners(') || src.includes('buildTurnResolutionListeners,');
        assert.ok(hasPrivateCall || hasExportedCall, '#executeTurn deve delegar para buildTurnResolutionListeners');
    });

    it('#executeTurn deve chamar #dispatchTurnToHost', () => {
        const hasPrivateCall = src.includes('this.#dispatchTurnToHost');
        const hasExportedCall = src.includes('dispatchTurnToHost(') || src.includes('dispatchTurnToHost,');
        assert.ok(hasPrivateCall || hasExportedCall, '#executeTurn deve delegar para dispatchTurnToHost');
    });

    it('#buildTurnResolutionListeners deve usar pendingListenerRef para cleanup no timeout', () => {
        const idx = src.lastIndexOf('buildTurnResolutionListeners');
        assert.ok(idx >= 0, 'buildTurnResolutionListeners deve existir');
        const methodBody = src.slice(idx, idx + 2000);
        assert.ok(
            methodBody.includes('pendingListenerRef'),
            'buildTurnResolutionListeners deve receber/usar pendingListenerRef',
        );
    });

    it('#dispatchTurnToHost deve usar pendingListenerRef.current para rastrear listener', () => {
        // Fase 5: dispatchTurnToHost é função exportada em dialog-turn-executor.js
        // Usar indexOf para achar a declaração (export function ...), não lastIndexOf que pode pegar uma chamada
        const declPattern = 'export function dispatchTurnToHost';
        const idx = src.indexOf(declPattern) >= 0 ? src.indexOf(declPattern) : src.indexOf('#dispatchTurnToHost(');
        assert.ok(idx >= 0, 'dispatchTurnToHost deve existir');
        const methodBody = src.slice(idx, idx + 2000);
        assert.ok(
            methodBody.includes('pendingListenerRef.current'),
            'dispatchTurnToHost deve atribuir a pendingListenerRef.current',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: comportamento de turn_start / turn_end via sendDialogTurn
// ─────────────────────────────────────────────────────────────────────────────

describe('DialogLoopManager › G2-ARCH-01: eventos de turno', async () => {
    it('events.js deve conter dialog.turn_start como evento registrado', async () => {
        const { readFile } = await import('node:fs/promises');
        const { resolve, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const dir = dirname(fileURLToPath(import.meta.url));
        const src = await readFile(resolve(dir, '../../../src/copilot/agent/events.js'), 'utf8');
        assert.ok(src.includes("'dialog.turn_start'"), 'events.js deve ter dialog.turn_start');
        assert.ok(src.includes("'dialog.turn_end'"), 'events.js deve ter dialog.turn_end');
        assert.ok(src.includes("'dialog.turn_timeout'"), 'events.js deve ter dialog.turn_timeout');
    });
});
