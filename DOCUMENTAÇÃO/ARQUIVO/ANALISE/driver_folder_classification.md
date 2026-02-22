# Classificação de Arquivos - src/driver/

**Data**: 1 de Fevereiro de 2026 **Objetivo**: Identificar quais arquivos da pasta `driver/` devem
migrar para `shared/` vs quais são específicos de driver

---

## Executive Summary

**Total de arquivos**: 13 arquivos JavaScript **Total de linhas**: ~2,724 linhas

**Classificação**:

- ✅ **JÁ MIGRADOS**: 2 arquivos (human.js, stabilizer.js)
- 🔵 **ESPECÍFICOS DE DRIVER**: 11 arquivos (permanecem em `driver/`)
- 🟡 **CANDIDATOS A MIGRAÇÃO**: 0 arquivos (nenhum universal tool restante)

---

## Estrutura Atual de `src/driver/`

```
src/driver/
├── core/                          [ESPECÍFICO - Base architecture]
│   ├── BaseDriver.js              (~430 lines) - Classe base de todos os drivers
│   └── TargetDriver.js            (~320 lines) - Abstract class com EventEmitter
│
├── modules/                       [ESPECÍFICO - Driver-coupled modules]
│   ├── biomechanics_engine.js     (~309 lines) - Orquestra human.js no contexto do driver
│   ├── frame_navigator.js         (~180 lines) - Navegação entre frames/iframes
│   ├── handle_manager.js          (~115 lines) - Gestão de handles do Puppeteer
│   ├── input_resolver.js          (~160 lines) - Resolve inputs usando SADI
│   ├── recovery_system.js         (~240 lines) - Sistema de recovery de erros
│   ├── submission_controller.js   (~150 lines) - Controla submissões de mensagens
│   └── triage.js                  (~256 lines) - Diagnóstico de travamentos
│
├── targets/                       [ESPECÍFICO - Target implementations]
│   └── ChatGPTDriver.js           (~485 lines) - Implementação específica ChatGPT
│
├── nerv_adapter/                  [ESPECÍFICO - IPC integration]
│   └── driver_nerv_adapter.js     - Adapter para comunicação NERV
│
├── factory.js                     [ESPECÍFICO - Factory pattern]
└── DriverLifecycleManager.js      [ESPECÍFICO - Lifecycle management]
```

---

## Classificação Detalhada

### 🟢 **UNIVERSAL TOOLS** (Já Migrados)

Arquivos que **JÁ FORAM MIGRADOS** para `src/shared/`:

1. **human.js** → `src/shared/biomechanics/human.js` ✅
   - **Razão**: Lógica de interação humana pura (gaussian, delays, movimento)
   - **Uso**: Múltiplos drivers (ChatGPT, Gemini, futuros)
   - **Status**: v2.0 completo (601 linhas)

2. **stabilizer.js** → `src/shared/page_stability/stabilizer.js` ✅
   - **Razão**: Estabilização de página multi-fase genérica
   - **Uso**: Múltiplos drivers + health checks
   - **Status**: v2.0 completo (699 linhas)

---

### 🔵 **DRIVER-SPECIFIC MODULES** (Permanecem em `driver/`)

Arquivos que **NÃO DEVEM MIGRAR** pois são acoplados à arquitetura de drivers:

#### **core/** (2 arquivos - 750 linhas)

1. **BaseDriver.js** (~430 lines) 🔵 **MANTER**
   - **Classe**: `BaseDriver extends TargetDriver`
   - **Responsabilidade**: Classe base de todos os drivers concretos
   - **Acoplamento**:
     - Instancia `RecoverySystem`, `HandleManager`, `InputResolver`, etc.
     - Gerencia lifecycle de driver (boot, navigate, execute, cleanup)
     - Emite eventos NERV (`_emitVital`)
   - **Dependências**: Todos os modules em `driver/modules/`
   - **Razão para manter**: É a **espinha dorsal da arquitetura de drivers**

2. **TargetDriver.js** (~320 lines) 🔵 **MANTER**
   - **Classe**: `TargetDriver extends EventEmitter`
   - **Responsabilidade**: Abstract class com state management
   - **Acoplamento**:
     - Define contrato de drivers (`page`, `currentDomain`, `correlationId`)
     - Gerencia telemetria (`_emitVital`)
   - **Razão para manter**: É a **interface abstrata** que todos os drivers implementam

