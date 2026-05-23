# Relatorio consolidado — Autonomia maxima do ChatGPT sobre o repo via MCP

**Data:** 2026-05-23  
**Escopo:** `src/copilot/`  
**Documento-base lido integralmente:** `src/copilot/docs/Plano consolidado de autonomia maxima.md`  
**Objetivo:** reduzir bloqueios e janelas de autorizacao no `https://chatgpt.com/`, aumentando o
poder pratico do ChatGPT sobre este repo por meio do MCP server.

---

## 1. Sumario executivo

O problema observado nao e um unico bug. Ele e a soma de quatro camadas:

1. Politica do proprio host ChatGPT para write actions.
2. Falta de hints completos em algumas annotations MCP.
3. Superficie de tools ainda granular demais para fluxos longos.
4. Ausencia de ferramentas agregadoras que transformem varias chamadas write/validation em uma
   chamada allowlisted.

A documentacao oficial confirma o ponto central: Developer Mode fornece acesso MCP amplo a tools
read e write, mas write actions exigem confirmacao por padrao. Tools sem `readOnlyHint` podem ser
tratadas como write. O servidor nao consegue desligar a UI de confirmacao do ChatGPT. O que ele
consegue fazer e:

1. Marcar reads como read-only e idempotentes.
2. Separar write reversivel de destructive.
3. Usar nomes e descricoes que reduzam ambiguidade.
4. Trocar delete por quarantine.
5. Trocar comandos soltos por suites allowlisted.
6. Trocar muitas micro-acoes por maintenance batch.
7. Delegar trabalho longo para um runner local nosso quando a UI do ChatGPT vira gargalo.

Portanto, a situacao ideal realista nao e "zero confirmacoes". A situacao ideal e:

```text
read tools sem prompts
bounded writes com confirmacao lembravel por conversa
destructive quase nunca usado
validacao e manutencao em batch
runner local para execucao longa
```

---

## 2. Fontes oficiais consideradas

1. OpenAI Apps SDK Quickstart  
   URL: `https://developers.openai.com/apps-sdk/quickstart`  
   Ponto aplicado: apps usam MCP para conectar ao ChatGPT; o MCP server define capabilities/tools.

2. OpenAI ChatGPT Developer Mode  
   URL: `https://developers.openai.com/api/docs/guides/developer-mode`  
   Pontos aplicados:
   - Developer Mode fornece suporte MCP para tools read e write.
   - Streaming HTTP e SSE sao protocolos aceitos.
   - OAuth, No Authentication e Mixed Authentication sao suportados.
   - Tools podem ser gerenciadas/refrescadas em app settings.
   - Write actions exigem confirmacao por padrao.
   - `readOnlyHint` e respeitado.
   - aprovacoes lembradas valem para a conversa e podem voltar apos refresh/nova conversa.

3. OpenAI Apps SDK Reference  
   URL: `https://developers.openai.com/apps-sdk/reference`  
   Pontos aplicados:
   - annotations relevantes: `readOnlyHint`, `destructiveHint`, `openWorldHint`, `idempotentHint`.
   - esses hints influenciam como o ChatGPT enquadra a chamada.
   - o servidor ainda precisa impor a propria autorizacao.

4. OpenAI Apps SDK Define tools  
   URL: `https://developers.openai.com/apps-sdk/plan/tools`  
   Pontos aplicados:
   - uma tarefa por tool.
   - inputs explicitos, enums e defaults documentados.
   - outputs previsiveis e estruturados.
   - separar read de write para respeitar confirmation flows.

5. OpenAI Apps SDK Test your integration  
   URL: `https://developers.openai.com/apps-sdk/deploy/testing`  
   Pontos aplicados:
   - testar localmente com MCP Inspector.
   - validar em ChatGPT Developer Mode com golden prompts.
   - registrar argumentos passados, tool escolhida e prompts de confirmacao.

---

## 3. Estado real atual do repo

