# Plano Canonico — ChatGPT MCP para `src/copilot`

**Data canonica:** 2026-05-22  
**Workspace:** `/workspaces/chatgpt-docker-puppeteer`  
**Escopo operacional:** `src/copilot/`  
**Branch de trabalho:** `main`  
**Estado Git inicial deste ciclo:** PR #135 mesclado em `main`, checkout local fast-forward em `origin/main`  
**Objetivo:** criar as condicoes para que `https://chatgpt.com/` se conecte ao workspace via MCP server local/tunelado, com controle amplo, auditavel e integrado ao projeto Copilot SDK 0.3.0 existente.

---

## 1. Contrato de escopo

1. O escopo pratico e `src/copilot/`.
2. O restante do repositorio e contexto secundario, usado apenas quando scripts, configs ou dependencias forem necessarios.
3. O servidor MCP deve ficar sob `src/copilot/`.
4. A LLM-B existente em `src/copilot` nao deve depender do MCP server para funcionar.
5. A LLM-B pode se integrar ao MCP server como consumidor local, ponte ou delegador.
6. O MCP server deve operar o repo real aberto no Dev Container.
7. A conexao remota do ChatGPT deve ser por Streamable HTTP em `/mcp`.
8. O uso local por VS Code, Copilot SDK ou outros clientes pode usar `stdio`.
9. SSE legado fica fora do caminho principal.
10. O sistema deve preservar auditabilidade, reversibilidade por Git, validacao de path e logs operacionais.

---

## 2. Fontes lidas e aplicadas

### 2.1 Documentos internos

1. `/workspaces/chatgpt-docker-puppeteer/AUDITORIA_TOOLS_READ_COMPLETA.md`
2. `/workspaces/chatgpt-docker-puppeteer/# Guia focado — Conexão do ChatGPT ao VS.md`
3. `src/copilot/tools/`
4. `src/copilot/bridges/mcp-tool-bridge.js`
5. `src/copilot/server/`
6. `src/copilot/sdk/`
7. `package.json`

### 2.2 Documentacao oficial OpenAI / Apps SDK

1. Apps SDK Quickstart: `https://developers.openai.com/apps-sdk/quickstart`
2. Connect from ChatGPT: `https://developers.openai.com/apps-sdk/deploy/connect-chatgpt`
3. MCP concepts for Apps SDK: `https://developers.openai.com/apps-sdk/concepts/mcp-server`
4. Build your MCP server: `https://developers.openai.com/apps-sdk/build/mcp-server`
5. Security & Privacy: `https://developers.openai.com/apps-sdk/guides/security-privacy`
6. Secure MCP Tunnel: `https://developers.openai.com/api/docs/guides/secure-mcp-tunnels`

### 2.3 Conclusoes oficiais relevantes

1. Apps SDK usa MCP para conectar apps ao ChatGPT.
2. Um MCP server e obrigatorio para expor capacidades.
3. UI web component e opcional.
4. Se o objetivo inicial e tools sem UI, podemos pular resource/widget.
5. ChatGPT exige endpoint HTTPS para conectar ao servidor.
6. Durante desenvolvimento, o endpoint local deve ser exposto por tunel ou Secure MCP Tunnel.
7. O campo do conector deve receber a URL publica com `/mcp`.
8. Streamable HTTP e o transporte recomendado para Apps SDK.
9. O servidor deve listar tools, chamar tools e retornar resultados estruturados.
10. Tool descriptors devem ter schemas claros.
11. Tool annotations devem indicar impacto: read-only, mundo aberto e destrutividade.
12. Inputs devem ser validados no servidor mesmo se vierem do modelo.
13. Acoes destrutivas devem exigir confirmacao humana.
14. Logs devem redigir dados sensiveis e manter correlation IDs.
15. Secure MCP Tunnel permite manter o servidor privado, usando saida HTTPS outbound para OpenAI.

---

## 3. Topologia canonica

```text
ChatGPT web
  -> conector Apps & Connectors
  -> HTTPS /mcp ou endpoint OpenAI Secure MCP Tunnel
  -> tunnel-client ou host HTTPS
  -> MCP server Node dentro do Dev Container
  -> Project Control Plane em src/copilot/mcp
  -> tools existentes em src/copilot/tools
  -> repo real em /workspaces/chatgpt-docker-puppeteer
```

### 3.1 Caminho local

```text
VS Code / MCP Inspector / cliente local
  -> stdio ou http://127.0.0.1:<porta>/mcp
  -> MCP server
  -> tools read/git/diagnostico
```

### 3.2 Caminho remoto

```text
ChatGPT
  -> https://<tunel>/mcp
  -> Streamable HTTP transport
  -> MCP server stateless por request
```

### 3.3 Caminho Copilot SDK

```text
LLM-B / Copilot SDK 0.3.0
  -> continua inicializando pelas rotas e bootstrap atuais
  -> opcionalmente consome MCP local via bridge
  -> nao depende do MCP server para boot
```

