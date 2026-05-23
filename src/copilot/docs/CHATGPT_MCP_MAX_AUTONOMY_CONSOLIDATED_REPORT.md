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

---

## 10. Incorporacao da auditoria live ampliada de 2026-05-23

Fonte local incorporada:

1. `src/copilot/docs/NEW_AUDIT_AUTONOMIA_GPT.md`

Contexto observado pela auditoria:

1. Endpoint testado:
   - `/WORKSPACE/link_6a11939cefd08191906489d7b45c6a3d`.
2. HEAD observado:
   - `044b2060`.
3. Tunnel:
   - online;
   - temporary Cloudflare;
   - auth `none-dev`.
4. Superficie MCP:
   - 54 tools;
   - 37 read-only idempotentes;
   - 16 bounded-write;
   - 1 destrutiva;
   - 0 open-world.
5. O ChatGPT confirmou que as tools novas existem e funcionam em discovery/profile.

### 10.1. Conclusoes validadas

1. `No Authentication` e compativel com dev mode.
2. A ausencia de OAuth nao explica sozinha os bloqueios.
3. OAuth/Mixed Auth melhora governanca, escopos e confianca, mas nao elimina confirmacoes de write
   actions.
4. `outputSchema` e lacuna real: a UI exibiu recomendacao de esquema de saida.
5. `securitySchemes` por tool e importante para evolucao de auth.
6. O host bloqueou chamadas antes de chegarem ao MCP.
7. Bloqueios ocorreram tambem em chamadas read-only.
8. `dryRun` dentro de bounded-write nao basta para o host; plan-only read-only precisa ser separado.
9. `mcp_runtime_health` estava mais verde que `mcp_smoke_workspace`.
10. Index estava vazio/indisponivel durante o teste live.

### 10.2. Confirmacao oficial rechecada

Documentacao oficial consultada nesta atualizacao:

1. Apps SDK Reference:
   - `https://developers.openai.com/apps-sdk/reference`
   - Confirma `outputSchema`, `securitySchemes` e annotations.
   - Confirma que annotations influenciam como ChatGPT enquadra a chamada, mas o servidor ainda deve
     aplicar auth.
2. Apps SDK Authentication:
   - `https://developers.openai.com/apps-sdk/build/auth`
   - Confirma que ChatGPT so mostra OAuth quando o servidor sinaliza metadata e runtime challenge.
   - Recomenda `securitySchemes` por tool.
3. Apps SDK Define tools:
   - `https://developers.openai.com/apps-sdk/plan/tools`
   - Recomenda uma tarefa por tool, inputs explicitos, outputs previsiveis e separar read/write para
     confirmation flows.
4. Apps SDK Build MCP server:
   - `https://developers.openai.com/apps-sdk/build/mcp-server`
   - Reforca o papel do MCP server como contrato de tools, auth e structured content.

### 10.3. Investigacao local adicional

O SDK instalado `@modelcontextprotocol/sdk` suporta:

1. `outputSchema` diretamente no `server.registerTool(...)`.
2. `_meta` diretamente no `server.registerTool(...)`.

O tipo local do metodo `registerTool` nao expoe `securitySchemes` top-level no config object atual,
embora a documentacao Apps SDK mostre esse campo em exemplos. Portanto a sequencia tecnica segura e:

1. Fase imediata:
   - adicionar `outputSchema`;
   - adicionar `_meta["securitySchemes"]`.
2. Fase posterior:
   - avaliar wrapper Apps SDK ou compat shim para `securitySchemes` top-level sem quebrar typecheck;
   - evoluir para Mixed Auth.

---

## 11. Roadmap canonico atualizado apos a nova auditoria

### Faixa A — Documentacao e baseline

Status: concluida nesta rodada de planejamento.

Objetivo:

1. Incorporar a auditoria live ampliada.
2. Registrar estado feito/faltante.
3. Ordenar P0/P1/P2 por dependencia real.

Pronto quando:

1. Este documento conter a nova matriz.
2. O roadmap distinguir plano, metadata, schemas, auth, runtime health e index.

