/* ==========================================================================
   src/core/infra_failure_policy.js
   Audit Level: 700 — Sovereign Infra Failure Escalation Protocol
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Decidir, executar e reportar manobras de emergência 
                     sobre a infraestrutura física (Navegador/Processos).
   Sincronizado com: system.js V45, ipc_client.js V600, constants.js V400.
========================================================================== */

const system = require('../infra/system');
const ipc = require('../infra/ipc_client');
const { log, audit } = require('./logger');
const { IPCEvent } = require('../shared/ipc/constants');

class InfraFailurePolicy {
    /**
     * Escala uma falha de infraestrutura conforme a severidade técnica.
     * Transforma um erro passivo em uma decisão ativa de governança.
     * 
     * @param {object} params
     * @param {object} params.ctx - Contexto de execução { browser, page }.
     * @param {string} params.reason - Código do erro (ex: BROWSER_FROZEN).
     * @param {Error} params.error - Objeto de erro original para evidência.
     * @param {string} params.correlationId - Rastro de causalidade da tarefa.
     */
    async escalate({ ctx, reason, error, correlationId }) {
        const traceId = correlationId || 'sys-infra-escalation';
        
        log('WARN', `[POLICY] Avaliando escalada de infraestrutura: ${reason}`, traceId);

        // 1. EXTRAÇÃO DE EVIDÊNCIA FÍSICA (PID)
        const pid = this._getPID(ctx);

        // 2. CATEGORIZAÇÃO E SENTENÇA
        switch (reason) {
            case 'TARGET_CLOSED':
            case 'CONNECTION_LOST':
                /**
                 * Caso: O canal de comunicação com o Chrome foi cortado.
                 * Ação: Notificar e garantir que não restem processos órfãos.
                 */
                await this._executeManeuver('TERMINAL_CONNECTION_FAILURE', pid, traceId, ctx);
                break;

            case 'BROWSER_FROZEN':
            case 'INFRA_TIMEOUT':
                /**
                 * Caso: O navegador parou de responder ao protocolo DevTools (HUNG).
                 * Ação: Executar Kill cirúrgico para permitir o restart pelo Engine.
                 */
                await this._executeManeuver('HARD_BROWSER_STALL', pid, traceId, ctx, true);
                break;

            default:
                /**
                 * Caso: Falhas menores ou desconhecidas.
                 * Ação: Apenas registro em log e auditoria para análise posterior.
                 */
                log('DEBUG', `[POLICY] Falha de infra não crítica registrada: ${reason}`, traceId);
                break;
        }
    }

    /**
     * Executa a manobra física e reporta para a malha sensorial (IPC).
     */
    async _executeManeuver(type, pid, correlationId, ctx, forceKill = false) {
        // A. Notifica o Dashboard e o Supervisor sobre a crise de infraestrutura
        ipc.emitEvent(IPCEvent.STALL_DETECTED, {
            type,
            severity: 'CRITICAL',
            evidence: { pid, action: forceKill ? 'PROCESS_KILL' : 'CLEANUP' }
        }, correlationId);

        // B. Registro em Auditoria Administrativa
        await audit('INFRA_ESCALATION', { type, pid, correlationId });

        // C. Execução Física (Apenas se houver um PID válido)
        if (pid && (forceKill || type.includes('TERMINAL'))) {
            log('FATAL', `[POLICY] Sentenciando processo ${pid} à morte (Razão: ${type})`, correlationId);
            await system.killProcess(pid).catch(err => {
                log('ERROR', `[POLICY] Falha ao executar sentença no PID ${pid}: ${err.message}`, correlationId);
            });
        }
    }

    /**
     * Extrai o PID de forma resiliente, suportando diferentes estados do driver.
     */
    _getPID(ctx) {
        try {
            if (ctx?.browser) {
                // Tenta pegar o PID do processo gerenciado pelo Puppeteer
                const proc = ctx.browser.process();
                return proc ? proc.pid : null;
            }
        } catch (e) {
            return null;
        }
        return null;
    }
}

module.exports = InfraFailurePolicy;