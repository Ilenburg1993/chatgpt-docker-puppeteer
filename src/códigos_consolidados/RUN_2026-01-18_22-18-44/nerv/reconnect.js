FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\nerv\transport\reconnect.js
PASTA_BASE: nerv
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

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
 */
function safeCall(fn) {
  try {
    fn();
  } catch (_) {
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
 * Cria um controlador técnico de reconexão.
 *
 * @param {Object} deps
 * @param {Object} deps.telemetry
 * Interface de telemetria do NERV.
 *
 * @param {Function} deps.start
 * Função técnica para iniciar o transporte.
 *
 * @param {Function} deps.stop
 * Função técnica para encerrar o transporte.
 *
 * @param {Object} [deps.policy]
 * Política técnica opcional:
 * - interval (ms)
 * - maxAttempts (null = infinito)
 */
function createReconnect({
  telemetry,
  start,
  stop,
  policy = {}
}) {
  if (!telemetry || typeof telemetry.emit !== 'function') {
    throw new Error('reconnect requer telemetry válida');
  }

  if (typeof start !== 'function' || typeof stop !== 'function') {
    throw new Error('reconnect requer start/stop válidos');
  }

  const interval = typeof policy.interval === 'number' ? policy.interval : 1000;
  const maxAttempts =
    typeof policy.maxAttempts === 'number' ? policy.maxAttempts : null;

  let attempts = 0;
  let active = false;
  let timer = null;

  /* ===========================
     Operações internas
  =========================== */

  function schedule() {
    if (timer) return;

    timer = setTimeout(() => {
      timer = null;
      tryReconnect();
    }, interval);
  }

  function tryReconnect() {
    if (!active) return;

    if (maxAttempts !== null && attempts >= maxAttempts) {
      telemetry.emit('nerv:transport:reconnect:exhausted', {
        attempts
      });
      return;
    }

    attempts += 1;

    telemetry.emit('nerv:transport:reconnect:attempt', {
      attempt: attempts,
      timestamp: now()
    });

    safeCall(stop);
    safeCall(start);

    schedule();
  }

  /* ===========================
     API pública
  =========================== */

  function startReconnecting() {
    if (active) return;

    active = true;
    attempts = 0;

    telemetry.emit('nerv:transport:reconnect:start');
    schedule();
  }

  function stopReconnecting() {
    if (!active) return;

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
    stop: stopReconnecting
  });
}

module.exports = createReconnect;
