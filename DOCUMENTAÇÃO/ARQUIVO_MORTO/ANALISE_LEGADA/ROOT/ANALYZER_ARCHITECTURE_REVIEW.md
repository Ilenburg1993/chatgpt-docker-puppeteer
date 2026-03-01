# Análise Arquitetural: Analyzer.js e Prerequisite Validator

**Data**: 2026-02-01 **Questão Levantada**: "O analyzer também é utilizado pelo driver, mas é uma
ferramenta dele. Analise isso melhor, para ver se a rede de chamamento está fazendo sentido."

---

## 1. Estado Atual da Arquitetura

### 1.1 Localização dos Componentes

```
src/
├── core/
│   └── validators/
│       └── prerequisite_validator.js  ← Camada de validação (CORE)
├── driver/
│   ├── modules/
│   │   └── analyzer.js               ← Ferrament SADI (DRIVER)
│   ├── core/
│   │   └── BaseDriver.js             ← Base dos drivers
│   ├── targets/
│   │   └── ChatGPTDriver.js          ← Driver específico ChatGPT
│   └── factory.js                     ← Factory de drivers
└── kernel/
    └── execution_engine.js            ← Orquestrador de execução
```

### 1.2 Fluxo de Chamadas Atual

```
NERV Event (DRIVER_EXECUTE_TASK)
    ↓
DriverNERVAdapter._handleDriverCommand()
    ↓
validateBrowserPool() [prerequisite_validator.js]  ← Valida Circuit Breaker
    ↓
validateDriverExecution()
    ├─ validateLLMPage()                            ← Valida URL
    └─ validateLLMInterface()                       ← USA analyzer.js
           └─ analyzer.findChatInputSelector()      ← SADI logic
           └─ analyzer.validateCandidateInteractivity()
    ↓
DriverLifecycleManager.execute(task)
    ↓
Factory.getDriver(target, page, config, signal)     ← Instancia driver
    ↓
ChatGPTDriver.execute()
    ├─ validatePage()                               ← USA analyzer.js NOVAMENTE
    │     └─ analyzer.findChatInputSelector()
    └─ sendPrompt()
```

### 1.3 Problema Identificado

**DUPLICAÇÃO DE VALIDAÇÃO**:

1. `prerequisite_validator` chama analyzer ANTES de instanciar driver
2. `ChatGPTDriver.validatePage()` chama analyzer DEPOIS de instanciar driver
3. **Duas validações idênticas em 2 pontos diferentes**

**INVERSÃO DE DEPENDÊNCIA**:

- `src/core/validators/` (camada CORE) importa `src/driver/modules/` (camada DRIVER)
- **Violação**: CORE não deveria depender de DRIVER (hierarquia invertida)

---

## 2. Análise do Analyzer.js

### 2.1 O Que É o Analyzer?

**SADI (Sensory Analysis Deep Intelligence)**: Sistema de percepção de interface LLM.

**Funcionalidade**:

- Detecta textarea de input (com heurística de scoring)
- Detecta botões de envio (por SVG signatures)
- Detecta área de resposta (por growth delta)
- Valida interatividade de elementos (focus test)
- Penetra Shadow DOM e IFrames

**Dependências**:

```javascript
// analyzer.js depende APENAS de:
const i18n = require('@core/i18n');  // Para termos multilíngues

// E recebe como parâmetro:
- page (Puppeteer Page instance)
```

### 2.2 Analyzer É Standalone?

**✅ SIM - É completamente standalone**:

- Não depende de `BaseDriver` ou `TargetDriver`
- Não depende de `DriverLifecycleManager`
- Não precisa de driver instanciado
- **Requer apenas**: `page` (Puppeteer) + `i18n` (CORE)

**Exports**:

```javascript
module.exports = {
  findChatInputSelector, // (page) → protocol
  findSendButtonSelector, // (page) → protocol
  findResponseArea, // (page) → protocol
  validateCandidateInteractivity, // (page, protocol) → boolean
  findFrameByPath, // (page, path) → frame
};
```

**Conclusão**: Analyzer é uma **biblioteca utilitária** que pode ser usada sem driver.

---

## 3. Quando o Driver É Instanciado?

### 3.1 Lifecycle do Driver

```
1. NERV Event (DRIVER_EXECUTE_TASK)
   ├─ browserPool disponível?        ← validateBrowserPool()
   ├─ Circuit Breaker OPEN?          ← validateBrowserPool()
   └─ OK → Prossegue

2. DriverLifecycleManager.execute(task)
   ├─ Adquire page do Browser Pool
   ├─ page disponível?
   └─ OK → Prossegue

3. Factory.getDriver(target, page, config, signal)
   ├─ Checa se já existe driver em cache (WeakMap por page)
   ├─ Se não existe: require(`./targets/${target}Driver.js`)
   ├─ Instancia: new ChatGPTDriver(page, config, signal)
   └─ Retorna driver

4. driver.execute(task)
   ├─ validatePage()                 ← AQUI usa analyzer
   ├─ sendPrompt(prompt)
   └─ waitForResponse()
```

