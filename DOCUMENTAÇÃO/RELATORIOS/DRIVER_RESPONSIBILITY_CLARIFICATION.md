# 🎯 Esclarecimento: Responsabilidade do Driver

> **Data**: 4 de Fevereiro de 2026 **Contexto**: Reclassificação de BaseDriver retry como
> comportamento CORRETO **Status**: ✅ CLARIFICADO (BaseDriver 100% conforme)

---

## 📜 Contexto

Durante auditoria arquitetural, o retry logic do BaseDriver foi **incorretamente** classificado como
"violação média". Após esclarecimento das responsabilidades, ficou claro que:

> **Cabe ao DRIVER fazer o que for necessário para a execução de uma tarefa dada na fila, partindo
> do pressuposto de que a tarefa esteja clara.**

Isso significa que o Driver **DEVE** fazer retry em falhas **TÉCNICAS** durante a execução
(seletores, frames, operações DOM), respeitando cancelamentos externos (signal.aborted).

---

## 🔄 3 Tipos de Retry

### 1️⃣ Retry TÁTICO (Driver - Operações Internas)

**Responsável**: Driver módulos (InputResolver, SubmissionController, BiomechanicsEngine)
**Escopo**: Operações DOM individuais (click, type, querySelector) **Decisão**: LOCAL (módulo sabe
quando operação é recuperável) **Exemplo**: Seletor não encontrado → tenta 3x em 500ms (animação
CSS)

```javascript
// input_resolver.js
for (let retry = 0; retry < 3; retry++) {
  try {
    return await page.querySelector(selector);
  } catch (err) {
    if (retry < 2) await sleep(500);
  }
}
```

### 2️⃣ Retry de EXECUÇÃO (Driver - Task Completa)

**Responsável**: BaseDriver **Escopo**: Completar MESMA task (execução até o fim) **Decisão**: LOCAL
(Driver classifica erro: TRANSIENT → retry, ABORT → stop) **Exemplo**: Connection lost during
execution → tenta 4x com backoff

```javascript
// BaseDriver.js
async execute(task, signal) {
    let attempts = 0;
    const MAX_RETRY_ATTEMPTS = 4;

    while (attempts < MAX_RETRY_ATTEMPTS) {
        // Checkpoint: Cancelamento externo
        if (signal?.aborted) {
            throw new Error('OPERATION_ABORTED');
        }

        try {
            // Execução completa (6 etapas Puppeteer)
            return await this._performAutomation(task, signal);
        } catch (err) {
            const errorClass = this._classifyError(err);

            // Cancelamento/Fatal → Stop
            if (errorClass === 'ABORT' || errorClass === 'FATAL') {
                throw err;
            }

            // Erro técnico → Retry
            attempts++;
        }
    }

    // Esgotou tentativas - relata ao Kernel
    throw new Error(`Task failed after ${MAX_RETRY_ATTEMPTS} attempts`);
}
```

### 3️⃣ Retry ESTRATÉGICO (Kernel - Reagendar Task)

**Responsável**: Kernel + PolicyEngine **Escopo**: Reagendar task COMPLETA na fila (próxima
execução) **Decisão**: GLOBAL (PolicyEngine usa contexto: SLA, rate limits, CB state) **Exemplo**:
Task falhou após 4 tentativas → PolicyEngine reagenda em 1 hora

```javascript
// execution_engine.js
async handleTaskFailure(task, error) {
    // PolicyEngine decide retry estratégico
    const decision = await this.policyEngine.shouldRetry({
        task,
        error,
        failureCount: task.metadata.failureCount,
        systemState: this.circuitBreaker.getState()
    });

    if (decision.shouldRetry) {
        // Reagenda task na fila
        await this.queue.reschedule(task, decision.retryAfter);
    } else {
        // Task cancelada permanentemente
        await this.queue.markAsFailed(task);
    }
}
```

---

## 🎯 Driver: Responsabilidades CORRETAS

### ✅ O Que Driver FAZ

1. **Execução Completa de Task**:
   - Fazer o necessário para executar task até o fim
   - Retry TÁTICO (operações DOM) + Retry de EXECUÇÃO (task completa)
   - Trabalhar no contexto de missão (task é parte de workflow maior)

2. **Respeitar Cancelamento Externo**:
   - Checar `signal?.aborted` em 6+ pontos durante execução
   - Abortar imediatamente se task cancelada (usuário, timeout, externe)
   - Emitir EXECUTION_ABORTED com contexto

3. **Classificar Erros**:
   - ABORT: Cancelamento externo → não retry
   - FATAL: Não recuperável (TARGET_CLOSED) → não retry, relatar
   - TRANSIENT/TIMEOUT/SELECTOR: Recuperável → retry OK

4. **Relatar Resultado**:
   - COMPLETED: Task executada com sucesso
   - FAILED: Esgotou retry de execução (Kernel decide retry estratégico)
   - ABORTED: Cancelada externamente (não tentar novamente)

### ❌ O Que Driver NÃO FAZ

1. **Não Decide Retry ESTRATÉGICO**:

   ```javascript
   // ERRADO: Driver reagenda task
   try {
     return await execute(task);
   } catch (err) {
     await sleep(3600000); // 1 hora
     return await execute(task); // retry estratégico
   }
   ```

2. **Não Ignora Cancelamento**:

   ```javascript
   // ERRADO: Driver ignora signal.aborted
   for (let i = 0; i < 100; i++) {
     await doWork(); // sem checar signal
   }
   ```

3. **Não Gerencia Conexão de Browser**:
   ```javascript
   // ERRADO: Driver tenta reconectar
   if (!page.isConnected()) {
     await this._reconnectBrowser();
   }
   ```

---

## 📊 Validação do Código Atual