---

## 4. Estado atual encontrado em `src/copilot`

### 4.1 Pontos fortes existentes

1. Ha um subsistema de tools maduro em `src/copilot/tools`.
2. `buildTool` e a factory canonica de tools.
3. `withSkipPermission` existe para tools read-only.
4. `bootstrapTools` agrega task, code, git, session, file, search, shell, web, todo e permission.
5. Tools de arquivo ja validam paths pelo workspace.
6. Tools de leitura ja possuem cache, truncamento e metadados IO.
7. Tools de shell ja possuem sandbox, blocklist, timeout e limpeza de ambiente sensivel.
8. Ha camada de auditoria em `src/copilot/audit`.
9. Ha locks em `src/copilot/infra/locks`.
10. Ha runtime operation/transaction/rollback em `src/copilot/infra/runtime`.
11. Ha servidor Express proprio em `src/copilot/server`.
12. Ha rotas SDK e SSE para o ecossistema LLM-B.
13. Ha testes unitarios extensos sob `tests/unit/copilot`.
14. O projeto usa ESM e JSDoc com `// @ts-check`.
15. A dependencia `@modelcontextprotocol/sdk` ja existe.
16. A dependencia `@github/copilot-sdk` esta em `^0.3.0`.

### 4.2 Lacuna MCP real

Existe `src/copilot/bridges/mcp-tool-bridge.js`, mas ele e uma ponte consumidora:

1. Lista tools MCP a partir de um endpoint local.
2. Converte schemas MCP para Zod.
3. Cria custom tools do Copilot prefixadas por `mcp_`.
4. Chama `tools/call` via HTTP.

Essa ponte nao e o servidor MCP canonico que o ChatGPT deve chamar.  
Portanto, a nova implementacao deve criar o servidor MCP, nao substituir a ponte.

### 4.3 Local sugerido

```text
src/copilot/mcp/
  README.md
  index.js
  server.js
  registry.js
  adapters/
    http.js
    stdio.js
  tools/
    repo-status.js
    repo-tree.js
    repo-read-file.js
    repo-search-text.js
    git.js
    project-doctor.js
  control-plane/
    paths.js
    audit.js
    result.js
    annotations.js
```

### 4.4 Integracao com server existente

O Express server atual pode receber uma rota `/mcp`, mas a primeira versao deve ser independente:

1. `node src/copilot/mcp/index.js --transport http`
2. `node src/copilot/mcp/index.js --transport stdio`
3. Sem acoplar boot da LLM-B ao MCP.
4. Sem exigir que `terminal:llm-b` suba o MCP.
5. Em fase posterior, adicionar comando terminal ou rota para health/status MCP.

---

## 5. Decisoes canonicas

1. O servidor MCP sera implementado em JavaScript ESM com `// @ts-check`.
2. O runtime alvo e Node 24, mas a implementacao deve evitar APIs instaveis desnecessarias.
3. O transporte remoto principal e Streamable HTTP.
4. O endpoint remoto principal e `/mcp`.
5. O transporte local principal e `stdio`.
6. O servidor HTTP deve escutar por padrao em `127.0.0.1`.
7. A porta padrao sera configuravel por `COPILOT_MCP_PORT`.
8. A porta default inicial sera `3333`, salvo conflito operacional.
9. A raiz do repo sera `WORKSPACE_ROOT` do projeto quando disponivel.
10. O fallback de raiz sera `process.cwd()`.
11. Todo path de tool deve ser normalizado contra a raiz do workspace.
12. A primeira entrega de tools sera read-only e Git read-only.
13. Escrita, execucao e admin command ficam em faixas posteriores.
14. Tool names expostos ao ChatGPT devem ser claros e estaveis.
15. Tool names devem evitar colisao com tools internas da LLM-B.
16. O prefixo externo sera `repo_` para tools de workspace.
17. Tool annotations serao obrigatorias desde a primeira entrega.
18. Read-only tools terao `readOnlyHint: true`.
19. Write tools futuras terao `readOnlyHint: false`.
20. Tools destrutivas futuras terao `destructiveHint: true`.
21. Tools de arquivo devem reutilizar politica existente sempre que possivel.
22. O plano deve ser atualizado ao fim de cada faixa implementada.
23. Validadores canonicos do escopo: `typecheck:strict:src.copilot`, `lint:copilot`, `test:copilot:unit`.

---

## 6. Faixas, fases e subfases

### Faixa A — Sincronia e leitura integral

**Status:** concluida.

#### Fase A.1 — Git / PR / main

1. Identificar branch e PR abertos.
2. Commitar arquivos pendentes.
3. Push para branch do PR.
4. Marcar PR ready se necessario.
5. Mesclar PR em `main`.
6. Checkout `main`.
7. Pull fast-forward de `origin/main`.

#### Fase A.2 — Documentos internos

