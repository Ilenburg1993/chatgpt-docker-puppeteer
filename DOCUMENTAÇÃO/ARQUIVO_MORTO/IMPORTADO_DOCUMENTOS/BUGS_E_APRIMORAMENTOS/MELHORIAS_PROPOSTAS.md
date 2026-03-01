# Melhorias e Refactorings Propostos - Auditoria Main.js

**Data da Auditoria:** 2026-02-13 (Atualizado) **Arquivos Analisados:** `src/main.js` (1372 linhas),
`src/server/main.js` (394 linhas) **Total de Melhorias:** 14 (3 P0, 4 P1, 5 P2, 2 P3)

---

## Code Smells Críticos Identificados

| Code Smell             | Métrica                        | Threshold           | Status          |
| ---------------------- | ------------------------------ | ------------------- | --------------- |
| **God Function**       | `boot()` = 705 linhas          | ≤ 200 linhas        | ❌ 3.5x acima   |
| **Control Structures** | 71 estruturas de controle      | ≤ 15                | ❌ 4.7x acima   |
| **Deep Nesting**       | 6+ níveis de indentação        | ≤ 4 níveis          | ❌ Violação     |
| **Duplicação**         | 26 linhas (socket wrapper) × 2 | 0% duplicação       | ❌ 52 linhas    |
| **Magic Numbers**      | 16 parsing patterns            | Constantes nomeadas | ❌ Hardcoded    |
| **process.exit()**     | 22 chamadas diretas            | Mockável            | ❌ Não testável |

---

## Melhorias Críticas (P0) - Implementar Imediatamente

### M1 - Extrair Constantes de Configuração (Magic Numbers)

**Prioridade:** P0 **Tipo:** Maintainability + Performance **Impacto:** Alto - Tunização do sistema
sob carga **Esforço:** 2h

#### Problema

Encontramos **16 ocorrências** do padrão `Number(process.env.XXX || defaultValue)` espalhadas pelo
código:

```javascript
// src/main.js linhas 567-616
const queueWorkerIntervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || 250) || 250;
const heartbeatIntervalMs = Number(process.env.HEARTBEAT_WATCHDOG_INTERVAL_MS || 500) || 500;
const kernelCycleMs = Number(process.env.KERNEL_CYCLE_INTERVAL || 1000) || 1000;
// ... mais 13 ocorrências
```

**Problemas específicos:**

- Valores duplicados (250ms, 500ms, 1000ms aparecem múltiplas vezes)
- Inconsistência entre MAIN e AGENT_LOOP (linhas 610-616 replicam intervalos)
- Impossível tunizar sistema sem editar código fonte
- Dificulta testes com timers mockados

#### Proposta de Solução

Criar `src/core/boot_config.js`:

```javascript
/**
 * Configuração centralizada de bootstrap
 * Fonte única de verdade para intervalos, timeouts e limites
 */
class BootConfig {
  constructor() {
    // Worker Intervals (250ms - 5000ms)
    this.QUEUE_WORKER_INTERVAL_MS = this._parseInterval('QUEUE_WORKER_INTERVAL_MS', 250, 100, 5000);
    this.HEARTBEAT_WATCHDOG_INTERVAL_MS = this._parseInterval(
      'HEARTBEAT_WATCHDOG_INTERVAL_MS',
      500,
      100,
      5000
    );
    this.KERNEL_CYCLE_INTERVAL = this._parseInterval('KERNEL_CYCLE_INTERVAL', 1000, 50, 5000);
    this.MISSION_RUNNER_INTERVAL_MS = this._parseInterval(
      'MISSION_RUNNER_INTERVAL_MS',
      1500,
      500,
      10000
    );

    // Timeouts (5s - 180s)
    this.KERNEL_BOOT_TIMEOUT_MS = this._parseInterval(
      'KERNEL_BOOT_TIMEOUT_MS',
      30000,
      5000,
      180000
    );
    this.SERVER_DISCOVERY_TIMEOUT = this._parseInterval(
      'SERVER_DISCOVERY_TIMEOUT',
      30000,
      0,
      180000
    );
    this.SSOT_INIT_TIMEOUT_MS = this._parseInterval('SSOT_INIT_TIMEOUT_MS', 30000, 10000, 180000);

    // Limites de processamento
    this.AGENT_LOOP_BATCH_SIZE = this._parseInt('AGENT_LOOP_BATCH_SIZE', 10, 1, 100);
    this.MAX_CONCURRENT_MISSIONS = this._parseInt('MAX_CONCURRENT_MISSIONS', 3, 1, 10);
  }

  /**
   * Valida intervalo com range checking
   */
  _parseInterval(envVar, defaultValue, min, max) {
    const value = Number(process.env[envVar] ?? defaultValue);
    if (value < min || value > max) {
      log(
        'WARN',
        `[BootConfig] ${envVar}=${value} fora do range [${min}, ${max}], usando ${defaultValue}`
      );
      return defaultValue;
    }
    return value;
  }

  /**
   * Recarrega configuração dinamicamente (SIGHUP)
   */
  async reload() {
    const old = { ...this };
    this.constructor(); // Re-run parsing

    // Emit telemetry se mudou
    const changed = Object.keys(this).filter(k => old[k] !== this[k]);
    if (changed.length > 0) {
      log(
        'INFO',
        `[BootConfig] Recarregadas ${changed.length} configurações: ${changed.join(', ')}`
      );
    }
  }
}

export default new BootConfig(); // Singleton
```

