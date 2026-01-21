/* ==========================================================================
   src/kernel/nerv_bridge/kernel_nerv_bridge.js
   Subsistema: KERNEL — Núcleo Soberano de Decisão
   Módulo: nerv_bridge/
   Arquivo: kernel_nerv_bridge.js

   Papel:
   - Integrar o Kernel ao NERV como camada de comunicação IPC
   - Receber EVENTs do mundo e encaminhá-los ao ObservationStore
   - Emitir COMMANDs do Kernel via NERV
   - Traduzir entre semântica do Kernel e estrutura do NERV

   IMPORTANTE:
   - NÃO decide nada
   - NÃO interpreta payload dos envelopes
   - NÃO valida verdade semântica
   - NÃO fecha causalidade
   - Atua apenas como ponte estrutural

   Linguagem: JavaScript (Node.js)
========================================================================== */

const { v4: uuidv4 } = require('uuid');
const { ActorRole, MessageType, ActionCode } = require('../../shared/nerv/constants');
const { createEnvelope } = require('../../shared/nerv/envelope');

/* ===========================
   Utilitários internos
=========================== */

/**
 * Valida envelope recebido do NERV.
 */
function isValidEnvelope(envelope) {
    return envelope && envelope.header && envelope.ids && envelope.kind && envelope.payload;
}

/**
 * Extrai dados estruturais do envelope de forma segura.
 */
function extractEnvelopeData(envelope) {
    return {
        msgId: envelope.ids?.msg_id ?? null,
        correlationId: envelope.ids?.correlation_id ?? null,
        source: envelope.header?.source ?? 'unknown',
        timestamp: envelope.header?.timestamp ?? Date.now(),
        kind: envelope.kind,
        payload: envelope.payload
    };
}

/* ===========================
   Fábrica da Ponte KERNEL↔NERV
=========================== */

/**
 * Cria a ponte de integração entre Kernel e NERV.
 *
 * @param {Object} deps
 * @param {Object} deps.nerv
 * Instância do NERV já configurada.
 *
 * @param {Object} deps.taskRuntime
 * Instância do TaskRuntime.
 *
 * @param {Object} deps.observationStore
 * Instância do ObservationStore.
 *
 * @param {Object} deps.telemetry
 * Canal de telemetria do Kernel.
 */
class KernelNERVBridge {
    constructor({ nerv, taskRuntime, observationStore, telemetry }) {
        if (!nerv) {
            throw new Error('KernelNERVBridge requer instância do NERV');
        }

        if (!taskRuntime) {
            throw new Error('KernelNERVBridge requer TaskRuntime');
        }

        if (!observationStore) {
            throw new Error('KernelNERVBridge requer ObservationStore');
        }

        if (!telemetry || typeof telemetry.emit !== 'function') {
            throw new Error('KernelNERVBridge requer telemetria válida');
        }

        this.nerv = nerv;
        this.taskRuntime = taskRuntime;
        this.observationStore = observationStore;
        this.telemetry = telemetry;

        this.started = false;
        this.unsubscribe = null;
    }

    /* ===========================
     LIFECYCLE
  =========================== */

    /**
     * Inicia a ponte, registrando handlers no NERV.
     */
    start() {
        if (this.started) {
            this.telemetry.warning('nerv_bridge_already_started');
            return;
        }

        this.telemetry.info('nerv_bridge_starting', {
            at: Date.now()
        });

        // Registra handler de recepção de envelopes
        this.unsubscribe = this.nerv.onReceive(envelope => {
            this._handleInboundEnvelope(envelope);
        });

        this.started = true;

        this.telemetry.info('nerv_bridge_started', {
            at: Date.now()
        });
    }

    /**
     * Para a ponte, desregistrando handlers.
     */
    stop() {
        if (!this.started) {
            this.telemetry.warning('nerv_bridge_already_stopped');
            return;
        }

        this.telemetry.info('nerv_bridge_stopping', {
            at: Date.now()
        });

        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }

        this.started = false;