### 3.2 Problema: Validação ANTES vs DEPOIS

**ANTES de instanciar driver** (`prerequisite_validator`):

- Objetivo: Validar se É POSSÍVEL instanciar driver
- Problemas:
  - Não tem `driver` ainda
  - Não tem `page` ainda (só terá após adquirir do pool)
  - **IMPOSSÍVEL validar interface LLM sem page**

**DEPOIS de instanciar driver** (`driver.validatePage()`):

- Objetivo: Validar estado da página antes de executar task
- Vantagens:
  - Tem `page` disponível
  - Tem `driver` configurado
  - Pode chamar analyzer com page real

---

## 4. Condições de Ativação do Driver

### 4.1 Quando Driver É "Ativado"?

**Driver é instanciado quando**:

```javascript
// Em DriverLifecycleManager.execute():
const page = await this._acquirePage(); // ← Adquire page do pool
const driver = this.driverFactory.getDriver(this.task.target, page, this.config, this.signal);
```

**Pré-requisitos para instanciar driver**:

1. ✅ Browser Pool operacional (não em Circuit Breaker OPEN)
2. ✅ Page disponível no pool (browser.isConnected() = true)
3. ✅ Task válida com target suportado

**Driver NÃO é instanciado se**:

- ❌ Circuit Breaker está OPEN
- ❌ Nenhuma page disponível no pool
- ❌ Browser não conectado (isConnected() = false)

### 4.2 Quando Analyzer Pode Ser Usado?

**Analyzer requer**:

1. ✅ `page` (Puppeteer Page instance)
2. ✅ `page.url()` válida (não about:blank)
3. ✅ `page` não fechada (`!page.isClosed()`)

**Analyzer NÃO requer**:

- ❌ Driver instanciado
- ❌ Task em execução
- ❌ DriverLifecycleManager ativo

**Conclusão**: Analyzer pode ser usado **independentemente do driver**.

---

## 5. Problemas Arquiteturais Identificados

### 5.1 ❌ Inversão de Hierarquia

```
ATUAL (ERRADO):
core/validators/ → depende de → driver/modules/

CORRETO:
driver/modules/ → pode ser usado por → core/validators/
(mas sem dependência direta - via interface)
```

**Por quê é problema?**:

- CORE é camada inferior (fundações)
- DRIVER é camada superior (aplicação)
- Fundações não podem depender de aplicação

### 5.2 ❌ Validação Prematura

```javascript
// prerequisite_validator.validateDriverExecution():
async function validateDriverExecution({ browserPool, page }) {
  const interfaceValidation = await validateLLMInterface(page);
  // ↑ PROBLEMA: page pode ser null aqui!
  // page só existe DEPOIS de acquirePage() em DriverLifecycleManager
}
```

**Situação atual**:

1. `DriverNERVAdapter` chama `validateDriverExecution()`
2. Passa `page` que ainda não foi adquirida
3. **validateLLMInterface() falha porque não tem page**

### 5.3 ❌ Duplicação de Lógica

```javascript
// prerequisite_validator.js
async function validateLLMInterface(page) {
    const inputResult = await analyzer.findChatInputSelector(page);
    // ... validação ...
}

// ChatGPTDriver.js
async validatePage() {
    const inputResult = await analyzer.findChatInputSelector(this.page);
    // ... mesma validação ...
}
```

**Duas validações idênticas em 2 lugares.**

---

## 6. Soluções Propostas

### Solução A: **Mover Analyzer para Camada Compartilhada** ✅ RECOMENDADO

**Estrutura**:

```
src/
├── shared/
│   └── sadi/                        ← Nova camada
│       └── analyzer.js              ← Move analyzer aqui
├── core/
│   └── validators/
│       └── prerequisite_validator.js ← Pode usar shared/sadi
└── driver/
    ├── modules/
    │   └── (outros módulos)
    └── targets/
        └── ChatGPTDriver.js         ← Pode usar shared/sadi
```

**Vantagens**:

- ✅ Elimina inversão de hierarquia
- ✅ Analyzer é claramente uma biblioteca compartilhada
- ✅ Pode ser usado por CORE e DRIVER sem problemas
- ✅ Semântica correta: "SADI é percepção, não é específico do driver"

**Mudanças necessárias**:

1. Move `src/driver/modules/analyzer.js` → `src/shared/sadi/analyzer.js`
2. Atualiza imports:
   - `prerequisite_validator.js`: `require('@shared/sadi/analyzer')`
   - `ChatGPTDriver.js`: `require('@shared/sadi/analyzer')`
   - `input_resolver.js`: `require('@shared/sadi/analyzer')`
   - `biomechanics_engine.js`: `require('@shared/sadi/analyzer')`
