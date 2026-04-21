# R-16 — Roadmap Geral Integrado de `src/copilot/`

**Data**: 2026-04-15 **Status**: plano operacional expandido **Relacionamento**: expansão detalhada
de `R-06-ROADMAP-MASTER.md`

---

## 1. Propósito

O `R-06` define a espinha dorsal do roadmap clean.

Este documento existe para ir além: ele organiza a execução em **faixas**, **fases**, **subfases**,
**dependências**, **gates** e **saídas esperadas**, integrando tudo o que foi consolidado na série
`R-00`–`R-15`.

Em termos simples:

- `R-06` diz **o que precisa acontecer**;
- `R-16` diz **como isso se distribui em uma jornada ampla e coerente**.

---

## 2. Visão macro

A rearquitetura clean foi reorganizada em **9 faixas**.

| Faixa | Nome                                                  | Natureza               |
| ----- | ----------------------------------------------------- | ---------------------- |
| A     | Baseline, governança e hubs canônicos                 | fundação               |
| B     | Fechamento do runtime do `agent/`                     | estrutural prioritária |
| C     | Sessão, snapshot, replay e ownership conversacional   | estrutural prioritária |
| D     | SDK fino, stateless e menos difuso                    | estrutural prioritária |
| E     | Eventos, hooks, observability e audit                 | estrutural prioritária |
| F     | Server, terminal, channel e conversation-hub          | bordas e orquestração  |
| G     | Plataforma interna: tools, config, core, infra, types | fundação técnica       |
| H     | Segurança, testes, typing, performance e docs         | governança contínua    |
| I     | Capacidades avançadas                                 | pós-base saudável      |

---

## 3. Sequência por ondas

## Onda 1 — Rebase operacional

### Faixas ativas

- A
- B (início)
- H (mínimo)

### Meta

Congelar baseline, declarar hubs canônicos, fechar backlog residual crítico do `agent/` e impedir
regressões de governança.

## Onda 2 — Runtime e ownership de sessão

### Faixas ativas

- B
- C
- D
- H

### Meta

Fechar o coração do runtime e clarear ownership de sessão entre `agent/`, `sdk/` e
`conversation-hub`.

## Onda 3 — Modelo de eventos e bordas sistêmicas

### Faixas ativas

- E
- F
- H

### Meta

Reduzir fan-out, governar eventos/observability e desacoplar presentation/orchestration.

## Onda 4 — Plataforma interna e limpeza pesada

### Faixas ativas

- G
- H

### Meta

Reorganizar tools/config/core/infra/types e remover boa parte da dívida residual.

## Onda 5 — Capacidades avançadas

### Faixas ativas

- I

### Meta

Expandir capacidades sem recolocar a casa em obras.

---

## 4. Faixa A — Baseline, governança e hubs canônicos

## Fase A1 — Baseline factual

### Subfases

- A1.1 medir LOC/arquivos/hotspots por módulo
- A1.2 medir acoplamentos transversais críticos
- A1.3 medir deprecateds, TODOs, catches silenciosos e pontos de risco
- A1.4 publicar tabela-base oficial do ciclo clean

## Fase A2 — Governança documental

### Subfases

- A2.1 declarar a série clean como hub operacional
- A2.2 ligar docs antigos ao novo hub
- A2.3 distinguir documento vivo vs histórico
- A2.4 manter índices e navegação consistentes

## Fase A3 — Ownership e contratos de topo

### Subfases

- A3.1 publicar matriz de ownership por módulo
- A3.2 publicar regras de fronteira por camada
- A3.3 publicar registro de compatibilidade residual
- A3.4 alinhar critérios de aceitação por programa

## Fase A4 — Gating mínimo

### Subfases

- A4.1 definir quality gates por programa
- A4.2 definir security gates por superfície
- A4.3 definir suites mínimas por tipo de mudança
- A4.4 registrar baseline de risco operacional

### Estado atual resumido da Faixa A

Os artefatos estruturais de A1–A4 já foram materializados na linha clean:

