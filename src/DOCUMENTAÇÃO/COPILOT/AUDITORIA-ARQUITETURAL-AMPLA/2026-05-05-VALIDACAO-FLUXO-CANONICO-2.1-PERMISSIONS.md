# Validação do fluxo canônico 2.0/2.1 — SDK → Agent → Presentation → Terminal → Server (Permissions)

Data: 2026-05-05 Escopo: `src/copilot/**` com foco em permissões e governança operacional ponta a
ponta.

## 1) Situação atual validada (após consolidação)

## 1.1 SDK (núcleo canônico)

- Policy factory canônica consolidada em `src/copilot/sdk/session/permissions.js`.
- Regras semânticas de decisão alinhadas ao SDK (`approve-*`, `reject`, etc.).
- Regra de segurança para `content-exclusion-check` mantida no núcleo canônico (não auto-aprova).
- DTO normalizer canônico criado em `src/copilot/sdk/session/permission-events.js`.

## 1.2 Agent

- `PermissionController` mantém governança (`approve_all|audit_only|selective`) e agora usa policy
  do SDK canônico, sem depender de hooks como núcleo de policy.
- `AgentContext`/facades continuam oferecendo `set/getPermissionMode`, snapshots e handle de pending
  permission.

## 1.3 Presentation

- `runtime-sdk-session` expõe handling de pending permission para camadas acima.
- `runtime-controls` mantém governança runtime-aware como fonte de verdade de permission mode.

## 1.4 Terminal

- Observa `permission.requested/completed/mode_changed`.
- Opera governança (`/permission mode`) e resposta manual (`/permission respond`) no fluxo local.
- Estado local de permission agora interpreta eventos com contrato normalizado (menos drift
  semântico).

## 1.5 Server

- Rotas SDK RPC preservam o contrato canônico de pending permission handling.
- Sem alteração de contrato HTTP externo nesta rodada (compat preservada).

## 2) Fluxo canônico ponta a ponta (estado ideal atingido nesta faixa)

1. SDK emite evento bruto (`permission.requested|completed`).
2. `event-handlers/interaction-events` normaliza DTO de permission via módulo canônico.
3. Agent/EventBus propaga payload já normalizado.
4. Presentation/Gateway mantêm contratos estáveis e runtime-target.
5. Terminal renderiza/age sobre o mesmo contrato.
6. Server RPC e comandos locais convergem no mesmo handler de pending permission.

## 3) Arquiteturas paralelas detectadas e tratadas

### Tratado

- Duplicidade de policy (`hooks/permission-handler` vs `sdk/session/permissions`):
  - `hooks/permission-handler` virou compat layer delegando ao núcleo SDK.
  - Hooks deixaram de ser ponto central de policy.

### Remanescente controlado

- Presets legados de hooks ainda existem por compatibilidade de API, mas agora sem autoridade
  semântica própria de policy.

## 4) Gaps que ainda podem evoluir (não bloqueantes)

1. Endpoint/listagem ativa de pending permissions direto da sessão SDK (`/permission pending` por
   RPC) depende de namespace/operador disponível no SDK.
2. UX guiada de `/permission respond` (autocomplete + schema específico por tipo) pode ser
   expandida.
3. Métricas/SLO de latência request→completed podem ser promovidas para painel de compliance.

## 5) Critério de elegância arquitetural 2.1

- Núcleo semântico único em SDK/policy ✅
- Camadas superiores consumindo contratos normalizados (não parsing ad-hoc por camada) ✅
- Hooks como compatibilidade e não centralidade ✅
- Operação terminal completa e coerente com governança/modelo de runtime ✅

## 6) Evidência de validação

- Suites focadas de permissions/terminal verdes.
- Regressão terminal ampla verde (`56 arquivos`, `380 testes` pass, `1 skipped`).
- Lint/format/typecheck strict limpos no fechamento da rodada.