---

#### **modules/** (7 arquivos - 1,410 linhas)

3. **biomechanics_engine.js** (~309 lines) 🔵 **MANTER**
   - **Classe**: `BiomechanicsEngine`
   - **Responsabilidade**: **Orquestra** `human.js` no contexto do driver
   - **Acoplamento**:
     - Recebe instância de `BaseDriver` no construtor
     - Chama `this.driver._emitVital()` (telemetria específica de driver)
     - Usa `this.driver.page`, `this.driver.currentDomain`
     - Integra com `stabilizer`, `analyzer`, `adaptive`
   - **Diferença de human.js**:
     - `human.js` = funções puras de interação
     - `biomechanics_engine.js` = **orquestrador com contexto de driver**
   - **Razão para manter**: É um **adapter** entre human.js (puro) e driver (contextual)

4. **triage.js** (~256 lines) 🔵 **MANTER**
   - **Funções**: `diagnoseStall(page, langCode)`
   - **Responsabilidade**: Autópsia de travamentos em tempo real
   - **Acoplamento**:
     - Usa `stabilizer.measureEventLoopLag` (já migrado ✅)
     - Usa `i18n.getTerms()` (detecção de erros multi-idioma)
     - Retorna diagnósticos para `BaseDriver` processar
   - **Por que não migrar**:
     - Embora use utils de `shared/`, seu **propósito** é diagnóstico de driver
     - É chamado apenas por drivers em contextos de erro

5. **input_resolver.js** (~160 lines) 🔵 **MANTER**
   - **Classe**: `InputResolver`
   - **Responsabilidade**: Localizar inputs priorizando DNA (rules) sobre heurística
   - **Acoplamento**:
     - Recebe `driver` no construtor
     - Usa `this.driver.page`, `this.driver._emitVital()`, `this.driver.handles`
     - Integra com `analyzer` (SADI), `io` (rules), `CONFIG`
   - **Razão para manter**: Cache e telemetria são **específicos de driver**

6. **frame_navigator.js** (~180 lines) 🔵 **MANTER**
   - **Classe**: `FrameNavigator`
   - **Responsabilidade**: Navegação entre frames/iframes
   - **Acoplamento**: Driver-specific (usa `this.driver.page.frames()`)
   - **Razão para manter**: Navegação de frames é **específica do contexto de driver**

7. **handle_manager.js** (~115 lines) 🔵 **MANTER**
   - **Classe**: `HandleManager`
   - **Responsabilidade**: Gestão de handles do Puppeteer (evitar leaks)
   - **Acoplamento**: Driver-specific (usa `this.driver.page.$$()`)
   - **Razão para manter**: Gerenciamento de handles é **lifecycle de driver**

8. **recovery_system.js** (~240 lines) 🔵 **MANTER**
   - **Classe**: `RecoverySystem`
   - **Responsabilidade**: Recovery de erros (reload, navigation, etc.)
   - **Acoplamento**:
     - Usa `this.driver.page.reload()`, `this.driver.navigate()`
     - Integra com `stabilizer` (já migrado ✅)
   - **Razão para manter**: Recovery é **estratégia de driver**

9. **submission_controller.js** (~150 lines) 🔵 **MANTER**
   - **Classe**: `SubmissionController`
   - **Responsabilidade**: Controlar submissões de mensagens
   - **Acoplamento**: Driver-specific (usa `adaptive`, `this.driver`)
   - **Razão para manter**: Submissão é **lógica de interação de driver**

---

#### **targets/** (1 arquivo - 485 linhas)

10. **ChatGPTDriver.js** (~485 lines) 🔵 **MANTER**
    - **Classe**: `ChatGPTDriver extends BaseDriver`
    - **Responsabilidade**: Implementação específica para ChatGPT
    - **Acoplamento**:
      - Sobrescreve métodos de `BaseDriver`
      - Usa `triage`, `analyzer`, `adaptive`
      - **BUG DETECTADO**: Ainda importa `require('../modules/stabilizer')` (deve ser
        `@shared/page_stability/stabilizer`)
    - **Razão para manter**: É a **implementação concreta** de um target

---