- `R-07A` congela a tabela-base factual do ciclo clean;
- `R-07B` publica a matriz de ownership e contratos de topo;
- `R-07C` publica as regras de fronteira e o registro canônico de compatibilidade residual;
- `R-07D` publica quality gates, security gates, suites mínimas e baseline de risco operacional.

Leitura prática:

- A1–A4 já têm output canônico utilizável;
- a manutenção desses artefatos passa a ser parte do done dos próximos checkpoints;
- A5/F0.5 permanece contínua, conectada a `R-04A`, `R-05`, `R-07C` e `R-15`.

Além disso, a linha clean agora ganhou um artefato específico para responder “qual é exatamente a
arquitetura ideal e como saberemos que chegamos lá?” sem espalhar essa resposta por cinco
documentos:

- `R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md`.

Leitura prática adicional:

- `R-04` continua sendo o desenho/princípios;
- `R-04A` passa a ser a régua explícita de convergência para checkpoints estruturais profundos.

---

## 5. Faixa B — Fechamento do runtime do `agent/`

## Fase B1 — Fechamento do backlog residual do `M-03`

### Subfases

- B1.1 expandir `background-tasks` para writes/side effects remanescentes
- B1.2 consolidar `health-check` como contrato canônico
- B1.3 revisar `error-policy` nas rotas reais do runtime
- B1.4 revisar/remover compatibilidade residual prioritária
- B1.5 rodar regressão ampla do eixo `agent/`

### Estado atual resumido de B1.1

Já há slices entregues em código para `B1.1`:

- persistências assíncronas do runtime principal em `agent-lifecycle.js`;
- persistências assíncronas de `pendingQuestion` e marcadores de turno em `user-input-handler.js`,
  `agent-messaging.js` e `dialog/turn-executor.js`;
- persistências de `dialogLoopActive` / `prMetrics` em `dialog/loop-manager.js`;
- cleanup de sessões stale, leitura para boot recovery, execução do boot recovery diferido e relay
  de `question.answered` em `session/boot-steps.js`.

Próxima regra prática para `B1.1`: continuar apenas em side effects não críticos e claramente
fire-and-forget, evitando migrar writes cujo `await` ainda é parte do contrato do fluxo
transacional. Correção: implemente tudo, de maneira completa e profunda; não deixe nada "para
depois".

### Estado atual resumido de B1.4

O primeiro corte de `B1.4` também já começou:

- o barrel `agent/infra/index.js` passou a apontar `executeTask` diretamente para
  `agent/messaging/agent-messaging.js`;
- a maior parte dos testes que ainda consumiam `#copilot/agent/session/event-handlers/*` foi migrada
  para os caminhos canônicos em `#copilot/event-handlers/*`;
- a compatibilidade residual de event-handlers foi concentrada em uma suíte dedicada de verificação
  de reexport, em vez de permanecer espalhada em dezenas de imports de teste.

Próxima regra prática para `B1.4`: reduzir consumidores legados primeiro, e só então considerar
remoção física dos shims de `queue-processor`, `task-executor` e `agent/session/event-handlers/*`.

### Estado atual resumido de B1.2

`B1.2` também avançou além do helper inicial:

- `agent/health-check.js` passou a publicar um snapshot mais rico, com `issues` e checks adicionais
  de `runtime`, `background` e `quota`;
- foi extraído `server/routes/agent-health.js` como ponto comum para:
  - fallback compatível do snapshot do agente;
  - status HTTP derivado do health;
  - projeção do módulo `agent` para o registry agregado;
- `health.js`, `copilot-api/control.js` e `health-registry.js` agora consomem a mesma normalização,
  reduzindo drift entre as superfícies operacionais.

Próxima regra prática para `B1.2`: espalhar o snapshot enriquecido para consumidores de
diagnóstico/terminal antes de criar novas variações locais de health.

Esse espalhamento começou a acontecer:

- o terminal agora já consome o snapshot enriquecido em `/health`, `/status` e `/diagnose`;
- isso reduziu projeções paralelas de health na borda de operação humana e abriu caminho para
  unificar thresholds e semântica de issues entre server, terminal e diagnósticos futuros.

