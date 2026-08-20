# SRC Copilot Agent + Terminal Deep Upgrade Roadmap — 2026-06-04

## 00. Status do Documento

- [x] Documento criado como guia novo para a fase ampla de `src/copilot`.
- [x] Escopo primário: `src/copilot`, com prioridade operacional em `terminal`, `agent`,
      `presentation`, `sdk` e suas fronteiras.
- [x] Escopo secundário: `model-gateway`, `mcp`, `server`, `channel`, `tools`, `infra` quando
      impactarem runtime, BYOK, terminal ou agent.
- [x] Roadmap usa somente checkboxes booleanos.
- [x] O documento anterior de UX terminal continua como histórico detalhado da revolução visual.
- [x] Este documento passa a guiar a próxima etapa: bugs, gaps e upgrades estruturais além da
      superfície visual.

## 01. Evidências Coletadas

- [x] Leitura arquitetural de `src/copilot/agent/README.md`.
- [x] Leitura arquitetural de `src/copilot/agent/dialog/README.md`.
- [x] Leitura arquitetural de `src/copilot/presentation/README.md`.
- [x] Leitura arquitetural de `src/copilot/terminal/README.md`.
- [x] Leitura do fluxo de turno em `src/copilot/terminal/dialog/engine.js`.
- [x] Leitura do collector semântico em `src/copilot/agent/dialog/seams/turn-output-collector.js`.
- [x] Leitura do executor de turno em `src/copilot/agent/dialog/executors/turn-executor.js`.
- [x] Leitura do estado de materialização em
      `src/copilot/terminal/state/turn-materialization-state.js`.
- [x] Leitura de `src/copilot/presentation/runtime/dialog.js`.
- [x] Leitura de `src/copilot/presentation/runtime/status.js`.
- [x] Leitura de `src/copilot/presentation/agent/runtime/runtime-selection.js`.
- [x] Varredura de fronteiras proibidas: `agent`, `presentation`, `sdk`, `core`, `config` não
      importam `terminal`.
- [x] Varredura de hotspots por tamanho em `agent`, `presentation` e `terminal`.
- [x] Varredura do texto crítico
      `sem resposta pública materializada; nenhuma pergunta humana pendente`.
- [x] Varredura de `ask_user`, `request_user_input`, `assistant.message`, `assistant.turn_end`,
      `session.model_changed`, `setModel`.
- [x] Varredura de `TODO`, `FIXME`, `fallback`, `degraded`, `legacy` nas camadas centrais.
- [x] Validações recentes da leva de UX: contexto, sessão e métricas com 65 testes verdes.

## 02. Situação Atual Resumida

- [x] A UX terminal foi amplamente humanizada em muitas superfícies.
- [x] A linha viva já existe e fica fora do input, com pulso de atividade.
- [x] O terminal já tem presenters dedicados para tools, intents, ask_user, deltas, SSE e tarefas.
- [x] O agent já possui um collector semântico de output de turno.
- [x] O terminal ainda mantém uma materialização própria de turno para reconciliação visual e
      fallback local.
- [x] `presentation/` já centraliza seleção de runtime e projeções compartilhadas.
- [x] A fronteira `agent -> presentation -> terminal` está conceitualmente definida.
- [x] Não foi encontrado import proibido de `terminal` dentro de `agent`, `presentation`, `sdk`,
      `core` ou `config`.
- [x] Os hotspots principais continuam muito grandes e exigem decomposição planejada.
- [x] A mensagem de turno vazio já tem classificação semântica, mas ainda precisa de diagnóstico
      mais acionável.
- [x] A seleção/troca de modelo já emite estado e eventos, mas a UX e a camada agent/presentation
      ainda precisam de trilha única mais forte.

## 03. Situação Ideal

- [ ] O agent é o owner único da semântica de turno.
- [ ] O terminal é o owner único da apresentação humana, sem reinterpretar semântica já resolvida
      pelo agent.
