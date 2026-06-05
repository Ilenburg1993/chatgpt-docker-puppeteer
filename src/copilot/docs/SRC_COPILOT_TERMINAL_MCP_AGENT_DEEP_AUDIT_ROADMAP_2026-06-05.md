# SRC Copilot Terminal + MCP + Agent Deep Audit Roadmap - 2026-06-05

## 00. Status do Documento

- [x] Documento criado como guia amplo para a fase atual de `src/copilot`.
- [x] Escopo principal: `src/copilot/terminal`, `src/copilot/mcp`, `src/copilot/tools`, `src/copilot/agent`, `src/copilot/presentation`, `src/copilot/sdk` e acoplamentos diretos.
- [x] Escopo secundario: `src/copilot/model-gateway` quando a selecao/troca de modelo afeta UX, runtime, BYOK ou eventos do terminal.
- [x] O roadmap anterior `SRC_COPILOT_AGENT_TERMINAL_DEEP_UPGRADE_ROADMAP_2026-06-04.md` permanece como historico detalhado da primeira leva.
- [x] Este documento passa a guiar a proxima leva de arquitetura, UX, MCP/tools, Agent e terminal.
- [x] Checkboxes sao booleanos: feito ou pendente, sem estados parciais.
- [x] Nenhuma alteracao de codigo foi feita antes da criacao deste documento.

## 01. Fontes Oficiais Consultadas

- [x] MCP 2025-11-25 Overview: `https://modelcontextprotocol.io/specification/2025-11-25/basic`.
- [x] MCP 2025-11-25 Lifecycle: `https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle`.
- [x] MCP 2025-11-25 Schema Reference: `https://modelcontextprotocol.io/specification/2025-11-25/schema`.
- [x] MCP 2025-11-25 Server Overview: `https://modelcontextprotocol.io/specification/2025-11-25/server/index`.
- [x] OpenAI Apps SDK MCP Server: `https://developers.openai.com/apps-sdk/build/mcp-server`.
- [x] OpenAI Apps SDK Reference: `https://developers.openai.com/apps-sdk/reference`.
- [x] Conclusao oficial A: MCP e Apps SDK esperam descriptors de tool com `inputSchema`; quando houver `structuredContent`, deve haver `outputSchema` compativel.
- [x] Conclusao oficial B: resultados de tool devem preferir `structuredContent` para dados e `content` para texto legivel pelo modelo/cliente.
- [x] Conclusao oficial C: erros originados dentro da tool devem ser retornados como resultado com `isError: true`, nao como erro protocolar, para permitir autocorrecao pelo modelo.
- [x] Conclusao oficial D: `annotations` e hints como `readOnlyHint`, `destructiveHint`, `openWorldHint` influenciam a forma como o cliente enquadra consentimento, mas nao substituem autorizacao do servidor.
- [x] Conclusao oficial E: Apps SDK documenta `_meta["openai/toolInvocation/invoking"]` e `_meta["openai/toolInvocation/invoked"]` como textos curtos de status; nossa camada deve humaniza-los e evitar labels tecnicos.
- [x] Conclusao oficial F: `_meta["securitySchemes"]` deve espelhar `securitySchemes` para compatibilidade com clientes que leem apenas `_meta`.
- [x] Conclusao oficial G: lifecycle MCP exige inicializacao e negociacao de capacidades antes da operacao normal; diagnosticos do terminal devem separar falha de lifecycle, falha de tool e falha de modelo.

## 02. Evidencias Locais Coletadas

- [x] `git status` mostra apenas `.codex/config.toml` modificado, fora do escopo desta leva.
- [x] `src/copilot/terminal/repl/live-status-line.js` existe e ja renderiza uma linha viva fora do input.
- [x] `src/copilot/terminal/events/tool-activity-presenter.js` humaniza nomes de tools e remove IDs tecnicos da superficie default.
- [x] `src/copilot/terminal/events/tool-lifecycle-runtime.js` consolida eventos nativos/externos de lifecycle.
- [x] `src/copilot/terminal/commands/tools.js` possui `/tools` e `/tools diag`, ja com superficie default menos tecnica.
- [x] `src/copilot/terminal/events/io-activity-events.js` converte eventos de IO em linguagem humana.
- [x] `src/copilot/terminal/events/model-transition-presenter.js` ja centraliza parte da linguagem de transicao de modelo.
- [x] `src/copilot/sdk/session/session-events.js` normaliza `session.model_changed`, `session.tools_updated`, `session.plan_changed` e `session.mode_changed`.
- [x] `src/copilot/mcp/control-plane/tool-metadata.js` injeta `outputSchema` permissivo, `securitySchemes` e `_meta` de invocacao/invocado.
- [x] `src/copilot/mcp/control-plane/result.js` retorna `content`, `structuredContent` e `isError` corretamente.
- [x] `src/copilot/mcp/control-plane/annotations.js` define helpers para read-only, bounded write e destructive.
- [x] `src/copilot/mcp/registry.js` valida descriptors, schemas, annotations e resultados contra `outputSchema`.
- [x] `src/copilot/mcp/tools/repo-read.js` cobre leitura, arvore, busca, diff e status read-only.
- [x] `src/copilot/mcp/tools/repo-write.js` cobre write, create, patch, move, quarantine, restore, remove e batch.
- [x] `src/copilot/tools/file/read/read-file-content.js` oferece leitura local rica com cache, streaming, base64, cursor e metadados.
- [x] `src/copilot/tools/file/write/patch-file.js` oferece patch local exato com diffPreview sempre presente no resultado local.
- [x] `read_file_content`, `write_file_content`, `create_file`, `copy_file`, `move_file`, `delete_file` e `patch_file` locais agora declaram `instructions` explicitas para orientar a LLM-B sobre leitura antes de edicao, hashes, cursor, dry-run, patch cirurgico e fluxo automatico sem prompts redundantes.
- [x] `io-activity-events.js` agora propaga `dryRun` de `io.advisoryLimits` para projection, SSE `tool.lifecycle` e narrativa humana, evitando que simulacao de patch pareca edicao aplicada.
- [x] `package.json` possui scripts canonicos para `terminal:llm-b`, `terminal:llm-b:live-test`, `lint:copilot`, `typecheck:strict:src.copilot` e `test:copilot`.
- [x] `Makefile` possui bloco Model Gateway BYOK e comando `make terminal-aux-libs-smoke`, mas a superficie terminal/UX ainda nao tem uma familia propria suficientemente clara.
- [x] A live recente `file-write-roundtrip` passou e provou fluxo real com `report_intent`, `read_file_content`, `create_file`, `move_file`, `delete_file` e `ask_user`.
- [x] A live recente confirmou ausencia de prompt SDK local para create/move/delete sob configuracao atual de permissao automatica.
- [x] A live recente confirmou que o runner precisava distinguir empty recovery antes/depois de input humano; isso ja foi corrigido.
- [x] A varredura de tamanho mostrou hotspots acima de 1000 linhas em terminal, MCP, SDK, Agent e model-gateway.
- [x] A varredura de diretorios mostrou que `src/copilot/.ai` e grande e deve ser excluido de auditorias estruturais salvo quando o objetivo for estado gerado.

## 03. Situacao Atual Resumida

