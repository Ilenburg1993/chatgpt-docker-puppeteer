# 104 — Auditoria geral `src/copilot` 2026-05-04

**Data:** 2026-05-04  
**Escopo:** auditoria geral após leitura dos documentos 98–103 e varredura atual de `src/copilot`.

---

## 1) Síntese executiva

`src/copilot` está em estágio avançado de canonicidade por camadas: boot único, runtime registry,
presentation como projection plane, SDK boundary preservado e terminal consumindo
gateways/projections. A dívida atual deixou de ser “qual arquitetura escolher” e passou a ser
fechamento de arestas:

- timeline dual deixou de ser `PR`: a cauda viva agora tem sync lazy para o Conversation Hub, com
  estado exposto na UX, retry, TTL e telemetria;
- passthrough SSE residual precisa virar adapter dedicado ou ignore declarativo;
- hotspots grandes continuam exigindo decomposição semântica;
- multi-runtime/multi-agent já tem base de identity/profile, mas ainda precisa contratos de
  isolamento por stream/rate-limit/capability.

---

## 2) Evidências da auditoria

Leituras realizadas:

- documentos 98, 99, 100, 101, 102 e 103;
- árvore real de `src/copilot/**` e `tests/unit/copilot/**`;
- diff local atual em runtime targeting, SDK routes, webhooks e testes;
- varredura por sinais de bug: `runtimeId`, fallback, `AGENT_RUNTIME_NOT_FOUND`, `withErrorHandler`,
  `JSON.parse`, `process.exit`, TODO/FIXME e hotspots por tamanho.

Métrica estrutural observada:

- `src/copilot/**/*.js` soma cerca de 101k linhas;
- principais hotspots atuais incluem `agent/agent-context.js`, `agent/always-alive.js`,
  `terminal/sdk-session-events.js`, `sdk/session/lifecycle.js`, `channel/inject.js`,
  `server/routes/sdk/session-crud.js`, `terminal/commands/session.js` e
  `presentation/agent-control.js`.

---

## 3) Situação atual consolidada

| Área                   | Situação atual                                                               | Risco residual |
| ---------------------- | ---------------------------------------------------------------------------- | -------------- |
| Boot                   | caminho canônico `terminal/bootstrap -> bootCopilot`; shims removidos        | baixo          |
| Runtime selection      | operações SDK/presentation estritas para runtime explícito inexistente       | baixo/médio    |
| Projections de leitura | fallback default permitido apenas com metadata/warning                       | médio          |
| SDK HTTP routes        | composição por `deps.js`; projector de erro canônico expandido               | baixo/médio    |
| Terminal UX            | gateways/projections e W129 alinhados ao plano global                        | médio          |
| Timeline               | projection reconciliada com sync lazy, retry, TTL e telemetria               | baixo          |
| SSE terminal           | passthrough allowlist controlado, ainda residual                             | médio          |
| Multi-agent            | `agentProfileId` propagado; capabilities/profile ainda sem contrato completo | médio          |
| Observability/logging  | logger resiliente a TTY quebrado; rotas auxiliares agora com erro canônico   | baixo          |

---

## 4) Bug corrigido nesta rodada

**BUG-2026-05-04-01 — rotas SDK auxiliares escapavam do erro canônico de runtime.**

Evidência:

- `server/routes/sdk/agent.js` resolvia deps diretamente em `agent/tools`, `agent/telemetry` e
  `agent/telemetry/clear`;
- `server/routes/sdk/hooks.js` resolvia deps diretamente em `hooks/registry`;
- `server/routes/sdk/observability.js` resolvia deps diretamente em `otel-status`, `events/catalog`
  e `events/dead-letter`;
- `server/routes/webhooks.js` já retornava 404 para runtime inexistente, mas sem metadata canônica
  de targeting no corpo.

Impacto:

- um `runtimeId` explícito inexistente podia escapar para handler genérico ou resposta
  inconsistente, contrariando a E2 e o contrato `AGENT_RUNTIME_NOT_FOUND`.

Correção:

- as rotas passaram a usar o mesmo `withErrorHandler`/`projectSdkHttpError` das demais rotas SDK;
- webhooks passou a anexar `requestedRuntimeId`, `runtimeFound=false` e
  `usedDefaultRuntimeFallback=false` no 404 semântico;
- os testes focais agora cobrem client, sessions, agent, hooks, observability e webhooks.

Validação:

```bash
npx vitest run tests/unit/copilot/test_sdk_runtime_targeting_strict_routes.spec.js tests/unit/copilot/test_presentation_runtime_targeting_strict.spec.js
```

Resultado: 2 arquivos, 7 testes, todos verdes.

Validação ampliada posterior:

```bash
npx vitest run tests/unit/copilot/test_sdk_runtime_targeting_strict_routes.spec.js tests/unit/copilot/test_presentation_runtime_targeting_strict.spec.js tests/unit/copilot/test_webhooks_routes.spec.js tests/unit/copilot/sdk/test_sdk_server_rpc_health.spec.js tests/unit/copilot/test_sdk_api.spec.js
```

Resultado: 4 arquivos verdes, 1 skipped esperado, 41 testes verdes e 1 skipped.

Validação final:

```bash
npm run typecheck:strict
npx eslint src/copilot/server/routes/sdk/agent.js src/copilot/server/routes/sdk/hooks.js src/copilot/server/routes/sdk/observability.js src/copilot/server/routes/webhooks.js tests/unit/copilot/test_sdk_runtime_targeting_strict_routes.spec.js tests/unit/copilot/test_webhooks_routes.spec.js
```

Resultado: ambos verdes.

---

## 5) Nova situação ideal mais completa

1. Runtime explícito inexistente deve falhar antes de tocar estado vivo em toda rota operacional,
   stream ou mutação.
2. Projections informativas podem cair para default somente com `requestedRuntimeId`, `runtimeFound`
   e `usedDefaultRuntimeFallback` explícitos.
3. Toda rota que resolve deps deve estar sob projector HTTP do domínio, sem `throw` solto em
   handler.
4. Timeline reconciliada deve manter sync lazy como política final da UX, com lifecycle observável
   já implementado.
5. SSE raw residual deve ser classificado como adapter futuro ou ignore deliberado, com teste.
6. Multi-runtime deve provar isolamento por stream, rate-limit, ownership e sessão.
7. Multi-agent deve separar runtime instance, profile, tools/hooks/policies e capability snapshot.
8. Hotspots devem ser reduzidos por extração de seams com contrato, não por refactor cosmético.

---

## 6) Backlog objetivo

| Prioridade | Item                               | Próxima ação concreta                                      |
| ---------- | ---------------------------------- | ---------------------------------------------------------- |
| P1         | SSE passthrough residual           | criar matriz evento -> adapter/ignore/passthrough          |
| P1         | Runtime targeting em streams       | adicionar contratos para recusa antes de abrir SSE         |
| P2         | Hotspots SDK/session/agent-control | fatiar handlers preservando payloads públicos              |
| P2         | Multi-runtime isolation            | contratos para rate-limit/stream/session por `runtimeId`   |
| P2         | Multi-agent profile capabilities   | projection canônica de profile + capabilities              |
| P3         | Governança documental              | manter 100–104 como hub de estado vivo da convergência 2.1 |

---

## 7) Próxima transformação recomendada

E3 deixou de ser o último `PR` grande: a política de persistência foi fechada como lazy sync e o
ciclo associado foi implementado no terminal. A ordem recomendada agora é:

1. transformar passthrough SSE residual em adapters ou ignores declarativos;
2. ampliar contratos de stream/rate-limit por runtime;
3. continuar decomposição de hotspots sem reabrir fluxos paralelos.