- [ ] `presentation/` é o owner das projeções compartilhadas entre terminal, server e channel.
- [ ] `sdk/` é o owner das capacidades vanilla do SDK.
- [ ] Todo turno explícito produz um resultado semântico auditável: reply público, input humano
      pendente, tool-only, transição de protocolo ou empty.
- [ ] Todo empty output vem com causa provável, evidências, impacto, próximo passo e relação com
      provider/modelo.
- [ ] Tool lifecycle sempre mostra nome humano, comando/argumentos seguros, alvo, duração, status,
      origem e IDs apenas em detail/raw.
- [ ] `exec_command` e equivalentes sempre comunicam o comando seguro ou sua versão redigida quando
      isso ajuda o operador.
- [ ] Tools de lista, leitura, escrita, move/delete e shell têm presenters consistentes e sem nomes
      internos na superfície default.
- [ ] A linha viva reflete progressos reais do agent, não apenas timers.
- [ ] A troca de modelo tem trilha única: solicitado, aplicado no SDK, confirmado por evento,
      observado no próximo uso, persistido no vínculo de sessão.
- [ ] O terminal explica claramente diferença entre modelo preparado, modelo vivo, vínculo de boot e
      telemetria histórica.
- [ ] BYOK, SDK Copilot e rotas auto não ficam misturados em linguagem visual.
- [ ] O usuário nunca vê enum interno por acidente em comandos default.
- [ ] Raw/detail preservam toda a informação técnica necessária para engenharia.
- [ ] Os testes live provam fluxo canônico completo: prompt, thinking, tools, deltas, ask_user,
      resposta, final, usage, export e SSE.

## 04. Achados Principais

- [x] Achado A: há dois níveis de materialização de turno, um no agent e outro no terminal.
- [x] Achado B: o agent já classifica `public_reply`, `pending_human_input`, `tool_only`,
      `protocol_transition` e `empty`.
- [x] Achado C: o terminal usa essa semântica, mas ainda complementa com materialização local
      pesada.
- [x] Achado D: `sem resposta pública materializada` aparece no terminal quando materialization
      source é `empty` e não há input humano pendente.
- [x] Achado E: há recuperação segura para empty antes de tools e para tool-only sem síntese.
- [x] Achado F: após tool ou protocolo, retry automático é deliberadamente limitado para evitar
      duplicar ação.
- [x] Achado G: o diagnóstico de empty já registra SSE e BYOK failure, mas pode ser mais
      explicativo.
- [x] Achado H: `exec_command` tem presenters, mas ainda deve ser auditado para comando/args em
      linha viva e `/tools`.
- [x] Achado I: `sdk-session-events.js`, `byok.js`, `sdk.js`, `session.js` e `engine.js` são
      hotspots grandes.
- [x] Achado J: `presentation/agent/control/handlers.js` é hotspot de controle humano/HTTP e merece
      auditoria própria.
- [x] Achado K: não há violação grosseira de import `terminal` para dentro das camadas inferiores.
- [x] Achado L: há duplicação de helpers de glossário entre comandos, sinal de extração futura.

## 05. Princípios para as Próximas Mudanças

- [ ] Não duplicar semântica já resolvida pelo agent.
- [ ] Não mover código apenas por estética de arquitetura.
- [ ] Não transformar `presentation/` em depósito genérico.
- [ ] Preservar barrel-first em import/export.
- [ ] Validar com testes escopados antes de baterias maiores.
- [ ] Usar live tests quando a mudança envolver UX, eventos, timing, ask_user ou modelo.
- [ ] Preferir presenters compartilhados quando dois comandos expõem a mesma semântica.
- [ ] Manter raw/detail como rota para IDs, enums e payloads técnicos.
- [ ] Default deve ser humano, compacto, elegante e operacional.

## Faixa A — Auditoria Viva e Inventário de Fronteiras