- [x] O terminal esta muito melhor do que a UX capturada nas screenshots antigas, mas ainda nao ha um contrato visual unico para todos os eventos.
- [x] A linha viva existe, mas algumas atualizacoes ainda dependem de heuristicas locais e timers.
- [x] A fala publica da LLM-B e os deltas possuem renderizadores dedicados.
- [x] Perguntas humanas possuem renderer separado e live estruturada cobrindo pending/answered sem poluicao duravel.
- [x] O lifecycle de tools ja foi humanizado em parte, mas read/list/patch/exec/batch ainda precisam de provas comparativas em linha viva, `/activity`, `/tools diag`, `/events` e export.
- [x] A camada MCP segue o contrato basico de `structuredContent` e `isError`.
- [x] A camada MCP ainda usa um `baseMcpOutputSchema` permissivo para varias tools, o que e aceitavel como ponte, mas nao e ideal.
- [x] A camada local `tools/file` retorna shapes diferentes dos MCP tools, o que obriga o terminal a normalizar mais.
- [x] A selecao/troca de modelo possui presenter e normalizer, mas ainda precisa de trilha unica do comando ate o modelo observado por turno.
- [x] BYOK e model-gateway ja possuem muitos comandos, mas o operador ainda pode receber linguagem misturada entre sessao preparada, sessao viva, provider, modelo e fallback.
- [x] A arquitetura por barrels existe em grande parte, mas ainda ha imports diretos e hotspots que devem ser avaliados com criterio, nao mecanicamente.
- [x] Os validadores escopados recentes estao verdes, mas ainda nao houve bateria ampla desta nova leva.

## 04. Situacao Ideal

- [ ] O operador ve uma UX fluida, tecnica, compacta, previsivel e bonita, sem IDs internos na superficie default.
- [ ] A linha viva e permanente, nao ocupa o input e comunica a atividade real: pensando, lendo contexto, usando tool, aguardando operador, emitindo delta, finalizando resposta, trocando modelo ou recuperando erro.
- [ ] Toda linha relevante tem timestamp ISO 8601 completo quando aparece como evento historico, diagnostico ou export.
- [ ] A linha viva pode omitir timestamp por economia visual, mas o detalhe/export sempre preserva timestamp completo.
- [ ] Cores sao padronizadas por papel: usuario, LLM-B, thinking, tools, IO, eventos, warning, erro, modelo, delta e espera.
- [ ] Names tecnicos como `report_intent`, `request_user_input`, `read_file_content`, `chatcmpl-tool-*` e enums internos aparecem apenas em raw/detail.
- [ ] A camada terminal recebe eventos operacionais canonicos e so renderiza; nao precisa reparsear payload cru em cada comando.
- [ ] O Agent e dono da semantica de turno: resposta publica, input humano pendente, tool-only, transicao de protocolo ou vazio.
- [ ] `presentation/` e dona das projecoes compartilhadas entre terminal, server, channel e automation.
- [ ] `sdk/` e dona de eventos vanilla e capacidades reais do SDK.
- [ ] MCP tools seguem contrato rico: `title`, `description`, `inputSchema`, `outputSchema`, `annotations`, `securitySchemes`, `_meta`, `structuredContent`, `content` legivel e `isError` em falhas de tool.
- [ ] Ferramentas locais e MCP usam uma taxonomia comum de operacao: READ, LIST, SEARCH, DIFF, WRITE, CREATE, PATCH, MOVE, QUARANTINE, RESTORE, DELETE, EXEC, ASK, INTENT.
- [ ] O terminal consegue renderizar tool local, SDK, MCP ou SSE com o mesmo shape humano.
- [ ] A selecao/troca de modelo mostra cadeia completa: pedido, tentativa, confirmacao SDK, modelo observado no turno, eventual fallback e persistencia.
- [ ] BYOK nunca mistura provider preparado com provider vivo sem indicar fronteira.
- [ ] Ollama/local continua suportado, mas nao selecionado por default sem pedido explicito do operador.
- [ ] Live tests provam cenarios reais antes de declararmos uma melhoria de UX como finalizada.

## 05. Principios Tecnicos

- [ ] Preservar `src/copilot` como foco primario.
- [ ] Nao tocar em `.codex/config.toml` sem pedido explicito.
- [ ] Usar barrel-first para novos imports/exports.
- [ ] Nao criar paralelismos de arquitetura quando ja existir owner claro.
- [ ] Preferir normalizacao estrutural a regexes locais quando houver shape estruturado disponivel.
- [ ] Manter raw/detail/export tecnicos completos, mesmo quando a superficie default for bonita.
- [ ] Nao remover seguranca de servidor para melhorar UX; melhorar descriptors, annotations, batch/plan tools e contrato operacional.
- [ ] Validar escopado apos blocos substanciais; baterias amplas so em marcos maiores.
- [ ] Usar live tests para timing, deltas, asks, tools, modelo e terminal visual.
- [ ] Separar bug real de preferencia estetica.
- [ ] Evitar refactor cosmetico em hotspots sem teste ou ganho operacional claro.

## 06. Decisoes de UX Canonicas

- [ ] Linha viva: uma unica linha transitoria, sempre fora do input, truncada sem quebrar ANSI.
- [ ] Historico: eventos importantes ficam em linhas persistentes curtas.
- [ ] Detalhe: `/activity`, `/tools diag`, `/events`, `/history`, `/export` preservam a trilha tecnica.
- [ ] Raw: IDs, call IDs, session IDs completos, payload cru e enums internos ficam apenas em raw/detail.
- [x] Pergunta humana: deve parecer uma pergunta do sistema de dialogo, nao uma tool comum.
- [ ] Tool em execucao: deve mostrar verbo humano, alvo seguro, status e duracao; nunca apenas nome tecnico.
- [ ] Tool concluida: deve mostrar resultado resumido e proximo estado, sem spam repetitivo.
- [ ] Delta publico: deve mudar estado para respondendo rapidamente.
- [ ] Thinking: deve ser sinalizado como raciocinio/trabalho interno, sem poluir transcript publico.
- [ ] Modelo: troca deve aparecer como evento operacional de alto nivel, nao como warning ambiguo.
- [ ] Erro: deve conter causa, impacto e proximo passo.
- [ ] Empty output: deve conter causa provavel, evidencias, acao sugerida e relacao com provider/modelo quando aplicavel.

## Faixa A - Inventario Arquitetural Profundo

- [x] A.1 Mapear hotspots principais de `src/copilot`.
- [x] A.2 Confirmar que `.ai` deve ser excluido de varreduras estruturais por default.
- [x] A.3 Identificar owners atuais: terminal, mcp, tools, sdk, agent, presentation, model-gateway.
- [ ] A.4 Rodar inventario de imports cruzados por camada.
- [ ] A.5 Comparar `module-map.js` e barrels com filesystem real.
- [ ] A.6 Identificar imports diretos que deveriam passar por barrel.
- [ ] A.7 Marcar hotspots acima de 1000 linhas com dono e plano de decomposicao.
- [ ] A.8 Criar teste/analise automatica contra novas violacoes de camada.
- [ ] A.9 Documentar excecoes legitimas de arquitetura.
- [ ] A.10 Atualizar este documento com achados da analise automatica.

## Faixa B - Contrato Operacional de Eventos do Terminal

- [x] B.1 Confirmar existencia de presenters de tool, intent, ask, model transition e stream publico.
- [ ] B.2 Definir tipo canonico `TerminalOperationalEvent` em camada apropriada.
- [ ] B.3 Mapear eventos SDK/Agent/MCP/SSE para taxonomia comum.
- [ ] B.4 Unificar labels humanos em um glossario compartilhado.
- [ ] B.5 Garantir timestamp ISO 8601 completo em eventos persistidos.
- [x] B.6 Garantir que linha viva use a mesma taxonomia dos eventos persistidos.
- [x] B.7 Remover parse ad-hoc duplicado onde presenter comum ja cobre.
- [ ] B.8 Criar testes para cada papel visual: user, assistant, thinking, tool, io, warning, error, model.
- [ ] B.9 Garantir que raw/detail continuem contendo IDs completos.
- [ ] B.10 Criar snapshot textual de UX para regressao.
- [x] B.11 Diferenciar I/O simulado (`dryRun`) de mutacao persistente na taxonomia humana e no evento `tool.lifecycle`.