### Estado atual resumido de B1.3

`B1.3` também já começou a sair da fase “mapeamento” e entrar em código real:

- surgiu `src/copilot/presentation/agent-http-errors.js` como projeção HTTP canônica dos erros do
  runtime do agente;
- a nova projeção consome `agent/error-policy.js` e fecha a tradução de códigos operacionais como:
  - `QUEUE_FULL`
  - `DIALOG_NOT_ACTIVE`
  - `DIALOG_QUEUE_FULL`
  - `DIALOG_TIMEOUT`
  - `NO_SESSION`
  - `AGENT_STOPPED`
  - `SESSION_FATAL`
- `copilot-api/tasks.js`, `copilot-api/dialog.js` e `copilot-api/control.js` passaram a consumir
  essa mesma projeção;
- `presentation/agent-control.js` também convergiu para o mesmo mecanismo em `inject`, `pipeline` e
  `pause/resume`.

Leitura prática:

- a política de erro do runtime deixou de viver só dentro de `messaging`/`reconnect-policy`;
- o sistema agora já tem uma SSOT de semântica de erro atravessando runtime e borda HTTP;
- o próximo passo de `B1.3` é espalhar essa mesma taxonomia para outras bordas sensíveis (ex.:
  camadas SDK/Socket) antes de aceitar novos handlers ad hoc.

## Fase B2 — Reestruturação de `session/`

### Subfases

- B2.1 separar boot/setup/recovery
- B2.2 separar snapshot/state ownership
- B2.3 explicitar lifecycle de keepalive
- B2.4 reduzir coordenação difusa entre initializer, state-io e boot
- B2.5 preparar integração melhor com hub e SDK fino

### Estado atual resumido de B2

`B2` já passou do estágio de “só mapear” e entrou na costura real entre runtime e bordas:

- `core/shared-state.js` passou a manter explicitamente o binding `hubSessionId ↔ sdkSessionId`;
- `agent/session/ownership.js` virou o helper canônico de sincronização/persistência desse vínculo;
- `agent-lifecycle.js` publica e limpa o `sdkSessionId` ativo no ciclo real da sessão SDK;
- `conversation-hub/orchestrator.js`, `terminal/index.js` e `server/routes/sessions.js` já consomem
  a mesma SSOT;
- `presentation/sdk-sessions.js` agora estende essa mesma regra para `server/routes/sdk/*`, evitando
  que o server trate “sessão SDK ativa” como detalhe local de cada rota.

Leitura prática:

- o vínculo ativo entre sessão SDK e conversa persistida deixou de depender só de snapshot e
  inferência;
- o próximo passo útil de `B2` é continuar desmontando coordenação implícita entre `initializer`,
  `state-io`, `snapshot`, `keepalive` e os consumidores remanescentes de sessão no server.

## Fase B3 — Endurecimento de `dialog/`

### Subfases

- B3.1 revisar loop manager e controle de turno
- B3.2 revisar retry/abort/restart/stop semantics
- B3.3 revisar watchdog e stall model
- B3.4 revisar side effects e métricas do diálogo
- B3.5 definir contract tests do domínio de diálogo

## Fase B4 — Slim da fachada pública

### Subfases

- B4.1 reduzir `always-alive.js`
- B4.2 revisar exports públicos do módulo
- B4.3 reduzir fan-in externo em pontos indevidos
- B4.4 mover coordenação excessiva para módulos próprios

## Fase B5 — Compatibilidade residual e saída do programa

### Subfases

- B5.1 remover shims já convergidos
- B5.2 revisar barrels e imports transitórios
- B5.3 reavaliar métricas do módulo
- B5.4 validar regressão do `agent/` como gate de saída

---

## 6. Faixa C — Sessão, snapshot, replay e ownership conversacional

## Fase C1 — Ownership de sessão

### Subfases

- C1.1 mapear quem é dono de cada aspecto de sessão
- C1.2 separar sessão SDK, sessão do agente e sessão conversacional
- C1.3 reduzir sobreposição entre `agent/`, `sdk/` e `hub`

