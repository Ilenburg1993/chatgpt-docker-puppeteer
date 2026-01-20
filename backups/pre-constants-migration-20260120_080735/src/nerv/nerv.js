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
const { createEnvelope } = require('../shared/nerv/envelope');
const { MessageType, ActionCode, ActorRole } = require('../shared/nerv/constants');

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
    /* =========================================================
     0. Modo de operação (ONDA 2.6: Suporte híbrido)
  ========================================================= */

    const mode = config.mode || 'local';
    let socketAdapter = null;
    let hybridTransport = null;

    // Se modo híbrido, cria adapter Socket.io
    if (mode === 'hybrid') {
        const createSocketAdapter = require('../infra/transport/socket_io_adapter');

        socketAdapter = createSocketAdapter({
            url: config.socketUrl || process.env.NERV_SOCKET_URL || 'http://localhost:3333',
            options: config.socketOptions || {}
        });

        // Log de eventos de conexão (antes de criar telemetria)
        socketAdapter.events.on('log', ({ level, msg }) => {
            console.log(`[NERV/${level}] ${msg}`);
        });
    }

    /* =========================================================
     1. Telemetria (base observacional)
  ========================================================= */

    const telemetry = createTelemetry({
        namespace: 'nerv'
    });

    // Agora que telemetry existe, cria hybrid transport
    if (mode === 'local' || mode === 'hybrid') {
        hybridTransport = createHybridTransport({
            mode,
            socketAdapter,
            telemetry
        });

        hybridTransport.start();
    }

    /* =========================================================
     2. Envelopes (protocolo universal NERV)
  ========================================================= */

    // Usa protocolo universal diretamente (sem compositor intermediário)
    const envelopes = {
        createEnvelope,
        normalize: createEnvelope, // Alias para compatibilidade
        validate: env => env // Validação já feita no createEnvelope
    };

    /* =========================================================
     3. Correlação (histórico factual)
  ========================================================= */

    const correlation = createCorrelation({ telemetry });

    /* =========================================================
     4. Buffers (FIFO técnico)
  ========================================================= */

    const buffers = createBuffers({
        telemetry,
        limits: config.buffers || {}
    });

    /* =========================================================
     5. Transporte físico (híbrido ou customizado)
  ========================================================= */

    // ONDA 2.6: Usa hybridTransport se local/hybrid, ou transport customizado
    const transport =
        hybridTransport ||
        (config.transport?.adapter
            ? createTransport({
                  telemetry,
                  adapter: config.transport.adapter,
                  reconnect: config.transport?.reconnect
              })
            : null);

    /* =========================================================
     6. Emissão (ato unilateral)
  ========================================================= */

    const emission = createEmission({
        envelopes,
        buffers,
        correlation,
        telemetry,
        transport // Pode ser null se mode='local'
    });

    /* =========================================================
     7. Recepção (fronteira factual)
  ========================================================= */

    const reception = createReception({
        envelopes,
        correlation,
        telemetry
    });

    /* =========================================================
     8. Health (observação de vitalidade)
  ========================================================= */

    const health = createHealth({
        telemetry,
        thresholds: config.health?.thresholds || {}
    });

    /* =========================================================
     9. Interface pública do NERV
  ========================================================= */

    const publicAPI = {
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
            return publicAPI.emit(envelope);
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
            return { mode: 'local', status: 'active' };
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

    return Object.freeze(publicAPI);
}

module.exports = { createNERV };
