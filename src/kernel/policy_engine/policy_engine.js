/* ==========================================================================
   src/kernel/policy_engine/policy_engine.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Módulo: policy_engine/
   Arquivo: policy_engine.js

   Papel:
   - Avaliar riscos, limites e condições internas
   - Emitir alertas normativos consultivos
   - Aconselhar o ExecutionEngine (não decide)
   - Aplicar políticas configuráveis

   IMPORTANTE:
   - NÃO decide
   - NÃO executa ações
   - NÃO controla tempo
   - NÃO interpreta EVENTs
   - NÃO comunica via IPC

   Toda saída é:
   - Consultiva
   - Sem efeito colateral
   - Semanticamente neutra

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Níveis Normativos
=========================== */

const PolicyLevel = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
});

/* ===========================
   Tipos de Alerta Normativo
=========================== */

const PolicyAlertType = Object.freeze({
    BUDGET_PRESSURE: 'BUDGET_PRESSURE',
    OBSERVATION_INCONSISTENCY: 'OBSERVATION_INCONSISTENCY',
    OBSERVATION_VOLUME: 'OBSERVATION_VOLUME',
    TASK_STAGNATION: 'TASK_STAGNATION',
    TASK_AGE_EXCEEDED: 'TASK_AGE_EXCEEDED',
    CONFIGURATION_RISK: 'CONFIGURATION_RISK',
    OBSERVATION_GAP: 'OBSERVATION_GAP',
    DUPLICATE_OBSERVATIONS: 'DUPLICATE_OBSERVATIONS'
});

/* ===========================
   Fábrica do PolicyEngine
=========================== */

class PolicyEngine {
    /**
     * @param {Object} params
     * @param {Object} params.telemetry
     * Canal de telemetria do Kernel.
     *
     * @param {Object} [params.limits]
     * Limites técnicos/configuracionais.
     */
    constructor({ telemetry, limits = {} }) {
        if (!telemetry || typeof telemetry.emit !== 'function') {
            throw new Error('PolicyEngine requer telemetria válida');
        }

        this.telemetry = telemetry;

        /**
         * Limites normativos configuráveis.
         */
        this.limits = {
            maxObservationsPerTask: limits.maxObservationsPerTask ?? 1000,
            maxTaskAgeMs: limits.maxTaskAgeMs ?? 300000, // 5 minutos
            maxStalledCycles: limits.maxStalledCycles ?? 10,
            maxObservationGapMs: limits.maxObservationGapMs ?? 30000, // 30 segundos
            maxDuplicateRatio: limits.maxDuplicateRatio ?? 0.3, // 30%
            ...limits
        };
    }

    /* ===========================
     AVALIAÇÃO NORMATIVA (PONTO ÚNICO)
  =========================== */

    /**
     * Avalia normativamente uma tarefa no contexto atual.
     *
     * @param {Object} params
     * @param {Object} params.task
     * Snapshot imutável da tarefa.
     *
     * @param {Array} params.observations
     * Lista de observações correlacionadas.
     *
     * @param {number} params.at
     * Timestamp do ciclo lógico.
     *
     * @returns {Object}
     * Avaliação normativa consultiva.
     */
    assess({ task, observations, at }) {
        const alerts = [];

        // 1. Avaliação de volume de observações
        this._assessObservationVolume(task, observations, alerts);

        // 2. Avaliação de idade da tarefa
        this._assessTaskAge(task, at, alerts);

        // 3. Avaliação de gaps de observação
        this._assessObservationGaps(task, observations, at, alerts);

        // 4. Avaliação de duplicação
        this._assessDuplication(observations, alerts);

        // 5. Avaliação de risco configuracional
        this._assessConfigurationRisk(task, observations, alerts);

        // 6. Avaliação de estagnação
        this._assessStagnation(task, observations, at, alerts);

        // Calcula nível normativo
        const level = this._computeLevel(alerts);

        const assessment = Object.freeze({
            level,
            alerts: Object.freeze(alerts),
            at
        });

        // Telemetria normativa
        this.telemetry.info('policy_engine_assessment_complete', {
            taskId: task.taskId,
            level,
            alertsCount: alerts.length,
            at
        });

        return assessment;
    }