1. Ler integralmente `AUDITORIA_TOOLS_READ_COMPLETA.md`.
2. Ler integralmente `# Guia focado — Conexão do ChatGPT ao VS.md`.
3. Extrair implicacoes arquiteturais.
4. Registrar bugs/gaps relevantes.

#### Fase A.3 — Documentacao oficial

1. Ler quickstart Apps SDK.
2. Ler conexao do ChatGPT.
3. Ler conceitos MCP.
4. Ler build MCP server.
5. Ler Security & Privacy.
6. Ler Secure MCP Tunnel.

### Faixa B — Plano canonico e guardrails

**Status:** concluida em primeira versao.

#### Fase B.1 — Documento canonico

1. Criar `src/copilot/docs/CHATGPT_MCP_CANONICAL_PLAN.md`.
2. Registrar fontes e achados.
3. Registrar topologia.
4. Registrar roadmap.
5. Registrar execution ledger.

#### Fase B.2 — Contrato de arquitetura

1. Definir `src/copilot/mcp` como modulo dono.
2. Definir boundaries com `tools`, `server`, `bridges`, `sdk`.
3. Definir independencia da LLM-B.
4. Definir validadores.

#### Fase B.3 — Scripts e comandos planejados

1. Planejar `copilot:mcp:http`.
2. Planejar `copilot:mcp:stdio`.
3. Planejar smoke local com inspector.
4. Planejar validadores de escopo.

### Faixa C — MCP local read-only minimo

**Status:** concluida em primeira versao.

#### Fase C.1 — Estrutura de modulo

1. Criar `src/copilot/mcp/index.js`.
2. Criar `src/copilot/mcp/server.js`.
3. Criar `src/copilot/mcp/registry.js`.
4. Criar `src/copilot/mcp/adapters/http.js`.
5. Criar `src/copilot/mcp/adapters/stdio.js`.
6. Criar `src/copilot/mcp/control-plane/paths.js`.
7. Criar `src/copilot/mcp/control-plane/result.js`.
8. Criar `src/copilot/mcp/control-plane/annotations.js`.

#### Fase C.2 — Tools de descoberta

1. `repo_status`
2. `repo_tree`
3. `repo_read_file`
4. `repo_search_text`
5. `project_doctor`

#### Fase C.3 — Tools Git read-only

1. `git_status`
2. `git_diff`
3. `git_log`
4. `git_branch_info`

#### Fase C.4 — Saida MCP

1. Retornar `content` textual curto.
2. Retornar `structuredContent` para dados parseaveis.
3. Evitar secrets.
4. Limitar payloads.
5. Incluir metadata util em `_meta` apenas quando nao for necessaria ao modelo.

#### Fase C.5 — Testes unitarios

1. Testar path resolver.
2. Testar registry de tools.
3. Testar annotations obrigatorias.
4. Testar pelo menos uma chamada de tool read-only.

### Faixa D — Streamable HTTP `/mcp`

**Status:** concluida em primeira versao.

#### Fase D.1 — HTTP adapter

1. Usar `StreamableHTTPServerTransport`.
2. Aceitar `POST`, `GET`, `DELETE`.
3. Responder `OPTIONS` para CORS preflight.
4. Expor `GET /` ou `/health` simples.
5. Configurar `enableJsonResponse`.
6. Usar modo stateless inicialmente.

#### Fase D.2 — Bind seguro

1. Bind default em `127.0.0.1`.
2. Host configuravel por `COPILOT_MCP_HOST`.
3. Porta configuravel por `COPILOT_MCP_PORT`.
4. Log de URL local.

#### Fase D.3 — Smoke local

1. `node src/copilot/mcp/index.js --transport http`.
2. `npx @modelcontextprotocol/inspector --server-url http://127.0.0.1:3333/mcp --transport http`.
3. Verificar tools/list.
4. Verificar `repo_status`.
5. Verificar `repo_read_file`.

### Faixa E — Stdio local

**Status:** concluida em primeira versao.

#### Fase E.1 — Stdio adapter

1. Usar `StdioServerTransport`.
2. Evitar logs em stdout.
3. Logs em stderr ou logger interno.
4. Encerrar corretamente em SIGINT/SIGTERM.

#### Fase E.2 — VS Code/devcontainer

1. Documentar entrada de MCP local.
2. Planejar `customizations.vscode.mcp` em fase posterior se apropriado.
3. Nao alterar `.devcontainer` nesta faixa sem necessidade.

### Faixa F — Project Control Plane

**Status:** em execucao; F.1 e auditoria persistente inicial concluidas.

#### Fase F.1 — `.ai` operacional sob escopo do projeto

1. Criar estrutura planejada dentro de `src/copilot/.ai` ou documentar decisao.
2. `context-pack.md`.
3. `audit/`.
4. `jobs/`.
5. `decisions/`.

#### Fase F.2 — Auditoria MCP

