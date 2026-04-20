# 17 — Auditoria SDK Copilot: Gaps Funcionais e Technical Debt

**Data de elaboração**: 2026-04-18 **Escopo**: Análise de gaps e technical debt **Tipo**: Documento
MDS complementar **Referência**: [15-AUDITORIA-BUGS-GAPS-TD.md](./15-AUDITORIA-BUGS-GAPS-TD.md)

---

## 1. Gaps Funcionais

### GAP-01: Validação de Input Incompleta no Session Initializer

**Arquivo**: `src/copilot/agent/session/initializer.js`

#### 1.1 Descrição

O `setBackgroundCompactionThreshold()` não retorna feedback sobre sucesso ou falha da operação:

```javascript
// initializer.js:59-63
export function setBackgroundCompactionThreshold(threshold) {
  if (typeof threshold === 'number' && threshold >= 0.1 && threshold <= 1.0) {
    _backgroundCompactionThreshold = threshold;
  }
  // Sem retorno, sem feedback
}
```

#### 1.2 Impacto

- Usuário não sabe se configuração foi aplicada
- Debugging difícil quando threshold não surte efeito
- Inconsistência com outras APIs que retornam boolean ou throws

#### 1.3 Recomendação

```javascript
export function setBackgroundCompactionThreshold(threshold) {
  if (typeof threshold !== 'number') {
    throw new TypeError('Threshold deve ser número');
  }
  if (threshold < 0.1 || threshold > 1.0) {
    throw new RangeError('Threshold deve estar entre 0.1 e 1.0');
  }
  _backgroundCompactionThreshold = threshold;
  return true; // ou void se preferir throw em caso de erro
}
```

---

### GAP-02: Modelo de Fallback Não Persiste Entre Reinicializações

**Arquivo**: `src/copilot/agent/dialog/loop-manager.js`

#### 2.1 Descrição

O `ModelFallbackState` mantém o fallback em memória mas não persiste no state-io:

```javascript
// loop-manager.js:129-131
this.#modelFallback = new ModelFallbackState({
  defaultModel: options.fallbackModel ?? getCopilotFallbackModel(),
});
```

#### 2.2 Cenário de Falha

1. Agente inicia com fallback agendado (ex: modelo `o3-mini` como fallback)
2. Fallback é usado durante operação
3. Agente reinicia (crash, deploy, etc.)
4. Fallback é perdido - agente tenta usar modelo original que pode estar falhando

#### 2.3 Recomendação

```javascript
// Adicionar persistência em loop-manager.js
async persistFallbackState() {
    const fallback = this.#modelFallback.getScheduledFallback();
    if (fallback) {
        await persistStateWithPolicy(
            { scheduledModelFallback: fallback },
            { label: 'dialog.fallback.persist' }
        );
    }
}

// E restaurar no constructor
constructor(options = {}) {
    // ...existing code
    const saved = readState()?.scheduledModelFallback;
    if (saved) {
        this.#modelFallback.restore(saved);
    }
}
```

---

### GAP-03: Ausência de Rate Limiting no SendMessage

**Arquivo**: `src/copilot/agent/messaging/agent-messaging.js`

#### 3.1 Descrição

Não há controle de taxa temporal - o agente pode sobrecarregar o SDK com many requisições em burst.

```javascript
// O único limite é o tamanho da fila
// message-queue.js:123
if (this.#items.length >= MAX_QUEUE_SIZE) {
  throw new SessionError('QUEUE_FULL');
}
```

#### 3.2 Cenário de Problema

- Usuário faz spam de mensagens rapidamente
- Cada mensagem é processada sequencialmente mas a taxa de entrada é alta
- SDK pode retornar rate limit errors

#### 3.3 Recomendação

```javascript
// Implementar token bucket
class RateLimiter {
  constructor(maxTokens, refillRate) {
    this.tokens = maxTokens;
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  async tryAcquire(tokens = 1) {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = (elapsed / 1000) * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }
}
```

---

### GAP-04: Handoff Manager Não Persiste Histórico

**Arquivo**: `src/copilot/agent/infra/handoff-manager.js`

#### 4.1 Descrição

Histórico de handoffs é perdido após restart:

```javascript
// handoff-manager.js:49-51
/** @type {HandoffRequest[]} */
#history = [];
// Apenas em memória, não persiste
```

#### 4.2 Impacto

- Não há audit trail de handoffs após restart
- Impossível rastrear padrões de handoff históricos
- Diagnóstico de problemas de handoff dificultado

#### 4.3 Recomendação

```javascript
// Adicionar persistência
async saveToHistory(request) {
    this.#history.push(request);
    if (this.#history.length > this.#maxHistory) {
        this.#history.shift();
    }
    // Persistir
    await persistStateWithPolicy(
        { handoffHistory: this.#history },
        { label: 'handoff.history' }
    );
}
```

---

### GAP-05: Keepalive Não Verifica Status do Client

**Arquivo**: `src/copilot/agent/session/keepalive.js`

#### 5.1 Descrição

O fallback de keepalive tenta `session.send()` sem verificar se o client está em estado válido:

```javascript
// keepalive.js:162-172
const session = getSession();
if (!session || typeof session.send !== 'function') return;

try {
    await session.send({ prompt: '[keepalive]' });
```

#### 5.2 Cenário de Problema