- [x] A.1 Mapear diretórios e hotspots principais.
- [x] A.2 Confirmar ausência de imports proibidos de `terminal` nas camadas inferiores.
- [x] A.3 Identificar pontos de turno vazio e materialização.
- [x] A.4 Identificar arquivos críticos de model switching.
- [ ] A.5 Gerar inventário de imports cruzados com script dedicado.
- [ ] A.6 Comparar module maps com filesystem real.
- [ ] A.7 Marcar owners para cada hotspot acima de 500 linhas.
- [ ] A.8 Criar critério automático contra novos imports proibidos.

## Faixa B — Resultado Semântico de Turno como Contrato Único

- [x] B.1 Confirmar existência de `DialogTurnSemanticResult` no agent.
- [x] B.2 Confirmar que `presentation/runtime/dialog.js` propaga resultado detalhado em caminho
      ativo.
- [ ] B.3 Auditar todos os consumidores de `sendDialogTurn` que perdem o resultado detalhado.
- [ ] B.4 Introduzir projection comum de resultado de turno em `presentation/runtime`.
- [ ] B.5 Reduzir interpretação paralela no terminal onde o agent já informou outcome.
- [ ] B.6 Manter materialização terminal apenas para reconciliação visual de deltas finais.
- [ ] B.7 Testar que `tool_only`, `pending_human_input`, `protocol_transition` e `empty` aparecem
      corretamente.
- [ ] B.8 Garantir que channel/server não reinterpretem `assistant.message` por conta própria.

## Faixa C — Empty Output e Diagnóstico Acionável

- [x] C.1 Localizar mensagem `sem resposta pública materializada; nenhuma pergunta humana pendente`.
- [x] C.2 Confirmar condições: source empty, sem pergunta humana, sem formulário pendente.
- [x] C.3 Confirmar recovery pre-action e post-tool-only.
- [x] C.4 Separar causas prováveis: sem delta, sem assistant.message, tool-only, protocolo, provider
      vazio, timeout tardio.
- [x] C.5 Melhorar painel do terminal para empty output com evidências e próximo passo por causa.
- [x] C.6 Registrar evento SSE com `operatorSummary`.
- [ ] C.7 Marcar saúde runtime/BYOK com cooldown adequado quando empty for provider/model failure.
- [ ] C.8 Criar testes unitários para cada classe de empty.
- [ ] C.9 Criar live curta que simule modelo sem resposta pública.

### Atualização C — 2026-06-04

- [x] `terminal/dialog/engine.js` agora gera diagnóstico de empty output com `cause`, `evidence`,
      `operatorSummary` e `operatorAction`.
- [x] A superfície humana trocou a linha opaca por três linhas: `Turno vazio`, `Causa` e
      `Evidências`, mantendo `Próximo passo` acionável.
- [x] O SSE `terminal.turn.empty_output` passou a carregar os mesmos campos de diagnóstico para
      `/events`, artefatos live e automações.
- [x] O teste `test_terminal_dialog_engine.spec.js` bloqueia regressão desses campos.

## Faixa D — Linha Viva Realmente Informativa

- [x] D.1 Linha viva existe sem ocupar o input.
- [x] D.2 A linha viva já mostra thinking, tools, pergunta e modelo em muitos estados.
- [ ] D.3 Auditar eventos que não atualizam atividade atual.
- [ ] D.4 Garantir que LIST/READ/EXEC/MOVE/DELETE apareçam com ação, alvo e status.
- [ ] D.5 Garantir que exec_command mostre comando redigido quando seguro.
- [ ] D.6 Garantir que troca de modelo apareça como estado transitório e confirmação.
- [ ] D.7 Garantir que delta público mude estado para respondendo rapidamente.
- [ ] D.8 Reduzir pulso genérico quando há evento específico recente.
- [ ] D.9 Adicionar testes de linha viva para cada fase canônica.

## Faixa E — Tool Lifecycle Completo