1. Registrar tool calls.
2. Registrar timestamp, tool, argumentos sanitisados, duracao, resultado.
3. Integrar com `src/copilot/audit` quando possivel.
4. Evitar prompt raw e secrets.

#### Fase F.3 — Jobs

1. Definir modelo de job.
2. Definir `spawn_job`.
3. Definir `get_job_output`.
4. Definir `cancel_job`.
5. Persistir logs.

### Faixa G — Escrita controlada

**Status:** G.1 concluida; G.2 guardrails iniciais concluidos no MCP.

#### Fase G.1 — Tools de escrita

1. `repo_apply_patch` — concluida.
2. `repo_write_file` — concluida.
3. `repo_create_file` — concluida.
4. `repo_move_file` — concluida.
5. `repo_remove_file` — concluida.

#### Fase G.2 — Guardrails de escrita

1. Path sempre dentro do workspace — concluido via `resolveReadPath`/`resolveWritePath`.
2. Diff antes/depois — concluido para `repo_apply_patch`, `repo_write_file` e `repo_create_file`; move/remove retornam metadados antes/depois.
3. Audit log obrigatorio — concluido via wrapper MCP e eventos especificos por tool de escrita.
4. Grants para operacoes destrutivas — concluido inicialmente por `destructiveHint` e `confirm`/`confirmOverwrite`.
5. Reversibilidade por Git quando aplicavel — concluido inicialmente por hashes, snapshots de remocao e diff previews.

### Faixa H — Execucao controlada

**Status:** H concluida no lado MCP.

#### Fase H.1 — Scripts canonicos

1. `run_typecheck_copilot` — concluida.
2. `run_lint_copilot` — concluida.
3. `run_unit_copilot` — concluida.
4. `run_project_doctor` — concluida.

#### Fase H.2 — Jobs assincronos

1. Comandos longos nao bloqueiam tool call indefinidamente — concluido via `spawnValidatorJob`.
2. Saida paginada — concluido via `job_get_output` com `tailBytes`.
3. Cancelamento — concluido via `job_cancel`.
4. Timeout configuravel — concluido via `timeoutMs` por chamada.

### Faixa I — Tunnel e ChatGPT

**Status:** concluida no lado repo/local; pendente apenas o preenchimento humano do endpoint real no ChatGPT.

#### Fase I.1 — Secure MCP Tunnel

1. Documentar pre-requisitos.
2. Definir onde `tunnel-client` roda.
3. Apontar para `http://127.0.0.1:3333/mcp`.
4. Registrar endpoint OpenAI no conector.

#### Fase I.2 — Formulario ChatGPT

1. Nome: `Repo DevContainer MCP`.
2. Descricao: conector para o repo aberto no Dev Container, com leitura, Git, diagnosticos e operacoes controladas.
3. URL: `https://<endpoint>/mcp`.
4. Autenticacao: conforme modo do tunel/OAuth disponivel.

#### Fase I.3 — Testes no ChatGPT

1. Verificar que tools aparecem.
2. Chamar `repo_status`.
3. Chamar `repo_tree`.
4. Chamar `repo_read_file`.
5. Chamar `git_status`.
6. Somente depois liberar escrita.

### Faixa J — Integracao Copilot SDK 0.3.0

**Status:** J concluida no lado MCP/local.

#### Fase J.1 — Consumidor local

1. Decidir se LLM-B consome o MCP server via bridge existente — concluido: consumo via MCP server config opt-in.
2. Atualizar `mcp-tool-bridge` apenas se necessario — concluido: sem alteracao obrigatoria na bridge legada.
3. Manter fallback quando MCP offline — concluido: default `COPILOT_MCP_SERVERS` segue vazio.

#### Fase J.2 — Delegacao

1. Expor tools MCP futuras para criar ou acionar sessao Copilot — concluido como leitura/delegacao segura de estado.
2. Nao fazer o boot da LLM-B depender dessas tools — concluido.
3. Registrar eventos no hub/observability quando aplicavel — coberto pelo audit wrapper MCP; hub profundo fica para K/L.

### Faixa K — Hardening e release operacional

**Status:** K.1/K.2 base concluidas; K.3 em andamento.

#### Fase K.1 — Seguranca

1. Revisar tool descriptions contra prompt injection — em andamento.
2. Validar inputs server-side — concluido via schemas Zod e path policy.
3. Limitar structured content — em andamento; snapshots de rollback nao saem mais no MCP.
4. Redigir secrets — concluido inicialmente por path policy e remocao de snapshot base64 em `repo_remove_file`.
5. Testar paths fora do workspace — concluido nos testes MCP de escrita.

#### Fase K.2 — Observabilidade

1. Metrics por tool — concluido.
2. Latencia — concluido.
3. Erros — concluido.
4. Ultima chamada — concluido.
5. Health endpoint — concluido com `GET /health` e `mcp_runtime_health`.

#### Fase K.3 — Documentacao final

1. Atualizar README do modulo.
2. Atualizar este plano.
3. Registrar comandos de operacao.
4. Registrar troubleshooting.