#### **nerv_adapter/** (1 arquivo)

11. **driver_nerv_adapter.js** 🔵 **MANTER**
    - **Classe**: `DriverNERVAdapter`
    - **Responsabilidade**: Adapter para comunicação NERV (IPC)
    - **Acoplamento**: Driver-specific (integração com `DriverLifecycleManager`)
    - **Razão para manter**: É parte da **arquitetura IPC**

---

#### **Root** (2 arquivos)

12. **factory.js** 🔵 **MANTER**
    - **Responsabilidade**: Factory pattern para criação de drivers
    - **Acoplamento**: Registra e cria instâncias de `ChatGPTDriver`, etc.
    - **Razão para manter**: É o **entry point** da arquitetura de drivers

13. **DriverLifecycleManager.js** 🔵 **MANTER**
    - **Classe**: `DriverLifecycleManager`
    - **Responsabilidade**: Gerenciar lifecycle de drivers (create, destroy, rotate)
    - **Acoplamento**: Integração com NERV, factory, recovery
    - **Razão para manter**: É a **gestão central** de drivers

---

## Decisão Final: Nenhum Arquivo a Migrar

### ✅ **Conclusão**

**NENHUM arquivo da pasta `driver/` deve ser migrado para `shared/`**.

**Razões**:

1. ✅ **Universal tools já foram migrados** (human.js, stabilizer.js)
2. 🔵 **Todos os arquivos restantes são driver-specific**:
   - São **acoplados à arquitetura de drivers** (recebem `driver` no construtor)
   - Usam **telemetria específica de driver** (`_emitVital`)
   - Gerenciam **lifecycle de driver** (boot, navigate, cleanup)
   - Implementam **estratégias de driver** (recovery, triage, navigation)

### 🐛 **Bug Detectado em ChatGPTDriver.js**

**Linha 19**:

```javascript
const stabilizer = require('../modules/stabilizer');
```

**Deve ser**:

```javascript
const stabilizer = require('@shared/page_stability/stabilizer');
```

**Impacto**: Import incorreto após migração de `stabilizer.js` para `shared/`

---

## Próximos Passos

### ✅ Fase Atual: Análise e Upgrade de `driver/`

**Arquivos prioritários para upgrade** (por tamanho e complexidade):

1. **BaseDriver.js** (430 lines) - Classe base crítica
2. **ChatGPTDriver.js** (485 lines) - Implementação concreta + bug fix
3. **biomechanics_engine.js** (309 lines) - Orquestrador de human.js
4. **TargetDriver.js** (320 lines) - Abstract class base
5. **triage.js** (256 lines) - Diagnóstico de travamentos
6. **recovery_system.js** (240 lines) - Sistema de recovery
7. **frame_navigator.js** (180 lines) - Navegação de frames
8. **input_resolver.js** (160 lines) - Resolução de inputs
9. **submission_controller.js** (150 lines) - Controle de submissões
10. **handle_manager.js** (115 lines) - Gestão de handles

### 🎯 **Estratégia de Upgrade**

**Prioridade 1** (Arquitetura Core):

- BaseDriver.js
- TargetDriver.js
- factory.js
- DriverLifecycleManager.js

**Prioridade 2** (Modules Críticos):

- biomechanics_engine.js (usa human.js v2.0)
- triage.js (usa stabilizer.js v2.0)
- input_resolver.js (usa analyzer.js v4.0)

**Prioridade 3** (Modules Auxiliares):

- recovery_system.js
- frame_navigator.js
- submission_controller.js
- handle_manager.js

**Prioridade 4** (Targets):

- ChatGPTDriver.js (fix import bug + upgrade)

---

## Métricas de Migração

| Categoria                      | Arquivos | Linhas | Status                  |
| ------------------------------ | -------- | ------ | ----------------------- |
| **Universal Tools (migrados)** | 2        | ~1,300 | ✅ COMPLETE             |
| **Driver-Specific (manter)**   | 11       | ~2,724 | 🔵 MANTER               |
| **Bugs Detectados**            | 1        | -      | 🐛 ChatGPTDriver import |

---

**Criado por**: GitHub Copilot **Data**: 1 de Fevereiro de 2026 **Versão**: 1.0 **Status**: ✅
**ANÁLISE COMPLETA**