### Estado atual resumido de C1

O primeiro corte de `C1` já está operacional:

- existe uma SSOT explícita do binding `hubSessionId ↔ sdkSessionId` em `core/shared-state.js`;
- esse vínculo é persistido no `ConversationStore` quando o hub ativo já existe;
- `server/routes/sessions.js` passou a herdar o `sdkSessionId` compartilhado por default;
- `server/routes/sdk/session-crud.js` e `session-messaging.js` passaram a publicar a mesma projeção
  de ownership, incluindo `sharedBinding`, `boundHubSessionId` e `canonicalSessionId`.
- `server/routes/sdk/client.js` e `agent.js` passaram a consumir a mesma runtime projection
  canônica, reduzindo drift entre as superfícies de inspeção e controle do SDK.

Leitura prática:

- `agent/`, `sdk/` e `conversation-hub/` ainda não têm ownership totalmente separado;
- porém, o sistema já deixou de depender de “quem lembra primeiro da sessão atual” em várias bordas
  críticas.

## Fase C2 — Registry e replay

### Subfases

- C2.1 definir session registry alvo
- C2.2 integrar replay com `conversation-hub`
- C2.3 alinhar retenção, cleanup e restore
- C2.4 validar cenários de restart e resume

## Fase C3 — Snapshot e state runtime

### Subfases

- C3.1 revisar contrato de snapshot
- C3.2 revisar state file ownership
- C3.3 reduzir writes incidentais e side effects implícitos
- C3.4 alinhar snapshot/state com health e background tasks

## Fase C4 — Sessão conversacional

### Subfases

- C4.1 fortalecer store e sincronização de histórico
- C4.2 preparar lifecycle de conversas
- C4.3 alinhar compaction/replay/resume com o runtime do agente

---

## 7. Faixa D — SDK fino, stateless e menos difuso

## Fase D1 — Session state fora do SDK fino

### Subfases

- D1.1 mapear `_client`, `_sessions` e ownership residual
- D1.2 extrair/relocalizar registry
- D1.3 limpar `sdk/session/client.js`
- D1.4 alinhar consumidores principais

### Estado atual resumido de D1

`D1` saiu da fase exclusivamente analítica e já teve o primeiro corte estrutural entregue:

- surgiu `src/copilot/infra/sdk-session-registry.js` como registry canônico das sessões SDK ativas
  no processo;
- `sdk/session/client.js` deixou de manter `_sessions` como estado privado e passou a delegar esse
  registry à nova camada de `infra`;
- a superfície pública do wrapper foi preservada, então `server/routes/sdk/*` e demais consumidores
  continuam usando a mesma API por enquanto;
- o barrel `infra/index.js` agora exporta a nova superfície de registry;
- aliases compatíveis `loadCustomTools` e `loadToolsConfig` foram restaurados no barrel
  `#copilot/sdk` para evitar regressão lateral de compatibilidade.

Leitura prática:

- o SDK ainda não está stateless, mas já deixou de concentrar um dos bolsões mais explícitos de
  estado operacional local;
- `server/routes/sdk/*` deixou de ser apenas consumidor passivo do wrapper e agora já conversa com
  uma projeção SSOT de ownership em `presentation/sdk-sessions.js`;
- `sdk/client` e `sdk/agent` agora também compartilham uma runtime projection única para state,
  binding e sessão canônica, em vez de projetarem versões locais de “sessão atual”;
- `client/force-stop` foi realinhado para a superfície canônica do wrapper, evitando stale state
  local em shutdown forçado;
- o próximo passo útil de `D1` é alinhar os consumidores principais restantes e decidir qual parte
  do ownership de sessão continua no wrapper e qual deve migrar de vez para a camada convergente
  entre `agent`, `hub` e server.

## Fase D2 — Consolidação de config e builders

### Subfases

- D2.1 remover duplicações `sdk/` ↔ `config/`
- D2.2 encerrar legado de config residual no wrapper
- D2.3 alinhar builders canônicos