**Uso:**

```javascript
import bootConfig from '#core/boot_config';

const queueWorker = new QueueWorker({
  intervalMs: bootConfig.QUEUE_WORKER_INTERVAL_MS, // Validado e centralizado
});
```

#### Benefícios

- ✅ Fonte única de verdade para 16+ configurações numéricas
- ✅ Validação de range (ex: 250ms não pode virar -100ms por erro de ENV)
- ✅ Reload dinâmico via SIGHUP sem restart
- ✅ Testável com mocks fáceis (`bootConfig.QUEUE_WORKER_INTERVAL_MS = 10`)
- ✅ Telemetria de mudanças de configuração

---

### M2 - Consolidar Padrão "Fallback Duplo" Incorreto

**Prioridade:** P0 **Tipo:** Bug Potencial + Maintainability **Impacto:** Alto - Valores 0 são
ignorados incorretamente **Esforço:** 1h

#### Problema

Padrão `Number(env || defaultValue) || fallback` tem bug sutil:

```javascript
// src/main.js:567
const queueWorkerIntervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || 250) || 250;

// Se QUEUE_WORKER_INTERVAL_MS=0:
// 1. (process.env... || 250) → 250 ✅ OK
// 2. Number(250) → 250
// 3. 250 || 250 → 250 ✅ OK

// Mas se QUEUE_WORKER_INTERVAL_MS='abc':
// 1. ('abc' || 250) → 'abc' ❌ BUG
// 2. Number('abc') → NaN
// 3. NaN || 250 → 250 ✅ Fallback funciona por acaso

// E se QUEUE_WORKER_INTERVAL_MS='0' (string):
// 1. ('0' || 250) → '0' ❌ BUG
// 2. Number('0') → 0
// 3. 0 || 250 → 250 ❌ BUG! Valor legítimo 0 é ignorado
```

**Impacto:**

- Valor 0 nunca pode ser usado (mesmo se intencional)
- Comportamento contrasintuitivo dificulta debugging
- Anti-padrão não é idiómatico em JavaScript moderno

#### Proposta de Solução

```javascript
// ❌ ANTES (16 ocorrências):
const value = Number(process.env.VAR || defaultValue) || fallback;

// ✅ DEPOIS (usar nullish coalescing):
const value = Number(process.env.VAR ?? defaultValue);

// Ou com validação explícita:
function parseInterval(envVar, defaultValue, min = 0, max = Infinity) {
  const raw = process.env[envVar];
  const parsed = raw !== undefined ? Number(raw) : defaultValue;

  // Valida se é número válido E está no range
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    log('WARN', `[Config] ${envVar}="${raw}" inválido, usando ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}
```

#### Benefícios

- ✅ Suporta valor 0 como legítimo
- ✅ Código mais previsível e idiomático
- ✅ Validação explícita vs. fallback implícito
- ✅ Mensagens de erro claras quando parsing falha

---

### M3 - Modularizar `resolveAuthority()` e `resolveServerMode()`

**Prioridade:** P0 **Tipo:** DRY Violation + Maintainability **Impacto:** Alto - Duplicação de
lógica crítica **Esforço:** 1.5h

#### Problema

Lógica de resolução de autoridade duplicada entre arquivos:

- **src/main.js (L131-187):** Implementação manual com validação PM2 + integrated conflict
- **src/server/main.js (L119):** Usa `Authority.resolveAuthority()` modularizado ✅

```javascript
// src/main.js:152 - Manual
let serverMode = process.env.SERVER_MODE || 'integrated';
if (isPM2 && serverMode === 'integrated') {
  log('FATAL', '[CONFIG] ❌ PM2 + SERVER_MODE=integrated é inválido');
  process.exit(1);
}