## Faixa C - Linha Viva Permanente

- [x] C.1 Confirmar existencia de `live-status-line.js`.
- [x] C.2 Confirmar truncamento single-line sem quebrar ANSI.
- [x] C.3 Confirmar fases existentes: idle, boot, tool, turn, thinking, streaming, question, task, compaction, model, error.
- [ ] C.4 Auditar quais eventos nao atualizam activity atual.
- [ ] C.5 Garantir que READ/LIST/SEARCH/DIFF/EXEC/PATCH/MOVE/DELETE aparecam com alvo.
- [ ] C.6 Garantir que ask_user substitua heartbeat generico por estado claro de espera humana.
- [ ] C.7 Garantir que delta publico mude estado para respondendo no primeiro chunk.
- [x] C.8 Garantir que troca de modelo apareca na linha viva como estado transitorio.
- [ ] C.9 Garantir que cooldown/rate limit de provider apareca de modo compacto.
- [x] C.10 Criar live visual com captura de terminal igual ao operador.
- [x] C.11 Deduplicar pulsos identicos imediatos da linha viva na borda fisica `writeInlineStatus`, reduzindo repeticao visual sem perder eventos estruturados.
- [x] C.12 Impedir que telemetria normal de `llm.usage` BYOK substitua o estado vivo de tool/turn; apenas mismatch vira alerta foreground.
- [x] C.13 Criar fase `model` no `activity-state` e render compacto `modelo solicitado/confirmado` na linha viva.

## Faixa D - Tools Local/MCP/SDK como UX Unica

- [x] D.1 Confirmar camada MCP com `repo_read_file`, `repo_apply_patch`, `repo_create_file`, `repo_move_file`, `repo_quarantine_file`, `repo_remove_file`.
- [x] D.2 Confirmar camada local com `read_file_content`, `patch_file`, `write_file_content` e associados.
- [x] D.3 Confirmar `tool-activity-presenter` ja normaliza argumentos e resultados de multiplos envelopes.
- [ ] D.4 Criar matriz de equivalencia entre tools locais e MCP.
- [x] D.5 Padronizar campos operacionais: action, target, command, filters, resultSummary, durationMs, status.
- [x] D.6 Harmonizar diffPreview: default suprimido em superficie humana, disponivel sob detail/raw.
- [x] D.7 Garantir que `patch_file` local nao despeje diff grande em superficies default do terminal.
- [x] D.8 Garantir que `read_file_content` local mostre range, bytes e truncamento de modo compacto.
- [x] D.9 Garantir que `patch_file dryRun=true` apareca como `simulacao de edicao`, nao como edicao aplicada.
- [x] D.10 Garantir que batch MCP mostre operacoes agregadas sem esconder risco.
- [x] D.11 Criar testes unitarios de presenter para read/list/search/diff/patch/exec/batch.
- [ ] D.12 Criar live real com read, list, patch, exec e batch.
- [x] D.13 Instrucoes de mutacao local agora proíbem narrar create/write/patch/copy/move/delete antes de retorno `success` da tool real.
- [x] D.14 Auditar claims publicos da LLM-B contra `turn-trace`: quando texto afirma tool concluida sem lifecycle recente, terminal alerta o operador.
- [x] D.15 Recovery pós-tools preserva allowlist e pergunta exata do turno original para evitar ferramenta alternativa ou ask_user improvisado.

## Faixa E - MCP e Apps SDK Compliance

- [x] E.1 Confirmar `okResult` e `errorResult` alinhados com `structuredContent`, `content` e `isError`.
- [x] E.2 Confirmar `tool-metadata.js` injeta `securitySchemes`, `_meta` e `outputSchema` permissivo.
- [x] E.3 Confirmar `annotations.js` cobre read-only, bounded write e destructive.
- [ ] E.4 Auditar todas as MCP tools sem `title` adequado.
- [x] E.5 Auditar todas as MCP tools com `_meta` default tecnico demais.
- [x] E.6 Trocar status default `Running <tool.name>` por labels humanos quando possivel.
- [ ] E.7 Criar outputSchemas especificos para repo-read e repo-write criticos.
- [ ] E.8 Criar teste que lista tools e valida descriptor Apps SDK/MCP.
- [ ] E.9 Criar teste que chama tools criticas e valida `structuredContent` contra `outputSchema`.
- [ ] E.10 Documentar limites reais: annotations reduzem friccao, mas cliente ChatGPT pode pedir aprovacao.
- [ ] E.11 Verificar compatibilidade com `openai/toolInvocation/invoking` e `invoked` <= 64 chars.

## Faixa F - Ask User e Elicitation

- [x] F.1 Confirmar que pergunta humana real ocorreu na live recente.
- [x] F.2 Confirmar que o runner live reconhece recovery quando ha pergunta depois de empty recovery.
- [x] F.3 Auditar `request_user_input`, `ask_user` e elicitation no SDK.
- [x] F.4 Garantir que pergunta humana nao seja exibida como tool comum.
- [x] F.5 Garantir que pending question tenha lifecycle: criada, aguardando, respondida, consumida, limpa.
- [ ] F.6 Garantir que timeout de pergunta gere erro compreensivel e nao repeticao poluida.
- [x] F.10 Separar timeout global do cenario e timeout pos-`ask_user`, dando orçamento proprio para continuação depois da resposta humana.
- [x] F.7 Criar teste unitario para renderer de pending/answered.
- [x] F.8 Criar live com pergunta curta e resposta do operador.
- [x] F.9 Garantir que a linha viva indique espera humana sem bloquear input.
- [x] F.11 Humanizar `elicitation.pending/completed` como formulario ao operador, usando o mesmo renderer de pergunta humana em vez de superficie tecnica do SDK.

## Faixa G - Empty Output, Recovery e Erros

- [x] G.1 Empty output ja possui diagnostico com causa, evidencias e proximo passo no roadmap anterior.
- [x] G.2 Runner live ja evita falso positivo quando input humano ocorre depois do empty.
- [ ] G.3 Auditar turn trace completo para provider failure tardio.
- [x] G.4 Separar empty de tool-only bem-sucedido, pending question e protocolo.
- [x] G.5 Ligar provider/model failure ao runtime health BYOK quando aplicavel.
- [ ] G.6 Garantir cooldown de retry sem mascarar falha real.
- [ ] G.7 Criar testes unitarios para cada causa de empty.
- [ ] G.8 Criar live que simule falha de modelo e verifica UX.
- [ ] G.9 Garantir mensagem final sem verborragia e sem loops repetitivos.
- [x] G.10 Humanizar falha BYOK de turno vivo como `Rota BYOK`, `Destino`, `Janela` e `Ação`, sem `dialog.byok_*` ou mensagem crua na superfície default.

## Faixa H - Model Switching, BYOK e Sessao Viva

- [x] H.1 Confirmar presenter de transicao de modelo.
- [x] H.2 Confirmar normalizer de `session.model_changed`.
- [x] H.3 Confirmar `/byok model` diferencia sessao preparada e sessao viva.
- [x] H.4 Auditar fluxo completo: comando -> request live switch -> SDK -> evento -> terminal -> proximo turno.
- [ ] H.5 Registrar modelo observado por turno em projection compartilhada.
- [ ] H.6 Garantir mismatch preparado/vivo como estado aguardando confirmacao, nao erro.
- [ ] H.7 Garantir que fallback BYOK nao caia em Copilot auto quando a policy bloquear.
- [ ] H.8 Garantir que Ollama/local nao entre em default selector sem pedido explicito.
- [ ] H.9 Criar live de troca real de modelo com confirmacao.
- [ ] H.10 Criar live de fallback/erro de provider com UX clara.
- [x] H.11 Separar core puro de apresentacao de transicao de modelo do renderer visual, evitando acoplamento BYOK -> UI/config.
- [x] H.12 Correlacionar pedido local/auto de modelo vivo com `session.model_changed` posterior em detalhe/SSE.
- [x] H.13 Evitar que confirmacao SDK correlacionada invada o prompt/input; a confirmacao fica em activity, `/live` e SSE.

