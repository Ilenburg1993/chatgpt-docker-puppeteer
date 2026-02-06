import * as envelopesModule from '#shared/nerv/envelope';
import { CONNECTION_MODES } from '#core/constants/browser';
import createCorrelation from './correlation/correlation_store.js';
import createTelemetry from './telemetry/ipc_telemetry.js';
import createBuffers from './buffers/buffers.js';
import createTransport from './transport/transport.js';
import createHybridTransport from './transport/hybrid_transport.js';
import createEmission from './emission/emission.js';
import createReception from './reception/reception.js';
import createHealth from './health/health.js';

/* ===========================
   Funções auxiliares de bootstrap
=========================== */

/**
 * Bootstrap: Socket.io adapter para modo híbrido
 */
async function bootstrapSocketAdapter(config) {
    const createSocketAdapter = await import('#infra/transport/socket_io_adapter').then(m => m.default ?? m);

    const socketAdapter = createSocketAdapter({
        url: config.socketUrl || process.env.NERV_SOCKET_URL || 'http://localhost:3008',
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
    const socketAdapter = mode === CONNECTION_MODES.HYBRID ? await bootstrapSocketAdapter(config) : null;

    /* 1. Telemetria */
    const telemetry = createTelemetry({ namespace: 'nerv' });

    /* 2. Hybrid transport */
    const hybridTransport = bootstrapHybridTransport({ mode, socketAdapter, telemetry });

    /* 3. Envelopes */
    const envelopes = {
        createEnvelope: envelopesModule.createEnvelope,
        normalize: envelopesModule.normalize,
        assertValid: envelopesModule.assertValid
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

export { createNERV };