3. Atualiza `jsconfig.json`:
   ```json
   "@shared/*": ["src/shared/*"]
   ```

### Solução B: **Remover Validação de Interface de Prerequisite Validator** ⚠️ ALTERNATIVA

**Rationale**: Validação de interface LLM SÓ faz sentido DEPOIS de adquirir page.

**Estrutura**:

```
prerequisite_validator.js:
- validateBrowserPool()       ← Mantém (não precisa de page)
- validateBrowserConnection() ← Mantém (valida browser.isConnected())
- validateLLMPage()           ← Mantém (valida URL, recebe page como param)
- validateLLMInterface()      ← REMOVE (move para driver)

driver.validatePage():
- Mantém única validação de interface (com analyzer)
```

**Vantagens**:

- ✅ Elimina inversão de hierarquia
- ✅ Validação no momento certo (quando page está disponível)
- ✅ Semântica correta: "validar interface é responsabilidade do driver"

**Desvantagens**:

- ❌ Menos validação prévia (detecção de problemas mais tarde no fluxo)

### Solução C: **Criar Interface Abstrata para Analyzer** 🔄 COMPLEXO

**Estrutura**:

```
src/
├── core/
│   └── interfaces/
│       └── IInterfaceDetector.js    ← Interface abstrata
├── driver/
│   └── modules/
│       └── analyzer.js              ← Implementa IInterfaceDetector
└── core/
    └── validators/
        └── prerequisite_validator.js ← Depende de interface, não implementação
```

**Vantagens**:

- ✅ Dependency Inversion Principle (SOLID)
- ✅ Pode trocar implementação de detector

**Desvantagens**:

- ❌ Over-engineering para caso simples
- ❌ JavaScript não tem interfaces nativas (precisaria TypeScript ou duck typing)

---

## 7. Recomendação Final

### **Solução A (Mover Analyzer para Camada Compartilhada)** ✅

**Justificativa**:

1. **Semântica correta**: Analyzer é percepção de interface, não é específico do driver
2. **Eliminação de inversão**: Camada compartilhada pode ser usada por todos
3. **Reuso facilitado**: Outros componentes podem usar SADI no futuro
4. **Hierarquia limpa**:
   ```
   SHARED (utilitários) ← usado por → CORE (validações) ← usado por → DRIVER (execução)
   ```

**Implementação**:

1. Criar `src/shared/sadi/analyzer.js` (move analyzer)
2. Atualizar 4 imports (prerequisite_validator, ChatGPTDriver, input_resolver, biomechanics_engine)
3. Atualizar `jsconfig.json` para incluir `@shared/*`
4. Testar que validações continuam funcionando

**Alternativa se Solução A for rejeitada**: **Solução B** (remover validateLLMInterface de
prerequisite_validator).

---

## 8. Reflexões Finais

### 8.1 Quando Chamar Ferramentas SEM Ativar o Robô?

**Resposta**: **Sempre que precisar APENAS de percepção de interface**.

**Casos de uso standalone do analyzer**:

- ✅ Health checks de interface (CI/CD tests)
- ✅ Pre-flight validations (antes de adquirir page)
- ✅ Diagnostic tools (scripts de debug)
- ✅ Interface monitoring (sem executar tasks)

**Exemplo**:

```javascript
// Script de health check (sem driver)
const puppeteer = require('puppeteer');
const analyzer = require('@shared/sadi/analyzer');

const browser = await puppeteer.connect({ browserWSEndpoint: 'ws://...' });
const page = await browser.newPage();
await page.goto('https://chatgpt.com');

// Usa analyzer SEM instanciar driver
const inputProtocol = await analyzer.findChatInputSelector(page);
if (inputProtocol) {
  console.log('✅ Interface ChatGPT detectada e operacional');
} else {
  console.log('❌ Interface ChatGPT não encontrada');
}
```

### 8.2 Quando É OBRIGATÓRIO Ativar o Robô?

**Quando precisar de**:

- Máquina de estados (IDLE, TYPING, WAITING, STALLED)
- Recovery system (3-tier recovery)
- Submission controller (envio de prompts)
- Biomechanics engine (human-like typing)
- Lifecycle management (timeout, abort signals)
- Telemetria via NERV

**Resumo**: Analyzer = Olhos. Driver = Corpo + Cérebro.

---

## 9. Ação Proposta

**PRÓXIMO PASSO**: Implementar Solução A (mover analyzer para `src/shared/sadi/`).

**Motivo**: Respeita princípios arquiteturais, elimina inversão de hierarquia, mantém funcionalidade
atual.

**Alternativa**: Se usuário preferir Solução B, remover `validateLLMInterface` de
`prerequisite_validator`.

---

**Conclusão**: A rede de chamamento atual **não faz sentido arquiteturalmente**. Analyzer deve ser
camada compartilhada, não módulo exclusivo do driver.