### Faixa B — Metadata registry-wide minima

Status: implementada e validada em teste focado nesta rodada.

Objetivo:

1. Adicionar `outputSchema` basico a todas as tools.
2. Adicionar `_meta["securitySchemes"]` explicito a todas as tools.
3. Testar que toda tool registrada tem:
   - annotations;
   - outputSchema;
   - `_meta.securitySchemes`.

Subfases:

1. Criar helpers em `src/copilot/mcp/control-plane/tool-metadata.js`.
2. Criar schema base `success/error passthrough`.
3. Adaptar typedef `McpToolDefinition`.
4. Adaptar `registerCanonicalMcpTools`.
5. Aplicar schema base em todas as tools.
6. Aplicar schemes por risco:
   - read-only: `noauth`;
   - bounded-write: `noauth` em dev, com scope planejado;
   - destructive: `noauth` em dev, com scope planejado.
7. Adicionar testes.

Pronto quando:

1. ChatGPT nao deve mais apontar ausencia ampla de output schema.
2. Tests de registry impedem regressao.

Resultado implementado:

1. `src/copilot/mcp/control-plane/tool-metadata.js` normaliza todas as tools canonicas.
2. Toda tool recebe `outputSchema` base estruturado.
3. Toda tool recebe `_meta.securitySchemes` com `noauth` no perfil dev atual.
4. `registerCanonicalMcpTools` propaga `outputSchema` e `_meta` para o SDK MCP.
5. `mcp_tools_status` passa a expor `hasOutputSchema` e `securitySchemes`.
6. `mcp_capabilities_summary` documenta o perfil de metadata.
7. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_registry.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 27 testes.

### Faixa C — Plan-only read-only tools

Status: implementada e validada em teste focado nesta rodada.

Objetivo:

1. Separar planejamento read-only de aplicacao write.
2. Reduzir bloqueios do host em dry-run.

Tools novas:

1. `repo_patch_plan`
2. `repo_create_file_plan`
3. `repo_quarantine_file_plan`
4. `repo_move_file_plan`
5. `repo_index_refresh_plan`
6. `mcp_validation_plan`

Pronto quando:

1. Golden prompts usam plan tools antes de apply.
2. Plan tools sao read-only/idempotentes.

Resultado implementado:

1. `repo_patch_plan` cria plano read-only com diff preview, contagem de ocorrencias e `sha256` para
   `expectedHash`.
2. `repo_create_file_plan` cria plano read-only com diff preview e deteccao de destino existente.
3. `repo_quarantine_file_plan` cria plano read-only para remocao reversivel por quarantine.
4. `repo_move_file_plan` cria plano read-only para rename/move com deteccao de overwrite.
5. `repo_index_refresh_plan` cria plano read-only para refresh do indice.
6. `mcp_validation_plan` cria plano read-only para suites seguras de validacao.
7. `mcp_session_profile`, `mcp_capabilities_summary`, `mcp_tools_status`, Cloudflare CLI e connector
   profile foram atualizados para favorecer plan-before-apply.
8. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_registry.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 27 testes.

### Faixa D — URL/redaction status sem inputs sensiveis

Status: implementada e validada em teste focado nesta rodada.

Objetivo:

1. Contornar bloqueios com URL publica passada como argumento.
2. Contornar bloqueio de `showHidden=true`.

Tools novas:

1. `chatgpt_connector_current_url_status`
2. `repo_root_redaction_status`

Pronto quando:

1. ChatGPT consegue auditar tunnel atual sem passar URL.
2. ChatGPT consegue auditar redaction sem listar hidden names.

Resultado implementado:

1. `chatgpt_connector_current_url_status` le o estado salvo do Cloudflare Quick Tunnel e/ou env
   atual, valida a URL `/mcp`, devolve campos prontos para a caixa do ChatGPT e orienta recovery sem
   exigir URL publica como argumento.
2. `repo_root_redaction_status` usa a engine de scan/IO para calcular contagens agregadas da raiz,
   inclusive hidden/protected, sem retornar arrays de entradas nem nomes hidden/protected.
