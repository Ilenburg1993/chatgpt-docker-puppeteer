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
        src = await readFile(resolve(dir, '../../../src/copilot/agent/dialog-loop-manager.js'), 'utf8');
    });

    it('deve declarar o método privado #emitTurnStart', () => {
        assert.ok(src.includes('#emitTurnStart'), 'helper #emitTurnStart deve existir');
    });

    it('deve declarar o método privado #buildTurnResolutionListeners', () => {
        assert.ok(src.includes('#buildTurnResolutionListeners'), 'helper #buildTurnResolutionListeners deve existir');
    });

    it('deve declarar o método privado #dispatchTurnToHost', () => {
        assert.ok(src.includes('#dispatchTurnToHost'), 'helper #dispatchTurnToHost deve existir');
    });

    it('#executeTurn deve chamar #emitTurnStart', () => {
        // Extrair apenas a parte após a última ocorrência de "#executeTurn(" que é a declaração do método
        const idx = src.lastIndexOf('#executeTurn(');
        assert.ok(idx >= 0, '#executeTurn deve existir no source como método declarado');
        const methodBody = src.slice(idx, idx + 3000);
        assert.ok(methodBody.includes('this.#emitTurnStart'), '#executeTurn deve delegar para #emitTurnStart');
    });

    it('#executeTurn deve chamar #buildTurnResolutionListeners', () => {
        const idx = src.lastIndexOf('#executeTurn(');
        assert.ok(idx >= 0, '#executeTurn deve existir no source como método declarado');
        const methodBody = src.slice(idx, idx + 3000);
        assert.ok(
            methodBody.includes('this.#buildTurnResolutionListeners'),
            '#executeTurn deve delegar para #buildTurnResolutionListeners',
        );
    });

    it('#executeTurn deve chamar #dispatchTurnToHost', () => {
        const idx = src.lastIndexOf('#executeTurn(');
        assert.ok(idx >= 0, '#executeTurn deve existir no source como método declarado');
        const methodBody = src.slice(idx, idx + 3000);
        assert.ok(
            methodBody.includes('this.#dispatchTurnToHost'),
            '#executeTurn deve delegar para #dispatchTurnToHost',
        );
    });

    it('#buildTurnResolutionListeners deve usar pendingListenerRef para cleanup no timeout', () => {
        const idx = src.lastIndexOf('#buildTurnResolutionListeners(');
        assert.ok(idx >= 0, '#buildTurnResolutionListeners deve existir');
        const methodBody = src.slice(idx, idx + 1200);
        assert.ok(
            methodBody.includes('pendingListenerRef'),
            '#buildTurnResolutionListeners deve receber pendingListenerRef',
        );
    });

    it('#dispatchTurnToHost deve usar pendingListenerRef.current para rastrear listener', () => {
        const idx = src.lastIndexOf('#dispatchTurnToHost(');
        assert.ok(idx >= 0, '#dispatchTurnToHost deve existir');
        const methodBody = src.slice(idx, idx + 1500);
        assert.ok(
            methodBody.includes('pendingListenerRef.current'),
            '#dispatchTurnToHost deve atribuir a pendingListenerRef.current',
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