### 3.1. Tool surface atual

O registry MCP atual possui 43 tools:

1. Read/navigation:
   - `repo_status`
   - `repo_tree`
   - `repo_root_tree`
   - `repo_read_file`
   - `repo_file_stats`
   - `repo_read_file_chunks`
   - `repo_diff_files`
   - `repo_search_text`
   - `repo_find_symbol_usages`
   - `repo_symbol_search`
   - `repo_file_outline`
2. Index:
   - `repo_index_status`
   - `repo_index_build`
   - `repo_index_search`
   - `repo_index_find_symbol`
   - `repo_find_imports`
   - `repo_index_invalidate`
3. Git read:
   - `git_status`
   - `git_diff`
   - `git_log`
   - `git_branch_info`
4. Validation/jobs:
   - `run_typecheck_copilot`
   - `run_lint_copilot`
   - `run_unit_copilot`
   - `run_project_doctor`
   - `run_copilot_validator`
   - `job_list`
   - `job_get_output`
   - `job_cancel`
5. Connection/runtime:
   - `chatgpt_connector_profile`
   - `chatgpt_connector_url_check`
   - `mcp_capabilities_summary`
   - `mcp_smoke_workspace`
   - `mcp_tunnel_status`
   - `mcp_runtime_health`
6. Controlled writes:
   - `repo_write_file`
   - `repo_create_file`
   - `repo_apply_patch`
   - `repo_move_file`
   - `repo_remove_file`
7. Copilot SDK metadata:
   - `copilot_sessions_list`
   - `copilot_session_get`

### 3.2. Pontos fortes atuais

1. A arquitetura ja separa MCP de LLM-B.
2. A engine compartilhada de IO/index/parser ja existe.
3. Ha redaction de paths protegidos.
4. Ha hashes para fluxo read -> write/patch.
5. Ha jobs assincronos com output.
6. Ha smoke local/remoto para tunnel.
7. Ha tools de indice e navegacao simbolica.
8. Ha controlled writes, nao shell arbitrario.

### 3.3. Gaps que geram friccao

1. `idempotentHint` ainda nao esta aplicado nas read tools.
2. Validacao ainda aparece como varias write-like calls (`run_typecheck`, `run_lint`, `run_unit`).
3. `run_copilot_validator` ainda e generico o suficiente para parecer mais amplo do que uma suite
   fixa.
4. Falta uma tool de suite allowlisted, por exemplo `mcp_run_safe_validation_suite`.
5. Falta quarantine/restore para evitar `repo_remove_file`.
6. Falta maintenance batch para agrupar tarefas comuns e reduzir prompts.
7. Falta tool de status das tools/annotations para o ChatGPT entender o perfil de risco antes de
   agir.
8. Falta um profile de sessao para o ChatGPT saber o que deve pedir para o usuario
   lembrar/autorizar.
9. Falta outputSchema em varias tools, o que reduz previsibilidade para o cliente/modelo.
10. Falta golden-log formal de chamadas reais no ChatGPT, incluindo onde surgiram prompts.

---

## 4. Causa-raiz das janelas de autorizacao

### 4.1. O que nao controlamos

O servidor MCP nao controla:

1. UI de confirmacao do ChatGPT.
2. Politica interna de bloqueio.
3. Persistencia de aprovacoes entre conversas.
4. Reset de aprovacoes apos refresh.
5. Moderacao/seguranca interna do host.
6. Decisao do modelo de considerar uma chamada arriscada.

### 4.2. O que controlamos

Controlamos:

1. annotations;
2. nomes;
3. descricoes;
4. schema;
5. granularidade;
6. reversibilidade;
7. logs;
8. policy local;
9. batch;
10. delegacao.

### 4.3. Leitura versus escrita

Reads devem ser:

```json
{
  "readOnlyHint": true,
  "destructiveHint": false,
  "openWorldHint": false,
  "idempotentHint": true
}
```

Writes reversiveis devem ser:

```json
{
  "readOnlyHint": false,
  "destructiveHint": false,
  "openWorldHint": false,
  "idempotentHint": false
}
```

Deletes reais devem ser raros:

```json
{
  "readOnlyHint": false,
  "destructiveHint": true,
  "openWorldHint": false,
  "idempotentHint": false
}
```

---

## 5. Situacao ideal

### 5.1. Perfil `chatgpt-max-power-temporary-tunnel`

Como este projeto usa tunnel temporario por natureza, a situacao ideal para agora e:

1. Quick Tunnel temporario ativo.
2. `mcp_tunnel_status` indicando `recommendedAction=use`.
3. `mcp_smoke_workspace` sem critical.
4. `tools/list` remoto igual ao registry local.
5. app ChatGPT em Developer Mode.
6. conversa dedicada ao repo.
7. prompt inicial proibindo fontes alternativas.
8. usuario lembrando aprovacao para bounded writes confiaveis na conversa.
9. destructive desabilitado no fluxo normal por substituicao com quarantine.
10. suite/batch/delegation em vez de varias chamadas write.

### 5.2. Perfil de tool surface ideal

1. Reads:
   - idempotentes;
   - outputSchema;
   - baixo ruido;
   - cursor/paginacao.
2. Writes:
   - expectedHash;
   - dryRun;
   - diffPreview;
   - rollback/quarantine quando possivel.
3. Validations:
   - suite enum;
   - job unico;
   - output resumido.
4. Maintenance:
   - enum de fixes;
   - dryRun obrigatorio no primeiro passo;
   - sem path arbitrario.
5. Delegation:
   - runner local;
   - policy profile;
   - relatorio final.

---

## 6. Roadmap canonico

### Faixa 0 — Baseline e documentacao

**Status:** em execucao nesta rodada.

Fases:

1. Ler integralmente o plano externo.
2. Conferir documentacao oficial atual.
3. Auditar registry e annotations.
4. Gerar este relatorio consolidado.

Pronto quando:

1. Este documento existir.
2. O roadmap estiver versionado.
3. A diferenca entre limite do ChatGPT e limite do MCP estiver clara.

### Faixa 1 — Reduzir prompts em read tools

Objetivo: todas as reads devem ser indiscutivelmente read-only/idempotentes.

Subfases:

1. Adicionar `idempotentHint=true` em `readOnlyAnnotations`.
2. Adicionar `idempotentHint=false` em bounded/destructive.
3. Atualizar testes de registry.
4. Atualizar capabilities summary com `annotationProfile`.
5. Rodar typecheck/lint/unit MCP.

Pronto quando:

1. Todas as tools tiverem `idempotentHint` booleano.
2. Reads tiverem `readOnlyHint=true` e `idempotentHint=true`.
3. Writes tiverem `idempotentHint=false`.

### Faixa 2 — Tool de status das tools

Objetivo: permitir que o ChatGPT audite a propria superficie antes de agir.

Subfases:

1. Criar `mcp_tools_status`.
2. Retornar:
   - total de tools;
   - groups;
   - annotations por tool;
   - classes de risco;
   - tools lembraveis;
   - tools destructive;
   - tools open-world.
3. Integrar em `mcp_capabilities_summary`.
4. Adicionar ao smoke workspace.

Pronto quando:

1. ChatGPT consegue chamar uma tool read-only para saber quais tools sao seguras para remember
   approval.

### Faixa 3 — Safe validation suite

Objetivo: trocar tres ou quatro prompts de validacao por uma chamada allowlisted.

Subfases:

1. Criar script interno de suite allowlisted.
2. Criar validators:
   - `suite-mcp-fast`;
   - `suite-mcp-full`;
   - `suite-copilot-fast`.
3. Criar tool `mcp_run_safe_validation_suite`.
4. Garantir output resumido.
5. Testar jobs/output.

Pronto quando:

1. ChatGPT consegue rodar `mcp_run_safe_validation_suite { suite: "mcp-full" }`.
2. A chamada nao aceita shell arbitrario.

### Faixa 4 — Quarantine em vez de delete

Objetivo: reduzir uso de destructive.

Subfases:

1. Criar `repo_quarantine_file`.
2. Criar `repo_restore_quarantined_file`.
3. Registrar manifest em `src/copilot/.ai/quarantine`.
4. Atualizar `mcp_capabilities_summary`.
5. Atualizar prompts e docs.

Pronto quando:

1. Fluxos normais nao precisam de `repo_remove_file`.

### Faixa 5 — Maintenance batch

Objetivo: agrupar manutencoes repetitivas e seguras.

Subfases:

1. Criar `mcp_maintenance_plan`.
2. Criar `mcp_maintenance_apply_safe_fixes`.
3. Fixes enum:
   - `refresh-index`;
   - `run-mcp-smoke`;
   - `emit-dirty-workspace-warning`;
   - `summarize-tools`;
   - `quarantine-known-temp-files`.
4. `dryRun=true` por padrao.
5. Sem path arbitrario.

Pronto quando:

1. ChatGPT consegue executar manutencao comum em uma chamada.

### Faixa 6 — Session profile

Objetivo: reduzir friccao entre conversas.

Subfases:

1. Criar `mcp_session_profile`.
2. Retornar:
   - prompt recomendado;
   - approval recommendations;
   - tools confiaveis;
   - tools perigosas;
   - endpoint/tunnel;
   - smoke prompts.
3. Integrar com `chatgpt_connector_profile`.

Pronto quando:

1. Uma nova conversa consegue se preparar rapidamente.

### Faixa 7 — Delegation runner

Objetivo: contornar limite de UI para execucao longa, mantendo politica local.

Subfases:

1. Criar contrato `delegate_to_repo_autonomy_runner`.
2. Implementar runner dry-run.
3. Implementar runner real para tarefas allowlisted.
4. Adicionar audit log e relatorio.
5. Nunca permitir shell arbitrario inicialmente.

Pronto quando:

1. ChatGPT dispara plano estruturado.
2. Runner executa etapas locais e devolve relatorio.

### Faixa 8 — Golden prompts e medicao real no ChatGPT

Objetivo: medir autonomia no host real.

Subfases:

1. Criar doc de golden prompts.
2. Registrar:
   - tool selecionada;
   - argumentos;
   - se houve prompt;
   - se o remember apareceu;
   - se houve bloqueio.
3. Iterar tool descriptions.

Pronto quando:

1. Temos historico objetivo de friccao por tool.

---

## 7. Ordem de execucao desta rodada

1. Faixa 0: finalizar documentacao.
2. Faixa 1: annotations/idempotencia.
3. Faixa 2: `mcp_tools_status`.
4. Faixa 3: `mcp_run_safe_validation_suite`.
5. Validadores:
   - `npm run typecheck:strict:src.copilot`;
   - `npm run lint:copilot`;
   - `npm run test:copilot:unit`;
   - smoke MCP local/remoto quando o tunnel estiver ativo.
6. Commit/push.
7. Continuar para Faixa 4.

---

## 8. Decisao de arquitetura

LLM-B e MCP permanecem independentes.

Compartilham:

1. IO engine.
2. index engine.
3. parser.
4. policy de paths.
5. jobs/validators quando fizer sentido.

Nao compartilham:

1. registry de tools;
2. prompts;
3. runtime de conversa;
4. estado interno da LLM-B.

Essa separacao evita acoplamento circular e preserva o objetivo original: o ChatGPT pode operar o
repo via MCP, enquanto a LLM-B continua funcionando sem depender do MCP server.

---

## 9. Status de implementacao da primeira rodada

Atualizado em 2026-05-23.

### 9.1. Fontes oficiais rechecadas nesta rodada

