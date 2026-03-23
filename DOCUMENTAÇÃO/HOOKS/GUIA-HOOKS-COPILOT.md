# Guia Completo de Hooks do GitHub Copilot (VS Code)

**Versão**: 2.5 | **Data**: 2026-03-13 | **Status**: Canônico

> Este documento descreve o funcionamento dos hooks do GitHub Copilot no VS Code, distinguindo
> rigorosamente o que é **nativo/automático** da plataforma VS Code Copilot e o que foi
> **introduzido ou estendido** por este repositório.

---

## Sumário

- [Guia Completo de Hooks do GitHub Copilot (VS Code)](#guia-completo-de-hooks-do-github-copilot-vs-code)
  - [Sumário](#sumário)
  - [1. O que são Hooks?](#1-o-que-são-hooks)
  - [2. Eventos Nativos do VS Code Copilot](#2-eventos-nativos-do-vs-code-copilot)
  - [3. Quando cada evento dispara — guia definitivo](#3-quando-cada-evento-dispara--guia-definitivo)
    - [3.1 `SessionStart` — Uma vez por janela de chat](#31-sessionstart--uma-vez-por-janela-de-chat)
    - [3.2 `UserPromptSubmit` (= `userPromptSubmitted`) — Por prompt digitado](#32-userpromptsubmit--userpromptsubmitted--por-prompt-digitado)
    - [3.3 `PreToolUse` — Antes de CADA ferramenta](#33-pretooluse--antes-de-cada-ferramenta)
    - [3.4 `PostToolUse` — Após CADA ferramenta completar COM SUCESSO](#34-posttooluse--após-cada-ferramenta-completar-com-sucesso)
    - [3.5 `Stop` (= `agentStop`) — Fim de CADA TURNO do agente](#35-stop--agentstop--fim-de-cada-turno-do-agente)
    - [3.6 `SubagentStart` / `SubagentStop` — Para subagentes](#36-subagentstart--subagentstop--para-subagentes)
    - [3.7 `PreCompact` — Antes de compactar o contexto](#37-precompact--antes-de-compactar-o-contexto)
    - [3.8 `SessionEnd` — Quando a sessão VS Code realmente fecha](#38-sessionend--quando-a-sessão-vs-code-realmente-fecha)
  - [4. O que é "fim de turno" — agentStop em profundidade](#4-o-que-é-fim-de-turno--agentstop-em-profundidade)
    - [4.1 Definição precisa de "turno" (regime automático VS Code)](#41-definição-precisa-de-turno-regime-automático-vs-code)
    - [4.2 Quando exatamente o agentStop ocorre?](#42-quando-exatamente-o-agentstop-ocorre)
    - [4.3 O que acontece DEPOIS do agentStop?](#43-o-que-acontece-depois-do-agentstop)
    - [4.4 O campo `stop_hook_active` — o anti-loop](#44-o-campo-stop_hook_active--o-anti-loop)
    - [4.5 `agentStop` vs `sessionEnd` — diferença crítica](#45-agentstop-vs-sessionend--diferença-crítica)
    - [4.6 Sequência completa de um ciclo prompt→resposta](#46-sequência-completa-de-um-ciclo-promptresposta)
  - [5. Entradas e Saídas dos Hooks](#5-entradas-e-saídas-dos-hooks)
    - [5.1 Input comum (todos os hooks)](#51-input-comum-todos-os-hooks)
    - [5.2 Outputs — como influenciar o agente](#52-outputs--como-influenciar-o-agente)
    - [5.3 Outputs específicos por hook](#53-outputs-específicos-por-hook)
  - [6. PreToolUse — Controle de Permissão por Ferramenta](#6-pretooluse--controle-de-permissão-por-ferramenta)
    - [6.1 permissionDecision — os três valores](#61-permissiondecision--os-três-valores)
    - [6.2 Como `deny` aparece para o agente](#62-como-deny-aparece-para-o-agente)
    - [6.3 Como `ask` funciona](#63-como-ask-funciona)
    - [6.4 `updatedInput` — modificar o input da ferramenta](#64-updatedinput--modificar-o-input-da-ferramenta)
    - [6.5 Input do PreToolUse — campos disponíveis](#65-input-do-pretooluse--campos-disponíveis)
  - [7. Configuração e Formato](#7-configuração-e-formato)
    - [7.1 Localização dos arquivos](#71-localização-dos-arquivos)
    - [7.2 Formatos suportados](#72-formatos-suportados)
    - [7.3 Propriedades de cada entrada de hook](#73-propriedades-de-cada-entrada-de-hook)
  - [8. Mapeamento: nomes locais vs nomes oficiais VS Code](#8-mapeamento-nomes-locais-vs-nomes-oficiais-vs-code)
  - [9. Fluxo Nativo vs Customizações deste Repositório](#9-fluxo-nativo-vs-customizações-deste-repositório)
    - [9.1 O que a plataforma VS Code faz AUTOMATICAMENTE](#91-o-que-a-plataforma-vs-code-faz-automaticamente)
    - [9.2 O que NÃO é nativo — construído por este repositório](#92-o-que-não-é-nativo--construído-por-este-repositório)
    - [9.3 `vscode_askQuestions` NÃO é um hook](#93-vscode_askquestions-não-é-um-hook)
  - [10. SESSION, SECTION, TURN — Modelo Personalizado](#10-session-section-turn--modelo-personalizado)
    - [Distinção SESSION / SECTION / TURN:](#distinção-session--section--turn)
  - [11. Evidência Empírica (audit.jsonl)](#11-evidência-empírica-auditjsonl)
    - [11.1 Frequência de eventos (sessionStart a sessionStart seguinte)](#111-frequência-de-eventos-sessionstart-a-sessionstart-seguinte)
    - [11.2 Relação entre prompts e ask_questions](#112-relação-entre-prompts-e-ask_questions)
    - [11.3 Estrutura do `tool_use_id` — identificador de ferramenta](#113-estrutura-do-tool_use_id--identificador-de-ferramenta)
  - [12. Variáveis Nativas do VS Code vs Variáveis Customizadas do Repositório](#12-variáveis-nativas-do-vs-code-vs-variáveis-customizadas-do-repositório)
    - [12.1 Campos enviados automaticamente pelo VS Code (em cada hook input)](#121-campos-enviados-automaticamente-pelo-vs-code-em-cada-hook-input)
    - [12.2 O `session_id` — imutável vs nosso contexto local](#122-o-session_id--imutável-vs-nosso-contexto-local)
    - [12.3 Variáveis que construímos e persistimos (session-context.json)](#123-variáveis-que-construímos-e-persistimos-session-contextjson)
  - [13. FAQ — Perguntas Frequentes](#13-faq--perguntas-frequentes)
    - [P1: Quando `sessionStart` dispara automaticamente?](#p1-quando-sessionstart-dispara-automaticamente)
    - [P2: `userPromptSubmitted` dispara quando o usuário responde ao `vscode_askQuestions`?](#p2-userpromptsubmitted-dispara-quando-o-usuário-responde-ao-vscode_askquestions)
    - [P3: `agentStop` dispara ao fechar o VS Code ou ao fim de cada turno?](#p3-agentstop-dispara-ao-fechar-o-vs-code-ou-ao-fim-de-cada-turno)
    - [P4: `sessionEnd` é confiável?](#p4-sessionend-é-confiável)
    - [P5: O que é `postToolUseFailure`? Onde está documentado?](#p5-o-que-é-posttoolusefailure-onde-está-documentado)
    - [P6: `vscode_askQuestions` é um hook ou uma ferramenta?](#p6-vscode_askquestions-é-um-hook-ou-uma-ferramenta)
    - [P7: Por que a sessão continua depois do `sessionCloseAuthorized`?](#p7-por-que-a-sessão-continua-depois-do-sessioncloseauthorized)
    - [P8: Respostas ao `vscode_askQuestions` iniciam uma nova SESSION?](#p8-respostas-ao-vscode_askquestions-iniciam-uma-nova-session)
    - [P9: Existe algum hook que dispara para compressão de contexto?](#p9-existe-algum-hook-que-dispara-para-compressão-de-contexto)
    - [P10: Como distinguir comportamento Copilot CLI antigo vs VS Code nativo?](#p10-como-distinguir-comportamento-copilot-cli-antigo-vs-vs-code-nativo)
    - [P11: Como saber qual hook corresponde a qual arquivo de script?](#p11-como-saber-qual-hook-corresponde-a-qual-arquivo-de-script)
    - [P12: O `agentStop` pode ser usado para BLOQUEAR o agente?](#p12-o-agentstop-pode-ser-usado-para-bloquear-o-agente)
    - [P13: O que acontece se o agente ignorar o bloqueio e tentar chamar `session-close.sh` diretamente?](#p13-o-que-acontece-se-o-agente-ignorar-o-bloqueio-e-tentar-chamar-session-closesh-diretamente)
    - [P14: Qual a diferença exata entre `agentStop` e `sessionEnd`?](#p14-qual-a-diferença-exata-entre-agentstop-e-sessionend)
    - [P15: O que é exatamente `stop_hook_active` e por que existe?](#p15-o-que-é-exatamente-stop_hook_active-e-por-que-existe)
    - [P16: O agente pode "terminar" voluntariamente sem escrever resposta?](#p16-o-agente-pode-terminar-voluntariamente-sem-escrever-resposta)
    - [P17: `SubagentStart` e `SubagentStop` disparam para o mesmo agente pai?](#p17-subagentstart-e-subagentstop-disparam-para-o-mesmo-agente-pai)
    - [P18: `PreCompact` pode ser usado para salvar estado antes de perder contexto?](#p18-precompact-pode-ser-usado-para-salvar-estado-antes-de-perder-contexto)
    - [P19: Múltiplos hooks para o mesmo evento — em qual ordem executam?](#p19-múltiplos-hooks-para-o-mesmo-evento--em-qual-ordem-executam)
    - [P20: O que acontece se um hook demora mais do que o timeout?](#p20-o-que-acontece-se-um-hook-demora-mais-do-que-o-timeout)
    - [P21: Um hook pode **modificar** a resposta do agente antes de exibi-la ao usuário?](#p21-um-hook-pode-modificar-a-resposta-do-agente-antes-de-exibi-la-ao-usuário)
    - [P22: O que significa exatamente o agente ficar "idle"?](#p22-o-que-significa-exatamente-o-agente-ficar-idle)
    - [P23: Enquanto aguarda resposta do `vscode_askQuestions`, o agente está "idle"?](#p23-enquanto-aguarda-resposta-do-vscode_askquestions-o-agente-está-idle)
    - [P24: Quais contadores são automáticos do VS Code e quais são criados pelo projeto?](#p24-quais-contadores-são-automáticos-do-vs-code-e-quais-são-criados-pelo-projeto)
    - [P25: O que é `transcript_path` e como podemos usá-lo?](#p25-o-que-é-transcript_path-e-como-podemos-usá-lo)
    - [P26: Por que `session_id` do VS Code e `session.id` no CTX podem ser diferentes?](#p26-por-que-session_id-do-vs-code-e-sessionid-no-ctx-podem-ser-diferentes)
  - [14. Bugs Conhecidos e Limitações da Plataforma](#14-bugs-conhecidos-e-limitações-da-plataforma)
    - [LIM-01 — `sessionEnd` não dispara em encerramento abrupto](#lim-01--sessionend-não-dispara-em-encerramento-abrupto)
    - [LIM-02 — `sessionStart` não dispara após close-and-continue](#lim-02--sessionstart-não-dispara-após-close-and-continue)
    - [LIM-03 — `userPromptSubmitted` não dispara para respostas de `vscode_askQuestions`](#lim-03--userpromptsubmitted-não-dispara-para-respostas-de-vscode_askquestions)
    - [LIM-04 — `sessionEnd` timestamps em Unix ms (bug de formato)](#lim-04--sessionend-timestamps-em-unix-ms-bug-de-formato)
    - [LIM-05 — Duplo disparo de hooks em edge cases](#lim-05--duplo-disparo-de-hooks-em-edge-cases)
  - [15. Subagentes em Profundidade — Ciclo de Vida Completo](#15-subagentes-em-profundidade--ciclo-de-vida-completo)
    - [15.1 O que é um subagente no VS Code Copilot?](#151-o-que-é-um-subagente-no-vs-code-copilot)
    - [15.2 Sequência exata de eventos ao chamar `runSubagent`](#152-sequência-exata-de-eventos-ao-chamar-runsubagent)
    - [15.3 `session_id` no contexto de subagentes — o que foi confirmado empiricamente](#153-session_id-no-contexto-de-subagentes--o-que-foi-confirmado-empiricamente)
    - [15.4 Campos nativos enviados pelo VS Code em SubagentStart e SubagentStop](#154-campos-nativos-enviados-pelo-vs-code-em-subagentstart-e-subagentstop)
    - [15.5 A ferramenta `runSubagent` — parâmetros do agente pai](#155-a-ferramenta-runsubagent--parâmetros-do-agente-pai)
    - [15.6 Variáveis criadas/modificadas quando um subagente é chamado](#156-variáveis-criadasmodificadas-quando-um-subagente-é-chamado)
    - [15.7 Os hooks do subagente — o subagente tem seus próprios hooks?](#157-os-hooks-do-subagente--o-subagente-tem-seus-próprios-hooks)
    - [15.8 O problema do `agentStop` do pai antes do subagente iniciar](#158-o-problema-do-agentstop-do-pai-antes-do-subagente-iniciar)
    - [15.9 Quando múltiplos subagentes são chamados na mesma sessão](#159-quando-múltiplos-subagentes-são-chamados-na-mesma-sessão)
    - [15.10 `search_subagent` — a segunda ferramenta interna de subagente](#1510-search_subagent--a-segunda-ferramenta-interna-de-subagente)
    - [15.11 Seleção de modelo — o agente pai NÃO tem controle direto](#1511-seleção-de-modelo--o-agente-pai-não-tem-controle-direto)
    - [15.12 Ferramentas disponíveis ao subagente Explore — conjunto `zK`](#1512-ferramentas-disponíveis-ao-subagente-explore--conjunto-zk)
    - [15.13 Arquitetura interna do agente Explore — como é gerado](#1513-arquitetura-interna-do-agente-explore--como-é-gerado)
    - [15.14 Agentes disponíveis ao `runSubagent` — tipos e origens](#1514-agentes-disponíveis-ao-runsubagent--tipos-e-origens)
    - [15.15 Schema da ferramenta `runSubagent` — referência completa](#1515-schema-da-ferramenta-runsubagent--referência-completa)
    - [15.16 Comunicação pai→filho: o `prompt` como único canal](#1516-comunicação-paifilho-o-prompt-como-único-canal)
  - [16. Ferramentas Internas Críticas — `vscode_askQuestions` e `manage_todo_list`](#16-ferramentas-internas-críticas--vscode_askquestions-e-manage_todo_list)
    - [16.1 `vscode_askQuestions` — papel no sistema de autorização](#161-vscode_askquestions--papel-no-sistema-de-autorização)
    - [16.2 Schema de input — o que o agente envia](#162-schema-de-input--o-que-o-agente-envia)
      - [Tabela de restrições (hardening v1.9)](#tabela-de-restrições-hardening-v19)
      - [Anti-padrões proibidos](#anti-padrões-proibidos)
    - [16.3 Schema de response — o que o agente recebe](#163-schema-de-response--o-que-o-agente-recebe)
    - [16.4 Behavior handler — allow / deny](#164-behavior-handler--allow--deny)
    - [16.5 `manage_todo_list` — o que é e como funciona](#165-manage_todo_list--o-que-é-e-como-funciona)
    - [16.6 Schema completo do `todoList` item](#166-schema-completo-do-todolist-item)
    - [16.7 Operações `read` e `write`](#167-operações-read-e-write)
    - [16.8 Integração com o sistema de hooks](#168-integração-com-o-sistema-de-hooks)
    - [16.9 Reinício inline vs preCompact — a diferença crítica](#169-reinício-inline-vs-precompact--a-diferença-crítica)
      - [O que aconteceu](#o-que-aconteceu)
      - [Por que o `preCompact` hook NÃO disparou](#por-que-o-precompact-hook-não-disparou)
      - [O sistema sobreviveu corretamente](#o-sistema-sobreviveu-corretamente)
      - [Hardenings implementados a partir desta investigação](#hardenings-implementados-a-partir-desta-investigação)
      - [Recomendações operacionais](#recomendações-operacionais)
  - [17. Agent Debug Panel — Sistema de Depuração Nativo do Copilot](#17-agent-debug-panel--sistema-de-depuração-nativo-do-copilot)
    - [17.1 O que é o Agent Debug Panel](#171-o-que-é-o-agent-debug-panel)
    - [17.2 Como Acessar o Debug Panel](#172-como-acessar-o-debug-panel)
      - [Via Paleta de Comandos (método principal)](#via-paleta-de-comandos-método-principal)
      - [Comandos de navegação e exportação disponíveis](#comandos-de-navegação-e-exportação-disponíveis)
      - [Filtros e toggles disponíveis na view](#filtros-e-toggles-disponíveis-na-view)
    - [17.3 Arquitetura Interna — Pipeline de Eventos](#173-arquitetura-interna--pipeline-de-eventos)
      - [Estado interno da classe `UK` — tabela de correlação](#estado-interno-da-classe-uk--tabela-de-correlação)
    - [17.4 Categorias de Eventos e Campos Rastreados](#174-categorias-de-eventos-e-campos-rastreados)
      - [17.4.1 Categoria `loopControl` — Loop do Agente](#1741-categoria-loopcontrol--loop-do-agente)
      - [17.4.2 Categoria `toolCall` — Chamadas de Ferramentas](#1742-categoria-toolcall--chamadas-de-ferramentas)
      - [17.4.3 Categoria `llmRequest` — Requisições ao LLM](#1743-categoria-llmrequest--requisições-ao-llm)
      - [17.4.4 Categoria `error` — Erros de Execução](#1744-categoria-error--erros-de-execução)
      - [17.4.5 Categoria `discovery` — Instruções e Skills](#1745-categoria-discovery--instruções-e-skills)
      - [Resumo de log levels por categoria](#resumo-de-log-levels-por-categoria)
    - [17.5 TrajectoryLogger — Registro Detalhado de Execução](#175-trajectorylogger--registro-detalhado-de-execução)
      - [Estrutura de uma trajetória](#estrutura-de-uma-trajetória)
      - [Estrutura de um `TrajectoryStep`](#estrutura-de-um-trajectorystep)
      - [Exportação de trajetórias](#exportação-de-trajetórias)
    - [17.6 Subagentes no Debug Panel](#176-subagentes-no-debug-panel)
    - [17.7 Configurações Relevantes](#177-configurações-relevantes)
    - [17.8 Comparação: Debug Panel vs. Nosso `audit.jsonl`](#178-comparação-debug-panel-vs-nosso-auditjsonl)
      - [O que o Debug Panel rastreia e nós NÃO rastreamos](#o-que-o-debug-panel-rastreia-e-nós-não-rastreamos)
      - [O que NÓS rastreamos e o Debug Panel NÃO rastreia](#o-que-nós-rastreamos-e-o-debug-panel-não-rastreia)
    - [17.9 Como Complementar Nosso Sistema com Dados do Debug Panel](#179-como-complementar-nosso-sistema-com-dados-do-debug-panel)
      - [Opção A — `PostToolUse` para capturar token usage (recomendada, baixo esforço)](#opção-a--posttooluse-para-capturar-token-usage-recomendada-baixo-esforço)
      - [Opção B — Filtrar `read_file` de skills no `PostToolUse` (skill discovery)](#opção-b--filtrar-read_file-de-skills-no-posttooluse-skill-discovery)
      - [Opção C — Parsear `exportTrajectories` via pós-processamento (offline)](#opção-c--parsear-exporttrajectories-via-pós-processamento-offline)
      - [Prioridade de implementação recomendada](#prioridade-de-implementação-recomendada)
    - [17.10 O Transcript JSONL — Log Filesystem Acessível por LLMs](#1710-o-transcript-jsonl--log-filesystem-acessível-por-llms)
      - [Localização e descoberta dinâmica do arquivo](#localização-e-descoberta-dinâmica-do-arquivo)
      - [Formato e tipos de eventos do transcript](#formato-e-tipos-de-eventos-do-transcript)
      - [Schemas completos por tipo de evento](#schemas-completos-por-tipo-de-evento)
      - [Análise empírica — dados reais de sessões coletadas](#análise-empírica--dados-reais-de-sessões-coletadas)
      - [Falhas encontradas: padrão entre sessões](#falhas-encontradas-padrão-entre-sessões)
      - [Limitação crítica do transcript](#limitação-crítica-do-transcript)
      - [Script `read-transcript.sh` — acesso programático ao log](#script-read-transcriptsh--acesso-programático-ao-log)
    - [17.11 Falhas de API do vscode_askQuestions — "Response contained no choices"](#1711-falhas-de-api-do-vscode_askquestions--response-contained-no-choices)
      - [Identificação no transcript e na UI](#identificação-no-transcript-e-na-ui)
      - [O artefato de "corrupção visual" na UI](#o-artefato-de-corrupção-visual-na-ui)
      - [Hardenings implementados {#hardenings-recomendados-askquestions}](#hardenings-implementados-hardenings-recomendados-askquestions)
  - [18. Achados de Auditoria Proativa — Exploratory Bug Hunt (2026-03-12)](#18-achados-de-auditoria-proativa--exploratory-bug-hunt-2026-03-12)
    - [18.1 Sumário Executivo](#181-sumário-executivo)
    - [18.2 Achados de Severidade MÉDIA (corrigidos)](#182-achados-de-severidade-média-corrigidos)
      - [EBH-M01 — `pre-tool-use.sh`: auto_recovery escrevia CTX de forma não-atômica](#ebh-m01--pre-tool-usesh-auto_recovery-escrevia-ctx-de-forma-não-atômica)
      - [EBH-M02 — `agent-stop.sh`: usava `$CTX_FILE.tmp` como nome estático de temporário](#ebh-m02--agent-stopsh-usava-ctx_filetmp-como-nome-estático-de-temporário)
      - [EBH-M03 — `session-start.sh`: `LOGICAL_SESSION_NUMBER` poderia ser `0`](#ebh-m03--session-startsh-logical_session_number-poderia-ser-0)
    - [18.3 Achados de Severidade BAIXA](#183-achados-de-severidade-baixa)
      - [EBH-L01 — `subagent-start.sh` / `subagent-stop.sh`: sem fallback mktemp (CORRIGIDO)](#ebh-l01--subagent-startsh--subagent-stopsh-sem-fallback-mktemp-corrigido)
      - [EBH-L02 — `common.sh:ctx_update()`: risco latente de injeção de expressão jq](#ebh-l02--commonshctx_update-risco-latente-de-injeção-de-expressão-jq)
      - [EBH-L03 — `agent-stop.sh`: ~40 chamadas individuais `jq "$CTX_FILE"` (performance)](#ebh-l03--agent-stopsh-40-chamadas-individuais-jq-ctx_file-performance)
    - [18.4 Metodologia](#184-metodologia)
  - [19. Análise Aprofundada: Ciclo de Vida do Prompt vs Sessão](#19-análise-aprofundada-ciclo-de-vida-do-prompt-vs-sessão)
    - [19.1 Taxonomia Completa dos Cenários](#191-taxonomia-completa-dos-cenários)
      - [Matriz de Decisão](#matriz-de-decisão)
      - [Caminho de Decisão no código (`log-prompt.sh` Fase 0)](#caminho-de-decisão-no-código-log-promptsh-fase-0)
    - [19.2 Análise Detalhada por Cenário](#192-análise-detalhada-por-cenário)
      - [Cenário A — Nova aba de chat (sessionStart + session_id novo)](#cenário-a--nova-aba-de-chat-sessionstart--session_id-novo)
      - [Cenário B — Sessão ativa, prompt normal (caminho mais comum)](#cenário-b--sessão-ativa-prompt-normal-caminho-mais-comum)
      - [Cenário C — Mesma aba, prompt após sessão fechada (RECONNECT-02)](#cenário-c--mesma-aba-prompt-após-sessão-fechada-reconnect-02)
      - [Cenário D — Reconexão VS Code, novo session_id sem sessionStart (RECONNECT-01)](#cenário-d--reconexão-vs-code-novo-session_id-sem-sessionstart-reconnect-01)
      - [Cenário E — Inline compaction (sub-caso de D)](#cenário-e--inline-compaction-sub-caso-de-d)
      - [Cenário F — Manual recovery (HEAL v1)](#cenário-f--manual-recovery-heal-v1)
    - [19.3 Caso Especial: RECONNECT-01 + RECONNECT-02 Simultâneos (GAP-ARCH-05)](#193-caso-especial-reconnect-01--reconnect-02-simultâneos-gap-arch-05)
    - [19.4 Gaps Identificados e Status de Correção](#194-gaps-identificados-e-status-de-correção)
    - [19.5 Convenções e Campos de Rastreamento Relevantes](#195-convenções-e-campos-de-rastreamento-relevantes)
    - [19.6 Evidência Empírica desta Análise](#196-evidência-empírica-desta-análise)
  - [20. Hierarquia SESSION / SECTION / TURN — Análise Técnica Completa](#20-hierarquia-session--section--turn--análise-técnica-completa)
    - [20.1 Definição Formal dos Três Níveis](#201-definição-formal-dos-três-níveis)
    - [20.2 `session_id` — Fonte de Verdade Única](#202-session_id--fonte-de-verdade-única)
    - [20.3 Ciclo de Vida Completo com Responsável por Campo](#203-ciclo-de-vida-completo-com-responsável-por-campo)
      - [SESSION](#session)
      - [SECTION](#section)
      - [TURN](#turn)
    - [20.4 Tabela Completa de Campos por Nível](#204-tabela-completa-de-campos-por-nível)
      - [`session.*` — Persistido em `session-context.json`](#session--persistido-em-session-contextjson)
      - [`session_stats.*` — Métricas da sessão](#session_stats--métricas-da-sessão)
      - [`current_section.*` — Estado vivo da seção ativa](#current_section--estado-vivo-da-seção-ativa)
      - [`current_turn.*` — Estado vivo do turno atual](#current_turn--estado-vivo-do-turno-atual)
    - [20.5 Semântica dos Contadores de TURN](#205-semântica-dos-contadores-de-turn)
    - [20.6 Bugs Identificados e Corrigidos (v2.3)](#206-bugs-identificados-e-corrigidos-v23)
    - [20.7 Gaps de Design Documentados](#207-gaps-de-design-documentados)
    - [20.8 Fluxo Completo de `session_id` por Cenário](#208-fluxo-completo-de-session_id-por-cenário)
  - [21. Referências](#21-referências)
    - [Documentação Oficial](#documentação-oficial)
    - [Documentação Interna](#documentação-interna)

---

## 1. O que são Hooks?

Hooks são **comandos shell** executados automaticamente em **pontos específicos do ciclo de vida**
do agente Copilot no VS Code. São configurados em arquivos JSON e recebem contexto via stdin,
podendo influenciar o comportamento do agente via stdout.

**Características fundamentais:**

- Execução **determinística** — ao contrário de instruções em linguagem natural, hooks executam
  código (shell) com garantias de resultado
- Comunicação bidirecional via JSON: stdin (entrada do VS Code) e stdout (saída para o VS Code)
- Hooks podem **bloquear**, **modificar** ou **aprovar** operações do agente
- Executados com as mesmas permissões do processo VS Code

**Casos de uso canônicos:**

| Caso de uso            | Evento recomendado | Exemplo                                 |
| ---------------------- | ------------------ | --------------------------------------- |
| Políticas de segurança | `PreToolUse`       | Bloquear `rm -rf` antes de executar     |
| Qualidade de código    | `PostToolUse`      | Rodar Prettier após edição de arquivo   |
| Auditoria              | Todos              | Logar cada invocação de ferramenta      |
| Injeção de contexto    | `SessionStart`     | Adicionar contexto do projeto ao início |
| Controle de aprovação  | `PreToolUse`       | Auto-aprovar operações seguras          |
| Rastreamento de estado | `UserPromptSubmit` | Registrar início de turno no audit log  |
| Cleanup / relatórios   | `Stop`             | Gerar relatório de sessão ao fim        |

---

## 2. Eventos Nativos do VS Code Copilot

> **Fonte**:
> [Documentação oficial VS Code — Agent hooks (Preview)](https://code.visualstudio.com/docs/copilot/customization/hooks)
> — verificada em 2026-03-11

O VS Code documenta **8 eventos oficiais** (em Preview como de março/2026):

| Evento (PascalCase) | Alias lowerCamelCase  | Quando dispara (oficial)                       |
| ------------------- | --------------------- | ---------------------------------------------- |
| `SessionStart`      | `sessionStart`        | Nova sessão de agente começa                   |
| `UserPromptSubmit`  | `userPromptSubmitted` | Usuário submete um prompt                      |
| `PreToolUse`        | `preToolUse`          | Antes do agente invocar qualquer ferramenta    |
| `PostToolUse`       | `postToolUse`         | Após ferramenta completar com sucesso          |
| `PreCompact`        | `preCompact`          | Antes da compactação do contexto da conversa   |
| `SubagentStart`     | `subagentStart`       | Subagente é criado                             |
| `SubagentStop`      | `subagentStop`        | Subagente completa                             |
| `Stop`              | `agentStop`           | Sessão do agente encerra (= fim de cada turno) |

> **Nota**: A documentação usa PascalCase (`SessionStart`). O formato Copilot CLI usa lowerCamelCase
> (`sessionStart`). O VS Code converte automaticamente entre os formatos.

---

## 3. Quando cada evento dispara — guia definitivo

Esta é a seção mais crítica. Muita confusão surge por mal-entendimento de **quando exatamente** cada
evento dispara.

### 3.1 `SessionStart` — Uma vez por janela de chat

**Dispara quando**: Uma **nova** sessão do Copilot Chat é criada no VS Code.

**O que é "nova sessão"?** Uma nova sessão começa quando:

- O usuário abre uma **nova aba/janela do Copilot Chat** (botão "+" — New Conversation)
- O VS Code reinicia e o Copilot Chat é recarregado
- O DevContainer é recriado

**O que NÃO é "nova sessão"?**

- O usuário responde a um prompt existente no mesmo chat = mesma sessão
- O usuário responde ao `vscode_askQuestions` do agente = mesma sessão
- O agente faz múltiplos TURNOS na mesma conversa = mesma sessão

**Evidência empírica** (audit.jsonl local):

```
sessionStart  2026-03-09T17:12:35Z  session_id: 7f9f96e4-...
  → userPromptSubmitted  17:12:37Z  (mesmo session_id)
  → (sessão encerrada)

sessionStart  2026-03-09T17:23:38Z  session_id: 444ad443-...
  → userPromptSubmitted  17:23:41Z  (mesmo session_id)
  → userPromptSubmitted  17:33:15Z  (mesmo session_id — SEGUNDO PROMPT, MESMA SESSÃO)
```

**Conclusão crítica**: `sessionStart` dispara **no máximo 1x por janela de chat**. Se o usuário faz
10 turnos em uma conversa, `sessionStart` dispara 1x e `userPromptSubmitted` dispara 10x.

**Input extra para SessionStart:**

```json
{ "source": "new" }
```

O campo `source` é atualmente sempre `"new"` (a plataforma não distingue outros casos).

> ⚠️ **DISTINÇÃO CRÍTICA — dois campos `source` diferentes**:
>
> | Campo                                                | Quem escreve         | Valores possíveis                                                                                                                            |
> | ---------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
> | `source` no **input do hook** (acima)                | VS Code / plataforma | Sempre `"new"`                                                                                                                               |
> | `session.source` no **CTX** (`session-context.json`) | Nossos scripts       | `"new"`, `"inline_restart"`, `"reconnect_rollover"`, `"manual_recovery"`, `"healed_from_real_session"`, `"healed_from_consecutive_mismatch"` |
>
> O CTX usa `session.source` para rastrear **como** a sessão lógica foi iniciada ou recuperada —
> valor diferente do `source` que o VS Code envia. Não confundir os dois.

---

### 3.2 `UserPromptSubmit` (= `userPromptSubmitted`) — Por prompt digitado

**Dispara quando**: O usuário digita um **texto na caixa de chat** do VS Code e pressiona Enter.

> ⚠️ **ARMADILHA CRÍTICA**: `userPromptSubmitted` NÃO dispara quando o agente usa
> `vscode_askQuestions`. As respostas do usuário a `vscode_askQuestions` chegam via
> **`postToolUse`** (pós-ferramenta), NÃO como novo prompt.

**Implicação prática**: Em sessões onde o fluxo principal é via `vscode_askQuestions`, o hook
`userPromptSubmitted` pode disparar **apenas 1 vez** na sessão inteira (o prompt inicial do
usuário). Todo o diálogo subsequente via `vscode_askQuestions` → respostas → callbacks corre via
`postToolUse`, não via `userPromptSubmitted`.

**Evidência empírica** (sessão `dcf579af` — 2026-03-10/11, ~24h de duração):

```
sessionStart    1x   (06:31:07Z)
userPromptSubmitted  28x  total (1 inicial + replies via chat box)
agentStop       20x  (um por turno do agente)
preToolUse    1892x  (execuções de ferramentas)
postToolUse   1851x
```

Nota: 28 `userPromptSubmitted` para uma sessão de 24h com muitos turnos via `vscode_askQuestions`
sugere que nas sessões interativas via `vscode_askQuestions`, o usuário ainda digitou alguns prompts
diretos na caixa de chat.

---

### 3.3 `PreToolUse` — Antes de CADA ferramenta

**Dispara quando**: O agente está **prestes a invocar** qualquer ferramenta (read_file,
replace_string_in_file, run_in_terminal, vscode_askQuestions, etc.).

**Frequência**: Altíssima. Em sessões longas, pode ser milhares de vezes (1892x na sessão acima).

**Uso canônico neste repo**: Verificar se a ferramenta `run_in_terminal` está tentando chamar
`session-close.sh` diretamente (bloqueado por `pre-tool-use.sh`).

---

### 3.4 `PostToolUse` — Após CADA ferramenta completar COM SUCESSO

**Dispara quando**: Uma ferramenta **completou com sucesso**.

> ⚠️ Não dispara para ferramentas que **falharam** — para erros, existe `postToolUseFailure`.

**Aspecto crítico**: Quando o usuário responde ao `vscode_askQuestions`:

1. O `vscode_askQuestions` é uma ferramenta invocada pelo agente
2. O resultado (resposta do usuário) chega via `postToolUse` com `tool_name = "vscode_askQuestions"`
3. É neste ponto que `post-tool-use.sh` detecta a `close_key` na resposta do usuário

**Frequência**: Alta — uma chamada por ferramenta executada.

---

### 3.5 `Stop` (= `agentStop`) — Fim de CADA TURNO do agente

> ⚠️ **A maior fonte de confusão**: O nome `Stop` e a descrição "Agent session ends" na documentação
> são **enganosos**. Na prática, `Stop` dispara ao **fim de cada turno** do agente, não quando a
> janela do chat é fechada. Ver a [Seção 4](#4-o-que-é-fim-de-turno--agentstop-em-profundidade) para
> análise completa.

**O que é um "turno"**: Do momento em que o usuário envia uma mensagem até o momento em que o agente
termina completamente sua resposta (sem mais tool calls pendentes, texto final escrito).

**Frequência**: Uma vez por turno completo. Na sessão de exemplo: 20x `agentStop` para uma sessão de
24h com muitos turnos.

**Entrada extra**: O campo `stop_hook_active` (boolean) indica se este disparo é resultado de um
bloqueio anterior do próprio hook Stop. Ver análise completa na Seção 4.

---

### 3.6 `SubagentStart` / `SubagentStop` — Para subagentes

**Dispara quando**: O agente principal cria um subagente via `runSubagent`. `SubagentStart` dispara
ao criar o subagente; `SubagentStop` quando ele termina.

**Evidência** (audit.jsonl histórico): 6 invocações de `runSubagent` registradas, todas usando o
agente `"Explore"`.

> **Visão completa dos subagentes está na Seção 16** — incluindo fluxo de eventos, `session_id`,
> variáveis criadas, e a lógica HARDENING do pai.

---

### 3.7 `PreCompact` — Antes de compactar o contexto

**Dispara quando**: O contexto da conversa está ficando longo demais e o VS Code decide compactá-lo
(truncar a história para caber no budget de tokens).

**Input extra:**

```json
{ "trigger": "auto" }
```

Atualmente só existe o trigger `"auto"` (compactação automática por limite de tokens).

**Frequência**: Relativamente rara — somente quando a conversa ultrapassa o limite de contexto.

---

### 3.8 `SessionEnd` — Quando a sessão VS Code realmente fecha

**Status**: Evento presente no formato Copilot CLI mas **NÃO listado nos 8 eventos oficiais** da
documentação VS Code de março/2026.

**Quando dispara**: Quando a janela do Copilot Chat é fechada pelo usuário **normalmente**.

> ⚠️ **LIMITAÇÃO CRÍTICA**: `sessionEnd` **NÃO dispara** quando:
>
> - O DevContainer reinicia abruptamente
> - O VS Code fecha inesperadamente (crash)
> - A sessão expira por timeout
> - O usuário fecha o VS Code sem fechar o chat explicitamente
>
> Esta limitação é a razão pela qual este repositório mantém o mecanismo `session-close.sh` — o
> único mecanismo **confiável** de registro de encerramento autorizado de sessão.

---

## 4. O que é "fim de turno" — agentStop em profundidade

### 4.1 Definição precisa de "turno" (regime automático VS Code)

Na plataforma VS Code Copilot, um **turno** (turn) é o ciclo:

```
[Usuário envia mensagem] → [Agente processa: faz N tool calls] → [Agente escreve resposta final]
```

O evento `Stop` (= `agentStop`) dispara **exatamente uma vez** por turno — no momento em que o
agente termina de escrever sua resposta final e o VS Code detecta que não há mais tool calls a
processar.

**Importante**: Um turno pode conter ZERO, UM ou MUITOS tool calls. O agente pode:

1. Chamar `read_file` 20 vezes, depois escrever uma resposta → 1 turno → 1 `agentStop`
2. Chamar `vscode_askQuestions`, aguardar a resposta, fazer mais tool calls, escrever a resposta
   final → 1 turno → 1 `agentStop` (quando tudo termina)
3. Escrever uma resposta de texto puro sem tool calls → 1 turno → 1 `agentStop`

### 4.2 Quando exatamente o agentStop ocorre?

O `agentStop` ocorre quando o VS Code detecta que:

1. O agente escreveu seu último token de texto
2. **Não há** mais tool calls na fila de execução do agente
3. O agente retornou controle à plataforma

**Não ocorre**:

- No meio de uma sequência de tool calls (mesmo com muitas ferramentas)
- Enquanto `vscode_askQuestions` está aguardando resposta do usuário
- Quando a janela do chat é fechada (para isso existe `sessionEnd`)

### 4.3 O que acontece DEPOIS do agentStop?

Existem dois cenários:

**Cenário A — agentStop normal (sem bloqueio):**

```
agentStop dispara
  → hook retorna {exit 0} ou vazio
  → VS Code: turno encerrado ✓
  → Agente fica IDLE
  → Aguarda próxima mensagem do usuário (userPromptSubmitted)
  → ou aguarda resposta de vscode_askQuestions (postToolUse)
```

**Cenário B — agentStop bloqueado pelo hook (customização deste repo):**

```
agentStop dispara (stop_hook_active=false)
  → hook detecta: vscode_askQuestions NÃO foi chamado neste turno
  → hook emite: {hookSpecificOutput: {decision: "block", reason: "..."}, systemMessage: "..."}
  → VS Code injeta o systemMessage no contexto do agente
  → Agente CONTINUA no mesmo turno (recebe o systemMessage como contexto adicional)
  → Agente deve agora chamar vscode_askQuestions
  → Agente chama vscode_askQuestions e escreve resposta final
  → agentStop dispara NOVAMENTE — mas desta vez stop_hook_active=TRUE
  → hook detecta stop_hook_active=true → NÃO bloqueia (anti-loop)
  → VS Code: turno encerrado ✓
```

### 4.4 O campo `stop_hook_active` — o anti-loop

`stop_hook_active` é o mecanismo do VS Code para **prevenir recursão infinita** no hook `Stop`.

| Valor   | Quando ocorre                                                                 |
| ------- | ----------------------------------------------------------------------------- |
| `false` | Primeira invocação do Stop neste turno — comportamento normal                 |
| `true`  | Segunda+ invocação — ocorre porque um hook anterior retornou `decision:block` |

**Regra crítica**: Um hook `Stop` **NUNCA** deve emitir `decision:block` quando
`stop_hook_active=true`. Caso contrário, cria-se um loop infinito de bloqueios.

**Sequência detalhada com stop_hook_active:**

```
1. Agente termina resposta → VS Code chama agent-stop.sh com stop_hook_active=false
2. agent-stop.sh verifica: vscode_askQuestions foi chamado? NÃO
3. agent-stop.sh emite decision:block + systemMessage
4. VS Code injeta systemMessage no contexto
5. Agente processa → chama vscode_askQuestions → escreve nova resposta
6. VS Code chama agent-stop.sh NOVAMENTE com stop_hook_active=true
7. agent-stop.sh verifica stop_hook_active=true → NÃO bloqueia
8. Turno encerra normalmente
```

Se em (2) o hook errasse e bloqueasse quando `stop_hook_active=true`, a sequência em (5-8) se
repetiria infinitamente.

**Evidência empírica** (audit.jsonl):

```
agentStop  2026-03-10T10:21:07  stop_hook_active=true
  → agente foi bloqueado anteriormente e precisou de nova rodada
```

### 4.5 `agentStop` vs `sessionEnd` — diferença crítica

| Aspecto              | `agentStop` (= `Stop`)                        | `sessionEnd`                                         |
| -------------------- | --------------------------------------------- | ---------------------------------------------------- |
| **Dispara quando**   | Fim de CADA turno do agente                   | Quando o chat panel é efetivamente fechado           |
| **Frequência**       | 1x por turno (pode ser dezenas/dia)           | 1x por sessão (máximo)                               |
| **Confiabilidade**   | ✅ Sempre dispara ao fim de cada turno        | ⚠️ Não dispara em crashes/reinicializações           |
| **stop_hook_active** | ✅ Presente (para anti-loop)                  | ❌ Não presente                                      |
| **Uso canônico**     | Auditoria de turno, bloqueio, nudge ao agente | Cleanup final de sessão (quando funciona)            |
| **Nome cripto**      | Oficial: "Stop" / Nosso: "agentStop"          | Experimental / Copilot CLI (não está nos 8 oficiais) |

### 4.6 Sequência completa de um ciclo prompt→resposta

```
Usuário digita no chat box
    ↓
[userPromptSubmitted] → log-prompt.sh executa
    - Loga início de turno no audit.jsonl
    - Reseta current_turn.* no session-context.json
    - (se ended_at != null → RECONNECT-02: cria sessão inline)
    ↓
VS Code repassa ao agente → agente processa
    ↓
Para cada ferramenta invocada:
    [PreToolUse] → pre-tool-use.sh executa
        - Verifica permissões
        - Loga no audit.jsonl
        - Pode: allow / deny / ask
    (ferramenta executa)
    [PostToolUse] → post-tool-use.sh executa
        - Atualiza métricas no session-context.json
        - Detecta close_key em respostas de vscode_askQuestions
    (ou, em caso de falha)
    [PostToolUseFailure] → tool-use-failure.sh executa
    ↓
Agente escreve resposta final (sem mais tool calls)
    ↓
[Stop / agentStop] → agent-stop.sh executa
    - Verifica se vscode_askQuestions foi chamado (AUTH_REQUESTED)
    - Se NÃO (e stop_hook_active=false) → decision:block → continua
    - Se SIM (ou stop_hook_active=true) → loga turno, encerra normalmente
    ↓
Agente fica IDLE (aguarda próximo input)
```

---

## 5. Entradas e Saídas dos Hooks

### 5.1 Input comum (todos os hooks)

```json
{
  "timestamp": "2026-03-11T14:00:00.000Z",
  "cwd": "/path/to/workspace",
  "sessionId": "uuid-da-sessao",
  "hookEventName": "PreToolUse",
  "transcript_path": "/path/to/transcript.json"
}
```

### 5.2 Outputs — como influenciar o agente

Todo hook pode retornar JSON via stdout:

```json
{
  "continue": true,
  "stopReason": "Razão para parar (se continue=false)",
  "systemMessage": "Mensagem exibida ao usuário/agente"
}
```

| Campo           | Tipo    | Efeito                                                       |
| --------------- | ------- | ------------------------------------------------------------ |
| `continue`      | boolean | `false` = para a sessão inteira (DRÁSTICO — use com cuidado) |
| `stopReason`    | string  | Razão para parar, mostrada ao usuário                        |
| `systemMessage` | string  | Aviso injetado na conversa (sem parar a sessão)              |

**Exit codes:**

| Código | Significado                                     |
| ------ | ----------------------------------------------- |
| `0`    | Sucesso — stdout é parseado como JSON           |
| `2`    | Erro bloqueante — o stderr é mostrado ao modelo |
| Outro  | Aviso não-bloqueante — processamento continua   |

### 5.3 Outputs específicos por hook

**PreToolUse** — via `hookSpecificOutput`:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Bloqueado por política",
    "updatedInput": { "alterações no input da ferramenta": true },
    "additionalContext": "Contexto adicional para o modelo"
  }
}
```

`permissionDecision` pode ser `"allow"`, `"deny"` ou `"ask"`. Múltiplos hooks: o mais restritivo
vence (`deny > ask > allow`).

**PostToolUse** — para bloquear ou injetar contexto:

```json
{
  "decision": "block",
  "reason": "Validação pós-ferramenta falhou",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "O arquivo editado tem erros de lint"
  }
}
```

**Stop** — para **impedir** que o agente pare (permite continuar por mais turnos):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Execute os testes antes de terminar"
  }
}
```

> ⚠️ `decision: "block"` no hook `Stop` faz o agente continuar por mais turnos, consumindo **premium
> requests**. Sempre cheque `stop_hook_active` no input para evitar loop infinito.

**SessionStart** — injetar contexto inicial:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Projeto: v1.1 | Branch: main | Node: 24"
  }
}
```

---

## 6. PreToolUse — Controle de Permissão por Ferramenta

O `PreToolUse` é o hook mais poderoso para **controlar o comportamento do agente**. Dispara antes de
qualquer ferramenta e pode aprovar, negar ou delegar para o usuário.

### 6.1 permissionDecision — os três valores

| Valor   | Efeito                                                                          |
| ------- | ------------------------------------------------------------------------------- |
| `allow` | Ferramenta pode executar (comportamento padrão se hook não retornar nada)       |
| `deny`  | Ferramenta é bloqueada. O agente recebe `additionalContext` explicando o porquê |
| `ask`   | VS Code pausa e pergunta ao usuário humano se a ferramenta deve executar        |

**Regra de prioridade com múltiplos hooks**: Se vários hooks registrados para `PreToolUse`
retornarem decisões diferentes, o mais restritivo vence: `deny > ask > allow`.

### 6.2 Como `deny` aparece para o agente

Quando `permissionDecision: "deny"` é retornado:

- A ferramenta **não executa**
- O VS Code injeta `additionalContext` como mensagem de erro no contexto do agente
- O agente recebe esse contexto e pode tentar uma abordagem alternativa

Exemplo prático (deste repositório — `pre-tool-use.sh`):

```json
{
  "permissionDecision": "deny",
  "additionalContext": "🚫 BLOQUEADO (v8.0): session-close.sh NÃO pode ser chamado diretamente.\nFluxo correto: (1) vscode_askQuestions Template F → (2) usuário digita KEY → (3) post-tool-use.sh executa automaticamente."
}
```

O agente recebe esse `additionalContext` e entende que precisa usar o fluxo correto.

### 6.3 Como `ask` funciona

Quando `permissionDecision: "ask"` é retornado:

- VS Code exibe um diálogo para o **usuário humano**
- O usuário pode aprovar ou negar manualmente
- O agente aguarda a decisão antes de continuar

**Diferença de `ask` vs `vscode_askQuestions`**:

- `ask` via `permissionDecision`: o VS Code exibe um prompt de aprovação nativo, específico para
  autorizar uma **ferramenta específica**
- `vscode_askQuestions`: uma ferramenta que o **agente invoca** para perguntar qualquer coisa ao
  usuário em formato livre / múltipla escolha

### 6.4 `updatedInput` — modificar o input da ferramenta

`PreToolUse` pode também **modificar o input** que chegará à ferramenta:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": {
      "command": "echo 'sanitized command'"
    }
  }
}
```

O `updatedInput` sobrescreve campos do `tool_input`. Útil para sanitizar ou enriquecer dados antes
da execução da ferramenta.

### 6.5 Input do PreToolUse — campos disponíveis

```json
{
  "timestamp": "2026-03-11T14:00:00.000Z",
  "sessionId": "uuid-da-sessao",
  "hookEventName": "PreToolUse",
  "tool_name": "run_in_terminal",
  "tool_input": {
    "command": "git push --force"
  },
  "tool_use_id": "tool-use-uuid"
}
```

O campo `tool_name` identifica qual ferramenta será executada. Exemplos comuns: `read_file`,
`replace_string_in_file`, `run_in_terminal`, `vscode_askQuestions`, `manage_todo_list`,
`grep_search`, `semantic_search`, etc.

---

## 7. Configuração e Formato

### 7.1 Localização dos arquivos

O VS Code busca hooks em (por ordem de prioridade):

| Escopo      | Localização padrão                                     |
| ----------- | ------------------------------------------------------ |
| Workspace   | `.github/hooks/*.json`                                 |
| Claude Code | `.claude/settings.json`, `.claude/settings.local.json` |
| Usuário     | `~/.claude/settings.json`                              |
| Agente      | Campo `hooks:` no frontmatter `.agent.md`              |

Hooks do workspace têm precedência sobre hooks do usuário para o mesmo tipo de evento.

### 7.2 Formatos suportados

O VS Code lê **três formatos** compatíveis:

**VS Code nativo (PascalCase):**

```json
{
  "hooks": {
    "PreToolUse": [{ "type": "command", "command": "./scripts/validate.sh" }]
  }
}
```

**Copilot CLI (lowerCamelCase):** VS Code converte automaticamente:

```json
{
  "hooks": {
    "preToolUse": [{ "type": "command", "bash": "./scripts/validate.sh" }]
  }
}
```

Propriedades `bash` e `powershell` são mapeadas para os equivalentes OS-específicos (`linux`/`osx` e
`windows`).

**Claude Code:** Lido via `settings.json`. Matchers (`"Edit|Write"`) são parseados mas **ignorados**
— todos os hooks do evento rodam independente do matcher.

### 7.3 Propriedades de cada entrada de hook

| Propriedade | Tipo   | Obrigatório | Descrição                               |
| ----------- | ------ | ----------- | --------------------------------------- |
| `type`      | string | ✅          | Deve ser `"command"`                    |
| `command`   | string | ✅\*        | Comando padrão (cross-platform)         |
| `bash`      | string | ✅\*        | Alias Copilot CLI para `linux`+`osx`    |
| `windows`   | string | ❌          | Comando para Windows                    |
| `linux`     | string | ❌          | Comando para Linux                      |
| `osx`       | string | ❌          | Comando para macOS                      |
| `cwd`       | string | ❌          | Dir de trabalho relativo à raiz do repo |
| `env`       | object | ❌          | Env vars adicionais                     |
| `timeout`   | number | ❌          | Timeout em segundos (padrão: 30)        |

\* `command` ou `bash` (um deles obrigatório)

---

## 8. Mapeamento: nomes locais vs nomes oficiais VS Code

O arquivo `copilot-hooks.json` deste repositório usa o **formato Copilot CLI** (lowerCamelCase).
Tabela de correspondência com os nomes oficiais VS Code:

| Nome local (copilot-hooks.json) | Nome oficial VS Code | Status         | Script local          |
| ------------------------------- | -------------------- | -------------- | --------------------- |
| `sessionStart`                  | `SessionStart`       | ✅ Oficial     | `session-start.sh`    |
| `userPromptSubmitted`           | `UserPromptSubmit`   | ✅ Oficial\*   | `log-prompt.sh`       |
| `preToolUse`                    | `PreToolUse`         | ✅ Oficial     | `pre-tool-use.sh`     |
| `postToolUse`                   | `PostToolUse`        | ✅ Oficial     | `post-tool-use.sh`    |
| `agentStop`                     | `Stop`               | ✅ Oficial\*\* | `agent-stop.sh`       |
| `subagentStart`                 | `SubagentStart`      | ✅ Oficial     | `subagent-start.sh`   |
| `subagentStop`                  | `SubagentStop`       | ✅ Oficial     | `subagent-stop.sh`    |
| `preCompact`                    | `PreCompact`         | ✅ Oficial     | `pre-compact.sh`      |
| `postToolUseFailure`            | _(não documentado)_  | ⚠️ Extra\*\*\* | `tool-use-failure.sh` |
| `sessionEnd`                    | _(não documentado)_  | ⚠️ Extra\*\*\* | `session-end.sh`      |

\* `userPromptSubmitted` vs `UserPromptSubmit` — sufixo diferente, mas VS Code trata como
equivalente via conversão Copilot CLI.

\*\* O `agentStop` no formato Copilot CLI corresponde ao `Stop` oficial. A documentação descreve
`Stop` como "agent session ends" mas na prática dispara ao fim de cada **turno** do agente.

\*\*\* `postToolUseFailure` e `sessionEnd` estão no nosso `copilot-hooks.json` e aparentam ser
suportados pelo VS Code, mas não aparecem nos 8 eventos da documentação oficial de março/2026. Podem
ser eventos Preview, Copilot CLI-específicos, ou documentação incompleta.

---

## 9. Fluxo Nativo vs Customizações deste Repositório

### 9.1 O que a plataforma VS Code faz AUTOMATICAMENTE

I. **Ao abrir nova conversa no Copilot Chat:** → VS Code dispara `sessionStart` automaticamente →
`session-start.sh` é chamado

II. **Ao usuário apertar Enter no chat box:** → VS Code dispara `userPromptSubmitted` →
`log-prompt.sh` é chamado

III. **Antes de o agente usar qualquer ferramenta:** → VS Code dispara `preToolUse` →
`pre-tool-use.sh` é chamado

IV. **Após cada ferramenta completar com sucesso:** → VS Code dispara `postToolUse` →
`post-tool-use.sh` é chamado

V. **Ao agente terminar de responder (fim do turno):** → VS Code dispara `agentStop` →
`agent-stop.sh` é chamado

VI. **Ao fechar o Copilot Chat (quando funciona):** → VS Code dispara `sessionEnd` →
`session-end.sh` é chamado

### 9.2 O que NÃO é nativo — construído por este repositório

Tudo a seguir é **código customizado** que gerenciamos por cima dos hooks nativos:

| Conceito                      | Como é implementado nos scripts                                         |
| ----------------------------- | ----------------------------------------------------------------------- |
| Conceito de "SECTION"         | `start-section.sh` atualiza `current_section` no `session-context.json` |
| Conceito de "TURN"            | `log-prompt.sh` reseta `current_turn.*` + `agent-stop.sh` fecha o turno |
| `close_key` de sessão         | Gerada por `session-start.sh`, validada por `post-tool-use.sh`          |
| Bloqueio por `decision:block` | `agent-stop.sh` emite saída JSON com `decision:block`                   |
| Audit log (`audit.jsonl`)     | Todos os scripts escrevem neste arquivo de log                          |
| `session-context.json`        | State store central, gerenciado pelos scripts                           |
| `watchdog.sh`                 | Script externo para diagnóstico de saúde da sessão                      |
| `vscode_askQuestions`         | Ferramenta do VS Code — NÃO é um hook nativo; é uma tool do agente      |
| SESSION_CLOSE_NO_KEY.flag     | Flag customizada para detectar encerramento não-autorizado              |
| RECONNECT-01/02 logic         | Lógica para detectar session_id mismatch e post-close inline restart    |

### 9.3 `vscode_askQuestions` NÃO é um hook

`vscode_askQuestions` é uma **ferramenta do agente** (tool call), não um hook. O agente **invoca**
essa ferramenta, e o VS Code apresenta um formulário ao usuário. A resposta do usuário é recebida
via `postToolUse` (pós-ferramenta). Hooks reagem a eventos da plataforma; ferramentas são invocadas
pelo agente.

---

## 10. SESSION, SECTION, TURN — Modelo Personalizado

Este repositório implementa um modelo de ciclo de vida sobre os hooks nativos:

```
VS Code Chat         → [sessionStart]      → Início real da SESSION
 (1 conversa)       → [userPromptSubmitted] → Início de TURN
                    → [agentStop]           → Fim de TURN
                    → [sessionEnd]          → Fim real da SESSION (⚠️ não confiável)

Nossos scripts:
→ session-context.json: rastreia SESSION, SECTION, TURN em JSON persistido
→ session-close.sh: mecanismo confiável de encerramento autorizado (substitui sessionEnd)
→ start-section.sh: cria/fecha SECTIONs semânticas (não existe na plataforma)
→ agent-stop.sh: geris bloqueio por decision:block se vscode_askQuestions não foi chamado
```

### Distinção SESSION / SECTION / TURN:

| Conceito    | Existe na plataforma?            | Como é gerenciado                                          |
| ----------- | -------------------------------- | ---------------------------------------------------------- |
| **SESSION** | ✅ (sessionStart/End)            | platform-native + nosso `session-context.json` + close_key |
| **SECTION** | ❌ (não existe)                  | 100% customizado — `start-section.sh` + state no JSON      |
| **TURN**    | ✅ (Start=prompt, End=agentStop) | augmentado com metadados no `session-context.json`         |

---

## 11. Evidência Empírica (audit.jsonl)

Dados reais do log do repositório — sessão `dcf579af` (2026-03-10 a 2026-03-11, ~24h):

### 11.1 Frequência de eventos (sessionStart a sessionStart seguinte)

| Evento                       | Contagem | Tipo          | Observação                                       |
| ---------------------------- | -------- | ------------- | ------------------------------------------------ |
| `sessionStart`               | 1        | Nativo        | Uma vez por sessão VS Code                       |
| `userPromptSubmitted`        | 28       | Nativo        | Cada texto digitado na caixa de chat             |
| `agentStop`                  | 20       | Nativo        | Um por turno completo do agente                  |
| `preToolUse`                 | 1892     | Nativo        | Antes de cada ferramenta                         |
| `postToolUse`                | 1851     | Nativo        | Após cada ferramenta com sucesso                 |
| `sessionClose_key_validated` | 2        | Customizado   | BUG-PC-03: usuário digitou close_key 2x          |
| `sessionCloseAuthorized`     | 2        | Customizado   | BUG-PC-03: session-close.sh chamado 2x           |
| `sessionEnd`                 | 3        | Nativo+Custom | 2 via sessionEnd nativo (unix ms), 1 manual      |
| `sessionStart_inline`        | 1        | Customizado   | RECONNECT-02: sessão inline após close           |
| `turnStart`                  | 28       | Customizado   | Logado por `log-prompt.sh`                       |
| `agentStop_blocked`          | 6        | Customizado   | Turno bloqueado por falta de vscode_askQuestions |

### 11.2 Relação entre prompts e ask_questions

Na sessão `dcf579af`:

- 28 `userPromptSubmitted` = 28 mensagens diretas na caixa de chat
- 30 `askQuestions_response` = 30 respostas via `vscode_askQuestions` (via `postToolUse`)

Isso mostra que ~30 interações aconteceram sem que o hook `userPromptSubmitted` disparasse.

### 11.3 Estrutura do `tool_use_id` — identificador de ferramenta

O `tool_use_id` enviado pelo VS Code tem formato:

```
toolu_vrtx_01J9rZ2JXVp64LMj8cmcT4KX__vscode-1773044179757
```

Isto inclui:

- Prefixo do modelo (`toolu_vrtx_` = Vertex AI / Claude)
- ID único da invocação
- Sufixo `__vscode-<epoch_ms>` — timestamp da sessão VS Code em millisegundos

Esse prefixo `toolu_vrtx_` confirma que o backend de LLM é Claude (Anthropic) via Vertex AI.

---

## 12. Variáveis Nativas do VS Code vs Variáveis Customizadas do Repositório

Esta seção mapeia **o que o VS Code envia automaticamente** versus **o que nós calculamos e
persistimos** no `session-context.json`.

### 12.1 Campos enviados automaticamente pelo VS Code (em cada hook input)

Estes são os campos que **a plataforma insere** no JSON de stdin para cada evento:

| Campo              | Tipo    | Presente em                                       | Descrição                                     |
| ------------------ | ------- | ------------------------------------------------- | --------------------------------------------- |
| `timestamp`        | string  | Todos os hooks                                    | ISO 8601 UTC do momento do evento             |
| `session_id`       | string  | Todos os hooks                                    | UUID único da sessão VS Code (imutável)       |
| `hookEventName`    | string  | Todos os hooks                                    | Nome do hook (ex: `"PreToolUse"`)             |
| `cwd`              | string  | Todos os hooks                                    | Diretório de trabalho atual                   |
| `transcript_path`  | string  | Todos os hooks                                    | Caminho do transcript JSON da conversa        |
| `tool_name`        | string  | `PreToolUse`, `PostToolUse`, `PostToolUseFailure` | Nome da ferramenta sendo invocada             |
| `tool_input`       | object  | `PreToolUse`                                      | Input da ferramenta (ex: `{command: "..."}`)  |
| `tool_response`    | any     | `PostToolUse`                                     | Resposta da ferramenta ao agente              |
| `tool_use_id`      | string  | `PreToolUse`, `PostToolUse`                       | UUID único desta invocação de ferramenta      |
| `stop_hook_active` | boolean | `Stop` / `agentStop`                              | Anti-loop: `true` se Stop já bloqueou uma vez |
| `source`           | string  | `SessionStart`                                    | Sempre `"new"` na doc oficial                 |
| `trigger`          | string  | `PreCompact`                                      | Sempre `"auto"` quando compactação automática |

> **CRÍTICO**: `session_id` é enviado pelo VS Code em TODOS os hooks e **não pode ser modificado**
> pela plataforma. É o UUID interno do VS Code para a sessão atual. Toda tentativa de "reiniciar" a
> sessão cria apenas uma sessão LÓGICA nova no nosso contexto local — do ponto de vista do VS Code,
> a sessão continua sendo a mesma.

### 12.2 O `session_id` — imutável vs nosso contexto local

Uma confusão comum: **session_id do VS Code ≠ session.id do nosso session-context.json**.

| Aspecto                  | `session_id` do VS Code                             | `session.id` no session-context.json                 |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------- |
| **Quem controla**        | Plataforma VS Code (imutável)                       | Nós (scripts)                                        |
| **Quando muda**          | Apenas ao abrir nova conversa (nova sessão VS Code) | Quando criamos uma `inline_restart` session          |
| **Pode ser modificado?** | ❌ Não — é a fonte de verdade da plataforma         | ✅ Sim — mas apenas localmente (não afeta o VS Code) |
| **Formato**              | UUID: `66abca9d-8655-4060-84b7-a1a3079c476d`        | UUID: mesmo formato, mas pode ser diferente          |

**O que acontece em inline_restart**: Quando `ended_at != null` é detectado em `log-prompt.sh`
(RECONNECT-02), o `session.id` do CTX é atualizado para o `SESSION_ID_PAYLOAD` recebido do VS Code —
ou seja, o **MESMO UUID** da sessão VS Code anterior. **Não é gerado um UUID novo** (isso seria um
bug: geraria mismatch permanente em todos os hooks subsequentes — ver BUG-01, historicamente
corrigido). A distinção "nova sessão lógica" é capturada por três campos:
`session.source = "inline_restart"`, `session.started_at` (novo timestamp ISO) e
`session.prev_session_id` (guarda o ID anterior, que será **idêntico ao `session.id` atual** — pois
trata-se da mesma sessão VS Code). Isso é **comportamento esperado e correto**.

> ⚠️ **Nota de consistência** (`prev_session_id === session.id`): Em RECONNECT-02, o campo
> `prev_session_id` apontará para o mesmo UUID que `session.id`, porque o VS Code não criou uma nova
> sessão — apenas o nosso sistema lógico foi reiniciado. Não é um bug; é consequência do design. Ver
> seção 19 para a taxonomia completa dos cenários.

**Implicação prática**: `inline_restart` é 100% um conceito do nosso sistema de tracking. Não há
nada no VS Code que saiba disso — do ponto de vista da plataforma, é a mesma sessão.

### 12.3 Variáveis que construímos e persistimos (session-context.json)

Tudo abaixo é **100% customizado** — o VS Code não sabe nada sobre essas variáveis:

**`session.*` — Estado da sessão ativa:**

| Campo                         | Quem escreve                        | Descrição                                                         |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| `session.id`                  | `session-start.sh`                  | Cópia do `session_id` do VS Code (ou novo UUID em inline_restart) |
| `session.started_at`          | `session-start.sh`                  | Timestamp ISO de início da sessão lógica                          |
| `session.ended_at`            | `session-close.sh`                  | Timestamp de encerramento autorizado (`null` se ativa)            |
| `session.end_reason`          | `session-close.sh`                  | `"authorized_close"`, `null`, etc.                                |
| `session.close_key`           | `session-start.sh`                  | Chave gerada (ex: `ENCERRAR-58D0F5A7`) para encerramento          |
| `session.close_key_validated` | `post-tool-use.sh`                  | `true` quando close_key foi detectada em askQuestions             |
| `session.source`              | `session-start.sh`, `log-prompt.sh` | `"new"`, `"inline_restart"`, `"manual_recovery"`                  |

**`current_turn.*` — Estado do turno corrente:**

| Campo                                | Quem escreve          | Descrição                                          |
| ------------------------------------ | --------------------- | -------------------------------------------------- |
| `current_turn.number`                | `log-prompt.sh`       | Número sequencial global do turno na sessão        |
| `current_turn.section_turn`          | `log-prompt.sh`       | Número do turno dentro da seção atual              |
| `current_turn.started_at`            | `log-prompt.sh`       | Timestamp de início do turno                       |
| `current_turn.turn_id`               | `log-prompt.sh`       | UUID único do turno                                |
| `current_turn.intent`                | `start-turn.sh`       | Intenção declarada pelo agente via script          |
| `current_turn.intent_declared`       | `start-turn.sh`       | `true` se intenção foi declarada                   |
| `current_turn.auth_requested`        | `pre-tool-use.sh`     | `true` quando `vscode_askQuestions` foi invocado   |
| `current_turn.todo_created`          | `pre-tool-use.sh`     | `true` quando `manage_todo_list` foi invocado      |
| `current_turn.tools_count`           | `pre-tool-use.sh`     | Quantidade total de ferramentas invocadas no turno |
| `current_turn.tools_by_name`         | `pre-tool-use.sh`     | Map de `{nome_ferramenta: contagem}` no turno      |
| `current_turn.agentStop_invocations` | `agent-stop.sh`       | Quantas vezes agentStop invocado (anti-loop)       |
| `current_turn.block_count`           | `agent-stop.sh`       | Quantas vezes foi bloqueado neste turno            |
| `current_turn.failures_count`        | `tool-use-failure.sh` | Falhas de ferramenta neste turno                   |

**`current_section.*` — Estado da seção lógica atual (100% nosso conceito):**

| Campo                            | Quem escreve       | Descrição                                      |
| -------------------------------- | ------------------ | ---------------------------------------------- |
| `current_section.name`           | `start-section.sh` | Nome da seção (ex: `"hooks-doc-research"`)     |
| `current_section.section_id`     | `start-section.sh` | UUID único da seção                            |
| `current_section.section_number` | `start-section.sh` | Número sequencial da seção na sessão           |
| `current_section.started_at`     | `start-section.sh` | Timestamp de início da seção                   |
| `current_section.local_turn`     | múltiplos scripts  | Contador de turnos na seção (= `section_turn`) |

**`session_stats.*` — Métricas acumuladas da sessão:**

| Campo                        | Descrição                                                    |
| ---------------------------- | ------------------------------------------------------------ |
| `turn_count`                 | Total de turnos na sessão                                    |
| `turn_authorized`            | Turnos que chamaram vscode_askQuestions                      |
| `turn_unauthorized`          | Turnos BLOQUEADOS por não terminar com askQuestions          |
| `turn_no_askQuestions`       | Turnos que encerraram sem vscode_askQuestions                |
| `turns_since_askQuestions`   | Contador desde último askQuestions (para reminder periódico) |
| `tools_total`                | Total de invocações de ferramentas na sessão                 |
| `tools_by_name`              | Map global de `{nome: contagem}` de ferramentas              |
| `section_count`              | Total de SECTIONs criadas na sessão                          |
| `errors_total`               | Erro logado via `save-finding.sh`                            |
| `subagent_calls`             | Subagentes criados na sessão                                 |
| `push_count`                 | Git pushes realizados na sessão                              |
| `pending_section_after_push` | `true` após git push (pendente decidir nova seção)           |

**`compliance.*` — Conformidade com o protocolo:**

| Campo                      | Descrição                                    |
| -------------------------- | -------------------------------------------- |
| `consecutive_unauthorized` | Turnos CONSECUTIVOS sem askQuestions         |
| `last_turn_authorized`     | `true` se o último turno cumpriu o protocolo |
| `flag_file_exists`         | `true` se existe flag de violação em disco   |

---

## 13. FAQ — Perguntas Frequentes

> Perguntas P1–P21 cobrem comportamento geral da plataforma e do sistema de hooks. Perguntas P22–P26
> (adicionadas v1.2) cobrem **idle**, **askQuestions vs idle**, **taxonomia de contadores** e
> **variáveis internas** do VS Code.

### P1: Quando `sessionStart` dispara automaticamente?

**R**: `sessionStart` dispara **uma única vez** quando o usuário **abre uma nova conversa** no
Copilot Chat do VS Code. Uma nova conversa começa com o botão "+" (New Conversation) ou quando o VS
Code reinicia.

Não dispara para:

- Cada mensagem/turno na mesma conversa
- Respostas ao `vscode_askQuestions`
- Quando a conversa continua depois de uma pausa longa

### P2: `userPromptSubmitted` dispara quando o usuário responde ao `vscode_askQuestions`?

**R**: **Não**. Respostas ao `vscode_askQuestions` chegam via `postToolUse`, não via
`userPromptSubmitted`. Isso significa que em sessões onde o diálogo principal ocorre via
`vscode_askQuestions`, o hook `userPromptSubmitted` dispara raramente (apenas para mensagens
digitadas diretamente no chat box).

**Implicação**: As respostas dos usuários ao `vscode_askQuestions` são **tool results**
(`postToolUse`), não novos prompts. É por isso que `log-prompt.sh` (ligado a `userPromptSubmitted`)
tem lógica especial para lidar com sessões onde o principal canal de comunicação é
`vscode_askQuestions`.

### P3: `agentStop` dispara ao fechar o VS Code ou ao fim de cada turno?

**R**: Ao **fim de cada turno** do agente. O nome "agentStop" e a descrição oficial "Agent session
ends" são confusos — na prática, este evento dispara quando o agente termina de responder a um
prompt (inclusive após processar respostas de `vscode_askQuestions`).

`agentStop` é análogo ao "fim de cada turno", não ao "fim da sessão VS Code". Para o fim da sessão
VS Code, existe `sessionEnd` (mas com as limitações descritas abaixo).

### P4: `sessionEnd` é confiável?

**R**: **Não inteiramente**. `sessionEnd` dispara quando a conversa do Copilot Chat é fechada
normalmente. Mas **não dispara** em:

- Crashes do VS Code
- Reinicializações do DevContainer
- Timeouts de sessão
- Fechamento abrupto do terminal

Por isso, este repositório implementa `session-close.sh` como mecanismo de encerramento autorizado —
ele é o único mecanismo **confiável** de registro de encerramento intencional.

No audit.jsonl do repo, observe que os eventos `sessionEnd` têm timestamps em ms (1773139323000) —
formato unix epoch em milissegundos, diferente do formato ISO dos outros eventos. Isso indica que
foram disparados pela plataforma VS Code (não pelos scripts customizados).

### P5: O que é `postToolUseFailure`? Onde está documentado?

**R**: `postToolUseFailure` aparece no `copilot-hooks.json` mas **não está nos 8 eventos
oficialmente documentados**. É possivelmente um evento Preview ou Copilot CLI-específico que o VS
Code suporta mas não documenta explicitamente ainda. Funciona como `postToolUse` mas para
ferramentas que **falharam** (erro de execução). Mapeado em `tool-use-failure.sh`.

### P6: `vscode_askQuestions` é um hook ou uma ferramenta?

**R**: É uma **ferramenta do agente** (`tool call`), não um hook. O agente **invoca** essa
ferramenta explicitamente em seu código, e o VS Code renderiza o formulário para o usuário. Hooks
reagem **passivamente** a eventos da plataforma; ferramentas são **chamadas ativamente** pelo
agente.

Fluxo `vscode_askQuestions`:

```
1. Agente chama vscode_askQuestions → [PreToolUse] é disparado
2. VS Code exibe formulário ao usuário
3. Usuário responde → [PostToolUse] é disparado com a resposta
4. O agente recebe a resposta via tool_response
```

### P7: Por que a sessão continua depois do `sessionCloseAuthorized`?

**R**: Porque `session-close.sh` é um **script de registro** — ele loga que a sessão foi autorizada
a encerrar e marca o estado adequado, mas **não fecha a janela do VS Code**. A sessão Copilot
continua existindo até que:

1. O usuário feche a aba do chat (o que dispara `sessionEnd`)
2. O VS Code seja reiniciado

Após `sessionCloseAuthorized`, se o usuário continua interagindo, o próximo `userPromptSubmitted`
ativa o hook RECONNECT-02 que cria uma "sessão inline" automaticamente.

### P8: Respostas ao `vscode_askQuestions` iniciam uma nova SESSION?

**R**: **Não**. Elas continuam na mesma session_id. A sessão VS Code não muda. O que muda é que o
nosso `session-context.json` pode ser atualizado por `post-tool-use.sh` quando detecta a `close_key`
na resposta.

### P9: Existe algum hook que dispara para compressão de contexto?

**R**: Sim — `PreCompact` (`preCompact` no formato Copilot CLI). Dispara antes de o VS Code
compactar o histórico da conversa quando o contexto fica muito longo. O script `pre-compact.sh` é
chamado neste momento para salvar estado antes da compactação.

### P10: Como distinguir comportamento Copilot CLI antigo vs VS Code nativo?

**R**: O VS Code usa PascalCase (`PreToolUse`). O Copilot CLI usava lowerCamelCase (`preToolUse`). O
VS Code 1.93+ converte automaticamente o formato Copilot CLI para o formato nativo. O arquivo
`copilot-hooks.json` deste repositório usa formato Copilot CLI (com `bash:` em vez de `command:` e
`linux`/`osx`), que o VS Code parseia e converte.

Diferenças de nomes de ferramentas: Claude Code usa snake_case (`file_path`), VS Code usa camelCase
(`filePath`). Isso pode causar incompatibilidade em scripts que leem `tool_input`.

### P11: Como saber qual hook corresponde a qual arquivo de script?

**R**: Ver o arquivo [`.github/hooks/copilot-hooks.json`](.github/hooks/copilot-hooks.json). Cada
entrada lista o script correspondente. Para documentação de cada script, ver os comentários no
início de cada arquivo `*.sh` em `.github/hooks/scripts/`.

### P12: O `agentStop` pode ser usado para BLOQUEAR o agente?

**R**: Sim! Este repositório usa `agent-stop.sh` para emitir `decision:block` quando o agente
termina um turno sem ter chamado `vscode_askQuestions` (violação do protocolo). A saída JSON com
`decision:block` faz o VS Code mostrar a mensagem de bloqueio ao agente e pedir que ele retome a
ação.

### P13: O que acontece se o agente ignorar o bloqueio e tentar chamar `session-close.sh` diretamente?

**R**: O `pre-tool-use.sh` bloqueará a chamada ao `run_in_terminal session-close.sh` diretamente. O
`pre-tool-use.sh` verifica se `close_key_validated=true` antes de permitir a execução. O fluxo
correto é: `vscode_askQuestions` Template F → usuário digita a close_key → `post-tool-use.sh`
detecta e chama `session-close.sh` automaticamente.

---

### P14: Qual a diferença exata entre `agentStop` e `sessionEnd`?

**R**: São eventos completamente diferentes em frequência, confiabilidade e propósito:

| Critério       | `agentStop` (= `Stop`)                  | `sessionEnd`                               |
| -------------- | --------------------------------------- | ------------------------------------------ |
| Dispara quando | Fim de **cada turno** do agente         | Quando o chat panel fecha                  |
| Frequência     | 1 a dezenas de vezes por sessão         | Máximo 1x por sessão                       |
| Confiável?     | ✅ Sim — sempre dispara ao fim de turno | ❌ Não — falha em crashes/reinicializações |
| Uso neste repo | Bloqueio de turno, auditoria, métricas  | Cleanup final (quando funciona)            |

`agentStop` é para **audit dos turnos**. `sessionEnd` é para **cleanup de sessão** — mas por não ser
confiável, o repositório usa `session-close.sh` como alternativa controlada.

---

### P15: O que é exatamente `stop_hook_active` e por que existe?

**R**: `stop_hook_active` é um campo que o VS Code envia no input do hook `Stop`. Seu valor:

- **`false`**: Esta é a primeira vez que `Stop` dispara neste turno (comportamento normal)
- **`true`**: Este disparo de `Stop` é resultado de um bloqueio anterior (o hook emitiu
  `decision:block`, o agente continuou e agora terminou novamente)

O propósito é **prevenir loops infinitos**: se um hook `Stop` sempre bloquear, o agente continua
indefinidamente. Com `stop_hook_active=true`, o hook sabe que deve liberar o agente independente das
condições normais de bloqueio.

**Implicação de segurança**: Todo hook que implementa `decision:block` em `Stop` DEVE checar
`stop_hook_active=true` e nesse caso NUNCA bloquear.

---

### P16: O agente pode "terminar" voluntariamente sem escrever resposta?

**R**: Não. O ciclo de turno completo exige que o agente **escreva texto** antes do `agentStop`
disparar. O VS Code não dispara `Stop` enquanto o agente ainda está processando (fazendo tool
calls). `Stop` = o VS Code detectou que o agente parou de gerar saída.

---

### P17: `SubagentStart` e `SubagentStop` disparam para o mesmo agente pai?

**R**: Sim. Os hooks de subagente disparam no contexto do **agente pai** (mesma sessão, mesmo
`session_id`). A sequência REAL (descoberta empiricamente) é surpreendente:

1. `preToolUse` dispara (pai invocou `runSubagent`)
2. **`agentStop` dispara NO PAI** ← o pai "termina" antes do subagente iniciar
3. `SubagentStart` dispara
4. Subagente executa (com seus próprios `preToolUse`/`postToolUse`)
5. `SubagentStop` dispara
6. `postToolUse` dispara no pai (resultado do runSubagent retornou)
7. Pai pode fazer mais tool calls...
8. `agentStop` dispara novamente no pai (encerramento real do turno)

> Este fluxo exigiu HARDENING especial — ver **Seção 15.8** para detalhes completos. Audit.jsonl
> deste repositório: 6 invocações de `runSubagent` registradas, todas com o agente "Explore".

---

### P18: `PreCompact` pode ser usado para salvar estado antes de perder contexto?

**R**: Sim, e essa é exatamente a motivação do `pre-compact.sh` neste repositório. Quando
`preCompact` dispara:

1. O VS Code está prestes a compactar (truncar) o histórico da conversa
2. O `pre-compact.sh` executa `session-checkpoint.sh` para salvar o estado atual
3. Após a compactação, o agente perde memória do histórico antigo
4. Com o checkpoint salvo, o agente pode ler `session-context.json` e recuperar contexto

**Importante**: `preCompact` dá ao hook a oportunidade de reagir, mas NÃO pode cancelar a
compactação. É apenas `pre` (antes) — não há `postCompact` nos 8 eventos oficiais.

---

### P19: Múltiplos hooks para o mesmo evento — em qual ordem executam?

**R**: O VS Code executa os hooks de um evento **na ordem em que aparecem** no arquivo
`copilot-hooks.json`. No caso de múltiplos arquivos de configuração, a ordem é: workspace → usuário.

Para `PreToolUse` com múltiplos hooks:

- Todos executam em sequência
- O resultado mais restritivo de `permissionDecision` vence (deny > ask > allow)
- Se algum hook retornar `deny`, a ferramenta é bloqueada (os hooks seguintes ainda executam para
  logging, mas a decisão final é deny)

---

### P20: O que acontece se um hook demora mais do que o timeout?

**R**: O hook é **terminado pelo VS Code** após o timeout. O comportamento padrão é como se o hook
retornasse exit code 0 (sucesso sem output). O `timeoutSec` no `copilot-hooks.json` controla esse
limite por hook. Valores no repositório atual:

| Hook                  | Timeout | Motivo do valor                                        |
| --------------------- | ------- | ------------------------------------------------------ |
| `sessionStart`        | 15s     | Pode envolver git operations                           |
| `userPromptSubmitted` | 10s     | Operações de leitura de CTX + jq                       |
| `preToolUse`          | 15s     | Pode fazer lookup de CTX + validações                  |
| `postToolUse`         | 15s     | Pode detectar close_key + chamar session-close.sh      |
| `agentStop`           | 10s     | Auditoria de turno + geração de bloqueio se necessário |
| `sessionEnd`          | 60s     | Permite git push + relatório final de sessão           |

---

### P21: Um hook pode **modificar** a resposta do agente antes de exibi-la ao usuário?

**R**: **Não** — não há hook `PostResponse` ou similar. Hooks podem injetar **contexto** que
influencia o que o agente escreve (`additionalContext` em SessionStart ou PostToolUse), podem
**bloquear** o agente via Stop, e podem **modificar inputs de ferramentas** via `updatedInput` em
PreToolUse. Mas o texto final que o agente escreve ao usuário não é interceptável por hooks.

---

### P22: O que significa exatamente o agente ficar "idle"?

**R**: "Idle" significa que o agente **completou seu turno e não está mais processando** — o loop de
raciocínio+ferramentas terminou. Tecnicamente, o estado idle se inicia quando:

1. `agentStop` dispara e retorna sem `decision: "block"` (sem bloqueio)
2. O VS Code exibe a resposta final ao usuário na interface
3. Nenhum hook adicional dispara
4. O modelo de linguagem não está em execução
5. O sistema aguarda o próximo `userPromptSubmitted` para iniciar novo turno

**O que NÃO é idle**:

- Agente chamou `vscode_askQuestions` e aguarda a resposta → **turno ainda ativo**
- Agente chamou `run_in_terminal` com comando longo → **turno ainda ativo**
- Agente processando erro de ferramenta → **turno ainda ativo**

A distinção é: enquanto `agentStop` **não disparou**, o agente está ativo. Após disparar (sem
block), o agente está idle. É uma transição binária — não há estados intermediários de "parcialmente
idle" na plataforma VS Code.

---

### P23: Enquanto aguarda resposta do `vscode_askQuestions`, o agente está "idle"?

**R**: **Não**. Isso é uma confusão frequente — `vscode_askQuestions` é uma **tool call** como
qualquer outra. O fluxo completo é:

```
Agente decide chamar vscode_askQuestions
    ↓
preToolUse dispara (tool_name = "vscode_askQuestions")
    ↓
VS Code exibe a question ao usuário na sidebar
    ↓
[usuário lê a pergunta e responde — pode levar minutos]
    ↓
postToolUse dispara (tool_response = resposta do usuário)
    ↓
Agente recebe a resposta e pode invocar MAIS ferramentas...
    ↓
[somente quando o agente terminar completamente...]
    ↓
agentStop dispara → AGORA SIM o agente está idle
```

**Implicações práticas**:

- `userPromptSubmitted` NÃO dispara quando o usuário responde ao `vscode_askQuestions`
- A resposta do usuário chega via `postToolUse` (campo `tool_response`)
- O `pre-tool-use.sh` detecta `vscode_askQuestions` e seta `auth_requested=true` no CTX
- O `post-tool-use.sh` lê a `tool_response` para detectar `close_key` se presente
- Toda sessão dirigida por `vscode_askQuestions` tem POUCOS `userPromptSubmitted` e MUITOS
  `postToolUse` com `tool_name = "vscode_askQuestions"`

**Em audit.jsonl**: Respostas ao askQuestions aparecem como evento `askQuestions_response`, não como
`turnStart`. O counter `session_stats.turn_count` NÃO é incrementado quando o usuário responde ao
askQuestions — apenas quando um novo prompt é digitado no chat box.

---

### P24: Quais contadores são automáticos do VS Code e quais são criados pelo projeto?

**R**: Esta é uma distinção fundamental:

**Contadores NATIVOS do VS Code** (READ-ONLY — enviados pela plataforma em cada hook input):

| Campo         | Tipo   | O que conta/identifica                              |
| ------------- | ------ | --------------------------------------------------- |
| `session_id`  | string | UUID único da sessão do chat panel (imutável)       |
| `tool_use_id` | string | ID único de cada invocação individual de ferramenta |
| `timestamp`   | string | Timestamp ISO de cada evento de hook                |

> **Nota**: O VS Code não fornece counters numéricos nativos. Apenas identificadores (UUIDs). Todos
> os contagens (turno N, ferramenta X do turno Y, etc.) são calculadas por NÓS.

**Contadores CRIADOS PELO PROJETO** (calculados pelos scripts, persistidos em session-context.json):

| Campo                                    | Script responsável  | O que conta                                    |
| ---------------------------------------- | ------------------- | ---------------------------------------------- |
| `session_stats.turn_count`               | `agent-stop.sh`     | Total de turnos na sessão                      |
| `session_stats.turn_authorized`          | `agent-stop.sh`     | Turnos que chamaram vscode_askQuestions        |
| `session_stats.turn_unauthorized`        | `agent-stop.sh`     | Turnos bloqueados por ausência de askQuestions |
| `session_stats.turn_no_askQuestions`     | `agent-stop.sh`     | Turnos sem askQuestions (incluindo primeiros)  |
| `session_stats.turns_since_askQuestions` | `agent-stop.sh`     | Contador desde último askQuestions             |
| `session_stats.tools_total`              | `pre-tool-use.sh`   | Total de ferramentas invocadas na sessão       |
| `session_stats.subagent_calls`           | `subagent-start.sh` | Total de subagentes criados                    |
| `session_stats.push_count`               | `on-git-push.sh`    | Total de git pushes na sessão                  |
| `current_turn.tools_count`               | `pre-tool-use.sh`   | Ferramentas invocadas no turno atual           |
| `current_turn.block_count`               | `agent-stop.sh`     | Bloqueios do turno atual                       |
| `current_turn.agentStop_invocations`     | `agent-stop.sh`     | Invocações do agentStop no turno atual         |
| `compliance.consecutive_unauthorized`    | `agent-stop.sh`     | Turnos consecutivos sem askQuestions           |
| `current_section.local_turn`             | múltiplos scripts   | Turnos dentro da seção atual                   |

**Como usar os contadores nos scripts**:

```bash
# Ler turn_count atual
turn_count=$(jq '.session_stats.turn_count // 0' "$CTX_FILE")

# Verificar se já é hora de lembrete periódico
turns_since=$(jq '.session_stats.turns_since_askQuestions // 0' "$CTX_FILE")
if ((turns_since >= 3)); then
  # Injetar reminder via systemMessage
fi

# Incrementar contador (ex: tools_total)
jq '.session_stats.tools_total = (.session_stats.tools_total // 0) + 1' \
  "$CTX_FILE" | sponge "$CTX_FILE"
```

---

### P25: O que é `transcript_path` e como podemos usá-lo?

**R**: `transcript_path` é o caminho para o arquivo JSON com **todo o histórico da conversa atual**
— mensagens do usuário, respostas do agente, chamadas de ferramentas e resultados. O VS Code envia
este caminho em todos os hook inputs (desde a v1.x do Copilot Chat).

**Formato típico**:

```
/home/usuario/.config/Code/User/globalStorage/github.copilot-chat/transcript-<UUID>.json
```

**Para que serve**:

- Análise offline do histórico completo de uma sessão
- Detecção de padrões de uso (quantas vezes o agente invocou uma ferramenta X)
- Auditoria de conformidade (o que o agente disse em determinado turn)
- Debug de sessões: ver o contexto completo que o agente tinha

**Limitação**: O arquivo é criado e gerenciado pelo VS Code. Nossos hooks recebem apenas o caminho —
não podem modificar nem deletar o arquivo durante a sessão.

**Uso no projeto**: `transcript_path` é capturado em `pre-tool-use.sh` e `post-tool-use.sh` mas
atualmente não é lido pelos scripts (apenas disponível se necessário). A lógica de auditoria do
repositório usa `audit.jsonl` (nosso próprio log) em vez do transcript nativo.

---

### P26: Por que `session_id` do VS Code e `session.id` no CTX podem ser diferentes?

**R**: Quando o projeto cria uma **sessão inline_restart** (`source: "inline_restart"`), um novo
UUID é gerado e salvo em `session-context.json` como `session.id`. Porém o VS Code continua usando o
mesmo `session_id` original em todos os hooks posteriores. Resultado:

```
VS Code envia nos hooks → session_id: "66abca9d-8655-4060-84b7-a1a3079c476d" (imutável)
Nosso CTX tem           → session.id: "9f2b341e-cccc-7777-bbbb-999999999999" (inline_restart)
```

Esta divergência é **intencional**: a sessão VS Code não terminou de verdade — apenas criamos um
marco lógico de reinício. O campo `prev_session_id` no CTX guarda o ID anterior.

A lógica de "heal" em `log-prompt.sh` detecta quando o `session_id` do VS Code não bate com nenhum
ID esperado, e pode realizar ações de recuperação (ex: logar `session_id_mismatch` e adotar o
`session_id` como referência para o próximo ciclo).

**Regra de ouro**: `session_id` (VS Code) = identidade REAL da sessão de hardware. `session.id`
(nosso CTX) = identidade LÓGICA/administrativa que nós contramos.

---

## 14. Bugs Conhecidos e Limitações da Plataforma

### LIM-01 — `sessionEnd` não dispara em encerramento abrupto

**Impacto**: Não há sinal automático de que a sessão terminou por crash/restart. **Mitigação**:
`session-close.sh` (encerramento autorizado manual) + `session-context.json` com
`end_reason=authorized_close` + `watchdog.sh` detecta estados inconsistentes.

### LIM-02 — `sessionStart` não dispara após close-and-continue

**Impacto**: Após `sessionCloseAuthorized`, a sessão VS Code continua. O próximo prompt do usuário
não dispara `sessionStart` — dispara apenas `userPromptSubmitted`. **Mitigação**: RECONNECT-02 em
`log-prompt.sh` detecta `ended_at != null` e cria sessão inline.

### LIM-03 — `userPromptSubmitted` não dispara para respostas de `vscode_askQuestions`

**Impacto**: Em sessões dirigidas por `vscode_askQuestions`, o counter de prompts e os resets de
estado dependentes de `userPromptSubmitted` podem não funcionar como esperado. **Mitigação**: A
lógica de reset de estado foi movida para `log-prompt.sh` (que é chamado por
`userPromptSubmitted`) + `post-tool-use.sh` atualiza metadados após cada tool call.

### LIM-04 — `sessionEnd` timestamps em Unix ms (bug de formato)

**Observação**: Os dois primeiros `sessionEnd` no audit.jsonl têm timestamps em unix epoch ms
(`1773139323000`) em vez de ISO 8601. Isso indica que a plataforma VS Code passa o timestamp em ms,
mas nosso script espera ISO — a conversão falha silenciosamente. **Status**: Bug a corrigir em
`session-end.sh`.

### LIM-05 — Duplo disparo de hooks em edge cases

**Observação**: BUG-PC-03 demonstrou que o mesmo hook pode disparar múltiplas vezes se o usuário
repete uma ação (enviar close_key duas vezes). Hooks devem sempre ter guards de idempotência para
operações com efeitos colaterais.

---

---

## 15. Subagentes em Profundidade — Ciclo de Vida Completo

Esta seção detalha o que acontece quando o agente pai invoca `runSubagent`: quais hooks disparam, em
que ordem, quais campos são enviados pelo VS Code, e como o projeto rastreia tudo isso.

### 15.1 O que é um subagente no VS Code Copilot?

Um **subagente** é uma instância separada do LLM, criada pelo agente pai para executar uma tarefa
específica de forma isolada. O agente pai usa a ferramenta `runSubagent` para criar o subagente,
passando um prompt e opcionalmente um nome de agente especializado.

**Características**:

- Executa no mesmo chat panel → mesmo `session_id` do VS Code (não há nova sessão)
- Recebe um **prompt fresco** — não tem acesso à memória/contexto do turno pai
- Pode usar ferramentas do VS Code (preToolUse/postToolUse disparam normalmente)
- O pai fica **bloqueado** (aguardando resultado) enquanto o subagente executa
- Os hooks `SubagentStart` e `SubagentStop` fornecem visibilidade ao repositório

### 15.2 Sequência exata de eventos ao chamar `runSubagent`

```
Agente pai chama runSubagent({agentName, description, prompt})
    ↓
preToolUse dispara no pai (tool_name = "runSubagent")
  → pre-tool-use.sh detecta runSubagent
  → seta auth_requested=true, subagent_delegated=true no CTX
  → incrementa session_stats.subagent_calls
  → loga evento "subagentStart" no audit.jsonl (com tool_use_id e description)
    ↓
agentStop dispara no PAI (!)
  → agent-stop.sh verifica subagent_delegated=true
  → auth_requested já = true → NÃO bloqueia (evita falso UNAUTHORIZED)
  → loga "auth_via_subagent_delegation"
  → pai entra em "idle" temporário aguardando subagente
    ↓
VS Code cria instância do subagente
SubagentStart dispara (no contexto do pai)
  → subagent-start.sh recebe: {session_id, timestamp, tool_use_id}
  → incrementa session_stats.subagent_calls (segundo incremento — redundância)
    ↓
Subagente executa seu trabalho:
  - Ferramentas do subagente → preToolUse/postToolUse disparam normalmente
  - Os hooks se aplicam ao subagente TAMBÉM (mesma copilot-hooks.json)
  - Cada ferramenta do subagente tem seu próprio tool_use_id único
  ↓
Subagente termina e retorna resultado ao pai
SubagentStop dispara (no contexto do pai)
  → subagent-stop.sh recebe: {session_id, timestamp} (+ campos opcionais que podem ser null)
  → loga evento "subagentStop" com duração aproximada
    ↓
postToolUse dispara no pai (resultado de runSubagent = output do subagente)
    ↓
Agente pai processa resultado e pode chamar mais ferramentas
    ↓
Agente pai termina → agentStop dispara novamente
  (auth_requested=true do runSubagent ainda está ativo → sem bloqueio duplo)
```

### 15.3 `session_id` no contexto de subagentes — o que foi confirmado empiricamente

| Evento                     | `session_id` observado                   | Quem envia     |
| -------------------------- | ---------------------------------------- | -------------- |
| `preToolUse` (runSubagent) | Mesmo da sessão pai                      | VS Code nativo |
| `SubagentStart`            | Mesmo da sessão pai                      | VS Code nativo |
| Ferramentas do subagente   | Mesmo da sessão pai                      | VS Code nativo |
| `SubagentStop`             | Mesmo da sessão pai (quando CTX correto) | VS Code nativo |

**Conclusão**: O subagente usa o **mesmo `session_id`** do agente pai. Não há nova sessão VS Code —
é a mesma sessão de chat panel. A instância do LLM é diferente (prompt fresco), mas a identidade de
sessão é compartilhada.

### 15.4 Campos nativos enviados pelo VS Code em SubagentStart e SubagentStop

**SubagentStart** (confirmado via audit.jsonl e pre-tool-use.sh):

| Campo           | Tipo   | Enviado nativamente? | Observação                                     |
| --------------- | ------ | -------------------- | ---------------------------------------------- |
| `session_id`    | string | ✅ Sim               | Mesmo session_id da sessão pai                 |
| `timestamp`     | string | ✅ Sim               | ISO 8601 do evento                             |
| `tool_use_id`   | string | ✅ Sim               | Mesmo tool_use_id do preToolUse do runSubagent |
| `hookEventName` | string | ✅ Sim               | `"SubagentStart"`                              |
| Outros campos   | —      | ❓ Não documentado   | Schema não publishado na doc oficial           |

**SubagentStop** (confirmado via audit.jsonl — todos os campos extras eram null):

| Campo         | Tipo    | Enviado nativamente? | Observação                                          |
| ------------- | ------- | -------------------- | --------------------------------------------------- |
| `session_id`  | string  | ✅ Sim               | Mesmo session_id da sessão pai                      |
| `timestamp`   | string  | ✅ Sim               | ISO 8601 do evento (pode ser epoch ms — ver LIM-04) |
| `agentName`   | string? | ❓ Incerto           | `null` em todos os casos observados                 |
| `result`      | string? | ❓ Incerto           | `null` em todos os casos observados                 |
| `tool_use_id` | string? | ❓ Incerto           | `null` em todos os casos observados                 |

> A documentação oficial VS Code **não publica** o schema de SubagentStart/SubagentStop. O
> `subagent-stop.sh` usa leitura defensiva com múltiplos fallbacks de nomes de campo.

### 15.5 A ferramenta `runSubagent` — parâmetros do agente pai

O agente usa `runSubagent` como qualquer outra ferramenta. O input JSON (visible em `preToolUse`)
tem o seguinte schema:

```json
{
  "agentName": "Explore", // opcional — nome de agente especializado
  "description": "Revisão de código...", // curta descrição da tarefa (aparece em SubagentStart)
  "prompt": "Você é um revisor..." // prompt completo para o subagente (pode ser longo)
}
```

**Agentes disponíveis** (incluem os listados no `copilot-instructions.md`):

- `"Explore"` — leitura e análise somente de codebase (sem modificações)
- `"Plan"` — exploração e planejamento arquitetural
- Outros conforme registrados no workspace

O `prompt` é o único meio de comunicação pai→subagente. Não há compartilhamento de memória,
variáveis de contexto, ou estado de ferramentas entre pai e filho.

### 15.6 Variáveis criadas/modificadas quando um subagente é chamado

Todas estas modificações acontecem no `session-context.json` do **agente pai**:

| Campo CTX                                 | Valor após runSubagent                            | Quem modifica     |
| ----------------------------------------- | ------------------------------------------------- | ----------------- |
| `current_turn.auth_requested`             | `true`                                            | `pre-tool-use.sh` |
| `current_turn.auth_requested_at`          | timestamp do preToolUse                           | `pre-tool-use.sh` |
| `current_turn.subagent_delegated`         | `true`                                            | `pre-tool-use.sh` |
| `current_turn.subagent_description`       | primeiros 200 chars do desc                       | `pre-tool-use.sh` |
| `current_turn.tools_count`                | +1 (runSubagent conta como tool)                  | `pre-tool-use.sh` |
| `current_turn.tools_by_name.runSubagent`  | +1                                                | `pre-tool-use.sh` |
| `session_stats.subagent_calls`            | +1 (em pre-tool-use.sh) +1 (em subagent-start.sh) | ambos             |
| `session_stats.tools_total`               | +1                                                | `pre-tool-use.sh` |
| `session_stats.tools_by_name.runSubagent` | +1                                                | `pre-tool-use.sh` |
| `last_tool.name`                          | `"runSubagent"`                                   | `pre-tool-use.sh` |

> **Atenção**: `session_stats.subagent_calls` é incrementado **DUAS VEZES** por subagente: uma em
> `pre-tool-use.sh` (ao detectar `runSubagent`) e outra em `subagent-start.sh` (ao processar o
> evento `SubagentStart`). Isso é uma redundância/bug de contagem dupla.

### 15.7 Os hooks do subagente — o subagente tem seus próprios hooks?

**Sim**. O subagente executa no mesmo ambiente VS Code e as mesmas configurações de hooks se
aplicam. Portanto, as ferramentas do subagente também disparam `preToolUse` e `postToolUse`.

**Consequência importante**: Um turno do tipo "pai invoca subagente que faz 10 tool calls" gera:

- 10 × `preToolUse` (no contexto do subagente)
- 10 × `postToolUse` (no contexto do subagente)
- Cada um incrementa `current_turn.tools_count` e `session_stats.tools_total` no CTX

**Isso pode levar a contagens infladas no `session-context.json`** — sem distinção entre ferramentas
do pai e ferramentas do subagente no turno.

### 15.8 O problema do `agentStop` do pai antes do subagente iniciar

Esta é a descoberta mais crítica no estudo de subagentes:

**O VS Code dispara `agentStop` para o agente PAI antes do subagente iniciar.**

Isso significa: quando o pai chama `runSubagent`, o sistema considera que o PAI terminou seu
processamento (agentStop). Mas o subagente ainda não começou.

Sem tratamento especial, `agent-stop.sh` veria:

- `auth_requested=false` (askQuestions não foi chamado)
- Decidiria: `decision: "block"` ← FALSO POSITIVO

A solução implementada (HARDENING `runSubagent`):

1. `pre-tool-use.sh` detecta `tool_name = "runSubagent"`
2. Seta `auth_requested=true` E `subagent_delegated=true` no CTX
3. Loga evento `subagentStart` no audit.jsonl (para o caso de race condition no CTX)
4. `agent-stop.sh` checa `subagent_delegated=true` → marca `AUTH_REQUESTED=true`
5. Loga `auth_via_subagent_delegation` em vez de `turnEnd_no_askQuestions`

### 15.9 Quando múltiplos subagentes são chamados na mesma sessão

Cada chamada a `runSubagent` é independente. Não há hierarquia de pai/filho persistente. Cada
subagente:

- Recebe o mesmo `session_id` da sessão VS Code
- Incrementa `session_stats.subagent_calls` (mas con double-counting, ver 16.6)
- `current_turn.subagent_delegated` é resetado a cada novo turno (via `log-prompt.sh`)
- Um subagente NÃO pode chamar outro subagente e ter isso rastreado com hierarquia pelo projeto

**Em audit.jsonl**: cada `subagentStart/Stop` tem seu próprio `tool_use_id`, permitindo
correlacionar pai (preToolUse do runSubagent) com a execução do subagente.

### 15.10 `search_subagent` — a segunda ferramenta interna de subagente

O VS Code Copilot expõe **duas** ferramentas de subagente, não apenas uma:

| Ferramenta        | Finalidade provável                             | Tratamento interno         |
| ----------------- | ----------------------------------------------- | -------------------------- |
| `runSubagent`     | Propósito geral: análise, revisão, planejamento | Idêntico a search_subagent |
| `search_subagent` | Busca focada: web, GitHub, código externo       | Idêntico a runSubagent     |

**Evidência no código** da extensão (versão 0.39.0):

```javascript
// extension.js (minificado)
m = t.name === 'runSubagent' || t.name === 'search_subagent';
```

Ambas são tratadas como subagentes equivalentes no rastreamento de ciclo de vida.

**Nos hooks deste repositório**: apenas `runSubagent` é detectado explicitamente em
`pre-tool-use.sh`. Se `search_subagent` for chamada, o guard de autorização **pode não** disparar
automaticamente. Isso é um gap potencial a corrigir.

**Nas constantes do código**:

```javascript
z.CoreRunSubagent = 'runSubagent';
z.SearchSubagent = 'search_subagent';
z.SwitchAgent = 'switch_agent'; // também é "subagent-like"
```

### 15.11 Seleção de modelo — o agente pai NÃO tem controle direto

**Resposta direta**: O agente pai **não pode escolher o modelo** ao chamar `runSubagent`. Não existe
um campo `model` no schema da ferramenta. A seleção de modelo é responsabilidade exclusiva da
infraestrutura do VS Code Copilot.

**Como o modelo do subagente `Explore` é determinado** (código confirmado da extensão):

```text
Prioridade (maior para menor):
1. VS Code setting: chat.exploreAgent.defaultModel  (non-extension config)
2. VS Code setting: chat.exploreAgent.model          (G.ExploreAgentModel)
3. Default padrão global:
   ["Claude Haiku 4.5 (copilot)",
    "Gemini 3 Flash (Preview) (copilot)",
    "Auto (copilot)"]
```

O valor padrão (`$si` na extensão) é um **array de 3 modelos**, não um único. Quando o modelo é um
array, o VS Code escolhe qual usar automaticamente (provavelmente o primeiro disponível). O
`"Auto (copilot)"` indica seleção automática pela plataforma.

**Como identificar o backend inferido pelo prefixo do `tool_use_id`**:

| Prefixo         | Backend                            | Modelo provável       |
| --------------- | ---------------------------------- | --------------------- |
| `toolu_bdrk_`   | Amazon Bedrock                     | Claude (all versions) |
| `toolu_vrtx_`   | Google Vertex AI                   | Claude (all versions) |
| Outros formatos | OpenAI API ou endpoint customizado | GPT ou modelo local   |

Esta informação é **inferida** do prefixo nos `tool_use_id` observados no audit.jsonl — não é um
campo explícito enviado pelos hooks.

**Para customizar o modelo do agente Explore** (via `.vscode/settings.json`):

```json
{
  "chat.exploreAgent.model": "Claude Sonnet 4.5 (copilot)"
}
```

### 15.12 Ferramentas disponíveis ao subagente Explore — conjunto `zK`

O agente `Explore` é **read-only por design**. Seu conjunto de ferramentas é fixo no código da
extensão como a variável `zK`:

```javascript
zK = [
  'search', // grep/file_search/semantic_search
  'read', // read_file, list_dir
  'web', // fetch_webpage
  'vscode/memory', // memory tool (leitura de /memories/)
  'github/issue_read', // leitura de issues GitHub
  'github.vscode-pull-request-github/issue_fetch',
  'github.vscode-pull-request-github/activePullRequest',
  'execute/getTerminalOutput', // ler output de terminal já aberto
  'execute/testFailure', // informação sobre falhas de teste
];
```

**O subagente Explore NÃO tem acesso a**:

- `create_file`, `replace_string_in_file`, `multi_replace_string_in_file` — sem escrita
- `run_in_terminal` — sem execução de comandos
- `runSubagent` — sem delegar para outro subagente (sem recursão)
- `vscode_askQuestions` — sem interação com o usuário
- `manage_todo_list` — sem criação de TODOs

> **Implicação**: O agente `Explore` só pode **ler e reportar**, nunca modificar. É seguro para
> paralelização massiva sem risco de efeitos colaterais.

### 15.13 Arquitetura interna do agente Explore — como é gerado

O agente `Explore` não é definido em um arquivo `.agent.md` estático. Ele é **gerado dinamicamente**
em tempo de execução pela classe `yB` na extensão:

```text
yB._buildCustomizedConfig()
  → mescla config base (qsi) + body dinâmico + modelo configurado
  → gera string YAML via função e9(config)
  → escreve arquivo temporário em:
     <extensionGlobalStorage>/explore-agent/Explore.agent.md (ou similar)
  → VS Code lê esse arquivo para registrar o agente
```

O **prompt do sistema** (body) do agente Explore é:

```
You are an exploration agent specialized in rapid codebase analysis and answering questions.

## Search Strategy
- Go broad to narrow:
  1. glob patterns or semantic codesearch to discover relevant areas
  2. regex or LSP for specific symbols
  3. read files only when you know the path

## Speed Principles
- Bias for speed — return findings as quickly as possible
- Parallelize independent tool calls
- Stop searching once you have sufficient context
- Make targeted searches, not exhaustive sweeps

## Output
- Files with absolute links
- Specific functions, types, or patterns that can be reused
- Clear answers to what was asked, not comprehensive overviews
Remember: Maximum parallelism + concise answers.
```

Outros agentes nativos identificados na extensão:

| Agente  | `disableModelInvocation` | `agents` (pode delegar) | Propósito                   |
| ------- | ------------------------ | ----------------------- | --------------------------- |
| Explore | ❌ (usa LLM)             | `[]`                    | Exploração rápida read-only |
| Plan    | ✅ (NÃO usa LLM próprio) | `["Explore"]`           | Planejamento arquitetural   |

> O campo `disableModelInvocation: true` do agente `Plan` é incomum — sugere que ele pode ser usado
> como roteador/orquestrador que delega inteiramente ao `Explore`.

### 15.14 Agentes disponíveis ao `runSubagent` — tipos e origens

Existem três origens de agentes que podem ser passados em `agentName`:

| Origem               | Exemplo `agentName`          | Onde é definido                        | `userInvocable` |
| -------------------- | ---------------------------- | -------------------------------------- | --------------- |
| **Nativo VS Code**   | `"Explore"`, `"Plan"`        | Hardcoded na extensão Copilot          | `false`         |
| **Workspace custom** | qualquer nome em `.agent.md` | `.github/agents/*.json` ou `.agent.md` | dependente      |
| **Sem agentName**    | omitido                      | Usa o agente padrão (igual ao pai)     | N/A             |

**Agento customizado neste repositório** (`.github/agents/audit-agent.json`):

```json
{
  "schema": "https://aka.ms/copilot-agent-schema/v1",
  "name": "Audit Skill Agent",
  "description": "Agente para invocar skills de auditoria.",
  "instructions": ["...foco em auditoria...", "...pt-BR..."],
  "tools": [{ "name": "workspaceFiles", "type": "fileSystem", ... }]
}
```

> **Atenção**: O schema `.github/agents/*.json` usa o formato
> `https://aka.ms/copilot-agent-schema/v1` — diferente do formato `.agent.md` da extensão. Estes são
> dois mecanismos distintos de definir agentes customizados.

### 15.15 Schema da ferramenta `runSubagent` — referência completa

```json
{
  "name": "runSubagent",
  "description": "Launch a new agent to handle complex, multi-step tasks autonomously.",
  "parameters": {
    "agentName": {
      "type": "string",
      "required": false,
      "description": "Optional name of a specific agent to invoke. If not provided, uses the current agent.",
      "knownValues": ["Explore", "Plan"]
    },
    "description": {
      "type": "string",
      "required": true,
      "description": "A short (3-5 word) description of the task. Shown in VS Code UI and logs."
    },
    "prompt": {
      "type": "string",
      "required": true,
      "description": "A detailed description of the task for the agent to perform. Can be thousands of chars."
    }
  },
  "notInSchema": ["model", "tools", "maxTokens", "temperature"]
}
```

**Campos AUSENTES intencionalmente**: não é possível especificar modelo, ferramentas disponíveis,
temperatura ou qualquer parâmetro de inferência através da tool. Esses controles são exclusivos da
infraestrutura VS Code Copilot.

**Comportamento por campo**:

| Campo         | Se omitido / vazio           | Se presente                              |
| ------------- | ---------------------------- | ---------------------------------------- |
| `agentName`   | Usa agente padrão (tipo pai) | Invoca agente nomeado específico         |
| `description` | (obrigatório)                | Aparece em SubagentStart summary e logs  |
| `prompt`      | (obrigatório)                | É o único canal de comunicação pai→filho |

### 15.16 Comunicação pai→filho: o `prompt` como único canal

O `prompt` é **a única forma** do agente pai comunicar ao subagente. Não há:

- Variáveis compartilhadas
- Injeção de contexto automático do pai
- Acesso ao histórico de conversa do pai
- Compartilhamento de `session-context.json`

**Boas práticas de prompt para subagentes**:

1. **Auto-suficiente**: incluir todo contexto necessário no `prompt`
2. **Escopo claro**: delimitar exatamente o que o subagente deve retornar
3. **Sem suposições**: não presumir que o subagente "já sabe" algo do contexto do pai
4. **Formato de saída**: especificar se estruturado (JSON, tabela, lista) ou livre

**O que injetar no `prompt`** para subagentes de exploração:

```
- Contexto: "Estamos trabalhando na feature X do módulo Y"
- Escopo exato: "Analisar apenas os arquivos em src/kernel/"
- Output esperado: "Retorne uma lista de todas as funções exportadas com JSDoc"
- Nível de detalhe: "thorough" / "medium" / "quick" (para agente Explore)
```

---

## 16. Ferramentas Internas Críticas — `vscode_askQuestions` e `manage_todo_list`

> Esta seção documenta o schema exato das duas ferramentas mais críticas do sistema: a responsável
> por toda a comunicação de autorização com o usuário (`vscode_askQuestions`) e a responsável pelo
> rastreamento de tarefas (`manage_todo_list`). Os dados foram extraídos diretamente do código-fonte
> minificado do `github.copilot-chat-0.39.0/dist/extension.js` (~19,6 MB, março/2026).

---

### 16.1 `vscode_askQuestions` — papel no sistema de autorização

`vscode_askQuestions` é uma ferramenta da categoria **"VS Code Interaction"** (`A7` object na
extensão). É o **único canal confiável de comunicação bidirecional** entre agente e usuário — toda
autorização explícita do sistema de hooks (Templates A–G) passa por esta ferramenta.

| **Categorias de ferramentas** extraídas de `extension.js` (`A7` object): | Ferramenta | Categoria
| | ------------------------------------------------------------------------ | ---------- ||
`manage_todo_list` | Core | | `vscode_askQuestions` | VS Code Interaction | | `runSubagent` | Core |
| `search_subagent` | Core |

**Contexto de uso**: Agentes da categoria `AskAgent` e `PlanAgent` incluem explicitamente
`vscode/askQuestions` no array de ferramentas via `_buildCustomizedConfig()`. O `hook agent-stop.sh`
verifica se `vscode_askQuestions` foi chamada no turno — a ausência gera `decision:block`.

---

### 16.2 Schema de input — o que o agente envia

Quando o agente chama `vscode_askQuestions`, o input é o parâmetro `questions` (array):

```json
[
  {
    "header": "string ≤50 chars", // OBRIGATÓRIO — serve como CHAVE no response
    "question": "string ≤200 chars", // OBRIGATÓRIO — texto exibido ao usuário
    "allowFreeformInput": true, // OPCIONAL — habilita campo de texto livre
    "multiSelect": true, // OPCIONAL — permite múltiplas seleções
    "options": [
      // OPCIONAL — lista de opções clicáveis
      {
        "label": "string", // OBRIGATÓRIO no item
        "description": "string", // OPCIONAL — subtítulo da opção
        "recommended": true // OPCIONAL — marca como sugestão padrão
      }
    ]
  }
]
```

#### Tabela de restrições (hardening v1.9)

| Campo                | Tipo   | Obrig. | Limite      | Falha se violado                              |
| -------------------- | ------ | ------ | ----------- | --------------------------------------------- |
| `header`             | string | ✅     | **≤50 ch**  | `FAILED: Response contained no choices`       |
| `question`           | string | ✅     | **≤200 ch** | Falha silenciosa — resposta vazia ou truncada |
| `allowFreeformInput` | bool   | ❌     | —           | —                                             |
| `multiSelect`        | bool   | ❌     | —           | —                                             |
| `options`            | array  | ❌     | —           | Sem opções = apenas campo livre               |
| `options[].label`    | string | ✅\*   | —           | \* obrigatório dentro de options              |

#### Anti-padrões proibidos

```json
// ❌ ERRADO — schema antigo, campos não reconhecidos pela API:
[{ "id": "x", "prompt": "...", "type": "selectOne", "options": ["string1", "string2"] }]

// ❌ ERRADO — header > 50 chars (causa "Response contained no choices"):
[{ "header": "Este cabeçalho tem mais de cinquenta caracteres e quebra a API",
   "question": "...", "options": [...] }]

// ❌ ERRADO — question > 200 chars (causa falha silenciosa):
[{ "header": "OK", "question": "Esta pergunta tem um texto muito longo que excede o limite de duzentos caracteres estabelecido pelo schema da ferramenta vscode_askQuestions, causando falha silenciosa na API do Copilot VS Code...", "options": [...] }]

// ❌ ERRADO — options como strings planas:
[{ "header": "OK", "question": "OK?", "options": ["Opção A", "Opção B"] }]

// ✅ CORRETO:
[{ "header": "Próxima ação",
   "question": "✅ Concluí: Hardening do schema. O que fazer agora?",
   "allowFreeformInput": true,
   "options": [{ "label": "Próxima tarefa", "recommended": true }, { "label": "Commit e push" }] }]
```

> **Atenção ao nome do campo**: Internamente o código usa `allowFreeform`, mas o campo enviado à
> ferramenta é `allowFreeformInput`. O mapeamento ocorre em:
>
> ```javascript
> // Dentro de askUserQuestion():
> allowFreeformInput: e.allowFreeform,   // <-- tradução do nome do campo
> options: e.choices?.map(u => ({label: u}))
> ```

**Múltiplas perguntas**: o array `questions` pode conter N perguntas — cada uma com seu próprio
`header`, `options` e `allowFreeformInput`. Cada pergunta gera uma entrada separada no response.

**Verificação de tamanho antes de invocar** (quando `question` contém placeholders que serão
substituídos por dados reais):

```bash
# Contar chars da question com valores reais (deve ser ≤200):
echo -n "✅ Concluí: Atualizar GUIA. Hardenings 1-4 e schema. O que fazer agora?" | wc -m
# Contar chars do header (deve ser ≤50):
echo -n "Próxima ação" | wc -m
```

---

### 16.3 Schema de response — o que o agente recebe

A resposta retornada pelo `invokeTool("vscode_askQuestions", ...)` é uma **string JSON** que deve
ser parseada: `JSON.parse(s.value)`. Estrutura parseada:

```json
{
  "answers": {
    "[valor do header]": {
      "selected": ["string"], // Array com os labels das opções selecionadas
      "freeText": "string", // Presente se allowFreeformInput=true e usuário digitou algo
      "skipped": true // true se o usuário cancelou/dispensou sem responder
    }
  }
}
```

**Lookup**: a chave em `answers` é exatamente o valor do campo `header` da pergunta enviada:

```javascript
let c = JSON.parse(s.value);
// Header "Modo da sessão" → c.answers["Modo da sessão"].selected[0]
let l = c.answers[question.header]; // header === chave de lookup no response
if (l?.freeText) return { answer: l.freeText, wasFreeform: true };
if (l?.selected?.length) return { answer: l.selected.join(', '), wasFreeform: false };
if (l?.skipped) return { answer: null, wasFreeform: false, skipped: true };
```

> ⚠️ **Hardening**: se `l` for `undefined`, o campo `header` enviado **não coincide** com o header
> da pergunta que gerou o response. Isso indica que o `header` foi acima de 50 chars ou foi truncado
> silenciosamente.

---

### 16.4 Behavior handler — allow / deny

O handler `BEe` (pos=15348945 em `extension.js`) processa a resposta antes de retornar ao agente:

```
Usuário RESPONDE → behavior: "allow"
  updatedInput = {
    ...originalInput,
    answers: {
      [u.question]: selected.join(", ")  // string com respostas unidas por ", "
    }
  }

Usuário CANCELA TODAS → behavior: "deny"
  message: "The user cancelled the question"
```

**Implicação para o sistema de hooks**: quando o usuário clica "fechar" ou cancel sem responder
nenhuma pergunta, o hook recebe um evento `deny`. Isso significa que a resposta `skipped: true` em
`answers` indica dispensa individual de pergunta, enquanto `deny` no behavior indica dispensa de
toda a invocação.

**Template F (Session Close) — detalhe crítico**: quando o usuário digita a `close_key`, o
`postToolUse` detecta o valor no campo `freeText` ou `selected[0]` da resposta, não no `behavior`.

---

### 16.5 `manage_todo_list` — o que é e como funciona

`manage_todo_list` é uma ferramenta da categoria **"Core"** renderizada ao vivo na UI do usuário. O
estado do todo list é **persistido no servidor** da extensão VS Code, vinculado ao
`chatSessionResource`.

**Alias interno**: `z.CoreManageTodoList = "manage_todo_list"` (enum em `extension.js` pos=13217851)

**Regras de uso extraídas diretamente do system prompt** (pos=14354691 em `extension.js`):

> Use `manage_todo_list` quando:
>
> - A tarefa tem três ou mais etapas distintas
> - O pedido é ambíguo ou requer planejamento prévio
> - O usuário fornece múltiplas tarefas ou uma lista numerada
>
> NÃO use `manage_todo_list` quando:
>
> - A tarefa é simples ou pode ser concluída em poucos passos
> - O pedido é puramente conversacional ou informacional
> - A ação é uma operação de suporte (busca, grep, formatação, typecheck, leitura de arquivos)

**Performance**: chame o `manage_todo_list` em **paralelo** com as ferramentas que já começam a
trabalhar no primeiro item — isso reduz latência e round-trips.

---

### 16.6 Schema completo do `todoList` item

Extraído do `processTodoWriteTool` (pos=15168046) e da classe `LYt` (pos=18780588):

```json
{
  "id": 0, // number — índice sequencial (0-based gerado automaticamente)
  "title": "string", // Texto da tarefa (label conciso, 3-7 palavras ideal)
  "description": "", // Opcional — string vazia por padrão
  "status": "not-started" // Enum: "not-started" | "in-progress" | "completed"
}
```

**Enum de status — correspondência interna**: | Valor externo (`manage_todo_list`) | Equivalente
Claude Code interno | | ---------------------------------- | ------------------------------- | |
`"not-started"` | `"pending"` | | `"in-progress"` | `"in_progress"` | | `"completed"` |
`"completed"` |

> **Regra crítica** (da classe `LYt` / `alternativeDefinition`): "At most one step can be
> `in_progress` at a time." → Nunca marque dois itens como `in-progress` simultaneamente.

---

### 16.7 Operações `read` e `write`

A ferramenta suporta duas operações:

**`write`** — atualiza o todo list completo:

```json
{
  "operation": "write",
  "todoList": [
    { "id": 0, "title": "Tarefa 1", "description": "", "status": "completed" },
    { "id": 1, "title": "Tarefa 2", "description": "", "status": "in-progress" },
    { "id": 2, "title": "Tarefa 3", "description": "", "status": "not-started" }
  ]
}
```

**`read`** — retorna o estado atual do todo list:

```json
{
  "operation": "read",
  "chatSessionResource": "vscode://session/..."
}
```

A operação `read` é usada internamente por `getCurrentTodoContext` (pos=13695390) para injetar o
contexto da lista de tarefas nos prompts de sistema (elemento `<todoList>` no prompt).

---

### 16.8 Integração com o sistema de hooks

O `manage_todo_list` influencia o ciclo de vida dos hooks de duas formas:

**1. Enforcement via `agent-stop.sh`**: Se o todo list não foi usado no turno, o `systemMessage` de
block menciona que `manage_todo_list` não foi invocado. O hook verifica indiretamente via
`tools_called` no CTX.

**2. Contexto injetado automaticamente**: O `getCurrentTodoContext` (classe `Hee`) lê o estado do
todo list via `operation:"read"` e injeta o resultado no prompt como `<todoList>context</todoList>`.
Isso significa que o agente sempre "vê" sua lista de tarefas atual no contexto, mesmo que não tenha
chamado `manage_todo_list` explicitamente naquele turno.

**Diagrama de integração**:

```
manage_todo_list (write)
        ↓
  Estado persistido no servidor VS Code
        ↓ (inject via getCurrentTodoContext)
  <todoList> no system prompt de cada turno
        ↓
  agent-stop.sh verifica se foi chamado
        ↓
  Mencionado em decision:block se ausente em turno complexo
```

---

### 16.9 Reinício inline vs preCompact — a diferença crítica

> Esta seção documenta a causa raiz da "interrupção de sessão" investigada em março/2026.

#### O que aconteceu

A sessão `dcf579af-502e-4bf2-9d92-75903f85b0a2` foi "interrompida" quando a conversa excedeu o
orçamento de tokens — o VS Code executou um **resumo inline da conversa** (inline conversation
compaction). Evidências:

```json
// session-context.json — estado recuperado após a interrupção:
{
  "session": { "source": "reconnect_rollover" },
  "session_stats": { "compaction_count": 0 }
}
```

- `source: "reconnect_rollover"` → o VS Code reconheceu que a sessão continuou após reinício
- `compaction_count: 0` → o hook `preCompact` **nunca foi disparado**

#### Por que o `preCompact` hook NÃO disparou

O hook `preCompact` (configurado em `copilot-hooks.json` → `pre-compact.sh`) é disparado para um
**tipo diferente de compactação** — não para o resumo inline automático de conversa.

```
Mecanismo de resumo inline (o que ocorreu):
  Token budget excedido → VS Code gera resumo automático → reconecta com <conversation-summary>
  → NÃO dispara preCompact → compaction_count permanece 0
  → source = "reconnect_rollover" no próximo session-start

Mecanismo preCompact (o que NÃO ocorreu):
  Contexto do workspace excedido → VS Code pede compactação → preCompact hook dispara
  → pre-compact.sh cria checkpoint → compaction_count incrementa
```

#### O sistema sobreviveu corretamente

Embora o `preCompact` não tenha disparado, o sistema de hooks **manteve estado continuamente**:

- `session.id` permaneceu o mesmo (`dcf579af`)
- `session-context.json` sobreviveu intacto
- `close_key` continuou válida: `ENCERRAR-58D0F5A7`
- `current_section` manteve: `hooks-doc-research`

#### Hardenings implementados a partir desta investigação

| Hardening                 | Descrição                                                       | Arquivo                          |
| ------------------------- | --------------------------------------------------------------- | -------------------------------- |
| `chat.exploreAgent.model` | Haiku como padrão do Explore (menor contexto por subagente)     | `.vscode/settings.json`          |
| Documentação              | inline restart ≠ preCompact (esta seção)                        | Este documento                   |
| Checkpoint periódico      | `session-checkpoint.sh` chamado pelo sistema em múltiplos hooks | `agent-stop.sh`, `log-prompt.sh` |

#### Recomendações operacionais

1. **Não trate `reconnect_rollover` como erro** — é o comportamento correto do sistema de reinício
2. **`compaction_count: 0` após reinício inline é esperado** — não indica falha nos hooks
3. **Para reduzir frequência de inline restarts**: use `head -N` em outputs de terminal grandes,
   prefira `rg` com `--max-count 50` em buscas extensas
4. **O `pre-compact.sh` não precisa ser modificado** — ele é correto para o seu propósito; o inline
   restart é um mecanismo distinto que o VS Code não expõe via hooks

---

## 17. Agent Debug Panel — Sistema de Depuração Nativo do Copilot

> **Nota de investigação**: Esta seção foi produzida por análise direta do código-fonte da extensão
> `github.copilot-chat-0.39.0/dist/extension.js` (19,6 MB) em 2026-03-11. Toda informação é baseada
> em evidência empírica do código, não em documentação oficial (inexistente para esta API).

### 17.1 O que é o Agent Debug Panel

O **Agent Debug Panel** (view "Chat Debug") é uma interface nativa do GitHub Copilot que exibe em
tempo real o pipeline interno de execução do agente: chamadas de ferramentas, requisições LLM,
eventos de loop de controle, erros e descoberta de instruções/skills.

**Características fundamentais**:

- View nativa no VS Code, no sidebar da área `copilot-chat`
- Nome na UI: **"Chat Debug"** (com ícone `debug-icon.svg`)
- Habilitada sob feature flag — aparece apenas quando o contexto VS Code
  `github.copilot.chat.showLogView` é ativado via comando
- Usa a **API proposta** `chatDebug@2` do VS Code (sujeita a mudanças entre versões)
- Rastreia **múltiplas sessões simultâneas**, inclusive subagentes, com correlação hierárquica

---

### 17.2 Como Acessar o Debug Panel

#### Via Paleta de Comandos (método principal)

```
Ctrl+Shift+P → "Developer: Show Chat Log View"
```

- **Comando**: `github.copilot.debug.showChatLogView` — categoria `"Developer"`
- **Efeito**: define contexto `github.copilot.chat.showLogView=true`, foca a view `copilot-chat`
- A view **"Chat Debug"** aparece na sidebar com ícone de bug

#### Comandos de navegação e exportação disponíveis

| Comando                                               | Descrição                                                |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `github.copilot.debug.showChatLogView`                | Abre a view "Chat Debug" na sidebar                      |
| `github.copilot.debug.workbenchState`                 | Inspeciona estado interno do workbench (caixas de input) |
| `github.copilot.debug.collectDiagnostics`             | Coleta diagnósticos do ambiente Copilot                  |
| `github.copilot.chat.debug.exportTrajectories`        | Exporta todas as trajetórias como JSON                   |
| `github.copilot.chat.debug.exportSingleTrajectory`    | Exporta uma trajetória específica como JSON              |
| `github.copilot.chat.debug.exportAllPromptLogsAsJson` | Exporta todos os logs de prompt como JSON                |
| `github.copilot.chat.debug.exportPromptLogsAsJson`    | Exporta logs de prompt da sessão atual como JSON         |
| `github.copilot.chat.debug.exportLogItem`             | Exporta item individual do log                           |
| `github.copilot.chat.debug.exportPromptArchive`       | Exporta arquivo compactado de prompts                    |
| `github.copilot.debug.resetVirtualToolGroups`         | Reseta grupos de ferramentas virtuais                    |

#### Filtros e toggles disponíveis na view

| Toggle                                         | Descrição                                     |
| ---------------------------------------------- | --------------------------------------------- |
| `github.copilot.chat.debug.showElements`       | Mostra elementos de renderização              |
| `github.copilot.chat.debug.hideElements`       | Oculta elementos de renderização              |
| `github.copilot.chat.debug.showTools`          | Mostra chamadas de ferramentas                |
| `github.copilot.chat.debug.hideTools`          | Oculta chamadas de ferramentas                |
| `github.copilot.chat.debug.showGhostRequests`  | Mostra requisições "ghost" (internas)         |
| `github.copilot.chat.debug.hideGhostRequests`  | Oculta requisições "ghost"                    |
| `github.copilot.chat.debug.showNesRequests`    | Mostra requisições NES (Next Edit Suggestion) |
| `github.copilot.chat.debug.hideNesRequests`    | Oculta requisições NES                        |
| `github.copilot.chat.debug.showRawRequestBody` | Exibe corpo bruto da requisição HTTP          |
| `github.copilot.chat.debug.filter`             | Filtra eventos por tipo/conteúdo              |

---

### 17.3 Arquitetura Interna — Pipeline de Eventos

O Debug Panel é alimentado por duas fontes de dados que são sincronizadas pela classe `UK`:

```
requestLogger (entradas brutas de rede)
  ├─ kind=2 → chamadas de ferramentas
  └─ kind=1 → requisições LLM (ChatMLSuccess / ChatMLFailure)
            ↓
trajectoryLogger (passos seriados do loop do agente)
  └─ steps: [{step_id, source, tool_calls, metrics, ...}]
            ↓
Classe UK (sincronizador central)
  ├─ onDidChangeRequests → _syncFromRequestLogger()
  └─ onDidUpdateTrajectory → _syncFromTrajectoryLogger()
            ↓
_debugEventService.addEvent({category, ...})
            ↓
ChatDebugLogProvider.registerChatDebugLogProvider() → VS Code chat API (chatDebug@2)
            ↓
View "Chat Debug" no sidebar do VS Code
```

#### Estado interno da classe `UK` — tabela de correlação

| Campo                       | Tipo     | Descrição                                              |
| --------------------------- | -------- | ------------------------------------------------------ |
| `_processedEntries`         | `Set`    | IDs de requisições já processadas (dedup)              |
| `_processedTrajectorySteps` | `Set`    | IDs de passos já processados (dedup)                   |
| `_subAgentEventId`          | `Map`    | `invocationId → debug event ID` (correlação subagente) |
| `_subAgentSessionId`        | `Map`    | `invocationId → sessionId`                             |
| `_subAgentNames`            | `Map`    | `invocationId → nome` do subagente                     |
| `_subAgentStarted`          | `Set`    | invocationIds de subagentes já notificados             |
| `_loopStartEventId`         | `Map`    | `requestId → loop start event ID`                      |
| `_lastKnownSessionId`       | `string` | Último sessionId visto (fallback para correlação)      |

---

### 17.4 Categorias de Eventos e Campos Rastreados

O `_debugEventService.addEvent()` aceita 5 categorias. Todos os eventos compartilham campos base:

```javascript
{
  id: string,            // UUID gerado por crypto.randomUUID()
  timestamp: number,     // epoch ms
  category: string,      // "loopControl" | "toolCall" | "llmRequest" | "error" | "discovery"
  sessionId: string,     // chat session ID
  summary: string,       // texto resumido para exibição na view
  details: object,       // detalhes específicos da categoria
  parentEventId?: string // UUID do evento pai (correlação hierárquica)
}
```

#### 17.4.1 Categoria `loopControl` — Loop do Agente

Rastreia início, fim e iterações do loop principal do agente.

```javascript
// Início da trajetória (emitido ao processar o primeiro step)
{
  category: "loopControl",
  loopAction: "start",
  summary: `Loop started: ${agentName}`,
  details: { agentName, model }     // modelo e nome do agente
}

// Fim da trajetória (emitido quando final_metrics disponíveis)
{
  category: "loopControl",
  loopAction: "stop",
  summary: `Loop stopped: ${agentName} — ${totalMs}ms, ${totalTokens} tokens`,
  details: {
    agentName, model,
    totalPromptTokens, totalCompletionTokens,
    totalTokens, durationMs
  }
}

// Iteração por passo do trajectoryLogger (source: "user"|"system"|"agent")
{
  category: "loopControl",
  loopAction: "iteration",
  summary: "<resumo do passo>",
  details: {
    source,           // "user" | "system" | "agent"
    message?,         // texto da mensagem (se disponível)
    content?,         // conteúdo estruturado
    subagentRefs?     // [session_id] de subagentes referenciados
  },
  metrics?: object    // métricas de tokens do passo (quando disponíveis)
}
```

**Log levels**: `loopControl` → **Info** (em todos os subtipos)

#### 17.4.2 Categoria `toolCall` — Chamadas de Ferramentas

```javascript
{
  category: "toolCall",
  toolName: string,          // nome exato da ferramenta ("read_file", "run_in_terminal", etc.)
  argsSummary: string,       // args serializados em JSON (truncado em 100.000 chars)
  resultSummary?: string,    // output da ferramenta (truncado em 10.000 chars)
  status: "success" | "failure",
  errorMessage?: string,     // mensagem de erro detectada (truncada em 10.000 chars)
  isSubAgent?: true,         // presente apenas para runSubagent / search_subagent
  subAgentName?: string,     // nome do subagente (se aplicável)
  requestLogEntryId: string, // correlação com o requestLogger
  summary: string            // "Tool: toolName" | "SubAgent started/completed: name"
}
```

**Detecção de erro por heurística**: o sistema inspeciona o output buscando strings `"Error:"`,
`"error:"`, `"ENOENT"`, `"EACCES"` para classificar `status: "failure"` quando a ferramenta não
retorna código de erro explícito.

**Evento especial para `read_file` de skills/instruções**: quando `read_file` é bem-sucedido e lê um
arquivo classificado como skill ou instruction, um evento `discovery` adicional é emitido
automaticamente com `parentEventId` apontando para o `toolCall` correspondente.

**Log levels**: `toolCall` success → **Info** | failure → **Warning**

#### 17.4.3 Categoria `llmRequest` — Requisições ao LLM

Este é o evento mais rico em métricas operacionais:

```javascript
{
  category: "llmRequest",
  requestName: string,         // debugName da requisição (ex: "ChatMLSuccess")
  durationMs: number,          // duração total em ms (endTime - startTime)
  promptTokens: number,        // tokens de prompt (prompt_tokens)
  completionTokens: number,    // tokens de resposta (completion_tokens)
  cachedTokens: number,        // tokens cacheados (prompt_tokens_details.cached_tokens)
  totalTokens: number,         // total = prompt + completion
  status: "success" | "failure",
  model?: string,              // nome do modelo (ex: "claude-sonnet-4-5")
  timeToFirstTokenMs?: number, // tempo até primeiro token gerado (ms)
  maxInputTokens?: number,     // limite de prompt do endpoint (modelMaxPromptTokens)
  maxOutputTokens?: number,    // limite de output (postOptions.max_tokens)
  requestLogEntryId: string,   // correlação com o requestLogger
  summary: `${debugName} — ${durationMs}ms, ${totalTokens} tokens`
}
```

**Log levels**: `llmRequest` success → **Info** | failure → **Error**

#### 17.4.4 Categoria `error` — Erros de Execução

```javascript
{
  category: "error",
  errorType: "networkError",  // tipo atual (único tipo observado no código)
  originalError: string,       // motivo do erro (t.result.reason)
  summary: `Error: ${debugName} — ${reason}`,
  details: { debugName, reason }
}
```

**Log level**: **Error** (sempre)

#### 17.4.5 Categoria `discovery` — Instruções e Skills

Rastreia quais arquivos de instrução e skill foram carregados pelo agente:

```javascript
// Descoberta inicial do workspace (ao iniciar o agente)
{
  category: "discovery",
  sessionId: "global",         // sempre "global" para descoberta inicial
  resourceType: "skill" | "instruction",
  source: "workspace",
  resourcePath: string,        // caminho absoluto do arquivo
  matched: true,
  summary: `${"Skill" | "Instruction"}: ${basename(path)}`
}

// Leitura de skill/instruction via read_file
{
  category: "discovery",
  resourceType: "skill" | "instruction",
  source: "workspace",
  resourcePath: string,
  matched: true,
  parentEventId: string,       // ID do toolCall correspondente
  summary: `Skill read: ${skillName}` | `Instruction read: ${basename}`
}
```

**Log level**: **Info** (sempre)

#### Resumo de log levels por categoria

| Categoria     | Status success   | Status failure |
| ------------- | ---------------- | -------------- |
| `toolCall`    | Info             | Warning        |
| `llmRequest`  | Info             | Error          |
| `error`       | — (sempre Error) | —              |
| `discovery`   | Info             | —              |
| `loopControl` | Info             | —              |

---

### 17.5 TrajectoryLogger — Registro Detalhado de Execução

O `trajectoryLogger` mantém o histórico completo da execução do agente em estrutura serializada,
indexada por `sessionId`.

#### Estrutura de uma trajetória

```javascript
{
  agent: {
    name: string,              // nome do agente (ex: "Copilot Coding Agent")
    version: string,           // "1.0.0"
    tool_definitions: [...]    // definições das ferramentas disponíveis
  },
  steps: TrajectoryStep[],     // passos em ordem cronológica
  final_metrics?: {
    total_prompt_tokens: number,
    total_completion_tokens: number
    // + outras métricas agregadas da sessão
  }
}
```

#### Estrutura de um `TrajectoryStep`

```javascript
{
  step_id: string,             // ID único do passo
  source: "user" | "system" | "agent",  // quem gerou este passo
  tool_calls?: [{
    function_name: string,     // nome da ferramenta
    arguments: object          // argumentos passados
  }],
  model_name?: string,         // modelo usado neste passo
  message?: string,            // conteúdo textual do passo
  timestamp?: string,          // ISO string
  metrics?: {
    prompt_tokens: number,
    completion_tokens: number,
    cached_tokens: number,
    time_to_first_token_ms: number,
    duration_ms: number
  },
  content?: object,            // conteúdo estruturado (alternativo a message)
  subagent_trajectory_ref?: [{ session_id: string }]  // refs a subagentes
}
```

#### Exportação de trajetórias

```bash
# Comando na paleta: "Export Trajectories"
# Equivalente: github.copilot.chat.debug.exportTrajectories
# Produz JSON com todas as trajetórias da sessão para análise offline
```

---

### 17.6 Subagentes no Debug Panel

O Debug Panel rastreia subagentes com granularidade especial e hierarquia de eventos:

**1. Quando `runSubagent` é invocado**, a classe `UK` emite:

- Evento `toolCall` com `summary: "SubAgent started: nome"`, `isSubAgent: true`
- O `invocationId` é armazenado em `_subAgentEventId` para correlação posterior

**2. Eventos do subagente** (ferramentas e LLM calls dentro do subagente filho) aparecem como filhos
hierárquicos ligados via `parentEventId` ao evento "SubAgent started".

**3. Quando o subagente termina**, é emitido:

- Evento `toolCall` com `summary: "SubAgent completed: nome"`, `isSubAgent: true`

**4. Subagentes aninhados** são detectados via `subAgentInvocationId` no token de autenticação de
cada requisição, permitindo correlação correta de hierarquias multi-nível (`pai → filho → neto`).

**5. Ferramenta `search_subagent`** recebe tratamento equivalente (detectada junto com `runSubagent`
por `t.name === "search_subagent"`).

---

### 17.7 Configurações Relevantes

| Configuração                          | Padrão | Alias legado                                   | Descrição                                      |
| ------------------------------------- | ------ | ---------------------------------------------- | ---------------------------------------------- |
| `chat.debug.requestLogger.maxEntries` | `100`  | `chat.advanced.debug.requestLogger.maxEntries` | Máximo de entradas no request log              |
| `chat.debug.githubAuthFailWith`       | `null` | —                                              | Simula falha de autenticação                   |
| `chat.copilotDebugCommand.enabled`    | `true` | —                                              | Habilita o comando `copilot-debug` no terminal |

> **Nota**: `chat.debug.requestLogger.maxEntries` limita o histórico da view. Para sessões longas
> com muitas ferramentas, aumentar para `500` pode ser necessário para ver o histórico completo.

---

### 17.8 Comparação: Debug Panel vs. Nosso `audit.jsonl`

#### O que o Debug Panel rastreia e nós NÃO rastreamos

| Dado nativo                     | Campo no Debug Panel                      | Importância |
| ------------------------------- | ----------------------------------------- | ----------- |
| Tokens de prompt                | `promptTokens`                            | 🔴 Alta     |
| Tokens de resposta              | `completionTokens`                        | 🔴 Alta     |
| Tokens totais                   | `totalTokens`                             | 🔴 Alta     |
| Tokens cacheados                | `cachedTokens`                            | 🟡 Média    |
| Modelo por requisição           | `model` (ex: `"claude-sonnet-4-5"`)       | 🔴 Alta     |
| Duração da requisição LLM       | `durationMs` por chamada                  | 🟡 Média    |
| Tempo ao primeiro token         | `timeToFirstTokenMs`                      | 🟡 Média    |
| Limite máximo de tokens         | `maxInputTokens`, `maxOutputTokens`       | 🟢 Baixa    |
| Skill/instruction discovery     | eventos `discovery` (path, type, matched) | 🔴 Alta     |
| Loop start/stop do agente       | `loopControl` (start, stop, iteration)    | 🟡 Média    |
| Subagente start/stop granular   | `toolCall.isSubAgent: true`               | 🟡 Média    |
| Step source (user/sys/agent)    | `loopControl.details.source`              | 🟢 Baixa    |
| Detecção de erro por heurística | ENOENT / Error: no output da ferramenta   | 🟢 Baixa    |

#### O que NÓS rastreamos e o Debug Panel NÃO rastreia

| Dado nosso                     | Evento em `audit.jsonl`                                |
| ------------------------------ | ------------------------------------------------------ |
| Ciclo de vida de SESSION       | `sessionStart`, `sessionEnd`, `sessionCloseAuthorized` |
| Ciclo de vida de SECTION       | `sectionStart`, `sectionEnd`                           |
| Ciclo de vida de TURN          | `turnStart`, `turnStart_enriched_auto`                 |
| Protocolo de autorização       | `askQuestions_response`, `sessionClose_key_validated`  |
| TODO list tracking             | `manage_todo_list` na resposta do `postToolUse`        |
| Block decisions                | `agentStop_blocked`, `turnEnd_no_askQuestions`         |
| Close key validation           | `sessionClose_key_validated`                           |
| Compaction detection           | `inline_compaction_detected`                           |
| Git push tracking              | `gitPush` via hook `post-push`                         |
| Finding e task management      | eventos via `save-finding.sh`, `add-task.sh`           |
| Consecutive unauthorized turns | `consecutive_unauthorized` no `agentStop`              |

---

### 17.9 Como Complementar Nosso Sistema com Dados do Debug Panel

Os dados de maior valor ausentes no nosso sistema são: **token usage**, **modelo por requisição** e
**skill/instruction discovery**. Abaixo, três opções para capturá-los.

#### Opção A — `PostToolUse` para capturar token usage (recomendada, baixo esforço)

O hook `PostToolUse` recebe o resultado de todas as tool calls. Se o VS Code incluir campos de
`token_usage` ou `model` no payload, podem ser capturados sem alteração arquitetural:

```bash
# Em post-tool-use.sh — adicionar ao bloco de logging existente:
TOKENS_IN=$(jq -r '.token_usage.input_tokens // 0' <<< "$INPUT_JSON")
TOKENS_OUT=$(jq -r '.token_usage.output_tokens // 0' <<< "$INPUT_JSON")
MODEL=$(jq -r '.model // empty' <<< "$INPUT_JSON")

if [ "$TOKENS_IN" -gt 0 ] || [ -n "$MODEL" ]; then
  log_event "llm_usage" \
    "{\"inputTokens\":$TOKENS_IN,\"outputTokens\":$TOKENS_OUT,\"model\":\"$MODEL\"}"
fi
```

#### Opção B — Filtrar `read_file` de skills no `PostToolUse` (skill discovery)

Quando o agente chama `read_file` em um arquivo `.github/skills/*/SKILL.md`, podemos detectar isso
no `PostToolUse` e logar como evento `skill_read`:

```bash
# Em post-tool-use.sh — detectar leitura de skills:
TOOL_NAME=$(jq -r '.tool_name // empty' <<< "$INPUT_JSON")
FILE_PATH=$(jq -r '.tool_input.filePath // .tool_input.path // empty' <<< "$INPUT_JSON")

if [ "$TOOL_NAME" = "read_file" ] && echo "$FILE_PATH" | rg -q '\.github/skills/.*/SKILL\.md'; then
  SKILL_NAME=$(dirname "$FILE_PATH" | xargs basename)
  log_event "skill_read" "{\"skillName\":\"$SKILL_NAME\",\"path\":\"$FILE_PATH\"}"
fi
```

#### Opção C — Parsear `exportTrajectories` via pós-processamento (offline)

Após cada sessão, exportar as trajetórias e enriquecer o `audit.jsonl` com dados de token usage
agregados. Útil para relatórios mas não realtime.

```bash
# Integrar ao session-end.sh — exportação automática de trajetória
# Requer integração com VS Code Commands API (via extensão ou MCP)
```

#### Prioridade de implementação recomendada

| Prioridade | Dado                        | Opção         | Esforço |
| ---------- | --------------------------- | ------------- | ------- |
| 🔴 Alta    | Token usage (in/out/cached) | A (hook POST) | Baixo   |
| 🔴 Alta    | Modelo por requisição LLM   | A (hook POST) | Baixo   |
| 🔴 Alta    | Skill/instruction reads     | B (hook POST) | Médio   |
| 🟡 Média   | Duração de cada LLM call    | A (hook POST) | Baixo   |
| 🟢 Baixa   | Trajectory export completo  | C (offline)   | Alto    |

---

### 17.10 O Transcript JSONL — Log Filesystem Acessível por LLMs

> **Descoberta crítica**: o GitHub Copilot Chat grava automaticamente um arquivo JSONL por sessão em
> disco. Este é o ponto de acesso mais confiável para que um agente (LLM) leia o log de execução da
> própria sessão — sem depender da UI do Debug Panel (in-memory only).

#### Localização e descoberta dinâmica do arquivo

O transcript fica no `workspaceStorage` do VS Code, sob um hash de workspace que **varia por
ambiente**. A descoberta deve ser feita dinamicamente:

```
/home/node/.vscode-server/data/User/workspaceStorage/
  <workspace-hash>/                        ← hash único por workspace e ambiente
  GitHub.copilot-chat/
  transcripts/
    <session-id>.jsonl                     ← um arquivo por sessão
```

**Como descobrir o path programaticamente**:

```bash
# Encontrar o diretório de transcripts
find /home/node/.vscode-server/data/User/workspaceStorage \
  -maxdepth 5 -name "*.jsonl" \
  -path "*/GitHub.copilot-chat/transcripts/*.jsonl" \
  -print 2> /dev/null | head -1 | xargs dirname

# Ou usar o script canônico do repositório:
bash .github/hooks/scripts/read-transcript.sh --path
```

**Correlação com o `session-context.json`**: o `session.id` nesse arquivo corresponde ao nome do
arquivo JSONL (`<session-id>.jsonl`), permitindo localizar o transcript da sessão ativa:

```bash
SESSION_ID=$(jq -r '.session.id' .github/hooks/state/session-context.json)
# → e.g. "dcf579af-502e-4bf2-9d92-75903f85b0a2"
```

#### Formato e tipos de eventos do transcript

O arquivo é **JSONL** (uma linha = um objeto JSON) com esta estrutura base:

```json
{
  "type": "tool.execution_complete",
  "data": {
    /* campos específicos por tipo */
  },
  "id": "uuid-do-evento",
  "timestamp": "2026-03-10T14:00:45.518Z",
  "parentId": "uuid-do-evento-pai"
}
```

**Sete tipos de eventos gravados**:

| Tipo                      | Frequência¹  | Propósito                               |
| ------------------------- | ------------ | --------------------------------------- |
| `session.start`           | 1/sessão     | Metadata da sessão (producer, versões)  |
| `user.message`            | ≈1–30/sessão | Mensagens do usuário no chat            |
| `assistant.turn_start`    | N/turno      | Início de um ciclo do agente            |
| `assistant.message`       | N            | Resposta do agente (texto + tool calls) |
| `assistant.turn_end`      | N            | Fim do ciclo                            |
| `tool.execution_start`    | 1/tool call  | Execução iniciada                       |
| `tool.execution_complete` | 1/tool call  | Resultado (apenas `success: boolean`)   |

¹ _Valores empíricos da sessão `dcf579af` (6866 eventos, 547 tool calls, 1 falha em
get_terminal_output)._

#### Schemas completos por tipo de evento

```json
// session.start
{ "type": "session.start", "data": {
    "sessionId": "dcf579af-502e-4bf2-9d92-75903f85b0a2",
    "version": 1,
    "producer": "copilot-agent",
    "copilotVersion": "0.39.0",
    "vscodeVersion": "1.111.0",
    "startTime": "2026-03-10T21:06:17.895Z"
}}

// user.message
{ "type": "user.message", "data": {
    "content": "texto da mensagem do usuário",
    "attachments": []  // arquivos ou contexto anexado
}}

// assistant.turn_start / assistant.turn_end
{ "type": "assistant.turn_start", "data": { "turnId": "0" }}

// assistant.message — o mais rico
{ "type": "assistant.message", "data": {
    "messageId": "uuid",
    "content": "texto da resposta (vazio quando apenas tool calls)",
    "toolRequests": [{                // presentes quando o agente chama ferramentas
        "toolCallId": "toolu_vrtx_...",
        "name": "run_in_terminal",
        "arguments": "{\"command\": \"...\"}", // JSON string (não objeto!)
        "type": "function"
    }],
    "reasoningText": "..."            // pensamento interno do LLM (presente em ~27% das msgs)
}}

// tool.execution_start
{ "type": "tool.execution_start", "data": {
    "toolCallId": "toolu_vrtx_...",
    "toolName": "run_in_terminal",
    "arguments": { /* objeto parsed */ }  // já decodificado (não string)
}}

// tool.execution_complete
{ "type": "tool.execution_complete", "data": {
    "toolCallId": "toolu_vrtx_...",
    "success": true  // ou false para falhas — ÚNICO campo disponível
}}
```

#### Análise empírica — dados reais de sessões coletadas

Extraídos de **6 sessões** presentes no workspaceStorage (análise em 2026-03-11):

| Sessão (parcial)       | Linhas | Tool Calls | Unique Tools | Falhas |
| ---------------------- | ------ | ---------- | ------------ | ------ |
| `444ad443`             | 128    | 25         | 5            | 0      |
| `7f9f96e4`             | 47     | 9          | 3            | 2      |
| `9b905230`             | 35     | 9          | 4            | 0      |
| `a0be08af`             | 11.721 | 2.355      | 16           | 2      |
| `cae36d10`             | 133    | 37         | 9            | 2      |
| `dcf579af` (**atual**) | 6.866  | 547        | 13           | 1      |

**Distribuição de eventos na sessão maior** (`a0be08af`, 11.721 linhas):

- `assistant.turn_start/end`: maioria
- `tool.execution_start/complete`: correlacionados 1:1
- `user.message`: muito escasso (13–21 por sessão longa)
- `assistant.message` com `reasoningText`: ~27% das mensagens (pensamento exposto)

#### Falhas encontradas: padrão entre sessões

| Sessão     | Ferramenta que falhou      | Timestamp                      |
| ---------- | -------------------------- | ------------------------------ |
| `7f9f96e4` | `run_notebook_cell` (×2)   | 2026-03-09T17:12:47/58         |
| `a0be08af` | `get_terminal_output` (×2) | 2026-03-09T05:15:22 e 07:11:43 |
| `cae36d10` | `grep_search` (×2)         | 2026-03-09T17:39:19 e 17:40:56 |
| `dcf579af` | `get_terminal_output` (×1) | 2026-03-10T14:00:45            |

**Diagnóstico da falha `dcf579af`**: o agente chamou `get_terminal_output` com `id: "2"` (terminal
que ainda não existia). O Copilot retornou `success: false`. Na sequência imediata, o agente usou
`run_in_terminal` diretamente e recuperou sem intervenção. Comportamento de auto-recuperação
correto.

**Padrão geral de falhas**:

- `get_terminal_output`: terminal ID não existe (foi fechado ou nunca aberto)
- `grep_search`: padrão muito restritivo ou arquivo não encontrado
- `run_notebook_cell`: falhas de runtime no Jupyter

#### Limitação crítica do transcript

> **⚠️ O campo `tool.execution_complete` contém APENAS `{ toolCallId, success: boolean }`.** O
> output real das ferramentas (stdout, resultados de búsca, conteúdo de arquivos) **NÃO está no
> transcript** — está apenas no in-memory `requestLogger` do Debug Panel (acessível via UI).

| O que o transcript tem       | O que o transcript NÃO tem         |
| ---------------------------- | ---------------------------------- |
| Tool call ID e nome          | Output/resultado da ferramenta     |
| Argumentos de entrada        | Token counts (input/output/cached) |
| Status success/fail          | Modelo LLM usado por chamada       |
| Timestamps                   | Duração de cada LLM request        |
| Conteúdo das mensagens       | Dados internos `loopControl`       |
| `reasoningText` (pensamento) | Eventos `discovery` (skill reads)  |

#### Script `read-transcript.sh` — acesso programático ao log

Criado em `.github/hooks/scripts/read-transcript.sh` (shellcheck limpo):

```bash
# Estatísticas completas da sessão atual
bash .github/hooks/scripts/read-transcript.sh --stats

# Apenas falhas (tool.execution_complete com success: false)
bash .github/hooks/scripts/read-transcript.sh --errors

# Últimas N mensagens do usuário
bash .github/hooks/scripts/read-transcript.sh --last 5

# Path do transcript da sessão atual
bash .github/hooks/scripts/read-transcript.sh --path

# Listar todas as sessões disponíveis
bash .github/hooks/scripts/read-transcript.sh --list

# Sessão específica (ID parcial)
bash .github/hooks/scripts/read-transcript.sh --session dcf579af
```

**Output do `--stats` (JSON estruturado)**:

```json
{
  "session_id": "dcf579af-502e-4bf2-9d92-75903f85b0a2",
  "transcript_path": "/home/node/.vscode-server/...",
  "session_start": "2026-03-10T21:06:17.895Z",
  "copilot_version": "0.39.0",
  "vscode_version": "1.111.0",
  "total_events": 6866,
  "total_tool_calls": 547,
  "total_failures": 1,
  "user_messages_count": 21,
  "assistant_messages_count": 1556,
  "tool_counts": {
    "run_in_terminal": 682,
    "read_file": 360,
    "manage_todo_list": 176,
    "replace_string_in_file": 167,
    "grep_search": 74,
    "vscode_askQuestions": 46,
    ...
  },
  "failures": [...]
}
```

**Uso recomendado no início de cada sessão**:

```bash
# Ver se houve falhas na sessão atual (diagnóstico rápido)
bash .github/hooks/scripts/read-transcript.sh --errors

# Comparar com o audit.jsonl do nosso sistema:
tail -20 .github/hooks/logs/audit.jsonl | jq '.event' -r
```

**Integração futura sugerida**: adicionar chamada automática ao `session-briefing.md` (gerado pelo
`session-start.sh`), injetando as estatísticas de erro da sessão mais recente ao briefing de início
da próxima sessão. Isso permitirá que o agente detecte automaticamente padrões de falha recorrentes.

---

### 17.11 Falhas de API do vscode_askQuestions — "Response contained no choices"

Esta seção documenta o padrão de falha de API descoberto empiricamente quando o
`vscode_askQuestions` retorna `FAILED: Response contained no choices`, suas causas, como identificar
no transcript e os hardenings aplicáveis.

#### Identificação no transcript e na UI

**Padrão de eventos no transcript** quando ocorre a falha:

```jsonc
// tool.execution_start — início normal
{"type":"tool.execution_start","data":{"toolCallId":"toolu_vrtx_01NYAEMw5wd1d...","toolName":"vscode_askQuestions","arguments":{...}}}

// tool.execution_complete — mas reporta success:true mesmo com erro interno
{"type":"tool.execution_complete","data":{"toolCallId":"toolu_vrtx_01NYAEMw5wd1d...","success":true}}
```

> ⚠️ **Armadilha crítica**: `success: true` no evento `tool.execution_complete` **não garante** que
> o askQuestions recebeu uma resposta válida do LLM. O campo indica apenas que a ferramenta retornou
> ao agente — o conteúdo da resposta pode ser um erro.

**Evidência empírica** (sessão `dcf579af`, evento #6122–#6123):

- `tool.execution_start` em `15:22:34`
- `tool.execution_complete` (success: true) em `15:26:19` (4 minutos de espera)
- A resposta continha: `FAILED: Response contained no choices.`
- O `session-context.json.current_turn.last_askquestions_response` preservou o erro

**Onde o erro aparece no `session-context.json`**:

```json
{
  "current_turn": {
    "last_askquestions_response": "...\"freeText\":\"[u.question]: selected.join(\\\",\\n[copilot_cache_control: { type: 'ephemeral' }]\\n\\n--- Error ---\\nFAILED: Response contained no choices.\\n\"..."
  }
}
```

#### O artefato de "corrupção visual" na UI

Quando `vscode_askQuestions` falha com este erro, a **interface VS Code exibe**:

1. O conteúdo parcial das perguntas (schemas compilados da extensão como `[u.question]`)
2. O texto `--- Error ---\nFAILED: Response contained no choices.`

Isso pode parecer ao usuário que um arquivo foi corrompido — especialmente se o agente estava
discutindo esse arquivo nas perguntas. **Não é corrupcão de arquivo** — é um artefato visual da UI
que exibe a falha de API inline.

**Como distinguir artefato de UI vs. corrupção real de arquivo**:

```bash
# Verificar se o arquivo termina corretamente
tail -5 DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md

# Buscar a string "FAILED" no arquivo
rg "FAILED.*no choices" DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md

# Verificar tamanho e timestamp
wc -l DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md
ls -la DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md
```

Se `rg` não encontrar a string e `tail` mostrar conteúdo válido, **o arquivo está limpo** — o que o
usuário viu foi o artefato visual da UI.

**Causa raiz identificada**: A falha `"Response contained no choices"` ocorre no nível da API do
Copilot quando:

- O contexto acumulado excede o limite do modelo
- A API do Copilot retorna rate-limiting ou falha de disponibilidade
- O timeout da requisição é atingido (observado: ~4 minutos de espera)

#### Hardenings implementados {#hardenings-recomendados-askquestions}

Todos os hardenings abaixo foram **implementados** nesta versão.

**Hardening 1 — Detecção de falha no `post-tool-use.sh`** ✅ IMPLEMENTADO

Ao capturar a resposta de `vscode_askQuestions`, verifica a presença de strings de erro:

```bash
# .github/hooks/scripts/post-tool-use.sh
ASK_API_FAILED=false
if echo "$TOOL_RESPONSE" | grep -qF "FAILED: Response contained no choices"; then
  ASK_API_FAILED=true
fi
# Grava evento "askQuestions_api_error" no audit.jsonl quando ASK_API_FAILED=true
```

**Hardening 2 — Flag no `session-context.json`** ✅ IMPLEMENTADO

Quando falha detectada, atualiza o contexto:

```json
{
  "current_turn": {
    "askquestions_api_failed": true
  },
  "session_stats": {
    "askquestions_api_failures": 1
  }
}
```

**Hardening 3 — Alerta no `start-turn.sh` + bridge automático** ✅ IMPLEMENTADO

No início de cada turno, verifica se o turno anterior teve falha de API:

```bash
# Saída emitida pelo start-turn.sh quando detecta falha anterior:
# ⚠️ [start-turn] ALERTA: vscode_askQuestions falhou na sessão
# Loga "turnStart_askquestions_failure_detected" no audit.jsonl
```

Também chama automaticamente `sync-transcript-errors.sh` para sincronizar erros do log nativo
Copilot ao nosso `audit.jsonl`.

**Hardening 4 — Alerta no `session-start.sh` (briefing)** ✅ IMPLEMENTADO

Quando `session_stats.askquestions_api_failures > 0`, injeta seção de alerta no
`session-briefing.md`:

```markdown
## ⚠️ ALERTA — Falha de API do `vscode_askQuestions` na sessão anterior

> O vscode_askQuestions falhou N× com erro "Response contained no choices".
```

**Bridge — `sync-transcript-errors.sh`** ✅ IMPLEMENTADO

Lê o transcript JSONL nativo do Copilot e sincroniza para `audit.jsonl` qualquer
`tool.execution_complete` com `success: false` não ainda registrado:

```bash
# Uso manual:
bash .github/hooks/scripts/sync-transcript-errors.sh
bash .github/hooks/scripts/sync-transcript-errors.sh --dry-run
bash .github/hooks/scripts/sync-transcript-errors.sh --session SESSION_ID
```

**Status de implementação**: Hardenings 1–4 e bridge implementados na versão atual.

---

## 18. Achados de Auditoria Proativa — Exploratory Bug Hunt (2026-03-12)

Esta seção documenta os achados da rodada de `exploratory-bug-hunt` (skill v2.0) executada em
2026-03-12, conduzida via inspeção manual de todos os 11 scripts de hooks e `hooks-lib/common.sh`.

### 18.1 Sumário Executivo

| ID      | Severidade | Script(s)                               | Categoria                     | Status         |
| ------- | ---------- | --------------------------------------- | ----------------------------- | -------------- |
| EBH-M01 | MÉDIO      | `pre-tool-use.sh`                       | Escrita não-atômica           | ✅ Corrigido   |
| EBH-M02 | MÉDIO      | `agent-stop.sh`                         | Nome estático de temporário   | ✅ Corrigido   |
| EBH-M03 | MÉDIO      | `session-start.sh`                      | Valor semântico inválido      | ✅ Corrigido   |
| EBH-L01 | BAIXO      | `subagent-start.sh`, `subagent-stop.sh` | Falha silenciosa sem `sponge` | ✅ Corrigido   |
| EBH-L02 | BAIXO      | `hooks-lib/common.sh`                   | Risco latente de injeção jq   | 📋 Documentado |
| EBH-L03 | BAIXO      | `agent-stop.sh`                         | Performance (40 chamadas jq)  | 📋 Documentado |

### 18.2 Achados de Severidade MÉDIA (corrigidos)

#### EBH-M01 — `pre-tool-use.sh`: auto_recovery escrevia CTX de forma não-atômica

**Problema**: A função de recuperação automática do CTX (ativada quando `session_id` não bate e a
fonte é `inline_restart`) fazia `> "$CTX_FILE"` diretamente. Se o `jq -cn` falhasse no meio da
operação, o arquivo seria truncado (CTX corrompido).

**Fix**: Substituído por padrão `mktemp` + `mv` com fallback sponge:

```bash
_CTX_RECOVERY_TMP="$(mktemp)"
if jq -cn ... > "$_CTX_RECOVERY_TMP" 2> /dev/null; then
  mv "$_CTX_RECOVERY_TMP" "$CTX_FILE" 2> /dev/null || ...
else
  rm -f "$_CTX_RECOVERY_TMP"
fi
```

#### EBH-M02 — `agent-stop.sh`: usava `$CTX_FILE.tmp` como nome estático de temporário

**Problema**: O update de `consecutive_unauthorized` usava `"$CTX_FILE" > "$CTX_FILE.tmp"`. Nome
estático de temporário cria dois riscos: (1) colisão entre instâncias paralelas; (2) orphan caso o
`mv` falhe.

**Fix**: Substituído por `_CTX_BLOCK_TMP="$(mktemp)"` com `rm -f` em caso de falha do `mv`.

#### EBH-M03 — `session-start.sh`: `LOGICAL_SESSION_NUMBER` poderia ser `0`

**Problema**: No branch `inline_restart`, `LOGICAL_SESSION_NUMBER` era copiado direto de
`_PREV_LOGICAL_NUM` que vinha do CTX. Se o CTX não tivesse o campo (sessão antiga), `jq` retornaria
`null`, resultando em `LOGICAL_SESSION_NUMBER=""` ou `"0"`, valor semanticamente inválido.

**Fix**: Adicionada guard explícita após ambos os branches:

```bash
[ "${LOGICAL_SESSION_NUMBER}" -lt 1 ] 2> /dev/null && LOGICAL_SESSION_NUMBER=1
```

### 18.3 Achados de Severidade BAIXA

#### EBH-L01 — `subagent-start.sh` / `subagent-stop.sh`: sem fallback mktemp (CORRIGIDO)

**Problema**: Os scripts só atualizavam `subagent_calls`/`subagent_completions` no CTX se `sponge`
estivesse disponível. Sem `sponge`, o bloco era simplesmente pulado — contador nunca incrementado.

**Fix aplicado**: Adicionado `else`-branch com padrão mktemp/mv. A guard `[ -s "$CTX_FILE" ]`
(tamanho > 0) também foi adicionada por consistência.

#### EBH-L02 — `common.sh:ctx_update()`: risco latente de injeção de expressão jq

**Descrição**: A função `ctx_update()` recebe uma expressão jq como string e a interpola dentro de
`sh -c "jq '${expr}' ..."`. Se `expr` contiver aspas simples, a sintaxe do shell quebraria. Não é
exploitável atualmente porque todos os call sites usam expressões hardcoded sem aspa simples.

**Risco**: Baixo — apenas callers internos controlam `expr`. Se futuramente algum código passar
dados externos para `ctx_update()`, seria necessário sanitizar.

**Recomendação futura**: Se `ctx_update()` for chamada com dados dinâmicos, usar `jq --argjson` ou
`printf '%q'` para sanitizar `expr` antes da interpolação.

#### EBH-L03 — `agent-stop.sh`: ~40 chamadas individuais `jq "$CTX_FILE"` (performance)

**Descrição**: `agent-stop.sh` executa ~40 chamadas `jq` separadas no CTX_FILE para leituras. Cada
chamada spawna um subshell, abre o arquivo e processa. Em sessões longas com muitos `agentStop`
disparados, essa sobrecarga é mensurável (estimado: ~100–400ms adicionais por invocação em sistemas
com I/O lento).

**Recomendação futura**: Fazer uma leitura consolidada `CTX_JSON="$(jq '.' "$CTX_FILE")"` no início
e usar `echo "$CTX_JSON" | jq ...` para todas as leituras. Escritas continuam individualmente (para
manter atomicidade).

**Status**: Documentado no PLANO (Seção 7-B) — aplicar na próxima rodada de otimização de
performance.

### 18.4 Metodologia

A inspeção seguiu as 10 categorias da skill `exploratory-bug-hunt` v2.0:

| Categoria              | O que foi verificado                  | Resultado               |
| ---------------------- | ------------------------------------- | ----------------------- | ------------------------------- | -------------- |
| C1 – Temp files        | `mktemp` sem cleanup, nomes estáticos | EBH-M02 encontrado      |
| C2 – Background procs  | Subshells zumbis                      | Nenhum achado           |
| C3 – Race conditions   | Escrita não-atômica em CTX            | EBH-M01 encontrado      |
| C4 – Error handling    | `                                     |                         | true` silenciosos problemáticos | Nenhum crítico |
| C5 – Input validation  | Interpolação sem sanitização          | EBH-L02 identificado    |
| C6 – Output corruption | Truncamento de arquivos               | Coberto por EBH-M01/M02 |
| C7 – Resource leaks    | Descritores/FDs não fechados          | Nenhum achado           |
| C8 – Logic correctness | Valores semânticos inválidos          | EBH-M03 encontrado      |
| C9 – Performance       | Chamadas redundantes                  | EBH-L03 identificado    |
| C10 – Portability      | Dependências não verificadas          | EBH-L01 encontrado      |

Referência canônica detalhada: `DOCUMENTAÇÃO/HOOKS/PLANO-CORRECOES-HOOKS.md` — Seção 7-B.

---

## 19. Análise Aprofundada: Ciclo de Vida do Prompt vs Sessão

> **Contexto**: esta seção consolida a investigação realizada em 2026-03-12, motivada pela
> observação de que "ao enviar um novo prompt em uma caixa já aberta anteriormente" (após o
> encerramento autorizado da sessão), o comportamento do sistema não era completamente documentado.
> Cobre todos os cenários possíveis, decisões de design, gaps identificados e correções aplicadas.

---

### 19.1 Taxonomia Completa dos Cenários

Quando um **novo prompt é enviado**, o `log-prompt.sh` (via `userPromptSubmitted`) precisa
determinar em qual das seis situações abaixo está operando, pois cada uma exige tratamento
diferente.

#### Matriz de Decisão

| Cenário                             | session_id novo? | ended_at != null? | sessionStart disparou? | Resultado                                                          |
| ----------------------------------- | ---------------- | ----------------- | ---------------------- | ------------------------------------------------------------------ |
| **A — Nova aba de chat**            | ✅ Sim           | ❌ Não            | ✅ Sim (antes)         | CTX já criado pelo `sessionStart`; `log-prompt.sh` só reseta turno |
| **B — Sessão ativa, prompt normal** | ❌ Não           | ❌ Não            | ✅ Sim                 | Caminho mais comum; apenas reset de `current_turn.*`               |
| **C — Mesma aba, após close**       | ❌ Não           | ✅ Sim            | ❌ Não                 | **RECONNECT-02**: cria sessão inline (`inline_restart`)            |
| **D — Reconexão VS Code, novo ID**  | ✅ Sim           | ❌ Não            | ❌ Não                 | **RECONNECT-01**: rollover com novo session_id                     |
| **E — Inline compaction**           | ❌ Não (ou Sim)  | ❌ Não            | ❌ Não                 | Sub-caso de D; detectado via `compaction_count=0`                  |
| **F — Recovery manual**             | qualquer         | qualquer          | ❌ Não                 | **HEAL v1**: adota SESSION_ID_PAYLOAD como fonte de verdade        |

#### Caminho de Decisão no código (`log-prompt.sh` Fase 0)

```
log-prompt.sh recebe SESSION_ID_PAYLOAD do VS Code
  │
  ├─ CTX existe? sim → lê CTX_ACTIVE_SID
  │     │
  │     ├─ session_id_payload ≠ CTX_ACTIVE_SID?
  │     │     │
  │     │     ├─ source = manual_recovery ou inline_restart → HEAL v1 (healed_from_real_session)
  │     │     │
  │     │     └─ source = outro → RECONNECT-01 (reconnect_rollover)
  │     │           └─ compaction_count=0? → log inlineCompact_suspected
  │     │
  │     └─ session_id_payload = CTX_ACTIVE_SID → sem mismatch
  │
  ├─ CTX.session.ended_at ≠ null? → RECONNECT-02 (inline_restart)
  │     └─ gera nova close_key, started_at, reseta turn_count, turns_since_askQuestions
  │
  └─ Prossegue para reset de current_turn (turno normal)
```

> **Ordem determinística**: HEAL v1 → RECONNECT-01 → RECONNECT-02. Cada bloco pode disparar
> independentemente dos anteriores (não há `return` entre eles).

---

### 19.2 Análise Detalhada por Cenário

#### Cenário A — Nova aba de chat (sessionStart + session_id novo)

- **Trigger**: usuário clica no botão "+" no painel do Copilot
- **Hookéventos**: `sessionStart` dispara → `session-start.sh` cria CTX completo novo
- **session.id**: UUID novo gerado pelo VS Code (diferente do anterior)
- **session.source**: `"new"`
- **`log-prompt.sh`**: recebe session_id que já está no CTX (criado pelo sessionStart) → caminho
  normal (sem mismatch, sem ended_at) → apenas reset de turno
- **Estado final**: CTX limpo, `turn_count=0`, `logical_session_number+1`

#### Cenário B — Sessão ativa, prompt normal (caminho mais comum)

- **Trigger**: agente respondeu, usuário digita novo prompt na mesma aba
- **Eventos**: apenas `userPromptSubmitted` → `log-prompt.sh`
- **session.id**: igual ao CTX; `ended_at=null`
- **`log-prompt.sh`**: sem mismatch, sem ended_at → reset `current_turn.*`, incrementa `turn_count`
- **Estado final**: novo turno iniciado, seção preservada

#### Cenário C — Mesma aba, prompt após sessão fechada (RECONNECT-02)

- **Trigger**: `session-close.sh` foi executado anteriormente (ended_at gravado); o VS Code NÃO
  dispara novo `sessionStart` — o painel continua aberto; usuário digita novo prompt
- **Identidade**: VS Code continua enviando o **MESMO session_id** (ex: `dcf579af-...`)
- **`log-prompt.sh`**: detecta `ended_at != null` → RECONNECT-02
- **O que acontece**:
  - `session.id` ← `SESSION_ID_PAYLOAD` (o MESMO UUID do VS Code — **não gera UUID novo**)
  - `session.vs_code_session_id` ← mesmo valor
  - `session.source` ← `"inline_restart"`
  - `session.started_at` ← novo timestamp ISO
  - `session.ended_at` ← `null` (limpa)
  - `session.close_key` ← nova chave `ENCERRAR-XXXXXXXX`
  - `session.prev_session_id` ← ID anterior (= `session.id` novo = mesmo UUID!)
  - `session_stats.turn_count` ← `0`
  - `session_stats.failures_detected` ← `0`
  - `session_stats.turns_since_askQuestions` ← `0` (**FIX-01**: corrigido em 2026-03-12)
  - `compliance.consecutive_unauthorized` ← `0`
  - `current_turn` ← reset completo
- **Evento logado**: `sessionStart_inline` em `audit.jsonl`
- **Nota `prev_session_id === session.id`**: comportamento esperado — não é bug. O campo aponta para
  o UUID anterior (que é o mesmo UUID VS Code atual, pois o VS Code não criou nova sessão).

> **⚠️ Observação de design**: `session_stats.tools_total`, `tools_by_name`, `section_count`,
> `section_names`, `section_history` e `turn_authorized`/`turn_unauthorized` **não são resetados**
> em RECONNECT-02 — isso é intencional, para preservar a continuidade histórica da janela VS Code. O
> campo `turn_count=0` reseta a contagem corrente, mas os acumulados permanecem para referência.

#### Cenário D — Reconexão VS Code, novo session_id sem sessionStart (RECONNECT-01)

- **Trigger**: VS Code fechou e reabriu o painel (crash, restart, tab recovery) **sem** a extensão
  Copilot disparar `sessionStart`; o novo prompt chega com um session_id diferente
- **`log-prompt.sh`**: `SESSION_ID_PAYLOAD ≠ CTX.session.id` → RECONNECT-01
- **O que acontece**:
  - Log `sessionReconnect` em `audit.jsonl` (cria "synthetic sessionEnd" para sessão anterior)
  - `session.id` ← novo `SESSION_ID_PAYLOAD`
  - `session.source` ← `"reconnect_rollover"`
  - **`ended_at` NÃO é limpo**: se a sessão anterior tinha `ended_at`, RECONNECT-02 pode disparar no
    mesmo prompt (duplo-firing — ver GAP-ARCH-05)

#### Cenário E — Inline compaction (sub-caso de D)

- Igual ao Cenário D (RECONNECT-01), com session_id diferente
- Detectado quando `session_stats.compaction_count == 0` no momento do rollover
- Log adicional: `inlineCompact_suspected` em `audit.jsonl`

#### Cenário F — Manual recovery (HEAL v1)

- **Trigger**: CTX foi criado manualmente (`source = "manual_recovery"`) ou uma sessão
  `inline_restart` ainda tem ID divergente
- **`log-prompt.sh`**: `SESSION_ID_PAYLOAD ≠ CTX.session.id` E
  `source ∈ {manual_recovery, inline_restart}` → HEAL v1
- **Resultado**: `session.id` ← `SESSION_ID_PAYLOAD`; `session.source` ←
  `"healed_from_real_session"`

---

### 19.3 Caso Especial: RECONNECT-01 + RECONNECT-02 Simultâneos (GAP-ARCH-05)

**Cenário hipoteticamente possível**: nova abada VS Code com session_id diferente, mas o CTX antigo
ainda tinha `ended_at != null` (sessão havia sido fechada antes do crash do VS Code).

**O que ocorre no `log-prompt.sh`**:

1. HEAL v1: `source != manual_recovery/inline_restart` → pula
2. RECONNECT-01: session_id mudou → dispara, atualiza `session.id`, seta
   `source = "reconnect_rollover"`, **não limpa `ended_at`**
3. RECONNECT-02: relê CTX, ainda encontra `ended_at != null` → dispara também, seta
   `source = "inline_restart"`, limpa `ended_at`

**Estado final**: `source = "inline_restart"` (RECONNECT-02 sobrescreve). Dois eventos são logados:
`sessionReconnect` (RECONNECT-01) E `sessionStart_inline` (RECONNECT-02). Isso é **aceitável** como
comportamento, mas o audit.jsonl mostrará ambos os eventos para o mesmo prompt.

**Impacto prático**: raro. Só ocorre quando houve crash do VS Code após `session-close.sh` mas antes
do usuário fechar a aba. Não há dados corrompidos — a segunda passagem (RECONNECT-02) limpa o estado
corretamente.

---

### 19.4 Gaps Identificados e Status de Correção

| ID               | Descrição                                                                                                                                                                                               | Severidade | Status                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| **FIX-01**       | `session_stats.turns_since_askQuestions` não resetado em RECONNECT-02: após um inline_restart, o campo carregava o valor da sessão anterior, causando falsa severidade ALERTA/CRITICO no primeiro turno | MÉDIO      | ✅ **Corrigido** em `log-prompt.sh` (2026-03-12)                                  |
| **GUIA-CORR-01** | Seção 12.2 do GUIA afirmava "geramos um NOVO UUID" em inline_restart — incorreto desde a correção do BUG-01; o código usa `SESSION_ID_PAYLOAD` (VS Code session_id)                                     | MÉDIO      | ✅ **Corrigido** (2026-03-12)                                                     |
| **GAP-ARCH-01**  | `prev_session_id === session.id` em RECONNECT-02: campo semanticamente confuso quando os dois UUIDs são idênticos; pode gerar estranheza ao ler o CTX                                                   | BAIXO      | 📋 **Documentado** (comportamento esperado; ver Seção 19.2-C)                     |
| **GAP-ARCH-02**  | `session_stats.turn_authorized` / `turn_unauthorized` não resetados em RECONNECT-02, mas `turn_count` é resetado: acumulado histórico e contador corrente divergem                                      | BAIXO      | 📋 **Documentado** (design intencional: preservar histórico acumulado)            |
| **GAP-ARCH-03**  | RECONNECT-01 não limpa `ended_at`: se CTX tinha ended_at de uma sessão fechada anterior, RECONNECT-02 dispara logo após, gerando dois eventos no mesmo prompt                                           | BAIXO      | 📋 **Documentado** (GAP-ARCH-05; comportamento aceitável, não corrompe estado)    |
| **GAP-ARCH-04**  | `session_stats.tools_total`, `tools_by_name`, `section_count` etc. preservados em RECONNECT-02 sem documentação explícita: pode surpreender ao ler CTX pós-restart                                      | BAIXO      | 📋 **Documentado** (design intencional: continuidade histórica da janela VS Code) |
| **LIM-04**       | Timestamps `sessionEnd` em Unix ms em vez de ISO 8601                                                                                                                                                   | BAIXO      | 📋 Backlog (sem impacto operacional imediato)                                     |

---

### 19.5 Convenções e Campos de Rastreamento Relevantes

| Campo no CTX                             | Quem escreve                                     | Quando muda                       | Valor em RECONNECT-02                              |
| ---------------------------------------- | ------------------------------------------------ | --------------------------------- | -------------------------------------------------- |
| `session.id`                             | `session-start.sh`, `log-prompt.sh`              | sessionStart ou RECONNECT         | Igual ao VS Code session_id (mesmo antes e depois) |
| `session.vs_code_session_id`             | `log-prompt.sh`                                  | Toda reconciliação                | Sempre igual ao SESSION_ID_PAYLOAD                 |
| `session.source`                         | `session-start.sh`, `log-prompt.sh`              | Cada transição                    | `"inline_restart"`                                 |
| `session.prev_session_id`                | `log-prompt.sh`                                  | RECONNECT-01/02                   | Igual a `session.id` em RECONNECT-02 (mesmo UUID)  |
| `session.started_at`                     | ambos                                            | Cada novo início lógico           | Novo timestamp ISO                                 |
| `session.ended_at`                       | `session-close.sh` → limpo em RECONNECT-02       | Close + Restart                   | `null`                                             |
| `session.close_key`                      | `session-start.sh`, `log-prompt.sh` RECONNECT-02 | Cada início lógico                | Nova chave `ENCERRAR-XXXXXXXX`                     |
| `session.logical_session_number`         | `session-start.sh`                               | Só em sessionStart (`source=new`) | **Não incrementado** em RECONNECT-02               |
| `session_stats.turn_count`               | `log-prompt.sh`, `agent-stop.sh`                 | Cada turno                        | Resetado para `0`                                  |
| `session_stats.turns_since_askQuestions` | `agent-stop.sh`, `log-prompt.sh`                 | Cada turno/restart                | Resetado para `0` (FIX-01)                         |
| `session_stats.turn_authorized`          | `agent-stop.sh`                                  | Cada turno autorizado             | **Preservado** (acumulado histórico)               |
| `session_stats.tools_total`              | `post-tool-use.sh`                               | Cada tool call                    | **Preservado** (acumulado histórico)               |

> **Nota sobre `logical_session_number`**: Este campo é incrementado apenas em `session-start.sh`
> (quando `source = "new"`, ou seja, nova aba). RECONNECT-02 é gerenciado por `log-prompt.sh` e
> **não** incrementa `logical_session_number`. Isso é design intencional: uma `inline_restart` é uma
> continuação da mesma sessão lógica VS Code, não um novo número lógico.

---

### 19.6 Evidência Empírica desta Análise

O cenário que motivou esta seção foi observado no `audit.jsonl` desta sessão:

```json
{"event": "sessionCloseAuthorized", "session_id": "dcf579af-...", "timestamp": "2026-03-12T01:38:07Z"}
...
{"event": "userPromptSubmitted",    "session_id": "dcf579af-...", "timestamp": "2026-03-12T09:12:52Z"}
{"event": "sessionStart_inline",    "session_id": "dcf579af-...", "timestamp": "2026-03-12T09:12:53Z",
 "message": "Nova sessão inline após fechamento"}
```

Intervalo de ~7,5 horas entre o fechamento autorizado e o novo prompt na mesma aba. O RECONNECT-02
foi ativado corretamente, gerando nova `close_key` e resetando `turn_count`.

Estado do CTX após RECONNECT-02 (confirmado via `session-context.json`):

- `session.source`: `"inline_restart"` ✅
- `session.id` === `session.vs_code_session_id` === `session.prev_session_id` = `"dcf579af-..."` ✅
  (esperado)
- `session.ended_at`: `null` ✅
- `session_stats.turn_count`: `0` ✅

---

## 20. Hierarquia SESSION / SECTION / TURN — Análise Técnica Completa

> **Versão**: v2.3 | **Adicionada em**: 2026-03-13 Análise baseada na leitura integral de
> `log-prompt.sh`, `session-start.sh`, `start-section.sh`, `start-turn.sh`, `agent-stop.sh`,
> `section-end.sh` e `continue-section.sh`.

---

### 20.1 Definição Formal dos Três Níveis

```
┌──────────────────────────────────────────────────────────────┐
│  SESSION  (1 por painel de chat)                             │
│  ├── SECTION  (N por SESSION — fases lógicas do agente)      │
│  │   ├── TURN  (N por SECTION — ciclos prompt→resposta)      │
│  │   ├── TURN                                                │
│  │   └── TURN                                                │
│  └── SECTION                                                 │
│      └── TURN                                                │
└──────────────────────────────────────────────────────────────┘
```

| Conceito    | O que é                                     | Quem cria                   | Quem encerra                   |
| ----------- | ------------------------------------------- | --------------------------- | ------------------------------ |
| **SESSION** | 1 painel de chat do VS Code Copilot         | `session-start.sh` (auto)   | `session-close.sh` (manual)    |
| **SECTION** | Fase lógica temática definida pelo agente   | `start-section.sh` (manual) | `section-end.sh` ou auto-close |
| **TURN**    | 1 ciclo `userPromptSubmitted` → `agentStop` | `log-prompt.sh` (auto)      | `agent-stop.sh` (auto)         |

**INVARIANTE ABSOLUTA**: sempre deve haver SESSION + SECTION + TURN simultaneamente ativos. O
`agent-stop.sh` garante isso criando automaticamente uma seção `"retomada"` se `current_section` for
`null`.

---

### 20.2 `session_id` — Fonte de Verdade Única

> **Princípio canônico**: `session_id` é SEMPRE definido pelo VS Code. O repositório apenas o lê,
> persiste e sincroniza. Nunca geramos um `session_id` por conta própria.

**Campo no payload da plataforma**: cada hook recebe `sessionId` no JSON de entrada (exceto
`SessionEnd`, onde o campo pode ser vazio ou diferente — ver LIM-04).

**Onde o `session_id` é lido do payload**:

| Script             | Campo lido                | Contexto                              |
| ------------------ | ------------------------- | ------------------------------------- |
| `session-start.sh` | `sessionId` do JSON stdin | Cria CTX zerado com o ID do VS Code   |
| `log-prompt.sh`    | `sessionId` do JSON stdin | Diagnóstico de continuidade / heals   |
| `agent-stop.sh`    | `sessionId` do JSON stdin | Guard + heals antes de qualquer write |
| `pre-tool-use.sh`  | `sessionId` do JSON stdin | Bloqueio de `session-close.sh` direto |
| `post-tool-use.sh` | `sessionId` do JSON stdin | Detecção de `vscode_askQuestions`     |
| `pre-compact.sh`   | `sessionId` do JSON stdin | Salvamento de estado pré-compactação  |

**Caminhos de sincronização / heal** (quando CTX e payload divergem):

| Cenário                        | Script          | Ação                                       | Evento LogadO                    |
| ------------------------------ | --------------- | ------------------------------------------ | -------------------------------- |
| `source=manual_recovery`       | `log-prompt.sh` | Adota payload, seta `source=healed`        | `sessionId_healed`               |
| `source=inline_restart`        | `agent-stop.sh` | Sincroniza CTX para o ID do payload        | `session_id_sync_inline_restart` |
| 3× mismatch consecutivo        | `agent-stop.sh` | HEAL v2: adota payload, `source=healed_v2` | `session_id_healed_v2`           |
| Session_id mudou (novo painel) | `log-prompt.sh` | RECONNECT-01: rollover de sessão           | `sessionStart_synthetic`         |
| `ended_at` != null             | `log-prompt.sh` | RECONNECT-02: restart inline               | `sessionStart_inline`            |

**Campo duplicado intencionalmente**: `session.id` e `session.vs_code_session_id` no CTX guardam o
mesmo UUID — `vs_code_session_id` é lido-only após o primeiro write, servindo como registro de
auditoria do ID original recebido do VS Code. Faz parte do contrato desde sempre preservar ambos
sincronizados.

---

### 20.3 Ciclo de Vida Completo com Responsável por Campo

#### SESSION

```
VS Code: sessionStart event
         └── session-start.sh
               ├── Lê sessionId do payload  ← FONTE DE VERDADE
               ├── Gera close_key (ENCERRAR-XXXXXXXX via openssl)
               ├── Gera initial_section_id + initial_turn_id (uuidgen)
               ├── Calcula logical_session_number
               │   ├── source=inline_restart AND prev_num > 0 → preserva prev_num
               │   └── else → prev_num + 1
               └── Escreve session-context.json (CTX):
                   ├── source=inline_restart: write parcial (só session.*)
                   └── else: CTX zerado completo
```

**Encerramento de SESSION** (único fluxo legítimo):

1. Agente chama `vscode_askQuestions` com Template F (exibe `close_key`)
2. Usuário digita `ENCERRAR-XXXXXXXX` na resposta
3. `post-tool-use.sh` detecta KEY → chama `session-close.sh` automaticamente
4. `session-close.sh` → `session-end.sh` → seta `session.ended_at`, gera relatório final

#### SECTION

```
Agente: bash start-section.sh "nome" ["descrição"]
         ├── Se há seção ativa: auto-fecha (sectionEnd reason="auto_closed_by_new_section")
         │   ├── Calcula duration_s e turns_covered da seção anterior
         │   └── Gera generate-section-summary.sh
         └── Cria nova seção:
               section_id = uuidgen
               section_number = section_count + 1
               local_turn = 0
               turn_start = session_stats.turn_count + 1   ← turno CORRENTE
               push_count = 0
               intent_history = []
               failures_count = 0
               blocked_turns = 0
               ─
               Atualiza: session_stats.section_count += 1
               Atualiza: session_stats.section_names += [nome]
               Atualiza: session_stats.section_history += [...] (cap 50)
               ─ NOVO BUG-S02 FIX:
               Reseta: current_turn.section_turn = 0
```

**Encerramento manual** via `section-end.sh`:

- Seta `current_section = {name: null, ...}` → invariant window (nulo até próximo agentStop)
- `agent-stop.sh` auto-cria `"retomada"` se detectar seção nula

#### TURN

```
VS Code: userPromptSubmitted event
          └── log-prompt.sh
                ├── FASE 0 — Reconciliação de session_id (heals + RECONNECTs)
                ├── Incrementa current_section.local_turn  += 1
                ├── Seta current_turn.section_turn          = local_turn (após incremento)
                ├── Seta current_turn.number                = session_stats.turn_count + 1
                ├── Gera current_turn.turn_id               = uuidgen
                ├── Seta current_turn.started_at            = NOW_ISO
                └── Loga turnStart em audit.jsonl

(Agente executa — ferramentas, lógica, etc.)

Agente (opcional): bash start-turn.sh "intenção"
                    ├── Lê askquestions_api_error → alerta se true
                    ├── Loga turnStart_enriched (intent + turn_id + section_id)
                    └── Seta current_turn.intent_declared = true
                             current_turn.intent = "..."

VS Code: agentStop event
          └── agent-stop.sh
                ├── flock -x -w 3 (exclusivo no CTX_FILE)
                ├── GUARD: session_id do payload vs CTX (heals se divergir)
                ├── Calcula TURN_DURATION_S
                ├── Loga agentStop em audit.jsonl
                ├── Detecção de autorização (4 estratégias)
                │   ├── Strat 1: busca vscode_askQuestions APÓS último userPromptSubmitted
                │   ├── Strat 2: (removida v7.0 — falso positivo cross-turn)
                │   ├── Strat 3: current_turn.auth_requested do CTX
                │   └── Strat 4: current_turn.subagent_delegated
                ├── Blocking (se não autorizado e não stop_hook_active):
                │   ├── turn_count >= 1: emite decision:block
                │   └── Incrementa compliance.consecutive_unauthorized
                ├── Autorizado: compliance.consecutive_unauthorized = 0
                │              loga turnEnd_authorized
                ├── Atualiza counters no CTX:
                │   ├── session_stats.turn_count += 1
                │   ├── session_stats.turn_authorized += 1  (ou turn_no_askQuestions)
                │   ├── session_stats.turns_since_askQuestions = 0 (se auth) ou +1
                │   ├── session_stats.turn_history append (cap 20)
                │   └── current_turn.number = TURN_NUMBER + 1  (pre-fill para próximo TURN)
                ├── Reseta campos do current_turn (auth_requested, intent, etc.)
                ├── Auto-cria seção "retomada" se current_section == null
                ├── session-checkpoint.sh (a cada TURN)
                └── sync-tasks-to-docs.sh (a cada 5 TURNs)
```

---

### 20.4 Tabela Completa de Campos por Nível

#### `session.*` — Persistido em `session-context.json`

| Campo                    | Tipo     | Quem escreve       | Quando muda                          | Reset em RECONNECT-02?    |
| ------------------------ | -------- | ------------------ | ------------------------------------ | ------------------------- |
| `id`                     | string   | `session-start.sh` | Novo painel VS Code                  | Sim (novo UUID)           |
| `vs_code_session_id`     | string   | `log-prompt.sh`    | HEAL ou RECONNECT-01                 | Sim                       |
| `started_at`             | ISO 8601 | `session-start.sh` | Novo painel / RECONNECT-02           | Sim                       |
| `ended_at`               | ISO 8601 | `session-close.sh` | Encerramento autorizado              | Sim (null)                |
| `close_key`              | string   | `log-prompt.sh`    | RECONNECT-02 (nova key gerada)       | Sim                       |
| `close_key_validated`    | bool     | `post-tool-use.sh` | KEY detectada em vscode_askQuestions | Sim (false)               |
| `source`                 | string   | `session-start.sh` | Varia por cenário                    | Não (fica inline_restart) |
| `logical_session_number` | int      | `session-start.sh` | Cada nova SESSION real               | Não (preservado)          |
| `prev_session_id`        | string   | `log-prompt.sh`    | RECONNECT-02                         | Sim                       |
| `prev_ended_at`          | ISO 8601 | `log-prompt.sh`    | RECONNECT-02                         | Sim                       |
| `prev_end_reason`        | string   | `log-prompt.sh`    | RECONNECT-02                         | Sim                       |

#### `session_stats.*` — Métricas da sessão

| Campo                        | Tipo  | Quem incrementa       | Reset em RECONNECT-02?                             |
| ---------------------------- | ----- | --------------------- | -------------------------------------------------- |
| `turn_count`                 | int   | `agent-stop.sh` (fim) | **Sim** → 0                                        |
| `turn_authorized`            | int   | `agent-stop.sh` (fim) | **Sim** → 0 (v2.3, BUG-S03 fix; salvo em prev\_\*) |
| `turn_no_askQuestions`       | int   | `agent-stop.sh` (fim) | **Sim** → 0 (v2.3, BUG-S03 fix; salvo em prev\_\*) |
| `turns_since_askQuestions`   | int   | `agent-stop.sh` (fim) | **Sim** → 0 (FIX-01)                               |
| `section_count`              | int   | `start-section.sh`    | **Não** (acumulado entre restarts)                 |
| `section_names`              | []str | `start-section.sh`    | **Não** (acumulado entre restarts)                 |
| `section_history`            | []obj | `start-section.sh`    | **Não** (cap 50)                                   |
| `turn_history`               | []obj | `agent-stop.sh` (fim) | **Não** (cap 20)                                   |
| `tools_total`                | int   | `post-tool-use.sh`    | **Não**                                            |
| `tools_by_name`              | obj   | `post-tool-use.sh`    | **Não**                                            |
| `failures_detected`          | int   | Vários scripts        | **Sim** → 0                                        |
| `pending_section_after_push` | bool  | `on-git-push.sh`      | **Não**                                            |
| `push_count`                 | int   | `on-git-push.sh`      | **Não**                                            |
| `prev_turn_authorized`       | int   | `log-prompt.sh`       | Setado no RECONNECT-02 (snapshot antes do reset)   |
| `prev_turn_no_askQuestions`  | int   | `log-prompt.sh`       | Setado no RECONNECT-02 (snapshot antes do reset)   |

> **Nota sobre o split turn_count/section_count**: Em RECONNECT-02, `turn_count=0` mas
> `section_count` mantém o acumulado histórico. Isso é **intencional**: turns representam atividade
> no painel atual (contexto de blocking/warm-up), enquanto sections são continuidade lógica do
> trabalho (preservadas para briefing e recovery).

#### `current_section.*` — Estado vivo da seção ativa

| Campo            | Tipo     | Quem escreve       | Resetado quando                      |
| ---------------- | -------- | ------------------ | ------------------------------------ |
| `name`           | string   | `start-section.sh` | Nova seção / `section-end.sh` → null |
| `section_id`     | UUID     | `start-section.sh` | Nova seção (uuidgen)                 |
| `section_number` | int      | `start-section.sh` | Nova seção (= section_count)         |
| `started_at`     | ISO 8601 | `start-section.sh` | Nova seção                           |
| `turn_start`     | int      | `start-section.sh` | Nova seção (= turn_count + 1 atual)  |
| `local_turn`     | int      | `log-prompt.sh`    | Resetado a 0 ao abrir nova seção     |
| `description`    | string?  | `start-section.sh` | Nova seção                           |
| `push_count`     | int      | `on-git-push.sh`   | Resetado a 0 ao abrir nova seção     |
| `intent_history` | []str    | `start-turn.sh`    | Resetado a [] ao abrir nova seção    |
| `failures_count` | int      | `agent-stop.sh`    | Resetado a 0 ao abrir nova seção     |
| `blocked_turns`  | int      | `agent-stop.sh`    | Resetado a 0 ao abrir nova seção     |
| `tools_by_name`  | obj      | `post-tool-use.sh` | Resetado a {} ao abrir nova seção    |

#### `current_turn.*` — Estado vivo do turno atual

| Campo                    | Tipo     | Quem escreve                      | Quando resetado                          |
| ------------------------ | -------- | --------------------------------- | ---------------------------------------- |
| `number`                 | int      | `log-prompt.sh` / `agent-stop.sh` | Cada turn (= turn_count + 1)             |
| `section_turn`           | int      | `log-prompt.sh`                   | Cada turn (= local_turn após incremento) |
| `turn_id`                | UUID     | `log-prompt.sh`                   | Cada turn (uuidgen)                      |
| `started_at`             | ISO 8601 | `log-prompt.sh`                   | Cada turn                                |
| `intent`                 | string?  | `start-turn.sh`                   | Fim de turn (agent-stop.sh → null)       |
| `intent_declared`        | bool     | `start-turn.sh`                   | Fim de turn → false                      |
| `auth_requested`         | bool     | `post-tool-use.sh`                | Fim de turn → false                      |
| `tools_count`            | int      | `post-tool-use.sh`                | Fim de turn → 0                          |
| `tools_by_name`          | obj      | `post-tool-use.sh`                | Fim de turn → {}                         |
| `failures_count`         | int      | `tool-use-failure.sh`             | Fim de turn → 0                          |
| `block_count`            | int      | `agent-stop.sh` (blocking)        | Fim de turn → 0                          |
| `todo_created`           | bool     | `pre-tool-use.sh`                 | Fim de turn → false                      |
| `subagent_delegated`     | bool     | `pre-tool-use.sh`                 | Fim de turn → false                      |
| `agentStop_invocations`  | int      | `agent-stop.sh` (início)          | Resetado pela auto-retomada              |
| `askquestions_api_error` | bool     | `post-tool-use.sh`                | Lido e limpo por `start-turn.sh`         |

---

### 20.5 Semântica dos Contadores de TURN

O contador `session_stats.turn_count` representa **TURNs COMPLETOS finalizados** na sessão:

```
Início da SESSION: turn_count = 0

TURN 1 começa:
  log-prompt.sh → current_turn.number = turn_count + 1 = 1

TURN 1 termina:
  agent-stop.sh → session_stats.turn_count = turn_count + 1 = 1
  agent-stop.sh → current_turn.number = 1 + 1 = 2  (pré-fill para TURN 2)

TURN 2 começa:
  log-prompt.sh → current_turn.number = turn_count + 1 = 2  (idêntico ao pré-fill)
```

**Por que o pré-fill?** Em `agent-stop.sh`, após incrementar `turn_count`, o script imediatamente
seta `current_turn.number = TURN_NUMBER + 1`. isso garante que o CTX nunca mostre o número do turn
anterior durante a janela entre agentStop e o próximo log-prompt.sh.

**Relação `section_turn` (local) vs `turn.number` (global)**:

```
SESSION: turn_count=0, section=A
  TURN 1 → section_turn=1, global=1
  TURN 2 → section_turn=2, global=2

bash start-section.sh "B"
  → new section: local_turn=0, current_turn.section_turn=0 (BUG-S02 FIX)

SESSION: turn_count=2, section=B
  TURN 3 → section_turn=1, global=3
  TURN 4 → section_turn=2, global=4
```

**`turns_since_askQuestions`**: zerado quando `AUTH_REQUESTED=true` ao fim do turno; incrementado
quando `AUTH_REQUESTED=false`. Também zerado no RECONNECT-02 (FIX-01). Usado no nudge periódico.

---

### 20.6 Bugs Identificados e Corrigidos (v2.3)

| ID      | Localização             | Descrição                                                              | Linha afetada | Status       |
| ------- | ----------------------- | ---------------------------------------------------------------------- | ------------- | ------------ |
| BUG-S01 | `agent-stop.sh` L774    | Auto-"retomada" missing `local_turn: 0` no objeto                      | ~774          | ✅ Corrigido |
| BUG-S02 | `start-section.sh` L150 | `current_turn.section_turn` stale após troca de seção                  | ~150, ~157    | ✅ Corrigido |
| BUG-S03 | `log-prompt.sh` L234    | `turn_authorized`/`turn_no_askQuestions` não resetados em RECONNECT-02 | ~232, ~260    | ✅ Corrigido |

**BUG-S01 — Detalhe**: A seção auto-criada `"retomada"` no `agent-stop.sh` (invariante
SESSION+SECTION+TURN) não incluía `local_turn: 0` no objeto. O fallback `// 0` no `log-prompt.sh`
compensava funcionalmente, mas a omissão era uma inconsistência semântica versus o schema gerado por
`start-section.sh`. Impacto: cosmético.

**BUG-S02 — Detalhe**: Quando o agente chama `start-section.sh` durante um TURN (o que é o caso
normal), o `current_turn.section_turn` permanecia com o valor do TURN anterior na seção A. O
`agent-stop.sh` logava aquele turn com `section_name=B` mas `section_turn=X` (de A). O nudge do
`systemMessage` também mostrava a contagem errada. FIX: dois `_JQ_FILTER` (branches com/sem
descrição) agora incluem `| .current_turn.section_turn = 0`.

**BUG-S03 — Detalhe**: Em RECONNECT-02 (inline restart), `turn_count` era zerado mas
`turn_authorized` e `turn_no_askQuestions` preservavam valores históricos. Isso criava
inconsistência: `turn_count=0` (nenhum turno nesta sessão) mas `turn_authorized=8` (turno de sessão
anterior). FIX: ambos os campos são resetados a 0; valores históricos são preservados em
`prev_turn_authorized` e `prev_turn_no_askQuestions` para auditoria.

---

### 20.7 Gaps de Design Documentados

| ID      | Descrição                                                                            | Impacto | Resolução                                                                       |
| ------- | ------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------- |
| GAP-S01 | `section_count`/`section_names` NÃO resetados em RECONNECT-02                        | Baixo   | **CORRIGIDO v2.4** — reset com snapshot `prev_section_count/names`              |
| GAP-S02 | `section-end.sh` deixa `current_section=null` (janela de violação da invariante)     | Baixo   | **CORRIGIDO v2.5** — `is_closed=true` preserva nome; agent-stop.sh detecta flag |
| GAP-S03 | Raio-de-heal do `session_id` não cobre todos os scripts de hook edge-case            | Médio   | **CORRIGIDO v2.5** — `session-end.sh` recebeu `SESSION_ID_PAYLOAD` + HEAL v1    |
| GAP-S04 | `logical_session_number` não propagado aos eventos `turnStart`/`sessionStart_inline` | Baixo   | **CORRIGIDO v2.4** — campo adicionado + incremento em RECONNECT-02              |

**GAP-S01 — Correção v2.4**: `section_count` e `section_names` agora são resetados em RECONNECT-02
com snapshot em `prev_section_count`/`prev_section_names`. Isso garante consistência com
`turn_count` (que já era resetado). O motivo da mudança: RECONNECT-02 inicia uma nova sessão lógica
— seções devem começar a numerar do #1 novamente. Histórico preservado em `audit.jsonl` e nos
snapshots `prev_*`.

**GAP-S02 — Correção v2.5**: `section-end.sh` agora marca a seção com `is_closed=true` e
`closed_at=<timestamp>` em vez de anular todos os campos de `current_section`. Isso preserva o
`current_section.name` durante a janela transitória — ferramentas chamadas entre `section-end.sh` e
`start-section.sh` continuam logando o nome correto da seção anterior. `agent-stop.sh` detecta
`is_closed=true` como equivalente a `name=null` para fins de invariante, criando seção "retomada" se
necessário. `start-section.sh` sobrescreve `current_section` completamente — o flag `is_closed` é
limpo naturalmente ao abrir nova seção. **Ação recomendada**: sempre chamar
`start-section.sh "nova-seção"` imediatamente após `section-end.sh`.

**GAP-S03 — Correção v2.5**: `session-end.sh` era o único script invocado pelo VS Code via hook
(`sessionEnd`) que não extraía `SESSION_ID_PAYLOAD` do payload nem aplicava HEAL v1. Todos os outros
9 scripts VS Code-invocados já tinham HEAL. A correção adiciona:

1. Extração de `SESSION_ID_PAYLOAD` do stdin (no bloco de parse do INPUT)
2. Bloco HEAL v1: se payload != CTX e CTX.source == `"manual_recovery"`, atualiza CTX e loga evento
3. Branch `inline_restart`: adota CTX como verdade (payload pode estar stale) Impacto: `sessionEnd`
   agora usa o `session_id` correto em todos os eventos e relatórios finais, incluindo o resumo de
   sessão, mesmo após cenários de manual_recovery.

**GAP-S04 — Correção v2.4**: `logical_session_number` agora é:

1. **Incrementado** em RECONNECT-02 (nova sessão lógica → número lógico aumenta)
2. **Gravado no CTX** em `session.logical_session_number`
3. **Propagado** ao evento `turnStart` em `audit.jsonl` (campo `logical_session_number`)
4. **Propagado** ao evento `sessionStart_inline` com `logical_session_number` +
   `prev_logical_session_number`

**UPG-AUDIT-01 — Planejado (não implementado)**: audit file isolado por `SESSION_ID`. O modelo atual
usa `audit.jsonl` e `session-context.json` globais (compartilhados entre sessões). O upgrade
produzirá `logs/audit-{SID_SHORT}.jsonl` e `state/session-context-{SID_SHORT}.json` por sessão, com
symlinks backward-compat e `state/current-session-id.txt` como ponteiro global. Plano detalhado com
36 sub-tarefas em `PLANO-CORRECOES-HOOKS.md` → Seção 8.

---

### 20.8 Fluxo Completo de `session_id` por Cenário

```
Cenário A — Nova SESSION (botão + no chat):
  VS Code → sessionStart → session_id_payload = "uuid-novo"
  session-start.sh → CTX.session.id = uuid-novo ✓

Cenário B — TURN normal (mesma SESSION):
  VS Code → userPromptSubmitted → session_id_payload = "uuid-A"
  log-prompt.sh → verifica CTX.session.id == "uuid-A" → OK, sem heal

Cenário C — RECONNECT-02 (ended_at != null, mesmo UUID):
  VS Code → userPromptSubmitted → session_id_payload = "uuid-A"
  log-prompt.sh → CTX.session.ended_at != null → RECONNECT-02
    → CTX.session.id = "uuid-A" (mantém o mesmo)
    → CTX.session.prev_session_id = "uuid-A" (confirmação da continuidade)
    → CTX.session.started_at = NOW (novo timestamp)
    → close_key = ENCERRAR-XXXXXXXX (nova key)

Cenário D — RECONNECT-01 (session_id mudou = novo painel):
  VS Code → userPromptSubmitted → session_id_payload = "uuid-B"
  log-prompt.sh → CTX.session.id = "uuid-A" ≠ "uuid-B" → RECONNECT-01
    → Rollover: salva dados da sessão A
    → CTX.session.id = "uuid-B" — ADOTA O PAYLOAD ✓

Cenário E — HEAL v1 (source=manual_recovery):
  VS Code → userPromptSubmitted → session_id_payload = "uuid-X"
  log-prompt.sh → CTX.source == "manual_recovery" → HEAL v1
    → CTX.session.id = "uuid-X" — ADOTA O PAYLOAD ✓
    → CTX.source = "healed_from_real_session"

Cenário F — HEAL v2 (3× mismatch em agent-stop.sh):
  VS Code → agentStop → session_id_payload = "uuid-Y" != CTX.session.id
  agent-stop.sh → mismatch_track.json incrementa contador
    → Se 3× mesmo "uuid-Y" → HEAL v2: CTX.session.id = "uuid-Y" ✓
    → Se 1-2× → loga mismatch, não bloqueia CTX write
```

**Princípio canônico**: em qualquer heal, o UUID que GANHA é sempre o do payload do VS Code. O
repositório NUNCA gera um UUID de sessão por conta própria.

---

## 21. Referências

### Documentação Oficial

| Recurso                          | URL                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| Agent hooks in VS Code (Preview) | https://code.visualstudio.com/docs/copilot/customization/hooks         |
| Customização geral do Copilot    | https://code.visualstudio.com/docs/copilot/copilot-customization       |
| Custom agents                    | https://code.visualstudio.com/docs/copilot/customization/custom-agents |

### Documentação Interna

| Recurso                           | Localização                                            |
| --------------------------------- | ------------------------------------------------------ |
| Relatório de Session Hardening v3 | `DOCUMENTAÇÃO/HOOKS/RELATORIO-SESSION-HARDENING-v3.md` |
| Scripts dos hooks                 | `.github/hooks/scripts/*.sh`                           |
| Configuração dos hooks            | `.github/hooks/copilot-hooks.json`                     |
| Contrato de eventos               | `.github/hooks/contracts/events-contract.md`           |
| Schema do session-context         | `.github/hooks/contracts/session-context.schema.json`  |
| Protocolo de hooks (instruções)   | `.github/instructions/hooks-protocol.instructions.md`  |
| Briefing da sessão atual          | `.github/hooks/state/session-briefing.md`              |
| Log de auditoria                  | `.github/hooks/logs/audit.jsonl`                       |
| Script de leitura do transcript   | `.github/hooks/scripts/read-transcript.sh`             |

---

\_Documento gerado em 2026-03-11. Versão 2.5 (2026-03-13): GAP-S02 corrigido — section-end.sh usa
is_closed=true em vez de null; agent-stop.sh detecta is_closed para invariante. GAP-S03 corrigido —
session-end.sh agora extrai SESSION_ID_PAYLOAD e aplica HEAL v1 (era o único hook VS Code invocado
sem HEAL). UPG-AUDIT-01 planejado: audit file isolado por SESSION_ID, documentado na Seção 8 do
PLANO (36 sub-tarefas, não implementado). Seção 20.7 atualizada. Versão 2.4 (2026-03-13): GAP-S01
corrigido — section_count e section_names agora resetados em RECONNECT-02 (com snapshot
prev_section_count/prev_section_names). GAP-S04 corrigido — logical_session_number incrementado em
RECONNECT-02 e propagado aos eventos turnStart e sessionStart_inline em audit.jsonl. Seção 20.7
atualizada (GAP-S01 e GAP-S04 marcados como FIXED). Versão 2.3 (2026-03-13): Seção 20 adicionada —
hierarquia completa SESSION/SECTION/TURN: definições formais, ciclo de vida por responsável, tabelas
de campos CTX, semântica de contadores, paths de sincronização de `session_id`. BUG-S01 corrigido
(auto-"retomada" missing `local_turn:0` em `agent-stop.sh`). BUG-S02 corrigido
(`current_turn.section_turn` stale após `start-section.sh` — ambos os branches). BUG-S03 corrigido
(`turn_authorized`/`turn_no_askQuestions` não resetados em RECONNECT-02 — com snapshot `prev\__`).
Referências renumeradas para Seção 21. TOC atualizado. Versão 2.2 (2026-03-12): Seção 18 adicionada
— Achados de Auditoria Proativa (Exploratory Bug Hunt): EBH-M01 (pre-tool-use.sh auto_recovery —
corrigido), EBH-M02 (agent-stop.sh CTX_FILE.tmp estático — corrigido), EBH-M03 (session-start.sh
LOGICAL_SESSION_NUMBER poderia ser 0 — corrigido), EBH-L01 (subagent-start/stop.sh sem fallback
mktemp — corrigido), EBH-L02 e EBH-L03 (baixa severidade — documentados). Seção 19 renomeada (era
Seção 18 — Referências). Versão 2.1 (2026-03-12): BUG-05 aplicado em Seção 3.1 — distinção explícita
entre `source`do VS Code (sempre`"new"`) e `session.source`do CTX (múltiplos valores); UPG-01
—`session.logical_session_number`e`session.logical_restart_at`adicionados ao CTX
em`session-start.sh`(incrementa em sessões`source=new`, preservado em `inline_restart`; briefing
exibe nova linha "Sessão lógica"); UPG-03 — tabela "Estado Ativo" do briefing expandida com "Origem
da sessão" (com descrição por valor de `$SOURCE`) e estado de preservação de estatísticas; G9-11 —
função `strip_sensitive_json_keys()`adicionada a`hooks-lib/common.sh`: redação estrutural por
denylist de chaves JSON sensíveis (password, token, api_key, secret, close_key, etc.), integrada em
`pre-tool-use.sh`como Camada 0 antes de`redact_credentials`. Versão 2.0 (2026-03-12): Ciclo completo
de correções de bugs e gaps em 17 itens implementados (BUG-01 a BUG-17, GAP-01 a GAP-05) nos 10
scripts de hooks e em `hooks-lib/common.sh`, mais ROB-B e GAP-O1 adicionados nesta mesma versão.
Principais correções desta versão: BUG-16 — guard de `session_id`em`tool-use-failure.sh`movido para
ANTES dos writes de`audit.jsonl`e`errors.jsonl`(evita contaminação de log com session_id errado em
caso de mismatch); BUG-17 — HEALs inline
de`manual_recovery`em`pre-tool-use.sh`e`post-tool-use.sh`agora atualizam também o
campo`.session.vs_code_session_id`(já correto em`common.sh`); GAP-05 — schema de
`session-start.sh`completo:`session_stats`recebe`subagent_completions`e`askquestions_api_failures`;
`current_turn`recebe`section_turn`, `todo_created`, `block_count`,
`agentStop_invocations`e`subagent_delegated`; ROB-B — padronização do sourcing de `common.sh`em
todos os 8 scripts de hook com mensagem`[WARN]`quando a lib não é encontrada (antes era silencioso);
GAP-O1 — log`session_id_sync_inline_restart`em`pre-tool-use.sh`e`post-tool-use.sh`agora limitado a 5
ocorrências por sessão (6ª emite evento`\_cap`), eliminando ruído excessivo em sessões longas; ROB-C
— confirmado que o padrão `jq -r ... 2>/dev/null || echo 'default'`já é uniforme em todos os scripts
(nenhuma alteração necessária). Ver`DOCUMENTAÇÃO/HOOKS/PLANO-CORRECOES-HOOKS.md`para histórico
completo de todos os 24+ itens implementados.`vscode_askQuestions`: todos os Templates A–G no
AGENTS.md reescritos com campos canônicos (`header`≤50 chars,`question`≤200
chars,`options: [{label}]`, `multiSelect`, `allowFreeformInput`). Seção 16.2 reescrita com tabela de
campos, anti-patterns, regras de hardening e exemplo completo. Seção 16.3 atualizada com exemplo de
lookup correto (`question.header`como chave) e hardening de detecção de mismatch. Cabeçalho do
documento atualizado de v1.6 para v1.9 (versões 1.7 e 1.8 não tinham atualizado o cabeçalho). (3115
linhas) Versão 2.2 (2026-03-12): Seção 19 adicionada — análise aprofundada do ciclo de vida de
prompt vs sessão: taxonomia completa dos 6 cenários (A-F), fluxo de decisão de`log-prompt.sh`Fase 0,
análise detalhada por cenário, gaps GAP-ARCH-01 a 05, tabela de status e evidência empírica. FIX-01
aplicado em`log-prompt.sh`: `session_stats.turns_since_askQuestions`agora resetado em RECONNECT-02
(inline_restart). Seção 12.2 corrigida (GUIA-CORR-01): afirmação incorreta sobre geração de UUID
novo removida. Seção 20 (Referências, renumerada de 19). TOC atualizado. Versão 1.8 (2026-03-11):
Seção 17.11 adicionada — diagnóstico empírico do erro`vscode_askQuestions`"Response contained no
choices": padrão no transcript, artefato visual de "corrupção" na UI, causa raiz (contexto/API
limit), 4 hardenings implementados + bridge. Investigação confirmou que GUIA v1.7 está limpo (2914
linhas) — o usuário viu artefato da UI, não corrupção real. Interrupção antes do prompt #14 foi
"unauthorized turn end" (turn #135 encerrou sem askQuestions após série de read_file calls). Versão
1.7 (2026-03-11): Seção 17.10 adicionada — descoberta do Transcript JSONL como log filesystem
acessível por LLMs; schemas completos dos 7 tipos de eventos, análise empírica de 6 sessões reais,
padrão de falhas entre sessões, limitações do transcript vs. Debug Panel, e
script`read-transcript.sh`(shellcheck limpo) criado em`.github/hooks/scripts/`. Investigação de
interrupção confirmou: causa = compactação inline do contexto pelo VS Code (inline compaction),
turno anterior encerrou com `turnEnd_authorized`. Versão 1.6 (2026-03-11): Seção 17 adicionada —
investigação completa do Agent Debug Panel ("Chat Debug" view), incluindo arquitetura interna
(classe UK, pipeline de eventos, trajectoryLogger), todas as 5 categorias de eventos com schemas
completos (`loopControl`, `toolCall`, `llmRequest`, `error`, `discovery`), mapa de comandos de
acesso, comparação com nosso audit.jsonl e recomendações de complementação. Baseado em análise
direta do código-fonte de `github.copilot-chat-0.39.0/dist/extension.js`e`package.json`. Versão 1.5
(2026-03-11): Seções 15.10–15.16 adicionadas — investigação profunda do ciclo de vida de subagentes.
Seção 16 adicionada: schemas de `vscode_askQuestions`e`manage_todo_list`, hardenings de inline
compaction. Baseado em: documentação oficial VS Code (março/2026), evidência empírica do audit.jsonl
e análise direta do código-fonte da extensão `github.copilot-chat-0.39.0`.\*