3. `mcp_capabilities_summary`, `mcp_session_profile`, Cloudflare smoke critical list e smoke prompts
   foram atualizados para favorecer essas tools.
4. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_registry.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 29 testes.

### Faixa E — Runtime health agregado

Status: implementada e validada em teste focado nesta rodada.

Objetivo:

1. Fazer `mcp_runtime_health` refletir:
   - ultimo smoke;
   - dirty workspace;
   - index empty/unavailable;
   - tunnel stale/fail;
   - error rates.

Subfases:

1. Persistir ou calcular ultimo smoke summary.
2. Incluir index status.
3. Incluir dirty workspace warning.
4. Ajustar status:
   - `ok`;
   - `degraded`;
   - `failed`.

Pronto quando:

1. `mcp_runtime_health` nao fica `ok` se smoke/index indicam degradacao operacional.

Resultado implementado:

1. `mcp_smoke_workspace` registra um resumo in-process do ultimo smoke local.
2. `mcp_runtime_health` agora agrega:
   - dirty workspace;
   - disponibilidade/vazio do indice IO;
   - estado do Cloudflare Quick Tunnel;
   - ultimo smoke Cloudflare;
   - ultimo `mcp_smoke_workspace`;
   - error rates por tool.
3. O campo `status` passa a refletir `ok`, `degraded` ou `failed`, preservando `success/ok` como
   sucesso da chamada MCP.
4. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_runtime_metrics.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 27 testes.

### Faixa F — Index resiliente fora do host

Status: implementada e validada em teste focado nesta rodada.

Objetivo:

1. Evitar dependencia de `repo_index_build` quando o host bloqueia.

Subfases:

1. Criar variaveis:
   - `COPILOT_MCP_INDEX_AUTO_BUILD`;
   - `COPILOT_MCP_INDEX_AUTO_BUILD_PATH`;
   - `COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES`.
2. Implementar auto-build opcional no boot HTTP.
3. Implementar status claro quando index vazio.
4. Integrar maintenance plan.

Pronto quando:

1. `repo_index_status` nao permanece vazio por falta de chamada do ChatGPT.

Resultado implementado:

1. `COPILOT_MCP_INDEX_AUTO_BUILD=true` ativa auto-build opcional no boot HTTP do MCP.
2. Variaveis suportadas:
   - `COPILOT_MCP_INDEX_AUTO_BUILD_PATH`;
   - `COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES`;
   - `COPILOT_MCP_INDEX_AUTO_BUILD_DEPTH`;
   - `COPILOT_MCP_INDEX_AUTO_BUILD_CONCURRENCY`;
   - `COPILOT_MCP_INDEX_AUTO_BUILD_IGNORE_GITIGNORE`.
3. O build roda em background apos o servidor HTTP ficar ouvindo, evitando bloquear startup/tunnel.
4. `repo_index_status`, `/health` e `mcp_runtime_health` passam a expor `indexAutoBuild`.
5. O objetivo operacional e permitir que o operador inicie:
   - `COPILOT_MCP_INDEX_AUTO_BUILD=true npm run copilot:mcp:http` antes de conectar pelo ChatGPT,
     evitando depender de `repo_index_build` dentro do host.
6. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_runtime_metrics.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 28 testes.

### Faixa G — Last validation summary

Status: implementada e validada em teste focado nesta rodada.

Objetivo:

1. Usar jobs existentes quando iniciar validação for bloqueado.

Tool nova:

1. `mcp_last_validation_summary`

Pronto quando:

1. ChatGPT consegue saber ultimo typecheck/lint/unit sem iniciar novo job.

Resultado implementado:

1. `mcp_last_validation_summary` le manifests persistidos dos validator jobs em `.ai/jobs`.
2. A tool retorna o job mais recente por validator, com status, exit code, duracao, command line e
   id.
3. Opcionalmente inclui `outputTail` curto quando `includeOutputTail=true`.
4. A tool e read-only/idempotente e foi adicionada ao capabilities/session profile/Cloudflare smoke.
5. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_registry.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 30 testes.

