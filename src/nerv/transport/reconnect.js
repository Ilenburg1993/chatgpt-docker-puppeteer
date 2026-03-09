// @ts-check
/* ==========================================================================
   src/nerv/transport/reconnect.js
   Subsistema: NERV — Neural Event Relay Vector
   Módulo: transport/
   Arquivo: reconnect.js

   Papel:
   - Implementar política TÉCNICA de reconexão do meio físico
   - Reagir apenas a estados de conexão (up/down)
   - Emitir telemetria observacional sobre tentativas

   IMPORTANTE:
   - NÃO interpreta causa lógica da falha
   - NÃO decide sucesso/falha semântica
   - NÃO bloqueia o NERV
   - NÃO conhece Kernel, Driver ou Server
   - Atua apenas no plano físico

   Linguagem: JavaScript (Node.js)
========================================================================== */

/* ===========================
   Utilitários internos
=========================== */

/**
 * Executa função de forma segura.
 *
 * @param {Function} fn
 */
function safeCall(fn) {
    try {
        fn();
    } catch (/** @type {any} */ _) {
        // falha física não deve propagar
    }
}

/**
 * Retorna timestamp atual.
 */
function now() {
    return Date.now();
}

/* ===========================
   Fábrica do reconector
=========================== */

/**
 * @typedef {object} CreateReconnectDeps
 * @property {any} telemetry
 * @property {function(): void} start
 * @property {function(): void} stop
 * @property {any} [policy]
 */
/**
 * @typedef {object} CreateReconnectOptions
 * @property {any} [telemetry]
 * @property {any} [start]
 * @property {any} [stop]
 * @property {any} [policy]
 */
/**
 * Cria um controlador técnico de reconexão.
 *
 * **Side-effects:** Agenda timers de reconexão, emite telemetria. **Semântica:** Política técnica de retry para
 * transporte físico. **Unidades:** interval em ms (padrão 1000), maxAttempts como inteiro ou null.
 *
 * @param {CreateReconnectDeps} deps - Dependências do controlador
 * @param {object} deps
 * @param {object} deps.policy
 * @param {number} [deps.policy.interval=1000] - Intervalo entre tentativas (ms). Default is `1000`
 * @param {number | null} [deps.policy.maxAttempts=null] - Máximo de tentativas (null=infinito). Default is `null`
 * @returns {any} Controlador com métodos start, stop, onConnectionUp, onConnectionDown
 * @throws {Error} Se dependências obrigatórias estiverem ausentes ou inválidas
 */
function createReconnect({ telemetry, start, stop, policy = {} }) {
    if (!telemetry || typeof telemetry.emit !== 'function') {
        throw new Error('reconnect requer telemetry válida');
    }

    if (typeof start !== 'function' || typeof stop !== 'function') {
        throw new Error('reconnect requer start/stop válidos');
    }

    const interval = typeof policy.interval === 'number' ? policy.interval : 1000;
    const maxAttempts = typeof policy.maxAttempts === 'number' ? policy.maxAttempts : null;

    let attempts = 0;
    let active = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;

    /* ===========================
     Operações internas
  =========================== */

    function schedule() {
        if (timer) {
            return;
        }

        timer = setTimeout(() => {
            timer = null;
            tryReconnect();
        }, interval);
    }

    function tryReconnect() {
        if (!active) {
            return;
        }

        if (maxAttempts !== null && attempts >= maxAttempts) {
            telemetry.emit('nerv:transport:reconnect:exhausted', {
                attempts,
            });
            return;
        }

        attempts += 1;

        telemetry.emit('nerv:transport:reconnect:attempt', {
            attempt: attempts,
            timestamp: now(),
        });

        safeCall(stop);
        safeCall(start);

        schedule();
    }

    /* ===========================
     API pública
  =========================== */

    function startReconnecting() {
        if (active) {
            return;
        }

        active = true;
        attempts = 0;

        telemetry.emit('nerv:transport:reconnect:start');
        schedule();
    }

    function stopReconnecting() {
        if (!active) {
            return;
        }

        active = false;

        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        telemetry.emit('nerv:transport:reconnect:stop');
    }

    /* ===========================
     Exportação canônica
  =========================== */

    return Object.freeze({
        start: startReconnecting,
        stop: stopReconnecting,
    });
}

export default createReconnect;