### BaseDriver.js - ✅ 100% CONFORME

**Linhas 490-650**: Retry de execução com classificação de erros

| Aspecto                     | Implementação                           | Status |
| --------------------------- | --------------------------------------- | ------ |
| Retry de execução           | 4 tentativas, backoff exponencial       | ✅     |
| Checkpoints de cancelamento | 6+ localizações (`signal?.aborted`)     | ✅     |
| Classificação de erros      | 5 classes (ABORT, FATAL, TIMEOUT, etc.) | ✅     |
| Telemetria                  | Emite RETRY_ATTEMPT, EXECUTION_ABORTED  | ✅     |
| Relata ao Kernel            | Lança erro após esgotar tentativas      | ✅     |
| Contexto de missão          | Executa task no contexto de workflow    | ✅     |

**Checkpoints Identificados**:

```javascript
// Linha 508: Início de cada tentativa
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}

// Linha 540: Após clearAll()
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}

// Linha 560: Após resolution
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}

// Linha 590: Após navigation
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}

// Linha 610: Durante typing
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}

// Linha 630: Após submission
if (signal?.aborted) {
  throw new Error('OPERATION_ABORTED');
}
```

---

## 🔄 Fluxo de Execução (Retry de Execução)

```
┌─────────────────────────────────────────────────┐
│ Kernel: "Execute task #42"                      │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ BaseDriver.execute(task, signal)                │
│                                                 │
│ Loop: attempts < MAX_RETRY_ATTEMPTS (4)         │
│   │                                             │
│   ├─> Checkpoint: signal?.aborted? → ABORT     │
│   │                                             │
│   ├─> Try: Execute automation (6 steps)        │
│   │   └─> clearAll → resolve → navigate        │
│   │       → getHandle → type → submit           │
│   │                                             │
│   ├─> Success? → Return result                 │
│   │                                             │
│   └─> Error? → Classify:                       │
│       ├─> ABORT/FATAL? → Throw (stop)          │
│       └─> TRANSIENT? → attempts++, continue     │
│                                                 │
│ Esgotou tentativas? → Throw error               │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Kernel: Recebe resultado                        │
│   ├─> COMPLETED: Task executada ✅              │
│   ├─> ABORTED: Cancelada externamente ⚠️        │
│   └─> FAILED: PolicyEngine decide retry? 🔄     │
└─────────────────────────────────────────────────┘
```

---

## 📋 Cenários de Teste

### ✅ Cenário 1: Falha Técnica Recuperável

**Input**: Task #42, Chrome fechado durante execução (erro: TARGET_CLOSED) **Classificação**: FATAL
**Ação**: Driver tenta reconnect via BrowserPool (1x), falha → relata FAILED **Kernel**:
PolicyEngine decide retry estratégico (reagenda em 5min)

### ✅ Cenário 2: Cancelamento Externo

**Input**: Task #42, usuário cancela via dashboard (signal.aborted = true) **Classificação**: ABORT
**Ação**: Driver aborta imediatamente (checkpoint detecta signal.aborted) **Kernel**: Recebe
ABORTED, não tenta retry estratégico

### ✅ Cenário 3: Selector Não Encontrado (Transient)

**Input**: Task #42, querySelector falha (animação CSS) **Classificação**: TRANSIENT (SELECTOR)
**Ação**: Driver tenta 4x com backoff (1s, 2s, 4s, 8s) **Kernel**: Recebe COMPLETED se sucesso,
FAILED se esgotar tentativas

### ✅ Cenário 4: Timeout de LLM

**Input**: Task #42, LLM não responde em 180s **Classificação**: TIMEOUT **Ação**: Driver tenta 4x
(aumenta timeout: 180s, 240s, 300s) **Kernel**: Recebe FAILED após 4 tentativas, PolicyEngine decide
retry estratégico

---

## 🎓 Lições Aprendidas

### 1. Separação de Concerns é Contextual

- Retry **não é** monolítico (não existe "um dono" de retry)
- 3 tipos de retry coexistem: TÁTICO, EXECUÇÃO, ESTRATÉGICO
- Cada camada tem responsabilidade legítima dentro do seu escopo

### 2. Driver Tem Contexto de Missão

- Driver não executa tasks isoladas (executa no contexto de workflow)
- Driver deve ser persistente com falhas técnicas (missão de 24h não pode falhar por timeout de 10s)
- Cancelamento externo **SEMPRE** tem precedência

### 3. Classificação de Erros é Crítica

- Driver precisa distinguir: ABORT (não retry) vs TRANSIENT (retry)
- Erro classification permite retry inteligente (não blind retry)
- PolicyEngine usa info de classificação para decisões estratégicas

---

## 📖 Referências

1. [CONCEPTUAL_ARCHITECTURE.md](CONCEPTUAL_ARCHITECTURE.md) - Arquitetura conceitual (atualizada)
2. [ARCHITECTURE_COMPLIANCE_AUDIT.md](ARCHITECTURE_COMPLIANCE_AUDIT.md) - Auditoria (100% conforme)
3. [BaseDriver.js](../src/driver/core/BaseDriver.js) - Implementação (linhas 490-650)

---

**Conclusão**: BaseDriver implementa corretamente retry de EXECUÇÃO. Driver tem responsabilidade
legítima de completar task no contexto de missão, respeitando cancelamentos externos. Sistema 100%
conforme com arquitetura.

**Próxima Ação**: Adicionar JSDoc aos módulos explicando 3 tipos de retry (tático, execução,
estratégico).

---

**Versão**: 1.0 **Documentação Atualizada**: CONCEPTUAL_ARCHITECTURE.md,
ARCHITECTURE_COMPLIANCE_AUDIT.md **Status**: ✅ CLARIFICADO (reclassificação completa)
