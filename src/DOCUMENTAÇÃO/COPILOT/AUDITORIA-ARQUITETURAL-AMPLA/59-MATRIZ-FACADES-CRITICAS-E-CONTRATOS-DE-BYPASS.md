# 59 — Matriz de facades críticas e contratos de bypass (`src/copilot/agent`)

**Data:** 2026-04-29 **Escopo:** `src/copilot/agent/facades/*` + contratos estruturais em
`tests/unit/copilot/contracts/`

---

## 1) Objetivo

Este documento fecha o gap da Faixa E do 58, consolidando:

1. **owners claros por facade crítica**;
2. **tipos de bypass proibidos**;
3. **contratos executáveis existentes**;
4. **próximas ações para completar o congelamento semântico**.

---

## 2) Matriz de ownership por facade crítica

| Facade                        | Owner semântico principal                    | Tipo de operação            | Consumidores principais                          |
| ----------------------------- | -------------------------------------------- | --------------------------- | ------------------------------------------------ |
| `agent-runtime-state`         | estado persistido de runtime/dialog          | query + mutation persistida | `dialog/*`, `session/*`, `lifecycle/*`           |
| `agent-runtime-controls`      | controles do runtime vivo e governança       | query + command             | `always-alive`, `presentation/runtime-controls`  |
| `agent-sdk-access`            | lifecycle vanilla do SDK + handles canônicos | command + query             | `session/*`, `lifecycle/*`, `facades/*`          |
| `agent-sdk-runtime`           | send/read/events de sessão SDK               | command + stream            | `agent/session-ops`, `presentation/sdk-sessions` |
| `agent-health-access`         | insumos agregados para health/status         | query                       | `health-check`, `presentation/runtime-health`    |
| `ports/*` (finas por domínio) | observability/tools/hooks/mcp/conversation   | ports/adapters              | `agent/*` (sem aggregate god-port)               |

---

## 3) Bypasses proibidos (regras atuais)

### 3.1 Runtime-state

- `dialog/*` **não** importa `lifecycle/state-io.js` diretamente para estado semântico;
- `boot-steps` **não** persiste shadow/dialogPaused inline;
- `turn-executor`/`loop-manager` **não** chamam `persistStateWithPolicy` cru para semântica de
  runtime.

### 3.2 Runtime-controls

- `always-alive` **não** lê/muta `ctx` diretamente nos eixos de interação/governança já cobertos;
- leitura de status/queue/pending question passa por snapshots canônicos.

### 3.3 SDK-access / SDK-runtime

- `agent/lifecycle` e `agent/session` **não** chamam lifecycle cru do SDK fora dos seams oficiais;
- bridges de boot/lifecycle/quota usam surface semântica dedicada.

### 3.4 External -> agent

- módulos fora de `agent/` **não** importam `agent/facades/*` nem `agent/error-policy.js`
  diretamente;
- fronteira pública esperada: `#copilot/agent`.

---

## 4) Contratos executáveis mapeados

Principal suíte:

- `tests/unit/copilot/contracts/test_arch_contracts.spec.js`;
- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`;
- `tests/unit/copilot/contracts/test_facade_bypass_matrix.spec.js`.

Cobertura atual relevante:

- anti deep-import externo de facades/error-policy;
- fronteira agent→sdk (sem deep imports fora de facades/ports);
- sem bypass de state-io em `dialog/*`;
- sem bypass de lifecycle cru do SDK em `agent/lifecycle` e `agent/session`;
- contracts de rotas SDK para projections runtime-aware;
- contract novo de Faixa B: `session/lifecycle` depende de `session/model-resolution-port`, não do
  barrel `models/index`.
- matriz granular por facade crítica (consumidores permitidos):
  - `agent-runtime-state`;
  - `agent-runtime-controls`;
  - `agent-health-access`;
  - `agent-sdk-access` e `agent-sdk-runtime`.

---

## 5) Gap residual (Faixa E)

Itens ainda abertos para “congelamento total”:

1. **redução de imports cruzados entre facades**
   - especialmente quando houver fluxo query-only que pode ser resolvido por helper mais fino;
2. **matriz de contrato por tipo de operação**
   - separar tests de query-only vs mutation-only vs lifecycle bridge;
3. **cobertura complementar de facades secundárias**
   - expandir o mesmo padrão para `agent-runtime-tools`, `agent-runtime-webhooks` e
     `agent-runtime-todos`.

---

## 6) Próxima onda recomendada

1. Expandir `test_facade_bypass_matrix.spec.js` para facades secundárias (tools/webhooks/todos);
2. Aplicar 1 refactor de baixo risco para reduzir import cruzado entre facades em
   `agent-runtime-capabilities`;
3. Introduzir contratos por tipo de operação (query/mutation/lifecycle) para fortalecer ownership.

Com isso, o bloco E deixa de ser “parcialmente coberto” e vira governança executável completa.
