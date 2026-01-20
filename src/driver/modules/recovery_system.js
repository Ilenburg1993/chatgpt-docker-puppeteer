/* ==========================================================================
   src/driver/modules/recovery_system.js
   Audit Level: 500 — Instrumented Recovery Protocol (IPC 2.0)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Aplicar manobras de recuperação escalonada (Tiers) e
                     reportar a saúde da infraestrutura para o Mission Control.
   Sincronizado com: BaseDriver V320, system.js V45, stabilizer.js V43.
========================================================================== */

const system = require('../../infra/system');
const stabilizer = require('./stabilizer');
const { log } = require('../../core/logger');

class RecoverySystem {
    /**
   * @param {object} driver - Instância do BaseDriver (acesso ao _emitVital).
   */
    constructor(driver) {
        this.driver = driver;
    }

    /**
   * Aplica um nível de recuperação baseado no número de tentativas falhas.
   * Narra a manobra para o barramento IPC 2.0.
   *
   * @param {Error} recoveryErr - O erro original capturado.
   * @param {number} attempt - O índice da tentativa atual (0-3).
   * @param {string} taskId - ID da tarefa ativa.
   */
    async applyTier(recoveryErr, attempt, taskId) {
        const msg = String(recoveryErr?.message || '').toUpperCase();
        const correlationId = this.driver.correlationId;

        log('WARN', `[RECOVERY] Acionando Tier ${attempt} | Causa: ${recoveryErr.message}`, correlationId);

        // [V500] Notifica o Supervisor sobre o início da manobra de recuperação
        this.driver._emitVital('TRIAGE_ALERT', {
            type: 'RECOVERY_MANEUVER_START',
            severity: attempt > 1 ? 'HIGH' : 'MEDIUM',
            evidence: {
                tier: attempt,
                cause: recoveryErr.message,
                taskId
            }
        });

        switch (attempt) {
            case 0:
                // Tier 0: Invalidação de Percepção + Delay Tático
                this.driver._emitVital('PROGRESS_UPDATE', { step: 'RECOVERY_TIER_0_CACHE_INVALIDATION' });
                this.driver.inputResolver.clearCache();

                // Backoff progressivo baseado no número da tentativa
                await new Promise(r => setTimeout(r, 1200 + attempt * 800));
                this.driver._assertPageAlive();
                break;

            case 1:
                // Tier 1: Recuperação de Foco e Visibilidade (Focus Recovery)
                this.driver._emitVital('PROGRESS_UPDATE', { step: 'RECOVERY_TIER_1_FOCUS_RESTORE' });
                try {
                    if (this.driver.page && !this.driver.page.isClosed()) {
                        await this.driver.page.bringToFront();
                        // Clique biomecânico "cego" no topo para forçar o foco da janela
                        await this.driver.page.mouse.click(1, 1).catch(() => {});
                        await this.driver.page.evaluate(() => { window.focus(); }).catch(() => {});
                    }
                } catch (focusErr) {
                    log('DEBUG', `[RECOVERY] Falha ao forçar foco: ${focusErr.message}`, correlationId);
                }
                this.driver.inputResolver.clearCache();
                break;

            case 2:
                // Tier 2: Recarregamento de Página (Hard Reload)
                this.driver._emitVital('PROGRESS_UPDATE', { step: 'RECOVERY_TIER_2_PAGE_RELOAD' });
                try {
                    if (this.driver.page && !this.driver.page.isClosed()) {
                        log('WARN', `[RECOVERY] Forçando reload da aba ativa...`, correlationId);
                        await this.driver.page.reload({
                            waitUntil: 'domcontentloaded',
                            timeout: 30000
                        });
                        // Bloqueia execução até que a interface pare de sofrer mutações (Entropia Zero)
                        await stabilizer.waitForStability(this.driver.page);
                    }
                } catch (navErr) {
                    log('ERROR', `[RECOVERY] Falha crítica no reload: ${navErr.message}`, correlationId);
                }
                break;

            default:
                // Tier 3: Manobra Nuclear (Surgical Process Kill)
                // Aplicada em casos de congelamento de browser ou desconexão fatal.
                if (msg.includes('TIMEOUT') || msg.includes('CLOSED') || msg.includes('DETACHED') || attempt >= 3) {

                    this.driver._emitVital('TRIAGE_ALERT', {
                        type: 'TERMINAL_INFRA_FAILURE',
                        severity: 'CRITICAL',
                        evidence: { action: 'PROCESS_KILL_TRIGGERED', taskId }
                    });

                    log('FATAL', `[RECOVERY] Tier 3 (Nuclear) atingido. Matando processo do navegador.`, correlationId);

                    const browser = this.driver.page.browser();
                    const pid = browser?.process?.()?.pid;
                    if (pid) {
                        // [P3 FIX] Timeout de 5s para evitar travamento em processos zombie
                        // Se treeKill não retornar em 5s, continua o fluxo (OS eventualmente limpa)
                        const KILL_TIMEOUT_MS = 5000;

                        try {
                            await Promise.race([
                                system.killProcess(pid),
                                new Promise((_, reject) =>
                                    setTimeout(() => reject(new Error('KILL_TIMEOUT')), KILL_TIMEOUT_MS)
                                )
                            ]);
                        } catch (killErr) {
                            if (killErr.message === 'KILL_TIMEOUT') {
                                log('WARN', `[RECOVERY] Kill timeout após ${KILL_TIMEOUT_MS}ms, processo pode estar zombie`, correlationId);
                            } else {
                                log('ERROR', `[RECOVERY] Falha no kill: ${killErr.message}`, correlationId);
                            }
                            // Continua o fluxo mesmo com falha (SO limpa eventualmente)
                        }
                    }

                    // Lança o erro para que o ExecutionEngine aplique a política de escalada de infra
                    throw recoveryErr;
                }
        }

        this.driver._emitVital('PROGRESS_UPDATE', { step: 'RECOVERY_MANEUVER_COMPLETE', tier: attempt });
    }
}

module.exports = RecoverySystem;