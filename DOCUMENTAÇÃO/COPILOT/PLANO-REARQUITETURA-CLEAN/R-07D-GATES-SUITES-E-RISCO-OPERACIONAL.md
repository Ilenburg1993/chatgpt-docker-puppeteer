# R-07D — Gates, Suites Mínimas e Baseline de Risco Operacional

**Programa**: P0 / Faixa A
**Data-base**: 2026-04-16
**Status**: canônico para quality/security gate do ciclo clean

---

## 1. Propósito

Este documento fecha a parte normativa da Faixa A.

Ele define:

- quality gates por programa;
- security gates por superfície crítica;
- suites mínimas por tipo de mudança;
- e o baseline atual de risco operacional que as próximas ondas devem reduzir.

---

## 2. Quality gates por programa

| Programa                                    | Gate mínimo por checkpoint                                                                                                        | Gate ampliado / gate de saída                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P0 — governança e baseline                  | consistência documental, links internos, `npm run lint`, `npm run format:check` quando houver edição em docs/config compartilhada | `LINK_CHECK_OK` + sincronização explícita dos hubs (`README`, `R-07`, `R-16`, docs derivados) |
| P1 — `agent/`                               | `npm run lint`, `npm run typecheck:node`, suites focadas do eixo alterado                                                         | `npm run test:unit` ou regressão ampla equivalente do eixo `agent/`                           |
| P2 — `sdk/`                                 | `npm run lint`, `npm run typecheck:node`, suites focadas de sessão/wrapper                                                        | `npm run test:unit` + validação dos principais consumidores do wrapper                        |
| P3 — eventos/hooks/observability            | `npm run lint`, suites focadas, `npm run analyze:events:ssot` quando naming/eventos forem tocados                                 | suites de contrato do domínio + revisão de projections de health/erro                         |
| P4 — `server/`/`terminal/`/`channel/`/`hub` | `npm run lint`, `npm run typecheck:node`, testes focados de rotas/handlers/contracts                                              | `npm run test:integration` sempre que SSE/Socket/HTTP runtime for tocado de forma relevante   |
| P5 — tools/config/core/infra/types          | `npm run lint`, `npm run typecheck:node`, testes focados das superfícies afetadas                                                 | `npm run test:unit` + checks específicos de env/config quando aplicável                       |
| P6 — segurança/qualidade/governança         | `npm run lint`, `npm run format:check`, `npm run typecheck:node`, suites focadas                                                  | `npm run validate:all` ou composição equivalente quando o checkpoint cruzar múltiplas bordas  |
| P7 — capabilities avançadas                 | gate do programa estrutural que a capability toca + testes focados próprios                                                       | só entra se não violar gates de base e não reabrir acoplamento estrutural                     |

### Regra prática

Se a mudança cruzar **mais de um programa estrutural** ao mesmo tempo, o gate mínimo sobe para:

- `npm run lint`
- `npm run format:check`
- `npm run typecheck:node`
- `npm run test:unit`

E `test:integration` passa a ser obrigatório se `server/`, SSE, Socket ou runtime distribuído
tiverem mudado de forma material.

---

## 3. Security gates por superfície crítica

| Superfície                              | Gate mínimo obrigatório                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP / REST / control routes            | auth ou `skipAuth` explicitamente declarado; validação de body/params/query; request-id; error handler; security headers; rate limiting quando a superfície for mutante ou sensível |
| SSE / Socket / realtime                 | autenticação explícita quando exigida; namespaces/transports documentados; retry/backpressure observáveis; testes de contrato das projections                                       |
| Agent control / permissions             | admin auth explícita; nenhuma regressão no fluxo de permissões; logs/trilha mínima de auditoria                                                                                     |
| Tools de shell / file / web             | permission flow preservado; validação de path/URL; SSRF/path traversal cobertos; testes focados das superfícies sensíveis                                                           |
| SDK API / session routes                | auth/token explícito; body validation; nenhuma reintrodução de ownership de sessão no wrapper fino                                                                                  |
| Terminal / REPL                         | nenhum novo import estrutural `server → terminal`; nenhuma expansão difusa de DI sem wiring explícito; preservação da interface operacional da LLM-B                                |
| Persistence / state / background writes | writes tracked quando forem fire-and-forget; sem swallow silencioso em I/O crítico; health/snapshot alinhados ao state ownership                                                    |

---

## 4. Suites mínimas por tipo de mudança

