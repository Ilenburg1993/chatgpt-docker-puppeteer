# Roteiro de agentes customizados com prioridade ao SDK — auditoria viva e implementação

Data-base: 2026-05-07
Status: implementado nesta rodada para o caminho crítico de carregamento, validação, perfis, RPC e
registro pleno de ferramentas
Origem: revisão crítica do documento externo `CUSTOM-AGENTS-ARCHITECTURE-AUDIT.md`

## Leitura corrigida do AS-IS

O documento externo acertava o problema macro, mas estava parcialmente defasado em relação ao
repositório vivo.

- `agent-full` já existia em `src/copilot/config/custom-agents.js`, mas não era carregado por padrão
  porque `COPILOT_CUSTOM_AGENTS` ainda excluía o maestro.
- `tool-aliases.js`, esquemas e um validador de contrato já existiam, mas `tools: ['*']` ainda não
  era expandido contra o registro real. Depois da conferência do contrato oficial do SDK, a forma
  correta de acesso total passou a ser `tools: null`.
- O registro real de ferramentas não carregava `indexTools` e `scopeTools` em `tools/bootstrap.js`,
  apesar de os arquivos `index-tools.js` e `scope-tools.js` já existirem.
- Alguns nomes do plano externo eram históricos (`bash`, `read_bash`, `report_intent`) e não batiam
  com a superfície carregada hoje (`exec_command`, `run_*`, `report_intent_local`).
- A ideia de política por agente só pode ser aplicada no hook quando o SDK envia contexto do agente
  na invocação. Quando esse contexto não vem, a restrição primária continua sendo o próprio
  `customAgents[].tools` do SDK.

## Correções implementadas

- Perfil operacional canônico em `config/operational-profiles.js`.
- Padrão `production` com `agent-full` em primeiro lugar.
- `terminal:llm-b` usando `COPILOT_OPERATIONAL_PROFILE=production`, `COPILOT_REASONING_EFFORT=xhigh`
  e `TERMINAL_DISPLAY_PRESET=full`, mantendo o maestro como padrão operacional de capacidade máxima.
- Agentes internos migrados para ferramentas canônicas de sistema de arquivos.
- `SDK_AGENTS` alinhados aos nomes realmente carregados no tempo de execução.
- Aliases compatíveis para `view/glob/grep`, `bash/read_bash/write_bash/stop_bash`,
  `str_replace_editor` e `report_intent`.
- Validação de contrato na criação/retomada de sessão, com erro para tier obrigatório ausente e
  aviso para tier recomendado degradado.
- `agent-full.tools` corrigido para `null`, que é o contrato oficial do SDK para acesso a todas as
  ferramentas.
- `tools/bootstrap.js` agora carrega também ferramentas de índice e escopo, fechando a lacuna de
  carregamento pleno das capacidades file/IO.
- `AgentToolPolicy` criado em `sdk/tools/agent-policy.js`, com aplicação por agente quando o hook
  fornece `agentName`.
- `/status` mostra perfil operacional e seleção efetiva de agentes customizados.
- A criação/retomada de sessão injeta `agent: 'agent-full'` e
  `includeSubAgentStreamingEvents: true`, mantendo o maestro como comando efetivo.
- A tentativa de usar `defaultAgent.excludedTools` com nomes de ferramentas locais foi removida: o
  SDK interpreta esse campo no namespace de ferramentas nativas e emitia avisos `Unknown tool name`.
  A contenção do agente padrão passa a depender da seleção explícita `agent-full`, da política de
  hooks e dos contratos `customAgents`.
- RPC de sessão passou a expor `agent.getCurrent()` e `agent.reload()` no facade canônico.
- Ferramentas `session_agent_current`, `session_agent_select`, `session_agent_reload`,
  `exp_agent_select` e `exp_agent_deselect` agora reforçam `agent-full` e bloqueiam seleção direta
  de especialistas fora do maestro.
- `agent-contract.js`, prompts e documentação operacional foram revisados para PT-BR, preservando
  identificadores técnicos do SDK e nomes reais de ferramentas.

## Arquitetura alvo

O caminho canônico continua sendo:

1. `config/env.js` lê env.
2. `config/operational-profiles.js` resolve perfil e seleção efetiva.
3. `config/custom-agents.js` monta `SessionConfig.customAgents`.
4. `tools/bootstrap.js` registra todas as ferramentas reais no SDK.
5. `agent-contract.js` valida `customAgents` contra o registro vivo.
6. `initializer.js` injeta `customAgents` validados em `SessionConfig`.
7. `hooks/tool-interceptor.js` aplica permissão/negação global e política por agente quando o SDK
   fornece contexto de agente.

