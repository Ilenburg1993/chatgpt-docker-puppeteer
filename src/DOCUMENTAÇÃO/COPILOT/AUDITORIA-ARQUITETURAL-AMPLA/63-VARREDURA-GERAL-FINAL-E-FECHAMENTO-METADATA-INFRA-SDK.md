# 63 — Varredura geral final e fechamento de metadata runtime em infra SDK

**Data:** 2026-04-30 **Escopo:** `server/routes/sdk/sessions.js`,
`server/routes/sdk/session-middleware.js`, contratos arquiteturais.

---

## 1) Objetivo

Executar uma varredura geral de pendências reais da migração 2.0 e fechar o último gap técnico de
propagação de metadata runtime no adapter SDK de sessões.

---

## 2) Gaps encontrados na varredura

A inspeção factual do código/contratos mostrou que a maioria dos handlers já propagava metadata
canônica, mas ainda havia dois caminhos infra sem cobertura:

- `401 Unauthorized` em `sdk/sessions.js`;
- erros `400/429/500` em `sdk/session-middleware.js`.

Esses caminhos eram importantes porque ficam fora dos handlers principais de CRUD/messaging e podiam
quebrar consistência de payload runtime em cenários reais de autenticação, validação e rate
limiting.

---

## 3) Transformações aplicadas

### 3.1 `sdk/sessions.js`

- autenticação por token passou a incluir metadata runtime no `401`:
  - `runtimeId`
  - `requestedRuntimeId`
  - `runtimeFound`
  - `usedDefaultRuntimeFallback`

### 3.2 `sdk/session-middleware.js`

- novo helper defensivo `buildSessionRouteRuntimeMeta(req)`;
- respostas infra agora incluem metadata runtime:
  - `429` (rate limiter);
  - `400` (`validateBody`);
  - `500` (`withErrorHandler`).

---

## 4) Contratos atualizados

- `tests/unit/copilot/contracts/test_arch_contracts.spec.js`:
  - nova asserção exigindo metadata runtime nesses fluxos infra de sessões SDK;
  - bloqueio explícito para regressão de payloads triviais sem metadata.

---

## 5) Validação executada

- `test_runtime_state_registry_inventory` — verde;
- `test_runtime_state_governance` — verde;
- `test_arch_contracts` — verde;
- `test_sdk_runtime_projection_routes` — verde;
- `typecheck:strict:src.copilot` — verde;
- `eslint` focado — verde.

---

## 6) Resultado arquitetural

Após esta onda, a propagação de metadata runtime no SDK adapter cobre não só os caminhos de negócio,
mas também erros de infraestrutura no eixo de sessões (auth/validation/rate-limit/fail-safe).

Isso reduz ambiguidade operacional de multi-runtime e fecha um gap residual de Faixa F/G com
contrato executável.
