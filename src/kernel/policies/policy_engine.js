// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { ActionCode, MessageType } from '#shared/nerv/constants';
import { STATUS_VALUES } from '#core/constants/tasks';

/** Classe exportada: default. */
class PolicyEngine {
    constructor(config) {
        this.config = config;

        // Regras Constitucionais (Hardcoded por segurança)
        this.MAX_RETRIES = config.MAX_RETRIES || 3;
        this.COOLDOWN_MS = config.COOLDOWN_MS || 5000;
    }

    /**
     * O Método Principal de Julgamento.
     * Chamado pelo Core a cada tick.
     * * @param {object} state - Snapshot da memória de longo prazo (TaskStore).
     * @param {Array} observations - Lista de novos eventos (ObservationStore).
     * @returns {Array} Lista de Propostas (Decisões).
     */
    evaluate(state, observations) {
        const proposals = [];

        // 1. Avaliação de Observações (Reação a Estímulos Externos)
        for (const obs of observations) {
            const reaction = this._reactToObservation(obs, state);
            if (reaction) {
                proposals.push(reaction);
            }
        }

        // 2. Avaliação de Estado (Regras de Negócio Contínuas)
        // Ex: Se estou falhando muito, desista.
        const stateProposals = this._evaluateStateHealth(state);
        if (stateProposals) {
            proposals.push(...stateProposals);
        }

        return proposals;
    }

    /* =========================================================
       JURISPRUDÊNCIA (Lógica de Decisão)
    ========================================================= */

    _reactToObservation(obs, state) {
        // LEI 1: Se o servidor propõe uma tarefa e estou livre -> Aceite.
        if (obs.code === ActionCode.PROPOSE_TASK) {
            if (state.is_idle) {
                return {
                    action: 'ACTIVATE_TASK', // Comando interno para o TaskEffector
                    payload: obs.payload,
                };
            }
            // Se já estou ocupado, rejeite educadamente.
            return {
                action: 'EMIT_EVENT',
                payload: this._createRejectionEnvelope(obs, 'BUSY'),
            };
        }

        // LEI 2: Se o sistema reporta alta pressão -> Pausa técnica.
        if (obs.code === 'HIGH_PRESSURE') {
            console.warn('[POLICY] Alta pressão detectada. Recomendando throttle.');
            // Futuro: Implementar pausa
        }

        return null;
    }

    _evaluateStateHealth(state) {
        const proposals = [];

        // LEI 3: Limite de Tentativas (Retry Policy)
        // Se a tarefa atual falhou mais que o permitido -> Aborte.
        if (state.status === STATUS_VALUES.RUNNING && state.failures > 0) {
            if (state.failures > this.MAX_RETRIES) {
                console.error(`[POLICY] Limite de falhas excedido (${state.failures}/${this.MAX_RETRIES}). Abortando.`);

                // 1. Matar o processo do driver
                proposals.push({ action: 'ABORT_TASK', reason: 'MAX_RETRIES_EXCEEDED' });

                // 2. Avisar o servidor
                proposals.push({
                    action: 'EMIT_EVENT',
                    payload: this._createTaskFailedEnvelope(state.task, 'MAX_RETRIES_EXCEEDED'),
                });
            } else {
                // Se ainda tem tentativas, o Driver (via TaskEffector) deve tentar se recuperar sozinho.
                // O Kernel apenas observa, a menos que queiramos forçar um reinício explícito.
                // Por enquanto, deixamos o sistema rodar ("Laissez-faire").
            }
        }

        return proposals;
    }

    /* =========================================================
       HELPERS DE BUROCRACIA (Criação de Envelopes de Resposta)
    ========================================================= */

    async _createRejectionEnvelope(originalObs, reason) {
        // Cria um envelope virtual para ser enviado pelo NERV
        const HighLevelNERV = await import('#nerv/adapters/high_level_adapter').then(m => m.default ?? m);
        const { ActorRole } = await import('#shared/nerv/constants');

        return HighLevelNERV.makeEnvelope({
            actor: ActorRole.MAESTRO,
            target: originalObs.source || ActorRole.SERVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.TASK_REJECTED,
            correlationId: originalObs.correlation_id,
            payload: { reason },
        });
    }

    async _createTaskFailedEnvelope(task, reason) {
        const HighLevelNERV = await import('#nerv/adapters/high_level_adapter').then(m => m.default ?? m);
        const { ActorRole } = await import('#shared/nerv/constants');

        return HighLevelNERV.makeEnvelope({
            actor: ActorRole.MAESTRO,
            target: ActorRole.SERVER,
            messageType: MessageType.EVENT,
            actionCode: ActionCode.TASK_FAILED,
            correlationId: task?.meta?.correlation_id, // Mantém o fio de Ariadne
            payload: {
                task_id: task?.meta?.id,
                reason,
            },
        });
    }
}

export default PolicyEngine;
