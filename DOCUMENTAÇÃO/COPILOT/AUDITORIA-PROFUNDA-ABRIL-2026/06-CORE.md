# 06-CORE — Auditoria do Módulo `core/`

**Auditoria Profunda de `src/copilot`** · Abril 2026
**Módulo**: `src/copilot/core/`
**Documentado em**: 2026-04-18

---

## 1. Mapa do Módulo

```
core/
├── event-bus.js           (EventBus — bus customizado com namespaces, wildcards, middleware)
├── di-container.js        (DIContainer — registro e resolução de tokens DI)
├── circuit-breaker.js     (CircuitBreaker — padrão de resiliência)
├── error-handlers.js      (logSwallowed, toError)
├── errors.js              (hierarquia CopilotError)
├── interfaces.js          (IAgent, IBridge — contratos de interface)
├── schemas.js             (HealthResponseSchema, schemas Zod)
├── index.js               (barrel)
└── types.js               (typedefs centrais)
```

---

## 2. Arquivo: `event-bus.js`

### 2.1 BUG CRÍTICO — `#deliver()` com Async Handlers (CAT-007 / BUG-CORE-01)

> **Status de execução (2026-04-17): corrigido no código.**
> `src/copilot/core/event-bus.js` agora usa `Promise.resolve(handler(event)).catch(...)` em `once()` e em `#deliver()`, eliminando a janela de `UnhandledPromiseRejection` para handlers assíncronos.

**Código atual:**

```js
#deliver(event) {
    const { type } = event;
    const direct = this.#listeners.get(type);
    if (direct) {
        for (const handler of direct) {
            try {
                void handler(event);  // ← PROBLEMA AQUI
            } catch (_) {
                /* handler errors are swallowed */
            }
        }
    }
    // mesmo padrão para namespace wildcard `session:*` e global `*`
}
```

**Problema**: `void handler(event)` descarta a Promise retornada por handlers assíncronos.
O `try/catch` **só captura erros síncronos** — rejeições de `async` handlers se tornam **unhandled Promise rejections**.

Em Node.js 24+, `unhandledRejection` por padrão **termina o processo** (modo `throw`).

**Impacto**: Qualquer handler assíncrono registrado no EventBus que rejeitar vai crashar o processo de produção.

**Achado**:

| ID                        | Sev               | Arquivo                     | Descrição                                                                                                                           |
| ------------------------- | ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **BUG-CORE-01** / CAT-007 | **P0 (CRITICAL)** | `core/event-bus.js:259-290` | `void handler(event)` — async rejections se tornam unhandled rejections que podem crashar Node.js 24+ — **corrigido em 2026-04-17** |

**Correção**:

```js
// Opção 1: catch por handler
try {
    const result = handler(event);
    if (result instanceof Promise) {
        result.catch((err) => {
            log('WARN', `[EventBus] handler assíncrono lançou erro para '${type}': ${toError(err).message}`);
        });
    }
} catch (err) {
    log('WARN', `[EventBus] handler síncrono lançou erro para '${type}': ${toError(err).message}`);
}

// Opção 2: Promise.resolve wrapper
Promise.resolve(handler(event)).catch((err) => {
    log('WARN', `[EventBus] handler error for '${type}': ${err}`);
});
```

### 2.2 Análise do Middleware Chain

```js
const deliver = () => {
    if (idx < mw.length) {
        const fn = mw[idx++];
        if (fn) fn(event, deliver);
    } else {
        this.#deliver(event);
    }
};
deliver();
```

| ID              | Sev | Descrição                                                                                                                                                                                                                                                    |
| --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-CORE-01** | P2  | Se um middleware é assíncrono e chama `deliver()` dentro de um `await`, o fluxo se rompe — `deliver()` retorna antes do middleware completar, e o próximo middleware pode executar antes do anterior terminar. O middleware chain assume handlers síncronos. |

> **Status de execução (2026-04-17): mitigado no código.**
> `emit()` agora delega para `#runMiddlewareChain(event)` com suporte a middlewares síncronos e assíncronos, preservando o contrato fire-and-forget.

### 2.3 `dispose()` sem Verificação de Emits Pendentes

```js
dispose() {
    this.#listeners.clear();
    this.#middleware.length = 0;
    this.#counters.clear();
    this.#disposed = true;
}
```

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                                                    |
| --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-CORE-02** | P3  | `dispose()` limpa imediatamente, mas se `emit()` está em andamento concorrentemente (em handler async), a limpeza pode causar iteração sobre `#listeners` já limpo. Em JavaScript single-thread com event loop não é um problema síncrono, mas promises em andamento pós-dispose podem acessar estado limpo. |

---

## 3. Arquivo: `di-container.js`

Analisado indiretamente via `di-wiring.js` e `bootstrap.js`.

**Positivo**:
- `container.validateRequired(tokens)` — validação declarativa de tokens obrigatórios
- Token-based registration via `container.register(TOKEN, value)`

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                          |
| --------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-CORE-03** | P3  | Container DI é singleton global. Sem suporte a `scope` (por request / por sessão). Todos os tokens são efetivamente singletons. Para componentes que deveriam ser por-sessão (ex: SessionKeepalive), a arquitetura força uso de `new X()` fora do container — sem rastreamento DI. |

---

## 4. Arquivo: `circuit-breaker.js`

| ID              | Sev | Descrição                                                                                                                                                                                                                            |
| --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-CORE-04** | P3  | `CircuitBreaker` implementado para operações de **conexão** (`sdkConnectionCircuitBreaker`). Não há circuit breaker para operações de **escrita** (ex: `storage.writeJson`) — que podem falhar por quota de disco ou arquivo locked. |

---

## 5. Arquivo: `error-handlers.js`

### `logSwallowed(error, context)`

```js
export function logSwallowed(err, context = 'unknown') {
    log('WARN', `[${context}] Erro engolido: ${toError(err).message}`);
}
```

**Positivo**: Substitui silently swallowed errors por log de WARN — rastreabilidade melhorada.

**Achado**:

| ID              | Sev | Descrição                                                                                                                                                                                                                                          |
| --------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-CORE-05** | P3  | `logSwallowed` loga em `WARN` mas não incrementa nenhum contador/métrica. Em produção, um pico de erros engolidos pode passar despercebido se só usar logs. Deveria também incrementar `defaultMetrics.increment('error.swallowed', { context })`. |

---

## 6. Resumo de Achados do Módulo Core

| ID                        | Severidade        | Arquivo                | Descrição                                                                              |
| ------------------------- | ----------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| **BUG-CORE-01** / CAT-007 | **P0 (CRITICAL)** | `event-bus.js:259-290` | Async handler rejections → unhandled → crash Node.js 24+ — **corrigido em 2026-04-17** |
| GAP-CORE-01               | P2                | `event-bus.js`         | Middleware chain não suporta async middlewares — **mitigado em 2026-04-17**            |
| GAP-CORE-02               | P3                | `event-bus.js`         | `dispose()` sem espera de promises em voo                                              |
| GAP-CORE-03               | P3                | `di-container.js`      | Container não suporta escopos por sessão                                               |
| GAP-CORE-04               | P3                | `circuit-breaker.js`   | CB apenas para conexão, não para escrita/storage                                       |
| GAP-CORE-05               | P3                | `error-handlers.js`    | `logSwallowed` sem métrica incremental                                                 |

### Severidade Geral do Módulo: **P0 (CRÍTICO)**

BUG-CORE-01 foi o bug mais severo encontrado nesta auditoria. Ele já está corrigido no código atual, mas continua importante como referência arquitetural para novos handlers.

---

*Próximo: [07-SERVER.md](./07-SERVER.md)*
