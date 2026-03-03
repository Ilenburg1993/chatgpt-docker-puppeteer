// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { CONNECTION_MODES } from '#core/constants/browser';
import { log } from '#core/logger';
import * as envelopesModule from '#shared/nerv/envelope';
import { getActionCode, getMessageType } from '#shared/nerv/envelope_reader';
import createBuffers from './buffers/buffers.js';
import createCorrelation from './correlation/correlation_store.js';
import createEmission from './emission/emission.js';
import createHealth from './health/health.js';
import createReception from './reception/reception.js';
import createTelemetry from './telemetry/ipc_telemetry.js';
import createHybridTransport from './transport/hybrid_transport.js';
import createTransport from './transport/transport.js';

/**
 * @typedef {object} NERVConfig
 * @property {'LOCAL'|'HYBRID'} [mode='LOCAL'] - Modo de conexão NERV
 * @property {string} [socketUrl] - URL para Socket.io (modo HYBRID)
 * @property {object} [socketOptions] - Opções para Socket.io
 * @property {object} [buffers] - Configurações de buffers inbound/outbound
 * @property {object} [health] - Configurações de health monitoring
 */

/* ===========================
   Funções auxiliares de bootstrap
=========================== */

/**
 * Bootstrap: Socket.io adapter para modo híbrido
 * @param {*} config
 */
async function bootstrapSocketAdapter(config) {
    const { default: createSocketAdapter } = await import('#infra/transport/socket_io_adapter');

    const socketAdapter = createSocketAdapter({
        url: config.socketUrl || process.env.NERV_SOCKET_URL || 'http://localhost:3008',
        options: config.socketOptions || {},
    });

    // Log de eventos de conexão (antes de criar telemetria)
    socketAdapter.events.on('log', ({ level, msg }) => {
        log.info(`[NERV/${level}] ${msg}`);
    });

    return socketAdapter;
}

/**
 * @typedef {object} BootstrapHybridTransportOptions
 * @property {*} [mode]
 * @property {*} [socketAdapter]
 * @property {*} [telemetry]
 */
/**
 * Bootstrap: Hybrid transport (local + Socket.io)
 * @param {BootstrapHybridTransportOptions} [options]
 */
function bootstrapHybridTransport({ mode, socketAdapter, telemetry }) {
    if (mode === CONNECTION_MODES.LOCAL || mode === CONNECTION_MODES.HYBRID) {
        const hybridTransport = createHybridTransport({
            mode,
            socketAdapter,
            telemetry,
        });

        hybridTransport.start();
        return hybridTransport;
    }
    return null;
}

/**
 * @typedef {object} BootstrapTransportOptions
 * @property {*} [hybridTransport]
 * @property {*} [config]
 * @property {*} [telemetry]
 */
/**
 * Bootstrap: Transport físico (híbrido ou customizado)
 * @param {BootstrapTransportOptions} [options]
 */
function bootstrapTransport({ hybridTransport, config, telemetry }) {
    // ONDA 2.6: Usa hybridTransport se local/hybrid, ou transport customizado
    return (
        hybridTransport ||
        (config.transport?.adapter
            ? createTransport({
                  telemetry,
                  adapter: config.transport.adapter,
                  reconnect: config.transport?.reconnect,
              })
            : null)
    );
}

/**
 * @typedef {object} BuildPublicAPIOptions
 * @property {*} [hybridTransport]
 * @property {*} [emission]
 * @property {*} [reception]
 * @property {*} [buffers]
 * @property {*} [transport]
 * @property {*} [health]
 * @property {*} [telemetry]
 * @property {*} [socketAdapter]
 */
/**
 * Constrói a interface pública do NERV
 * @param {BuildPublicAPIOptions} [options]
 */