1. OpenAI Apps SDK Quickstart:
   - `https://developers.openai.com/apps-sdk/quickstart`
   - Confirmou que Apps SDK usa MCP para conectar capabilities/tools ao ChatGPT.
   - Confirmou que o servidor deve expor endpoint `/mcp`.
   - Confirmou que, para conectar no ChatGPT durante desenvolvimento, e necessario URL HTTPS publica
     com `/mcp`.
   - Confirmou que o fluxo de ChatGPT usa Developer Mode em Settings > Apps & Connectors > Advanced
     settings.
2. OpenAI Apps SDK Reference:
   - `https://developers.openai.com/apps-sdk/reference`
   - Confirmou `openWorldHint`, `idempotentHint` e a regra essencial: estes hints influenciam como o
     ChatGPT apresenta/chama a tool para o usuario, mas o servidor continua responsavel por aplicar
     autorizacao propria.
3. Cloudflare Quick Tunnels:
   - `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/`
   - Confirmou que Quick Tunnels geram subdominio aleatorio `trycloudflare.com`.
   - Confirmou que sao voltados para teste/desenvolvimento, sem SLA/uptime garantido.
   - Confirmou limitacoes relevantes, incluindo concorrencia e SSE.
4. Cloudflare Tunnel setup:
   - `https://developers.cloudflare.com/tunnel/setup/`
   - Confirmou que Quick Tunnel pode expor localhost sem dominio fixo.

### 9.2. Faixa 1 concluida — annotations/idempotencia

Mudancas implementadas:

1. `readOnlyAnnotations()` agora emite:
   - `readOnlyHint=true`;
   - `openWorldHint=false`;
   - `destructiveHint=false`;
   - `idempotentHint=true`.
2. `boundedWriteAnnotations()` agora emite:
   - `readOnlyHint=false`;
   - `openWorldHint=false`;
   - `destructiveHint=false`;
   - `idempotentHint=false`.
3. `destructiveAnnotations()` agora emite:
   - `readOnlyHint=false`;
   - `openWorldHint=false`;
   - `destructiveHint=true`;
   - `idempotentHint=false`.
4. Teste de registry garante que todas as tools tenham hints booleanos explicitos.
5. Teste de registry garante que `idempotentHint` acompanha `readOnlyHint`.

Efeito esperado no ChatGPT:

1. Tools de leitura ficam mais claramente idempotentes.
2. Tools de escrita continuam explicitamente nao idempotentes.
3. O host pode enquadrar melhor chamadas repetiveis.
4. O MCP nao promete eliminar janelas do ChatGPT; apenas fornece metadata mais correta.

### 9.3. Faixa 2 concluida — `mcp_tools_status`

Mudancas implementadas:

1. Criada tool `mcp_tools_status`.
2. A tool retorna:
   - total de tools;
   - contagem read-only;
   - contagem bounded-write;
   - contagem destructive;
   - contagem open-world;
   - contagem de leituras idempotentes;
   - lista de tools candidatas a `remember approval`;
   - lista de tools destrutivas;
   - lista de tools open-world;
   - matriz completa de annotations por tool.
3. `mcp_capabilities_summary` agora anuncia:
   - `mcp_tools_status` no grupo runtime;
   - `annotationProfile`;
   - guidance operacional para usar `mcp_tools_status` antes de planejamento amplo.
4. `chatgpt_connector_profile` ganhou prompt de smoke para `mcp_tools_status`.
5. Smoke remoto Cloudflare passou a considerar `mcp_tools_status` como critical tool.

Efeito esperado no ChatGPT:

1. O modelo consegue descobrir rapidamente quais chamadas sao de leitura.
2. O modelo consegue evitar `repo_remove_file` quando houver alternativa reversivel.
3. Humanos conseguem diagnosticar por que uma tool tende a pedir confirmacao.

### 9.4. Faixa 3 concluida — `mcp_run_safe_validation_suite`

Mudancas implementadas:

1. Criado script:
   - `src/copilot/mcp/scripts/run-safe-validation-suite.js`.
