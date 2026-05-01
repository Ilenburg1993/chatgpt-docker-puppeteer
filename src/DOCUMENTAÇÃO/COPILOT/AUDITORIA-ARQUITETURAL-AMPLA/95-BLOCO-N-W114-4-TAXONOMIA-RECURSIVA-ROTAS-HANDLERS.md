# 95 — Bloco N / W114.4: taxonomia recursiva de `server/routes` e `terminal/handlers`

**Data:** 2026-05-01 **Escopo:** `src/copilot/server/routes/`, `src/copilot/terminal/handlers/`
**Status:** checkpoint executável W114.4

---

## 1) Situação validada

A raiz de `server/` e `terminal/` já estava navegável, mas os subdiretórios mais importantes ainda
misturavam responsabilidades sob nomes genéricos:

- `terminal/handlers` é pequeno e saudável: quase todos os arquivos são adapters finos para
  `presentation/`;
- `server/routes` mistura rotas históricas finas, SSE, Copilot API e SDK API;
- `server/routes/sdk` concentra os maiores hotspots da borda HTTP, especialmente session messaging,
  session CRUD e observability;
- `server/routes/copilot-api` ainda concentra lifecycle/control/tasks em arquivos que já merecem
  cortes físicos.

---

## 2) Decisão arquitetural

Esta onda não move endpoints. Ela cria contratos para orientar a próxima decomposição sem quebrar
compatibilidade:

1. `terminal/handlers/module-map.js` classifica handlers por papel e confirma que o diretório deve
   permanecer adapter fino de `presentation/`;
2. `server/routes/module-map.js` classifica todas as rotas de forma recursiva por `surface`, `role`,
   `tier` e `risk`;
3. `server/routes/README.md` e `terminal/handlers/README.md` passam a explicar a ordem de leitura e
   a regra para novos arquivos;
4. contratos em `test_module_layout_governance.spec.js` garantem cobertura total de JS, ausência de
   arquivos inexistentes, documentação dos papéis, exports dos mapas e marcação obrigatória de
   arquivos grandes como `watch`/`hotspot`;
5. `sdk/session-schemas.js` separa os schemas Zod de `sdk/session-middleware.js`, reduzindo um dos
   hotspots antes da decomposição maior de sessions;
6. scorecards beta em `server/routes/module-map.js` e `terminal/handlers/module-map.js` agregam
   contagens por papel, superfície e risco, antecipando a W115.

---

## 3) Hotspots formalizados

### SDK API

1. `sdk/session-messaging.js` — messaging, stream, workspace, UI, permissions, tools, compaction e
   shell no mesmo arquivo.
2. `sdk/session-crud.js` — inventory, foreground, create/resume, delete/disconnect e compaction
   history no mesmo arquivo.
3. `sdk/observability.js` — health, metrics, quota, errors, logs, audit e event catalog juntos.
4. `sdk/agent.js` e `sdk/client.js` — HTTP control e SSE/helper logic no mesmo módulo.
5. `sdk/session-middleware.js` — deixou de conter schemas; permanece como `watch` para rate-limit,
   error wrapper e model sanitizer.

### Copilot API

1. `copilot-api/control.js` — lifecycle, permissions, steering, status e session payloads juntos.
2. `copilot-api/tasks.js` — enqueue, pending questions, shadow, SDK elicitation e timeout policy
   juntos.

---

## 4) Próxima execução recomendada

1. Extrair `server/routes/sdk/session-messaging` para subpastas ou seams locais por família:
   `messaging`, `stream`, `workspace`, `ui`, `permissions-tools`, `compaction`, `shell`.
2. Extrair `server/routes/sdk/session-crud` para `inventory`, `foreground`, `lifecycle` e
   `destructive`.
3. Extrair `server/routes/sdk/observability` para `health-metrics`, `errors-logs`, `audit` e
   `events`.
4. Depois repetir o mesmo padrão em `copilot-api/control` e `copilot-api/tasks`.

Critério: cada movimento físico deve preservar endpoints públicos, manter o router composition
estável e atualizar o module map antes de alterar novos arquivos.