### Faixa H — Host block diagnostics

Status: implementada e validada em teste focado nesta rodada.

Objetivo:

1. Estruturar registro manual de bloqueios externos, pois eles nao chegam ao MCP.

Tools/docs:

1. `mcp_host_block_diagnostics`
2. golden prompt result template JSON/MD

Pronto quando:

1. Cada bloqueio tem tool, args class, mensagem, contexto e timestamp.

Resultado implementado:

1. `mcp_host_block_diagnostics` classifica bloqueios host-side que nao chegaram ao MCP.
2. A tool e read-only/idempotente, nao persiste dados e aceita apenas descricoes nao sensiveis.
3. A resposta inclui:
   - codigo estavel de classificacao;
   - severidade;
   - alternativas de menor atrito;
   - template de auditoria manual.
4. `mcp_golden_prompts` foi atualizado com campos e template de host block.
5. `mcp_session_profile`, `mcp_capabilities_summary` e Cloudflare smoke critical list anunciam a
   tool.
6. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_registry.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 31 testes.

### Faixa I — Mixed Authentication

Status: readiness implementada; enforcement gradual em implementacao nesta rodada.

Objetivo:

1. Evoluir de `none-dev` para perfis:
   - `dev-noauth`;
   - `dev-mixed-auth`;
   - `team-oauth`;
   - `prod-readonly`.

Subfases:

1. Mapear scopes por tool: implementado.
2. Implementar protected resource metadata: implementado no HTTP adapter.
3. Implementar authorization server metadata: pendente; depende de issuer real externo.
4. Implementar runtime challenge `_meta["mcp/www_authenticate"]`: implementado no wrapper
   do registry quando enforcement exige token e o bearer esta ausente/invalido.
5. Validar com MCP Inspector e ChatGPT: pendente em modo OAuth real.

Pronto quando:

1. ChatGPT mostra OAuth/linking quando apropriado.
2. Server valida token/scope/audience em write/validate/destructive.

Fontes oficiais rechecadas nesta fase:

1. Apps SDK Authentication:
   - `https://developers.openai.com/apps-sdk/build/auth`
   - Confirma protected resource metadata, authorization server metadata, `resource` parameter, PKCE
     e verificacao de token pelo resource server.
2. Apps SDK Reference:
   - `https://developers.openai.com/apps-sdk/reference`
   - Confirma `_meta["mcp/www_authenticate"]` em error tool result para disparar OAuth.
3. Apps SDK Define tools:
   - `https://developers.openai.com/apps-sdk/plan/tools`
   - Reforca hints de read-only/destructive/open-world e separacao de tools por tarefa.

Resultado implementado:

1. `src/copilot/mcp/control-plane/auth.js` define:
   - `none-dev`;
   - `mixed-auth`;
   - `oauth`;
   - `secure-mcp-tunnel`;
   - scopes `repo:read`, `repo:write`, `repo:validate`, `repo:admin`.
2. Scopes sao derivados das annotations e nomes das tools:
   - read-only -> `repo:read`;
   - bounded write -> `repo:write`;
   - validators/jobs -> `repo:validate`;
   - destructive/admin -> `repo:admin`.
3. `securitySchemes` agora acompanha o modo:
   - `none-dev`: `noauth`;
   - `mixed-auth`: `noauth` + `oauth2`;
   - `oauth`: `oauth2`.
4. O HTTP adapter expoe:
   - `GET /.well-known/oauth-protected-resource`.
5. Nova tool read-only:
   - `mcp_auth_profile`.
6. `chatgpt_connector_profile` agora inclui `authReadiness`.
7. CORS do HTTP adapter passa a aceitar header `Authorization` para a fase OAuth futura.
8. O HTTP adapter propaga bearer token para o registry sem acoplar LLM-B ao MCP.
9. `COPILOT_MCP_AUTH_ENFORCEMENT` permite enforcement gradual:
   - default em `none-dev`, `mixed-auth` e `secure-mcp-tunnel`: `off`;
   - default em `oauth`: `all`;
   - modos explicitos: `off`, `read`, `write`, `validate`, `admin`, `all`.