2. Criado npm script:
   - `npm run copilot:mcp:safe-suite -- <suite>`.
3. Suites allowlisted:
   - `mcp-fast`: typecheck strict de `src/copilot` + testes unitarios MCP;
   - `mcp-full`: typecheck strict de `src/copilot` + lint Copilot + testes unitarios MCP;
   - `copilot-fast`: typecheck strict de `src/copilot` + lint Copilot + unitarios Copilot.
4. `resolveValidatorCommand()` passou a aceitar:
   - `suite-mcp-fast`;
   - `suite-mcp-full`;
   - `suite-copilot-fast`.
5. Criada tool:
   - `mcp_run_safe_validation_suite`.
6. `project_doctor` passou a anunciar as suites.
7. `mcp_capabilities_summary` passou a recomendar suite antes de validators separados.
8. `chatgpt_connector_profile` ganhou smoke prompt de suite segura.
9. Smoke remoto Cloudflare passou a considerar `mcp_run_safe_validation_suite` critical.

Efeito esperado no ChatGPT:

1. Menos chamadas separadas para validacao.
2. Menos janelas sequenciais para typecheck/lint/test.
3. Um job unico continua auditavel via `job_get_output`.
4. Nao ha shell arbitrario; tudo e allowlisted.

### 9.5. Faixa 4 parcialmente concluida — quarentena reversivel

Mudancas implementadas:

1. Criada tool:
   - `repo_quarantine_file`.
2. Criada tool:
   - `repo_restore_quarantined_file`.
3. Criada tool:
   - `repo_list_quarantine`.
4. Criada tool:
   - `repo_inspect_quarantined_file`.
5. `repo_quarantine_file`:
   - aceita path de workspace;
   - exige arquivo regular;
   - move o arquivo para `src/copilot/.ai/quarantine`;
   - grava metadata JSON com `quarantineId`, caminho original, hash, tamanho e status;
   - retorna `quarantineId` para reversao.
6. `repo_restore_quarantined_file`:
   - usa `quarantineId`;
   - restaura no caminho original por padrao;
   - permite `destinationPath` alternativo;
   - bloqueia overwrite por padrao;
   - exige `overwrite=true` e `confirmOverwrite=true` quando houver substituicao.
7. `repo_list_quarantine`:
   - lista metadata conhecida;
   - filtra por `quarantined`, `restored` ou `all`;
   - limita resultados.
8. `repo_inspect_quarantined_file`:
   - valida se o objeto armazenado ainda existe;
   - retorna bytes;
   - calcula SHA-256 por padrao;
   - informa se o item e restauravel.
9. `mcp_capabilities_summary` passou a recomendar quarentena antes de remocao.
10. `mcp_session_profile` inclui listagem/inspecao de quarentena entre leituras de baixa friccao.
11. Testes cobrem:

- quarentena e restauração normal;
- listagem de item quarantined;
- inspecao com SHA-256;
- bloqueio de segunda restauração;
- bloqueio de overwrite sem confirmação;
- overwrite confirmado.

Efeito esperado no ChatGPT:

1. Fluxos de limpeza/refatoracao podem evitar `repo_remove_file`.
2. Remocao real continua disponivel, mas deixa de ser caminho preferencial.
3. A experiencia deve gerar menos bloqueios por risco destrutivo quando a intencao for reversivel.
4. O ChatGPT consegue descobrir `quarantineId` sem depender de memoria da conversa.

### 9.6. Validadores executados nesta rodada

Executados e aprovados:

1. `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_registry.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js tests/unit/copilot/mcp/test_mcp_jobs.spec.js --reporter=dot`
   - 3 arquivos;
   - 27 testes;
   - passou.
2. `npm run typecheck:strict:src.copilot`
   - passou apos ajuste de mapa explicito para suites e metadata de quarentena.
3. `npm run lint:copilot`
   - passou.