## Faixa I - Model Gateway e Pre-Runtime como Fonte de UX

- [x] I.1 Model-gateway ja possui scripts de build, selection, runtime health e live readiness.
- [x] I.2 Makefile ja possui comandos de cockpit BYOK.
- [ ] I.3 Auditar como selecao pre-runtime aparece no terminal.
- [ ] I.4 Garantir que modelos excluidos por acesso/quota/local-policy expliquem motivo de forma humana.
- [ ] I.5 Separar metadados canonicos, filtros pre-runtime, runtime health e live probes.
- [ ] I.6 Garantir que provider local/Ollama seja opt-in.
- [ ] I.7 Garantir que rate limit/quota esgotada atualize ledger dinamico sem corromper catalogo canonico.
- [ ] I.8 Expor resumo compacto em `/byok`, `/status`, `/health` e linha viva quando relevante.
- [ ] I.9 Criar comandos de terminal para explicar decisao do seletor sem rodar modelo.

## Faixa J - Comandos Canonicos e Superficie do Operador

- [x] J.1 `package.json` tem scripts essenciais de terminal, model-gateway, lint, typecheck e testes.
- [x] J.2 Makefile tem comandos BYOK/model-gateway.
- [ ] J.3 Criar familia Makefile para terminal UX: status, live-test-plan, live-test-run, live-artifacts, terminal-ux-smoke.
- [ ] J.4 Criar scripts package equivalentes para terminal UX.
- [ ] J.5 Garantir `/help` e banner terminal apontem para comandos canônicos sem poluir primeira tela.
- [ ] J.6 Documentar comandos para operador humano e LLM.
- [ ] J.7 Separar comandos de leitura, diagnostico, mutacao e live.
- [ ] J.8 Criar comando de inventario que compare package, Makefile e terminal.
- [x] J.9 Redesenhar `/events --raw` para preview compacto por default em TTY, evitando despejo JSON massivo no fluxo visual.
- [ ] J.10 Aplicar o mesmo padrão deliberado/preview/full a `/tools raw` e demais superfícies raw.

## Faixa K - Auxiliar UX Libs

- [x] K.1 Existem docs anteriores de libs auxiliares em `src/copilot/docs/terminal`.
- [x] K.2 Investigar `gum` em documentacao oficial: menus, inputs, confirms, estilos, fallback.
- [x] K.3 Investigar `fzf`: selecao de arquivos/contexto, preview, portabilidade.
- [x] K.4 Investigar `bat`: preview de arquivos, temas, fallback para `sed`.
- [x] K.5 Investigar `glow`: markdown legivel, pager e fallback.
- [x] K.6 Investigar `delta`: diffs legiveis, integracao com git e patch previews.
- [x] K.7 Investigar `atuin`: historico e riscos de privacidade.
- [x] K.8 Investigar `zoxide`: navegacao e custo de adocao.
- [x] K.9 Investigar `jq/yq`: contratos estruturados com LLM, validacao e fallback.
- [x] K.10 Decidir aceitar/rejeitar cada lib com criterios de valor, dependencia, portabilidade, manutencao e fallback.
- [x] K.11 Nao implementar lib antes de completar o documento de decisao especifico.

## Faixa L - Live Tests e Evidencia Visual

- [x] L.1 Live `file-write-roundtrip` passou com create/move/delete/ask.
- [ ] L.2 Criar live de read/list/search/diff.
- [x] L.3 Criar live de patch/edit com diff suprimido no default.
- [ ] L.4 Criar live de exec_command seguro.
- [ ] L.5 Criar live de ask_user com resposta tardia e sem timeout falso.
- [x] L.11 Runner live agora registra `timeoutStage` e `timeoutBudgetMs`, rearmando a janela para `post-ask-continuation` quando a resposta final ao `ask_user` e enviada.
- [x] L.12 Runner live agora bloqueia auto-resposta quando `ask_user` aparece antes de todas as tools obrigatorias do cenario terem lifecycle/postToolUse confirmado.
- [ ] L.6 Criar live de model switch.
- [ ] L.7 Criar live de provider failure/quota/rate-limit.
- [ ] L.8 Capturar terminal como operador humano ve.
- [ ] L.9 Comparar artefatos SSE, summary, transcript e tela.
- [ ] L.10 Corrigir discrepancias antes de promover marco.

## Faixa M - Testes, Validadores e Gates

- [x] M.1 Validacoes escopadas recentes passaram para tool lifecycle UX.
- [ ] M.2 Criar suite escopada `terminal ux` com presenters, linha viva e comandos.
- [ ] M.3 Criar suite escopada MCP descriptor/result contract.
- [ ] M.4 Criar suite escopada Agent turn semantic result.
- [ ] M.5 Criar suite escopada BYOK model transition.
- [ ] M.6 Rodar lint/typecheck de `src/copilot` em marco maior.
- [ ] M.7 Rodar `test:copilot` amplo apenas apos blocos substanciais.
- [ ] M.8 Criar relatorio de regressao quando live falhar.

## Faixa N - Hotspots e Decomposicao

- [x] N.1 Identificados hotspots grandes em terminal, MCP, SDK, Agent e model-gateway.
- [ ] N.2 Decompor apenas quando reduzir risco ou duplicacao real.
- [x] N.3 Iniciar decomposicao de `engine.js` extraindo classificacao pura de saida vazia/nao textual.
- [ ] N.4 Extrair glossarios e renderers antes de mexer em comandos grandes.
- [ ] N.5 Evitar refactor amplo sem live/test correspondente.
- [ ] N.6 Documentar cada decomposicao com owner e contrato.

## Faixa O - Sequencia Imediata Recomendada

- [x] O.1 Criar este documento antes de novas transformacoes.
- [x] O.2 Implementar auditoria MCP descriptor/status labels humanos.
- [x] O.3 Fortalecer presenters para local/MCP tools com action/target/result comuns.
- [x] O.4 Cobrir read/list/patch/exec nos testes de presenter e linha viva.
- [x] O.5 Rodar live curta de read/list/patch/exec, incluindo `file-patch-roundtrip`.
- [ ] O.6 Corrigir discrepancias visuais observadas.
- [ ] O.7 Auditar model switch end-to-end.
- [ ] O.8 Criar live de model switch.
- [ ] O.9 Consolidar comandos canonicos de terminal UX em package/Makefile.
- [ ] O.10 Investigar libs auxiliares e criar documento especifico antes de qualquer dependencia nova.

## 07. Bugs e Gaps de Alta Prioridade

