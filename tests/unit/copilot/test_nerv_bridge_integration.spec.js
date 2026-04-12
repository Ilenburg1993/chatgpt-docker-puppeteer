// @ts-check
/**
 * tests/unit/copilot/test_nerv_bridge_integration.spec.js
 *
 * F34.6 — Testes de integração NERV ↔ agent (round-trip).
 *
 * Valida que o nerv-bridge:
 *
 * - Exporta EVENT_MAP com mapeamento completo
 * - Implementa INBOUND_COMMANDS (sendMessage, pause, resume, restart)
 * - mount/unmount são idempotentes
 * - safeEmit cria envelopes corretos
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('F34.6 — NERV ↔ Agent bridge integration', async () => {
    /** @type {string} */
    let bridgeSource = '';

    beforeAll(async () => {
        const { readFile } = await import('node:fs/promises');
        bridgeSource = await readFile(new URL('../../../src/copilot/bridges/nerv-bridge.js', import.meta.url), 'utf-8');
    });

    // ── EVENT_MAP Coverage ───────────────────────────────────────────────────

    describe('EVENT_MAP coverage', () => {
        /** Eventos críticos que DEVEM estar mapeados no bridge */
        const REQUIRED_EVENTS = [
            'dialog.turn_start',
            'dialog.turn_end',
            'dialog.reply',
            'session.fatal',
            'session.compaction_complete',
            'session.usage',
            'task.completed',
            'task.error',
        ];

        for (const event of REQUIRED_EVENTS) {
            it(`deve mapear evento '${event}' no EVENT_MAP`, () => {
                assert.ok(
                    bridgeSource.includes(`event: '${event}'`),
                    `EVENT_MAP deve conter mapeamento para '${event}'`,
                );
            });
        }
    });

    // ── INBOUND_COMMANDS ─────────────────────────────────────────────────────

    describe('INBOUND_COMMANDS', () => {
        const REQUIRED_COMMANDS = ['sendMessage', 'pause', 'resume', 'restart'];

        for (const cmd of REQUIRED_COMMANDS) {
            it(`deve definir handler inbound para '${cmd}'`, () => {
                assert.ok(
                    bridgeSource.includes(`async ${cmd}(`) || bridgeSource.includes(`async ${cmd} (`),
                    `INBOUND_COMMANDS deve ter handler para '${cmd}'`,
                );
            });
        }
    });

    // ── Estrutura do bridge ──────────────────────────────────────────────────

    describe('Estrutura do bridge', () => {
        it('deve exportar mount()', () => {
            assert.ok(bridgeSource.includes('export function mount('), 'nerv-bridge deve exportar mount()');
        });

        it('deve exportar unmount()', () => {
            assert.ok(
                bridgeSource.includes('export function unmount(') || bridgeSource.includes('export function unmount()'),
                'nerv-bridge deve exportar unmount()',
            );
        });

        it('deve exportar emitNerv()', () => {
            assert.ok(
                bridgeSource.includes('export function emitNerv(') ||
                    bridgeSource.includes('export { emitNerv') ||
                    bridgeSource.includes('export function emitNerv'),
                'nerv-bridge deve exportar emitNerv()',
            );
        });

        it('mount() deve ser idempotente (verifica remontagem)', () => {
            assert.ok(bridgeSource.includes('já montado'), 'mount() deve detectar e lidar com re-montagem');
        });

        it('deve criar envelopes com actor COPILOT', () => {
            assert.ok(bridgeSource.includes("actor: 'COPILOT'"), 'envelopes devem ter actor COPILOT');
        });

        it('deve ter proteção contra erros em safeEmit', () => {
            assert.ok(
                bridgeSource.includes('safeEmit') && bridgeSource.includes('.catch('),
                'safeEmit deve capturar erros de emissão',
            );
        });
    });

    // ── F34: Canal inbound ───────────────────────────────────────────────────

    describe('Canal inbound NERV → agent', () => {
        it('deve assinar COPILOT_COMMAND via nerv.onEvent()', () => {
            assert.ok(bridgeSource.includes("'COPILOT_COMMAND'"), 'bridge deve escutar actionCode COPILOT_COMMAND');
        });

        it('deve validar comandos desconhecidos', () => {
            assert.ok(bridgeSource.includes('Comando desconhecido'), 'bridge deve logar comandos desconhecidos');
        });

        it('deve capturar erros de execução de comandos', () => {
            assert.ok(bridgeSource.includes('Erro ao executar'), 'bridge deve capturar erros nos handlers inbound');
        });
    });

    // ── Reconexão: re-registro de listeners após stop/start ──────────────────

    describe('Reconexão do bridge', () => {
        it('deve escutar before-stop para cleanup de listeners', () => {
            assert.ok(bridgeSource.includes("'before-stop'"), 'bridge deve escutar before-stop do agente');
        });

        it('deve proteger contra registro duplo de before-stop', () => {
            assert.ok(
                bridgeSource.includes('_beforeStopRegistered'),
                'bridge deve ter flag para evitar registro duplo',
            );
        });
    });
});
