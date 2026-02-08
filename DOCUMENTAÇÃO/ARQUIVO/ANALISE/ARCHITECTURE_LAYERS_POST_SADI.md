# Arquitetura de Camadas - Pós-Migração SADI v3.0

```
┌─────────────────────────────────────────────────────────────────┐
│                         APPLICATION                              │
│  (Orquestração de alto nível, rotas API, dashboard)             │
│  - src/server/                                                   │
│  - src/mission/                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↑ usa
┌─────────────────────────────────────────────────────────────────┐
│                          DRIVER                                  │
│  (Execução física: controle de browser, interação com LLMs)     │
│  - src/driver/targets/ChatGPTDriver.js  ──┐                     │
│  - src/driver/modules/input_resolver.js   ├─→ usa @shared/sadi  │
│  - src/driver/modules/biomechanics.js    ─┘                     │
│  - src/driver/core/BaseDriver.js                                │
│  - src/driver/factory.js                                        │
│  - src/driver/nerv_adapter/                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↑ usa
┌─────────────────────────────────────────────────────────────────┐
│                          KERNEL                                  │
│  (Motor de execução: loop principal, políticas, recovery)       │
│  - src/kernel/execution_engine.js                               │
│  - src/kernel/kernel_loop/                                      │
│  - src/kernel/policy_engine.js                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↑ usa
┌─────────────────────────────────────────────────────────────────┐
│                          CORE                                    │
│  (Fundações: config, logger, validators, schemas)               │
│  - src/core/validators/prerequisite_validator.js ──┐            │
│  - src/core/config.js                               ├─→ usa @shared/sadi
│  - src/core/logger.js                              │            │
│  - src/core/schemas.js                             │            │
└────────────────────────────────────────────────────┼────────────┘
                              ↑ usa                   │
┌─────────────────────────────────────────────────────┼────────────┐
│                       SHARED (Utilitários)          │            │
│  Bibliotecas standalone, sem dependências de negócio│            │
│                                                      │            │
│  ┌────────────────────────────────────────────────┐ │            │
│  │  SADI (Sensory Analysis Deep Intelligence)    │←┘            │
│  │  src/shared/sadi/analyzer.js                  │              │
│  │  - findChatInputSelector()                    │              │
│  │  - findSendButtonSelector()                   │              │
│  │  - findResponseArea()                         │              │
│  │  - validateCandidateInteractivity()           │              │
│  │  - findFrameByPath()                          │              │
│  │                                                │              │
│  │  Depende apenas de: @core/i18n                │              │
│  │  Não depende de: driver, kernel, server       │              │
│  └────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              ↑ usa
┌─────────────────────────────────────────────────────────────────┐
│                          INFRA                                   │
│  (Infraestrutura: browser pool, proxy, locks, io)               │
│  - src/infra/browser_pool/                                      │
│  - src/infra/proxy/                                             │
│  - src/infra/ConnectionOrchestrator.js                          │
│  - src/infra/io.js                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Fluxo de Validação Atualizado

```
NERV Event: DRIVER_EXECUTE_TASK
       ↓
DriverNERVAdapter._handleDriverCommand()
       ↓
[VALIDAÇÃO CAMADA CORE]
prerequisite_validator.validateBrowserPool()
   ├─ Circuit Breaker OK?
   └─ Browser Pool healthy?
       ↓
prerequisite_validator.validateLLMInterface()
   ├─ require('@shared/sadi/analyzer')        ← SHARED LAYER
   ├─ analyzer.findChatInputSelector(page)
   └─ analyzer.validateCandidateInteractivity()
       ↓
[VALIDAÇÃO OK - PROSSEGUE]
       ↓
DriverLifecycleManager.execute(task)
   ├─ Adquire page do Browser Pool
   └─ Factory.getDriver(target, page, config, signal)
       ↓
[EXECUÇÃO CAMADA DRIVER]
ChatGPTDriver.execute()
   ├─ validatePage()
   │    ├─ require('@shared/sadi/analyzer')  ← SHARED LAYER
   │    └─ analyzer.findChatInputSelector()
   ├─ sendPrompt()
   │    └─ input_resolver (usa analyzer)     ← SHARED LAYER
   └─ waitForResponse()
        └─ analyzer.findResponseArea()       ← SHARED LAYER
```

## Comparação Antes vs Depois

### ❌ ANTES (Inversão de Hierarquia)

```
CORE (validators)
   │
   └─→ depende de → DRIVER (modules/analyzer)
                         ↑
                         │
                    [PROBLEMA!]
        Camada inferior depende de superior
```

### ✅ DEPOIS (Hierarquia Correta)

```
SHARED (sadi/analyzer)
   ↑                 ↑
   │                 │
   │                 │
 CORE          DRIVER
(validators)  (modules)
   ↑                 ↑
   │                 │
   └────── OK ───────┘
Camadas superiores dependem de camada compartilhada
```

## Benefícios da Nova Arquitetura

### 1. Separation of Concerns

```
SHARED/SADI:   Percepção (olhos)
   ↓
CORE:          Validações (regras)
   ↓
DRIVER:        Execução (ação)
```

### 2. Reusabilidade

```javascript
// Health check standalone (sem driver)
const analyzer = require('@shared/sadi/analyzer');
const result = await analyzer.findChatInputSelector(page);

// Diagnostic tool
const analyzer = require('@shared/sadi/analyzer');
const isInteractive = await analyzer.validateCandidateInteractivity(page, protocol);

// Driver execution
class ChatGPTDriver {
    async validatePage() {
        const analyzer = require('@shared/sadi/analyzer');
        return await analyzer.findChatInputSelector(this.page);
    }
}
```

### 3. Testabilidade

```javascript
// Testa percepção isoladamente
describe('SADI', () => {
    it('detecta textarea ChatGPT', async () => {
        const analyzer = require('@shared/sadi/analyzer');
        const result = await analyzer.findChatInputSelector(page);
        expect(result).toBeDefined();
    });
});

// Testa validação isoladamente
describe('PrerequisiteValidator', () => {
    it('rejeita interface inválida', async () => {
        const result = await validateLLMInterface(page);
        expect(result.valid).toBe(false);
    });
});
```

## Dependências Clarificadas

### analyzer.js (SHARED)

```
Depende de:
  ✅ @core/i18n (termos multilíngues)
  ✅ Puppeteer Page (parâmetro)

NÃO depende de:
  ❌ BaseDriver
  ❌ TargetDriver
  ❌ DriverLifecycleManager
  ❌ Factory
  ❌ Kernel
  ❌ Server
```

### prerequisite_validator.js (CORE)

```
Depende de:
  ✅ @shared/sadi/analyzer (percepção)
  ✅ @core/logger
  ✅ @core/constants

NÃO depende de:
  ❌ @driver/* (exceto via SHARED)
  ❌ @kernel/*
  ❌ @server/*
```

### ChatGPTDriver.js (DRIVER)

```
Depende de:
  ✅ @shared/sadi/analyzer (percepção)
  ✅ @driver/core/BaseDriver
  ✅ @driver/modules/*
  ✅ @core/logger
```

## Conclusão

**Arquitetura Pós-Migração**: Hierarquia limpa com camada compartilhada para utilitários standalone.

**Princípios Respeitados**:
- ✅ Separation of Concerns
- ✅ Dependency Inversion (camadas dependem de abstrações)
- ✅ Single Responsibility (SADI = percepção, Driver = execução)
- ✅ Reusabilidade (SADI usado por múltiplas camadas)

**Status**: ✅ Implementado e validado (2026-02-01)
