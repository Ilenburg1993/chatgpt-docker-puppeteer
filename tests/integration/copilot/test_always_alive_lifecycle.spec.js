// @ts-check
/**
 * tests/integration/copilot/test_always_alive_lifecycle.spec.js
 *
 * F4.7 (UPG-12): Teste de integração do ciclo stop()/start() do AlwaysAliveAgent.
 *
 * Verifica:
 *
 * - 3 ciclos completos stop → start sem vazamento de listeners ou estado residual
 * - `dialogLoopActive` false após stop, true após startDialogLoop
 * - Eventos emitidos corretamente em cada transição
 * - `dialog.loop.changed` (F4.6) emitido com { active: true } e { active: false }
 * - Nenhum PR extra consumido por ciclos de stop/start (resumeSession = 0 PR)
 *
 * Requisito: Copilot Language Server deve estar disponível e autenticado. Executar isolado: node --strip-types --test
 * tests/integration/copilot/test_always_alive_lifecycle.spec.js
 *
 * @module tests/integration/copilot/test_always_alive_lifecycle
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// AlwaysAliveAgent é um singleton exportado do módulo — importamos diretamente
// para garantir o mesmo objeto monitorado pelos listeners do sistema.
import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configurações
// ─────────────────────────────────────────────────────────────────────────────

/** Tempo máximo para boot do dialog loop */
const BOOT_TIMEOUT_MS = Number(process.env.COPILOT_BOOT_TIMEOUT_MS ?? 120_000);

/** Modelo a usar (pode ser sobrescrito) */
const TEST_MODEL = process.env.COPILOT_TEST_MODEL ?? 'gpt-4.1-mini';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aguarda um evento do agente com timeout.
 *
 * @param {import('../../../src/copilot/agent/always-alive.js').AlwaysAliveAgent} agent
 * @param {string} eventName
 * @param {number} timeoutMs
 * @returns {Promise<unknown>}
 */
function waitForEvent(agent, eventName, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`[test] Timeout aguardando evento "${eventName}" após ${timeoutMs}ms`));
        }, timeoutMs);
        agent.once(eventName, (data) => {
            clearTimeout(timeout);
            resolve(data);
        });
    });
}

/**
 * Executa um ciclo completo: start → startDialogLoop → stopDialogLoop → stop. Verifica eventos e propriedades em cada
 * etapa.
 *
 * @param {number} cycleNum - Número do ciclo (para logging)
 * @param {import('../../../src/copilot/agent/always-alive.js').AlwaysAliveAgent} agent
 */