- Client está em transição (reconnecting)
- Keepalive tenta send e falha
- Erro polui logs
- Em alguns casos pode agravatar a situação de reconexão

#### 5.3 Recomendação

```javascript
// Adicionar verificação de status
const client = getClient?.();
if (client && typeof client.getStatus === 'function') {
  const status = client.getStatus();
  if (status !== 'connected' && status !== 'ready') {
    log('DEBUG', `Keepalive skipped: client status = ${status}`);
    return;
  }
}
```

---

### GAP-06: Ausência de Graceful Degradation para Tools Registry

**Arquivo**: `src/copilot/agent/agent-context.js`

#### 6.1 Descrição

Se `createRegistry()` falhar, todo o agente pode falhar:

```javascript
// agent-context.js:178
this.toolsRegistry = createRegistry();
```

#### 6.2 Recomendação

```javascript
try {
  this.toolsRegistry = createRegistry();
} catch (error) {
  log('WARN', `Tools registry creation falhou: ${error.message}, usando fallback`);
  this.toolsRegistry = createFallbackRegistry();
}
```

---

### GAP-07: Session Rotation Não Considera Quota Exhausted

**Arquivo**: `src/copilot/agent/session/rotation.js`

#### 7.1 Descrição

O `shouldRotateSession()` não verifica quota disponível antes de decidir rotation:

```javascript
// rotation.js - verificar implementação
const decision = shouldRotateSession(rotationCtx);
if (decision.shouldRotate) {
  // tenta criar nova sessão sem verificar quota
  savedSessionId = null;
}
```

#### 7.2 Cenário de Problema

1. Sessão atual está perto do limite
2. Rotation decide criar nova sessão
3. Nova sessão falha por quota exhausted
4. Usuário fica sem sessão ativa

#### 7.3 Recomendação

```javascript
// Integrar com quota monitor
async function shouldRotateSession(rotationCtx) {
  const quotaMonitor = container.resolve(QUOTA_MONITOR);
  const quotaStatus = quotaMonitor.getStatus();

  if (quotaStatus.remaining <= quotaStatus.criticalThreshold) {
    return { shouldRotate: false, reason: 'quota_exhausted' };
  }

  // ... resto da lógica
}
```

---

## 2. Technical Debt

### TD-01: Casts Residuais em Runtime Contracts

**Arquivo**: `src/copilot/agent/runtime-contracts.js`

**Descrição**: Ainda existem alguns casts `any` para compatibilidade com diferentes versões do SDK.

**Recomendação**: Normalizar interface SDK e remover casts progressivamente.

---

### TD-02: Code Duplication em Error Handling

**Descrição**: Padrões de `try/catch` duplicados mesmo com `withAgentErrorPolicy` disponível.

**Exemplo**:

```javascript
// Em vez de:
try {
    // lógica
} catch (e) {
    log('ERROR', e.message);
    // retry logic duplicada
}

// Usar:
const result = await withAgentErrorPolicy(() => /* lógica */, {
    onError: (error, disposition) => log(...)
});
```

---

### TD-03: Props Drilling em BootWiringContext

**Arquivo**: `src/copilot/agent/session/boot-wiring.js`

**Descrição**: Contexto de boot recebe muitos parâmetros, alguns redundantes.

**Recomendação**: Simplificar para usar AgentContext onde possível.

---

### TD-04: Logging Inconsistente

**Descrição**: Módulos usam `log`, `console`, e custom loggers.

**Recomendação**: Padronizar em único logger.

---

### TD-05: Ausência de TypedEventEmitter

**Descrição**: Uso de `EventEmitter` genérico em vez de tipado.

**Recomendação**: Criar tipos de events e usar EventEmitter tipado.

---

### TD-06: Config Spread em Session-Setup

**Arquivo**: `src/copilot/agent/lifecycle/session-setup.js`

**Descrição**: Uso excessivo de spread operator.

**Recomendação**: Consolidar em objetos de configuração definidos.

---

## 3. Matriz de Esforço vs Impacto

```
                    IMPACTO
                    Baixo    Médio    Alto
            Alto   TD-05    GAP-03   BUG-02
ESFORÇO     Médio  TD-04    GAP-02   GAP-07
            Baixo  TD-06    GAP-01   GAP-04
                           GAP-05   GAP-06
                           TD-01    TD-02
                           TD-03
```

---

## 4. Roadmap de Resolução

### Curto Prazo (1-2 semanas)

1. GAP-01: Melhorar validation feedback
2. GAP-06: Graceful degradation registry
3. TD-02: Consolidar error handling

### Médio Prazo (1 mês)

1. GAP-02: Persistência de fallback
2. GAP-03: Rate limiting
3. GAP-04: Handoff history persistence
4. GAP-05: Client status verification

### Longo Prazo

1. GAP-07: Quota-aware rotation
2. TD-01, TD-03, TD-04, TD-05, TD-06: Refactoring estrutural

---

## 5. Conclusão

Os gaps funcionais representam limitações que não bloqueiam o funcionamento básico do sistema, mas
limitam sua robustez em cenários edge cases. O technical debt representa oportunidades de melhoria
de código que podem ser adressadas gradualmente sem impacto imediato na funcionalidade.

A priorização recomendada foca nos gaps que têm maior impacto em resiliência (GAP-02, GAP-03,
GAP-04, GAP-05) e no technical debt que causa maior fricção no desenvolvimento diário (TD-02,
TD-04).