10. Validador de bearer token suporta:
   - token estatico local via `COPILOT_MCP_STATIC_BEARER_TOKEN`, util para testes controlados;
   - OAuth/JWT por JWKS via `COPILOT_MCP_OAUTH_JWKS_URI`;
   - issuer via `COPILOT_MCP_OAUTH_EXPECTED_ISSUER`;
   - audience/resource via `COPILOT_MCP_OAUTH_AUDIENCE`;
   - checagem de scopes `scope` ou `scp`.
11. `mcp_auth_profile` reporta enforcement, issuer, audience, JWKS e static bearer sem revelar segredo.
    Tambem retorna templates redigidos de ambiente para:
   - tunnel temporario sem auth;
   - teste local `mixed-auth` com bearer estatico nao commitado;
   - OAuth/JWKS com issuer real.
12. `mcp_oauth_issuer_diagnostics` valida, quando houver issuer real, os documentos:
   - `/.well-known/oauth-authorization-server`;
   - `/.well-known/openid-configuration`.
13. O diagnostico de issuer verifica:
   - `issuer`;
   - `authorization_endpoint`;
   - `token_endpoint`;
   - `token_endpoint_auth_methods_supported`;
   - `code_challenge_methods_supported` com `S256`;
   - scopes de repo.
14. Validacao focada:
   - `npm run typecheck:strict:src.copilot`: passou;
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/test_mcp_registry.spec.js tests/unit/copilot/mcp/test_mcp_tools.spec.js --reporter=dot`:
     passou com 34 testes.
   - `npm run lint:copilot`: passou.
   - `npm run copilot:mcp:safe-suite -- mcp-full`: passou com typecheck, lint e 82 testes MCP.
   - `npm run test:copilot:unit`: passou com 3081 testes.
15. `mcp_autonomy_power_score` mede postura de autonomia do conector por:
   - cobertura de tools;
   - proporcao read-only/low-friction;
   - seguranca de escrita e plan-only;
   - cobertura de outputSchema/security metadata;
   - prontidao de validadores;
   - postura auth/tunnel;
   - ausencia de open-world tools.

Pendencias da Faixa I:

1. Escolher/fornecer issuer OAuth real para `COPILOT_MCP_OAUTH_ISSUER`.
2. Publicar metadata do authorization server fora deste MCP ou integrar com provedor existente.
3. Rodar `mcp_oauth_issuer_diagnostics` contra o issuer real.
4. Validar OAuth real com issuer/JWKS externo usado pelo ChatGPT.
5. Publicar exemplos finais do `.env` para modo OAuth quando houver issuer real.
6. Rodar teste real no ChatGPT com auth `OAuth`.

---

## 12. Virada para Cloudflare Tunnel permanente — aurelin.org

Data: 2026-05-23.

Decisao atual:

1. O modo padrao deixa de ser `trycloudflare.com` temporario.
2. O dominio permanente e `aurelin.org`.
3. O tunnel remoto Cloudflare se chama `workspace-mcp-dev`.
4. A URL canonica para o ChatGPT passa a ser:
   - `https://workspace-mcp-dev.aurelin.org/mcp`
5. O origin local permanece:
   - `http://127.0.0.1:3333`
6. O serviço publicado no Cloudflare deve apontar para o origin raiz, nao para `/mcp`.
7. O path `/mcp` continua sendo responsabilidade do ChatGPT e do MCP HTTP adapter.

Fontes oficiais Cloudflare rechecadas:

1. `https://developers.cloudflare.com/tunnel/setup/`
   - Confirma que tunnels remotos podem rodar por token e que Quick Tunnels sao apenas para
     desenvolvimento/testes.
2. `https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/`
   - Confirma que qualquer pessoa com o tunnel token pode rodar o tunnel; portanto o token nao
     deve ser versionado nem impresso.
