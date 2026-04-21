# R-08 — Programa 1: `agent/`, core runtime e lifecycle

**Programa**: P1 **Prioridade**: máxima **Foco**: concluir a reestruturação séria de
`src/copilot/agent/` e reduzir seu custo sistêmico

---

## 1. Objetivo

P1 existe para transformar o `agent/` de maior hotspot do sistema em um runtime orquestrador forte,
mas mais legível, menos difuso e com fronteiras muito melhores.

---

## 2. Diagnóstico de partida

### Snapshot-base

- **62 arquivos**
- **8.248 linhas**
- `session/` = **1.975L**
- `dialog/` = **1.902L**
- `lifecycle/` = **1.299L**
- `always-alive.js` = **638L**

### Situação atual

P1 não começa do zero.

As seguintes fundações já existem:

- `AgentContext` particionado internamente;
- fila/executor canônicos em `agent-messaging.js`;
- `boot-wiring` + `boot-steps`;
- `event-bridge-map` + `event-bridge-wiring`;
- `background-tasks.js`;
- `health-check.js`.

Mais recentemente, o eixo de health deixou de ser apenas helper interno e passou a ter uma projeção
compartilhada de servidor:

- `agent/health-check.js` agora expõe issues canônicas e checks mais ricos de `runtime`,
  `background` e `quota`;
- `server/routes/agent-health.js` passou a centralizar o fallback compatível e a projeção
  HTTP/registry do health do agente;
- `health.js`, `copilot-api/control.js` e `health-registry.js` agora consomem a mesma normalização,
  reduzindo drift entre `/health/agent`, `/health` e `health/modules`.

O eixo de erro do runtime também saiu da fase “helper isolado” e começou a governar as bordas reais:

- surgiu `presentation/agent-http-errors.js` como projeção HTTP canônica baseada em
  `agent/error-policy.js`;
- `copilot-api/tasks.js`, `copilot-api/dialog.js` e `copilot-api/control.js` passaram a consumir a
  mesma semântica para `AbortError`, `QUEUE_FULL`, `DIALOG_*`, `NO_SESSION`, `AGENT_STOPPED` e
  códigos fatais;
- `presentation/agent-control.js` passou a usar a mesma projeção para `inject`, `pipeline` e
  `pause/resume`, evitando mais uma família paralela de `500` artesanais;
- isso fecha a primeira costura explícita entre a política operacional do runtime e a borda HTTP
  compartilhada.

### Sinal de execução já em curso

Além dessas fundações, o programa já teve um corte novo alinhado a `F1.1.a`:

- `dialog/turn-executor.js` passou a rotear a persistência de `pendingTurnMessage`, `pendingTurnTs`
  e `pendingTurnConsumedPR` via `trackBackgroundTask` quando o host expõe o tracker;
- isso fecha mais um call site remanescente do `K4` no caminho quente de turnos;
- `session/boot-steps.js` passou a rotear via `backgroundTasks.track(...)`:
  - a execução assíncrona do boot recovery diferido (`dialog.boot_recovery.run`);
  - o relay de respostas `question.answered` para `hook-tools` (`hooks.question_answered.relay`);
- o cleanup inicial de compatibilidade também começou:
  - `agent/infra/index.js` já exporta `executeTask` diretamente do caminho canônico em
    `agent-messaging.js`, sem passar pelo shim `infra/task-executor.js`;
  - a maior parte da suíte unitária de handlers foi migrada de
    `#copilot/agent/session/event-handlers/*` para `#copilot/event-handlers/*`;
  - a compatibilidade residual ficou reduzida a uma suíte dedicada de prova de reexport, em vez de
    espalhada por dezenas de imports de teste;
- isso fecha mais um bolsão relevante de fire-and-forget no pipeline de boot, sem mudar a semântica
  crítica de `pause/resume` ou do shutdown;
- validação focada acumulada dos cortes recentes:
  - **17/17** (`vitest`) + **11/11** (`node:test`) verdes no lote anterior de `K4.2`;
  - **53/53** (`vitest`) + **2/2** (`node:test`) verdes no cleanup inicial de shims.

O desafio agora é **fechar a transformação**, e não só prová-la em pedaços.

---

## 3. Fases

## F1.1 — Fechamento do backlog residual do `M-03`

### Subfases

- F1.1.a — expandir `background-tasks` para todo fire-and-forget relevante
- F1.1.b — consolidar `health-check` como contrato canônico de runtime
- F1.1.c — revisar e reduzir o fan-in de `always-alive.js`
- F1.1.d — decidir e executar a remoção dos shims residuais de fila/executor/event-handlers quando
  seguro
- F1.1.e — rodar regressão ampla do eixo `agent/`

### Resultado esperado

O backlog residual do `M-03` deixa de ser “meio concluído” e vira base realmente pronta para a
próxima decomposição.

### Sinal de avanço já entregue em `F1.1.a`