Não há tempo de execução paralelo de agentes customizados. A implementação permanece com prioridade
ao SDK.

## Invariantes canônicas atualizadas

- `agent-full` é sempre o primeiro agente e sempre entra em `SessionConfig.agent`.
- `agent-full` usa `tools: null`, seguindo o SDK oficial para acesso total.
- `agent-full` não é afetado por listas globais de negação/permissão da política local; elas seguem
  válidas para agentes especialistas e para o agente padrão.
- `defaultAgent.excludedTools` não deve receber nomes de ferramentas customizadas locais. Quando for
  usado no futuro, deve ser limitado a nomes nativos reconhecidos pelo SDK.
- O terminal LLM-B deve iniciar com exibição plena por padrão: streaming, eventos de sessão,
  atividade de ferramentas, usage, intent e captura/preview de reasoning.
- Em turnos longos sem delta visível, o terminal deve narrar automaticamente que a LLM-B continua
  trabalhando, incluindo modelo, effort e tempo sem saída incremental.
- Um reasoning explícito de boot tem precedência sobre estado persistido antigo. Se o SDK resolver
  `model="auto"` para um modelo que só exponha `high`, o terminal deve mostrar esse estado efetivo
  com clareza em vez de silenciar a redução.
- Seleção direta de `task`, `explore`, `diagnostic`, `planner`, `git-ops` ou `shell-ops` é bloqueada
  nas ferramentas RPC públicas. Especialistas são auxiliares do maestro, não substitutos dele.
- Recarregamentos de agentes devem recarregar a lista e reativar `agent-full` imediatamente.

## Roadmap restante

- Persistir o resumo de validação de contratos em projeção viva para terminal/server, em vez de
  apenas registrar no início.
- Adicionar métricas de uso por agente quando o SDK expuser `agentName` de forma estável nos
  hooks/eventos.
- Expandir docs de usuário para criação de agentes customizados externos.
- Remover, em uma rodada separada, prompts que ainda mencionem ferramentas históricas como primeira
  opção.
- Validar ao vivo `terminal:llm-b` após reset de limite de uso para provar delegação real do
  `agent-full`, streaming de subagentes e ausência de avisos `defaultAgent.excludedTools`.
- Expor no `/status` uma seção detalhada de invariantes do maestro: agente ativo, contrato
  `tools:null`, contagem de ferramentas visíveis e último recarregamento RPC.
- Adicionar evento observável `custom_agent.maestro_enforced` sempre que a sessão corrigir seleção
  divergente.
- Avaliar se `BUILTIN_AGENTS` ainda deve existir como camada de REPL ou se deve virar apenas alias
  de templates SDK, mantendo um único modelo mental.
- Separar claramente no `/status` o effort solicitado (`xhigh`) do effort efetivo resolvido pelo SDK
  (`high` em alguns modelos `auto`), para evitar falsa leitura de degradação local.

## Rodada de terminal live — 2026-05-07

O primeiro boot real do `terminal:llm-b` confirmou que o terminal já consegue mostrar sinais
automaticamente na sessão viva: atividade de tools, eventos de sessão, aviso de compactação, captura
de `task.reasoning` e projeção de modelo/effort no prompt.

Ele também revelou dois gaps corrigidos nesta rodada:

- O preset visual `full` era aplicado, mas o auto-brief inferia `verbose` porque os estados eram
  equivalentes. O auto-brief agora reporta o preset de boot configurado.
- `defaultAgent.excludedTools` recebia nomes locais como `read_file_content` e `exec_command`,
  gerando avisos do SDK. O inicializador não envia mais esse campo com tools customizadas.

Upgrade adicional implementado:

- `dev:terminal` e `terminal:llm-b` agora iniciam em perfil `production`, display `full` e
  `COPILOT_REASONING_EFFORT=xhigh`.
- O loop de diálogo emite uma linha automática a cada 10s quando a LLM-B está processando sem
  streaming/reasoning visível, com registro em `recordTerminalActivity`.
- Tools longas também emitem heartbeat automático a cada 10s quando não há `progress` ou
  `partial_result`, evitando o silêncio operacional observado durante `bash` interno de boot.
- Sessões retomadas priorizam o reasoning explícito do boot sobre o valor persistido anterior.

Resultado do segundo boot ao vivo:

- `display=full`, `capacidade=auto` e `reasoning=xhigh` apareceram no auto-brief.
- O prompt efetivo passou a mostrar `claude-sonnet-4.6/xhigh`, preservando o roteamento nativo
  `auto → claude-sonnet-4.6`.