// src/server/main.js:119 - Modularizado
const authority = Authority.resolveAuthority(isPM2, serverMode);
```

**Problemas:**

- Regras de validação podem divergir (já aconteceu)
- Mudanças em PM2 logic requerem editar 2 arquivos
- Lógica não testável isoladamente
- Code smell: "Don't Repeat Yourself" violado

#### Proposta de Solução

Criar `src/core/authority_resolver.js`:

```javascript
import { log } from '#core/logger';
import { Authority } from '#shared/constants/authority';

/**
 * Resolve modo de servidor com validação
 * @param {boolean} isPM2 - Se processo está sob PM2
 * @param {string} serverModeEnv - Valor de SERVER_MODE
 * @returns {'integrated'|'split'|'disabled'}
 */
export function resolveServerMode(isPM2, serverModeEnv) {
  const mode = serverModeEnv || 'integrated';
  const validModes = ['integrated', 'split', 'disabled'];

  if (!validModes.includes(mode)) {
    log('FATAL', `[CONFIG] SERVER_MODE="${mode}" inválido. Use: ${validModes.join(', ')}`);
    process.exit(1);
  }

  // PM2 + integrated é incompatível
  if (isPM2 && mode === 'integrated') {
    log('FATAL', '[CONFIG] ❌ PM2 + SERVER_MODE=integrated é inválido');
    log('FATAL', '[CONFIG] Use SERVER_MODE=split ou disabled com PM2');
    process.exit(1);
  }

  return mode;
}

/**
 * Resolve autoridade do processo
 * @param {boolean} isPM2
 * @param {string} serverMode
 * @returns {Authority.MAESTRO|Authority.SERVER|Authority.STANDALONE}
 */
export function resolveAuthority(isPM2, serverMode) {
  return Authority.resolveAuthority(isPM2, serverMode);
}
```

**Uso em ambos os arquivos:**

```javascript
import { resolveServerMode, resolveAuthority } from '#core/authority_resolver';

const serverMode = resolveServerMode(isPM2, process.env.SERVER_MODE);
const authority = resolveAuthority(isPM2, serverMode);
```

#### Benefícios

- ✅ Fonte única de verdade para lógica de autoridade
- ✅ Testável isoladamente com mocks de ENV
- ✅ Mensagens de erro consistentes
- ✅ Evita drift entre main.js e server/main.js

---

## Melhorias de Alta Prioridade (P1) - Próximo Sprint

### M4 - Remover `checkPortInUse()` Manual

**Prioridade:** P1 **Tipo:** Resilience + Maintainability **Impacto:** Médio - Race condition TOCTOU
**Esforço:** 1h

#### Problema

Implementação manual de port checking (L97-118) tem race condition:

```javascript
async function checkPortInUse(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', err => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else reject(err);
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '0.0.0.0');
  });
}
```

**Problemas:**

- **TOCTOU (Time of Check, Time of Use):** Porta pode ser ocupada entre check (L324) e uso (L347)
- Sem timeout em `server.listen()` — pode ficar pendurado
- Error handling genérico não diferencia erros de rede

#### Proposta

```bash
npm install get-port
```

```javascript
import getPort from 'get-port';

// Substitui checkPortInUse() + port allocation
const port = await getPort({ port: preferredPort });
```

**Benefícios:**

- ✅ Elimina 22 linhas de código frágil
- ✅ Biblioteca testada em produção (400k+ downloads/semana)
- ✅ Suporta ranges, exclusões, IPv6

---

### M5 - Extrair ChromeProxy Boot em Função Separada

**Prioridade:** P1 **Tipo:** God Function Refactoring **Impacto:** Alto - Complexidade cognitiva
**Esforço:** 2h

#### Problema

Bloco monolítico de 73 linhas (L311-384) dentro de `boot()`:

```javascript
// FASE 2.5: CHROME PROXY SERVICE
if (CONFIG.CHROME_PROXY_ENABLED !== false) {
  // ... 73 linhas de lógica complexa
  // - Check de porta
  // - Instanciação
  // - NERV injection
  // - Error recovery
  // - Logging
}
```

**Impacto:**

- `boot()` tem 705 linhas (3.5x threshold de 200)
- Nesting profundo (6+ níveis)
- Impossível testar ChromeProxy boot isoladamente

#### Proposta

```javascript
async function initChromeProxyService(nerv, config) {
  if (config.CHROME_PROXY_ENABLED === false) {
    log('WARN', '[BOOT] Chrome Proxy desabilitado');
    return null;
  }

  // Port check
  const portInUse = await checkPortInUse(config.CHROME_PROXY_PORT);
  if (portInUse) throw new Error(`Porta ${config.CHROME_PROXY_PORT} em uso`);

  // Instantiate
  const ChromeProxyService = await import('./infra/proxy/chromeProxyService.js').then(
    m => m.default ?? m
  );
  const proxy = new ChromeProxyService(config.CHROME_PROXY_PORT, config.CHROME_PORT);

  // Inject NERV
  proxy.setNERV(nerv);

  // Start
  await proxy.start();

  return proxy;
}

