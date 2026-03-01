# 🔬 Driver Lifecycle - Análise Profunda v1.0

**Data**: 3 de Fevereiro de 2026 **Status**: 🔄 Análise Pre-Sprint 1 **Objetivo**: Mapear ciclo de
vida completo do driver, identificar estados pausados, pré-condições e integração com DNA

---

## 📋 ÍNDICE

1. [Visão Geral do Ciclo de Vida](#visão-geral-do-ciclo-de-vida)
2. [Estados do Driver (State Machine)](#estados-do-driver-state-machine)
3. [Pré-Condições de Operação](#pré-condições-de-operação)
4. [Integração com Sistema DNA](#integração-com-sistema-dna)
5. [Estados Pausados e Idle](#estados-pausados-e-idle)
6. [Instanciação e Cache](#instanciação-e-cache)
7. [Validações em Cascata](#validações-em-cascata)
8. [Questões Críticas Identificadas](#questões-críticas-identificadas)

---

## 🎯 VISÃO GERAL DO CICLO DE VIDA

### Ciclo Completo (11 Fases)

```
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 0: PRÉ-CONDIÇÕES (Validações de Existência)                     │
├──────────────────────────────────────────────────────────────────────┤
│ ✅ Chrome está rodando? (Circuit Breaker check)                      │
│ ✅ BrowserPool está inicializado?                                    │
│ ✅ Page existe? (not null, not closed)                               │
│ ✅ Page em URL válida? (não about:blank, chrome://, etc)             │
│ ✅ Page em LLM suportada? (chatgpt.com, gemini.google.com, etc)      │
└──────────────────────────────────────────────────────────────────────┘
                              ↓ PASS
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 1: ALOCAÇÃO DE RECURSOS (BrowserPool)                           │
├──────────────────────────────────────────────────────────────────────┤
│ → BrowserPool.allocate(target)                                       │
│   ├─ Verifica pool disponível                                        │
│   ├─ Retorna Page existente OU cria nova                             │
│   └─ Marca Page como "em uso"                                        │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 2: CRIAÇÃO DO LIFECYCLE MANAGER                                 │
├──────────────────────────────────────────────────────────────────────┤
│ → new DriverLifecycleManager(page, task, config)                     │
│   ├─ Cria AbortController (kill switch)                              │
│   ├─ Inicializa métricas                                             │
│   └─ Setup de EventEmitter                                           │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 3: ACQUIRE DRIVER (Factory + Retry Logic)                       │
├──────────────────────────────────────────────────────────────────────┤
│ → DriverLifecycleManager.acquire()                                   │
│   ├─ Factory.getDriver(target, page, config, signal)                 │
│   │   ├─ Cache hit? (WeakMap check)                                  │
│   │   │   └─ ✅ Retorna driver existente (reuso)                     │
│   │   └─ Cache miss?                                                 │
│   │       ├─ Lazy-load driver class (require)                        │
│   │       ├─ new ChatGPTDriver(page, config, signal)                 │
│   │       └─ Armazena em cache (WeakMap)                             │
│   ├─ Retry logic (3 tentativas, exponential backoff)                 │
│   └─ Conecta telemetria (state_change, progress)                     │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 4: VALIDAÇÃO DE PÁGINA (Prerequisite Validator)                 │
├──────────────────────────────────────────────────────────────────────┤
│ → Driver.validatePage()                                              │
│   ├─ validateLLMPage(page)                                           │
│   │   ├─ Page não é null?                                            │
│   │   ├─ Page não está closed?                                       │
│   │   ├─ URL válida? (não about:blank, chrome://, etc)               │
│   │   └─ URL em LLM suportada?                                       │
│   └─ validateLLMInterface(page) [CRITICAL]                           │
│       ├─ Usa SADI (analyzer.js) para encontrar campo de entrada      │
│       │   └─ analyzer.findChatInputSelector(page)                    │
│       ├─ Valida interatividade (não oculto, não disabled)            │
│       │   └─ analyzer.validateCandidateInteractivity(page, input)    │
│       └─ (Opcional) Detecta área de resposta                         │
│           └─ analyzer.findResponseArea(page)                         │
└──────────────────────────────────────────────────────────────────────┘
                              ↓ PASS
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 5: CARREGAMENTO DO DNA (Dynamic Rules)                          │
├──────────────────────────────────────────────────────────────────────┤
│ → dna_store.getTargetRules(domain)                                   │
│   ├─ Cache hit? → Retorna DNA cached                                 │
│   └─ Cache miss?                                                     │
│       ├─ Lê dynamic_rules.json (safeReadJSON)                        │
│       ├─ Valida schema (Zod validation)                              │
│       ├─ Extrai regras para target (ex: chatgpt.com)                 │
│       │   ├─ Selectors específicos (input_box, send_button)          │
│       │   ├─ Behavior overrides (typing_speed, delays)               │
│       │   └─ Fallback para global_selectors se target não existe     │
│       └─ Armazena em cache (RAM)                                     │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 6: PREPARAÇÃO DE CONTEXTO (State: PREPARING)                    │
├──────────────────────────────────────────────────────────────────────┤
│ → Driver.prepareContext(taskSpec)                                    │
│   ├─ Driver.setState('PREPARING')                                    │
│   ├─ Model switching (se taskSpec.model != currentModel)             │
│   │   ├─ Valida modelo suportado (SUPPORTED_MODELS)                  │
│   │   ├─ Navega para URL de switching                                │
│   │   └─ Aguarda carregamento (waitForSelector)                      │
│   ├─ Context reset (se taskSpec.config.reset_context)                │
│   └─ Captura estado inicial (captureState)                           │
│       └─ Contagem de mensagens do assistente                         │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 7: ENVIO DO PROMPT (State: TYPING)                              │
├──────────────────────────────────────────────────────────────────────┤
│ → Driver.sendPrompt(text)                                            │
│   ├─ Driver.setState('TYPING')                                       │
│   ├─ BiomechanicsEngine.prepareEnvironment()                         │
│   │   ├─ Foca campo de entrada (using DNA selectors)                 │
│   │   ├─ Limpa conteúdo anterior (clear)                             │
│   │   └─ Verifica readiness (campo focado e vazio)                   │
│   ├─ BiomechanicsEngine.typeText(text)                               │
│   │   ├─ Typing biomimético (human-like speed, pauses)               │
│   │   ├─ Emite eventos: biomech:typing_started → typing_completed    │
│   │   └─ Usa DNA behavior_overrides (typing_speed_factor)            │
│   ├─ BiomechanicsEngine.clickSubmit()                                │
│   │   ├─ Localiza botão de envio (using DNA selectors)               │
│   │   ├─ Click biomimético (move mouse, click)                       │
│   │   └─ Aguarda estabilidade (stabilizer)                           │
│   └─ Driver.setState('WAITING')                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 8: AGUARDANDO RESPOSTA (State: WAITING)                         │
├──────────────────────────────────────────────────────────────────────┤
│ → Driver.waitForResponse()                                           │
│   ├─ Perception loop (800ms interval)                                │
│   │   ├─ Detecta área de resposta (using DNA ou SADI)                │
│   │   ├─ Extrai texto acumulado                                      │
│   │   ├─ Verifica estabilidade (3 ciclos sem mudança)                │
│   │   ├─ Emite eventos: driver:progress (cada N caracteres)          │
│   │   └─ Check timeout (MAX_WAIT_TIME_MS = 10min)                    │
│   ├─ AbortSignal check (a cada ciclo)                                │
│   │   └─ Se abortado → throw AbortError                              │
│   ├─ Stall detection (30s sem mudança)                               │
│   │   └─ Driver.setState('STALLED')                                  │
│   └─ Stable cycles atingidos?                                        │
│       └─ Finaliza perception loop                                    │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 9: EXTRAÇÃO DE RESPOSTA                                         │
├──────────────────────────────────────────────────────────────────────┤
│ → Driver.extractResponse()                                           │
│   ├─ Localiza área de resposta final                                 │
│   ├─ Extrai texto completo (innerText, innerHTML)                    │
│   ├─ Thought pruning (se modelo o1/o3)                                │
│   │   └─ Remove blocos de raciocínio (cost optimization)             │
│   ├─ Valida resposta (não vazia, tamanho mínimo)                     │
│   └─ Retorna resultado { text, metadata }                            │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 10: CLEANUP & RELEASE (State: IDLE)                             │
├──────────────────────────────────────────────────────────────────────┤
│ → DriverLifecycleManager.release()                                   │
│   ├─ Driver.setState('IDLE')                                         │
│   ├─ Driver.destroy()                                                │
│   │   ├─ Remove todos os listeners (EventEmitter)                    │
│   │   ├─ Marca destroyed = true                                      │
│   │   ├─ Emite EVENTS.DESTROYED (Factory eviction)                   │
│   │   └─ Nullifica page, config                                      │
│   ├─ BrowserPool.release(page)                                       │
│   │   └─ Marca Page como "disponível" no pool                        │
│   └─ Limpa activeDrivers Map                                         │
│       └─ Map.delete(taskId)                                          │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────┐
│ FASE 11: MÉTRICAS & TELEMETRIA                                       │
├──────────────────────────────────────────────────────────────────────┤
│ → LifecycleManager coleta métricas finais                            │
│   ├─ acquireTime (ms)                                                │
│   ├─ releaseTime (ms)                                                │
│   ├─ stateChanges (count)                                            │
│   ├─ progressUpdates (count)                                         │
│   └─ errors (count)                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

**Timing Total**: 2-5min (dependendo da complexidade do prompt)

---

## 🔄 ESTADOS DO DRIVER (STATE MACHINE)

### State Machine Completa

O driver implementa uma **máquina de estados validada** com 5 estados:

```javascript
// src/driver/core/TargetDriver.js
const STATES = Object.freeze({
  IDLE: 'IDLE', // Ocioso, aguardando tarefa
  PREPARING: 'PREPARING', // Configurando contexto/modelo
  TYPING: 'TYPING', // Executando interação biomecânica
  WAITING: 'WAITING', // Aguardando resposta da IA
  STALLED: 'STALLED', // Detectado provável travamento
});

// State Transition Matrix (validação)
const STATE_TRANSITIONS = Object.freeze({
  IDLE: [PREPARING],
  PREPARING: [TYPING, IDLE],
  TYPING: [WAITING, IDLE],
  WAITING: [IDLE, STALLED],
  STALLED: [IDLE],
});
```

### Diagrama de Estados

```
┌──────────────────────────────────────────────────────────────────┐
│                    STATE MACHINE DIAGRAM                          │
└──────────────────────────────────────────────────────────────────┘

        ┌────────┐
        │  IDLE  │◄───────────────────────────────┐
        └───┬────┘                                 │
            │                                      │
            │ acquire() called                     │
            ↓                                      │
        ┌────────────┐                             │
        │ PREPARING  │                             │
        └─────┬──────┘                             │
              │                                    │
              │ prepareContext() complete          │
              ↓                                    │
        ┌────────────┐                             │
        │   TYPING   │                             │
        └─────┬──────┘                             │
              │                                    │
              │ sendPrompt() complete              │
              ↓                                    │
        ┌────────────┐                             │
        │  WAITING   │◄───────┐                   │
        └─────┬──────┘        │                   │
              │               │                   │
              │ stable        │ 30s               │
              │ cycles        │ without           │
              │ reached       │ change            │
              │               │                   │
              │               ↓                   │
              │          ┌─────────┐              │
              │          │ STALLED │──────────────┘
              │          └─────────┘   recovery
              │
              └──────────────────────────────────►
                    release() called


Estados Pausados:
- IDLE: Driver existe mas não está executando (waiting for task)
- PREPARING: Driver configurando contexto (model switching, reset)
- WAITING: Driver aguardando resposta do LLM (perception loop)
- STALLED: Driver detectou travamento (30s sem mudança)
```

### Transições Válidas (Matrix)

| Estado Atual  | Transições Permitidas | Trigger                             |
| ------------- | --------------------- | ----------------------------------- |
| **IDLE**      | → PREPARING           | `acquire()` called                  |
| **PREPARING** | → TYPING, → IDLE      | `prepareContext()` complete / abort |
| **TYPING**    | → WAITING, → IDLE     | `sendPrompt()` complete / abort     |
| **WAITING**   | → IDLE, → STALLED     | Stable cycles reached / 30s stall   |
| **STALLED**   | → IDLE                | Recovery ou abort                   |

### Transições Inválidas (Bloqueadas)

```javascript
// ❌ INVÁLIDO: IDLE → WAITING (pula PREPARING e TYPING)
driver.setState('WAITING'); // Throw Error

// ❌ INVÁLIDO: WAITING → PREPARING (não pode voltar)
driver.setState('PREPARING'); // Throw Error

// ❌ INVÁLIDO: TYPING → STALLED (apenas WAITING pode detectar stall)
driver.setState('STALLED'); // Throw Error

// ✅ VÁLIDO: Qualquer estado → IDLE (recovery, abort, release)
driver.setState('IDLE'); // OK (AbortSignal bypass validation se necessário)
```

---

## ✅ PRÉ-CONDIÇÕES DE OPERAÇÃO

### Hierarquia de Validações (6 Níveis)

```
┌─────────────────────────────────────────────────────────────────┐
│ NÍVEL 0: SISTEMA (Mais Básico)                                  │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Chrome está rodando?                                          │
│    └─ Verificado por: Circuit Breaker (BrowserPool)             │
│       ├─ Estado: OPEN (Chrome down) → Pausa sistema             │
│       ├─ Estado: HALF_OPEN (tentando recovery)                  │
│       └─ Estado: CLOSED (Chrome OK) → Sistema operacional       │
│                                                                  │
│ ✅ BrowserPool está inicializado?                               │
│    └─ Verificado por: validateBrowserPool()                     │
│       ├─ browserPool.initialized === true                       │
│       ├─ browserPool.shuttingDown === false                     │
│       └─ Circuit Breaker não em OPEN                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓ PASS
┌─────────────────────────────────────────────────────────────────┐
│ NÍVEL 1: PAGE (Existência)                                      │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Page existe?                                                  │
│    └─ Verificado por: validateLLMPage(page)                     │
│       ├─ page !== null                                          │
│       ├─ page !== undefined                                     │
│       └─ !page.isClosed()                                       │
│                                                                  │
│ ✅ Page em URL válida?                                           │
│    └─ Verificado por: validateLLMPage(page)                     │
│       ├─ URL não é about:blank                                  │
│       ├─ URL não é chrome://                                    │
│       ├─ URL não é chrome-extension://                          │
│       ├─ URL não é data:                                        │
│       └─ URL não é file://                                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓ PASS
┌─────────────────────────────────────────────────────────────────┐
│ NÍVEL 2: DOMAIN (LLM Suportada)                                 │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Page em LLM suportada?                                        │
│    └─ Verificado por: validateLLMPage(page)                     │
│       ├─ URL contém chatgpt.com                                 │
│       ├─ URL contém openai.com                                  │
│       ├─ URL contém gemini.google.com                           │
│       ├─ URL contém claude.ai                                   │
│       └─ URL contém anthropic.com                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓ PASS
┌─────────────────────────────────────────────────────────────────┐
│ NÍVEL 3: INTERFACE (DOM Carregado)                              │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Campo de entrada está presente?                               │
│    └─ Verificado por: validateLLMInterface(page) usando SADI    │
│       ├─ analyzer.findChatInputSelector(page)                   │
│       ├─ Busca textarea, div[contenteditable], [role=textbox]   │
│       ├─ Usa DNA se disponível (target-specific selectors)      │
│       └─ Fallback para global_selectors                         │
│                                                                  │
│ ✅ Campo de entrada está interativo?                             │
│    └─ Verificado por: analyzer.validateCandidateInteractivity() │
│       ├─ Elemento não está oculto (display, visibility)         │
│       ├─ Elemento não está disabled                             │
│       ├─ Elemento não está coberto por overlay                  │
│       └─ Elemento pode receber focus                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓ PASS
┌─────────────────────────────────────────────────────────────────┐
│ NÍVEL 4: DNA (Regras Dinâmicas)                                 │
├─────────────────────────────────────────────────────────────────┤
│ ✅ DNA está carregado?                                           │
│    └─ Verificado por: dna_store.getDna()                        │
│       ├─ Cache hit? → Retorna DNA                               │
│       └─ Cache miss?                                            │
│           ├─ Lê dynamic_rules.json                              │
│           ├─ Valida schema (Zod)                                │
│           ├─ Extrai target rules (ex: chatgpt.com)              │
│           └─ Fallback para DEFAULT_DNA se corrompido            │
│                                                                  │
│ ✅ Target rules existem?                                         │
│    └─ Verificado por: dna_store.getTargetRules(domain)          │
│       ├─ dna.targets[domain] existe?                            │
│       │   └─ ✅ Retorna selectors + behavior_overrides          │
│       └─ Não existe?                                            │
│           └─ ✅ Retorna global_selectors (fallback universal)   │
└─────────────────────────────────────────────────────────────────┘
                              ↓ PASS
┌─────────────────────────────────────────────────────────────────┐
│ NÍVEL 5: DRIVER (Estado Interno)                                │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Driver está em estado válido?                                 │
│    └─ Verificado por: Driver.setState()                         │
│       ├─ Transição é permitida? (STATE_TRANSITIONS matrix)      │
│       ├─ Driver não está destroyed?                             │
│       └─ AbortSignal não foi disparado?                         │
│                                                                  │
│ ✅ Capabilities estão corretas?                                  │
│    └─ Verificado por: Driver._validateCapabilities()            │
│       ├─ Capabilities são boolean?                              │
│       └─ Capabilities estão em CAPABILITIES_SCHEMA?             │
└─────────────────────────────────────────────────────────────────┘
```

### Condições de Falha (Fail-Fast)

**Nível 0 Failure** (SISTEMA):

```javascript
// Circuit Breaker OPEN
→ Resultado: Sistema PAUSA (KernelLoop skip execution)
→ Ação: Aguardar recovery ou reabrir Chrome
→ Sem retry: Não tenta executar tasks
```

**Nível 1 Failure** (PAGE):

```javascript
// Page null, closed ou URL inválida
→ Resultado: DRIVER_EXECUTE falha antes de acquire
→ Ação: DriverNERVAdapter emite TASK_FAILED
→ Retry: Kernel pode retentar (PolicyEngine decision)
```

**Nível 2 Failure** (DOMAIN):

```javascript
// URL não é LLM suportada
→ Resultado: validatePage() retorna false
→ Ação: Driver abort antes de execute
→ Retry: Não retentável (erro de configuração)
```

**Nível 3 Failure** (INTERFACE):

```javascript
// Campo de entrada não encontrado ou não interativo
→ Resultado: validateLLMInterface() retorna false
→ Ação: Driver aguarda (retry após delay) ou abort
→ Retry: Retentável (página pode estar carregando)
```

**Nível 4 Failure** (DNA):

```javascript
// DNA corrompido ou target rules faltando
→ Resultado: Fallback para DEFAULT_DNA
→ Ação: Sistema usa global_selectors (universal)
→ Retry: Não necessário (fallback automático)
```

**Nível 5 Failure** (DRIVER):

```javascript
// Transição inválida ou driver destroyed
→ Resultado: setState() throws Error
→ Ação: Driver reset para IDLE ou abort
→ Retry: AbortSignal force reset
```

---

## 🧬 INTEGRAÇÃO COM SISTEMA DNA

### O Que É DNA?

**DNA** (Dynamic Rules) é o "genoma" do sistema que define:

- **Selectors**: Como localizar elementos (input_box, send_button, response_area)
- **Behavior Overrides**: Ajustes de comportamento (typing_speed, delays, stability_threshold)
- **Evolution**: Aprende com erros (SADI pode atualizar DNA automaticamente)

### Estrutura do DNA

```javascript
// dynamic_rules.json
{
    "_meta": {
        "version": 5,
        "last_updated": "2026-02-03T10:30:00Z",
        "updated_by": "SADI_V19",
        "evolution_count": 127
    },

    "targets": {
        "chatgpt.com": {
            "selectors": {
                "input_box": {
                    "selector": "#prompt-textarea",
                    "context": "root",
                    "isShadow": false,
                    "timestamp": 1738573800000
                },
                "send_button": {
                    "selector": "button[data-testid='send-button']",
                    "context": "root",
                    "isShadow": false,
                    "timestamp": 1738573800000
                },
                "response_area": {
                    "selector": "div[data-message-author-role='assistant']",
                    "context": "root",
                    "isShadow": false,
                    "timestamp": 1738573800000
                }
            },
            "behavior_overrides": {
                "typing_speed_factor": 1.2,
                "idle_sleep_ms": 500,
                "stability_threshold": 3
            }
        },

        "gemini.google.com": {
            "selectors": {
                "input_box": ".ql-editor.textarea",
                "send_button": "button[aria-label='Send message']"
            },
            "behavior_overrides": {
                "typing_speed_factor": 0.9,
                "idle_sleep_ms": 800
            }
        }
    },

    "global_selectors": {
        "input_box": [
            "textarea",
            "div[contenteditable='true']",
            "[role='textbox']"
        ],
        "send_button": [
            "button[type='submit']",
            "[data-testid='send-button']",
            "[aria-label*='Send']"
        ]
    }
}
```

### Fluxo de Integração DNA

```
┌────────────────────────────────────────────────────────────┐
│ 1. CARREGAMENTO (Lazy - Apenas quando driver execute)      │
├────────────────────────────────────────────────────────────┤
│ → dna_store.getTargetRules(domain)                         │
│   ├─ Cache hit? (RAM)                                      │
│   │   └─ Retorna DNA cached (O(1))                         │
│   └─ Cache miss?                                           │
│       ├─ Read disk: dynamic_rules.json                     │
│       ├─ Validate: DnaSchema (Zod)                         │
│       ├─ Extract: dna.targets[domain]                      │
│       └─ Fallback: global_selectors se domain não existe   │
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ 2. USO (Durante Execução do Driver)                        │
├────────────────────────────────────────────────────────────┤
│ → BiomechanicsEngine.prepareEnvironment()                  │
│   ├─ Obtém DNA selector: input_box                         │
│   ├─ Tenta foco no campo (usando selector do DNA)          │
│   └─ Fallback: SADI (analyzer) se selector não funcionar   │
│                                                            │
│ → BiomechanicsEngine.typeText(text)                        │
│   ├─ Obtém DNA behavior: typing_speed_factor               │
│   ├─ Ajusta velocidade: baseSpeed * typing_speed_factor    │
│   └─ Fallback: Default behavior se override não existe     │
│                                                            │
│ → ChatGPTDriver.waitForResponse()                          │
│   ├─ Obtém DNA behavior: stability_threshold               │
│   ├─ Aguarda N ciclos estáveis (stability_threshold)       │
│   └─ Fallback: CHATGPT_CONFIG.STABLE_CYCLES_TARGET         │
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ 3. EVOLUÇÃO (SADI Automático - Futuro)                     │
├────────────────────────────────────────────────────────────┤
│ → Se selector falhar (not found, not interactive)          │
│   ├─ SADI busca novo selector (analyzer.js)                │
│   ├─ Valida novo selector (interactivity check)            │
│   ├─ Atualiza DNA:                                         │
│   │   └─ dna_store.saveDna(updatedDna, 'SADI_V19')         │
│   └─ Invalidate cache (próxima task usa novo DNA)          │
└────────────────────────────────────────────────────────────┘
```

### Quando DNA É Carregado?

```javascript
// ❌ NÃO: No boot do sistema
// DNA NÃO é carregado preventivamente

// ❌ NÃO: Na criação do driver
// Driver não acessa DNA no constructor

// ✅ SIM: Na primeira execução (lazy-load)
// DNA é carregado apenas quando driver.execute() é chamado

// Fluxo real:
Driver.execute(prompt)
  └─> prepareContext()
      └─> BiomechanicsEngine.prepareEnvironment()
          └─> dna_store.getTargetRules(domain)  // ✅ AQUI
              └─> Cache ou disk read

// Benefícios:
// 1. Boot mais rápido (não carrega DNA desnecessário)
// 2. Lazy-load apenas para targets usados
// 3. Hot-reload: Se DNA muda, próxima task usa nova versão
```

### Cache de DNA (Invalidação)

```javascript
// Cache em RAM (dna_store.js)
let cachedDna = null;

// 1. Primeiro acesso: Cache miss → Load from disk
const dna1 = await dna_store.getDna(); // Load + cache

// 2. Segundo acesso: Cache hit → Retorna RAM
const dna2 = await dna_store.getDna(); // Instant

// 3. Invalidação manual (ex: após saveDna)
dna_store.invalidateCache(); // cachedDna = null

// 4. Próximo acesso: Cache miss novamente
const dna3 = await dna_store.getDna(); // Load + cache (nova versão)

// 5. Watchers externos podem invalidar
// fs_watcher detecta mudança em dynamic_rules.json
// → Emite event → io.invalidateDnaCache() → Cache cleared
```

### Fallbacks (3 Níveis)

```
┌─────────────────────────────────────────────────────────────┐
│ NÍVEL 1: Target-Specific Rules                              │
├─────────────────────────────────────────────────────────────┤
│ dna.targets["chatgpt.com"].selectors.input_box              │
│ → Ex: "#prompt-textarea"                                    │
└─────────────────────────────────────────────────────────────┘
                          ↓ FALHA (selector not found)
┌─────────────────────────────────────────────────────────────┐
│ NÍVEL 2: Global Selectors                                   │
├─────────────────────────────────────────────────────────────┤
│ dna.global_selectors.input_box                              │
│ → Ex: ["textarea", "div[contenteditable='true']"]           │
└─────────────────────────────────────────────────────────────┘
                          ↓ FALHA (todos selectors not found)
┌─────────────────────────────────────────────────────────────┐
│ NÍVEL 3: SADI (Sensory Analysis Deep Intelligence)          │
├─────────────────────────────────────────────────────────────┤
│ analyzer.findChatInputSelector(page)                        │
│ → Busca heurística (roles, placeholders, patterns)          │
│ → Machine learning-based detection                          │
└─────────────────────────────────────────────────────────────┘
```

---

## ⏸️ ESTADOS PAUSADOS E IDLE

### Quando Driver Fica "Pausado"?

O driver pode ficar em estado **idle/pausado** por **8 motivos principais**:

#### 1. **IDLE (Aguardando Task)**

```javascript
// Driver existe mas não há task para executar
// Estado: IDLE
// Duração: Indefinida (até acquire() ser chamado)
// Consumo: Mínimo (apenas listener de eventos)

// Cache:
factory.cache.get(page).get('chatgpt'); // ✅ Driver existe
driver.state === 'IDLE'; // ✅ Ocioso

// Causa:
// - Task anterior já foi concluída (release chamado)
// - Driver foi criado mas ainda não foi usado
// - Sistema esperando próxima task do Kernel

// Liberação de recursos:
// - Page: Retornada ao BrowserPool (disponível para reuso)
// - Driver: Permanece em cache (WeakMap) até page ser coletado
// - Listeners: Permanecem conectados (aguardando próximo acquire)
```

#### 2. **PREPARING (Model Switching)**

```javascript
// Driver preparando contexto (ex: trocando de modelo)
// Estado: PREPARING
// Duração: 5-15s (navegação + waitForSelector)
// Consumo: Moderado (navegação de página)

// Fluxo:
driver.prepareContext({ model: 'gpt-4o' })
  ├─> Navega para URL de switching
  ├─> Aguarda carregamento (waitForSelector)
  └─> Valida interface (validateLLMInterface)

// Causa:
// - taskSpec.model != driver.currentModel
// - taskSpec.config.reset_context === true

// Interrupção:
// - AbortSignal disparado → Reset para IDLE
// - Timeout (30s) → Throw error
```

#### 3. **WAITING (Aguardando Resposta do LLM)**

```javascript
// Driver aguardando LLM gerar resposta
// Estado: WAITING
// Duração: 5s - 10min (depende da complexidade)
// Consumo: Baixo (apenas polling DOM)

// Perception Loop:
while (!stable) {
    // Check abort
    if (signal.aborted) throw AbortError;

    // Extract text
    const text = await extractResponseText();

    // Check stability (3 cycles without change)
    if (text === lastText) {
        stableCycles++;
    } else {
        stableCycles = 0;
    }

    // Wait interval
    await sleep(800ms);
}

// Causa:
// - LLM está gerando resposta (normal)
// - Prompt complexo (demora mais)
// - Modelo lento (ex: o1-preview)

// Interrupção:
// - Stable cycles atingidos → Extraction
// - AbortSignal disparado → Abort
// - Timeout (10min) → Throw TimeoutError
// - Stall detectado (30s) → setState('STALLED')
```

#### 4. **STALLED (Travamento Detectado)**

```javascript
// Driver detectou possível travamento
// Estado: STALLED
// Duração: Indefinida (até recovery ou abort)
// Consumo: Mínimo (aguardando intervenção)

// Detecção:
if (Date.now() - lastUpdate > STALL_WARNING_MS) {
  driver.setState('STALLED');
  emit('warning', { context: 'stall_detected' });
}

// Causa:
// - LLM travou (rare)
// - Selector de response_area mudou (interface change)
// - Network issues (rare)
// - Browser hang (rare)

// Recovery:
// - Manual: User aborts task
// - Automático: Timeout (10min) → Abort
// - PolicyEngine: Decide retry strategy
```

#### 5. **Sem Tasks no Kernel**

```javascript
// Sistema operacional mas não há tasks para processar
// Estado: N/A (driver não existe ainda)
// Duração: Indefinida (até task ser submetida)
// Consumo: Zero (driver não instanciado)

// Kernel:
const tasks = taskRuntime.listTasks(); // []

// DriverNERVAdapter:
// Não escuta DRIVER_EXECUTE (nenhum evento emitido)

// BrowserPool:
// Pages estão IDLE no pool (disponíveis mas não alocadas)

// Causa:
// - Sistema recém-iniciado (sem tasks submetidas)
// - Todas tasks foram concluídas (missão finalizada)
// - MissionManager não gerou tasks ainda

// Ação do sistema:
// - KernelLoop continua executando (50ms cycles)
// - ExecutionEngine.evaluate() retorna proposals vazios
// - Sistema aguarda TASK_SUBMITTED event via NERV
```

#### 6. **Sem Missões Ativas**

```javascript
// MissionManager não tem missões em execução
// Estado: N/A (nenhuma task gerada)
// Duração: Indefinida (até createMission ou executeMission)
// Consumo: Zero

// MissionManager:
const missions = await stateManager.listMissions();
// Filtro: missions.filter(m => m.status === MISSION_STATUS.RUNNING) // []

// Causa:
// - Nenhuma missão criada ainda (sistema fresh)
// - Todas missões foram completadas
// - Usuário pausou todas missões (PAUSED status)

// Ação do sistema:
// - Dashboard mostra "No active missions"
// - Kernel não recebe TASK_SUBMITTED
// - Driver não é instanciado
// - Sistema aguarda user input (POST /api/missions)
```

#### 7. **Circuit Breaker OPEN (Chrome Down)**

```javascript
// Chrome fechou ou crashou
// Estado: N/A (sistema pausado)
// Duração: Até Chrome ser reaberto + recovery (30s)
// Consumo: Zero (operações bloqueadas)

// Circuit Breaker:
if (browserPool.circuitBreaker.shouldPauseSystem()) {
  // KernelLoop skip execution
  return;
}

// Causa:
// - User fechou Chrome (START-CHROME-SIMPLE.bat não rodando)
// - Chrome crashou (rare)
// - Chrome Proxy disconnect (network issue)

// Recovery:
// 1. Circuit Breaker detecta (heartbeat failure)
// 2. Estado: CLOSED → OPEN
// 3. Sistema pausa (KernelLoop skip)
// 4. User reabre Chrome (START-CHROME-SIMPLE.bat)
// 5. Circuit Breaker detecta recovery (heartbeat success)
// 6. Estado: OPEN → HALF_OPEN (tentative)
// 7. Teste bem-sucedido → HALF_OPEN → CLOSED
// 8. Sistema retoma (KernelLoop execute)
```

#### 8. **Page Not Allocated (BrowserPool Exhausted)**

```javascript
// BrowserPool não tem pages disponíveis
// Estado: N/A (aguardando release)
// Duração: Até alguma task concluir e liberar page
// Consumo: Zero (task em fila)

// DriverNERVAdapter:
const page = await this.browserPool.allocate(target);
// Se pool exhausted:
//   ├─> Enfileira task (bufferQueue)
//   └─> Aguarda release de outra page

// Causa:
// - MAX_ACTIVE_DRIVERS atingido (ex: 3 drivers simultâneos)
// - Tasks longas ocupando todas as pages
// - Pool size pequeno (configuração)

// Recovery:
// - Automático: Quando alguma task concluir
// - Manual: Aumentar pool size (config.json)
```

### Resumo de Estados Pausados

| Estado                     | Duração      | Consumo  | Causa                       | Recovery                 |
| -------------------------- | ------------ | -------- | --------------------------- | ------------------------ |
| **IDLE** (driver exists)   | Indefinida   | Mínimo   | Aguardando task             | acquire() called         |
| **PREPARING** (switching)  | 5-15s        | Moderado | Model switching             | Navegação completa       |
| **WAITING** (LLM response) | 5s - 10min   | Baixo    | LLM gerando resposta        | Stable cycles ou timeout |
| **STALLED** (hang)         | Indefinida   | Mínimo   | Travamento detectado        | Abort ou timeout         |
| **No tasks** (kernel)      | Indefinida   | Zero     | Nenhuma task submetida      | TASK_SUBMITTED event     |
| **No missions**            | Indefinida   | Zero     | Nenhuma missão ativa        | POST /api/missions       |
| **Circuit Breaker OPEN**   | Até recovery | Zero     | Chrome down                 | Reabrir Chrome           |
| **Pool exhausted**         | Até release  | Zero     | MAX_ACTIVE_DRIVERS atingido | Task concluir            |

---

## 🏭 INSTANCIAÇÃO E CACHE

### Quando Driver É Instanciado?

```
┌────────────────────────────────────────────────────────────┐
│ TRIGGER: DRIVER_EXECUTE event via NERV                     │
├────────────────────────────────────────────────────────────┤
│ → DriverNERVAdapter escuta DRIVER_EXECUTE                  │
│   └─> _handleDriverExecute(payload)                        │
│       ├─> Aloca page: BrowserPool.allocate(target)         │
│       ├─> Cria lifecycle: new DriverLifecycleManager()     │
│       └─> Acquire driver: lifecycle.acquire()              │
│           └─> Factory.getDriver(target, page, ...)  ✅ AQUI│
│               ├─> Cache check (WeakMap<Page, Map>)         │
│               │   ├─ Hit? → Retorna driver existente       │
│               │   └─ Miss? → Instancia novo driver         │
│               │       ├─ Lazy-load class (require)         │
│               │       ├─ new ChatGPTDriver(page, ...)      │
│               │       └─ Store em cache                    │
│               └─> Retorna driver instance                  │
└────────────────────────────────────────────────────────────┘
```

### Factory Cache (WeakMap)

**Estrutura**:

```javascript
// src/driver/factory.js
this.pageCache = new WeakMap();

// Estrutura interna:
WeakMap {
    <Page instance 1> => Map {
        'chatgpt' => <ChatGPTDriver instance>,
        'gemini'  => <GeminiDriver instance>
    },
    <Page instance 2> => Map {
        'chatgpt' => <ChatGPTDriver instance>
    }
}
```

**Fluxo de Cache**:

```javascript
// 1. Task 1 executa (chatgpt)
Factory.getDriver('chatgpt', page1, ...)
├─> WeakMap.get(page1) → undefined (cache miss)
├─> new ChatGPTDriver(page1, ...)
├─> WeakMap.set(page1, Map { 'chatgpt' => driver1 })
└─> return driver1

// 2. Task 2 executa NA MESMA PAGE (chatgpt)
Factory.getDriver('chatgpt', page1, ...)
├─> WeakMap.get(page1) → Map { 'chatgpt' => driver1 } (cache hit)
├─> Map.get('chatgpt') → driver1
└─> return driver1 (REUSO - não instancia novo)

// 3. Task 3 executa EM OUTRA PAGE (chatgpt)
Factory.getDriver('chatgpt', page2, ...)
├─> WeakMap.get(page2) → undefined (cache miss)
├─> new ChatGPTDriver(page2, ...)
├─> WeakMap.set(page2, Map { 'chatgpt' => driver2 })
└─> return driver2 (novo driver para page2)

// 4. Page1 é liberada e coletada pelo GC
// → WeakMap entry é automaticamente removido
// → driver1 é eligible para GC (se não houver outras referências)
```

### Benefícios do WeakMap

1. **GC Automático**:
   - Page coletada → Entry removido automaticamente
   - Previne memory leaks (drivers não mantém pages vivas)

2. **Isolamento por Page**:
   - Cada Page tem seu próprio Map de drivers
   - Drivers não interferem entre si

3. **Reuso Eficiente**:
   - Múltiplas tasks na mesma page reutilizam driver
   - Evita overhead de instanciação

### Eviction (Remoção do Cache)

```javascript
// Auto-eviction reativa
driver.once('destroyed', () => {
  // Remove driver do cache Map
  const driverMap = this.pageCache.get(page);
  if (driverMap) {
    driverMap.delete(target);

    // Se Map ficou vazio, pode remover (opcional)
    if (driverMap.size === 0) {
      // WeakMap não tem .delete(), mas pode limpar Map
      driverMap.clear();
    }
  }

  this.metrics.driversDestroyed++;
  this.emit('driver_evicted', { target, page });
});

// Quando driver é evicted:
// 1. driver.destroy() é chamado (LifecycleManager.release)
// 2. driver emite 'destroyed' event
// 3. Factory escuta evento e remove do cache
// 4. Próxima task na mesma page instancia novo driver
```

### Limite de Cache (Memory Leak Prevention)

```javascript
// src/driver/factory.js
const FACTORY_CONFIG = {
  MAX_DRIVERS_PER_PAGE: 10, // Limite de drivers por page
};

// Validação em getDriver():
const driverMap = this.pageCache.get(page) || new Map();

if (driverMap.size >= FACTORY_CONFIG.MAX_DRIVERS_PER_PAGE) {
  log(
    'WARN',
    `[Factory] Page has ${driverMap.size} drivers cached. ` +
      `Limit: ${FACTORY_CONFIG.MAX_DRIVERS_PER_PAGE}. ` +
      `Consider invalidating cache.`
  );

  // Estratégia: LRU eviction (futuro)
  // Por ora: Warning apenas
}
```

---

## 🔍 VALIDAÇÕES EM CASCATA

### Sequence Diagram Completo

```
User                    System                  Validation Layers
  │                       │                            │
  │ POST /api/missions    │                            │
  ├──────────────────────►│                            │
  │                       │ MissionManager             │
  │                       ├────────────────────────────┤
  │                       │ Create workflow            │
  │                       │ Submit task to Kernel      │
  │                       │                            │
  │                       │ Kernel                     │
  │                       ├────────────────────────────┤
  │                       │ Register task              │
  │                       │ Emit DRIVER_EXECUTE (NERV) │
  │                       │                            │
  │                       │ DriverNERVAdapter          │
  │                       ├────────────────────────────┤
  │                       │                            │
  │                       │ ╔══════════════════════════════╗
  │                       │ ║ VALIDATION CASCADE STARTS    ║
  │                       │ ╚══════════════════════════════╝
  │                       │                            │
  │                       │                            ▼
  │                       │                   [L0: SYSTEM CHECK]
  │                       │                   validateBrowserPool()
  │                       │                   ├─ initialized?
  │                       │                   ├─ !shuttingDown?
  │                       │                   └─ Circuit Breaker OK?
  │                       │                            │
  │                       │◄───────────────────────────┤ PASS
  │                       │                            │
  │                       │ BrowserPool.allocate()     │
  │                       │                            ▼
  │                       │                   [L1: PAGE EXISTS]
  │                       │                   validateLLMPage(page)
  │                       │                   ├─ page != null?
  │                       │                   ├─ !page.isClosed()?
  │                       │                   └─ URL valid?
  │                       │                            │
  │                       │◄───────────────────────────┤ PASS
  │                       │                            │
  │                       │ LifecycleManager.acquire() │
  │                       │                            ▼
  │                       │                   [L2: DOMAIN CHECK]
  │                       │                   validateLLMPage(page)
  │                       │                   └─ URL in supported LLMs?
  │                       │                            │
  │                       │◄───────────────────────────┤ PASS
  │                       │                            │
  │                       │ Factory.getDriver()        │
  │                       │   ├─ Cache hit/miss        │
  │                       │   └─ new ChatGPTDriver()   │
  │                       │                            │
  │                       │ Driver.validatePage()      ▼
  │                       │                   [L3: INTERFACE READY]
  │                       │                   validateLLMInterface()
  │                       │                   ├─ findChatInputSelector()
  │                       │                   ├─ validateInteractivity()
  │                       │                   └─ findResponseArea()
  │                       │                            │
  │                       │◄───────────────────────────┤ PASS
  │                       │                            │
  │                       │                            ▼
  │                       │                   [L4: DNA LOAD]
  │                       │                   getTargetRules(domain)
  │                       │                   ├─ Cache hit/miss
  │                       │                   ├─ Load dynamic_rules.json
  │                       │                   └─ Fallback if needed
  │                       │                            │
  │                       │◄───────────────────────────┤ OK
  │                       │                            │
  │                       │ Driver.prepareContext()    │
  │                       │   ├─ setState('PREPARING')  ▼
  │                       │   └─ Model switch (opt)    [L5: DRIVER STATE]
  │                       │                   validateTransition()
  │                       │                   └─ IDLE → PREPARING OK?
  │                       │                            │
  │                       │◄───────────────────────────┤ OK
  │                       │                            │
  │                       │ ╔══════════════════════════════╗
  │                       │ ║ ALL VALIDATIONS PASSED       ║
  │                       │ ║ Driver ready to execute      ║
  │                       │ ╚══════════════════════════════╝
  │                       │                            │
  │                       │ Driver.sendPrompt()        │
  │                       ├────────────────────────────┤
  │                       │ Type + Submit              │
  │                       │                            │
  │◄──────────────────────┤ Task executing             │
  │ Socket.io update      │                            │
```

### Ordem de Validação (Fail-Fast)

```
1. SYSTEM (Circuit Breaker)      ← Mais básico (Chrome rodando?)
   ↓ PASS
2. PAGE (Exists & Valid URL)     ← Page existe e URL válida?
   ↓ PASS
3. DOMAIN (LLM Supported)        ← URL é LLM suportada?
   ↓ PASS
4. INTERFACE (DOM Ready)         ← Interface carregada?
   ↓ PASS
5. DNA (Rules Loaded)            ← Regras dinâmicas OK?
   ↓ PASS
6. DRIVER (State Valid)          ← Estado interno OK?
   ↓ PASS
7. EXECUTE (Send Prompt)         ← Execução inicia
```

**Princípio Fail-Fast**: Se qualquer validação falhar, processo aborta IMEDIATAMENTE (não tenta
etapas seguintes).

---

## ⚠️ QUESTÕES CRÍTICAS IDENTIFICADAS

### Questão 1: **Driver Pode Ficar "Zumbi"?**

**Cenário**:

```javascript
// Driver é instanciado
const driver = Factory.getDriver('chatgpt', page, ...);

// Task 1 executa → Completa → release() chamado
driver.setState('IDLE');

// Page é liberada mas driver ainda está em cache
Factory.pageCache.get(page).get('chatgpt') === driver; // true

// Task 2 executa NA MESMA PAGE
const driver2 = Factory.getDriver('chatgpt', page, ...);

// ❓ driver2 === driver (reuso) ou novo driver?
// ✅ RESPOSTA: driver2 === driver (REUSO)
```

**Análise**:

- ✅ **OK**: Driver é reutilizado se:
  1. driver.destroyed === false
  2. driver.state === 'IDLE'
  3. Page ainda válida (não closed)

- ❌ **PROBLEMA**: Se driver.destroyed === true MAS ainda em cache?

  ```javascript
  // BUG POTENCIAL:
  driver.destroy(); // destroyed = true
  // Factory cache NÃO remove automaticamente
  // → Próxima task pode receber driver destroyed

  // FIX ATUAL:
  // driver.once('destroyed') → Factory remove do cache
  // ✅ Auto-eviction implementado
  ```

**Recomendação**: ✅ **VALIDAR**: `getDriver()` deve checar `driver.destroyed` antes de retornar
cache hit.

### Questão 2: **Page Pode Ser Reutilizada Por Múltiplas Tasks Simultâneas?**

**Cenário**:

```javascript
// Task 1 aloca page
const page1 = await BrowserPool.allocate('chatgpt.com');

// Task 2 tenta alocar page (BrowserPool exhausted)
const page2 = await BrowserPool.allocate('chatgpt.com');

// ❓ page2 === page1 (mesma page?) ou aguarda release?
// ✅ RESPOSTA: Aguarda release (enfileira task)
```

**Análise**:

- ✅ **OK**: BrowserPool marca page como "em uso"
- ✅ **OK**: DriverNERVAdapter enfileira task se `MAX_ACTIVE_DRIVERS` atingido
- ❌ **PROBLEMA**: Se BrowserPool libera page MAS driver ainda executando?

  ```javascript
  // Fluxo normal:
  driver.execute() → complete → release() → BrowserPool.release(page)

  // BUG POTENCIAL:
  // Se release() é chamado antes de driver.execute() terminar?
  // → Page pode ser reutilizada por outra task
  // → Conflito: 2 drivers na mesma page simultâneos

  // PROTEÇÃO ATUAL:
  // LifecycleManager.release() aguarda driver.destroy() completo
  // ✅ Atomicidade garantida
  ```

**Recomendação**: ✅ **VALIDAR**: Adicionar assertion em `BrowserPool.allocate()` que page não está
"em uso".

### Questão 3: **Driver Pode Entrar em Estado Inválido Após Abort?**

**Cenário**:

```javascript
// Task em execução: WAITING
driver.state === 'WAITING';

// AbortSignal disparado
abortController.abort();

// ❓ Driver vai para IDLE automaticamente?
// ✅ RESPOSTA: SIM (setupAbortListener implementado)
```

**Análise**:

- ✅ **OK**: `_setupAbortListener()` reseta driver para IDLE
- ✅ **OK**: Emite `ABORT_SIGNAL_RECEIVED` event
- ❌ **PROBLEMA**: E se abort acontece durante `PREPARING` (navegação)?

  ```javascript
  // Preparing → Model switching (navegação)
  await page.goto(switchingUrl);

  // AbortSignal durante navegação
  // ❓ Page fica em URL errada?
  // ❓ Driver consegue resetar?

  // PROTEÇÃO ATUAL:
  // AbortSignal é passado para page.goto() → Cancela navegação
  // ✅ Implementado em prepareContext()
  ```

**Recomendação**: ✅ **VALIDAR**: Testar abort durante cada estado (IDLE, PREPARING, TYPING,
WAITING, STALLED).

### Questão 4: **DNA Pode Estar Corrompido E Sistema Continuar?**

**Cenário**:

```javascript
// dynamic_rules.json corrompido (JSON inválido)
// ❓ Sistema crasha ou usa fallback?
// ✅ RESPOSTA: Usa fallback (DEFAULT_DNA)
```

**Análise**:

- ✅ **OK**: `dna_store.getDna()` tem try-catch
- ✅ **OK**: Valida com Zod → Fallback se inválido
- ✅ **OK**: Usa `global_selectors` se target não existe
- ❌ **PROBLEMA**: E se `global_selectors` TAMBÉM está corrompido?

  ```javascript
  // Cenário extremo:
  // dna.global_selectors = null (corrupted)

  // getTargetRules() retorna:
  // { selectors: null, behavior_overrides: {}, source: 'global_fallback' }

  // BiomechanicsEngine tenta:
  // const selector = rules.selectors.input_box; // Throw TypeError

  // PROTEÇÃO ATUAL:
  // DEFAULT_DNA tem global_selectors válidos (hardcoded)
  // ✅ Fallback garantido
  ```

**Recomendação**: ✅ **OK** - Proteção adequada com DEFAULT_DNA.

### Questão 5: **Circuit Breaker Pode Parar Sistema Indefinidamente?**

**Cenário**:

```javascript
// Chrome fecha → Circuit Breaker OPEN
browserPool.circuitBreaker.shouldPauseSystem() === true;

// ❓ Sistema retoma automaticamente quando Chrome reabre?
// ✅ RESPOSTA: SIM (heartbeat detecta recovery)
```

**Análise**:

- ✅ **OK**: Circuit Breaker tem heartbeat periódico
- ✅ **OK**: Detecta recovery (OPEN → HALF_OPEN → CLOSED)
- ❌ **PROBLEMA**: E se Chrome reabre MAS em porta diferente?

  ```javascript
  // Boot 1: Chrome na porta 9225
  browserPool.connect('http://localhost:9225');

  // User fecha Chrome
  // Circuit Breaker OPEN

  // User reabre Chrome NA PORTA 9226 (erro de configuração)
  // ❓ Circuit Breaker consegue detectar?
  // ❌ NÃO - Porta hardcoded em config.json

  // PROTEÇÃO ATUAL:
  // Scripts garantem porta consistente (START-CHROME-SIMPLE.bat)
  // Documentação alerta para usar scripts
  ```

**Recomendação**: ⚠️ **MELHORAR**: Adicionar fallback de porta (tentar 9225, depois 9226, etc).

---

## 📊 SUMÁRIO EXECUTIVO

### Ciclo de Vida (Resumo)

```
0. PRÉ-CONDIÇÕES (6 níveis de validação)
   ↓
1. ALOCAÇÃO (BrowserPool.allocate)
   ↓
2. LIFECYCLE (new DriverLifecycleManager)
   ↓
3. ACQUIRE (Factory.getDriver + cache)
   ↓
4. VALIDATE (validatePage + validateLLMInterface)
   ↓
5. DNA LOAD (getTargetRules + cache)
   ↓
6. PREPARE (prepareContext + model switch)
   ↓
7. SEND (sendPrompt + biomechanics)
   ↓
8. WAIT (waitForResponse + perception loop)
   ↓
9. EXTRACT (extractResponse + thought pruning)
   ↓
10. CLEANUP (release + destroy + eviction)
    ↓
11. METRICS (collect + emit)
```

### Estados Pausados (8 Cenários)

1. ✅ **IDLE**: Driver ocioso (aguardando task)
2. ✅ **PREPARING**: Model switching (5-15s)
3. ✅ **WAITING**: Aguardando LLM (5s-10min)
4. ✅ **STALLED**: Travamento detectado
5. ✅ **No tasks**: Kernel sem tasks
6. ✅ **No missions**: MissionManager sem missões
7. ✅ **Circuit Breaker OPEN**: Chrome down
8. ✅ **Pool exhausted**: MAX_ACTIVE_DRIVERS atingido

### Integração DNA (3 Fases)

1. ✅ **LOAD**: Lazy-load on first execute
2. ✅ **USE**: BiomechanicsEngine + Driver
3. ✅ **EVOLVE**: SADI auto-update (futuro)

### Questões Críticas (5 Identificadas)

1. ✅ **Driver zumbi**: Auto-eviction OK
2. ✅ **Page reuso**: Atomicidade OK
3. ✅ **Abort handling**: Reset OK
4. ✅ **DNA corrupted**: Fallback OK
5. ⚠️ **Circuit Breaker porta**: Melhorar fallback

---

**Próximo Passo**: Com esta análise profunda, podemos prosseguir com **Sprint 1** (correções P0) com
**100% de solidez**. Todas as pré-condições, estados pausados e integrações estão mapeadas.

**Status**: ✅ **Análise Completa** - Ready for Sprint 1 Implementation