---

## 7. Validadores canonicos

1. Typecheck strict do escopo:

```bash
npm run typecheck:strict:src.copilot
```

2. Lint do escopo:

```bash
npm run lint:copilot
```

3. Testes unitarios do escopo:

```bash
npm run test:copilot:unit
```

Observacao: durante a sincronizacao inicial foi solicitado nao validar antes. A partir da implementacao, estes validadores voltam a ser os criterios canonicos de saida.

---

## 8. Execution ledger

### 2026-05-22 — Sincronia inicial

1. Branch inicial: `codex/faixa-f-session-fs-metadata`.
2. PR: `#135`.
3. Commit criado: `docs: add ChatGPT MCP planning inputs`.
4. Push realizado para a branch do PR.
5. PR estava draft; foi marcado como ready.
6. PR foi mesclado em `main`.
7. `main` local foi atualizado por fast-forward para `origin/main`.

### 2026-05-22 — Investigacao

1. Documento de auditoria read tools lido integralmente.
2. Guia focado ChatGPT-MCP-VS-Code lido integralmente.
3. Docs oficiais OpenAI/Apps SDK consultadas.
4. `src/copilot` mapeado.
5. Lacuna MCP server identificada.
6. Ponte MCP consumidora existente identificada.
7. Roadmap canonico definido.

### 2026-05-22 — Faixa B concluida

1. Criado `src/copilot/docs/CHATGPT_MCP_CANONICAL_PLAN.md`.
2. Registradas fontes oficiais, achados locais, topologia e roadmap.
3. Definida a diferenca entre MCP server canonico e MCP bridge consumidora existente.

### 2026-05-22 — Faixas C/D/E primeira versao

1. Criado modulo `src/copilot/mcp`.
2. Criada factory `createCopilotMcpServer()`.
3. Criado registry canonico de tools MCP.
4. Criados adapters `http` e `stdio`.
5. Criados scripts `copilot:mcp:http` e `copilot:mcp:stdio`.
6. Expostas tools read-only:
   - `repo_status`
   - `repo_tree`
   - `repo_read_file`
   - `repo_search_text`
   - `git_status`
   - `git_diff`
   - `git_log`
   - `git_branch_info`
   - `project_doctor`
7. Todas as tools iniciais possuem annotations MCP read-only.
8. Smoke HTTP validou `/health`, `initialize`, `tools/list` e `tools/call repo_read_file`.
9. Smoke stdio validou stdout limpo durante bootstrap.

### 2026-05-22 — Validacao