## Fase D3 — Contracts e barrels do wrapper

### Subfases

- D3.1 consolidar `custom-agents`
- D3.2 revisar typedefs e contracts mal posicionados
- D3.3 limpar barrels e re-exports excessivos

## Fase D4 — Dieta de imports do SDK

### Subfases

- D4.1 mapear importadores legítimos e de conveniência
- D4.2 criar superfícies intermediárias onde fizer sentido
- D4.3 reduzir fan-out direto do wrapper

## Fase D5 — Tipagem e docs do wrapper

### Subfases

- D5.1 revisar JSDoc pública
- D5.2 reorganizar types pesados demais
- D5.3 publicar/alinhar documentação de API do wrapper

---

## 8. Faixa E — Eventos, hooks, observability e audit

## Fase E1 — Taxonomia de eventos

### Subfases

- E1.1 inventariar eventos por domínio
- E1.2 classificar eventos de domínio/infra/telemetria/health
- E1.3 alinhar naming, schema e ownership
- E1.4 declarar bridges e aliases transitórios

## Fase E2 — Bridges e fluxo de eventos

### Subfases

- E2.1 alinhar bridges entre SDK, hooks e runtime
- E2.2 reduzir bridges manuais residuais
- E2.3 revisar pontos de emissão ad-hoc

## Fase E3 — Hooks, handlers e observers

### Subfases

- E3.1 consolidar papel de `event-handlers/`
- E3.2 estreitar o escopo de `hooks/`
- E3.3 separar reação semântica de coleta/observação
- E3.4 reduzir overlap entre collectors e observers

## Fase E4 — Error pipeline e health projections

### Subfases

- E4.1 consolidar tracking/alerting/classificação
- E4.2 alinhar error pipeline com projections de health
- E4.3 revisar `/health`, `/errors`, `/audit`, `/metrics`
- E4.4 reduzir duplicações entre runtime e observability

## Fase E5 — Dieta de observability e alinhamento com audit

### Subfases

- E5.1 mapear imports diretos realmente necessários
- E5.2 reduzir pontos de consumo direto
- E5.3 alinhar trilha auditável e observability operacional
- E5.4 limpar taxonomia residual do subsistema

---

## 9. Faixa F — Server, terminal, channel e hub

## Fase F1 — Separação `server ↔ terminal`

### Subfases

- F1.1 mapear imports cruzados
- F1.2 extrair contratos/serviços compartilháveis
- F1.3 remover dependências diretas evitáveis
- F1.4 validar ownership de handlers/health/status

### Estado atual resumido de F1

Os cinco primeiros slices executados desta faixa foram nos eixos `health/config`,
`sessions/memory/hub-health`, `SSE/rate-limiter-state`, `observability/git/quota/pr-budget` e
`agent-control`:

- surgiu `src/copilot/presentation/system-config.js` como superfície compartilhada;
- `server/routes/health.js` e `server/routes/config.js` migraram para essa nova camada;
- `terminal/handlers/system-config.js` virou adapter fino.
- surgiu `src/copilot/presentation/conversation-hub.js` como superfície compartilhada;
- `server/routes/sessions.js`, `server/routes/memory.js` e a rota `/hub-health` migraram para essa
  nova camada;
- `terminal/handlers/dialog.js` virou adapter fino.
- surgiu `src/copilot/presentation/realtime.js` como superfície compartilhada;
- `server/routes/sse.js` e `server/middleware/rate-limiter-state.js` migraram para essa nova camada;
- `terminal/dialog/sse.js` e `terminal/rate-limiter-state.js` viraram adapters finos.
- surgiu `src/copilot/presentation/system-metrics.js` como superfície compartilhada;
- `server/routes/observability.js`, `server/routes/git.js` e quota/pr-budget em
  `server/routes/agent.js` migraram para essa nova camada;
- `terminal/handlers/system-metrics.js` virou adapter fino.
- surgiu `src/copilot/presentation/agent-control.js` como superfície compartilhada;
- `server/routes/agent.js` migrou para essa nova camada;
- `terminal/handlers/agent.js` virou adapter fino.

