FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\server\supervisor\remediation.js
PASTA_BASE: server
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/server/supervisor/remediation.js
   Audit Level: 700 — Remediation Logic Engine (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Atuar como a inteligência prescritiva do sistema. 
                     Traduz diagnósticos de stall em manobras de autocura.
   Sincronizado com: reconciler.js V700, triage.js V70, constants.js V400.
========================================================================== */

const { IPCCommand } = require('../../shared/ipc/constants');
const { log } = require('../../../core/logger');

/**
 * Tabela de Políticas de Remediação (The Remediation Matrix).
 * Define a manobra tática para cada patologia detectada na interface.
 */
const RemediationPolicy = Object.freeze({
    
    // --- 1. COLAPSOS DE INFRAESTRUTURA FÍSICA ---
    
    'BROWSER_FROZEN': {
        action: IPCCommand.BROWSER_REBOOT,
        severity: 'HIGH',
        retryTask: true
    },
    
    'TERMINAL_INFRA_FAILURE': {
        action: IPCCommand.BROWSER_REBOOT,
        severity: 'CRITICAL',
        retryTask: true
    },

    'DIAGNOSTIC_CRASH': {
        action: IPCCommand.BROWSER_REBOOT,
        severity: 'HIGH',
        retryTask: true
    },

    // --- 2. BARREIRAS DE SEGURANÇA E ACESSO ---

    'CAPTCHA_CHALLENGE': {
        action: IPCCommand.ENGINE_PAUSE,
        severity: 'CRITICAL',
        notifyUser: true // Exige intervenção humana imediata no Dashboard
    },

    'INFRA_BARRIER_DETECTED': {
        action: IPCCommand.BROWSER_REBOOT, // Tenta contornar via reset de sessão
        severity: 'HIGH',
        retryTask: true
    },

    'LOGIN_REQUIRED': {
        action: IPCCommand.ENGINE_STOP,
        severity: 'HIGH',
        notifyUser: true
    },

    // --- 3. LIMITES E ERROS SEMÂNTICOS ---

    'LIMIT_REACHED': {
        action: IPCCommand.ENGINE_PAUSE,
        severity: 'MEDIUM',
        cooldown_ms: 3600000 // 1 hora de repouso para reset de cota
    },

    'GENERIC_ERROR_TEXT': {
        action: IPCCommand.TASK_RETRY,
        severity: 'MEDIUM',
        maxRetries: 1
    },

    // --- 4. ANOMALIAS DE LÓGICA E INTERFACE ---

    'LOGICAL_LOOP': {
        action: IPCCommand.CACHE_CLEAR,
        severity: 'MEDIUM',
        retryTask: true
    },

    'INPUT_NOT_FOUND': {
        action: IPCCommand.BROWSER_REBOOT,
        severity: 'HIGH',
        retryTask: true
    },

    'FINISHED_ABRUPTLY': {
        action: IPCCommand.TASK_RETRY,
        severity: 'LOW',
        maxRetries: 2
    },

    'VISUAL_ERROR_DETECTED': {
        action: IPCCommand.TASK_RETRY,
        severity: 'MEDIUM',
        maxRetries: 1
    }
});

class RemediationEngine {
    /**
     * Avalia um diagnóstico técnico e prescreve a manobra de autocura.
     * 
     * @param {object} diagnosis - Payload do evento STALL_DETECTED vindo do Driver.
     * @returns {object|null} Prescrição técnica ou null se não houver ação necessária.
     */
    evaluate(diagnosis) {
        if (!diagnosis || !diagnosis.type || diagnosis.type === 'HEALTHY') {
            return null;
        }

        const type = diagnosis.type;
        const policy = RemediationPolicy[type];

        if (!policy) {
            log('DEBUG', `[REMEDIATION] Sem política de autocura para o sintoma: ${type}`);
            return null;
        }

        log('INFO', `[REMEDIATION] Sintoma "${type}" reconhecido. Prescrevendo: ${policy.action}`);

        /**
         * Objeto de Prescrição:
         * Retornamos apenas os parâmetros lógicos. A execução via SocketHub 
         * é responsabilidade exclusiva do Reconciliador.
         */
        return {
            command: policy.action,
            params: {
                reason: `AUTOCURA:${type}`,
                severity: policy.severity,
                should_retry: policy.retryTask || false,
                cooldown: policy.cooldown_ms || 0,
                notify: policy.notifyUser || false,
                evidence: diagnosis.evidence || {}
            }
        };
    }
}

// Exporta como Singleton (Pure Logic Engine)
module.exports = new RemediationEngine();