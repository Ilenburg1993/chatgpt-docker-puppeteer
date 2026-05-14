# Investigação Arquitetural — Optimization #1: Model Switch Retry + Timeout

**Data**: 2026-05-14 | **Status**: 🔬 Investigação Completa | **Rigor**: TypeScript Strict

---

## 1. Fluxo Atual de Model Switch

### 1.1 Cadeia de Chamadas

```
setSessionModel(session, model, options)
  └─ verifySessionModelSwitch(session, model, options)
       ├─ Etapa 1: Check `session.rpc.model.getCurrent()`
       │  └─ result.verifiedSwitch = (current.modelId === model)
       │  └─ Se verdadeiro: return early ✅
       │
       └─ Etapa 2: Se false, tenta RPC fallback
          ├─ Call: session.rpc.model.switchTo(model, options)
          └─ Call: modelGetCurrent(session)
             └─ result.verifiedSwitch = (current.modelId === model)
             └─ return result
```

### 1.2 Tipos Envolvidos

**Em runtime.js**:
```typescript
async function verifySessionModelSwitch(
    session: CopilotSession,
    model: string,
    options?: { reasoningEffort?: ReasoningEffort }
): Promise<{
    requestedModel: string;
    effectiveModel: string | null;
    verifiedSwitch: boolean;
    usedRpcFallback: boolean;
}>
```

**Em rpc/session.js**:
```typescript
export async function modelGetCurrent(session: CopilotSession): Promise<{ modelId: string }>

export async function modelSwitchTo(
    session: CopilotSession,
    modelId: string,
    options?: { reasoningEffort?: string }
): Promise<{ modelId?: string }>
```

### 1.3 Predicado de Sucesso

```javascript
// Linha ~75-80 em runtime.js
result.verifiedSwitch = current.modelId === model;

// Predicado do resultado
return result; // {verifiedSwitch: boolean, ...}
```

---

## 2. Problema: False Negatives

### 2.1 Cenário Problemático

1. `session.rpc.model.switchTo(newModel)` chamado ✅
2. Retorno com sucesso (sem erro) ✅
3. **Mas** internamente o SDK ainda está processando a troca assincronamente
4. Imediatamente depois: `modelGetCurrent()` chamado
5. Retorna o modelo ANTIGO ainda (troca não finalizou internamente)
6. Predicado: `old_model === new_model` → **FALSE** ❌
7. Resultado: `verifiedSwitch=false` (falso negativo)

### 2.2 Causa Raiz

- RPC `.switchTo()` é assincronamente efetivo (não espera sincronismo interno)
- Chamada + return não significa que `getCurrent()` refletirá a mudança imediatamente
- Sem retry/backoff, primeira falha é considerada permanente

### 2.3 Impacto

- Model switch validation fail silenciosamente
- Usuários veem modelo antigo em UI após switch
- Sem recuperação automática

---

## 3. Solução: Retry com Timeout Cap

### 3.1 Algoritmo Proposto

```javascript
// Pseudocódigo
function verifyWithRetry(predicateFn, config) {
    const startTime = Date.now();
    const MAX_RETRIES = 3;
    const POLL_DELAY = 100; // ms
    const TIMEOUT_CAP = 500; // ms MAX (critical!)

    async function attempt(retryCount) {
        const success = await predicateFn();
        if (success) return { ok: true, retries: retryCount };

        const elapsed = Date.now() - startTime;
        const remaining = TIMEOUT_CAP - elapsed;

        if (retryCount < MAX_RETRIES && remaining > 50) {
            await wait(POLL_DELAY * (1 + retryCount)); // Exponential backoff
            return attempt(retryCount + 1);
        }

        return {
            ok: false,
            retries: retryCount,
            timedOut: remaining <= 0
        };
    }

    return attempt(0);
}
```

### 3.2 Propriedades

