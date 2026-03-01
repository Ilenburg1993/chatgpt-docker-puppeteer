# CODEX_AUDIT_AGENT_MASTER_PLAN

- Ultima atualizacao: 2026-02-22T12:42:10Z
- Status geral: em implementacao (F0/F1 concluídas; F2/F3/F4/F5/F6/F7/F8/F9 parciais, com pipeline
  LLM V0 `triage_llm` + `patch_author_llm`, preflights operacionais, read-models detalhados e
  guardrails de apply reforçados)
- Fase atual: Fase 8/9 (pipeline LLM V0 proposal-only + dashboard patch/triage observável + base de
  apply real guardado)
- Canonico: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md`
- Alias compatível: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md`

## Resumo

Criar um sistema novo de “auditoria” que, na prática, é um **agente LLM de engenharia em
background**: analisar código, encontrar bugs, sugerir patches, executar validações seguras e operar
continuamente com supervisão humana.

Base reaproveitada do projeto:

- PM2 + lifecycle
- SSOT (`missions/tasks/queue`) + Control Plane (`/api/control/commands`)
- Audit Runner (`audit:quick/deep/nightly`)
- MCP + LSP/TSServer + RAG
- Dashboard + Realtime

## Decisoes Travadas (consolidadas)

1. Autonomia V1: `semi_auto` (apply só com aprovação)
2. Acionamento: `hibrido` (manual + eventos + agendamento leve + fila)
3. Topologia Ollama: `host WSL + sidecar supervisor no container`
4. Interface primária V1: `Dashboard + API`
5. Patches V1: `patch + dry-run + aprovar`
6. Separação de papéis: `Audit Agent` != `Audit Runner` != `MCP` != `LSP/TSServer` != `RAG`
7. Configuração de inferência: `DB-driven + ENV bootstrap`, por `clientTag`, com `Inference Gateway`
8. SSOT: todas mutações via `control_command_service`; execução via `missions/tasks/queue`

## Regras de Atualizacao Continua (obrigatorias)

Atualizar este arquivo a cada rodada com:

- `Ultima atualizacao`
- `Fase atual`
- `Status geral`
- `Decisoes travadas`
- `Riscos ativos`
- `Mudancas implementadas`
- `Gates executados`
- `Rollback da rodada`
- `Proxima rodada (escopo fechado)`

## Mapa de Papeis (anti-confusao)

1. **Audit Agent**: orquestra jobs de engenharia, chama LLM, consolida findings, propõe patches,
   roda dry-run, aguarda aprovação para apply.
2. **Audit Runner**: motor determinístico de checks/contracts/quality; não decide patch.
3. **MCP Server**: barramento de ferramentas (LSP, RAG, Ollama etc.).
4. **LSP/TSServer**: semântica determinística; não governa patch.
5. **RAG**: contexto; não orquestra mutações.
6. **Inference Gateway**: governança de inferência (tagging, budgets, quotas, métricas, fallback,
   circuit breaker).
7. **LLMs externas do editor**: fora do sistema canônico (não usam o control plane do projeto).

## Arquitetura Alvo (consolidada)

### Camadas

1. **Execução determinística**: `audit runner`, `lint`, `typecheck`, `node --check`,
   `prettier --check`, tests, contracts, health scripts.
2. **Ferramentas/semântica**: MCP tools (`lsp_*`, `rag_*`, `ollama_*`).
3. **Inteligência de engenharia**: `Audit Agent` + `Inference Gateway`.
4. **Governança e operação**: Control Plane + SSOT + Dashboard/Realtime + RBAC.

### Topologia de processos

#### Host WSL

- `ollama` permanente (serviço)

#### Container / PM2

- `dashboard-web`
- `agente-gpt`
- `chrome-proxy`
- `ollama-host-supervisor` (novo)
- `audit-agent` (novo)
- `inference-gateway` (novo; pode iniciar embutido e separar depois)

## Inference Gateway + Configuracao Completa da LLM Local

### Objetivo

Permitir configuração extensa da inferência local por papel, com governança, observabilidade e
upgrade futuro sem refatoração estrutural.

### Precedencia de configuração (maior -> menor)

1. Override por `job/comando` (auditado e limitado)
2. Política por `clientTag` (DB)
3. Perfil de inferência (DB)
4. Registry de modelos/backends (DB)
5. Config global persistida (DB)
6. ENV bootstrap
7. Defaults internos seguros

### `clientTag` obrigatório (V1)

- `audit_agent_triage`
- `audit_agent_patch`
- `audit_agent_review` (V1.1)
- `rag_embed`
- `mcp_ollama_generate`
- `mcp_ollama_embed`
- `diagnostics_probe`
- `fallback_generic`

### Tabelas novas (DB)

- `inference_backends`
- `inference_models`
- `inference_profiles`
- `inference_client_policies`
- `inference_prompt_templates` (V1 opcional / V1.1)
- `inference_benchmarks` (V1.1)
- `audit_jobs`
- `audit_job_runs`
- `audit_job_findings`
- `audit_patch_proposals`
- `audit_watch_rules`

## Integração MCP + LSP/TSServer + RAG

1. MCP como barramento oficial (V1) para `lsp_*`, `rag_*`, `ollama_*` (com evolução para gateway).
2. LSP/TSServer como semântica determinística para `context_builder` e validação de impacto.
3. RAG como contexto, não autoridade.
4. Fallbacks obrigatórios:
   - LSP degradado -> lexical + risco explícito
   - RAG degradado -> contexto reduzido + risco explícito
   - MCP indisponível -> modo mínimo determinístico
   - Ollama indisponível -> findings determinísticos, sem triagem LLM

## APIs / Interfaces / Tipos (resumo)

### Rotas Dashboard (leitura)

- `/api/dashboard/audit/*`
- `/api/dashboard/inference/*`

### Mutações via Control Plane

- Comandos `AUDIT_*`
- Comandos `INFERENCE_*`

### Tipos internos novos

- `AuditJob`, `AuditJobRun`, `AuditFinding`, `AuditPatchProposal`, `AuditWatchRule`
- `InferenceBackend`, `InferenceModel`, `InferenceProfile`, `InferenceClientPolicy`
- `InferenceClientTag`, `InferenceCapabilities`, `InferenceFallbackChain`
- `SemanticContextPack`

## Fases de Implementacao (resumo)

- F0 Governança e baseline
- F1 Contrato de papéis + anti-confusão
- F2 Ollama host permanente + supervisor sidecar
- F3 Inference Gateway + config avançada da LLM local
- F4 Domínio `Audit Agent` (DB + repos)
- F5 Processo PM2 `audit-agent` (loop híbrido)
- F6 Integração SSOT + Control Plane
- F7 Context Builder semântico (MCP + LSP/TSServer + RAG)
- F8 Pipeline LLM (triage -> patch -> dry-run -> waiting approval)
- F9 API + Dashboard + Realtime (Audit Workbench + LLM Control Center)
- F10 Segurança, RBAC e guardrails
- F11 Integração com Audit Runner + Contracts v3
- F12 Rollout progressivo + tuning de CPU/latência