4. `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp --reporter=dot`
   - 12 arquivos;
   - 64 testes;
   - passou.
5. `npm run copilot:mcp:safe-suite -- mcp-fast`
   - typecheck strict passou;
   - testes unitarios MCP passaram;
   - suite retornou `success=true`.
6. `npm run test:copilot:unit`
   - primeira execucao acusou uma falha isolada em
     `tests/unit/copilot/conversation-hub/test_hub.spec.js`;
   - o arquivo isolado passou;
   - o diretorio `tests/unit/copilot/conversation-hub` passou;
   - rerun completo passou com 3063/3063 testes;
   - classificacao atual: evento de runner/carga nao reproduzido, sem mudanca de produto necessaria
     nesta rodada.
7. `npm run copilot:mcp:safe-suite -- mcp-full`
   - typecheck strict passou;
   - lint Copilot passou;
   - testes unitarios MCP passaram;
   - suite retornou `success=true`.
8. `npm run test:copilot:unit`
   - rerun final apos `mcp_session_profile`, listagem/inspecao de quarentena e docs passou;
   - 3064/3064 testes passaram.
9. `npm run copilot:mcp:safe-suite -- mcp-full`
   - rerun apos maintenance batch passou;
   - typecheck strict passou;
   - lint Copilot passou;
   - 66 testes MCP passaram.
10. `npm run test:copilot:unit`
    - rerun final apos maintenance batch passou;
    - 3065/3065 testes passaram.
11. `npm run copilot:mcp:safe-suite -- mcp-full`
    - rerun apos delegation runner passou;
    - typecheck strict passou;
    - lint Copilot passou;
    - 67 testes MCP passaram.
12. `npm run test:copilot:unit`
    - rerun final apos delegation runner passou;
    - 3066/3066 testes passaram.
13. `npm run copilot:mcp:safe-suite -- mcp-full`
    - rerun apos golden prompts passou;
    - typecheck strict passou;
    - lint Copilot passou;
    - 68 testes MCP passaram.
14. `npm run test:copilot:unit`
    - rerun final apos golden prompts passou;
    - 3067/3067 testes passaram.

### 9.7. Faixa 6 inicial concluida — `mcp_session_profile`

Mudancas implementadas:

1. Criada tool:
   - `mcp_session_profile`.
2. A tool retorna:
   - perfil operacional `chatgpt-max-autonomy-temporary-tunnel`;
   - URL MCP/public/local conforme profile atual;
   - chamadas iniciais recomendadas;
   - chamadas read-only de baixa friccao;
   - fluxos preferenciais para patch, remocao reversivel e validacao;
   - guidance sobre `remember approval`;
   - lista de tools a evitar sem necessidade explicita;
   - guidance de Quick Tunnel temporario;
   - smoke prompts.
3. `mcp_capabilities_summary` passou a anunciar `mcp_session_profile`.
4. `chatgpt_connector_profile` passou a recomendar `mcp_session_profile` no primeiro smoke.
5. Smoke remoto Cloudflare passou a considerar `mcp_session_profile` critical.

Efeito esperado no ChatGPT:

1. Conversas novas podem iniciar com uma tool read-only que instrui o proprio modelo remoto sobre o
   modo de operacao.
2. O modelo remoto deve escolher quarentena, patch exato e suite segura mais cedo.
3. Isso reduz tentativas de chamada destrutiva/generica que tendem a disparar bloqueios.

### 9.8. Proxima sequencia cronologica

### 9.8. Faixa 5 inicial concluida — maintenance batch

Mudancas implementadas:

1. Criada tool:
   - `mcp_maintenance_plan`.
2. Criada tool:
   - `mcp_maintenance_apply_safe_fixes`.
3. Fixes allowlisted:
   - `workspace-status`;
   - `summarize-tools`;
   - `run-mcp-smoke`;
   - `refresh-index`.
