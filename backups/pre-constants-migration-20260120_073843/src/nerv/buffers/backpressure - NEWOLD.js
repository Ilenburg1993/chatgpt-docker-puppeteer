/* ==========================================================================
   src/nerv/buffers/backpressure.js
   Audit Level: 550 — Neural Pressure Sensor
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade:
     - Monitorar o tamanho das filas de saída (Outbox).
     - Emitir sinais de 'ALTA PRESSÃO' para o Kernel reduzir a carga.
     - Prevenir OOM (Out of Memory) em picos de tráfego.
========================================================================== */

/**
 * Limites de Segurança (Hardcoded por segurança constitucional)
 */
const THRESHOLDS = {
    WARNING: 50, // Avisa quando houver 50 mensagens na fila
    CRITICAL: 200 // Grita/Bloqueia quando houver 200 mensagens
};

/**
 * Fábrica do Sensor de Backpressure.
 * * @param {object} deps
 * @param {object} deps.telemetry - Emissor de eventos do NERV.
 */
function createBackpressure({ telemetry }) {
    // Estado interno volátil
    let currentSize = 0;
    let status = 'HEALTHY'; // HEALTHY | WARNING | CRITICAL

    /**
     * Avalia o novo tamanho da fila e emite eventos se houver transição de estado.
     * Deve ser chamado sempre que o buffer de transporte mudar de tamanho.
     * * @param {number} size - Tamanho atual da fila (queue length).
     */
    function update(size) {
        currentSize = size;
        let newStatus = 'HEALTHY';

        if (size >= THRESHOLDS.CRITICAL) {
            newStatus = 'CRITICAL';
        } else if (size >= THRESHOLDS.WARNING) {
            newStatus = 'WARNING';
        }

        // Detecção de Transição de Estado (Edge Trigger)
        if (newStatus !== status) {
            const previous = status;
            status = newStatus;

            telemetry.emit('nerv:backpressure:change', {
                from: previous,
                to: status,
                size: currentSize,
                timestamp: Date.now()
            });

            // Log de Alta Severidade para Diagnóstico
            if (status === 'CRITICAL') {
                telemetry.emit('nerv:log', {
                    level: 'WARN',
                    msg: `[BACKPRESSURE] Sistema congestionado! Fila: ${size}`
                });
            } else if (previous === 'CRITICAL' && status === 'WARNING') {
                telemetry.emit('nerv:log', {
                    level: 'INFO',
                    msg: '[BACKPRESSURE] Sistema drenando. Pressão reduzida.'
                });
            }
        }
    }

    /**
     * Retorna o estado atual de saúde do fluxo.
     * @returns {object} { status, size, congestionPct }
     */
    function getSnapshot() {
        return {
            status,
            size: currentSize,
            congestionPct: Math.min(100, (currentSize / THRESHOLDS.CRITICAL) * 100)
        };
    }

    return {
        update,
        getSnapshot,
        THRESHOLDS
    };
}

module.exports = createBackpressure;