3. `https://developers.cloudflare.com/tunnel/advanced/run-parameters/`
   - Confirma `cloudflared tunnel run --token <TOKEN>` e `--token-file <PATH>` para
     tunnels remotamente gerenciados.
4. `https://developers.cloudflare.com/tunnel/routing/`
   - Confirma o modelo public hostname -> local service.
5. `https://developers.cloudflare.com/tunnel/`
   - Confirma que `cloudflared` cria conexao outbound, sem portas inbound no Dev Container.

Estado local investigado:

1. `cloudflared` ja esta instalado no Dev Container.
2. Versao observada:
   - `cloudflared version 2026.5.0`.
3. Usuario atual:
   - `node`.
4. Ambiente:
   - WSL2/devcontainer Linux.
5. Como `systemd`/servico pode nao ser confiavel dentro do Dev Container, o caminho operacional
   preferido no workspace e:
   - MCP HTTP em um processo;
   - `cloudflared tunnel run` em outro processo;
   - token armazenado em arquivo local ignorado pelo Git.

Mudancas estruturais aplicadas:

1. Defaults de Cloudflare passam a ser:
   - `COPILOT_MCP_CLOUDFLARE_MODE=named-permanent`;
   - `COPILOT_MCP_CLOUDFLARE_TUNNEL_NAME=workspace-mcp-dev`;
   - `COPILOT_MCP_CLOUDFLARE_ZONE=aurelin.org`;
   - `COPILOT_MCP_CLOUDFLARE_PUBLIC_HOSTNAME=workspace-mcp-dev.aurelin.org`;
   - `COPILOT_MCP_CLOUDFLARE_PUBLIC_URL=https://workspace-mcp-dev.aurelin.org/mcp`;
   - `COPILOT_MCP_CLOUDFLARE_ORIGIN_URL=http://127.0.0.1:3333`.
2. O CLI `npm run copilot:mcp:cloudflare:run` agora aceita:
   - `CLOUDFLARE_TUNNEL_TOKEN`;
   - `CLOUDFLARE_TUNNEL_TOKEN_FILE`.
3. O caminho preferido e `CLOUDFLARE_TUNNEL_TOKEN_FILE`, para reduzir risco de vazamento em
   historico de shell.
4. `mcp_tunnel_status`, `mcp_runtime_health`, `mcp_smoke_workspace`, `mcp_session_profile`,
   `chatgpt_connector_profile` e `chatgpt_connector_current_url_status` passam a tratar o
   tunnel permanente como fonte primaria.
5. Quick Tunnel continua disponivel como fallback:
   - `COPILOT_MCP_CLOUDFLARE_MODE=temporary-quick npm run copilot:mcp:cloudflare:quick`.

Runbook permanente atual:

1. Criar arquivo local de token:
   - `src/copilot/.ai/cloudflare/workspace-mcp-dev.token`
2. O conteudo do arquivo deve ser somente o token gerado pela tela Cloudflare.
3. Nunca versionar esse arquivo.
4. Rodar MCP HTTP:
   - `npm run copilot:mcp:http`
5. Em outro processo, rodar o tunnel:
   - `CLOUDFLARE_TUNNEL_TOKEN_FILE=src/copilot/.ai/cloudflare/workspace-mcp-dev.token npm run copilot:mcp:cloudflare:run`
6. No Cloudflare, confirmar que o tunnel `workspace-mcp-dev` detecta conexao ativa.
7. Publicar hostname:
   - hostname: `workspace-mcp-dev.aurelin.org`;
   - service/origin: `http://127.0.0.1:3333`.
8. Rodar smoke:
   - `npm run copilot:mcp:cloudflare:smoke`
9. No ChatGPT, usar:
   - nome: `Repo DevContainer MCP`;
   - URL: `https://workspace-mcp-dev.aurelin.org/mcp`;
   - autenticacao atual: sem autenticacao / desenvolvimento controlado.

Pendencias externas:

1. Confirmar no dashboard Cloudflare que a conexao do tunnel foi detectada.
   - Estado local: conexao registrada pelo `cloudflared` com quatro conexoes `http2`.