- [ ] Gap 1: `baseMcpOutputSchema` permissivo reduz validacao real das tools mais importantes.
- [x] Gap 2: `_meta` default ainda pode gerar textos tecnicos `Running <tool.name>`.
- [x] Gap 3: camada local `patch_file` retorna diff sempre; terminal precisa suprimir/humanizar default.
- [x] Gap 4: falta matriz unica local/MCP/SDK para action, target e result.
- [ ] Gap 5: eventos de modelo ainda nao formam trilha unica ate modelo observado por turno.
- [ ] Gap 6: Makefile/package nao tem familia terminal UX completa.
- [ ] Gap 7: live visual agora possui cenario de patch, mas ainda precisa execucao e cobertura read/list/search/exec/model switch.
- [ ] Gap 8: ask_user ainda precisa de teste de timeout e limpeza persistida.
- [ ] Gap 9: quota/rate-limit/provider failure ainda precisa aparecer como estado operacional claro, nao apenas erro tecnico.
- [ ] Gap 10: docs de libs auxiliares precisam de decisao atualizada antes de novas dependencias.
- [x] Gap 11: live `file-patch-roundtrip` mostrou timeout/latencia alta na continuacao pos-`ask_user`; o runner agora separa stage/budget e nao encerra imediatamente poucos segundos depois de a resposta humana ser enviada.
- [x] Gap 12: `patch_file dryRun=true` aparecia como `Arquivo edição ok`; agora projection, SSE e linha viva preservam semantica de simulacao.
- [x] Gap 13: fala publica da LLM-B podia exibir/exportar HTML bruto; renderer de turno e `/export` agora escapam markup em texto nao confiavel.
- [x] Gap 14: live pass3 mostrou alucinacao operacional (`delete_file` descrito no texto sem tool real); runner agora nao responde automaticamente ao `ask_user` se tools obrigatorias estiverem incompletas.
- [x] Gap 15: prompt live permitia deltas com markup; agora exige texto puro nas linhas `DELTA-CANONICAL` e o runner tem criterio contra HTML bruto na superficie publica.
- [x] Gap 16: terminal confiava visualmente em claims publicos de tool; agora `assistant-tool-claim-audit` compara resposta publica com o ledger recente e emite warning/SSE quando falta lifecycle comprovado.
- [x] Gap 17: recuperação automática pós-tools podia sair da allowlist do pedido original (`exec_command` em live de file tools); prompt de recovery agora injeta allowlist/pergunta exata e runner detecta `ask_user` divergente.
- [x] Gap 18: linha viva podia mostrar `Uso BYOK sem pedido premium` como trabalho atual durante tool/turn; uso normal agora é observação/background, mantendo mismatch como alerta.
- [x] Gap 19: troca de modelo tinha linguagem paralela entre `/byok model`, automação e `session.model_changed`; agora há core puro compartilhado, fase `model` e correlação request -> confirmação SDK.
- [x] Gap 20: live pass3 mostrou `Modelo SDK confirmado` assíncrono entre prompt e comando seguinte; confirmações correlacionadas agora não imprimem linha solta no prompt.
- [x] Gap 21: `elicitation.pending` ainda podia aparecer como termo tecnico; agora a superficie default usa `Formulário ao operador`, ação clara e IDs apenas como pedido secundario/detail.
- [x] Gap 22: a classificacao de turno sem transcript publico vivia acoplada ao `engine.js`; agora `empty-output-diagnosis` separa `pending_human_input`, `tool_only`, `protocol_transition` e `empty_failure` em core puro testavel.
- [x] Gap 23: falha BYOK de turno vivo expunha `dialog.byok_*` e mensagem crua do provider no terminal; agora um presenter puro gera resumo humano e preserva detalhe técnico em activity/SSE/health.
- [x] Gap 24: `/events --raw` despejava JSON extenso dentro da tela visual; agora default é preview JSONL compacto, com `/events --raw full` para auditoria completa.
- [x] Gap 25: `payloadPreview` de eventos muito estruturais podia conter mini-JSON; agora activity, hook e lifecycle têm humanizadores específicos no preview raw.
- [x] Gap 26: prompt idle podia reaparecer entre resumo de tools e transcript final quando `assistant.turn_end` chegava antes da materialização final; agora redraw considera materialização ativa, não apenas `busy`.
- [x] Gap 27: `/events` default ainda mostrava limpeza interna de sessões SDK (`session.deleted`); agora lifecycle rotineiro fica em filtros explícitos/raw/json.
- [x] Gap 28: continuação pós-`ask_user` usava estado genérico de resposta humana e recuperação automática mínima; agora há presenter compartilhado para aguardando continuação, auto-retomada e diagnóstico.
- [x] Gap 29: superfícies humanas de troca de modelo ainda citavam `session.model_changed`; agora falam em confirmação do SDK/uso observado, mantendo o nome cru apenas em SSE, adapters e inspeção técnica.
- [x] Gap 30: `/index search` mostrava marcadores FTS5 como `[terminal]`, parecendo caminho adulterado; agora o comando humano converte highlights para ANSI e preserva texto copiável sem colchetes artificiais.
- [x] Gap 31: teste unitário de `/index` apagava o índice real em `copilot.sqlite`; agora usa SQLite em memória via mock de `#copilot/db`, mantendo o estado operacional do terminal intacto.
- [x] Gap 32: `/index build` ficava silencioso durante varredura/indexação longa; agora consome `copilot.io.scan`/`copilot.io.index` temporariamente e imprime progresso humano por marcos.
- [x] Gap 33: `operator-ux-cycle` avançava após palavras genéricas do status BYOK (`Sessão viva`/`Modelo vivo`) e podia intercalar `/activity` antes de `Modelo vivo solicitado`; agora espera o marcador específico de pedido/adiamento/falha.
- [x] Gap 34: `/session save` imprimia caminho absoluto do workspace na superfície default; agora usa path relativo humano, preservando o caminho completo nas camadas de persistência.
- [x] Gap 35: `/metrics` imprimia o arquivo do archive SSE como caminho absoluto do workspace; agora a superfície default usa caminho relativo humano e mantém o caminho completo apenas em estado interno/export técnico.
- [x] Gap 36: `/session list` e `/session restore` ainda usavam ANSI literal, IDs/status crus e sufixos como `[ready]`; agora usam tema central, rótulos humanos, IDs compactos e instruções consistentes.
- [x] Gap 37: `/sdk skills` expunha paths absolutos de skills em projetos externos; agora paths passam pelo formatador de operador e ficam compactos.
- [x] Gap 38: `/workspace mirror|promote|sync` ainda usava `ok=`, `fail=`, `root=` e `traceId` na superfície principal; agora usa contadores humanos, paths compactos e rótulo de auditoria.
- [x] Gap 39: `/byok status` ainda mostrava `ativo sim`, `protocolo -` e `Azure -`; agora usa estado natural, autenticação/capacidades humanizadas e omite campos opcionais ausentes.
- [x] Gap 40: `/model list` misturava modelo, `ativo` e badges `[raciocínio]`/`[visão]` sem separadores claros; agora usa uma row compacta por modelo com `· ativo · raciocínio · visão`.
- [x] Gap 41: live pass11 mostrou `LLM-B modelo confirmado .../sdk models` colado ao input; agora confirmação/reconfirmação de modelo é status concluído e não mantém overlay quando o runtime está idle.
- [x] Gap 42: `/sdk models` ainda imprimia `reasoning low,medium,high`; agora usa `raciocínio low, medium, high` com espaçamento humano.
- [x] Gap 43: `/git help` empilhava todos os comandos em uma única row multiline; agora renderiza ações nomeadas, uma por linha.
- [x] Gap 44: live pass13 falhou por critério antigo que exigia `Comandos` em `/git help`; harness agora valida as novas ações nomeadas e reprova a row multiline antiga.
- [x] Gap 45: `/attach` vazio e fila preenchida ainda imprimiam frases soltas fora do tema; agora usam rows `Uso`/`Próximo` e paths formatados para operador.
- [x] Gap 46: live pass15 mostrou a linha viva de modelo colando no comando seguinte (`…/activity 10`) quando o operador apertava Enter; agora o REPL limpa a linha viva no evento `line` antes de despachar qualquer comando.
- [x] Gap 47: `/activity` ainda orientava o operador com `trace, engine e streaming`; agora a cópia padrão fala em `auditoria técnica` e deixa IDs brutos para o modo detalhado.
- [x] Gap 48: live pass16 mostrou que o harness exigia uma corrida temporal específica (`Troca de modelo solicitada` como estado atual), embora a UX correta já pudesse estar em `Modelo SDK confirmado`; agora o critério aceita confirmação rápida desde que a timeline retenha o pedido.
- [x] Gap 49: `/byok model` imprimia o painel completo de `/byok` antes do resultado, repetindo catálogo, rotina, comandos avançados e fronteira; agora usa um resumo compacto `BYOK modelo` focado em preparada/sessão viva/fronteira/ação.
- [x] Gap 50: o resumo compacto de `/byok model` ainda herdava labels longos (`perfil/preset/provedor/modelo`) e ação explicativa extensa; agora compacta o vínculo vivo e reduz a ação para confirmação operacional.
- [x] Gap 51: a limpeza da linha viva no submit usava `clearInlineStatus()` e podia limpar a linha do prompt mesmo sem overlay reservado; agora o REPL usa `clearReservedInlineStatus()` e só remove status vivo real.
- [x] Gap 52: pass20 revelou que a nova função de limpeza reservada não estava no barrel `terminal/dialog`; agora `clearReservedInlineStatus` é exportada pelo barrel canônico.
- [x] Gap 53: `/model list` despejava 40 modelos por padrão e dominava a tela; agora mostra 20 por padrão, aceita limite explícito (`/model list 50`/`limit=50`) e mantém `full` para catálogo completo.
- [x] Gap 54: pass22 mostrou clear reservado colando no prompt antes do próximo comando porque a reserva continuava marcada após submit; agora `clearReservedInlineStatus()` libera a reserva depois de limpar.
- [x] Gap 55: live canônico de pergunta real mostrou critério antigo esperando `trace, engine e streaming`; harness atualizado para a cópia humana atual de `/activity detail`.
- [x] Gap 56: live canônico mostrou `você[...]›` antes do transcript final da LLM-B; o primeiro delta visível agora limpa explicitamente a linha interativa antes de abrir o bloco durável.
- [x] Gap 57: `/usage now` padrão ainda dizia `ambiente, SDK e hub conectados`; agora a superfície normal fala `Conexão · sessão conectada`, deixando IDs e SDK/hub para `detail`.
- [x] Gap 58: live canônico pass3 mostrou que tools em grupos separados podiam redesenhar prompt entre resumo de tool e transcript final; `printlnBlock` agora não repinta prompt enquanto a atividade operacional está em fase de turno/tool/streaming/thinking.
- [x] Gap 59: recovery pós-ask dominou `/events` default e expôs labels crus `task started`, `task queued`, `pending messages modified` e `session tools updated`; agora estes eventos possuem rótulos humanos em português.
- [x] Gap 60: recovery automático pós-ask tinha ação automática, mas não exibia retomada manual; agora o card mostra `Retomar /turn ...` e o runner distingue falha vazia recuperada de bloqueio real.
- [x] Gap 61: libs auxiliares precisavam de decisão arquitetural antes de novas integrações; criado `TERMINAL_AUX_LIBS_UX_ARCHITECTURE_DECISION_2026-06-05.md` com inventário, decisões e roadmap AUX.
- [x] Gap 62: rodapés de preview divergiam entre `/fs`, `/git` e `/gh`; agora `renderTerminalPreviewSummary` padroniza renderer externo, fallback canônico, motivo, filtro aplicado e truncamento.
- [x] Gap 63: `/fs preview --json|--yaml --lines` ignorava o limite em previews estruturados e podia despejar centenas de linhas; agora o renderer estruturado limita linhas e reporta `truncado`.
- [x] Gap 64: `/export` removia HTML e redigia segredos, mas podia preservar ANSI/OSC/control codes vindos de renderers externos; agora sanitiza texto terminal antes da redação e do Markdown.

