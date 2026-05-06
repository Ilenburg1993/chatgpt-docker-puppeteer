# Roadmap — Permissions end-to-end (`src/copilot`)

Data base: 2026-05-05

## Fase P0 — Estabilização crítica (concluída)

- [x] Corrigir classificação semântica de decisão em audit pipeline (`approve-*` vs `approved`).
- [x] Corrigir diretório de escrita do permission audit log.
- [x] Preservar `requestId`/`result` nos eventos de permission.
- [x] Expor `permissionsHandlePending` no terminal via `/permission respond`.
- [x] Refletir `permission.mode_changed` na UX live.
- [x] Cobrir com testes unitários focados.

## Fase P1 — Consolidação canônica (próxima)

Objetivo: eliminar drift arquitetural e reduzir manutenção duplicada.

1. **Unificar policy factory**
   - Definir módulo único para `createPermissionHandler` e presets base.
   - Migrar `sdk/session/permissions.js` para delegar explicitamente ao núcleo canônico.
   - Garantir compat no barrel `#copilot/sdk` sem ciclos ESM.

2. **Contrato permission DTO único**
   - Criar normalizer canônico para payload de `permission.requested/completed`.
   - Reutilizar normalizer em event-handlers, observability e terminal adapters.

3. **Instrumentação unificada**
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
