# 🧠 Arquitetura Conceitual: Responsabilidades e Taxonomia de Eventos

> **Versão**: 1.0 **Data**: 4 de Fevereiro de 2026 **Status**: 🟢 PRODUCTION DEFINITION
> **Objetivo**: Definir claramente as responsabilidades de cada componente e categorizar todos os
> tipos de eventos/problemas do sistema.

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Matriz de Responsabilidades](#matriz-de-responsabilidades)
3. [Taxonomia de Eventos](#taxonomia-de-eventos)
4. [Componentes: Definição Conceitual](#componentes-definição-conceitual)
5. [Fluxos de Decisão](#fluxos-de-decisão)
6. [Anti-Patterns: O Que Cada Componente NÃO Faz](#anti-patterns-o-que-cada-componente-não-faz)
7. [Casos de Uso Detalhados](#casos-de-uso-detalhados)

---

## 🎯 Visão Geral

### O Problema Fundamental

O sistema enfrenta **4 tipos diferentes de situações** que frequentemente são confundidas como
"falhas":

```
TAXONOMIA DE EVENTOS
┌─────────────────────────────────────────────────────────────┐
│ 1. FALHAS TÉCNICAS (System Failures)                       │
│    → Conexão perdida, crash do Chrome, OOM, rede down      │
│    → RESPONSABILIDADE: CircuitBreaker + Recovery            │
├─────────────────────────────────────────────────────────────┤
│ 2. AÇÕES DO USUÁRIO (User Actions)                         │
│    → Fechar Chrome, não abrir página, reabrir browser      │
│    → RESPONSABILIDADE: Kernel (aguardar pacientemente)      │
├─────────────────────────────────────────────────────────────┤
│ 3. PROBLEMAS DE NEGÓCIO (Business Problems)                │
│    → Conversas longas, LLM degradado, rate limits          │
│    → RESPONSABILIDADE: Driver (detectar + relatar)          │
├─────────────────────────────────────────────────────────────┤
│ 4. CONDIÇÕES DE ESPERA (Waiting Conditions)                │
│    → Página carregando, LLM processando, rede lenta        │
│    → RESPONSABILIDADE: Driver (aguardar + timeout)          │
└─────────────────────────────────────────────────────────────┘
```

### Princípio Central

**Cada componente tem UMA responsabilidade primária**:

- **Driver** = Controla **COMO** automatizar LLM (Puppeteer, seletores, typing)
- **Kernel** = Decide **QUANDO** executar tasks (políticas, MAX_WORKERS, alocação)
- **CircuitBreaker** = Detecta **CAUSA** de falhas técnicas (não apenas "falhou")
- **Monitor** = Mede **SAÚDE** contínua (métricas, CDP health checks)
- **BrowserPool** = Gerencia **RECURSOS** (browsers, páginas, conexões)

---

## 📊 Matriz de Responsabilidades

### Tabela Completa

| Componente                | Responsabilidade Primária    | Escopo                | Inputs                  | Outputs               | NÃO Faz                                                                             |
| ------------------------- | ---------------------------- | --------------------- | ----------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| **Driver**                | **Automação de LLM**         | Página LLM específica | Task (prompt, target)   | Result (resposta LLM) | ❌ Não decide quando executar<br>❌ Não gerencia conexões<br>❌ Não decide retry    |
| **Kernel**                | **Orquestração de Execução** | Sistema completo      | Decisions (políticas)   | Task allocation       | ❌ Não executa tasks<br>❌ Não controla Puppeteer<br>❌ Não detecta falhas técnicas |
| **CircuitBreaker**        | **Diagnóstico de Causa**     | Browser Pool          | Failures (com contexto) | Pause decisions       | ❌ Não tenta reconectar<br>❌ Não executa health checks<br>❌ Não gerencia recursos |
| **PeriodicHealthMonitor** | **Monitoramento Contínuo**   | Pool + Pages          | CDP checks (30s)        | Health status         | ❌ Não decide pausar sistema<br>❌ Não diagnostica causa<br>❌ Não executa tasks    |
| **BrowserPool**           | **Gestão de Recursos**       | Browsers/Pages        | Allocation requests     | Browser instances     | ❌ Não executa tasks<br>❌ Não decide políticas<br>❌ Não automatiza LLM            |

### Diagrama de Camadas

```
┌─────────────────────────────────────────────────────────────┐
│                    MISSION LAYER                            │
│         (Workflows, Steps, Long-running processes)          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                      │
│   Kernel: Decide QUANDO executar (políticas, workers)      │
│   - KernelLoop (20Hz): Tempo soberano                      │
│   - PolicyEngine: MAX_WORKERS, rate limits, health         │
│   - TaskRuntime: Estado de tasks (PENDING→RUNNING→DONE)   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION LAYER                          │
│   Driver: Controla COMO automatizar LLM                    │
│   - Puppeteer automation (typing, clicks, waits)          │
│   - LLM-specific logic (ChatGPT vs. Gemini)              │
│   - Response collection (streaming, incremental)          │
│   - Business problems detection (rate limits, errors)     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                     │
│   BrowserPool: Gerencia browsers + conexões               │
│   - Allocation/deallocation de recursos                   │
│   - CircuitBreaker: Diagnóstico de CAUSA de falhas       │
│   - PeriodicHealthMonitor: Saúde contínua (CDP)          │
│   - ConnectionRecovery: Tentativas de reconexão          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏷️ Taxonomia de Eventos

### 1. FALHAS TÉCNICAS (System Failures)

**Definição**: Problemas causados por falha em componentes de infraestrutura (não pelo usuário ou
LLM).

| Tipo                 | Causa                  | Detectado Por                          | Ação                 | Exemplo                       |
| -------------------- | ---------------------- | -------------------------------------- | -------------------- | ----------------------------- |
| `TECHNICAL_CRASH`    | Chrome crash           | BrowserPool (isConnected=false)        | CB pause + recovery  | Chrome OOM, process killed    |
| `NETWORK_ISSUE`      | Rede instável          | PeriodicHealthMonitor (CDP timeout)    | CB pause + retry     | Wi-Fi desconectou, proxy down |
| `PROXY_FAILURE`      | Proxy parou            | chromeProxyService (health check fail) | CB pause + restart   | Porta 9224 não responde       |
| `OUT_OF_MEMORY`      | Chrome OOM             | CDP metrics (memory > 90%)             | CB pause + cleanup   | Muitas tabs abertas           |
| `PROCESS_SUSPENDED`  | S.O. suspendeu Chrome  | CDP targets (0 targets)                | CB pause + wake      | Laptop em sleep mode          |
| `CDP_PROTOCOL_ERROR` | Chrome DevTools falhou | Puppeteer exception                    | CB pause + reconnect | WebSocket protocol error      |
| `PAGE_CRASH`         | Página travou          | page.isClosed()=true                   | Driver retry (3x)    | Tab crash no Chrome           |

**Características**:

- ✅ **NÃO são culpa do usuário** (são falhas técnicas)
- ✅ **Não são esperadas** (devem ser exceções raras)
- ✅ **Requerem pause** do sistema (CircuitBreaker CIRCUIT_OPEN)
- ✅ **Requerem recovery** automático (ConnectionRecoveryStrategy)

---

### 2. AÇÕES DO USUÁRIO (User Actions)

**Definição**: Decisões conscientes do usuário que não são "falhas", mas requerem que o sistema
aguarde pacientemente.

| Tipo                     | Ação                                  | Detectado Por                     | Resposta do Sistema                   | Exemplo                               |
| ------------------------ | ------------------------------------- | --------------------------------- | ------------------------------------- | ------------------------------------- |
| `USER_CLOSED_CHROME`     | Usuário fechou Chrome                 | BrowserPool (isConnected=false)   | ✅ Kernel PAUSED (aguarda reopen)     | Usuário clicou X no Chrome            |
| `USER_NOT_OPENED_CHROME` | Usuário ainda não abriu Chrome        | Puppeteer.connect() fail          | ✅ Kernel PAUSED (aguarda open)       | Sistema iniciado, Chrome não          |
| `USER_CLOSED_PAGE`       | Usuário fechou tab LLM                | page.isClosed()=true              | ✅ Driver aguarda nova página         | Usuário fechou ChatGPT tab            |
| `USER_NAVIGATED_AWAY`    | Usuário mudou de página               | page.url() !== expected           | ✅ Driver aguarda navegação correta   | Abriu Gmail em vez de ChatGPT         |
| `USER_LOGGED_OUT`        | Usuário fez logout do LLM             | Selector '.login-button' presente | ✅ Driver retorna erro (requer login) | Sessão expirou, usuário clicou logout |
| `USER_REOPENED_CHROME`   | Usuário reabriu Chrome                | Puppeteer.connect() success       | ✅ Kernel ACTIVE (retoma tasks)       | Usuário abriu Chrome novamente        |
| `USER_IDLE_SESSION`      | Usuário deixou sistema aberto sem uso | Não é detectado                   | ✅ Sistema continua (sem problema)    | Usuário foi almoçar                   |

**Características**:

- ✅ **São decisões do usuário** (não falhas técnicas)
- ✅ **São esperadas** (fazem parte do uso normal)
- ✅ **Não requerem alarmes** (logs informativos apenas)
- ✅ **Sistema aguarda pacientemente** (Kernel PAUSED, zero erros)
- ✅ **Retomada automática** (quando condição satisfeita)

**Princípio de Design**:

```javascript
// CORRETO: Aguardar pacientemente
if (!browserPool.isConnected()) {
  kernel.setState(KernelLoopState.PAUSED);
  log('INFO', 'Aguardando usuário abrir Chrome...');
  return; // Pula ciclo, mas mantém loop ativo
}

// ERRADO: Lançar erro
if (!browserPool.isConnected()) {
  throw new Error('Chrome não conectado!'); // ❌ NÃO FAÇA ISSO
}
```

---

### 3. PROBLEMAS DE NEGÓCIO (Business Problems)

**Definição**: Problemas relacionados ao comportamento do LLM ou às limitações da plataforma
(ChatGPT, Gemini).

| Tipo                       | Problema               | Detectado Por                           | Resposta                                        | Exemplo                             |
| -------------------------- | ---------------------- | --------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| `CONVERSATION_TOO_LONG`    | Contexto saturado      | Driver (análise de resposta LLM)        | ✅ Task retorna com flag `needsNewConversation` | LLM ignora instruções antigas       |
| `RATE_LIMIT_HIT`           | Too many requests      | Driver (selector '.rate-limit-warning') | ✅ Task retorna FAILED com retry delay          | ChatGPT: "Try again in 1 hour"      |
| `LLM_OVERLOADED`           | Serviço sobrecarregado | Driver (timeout > 60s)                  | ✅ Task retorna FAILED com retry                | ChatGPT: Timeout ao gerar resposta  |
| `CONTENT_POLICY_VIOLATION` | Prompt violou política | Driver (selector '.content-warning')    | ✅ Task retorna FAILED (sem retry)              | ChatGPT: "I can't assist with that" |
| `INVALID_RESPONSE`         | Resposta malformada    | Driver (validação de schema)            | ✅ Task retorna FAILED (retry possível)         | JSON inválido, resposta truncada    |
| `LLM_CONFUSION`            | LLM não entendeu       | Driver (análise semântica)              | ✅ Task retorna com flag `needsClarification`   | Resposta vaga, fora do contexto     |
| `SESSION_EXPIRED`          | Sessão ChatGPT expirou | Driver (redirect para /auth/login)      | ✅ Task retorna FAILED (requer login)           | 401 Unauthorized                    |

**Características**:

- ✅ **São problemas de NEGÓCIO** (não infraestrutura)
- ✅ **Driver detecta** (durante execução)
- ✅ **Driver relata** (via resultado de task)
- ✅ **Kernel decide retry** (baseado em PolicyEngine)
- ✅ **Podem requerer intervenção humana** (ex: login, clarificação)

**Fluxo de Detecção**:

```javascript
// src/driver/targets/ChatGPTDriver.js
async execute(task) {
    const response = await this._collectResponse();

    // Detecta problemas de negócio
    if (this._isRateLimited(response)) {
        return {
            status: 'FAILED',
            error: 'RATE_LIMIT_HIT',
            retryAfter: 3600, // 1 hora
            businessProblem: true
        };
    }

    if (this._isConversationTooLong(response)) {
        return {
            status: 'COMPLETED',
            data: response,
            needsNewConversation: true,
            businessProblem: true
        };
    }

    return { status: 'COMPLETED', data: response };
}
```

---

### 4. CONDIÇÕES DE ESPERA (Waiting Conditions)

**Definição**: Situações normais onde o sistema precisa aguardar (não são problemas).

| Tipo                      | Condição                      | Aguarda Por                       | Timeout     | Exemplo                            |
| ------------------------- | ----------------------------- | --------------------------------- | ----------- | ---------------------------------- |
| `PAGE_LOADING`            | Página carregando             | `page.waitForNavigation()`        | 30s         | ChatGPT carregando JS/CSS          |
| `LLM_THINKING`            | LLM gerando resposta          | Streaming incremental             | 180s        | ChatGPT processando resposta longa |
| `ELEMENT_NOT_YET_VISIBLE` | Seletor ainda não existe      | `page.waitForSelector()`          | 10s         | Chat input ainda não renderizado   |
| `NETWORK_SLOW`            | Rede lenta                    | Retry automático                  | 5s          | Download de assets lento           |
| `ANIMATION_RUNNING`       | Animação CSS/JS               | `await sleep(500)`                | 2s          | Botão com animação de click        |
| `TYPING_SIMULATION`       | Simulação de digitação humana | Typing engine (50ms/char)         | N/A         | Digitar prompt de 500 caracteres   |
| `BROWSER_CONNECTING`      | Puppeteer.connect()           | ConnectionRecovery (5 tentativas) | 60s (total) | Chrome iniciando                   |

**Características**:

- ✅ **São normais** (fazem parte do fluxo esperado)
- ✅ **Têm timeouts definidos** (não aguarda infinitamente)
- ✅ **Driver gerencia** (usando Puppeteer waits)
- ✅ **Não são relatadas como erros** (apenas logs DEBUG)
- ✅ **Exceções após timeout** (se timeout expirar, vira SYSTEM FAILURE)

**Exemplo de Implementação**:

```javascript
// src/driver/guards/DriverReadinessGuard.js
async waitForChatReady(page, timeout = 10000) {
    try {
        // Aguarda condição (WAITING CONDITION)
        await page.waitForSelector('#chat-input', { timeout });

        return { ready: true };
    } catch (err) {
        // Timeout expirou → vira SYSTEM FAILURE
        if (err.name === 'TimeoutError') {
            return {
                ready: false,
                error: 'TECHNICAL_TIMEOUT',
                businessProblem: false
            };
        }
        throw err;
    }
}
```

---

## 🧩 Componentes: Definição Conceitual

### 1. DRIVER (Execution Layer)

**Definição Conceitual**:

> O Driver é o **especialista em automação de LLM**. Ele sabe COMO controlar Puppeteer, QUAIS
> seletores usar, COMO digitar como humano, COMO coletar respostas incrementais. Ele NÃO decide
> QUANDO executar tasks (isso é o Kernel).

#### Responsabilidades Primárias

1. **Execução Completa de Task**:
   - **Responsabilidade**: Fazer o necessário para executar a task até o fim
   - **Escopo**: No contexto de uma missão, partindo do pressuposto que task está clara
   - **Retry Tático**: Tentar novamente em caso de falhas TÉCNICAS recuperáveis
   - **Abort em Cancelamento**: Abortar imediatamente se task cancelada externamente

2. **Automação Puppeteer**:
   - Navegar para página LLM
   - Aguardar elementos ficarem prontos (chat input, botões)
   - Simular digitação humana (typing engine)
   - Clicar botões, enviar formulários
   - Coletar respostas (streaming incremental)

3. **Retry Tático (Operações de Execução)**:
   - **Escopo**: Seletores, frames, operações DOM, animações CSS
   - **Decisão**: LOCAL (driver sabe quando operação é recuperável)
   - **Timeouts**: Configurados por operação (selector: 10s, navigation: 30s)
   - **Distingue**: Falha técnica (retry) vs cancelamento externo (abort)
   - **Exemplo**: Seletor não encontrado → tenta 4x em 2 segundos

4. **Detecção de Problemas de Negócio**:
   - Rate limits (selector: `.rate-limit-warning`)
   - Conversas longas (análise de contexto)
   - Erros do LLM (mensagens de erro na UI)
   - Sessões expiradas (redirect para login)
   - **Relata ao Kernel**: Kernel decide retry estratégico

5. **Gestão de Estado de Página**:
   - Verificar se página está pronta (DriverReadinessGuard)
   - Detectar navegação inesperada
   - Limpar estado entre tasks
   - Gerenciar handles do Puppeteer (HandleManager)

6. **Cancelamento Externo (AbortSignal)**:
   - **Checkpoints**: 6+ pontos de verificação durante execução
   - **Resposta**: Abort imediato (lança OPERATION_ABORTED)
   - **Fonte**: Dashboard (usuário cancelou), Kernel (timeout global)
   - **Propagação**: Signal passado por todos os módulos internos

7. **Classificação de Erros**:
   - **ABORT**: Cancelamento externo (não retry)
   - **TRANSIENT**: Falha técnica recuperável (retry tático)
   - **FATAL**: Não recuperável (relata ao Kernel)
   - **BUSINESS**: Problema de negócio (relata ao Kernel para decisão)

#### O Que o Driver NÃO Faz

❌ **Não decide retry ESTRATÉGICO de task**:

```javascript
// ERRADO: Driver decide reagendar task completa
async execute(task) {
    try {
        return await this._performTask(task);
    } catch (err) {
        // ❌ NÃO: Reagendar task é decisão do Kernel/PolicyEngine
        await sleep(3600000); // 1 hora
        return await this._performTask(task); // retry estratégico
    }
}

// CORRETO: Driver faz retry TÁTICO (operações), relata falha para Kernel
async execute(task) {
    try {
        return await this._performTask(task); // com retry tático interno
    } catch (err) {
        // Relata falha - Kernel decide se reagenda
        return {
            status: 'FAILED',
            error: err.message,
            recoverable: this._isRecoverable(err)
        };
    }
}
```

❌ **Não gerencia conexões de browser**:

```javascript
// ERRADO: Driver tenta reconectar browser
async execute(task) {
    if (!this.page.isConnected()) {
        // ❌ NÃO: Isso é responsabilidade do BrowserPool
        await this._reconnectBrowser();
    }
}
```

❌ **Não pausa sistema inteiro**:

```javascript
// ERRADO: Driver pausa Kernel
async execute(task) {
    if (this._isRateLimited()) {
        // ❌ NÃO: Driver não controla Kernel
        kernel.pause();
    }
}
```

❌ **Não ignora cancelamento externo**:

```javascript
// ERRADO: Driver ignora AbortSignal
async execute(task, signal) {
    // ❌ NÃO: Driver DEVE checar signal?.aborted
    for (let i = 0; i < 100; i++) {
        await doWork(); // sem checar signal
    }
}

// CORRETO: Driver respeita cancelamento
async execute(task, signal) {
    for (let i = 0; i < 100; i++) {
        if (signal?.aborted) {
            throw new Error('OPERATION_ABORTED');
        }
        await doWork();
```

#### Princípios de Design

✅ **Execute Até Conseguir OU Ser Cancelado**:

```javascript
// CORRETO: Driver é persistente com falhas técnicas
async execute(task, signal) {
    let attempts = 0;

    while (attempts < MAX_RETRY_ATTEMPTS) {
        // Check cancelamento externo
        if (signal?.aborted) {
            throw new Error('OPERATION_ABORTED');
        }

        try {
            // Tenta executar (retry tático de operações DOM)
            return await this._performAutomation(task, signal);
        } catch (err) {
            // Classifica erro
            const errorClass = this._classifyError(err);

            if (errorClass === 'ABORT') {
                throw err; // Cancelamento - não retry
            }

            if (errorClass === 'TRANSIENT') {
                attempts++;
                continue; // Retry tático OK
            }

            // Erro não recuperável - relata ao Kernel
            return {
                status: 'FAILED',
                error: err.message,
                recoverable: false
            };
        }
    }
}
```

✅ **Respeite Cancelamento Externo**:

```javascript
// CORRETO: Driver aborta imediatamente
async execute(task, signal) {
    // Checkpoint 1: Início
    if (signal?.aborted) {
        throw new Error('OPERATION_ABORTED');
    }

    await this._resolveInputs(signal);

    // Checkpoint 2: Após resolução
    if (signal?.aborted) {
        throw new Error('OPERATION_ABORTED');
    }

    await this._performTyping(signal);

    // Checkpoint 3: Após digitação
    if (signal?.aborted) {
        throw new Error('OPERATION_ABORTED');
    }

    return await this._collectResponse(signal);
}
```

✅ **Detecte e Relate Problemas de Negócio**:

```javascript
// CORRETO: Driver detecta, Kernel decide retry estratégico
async execute(task) {
    const response = await this._collectResponse();

    if (this._isRateLimited(response)) {
        // Relata problema de negócio - Kernel decide retry
        return {
            status: 'FAILED',
            error: 'RATE_LIMIT_HIT',
            businessProblem: true,
            retryAfter: 3600,
            recoverable: true // Kernel pode reagendar em 1 hora

    return { status: 'COMPLETED', data: response };
}
```

---

### 2. KERNEL (Orchestration Layer)

**Definição Conceitual**:

> O Kernel é o **maestro de orquestração**. Ele decide QUANDO executar tasks (baseado em políticas),
> quantas tasks simultâneas, quando aguardar, quando retomar. Ele NÃO sabe COMO automatizar LLM
> (isso é o Driver).

#### Responsabilidades Primárias

1. **Tempo Soberano**:
   - Loop 20Hz (50ms por ciclo)
   - Único controlador de tempo do sistema
   - Coordena todos os componentes

2. **Decisões de Alocação**:
   - Quando alocar próxima task (PolicyEngine)
   - Quantas tasks simultâneas (MAX_WORKERS)
   - Qual task executar (fila de prioridades)
   - Quando aguardar recursos ficarem disponíveis

3. **Gestão de Lifecycle de Tasks**:
   - PENDING → RUNNING → DONE/FAILED
   - Tracking de tasks ativas (Set de IDs)
   - Decisões de retry (baseado em PolicyEngine)

4. **Coordenação de Pausa/Retomada**:
   - Pausar sistema (CircuitBreaker OPEN)
   - Retomar sistema (CircuitBreaker RECOVERED)
   - Aguardar condições (browser não conectado)

#### O Que o Kernel NÃO Faz

❌ **Não executa tasks diretamente**:

```javascript
// ERRADO: Kernel executa Puppeteer
class KernelLoop {
  async step() {
    const task = queue.getNext();
    // ❌ NÃO: Kernel não sabe como automatizar LLM
    await page.type('#chat-input', task.prompt);
  }
}
```

❌ **Não detecta falhas técnicas**:

```javascript
// ERRADO: Kernel detecta causa de falha
class KernelLoop {
  async step() {
    // ❌ NÃO: Isso é responsabilidade do CircuitBreaker
    if (lastError.message.includes('connection refused')) {
      this.failureCause = 'NETWORK_ISSUE';
    }
  }
}
```

❌ **Não tenta reconectar browsers**:

```javascript
// ERRADO: Kernel tenta reconectar
class KernelLoop {
  async step() {
    if (!browserPool.isConnected()) {
      // ❌ NÃO: Isso é responsabilidade do BrowserPool/Recovery
      await browserPool.reconnect();
    }
  }
}
```

#### Princípios de Design

✅ **Decida e Delegue**:

```javascript
// CORRETO: Kernel decide quando, delega execução
class KernelLoop {
  async step() {
    // 1. Consulta políticas
    const shouldAllocate = await this.policyEngine.shouldAllocateNext();

    if (!shouldAllocate) {
      return; // Aguarda próximo ciclo
    }

    // 2. Delega execução para Driver (via NERV)
    const task = await this.queue.getNext();
    this.nerv.emit('TASK_ALLOCATED', task);
  }
}
```

✅ **Aguarde Pacientemente**:

```javascript
// CORRETO: Kernel aguarda sem erros
class KernelLoop {
  async step() {
    // Checa CircuitBreaker
    if (this._checkCircuitBreaker()) {
      // Sistema pausado - pula ciclo mas mantém loop
      this.state = KernelLoopState.PAUSED;
      this.telemetry.info('kernel_loop_paused');
      return; // Loop continua 20Hz
    }

    // ... resto do ciclo
  }
}
```

---

### 3. CIRCUITBREAKER (Infrastructure Layer)

**Definição Conceitual**:

> O CircuitBreaker é o **diagnosticador de causa**. Ele detecta POR QUE o sistema falhou (não apenas
> "falhou"). Ele NÃO tenta reconectar (isso é ConnectionRecovery), NÃO mede saúde contínua (isso é
> Monitor).

#### Responsabilidades Primárias

1. **Diagnóstico de Causa**:
   - Analisar contexto de falha (error message, stack trace)
   - Classificar em 7 causas: USER_CLOSED, TECHNICAL_CRASH, NETWORK_ISSUE, PROXY_FAILURE,
     OUT_OF_MEMORY, PROCESS_SUSPENDED, CHROME_RESTARTED
   - Inferir causa quando ambígua

2. **Decisões de Pausa**:
   - Decidir se sistema deve pausar (baseado em policy)
   - 3 estados: OPERATIONAL (3/3 healthy), DEGRADED (1-2/3), CIRCUIT_OPEN (0/3)
   - Policy por causa: shouldPause, autoRestart, maxRetries

3. **Tracking de Instâncias**:
   - Rastrear falhas por poolEntry.id
   - Contar falhas consecutivas
   - Calcular taxa de falha (failure rate)

4. **Emissão de Eventos**:
   - `CIRCUIT_STATE_CHANGED` (para Kernel)
   - `CRITICAL_FAILURE` (para Telemetry)
   - `RECOVERY_REGISTERED` (quando volta a funcionar)

#### O Que o CircuitBreaker NÃO Faz

❌ **Não tenta reconectar**:

```javascript
// ERRADO: CB tenta reconectar
class CircuitBreaker {
    registerFailure(poolEntryId, error) {
        this.state = 'CIRCUIT_OPEN';

        // ❌ NÃO: CB não tenta recovery
        await this._reconnectBrowser(poolEntryId);
    }
}
```

❌ **Não faz health checks periódicos**:

```javascript
// ERRADO: CB faz polling
class CircuitBreaker {
  async start() {
    // ❌ NÃO: Isso é responsabilidade do PeriodicHealthMonitor
    setInterval(() => {
      this._checkBrowserHealth();
    }, 30000);
  }
}
```

❌ **Não gerencia recursos**:

```javascript
// ERRADO: CB aloca/libera browsers
class CircuitBreaker {
  async recover() {
    // ❌ NÃO: Isso é responsabilidade do BrowserPool
    const newBrowser = await puppeteer.launch();
    this.pool.add(newBrowser);
  }
}
```

#### Princípios de Design

✅ **Diagnostique e Decida**:

```javascript
// CORRETO: CB diagnostica causa e decide pausa
class CircuitBreaker {
  registerFailure(poolEntryId, error, context = {}) {
    // 1. Diagnostica causa
    const cause = this._inferCause(error, context);

    // 2. Consulta policy
    const policy = this.policies[cause];

    // 3. Decide pausa
    if (policy.shouldPause) {
      this.state = 'CIRCUIT_OPEN';
      this._emitStateChange();
    }

    // NÃO tenta reconectar aqui (delega para Recovery)
  }
}
```

✅ **Infira Causa Inteligentemente**:

```javascript
// CORRETO: CB usa heurísticas para inferir causa
_inferCause(error, context) {
    // Usuário fechou deliberadamente
    if (error.message.includes('Target closed') &&
        context.browserStillRunning) {
        return 'USER_CLOSED';
    }

    // Chrome crashou
    if (error.message.includes('Session closed') &&
        !context.browserStillRunning) {
        return 'TECHNICAL_CRASH';
    }

    // Rede caiu
    if (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT')) {
        return 'NETWORK_ISSUE';
    }

    // ... outras 4 causas

    return 'UNKNOWN';
}
```

---

### 4. PERIODICHEALTHMONITOR (Infrastructure Layer)

**Definição Conceitual**:

> O Monitor é o **medidor de saúde contínua**. Ele verifica métricas, faz CDP checks, detecta
> degradação. Ele NÃO diagnostica causa (isso é CB), NÃO decide pausar sistema (isso é CB via
> Kernel).

#### Responsabilidades Primárias

1. **Health Checks Periódicos**:
   - Intervalo: 30s normal, 5s modo crítico
   - 3 tipos de checks:
     - CONNECTION: `browser.isConnected()`
     - PAGE_MEMORY: `page.metrics()` (memória, CPU)
     - PAGE_TARGETS: `browser.targets()` (páginas ativas)

2. **Classificação de Saúde**:
   - 5 estados: HEALTHY, WARNING, DEGRADED, CRITICAL, DISCONNECTED
   - Métricas: memória, latência CDP, targets count
   - Score agregado (0-100)

3. **Detecção de Degradação**:
   - Memória > 80% = WARNING
   - Memória > 90% = DEGRADED
   - isConnected=false = DISCONNECTED
   - Latência CDP > 5s = CRITICAL

4. **Trigger de Recovery**:
   - Emite `RECOVERY_NEEDED` quando DISCONNECTED
   - NÃO tenta reconectar (delega para ConnectionRecovery)
   - NÃO pausa Kernel (delega para CircuitBreaker)

#### O Que o Monitor NÃO Faz

❌ **Não diagnostica causa**:

```javascript
// ERRADO: Monitor diagnostica causa
class PeriodicHealthMonitor {
  _evaluateConnection(result) {
    if (!result.passed) {
      // ❌ NÃO: Diagnóstico de causa é responsabilidade do CB
      this.failureCause = 'NETWORK_ISSUE';
    }
  }
}
```

❌ **Não decide pausar sistema**:

```javascript
// ERRADO: Monitor pausa Kernel
class PeriodicHealthMonitor {
  async _checkHealth() {
    const health = await this._performChecks();

    if (health.status === 'CRITICAL') {
      // ❌ NÃO: Decisão de pausar é responsabilidade do Kernel (via CB)
      kernel.pause();
    }
  }
}
```

❌ **Não tenta recovery**:

```javascript
// ERRADO: Monitor tenta reconectar
class PeriodicHealthMonitor {
  async _checkHealth() {
    if (!browser.isConnected()) {
      // ❌ NÃO: Recovery é responsabilidade do ConnectionRecoveryStrategy
      await this._attemptReconnection();
    }
  }
}
```

#### Princípios de Design

✅ **Meça e Relate**:

```javascript
// CORRETO: Monitor mede e emite eventos
class PeriodicHealthMonitor {
  async _performHealthCheck() {
    const results = {
      checks: {
        CONNECTION: await this._checkConnection(),
        PAGE_MEMORY: await this._checkMemory(),
        PAGE_TARGETS: await this._checkTargets(),
      },
    };

    const status = this._calculateStatus(results);

    // Emite evento (quem consome decide ação)
    this.emit(MONITOR_EVENTS.STATUS_CHANGED, {
      oldStatus: this.currentStatus,
      newStatus: status,
      results,
    });

    // Trigger recovery se necessário (delega para outros)
    if (status === HEALTH_STATUS.DISCONNECTED) {
      this.emit(MONITOR_EVENTS.RECOVERY_NEEDED, results);
    }
  }
}
```

---

### 5. BROWSERPOOL (Infrastructure Layer)

**Definição Conceitual**:

> O BrowserPool é o **gestor de recursos**. Ele aloca/libera browsers e páginas, coordena CB +
> Monitor + Recovery. Ele NÃO executa tasks (isso é Driver), NÃO decide políticas (isso é Kernel).

#### Responsabilidades Primárias

1. **Gestão de Lifecycle**:
   - Criar browsers (launcher mode)
   - Conectar a browsers externos (external mode)
   - Detectar automaticamente (auto mode)
   - Liberar recursos (graceful shutdown)

2. **Allocation/Deallocation**:
   - `allocate(config)` → poolEntry
   - `release(poolEntryId)` → void
   - Tracking de páginas ativas
   - Cleanup de handles do Puppeteer

3. **Coordenação de Subsistemas**:
   - Inicializa CircuitBreaker
   - Inicializa PeriodicHealthMonitor
   - Inicializa ConnectionRecoveryStrategy
   - Bridge: coordena CB ↔ Monitor

4. **Health API**:
   - `isConnected()` → boolean
   - `getHealth()` → { status, metrics }
   - `validatePool()` → { valid, reason }

#### O Que o BrowserPool NÃO Faz

❌ **Não executa tasks**:

```javascript
// ERRADO: Pool executa tasks
class BrowserPoolManager {
  async executeTask(task) {
    const poolEntry = await this.allocate();
    // ❌ NÃO: Execução de task é responsabilidade do Driver
    await poolEntry.page.type('#input', task.prompt);
  }
}
```

❌ **Não decide políticas**:

```javascript
// ERRADO: Pool decide quando executar
class BrowserPoolManager {
  async allocate(config) {
    // ❌ NÃO: Decisões de alocação são responsabilidade do Kernel
    if (this.activeCount >= MAX_WORKERS) {
      throw new Error('Too many workers');
    }
  }
}
```

❌ **Não controla tempo**:

```javascript
// ERRADO: Pool tem próprio loop de tempo
class BrowserPoolManager {
  async start() {
    // ❌ NÃO: Tempo soberano é responsabilidade do Kernel
    setInterval(() => {
      this._checkAndAllocate();
    }, 1000);
  }
}
```

#### Princípios de Design

✅ **Gerencie Recursos**:

```javascript
// CORRETO: Pool gerencia lifecycle de browsers
class BrowserPoolManager {
  async allocate(config = {}) {
    // 1. Valida disponibilidade
    if (!this._hasAvailableSlots()) {
      throw new Error('No available slots');
    }

    // 2. Aloca recursos
    const poolEntry = await this._createOrReuseEntry(config);

    // 3. Retorna handle
    return poolEntry;
  }

  async release(poolEntryId) {
    // 1. Cleanup de páginas
    await this._cleanupPages(poolEntryId);

    // 2. Libera recursos
    this.pool.delete(poolEntryId);

    // 3. Emite evento
    this.emit('POOL_ENTRY_RELEASED', { poolEntryId });
  }
}
```

✅ **Coordene Subsistemas**:

```javascript
// CORRETO: Pool coordena CB ↔ Monitor
class BrowserPoolManager {
  _bridgeCircuitBreakerAndMonitor() {
    // Monitor detecta recovery → notifica CB
    this.healthMonitor.on(MONITOR_EVENTS.STATUS_CHANGED, data => {
      if (data.newStatus === HEALTH_STATUS.HEALTHY) {
        this.circuitBreaker.registerRecovery(poolEntryId);
      }
    });

    // Monitor detecta problema → notifica CB
    this.healthMonitor.on(MONITOR_EVENTS.CRITICAL_ISSUE, results => {
      const error = new Error('Connection lost');
      this.circuitBreaker.registerFailure(poolEntryId, error);
    });
  }
}
```

---

## 🔄 Fluxos de Decisão

### Fluxo 1: Usuário Fecha Chrome (USER_CLOSED)

```
T0: Sistema executando normalmente
    ├─> Kernel: ACTIVE (loop 20Hz)
    ├─> CircuitBreaker: OPERATIONAL (3/3)
    └─> Driver: Executando task 'task-001'

T1: Usuário clica X no Chrome
    └─> Chrome process termina

T2: Driver detecta durante execução (50ms depois)
    └─> page.isConnected() = false
    └─> Driver: Lança exception 'Target closed'
    └─> Task 'task-001': FAILED

T3: BrowserPool.allocate() falha no próximo allocate
    └─> browser.isConnected() = false
    └─> Emite: BROWSER_POOL_DISCONNECTED
    └─> CircuitBreaker.registerFailure(poolEntryId, error)

T4: CircuitBreaker diagnostica causa
    └─> Heurística: isConnected=false + browser process gone
    └─> Causa inferida: USER_CLOSED
    └─> Policy: { shouldPause: true, autoRestart: false }
    └─> Estado: OPERATIONAL → CIRCUIT_OPEN
    └─> Emite: CIRCUIT_STATE_CHANGED

T5: Kernel Loop próximo ciclo (50ms depois)
    └─> _checkCircuitBreaker() → shouldPauseSystem() = true
    └─> Estado: ACTIVE → PAUSED
    └─> Log: "⚠️ Sistema PAUSADO - Aguardando usuário reabrir Chrome"
    └─> ✅ NENHUMA TASK EXECUTADA (mas loop continua 20Hz)

T6-T60: Sistema aguarda pacientemente (3 minutos)
    └─> Kernel: Loop 20Hz, estado PAUSED
    └─> PeriodicHealthMonitor: Detecta CONNECTION_LOST
    └─> Emite: RECOVERY_NEEDED
    └─> ConnectionRecoveryStrategy: 5 tentativas falham (Chrome não aberto)
    └─> ✅ NENHUM ERRO lançado (logs informativos apenas)

T61: Usuário reabre Chrome (START-CHROME-SIMPLE.bat)
    └─> Chrome inicia na porta 9225
    └─> chromeProxyService detecta (health checks internos)

T90: PeriodicHealthMonitor próximo check (30s depois)
    └─> _attemptReconnection() → SUCCESS!
    ├─> puppeteer.connect('ws://localhost:9224') → newBrowser
    ├─> poolEntry.browser = newBrowser
    ├─> ✅ FIX: circuitBreaker.registerRecovery(poolEntry.id)
    └─> Emite: RECONNECTION_SUCCEEDED

T91: Bridge CircuitBreaker ↔ Monitor (automático)
    └─> Monitor emite: STATUS_CHANGED (→ HEALTHY)
    └─> Bridge captura evento
    └─> ✅ FIX: circuitBreaker.registerRecovery(poolEntry.id) (redundante mas safe)
    └─> CircuitBreaker: CIRCUIT_OPEN → OPERATIONAL
    └─> Emite: CIRCUIT_STATE_CHANGED

T92: Kernel Loop próximo ciclo (50ms depois)
    └─> _checkCircuitBreaker() → shouldPauseSystem() = FALSE
    └─> Estado: PAUSED → ACTIVE
    └─> ✅ TASKS RETOMAM AUTOMATICAMENTE
    └─> Log: "✅ Sistema ATIVO - Retomando execução de tasks"
```

**Decisões Tomadas**:

- **BrowserPool**: Detectou desconexão, notificou CB
- **CircuitBreaker**: Diagnosticou USER_CLOSED, decidiu pausar
- **Kernel**: Aplicou decisão (PAUSED), aguardou pacientemente
- **PeriodicHealthMonitor**: Detectou recovery, notificou CB (via Bridge)
- **Driver**: Não decidiu nada (apenas executou e relatou falha)

---

### Fluxo 2: Rate Limit do ChatGPT (BUSINESS PROBLEM)

```
T0: Driver executando task 'task-042'
    └─> Prompt: "Write a 5000-word essay..."
    └─> ChatGPTDriver.execute(task)

T1: Driver envia prompt
    └─> Digita no chat input (human typing simulation)
    └─> Clica "Send" button
    └─> Aguarda resposta (streaming incremental)

T2: ChatGPT retorna erro (30s depois)
    └─> Selector '.rate-limit-warning' presente
    └─> Mensagem: "You've reached your limit. Try again in 1 hour."

T3: Driver detecta problema de negócio
    └─> _isRateLimited(response) = true
    └─> ✅ Driver NÃO tenta retry (não é sua responsabilidade)
    └─> ✅ Driver NÃO pausa sistema (não é sua responsabilidade)
    └─> Driver retorna:
        {
            status: 'FAILED',
            error: 'RATE_LIMIT_HIT',
            businessProblem: true,
            retryAfter: 3600,
            recoverable: true
        }

T4: Kernel recebe resultado via NERV
    └─> TaskExecutionOrchestrator._handleTaskCompleted()
    └─> Identifica: businessProblem=true, recoverable=true
    └─> Delega para PolicyEngine

T5: PolicyEngine decide retry
    └─> Consulta policy: RATE_LIMIT_HIT
    └─> Policy: { maxRetries: 3, retryDelay: 3600, backoff: 'fixed' }
    └─> Decisão: RETRY (após 3600s)

T6: Kernel aplica decisão
    └─> TaskRuntime: task-042.status = PENDING (retry scheduled)
    └─> TaskRuntime: task-042.retryAfter = Date.now() + 3600000
    └─> ✅ Sistema continua executando OUTRAS tasks normalmente
    └─> Log: "Task 'task-042' agendada para retry em 1 hora (rate limit)"

T3600: Kernel detecta task pronta para retry (1 hora depois)
    └─> PolicyEngine: shouldRetry(task-042) = true
    └─> Aloca task novamente
    └─> Driver: Executa task-042 novamente
    └─> ✅ Sucesso (rate limit expirou)
```

**Decisões Tomadas**:

- **Driver**: Detectou RATE_LIMIT, relatou como businessProblem
- **Kernel/PolicyEngine**: Decidiu retry com delay de 1 hora
- **Sistema**: Continuou executando outras tasks (não pausou)
- **CircuitBreaker**: Não foi envolvido (não é falha técnica)

---

### Fluxo 3: Chrome Crash (TECHNICAL_CRASH)

```
T0: Sistema executando 3 tasks simultâneas
    ├─> task-010 (worker 1)
    ├─> task-011 (worker 2)
    └─> task-012 (worker 3)

T1: Chrome crash (OOM)
    └─> Chrome process killed pelo S.O.
    └─> browser.isConnected() = false (todas as 3 instâncias)

T2: Drivers detectam (50ms depois)
    └─> 3x page.isConnected() = false
    └─> 3x Driver: Lança exception 'Session closed'
    └─> 3x Task: FAILED

T3: BrowserPool detecta (100ms depois)
    └─> browser.isConnected() = false
    └─> Contexto: process.pid não existe mais
    └─> CircuitBreaker.registerFailure(poolEntry1, error, { browserGone: true })
    └─> CircuitBreaker.registerFailure(poolEntry2, error, { browserGone: true })
    └─> CircuitBreaker.registerFailure(poolEntry3, error, { browserGone: true })

T4: CircuitBreaker diagnostica causa
    └─> Heurística: browser.isConnected=false + process não existe
    └─> Causa inferida: TECHNICAL_CRASH
    └─> Policy: { shouldPause: true, autoRestart: true, maxRetries: 3 }
    └─> Estado: OPERATIONAL → CIRCUIT_OPEN (0/3 healthy)
    └─> Emite: CIRCUIT_STATE_CHANGED + CRITICAL_FAILURE

T5: Kernel Loop próximo ciclo (50ms depois)
    └─> _checkCircuitBreaker() → shouldPauseSystem() = true
    └─> Estado: ACTIVE → PAUSED
    └─> Log: "🚨 Sistema PAUSADO - Falha técnica detectada (TECHNICAL_CRASH)"

T6: ConnectionRecoveryStrategy ativa (500ms depois)
    └─> PeriodicHealthMonitor detectou CONNECTION_LOST
    └─> Emite: RECOVERY_NEEDED
    └─> ConnectionRecoveryStrategy._attemptReconnection()
    └─> Tentativa 1: FAIL (browser ainda não reiniciado)
    └─> Aguarda 2s (exponential backoff)

T8: autoRestart policy executa (2s depois)
    └─> CircuitBreaker policy: autoRestart=true
    └─> BrowserPool: Tenta lançar novo Chrome
    └─> puppeteer.launch() → novo Chrome na porta 9225

T10: ConnectionRecoveryStrategy tentativa 2 (2s depois)
    └─> puppeteer.connect('ws://localhost:9224') → SUCCESS!
    └─> poolEntry.browser = newBrowser
    └─> ✅ circuitBreaker.registerRecovery(poolEntry.id)
    └─> Emite: RECONNECTION_SUCCEEDED

T11: CircuitBreaker recebe recovery
    └─> Estado: CIRCUIT_OPEN → OPERATIONAL (3/3 healthy)
    └─> Emite: CIRCUIT_STATE_CHANGED

T12: Kernel Loop próximo ciclo (50ms depois)
    └─> _checkCircuitBreaker() → shouldPauseSystem() = FALSE
    └─> Estado: PAUSED → ACTIVE
    └─> ✅ TASKS RETOMAM AUTOMATICAMENTE
    └─> Log: "✅ Sistema ATIVO - Recovery completo após crash"

T13: Kernel reprocessa tasks falhadas
    └─> PolicyEngine: shouldRetry(task-010) = true (technical failure)
    └─> PolicyEngine: shouldRetry(task-011) = true
    └─> PolicyEngine: shouldRetry(task-012) = true
    └─> ✅ 3 tasks reagendadas para execução
```

**Decisões Tomadas**:

- **BrowserPool**: Detectou crash, forneceu contexto para CB
- **CircuitBreaker**: Diagnosticou TECHNICAL_CRASH, decidiu pausar + autoRestart
- **ConnectionRecoveryStrategy**: Executou 5 tentativas, sucesso na 2ª
- **Kernel**: Aplicou pausa, retomou após recovery, reagendou tasks falhadas
- **Driver**: Apenas relatou falha (não decidiu retry)

---

## ❌ Anti-Patterns: O Que Cada Componente NÃO Faz

### ❌ Driver NÃO Decide Retry

```javascript
// ❌ ERRADO: Driver decide retry
class ChatGPTDriver {
  async execute(task) {
    let attempts = 0;
    while (attempts < 3) {
      try {
        return await this._tryExecute(task);
      } catch (err) {
        attempts++;
        await sleep(1000 * attempts);
      }
    }
    throw new Error('Failed after 3 attempts');
  }
}

// ✅ CORRETO: Driver executa e relata
class ChatGPTDriver {
  async execute(task) {
    try {
      return await this._performAutomation(task);
    } catch (err) {
      return {
        status: 'FAILED',
        error: err.message,
        recoverable: this._isRecoverable(err),
      };
    }
  }
}
```

**Por Quê?** Retry é uma **decisão de política** (Kernel/PolicyEngine), não de execução (Driver). O
Driver não sabe o contexto completo do sistema (quantas tasks falharam, qual o SLA, quais são os
limites de rate).

---

### ❌ Kernel NÃO Executa Puppeteer

```javascript
// ❌ ERRADO: Kernel controla Puppeteer
class KernelLoop {
  async step() {
    const task = queue.getNext();
    const page = browserPool.allocate();

    // ❌ NÃO: Kernel não sabe como automatizar LLM
    await page.goto('https://chatgpt.com');
    await page.type('#chat-input', task.prompt);
    await page.click('button[type="submit"]');
  }
}

// ✅ CORRETO: Kernel delega para Driver
class KernelLoop {
  async step() {
    const task = queue.getNext();

    // Delega execução via NERV
    this.nerv.emit('TASK_ALLOCATED', {
      taskId: task.id,
      target: task.target,
      prompt: task.prompt,
    });
  }
}
```

**Por Quê?** Automação LLM é **conhecimento especializado** (Driver). O Kernel é genérico e deve
funcionar com qualquer driver (ChatGPT, Gemini, Claude, etc.).

---

### ❌ CircuitBreaker NÃO Tenta Reconectar

```javascript
// ❌ ERRADO: CB tenta reconectar
class CircuitBreaker {
  registerFailure(poolEntryId, error) {
    this.state = 'CIRCUIT_OPEN';

    // ❌ NÃO: Recovery é responsabilidade do ConnectionRecoveryStrategy
    setTimeout(() => {
      this._tryReconnect(poolEntryId);
    }, 5000);
  }
}

// ✅ CORRETO: CB diagnostica e emite eventos
class CircuitBreaker {
  registerFailure(poolEntryId, error, context = {}) {
    const cause = this._inferCause(error, context);
    const policy = this.policies[cause];

    if (policy.shouldPause) {
      this.state = 'CIRCUIT_OPEN';
      this._emitStateChange();
    }

    // NÃO tenta reconectar - delega para ConnectionRecoveryStrategy
  }
}
```

**Por Quê?** Recovery é uma **operação de infraestrutura** (ConnectionRecoveryStrategy), não de
diagnóstico (CircuitBreaker). Separação de concerns: CB diagnostica, Recovery executa.

---

### ❌ PeriodicHealthMonitor NÃO Pausa Kernel

```javascript
// ❌ ERRADO: Monitor pausa Kernel
class PeriodicHealthMonitor {
  async _checkHealth() {
    const health = await this._performChecks();

    if (health.status === 'CRITICAL') {
      // ❌ NÃO: Decisão de pausar é responsabilidade do Kernel (via CB)
      kernel.setState('PAUSED');
    }
  }
}

// ✅ CORRETO: Monitor emite eventos
class PeriodicHealthMonitor {
  async _checkHealth() {
    const health = await this._performChecks();

    // Emite evento (quem consome decide ação)
    this.emit(MONITOR_EVENTS.STATUS_CHANGED, {
      oldStatus: this.currentStatus,
      newStatus: health.status,
      results: health.checks,
    });

    // Se CRITICAL, emite evento para Bridge
    if (health.status === 'CRITICAL') {
      this.emit(MONITOR_EVENTS.CRITICAL_ISSUE, health.checks);
    }
  }
}
```

**Por Quê?** Pausa é uma **decisão de orquestração** (Kernel), não de monitoramento (Monitor). O
Monitor apenas mede e relata, o Kernel decide e aplica.

---

### ❌ BrowserPool NÃO Decide Políticas

```javascript
// ❌ ERRADO: Pool decide quando alocar
class BrowserPoolManager {
  async allocate(config) {
    // ❌ NÃO: Decisões de política são responsabilidade do Kernel
    if (this.activeCount >= MAX_WORKERS) {
      throw new Error('Too many workers - waiting 5s');
    }

    if (Date.now() - this.lastAllocation < 1000) {
      throw new Error('Rate limit - 1 allocation per second');
    }

    return this._createPoolEntry(config);
  }
}

// ✅ CORRETO: Pool apenas gerencia recursos
class BrowserPoolManager {
  async allocate(config) {
    // Valida disponibilidade técnica (não política)
    if (!this._hasAvailableSlots()) {
      throw new Error('No available slots');
    }

    // Aloca recursos
    return this._createPoolEntry(config);
  }
}
```

**Por Quê?** Políticas (MAX_WORKERS, rate limits) são **responsabilidade do Kernel/PolicyEngine**. O
Pool apenas gerencia o que foi decidido pela camada de orquestração.

---

## 📚 Casos de Uso Detalhados

### Caso 1: Conversação Longa Degrada LLM

**Situação**: Task executando há 2 horas, contexto com 50 mensagens. ChatGPT começa a ignorar
instruções antigas.

**Fluxo**:

1. **Driver detecta** (durante execução):

   ```javascript
   async execute(task) {
       const response = await this._collectResponse();

       // Detecta problema de negócio
       if (this._isConversationTooLong(response)) {
           return {
               status: 'COMPLETED',
               data: response,
               needsNewConversation: true,
               businessProblem: true,
               reason: 'Context window saturated'
           };
       }
   }
   ```

2. **Kernel recebe resultado**:

   ```javascript
   // TaskExecutionOrchestrator
   _handleTaskCompleted(payload, correlationId) {
       if (payload.needsNewConversation) {
           // Decisão: Criar nova conversation
           this._createNewConversation(task);
       }
   }
   ```

3. **MissionManager processa** (se task faz parte de missão):

   ```javascript
   // MissionManager
   _handleTaskCompleted(result) {
       if (result.needsNewConversation) {
           // Salva contexto atual
           this._saveConversationSnapshot(result.data);

           // Gera nova task com nova conversation
           const newTask = this._createTaskWithNewConversation({
               previousContext: result.data.summary,
               continueFromStep: result.currentStep
           });

           this.kernel.submitTask(newTask);
       }
   }
   ```

**Responsabilidades Executadas**:

- ✅ **Driver**: Detectou problema de negócio (conversação longa)
- ✅ **Kernel**: Decidiu ação (criar nova conversation)
- ✅ **MissionManager**: Coordenou transição de contexto
- ✅ **CircuitBreaker**: Não foi envolvido (não é falha técnica)
- ✅ **Monitor**: Não foi envolvido (não é problema de saúde)

---

### Caso 2: Usuário Não Abre Chrome ao Iniciar Sistema

**Situação**: Sistema iniciado via `make start`, mas usuário ainda não rodou
`START-CHROME-SIMPLE.bat`.

**Fluxo**:

```
T0: Sistema inicia (PM2)
    ├─> main.js: Boot sequence (6 fases)
    ├─> Kernel: Inicializado (estado INACTIVE)
    ├─> BrowserPool: Inicializado (modo AUTO)
    └─> NERV: Conectado

T1: Kernel.start() chamado
    └─> KernelLoop.start()
    └─> Estado: INACTIVE → ACTIVE
    └─> Loop: 20Hz iniciado

T2: Kernel Loop primeiro ciclo (50ms depois)
    └─> _checkCircuitBreaker()
    └─> CircuitBreaker: Estado = OPERATIONAL (nenhuma falha registrada ainda)
    └─> shouldPauseSystem() = FALSE
    └─> Continua ciclo normalmente

T3: PolicyEngine decide alocar primeira task
    └─> Queue tem task 'task-001' PENDING
    └─> shouldAllocateNext() = TRUE
    └─> Kernel tenta alocar task

T4: BrowserPool.allocate() falha
    └─> puppeteer.connect('ws://localhost:9224') → FAIL
    └─> Error: 'ECONNREFUSED' (proxy não consegue conectar no Chrome)
    └─> Contexto: { browserNotStarted: true }

T5: CircuitBreaker registra falha
    └─> registerFailure(poolEntry.id, error, context)
    └─> Causa inferida: USER_NOT_OPENED_CHROME (heurística: ECONNREFUSED + primeira tentativa)
    └─> Policy: { shouldPause: true, autoRestart: false }
    └─> Estado: OPERATIONAL → CIRCUIT_OPEN
    └─> Emite: CIRCUIT_STATE_CHANGED

T6: Kernel Loop próximo ciclo (50ms depois)
    └─> _checkCircuitBreaker() → shouldPauseSystem() = TRUE
    └─> Estado: ACTIVE → PAUSED
    └─> Log: "⏸️ Sistema PAUSADO - Aguardando usuário abrir Chrome"
    └─> Log: "💡 Execute: START-CHROME-SIMPLE.bat"
    └─> ✅ Loop continua 20Hz (mas não executa tasks)

T7-T600: Sistema aguarda pacientemente (10 minutos)
    └─> Kernel: Loop 20Hz, estado PAUSED
    └─> PeriodicHealthMonitor: Tenta health check a cada 30s → FAIL
    └─> ConnectionRecoveryStrategy: 5 tentativas a cada 30s → FAIL
    └─> ✅ NENHUM ERRO lançado (logs INFO apenas)
    └─> ✅ Sistema estável, aguardando ação do usuário

T601: Usuário abre Chrome
    └─> Executa: START-CHROME-SIMPLE.bat
    └─> Chrome inicia na porta 9225
    └─> chromeProxyService detecta (health checks internos)

T630: PeriodicHealthMonitor próximo check (30s depois)
    └─> _attemptReconnection() → SUCCESS!
    └─> puppeteer.connect('ws://localhost:9224') → newBrowser
    └─> ✅ circuitBreaker.registerRecovery(poolEntry.id)
    └─> Emite: RECONNECTION_SUCCEEDED

T631: CircuitBreaker recebe recovery
    └─> Estado: CIRCUIT_OPEN → OPERATIONAL
    └─> Emite: CIRCUIT_STATE_CHANGED

T632: Kernel Loop próximo ciclo (50ms depois)
    └─> _checkCircuitBreaker() → shouldPauseSystem() = FALSE
    └─> Estado: PAUSED → ACTIVE
    └─> ✅ TASKS RETOMAM AUTOMATICAMENTE
    └─> Log: "✅ Sistema ATIVO - Chrome conectado"
```

**Responsabilidades Executadas**:

- ✅ **BrowserPool**: Tentou conectar, falhou, reportou erro
- ✅ **CircuitBreaker**: Diagnosticou USER_NOT_OPENED_CHROME, decidiu pausar
- ✅ **Kernel**: Aplicou pausa, aguardou pacientemente (10 minutos sem erros)
- ✅ **PeriodicHealthMonitor**: Tentou reconectar periodicamente
- ✅ **ConnectionRecoveryStrategy**: Tentou 5 tentativas por ciclo
- ✅ **Sistema**: Retomou automaticamente assim que Chrome ficou disponível

**Garantias Satisfeitas**:

- ✅ Sistema não crashou
- ✅ Nenhum erro lançado (apenas logs informativos)
- ✅ Usuário pode demorar quanto quiser para abrir Chrome
- ✅ Retomada 100% automática (zero intervenção manual)

---

## 📋 Sumário de Responsabilidades

### Matriz Final de Responsabilidades

| Componente                | Faz (✅)                                                                                                                                    | Não Faz (❌)                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Driver**                | ✅ Automação Puppeteer<br>✅ Detecta problemas de negócio<br>✅ Aguarda página/LLM prontos<br>✅ Coleta respostas<br>✅ Relata resultado    | ❌ Decide retry<br>❌ Gerencia conexões<br>❌ Pausa sistema<br>❌ Controla tempo<br>❌ Define políticas                   |
| **Kernel**                | ✅ Decide quando executar<br>✅ Aplica políticas (MAX_WORKERS)<br>✅ Aloca tasks<br>✅ Controla tempo (20Hz)<br>✅ Coordena pausa/retomada  | ❌ Executa Puppeteer<br>❌ Detecta falhas técnicas<br>❌ Diagnostica causa<br>❌ Tenta reconectar<br>❌ Faz health checks |
| **CircuitBreaker**        | ✅ Diagnostica CAUSA de falha<br>✅ Decide pausar sistema<br>✅ Aplica políticas por causa<br>✅ Tracking de instâncias<br>✅ Emite eventos | ❌ Tenta reconectar<br>❌ Faz health checks<br>❌ Gerencia recursos<br>❌ Executa tasks<br>❌ Define políticas de retry   |
| **PeriodicHealthMonitor** | ✅ Mede saúde contínua<br>✅ Faz CDP checks<br>✅ Classifica status<br>✅ Detecta degradação<br>✅ Emite eventos                            | ❌ Diagnostica causa<br>❌ Decide pausar<br>❌ Tenta reconectar<br>❌ Executa tasks<br>❌ Gerencia recursos               |
| **BrowserPool**           | ✅ Aloca/libera recursos<br>✅ Coordena CB+Monitor<br>✅ Gerencia lifecycle<br>✅ Cleanup de handles<br>✅ Health API                       | ❌ Executa tasks<br>❌ Decide políticas<br>❌ Controla tempo<br>❌ Faz automação LLM<br>❌ Diagnostica causa              |

---

## 🎯 Conclusão

### Princípios Fundamentais

1. **Separação de Concerns**: Cada componente tem UMA responsabilidade primária
2. **Decisão vs. Execução**: Quem decide NÃO executa, quem executa NÃO decide
3. **Detecção vs. Ação**: Quem detecta NÃO age, quem age NÃO detecta (usa eventos)
4. **Taxonomia Clara**: 4 tipos de eventos (Falhas, Ações do Usuário, Problemas de Negócio,
   Condições de Espera)
5. **Aguardar Pacientemente**: Sistema NUNCA lança erro para ações normais do usuário

### Validação de Arquitetura

Para validar se um componente está bem implementado, pergunte:

1. **Driver**: "Este código controla Puppeteer OU decide política?"
   - ✅ Se controla Puppeteer → correto
   - ❌ Se decide política → mover para Kernel

2. **Kernel**: "Este código decide quando OU executa Puppeteer?"
   - ✅ Se decide quando → correto
   - ❌ Se executa Puppeteer → mover para Driver

3. **CircuitBreaker**: "Este código diagnostica causa OU tenta reconectar?"
   - ✅ Se diagnostica causa → correto
   - ❌ Se tenta reconectar → mover para ConnectionRecoveryStrategy

4. **PeriodicHealthMonitor**: "Este código mede saúde OU decide pausar?"
   - ✅ Se mede saúde → correto
   - ❌ Se decide pausar → mover para CircuitBreaker (via Kernel)

5. **BrowserPool**: "Este código gerencia recursos OU executa tasks?"
   - ✅ Se gerencia recursos → correto
   - ❌ Se executa tasks → mover para Driver

---

**Versão**: 1.0 **Status**: 🟢 PRODUCTION DEFINITION **Próxima Revisão**: Após implementação de
LLM-as-judge validation