    /* ===========================
     AVALIAÇÕES ESPECÍFICAS
  =========================== */

    /**
     * Avalia pressão por volume de observações.
     */
    _assessObservationVolume(task, observations, alerts) {
        if (observations.length > this.limits.maxObservationsPerTask) {
            alerts.push(
                Object.freeze({
                    type: PolicyAlertType.OBSERVATION_VOLUME,
                    message: 'Volume elevado de observações para a tarefa',
                    value: observations.length,
                    limit: this.limits.maxObservationsPerTask,
                    severity: 'HIGH'
                })
            );
        }
    }

    /**
     * Avalia idade lógica da tarefa.
     */
    _assessTaskAge(task, at, alerts) {
        if (this.limits.maxTaskAgeMs !== null) {
            const ageMs = at - task.createdAt;

            if (ageMs > this.limits.maxTaskAgeMs) {
                alerts.push(
                    Object.freeze({
                        type: PolicyAlertType.TASK_AGE_EXCEEDED,
                        message: 'Tarefa com idade lógica elevada',
                        value: ageMs,
                        limit: this.limits.maxTaskAgeMs,
                        severity: 'CRITICAL'
                    })
                );
            }
        }
    }

    /**
     * Avalia gaps temporais entre observações.
     */
    _assessObservationGaps(task, observations, at, alerts) {
        if (observations.length === 0) {
            return;
        }

        // Ordena por timestamp de ingestão
        const sorted = [...observations].sort((a, b) => a.ingestedAt - b.ingestedAt);

        const lastObs = sorted[sorted.length - 1];
        const gapMs = at - lastObs.ingestedAt;

        if (
            this.limits.maxObservationGapMs !== null &&
            gapMs > this.limits.maxObservationGapMs &&
            task.state === 'ACTIVE'
        ) {
            alerts.push(
                Object.freeze({
                    type: PolicyAlertType.OBSERVATION_GAP,
                    message: 'Gap temporal excessivo desde última observação',
                    value: gapMs,
                    limit: this.limits.maxObservationGapMs,
                    severity: 'MEDIUM'
                })
            );
        }
    }

    /**
     * Avalia taxa de duplicação de observações.
     */
    _assessDuplication(observations, alerts) {
        if (observations.length === 0) {
            return;
        }

        const msgIds = new Set();
        let duplicates = 0;

        for (const obs of observations) {
            if (msgIds.has(obs.msgId)) {
                duplicates++;
            } else {
                msgIds.add(obs.msgId);
            }
        }

        const duplicateRatio = duplicates / observations.length;

        if (this.limits.maxDuplicateRatio !== null && duplicateRatio > this.limits.maxDuplicateRatio) {
            alerts.push(
                Object.freeze({
                    type: PolicyAlertType.DUPLICATE_OBSERVATIONS,
                    message: 'Taxa elevada de observações duplicadas',
                    value: duplicateRatio,
                    limit: this.limits.maxDuplicateRatio,
                    severity: 'MEDIUM'
                })
            );
        }
    }

    /**
     * Avalia risco configuracional.
     */
    _assessConfigurationRisk(task, observations, alerts) {
        // Tarefa suspensa com observações acumuladas
        if (task.state === 'SUSPENDED' && observations.length > 0) {
            alerts.push(
                Object.freeze({
                    type: PolicyAlertType.CONFIGURATION_RISK,
                    message: 'Tarefa suspensa com observações acumuladas',
                    value: observations.length,
                    severity: 'LOW'
                })
            );
        }

        // Tarefa criada há muito tempo sem ativação
        const ageMs = Date.now() - task.createdAt;
        if (task.state === 'CREATED' && ageMs > 60000) {
            // 1 minuto
            alerts.push(
                Object.freeze({
                    type: PolicyAlertType.CONFIGURATION_RISK,
                    message: 'Tarefa criada mas não ativada após tempo limite',
                    value: ageMs,
                    severity: 'MEDIUM'
                })
            );
        }
    }

