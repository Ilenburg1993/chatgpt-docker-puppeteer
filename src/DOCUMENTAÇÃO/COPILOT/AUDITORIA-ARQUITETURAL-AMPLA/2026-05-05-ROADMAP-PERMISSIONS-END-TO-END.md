# Roadmap — Permissions end-to-end (`src/copilot`)

Data base: 2026-05-05

## Fase P0 — Estabilização crítica (concluída)

- [x] Corrigir classificação semântica de decisão em audit pipeline (`approve-*` vs `approved`).
- [x] Corrigir diretório de escrita do permission audit log.
- [x] Preservar `requestId`/`result` nos eventos de permission.
- [x] Expor `permissionsHandlePending` no terminal via `/permission respond`.
- [x] Refletir `permission.mode_changed` na UX live.
- [x] Cobrir com testes unitários focados.

## Fase P1 — Consolidação canônica (concluída)

Objetivo: eliminar drift arquitetural e reduzir manutenção duplicada.

1. **Unificar policy factory** ✅
   - Definir módulo único para `createPermissionHandler` e presets base.
   - Migrar `sdk/session/permissions.js` para delegar explicitamente ao núcleo canônico.
   - Garantir compat no barrel `#copilot/sdk` sem ciclos ESM.

2. **Contrato permission DTO único** ✅
   - Criar normalizer canônico para payload de `permission.requested/completed`.
   - Reutilizar normalizer em event-handlers, observability e terminal adapters.

3. **Instrumentação unificada** ✅
   - Normalizar taxonomia de decision no audit log/hook/evento (`approved|denied` + kind bruto).

## Fase P2 — UX operacional avançada

1. **`/permission pending` por RPC**
   - Listagem ativa de permissões pendentes direto da sessão SDK quando namespace `permissions`
     estiver disponível.

2. **`/permission respond` guiado**
   - Assistente interativo com autocomplete de `decision kind` e validação de payload específico.

3. **Cockpit de governance**
   - Painel curto com modo atual + últimos mode changes + pendências por tipo + quick actions.

## Fase P3 — Hardening e observabilidade

1. **Testes de integração cruzada**
   - Simular fluxo real: request → respond → completed com requestId correlacionado.

2. **SLO de permission loop**
   - Tempo entre `permission.requested` e `permission.completed` por tipo.
   - Alertas para pendências prolongadas.

3. **Relatório de compliance operacional**
   - Exportar histórico de mudanças de mode + decisões em alto risco.

## Critérios de pronto (estado ideal)

- Não há duplicidade semântica entre módulos de permission policy.
- Todo evento de permission é correlacionável por `requestId` e semanticamente consistente.
- Terminal consegue observar, governar e resolver pendências sem via paralela obrigatória.
- Audit trail representa corretamente decisões SDK e suporta diagnóstico confiável.

## Addendum 2026-05-06 — pós-validação arquitetural ampla

Status factual após a rodada geral em `src/copilot`:

- **P1 permanece concluída e agora validada contra guardrails estruturais.**
  - `hooks/permission-handler.js` é compat layer e importa a policy canônica via `#copilot/sdk`.
  - `sdk/session/permission-events.js` concentra normalização de DTOs de `permission.requested` e
    `permission.completed`.
  - Event handlers, observability e terminal consomem o contrato normalizado.

- **Correções de anti-regressão aplicadas fora do fluxo direto de permissions.**
  - `terminal/module-map.js` passou a declarar `ui-preferences.js` e `ui-theme.js`.
  - `terminal/sdk-interactions.js` e `server/routes/sdk/deps.js` foram promovidos para `hotspot`
    porque já cruzaram o limite executável de arquivos muito grandes.
  - `config/system-prompt/sdk-introspection.js` deixou de chamar `session.rpc.instructions`
    diretamente; a chamada agora passa por `sdk/rpc/session.js` via `instructionSourcesGet`.

- **Validações pós-ajuste.**
  - `npm run check:copilot:guardrails`: verde.
  - Suites focadas de permissions, terminal, system prompt, RPC e module layout: verdes.

### Reclassificação da P2/P3

- **P2 continua aberta**, mas agora é backlog funcional, não dívida de canonicidade:
  `/permission pending` por RPC, UX guiada para `/permission respond` e cockpit de governance.
- **P3 continua aberta**, com foco em SLO/compliance e métricas request→completed.
- Próximo corte recomendado: implementar listagem ativa de pending permissions somente quando a
  surface SDK/RPC oferecer contrato observável suficiente; até lá, manter estado observado local
  como fonte operacional do terminal.

## Addendum 2026-05-06 — P2 operacional parcialmente fechada

- `/permission pending` já consulta a sessão SDK quando o namespace expõe
  `permissions.listPendingPermissionRequests` ou `permissions.listPendingRequests`.
- Quando a listagem ativa está indisponível, o comando informa fallback explícito para o estado
  observado local.
- Quando a listagem ativa retorna requests, esses requests hidratam o estado local do terminal para
  que `/permission respond <id>` continue sendo a borda única de resolução.
- Teste live com `npm run terminal:llm-b` confirmou que `/permission pending` funciona em runtime
  real sob `rate_limit` externo, sem travar o terminal.

Reclassificação:

- **P2.1 `/permission pending` por RPC:** concluída.
- **P2.2 `/permission respond` guiado:** parcialmente concluída pela validação de payload; falta UX
  interativa/autocomplete.
- **P2.3 cockpit de governance:** aberto.
- **P3 request → respond → completed com correlação:** aberto.