Efeito medido:

- imports diretos `server → terminal` caíram de **11** para **0**.

Próxima fila prática de F1:

1. redução mais pesada de DI em `commands/`, `handlers/` e `dialog/`;
2. atualização do `README` do terminal;
3. contract tests ampliados de P4.

## Fase F2 — Organização da borda HTTP/realtime

### Subfases

- F2.1 revisar rotas e namespaces
- F2.2 alinhar health e projections
- F2.3 alinhar SSE, Socket e HTTP
- F2.4 reduzir duplicação de endpoints e handlers

## Fase F3 — Fortalecimento de `channel/`

### Subfases

- F3.1 explicitar contrato do canal
- F3.2 revisar retry/timeout/reconnect/structured parsing
- F3.3 alinhar `channel` com terminal e runtime
- F3.4 reduzir vazamento de detalhes internos

## Fase F4 — Lifecycle do `conversation-hub`

### Subfases

- F4.1 reforçar ownership sobre store e replay
- F4.2 alinhar retenção, cleanup e compaction
- F4.3 reduzir ambiguidade com sessão do agente
- F4.4 validar restart e replay cross-runtime

## Fase F5 — Terminal como UX e não pseudo-backend

### Subfases

- F5.1 classificar todo o `terminal/` entre boot/wiring, REPL/commands, handlers HTTP, dialog
  engine, estado local e compatibilidade
- F5.2 reduzir o uso difuso de container/DI em comandos, handlers e costuras do terminal
- F5.2.a consolidar `terminal/frontend/*` como consumer layer principal da LLM-B
- F5.2.b migrar `/status`, `/diagnose`, `/metrics`, `/usage` e flows de sessão para essa camada
- F5.2.c migrar progressivamente os demais comandos acoplados (`memory`, `resume`, `search`,
  `config`)
- F5.3 extrair projections/serviços hoje importados pelo `server/` a partir de `terminal/`
- F5.4 reorganizar `commands/` por domínio e por nível de acoplamento ao runtime
- F5.5 reorganizar `handlers/` como adapters HTTP finos, desacoplados do `server/`
- F5.6 revisar `dialog/` como boundary de streaming, turn execution e persistência local
- F5.7 consolidar `state.js`, aliases, file/workspace context e rate-limiter state como núcleo
  legítimo de UX local
- F5.8 separar backlog estrutural de UX avançada e capabilities futuras

### Estado atual resumido de F5

Há groundwork real já entregue no terminal:

- `/health`, `/status` e `/diagnose` passaram a consumir o snapshot canônico do `agent`;
- parte do acoplamento com DI caiu em `session.js`, `diagnose.js` e `system-config.js`;
- o módulo já se encontra separado em `commands/`, `handlers/`, `dialog/` e costuras de boot.

Mas a auditoria específica do terminal também mostrou que ainda restam gaps de fronteira relevantes:

- `47` arquivos `.js` no módulo;
- `23` arquivos em `commands/`;
- `73` ocorrências de DI/container no recorte;
- `11` imports reais de `server/` para `terminal/` no baseline auditado, reduzidos para `0` após os
  cinco slices de extração (`health/config`, `sessions/memory/hub-health`, `SSE/rate-limiter-state`,
  `observability/git/quota/pr-budget` e `agent-control`);
- drift documental no `README.md` do módulo.

Próxima regra prática para `F5`: tratar o terminal como subprograma do P4, com fila própria de
desacoplamento, em vez de apenas uma nota lateral do backlog de borda.

Primeiro corte recomendado de `F5`: extrair, para superfícies canônicas fora de `terminal/`, os
blocos hoje importados pelo `server/` em
`health/config/dialog/memory/sessions/sse/rate-limiter-state`, preservando adapters finos
transitórios enquanto a migração acontece.