    /**
     * Avalia estagnação lógica.
     * [P2.1 CORREÇÃO] Adiciona contexto semântico para reduzir falsos positivos
     */
    _assessStagnation(task, observations, at, alerts) {
        // Tarefa ativa sem progresso recente
        if (task.state === 'ACTIVE' && observations.length > 0) {
            const sorted = [...observations].sort((a, b) => a.ingestedAt - b.ingestedAt);

            const lastObs = sorted[sorted.length - 1];
            const stalledMs = at - lastObs.ingestedAt;

            // [P2.1 FIX] Adiciona contexto semântico para reduzir falsos positivos
            const isWaitingForUser = task.metadata?.waitingForInput === true;
            const isLongOperation = task.metadata?.expectedDuration > 120000;

            // Só alerta se estagnado E não for operação esperada
            if (stalledMs > 120000 && !isWaitingForUser && !isLongOperation) {
                // 2 minutos sem progresso
                alerts.push(
                    Object.freeze({
                        type: PolicyAlertType.TASK_STAGNATION,
                        message: 'Tarefa ativa sem progresso recente',
                        value: stalledMs,
                        severity: 'HIGH'
                    })
                );
            }
        }

        // [P2.2 FIX] Usa contador de ciclos estagnados (maxStalledCycles)
        if (task.state === 'ACTIVE' && task.stalledCycleCount !== undefined) {
            if (task.stalledCycleCount > this.limits.maxStalledCycles) {
                alerts.push(
                    Object.freeze({
                        type: PolicyAlertType.TASK_STAGNATION,
                        message: 'Tarefa excedeu máximo de ciclos sem progresso',
                        value: task.stalledCycleCount,
                        severity: 'CRITICAL'
                    })
                );
            }
        }
    }

    /* ===========================
     CÁLCULO DO NÍVEL NORMATIVO
  =========================== */

    /**
     * Calcula nível normativo a partir dos alertas.
     *
     * @param {Array<Object>} alerts
     * @returns {string}
     */
    _computeLevel(alerts) {
        if (alerts.length === 0) {
            return PolicyLevel.LOW;
        }

        const severities = alerts.map(a => a.severity);

        // Se há algum CRITICAL, nível é CRITICAL
        if (severities.includes('CRITICAL')) {
            return PolicyLevel.CRITICAL;
        }

        // Se há algum HIGH, nível é HIGH
        if (severities.includes('HIGH')) {
            return PolicyLevel.HIGH;
        }

        // Se há mais de 3 MEDIUM, nível é HIGH
        const mediumCount = severities.filter(s => s === 'MEDIUM').length;
        if (mediumCount >= 3) {
            return PolicyLevel.HIGH;
        }

        // Se há algum MEDIUM, nível é MEDIUM
        if (severities.includes('MEDIUM')) {
            return PolicyLevel.MEDIUM;
        }

        // Caso contrário, LOW
        return PolicyLevel.LOW;
    }

    /* ===========================
     CONFIGURAÇÃO DINÂMICA
  =========================== */

    /**
     * Atualiza limites normativos em tempo de execução.
     *
     * @param {Object} newLimits
     */
    updateLimits(newLimits) {
        Object.assign(this.limits, newLimits);

        this.telemetry.info('policy_engine_limits_updated', {
            limits: this.limits,
            at: Date.now()
        });
    }

    /**
     * Retorna limites atuais.
     *
     * @returns {Object}
     */
    getLimits() {
        return Object.freeze({ ...this.limits });
    }
}

module.exports = {
    PolicyEngine,
    PolicyLevel,
    PolicyAlertType
};