- Os avisos `Unknown tool name in defaultAgent.excludedTools` desapareceram.
- Uma tool `bash` longa foi reanunciada automaticamente com `bash ainda executando · 15s/25s/35s` e
  depois passou a exibir `partial_result` incremental.
- `/status` confirmou `tools load = 104 registradas`, `fsCanônico=true` e perfil custom agents
  `production · agent-full, explore, diagnostic, planner, task, git-ops, shell-ops`.

Gaps remanescentes observados ao vivo:

- O auto-brief inicial ainda pode marcar rota `degraded` antes da projeção final de tools ficar
  carregada; `/status` já corrige a leitura depois do boot.
- `session.tools_updated` reportou `0` tools porque esse contador é do evento vanilla do SDK, não do
  registro local canônico de 104 tools. A UI precisa rotular essa diferença para evitar falsa
  suspeita de falha de carregamento.
- A tool interna executada pela própria LLM-B rodou uma suíte longa e pode estourar o boot do
  `DialogLoopManager`. A arquitetura agora mostra progresso, mas ainda precisa de política de
  timeout/escopo para comandos autônomos de boot.

## Rodada de terminal live — leitura forçada por tools

Teste executado com `AGENT_STATE_FILE=/tmp/llmb-live-tool-test.json` e boot prompt mínimo para
evitar retomada de contexto antigo. A LLM-B foi instruída a ler arquivos via ferramenta de leitura,
sem `bash`, `cat`, `sed`, `grep`, `npm` ou memória.

Resultado observado:

- A LLM-B usou `view` em paralelo para ler `src/copilot/terminal/live-status-line.js`,
  `src/copilot/terminal/activity-state.js` e `src/copilot/terminal/repl-lifecycle.js`.
- O terminal mostrou automaticamente `[TOOL] [READ] view`, conclusão de cada leitura e resumo
  `[FILES] READ ...`.
- A linha viva permanente apareceu durante boot, turnos, thinking, streaming e tools.
- O reasoning bruto inicialmente aparecia tokenizado demais; a UX foi alterada para não despejar
  conteúdo bruto automaticamente, mostrando progresso operacional e resumo seguro.
- O streaming de resposta foi bufferizado para evitar `│` no meio das frases a cada microchunk.

Correções implementadas após o teste:

- `live-status-line.js` agora tolera `readTerminalDialogStreamMeta()` nulo/indefinido.
- `activity-state.js` mantém foco em operação ativa e evita que eventos periféricos escondam a tool
  em execução.
- Atividades concluídas deixam de manter a linha viva quando o runtime volta a `waiting_for_input`.
- `repl-lifecycle.js` serializa o processamento de linhas para evitar reentrância do readline.
- `@path` puro agora anexa arquivo sem reenviar a referência como mensagem textual.
- Cleanup do REPL ficou robusto: falhas em cleanup de linha viva/listeners não impedem
  `setRl(null)`.

## Validação local desta rodada

- `bootstrapTools(createRegistry(), [])` carregou 104 ferramentas registradas, incluindo índice,
  escopo, RPC de sessão e ferramentas experimentais.
- `validateAgentContracts(buildCustomAgentsConfig(), liveToolNames)` passou sem erros e sem avisos.
- O contrato vivo validou `agent-full` em primeiro, `tools: null` e resolução de 104 ferramentas
  para o maestro.
- Testes unitários cobrem perfis, aliases, contrato, política, RPC de agente, reforço do maestro e
  carregamento de capacidades de arquivo.
- Validações executadas: Vitest focado (10 arquivos, 140 testes), ESLint focado e
  `npm run typecheck:strict:src.copilot`.

## Rodada de terminal live — FS canônico real por custom tools

Teste longo executado em sessão isolada com `COPILOT_REASONING_EFFORT=xhigh`,
`TERMINAL_DISPLAY_PRESET=full` e `AGENT_STATE_FILE` temporário. A LLM-B recebeu uma sequência
obrigatória usando somente as tools canônicas locais: `read_file_content`, `create_file`,
`write_file_content`, `patch_file` e `read_file_content`.

Achados corrigidos:

- As file-tools estavam registradas no registry local, mas schemas Zod v4 eram convertidos para JSON
  Schema vazio (`{"$schema": ...}`), deixando
  `read_file_content/create_file/write_file_content/patch_file` invisíveis ou não invocáveis para o
  modelo.
- `tool-factory.js` e `sdk/tools/core.js` agora convertem Zod v4 com `z.toJSONSchema()` antes do
  fallback `zod-to-json-schema`.
- A sessão SDK agora exclui da superfície de escolha do modelo as built-ins legadas de FS
  `view/create/edit/glob/grep` quando a superfície canônica local está completa.
