# 📖 Glossário Técnico

**Versão**: 1.0
**Última Atualização**: 21/01/2026
**Público-Alvo**: Todos os níveis
**Tempo de Leitura**: ~15 min

---

## 📖 Visão Geral

Este glossário define **termos técnicos** usados na documentação e no código do sistema `chatgpt-docker-puppeteer`. Organizado alfabeticamente e por categoria para fácil consulta.

---

## 📚 Índice por Categoria

### Arquitetura
- [NERV](#nerv)
- [Kernel](#kernel)
- [Driver](#driver)
- [Event Bus](#event-bus)
- [Domain-Driven Design](#domain-driven-design-ddd)

### Componentes
- [Browser Pool](#browser-pool)
- [Queue Cache](#queue-cache)
- [Lock Manager](#lock-manager)
- [File Watcher](#file-watcher)

### Estados e Transições
- [Task States](#task-states)
- [Browser States](#browser-states)
- [Health Status](#health-status)

### Conceitos
- [DNA](#dna)
- [Envelope](#envelope)
- [Correlation ID](#correlation-id)
- [Optimistic Locking](#optimistic-locking)
- [Circuit Breaker](#circuit-breaker)
- [Memoization](#memoization)

### Audit & Quality
- [P-Levels](#p-levels)
- [Audit Rating](#audit-rating)

### Browser Automation
- [CDP (Chrome DevTools Protocol)](#cdp-chrome-devtools-protocol)
- [Page](#page)
- [Puppeteer](#puppeteer)
- [Stealth Plugin](#stealth-plugin)

---

## 🔤 Glossário Alfabético

### Adaptive Delay

**Categoria**: Performance
**Definição**: Técnica de ajuste dinâmico de delays entre ações (typing, clicks) usando **EMA (Exponential Moving Average)** e **6σ outlier rejection**.

**Contexto**:
- Usado em `src/driver/modules/human.js`
- Simula comportamento humano (não-robótico)
- Previne detecção de bot por timing previsível

**Exemplo**:
```javascript
const delay = adaptiveDelay.next();  // 95ms (EMA)
await page.waitForTimeout(delay);
```

**Ver também**: [EMA](#ema-exponential-moving-average), [Outlier Rejection](#outlier-rejection)

---

### Audit Rating

**Categoria**: Quality
**Definição**: Nota atribuída a componentes/módulos após auditoria sistemática de código, escala **0-10**.

**Escalas**:
- 9.5-10.0: Excepcional (production-grade)
- 9.0-9.4: Excelente
- 8.0-8.9: Bom
- 7.0-7.9: Satisfatório
- <7.0: Precisa melhorias

**Contexto**:
- 14 audits completas realizadas
- Média do sistema: ~9.2/10
- Documentado em `AUDITORIA_STATUS_ATUAL.md`

**Exemplo**:
```
CORE: 9.5/10
NERV: 9.4/10
KERNEL: 9.2/10
```

**Ver também**: [P-Levels](#p-levels)

---

### Browser Pool

**Categoria**: Componente
**Definição**: Pool de instâncias de browser (Chrome/Edge) gerenciadas para executar tasks em paralelo.

**Responsabilidades**:
- Criar/destruir instâncias de browser
- Alocar páginas para drivers
- Monitorar saúde (health monitoring)
- Circuit breaker (P9.2)

**Localização**: `src/infra/browser_pool/`

**Componentes**:
- **PoolManager**: Gerencia pool
- **ConnectionOrchestrator**: Conecta a browsers (launcher/external)
- **HealthMonitor**: Monitora degradação

**Estados** (Browser Instance):
- `CREATED` → `HEALTHY` → `DEGRADED` → `CRASHED`

**Exemplo**:
```javascript
const page = await browserPool.allocatePage('chatgpt');
// ... usar página
await browserPool.releasePage(page);
```

**Ver também**: [Browser States](#browser-states), [Circuit Breaker](#circuit-breaker)

---

### Browser States

**Categoria**: Estado
**Definição**: Estados possíveis de uma instância de browser no pool.

**Estados**:
1. **CREATED**: Instância criada, ainda não validada
2. **HEALTHY**: Funcionando normalmente (response time <5s, zero failures)
3. **DEGRADED**: Funcionando mas lento (response time >5s, 1-2 failures)
4. **CRASHED**: Não responsivo (>=3 failures consecutivos)
5. **SHUTDOWN**: Fechado manualmente

**Transições**:
```
CREATED → HEALTHY        (launch success)
HEALTHY → DEGRADED       (performance drop)
DEGRADED → HEALTHY       (recovery)
DEGRADED → CRASHED       (>=3 failures)
HEALTHY → SHUTDOWN       (manual close)
```

**Contexto**: Circuit Breaker (P9.2) usa estes estados para decisão de alocação

**Ver também**: [Browser Pool](#browser-pool), [Circuit Breaker](#circuit-breaker)

---

### CDP (Chrome DevTools Protocol)

**Categoria**: Browser Automation
**Definição**: Protocolo usado pelo Chrome/Edge para controle remoto via WebSocket.

**Porta padrão**: 9222
**URL exemplo**: `ws://localhost:9222/devtools/browser/...`

**Contexto**:
- Puppeteer usa CDP internamente
- Modo `external` conecta a browser via CDP (porta 9222)
- Permite debug, profiling, network interception

**Comandos comuns**:
- `Page.navigate`: Navegar para URL
- `Runtime.evaluate`: Executar JavaScript
- `DOM.querySelector`: Localizar elementos

**Ver também**: [Puppeteer](#puppeteer), [External Browser](#external-browser)

---

### Circuit Breaker

**Categoria**: Pattern
**Definição**: Padrão de resiliência que **"abre circuito"** (bloqueia requisições) quando serviço está degradado, prevenindo cascata de falhas.

**Estados**:
- **CLOSED**: Normal (requisições passam)
- **OPEN**: Bloqueado (requisições rejeitadas)
- **HALF-OPEN**: Testando recuperação (alguns requests passam)

**Implementação no sistema**:
- **Browser Pool** (P9.2): Filtra apenas instâncias `HEALTHY`
- Threshold: 3 failures consecutivos → marca `CRASHED`
- Instâncias `DEGRADED` ainda acessíveis em emergência

**Exemplo**:
```javascript
// _selectInstance() filtra HEALTHY apenas
const healthy = pool.filter(e => e.health.status === 'HEALTHY');
```

**Ver também**: [Browser States](#browser-states), [P9.2](#p92-circuit-breaker)

---

### Correlation ID

**Categoria**: Conceito
**Definição**: UUID único atribuído a cada evento NERV para rastrear **lineage** (parentesco) entre eventos relacionados.

**Formato**: UUID v4 (36 chars)
**Exemplo**: `550e8400-e29b-41d4-a716-446655440000`

**Contexto**:
- Adicionado automaticamente por NERV Emission Layer
- Propagado através de eventos child
- Permite reconstruir cadeia de eventos (chain)

**Exemplo de Chain**:
```
User Input (correlationId: A)
  ↓
QUEUE_CHANGE (correlationId: B, parent: A)
  ↓
TASK_ALLOCATED (correlationId: C, parent: B)
  ↓
DRIVER_RESULT (correlationId: D, parent: C)
```

**Localização**: `src/nerv/correlation/`

**Ver também**: [Envelope](#envelope), [NERV](#nerv)

---

### DNA

**Categoria**: Conceito
**Definição**: Identificador único e persistente da **instância do agente** (UUID v4).

**Propósito**:
- Identificar agente em logs multi-instance
- Detectar múltiplas instâncias simultâneas
- Recuperação de locks orphans (UUID matching)

**Persistência**: `controle.json` (root)

**Geração**:
```javascript
const { initDNA } = require('./core/identity/dna');
const dna = initDNA();  // 'a3f9c2b1-...'
```

**Localização**: `src/core/identity/dna.js`

**Ver também**: [Identity](#identity), [Lock Manager](#lock-manager)

---

### Domain-Driven Design (DDD)

**Categoria**: Arquitetura
**Definição**: Abordagem arquitetural que organiza código por **domínios funcionais** (Kernel, Driver, Infra, etc), não camadas técnicas.

**Domínios no Sistema**:
- **KERNEL**: Execução de tasks
- **DRIVER**: Automação de browser
- **INFRA**: Recursos compartilhados
- **SERVER**: Interface web
- **NERV**: Event bus
- **CORE**: Fundação
- **LOGIC**: Regras de negócio

**Benefícios**:
- Clarity: Fácil saber onde adicionar código
- Testability: Testar domínios isoladamente
- Team scalability: Times diferentes cuidam de domínios diferentes

**Ver também**: [PHILOSOPHY.md - Domain-Driven Design](PHILOSOPHY.md#domain-driven-design)

---

### Driver

**Categoria**: Componente
**Definição**: Módulo responsável por **automação de browser** para interagir com LLMs (ChatGPT, Gemini).

**Responsabilidades**:
- Controlar browser via Puppeteer
- Navegar para sites LLM
- Localizar elementos (textarea, botões)
- Digitar prompt (human-like timing)
- Coletar resposta (incremental)

**Localização**: `src/driver/`

**Submódulos**:
- **Factory**: Cria driver correto (ChatGPT/Gemini)
- **Targets**: Implementações específicas (ChatGPTDriver, GeminiDriver)
- **Modules**: human.js, ariadne_thread.js, collection.js
- **NERV Adapter**: Conecta Driver ↔ NERV

**Exemplo**:
```javascript
const driver = DriverFactory.create('chatgpt');
const response = await driver.execute('task-abc', 'Hello GPT');
```

**Ver também**: [DriverFactory](#driverfactory), [Puppeteer](#puppeteer)

---

### DriverFactory

**Categoria**: Pattern
**Definição**: **Factory Pattern** que cria instância correta de Driver baseado no target.

**Uso**:
```javascript
const driver = DriverFactory.create('chatgpt');  // ChatGPTDriver
const driver = DriverFactory.create('gemini');   // GeminiDriver
```

**Extensibilidade**:
```javascript
// Adicionar novo target
DriverFactory.register('claude', ClaudeDriver);
const driver = DriverFactory.create('claude');
```

**Localização**: `src/driver/factory/driver_factory.js`

**Ver também**: [Factory Pattern](PATTERNS.md#factory-pattern), [Driver](#driver)

---

### EMA (Exponential Moving Average)

**Categoria**: Algoritmo
**Definição**: Média móvel que dá **mais peso a valores recentes**, usada para suavizar adaptive delays.

**Fórmula**:
```
EMA_new = α × value_current + (1 - α) × EMA_old
```

**Parâmetros**:
- α (alpha) = 0.3 (30% peso atual, 70% histórico)

**Contexto**: Usado em `src/logic/adaptive_delay.js` para suavizar delays entre keystrokes

**Ver também**: [Adaptive Delay](#adaptive-delay)

---

### Envelope

**Categoria**: Conceito
**Definição**: Estrutura padronizada que **encapsula eventos NERV**, contendo metadata (correlationId, timestamp) e payload.

**Estrutura**:
```javascript
{
    messageType: 'TASK_ALLOCATED',      // Tipo do evento
    payload: {                          // Dados específicos
        taskId: 'task-abc',
        target: 'chatgpt'
    },
    correlationId: '550e8400-...',      // UUID para tracking
    timestamp: 1737469250123,           // Unix timestamp (ms)
    _serialized: null                   // P9.5: Cache de serialização
}
```

**Criação**: NERV Emission Layer

**Serialização**: Transport Layer (memoizado - P9.5)

**Ver também**: [NERV](#nerv), [Correlation ID](#correlation-id), [Memoization](#memoization)

---

### Event Bus

**Categoria**: Arquitetura
**Definição**: Componente central (NERV) que **medeia comunicação entre módulos** via eventos, garantindo zero acoplamento direto.

**Operações**:
- `emit(messageType, payload)`: Publicar evento
- `on(messageType, handler)`: Escutar evento (persistente)
- `once(messageType, handler)`: Escutar uma vez

**Exemplo**:
```javascript
// Publicar
nerv.emit('TASK_ALLOCATED', { taskId: 'task-abc' });

// Escutar
nerv.on('TASK_ALLOCATED', ({ taskId }) => {
    log('INFO', `Task allocated: ${taskId}`);
});
```

**Ver também**: [NERV](#nerv), [Event-Driven Architecture](PATTERNS.md#event-driven-architecture)

---

### External Browser

**Categoria**: Configuração
**Definição**: Modo de operação onde sistema **conecta a browser já executando** (via CDP porta 9222), ao invés de lançar instância própria.

**Vantagens**:
- -70% uso de recursos (CPU, memória)
- Debugging facilitado (DevTools acessível)
- Perfil persistente (login manual possível)

**Desvantagens**:
- Requer setup manual
- Instabilidade se browser fechado

**Configuração**:
```json
{
    "browserMode": "external",
    "externalBrowserPort": 9222
}
```

**Ver também**: [CDP](#cdp-chrome-devtools-protocol), [Launcher Mode](#launcher-mode)

---

### File Watcher

**Categoria**: Componente
**Definição**: Componente que **observa mudanças no filesystem** (diretório `fila/`) e notifica sistema via NERV quando tasks são adicionadas/modificadas.

**Tecnologia**: chokidar (npm package)

**Eventos observados**:
- `add`: Arquivo adicionado
- `change`: Arquivo modificado
- `unlink`: Arquivo removido

**Debounce**: 100ms (acumula múltiplos eventos)

**Localização**: `src/infra/queue/fs_watcher.js`

**Exemplo**:
```javascript
watcher.on('add', (filePath) => {
    cache.markDirty();
    nerv.emit('QUEUE_CHANGE', { action: 'add', filePath });
});
```

**Ver também**: [Observer Pattern](PATTERNS.md#observer-pattern), [Queue Cache](#queue-cache)

---

### Health Status

**Categoria**: Estado
**Definição**: Status de saúde do sistema ou componente, exposto via endpoints `/api/health`.

**Valores possíveis**:
- `ok` / `healthy` / `online`: Sistema funcionando normalmente
- `degraded`: Funcionando mas com problemas
- `offline` / `unhealthy`: Sistema indisponível

**Endpoints**:
- `/api/health`: Core health
- `/api/health-metrics`: P9.1 - Heap usage, GC stats
- `/api/metrics`: P9.6 - Cache metrics

**Exemplo de resposta**:
```json
{
    "status": "ok",
    "uptime": 123456789,
    "components": {
        "nerv": "ok",
        "kernel": "ok",
        "browserPool": "ok"
    }
}
```

**Ver também**: [Circuit Breaker](#circuit-breaker), [Browser States](#browser-states)

---

### Identity

**Categoria**: Módulo
**Definição**: Sistema de identificação único do agente via **DNA** (UUID persistente).

**Funções**:
- `initDNA()`: Inicializa DNA (carrega ou cria)
- `getAgentDNA()`: Retorna DNA atual
- `generateTaskId()`: Gera ID único para task
- `generateCorrelationId()`: Gera ID para eventos NERV

**Localização**: `src/core/identity/dna.js`

**Ver também**: [DNA](#dna), [Correlation ID](#correlation-id)

---

### Kernel

**Categoria**: Componente
**Definição**: Motor de execução que **decide quando e quais tasks executar**, rodando em loop 20Hz.

**Responsabilidades**:
- Loop 20Hz (50ms por ciclo)
- Avaliar políticas (PolicyEngine)
- Alocar tasks para drivers
- Gerenciar estado de tasks (TaskRuntime)
- Observar execuções (ObservationStore)

**Localização**: `src/kernel/`

**Subcomponentes**:
- **KernelMaestro**: Orchestrator
- **KernelLoop**: Loop 20Hz
- **PolicyEngine**: Decide alocações
- **TaskRuntime**: Gerencia estados
- **ObservationStore**: Histórico + telemetria
- **KernelNERVBridge**: Adapter para NERV

**Ver também**: [PolicyEngine](#policyengine), [KernelLoop](#kernelloop)

---

### KernelLoop

**Categoria**: Componente
**Definição**: Loop assíncrono que executa a **20Hz (50ms por ciclo)**, coordenando decisões de alocação de tasks.

**Fluxo**:
```
1. Avaliar políticas (PolicyEngine)
2. Processar decisões (alocar tasks)
3. Aguardar próximo ciclo (50ms - duration)
4. Repetir
```

**Timeout** (P9.4): 5s max por ciclo (previne bloqueio)

**Performance típica**:
- Cycle duration: 10-30ms
- Overhead: 20-40%
- Next cycle delay: 20-40ms

**Localização**: `src/kernel/kernel_loop/kernel_loop.js`

**Ver também**: [Kernel](#kernel), [PolicyEngine](#policyengine)

---

### Launcher Mode

**Categoria**: Configuração
**Definição**: Modo de operação onde sistema **lança sua própria instância de browser** (Chrome/Edge) via Puppeteer.

**Vantagens**:
- Setup automático (zero configuração manual)
- Isolamento completo (sem interferência externa)
- Stealth plugins aplicados automaticamente

**Desvantagens**:
- +70% uso de recursos vs external mode
- Debugging mais difícil

**Configuração**:
```json
{
    "browserMode": "launcher"
}
```

**Ver também**: [External Browser](#external-browser), [Puppeteer](#puppeteer)

---

### Lock Manager

**Categoria**: Componente
**Definição**: Gerencia **locks distribuídos** para coordenar acesso concorrente a tasks entre múltiplas instâncias.

**Estratégia**: Two-phase commit

**Fases**:
1. **Acquire**: Criar arquivo `.lock` com PID + DNA
2. **Validate**: Verificar se lock owner ainda está vivo
3. **Release**: Remover arquivo `.lock`
4. **Recovery**: Limpar locks orphans (owner morto)

**Localização**: `src/infra/locks/lock_manager.js`

**Exemplo**:
```javascript
const lock = await lockManager.acquireLock('task-abc', 'chatgpt');
try {
    // ... processar task
} finally {
    await lockManager.releaseLock(lock);
}
```

**Ver também**: [Optimistic Locking](#optimistic-locking), [DNA](#dna)

---

### Memoization

**Categoria**: Pattern
**Definição**: Técnica de **cachear resultados** de funções puras para evitar recomputação, aplicada na serialização de envelopes NERV (P9.5).

**Implementação**:
```javascript
function serializeEnvelope(envelope) {
    if (envelope._serialized) {
        return envelope._serialized;  // Cache hit
    }

    envelope._serialized = JSON.stringify(envelope);
    return envelope._serialized;
}
```

**Performance**:
- 1ª serialização: 5ms
- 2ª+ serializações: 0.1ms
- **Reduction: 98%**

**Contexto**: Hot path (kernel 20Hz) com P9.5

**Ver também**: [P9.5](#p95-json-memoization), [Envelope](#envelope)

---

### NERV

**Categoria**: Componente
**Definição**: **Event Bus central** que medeia toda comunicação entre componentes do sistema, implementando arquitetura event-driven.

**Acrônimo**: *(Não definido oficialmente - possível: Network Event Relay Vertex)*

**Responsabilidades**:
- Emissão de eventos (Emission Layer)
- Recepção de eventos (Reception Layer)
- Buffers (Inbound + Outbound)
- Transport (routing + serialization)
- Correlation (lineage tracking)
- Telemetria (metrics)

**Localização**: `src/nerv/`

**Arquitetura**:
```
Component A → emit() → NERV → on() → Component B
```

**Ver também**: [Event Bus](#event-bus), [Envelope](#envelope), [Event-Driven Architecture](PATTERNS.md#event-driven-architecture)

---

### Optimistic Locking

**Categoria**: Pattern
**Definição**: Técnica de **prevenir race conditions** em atualizações concorrentes, verificando se estado esperado ainda é atual antes de commitar (P5.1).

**Fluxo**:
```javascript
// 1. Read current state
const task = await loadTask(taskId);

// 2. Check expected state
if (expectedState && task.state !== expectedState) {
    throw new Error('RACE_CONDITION');
}

// 3. Update
task.state = newState;
await saveTask(task);
```

**Cenário de Race**:
```
T=0  : Task state = 'PENDING'
T=100: Instance A updates to 'RUNNING' (expected='PENDING') ✅ OK
T=110: Instance B tries update to 'RUNNING' (expected='PENDING')
       → Current state is 'RUNNING' (changed by A)
       → ❌ RACE_CONDITION error
```

**Ver também**: [Lock Manager](#lock-manager), [P5.1](#p51-optimistic-locking)

---

### Outlier Rejection

**Categoria**: Algoritmo
**Definição**: Técnica estatística para **rejeitar valores anômalos** (outliers) em adaptive delays, usando 6σ (six sigma).

**Lógica**:
```javascript
if (Math.abs(value - mean) > 6 * stdDev) {
    return mean;  // Rejeitar outlier
}
```

**Contexto**: Previne delays absurdos (ex: 2000ms) por bugs ou network spike

**Ver também**: [Adaptive Delay](#adaptive-delay), [EMA](#ema-exponential-moving-average)

---

### Page

**Categoria**: Browser Automation
**Definição**: Instância de **aba do browser** controlada via Puppeteer, usada para executar automação.

**Operações comuns**:
- `page.goto(url)`: Navegar
- `page.type(selector, text)`: Digitar
- `page.click(selector)`: Clicar
- `page.evaluate(fn)`: Executar JavaScript

**Exemplo**:
```javascript
const page = await browserPool.allocatePage('chatgpt');
await page.goto('https://chat.openai.com');
await page.type('textarea', 'Hello GPT');
```

**Ver também**: [Puppeteer](#puppeteer), [Browser Pool](#browser-pool)

---

### P-Levels

**Categoria**: Quality
**Definição**: Sistema de classificação de **problemas identificados em audits**, priorizados de P1 (crítico) a P9 (melhorias).

**Escalas**:
- **P1-P2**: Bugs críticos (system crash, data loss)
- **P3-P5**: Bugs sérios (race conditions, memory leaks)
- **P6-P7**: Melhorias de performance
- **P8**: Security fixes
- **P9**: Performance otimizações

**Exemplos**:
- **P5.1**: Optimistic locking para race conditions
- **P8.1**: Sanitização de prompts
- **P9.2**: Circuit breaker no browser pool
- **P9.5**: Memoização JSON

**Status**: 40+ P-level fixes implementados (2024-2026)

**Ver também**: [Audit Rating](#audit-rating)

---

### P5.1 (Optimistic Locking)

**Categoria**: P-Level Fix
**Descrição**: Fix para **race conditions** em atualizações concorrentes de task state.

**Problema**: Duas instâncias atualizavam task simultaneamente → estado inconsistente

**Solução**: Validar expected state antes de commit

**Implementação**: `src/kernel/task_runtime/task_runtime.js`

**Ver também**: [Optimistic Locking](#optimistic-locking)

---

### P9.2 (Circuit Breaker)

**Categoria**: P-Level Fix
**Descrição**: Circuit breaker no **browser pool** para prevenir alocação de instâncias degradadas.

**Problema**: Pool alocava browsers crashed/degradados → falhas em cascata

**Solução**: Filtrar apenas instâncias `HEALTHY` em `_selectInstance()`

**Implementação**: `src/infra/browser_pool/pool_manager.js`

**Ver também**: [Circuit Breaker](#circuit-breaker), [Browser States](#browser-states)

---

### P9.5 (JSON Memoization)

**Categoria**: P-Level Fix
**Descrição**: **Memoização de serialização JSON** de envelopes NERV para reduzir CPU em hot paths.

**Problema**: Envelopes serializados múltiplas vezes (kernel 20Hz) → CPU alto

**Solução**: Cache `_serialized` no envelope

**Performance**: 98% reduction (5ms → 0.1ms)

**Implementação**: `src/nerv/transport/transport.js`

**Ver também**: [Memoization](#memoization), [Envelope](#envelope)

---

### PolicyEngine

**Categoria**: Componente
**Definição**: Componente que **decide quando alocar tasks** baseado em políticas (MAX_WORKERS, queue status).

**Políticas**:
1. Respeitar `MAX_WORKERS` (P9.9 - configurável)
2. Queue não vazia (PENDING tasks)
3. Priorizar por ordem (FIFO)

**Output**:
```javascript
{
    shouldAllocate: true/false,
    nextTask: { id, target, prompt, ... },
    reason: 'MAX_WORKERS_REACHED' | 'QUEUE_EMPTY' | null
}
```

**Localização**: `src/kernel/policy_engine/policy_engine.js`

**Ver também**: [Kernel](#kernel), [KernelLoop](#kernelloop)

---

### Puppeteer

**Categoria**: Tecnologia
**Definição**: Biblioteca Node.js para **controle de Chrome/Chromium** via DevTools Protocol (CDP).

**Versão no sistema**: 23.11

**Features usadas**:
- Launch/connect browsers
- Page automation (navigate, type, click)
- Network interception
- Screenshot/PDF generation

**Exemplo**:
```javascript
const puppeteer = require('puppeteer');
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://example.com');
```

**Ver também**: [CDP](#cdp-chrome-devtools-protocol), [Stealth Plugin](#stealth-plugin)

---

### Queue Cache

**Categoria**: Componente
**Definição**: Cache em memória da **fila de tasks** (diretório `fila/`), com invalidação reativa via File Watcher.

**Responsabilidades**:
- Scan filesystem (`scanQueue()`)
- Cachear resultados (`globalQueueCache`)
- Invalidar cache (`markDirty()`)
- p-limit(10) para controlar concorrência (P9.7)
- Cache metrics (P9.6)

**Localização**: `src/infra/queue/cache.js`

**Fluxo**:
```
File added → Watcher detects → markDirty() → Next getQueue() → scanQueue()
```

**Performance**:
- Cache hit: <1ms
- Cache miss: 200ms (10 tasks), 1200ms (100 tasks com p-limit)

**Ver também**: [File Watcher](#file-watcher), [P9.7](#p97-p-limit)

---

### P9.7 (p-limit)

**Categoria**: P-Level Fix
**Descrição**: Controle de **concorrência em queue scan** para evitar esgotar file descriptors.

**Problema**: 100 files = 100 FDs simultâneos → EMFILE error

**Solução**: `p-limit(10)` limita concorrência em 10

**Performance**: +33% latência, -90% FDs

**Implementação**: `src/infra/queue/cache.js`

**Ver também**: [Queue Cache](#queue-cache), [Promise Pooling](PATTERNS.md#promise-pooling)

---

### Stealth Plugin

**Categoria**: Tecnologia
**Definição**: Plugin Puppeteer (`puppeteer-extra-plugin-stealth`) que **mascara automação** para prevenir detecção de bots.

**Técnicas**:
- Remover `navigator.webdriver = true`
- Emular `navigator.plugins`
- User-agent rotation
- Canvas fingerprint masking

**Instalação**:
```javascript
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
```

**Ver também**: [Puppeteer](#puppeteer), [User-Agent Rotation](#user-agent-rotation)

---

### Task States

**Categoria**: Estado
**Definição**: Estados possíveis de uma task durante seu lifecycle.

**Estados**:
1. **PENDING**: Task na fila, aguardando alocação
2. **RUNNING**: Task executando (driver alocado)
3. **DONE**: Task concluída com sucesso
4. **FAILED**: Task falhou (error durante execução)
5. **CANCELED**: Task cancelada manualmente

**Transições válidas**:
```
PENDING → RUNNING
PENDING → CANCELED
RUNNING → DONE
RUNNING → FAILED
RUNNING → CANCELED (raro)
```

**Transições inválidas**:
```
DONE → RUNNING ❌
FAILED → PENDING ❌
```

**Validação**: `TaskRuntime.isValidTransition()`

**Ver também**: [TaskRuntime](#taskruntime), [Optimistic Locking](#optimistic-locking)

---

### TaskRuntime

**Categoria**: Componente
**Definição**: Componente que **gerencia estados de tasks**, aplicando optimistic locking (P5.1) e validando transições.

**Responsabilidades**:
- `updateState(taskId, newState, expectedState)`: Atualizar com validação
- `isValidTransition(from, to)`: Validar se transição é permitida

**Localização**: `src/kernel/task_runtime/task_runtime.js`

**Ver também**: [Task States](#task-states), [Optimistic Locking](#optimistic-locking), [P5.1](#p51-optimistic-locking)

---

### User-Agent Rotation

**Categoria**: Técnica
**Definição**: Rotacionar **user-agent strings** em requests para simular diferentes browsers e prevenir detecção de bot.

**Exemplos**:
```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15
Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0
```

**Contexto**: Aplicado em `setupPage()` do browser pool

**Ver também**: [Stealth Plugin](#stealth-plugin), [Browser Pool](#browser-pool)

---

## 📊 Referências Cruzadas

### Por Componente

**CORE**: [DNA](#dna), [Identity](#identity)
**NERV**: [Event Bus](#event-bus), [Envelope](#envelope), [Correlation ID](#correlation-id)
**KERNEL**: [Kernel](#kernel), [KernelLoop](#kernelloop), [PolicyEngine](#policyengine), [TaskRuntime](#taskruntime)
**INFRA**: [Browser Pool](#browser-pool), [Queue Cache](#queue-cache), [Lock Manager](#lock-manager), [File Watcher](#file-watcher)
**DRIVER**: [Driver](#driver), [DriverFactory](#driverfactory), [Puppeteer](#puppeteer)

### Por Padrão

**Event-Driven**: [NERV](#nerv), [Event Bus](#event-bus)
**Factory**: [DriverFactory](#driverfactory)
**Circuit Breaker**: [P9.2](#p92-circuit-breaker), [Browser States](#browser-states)
**Optimistic Locking**: [P5.1](#p51-optimistic-locking), [TaskRuntime](#taskruntime)
**Memoization**: [P9.5](#p95-json-memoization), [Envelope](#envelope)

---

## 📚 Documentos Relacionados

- [ARCHITECTURE.md](ARCHITECTURE.md) - Visão geral dos componentes
- [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) - Diagramas detalhados
- [SUBSYSTEMS.md](SUBSYSTEMS.md) - Deep dive em cada módulo
- [PATTERNS.md](PATTERNS.md) - Padrões arquiteturais
- [PHILOSOPHY.md](PHILOSOPHY.md) - Princípios arquiteturais

---

*Última revisão: 21/01/2026 | Contribuidores: AI Architect, Core Team*