        this.telemetry.info('nerv_bridge_stopped', {
            at: Date.now()
        });
    }

    /* ===========================
     RECEPÇÃO DE ENVELOPES (INBOUND)
  =========================== */

    /**
     * Processa envelope recebido do NERV.
     *
     * IMPORTANTE:
     * - Apenas EVENTs são processados (fatos do mundo)
     * - ACKs são ignorados (confirmações físicas)
     * - COMMANDs recebidos são anomalia (Kernel não recebe comandos)
     */
    _handleInboundEnvelope(envelope) {
        if (!isValidEnvelope(envelope)) {
            this.telemetry.warning('nerv_bridge_invalid_envelope', {
                at: Date.now()
            });
            return;
        }

        const data = extractEnvelopeData(envelope);

        this.telemetry.info('nerv_bridge_envelope_received', {
            kind: data.kind,
            msgId: data.msgId,
            correlationId: data.correlationId,
            at: Date.now()
        });

        // Apenas EVENTs são fatos do mundo
        if (data.kind === MessageType.EVENT) {
            this._processEvent(envelope, data);
            return;
        }

        // ACKs são confirmações físicas (ignoradas semanticamente)
        if (data.kind === MessageType.ACK) {
            this.telemetry.info('nerv_bridge_ack_received', {
                msgId: data.msgId,
                at: Date.now()
            });
            return;
        }

        // COMMANDs recebidos são anomalia
        if (data.kind === MessageType.COMMAND) {
            this.telemetry.warning('nerv_bridge_unexpected_command', {
                msgId: data.msgId,
                source: data.source,
                at: Date.now()
            });
            return;
        }

        // Tipo desconhecido
        this.telemetry.warning('nerv_bridge_unknown_envelope_kind', {
            kind: data.kind,
            at: Date.now()
        });
    }

    /**
     * Processa EVENT recebido, encaminhando ao ObservationStore.
     */
    _processEvent(envelope, data) {
        try {
            // Delega ingestão ao ObservationStore
            this.observationStore.ingestEvent(envelope);

            this.telemetry.info('nerv_bridge_event_ingested', {
                msgId: data.msgId,
                correlationId: data.correlationId,
                at: Date.now()
            });
        } catch (error) {
            this.telemetry.critical('nerv_bridge_event_ingestion_failed', {
                msgId: data.msgId,
                error: error.message,
                at: Date.now()
            });
        }
    }

    /* ===========================
     EMISSÃO DE ENVELOPES (OUTBOUND)
  =========================== */

    /**
     * Emite um COMMAND via NERV.
     *
     * @param {Object} params
     * @param {string} params.target
     * Destinatário do comando (ex.: 'driver', 'server').
     *
     * @param {string} params.correlationId
     * ID de correlação (vincula a uma tarefa).
     *
     * @param {Object} params.payload
     * Payload opaco do comando.
     */
    emitCommand({ target, correlationId, payload }) {
        if (!this.started) {
            throw new Error('KernelNERVBridge não iniciada');
        }

        const msgId = uuidv4();

        const envelope = {
            header: {
                version: 1,
                timestamp: Date.now(),
                source: ActorRole.KERNEL.toLowerCase(),
                target
            },
            ids: {
                msg_id: msgId,
                correlation_id: correlationId
            },
            kind: MessageType.COMMAND,
            payload
        };

        try {
            this.nerv.emitCommand(envelope);

            this.telemetry.info('nerv_bridge_command_emitted', {
                msgId,
                correlationId,
                target,
                at: Date.now()
            });
        } catch (error) {
            this.telemetry.critical('nerv_bridge_command_emission_failed', {
                msgId,
                correlationId,
                error: error.message,
                at: Date.now()
            });

            throw error;
        }
    }

    /**
     * Emite um EVENT via NERV.
     *
     * @param {Object} params
     * @param {string} [params.target]
     * Destinatário opcional (broadcast se ausente).
     *
     * @param {string} params.correlationId
     * ID de correlação.
     *
     * @param {Object} params.payload
     * Payload opaco do evento.
     */
    emitEvent({ target = null, correlationId, payload }) {
        if (!this.started) {
            throw new Error('KernelNERVBridge não iniciada');
        }

        // Extrair actionCode do payload (ou usar genérico)
        const actionCode = payload.actionCode || ActionCode.KERNEL_TELEMETRY;

        // Criar envelope canônico usando factory
        const envelope = createEnvelope({
            actor: ActorRole.KERNEL,
            target: target ? ActorRole[target.toUpperCase()] : null,
            messageType: MessageType.EVENT,
            actionCode: actionCode,
            payload: payload,
            correlationId: correlationId
        });

        const msgId = envelope.causality.msg_id;

        try {
            this.nerv.emitEvent(envelope);

            this.telemetry.info('nerv_bridge_event_emitted', {
                msgId,
                correlationId,
                target: target ?? 'broadcast',
                at: Date.now()
            });
        } catch (error) {
            this.telemetry.critical('nerv_bridge_event_emission_failed', {
                msgId,
                correlationId,
                error: error.message,
                at: Date.now()
            });

            throw error;
        }
    }

    /* ===========================
     OBSERVABILIDADE
  =========================== */

    /**
     * Retorna status técnico da ponte.
     */
    getStatus() {
        return Object.freeze({
            started: this.started,
            nerv: this.nerv ? 'connected' : 'disconnected'
        });
    }
}

module.exports = {
    KernelNERVBridge
};
