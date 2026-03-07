// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as system from '#infra/system';
import { log, audit } from './logger.js';
import { ActionCode, ActorRole } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';

// NERV instance will be injected via setNERV()
/** @type {any} */
let nervInstance = null;

/**
 * Injeta instância do NERV para emissão de eventos (ONDA 2).
 * Deve ser chamado no boot antes de usar infra_failure_policy.
 * @param {*} nerv
  * @returns {void}
 */
function setNERV(nerv) {
    nervInstance = nerv;
}

/**
 * Failure Categories: Categorias de falha de infraestrutura
 * Escopo: Local ao módulo infra_failure_policy
 */
const FAILURE_CATEGORIES = {
    TARGET_CLOSED: 'TARGET_CLOSED',
    CONNECTION_LOST: 'CONNECTION_LOST',
    BROWSER_FROZEN: 'BROWSER_FROZEN',
    INFRA_TIMEOUT: 'INFRA_TIMEOUT',
};

/**
 * Política de escalonamento para falhas de infraestrutura do browser/protocolo.
 */
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
    async escalate({ ctx, reason, error: _, correlationId }) {
        const traceId = correlationId || 'sys-infra-escalation';

        log('WARN', `[POLICY] Avaliando escalada de infraestrutura: ${reason}`, traceId);

        // 1. EXTRAÇÃO DE EVIDÊNCIA FÍSICA (PID)
        const pid = this._getPID(ctx);

        // 2. CATEGORIZAÇÃO E SENTENÇA
        switch (reason) {
            case FAILURE_CATEGORIES.TARGET_CLOSED:
            case FAILURE_CATEGORIES.CONNECTION_LOST:
                /**
                 * Caso: O canal de comunicação com o Chrome foi cortado.
                 * Ação: Notificar e garantir que não restem processos órfãos.
                 */
                await this._executeManeuver('TERMINAL_CONNECTION_FAILURE', pid, traceId, ctx);
                break;

            case FAILURE_CATEGORIES.BROWSER_FROZEN:
            case FAILURE_CATEGORIES.INFRA_TIMEOUT:
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
    async _executeManeuver(/** @type {any} */ type, /** @type {any} */ pid, /** @type {any} */ correlationId, /** @type {any} */ ctx, forceKill = false) {
        if (!type || typeof type !== 'string') {
            log('ERROR', `[POLICY] Invalid maneuver type: ${type}`, correlationId);
            return;
        }
        // A. Notifica o Dashboard e o Supervisor sobre a crise de infraestrutura via NERV (ONDA 2 - Migrado)
        if (nervInstance) {
            try {
                await HighLevelNERV.sendEvent(
                    nervInstance,
                    ActorRole.INFRA,
                    ActionCode.INFRA_EMERGENCY,
                    {
                        type: type,
                        pid: pid,
                        action: forceKill ? 'PROCESS_KILL' : 'CLEANUP',
                        severity: 'CRITICAL',
                    },
                    correlationId
                );

                log(
                    'WARN',
                    `[POLICY] Infraestrutura escalada e notificada via NERV: ${type} (PID: ${pid})`,
                    correlationId
                );
            } catch (/** @type {any} */ _rawE) {
            const e = /** @type {any} */ (_rawE);
                log('ERROR', `[POLICY] Falha ao notificar infra escalation via NERV: ${e.message}`, correlationId);
            }
        } else {
            log(
                'WARN',
                `[POLICY] Infraestrutura escalada mas NERV não disponível: ${type} (PID: ${pid})`,
                correlationId
            );
        }

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
    _getPID(/** @type {any} */ ctx) {
        try {
            if (ctx?.browser) {
                // Tenta pegar o PID do processo gerenciado pelo Puppeteer
                const proc = ctx.browser.process();
                return proc ? proc.pid : null;
            }
        } catch (/** @type {any} */ _rawErr) {
            const err = /** @type {any} */ (_rawErr);
            log('DEBUG', `[POLICY] Failed to extract PID: ${err?.message || String(err)}`);
            return null;
        }
        return null;
    }
}

/**
 * Política de falha de infraestrutura e injeção de dependência NERV para escalonamento.
 */
export { InfraFailurePolicy, setNERV };