## Testes e Cenarios de Aceite (macro)

1. Infra/lifecycle: PM2, `/ready`, import-safety.
2. SSOT/control plane: `AUDIT_*`/`INFERENCE_*` via command service.
3. Inference Gateway: `clientTag`, policies, fallback, métricas.
4. MCP/LSP/RAG: `context_builder` + fallback degradado.
5. Pipeline LLM/patch: triage -> proposal -> dry-run -> approval/apply.
6. Dashboard/realtime: jobs/findings/patches + LLM Control Center.
7. Regressões do projeto: `audit:quick`, `typecheck:full`, `lint --quiet`, suites críticas.

## Rollout e Rollback (macro)

- Rollout: `F0 -> F1 -> ... -> F12`
- Rollback: preservar schema/governança, desativar `AUDIT_AGENT_ENABLED`, degradar para
  `propose_only`, reduzir contracts para `warn` sem perder telemetria.

## Assuncoes e Defaults

1. Idioma dos artefatos: Português
2. Fonte canônica: `DOCUMENTAÇÃO/BUGS`
3. V1 = `semi_auto`
4. `Audit Runner` continua motor determinístico
5. `Audit Agent` é camada de inteligência/orquestração
6. Config da LLM local é `DB-driven + ENV bootstrap`
7. `clientTag` é obrigatório
8. CPU/latência são requisitos de produto (budgets, concurrency, circuit breaker)

## Mudancas Implementadas (rodada atual)

- Criação do plano mestre canônico (`CODEX_AUDIT_AGENT_MASTER_PLAN.md`)
- Scaffold inicial de contratos anti-confusão (`clientTag`/políticas) [em código]
- Skill dedicada do projeto [inicial]
- `Inference Gateway` runtime mínimo funcional (wrapper sobre `tools/ollama/client.mjs`)
  - `src/inference_gateway/gateway.js`
  - `src/inference_gateway/server.js`
  - `src/inference_gateway/main.js`
- `Ollama Host Supervisor` (polling/circuit básico, sem hooks globais)
  - `src/inference_gateway/ollama_host_supervisor.js`
  - `scripts/ollama-host-supervisor.js`
- Integração parcial de readiness no server:
  - `src/server/main.js` agora registra `ollama_host` em `runtime_resource_registry`
  - probe pontual (sem poller contínuo local) para refletir `ready/degraded` no `/ready`
- Contratos iniciais do domínio `Audit Agent`
  - `src/audit_agent/contracts.js`
  - `src/audit_agent/runtime.js` (jobs em memória + tick híbrido mínimo)
  - `src/audit_agent/server.js` (HTTP local: `/health`, `/metrics`, `/jobs`)
  - `src/audit_agent/main.js` (processo HTTP + tick periódico, behind flag)
- API de dashboard (F9 parcial) para inferência/runtime:
  - `src/server/api/controllers/dashboard_inference.js`
  - `src/server/api/controllers/dashboard.js` (mount do router)
- API de dashboard (F9 parcial) para Audit Agent:
  - `src/server/api/controllers/dashboard_audit.js`
  - endpoints V0 (`/audit/runtime`, `/audit/jobs`, `/audit/jobs/:id`, placeholders de
    findings/patches/watch-rules)
- Control Plane (F6 parcial) com comandos mínimos `AUDIT_*`/`INFERENCE_*`:
  - `AUDIT_JOB_CREATE`, `AUDIT_JOB_RUN`, `AUDIT_JOB_CANCEL`, `AUDIT_JOB_RETRY`
  - `INFERENCE_PROFILE_VALIDATE`
  - proxy local para `audit-agent` + validação local de policy/route de inferência
- PM2 opcional (sem impacto no baseline padrão):
  - `ecosystem.config.cjs` com processos condicionais por `ENABLE_AUDIT_AGENT_PM2_PROCESSES=true`
  - processos: `inference-gateway`, `ollama-host-supervisor`, `audit-agent`
- Testes unitários iniciais (gateway/supervisor/contracts)
  - `tests/unit/inference/*.spec.js`
  - `tests/unit/audit_agent/*.spec.js`
- Testes adicionais de integração local (proxy control plane -> audit-agent):
  - `tests/unit/server/test_control_command_service_audit_inference.spec.js`
- Scripts npm de operação/teste (fase inicial)
  - `audit-agent:run`
  - `inference-gateway:run`
  - `ollama:supervisor`
  - `test:unit:audit-agent`
  - `daemon:start:audit-agent`
  - `daemon:restart:audit-agent`

## Gates Executados (rodada atual)

- `node --check`:
  - `src/inference_gateway/{client_tags,policy_config,gateway,ollama_host_supervisor,server,main}.js`
  - `src/audit_agent/{contracts,main}.js`
  - **OK**
- `node --test`:
  - `tests/unit/inference/test_client_tags.spec.js`
  - `tests/unit/inference/test_policy_config.spec.js`
  - `tests/unit/inference/test_gateway.spec.js`
  - `tests/unit/inference/test_ollama_host_supervisor.spec.js`
  - `tests/unit/audit_agent/test_audit_agent_contracts.spec.js`
  - `tests/unit/audit_agent/test_audit_agent_server.spec.js`
  - `tests/unit/audit_agent/test_audit_agent_runtime.spec.js`
  - **15/15 pass** (base)
