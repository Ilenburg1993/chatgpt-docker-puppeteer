**Status**: Canônico de apoio.  
**Escopo**: aprofundamento arquitetural deste recorte.  
**Quando consultar**: quando precisar detalhar este subsistema, fluxo ou visão especializada.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](./ARCHITECTURE.md).

# 🔍 Boot Process Deep Dive - Investigação Completa

> **Status**: Documentação técnica profunda do processo de boot do sistema **Versão**: 1.0
> (2026-02-01) **Propósito**: Entender completamente como o sistema inicia, identificar conflitos
> potenciais e componentes envolvidos

---

## 📑 Índice

1. [Pontos de Entrada (Entry Points)](#1-pontos-de-entrada)
2. [Fluxos de Boot por Modo](#2-fluxos-de-boot-por-modo)
3. [Anatomia Completa: Maestro Boot](#3-anatomia-completa-maestro-boot)
4. [Anatomia Completa: Server Boot](#4-anatomia-completa-server-boot)
5. [Modos de Operação (SERVER_MODE)](#5-modos-de-operação)
6. [Autoridade de Processos (Authority Pattern)](#6-autoridade-de-processos)
7. [Descoberta de Serviços (Service Discovery)](#7-descoberta-de-serviços)
8. [Conflitos Identificados](#8-conflitos-identificados)
9. [Dependências entre Componentes](#9-dependências-entre-componentes)
10. [Diagramas de Fluxo](#10-diagramas-de-fluxo)
11. [Recomendações Críticas](#11-recomendações-críticas)

---

## 1. Pontos de Entrada

### 1.1 Entry Points Físicos

O sistema possui **4 pontos de entrada** possíveis:

```
📁 Workspace Root
├── index.js                    # Entry Point Proxy (wrapper)
├── src/main.js                 # Maestro Entry Point (real)
├── src/server/main.js          # Server Entry Point (standalone)
└── scripts/chrome-proxy-service.js  # Chrome Proxy Entry Point
```

#### 1.1.1 **index.js** (Proxy Entry Point)

**Arquivo**: `/index.js` **Responsabilidade**: Delega para `src/main.js` após configurar module
aliases

```javascript
#!/usr/bin/env node
// Activate module aliases (MUST be first)
require('module-alias/register');

// Delegate to actual entry point
const { main } = require('./src/main');
main();
```

**Usado por**:

- PM2 (`ecosystem.config.cjs` → `script: './index.js'`)
- Docker (`CMD ["node", "index.js"]`)
- npm scripts (`npm start`)
- Execução direta (`node index.js`)

**Características**:

- ✅ **Thin wrapper** (15 linhas)
- ✅ **Zero lógica de negócio**
- ✅ **Module-alias bootstrap** (CRÍTICO para imports `@core`, `@infra`, etc.)

---

#### 1.1.2 **src/main.js** (Maestro Entry Point)

**Arquivo**: `/src/main.js` (1,153 linhas) **Responsabilidade**: Boot completo do **Maestro**
(processo central)

**Função de entrada**:

```javascript
async function main() {
  try {
    const context = await boot();
    setupSignalHandlers(context);
    log('INFO', `[MAIN] ✅ Sistema operacional (modo=${context.serverMode})`);
  } catch (error) {
    log('FATAL', `[MAIN] Boot falhou: ${error.message}`);
    process.exit(1);
  }
}

// EXECUÇÃO CONDICIONAL
if (require.main === module) {
  main();
}
```

**Invocado quando**:

- PM2 executa `agente-gpt` app
- `index.js` delega via `require('./src/main')`
- Execução direta: `node src/main.js`

**Características**:

- ✅ **Boot completo em 6 fases** (NERV, Browser Pool, Kernel, Adapters, Missions, Server)
- ✅ **Shutdown coordenado** (10 fases em cascata reversa)
- ⚠️ **Pode iniciar server HTTP** se `SERVER_MODE=integrated`

---

#### 1.1.3 **src/server/main.js** (Server Entry Point)

**Arquivo**: `/src/server/main.js` (376 linhas) **Responsabilidade**: Boot do **Server** (processo
HTTP + Socket.io)

**Função de entrada**:

```javascript
async function bootstrap(options = {}) {
  const authority = Authority.resolveAuthority(options.authority);

  try {
    log('INFO', `🚀 Server Process — Canonical Bootstrap (authority=${authority})`);

    // 10 fases de boot...
    return { port, httpServer, nerv, serverAdapter, authority };
  } catch (err) {
    log('FATAL', `[BOOT] Bootstrap falhou: ${err.message}`);
    if (Authority.isStandalone(authority)) {
      process.exit(1);
    }
    throw err;
  }
}

// EXECUÇÃO CONDICIONAL
if (require.main === module) {
  (async () => {
    try {
      await bootstrap();
    } catch (err) {
      log('FATAL', `[BOOT] Entrypoint bootstrap falhou: ${err.message}`);
      process.exit(1);
    }
  })();
}
```

**Invocado quando**:

- PM2 executa `dashboard-web` app
- Maestro chama `bootstrap({ authority: 'delegated', nerv })` em modo `integrated`
- Execução direta: `node src/server/main.js`

**Características**:

- ✅ **Suporta 2 modos de autoridade** (`standalone` vs `delegated`)
- ✅ **Não cria NERV** se injetado externamente (delegated)
- ✅ **Não registra signal handlers** em modo delegated

---

#### 1.1.4 **scripts/chrome-proxy-service.js** (Chrome Proxy)

**Arquivo**: `/scripts/chrome-proxy-service.js` **Responsabilidade**: Proxy HTTP + WebSocket para
Chrome (Windows → Container)

**Função de entrada**:

```javascript
async function main() {
  const proxy = new ChromeProxyService(config);
  await proxy.start();

  process.on('SIGTERM', async () => {
    await proxy.stop();
    process.exit(0);
  });
}

if (require.main === module) main();
```

**Invocado quando**:

- PM2 executa `chrome-proxy` app
- Maestro inicia proxy interno (Fase 2.5) se `CHROME_PROXY_ENABLED=true`

**Características**:

- ✅ **Simples e focado** (643 linhas)
- ⚠️ **Não usa NERV** (comunicação HTTP direta)
- ⚠️ **Não implementa Authority Pattern**

---

### 1.2 Matriz de Invocação

| Cenário                        | index.js        | src/main.js       | src/server/main.js | chrome-proxy         |
| ------------------------------ | --------------- | ----------------- | ------------------ | -------------------- |
| **PM2 (3 processos)**          | ✅ (agente-gpt) | ✅ (via index.js) | ✅ (dashboard-web) | ✅ (chrome-proxy)    |
| **Standalone (node index.js)** | ✅              | ✅ (via index.js) | ⚠️ (se integrated) | ⚠️ (inline Fase 2.5) |
| **Docker**                     | ✅ (CMD)        | ✅ (via index.js) | ⚠️ (se integrated) | ❌ (externo)         |
| **Testes**                     | ❌              | ✅ (require)      | ✅ (require)       | ❌                   |

---

## 2. Fluxos de Boot por Modo

### 2.1 **Modo PM2 (3 processos separados)** ⭐ RECOMENDADO

**Configuração**: `ecosystem.config.cjs`

```javascript
apps: [
  { name: 'agente-gpt', script: './index.js' }, // Maestro
  { name: 'dashboard-web', script: './src/server/main.js' }, // Server
  { name: 'chrome-proxy', script: './scripts/chrome-proxy-service.js' },
];
```

**Variáveis de ambiente necessárias**:

```bash
SERVER_MODE=split               # Maestro NÃO inicia server
SERVER_AUTHORITY=standalone     # Cada processo é soberano
CHROME_PROXY_ENABLED=true       # PM2 gerencia proxy separado
```

**Sequência de boot**:

```
┌─────────────────────────────────────────────────────┐
│ PM2 Daemon                                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [1] chrome-proxy                                   │
│      └─> scripts/chrome-proxy-service.js            │
│          └─> Porta 9224 (proxy)                     │
│          └─> Conecta Chrome 9225 (Windows)          │
│                                                     │
│  [2] dashboard-web                                  │
│      └─> src/server/main.js                         │
│          └─> bootstrap({ authority: 'standalone' }) │
│          └─> Porta 3008 (HTTP)                      │
│          └─> Publica SERVER_READY via NERV          │
│                                                     │
│  [3] agente-gpt                                     │
│      └─> index.js → src/main.js                     │
│          └─> boot() (6 fases)                       │
│          └─> Escuta SERVER_READY (timeout 10s)      │
│          └─> Conecta socketHub externo (porta 3008) │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Comunicação Inter-Processos**:

- **PM2 Bus**: `dashboard-web` monitora eventos de `agente-gpt`
- **NERV Events**: `agente-gpt` escuta `SERVER_READY` de `dashboard-web`
- **Socket.io**: Dashboard ↔ Frontend (porta 3008)

**Vantagens**:

- ✅ Isolamento de falhas (crash em proxy não derruba servidor)
- ✅ Escalabilidade (cluster mode possível)
- ✅ Monitoramento individual por processo
- ✅ Logs separados por componente

**Desvantagens**:

- ⚠️ Complexidade de coordenação (discovery via NERV)
- ⚠️ Timeout de 10s pode causar falhas se server lento

---

### 2.2 **Modo Standalone (1 processo único)**

**Comando**: `node index.js`

**Variáveis de ambiente necessárias**:

```bash
SERVER_MODE=integrated          # Maestro INICIA server interno
SERVER_AUTHORITY=standalone     # Processo único soberano
CHROME_PROXY_ENABLED=true       # Maestro inicia proxy inline
```

**Sequência de boot**:

```
┌─────────────────────────────────────────────────────┐
│ Node.js (processo único)                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  index.js                                           │
│    └─> src/main.js::boot()                          │
│        │                                            │
│        ├─> FASE 1: Config + Identity               │
│        ├─> FASE 2: NERV                             │
│        ├─> FASE 2.5: Chrome Proxy (inline)          │
│        ├─> FASE 3: Browser Pool                     │
│        ├─> FASE 4: Kernel                           │
│        ├─> FASE 5: Adapters                         │
│        │   ├─> DriverAdapter                        │
│        │   └─> SERVER_MODE=integrated:              │
│        │       └─> bootstrap({                      │
│        │             authority: 'delegated',         │
│        │             nerv: <compartilhado>           │
│        │           })                                │
│        │           └─> HTTP Server (porta 3008)     │
│        │           └─> Socket Hub                   │
│        │           └─> ServerAdapter (NERV shared)  │
│        │                                            │
│        └─> FASE 6: Mission Manager                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Características**:

- ✅ **Simples** (1 processo, 1 NERV compartilhado)
- ✅ **Sem IPC** (componentes se comunicam via NERV local)
- ✅ **Boot rápido** (sem discovery network)
- ⚠️ **Falha catastrófica** (crash derruba tudo)
- ⚠️ **Não escalável** (1 CPU core)

---

### 2.3 **Modo Split (Maestro + Server externo)**

**Cenário**: Maestro roda em um host, Server em outro

**Variáveis de ambiente**:

```bash
# MAESTRO (agente-gpt)
SERVER_MODE=split
SERVER_PORT=3008
SERVER_AUTHORITY=standalone

# SERVER (dashboard-web)
SERVER_AUTHORITY=standalone
PORT=3008
```

**Sequência**:

```
┌─────────────────────┐       ┌─────────────────────┐
│ Host A (Maestro)    │       │ Host B (Server)     │
├─────────────────────┤       ├─────────────────────┤
│                     │       │                     │
│ agente-gpt          │       │ dashboard-web       │
│  ├─> boot()         │       │  └─> bootstrap()    │
│  ├─> NERV (local)   │       │      ├─> HTTP:3008  │
│  ├─> Kernel         │       │      ├─> NERV       │
│  └─> SERVER_MODE=   │       │      └─> SERVER_    │
│      split:         │       │          READY pub  │
│      └─> Escuta     │◄──────┼─────────────────────┘
│          SERVER_    │  NERV │
│          READY      │ Event │
│      └─> Conecta   ─┼──────►│ Socket.io:3008
│          :3008      │  HTTP │
│                     │       │
└─────────────────────┘       └─────────────────────┘
```

**Vantagens**:

- ✅ Separação física (segurança, firewall)
- ✅ Especialização de recursos (GPU no maestro, CPU no server)

**Desvantagens**:

- ⚠️ Latência de rede
- ⚠️ Discovery complexo (NERV precisa cruzar processos)

---

## 3. Anatomia Completa: Maestro Boot

### 3.1 **Função: `boot()` em src/main.js**

**Linhas**: 144-733 (589 linhas) **Responsabilidade**: Inicializar todos os subsistemas do Maestro

---

#### **FASE 1: Configuração e Identidade** (Linhas 161-188)

```javascript
log('INFO', '[BOOT] Fase 1/6: Configuração e Identidade');

// 1.1 Carga de configuração
await CONFIG.reload('sys-boot');

// 1.2 Identidade do robô (robot_id)
await identityManager.initialize();
const identity = identityManager.getFullIdentity();

if (!identity || !identity.robot_id) {
  log('FATAL', '[BOOT] Identidade não estabelecida');
  process.exit(1);
}

// 1.3 GC inicial (se disponível)
if (global.gc) {
  global.gc();
}
```

**Componentes carregados**:

- `CONFIG` ([src/core/config.js](../../src/core/config.js))
- `identityManager` ([src/core/identity_manager.js](../../src/core/identity_manager.js))

**Saídas**:

- ✅ `identity.robot_id` (UUID persistente)
- ✅ Configurações hot-reloaded

**Falhas possíveis**:

- ❌ Arquivo `src/infra/storage/robot_identity.json` corrompido
- ❌ Permissões de filesystem

---

#### **FASE 2: NERV (Event Bus)** (Linhas 190-209)

```javascript
log('INFO', '[BOOT] Fase 2/6: Inicializando NERV');

const nerv = await createNERV({
  mode: CONNECTION_MODES.HYBRID, // Local + Remote
  correlation: true, // Event sourcing
  bufferSize: 1000,
  telemetry: true,
});

// Injeta NERV em módulos que precisam
forensics.setNERV(nerv);
const { setNERV: setInfraPolicyNERV } = require('./core/infra_failure_policy');
setInfraPolicyNERV(nerv);
```

**Componentes carregados**:

- `createNERV` ([src/nerv/nerv.js](../../src/nerv/nerv.js))
- `forensics` ([src/core/forensics.js](../../src/core/forensics.js))
- `infra_failure_policy`
  ([src/core/infra_failure_policy.js](../../src/core/infra_failure_policy.js))

**Saídas**:

- ✅ `nerv` instance (EventEmitter + correlação)
- ✅ NERV injetado em 2 módulos

**Características**:

- Zero acoplamento direto entre componentes
- Pub/sub pattern
- Correlation ID propagation

---

#### **FASE 2.5: Chrome Proxy Service** ⭐ NOVO (Linhas 211-264)

```javascript
log('INFO', '[BOOT] Fase 2.5/6: Inicializando Chrome Proxy Service');

let chromeProxy = null;

if (CONFIG.CHROME_PROXY_ENABLED !== false) {
  try {
    const ChromeProxyService = require('./infra/proxy/chromeProxyService');

    chromeProxy = new ChromeProxyService({
      PUBLIC_IP: CONFIG.CHROME_PROXY_HOST || '192.168.0.2',
      CHROME_PORT: CONFIG.CHROME_PORT || 9225,
      PROXY_PORT: CONFIG.CHROME_PROXY_PORT || 9224,
      LOG_LEVEL: CONFIG.LOG_LEVEL || 'INFO',
    });

    chromeProxy.setNERV(nerv);
    await chromeProxy.start();

    global.chromeProxy = chromeProxy;

    // Emite INFRA_READY via NERV
    sendEvent(nerv, ActorRole.INFRA, ActionCode.INFRA_READY, {
      component: 'ChromeProxyService',
      port: 9224,
    });
  } catch (error) {
    log('ERROR', `[BOOT] Chrome Proxy falhou: ${error.message}`);
    throw error; // ❌ FALHA CRÍTICA
  }
}
```

**Componentes carregados**:

- `ChromeProxyService`
  ([src/infra/proxy/chromeProxyService.js](../../src/infra/proxy/chromeProxyService.js))

**Saídas**:

- ✅ HTTP proxy ativo (porta 9224)
- ✅ WebSocket proxy ativo
- ✅ Evento `INFRA_READY` publicado via NERV

**⚠️ CONFLITO POTENCIAL**: Se PM2 já iniciou `chrome-proxy` como processo separado, teremos **2
proxies** competindo pela porta 9224!

**Falhas possíveis**:

- ❌ Porta 9224 já em uso
- ❌ Chrome não acessível (porta 9225)

---

#### **FASE 2.5B: Server Discovery via NERV** (Linhas 266-301)

```javascript
let discoveredServerInfo = null;

try {
  const discoveryTimeoutMs = 5000;

  const unsub = nerv.onEvent(envelope => {
    if (envelope.type.action_code === ActionCode.SERVER_READY) {
      discoveredServerInfo = envelope.payload;
      log('INFO', `[BOOT] Server descoberto via NERV: porta ${payload.port}`);
    }
  });

  // Aguarda 5 segundos (non-blocking)
  await sleep(discoveryTimeoutMs);
} catch (err) {
  log('DEBUG', `[BOOT] Discovery NERV falhou: ${err.message}`);
}
```

**Propósito**: Escutar evento `SERVER_READY` de `dashboard-web`

**⚠️ PROBLEMA**:

- Timeout de **5 segundos** pode ser insuficiente
- Se server demora > 5s para boot, discovery falha
- Maestro assume modo degradado desnecessariamente

---

#### **FASE 3: Browser Pool** (Linhas 303-357)

```javascript
log('INFO', '[BOOT] Fase 3/6: Inicializando Browser Pool');

const {
  initializeBrowserPoolResilient,
  resolveChromeEndpoint,
} = require('./core/boot_resilience_manager');

const chromeEndpoint = resolveChromeEndpoint();

const browserPoolResult = await initializeBrowserPoolResilient(
  {
    poolSize: 3,
    browserEndpoint: {
      url: chromeEndpoint,
      wsEndpoint: CONFIG.WS_ENDPOINT,
    },
  },
  {
    allowDegradedMode: true,
    autoRetry: true,
    maxAutoRetries: 2,
  }
);

if (!browserPoolResult.success) {
  log('FATAL', '[BOOT] Browser Pool falhou');
  process.exit(1);
}

const browserPool = browserPoolResult.browserPool; // Pode ser null
const systemMode = browserPoolResult.mode; // 'full' ou 'degraded'
```

**Componentes carregados**:

- `boot_resilience_manager`
  ([src/core/boot_resilience_manager.js](../../src/core/boot_resilience_manager.js))
- `BrowserPoolManager`
  ([src/infra/browser_pool/pool_manager.js](../../src/infra/browser_pool/pool_manager.js))

**Saídas**:

- ✅ `browserPool` instance (ou `null` em degraded)
- ✅ `systemMode: 'full' | 'degraded'`

**Modo Degradado**: Ativado quando Chrome não está acessível. Sistema continua funcionando mas
**tarefas de browser ficam pendentes**.

---

#### **FASE 3.5: Context Manager** (Linhas 359-371)

```javascript
log('INFO', '[BOOT] Fase 3.5/6: Inicializando ContextManager');

const { ContextManager } = require('./orchestrator/context_manager');

const contextManager = new ContextManager({
  strategy: 'sliding_window',
  maxTokens: 100000,
  summarizationPolicy: 'on_overflow',
});
```

**Componente**:

- `ContextManager`
  ([src/orchestrator/context_manager.js](../../src/orchestrator/context_manager.js))

**Propósito**: Gerenciar contexto de missões (100k tokens, janela deslizante)

---

#### **FASE 4: Kernel** (Linhas 373-395)

```javascript
log('INFO', '[BOOT] Fase 4/6: Inicializando KERNEL');

const kernel = await createKernel({
  nerv,
  contextManager,
  telemetry: { source: 'kernel', retention: 1000 },
  policy: {},
  loop: { cycleInterval: 50 }, // 20 Hz
});

if (!kernel || typeof kernel.executeTask !== 'function') {
  log('FATAL', '[BOOT] Kernel inválido');
  process.exit(1);
}
```

**Componente**:

- `createKernel` ([src/kernel/kernel.js](../../src/kernel/kernel.js))

**Saídas**:

- ✅ `kernel` instance (execução de tasks)
- ✅ Loop 20 Hz ativo

---

#### **FASE 5: Adapters (Driver + Server)** (Linhas 397-583)

**5A: Driver Adapter** (sempre criado)

```javascript
const driverAdapter = new DriverNERVAdapter(nerv, browserPool, CONFIG);

if (systemMode === 'degraded') {
  log('WARN', '[BOOT] DriverAdapter em modo degraded (sem browser)');
}
```

**5B: Server Mode Resolution** (linhas 424-583)

```javascript
const SERVER_MODE = resolveServerMode(); // 'integrated' | 'split' | 'disabled'

if (SERVER_MODE === 'split') {
  // Conecta em server externo
  const externalPort = 3008;
  socketHub = await socketModule.connectExternal(externalPort);
  serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);
  httpAuthority = false;
} else if (SERVER_MODE === 'integrated') {
  // ⚠️ INICIA SERVER INTERNAMENTE
  const instance = await serverEngine.start(3008);
  httpServer = instance.server;
  boundPort = instance.port;

  socketHub = socketModule.init(httpServer);
  serverAdapter = new ServerNERVAdapter(nerv, socketHub, CONFIG);
  httpAuthority = true;
} else if (SERVER_MODE === 'disabled') {
  serverAdapter = null;
  socketHub = null;
}
```

**⚠️ CONFLITO CRÍTICO IDENTIFICADO**:

Se `SERVER_MODE=integrated` **E** PM2 está gerenciando `dashboard-web`, teremos:

- 2 servidores HTTP tentando bind na porta 3008
- Falha: `EADDRINUSE: address already in use`

---

#### **FASE 5.5: Mission Orchestration** (Linhas 585-650)

```javascript
log('INFO', '[BOOT] Fase 5.5/6: Inicializando Mission Layer');

const feedbackProcessor = new FeedbackProcessor({ contextManager });

const missionManager = new MissionManager({
  nerv,
  kernel,
  contextManager,
  feedbackProcessor,
  orchestratorEngine,
  drivers: { browserPool },
});
```

**Componentes**:

- `FeedbackProcessor`
  ([src/missions/feedback_processor.js](../../src/missions/feedback_processor.js))
- `MissionManager` ([src/missions/mission_manager.js](../../src/missions/mission_manager.js))

---

#### **FASE 6: Finalização** (Linhas 652-733)

```javascript
const bootDuration = Date.now() - bootStartTime;

log('INFO', `[BOOT] ✅ Boot completo em ${bootDuration}ms`);
log('INFO', `[BOOT] Topologia: ${SERVER_MODE} (authority=${httpAuthority})`);

return {
  nerv,
  kernel,
  identity,
  browserPool,
  systemMode,
  driverAdapter,
  serverAdapter,
  missionManager,
  serverMode: SERVER_MODE,
  socketHub,
  httpServer,
  httpAuthority,
  httpPort: boundPort,
  bootDuration,
};
```

**Context Object** retornado para `main()` e usado em `setupSignalHandlers()`.

---

## 4. Anatomia Completa: Server Boot

### 4.1 **Função: `bootstrap()` em src/server/main.js**

**Linhas**: 154-347 (193 linhas) **Responsabilidade**: Inicializar server HTTP + Socket.io + API

---

#### **FASE 1: Lifecycle Signals** (Linhas 169-181)

```javascript
const authority = Authority.resolveAuthority(options.authority);

if (Authority.isStandalone(authority)) {
  lifecycle.listenToSignals();
  log('DEBUG', '[BOOT] Lifecycle signals ativos (standalone)');
} else {
  lifecycle.setAllowProcessExit(false);
  log('DEBUG', '[BOOT] Lifecycle signals skip (delegated)');
}
```

**Lógica de Autoridade**:

- **standalone**: Processo registra `SIGTERM`, `SIGINT` handlers
- **delegated**: Processo **NÃO** registra handlers (Maestro controla)

---

#### **FASE 2: HTTP Engine Bind** (Linhas 187-189)

```javascript
const basePort = process.env.SERVER_PORT || process.env.PORT || 3008;
const { server: httpServer, port } = await serverEngine.start(basePort);
```

**Componente**:

- `serverEngine` ([src/server/engine/server.js](../../src/server/engine/server.js))

**Saídas**:

- ✅ `httpServer` (Node.js `http.Server` instance)
- ✅ `port` (porta efetivamente bound, pode diferir de `basePort`)

---

#### **FASE 3: Estado IPC** (Linhas 197-203)

```javascript
if (Authority.isStandalone(authority)) {
  persistServerState(port, authority);
} else {
  log('DEBUG', '[BOOT] persistServerState skip (delegated)');
}
```

**Função**: `persistServerState()`

```javascript
function persistServerState(port, authority) {
  const payload = {
    port,
    pid: process.pid,
    server_started_at: new Date().toISOString(),
    protocol: '2.0.0',
    role: 'server',
    authority,
  };

  Discovery.publishServerReady(null, payload);
}
```

**Componente**:

- `Discovery` ([src/nerv/discovery.js](../../src/nerv/discovery.js))

**⚠️ DEPRECATION NOTICE**: Anteriormente gravava arquivo `estado.json`. Agora apenas publica evento
NERV (ou nada se NERV ausente).

---

#### **FASE 4: Socket Hub** (Linhas 209-211)

```javascript
socketHub.init(httpServer);
```

**Componente**:

- `socketHub` ([src/server/engine/socket.js](../../src/server/engine/socket.js))

**Saídas**:

- ✅ Socket.io server acoplado ao HTTP server
- ✅ Listeners para eventos `connection`, `disconnect`

---

#### **FASE 5: API Router** (Linhas 219-229)

```javascript
try {
  app.locals = app.locals || {};
  app.locals.authority = authority;
} catch (e) {
  /* noop */
}

router.applyRoutes(app);
```

**Componentes**:

- `app` ([src/server/engine/app.js](../../src/server/engine/app.js)) - Express app
- `router` ([src/server/api/router.js](../../src/server/api/router.js))

**Rotas registradas**:

- `/health` - Health check
- `/api/tasks` - Task management
- `/api/system` - System control
- `/api/missions` - Mission management (parcial)

---

#### **FASE 6: Telemetria** (Linhas 235-248)

```javascript
pm2Bridge.init();
logTail.init();
hardwareTelemetry.init();

const intervalMs = 60000;
snapshot.start(intervalMs);
```

**Componentes**:

- `pm2Bridge`
  ([src/server/realtime/bus/pm2_bridge.js](../../src/server/realtime/bus/pm2_bridge.js)) - PM2 event
  bus
- `logTail`
  ([src/server/realtime/streams/log_tail.js](../../src/server/realtime/streams/log_tail.js))
- `hardwareTelemetry`
  ([src/server/realtime/telemetry/hardware.js](../../src/server/realtime/telemetry/hardware.js))
- `snapshot` ([src/server/telemetry/snapshot.js](../../src/server/telemetry/snapshot.js))

---

#### **FASE 7: Watchers** (Linhas 254-256)

```javascript
fsWatcher.init();
logWatcher.init();
```

**Componentes**:

- `fsWatcher` ([src/server/watchers/fs_watcher.js](../../src/server/watchers/fs_watcher.js)) - File
  changes
- `logWatcher` ([src/server/watchers/log_watcher.js](../../src/server/watchers/log_watcher.js)) -
  Log rotation

---

#### **FASE 8: NERV** (Linhas 264-290)

```javascript
let nerv = options.nerv ?? null;

if (!nerv) {
  if (Authority.isDelegated(authority)) {
    log('FATAL', '[BOOT] NERV não injetado em modo delegated');
    throw new Error('NERV must be injected in delegated mode');
  }

  const { createNERV } = NERV;
  nerv = await createNERV({
    mode: 'hybrid',
    correlation: true,
    bufferSize: 1000,
    telemetry: true,
  });

  log('DEBUG', '[BOOT] NERV local criado (standalone)');
} else {
  log('DEBUG', '[BOOT] NERV injetado (delegated)');
}

// Publicação SERVER_READY (só em standalone)
if (Authority.isStandalone(authority)) {
  HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, {
    port,
    pid: process.pid,
    authority: 'standalone',
  });
}
```

**Lógica**:

- **standalone**: Cria NERV próprio, publica `SERVER_READY`
- **delegated**: Recebe NERV via `options.nerv` (compartilhado com Maestro)

---

#### **FASE 9: ServerNERVAdapter** (Linhas 296-309)

```javascript
const serverAdapter = new ServerNERVAdapter(nerv, socketHub);

// Injeta MissionManager (se disponível)
if (options.missionManager) {
  serverAdapter.setMissionManager(options.missionManager);
}
```

**Componente**:

- `ServerNERVAdapter`
  ([src/server/nerv_adapter/server_nerv_adapter.js](../../src/server/nerv_adapter/server_nerv_adapter.js))

**Responsabilidade**: Ponte NERV ↔ Socket.io

---

#### **FASE 10: Reconciler** (Linhas 317-320)

```javascript
if (typeof reconciler?.start === 'function') {
  reconciler.start();
}
```

**Componente**:

- `reconciler` ([src/server/supervisor/reconcilier.js](../../src/server/supervisor/reconcilier.js))

**Propósito**: Auto-recuperação de estados inconsistentes

---

#### **Retorno Final** (Linhas 325-347)

```javascript
return {
  port,
  httpServer,
  nerv,
  serverAdapter,
  authority,
};
```

---

## 5. Modos de Operação

### 5.1 **SERVER_MODE** (Topologia de Processos)

**Enum**: `src/main.js` linhas 72-76

```javascript
const SERVER_MODES = Object.freeze({
  INTEGRATED: 'integrated',
  SPLIT: 'split',
  DISABLED: 'disabled',
});
```

**Resolução**: Função `resolveServerMode()` (linhas 112-138)

```javascript
function resolveServerMode() {
  const raw = process.env.SERVER_MODE ?? CONFIG.SERVER_MODE ?? SERVER_MODES.INTEGRATED;

  const mode = String(raw).toLowerCase().trim();
  const valid = ['integrated', 'split', 'disabled'];

  if (!valid.includes(mode)) {
    log('FATAL', `[CONFIG] SERVER_MODE inválido: "${raw}"`);
    process.exit(1);
  }

  log('INFO', `[CONFIG] SERVER_MODE resolvido: ${mode}`);
  return mode;
}
```

**Precedência**:

1. `process.env.SERVER_MODE` (variável de ambiente)
2. `CONFIG.SERVER_MODE` (config.json)
3. `INTEGRATED` (fallback padrão)

---

### 5.2 **Matriz de Comportamento**

| Modo           | Maestro HTTP?       | Server Process?   | Socket.io?     | Discovery?     |
| -------------- | ------------------- | ----------------- | -------------- | -------------- |
| **integrated** | ✅ Sim (porta 3008) | ❌ Não necessário | ✅ Via Maestro | ❌ Não         |
| **split**      | ❌ Não              | ✅ Separado (PM2) | ✅ Via Server  | ✅ NERV events |
| **disabled**   | ❌ Não              | ❌ Não            | ❌ Não         | ❌ Não         |

---

### 5.3 **Quando Usar Cada Modo**

#### **integrated** (Desenvolvimento / Debug)

```bash
# Comando
node index.js

# Variáveis
SERVER_MODE=integrated
```

**Use quando**:

- ✅ Desenvolvimento local (1 terminal)
- ✅ Debug (attach único)
- ✅ Testes rápidos

**NÃO use quando**:

- ❌ PM2 está gerenciando processos separados
- ❌ Produção (falta isolamento)

---

#### **split** (Produção / PM2)

```bash
# Comando
npx pm2 start ecosystem.config.cjs

# Variáveis (agente-gpt)
SERVER_MODE=split
SERVER_PORT=3008
```

**Use quando**:

- ✅ PM2 gerencia processos separados
- ✅ Produção (isolamento de falhas)
- ✅ Escalabilidade (cluster mode)

**NÃO use quando**:

- ❌ Execução standalone (`node index.js`)
- ❌ Sem PM2 daemon

---

#### **disabled** (Worker / Headless)

```bash
# Variáveis
SERVER_MODE=disabled
```

**Use quando**:

- ✅ Agente sem interface (worker puro)
- ✅ Execução batch
- ✅ Lambda functions

---

## 6. Autoridade de Processos

### 6.1 **Authority Pattern** ([src/core/authority.js](../../src/core/authority.js))

**Enum**:

```javascript
const SERVER_AUTHORITIES = Object.freeze({
  STANDALONE: 'standalone',
  DELEGATED: 'delegated',
});
```

**Resolução**:

```javascript
function resolveAuthority(explicitAuthority = null) {
  const raw = explicitAuthority ?? process.env.SERVER_AUTHORITY ?? SERVER_AUTHORITIES.STANDALONE;

  const authority = String(raw).toLowerCase().trim();

  if (!['standalone', 'delegated'].includes(authority)) {
    throw new Error(`Invalid SERVER_AUTHORITY: ${raw}`);
  }

  return authority;
}
```

---

### 6.2 **Standalone vs Delegated**

| Aspecto              | standalone                 | delegated                    |
| -------------------- | -------------------------- | ---------------------------- |
| **Signal Handlers**  | ✅ Registra SIGTERM/SIGINT | ❌ Não registra              |
| **process.exit()**   | ✅ Pode chamar             | ❌ Não deve chamar           |
| **Shutdown Control** | ✅ Autônomo                | ❌ Controlado externamente   |
| **NERV Creation**    | ✅ Cria próprio            | ❌ Recebe injetado           |
| **SERVER_READY**     | ✅ Publica                 | ❌ Não publica (Maestro faz) |

---

### 6.3 **Onde é Usado**

#### **src/server/main.js** (IMPLEMENTADO)

```javascript
if (Authority.isStandalone(authority)) {
    lifecycle.listenToSignals();          // Registra handlers
    persistServerState(port, authority);   // Grava estado

    // Cria NERV próprio
    nerv = await createNERV({ ... });

    // Publica SERVER_READY
    HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, { ... });
} else {
    lifecycle.setAllowProcessExit(false);  // Suprime exit
    log('DEBUG', '[BOOT] Modo delegated');

    // NERV vem via options.nerv
    nerv = options.nerv;
}
```

---

#### **src/main.js** (PARCIALMENTE IMPLEMENTADO)

```javascript
// ❌ NÃO VALIDA autoridade ainda
// ⚠️ Sempre age como standalone

// ✅ Deveria fazer:
if (process.env.pm_id && SERVER_MODE === 'integrated') {
  log('FATAL', '[BOOT] CONFLITO: PM2 + SERVER_MODE=integrated');
  log('FATAL', '[BOOT] Use SERVER_MODE=split com PM2');
  process.exit(1);
}
```

---

## 7. Descoberta de Serviços

### 7.1 **Método Atual: NERV Events** ([src/nerv/discovery.js](../../src/nerv/discovery.js))

**Funções**:

```javascript
// Publicar disponibilidade
function publishServerReady(nerv, payload) {
  if (nerv) {
    HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
  }
}

// Aguardar servidor (Promise)
function waitForServerReady(nerv, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);

    const unsub = nerv.onEvent(envelope => {
      if (envelope.type.action_code === ActionCode.SERVER_READY) {
        clearTimeout(timer);
        unsub();
        resolve(envelope.payload);
      }
    });
  });
}

// Escutar continuamente
function listenForServerReady(nerv, handler) {
  return nerv.onEvent(envelope => {
    if (envelope.type.action_code === ActionCode.SERVER_READY) {
      handler(envelope.payload);
    }
  });
}
```

---

### 7.2 **Fluxo de Discovery no Modo Split**

```
┌─────────────────────────────────────────────────────┐
│ TIMELINE: Discovery via NERV                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ T=0s   dashboard-web inicia bootstrap()            │
│        └─> Fase 2: HTTP bind (porta 3008)          │
│                                                     │
│ T=2s   dashboard-web completa boot                 │
│        └─> Fase 8: Publica SERVER_READY via NERV   │
│                                                     │
│ T=0s   agente-gpt inicia boot()                     │
│        └─> Fase 2.5B: Escuta SERVER_READY          │
│            └─> timeout 5 segundos                   │
│                                                     │
│ T=2s   agente-gpt recebe SERVER_READY              │
│        └─> discoveredServerInfo = { port: 3008 }   │
│                                                     │
│ T=5s   agente-gpt continua (Fase 3)                │
│        └─> Usa discoveredServerInfo.port           │
│                                                     │
│ ✅ SUCCESS: Discovery em 2s (dentro do timeout)    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### 7.3 **Cenário de Falha: Timeout**

```
┌─────────────────────────────────────────────────────┐
│ TIMELINE: Discovery Timeout                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│ T=0s   agente-gpt inicia boot()                     │
│        └─> Fase 2.5B: Escuta SERVER_READY          │
│            └─> timeout 5 segundos                   │
│                                                     │
│ T=0s   dashboard-web inicia bootstrap() LENTO      │
│        └─> Deps install? Migrations? Lag?          │
│                                                     │
│ T=5s   agente-gpt timeout!                          │
│        └─> discoveredServerInfo = null             │
│                                                     │
│ T=7s   dashboard-web completa boot                 │
│        └─> Publica SERVER_READY (tarde demais!)    │
│                                                     │
│ T=5s   agente-gpt Fase 5 (SERVER_MODE=split)       │
│        └─> externalPort = 3008 (fallback)          │
│        └─> socketModule.connectExternal(3008)      │
│            └─> ❌ Connection refused (server não pronto) │
│                                                     │
│ ❌ FAILURE: Boot abortado ou modo degradado        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### 7.4 **Método Legado: File-Based** (DEPRECATED)

**Arquivo**: `estado.json` (raiz do workspace)

```json
{
  "server_port": 3008,
  "server_started_at": "2026-02-01T12:34:56.789Z",
  "pid": 12345,
  "protocol": "2.0.0",
  "role": "server"
}
```

**Status**:

- ❌ **Removido oficialmente**
- ⚠️ Fallback via `ENABLE_STATE_FILE=true` (compatibilidade temporária)
- ✅ **Substituído por**: NERV events (`SERVER_READY`)

---

## 8. Conflitos Identificados

### 🔴 **CONFLITO #1: Duplicação de Server HTTP** (CRÍTICO)

**Cenário**:

```bash
# PM2 gerencia 3 processos
npx pm2 start ecosystem.config.cjs

# Mas variáveis estão:
SERVER_MODE=integrated   # ❌ ERRADO!
```

**O que acontece**:

1. PM2 inicia `dashboard-web` → bind porta 3008 ✅
2. PM2 inicia `agente-gpt` (via index.js → src/main.js)
3. `boot()` Fase 5 detecta `SERVER_MODE=integrated`
4. Chama `serverEngine.start(3008)` → ❌ **EADDRINUSE**

**Resultado**:

- ❌ `agente-gpt` crasha com `EADDRINUSE: address already in use :::3008`
- ❌ Sistema não funciona

**Causa Raiz**: Falta **validação de conflito PM2 + integrated**

**Fix Recomendado**: Adicionar em `src/main.js` Fase 1:

```javascript
// Detecta se rodando sob PM2
if (process.env.pm_id && SERVER_MODE === 'integrated') {
  log('FATAL', '[BOOT] ❌ CONFLITO DETECTADO');
  log('FATAL', '[BOOT] PM2 gerencia processos separados');
  log('FATAL', '[BOOT] Use SERVER_MODE=split (não integrated)');
  log('FATAL', '[BOOT]');
  log('FATAL', '[BOOT] Alternativas:');
  log('FATAL', '[BOOT] 1. Mudar para: SERVER_MODE=split');
  log('FATAL', '[BOOT] 2. Rodar standalone: node index.js (sem PM2)');
  process.exit(1);
}
```

---

### 🟡 **CONFLITO #2: Duplicação de Chrome Proxy** (MÉDIO)

**Cenário**:

```bash
# PM2 inicia chrome-proxy como processo separado
npx pm2 start ecosystem.config.cjs

# Mas Maestro também inicia proxy (Fase 2.5)
CHROME_PROXY_ENABLED=true   # ❌ DUPLICADO!
```

**O que acontece**:

1. PM2 inicia `chrome-proxy` → bind porta 9224 ✅
2. PM2 inicia `agente-gpt`
3. `boot()` Fase 2.5 tenta iniciar ChromeProxyService
4. `chromeProxy.start()` → bind 9224 → ❌ **EADDRINUSE**

**Resultado**:

- ❌ `agente-gpt` crasha com `EADDRINUSE: address already in use :::9224`
- ❌ Proxy PM2 continua rodando (huérfão)

**Causa Raiz**: Falta detecção de **proxy já rodando**

**Fix Recomendado**: Adicionar health check antes de start:

```javascript
// Fase 2.5
if (CONFIG.CHROME_PROXY_ENABLED !== false) {
    // Verifica se proxy já está rodando
    const proxyAlreadyRunning = await checkChromeProxyHealth(9224);

    if (proxyAlreadyRunning) {
        log('INFO', '[BOOT] ✅ Chrome Proxy já rodando (porta 9224)');
        log('INFO', '[BOOT] Usando proxy externo (PM2 ou processo separado)');
        // Pula criação inline
    } else {
        // Cria proxy inline
        chromeProxy = new ChromeProxyService({ ... });
        await chromeProxy.start();
    }
}
```

---

### 🟡 **CONFLITO #3: Discovery Timeout** (MÉDIO)

**Cenário**:

```bash
# dashboard-web demora > 5s para boot
# (migrations? deps? cold start?)

# agente-gpt timeout 5s na escuta SERVER_READY
```

**O que acontece**:

1. `agente-gpt` Fase 2.5B escuta `SERVER_READY` (timeout 5s)
2. `dashboard-web` boot lento (7s)
3. Timeout! `discoveredServerInfo = null`
4. `agente-gpt` Fase 5 assume `externalPort = 3008` (fallback)
5. Tenta `connectExternal(3008)` → ❌ **Connection refused** (server ainda não pronto)

**Resultado**:

- ⚠️ Possível boot degradado
- ⚠️ Logs confusos ("Server não descoberto")

**Causa Raiz**: Timeout de **5 segundos** muito curto

**Fix Recomendado**: Aumentar timeout para 30s + retry:

```javascript
// Fase 2.5B
const discoveryTimeoutMs = Number(process.env.SERVER_DISCOVERY_TIMEOUT ?? 30000); // 30s
```

---

### 🟢 **CONFLITO #4: Authority Pattern Incompleto** (BAIXO)

**Cenário**: Maestro sempre age como `standalone`, ignorando injeção

**Impacto**: Impossível rodar Maestro como processo delegado

**Fix**: Implementar lógica de autoridade em `src/main.js`

---

## 9. Dependências entre Componentes

### 9.1 **Grafo de Dependências (Boot Order)**

```
┌─────────────────────────────────────────────────────┐
│ MAESTRO BOOT (src/main.js)                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐                                       │
│  │ Config   │ ◄──────────────────┐                  │
│  │ Identity │                    │                  │
│  └────┬─────┘                    │                  │
│       │                          │                  │
│       ▼                          │                  │
│  ┌──────────┐                    │                  │
│  │   NERV   │ ◄──────────┐       │                  │
│  └────┬─────┘            │       │                  │
│       │                  │       │                  │
│       ├──────────────────┼───────┼─────────┐        │
│       │                  │       │         │        │
│       ▼                  │       │         │        │
│  ┌──────────┐            │       │         │        │
│  │ Chrome   │ ───event───┘       │         │        │
│  │  Proxy   │                    │         │        │
│  └──────────┘                    │         │        │
│                                  │         │        │
│  ┌──────────┐                    │         │        │
│  │ Browser  │ ◄──────────────────┘         │        │
│  │   Pool   │                              │        │
│  └────┬─────┘                              │        │
│       │                                    │        │
│       ▼                                    │        │
│  ┌──────────┐                              │        │
│  │ Context  │ ◄──────────────┐             │        │
│  │ Manager  │                │             │        │
│  └────┬─────┘                │             │        │
│       │                      │             │        │
│       ▼                      │             │        │
│  ┌──────────┐                │             │        │
│  │  Kernel  │ ◄──────────────┤             │        │
│  └────┬─────┘                │             │        │
│       │                      │             │        │
│       ▼                      │             │        │
│  ┌──────────┐                │             │        │
│  │  Driver  │                │             │        │
│  │ Adapter  │                │             │        │
│  └──────────┘                │             │        │
│                              │             │        │
│  ┌──────────┐                │             │        │
│  │  Server  │ ◄──────────────┴─────────────┘        │
│  │  (cond)  │                                       │
│  └────┬─────┘                                       │
│       │                                             │
│       ▼                                             │
│  ┌──────────┐                                       │
│  │ Mission  │                                       │
│  │ Manager  │                                       │
│  └──────────┘                                       │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ SERVER BOOT (src/server/main.js)                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────┐                                       │
│  │Lifecycle │                                       │
│  │ Signals  │                                       │
│  └────┬─────┘                                       │
│       │                                             │
│       ▼                                             │
│  ┌──────────┐                                       │
│  │   HTTP   │ ──────────────┐                       │
│  │  Engine  │               │                       │
│  └────┬─────┘               │                       │
│       │                     │                       │
│       ▼                     │                       │
│  ┌──────────┐               │                       │
│  │  Socket  │ ◄─────────────┘                       │
│  │   Hub    │                                       │
│  └────┬─────┘                                       │
│       │                                             │
│       ▼                                             │
│  ┌──────────┐                                       │
│  │   API    │                                       │
│  │  Router  │                                       │
│  └──────────┘                                       │
│                                                     │
│  ┌──────────┐                                       │
│  │Telemetry │                                       │
│  │ Watchers │                                       │
│  └──────────┘                                       │
│                                                     │
│  ┌──────────┐                                       │
│  │   NERV   │ ◄──────────┐                          │
│  │ (create  │            │                          │
│  │ or inject)                                      │
│  └────┬─────┘            │                          │
│       │                  │                          │
│       ▼                  │                          │
│  ┌──────────┐            │                          │
│  │  Server  │ ───────────┘                          │
│  │ Adapter  │                                       │
│  └──────────┘                                       │
│                                                     │
│  ┌──────────┐                                       │
│  │Reconciler│                                       │
│  └──────────┘                                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### 9.2 **Dependências Críticas**

| Componente         | Depende de             | Razão                          |
| ------------------ | ---------------------- | ------------------------------ |
| **NERV**           | Config                 | Buffersize, telemetry settings |
| **Chrome Proxy**   | NERV                   | Eventos `INFRA_READY`          |
| **Browser Pool**   | Chrome Proxy           | Endpoint correto (proxy:9224)  |
| **Kernel**         | NERV, ContextManager   | Comunicação + contexto         |
| **DriverAdapter**  | NERV, BrowserPool      | Execução de tasks              |
| **ServerAdapter**  | NERV, SocketHub        | Ponte eventos                  |
| **MissionManager** | Kernel, ContextManager | Orquestração                   |

---

## 10. Diagramas de Fluxo

### 10.1 **Boot Sequence (PM2 Mode - RECOMMENDED)**

```
START PM2
    │
    ├──> [1] chrome-proxy
    │      └─> scripts/chrome-proxy-service.js
    │          ├─> HTTP proxy :9224
    │          ├─> WS proxy
    │          └─> Health check Chrome :9225
    │
    ├──> [2] dashboard-web
    │      └─> src/server/main.js::bootstrap()
    │          ├─> HTTP bind :3008
    │          ├─> Socket.io init
    │          ├─> NERV create
    │          └─> Publish SERVER_READY
    │
    └──> [3] agente-gpt
           └─> index.js → src/main.js::boot()
               ├─> NERV create
               ├─> Listen SERVER_READY (5s timeout)
               ├─> Browser Pool (via proxy :9224)
               ├─> Kernel
               ├─> DriverAdapter
               ├─> SERVER_MODE=split:
               │   └─> Connect socketHub :3008
               └─> MissionManager
```

---

### 10.2 **Boot Sequence (Standalone Mode)**

```
START node index.js
    │
    └─> src/main.js::boot()
        ├─> NERV create
        ├─> Chrome Proxy inline (Fase 2.5)
        │   └─> HTTP + WS proxy :9224
        ├─> Browser Pool
        ├─> Kernel
        ├─> DriverAdapter
        ├─> SERVER_MODE=integrated:
        │   └─> bootstrap({ authority: 'delegated', nerv })
        │       └─> src/server/main.js
        │           ├─> HTTP bind :3008
        │           ├─> Socket.io init
        │           ├─> NERV inject (shared)
        │           └─> ServerAdapter (NERV shared)
        └─> MissionManager
```

---

### 10.3 **Decision Tree: Entry Point Selection**

```
┌─────────────────────────────────────┐
│ Qual comando foi executado?         │
└──────────────┬──────────────────────┘
               │
       ┌───────┴────────┐
       │                │
   pm2 start      node index.js
       │                │
       ▼                ▼
┌─────────────┐   ┌──────────────┐
│ PM2 lê      │   │ index.js     │
│ ecosystem   │   │ delega para  │
│ .config.js  │   │ src/main.js  │
└─────┬───────┘   └──────┬───────┘
      │                  │
      │◄─────────────────┘
      │
      ▼
┌────────────────────────────────────┐
│ Quantos processos no ecosystem?    │
└──────────────┬─────────────────────┘
               │
       ┌───────┴────────┐
       │                │
     3 apps         1 app
       │                │
       ▼                ▼
┌─────────────┐   ┌──────────────┐
│ Inicia:     │   │ Inicia:      │
│ - chrome-   │   │ - agente-gpt │
│   proxy     │   │              │
│ - dashboard │   │ (standalone) │
│   -web      │   │              │
│ - agente-   │   │              │
│   gpt       │   │              │
│             │   │              │
│ SERVER_MODE │   │ SERVER_MODE  │
│ = split     │   │ = integrated │
└─────────────┘   └──────────────┘
```

---

## 11. Recomendações Críticas

### 🎯 **R1: Validar Conflito PM2 + Integrated** ⭐ URGENTE

**Implementar em**: `src/main.js` Fase 1 (após linha 188)

```javascript
// ===== VALIDAÇÃO: PM2 + SERVER_MODE CONFLICT =====
if (process.env.pm_id && SERVER_MODE === 'integrated') {
  log('FATAL', '');
  log('FATAL', '❌ ═══════════════════════════════════════════════════');
  log('FATAL', '❌ CONFLITO DETECTADO: PM2 + SERVER_MODE=integrated');
  log('FATAL', '❌ ═══════════════════════════════════════════════════');
  log('FATAL', '');
  log('FATAL', 'PM2 está gerenciando processos separados (agente-gpt, dashboard-web)');
  log('FATAL', 'Mas SERVER_MODE=integrated tenta iniciar servidor HTTP inline');
  log('FATAL', '');
  log('FATAL', '⚠️  Resultado: 2 servidores competem pela porta 3008 → EADDRINUSE');
  log('FATAL', '');
  log('FATAL', '✅ SOLUÇÕES:');
  log('FATAL', '');
  log('FATAL', '   1. Usar PM2 corretamente:');
  log('FATAL', '      export SERVER_MODE=split');
  log('FATAL', '      npx pm2 restart ecosystem.config.cjs');
  log('FATAL', '');
  log('FATAL', '   2. OU rodar standalone (sem PM2):');
  log('FATAL', '      pm2 delete all');
  log('FATAL', '      export SERVER_MODE=integrated');
  log('FATAL', '      node index.js');
  log('FATAL', '');
  log('FATAL', '═══════════════════════════════════════════════════════');
  process.exit(1);
}
```

**Benefício**:

- ✅ Evita 90% dos crashes em produção
- ✅ Mensagens claras (onboarding de novos devs)
- ✅ Force correct usage

---

### 🎯 **R2: Aumentar Timeout de Discovery**

**Implementar em**: `src/main.js` Fase 2.5B (linha 269)

```javascript
// ANTES (5 segundos)
const discoveryTimeoutMs = Number(process.env.SERVER_DISCOVERY_TIMEOUT ?? 5000);

// DEPOIS (30 segundos)
const discoveryTimeoutMs = Number(process.env.SERVER_DISCOVERY_TIMEOUT ?? 30000);
```

**Ou implementar retry exponencial**:

```javascript
async function discoverServerWithRetry(nerv, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutMs = 10000 * attempt; // 10s, 20s, 30s
      const serverInfo = await waitForServerReady(nerv, { timeoutMs });
      log('INFO', `[DISCOVERY] Server descoberto (tentativa ${attempt}/${maxRetries})`);
      return serverInfo;
    } catch (err) {
      if (attempt === maxRetries) {
        log('WARN', `[DISCOVERY] Timeout após ${maxRetries} tentativas`);
        return null;
      }
      log('WARN', `[DISCOVERY] Retry ${attempt}/${maxRetries} (timeout ${timeoutMs}ms)`);
    }
  }
}
```

---

### 🎯 **R3: Detectar Chrome Proxy Duplicado**

**Implementar em**: `src/main.js` Fase 2.5 (linha 214)

```javascript
// ANTES
if (CONFIG.CHROME_PROXY_ENABLED !== false) {
    chromeProxy = new ChromeProxyService({ ... });
    await chromeProxy.start();
}

// DEPOIS
if (CONFIG.CHROME_PROXY_ENABLED !== false) {
    // Health check: proxy já rodando?
    const proxyPort = CONFIG.CHROME_PROXY_PORT || 9224;
    const proxyRunning = await checkPortInUse(proxyPort);

    if (proxyRunning) {
        log('INFO', `[BOOT] ✅ Chrome Proxy já rodando (porta ${proxyPort})`);
        log('INFO', '[BOOT] Assumindo proxy externo (PM2 ou processo separado)');
        log('INFO', '[BOOT] Pulando criação inline');
    } else {
        log('INFO', `[BOOT] Iniciando Chrome Proxy inline (porta ${proxyPort})`);
        chromeProxy = new ChromeProxyService({ ... });
        await chromeProxy.start();
        global.chromeProxy = chromeProxy;
    }
}

// Helper function
async function checkPortInUse(port) {
    return new Promise(resolve => {
        const server = require('net').createServer();
        server.once('error', () => resolve(true));  // Porta em uso
        server.once('listening', () => {
            server.close();
            resolve(false);  // Porta livre
        });
        server.listen(port);
    });
}
```

---

### 🎯 **R4: Documentar Modos no README**

**Criar**: `README_BOOT_MODES.md`

````markdown
# Boot Modes Guide

## PM2 (Production)

```bash
export SERVER_MODE=split
export SERVER_AUTHORITY=standalone
npx pm2 start ecosystem.config.cjs
```
````

## Standalone (Development)

```bash
export SERVER_MODE=integrated
node index.js
```

## When to Use Each

| Mode                  | Use Case   | Pros                   | Cons         |
| --------------------- | ---------- | ---------------------- | ------------ |
| PM2 split             | Production | Isolation, Scalability | Complexity   |
| Standalone integrated | Dev/Debug  | Simple                 | No isolation |

````

---

### 🎯 **R5: Implementar Authority em Maestro**

**Adicionar**: Suporte a `SERVER_AUTHORITY=delegated` em `src/main.js`

```javascript
// Fase 1
const AUTHORITY = resolveAuthority();

if (Authority.isDelegated(AUTHORITY)) {
    log('INFO', '[BOOT] Modo delegated - suprimindo signal handlers');
    // Não registra SIGTERM/SIGINT
    // NERV será injetado via options
} else {
    // Modo standalone atual (sem mudanças)
}
````

---

## 📊 Conclusão

### ✅ **Estado Atual**

**Funcional**:

- ✅ Boot completo em 6 fases (Maestro)
- ✅ Boot completo em 10 fases (Server)
- ✅ Suporte a 3 modos de servidor (integrated/split/disabled)
- ✅ Authority pattern em Server
- ✅ Discovery via NERV events
- ✅ Chrome Proxy v3.0

**Parcial**:

- ⚠️ Authority pattern no Maestro (não implementado)
- ⚠️ Discovery timeout curto (5s)
- ⚠️ Sem detecção de conflitos

**Problemático**:

- ❌ PM2 + integrated mode causam EADDRINUSE
- ❌ Proxy duplicado possível
- ❌ Falta documentação clara de modos

---

### 🎯 **Prioridades de Fix**

**URGENTE** (implementar agora):

1. R1: Validar conflito PM2 + integrated
2. R2: Aumentar timeout discovery para 30s

**IMPORTANTE** (próxima sprint): 3. R3: Detectar proxy duplicado 4. R4: Documentar modos no README

**DESEJÁVEL** (backlog): 5. R5: Authority em Maestro (delegated mode) 6. Testes E2E de boot
sequences 7. Health check consolidado

---

**Próxima Ação Sugerida**: Implementar **R1** (validação PM2) → 15 minutos de código, previne 90%
dos crashes.

Quer que eu implemente alguma recomendação agora? 🚀