function buildPublicAPI({
    hybridTransport,
    emission,
    reception,
    buffers,
    transport,
    health,
    telemetry,
    socketAdapter,
}) {
    const baseOnReceive = hybridTransport ? hybridTransport.onReceive : reception.onReceive;

    return {
        /* Emissão */
        emit: envelope => {
            // ONDA 2.6: Emite via hybrid transport diretamente
            if (hybridTransport) {
                return hybridTransport.send(envelope);
            }
            return emission.emitEvent(envelope);
        },
        send: envelope => {
            // Alias para emit - usado pelos testes
            if (hybridTransport) {
                return hybridTransport.send(envelope);
            }
            return emission.emitEvent(envelope);
        },
        emitCommand: emission.emitCommand,
        emitEvent: emission.emitEvent,
        emitAck: emission.emitAck,

        /* Recepção */
        receive: reception.receive,
        onReceive: baseOnReceive,
        onEvent: (actionCodeOrHandler, maybeHandler) => {
            // overload:
            // - onEvent(handler) => all EVENT envelopes
            // - onEvent(actionCode, handler) => EVENT envelopes with action_code == actionCode
            if (typeof actionCodeOrHandler === 'function') {
                const handler = actionCodeOrHandler;
                return baseOnReceive(envelope => {
                    if (getMessageType(envelope) === 'EVENT') handler(envelope);
                });
            }

            if (typeof actionCodeOrHandler === 'string' && typeof maybeHandler === 'function') {
                const actionCode = actionCodeOrHandler;
                const handler = maybeHandler;
                return baseOnReceive(envelope => {
                    if (getMessageType(envelope) !== 'EVENT') return;
                    if (getActionCode(envelope) !== actionCode) return;
                    handler(envelope);
                });
            }

            throw new Error('onEvent requer (handler) ou (actionCode, handler)');
        },
        onCommand: reception.onCommand || reception.onReceive,
        onActor: (actor, handler) => {
            if (typeof actor !== 'string' || !actor.trim()) {
                throw new Error('onActor requer actor string');
            }
            if (typeof handler !== 'function') {
                throw new Error('onActor requer função');
            }
            return baseOnReceive(envelope => {
                const a = envelope?.identity?.actor || envelope?.actor || envelope?.header?.source || null;
                if (a === actor) handler(envelope);
            });
        },

        /* Buffers (exposição explícita; sem auto-drain) */
        buffers,

        /* Transporte (controle externo) */
        transport,

        /* Health (observação) */
        health,

        /* Telemetria (observação avançada) */
        telemetry,

        /* Status */
        getStatus: () => {
            if (hybridTransport && hybridTransport.getStatus) {
                return hybridTransport.getStatus();
            }
            return { mode: CONNECTION_MODES.LOCAL, status: 'active' };
        },

        /* Shutdown gracioso — limpa TODOS os subsistemas */
        async shutdown() {
            try {
                if (health && typeof health.shutdown === 'function') health.shutdown();
            } catch (_) {
                /* health cleanup best-effort */
            }
            try {
                if (buffers && typeof buffers.shutdown === 'function') buffers.shutdown();
            } catch (_) {
                /* buffers cleanup best-effort */
            }
            if (hybridTransport) {
                hybridTransport.stop();
            }
            if (transport && transport.stop) {
                transport.stop();
            }
            if (socketAdapter && socketAdapter.stop) {
                socketAdapter.stop();
            }
            try {
                if (telemetry && typeof telemetry.shutdown === 'function') telemetry.shutdown();
            } catch (_) {
                /* telemetry cleanup best-effort */
            }
        },
    };
}

/* ===========================
   Fábrica do NERV
=========================== */

/**
 * Cria o subsistema NERV (Neural Event Relay Virtual).
 *
 * **Side-effects:** Inicializa transportes, telemetria, correlação, buffers, health monitoring.
 * **Semântica:** Bootstrap completo do sistema de comunicação neural com todos os componentes.
 * **Unidades:** Configurações seguem typedef NERVConfig.
 *
 * @param {NERVConfig} [config={}] - Configurações estruturais do NERV
 * @returns {Promise<object>} Instância NERV com API pública completa (congelada)
 * @throws {Error} Se bootstrap de algum componente falhar
 */
async function createNERV(config = {}) {
    /* 0. Modo de operação */
    const mode = config.mode || CONNECTION_MODES.LOCAL;
    const socketAdapter = mode === CONNECTION_MODES.HYBRID ? await bootstrapSocketAdapter(config) : null;

    /* 1. Telemetria */
    const telemetry = createTelemetry({ namespace: 'nerv' });

    /* 2. Hybrid transport */
    const hybridTransport = bootstrapHybridTransport({ mode, socketAdapter, telemetry });

    /* 3. Envelopes */
    const envelopes = {
        createEnvelope: envelopesModule.createEnvelope,
        normalize: envelopesModule.normalize,
        assertValid: envelopesModule.assertValid,
    };

    /* 4. Correlação */
    const correlation = createCorrelation({ telemetry });

    /* 5. Buffers */
    const buffers = createBuffers({
        telemetry,
        limits: config.buffers || {},
    });

    /* 6. Transporte físico */
    const transport = bootstrapTransport({ hybridTransport, config, telemetry });

    /* 7. Emissão */
    const emission = createEmission({
        envelopes,
        buffers,
        correlation,
        telemetry,
    });

    /* 8. Recepção */
    const reception = createReception({
        envelopes,
        correlation,
        telemetry,
    });

    /* 9. Health */
    const health = createHealth({
        telemetry,
        thresholds: config.health?.thresholds || {},
    });

    /* 10. Interface pública */
    const publicAPI = buildPublicAPI({
        hybridTransport,
        emission,
        reception,
        buffers,
        transport,
        health,
        telemetry,
        socketAdapter,
    });

    return Object.freeze(publicAPI);
}

export { createNERV };