Os cinco primeiros subcortes já foram executados em `health/config`, `sessions/memory/hub-health`,
`SSE/rate-limiter-state`, `observability/git/quota/pr-budget` e `agent-control`; o próximo foco
recomendado agora é a consolidação de `terminal/frontend/*` como camada interna do frontend
principal da LLM-B, seguida da redução de DI interna do terminal e do endurecimento de contract
tests do P4.

Esse foco também já começou a se materializar:

- surgiu `src/copilot/terminal/frontend/llm-b-frontend.js` como consumer layer principal da LLM-B
  dentro do terminal;
- `commands/session.js`, `commands/diagnose.js`, `commands/metrics.js`, `commands/usage.js`,
  `commands/memory.js`, `commands/resume.js` e `commands/search.js` já migraram para essa camada;
- `commands/config.js`, `commands/context.js` e `commands/errors.js` também já migraram para essa
  camada;
- `commands/export.js` também passou a consumir a seam runtime compartilhada, sem abrir `channel/`
  diretamente;
- o recorte de DI direta em `terminal/commands/` caiu de **22** para **0** ocorrências;
- surgiu `src/copilot/terminal/frontend/llm-b-runtime.js` como gateway runtime do terminal para
  `agent/`, `channel/` e `conversation-hub`;
- `llm-b-frontend.js` deixou de importar diretamente `#copilot/agent`, `#copilot/channel`,
  `#copilot/conversation-hub` e `#copilot/core`, passando a consumir runtime/hub/transporte apenas
  via `llm-b-runtime.js`;
- `repl.js`, `repl-listeners.js`, `dialog/output.js`, `dialog/engine.js`,
  `dialog/engine-persistence.js`, `terminal-agent-wiring.js` e `index.js` passaram a consumir esse
  gateway;
- o recorte total de `container.resolve()` em `src/copilot/terminal/` caiu para **2** ocorrências,
  com apenas **1** remanescente no runtime do módulo;
- validação focada mais recente do slice terminal-first:
  - **44/44** testes verdes em `vitest` no slice de comandos/frontend;
  - **14/14** testes verdes em `node:test` nos contratos de `dialog`/`repl`/`wiring`/`index`;
  - **26/26** testes verdes em `vitest` na rodada do gateway runtime.
- a próxima fila recomendada passa a ser:
  1. refinamento residual de `dialog/`, `repl.js` e `repl-listeners.js` em torno do gateway runtime
     já extraído;
  2. contract tests ampliados do frontend principal e do boundary P4;
  3. documentação local do terminal e backlog de UX local remanescente.

### Guardrail de compatibilidade para F5/F1

As extrações de P4 devem centralizar bordas compartilhadas em `presentation/`, mas manter intactas
as costuras do terminal com o runtime principal:

- `agent/` continua sendo a SSOT de runtime/health/controle da LLM-B;
- `conversation-hub/` continua sendo a SSOT de sessões, turns e memória conversacional;
- `channel/` continua sendo a SSOT de transporte e diálogo LLM-A ↔ LLM-B;
- `sdk/` continua sendo a superfície de modelos e capacidades consumida pelo terminal quando
  necessário.

Em outras palavras: o terminal continua sendo a interface operacional da LLM-B; `presentation/`
passa a ser apenas a SSOT de projections e handlers compartilhados entre as bordas.

---

## 10. Faixa G — Plataforma interna

## Fase G1 — Governança de tools

### Subfases

- G1.1 revisar bootstrap/registry/state
- G1.2 revisar superfícies sensíveis (shell/web/file)
- G1.3 alinhar métricas, auditoria e permissions das tools
- G1.4 separar plataforma atual de backlog futuro de tools

## Fase G2 — Normalização de config

### Subfases

- G2.1 separar builders/defaults/runtime state
- G2.2 revisar system prompt e configs MCP/tools
- G2.3 alinhar config com SDK e agent

## Fase G3 — Hardening de core e infra

### Subfases

- G3.1 revisar barrels gordos e exports centrais
- G3.2 revisar timers, queues, locks e storage
- G3.3 reduzir duplicações de mecanismos técnicos
- G3.4 alinhar utilidades centrais com o modelo de camadas

## Fase G4 — Tipos e contratos compartilhados

