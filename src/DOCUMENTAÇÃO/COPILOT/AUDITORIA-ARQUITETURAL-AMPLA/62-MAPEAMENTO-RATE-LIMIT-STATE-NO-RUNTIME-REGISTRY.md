# 62 — Mapeamento do estado de rate limit no runtime registry

**Data:** 2026-04-30 **Escopo:** `src/copilot/server/routes/sdk/session-middleware.js` e
`src/copilot/server/runtime-state/*`.

---

## 1. Objetivo

Fechar o último estado mutável module-level relevante ainda remanescente em `server/routes/sdk/*`:

- `_rlWindowMap` em `session-middleware`.

A convergência desta onda aplica a mesma regra já usada em SSE/concorrência multi-runtime:

> política na rota/middleware, estado vivo process-wide em registry explícito e nomeado.

---

## 2. Transformação aplicada

### Antes

`session-middleware.js` mantinha localmente:

- `const _rlWindowMap = new Map()`

com purge por janela e controle de contagem por `label:ip`.

### Depois

Foi criado:

- `src/copilot/server/runtime-state/sdk-session-rate-limit.js`

com API explícita para iterar/ler/escrever/remover janelas de rate limit.

`session-middleware.js` passou a consumir somente esse registry:

- `iterateSdkSessionRateLimitWindows()`;
- `getSdkSessionRateLimitWindow()`;
- `setSdkSessionRateLimitWindow()`;
- `deleteSdkSessionRateLimitWindow()`.

---

## 3. Contratos atualizados

- `tests/unit/copilot/contracts/test_runtime_state_registry_inventory.spec.js`
  - inventário de `server/runtime-state` atualizado com `sdk-session-rate-limit.js`;
  - `session-middleware` agora deve importar o registry explícito;
  - regressão para `new Map()` local no middleware bloqueada por contrato.

- `src/copilot/server/runtime-state/README.md`
  - categoria de rate-limit state adicionada à lista oficial de registries.

---

## 4. Validação executada

- `test_runtime_state_registry_inventory` — verde;
- `test_runtime_state_governance` — verde;
- `test_arch_contracts` — verde;
- `test_sdk_runtime_projection_routes` — verde;
- `typecheck:strict:src.copilot` — verde;
- `eslint` focado nos arquivos tocados — verde.

---

## 5. Leitura arquitetural

Este ajuste completa a convergência da família de estados vivos de `server/routes/sdk/*` para
registries explícitos em `server/runtime-state/`.

Com isso:

- rotas e middlewares permanecem donas da política;
- o estado mutável process-wide deixa de ficar escondido em módulos de borda;
- Gate 2.0-D ganha cobertura adicional para infra de rate limiting, não apenas SSE/concorrência.