- [x] E.1 Presenters de tools já humanizam nomes comuns.
- [x] E.2 IDs internos são ocultados em default.
- [ ] E.3 Auditar `exec_command`, `LIST`, `READ`, write/move/delete e shell legacy.
- [ ] E.4 Padronizar shape visual: ferramenta, ação, alvo, status, duração, comando seguro, detalhe.
- [x] E.5 Consolidar `tool-activity-presenter`, `tool-lifecycle-runtime` e `/tools`.
- [x] E.6 Criar testes para comando redigido.
- [ ] E.7 Criar live com tools variadas e validar linha viva + `/activity` + `/tools diag`.
- [x] E.8 Garantir que raw IDs fiquem em detail/raw.

### Atualização E — 2026-06-04

- [x] `tool-activity-presenter.js` passou a extrair argumentos de `args`, `arguments`, `toolArgs`,
      `input`, `data` e `payload`, incluindo JSON serializado.
- [x] `tool-activity-presenter.js` passou a entender `toolResult` e envelopes `textResultForLlm`,
      preservando resumo de resultado, contagem e ranges retornados.
- [x] `tool-lifecycle-runtime.js` passou a registrar no `ToolCallRegistry` os argumentos
      normalizados, reduzindo completions genéricas quando o SDK omite payload no fim da tool.
- [x] `exec_command` serializado em `arguments` agora aparece como `Executar comando` com comando
      seguro em `terminal.activity`, linha viva e `tool.lifecycle`.
- [x] Testes escopados cobrem argumentos JSON, resultado estruturado e ausência de vazamento de
      `toolCallId` na superfície default.
- [x] A base de extração de metadados está mais forte para `exec_command`, leitura e resultados
      estruturados.
- [x] `/tools diag` agora renderiza `Comando`, `Filtros`, `Diretório` e `Resultado` quando o
      lifecycle possui esses metadados.
- [x] `/tools diag` mantém IDs internos fora da superfície humana; `/tools all` preserva rastreio
      técnico.
- [ ] Ainda falta auditar profundamente `/tools diag`, shell legacy e operações write/move/delete em
      execução live.
- [ ] Ainda falta live real com lista/leitura/escrita/move/delete/exec para comparar `/activity`,
      linha viva, `/tools diag` e artefatos SSE.

### Atualização E2 — 2026-06-05

- [x] `file-write-roundtrip` executou `report_intent`, `read_file_content`, `create_file`,
      `move_file`, `delete_file` e `ask_user` reais via SDK, sem prompt de permissão do SDK.
- [x] `/health full` no live confirmou `Permissões automáticas · prompts SDK ignorados`.
- [x] `/tools diag` mostrou `Criar arquivo`, `Mover arquivo`, `Excluir arquivo` e I/O local com
      nomes humanos, alvos claros e IDs internos fora da superfície default.
- [x] `io-activity-events.js` passou a concordar corretamente operações masculinas como
      `Arquivo: movimento concluído`, preservando `leitura/escrita/remoção concluída`.
- [x] O runner live deixou de classificar recuperação vazia pré-ação como
      `assistant-empty-after-user-input` quando o `user_input.completed` ocorreu apenas depois; a
      classificação agora respeita ordem temporal dos eventos.
- [x] O runner live reconhece `terminal.turn.empty_recovery` como recuperado quando há
      materialização pública, delta, reply suprimido já materializado ou nova pergunta depois da
      recuperação.
- [ ] Ainda falta live específico para `exec_command`, `LIST` e patch/edit em um único ciclo
      comparando linha viva, `/activity`, `/tools diag`, `/events` e export.

## Faixa F — Model Switching e BYOK Runtime Boundary

- [x] F.1 `/byok model` já solicita troca e aguarda confirmação.
- [x] F.2 `session.model_changed` já é evento conhecido.
- [x] F.3 O terminal já diferencia modelo preparado e modelo vivo em parte das telas.
- [ ] F.4 Auditar caminho completo: comando -> SDK setModel -> evento -> status -> usage -> prompt.
- [ ] F.5 Criar projection compartilhada de model transition em `presentation`.
- [ ] F.6 Garantir que agent registre modelo observado por turno.
- [ ] F.7 Garantir que mismatch preparado/vivo tenha estado claro e não pareça erro se aguardando
      confirmação.