- persistência assíncrona de `pendingTurn*` no `turn-executor` já coberta pelo tracker;
- `cleanupStaleSessions()` e leitura para agendamento do boot recovery já cobertos pelo tracker em
  `boot-steps`;
- a execução do boot recovery diferido e o relay de `question.answered` agora também entram no
  tracker central;
- o primeiro lote de redução de consumidores de shim já convergiu a suíte de handlers para os
  caminhos canônicos;
- próximos candidatos do lote 3 devem priorizar apenas side effects realmente fire-and-forget,
  evitando migrar writes sequenciais cujo `await` ainda faz parte do contrato do fluxo.

### Sinal de avanço já entregue em `F1.1.d`

- o barrel `agent/infra/index.js` já deixou de depender do shim `infra/task-executor.js`;
- a suíte unitária de handlers passou a consumir `#copilot/event-handlers/*` como caminho padrão;
- restaram apenas **2 imports legados** em testes, concentrados numa suíte dedicada de
  compatibilidade explícita.

### Sinal de avanço já entregue em `F1.1.b`

- o snapshot do agente agora publica `issues` operacionais e checks adicionais de:
  - `runtime`
  - `background`
  - `quota`
- foi extraída uma projeção compartilhada em `server/routes/agent-health.js`, eliminando duplicação
  de fallback entre `health.js` e `copilot-api/control.js`;
- `health-registry.js` passou a usar a mesma projeção compartilhada para o módulo `agent`;
- validação focada do corte: **3/3** (`node:test`) para `agent/health-check` + **5/5** (`node:test`)
  para rotas e projeção de health.
- a borda do terminal também começou a convergir para o snapshot canônico:
  - `terminal/handlers/system-config.js` (`/health`) agora consome `getHealthSnapshot()` e degrada
    com fallback gracioso para métricas quando o store DI não estiver inicializado;
  - `terminal/commands/session.js` (`/status` textual) agora exibe `health`, `bg tasks` e `issues`
    do snapshot do agente;
  - `terminal/commands/diagnose.js` passou a projetar `health`, `keepalive`, `quota monitor` e
    `issues` diretamente do snapshot canônico, fechando o ciclo `agent → server → terminal`.

## F1.2 — Reestruturação de `session/`

### Subfases

- F1.2.a — separar claramente boot, setup, keepalive, snapshot e recovery
- F1.2.b — reduzir coordenação implícita entre `initializer`, `boot-wiring`, `boot-steps`,
  `snapshot` e `state-io`
- F1.2.c — fechar ownership de snapshot/state runtime
- F1.2.d — preparar `session/` para integrar melhor com hub e SDK stateless

### Resultado esperado

`session/` deixa de ser a maior caixa-preta do `agent/`.

### Avanço incremental já entregue em `F1.2`

O primeiro corte de ownership entre `session/`, `hub` e `sdk` já entrou em código:

- `core/shared-state.js` deixou de manter apenas `hubSessionId` e passou a publicar também a sessão
  SDK ativa;
- surgiu `agent/session/ownership.js` como helper explícito de sincronização do vínculo
  `hubSessionId ↔ sdkSessionId`;
- `agent-lifecycle.js` agora atualiza esse vínculo ao inicializar/parar a sessão SDK e, quando
  houver hub ativo, persiste o `sdk_session_id` no `ConversationStore`;
- `conversation-hub/orchestrator.js` passou a consultar primeiro a SSOT compartilhada do
  `sdkSessionId`, em vez de inferi-la sempre via snapshot do `agent`;
- `terminal/index.js` e `server/routes/sessions.js` passaram a usar o `sdkSessionId` compartilhado
  como binding padrão na criação de novas hub sessions.
- o mesmo vínculo deixou de ficar restrito ao runtime do `agent`: `presentation/sdk-sessions.js`
  passou a centralizar projeções e sincronização de ownership para `server/routes/sdk/*`, incluindo
  um endpoint canônico `GET /sdk/sessions/binding` e respostas enriquecidas em
  create/resume/foreground/disconnect/model.

Validação focada do corte:

- **27/27** (`node:test`) no recorte de ownership/store/router;
- **17/17** (`vitest`) no recorte de `terminal/state`.
- **6/6** (`node:test`) no recorte novo de rotas SDK com SSOT explícita.

## F1.3 — Endurecimento de `dialog/`

### Subfases

- F1.3.a — consolidar domínio de loop, turn, abort/retry, watchdog e state transitions
- F1.3.b — reduzir dependências incidentais de `dialog/` com `lifecycle/` e `state-io`
- F1.3.c — explicitar contratos de streaming, stop, restart e recovery
- F1.3.d — organizar melhor métricas e side-effects do diálogo

### Resultado esperado

`dialog/` passa a ser lido como domínio coeso, não como acúmulo de runtime behavior.

## F1.4 — Slim da fachada pública

### Subfases

- F1.4.a — reduzir o papel de `always-alive.js` para fachada real
- F1.4.b — mover coordenação excessiva para módulos de domínio apropriados
- F1.4.c — estabilizar API pública de `agent/`
- F1.4.d — revisar barrels, exports e imports externos do módulo