1. `npm run typecheck:strict:src.copilot` passou.
2. `npm run lint:copilot` passou.
3. `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou com 2 arquivos e 6 testes.
4. `npm run test:copilot:unit` falhou em 6 testes preexistentes fora do modulo MCP:
   - `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`
   - `tests/unit/copilot/contracts/test_arch_contracts.spec.js`
   - `tests/unit/copilot/contracts/test_global_architecture_strict.spec.js`
   - `tests/unit/copilot/contracts/test_owner_sovereignty_block_a.spec.js`
   - `tests/unit/copilot/contracts/test_terminal_barrel_governance.spec.js`

### Proximo item cronologico

Faixa F, Fase F.1: Project Control Plane operacional, memoria `.ai`, auditoria MCP persistente e modelo inicial de jobs.

### 2026-05-22 — Faixa F parcial

1. Criado `src/copilot/.ai/context-pack.md`.
2. Criadas pastas `src/copilot/.ai/audit/` e `src/copilot/.ai/jobs/` com `.gitkeep`.
3. `.gitignore` atualizado para ignorar audit/job runtime data mantendo contratos.
4. `appendMcpAuditEvent()` criado em `src/copilot/mcp/control-plane/audit.js`.
5. Registry MCP passou a registrar `tool_call_started`, `tool_call_completed` e `tool_call_failed`.
6. Audit file default: `src/copilot/.ai/audit/mcp-tool-calls.jsonl`.
7. Override operacional: `COPILOT_MCP_AUDIT_FILE`.
8. Kill switch operacional: `COPILOT_MCP_AUDIT_DISABLED=true`.
9. Teste unitario de persistencia audit adicionado.
10. Validacao focada: typecheck strict, lint MCP e testes MCP passaram.

### 2026-05-22 — Faixa F jobs inicial

1. Criado `src/copilot/mcp/control-plane/jobs.js`.
2. Criadas tools:
   - `run_copilot_validator`
   - `job_get_output`
   - `job_cancel`
3. Execucao propositalmente allowlistada, sem `run_admin_command`.
4. Validadores suportados:
   - `typecheck`
   - `lint`
   - `unit-mcp`
   - `unit-copilot`
5. Logs de jobs ficam em `src/copilot/.ai/jobs/*.log`, ignorados pelo Git.
6. Smoke HTTP confirmou que as tools de jobs aparecem em `tools/list`.
7. Validacao focada: typecheck strict, lint MCP e testes MCP passaram.

### Proximo item cronologico apos Faixa F jobs inicial

Faixa G, Fase G.1: escrita controlada (`repo_apply_patch` primeiro), com diff, path policy e auditoria.

### 2026-05-22 — Faixa I repo-side

1. Criado `src/copilot/docs/CHATGPT_MCP_CONNECT_CHATGPT_RUNBOOK.md`.
2. Criado `src/copilot/mcp/connection/profile.js`.
3. Criadas tools:
   - `chatgpt_connector_profile`
   - `chatgpt_connector_url_check`
4. Criado endpoint HTTP auxiliar:
   - `GET /chatgpt-connector.json`
5. Perfil canonico do formulario ChatGPT:
   - Nome: `Repo DevContainer MCP`
   - URL: `https://<endpoint-do-tunel>/mcp`
   - Auth: `secure-mcp-tunnel` ou OAuth conforme configuracao real.
6. Runbook cobre Secure MCP Tunnel em modo HTTP e stdio.
7. Runbook cobre smoke tests no ChatGPT: `repo_status`, `repo_tree`, `repo_read_file`, `git_status`.
8. Validacao local deve confirmar `/health`, `/chatgpt-connector.json`, `tools/list` e chamadas read-only.
9. Validacao executada:
   - `npm run typecheck:strict:src.copilot` passou.
   - `npm run lint:copilot` passou.
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 5 arquivos, 13 testes.
   - Smoke HTTP passou para `/health`, `/chatgpt-connector.json`, `tools/list` e `chatgpt_connector_url_check`.
   - `npm run test:copilot:unit` ainda falha em 6 testes preexistentes fora do modulo MCP/ChatGPT connection.

### Observacao de prontidao Faixa I

O repo agora fornece tudo que pode ser preparado localmente. A unica parte que nao pode ser materializada sem credenciais e
sem acao no browser e criar o `tunnel_id`, rodar `tunnel-client` com runtime API key real, copiar o endpoint HTTPS gerado e
preencher o formulario do ChatGPT. O runbook detalha essa operacao.

### Proximo item cronologico apos Faixa I

Faixa G, Fase G.1: escrita controlada (`repo_apply_patch` primeiro), com diff, path policy e auditoria.

### 2026-05-22 — Faixa G.1 escrita controlada MCP

1. Criado `src/copilot/mcp/tools/repo-write.js`.
2. Criado helper `resolveWritePath` em `src/copilot/mcp/control-plane/paths.js`.
3. Tools registradas:
   - `repo_write_file`
   - `repo_create_file`
   - `repo_apply_patch`
   - `repo_move_file`
   - `repo_remove_file`
4. `repo_apply_patch` usa `patchTextLocked`, com:
   - substituicao exata;
   - `dryRun`;
   - `expectedHash`;
   - `replace_all`;
   - `occurrence_index`;
   - diff preview;
   - hashes antes/depois;
   - metadados IO.
5. `repo_write_file` substitui arquivo existente, com:
   - `expectedHash`;
   - `dryRun`;
   - diff preview;
   - escrita atomica via `writeFileAtomic`.
6. `repo_create_file` cria arquivo novo, com:
   - falha se destino existe;
   - `dryRun`;
   - criacao opcional de diretorios pais;
   - escrita atomica via `createOrReplaceFileAtomic`.
7. `repo_move_file` move/renomeia arquivo, com:
   - overwrite desligado por padrao;
   - `confirmOverwrite` obrigatorio quando `overwrite=true`;
   - `dryRun`;
   - locks canonicos via `moveFileLocked`.
8. `repo_remove_file` remove somente arquivos regulares, com:
   - `destructiveHint=true`;
   - `confirm=true` obrigatorio;
   - `dryRun`;
   - snapshot de rollback quando disponivel via `deleteFileLocked`.
9. Auditoria:
   - wrapper MCP registra inicio/conclusao/falha de toda tool;
   - cada escrita registra evento especifico sem persistir conteudo editado.
10. Validacao executada:
    - `npm run typecheck:strict:src.copilot` passou.
    - `npm run lint:copilot` passou.
    - `node --max-old-space-size=6144 node_modules/.bin/eslint src/copilot/mcp tests/unit/copilot/mcp --no-cache` passou.
    - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 6 arquivos, 20 testes.
    - `npm run test:copilot:unit` ainda falha em 6 testes preexistentes fora do modulo MCP; nesta rodada foram 3019 testes totais, 3013 passaram.
11. Falhas unit completas ainda externas ao MCP:
    - `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`: expectativa BYOK com 2 entradas recebeu 3.
    - `tests/unit/copilot/contracts/test_arch_contracts.spec.js`: import externo para `#copilot/agent/session`.
    - `tests/unit/copilot/contracts/test_global_architecture_strict.spec.js`: violacao em `hooks/session-hooks.js`.
    - `tests/unit/copilot/contracts/test_owner_sovereignty_block_a.spec.js`: `hooks/session-hooks.js` importa runtime/agent.
    - `tests/unit/copilot/contracts/test_terminal_barrel_governance.spec.js`: imports cross-folder do terminal sem barrels.

### Proximo item cronologico apos Faixa G.1

Faixa H ja possui a base inicial de jobs allowlistados. A proxima consolidacao cronologica e alinhar os nomes canonicos
`run_typecheck_copilot`, `run_lint_copilot`, `run_unit_copilot` e `run_project_doctor` como aliases/tools explicitas sobre
o mecanismo de jobs ja existente.

### 2026-05-22 — Faixa H.1 aliases canonicos de validacao

1. `src/copilot/mcp/tools/jobs.js` agora expoe wrappers canonicos:
   - `run_typecheck_copilot`
   - `run_lint_copilot`
   - `run_unit_copilot`
   - `run_project_doctor`
2. `run_typecheck_copilot`, `run_lint_copilot` e `run_unit_copilot` usam `spawnValidatorJob` e retornam `job.id`.
3. `run_project_doctor` reutiliza o handler de `project_doctor`, sem abrir processo desnecessario.
4. `run_copilot_validator` permanece como ferramenta parametrica para compatibilidade e para `unit-mcp`.
5. `job_get_output` e `job_cancel` continuam sendo o plano de observabilidade e controle.
6. Validacao executada:
   - `npm run typecheck:strict:src.copilot` passou.
   - `npm run lint:copilot` passou.
   - `node --max-old-space-size=6144 node_modules/.bin/eslint src/copilot/mcp tests/unit/copilot/mcp --no-cache` passou.
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 6 arquivos, 21 testes.

### Proximo item cronologico apos Faixa H.1

Concluir H.2 adicionando timeout explicito por chamada de job e metadados de comando no retorno do job.

### 2026-05-22 — Faixa H.2 jobs assincronos completos

1. `spawnValidatorJob` agora aceita `timeoutMs` por chamada.
2. `resolveJobTimeoutMs` normaliza timeout entre 1000 e 3600000 ms.
3. Job record publico agora inclui:
   - `command`
   - `args`
   - `timeoutMs`
   - `signal`
   - `timedOut`
4. Logs de job registram o timeout efetivo.
5. Jobs que excedem timeout recebem SIGTERM e ficam com `timedOut=true`.
6. Tools que aceitam `timeoutMs`:
   - `run_copilot_validator`
   - `run_typecheck_copilot`
   - `run_lint_copilot`
   - `run_unit_copilot`
7. Validacao executada:
   - `npm run typecheck:strict:src.copilot` passou.
   - `npm run lint:copilot` passou.
   - `node --max-old-space-size=6144 node_modules/.bin/eslint src/copilot/mcp tests/unit/copilot/mcp --no-cache` passou.
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 6 arquivos, 22 testes.

### Proximo item cronologico apos Faixa H

Retomar Faixa I somente no ambiente externo quando houver endpoint HTTPS real do Secure MCP Tunnel; no repo, seguir para
Faixa J: integracao opcional do LLM-B/Copilot SDK com o MCP local sem criar dependencia obrigatoria.

### 2026-05-22 — Faixa J.1 MCP local opcional para LLM-B

1. `src/copilot/config/mcp-servers.js` registra `copilot-local`.
2. `copilot-local` e um servidor MCP stdio:
   - command: `node`
   - args: `src/copilot/mcp/index.js --transport stdio`
3. Ativacao:
   - `COPILOT_MCP_SERVERS=copilot-local npm run terminal:llm-b`
4. Fallback:
   - default continua desligado;
   - LLM-B nao depende do MCP server;
   - MCP offline nao impede boot quando env nao habilita `copilot-local`.
5. `mcp-tool-bridge` legado nao foi alterado nesta fase, pois o SDK ja aceita `mcpServers` em `SessionConfig`.
6. Validacao executada:
   - `npm run typecheck:strict:src.copilot` passou.
   - `npm run lint:copilot` passou.
   - `node --max-old-space-size=6144 node_modules/.bin/eslint src/copilot/mcp src/copilot/config/mcp-servers.js tests/unit/copilot/mcp --no-cache` passou.
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 7 arquivos, 24 testes.

### Proximo item cronologico apos Faixa J.1

Faixa J.2: expor uma delegacao MCP segura para consultar estado de sessoes Copilot/LLM-B sem obrigar boot da LLM-B.

### 2026-05-22 — Faixa J.2 leitura segura de sessoes Copilot

1. Criado `src/copilot/mcp/tools/copilot-session.js`.
2. Tools registradas:
   - `copilot_sessions_list`
   - `copilot_session_get`
3. As tools leem `defaultSdkSessionRegistry` via facades publicas de `#copilot/sdk/session`.
4. As tools nao:
   - criam sessao;
   - retomam sessao;
   - disparam turno LLM-B;
   - expoem objeto vivo `session`.
5. Retorno publico contem apenas:
   - `sessionId`
   - `model`
   - `createdAt`
   - `messagesCount`
6. Validacao executada:
   - `npm run typecheck:strict:src.copilot` passou.
   - `npm run lint:copilot` passou.
   - `node --max-old-space-size=6144 node_modules/.bin/eslint src/copilot/mcp tests/unit/copilot/mcp --no-cache` passou.
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 8 arquivos, 27 testes.

### Proximo item cronologico apos Faixa J

Faixa K: hardening e release operacional, com revisao de seguranca das tool descriptions, outputs, prompts e superficie
de escrita/execucao.

### 2026-05-22 — Faixa K.1/K.2 hardening e observabilidade MCP

1. Criado `src/copilot/mcp/control-plane/metrics.js`.
2. Criado `src/copilot/mcp/tools/runtime-health.js`.
3. Tool nova:
   - `mcp_runtime_health`
4. Registry MCP agora registra metricas por tool:
   - chamadas;
   - erros;
   - duracao total;
   - duracao media;
   - ultima duracao;
   - ultima chamada;
   - ultimo status de erro.
5. `GET /health` agora inclui snapshot de metricas.
6. `repo_remove_file` deixou de retornar `previousSnapshotBase64`; retorna apenas `rollbackSnapshotAvailable` e hashes.
7. Validacao executada:
   - `npm run typecheck:strict:src.copilot` passou.
   - `npm run lint:copilot` passou.
   - `node --max-old-space-size=6144 node_modules/.bin/eslint src/copilot/mcp tests/unit/copilot/mcp --no-cache` passou.
   - `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js` passou: 9 arquivos, 29 testes.

### Proximo item cronologico apos K.1/K.2

Faixa K.3: finalizar documentacao de release operacional, incluindo checklist de seguranca, troubleshooting e comandos.

---

## 9. Criterios de pronto por faixa

### Faixa B pronta quando

1. Este arquivo existir.
2. O roadmap estiver detalhado.
3. As fontes estiverem registradas.
4. A distincao entre MCP server e MCP bridge estiver clara.

### Faixa C pronta quando

1. `src/copilot/mcp` existir.
2. O servidor MCP puder ser instanciado.
3. Tools read-only estiverem registradas.
4. Testes unitarios cobrirem registry/path/annotations/tool call.

### Faixa D pronta quando

1. `node src/copilot/mcp/index.js --transport http` subir.
2. `/mcp` responder handshake MCP via Streamable HTTP.
3. `GET /health` ou `/` responder.
4. CORS preflight basico funcionar.

### Faixa E pronta quando

1. `node src/copilot/mcp/index.js --transport stdio` conectar.
2. stdout estiver reservado ao protocolo.
3. logs nao quebrarem cliente MCP.

### Faixa F pronta quando

1. Auditoria MCP persistir eventos.
2. `.ai` ou pasta equivalente estiver definida.
3. Jobs tiverem modelo inicial.

### Faixa G pronta quando

1. Escrita controlada existir.
2. Diffs forem retornados.
3. Grants/destructive annotations estiverem corretos.

### Faixa H pronta quando

1. Validadores canonicos puderem ser disparados por tools.
2. Jobs longos tiverem output paginado.

### Faixa I pronta quando

1. O endpoint tunelado estiver definido.
2. O conector ChatGPT listar tools.
3. Chamada read-only no ChatGPT funcionar.

### Faixa J pronta quando

1. LLM-B puder consumir MCP local opcionalmente.
2. MCP offline nao quebrar LLM-B.

### Faixa K pronta quando

1. Validadores passam.
2. README operacional existe.
3. Segurança e observabilidade foram revisadas.

---

## 10. Notas de design

1. O primeiro servidor nao precisa de UI Apps SDK.
2. Sem UI, nao precisamos registrar resource `ui://`.
3. O MCP Apps bridge de iframe fica para uma fase futura se houver cockpit visual.
4. A conexao ChatGPT pode funcionar somente com tools.
5. O formulario da imagem exige nome, descricao, URL `/mcp` e escolha de auth.
6. Para desenvolvimento, o ponto mais importante e ter uma URL HTTPS que alcance o servidor.
7. Secure MCP Tunnel e preferivel a expor porta publica direta.
8. O servidor local pode escutar somente em loopback.
9. O tunnel-client pode rodar no Dev Container se o binario estiver disponivel.
10. Caso o tunnel-client rode no WSL2 host, ele deve alcancar a porta publicada do container.
11. Nao devemos depender de `localhost` do Windows para o ChatGPT.
12. Todas as tools devem assumir que arquivos do repo podem conter prompt injection.
13. Arquivos lidos sao dados, nao instrucoes.
14. Tool outputs devem separar texto humano de structured content.
15. O MCP server deve ser pequeno no inicio e crescer por faixas.