// No boot():
const chromeProxy = await initChromeProxyService(nerv, CONFIG);
if (chromeProxy) {
  global.chromeProxy = chromeProxy;
}
```

**Benefícios:**

- ✅ Reduz `boot()` em 73 linhas
- ✅ Testável isoladamente
- ✅ Reutilizável em outros contexts (CLI, testes)
- ✅ Degraded mode explícito (retorna null)

---

### M6 - Consolidar Socket Hub Wrapper (26 linhas duplicadas × 2)

**Prioridade:** P1 **Tipo:** DRY Violation **Impacto:** Médio - Duplicação óbvia **Esforço:** 1h

#### Problema

Padrão `Object.create(socketHub)` + `sendToClient` fallback duplicado:

- **src/main.js:689-708** (split mode)
- **src/main.js:743-765** (integrated mode)

**26 linhas × 2 = 52 linhas duplicadas**

#### Proposta

```javascript
function createSocketHubWrapper(socketHub) {
  const wrapper = Object.create(socketHub);

  wrapper.sendToClient = function (event, payload) {
    try {
      if (socketHub && typeof socketHub.emit === 'function') {
        socketHub.emit(event, payload);
      } else {
        log('DEBUG', `[SocketHub] Fallback: ${event} (socketHub indisponível)`);
      }
    } catch (err) {
      log('WARN', `[SocketHub] Erro ao enviar ${event}: ${err.message}`);
    }
  };

  return wrapper;
}

// Uso:
const wrappedSocketHub = createSocketHubWrapper(socketHub);
```

**Benefícios:**

- ✅ Elimina 26 linhas de duplicação
- ✅ Testável como unidade
- ✅ Mudanças propagam automaticamente

---

### M7 - Implementar Circuit Breaker para Subsistemas Críticos

**Prioridade:** P1 **Tipo:** Resilience **Impacto:** Alto - Produção essencial **Esforço:** 3h

#### Problema

Boot sequencial sem graceful degradation:

```
NERV → BrowserPool → KERNEL → Server
  ↓          ↓           ↓        ↓
  ✅         ❌          ✅       ✅
           CRASH TOTAL DO SISTEMA
```

Se BrowserPool falha (L435-459), sistema inteiro aborta. Sem retry automático.

#### Proposta

```javascript
import CircuitBreaker from 'opossum';

const browserPoolBreaker = new CircuitBreaker(initBrowserPoolResilient, {
  timeout: 30000, // 30s timeout
  errorThresholdPercentage: 50,
  resetTimeout: 30000, // Half-open após 30s
});

browserPoolBreaker.fallback(() => {
  log('WARN', '[BOOT] BrowserPool falhou, entrando em modo degradado');
  return createDegradedBrowserPool(); // Mock pool sem Chrome real
});

// Uso:
const browserPool = await browserPoolBreaker.fire();
```

**Estados do Circuit Breaker:**

- **CLOSED:** Operação normal
- **OPEN:** Falhas consecutivas → fallback imediato (sem tentar)
- **HALF-OPEN:** Testa se recuperou após timeout

**Benefícios:**

- ✅ Retry automático com backoff exponencial
- ✅ Modo degradado automático após N falhas
- ✅ Evita carga constante em sistema falho
- ✅ Telemetria de resiliência (success rate, latency percentiles)

---

## Melhorias de Média Prioridade (P2) - Backlog

### M8 - Extrair Shutdown Phase Manager

**Prioridade:** P2 **Tipo:** Maintainability **Esforço:** 3h

#### Problema

`shutdown()` tem 250+ linhas com callback hell (L919-1214):

```javascript
const phases = [
    { name: 'Reconciler', fn: async () => { ... } },
    { name: 'ChromeProxy', fn: async () => { ... } },
    // ... mais 8 fases
];

for (const phase of phases) {
    try {
        await phase.fn();
    } catch (err) {
        log('WARN', `[SHUTDOWN] ${phase.name}: ${err.message}`);
    }
}
```

#### Proposta

```javascript
class ShutdownOrchestrator {
  constructor() {
    this.phases = [];
  }

