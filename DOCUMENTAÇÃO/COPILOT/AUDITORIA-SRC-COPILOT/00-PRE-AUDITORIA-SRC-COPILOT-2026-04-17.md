# Pré-auditoria ampla de `src/copilot`

Data: `2026-04-17`

## Objetivo

Fazer uma leitura exploratória ampla de `src/copilot` antes da auditoria completa, levantando:

- baseline de complexidade e risco;
- hotspots arquiteturais;
- gargalos de teste e operabilidade;
- primeiros bugs/gaps de alta confiança;
- backlog para aprofundamento posterior.

## Escopo real coberto nesta pré-auditoria

- árvore inteira de `src/copilot` (`452` arquivos);
- leitura focal em `agent`, `conversation-hub`, `channel`, `server`, `sdk`, `observability`, `tools`, `core`, `infra`, `config`;
- inspeção direta de arquivos críticos e de arquivos abertos no IDE:
  - `src/copilot/agent/session/boot-steps.js`
  - `src/copilot/agent/always-alive.js`
  - `src/copilot/server/routes/health-registry.js`
  - `src/copilot/observability/event-bus-runtime.js`
  - `src/copilot/conversation-hub/store.js`
  - `src/copilot/channel/client.js`
- varredura `grep-first` por timers, `JSON.parse`, `logSwallowed`, `catch(_)`, `process.exit`, TODO/FIXME/HACK/XXX;
- leitura de testes `copilot` e de scripts do `package.json`.

## Baseline levantado

### Métricas estruturais

- `452` arquivos em `src/copilot`
- `66.864` linhas totais
- `69` arquivos com mais de `300` linhas
- `7` arquivos com mais de `500` linhas
- maiores hotspots:
  - `src/copilot/terminal/frontend/llm-b-frontend.js` (`711`)
  - `src/copilot/sdk/types.js` (`700`)
  - `src/copilot/agent/always-alive.js` (`638`)
  - `src/copilot/agent/dialog/loop-manager.js` (`631`)
  - `src/copilot/conversation-hub/store.js` (`563`)
  - `src/copilot/channel/client.js` (`507`)

### Saúde arquitetural automatizada

Saída de `npm run analyze:arch:health`:

- `Health Score: 75/100 (C)`
- `barrel coverage: 19/20`
- `missing barrels: presentation`
- `singletons (refined): 36`
- `deep imports (refined): 14`
- `fan-out max/avg: 12 / 4.7`

Leitura: a área já tem alguma disciplina arquitetural, mas ainda carrega acoplamento, singletons e módulos grandes demais para uma camada crítica.

### Saúde operacional automatizada

Saída de `npm run audit:preflight`:

- `pm2`: ok
- `mcp`: não pronto
- `rag`: não pronto
- `lsp`: não pronto

Impacto: o ecossistema `copilot` tem dependências operacionais relevantes fora do processo principal. Em ambiente degradado, parte das capacidades cai silenciosamente para modos parciais ou de fallback.

## Sinais quantitativos de risco

- `62` usos de `logSwallowed(...)`
- `19` `catch(_)`/swallow explícitos
- `11` `setInterval(...)`
- `53` `setTimeout(...)`
- `20` `JSON.parse(...)`
- `3` `process.exit(...)`
- `21` marcadores `TODO/FIXME/HACK/XXX`
- `39` testes `copilot` marcados como skipped/pending
- `97` testes `copilot` importando `vitest`, enquanto o `npm test` padrão está ancorado em `node --test`

## Conclusões iniciais

### 1. O risco principal não está em um único bug, mas em um padrão sistêmico

O código concentra vários sinais do mesmo tipo:

- concorrência coordenada por convenção/comentário, não por isolamento forte;
- operações críticas que podem falhar silenciosamente;
- timers/loops/retries espalhados;
- endpoints e canais com assimetria entre autenticação e autorização;
- drift entre comentário, script de teste e comportamento real.

### 2. O subsistema `server` tem drift importante entre intenção e execução

Os comentários e a organização de rotas sugerem uma política de `skipAuth` seletiva, mas o app instala autenticação global antes do mount das rotas. Isso gera forte suspeita de mismatch entre contrato esperado e comportamento real para `/health`, `/metrics` e endpoints equivalentes.

### 3. O subsistema `channel`/`conversation-hub` tem risco real de cross-talk e zumbificação

Os trechos lidos indicam dois problemas centrais:

- captura de eventos globais por listeners `once/on` em chamadas concorrentes de `chat()`;
- possibilidade de turnos serem gravados após fechamento da sessão quando a requisição já estava em voo.

### 4. Observabilidade existe, mas parte dela é “observabilidade cega”

Há muito `logSwallowed`, muito `catch` silencioso e muito fallback best-effort. Isso reduz ruído fatal, mas aumenta a chance de o sistema ficar “parecendo saudável” enquanto perde sinais importantes.

### 5. A suíte de testes está estruturalmente desalinhada

Achado forte desta rodada:

- `npm test` usa `node --test`;
- ao menos `97` testes `copilot` importam `vitest`;
- a execução representativa de `node --strip-types --test tests/unit/copilot/test_keepalive.spec.js` falhou com:
  - `Vitest mocker was not initialized in this environment`

Isso caracteriza um gap de governança da suíte, não apenas um caso isolado.

## Primeiros achados de alta confiança

### P0/P1

1. `POST /steer` não recebe o mesmo middleware admin de `/start`, `/stop` e `/permissions`.
   - Evidência: `src/copilot/server/routes/copilot-api/control.js:71-80`
2. Socket namespace autentica token, mas não autoriza acesso por sessão.
   - Evidência: `src/copilot/server/socket/hub-ns.js:188-199`, `223-255`, `268-319`
3. `LlmBridgeClient.chat()` é vulnerável a cross-talk em chamadas concorrentes por depender de eventos globais `task.queued`/`question.pending`.
   - Evidência: `src/copilot/channel/client.js:189-223`, `295-340`
4. Fechamento de sessão não impede gravação tardia de turnos já em voo.
   - Evidência: `src/copilot/conversation-hub/orchestrator.js:192-203`, `226-263`; `src/copilot/conversation-hub/send-pipeline.js:79-87`, `141-163`
5. O middleware CORS default é inválido para navegador (`http://localhost:*`) e também usa composição incorreta para múltiplas origens.
   - Evidência: `src/copilot/server/app.js:54-55`; `src/copilot/server/middleware/cors.js:38-43`
6. `infra/storage.writeJson()` promete escrita atômica, mas faz `writeFile` direto.
   - Evidência: `src/copilot/infra/storage.js:32-46`

### P2

7. Health/metrics marcados como `skipAuth` no comentário, mas a montagem real indica auth global antes das rotas.
   - Evidência: `src/copilot/server/app.js:61-64`; `src/copilot/server/router.js:68-84`; `src/copilot/server/routes/health.js:30-31`
8. `session-messaging`, `session-rpc-tools` e `experimental-rpc-tools` usam `Promise.race` com `setTimeout` sem limpeza explícita do timer.
   - Evidência: `src/copilot/server/routes/sdk/session-messaging.js:125-130`; `src/copilot/tools/session-rpc-tools.js:82-87`; `src/copilot/tools/experimental-rpc-tools.js:86-93`
9. `SessionKeepalive` pode disparar ticks sobrepostos.
   - Evidência: `src/copilot/agent/session/keepalive.js:62-70`, `113-155`
10. `EventBus` declara suportar handlers async, mas não captura rejeições assíncronas.
    - Evidência: `src/copilot/core/event-bus.js:24-27`, `95-103`, `255-289`

## Evidências de drift documental/organizacional

### README do módulo desatualizado

`src/copilot/README.md` ainda descreve uma árvore de módulos que já não corresponde integralmente à estrutura atual. Isso não é cosmético: complica onboarding, auditoria e triagem por outras LLMs.

### Comentários de persistência em caminhos incorretos

Dois módulos dizem persistir arquivos “na raiz do projeto”, mas os caminhos resolvidos apontam para dentro de `src/copilot/`:

- `src/copilot/sdk/tools/custom.js:3-6`, `48`
- `src/copilot/sdk/tools/state.js:5-9`, `23`

Isso apareceu inclusive nos logs da rodada:

- `ENOENT ... /src/copilot/custom-tools.json`
- `ENOENT ... /src/copilot/tools-config.json`

## Testes executados nesta rodada

Passaram:

- `tests/unit/copilot/test_agent_health_routes.spec.js`
- `tests/unit/copilot/test_hub_orchestrator.spec.js`
- `tests/unit/copilot/test_llm_bridge_client.spec.js`

Importante: o fato de passarem não cobre os bugs levantados acima. Pelo contrário, ajuda a mostrar que a cobertura atual não exercita:

- concorrência real em `LlmBridgeClient.chat()`;
- fechamento de sessão durante requisição em voo;
- políticas de auth/authorization de socket por sessão;
- timers órfãos de `Promise.race`;
- compatibilidade entre `node --test` e arquivos escritos com `vitest`.

## Direção para a auditoria completa

Prioridades da próxima fase:

1. segurança de rotas e sockets;
2. concorrência e filas (`agent`, `channel`, `conversation-hub`);
3. timers/retries/watchdogs;
4. observabilidade e falhas silenciosas;
5. hardening da suíte e governança de testes;
6. catálogo amplo de bugs/gaps confirmados e heurísticos.

## Veredito da pré-auditoria

`src/copilot` está funcional e relativamente modularizado, mas apresenta sinais claros de:

- drift entre intenção arquitetural e runtime real;
- lacunas de segurança por autorização incompleta;
- coordenação concorrente frágil;
- observabilidade excessivamente permissiva com falhas silenciosas;
- suíte de testes estruturalmente quebrada ou parcialmente fora do pipeline padrão.

Isso justifica uma auditoria completa, ampla e versionada, com backlog grande de correções e triagem.