2. Confirmar rota/public hostname em `workspace-mcp-dev.aurelin.org`.
   - Estado local em 2026-05-23: `curl https://workspace-mcp-dev.aurelin.org/health`
     ainda falha com DNS `Could not resolve host`, logo falta publicar/propagar o hostname.
3. Rodar smoke externo contra `/health` e `/mcp` depois que DNS resolver.
4. Atualizar o conector no ChatGPT para a URL permanente.
5. Rodar teste real no ChatGPT com `mcp_tunnel_status`, `repo_status`, `mcp_autonomy_power_score`
   e `mcp_run_safe_validation_suite`.

Validacao local desta virada:

1. `node scripts/env/validate-env.js`: passou.
2. `node scripts/env/check-env-local.mjs`: passou.
3. `node scripts/env/audit-env-surface.mjs`: falhou por lacunas preexistentes fora desta frente
   (`COPILOT_SDK_ENABLED`, `COPILOT_TEST_*`, `ENABLE_AUDIT_AGENT_PM2_PROCESSES`,
   `LLM_B_TERMINAL_PORT`, `LSP_`, `NODE_COMPILE_CACHE`, `XDG_CACHE_HOME`); as novas variaveis
   Cloudflare ficaram cobertas por templates/schema.
4. `npm run typecheck:strict:src.copilot`: passou.
5. `npm run lint:copilot`: passou.
6. `npm run copilot:mcp:safe-suite -- mcp-full`: passou com 83 testes MCP.
7. `npm run test:copilot:unit`: passou com 3082 testes.
8. `npm run copilot:mcp:cloudflare:status`: passou com `named-permanent`, MCP HTTP vivo e
   `cloudflared` vivo.

## 13. Estado feito vs faltante apos a nova auditoria

Feito:

1. 67 tools expostas.
2. Annotations completas.
3. `idempotentHint` para read-only.
4. `mcp_tools_status`.
5. `mcp_session_profile`.
6. `mcp_golden_prompts`.
7. `mcp_maintenance_plan`.
8. `mcp_maintenance_apply_safe_fixes`.
9. `delegate_to_repo_autonomy_runner`.
10. `mcp_run_safe_validation_suite`.
11. Quarantine/restore/list/inspect.
12. Cloudflare permanent tunnel workflow como padrao; Quick Tunnel como fallback.
13. Testes MCP e unitarios passando no ultimo ciclo: 83 MCP e 3082 unitarios.
14. `outputSchema` registry-wide.
15. `_meta.securitySchemes` registry-wide para perfil dev `noauth`.
16. Plan-only read-only tools para patch/create/quarantine/move/index/validation.
17. `chatgpt_connector_current_url_status`.
18. `repo_root_redaction_status`.
19. Runtime health agregado com dirty workspace, index, tunnel e ultimo smoke local.
20. Auto index refresh opt-in no boot HTTP do MCP.
21. `mcp_last_validation_summary`.
22. `mcp_host_block_diagnostics`.
23. `mcp_auth_profile`.
24. OAuth protected resource metadata endpoint.
25. Scope/security-scheme readiness por tool.
26. Enforcement gradual por tool, desligado por padrao no tunel temporario.
27. Validador bearer token por static token local ou OAuth/JWKS.
28. `mcp_oauth_issuer_diagnostics` para checar metadata OAuth/OIDC do issuer real.
29. Templates de env sem segredo dentro de `mcp_auth_profile`.
30. `mcp_autonomy_power_score`.

Faltante P0:

1. Nenhum item P0 da nova auditoria permanece aberto apos a Faixa D; os proximos itens sao P1/P2.

Faltante P1:

1. Nenhum item P1 da nova auditoria permanece aberto apos a Faixa H.

Faltante P2:

1. OAuth authorization server metadata real.
2. Teste OAuth/JWKS real com ChatGPT.
3. Teste real dos templates de env OAuth contra issuer escolhido apos diagnostico.
4. Teste ChatGPT OAuth real.
5. Dashboard visual externo, se ainda for util apos o power score read-only.