- [ ] F.8 Criar live de troca automática/real com confirmação.
- [ ] F.9 Testar fallback proibido BYOK -> Copilot auto quando contrato exigir bloqueio.

## Faixa G — Agent Dialog Internals

- [x] G.1 `turn-output-collector` existe e é owner semântico.
- [x] G.2 `turn-executor` propaga outcome e diagnostics.
- [ ] G.3 Auditar `loop-manager` para filas, waiting state e recovery.
- [ ] G.4 Auditar `user-input-handler` para READY/REPLY/STOPPED e ask_user humano.
- [ ] G.5 Auditar watchdogs para não produzir recovery com PR indevido.
- [ ] G.6 Garantir que pending question shadow tenha lifecycle observável e limpo.
- [ ] G.7 Separar métricas de progresso real de heartbeat.
- [ ] G.8 Criar testes agent-level para tool-only, protocol-transition e empty.

## Faixa H — Presentation como Fronteira Compartilhada

- [x] H.1 `presentation/runtime/dialog.js` já existe.
- [x] H.2 `presentation/agent/runtime/runtime-selection.js` centraliza runtime selection.
- [ ] H.3 Auditar handlers de `presentation/agent/control/handlers.js`.
- [ ] H.4 Garantir que mutações com runtimeId explícito usem `requireAgentRuntimeSelection`.
- [ ] H.5 Garantir que fallbacks de runtime apareçam nos payloads quando permitidos.
- [ ] H.6 Criar projection compartilhada para turn diagnostics.
- [ ] H.7 Remover parsing duplicado de runtimeId nas bordas.
- [ ] H.8 Criar testes de HTTP/terminal sobre o mesmo contrato.

## Faixa I — Hotspot Reduction sem Refactor Cosmético

- [ ] I.1 Quebrar `terminal/commands/byok.js` por subcomandos/presenters.
- [ ] I.2 Quebrar `terminal/commands/sdk.js` por SDK, waits, workspace e capabilities.
- [ ] I.3 Quebrar `terminal/events/sdk-session-events.js` por lifecycle, tools, UI e session.
- [ ] I.4 Quebrar `terminal/dialog/engine.js` em orchestration, recovery e rendering.
- [ ] I.5 Quebrar `presentation/agent/control/handlers.js` por intent/mutation.
- [ ] I.6 Garantir barrels em cada subdomínio novo.
- [ ] I.7 Antes de cada extração, adicionar teste de contrato do comportamento existente.

## Faixa J — Estado Compartilhado, Stores e Observabilidade

- [ ] J.1 Auditar `presentation/state/ui-store/store.js`.
- [ ] J.2 Auditar `terminal/state/sdk-interactions.js`.
- [ ] J.3 Auditar `terminal/state/turn-trace-state.js`.
- [ ] J.4 Auditar `terminal/state/tool-call-registry.js`.
- [ ] J.5 Garantir bounds/TTL em todos os buffers de eventos.
- [ ] J.6 Criar projection de estado de turno para `/activity` e live status.
- [ ] J.7 Garantir que SSE e transcript usam o mesmo turnId/traceId.

## Faixa K — Testes Live e Provas Operacionais

- [x] K.1 Já existem lives no-PR e ciclos UX.
- [x] K.2 Já existem lives BYOK com ask_user e tool protocol em histórico recente.
- [ ] K.3 Criar live específico para empty output.
- [ ] K.4 Criar live específico para tool-only com síntese recuperada.
- [ ] K.5 Criar live específico para model switch.
- [ ] K.6 Criar live específico para exec_command visível.
- [ ] K.7 Criar live completo terminal + agent + presentation + SSE.
- [ ] K.8 Comparar plain log com critérios de estética: largura, ids, enums, ANSI solto.
- [x] K.9 Live `file-write-roundtrip` passou em 2026-06-05: create/move/delete/ask_user reais,
      permissões automáticas, SSE sem erros, export correlacionado e pós-pergunta materializado.