- O terminal passou a explicitar aliases quando aparecem em sessões antigas
  (`view -> read_file_content`, `create -> create_file`, `edit -> patch_file`).
- O auto-brief inicial não declara mais `degraded` quando o registry ainda está em bootstrap; ele
  mostra `route=booting`.
- O evento vanilla `session.tools_updated` foi renomeado na UI para “tools dinâmicas SDK” para não
  ser confundido com o registry local de 104 tools.
- `request_user_input` deixou de se apresentar como chamada obrigatória ao fim de toda resposta no
  terminal LLM-B; continuidade normal fica com `ask_user` READY/REPLY.

Resultado do teste final:

- O terminal exibiu `[TOOL] [READ] read_file_content`, `[TOOL] [WRITE] create_file`,
  `[TOOL] [WRITE] write_file_content`, `[TOOL] [EDIT] patch_file` e a leitura final via
  `read_file_content`.
- As operações `[IO]` vieram do `io-engine` local (`readFile.text`, `atomic-write`,
  `patchTextLocked`) com metadados de bytes, alvo e duração.
- A LLM-B reportou que nenhuma tool legada (`view`, `create`, `edit`, `glob`, `grep`, `bash`,
  `exec_command`) foi usada.
- A linha viva permanente permaneceu ativa durante boot, turno, thinking, tool calls e heartbeats de
  tool pendente.

## Gaps remanescentes observados ao vivo

- Há duplicidade visual de alguns eventos `external_tool` junto de `tool.execution_*`; a execução
  está correta, mas a timeline pode consolidar esses eventos para reduzir ruído.
- `permission.requested` aparece para writes aprovadas automaticamente; a UX pode indicar
  "autoaprovado" com mais clareza.

## Rodada de aperfeiçoamento UX — 2026-05-07 (tarde)

Fechamento dos gaps remanescentes de UX identificados na rodada anterior:

**Problema 1: Duplicidade visual external_tool + tool.execution_***

- Implementado rastreamento em `sdk-session-events.js`: funções `markExternalToolInFlight()`,
  `unmarkExternalToolInFlight()` e `isExternalToolInFlight()`.
- Quando `external_tool.requested` é emitido, marca a ferramenta em voo.
- Em `agent-runtime-events.js`, `onToolStart()` e `onToolComplete()` agora verificam se a ferramenta
  está marcada como externa; se sim, pulam a narração para evitar duplicidade.
- Resultado: eventos `external_tool.requested` → `external_tool.completed` são únicos na timeline; não
  há duplicidade com `EMITTER_TOOL_EXECUTION_START/COMPLETE` para a mesma ferramenta.

**Problema 2: Autoaprovação em permissões não era explícita**

- Adicionado import de `classifyPermissionDecision` em `sdk-session-events.js`.
- Expandido `onPermissionCompleted()` para detectar `denied-by-rules`,
  `denied-by-permission-request-hook` e `denied-by-content-exclusion-policy`.
- Quando uma permissão é negada por política (não interativamente), exibe `(política)` na saída.
- Agora diferencia claramente: `✓ Permissão: file_read aprovada (política)` vs
  `✓ Permissão: file_read aprovada (interativa)` ou sem indicador.
- Broadcast SSE inclui `wasDeniedByPolicy` para frontends capturarem o estado.

**Validação local desta rodada**

- Testes de unidade: sintaxe JS validada com `node -c` para ambos os arquivos modificados.
- Testes semânticos: `classifyPermissionDecision()` passa em todos os 4 tipos de negação.
- Lint: `npm run lint` passou sem erros focados em `src/copilot/`.
- Terminal LLM-B: iniciou em perfil `production`, display `full`, effort `xhigh` sem erros de
  inicialização.

**Retenção de invariantes**

- O maestro continua sendo `agent-full` com `tools: null`.
- Permissões não mudam de política; apenas a narrativa de apresentação melhora.
- Ferramentas externas são consolidadas: uma única entrada na timeline por requisição/conclusão.
- O autofechamento de permissões segue a política do hook; o terminal apenas comunica com mais
  clareza quando a decisão foi automática vs. interativa.

**Gaps remanescentes após esta rodada**

- Nenhum novo gap identificado durante validação local. Mantém-se aberto: se há outros tipos de
  negação não cobertos em `classifyPermissionDecision()`, adicionar quando forem observados ao vivo.
- Timeline consolidada funciona bem; a narrativa de autofechamento de permissões melhora a legibilidade
  e evita a falsa suspeita de que "a permissão foi pedida e ignorada silenciosamente".