## 4.1 Docs / roadmap clean only

- validação de links internos da linha clean;
- revisão de consistência entre `README`, `R-07`, `R-16` e artefatos derivados;
- não exige runtime test quando o checkpoint for exclusivamente documental.

## 4.2 Runtime do `agent/`

- `npm run lint`
- `npm run typecheck:node`
- suites focadas do eixo alterado (`agent/`, `dialog/`, `lifecycle/`, `session/`, `health`)
- regressão ampla do eixo `agent/` antes de fechamento de fase.

## 4.3 `sdk/` e fronteiras de sessão

- `npm run lint`
- `npm run typecheck:node`
- suites focadas de `sdk/session/*`, wrappers e consumidores principais
- contract tests de ownership quando o change tocar sessão/registry.

## 4.4 `server/` / `presentation/` / `terminal/`

- `npm run lint`
- `npm run typecheck:node`
- testes focados `node:test` e/ou `vitest` das rotas/handlers/shared surfaces
- `npm run test:integration` se a mudança tocar Express/SSE/Socket de forma material.

## 4.5 Eventos / hooks / observability

- `npm run lint`
- suites focadas do subsistema
- `npm run analyze:events:ssot` quando houver mudança de naming/event schemas
- validação explícita de projections de health/erro quando afetadas.

## 4.6 Tools e superfícies sensíveis

- `npm run lint`
- suites focadas das tools afetadas
- verificação das regras de permissão e validação da superfície
- quando aplicável, `npm run audit:security` como checagem ampliada.

---

## 5. Baseline de risco operacional

| ID   | Risco                                                         | Sinal atual                                                            | Impacto          | Programas de redução imediata |
| ---- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------- | ----------------------------- |
| R-01 | ownership de sessão ainda difuso                              | `agent/`, `sdk/` e `conversation-hub/` ainda dividem responsabilidades | alto             | P1 + P2 + P4                  |
| R-02 | difusão excessiva de `observability/`                         | 97 importadores diretos                                                | alto             | P3 + P6                       |
| R-03 | wrapper SDK ainda vaza demais                                 | 95 importadores fora de `sdk/`                                         | alto             | P2                            |
| R-04 | compatibilidade residual prolongada                           | 20 referências a deprecated + múltiplos shims ativos                   | alto             | P1 + P6                       |
| R-05 | swallow silencioso de erro                                    | 12 `catch {}` silenciosos no recorte                                   | médio-alto       | P1 + P6                       |
| R-06 | superfícies críticas dependem de configuração correta de auth | middleware libera rotas quando token terminal não está definido        | alto condicional | P4 + P6                       |
| R-07 | terminal ainda carrega DI interna alta                        | 73 ocorrências medidas no recorte auditado do módulo                   | médio-alto       | P4 + P6                       |
| R-08 | modelo de eventos custa caro de governar                      | 733 referências a EventBus/emissão                                     | alto             | P3                            |
| R-09 | docs clean podem envelhecer rápido sem baseline comum         | snapshot anterior já estava defasado em múltiplos arquivos             | médio            | P0 + P6                       |

### Regra de priorização de risco

Quando um checkpoint competir com outro, vence o item que:

1. reduz risco alto em superfície central;
2. diminui acoplamento estrutural mensurável;
3. preserva ou aumenta governança de teste/segurança;
4. não cria nova compatibilidade residual sem data de saída.

---

## 6. Done mínimo do ciclo clean

Nenhuma fase deve ser considerada “pronta” se o resultado não deixar explícito:

- qual SSOT ficou mais clara;
- qual acoplamento caiu;
- quais suites foram rodadas;
- quais riscos subiram, caíram ou ficaram inalterados;
- e que parte do backlog estrutural isso realmente fechou.

Se o checkpoint só muda código e não melhora nenhuma dessas cinco respostas, ele ainda não cumpriu a
governança da linha clean.

---

## 7. Relação com os próximos programas

Este documento não substitui P1–P6. Ele impõe o chão deles.

Em especial:

- P1 usa estas regras para decidir quando um shim pode morrer;
- P2 usa estas regras para impedir que o SDK continue dono de sessão;
- P3 usa estas regras para governar eventos/observability como contratos, não como costume local;
- P4 usa estas regras para separar `server/`, `presentation/` e `terminal/` sem amputar a LLM-B;
- P6 usa estas regras para transformar qualidade/segurança/documentação em gates, não apêndices.