- [ ] K.10 Criar live de patch/edit real e leitura profunda, pois read/patch são tools de maior uso
      operacional.
- [ ] K.11 Criar live de exec/list/search com foco em targets, cwd e comando seguro.

## Faixa L — Documentação e Governança Contínua

- [x] L.1 Este roadmap foi criado.
- [ ] L.2 Atualizar este roadmap após cada leva estrutural.
- [ ] L.3 Adicionar seção de comandos canônicos para auditoria agent/terminal.
- [ ] L.4 Registrar decisões de fronteira agent/presentation/terminal.
- [ ] L.5 Registrar todos os lives relevantes com caminho de artefato.
- [ ] L.6 Manter checkboxes booleanos.

## 06. Próxima Sequência Técnica Recomendada

- [ ] Primeiro: auditar e melhorar empty output em `terminal/dialog/engine.js` usando outcome
      semântico do agent.
- [ ] Segundo: auditar tool lifecycle para `exec_command`, LIST, READ e patch/edit reais.
- [ ] Terceiro: criar documento de auditoria ampla de `src/copilot` com Agent, terminal, tools,
      MCP/OpenAI e fronteiras de arquitetura.
- [ ] Quarto: criar projection compartilhada de turn diagnostics em `presentation/runtime`.
- [ ] Quinto: executar live canônico com read/patch/exec/list/search após as correções.
- [ ] Sexto: iniciar decomposição de hotspots, começando por presenters e subcomandos sem mudar
      comportamento.

## 07. Comandos de Evidência Usados

- [x] `find src/copilot -maxdepth 3 -type d | sort`
- [x] `rg --files src/copilot --glob '!src/copilot/.ai/**'`
- [x] `rg -n "sem resposta pública materializada|ask_user|assistant.message|session.model_changed" src/copilot/...`
- [x] `rg -n "from '#copilot/terminal'|from '../terminal'" src/copilot/agent src/copilot/presentation src/copilot/sdk src/copilot/core src/copilot/config`
- [x] `find src/copilot/agent src/copilot/presentation src/copilot/terminal -name '*.js' -print0 | xargs -0 wc -l | sort -nr`
- [x] `npx vitest run tests/unit/copilot/terminal/test_commands_context.spec.js tests/unit/copilot/terminal/test_commands_session.spec.js tests/unit/copilot/terminal/test_commands_metrics_usage.spec.js`
- [x] `npx eslint src/copilot/terminal/commands/context.js src/copilot/terminal/commands/session.js src/copilot/terminal/commands/metrics.js ...`
- [x] `npx vitest run tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js`
- [x] `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs src/copilot/terminal/events/io-activity-events.js src/copilot/terminal/commands/tools.js src/copilot/terminal/events/tool-activity-presenter.js src/copilot/terminal/events/tool-lifecycle-runtime.js tests/unit/copilot/terminal/test_io_activity_events.spec.js tests/unit/copilot/terminal/test_commands_tools.spec.js tests/unit/copilot/terminal/test_tool_activity_presenter.spec.js tests/unit/copilot/terminal/test_tool_lifecycle_runtime.spec.js`
- [x] `npm run terminal:llm-b:live-test -- --live-scenario=file-write-roundtrip --timeout-ms=260000 --out-dir=artifacts/terminal-live/tool-lifecycle-file-write-roundtrip-rerun-20260604`

## 08. Notas de Risco

- [ ] Não remover a materialização terminal até provar que o agent cobre todos os casos visuais.
- [ ] Não transformar retry de empty output em retry automático depois de tools sem prova de
      idempotência.
- [ ] Não tornar fallback de modelo implícito em BYOK quando o contrato diz para bloquear.
- [ ] Não esconder raw payloads em detail/raw, porque eles são necessários para depuração.
- [ ] Não criar novos imports diretos de `terminal` em camadas inferiores.
- [ ] Não criar subpastas sem barrel quando cruzarem fronteiras.