### Resultado esperado

`always-alive.js` deixa de ser o grande balcão de todo mundo.

## F1.5 — Runtime services do agente

### Subfases

- F1.5.a — amadurecer `background-tasks.js`
- F1.5.b — amadurecer `health-check.js`
- F1.5.c — revisar `error-policy.js`
- F1.5.d — consolidar serviços transversais do runtime do agente em contratos explícitos

### Resultado esperado

Health, background tasks e error policy deixam de ser “features novas dentro do agent” e viram
infraestrutura consolidada do runtime.

### Próximo aprofundamento sugerido para `F1.5`

- projetar o mesmo snapshot enriquecido de health para consumidores de terminal/diagnóstico;
- decidir thresholds operacionais canônicos para `backgroundPendingCount`, `queue starvation` e
  `quotaMonitor`;
- aproximar health operacional de diagnósticos de runtime, evitando duplicação entre `/health`,
  `diagnose` e métricas ad hoc.

### Avanço adicional já entregue em `F1.5.c`

- `error-policy.js` deixou de governar apenas `messaging` e `reconnect-policy`;
- a nova projeção `presentation/agent-http-errors.js` passou a derivar status/body de borda a partir
  da mesma classificação canônica do runtime;
- `copilot-api/tasks.js` agora projeta de forma consistente:
  - `AbortError`/`ABORT_ERR` → `504`;
  - `QUEUE_FULL` → `429`;
  - erros fatais / `NO_SESSION` / `AGENT_STOPPED` → `503` conforme o código/semântica do runtime;
- `copilot-api/dialog.js` agora projeta `DIALOG_TIMEOUT`, `DIALOG_NOT_ACTIVE`, `DIALOG_QUEUE_FULL` e
  demais erros do domínio pelo mesmo mecanismo;
- `presentation/agent-control.js` passou a devolver a mesma taxonomia em `handleInject`,
  `handlePipeline` e `handleDialogResume`, reduzindo drift entre terminal e server;
- validação focada do corte: **15/15** (`node:test`) + **18/18** (`vitest`) verdes.

### Avanço adicional já entregue na borda do terminal

- `/health` do terminal (`handleHealth`) e `/status` do REPL agora exibem a mesma semântica de
  `healthStatus`, `backgroundPendingCount`, `keepaliveRunning` e `issues`;
- o comando `/diagnose` passou a consumir `getAgent()` e o snapshot de health, reduzindo acoplamento
  com DI e evitando mais uma projeção paralela de runtime;
- validação focada do corte de terminal: **33/33** (`vitest`) verdes.

## F1.6 — Compatibilidade residual e regressão final

### Subfases

- F1.6.a — remover compatibilidade residual quando consumidores convergirem
- F1.6.b — limpar wrappers temporários e imports de transição
- F1.6.c — reavaliar LOC e fan-in do módulo
- F1.6.d — executar regressão ampla multi-suite

### Resultado esperado

P1 termina com `agent/` significativamente mais governável e menos dependente de gambiarras de
transição.

---

## 4. Critérios de conclusão

- `agent/` visivelmente mais fino e menos difuso;
- `always-alive.js` funcionando como fachada real;
- `session/`, `dialog/` e `lifecycle/` com fronteiras mais claras;
- serviços transversais do runtime consolidados;
- compatibilidade residual significativamente reduzida;
- regressão ampla verde no eixo do `agent/`.

---

## 5. Métricas-alvo sugeridas

| Métrica                    |        Base |                            Target de programa |
| -------------------------- | ----------: | --------------------------------------------: |
| `agent/` LOC               |       8.248 | abaixo de 6.000 como meta intermediária forte |
| `always-alive.js`          |        638L |                                faixa 300–450L |
| shims residuais principais |   3 bolsões |                       0 ou mínimo documentado |
| fan-in externo de `agent/` | 40 arquivos |    redução material, especialmente nas bordas |

---

## 6. Dependências relevantes

P1 conversa diretamente com:

- P2, porque ownership de sessão e SDK boundary influenciam muito o `agent/`;
- P3, porque eventos/observability afetam lifecycle e runtime;
- P4, porque server/terminal/channel/hub consomem o runtime do agente;
- P6, porque typing, testes e gates são necessários para não quebrar a casa durante a obra.

---

## 7. Riscos principais

- fazer slim de fachada sem fechar ownership interno suficiente;
- remover compatibilidade cedo demais;
- confundir redução de LOC com redução real de custo arquitetural;
- atacar `dialog/` e `session/` sem contract tests adequados.

---

## 8. Resultado esperado

Ao concluir P1, o `agent/` deve deixar de ser “o maior módulo mais sensível do repositório” e passar
a ser “o runtime orquestrador mais bem delimitado do sistema”.

É uma diferença enorme — e bastante útil para dormir melhor depois de merge grande.