  addPhase(name, fn, options = {}) {
    this.phases.push({
      name,
      fn,
      timeout: options.timeout || 10000,
      critical: options.critical || false,
    });
  }

  async execute() {
    const results = [];

    for (const phase of this.phases) {
      const start = Date.now();

      try {
        await Promise.race([
          phase.fn(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), phase.timeout)),
        ]);

        results.push({ phase: phase.name, success: true, duration: Date.now() - start });
      } catch (err) {
        results.push({ phase: phase.name, success: false, error: err.message });

        if (phase.critical) {
          throw err; // Abort shutdown se crítico
        }
      }
    }

    return results;
  }
}
```

**Benefícios:**

- ✅ Timeout por fase (evita deadlock)
- ✅ Paralelização opcional com `Promise.all()`
- ✅ Relatório estruturado de shutdown
- ✅ Fases críticas vs. best-effort

---

### M9 - Adicionar Observabilidade: Métricas de Boot

**Prioridade:** P2 **Tipo:** Observability **Esforço:** 4h

#### Proposta

```javascript
import { sendEvent } from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole } from '#shared/nerv/constants';

async function bootPhase(name, fn) {
  const start = Date.now();
  const startMem = process.memoryUsage();

  try {
    await sendEvent(nerv, ActorRole.MAESTRO, ActionCode.BOOT_PHASE_START, { phase: name });

    await fn();

    const duration = Date.now() - start;
    const memDelta = process.memoryUsage().heapUsed - startMem.heapUsed;

    await sendEvent(nerv, ActorRole.MAESTRO, ActionCode.BOOT_PHASE_END, {
      phase: name,
      duration,
      memoryDelta: memDelta,
      success: true,
    });

    log('INFO', `[BOOT] ✅ ${name} (${duration}ms, +${(memDelta / 1024 / 1024).toFixed(2)}MB)`);
  } catch (err) {
    await sendEvent(nerv, ActorRole.MAESTRO, ActionCode.BOOT_PHASE_ERROR, {
      phase: name,
      error: err.message,
      stack: err.stack,
    });

    throw err;
  }
}
```

**Dashboard:**

```javascript
// GET /api/metrics/boot
{
    "totalDuration": 4523,
    "phases": [
        { "name": "NERV", "duration": 234, "memoryMB": 12.4 },
        { "name": "BrowserPool", "duration": 1823, "memoryMB": 45.2 },
        // ...
    ],
    "slo": {
        "target": 5000,
        "actual": 4523,
        "met": true
    }
}
```

**Benefícios:**

- ✅ SLO tracking (objetivo: boot < 5s)
- ✅ Detecta regressões de performance
- ✅ Dashboard real-time de health

---

## Melhorias de Baixa Prioridade (P3) - Nice to Have

### M12 - Validação de Schema no Retorno do Boot

**Prioridade:** P3 **Esforço:** 1h

```javascript
import { z } from 'zod';

const BootContextSchema = z.object({
  nerv: z.object({
    onEvent: z.function(),
    sendEvent: z.function(),
  }),
  kernel: z.object({
    start: z.function(),
    shutdown: z.function(),
  }),
  browserPool: z.any(),
  // ... 15 campos restantes
});

// No final de boot():
return BootContextSchema.parse(context); // Throws se shape inválido
```

---

## Roadmap Recomendado

### **Sprint 1 (4.5h) - P0 Quick Wins**

1. M2: Fallback duplo (1h)
2. M3: Authority resolver (1.5h)
3. M1: Magic numbers (2h)

### **Sprint 2 (7h) - P1 DRY + Resilience**

4. M6: Socket wrapper (1h)
5. M4: checkPortInUse (1h)
6. M5: ChromeProxy extraction (2h)
7. M7: Circuit breaker (3h)

### **Sprint 3+ (19h) - P2/P3 Architecture**

8. M8: Shutdown orchestrator (3h)
9. M9: Observabilidade (4h)
10. M10-M14: Resto (12h)

---

## Métricas de Impacto Estimado

| Métrica             | Antes     | Depois | Melhoria   |
| ------------------- | --------- | ------ | ---------- |
| Linhas em boot()    | 705       | ~450   | -36%       |
| Duplicação          | 52 linhas | 0      | -100%      |
| Magic numbers       | 16        | 0      | -100%      |
| Testability         | 20%       | 80%    | +300%      |
| Boot SLO compliance | ❓        | 95%    | Mensurável |

**Total de esforço:** ~30 horas de desenvolvimento **ROI estimado:** Alto (redução de 40% em
complexidade + 300% melhoria em testability)