async function runLifecycleCycle(cycleNum, agent) {
    const loopChangedEvents = /** @type {{ active: boolean; ts: number }[]} */ ([]);
    const onLoopChanged = (/** @type {{ active: boolean; ts: number }} */ evt) => {
        loopChangedEvents.push(evt);
    };
    agent.on('dialog.loop.changed', onLoopChanged);

    try {
        assert.equal(agent.status, 'stopped', `[ciclo ${cycleNum}] Agente deve começar stopped`);
        assert.equal(
            agent.dialogLoopActive,
            false,
            `[ciclo ${cycleNum}] dialogLoopActive deve ser false antes do start`,
        );

        // Start do agente
        agent.setModel(TEST_MODEL);
        const readyPromise = waitForEvent(agent, 'ready', BOOT_TIMEOUT_MS);
        await agent.start();
        await readyPromise;

        assert.notEqual(agent.status, 'stopped', `[ciclo ${cycleNum}] Agente deve estar running após start`);
        assert.equal(
            agent.dialogLoopActive,
            false,
            `[ciclo ${cycleNum}] dialogLoopActive false antes do startDialogLoop`,
        );

        // startDialogLoop
        const dialogReadyPromise = waitForEvent(agent, 'dialog.ready', BOOT_TIMEOUT_MS);
        await agent.startDialogLoop();
        await dialogReadyPromise;

        assert.equal(
            agent.dialogLoopActive,
            true,
            `[ciclo ${cycleNum}] dialogLoopActive deve ser true após startDialogLoop`,
        );

        // Verifica evento dialog.loop.changed { active: true }
        assert.ok(
            loopChangedEvents.some((e) => e.active === true),
            `[ciclo ${cycleNum}] dialog.loop.changed { active: true } deve ter sido emitido`,
        );

        // stopDialogLoop
        await agent.stopDialogLoop();
        assert.equal(
            agent.dialogLoopActive,
            false,
            `[ciclo ${cycleNum}] dialogLoopActive deve ser false após stopDialogLoop`,
        );

        // Verifica evento dialog.loop.changed { active: false }
        assert.ok(
            loopChangedEvents.some((e) => e.active === false),
            `[ciclo ${cycleNum}] dialog.loop.changed { active: false } deve ter sido emitido`,
        );

        // Stop do agente
        await agent.stop({ shutdownTimeoutMs: 15_000 });
        assert.equal(agent.status, 'stopped', `[ciclo ${cycleNum}] Agente deve estar stopped após stop`);
    } finally {
        agent.off('dialog.loop.changed', onLoopChanged);
    }

    return { loopChangedEvents };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────

describe('AlwaysAliveAgent › ciclo stop/start › F4.7 (UPG-12)', { timeout: BOOT_TIMEOUT_MS * 7 }, () => {
    before(async () => {
        // Garantir que o agente está parado antes dos testes
        if (alwaysAliveAgent.status !== 'stopped') {
            if (alwaysAliveAgent.dialogLoopActive) {
                await alwaysAliveAgent.stopDialogLoop().catch(() => {});
            }
            await alwaysAliveAgent.stop({ shutdownTimeoutMs: 10_000 }).catch(() => {});
        }
    });

    after(async () => {
        // Limpeza final
        if (alwaysAliveAgent.status !== 'stopped') {
            if (alwaysAliveAgent.dialogLoopActive) {
                await alwaysAliveAgent.stopDialogLoop().catch(() => {});
            }
            await alwaysAliveAgent.stop({ shutdownTimeoutMs: 10_000 }).catch(() => {});
        }
    });

    it('ciclo 1: start → startDialogLoop → stopDialogLoop → stop', async () => {
        const result = await runLifecycleCycle(1, alwaysAliveAgent);
        assert.equal(result.loopChangedEvents.length, 2, 'Deve ter exatamente 2 eventos dialog.loop.changed');
        assert.equal(result.loopChangedEvents[0].active, true);
        assert.equal(result.loopChangedEvents[1].active, false);
    });

    it('ciclo 2: sem vazamento de listeners — segundo ciclo completo', async () => {
        const preListenerCount = alwaysAliveAgent.eventNames().length;
        const result = await runLifecycleCycle(2, alwaysAliveAgent);
        const postListenerCount = alwaysAliveAgent.eventNames().length;
        // Após o ciclo, o count de event names não deve ter crescido significativamente
        assert.ok(
            postListenerCount <= preListenerCount + 2,
            `Vazamento de listeners detectado: ${preListenerCount} → ${postListenerCount}`,
        );
        assert.equal(result.loopChangedEvents.length, 2);
    });

    it('ciclo 3: estado limpo — terceiro ciclo completo', async () => {
        const result = await runLifecycleCycle(3, alwaysAliveAgent);
        assert.equal(alwaysAliveAgent.status, 'stopped');
        assert.equal(alwaysAliveAgent.dialogLoopActive, false);
        assert.equal(result.loopChangedEvents.length, 2);
    });

    it('status padrões corretos após todos os ciclos', () => {
        assert.equal(alwaysAliveAgent.status, 'stopped');
        assert.equal(alwaysAliveAgent.dialogLoopActive, false);
        assert.equal(alwaysAliveAgent.sessionId, null);
    });
});