4. `dryRun=true` e o default.
5. Nao ha shell arbitrario.
6. Nao ha path arbitrario.
7. `refresh-index` sempre mira `src/copilot`, usando IO index compartilhado.
8. `run-mcp-smoke` em `dryRun=true` apenas planeja; em `dryRun=false`, chama a smoke suite
   read-only.
9. `mcp_session_profile` passou a recomendar o fluxo:
   - `mcp_maintenance_plan`;
   - `mcp_maintenance_apply_safe_fixes dryRun=true`.
10. `mcp_capabilities_summary` passou a anunciar as tools de maintenance.
11. Smoke remoto Cloudflare passou a exigir as duas tools como critical.

Efeito esperado no ChatGPT:

1. Manutencoes comuns podem virar uma chamada planejada/batch em vez de varias chamadas soltas.
2. A chamada real continua estreita e allowlisted.
3. O ChatGPT consegue operar com menor quantidade de pedidos de confirmacao quando o usuario aceitar
   a tool batch.

### 9.9. Proxima sequencia cronologica

1. Atualizar runbook operacional com smoke de quarentena e maintenance.
2. Medir prompts reais no ChatGPT.

### 9.10. Faixa 7 inicial concluida — delegation runner allowlisted

Mudancas implementadas:

1. Criada tool:
   - `delegate_to_repo_autonomy_runner`.
2. Missions allowlisted:
   - `diagnose-mcp`;
   - `validate-mcp-full`;
   - `maintenance-safe-dry-run`.
3. `dryRun=true` e o default.
4. Constraints explicitas:
   - sem shell arbitrario;
   - sem paths arbitrarios;
   - sem acoes destrutivas diretas.
5. `diagnose-mcp` em execucao real chama apenas:
   - `repo_status`;
   - `mcp_capabilities_summary`;
   - `mcp_smoke_workspace`;
   - `mcp_runtime_health`.
6. `validate-mcp-full` em execucao real inicia job `suite-mcp-full`, exigindo leitura posterior via
   `job_get_output`.
7. `maintenance-safe-dry-run` permanece sem mutacao mesmo com `dryRun=false`.
8. `mcp_session_profile` passou a recomendar o fluxo de delegacao.
9. `mcp_capabilities_summary` passou a anunciar o runner.
10. Smoke remoto Cloudflare passou a exigir o runner como critical.

Efeito esperado no ChatGPT:

1. Workflows maiores podem ser compactados em uma tool, reduzindo sequencias de autorizacao.
2. A primeira chamada pode ser dry-run, dando ao usuario uma visao objetiva do que sera executado.
3. A execucao real continua presa a missoes fixas, sem abrir shell generico.

### 9.11. Proxima sequencia cronologica

### 9.11. Faixa 8 inicial concluida — golden prompts e medicao

Mudancas implementadas:

1. Criado documento:
   - `src/copilot/docs/CHATGPT_MCP_GOLDEN_PROMPTS_AND_MEASUREMENT.md`.
2. Criada tool:
   - `mcp_golden_prompts`.
3. A tool retorna:
   - prompt set canonico;
   - expected tools por prompt;
   - measurement fields;
   - success criteria.
4. `mcp_session_profile` passou a recomendar `mcp_golden_prompts`.
5. `mcp_capabilities_summary` passou a anunciar `mcp_golden_prompts`.
6. Smoke remoto Cloudflare passou a exigir `mcp_golden_prompts` como critical.

Efeito esperado no ChatGPT:

1. A medicao de prompts de autorizacao deixa de ser anedotica.
2. O ChatGPT consegue consultar o protocolo de teste sem depender do documento MD.
3. Fica mais facil comparar iteracoes de tool descriptions, annotations e workflows.

### 9.12. Proxima sequencia cronologica

1. Rodar golden prompts no ChatGPT real.
2. Registrar autorizacoes/bloqueios.
3. Refinar descriptions e workflows com base em dados reais.
4. Evoluir `delegate_to_repo_autonomy_runner` para missoes adicionais, mantendo allowlist.