## 08. Criterio de Marco

- [ ] Marco UX-1: read/list/patch/exec aparecem bonitos em linha viva, historico, `/activity`, `/tools diag` e export.
- [x] Marco UX-2: ask_user/request_user_input aparece como pergunta humana real, sem repeticao poluida e sem timeout falso no fluxo live estruturado.
- [ ] Marco UX-3: model switch tem trilha completa e compreensivel.
- [ ] Marco MCP-1: descriptors criticos possuem labels humanos, schemas melhores e results validados.
- [ ] Marco Agent-1: resultado semantico de turno e consumido sem reinterpretacao paralela desnecessaria.
- [ ] Marco BYOK-1: provider/modelo/quota/rate-limit aparecem separados entre catalogo, pre-runtime e runtime.
- [ ] Marco Ops-1: package, Makefile e terminal possuem comandos canonicos consistentes.
- [x] Marco Live-1: `file-patch-roundtrip` possui artefato live PASS com tool lifecycle, ask_user, export e SSE canônicos.

## 09. Diario Tecnico do Turno Atual

- [x] 2026-06-05: criado o cenario live `file-patch-roundtrip` no runner canonico do Terminal LLM-B.
- [x] 2026-06-05: o cenario novo exige `create_file`, `read_file_content includeHash=true`, `patch_file dryRun=true`, `patch_file dryRun=false`, leitura de confirmacao e `delete_file`.
- [x] 2026-06-05: o cenario novo verifica lifecycle de `Criar arquivo`, `Editar arquivo` e `Excluir arquivo`, marcador `PATCH-ROUNDTRIP-APPLIED`, render humano e ausencia do badge incorreto de leitura para patch/delete.
- [x] 2026-06-05: ajustado o criterio de foco de tool para permitir transicoes internas quando uma mesma tool precisa aparecer mais de uma vez no mesmo cenario, como `patch_file` dry-run seguido de apply.
- [x] 2026-06-05: reforcadas `instructions` das file-tools locais de escrita para orientar replacement total, criacao, copia, movimento, cleanup, hashes e ausencia de prompt redundante em modo automatico.
- [x] 2026-06-05: executado live `file-patch-roundtrip` em PTY; o fluxo funcional completou, mas o summary falhou por `no-prompt-double-render`, localizado logo apos `Intervenção modelo ocioso`.
- [x] 2026-06-05: corrigido handoff de texto livre para turno: `parkTerminalPromptForContinuation()` agora cobre o fallback de modelo ocioso e a linha viva nao repinta prompt extra durante o estacionamento.
- [x] 2026-06-05: reexecutado live `file-patch-roundtrip` em PTY; regex de prompt duplicado caiu de 1 para 0 no plain log.
- [x] 2026-06-05: corrigida UX de dry-run de patch; `io.advisoryLimits.dryRun=true` agora gera `simulacao de edicao` na narrativa viva, em `/activity` e no evento `tool.lifecycle.ioDryRun`.
- [x] 2026-06-05: validado o contrato de dry-run com `test_io_activity_events.spec.js` e dedup I/O, incluindo separacao semantica para evitar colisao entre dry-run e apply no mesmo alvo.
- [x] 2026-06-05: runner live passou a rearamar timeout na fase `post-ask-continuation`; se a continuação apos `ask_user` demorar demais, o summary indicara stage/budget e coletara diagnosticos antes de encerrar.
- [x] 2026-06-05: `writeInlineStatus` ganhou dedupe visual curto por texto sem ANSI, evitando pares identicos de `LLM-B pensando/finalizando` quando duas fontes pedem o mesmo repaint quase ao mesmo tempo.
- [x] 2026-06-05: presenter de `repo_apply_file_batch` passou a mostrar contagem planejada (`2 operações`) junto dos arquivos e a conclusão resume `sucesso · N operações`.
- [x] 2026-06-05: reexecutada live `file-patch-roundtrip` pass3; dry-run apareceu como `simulação de edição`, prompt duplicado continuou ausente e resposta pos-ask materializou rapidamente.
- [x] 2026-06-05: a live pass3 falhou corretamente porque a LLM-B escreveu que removeu o arquivo sem chamar `delete_file`; scratch remanescente foi removido e o runner foi fortalecido para nao auto-responder protocolo incompleto.
- [x] 2026-06-05: identificado HTML bruto em delta publico (`<a><img>`); `sanitizeTerminalRenderText` e `/export` agora escapam markup, com testes unitarios dedicados.
- [x] 2026-06-05: prompt live e instructions das file tools reforçados para texto puro e para nunca afirmar mutação antes do retorno `success` da tool real.
- [x] 2026-06-05: pass4 confirmou o caso adversarial: a LLM-B voltou a afirmar `delete_file` sem lifecycle; o runner bloqueou auto-resposta ao `ask_user` e coletou diagnosticos.
- [x] 2026-06-05: criado `assistant-tool-claim-audit`, integrado ao engine, com warning visual e SSE quando resposta publica afirma tool concluida sem evidencia no `turn-trace`.
- [x] 2026-06-05: `delete_file` local agora retorna `withIoMeta(..., deleted.io)` como as demais mutacoes, preservando `io.operation=delete` para projection/lifecycle.
- [x] 2026-06-05: pass6 bloqueou corretamente por `unexpected-scenario-tool`: recuperação pós-tools chamou `exec_command` fora da allowlist após falha BYOK/hash mismatch.
- [x] 2026-06-05: `buildToolOnlyRecoveryPrompt()` agora preserva allowlist original de tools e pergunta exata de `ask_user`; runner live também bloqueia pergunta divergente com diagnóstico próprio.
- [x] 2026-06-05: reexecutado live `file-patch-roundtrip` pass7 em PTY; status PASS, scratch limpo, `delete_file` real renderizado como `EXCLUIR`, `ask_user` exato, resposta pós-SIM materializada e export/SSE correlacionados.
- [x] 2026-06-05: `llm.usage` BYOK sem premium request deixou de tomar a atividade corrente; a linha viva permanece em tool/turn enquanto usage segue em SSE, `/usage` e histórico quando habilitado.
- [x] 2026-06-05: adicionada fase `model` ao `activity-state`; pedido de `/byok model` e automação model-gateway agora entram como estado vivo compacto sem substituir tool/turn por telemetria de uso.
- [x] 2026-06-05: extraído `model-transition-presentation.js` como core puro; o presenter visual segue como renderer, e BYOK deixa de importar UI/config para gerar detalhes canônicos.
- [x] 2026-06-05: `session.model_changed` consome pedido vivo pendente quando confirma o mesmo modelo, registrando `matchedTerminalRequest` no SSE e mantendo ISO 8601 completo no detalhe.
- [x] 2026-06-05: runner `operator-ux-cycle` passou a exercitar `/byok model terminal-ux-boundary-fixture` e `/activity 10`, exigindo `Estado modelo` e rejeitando `Estado model`.
- [x] 2026-06-05: live `terminal-ux-operator-model-switch` pass3 encontrou interferência visual de confirmação SDK no prompt; pass4 PASS confirmou `/sdk models` limpo, `/activity` com `Estado modelo` e `/live` com confirmação correlacionada.
- [x] 2026-06-05: live `structured-input-cycle` pass2 PASS confirmou cartão humano para `request_user_input`, prompt `[PERG]`, `/sdk waits` pendente/limpo, resposta roteada e ausencia de `request_user_input ainda executando`, IDs crus e spam duravel.
- [x] 2026-06-05: `elicitation.pending/completed` foi rebaixado de jargao SDK para `Formulário ao operador`, reaproveitando o renderer canonico de pergunta humana e mantendo o pedido tecnico em linha secundaria.
- [x] 2026-06-05: extraído `dialog/empty-output-diagnosis.js` para classificar saida vazia/nao textual sem efeitos colaterais; engine permanece responsavel por activity/SSE/BYOK health.
- [x] 2026-06-05: adicionados testes unitarios para pending human input, READY protocolar, tool-only, protocol transition e diagnostico acionavel de tools sem sintese publica.
- [x] 2026-06-05: criado `dialog/byok-turn-error-presentation.js`; erros BYOK de turno vivo agora mostram `Rota BYOK`, destino, janela de retry/reset quando houver e ação, sem vazar `dialog.byok_*` na linha principal.
- [x] 2026-06-05: live `terminal-ux-default` pass5 falhou apenas porque o harness ainda esperava labels antigos de uso LLM; a tela real já mostrava `LLM`, `Pedido sem pedido premium` e `Tipo continuação da pergunta humana`.
- [x] 2026-06-05: runner live passou a aceitar a taxonomia atual de usage (`LLM` + `Pedido sem pedido premium`); live `terminal-ux-default` pass6 PASS cobriu boot, tools, deltas, pergunta, resposta humana, pós-pergunta, `/activity`, `/events`, `/health`, `/export` e shutdown limpo.
- [x] 2026-06-05: `/events --raw` redesenhado como preview compacto: 12 eventos por default, `payloadKeys`, `payloadPreview`, eventId/source/trace preservados e atalho para `/events --raw full`.
- [x] 2026-06-05: live `terminal-ux-default` pass7 PASS confirmou preview raw de 12/100 eventos, `Ocultos 88 eventos`, cruzamento de eventIds com SSE e ausência de retorno ao despejo massivo anterior.
- [x] 2026-06-05: melhorados humanizadores de `payloadPreview` para `activity.changed`, `terminal.activity`, `hook.start`, `hook.end` e `sdk.lifecycle`, reduzindo mini-JSON em previews raw.
- [x] 2026-06-05: corrigida janela visual em que `você[...]›` aparecia entre `Turno 2 ações`/`Arquivos LER` e o transcript final; `output.js` agora trata `readTerminalTurnMaterialization().status=active` como turno visualmente ativo.
- [x] 2026-06-05: runner live ganhou critério `ux-no-ready-prompt-during-active-turn`, que reprova o log antigo e protege contra prompt idle antes da fala final.
- [x] 2026-06-05: live `terminal-ux-default` pass9 PASS confirmou deltas, tools, pergunta, resposta, export/SSE e ausência de prompt pronto entre resumo de tools/linha viva/transcript.
- [x] 2026-06-05: `/events` default passou a ocultar lifecycle rotineiro de sessão SDK (`session.created/deleted/foreground/background/ended`) como já fazia com `session.updated`, preservando inspeção por `event=sdk.lifecycle` e `--raw`.
- [x] 2026-06-05: live `default-ux-cycle` pass10 PASS confirmou que limpeza de sessão SDK não polui mais `/events` default e que as superfícies de UX padrão seguem estáveis.
- [x] 2026-06-05: resposta humana agora registra atividade `Continuação pós-pergunta`, com detalhe `resposta registrada; aguardando resposta final da LLM-B` e comandos de acompanhamento, mantendo a linha viva compacta como `LLM-B continuando`.
- [x] 2026-06-05: recuperação automática pós-pergunta vazia agora usa `buildEmptyAfterUserInputAutoRecoveryRows`, exibindo estado, ação, resposta, turno, diagnóstico e alternativa de troca de modelo.
- [x] 2026-06-05: validado com `test_dialog_recovery_presenter`, `test_terminal_sdk_session_events`, `test_live_status_line`, `test_terminal_agent_wiring` e `test_commands_events`.
- [x] 2026-06-05: revisada a trilha BYOK sem mensagem estruturada; a cobertura existente já humaniza `agent.error`/`session.error`, mantém linha viva compacta e evita fallback Copilot automático, ficando pendente apenas cenário live adversarial dedicado.
- [x] 2026-06-05: `/byok model`, auto-apply do model-gateway e o runner live passaram a usar `confirmação do SDK ou próximo uso observado`; `session.model_changed` permanece como contrato técnico de SSE/event adapter, não como texto padrão ao operador.
- [x] 2026-06-05: live `operator-ux-cycle` pass5 PASS confirmou a troca para `confirmação do SDK`; no mesmo PTY foi identificado e corrigido o destaque FTS5 textual de `/index search` que criava `[terminal]` em previews.
- [x] 2026-06-05: `test_commands_index` foi isolado com `better-sqlite3(':memory:')` e `resetIoIndexForTest()`, impedindo que validações destruam o índice L2 persistente visto por `/index status` no terminal real.
- [x] 2026-06-05: `/index build` passou a renderizar `Progresso`, `Varrendo`, `Varredura` e `Indexando` a partir dos canais canônicos de observabilidade, sem criar um segundo contador no comando.
- [x] 2026-06-05: live `operator-ux-cycle` pass7 revelou avanço prematuro do harness em `/byok model`; o `waitFor` agora exige `Modelo vivo solicitado` ou saída específica de adiamento/falha, evitando comandos colados no bloco visual anterior.
- [x] 2026-06-05: `cmdSessionSave` passou a renderizar o arquivo salvo via `formatTerminalToolPathForOperator`, removendo `/workspaces/...` do fluxo visual padrão.
- [x] 2026-06-05: `/metrics` passou a renderizar o caminho do archive SSE via `formatTerminalToolPathForOperator`, com teste garantindo `data/copilot-terminal/sse-events` sem `process.cwd()`.
- [x] 2026-06-05: `/session list` e `/session restore` foram migrados para `terminalThemeHeadline/Row`, com perguntas restauradas humanizadas (`pronto`, `operador`, etc.) e sem ANSI hardcoded nos testes.
- [x] 2026-06-05: `/sdk skills` e `/workspace` agora reutilizam `formatTerminalToolPathForOperator`/`compactTerminalDiagnosticId` para skills, workspace virtual, mirror e promoção FS↔SDK.
- [x] 2026-06-05: live `operator-ux-cycle` pass9 PASS confirmou `/session save`, `/workspace list`, `/byok model`, `/activity`, `/live` e revelou as novas limpezas de `/byok status` e `/model list`.
- [x] 2026-06-05: `/byok status` passou a renderizar estado como `ativo e pronto`, autenticação como `token bearer configurado` e modelo sem `protocolo -`/`Azure -`.
- [x] 2026-06-05: `/model list` passou a renderizar uma linha por modelo com sufixos humanos (`ativo`, `raciocínio`, `visão`), evitando badges colados e excesso de linhas.
- [x] 2026-06-05: live `operator-ux-cycle` pass11 FAIL revelou disputa entre overlay de modelo confirmado e input; `shouldRenderTerminalLiveStatusLine` agora suprime confirmações concluídas quando a sessão está ociosa.
- [x] 2026-06-05: live `operator-ux-cycle` pass12 PASS confirmou `/model list` compacto, `/byok status` limpo e ausência de colisão entre confirmação de modelo e `/sdk models`.
- [x] 2026-06-05: `/sdk models` passou a humanizar esforços suportados como `raciocínio high`, evitando inglês cru e listas sem espaço.
- [x] 2026-06-05: `/git help` passou a usar linhas `Status`, `Log`, `Diff`, `Branches`, `Atualizar` e `Stash`, sem bloco multiline em uma única row.
- [x] 2026-06-05: live `operator-ux-cycle` pass13 mostrou UX correta, mas critério desatualizado; runner agora espera `Status/Diff/Stash` e rejeita `Comandos /git status` multiline.
- [x] 2026-06-05: live `operator-ux-cycle` pass14 PASS confirmou Git help em ações nomeadas, BYOK/model list compactos, `/sdk models` humanizado e ausência de colisão de overlay.
- [x] 2026-06-05: `/attach` deixou de imprimir `Use /attach...`/`Serão embutidos...` como texto solto; filas agora seguem `terminalThemeRow` e paths passam por `formatTerminalToolPathForOperator`.
- [x] 2026-06-05: live `operator-ux-cycle` pass15 confirmou `/attach`, mas revelou overlay de modelo colando em `/activity`; o REPL agora limpa a linha viva no submit e `/activity` usa linguagem de auditoria humana.
- [x] 2026-06-05: live `operator-ux-cycle` pass16 confirmou o prompt limpo em `/activity`; o runner agora aceita tanto estado solicitado quanto confirmação rápida do SDK, exigindo a solicitação preservada na timeline.
- [x] 2026-06-05: `/byok model` deixou de reaproveitar o painel completo de status e ganhou resumo operacional compacto antes da solicitação live.
- [x] 2026-06-05: `/byok model` também compactou `Sessão viva` e `Ação`, removendo a frase longa de confirmação duplicada.
- [x] 2026-06-05: a limpeza de overlay no submit passou a ser reservada-only, evitando clear-line extra em comandos sem linha viva ativa.
- [x] 2026-06-05: live pass20 falhou no boot por export ausente; `terminal/dialog/index.js` agora reexporta `clearReservedInlineStatus`.
- [x] 2026-06-05: `/model list` passou para janela default de 20 modelos com expansão explícita por número ou `full`.
- [x] 2026-06-05: pass22 revelou resíduo de reserva no prompt; a limpeza reserved-only agora zera a reserva depois do submit.
- [x] 2026-06-05: live `terminal-ux-live-ask-user-canonical` pass1 confirmou pergunta humana sem spam, mas expôs prompt pronto antes do transcript final; `turn-display` passou a limpar a linha interativa no primeiro delta visível.
- [x] 2026-06-05: critérios live de `/activity` foram alinhados à linguagem atual `auditoria técnica e streaming`, evitando falso negativo herdado da cópia anterior.
- [x] 2026-06-05: `/usage now` trocou `Vínculo ambiente, SDK e hub conectados` por `Conexão sessão conectada`, mantendo os identificadores técnicos apenas em `/usage now detail`.
- [x] 2026-06-05: live pass3 expôs prompt pronto entre tool summary e transcript quando o SDK dividiu tools em duas fases; `redrawPromptIfInteractive` passou a respeitar fase operacional ativa, não apenas busy/materialização.
- [x] 2026-06-05: `/events` default passou a humanizar `task.started`, `task.queued`, `pending_messages.modified` e `session.tools_updated`, removendo inglês cru da trilha de recuperação pós-ask.
- [x] 2026-06-05: card de recuperação automática pós-ask passou a incluir retomada manual explícita; harness live deixa de marcar `BLOCKED` quando a recuperação entrega o final canônico.
- [x] 2026-06-05: live `terminal-ux-live-ask-user-canonical` pass04 PASS confirmou `Conexão sessão conectada`, ausência de prompt pronto entre tool summary/status/transcript, ask_user real, resposta humana, pós-ask e `/events` default humanizado.
- [x] 2026-06-05: criada decisão arquitetural de libs auxiliares do terminal; `gum/fzf` ficam bloqueados até TTY exclusivo, `bat/glow/delta/jq/yq` seguem como previews explícitos e `atuin/zoxide` permanecem adiados.
- [x] 2026-06-05: `/terminal libs` ganhou resumo por categoria e link para o guia AUX; `/fs preview`, `/git diff` e `/gh pr diff` agora compartilham rodapé canônico `renderer externo`/`fallback canônico`, com testes focados cobrindo os fallbacks.
- [x] 2026-06-05: observado em execução real que `/fs preview package.json --json --query .scripts --lines 5` despejava centenas de linhas; `structured-preview` agora aplica `lineLimit` pós-render e o smoke AUX protege `structured-preview-line-limit`.
- [x] 2026-06-05: `/export` passou a usar `sanitizeTerminalExternalToolText` antes de `redactSecretText`, removendo ANSI/OSC/controles de conteúdo e envelopes preservados no Markdown.
