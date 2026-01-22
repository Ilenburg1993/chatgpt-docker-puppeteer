/* ==========================================================================
   src/nerv/NERV.js
   Subsistema: NERV — Neural Event Relay Vector
   Arquivo: NERV.js

   Estatuto:
   - COMPOSITOR ESTRUTURAL PURO
   - NÃO executa fluxo
   - NÃO registra callbacks internos
   - NÃO drena buffers
   - NÃO reage a eventos
   - NÃO decide
   - NÃO interpreta

   Este arquivo apenas CONSTRÓI e EXPÕE o NERV.
========================================================================== */

/* ===========================
   Imports canônicos
=========================== */

// Protocolo universal NERV
const { createEnvelope } = require('@shared/nerv/envelope');

const { CONNECTION_MODES: CONNECTION_MODES } = require('@core/constants/browser.js');

// Núcleo estrutural
const createCorrelation = require('./correlation/correlation_store');
const createTelemetry = require('./telemetry/ipc_telemetry');

// Infraestrutura
const createBuffers = require('./buffers/buffers');
const createTransport = require('./transport/transport');
const createHybridTransport = require('./transport/hybrid_transport'); // ONDA 2.6

// Fronteiras semânticas neutras
const createEmission = require('./emission/emission');
const createReception = require('./reception/reception');
const createHealth = require('./health/health');

/* ===========================
   Funções auxiliares de bootstrap
=========================== */

/**
 * Bootstrap: Socket.io adapter para modo híbrido
 */
function bootstrapSocketAdapter(config) {
    const createSocketAdapter = require('@infra/transport/socket_io_adapter');

    const socketAdapter = createSocketAdapter({
        url: config.socketUrl || process.env.NERV_SOCKET_URL || 'http://localhost:3333',
        options: config.socketOptions || {}
    });

    // Log de eventos de conexão (antes de criar telemetria)
    socketAdapter.events.on('log', ({ level, msg }) => {
        console.log(`[NERV/${level}] ${msg}`);
    });

    return socketAdapter;
}

/**
 * Bootstrap: Hybrid transport (local + Socket.io)
 */
function bootstrapHybridTransport({ mode, socketAdapter, telemetry }) {
    if (mode === CONNECTION_MODES.LOCAL || mode === CONNECTION_MODES.HYBRID) {
        const hybridTransport = createHybridTransport({
            mode,
            socketAdapter,
            telemetry
        });

        hybridTransport.start();
        return hybridTransport;
    }
    return null;
}

/**
 * Bootstrap: Transport físico (híbrido ou customizado)
 */
function bootstrapTransport({ hybridTransport, config, telemetry }) {
    // ONDA 2.6: Usa hybridTransport se local/hybrid, ou transport customizado
    return (
        hybridTransport ||
        (config.transport?.adapter
            ? createTransport({
                  telemetry,
                  adapter: config.transport.adapter,
                  reconnect: config.transport?.reconnect
              })
            : null)
    );
}

/**
 * Constrói a interface pública do NERV
 */
function buildPublicAPI({
    hybridTransport,
    emission,
    reception,
    buffers,
    transport,
    health,
    telemetry,
    socketAdapter
}) {
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
        onReceive: hybridTransport ? hybridTransport.onReceive : reception.onReceive,
        onEvent: hybridTransport ? hybridTransport.onEvent : reception.onEvent || reception.onReceive,
        onCommand: reception.onCommand || reception.onReceive,
        onActor: hybridTransport ? hybridTransport.onActor : reception.onReceive,

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

        /* Shutdown gracioso */
        async shutdown() {
            if (hybridTransport) {
                hybridTransport.stop();
            }
            if (transport && transport.stop) {
                transport.stop();
            }
            if (socketAdapter && socketAdapter.stop) {
                socketAdapter.stop();
            }
        }
    };
}

/* ===========================
   Fábrica do NERV
=========================== */

/**
 * Cria o subsistema NERV.
 *
 * @param {Object} config
 * Configurações estruturais:
 * - mode: 'local' | 'hybrid' (default: 'local')
 *   * local: EventEmitter puro (in-process)
 *   * hybrid: EventEmitter + Socket.io adapter (local + remoto)
 * - transport: { adapter, reconnect? } (se mode='remote' ou adapter customizado)
 * - buffers: { inbound?, outbound? }
 * - health: { thresholds? }
 * - socketUrl: URL do servidor Socket.io (se mode='hybrid')
 */
async function createNERV(config = {}) {
    /* 0. Modo de operação */
    const mode = config.mode || CONNECTION_MODES.LOCAL;
    const socketAdapter = mode === CONNECTION_MODES.HYBRID ? bootstrapSocketAdapter(config) : null;

    /* 1. Telemetria */
    const telemetry = createTelemetry({ namespace: 'nerv' });

    /* 2. Hybrid transport */
    const hybridTransport = bootstrapHybridTransport({ mode, socketAdapter, telemetry });

    /* 3. Envelopes */
    const envelopes = {
        createEnvelope,
        normalize: createEnvelope,
        validate: env => env
    };

    /* 4. Correlação */
    const correlation = createCorrelation({ telemetry });

    /* 5. Buffers */
    const buffers = createBuffers({
        telemetry,
        limits: config.buffers || {}
    });

    /* 6. Transporte físico */
    const transport = bootstrapTransport({ hybridTransport, config, telemetry });

    /* 7. Emissão */
    const emission = createEmission({
        envelopes,
        buffers,
        correlation,
        telemetry,
        transport
    });

    /* 8. Recepção */
    const reception = createReception({
        envelopes,
        correlation,
        telemetry
    });

    /* 9. Health */
    const health = createHealth({
        telemetry,
        thresholds: config.health?.thresholds || {}
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
        socketAdapter
    });

    return Object.freeze(publicAPI);
}

module.exports = { createNERV };