| Propriedade | Valor                         | Justificativa                               |
| ----------- | ----------------------------- | ------------------------------------------- |
| MAX_RETRIES | 3                             | 3 chances antes de desistir                 |
| POLL_DELAY  | 100ms                         | Inicial, espera razoável para SDK processar |
| TIMEOUT_CAP | 500ms                         | Nunca espera mais que meio segundo          |
| Backoff     | Exponencial: 100, 200, 300 ms | Mais espera conforme tentativas aumentam    |

### 3.3 Timeout Cap (Critical)

**Por que 500ms é crítico**:
- Sem cap: retry indefinido (50ms × 3 = 150ms, mais esperas = ∞)
- Com cap 500ms: Pior caso = ~500ms por verificação
- 500ms é aceitável em UX (meio segundo de delay)
- Além disso: timeout melhor que falha indefinida

---

## 4. Integração com runtime.js

### 4.1 Ponto de Integração

Dentro de `verifySessionModelSwitch()` após falha na Etapa 2:

```javascript
async function verifySessionModelSwitch(session, model, options) {
    const result = {
        requestedModel: model,
        effectiveModel: null,
        verifiedSwitch: false,
        usedRpcFallback: false,
    };

    // ... Etapa 1: modelGetCurrent initial check ...

    if (result.verifiedSwitch) return result;

    // ... Etapa 2: Try switchTo fallback ...
    try {
        await modelSwitchTo(session, model, ...);
        result.usedRpcFallback = true;

        // ⭐ AQUI: Aplicar retry com timeout
        const verifyResult = await verifyModelWithRetry(
            () => verifyCurrentModel(session, model),
            { maxRetries: 3, pollDelayMs: 100, totalTimeoutMs: 500 }
        );

        result.verifiedSwitch = verifyResult.ok;
        if (!result.verifiedSwitch) {
            log('WARN', `Model switch still unverified after ${verifyResult.retries} retries`);
        }

        return result;
    } catch (error) {
        // ...
    }
}
```

### 4.2 Função Auxiliar Proposta

```javascript
/**
 * Valida modelo atual com retry + timeout.
 *
 * @param {() => Promise<boolean>} predicateFn - Retorna true se verificação passou
 * @param {{ maxRetries?: number; pollDelayMs?: number; totalTimeoutMs?: number }} [config]
 * @returns {Promise<{ ok: boolean; retries: number; timedOut: boolean }>}
 */
async function verifyModelWithRetry(predicateFn, config = {}) {
    // Implementação...
}
```

---

## 5. Considerações TypeScript Strict

### 5.1 Problemas a Evitar

❌ **Defaults via `= null`** (não passa typecheck strict)
```typescript
function retry(fn, startTime = null, retryCount = 0) // ❌ null type error
```

✅ **Usar separação de concerns**:
```typescript
function retry(fn, config) {
    const startTime = Date.now(); // Não é parâmetro
    return retryInternal(fn, config, startTime, 0);
}

function retryInternal(fn, config, startTime, retryCount) {
    // Todos os parâmetros têm tipo definido
}
```

### 5.2 Typings Necessários

```typescript
/**
 * @typedef {object} ModelSwitchRetryConfig
 * @property {number} [maxRetries] - Default: 3
 * @property {number} [pollDelayMs] - Default: 100
 * @property {number} [totalTimeoutMs] - Default: 500
 */

/**
 * @typedef {object} VerifyResult
 * @property {boolean} ok - true se verificação passou
 * @property {number} retries - Número de tentativas
 * @property {boolean} timedOut - true se atingiu timeout
 */
```

### 5.3 Duck-typing de Session

```javascript
// Já feito em rpc/session.js (modelo a seguir)
if (typeof session.rpc?.model?.getCurrent !== 'function') {
    throw new TypeError('modelo.getCurrent indisponível');
}
```

---

## 6. Padrão de Implementação (Zero Burla)

### 6.1 Estrutura Recomendada

**Opção A**: Helper em arquivo separado `model-switch-retry.js`
```
src/copilot/sdk/session/
├── model-switch-retry.js    ← Nova função de retry
├── runtime.js               ← Usa a função
└── ...
```