- `node --test tests/unit/audit_agent/test_audit_agent_server.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
  -> **5/5 pass**
- `npm run test:unit:audit-agent` -> **OK**
- Smoke wrappers behind flags (default `disabled`):
  - `npm run audit-agent:run` -> **exit 0** (`AUDIT_AGENT_ENABLED=false`)
  - `npm run inference-gateway:run` -> **exit 0** (`INFERENCE_GATEWAY_ENABLED=false`)
  - `npm run ollama:supervisor` -> **exit 0** (`OLLAMA_SUPERVISOR_ENABLED=false`)
- `npm run typecheck:full` -> **OK**
- `eslint` direcionado nos arquivos novos/alterados -> **OK**
- `env NODE_APP_INSTANCE=0 timeout 5s node --input-type=module -e "import './src/server/main.js'; console.log('OK')"`
  -> **OK**
- `node --test tests/regression/test_wave20b_server_main_import_pm2_env_no_boot.spec.js tests/regression/test_wave20b_main_import_daemon_env_no_boot.spec.js`
  -> **2/2 pass**
- `npm run audit:quick -- --triage false --progress false --eta false` -> **success**
  - `WAVE_AUDIT_QUICK_2026-02-22T11-07-37-415Z`
  - `errors=0`, `warnings=0`, `partial=false`
- Smokes HTTP locais (behind flags):
  - `AUDIT_AGENT_ENABLED=true node src/audit_agent/main.js` + `GET /health` -> **OK**
  - `INFERENCE_GATEWAY_ENABLED=true node src/inference_gateway/main.js` + `GET /health` -> **OK**

## Riscos Ativos

1. `Inference Gateway` ainda não integrado aos consumidores atuais (`rag`, `mcp_ollama_tools`).
2. `audit-agent`, `inference-gateway` e `ollama-host-supervisor` ainda não estão adicionados ao
   `ecosystem.config.cjs` (PM2) para evitar impacto no runtime antes da Fase 5.
3. `ollama_host` no server está em modo _probe pontual_; sidecar/supervisor PM2 ainda não acoplado
   ao lifecycle do runtime (sem polling contínuo centralizado).
4. `dashboard /api/dashboard/inference/*` é leitura inicial; ainda não há `LLM Control Center` na
   UI.
5. `Inference Gateway` ainda não foi integrado aos consumidores reais (`RAG`, `mcp_ollama_tools`).
6. `audit-agent` ainda opera com jobs em memória (sem DB/SSOT/control-plane final), embora já exista
   proxy mínimo via `control_command_service`.
7. Configuração avançada de inferência ainda sem persistência DB/UI (`inference_*` DB pendente).

## Rollback da Rodada

1. Reverter arquivos novos (`src/inference_gateway/*`, `src/audit_agent/*`, tests, skill, docs) sem
   impactar runtime atual.
2. Manter o plano mestre (documentação) mesmo em rollback parcial de código.

## Proxima Rodada (escopo fechado)

1. Fase 4 parcial: iniciar schema/repos `inference_*` (primeiro `inference_client_policies` e
   `inference_profiles`) para sair do modo ENV-only.
2. Fase 6 continuação: ampliar `AUDIT_*` (patch/watch-rules) e `INFERENCE_*` (config persistida) com
   stubs/fluxo auditável.
3. Fase 5/F7 parcial: `audit-agent` usar `Inference Gateway` e MCP (`lsp_*`/`rag_*`) em um job
   manual real (`quick_audit` skeleton com contexto).
4. Fase 4/F9 continuação: persistência `audit_jobs/*` + endpoints `/api/dashboard/audit/*` lendo DB
   (substituir placeholders).

---

## Rodada de Implementação Contínua (2026-02-22) — F3/F4/F6/F9 parciais (DB-backed policies + patch/watch/inference commands)

### Status geral

- **Em implementação (integração vertical mínima já funcional: control plane -> repos/gateway ->
  dashboard read APIs)**

### Mudanças implementadas nesta rodada

1. **Persistência de findings/patches/watch-rules**

- Migration `v8` em `src/infra/db/migrations.js`
- Repos novos:
  - `src/infra/db/audit_finding_repo.js`
  - `src/infra/db/audit_patch_repo.js`
  - `src/infra/db/audit_watch_rule_repo.js`
- `audit_patch_repo` expandido com `updateAuditPatchProposal()`
- `audit_watch_rule_repo` expandido com `getAuditWatchRuleById()`

2. **`audit-agent` persistindo findings + patch proposals + hydration**

- `src/audit_agent/db_store.js`
- `src/audit_agent/runtime.js`
  - persistência de findings e patches
  - `hydrateFromStore()`
  - integração com `contextBuilder.collectQuickContext()`
- `src/audit_agent/main.js`
  - hydration opcional no startup (`AUDIT_AGENT_HYDRATE_ON_START`)
  - `context_builder` read-only plugável

3. **`context_builder` read-only V0 (MCP/RAG/LSP health + Inference Gateway probe)**

- `src/audit_agent/context_builder.js`
- coleta:
  - `mcp:diagnose`
  - `rag:health`
  - `lsp:health`
  - `Inference Gateway /health` + `/v1/models`
- produz findings normalizados (warning/info) sem mutação

4. **`Inference Gateway` com policies DB-backed + reload**

- `src/inference_gateway/persistence.js` (loader de `inference_profiles` e
  `inference_client_policies`)
- `src/inference_gateway/gateway.js`
  - `setPolicies()`
  - `getPolicySummary()`
  - resolve profile por `clientPolicy.profile_name`
- `src/inference_gateway/server.js`
  - `GET /v1/policies`
  - `POST /v1/policies/reload`
- `src/inference_gateway/main.js`
  - reload inicial de policies do SQLite

5. **Control Plane ampliado (`AUDIT_*` + `INFERENCE_*`)**

- `src/server/domain/control_command_service.js`
- novos comandos implementados:
  - `AUDIT_PATCH_APPROVE`
  - `AUDIT_PATCH_REJECT`
  - `AUDIT_WATCH_RULE_UPSERT`
  - `AUDIT_WATCH_RULE_TOGGLE`
  - `INFERENCE_PROFILE_UPSERT`
  - `INFERENCE_CLIENT_POLICY_UPSERT`
- mutações `INFERENCE_*` acionam reload explícito no `Inference Gateway`
- correção de bug real: import dinâmico de socket hub (`#server/engine/socket` em vez de
  `socket.js.js`)

6. **Dashboard Inference / Audit APIs ampliadas**

- `src/server/api/controllers/dashboard_inference.js`
  - `GET /inference/profiles`
  - `GET /inference/client-policies`
  - `GET /inference/policies/summary`
- `src/server/api/controllers/dashboard_audit.js`
  - `/audit/jobs*` fallback DB
  - `/audit/jobs/:id/findings` usando repo real
  - `/audit/jobs/:id/patches` usando repo real
  - `/audit/watch-rules` usando repo real

### Gates executados (rodada)

1. `node --test tests/unit/inference/*.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **15/15 pass**
2. `npm run typecheck:full` -> **OK**
3. `eslint` direcionado (arquivos alterados) -> **OK**
4. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-39-17-917Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `AUDIT_PATCH_APPLY` e fluxo de apply/rollback ainda não implementados (somente approve/reject e
   proposal tracking).
2. `audit-agent` ainda não usa MCP `lsp_*`/`rag_*` tools diretamente; `context_builder` atual está
   em modo probe/read-only.
3. `Inference Gateway` ainda consome apenas `profiles/client_policies`; `inference_backends/models`
   seguem sem repos/gestão completa.
4. Processos PM2 novos (`audit-agent`, `inference-gateway`, `ollama-host-supervisor`) ainda não
   ativados operacionalmente por default (flags seguras).

### Próxima rodada (escopo fechado)

1. Fase 5/F7: primeiro job manual real com `context_builder` chamando MCP tools `lsp_*` / `rag_*`
   (read-only).
2. Fase 4/F6: `AUDIT_PATCH_APPLY` em modo `propose_only`/guardado (sem fake apply) +
   `AUDIT_WATCH_RULE_*` validações de schema/payload.
3. Fase 3/F9: endpoints/control-plane de `INFERENCE_PROFILE_VALIDATE` e gestão básica de
   `inference_backends/models` (repos mínimos).

---

## Rodada de Implementação Contínua (2026-02-22) — F5/F7/F6 parciais (`context_builder` MCP-aware + `AUDIT_PATCH_APPLY` guardado)

### Status geral

- **Em implementação (contexto semântico read-only evoluído, sem abrir mutação insegura)**

### Mudanças implementadas nesta rodada

1. **`context_builder` com MCP tools reais (read-only)**

- `src/audit_agent/context_builder.js`
- adicionadas chamadas MCP via `/api/mcp` (`tools/call`) para:
  - `lsp_diagnostics`
  - `lsp_definition` (probe opcional baseado em escopo)
  - `rag_search`
- fallback automático para modo probe anterior quando MCP/tools indisponíveis
- `mode` evolui para `read_only_mcp_v1` quando as chamadas MCP são usadas
- findings novos derivados de falha de `lsp_diagnostics` / `rag_search`

2. **`audit-agent` runtime passa escopo do job para `contextBuilder`**

- `src/audit_agent/runtime.js`
- `collectQuickContext(job)` agora recebe o job (base para filePath/query/line/character por escopo)

3. **Control Plane: `AUDIT_PATCH_APPLY` guardado (sem fake apply)**

- `src/server/domain/control_command_service.js`
- comando `AUDIT_PATCH_APPLY` adicionado com guardrails:
  - patch precisa estar `approved`
  - dry-run válido obrigatório (`dry_run_result_json.ok === true`)
  - bloqueio por default em modo `propose_only`
  - env de escape explícita: `AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL=true`
- comportamento atual: **bloqueia com erro explícito e auditável** (sem simular apply)

4. **Testes**

- `tests/unit/audit_agent/test_audit_agent_runtime.spec.js`
  - garante que `contextBuilder.collectQuickContext()` recebe o `job`
- `tests/unit/server/test_control_command_service_audit_persistence.spec.js`
  - cobre `AUDIT_PATCH_APPLY`:
    - falha sem aprovação
    - falha em `propose_only` mesmo após aprovação + dry-run válido

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_agent_runtime.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **4/4 pass**
2. `npm run typecheck:full` -> **OK**
3. `eslint` direcionado (arquivos alterados) -> **OK**
4. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-48-38-596Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `context_builder` já chama MCP tools, mas ainda usa payloads resumidos; falta enriquecimento de
   contexto por resultado (`rag_expand`, refs/symbols) e limites por budget.
2. `AUDIT_PATCH_APPLY` ainda não executa apply/dry-run revalidação de verdade (guardado por design
   nesta fase).
3. `audit-agent` ainda não publica findings/patches em realtime dedicado (`audit:*_updates_batch`).

### Próxima rodada (escopo fechado)

1. Enriquecer `context_builder` com `rag_expand` e `lsp_references`/`lsp_document_symbols` sob
   budget.
2. Implementar `AUDIT_PATCH_APPLY` em modo `propose_only` + `dry-run record/check TTL` mais formal
   (sem apply real ainda) e preparar contrato para futura execução.
3. Iniciar `inference_backends` / `inference_models` repos + endpoints de leitura no dashboard.

---

## Rodada de Implementação Contínua (2026-02-22) — F7/F3/F9 parciais (budget MCP + `inference_backends/models`)

### Status geral

- **Em implementação (contexto semântico enriquecido sob budget + configuração de inferência
  avançando na camada de persistência/API)**

### Mudanças implementadas nesta rodada

1. **`context_builder` enriquecido com budget MCP**

- `src/audit_agent/context_builder.js`
- adicionado orçamento simples por escopo/env (`mcp_budget` / `AUDIT_AGENT_CONTEXT_MCP_BUDGET`)
- novas chamadas MCP sob budget:
  - `rag_expand`
  - `lsp_references`
  - `lsp_document_symbols`
- `mcp_tools` agora expõe resumo de budget (`limit/used/remaining`)
- `mcp_tool_payloads` inclui payloads brutos das novas chamadas (read-only)
- findings informativos adicionais quando enriquecimento falha (`rag_expand`, `lsp_references`)

2. **Repos `inference_backends` / `inference_models` (base de config avançada)**

- `src/infra/db/inference_backend_repo.js`
  - `upsertInferenceBackend`, `getInferenceBackendById`, `listInferenceBackends`
- `src/infra/db/inference_model_repo.js`
  - `upsertInferenceModel`, `getInferenceModelById`, `listInferenceModels`

3. **Dashboard Inference API (leitura SQLite ampliada)**

- `src/server/api/controllers/dashboard_inference.js`
- novos endpoints:
  - `GET /api/dashboard/inference/backends`
  - `GET /api/dashboard/inference/models-db`

4. **Control Plane (`INFERENCE_*`) ampliado**

- `src/server/domain/control_command_service.js`
- comandos novos:
  - `INFERENCE_BACKEND_UPSERT`
  - `INFERENCE_MODEL_UPSERT`
- mutações seguem com reload explícito do `Inference Gateway`

5. **Testes**

- `tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js`
  - cobertura dos repos `inference_backends/models`
- `tests/unit/server/test_control_command_service_audit_persistence.spec.js`
  - cobertura de `INFERENCE_BACKEND_UPSERT` e `INFERENCE_MODEL_UPSERT`

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **6/6 pass**
2. `npm run typecheck:full` -> **OK**
3. `eslint` direcionado (arquivos alterados) -> **OK**
4. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-54-44-679Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `inference_backends/models` já têm repos e leitura via dashboard, mas ainda faltam
   endpoints/commands de toggle específicos e validação mais rígida de schema/capabilities.
2. `context_builder` MCP enriched gera payloads maiores; falta truncation/token budget formal antes
   de entrar em prompts LLM.
3. `AUDIT_PATCH_APPLY` segue guardado (sem apply real), como planejado.

### Próxima rodada (escopo fechado)

1. Formalizar TTL/metadata de dry-run em `audit_patch_proposals` e endurecer `AUDIT_PATCH_APPLY` com
   validação temporal.
2. Introduzir endpoints de leitura/validação para `inference_backends/models` no
   `Dashboard Inference` (contract summary / capabilities).
3. Preparar `audit-agent` para primeiro job manual com saída de findings + patch proposal orientada
   por contexto MCP enriquecido (sem apply).

---

## Rodada de Implementação Contínua (2026-02-22) — F6/F9/F8 parciais (toggles `INFERENCE_*` + summary/capabilities + `dry_run_state`)

### Status geral

- **Em implementação (gestão de inferência mais completa e patches de auditoria com estado explícito
  de dry-run)**

### Mudanças implementadas nesta rodada

1. **Control Plane (`INFERENCE_*`) com toggles dedicados**

- `src/server/domain/control_command_service.js`
- novos comandos:
  - `INFERENCE_BACKEND_TOGGLE`
  - `INFERENCE_MODEL_TOGGLE`
- mantém reload explícito do `Inference Gateway` após mutações

2. **Repos `inference_*` com enable/disable**

- `src/infra/db/inference_backend_repo.js`
  - `setInferenceBackendEnabled(...)`
- `src/infra/db/inference_model_repo.js`
  - `setInferenceModelEnabled(...)`

3. **Dashboard Inference com visão operacional mais útil**

- `src/server/api/controllers/dashboard_inference.js`
- `GET /api/dashboard/inference/models-db`
  - agora retorna `capabilities_summary` + `policy_flags`
- novo endpoint:
  - `GET /api/dashboard/inference/summary`
  - counts por domínio + `by_backend` + totais de capability (code patch / embed / json strict /
    long context)

4. **Dashboard Audit Patches com `dry_run_state` explícito**

- `src/server/api/controllers/dashboard_audit.js`
- `GET /api/dashboard/audit/jobs/:id/patches`
  - cada patch agora inclui `dry_run_state` (`missing|pending|invalid|fresh|failed|stale`)
  - metadata de resposta inclui summary por status e estado de dry-run

5. **Hardening de `AUDIT_PATCH_APPLY` (validação temporal)**

- `src/server/domain/control_command_service.js`
- `AUDIT_PATCH_APPLY` agora exige:
  - timestamp de dry-run (`validated_at_ms` / `ts`)
  - TTL válido (`dry_run_result_json.ttl_ms` ou env `AUDIT_PATCH_DRY_RUN_MAX_AGE_MS`)
  - dry-run não expirado
- continua guardado em `propose_only` (sem apply real) por design nesta fase

6. **Testes ampliados**

- `tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js`
  - cobre disable/enable de `inference_backends/models`
  - valida patch proposal persistida com `context_signals` e `dry_run_result_json.pending`
- `tests/unit/server/test_control_command_service_audit_persistence.spec.js`
  - cobre `INFERENCE_BACKEND_TOGGLE` e `INFERENCE_MODEL_TOGGLE`

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **6/6 pass**
2. `node --check src/server/domain/control_command_service.js src/server/api/controllers/dashboard_inference.js src/server/api/controllers/dashboard_audit.js src/infra/db/inference_backend_repo.js src/infra/db/inference_model_repo.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-06-10-486Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `AUDIT_PATCH_APPLY` já tem validação temporal de dry-run, mas ainda não executa apply real nem
   revalidação on-demand.
2. `context_builder` MCP enriched já gera payloads úteis, porém ainda falta truncation/token-budget
   formal antes do pipeline LLM.
3. `Dashboard Inference` já expõe summary/capabilities, mas ainda sem endpoints de benchmark/runtime
   policy avançada.

### Próxima rodada (escopo fechado)

1. Primeiro job manual `patch_suggest/bug_hunt` com persistência de findings/patches enriquecidos e
   resposta de dashboard end-to-end.
2. Preparar metadata/TTL de dry-run para futura execução real de `AUDIT_PATCH_APPLY` (sem habilitar
   apply nesta rodada).
3. Avançar `inference_backends/models` com validação de schema/capabilities e comandos de toggle via
   UI/API (read + command wrappers).

---

## Rodada de Implementação Contínua (2026-02-22) — F4/F3 parciais (persistência SQLite)

### Status geral

- **Em implementação (persistência mínima ativa, runtime V0 preservado)**

### Mudanças implementadas nesta rodada

1. **SQLite Migration v7** (`src/infra/db/migrations.js`)

- `audit_jobs`
- `audit_job_runs`
- `inference_backends`
- `inference_models`
- `inference_profiles`
- `inference_client_policies`

2. **Repos novos (F4/F3 parcial)**

- `src/infra/db/audit_job_repo.js`
- `src/infra/db/audit_job_run_repo.js`
- `src/infra/db/inference_profile_repo.js`
- `src/infra/db/inference_client_policy_repo.js`

3. **Persistência do Audit Agent (sink incremental)**

- `src/audit_agent/db_store.js` (store SQLite)
- `src/audit_agent/runtime.js` persistindo snapshots de jobs e runs (opcional, via store)
- `src/audit_agent/main.js` passa a habilitar store SQLite por padrão
  (`AUDIT_AGENT_PERSIST_DB=true`)

4. **Dashboard Audit API com fallback em DB**

- `src/server/api/controllers/dashboard_audit.js`
- `GET /api/dashboard/audit/jobs` e `GET /api/dashboard/audit/jobs/:id` agora fazem fallback para
  `audit_job_repo` quando o `audit-agent` local está indisponível

### Gates executados (rodada)

1. `node --test tests/unit/audit_agent/*.spec.js tests/unit/inference/*.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **22/22 pass**
2. `npm run typecheck:full` -> **OK**
3. `eslint` direcionado nos arquivos alterados -> **OK**
4. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-20-35-842Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. Persistência implementada como **sink incremental**; runtime de execução do `audit-agent`
   continua em memória (sem hydratação após restart).
2. `inference_backends/models` schema já existe, mas ainda sem repos completos e sem UI/API de
   gerenciamento.
3. `audit_job_findings`, `audit_patch_proposals`, `audit_watch_rules` ainda pendentes.

### Próxima rodada (escopo fechado)

1. Hydration opcional do `audit-agent` a partir de `audit_jobs` (evitar perda de visibilidade após
   restart)
2. Schema/repos de `audit_job_findings` e `audit_patch_proposals`
3. Primeiro job manual real do `audit-agent` usando `Inference Gateway` + MCP (`lsp_*`/`rag_*`) em
   modo `read_only/propose_only`

---

## Rodada de Implementação Contínua (2026-02-22) — F9/F6 parciais (wrappers dashboard de mutação + fluxo manual `patch_suggest`)

### Status geral

- **Em implementação (dashboard já consegue acionar parte relevante do plano via control plane, sem
  terminal)**

### Mudanças implementadas nesta rodada

1. **Dashboard Audit (wrappers `AUDIT_*` via control plane)**

- `src/server/api/controllers/dashboard_audit.js`
- novos endpoints de mutação:
  - `POST /api/dashboard/audit/jobs` (`run_now` opcional)
  - `POST /api/dashboard/audit/jobs/:id/run`
  - `POST /api/dashboard/audit/jobs/:id/cancel`
  - `POST /api/dashboard/audit/patches/:id/approve`
  - `POST /api/dashboard/audit/patches/:id/reject`
  - `POST /api/dashboard/audit/patches/:id/apply`
  - `POST /api/dashboard/audit/watch-rules`
  - `POST /api/dashboard/audit/watch-rules/:id/toggle`
- todos delegam para `executeCommand(...)` (sem bypass de mutação)

2. **Dashboard Inference (wrappers `INFERENCE_*` via control plane)**

- `src/server/api/controllers/dashboard_inference.js`
- novos endpoints de mutação:
  - `POST /api/dashboard/inference/profiles/validate`
  - `POST /api/dashboard/inference/backends`
  - `POST /api/dashboard/inference/backends/:id/toggle`
  - `POST /api/dashboard/inference/models`
  - `POST /api/dashboard/inference/models/:id/toggle`
- mantém trilha/auditoria/idempotency via control plane

3. **Fluxo manual `patch_suggest` via control plane (cobertura de teste)**

- `tests/unit/server/test_control_command_service_audit_inference.spec.js`
- novo teste cobrindo:
  - `AUDIT_JOB_CREATE` com `kind=patch_suggest`
  - `AUDIT_JOB_RUN`
  - resultado em `WAITING_APPROVAL`

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **4/4 pass**
2. `node --check src/server/api/controllers/dashboard_audit.js src/server/api/controllers/dashboard_inference.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-12-41-055Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. Wrappers de dashboard já existem, mas ainda faltam telas/composables de UI para operar o fluxo
   sem chamadas manuais.
2. `AUDIT_PATCH_APPLY` permanece guardado (sem apply real), mesmo com approval + dry-run freshness.
3. Pipeline LLM real (triage/patch author) ainda não integrado ao `Audit Agent` — patch proposal
   atual continua skeleton enriquecido por contexto MCP.

### Próxima rodada (escopo fechado)

1. Integrar primeiro passo real de pipeline LLM via `Inference Gateway` (`audit_agent_triage`
   read-only) com budgets e fallback.
2. Expor wrappers adicionais de `INFERENCE_PROFILE_UPSERT` / `INFERENCE_CLIENT_POLICY_UPSERT` e
   sumarização de reload/resultados.
3. Preparar endpoint/dashboard para execução manual de `patch_suggest` com preview do
   `dry_run_state` já enriquecido.

---

## Rodada de Implementação Contínua (2026-02-22) — F8/F9 parciais (`triage_llm` via Inference Gateway + wrappers inference avançados)

### Status geral

- **Em implementação (primeiro passo real de pipeline LLM integrado ao runtime do Audit Agent, com
  fallback seguro e feature flag)**

### Mudanças implementadas nesta rodada

1. **`triage_llm` via `Inference Gateway` (read-only, behind flag)**

- `src/audit_agent/triage_llm.js` (novo)
- client HTTP para `POST /v1/generate` com:
  - `clientTag = audit_agent_triage`
  - `profileName` opcional (`AUDIT_AGENT_TRIAGE_PROFILE_NAME`)
  - `model` opcional (`AUDIT_AGENT_LLM_MODEL_TRIAGE`)
  - `runtime=local`
- prompt de triage construído a partir de sinais MCP/LSP/RAG já coletados
- saída JSON esperada (`summary`, `risk_level`, `next_actions`) com fallback para texto bruto
- ativação por flag: `AUDIT_AGENT_TRIAGE_LLM_ENABLED=true`

2. **Integração no runtime do Audit Agent**

- `src/audit_agent/runtime.js`
- novo passo `triage_llm` no fluxo `_processJob()`
- `llm_triage` passa a ser persistido em `job.result_json`
- findings informativos de triage:
  - sucesso (`source=audit-agent-llm`)
  - falha não-bloqueante (`seguindo sem bloqueio`)

3. **Wiring opcional no processo `audit-agent`**

- `src/audit_agent/main.js`
- runtime passa a receber `triageClient` quando o módulo carregar
- fallback seguro se o client não puder ser inicializado

4. **Dashboard Inference wrappers adicionais (`INFERENCE_*`)**

- `src/server/api/controllers/dashboard_inference.js`
- novos endpoints:
  - `POST /api/dashboard/inference/profiles`
  - `POST /api/dashboard/inference/client-policies`
- retornam metadata de `reload_gateway` quando disponível

5. **Testes**

- `tests/unit/audit_agent/test_audit_agent_runtime.spec.js`
  - novo teste cobrindo `triageClient.runTriage()` e persistência em `job.result_json.llm_triage`

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_agent_runtime.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **8/8 pass**
2. `node --check src/audit_agent/triage_llm.js src/audit_agent/runtime.js src/audit_agent/main.js src/server/api/controllers/dashboard_inference.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-18-04-697Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `triage_llm` está integrado mas ainda **desabilitado por padrão**
   (`AUDIT_AGENT_TRIAGE_LLM_ENABLED=false`) até calibrar budgets/modelos no ambiente.
2. O passo LLM atual gera triagem textual/JSON; ainda não existe patch author real via LLM
   (`patch_author_llm`).
3. Faltam endpoints de UI/dashboard específicos para visualizar o `llm_triage` de um job de forma
   dedicada (por enquanto vem via `job.result_json` / findings).

### Próxima rodada (escopo fechado)

1. Expor no dashboard um endpoint/read-model de `audit job detail` com resumo de `llm_triage` (se
   presente).
2. Integrar `Inference Gateway` triage com validação de policy/profile no fluxo
   (`audit_agent_triage` + `INFERENCE_PROFILE_VALIDATE` opcional preflight).
3. Preparar primeiro teste/integração com `triage_llm` habilitado e `Inference Gateway` stubado
   (HTTP) para validar contrato ponta a ponta.

---

## Rodada de Implementação Contínua (2026-02-22) — F8/F9 parciais (`triage_llm` com preflight + read-model `llm_triage_summary`)

### Status geral

- **Em implementação (preflight de policy/profile aplicado antes da chamada LLM e resumo de triagem
  exposto no read-model de jobs)**

### Mudanças implementadas nesta rodada

1. **Preflight de policy/profile no `Inference Gateway`**

- `src/inference_gateway/gateway.js`
  - novo método `validateGenerate(...)` (resolve policy + valida rota sem chamar Ollama)
- `src/inference_gateway/server.js`
  - novo endpoint `POST /v1/validate/generate`
  - responde `200` quando permitido e `400` quando rota/política rejeita

2. **`triage_llm` passa a executar preflight explícito antes do `generate`**

- `src/audit_agent/triage_llm.js`
- fluxo:
  - `POST /v1/validate/generate`
  - se falhar/rejeitar -> `skipped=true` com `error=inference_gateway_preflight_failed`
  - se passar -> `POST /v1/generate`
- resultado persistido inclui `preflight` no payload de `llm_triage`

3. **Read-model do dashboard enriquecido com resumo de `llm_triage`**

- `src/server/api/controllers/dashboard_audit.js`
- `GET /api/dashboard/audit/jobs`
- `GET /api/dashboard/audit/jobs/:id`
- novo campo `llm_triage_summary` (compacto e estável):
  - `ok`, `skipped`, `model`, `profile_name`
  - `risk_level`, `summary`, `next_actions`
  - `error`, `ts`

4. **Testes de contrato (rápidos, sem Ollama real)**

- `tests/unit/inference/test_gateway_server.spec.js`
  - valida endpoint `POST /v1/validate/generate`
- `tests/unit/audit_agent/test_triage_llm.spec.js`
  - valida preflight + generate via HTTP stub
  - valida skip explícito quando preflight rejeita rota

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/inference/test_gateway_server.spec.js tests/unit/audit_agent/test_triage_llm.spec.js`
   -> **4/4 pass**
2. `node --check src/inference_gateway/gateway.js src/inference_gateway/server.js src/audit_agent/triage_llm.js src/server/api/controllers/dashboard_audit.js tests/unit/inference/test_gateway_server.spec.js tests/unit/audit_agent/test_triage_llm.spec.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-24-20-408Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `triage_llm` continua behind flag (`AUDIT_AGENT_TRIAGE_LLM_ENABLED=false` por default) até
   calibrar modelo/profile/budgets no ambiente.
2. `llm_triage_summary` expõe resumo estável, mas ainda não há tela dedicada no dashboard (apenas
   read-model/API).
3. `AUDIT_PATCH_APPLY` segue guardado (sem apply real), mesmo com approval e dry-run freshness.

### Próxima rodada (escopo fechado)

1. Expor endpoint/dashboard dedicado para visualização de `llm_triage` completo (resumo + detalhes
   parse/raw).
2. Integrar `context_builder` com mais sinais MCP sob budget (ex.: `rag_expand`/`lsp_references`) ao
   resumo operacional do job.
3. Preparar preflight/health de `audit_agent_triage` no dashboard inference (validando profile e
   route sem chamar LLM real).

---

## Rodada de Implementação Contínua (2026-02-22) — F8/F9 parciais (`patch_author_llm` V0 + endpoint detalhado `llm_triage` + preflight de triage no dashboard)

### Status geral

- **Em implementação (pipeline LLM proposal-only evoluído: triage + patch-author V0, com
  observabilidade e preflight operacional no dashboard)**

### Mudanças implementadas nesta rodada

1. **`patch_author_llm` V0 (proposal-only) via `Inference Gateway`**

- `src/audit_agent/patch_author_llm.js` (novo)
- fluxo:
  - `POST /v1/validate/generate` (`clientTag=audit_agent_patch`)
  - `POST /v1/generate` (se preflight passar)
- retorna proposta normalizada (`patch_proposal`) com:
  - `patch_summary` estruturado
  - `risk_score`
  - `dry_run_result_json` pendente
  - `approval_required=true`
- **sem apply real** (V0 proposal-only)
- behind flag: `AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED=true`

2. **Integração do `patch_author_llm` no runtime do Audit Agent**

- `src/audit_agent/runtime.js`
- novo passo `patch_author_llm` para jobs `patch_suggest` / `bug_hunt`
- persistência em `job.result_json.llm_patch_author`
- findings informativos (`source=audit-agent-llm`) para sucesso/falha
- patch proposals persistidas priorizando saída do `patch_author_llm` quando disponível

3. **Wiring opcional no processo `audit-agent`**

- `src/audit_agent/main.js`
- runtime recebe `patchAuthorClient` com fallback seguro se módulo não carregar

4. **Dashboard Audit: endpoint detalhado de triagem LLM**

- `src/server/api/controllers/dashboard_audit.js`
- novo endpoint:
  - `GET /api/dashboard/audit/jobs/:id/llm-triage`
- retorna:
  - `summary` (compacto)
  - `parsed`
  - `raw_response`
  - `preflight`
  - `policy`
  - `provider/client_tag/error/skipped/ok/ts`
- usa fallback DB se `audit-agent` local estiver indisponível

5. **Dashboard Inference: preflight de triage sem chamada LLM real**

- `src/server/api/controllers/dashboard_inference.js`
- novo endpoint:
  - `POST /api/dashboard/inference/triage/preflight`
- chama `POST /v1/validate/generate` no `Inference Gateway` com `clientTag=audit_agent_triage`
- suporta `profile_name`, `model`, `backend`, `timeout_ms`
- `probe_models=true` opcional para testar listagem de modelos no mesmo fluxo

6. **Testes novos**

- `tests/unit/audit_agent/test_patch_author_llm.spec.js`
  - cobre preflight + generate + normalização de proposal
- `tests/unit/audit_agent/test_audit_agent_runtime.spec.js`
  - novo teste cobrindo integração do `patchAuthorClient`

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_patch_author_llm.spec.js tests/unit/audit_agent/test_audit_agent_runtime.spec.js tests/unit/audit_agent/test_triage_llm.spec.js tests/unit/inference/test_gateway_server.spec.js`
   -> **10/10 pass**
2. `node --check src/audit_agent/patch_author_llm.js src/audit_agent/runtime.js src/audit_agent/main.js src/server/api/controllers/dashboard_audit.js src/server/api/controllers/dashboard_inference.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-36-34-007Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `patch_author_llm` é V0 proposal-only; não gera diff confiável em todos os casos (pode retornar
   apenas plano estruturado).
2. `AUDIT_PATCH_APPLY` continua guardado (sem apply real), conforme política V1.
3. Faltam telas dedicadas no dashboard para operar `llm_triage` detalhado e proposal do
   `patch_author_llm` (API já disponível/expandida).

### Próxima rodada (escopo fechado)

1. Criar endpoint detalhado de `patch proposal` (incluindo `patch_summary`, `dry_run_state` e
   metadados LLM) no dashboard audit.
2. Preparar `patch_author_llm` com saída JSON schema mais estrita (`response_format`) e validação
   leve de shape.
3. Iniciar base de `AUDIT_PATCH_APPLY` real em modo `blocked-by-default` com dry-run TTL + validação
   de branch/path (sem habilitar apply por padrão).

---

## Rodada de Implementação Contínua (2026-02-22) — F8/F9 parciais (patch detail read-model + preflight patch + guardrails de apply)

### Status geral

- **Em implementação (pipeline proposal-only mais observável e guardrails de apply reforçados antes
  do apply real)**

### Mudanças implementadas nesta rodada

1. **Guardrails adicionais em `AUDIT_PATCH_APPLY` (branch/path)**

- `src/server/domain/control_command_service.js`
- validação pré-apply (enforce quando configurado):
  - branch atual (`git rev-parse --abbrev-ref HEAD`)
  - allowlist de branches (`AUDIT_PATCH_APPLY_ALLOWED_BRANCHES`)
  - allowlist de paths (`AUDIT_PATCH_APPLY_ALLOWED_PATH_PREFIXES`)
  - leitura de `candidate_files` de `patch_summary_json`
- novos erros:
  - `AUDIT_PATCH_APPLY_BRANCH_NOT_ALLOWED`
  - `AUDIT_PATCH_APPLY_PATH_NOT_ALLOWED`
- `AUDIT_PATCH_APPLY_DISABLED` agora retorna `guards` em `details`

2. **Dashboard Audit: read-model detalhado de patch proposal**

- `src/server/api/controllers/dashboard_audit.js`
- novos endpoints:
  - `GET /api/dashboard/audit/patches/:id`
  - `GET /api/dashboard/audit/jobs/:id/patches/:patchId`
- patch enriquecido com:
  - `dry_run_state`
  - `llm_patch_summary` (derivado de `patch_summary_json`)

3. **Dashboard Inference: preflight de `audit_agent_patch`**

- `src/server/api/controllers/dashboard_inference.js`
- novo endpoint:
  - `POST /api/dashboard/inference/patch/preflight`
- valida profile/model/backend do patch author via `POST /v1/validate/generate` (sem consumir
  inferência real)

4. **`patch_author_llm` V0 endurecido com validação leve de shape**

- `src/audit_agent/patch_author_llm.js`
- `patch_summary.validation` agora inclui:
  - `shape_valid`
  - `has_summary`
  - `risk_level_supported`
  - `has_candidate_files`
  - `has_proposed_changes`
  - `used_fallback_candidate_file`
- tolera resposta não-JSON e segue com proposal normalizado (fallback)

5. **Testes ampliados**

- `tests/unit/audit_agent/test_patch_author_llm.spec.js`
  - novo caso: resposta não-JSON + fallback + metadados de validação
- `tests/unit/server/test_control_command_service_audit_persistence.spec.js`
  - novos asserts: bloqueio por path/branch guard em `AUDIT_PATCH_APPLY`

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_patch_author_llm.spec.js tests/unit/audit_agent/test_audit_agent_runtime.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **8/8 pass**
2. `node --check src/audit_agent/patch_author_llm.js src/server/domain/control_command_service.js src/server/api/controllers/dashboard_audit.js src/server/api/controllers/dashboard_inference.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-41-54-404Z`
- `errors=0`, `warnings=0`, `partial=false`
- Observação: cache miss em `quality.lint`/`quality.prettier_check` elevou duração (~117s); tuning
  fica para rodada de performance do audit

### Riscos ativos (atualizados)

1. `patch_author_llm` continua V0 proposal-only; qualidade da proposta depende do modelo/profile
   configurado.
2. `AUDIT_PATCH_APPLY` continua sem apply real (guardado), apesar dos novos pré-checks.
3. Faltam telas dedicadas de UI para explorar patch proposal detalhado e preflights de triage/patch
   sem client manual.

### Próxima rodada (escopo fechado)

1. Expor read-model detalhado de `llm_patch_author` por job
   (parsed/raw/validation/preflight/policy).
2. Endurecer `patch_author_llm` com schema/output mode opcional (`response_format`) e validação
   estrutural mais estrita.
3. Preparar esqueleto do apply real (`AUDIT_PATCH_APPLY`) com validação de branch limpa/dirty + path
   guards + TTL, ainda blocked-by-default.

---

## Rodada de Implementação Contínua (2026-02-22) — F6/F9 parciais (Apply Readiness Validation via Control Plane + Dashboard)

### Status geral

- **Em implementação (guardrails de patch apply consolidados em comando read-only de readiness, sem
  liberar apply real)**

### Mudanças implementadas nesta rodada

1. **Novo comando canônico `AUDIT_PATCH_APPLY_VALIDATE` (read-only)**

- `src/server/domain/control_command_service.js`
- reutiliza os guardrails do `AUDIT_PATCH_APPLY` e expõe readiness estruturado sem mutação
- readiness inclui:
  - `approval` (status/aprovação)
  - `dry_run` (presença, freshness, TTL, expiração)
  - `guards` (branch/path/worktree)
  - `blocking_reasons`
  - `mode` (`propose_only` vs `unsafe_local_enabled`)
  - `will_execute_real_apply`

2. **`AUDIT_PATCH_APPLY` refatorado para usar avaliação centralizada de readiness**

- `src/server/domain/control_command_service.js`
- erros de apply (`REQUIRES_APPROVAL`, `REQUIRES_DRY_RUN`, `*_EXPIRED`, `*_PATH_NOT_ALLOWED`,
  `*_BRANCH_NOT_ALLOWED`, `*_WORKTREE_DIRTY`, `*_DISABLED`) agora retornam `details` com a mesma
  estrutura de readiness
- reduz drift entre UI/API e control plane

3. **Dashboard Audit: endpoints de readiness de apply**

- `src/server/api/controllers/dashboard_audit.js`
- novos endpoints:
  - `GET /api/dashboard/audit/patches/:id/apply-readiness`
  - `POST /api/dashboard/audit/patches/:id/apply/validate`
- ambos retornam:
  - `patch` (enriquecido com `dry_run_state`)
  - `validation` (payload read-only do control plane)

4. **Teste unitário de persistência/control plane ampliado**

- `tests/unit/server/test_control_command_service_audit_persistence.spec.js`
- cobre `AUDIT_PATCH_APPLY_VALIDATE` com asserts de readiness (incluindo bloqueio por
  `propose_only`)

### Gates executados (rodada)

1. `env -u NO_COLOR node --test tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **1/1 pass**
2. `node --check src/server/domain/control_command_service.js src/server/api/controllers/dashboard_audit.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-56-03-672Z`
- `errors=0`, `warnings=0`, `partial=false`

### Riscos ativos (atualizados)

1. `AUDIT_PATCH_APPLY` continua **sem apply real**, guardado por design (V1 `semi_auto`).
2. Endpoints de readiness já existem, mas faltam telas de UI para consumo visual/operacional.
3. `patch_author_llm` segue V0 proposal-only; apply readiness não implica patch aplicável
   automaticamente.

### Próxima rodada (escopo fechado)

1. Expor read-model/summary de `apply_readiness` diretamente em patch detail/list (cacheado quando
   fizer sentido).
2. Iniciar esqueleto de apply real em `AUDIT_PATCH_APPLY` (ainda blocked-by-default) com validação
   extra de worktree/branch/path já centralizada.
3. Integrar output-schema mais estrito no `patch_author_llm` (via gateway/response format) para
   reduzir fallback textual.