### Subfases

- G4.1 mapear contratos dispersos
- G4.2 promover tipos compartilhados reais
- G4.3 reduzir tipagem incidental duplicada

## Fase G5 — `plugins/` e taxonomias mortas

### Subfases

- G5.1 decidir o papel atual de `plugins/`
- G5.2 decidir destino de `logs/`
- G5.3 impedir módulo-fantasma sem ownership ou programa

---

## 11. Faixa H — Segurança, testes, typing, performance e docs

## Fase H1 — Segurança por superfície

### Subfases

- H1.1 revisar auth/autz nos endpoints críticos
- H1.2 revisar validação de inputs/params/URLs/paths
- H1.3 revisar shell/file/web execution surfaces
- H1.4 alinhar audit de falhas sensíveis

## Fase H2 — Matriz de testes

### Subfases

- H2.1 mapear cobertura por módulo e contrato
- H2.2 abrir suites faltantes críticas
- H2.3 distinguir unitário, contrato, integração e regressão
- H2.4 amarrar suites obrigatórias por programa

## Fase H3 — Typing e JSDoc

### Subfases

- H3.1 reduzir `any` em contratos importantes
- H3.2 reforçar JSDoc pública
- H3.3 alinhar typedefs/barrels/import surfaces

## Fase H4 — Performance e hygiene

### Subfases

- H4.1 revisar timers/intervals/listener cleanup
- H4.2 revisar queue pressure e backoff
- H4.3 revisar I/O síncrono e fire-and-forget inseguros
- H4.4 alinhar métricas de performance com observability madura

## Fase H5 — Deprecateds e dívida residual

### Subfases

- H5.1 classificar `@deprecated` ativos
- H5.2 remover wrappers mortos
- H5.3 limpar dead code e taxonomias vazias
- H5.4 impedir compatibilidade eterna

## Fase H6 — Governança documental contínua

### Subfases

- H6.1 manter a linha clean como hub operacional
- H6.2 atualizar pontes mínimas com docs legadas quando necessário
- H6.3 evitar novas taxonomias paralelas
- H6.4 manter backlog estrutural separado do backlog de capabilities

---

## 12. Faixa I — Capacidades avançadas

## Fase I1 — Terminal UX avançado

## Fase I2 — Multi-session e operações ricas de sessão

## Fase I3 — RPC, orchestration e surfaces avançadas

## Fase I4 — TSServer e contexto semântico

## Fase I5 — Plugin ecosystem e extensibilidade

## Fase I6 — Telemetria e dashboards expandidos

> As subfases detalhadas dessa faixa permanecem governadas por `R-15` e só devem entrar na fila
> ativa após a base estrutural estar suficientemente madura.

---

## 13. Primeira fila recomendada de execução

### Sprint/Checkpoint 1

- A1
- A2
- A4
- B1.1
- B1.2
- H1.1

### Sprint/Checkpoint 2

- B1.3
- B1.4
- B2.1
- B2.2
- D1.1
- D1.2

### Sprint/Checkpoint 3

- D1.3
- D2.1
- E1.1
- E1.2
- E2.1
- H2.1

### Sprint/Checkpoint 4

- F1.1
- F1.2
- F2.1
- F3.1
- C1.1
- C2.1

---

## 14. Gates por checkpoint

Cada checkpoint relevante deve responder:

- melhorou ownership?
- reduziu acoplamento?
- deixou docs mais simples?
- preservou contratos?
- aumentou governança de teste/segurança/typing?

Se a resposta for “não” para três desses cinco pontos, a mudança provavelmente é capability precoce
ou refactor cosmético.

---

## 15. Conclusão

O roadmap geral integrado desta série foi desenhado para que o sistema possa avançar continuamente
sem perder o eixo.

A mensagem central dele é simples:

1. consolidar base;
2. fechar fronteiras;
3. endurecer governança;
4. só então expandir com conforto.

É menos glamouroso do que pular direto para features de foguete, mas dá bem menos trabalho do que
consertar foguete montado em cima de trampolim.