**Opção B**: Helper inline em `runtime.js`
```javascript
// No topo de runtime.js (após imports)

/**
 * Retry com timeout para verificação de model switch.
 * ...
 */
async function retryVerifyModelSwitch(session, model, config = {}) {
    // ...
}

// Depois usado em verifySessionModelSwitch()
```

### 6.2 Pré-requisitos de Validação

Antes de implementar, validar:

1. ✅ `modelGetCurrent` existente e tipado (`Promise<{ modelId: string }>`)
2. ✅ `modelSwitchTo` existente e tipado
3. ✅ Ambos importados em runtime.js
4. ✅ Result type já definido em runtime.js
5. ✅ Log helper disponível (`log()`)
6. ✅ Error helper disponível (`toError()`)

---

## 7. Testes Necessários

### 7.1 Casos

```javascript
describe('verifySessionModelSwitch com retry', () => {
    it('sucesso no retry imediato', async () => {
        // Session que retorna modelo correto na 1ª tentativa
        // Espera: verifiedSwitch=true, retries=0
    });

    it('sucesso após 2 retries', async () => {
        // Session que retorna modelo antigo na 1ª, correto na 2ª
        // Espera: verifiedSwitch=true, retries=2
    });

    it('falha após timeout', async () => {
        // Session que nunca retorna modelo correto
        // Espera: verifiedSwitch=false, timedOut=true
    });

    it('falha após max retries sem timeout', async () => {
        // Config com timeout muito alto, retries baixo
        // Espera: verifiedSwitch=false, timedOut=false
    });

    it('respeita timeout cap de 500ms', async () => {
        // Mede duração e garante < 600ms
    });
});
```

### 7.2 Mocking Strategy

```javascript
// Mock modelGetCurrent para retornar modelo diferente primeiramente
const sessionMock = {
    rpc: {
        model: {
            getCurrent: vi.fn()
                .mockResolvedValueOnce({ modelId: 'gpt-4' })      // Retry 1: ainda antigo
                .mockResolvedValueOnce({ modelId: 'gpt-4' })      // Retry 2: ainda antigo
                .mockResolvedValueOnce({ modelId: 'gpt-4-turbo' }) // Retry 3: sucesso!
        }
    }
};

// Test
const result = await verifySessionModelSwitch(sessionMock, 'gpt-4-turbo');
expect(result.verifiedSwitch).toBe(true);
expect(result.retries).toBe(2); // (ou número correto)
```

---

## 8. Gates para Implementação

Antes de codificar:

- [ ] ✅ Código atual pass: `npm run typecheck:strict:src.copilot.sdk`
- [ ] ✅ Testes passam: `npm run test:copilot:unit`
- [ ] ✅ Lint pass: `npx eslint src/copilot/sdk`

Depois de implementar:

- [ ] Typecheck strict pass (zero errors)
- [ ] ESLint pass (zero violations)
- [ ] Testes pass (100% - 2594+)
- [ ] Nenhuma regressão

---

## 9. Próximos Passos

### Fase 3.2 Implementação

1. **Criar função auxiliar** com retry + timeout
2. **Integrar em verifySessionModelSwitch()**
3. **Adicionar testes** para 4 casos acima
4. **Validar todos gates**
5. **Documentar em JSDoc**

### Validação Pré-Deploy

- [ ] Feature works em isolamento
- [ ] Integração com session.setModel() OK
- [ ] Sem regressões em model cache
- [ ] Performance: < 600ms worst case
- [ ] Error handling robusto

---

## 10. Referências

**Arquivos Principais**:
- `src/copilot/sdk/session/runtime.js` — verifySessionModelSwitch()
- `src/copilot/sdk/rpc/session.js` — modelGetCurrent, modelSwitchTo

**Padrões JSDoc**:
- `@param {CopilotSession}`
- `@returns {Promise<...>}`
- `@typedef {object}`

**TypeScript Strict Config**:
- `config/typing/strict/tsconfig.strict.src.copilot.sdk.json`

---

**Status**: 🔬 Pronto para Implementação com Máximo Rigor

_Todos os problemas TypeScript mapeados, solução vetada, testes planejados._
