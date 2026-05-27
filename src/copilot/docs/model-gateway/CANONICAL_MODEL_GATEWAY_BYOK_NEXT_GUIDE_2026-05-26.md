# Canonical Model Gateway BYOK Next Guide - 2026-05-26

## 0. Status Canonico

Este arquivo passa a ser o guia canonico vivo do `src/copilot/model-gateway`.

O guia anterior fica como legado historico:

`src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md`

Este documento consolida a leitura integral do guia legado de 6593 linhas.

Este documento consolida a auditoria local do estado atual do codigo em 2026-05-26.

Este documento consolida as lacunas de arquitetura, runtime, SQLite, terminal e SDK.

Este documento consolida o roadmap futuro com checkboxes booleanos.

Todo checkbox deste documento e booleano.

`[x]` significa concluido de modo aceitavel para a camada atual.

`[ ]` significa pendente.

Nao ha checkbox parcial.

Quando uma area estiver parcialmente feita, o item amplo fica pendente.

Quando uma parte estiver pronta, ela aparece como subitem concluido.

O foco operacional continua sendo `src/copilot`.

O foco de dominio continua sendo `src/copilot/model-gateway`.

O banco de dados citado neste documento e o banco de metadados do model-gateway.

Nao e build de frontend.

Nao e build da aplicacao inteira.

Nao e build Docker.

Nao e build MCP.

O build canonicamente relevante aqui e a materializacao do catalogo de metadados em JSON e SQLite.

O schema externo-alvo continua sendo OpenAI-first.

O schema interno continua podendo ser mais rico que o schema OpenAI.

O objetivo e normalizar providers heterogeneos para uma camada universal.

O objetivo nao e apagar diferencas entre providers.

O objetivo e preservar essas diferencas dentro de `x_model_gateway`.

O objetivo e separar metadados, overlays, elegibilidade, selecao e runtime.

O objetivo e permitir BYOK robusto, auditavel e reversivel.

O objetivo e permitir atualizacao incremental sem rebuild completo quando possivel.

O objetivo e permitir live tests apenas quando as camadas anteriores estiverem prontas.

O objetivo e manter Ollama local suportado, mas fora dos defaults.

O objetivo e permitir Ollama local somente por opt-in explicito do operador.

O objetivo e nao promover runtime proof para metadado canonico.

O objetivo e nao persistir segredo em catalogo, SQLite, log, terminal ou artefato.

O objetivo e nao criar paralelismos entre SDK, terminal e gateway.

O objetivo e fortalecer uma arquitetura unica.

## 1. Fontes Lidas E Auditadas

### 1.1 Guia Legado

Arquivo lido integralmente:

`src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md`

Contagem verificada: 6593 linhas.

O guia legado contem a base conceitual inicial.

O guia legado contem o vocabulario de provider, subject provider e provider model.

O guia legado contem a separacao entre metadados e runtime.

O guia legado contem a separacao entre account overlay e runtime proof.

O guia legado contem o historico de faixas A ate Y.

O guia legado contem registros de live tests BYOK reais.

O guia legado contem registros de validadores recentes.

O guia legado contem continuidade acumulada demais para continuar como guia primario.

O guia legado deve continuar disponivel para arqueologia e detalhes de implementacao historica.

O guia legado nao deve mais ser usado como roadmap primario.

### 1.2 Arquivos De Dominio Auditados

`src/copilot/model-gateway/README.md`

`src/copilot/model-gateway/index.js`

`src/copilot/model-gateway/catalog/contracts.js`

`src/copilot/model-gateway/catalog/default-importers.js`

`src/copilot/model-gateway/catalog/importer-runner.js`

`src/copilot/model-gateway/catalog/refresh.js`

`src/copilot/model-gateway/catalog/sqlite-schema.js`

`src/copilot/model-gateway/catalog/sqlite-catalog-store.js`

`src/copilot/model-gateway/catalog/normalizers.js`

`src/copilot/model-gateway/catalog/openai-schema.js`

`src/copilot/model-gateway/catalog/search.js`

`src/copilot/model-gateway/catalog/coverage.js`

`src/copilot/model-gateway/catalog/integrity.js`

`src/copilot/model-gateway/catalog/refresh-plan.js`

`src/copilot/model-gateway/catalog/refresh-logs.js`

`src/copilot/model-gateway/catalog/retention.js`

`src/copilot/model-gateway/eligibility/contracts.js`

`src/copilot/model-gateway/eligibility/evaluator.js`

`src/copilot/model-gateway/eligibility/catalog-snapshot.js`

`src/copilot/model-gateway/account-access/resolver.js`

`src/copilot/model-gateway/account-access/runtime-overlays.js`

`src/copilot/model-gateway/account-access/limits.js`

`src/copilot/model-gateway/account-access/sdk-quota.js`

`src/copilot/model-gateway/account-access/summary.js`

`src/copilot/model-gateway/health/provider-failure.js`

`src/copilot/model-gateway/health/provider-health.js`

`src/copilot/model-gateway/health/sqlite-health-mirror.js`

`src/copilot/model-gateway/routing/policy-engine.js`

`src/copilot/model-gateway/routing/candidate-builder.js`

`src/copilot/model-gateway/routing/selection-audit.js`

`src/copilot/model-gateway/routing/task-profiles.js`

`src/copilot/model-gateway/routing/local-provider-opt-in.js`

`src/copilot/model-gateway/providers/provider-adapter-registry.js`

`src/copilot/model-gateway/providers/openai-compatible-adapter.js`

`src/copilot/model-gateway/providers/openai-provider-family-adapter.js`

`src/copilot/model-gateway/providers/endpoints/index.js`

`src/copilot/model-gateway/providers/specs/index.js`

`src/copilot/model-gateway/probes/matrix.js`

`src/copilot/model-gateway/probes/planner.js`

`src/copilot/model-gateway/probes/backoff-planner.js`

`src/copilot/model-gateway/probes/chat-probe.js`

`src/copilot/model-gateway/probes/streaming-probe.js`

`src/copilot/model-gateway/probes/json-probe.js`

`src/copilot/model-gateway/probes/agent-probe.js`

`src/copilot/model-gateway/probes/vision-probe.js`

`src/copilot/model-gateway/session/copilot-model-projection.js`

`src/copilot/model-gateway/session/on-list-models.js`

`src/copilot/model-gateway/commands/canonical-commands.js`

### 1.3 Arquivos De Integracao Auditados

`src/copilot/terminal/commands/byok.js`

`src/copilot/terminal/byok/session-binding.js`

`src/copilot/terminal/byok/admission.js`

`src/copilot/terminal/frontend/index.js`

`src/copilot/terminal/frontend/projections/config.js`

`src/copilot/terminal/frontend/projections/sdk-session.js`

`scripts/model-gateway-metadata-build.mjs`

`scripts/model-gateway-refresh.mjs`

`scripts/model-gateway-refresh-log.mjs`

`scripts/model-gateway-sqlite-diagnostics.mjs`

`scripts/model-gateway-sqlite-retention.mjs`

`scripts/model-gateway-catalog-integrity.mjs`

`scripts/model-gateway-selection-audit.mjs`

`scripts/model-gateway-effective-selection.mjs`

`scripts/model-gateway-live-readiness.mjs`

`scripts/model-gateway-live-plan.mjs`

`scripts/model-gateway-canonical-commands.mjs`

`scripts/copilot/run-terminal-llm-b-live-test.mjs`

`package.json`

`Makefile`

### 1.4 Testes Relacionados

`tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`

`tests/unit/copilot/model-gateway/test_model_gateway_provider_failure.spec.js`

`tests/unit/copilot/model-gateway/test_model_gateway_provider_health.spec.js`

`tests/unit/copilot/terminal/test_commands_byok.spec.js`

`tests/unit/copilot/sdk/test_sdk_quota_monitor_f25.spec.js`

`tests/unit/copilot/sdk/test_model_switch_verify_retry.spec.js`

`tests/unit/copilot/sdk/test_sdk_models_session_resolution_adapter.spec.js`

`tests/unit/copilot/test_sdk_runtime_projection_routes.spec.js`

`tests/unit/copilot/test_sdk_runtime_targeting_strict_routes.spec.js`

## 2. Diagnostico Atual Em 2026-05-26

### 2.1 Diagnostico De Catalogo

Comando usado:

`npm run model-gateway:catalog:integrity`

Resultado observado:

`ok=true`.

Snapshot observado:

`catalog:88612faae132134557e24113`.

Gerado em:

`2026-05-26T20:03:07.966Z`.

Store JSON:

`data/copilot/model-gateway/catalog.json`.

Evidencias de modelo:

34728 linhas.

Evidencias de provider:

614 linhas.

Route options:

1837 linhas.

Projections:

1314 linhas.

Provider projections:

77 linhas.

Account overlays:

14 linhas.

Duplicatas de evidencias:

0.

Duplicatas de route options:

0.

Duplicatas de projections:

0.

Duplicatas de account overlays:

0.

Identidades redigidas indevidamente:

0.

Conclusao:

O catalogo persistido atual esta integro.

### 2.2 Diagnostico De SQLite

Comando usado:

`npm run model-gateway:sqlite:diagnostics`

Resultado observado:

Schema version:

4.

SQLite user_version:

4.

Snapshot ativo:

existe.

Fonte do snapshot ativo:

`eligibility-refresh`.

Linhas de catalogo:

40818.

Linhas de historico de conta:

210.

Linhas de runtime:

0.

Route decisions:

3.

Refresh log events:

640.

Tabela `copilot_model_gateway_runtime_probe_runs`:

0.

Tabela `copilot_model_gateway_runtime_probe_results`:

0.

Tabela `copilot_model_gateway_health_observations`:

0.

Conclusao:

SQLite esta materializado e coerente para catalogo, overlays, eligibility e logs.

Conclusao adicional:

Runtime proof ainda nao esta persistido no SQLite como camada propria.

### 2.3 Diagnostico De Selecao Efetiva

Comando usado:

`npm run model-gateway:selection:effective -- --strict`

Resultado observado:

`ok=true`.

Modo:

`strict_access_only_with_observed_health`.

Persisted:

false.

Runtime executed:

false.

Health records observados:

17.

Runtime account overlays derivados:

2.

Runtime overlays ativos:

0.

Runtime overlays expirados:

2.

Runtime overlays por provider:

`chutes:1`.

`gemini:1`.

Runtime overlays por failure:

`credits:1`.

`auth:1`.

Eligibility decisions efetivas:

1923.

Elegiveis:

868.

Unknown:

356.

Excluidos:

699.

Perfis selecionados:

8 de 8.

Providers selecionados:

`zai:1`.

`chutes:6`.

`cerebras:1`.

Supply warnings:

3.

Supply warnings concentrados em:

`local_private`.

Conclusao:

A selecao efetiva esta funcional antes de runtime.

Conclusao adicional:

O perfil `local_private` ainda precisa de semantica mais clara para defaults e opt-in.

Conclusao adicional:

O warning de supply local/private e esperado quando Ollama local nao esta rodando.

Conclusao adicional:

Defaults nao selecionam Ollama local.

### 2.4 Diagnostico De Live Readiness

Comando usado:

`npm run model-gateway:live:readiness`

Resultado observado:

`ok=true`.

Catalog integrity:

ok.

SQLite parity:

ok.

Selection allow probe:

8 de 8 perfis selecionados.

Selection strict access:

8 de 8 perfis selecionados.

Selection effective observed health:

8 de 8 perfis selecionados.

Runtime not promoted:

ok.

Live runner present:

ok.

Supply warnings:

3.

Conclusao:

A base esta pronta para planejar live tests.

Conclusao adicional:

Ainda nao devemos assumir que a camada runtime persistente esta completa.

### 2.5 Diagnostico De Comandos Canonicos

Comando usado:

`npm run model-gateway:commands:json`

Superficies observadas:

package scripts.

Makefile.

terminal cockpit.

Fases observadas:

orientation.

validate.

prebuild.

metadata.

pre-runtime.

selection.

live-readiness.

Comandos principais:

`npm run model-gateway:commands`.

`npm run model-gateway:validate`.

`npm run model-gateway:metadata:build:plan`.

`npm run model-gateway:metadata:build:preview`.

`npm run model-gateway:metadata:build`.

`npm run model-gateway:build`.

`npm run model-gateway:selection:effective`.

`npm run model-gateway:live:readiness`.

`npm run model-gateway:live:plan`.

`npm run terminal:llm-b:live-test`.

Conclusao:

A operabilidade canônica existe.

Conclusao adicional:

O novo guia deve tornar a sequencia oficial mais explicita.

## 3. Arquitetura Atual Resumida

### 3.1 Camada `catalog`

`catalog/contracts.js` define fatos secret-safe.

`catalog/contracts.js` define `MODEL_GATEWAY_CATALOG_SCHEMA_VERSION`.

`catalog/contracts.js` define source, evidence, provider evidence, projection, route option e account overlay.

`catalog/contracts.js` redige campos sensiveis por chave e por texto.

`catalog/normalizers.js` normaliza modalidades.

`catalog/normalizers.js` normaliza capacidades OpenAI-compatible.

`catalog/normalizers.js` normaliza tokens.

`catalog/normalizers.js` normaliza pricing USD.

`catalog/normalizers.js` normaliza lifecycle.

`catalog/normalizers.js` normaliza aliases.

`catalog/normalizers.js` normaliza rate limits.

`catalog/normalizers.js` normaliza data policy.

`catalog/merge.js` faz merge por field confidence.

`catalog/openai-schema.js` projeta a saida OpenAI-first.

`catalog/refresh.js` executa refresh programatico.

`catalog/refresh.js` separa preview e commit.

`catalog/refresh.js` suporta progress events.

`catalog/refresh.js` suporta lock.

`catalog/refresh.js` suporta refresh incremental.

`catalog/refresh.js` suporta account overlay refresh separado.

`catalog/refresh.js` suporta eligibility refresh opcional.

`catalog/sqlite-schema.js` reserva tabelas para catalogo, overlays, eligibility, runtime probes, health e route decisions.

`catalog/sqlite-catalog-store.js` materializa o snapshot em tabelas normalizadas.

`catalog/integrity.js` audita duplicatas e redaction.

`catalog/coverage.js` mede cobertura de metadados.

`catalog/search.js` busca rica por metadados.

`catalog/explain.js` explica registros do catalogo.

### 3.2 Camada `importers`

Importers publicos existem para OpenRouter.

Importers publicos existem para Kilo Gateway.

Importers publicos existem para Cerebras.

Importers publicos existem para OpenAI docs.

Importers publicos existem para Anthropic docs.

Importers publicos existem para Gemini docs.

Importers publicos existem para Mistral docs.

Importers publicos existem para Groq docs.

Importers publicos existem para Hugging Face router.

Importers publicos existem para Cloudflare Workers AI.

Importers publicos existem para OpenCode docs.

Importers publicos existem para Z.AI OpenAPI/docs.

Importers autenticados existem para OpenAI.

Importers autenticados existem para Anthropic.

Importers autenticados existem para Gemini.

Importers autenticados existem para Mistral.

Importers autenticados existem para Groq.

Importers autenticados existem para Cerebras.

Importers autenticados existem para OpenRouter account.

Importers autenticados existem para Kilo account.

Importers autenticados existem para Cloudflare account.

Importers autenticados existem para Hugging Face.

Importers autenticados existem para OpenCode.

Importers autenticados existem para NVIDIA NIM.

Importers autenticados existem para Chutes.

Importers autenticados existem para Z.AI.

Importer local existe para Ollama.

`default-importers.js` compoe os importers a partir do env.

`default-importers.js` nao adiciona Ollama local sem base URL.

`default-importers.js` inclui `OPENCODE_API_KEY`.

`importer-runner.js` preserva erro por importer sem quebrar todo o pipeline.

`importer-runner.js` gera overlays de falha quando a fonte permite.

`importer-runner.js` gera raw payload refs sanitizados.

### 3.3 Camada `providers`

Existe inventario de endpoints por provider.

Existe arquivo de endpoints para OpenAI.

Existe arquivo de endpoints para OpenRouter.

Existe arquivo de endpoints para Anthropic.

Existe arquivo de endpoints para Gemini.

Existe arquivo de endpoints para Ollama.

Existe arquivo de endpoints para Kilo.

Existe arquivo de endpoints para Groq.

Existe arquivo de endpoints para Mistral.

Existe arquivo de endpoints para Hugging Face.

Existe arquivo de endpoints para Cloudflare Workers AI.

Existe arquivo de endpoints para NVIDIA NIM.

Existe arquivo de endpoints para OpenCode.

Existe arquivo de endpoints para Cerebras.

Existe arquivo de endpoints para Chutes.

Existe arquivo de endpoints para Z.AI.

Existe arquivo de spec OpenAI-family para OpenAI.

Existe arquivo de spec OpenAI-family para Kilo.

Existe arquivo de spec OpenAI-family para Groq.

Existe arquivo de spec OpenAI-family para Mistral.

Existe arquivo de spec OpenAI-family para Hugging Face.

Existe arquivo de spec OpenAI-family para Cloudflare Workers AI.

Existe arquivo de spec OpenAI-family para NVIDIA NIM.

Existe arquivo de spec OpenAI-family para OpenCode.

Existe arquivo de spec OpenAI-family para Cerebras.

Existe arquivo de spec OpenAI-family para Chutes.

Existe arquivo de spec OpenAI-family para Z.AI.

Nao existe spec OpenAI-family para Anthropic.

Nao existe spec OpenAI-family para Gemini.

Nao existe spec OpenAI-family para OpenRouter.

Nao existe spec OpenAI-family para Ollama.

Isso e coerente quando o provider nao e diretamente OpenAI-family ou usa adapter dedicado.

Isso ainda precisa ficar explicito em auditoria automatica.

### 3.4 Camada `account-access`

`resolver.js` resolve acesso pre-runtime sem chamar provider.

`resolver.js` considera secret presence.

`resolver.js` considera overlays por provider.

`resolver.js` considera enabled models.

`resolver.js` considera blocked models.

`resolver.js` considera quotas.

`resolver.js` considera spending.

`resolver.js` considera rate limits.

`resolver.js` considera key disabled.

`resolver.js` separa status de failure class.

`runtime-overlays.js` deriva overlays volateis de health ja observado.

`runtime-overlays.js` trata auth, credits e rate-limit.

`runtime-overlays.js` usa TTL.

`runtime-overlays.js` usa reset windows quando disponiveis.

`sdk-quota.js` existe para snapshots de quota do SDK.

`limits.js` normaliza estados de limite.

Conclusao:

A camada account/key existe e esta no caminho correto.

Gap:

Ainda precisamos unificar melhor provider quotas, SDK quota snapshots e runtime failures no mesmo modelo mental.

### 3.5 Camada `eligibility`

`eligibility/evaluator.js` e puro.

`eligibility/evaluator.js` nao chama provider.

`eligibility/evaluator.js` nao muta catalogo canonico.

`eligibility/evaluator.js` consome projection.

`eligibility/evaluator.js` consome route option.

`eligibility/evaluator.js` consome account overlays.

`eligibility/evaluator.js` consome secret registry.

`eligibility/evaluator.js` consome policy.

`eligibility/evaluator.js` consome health fatal conhecido.

`eligibility/evaluator.js` trata secret missing.

`eligibility/evaluator.js` trata account overlay missing.

`eligibility/evaluator.js` trata enabled model closed list.

`eligibility/evaluator.js` trata lifecycle retired.

`eligibility/evaluator.js` trata provider allow/block.

`eligibility/evaluator.js` trata model allow/block.

`eligibility/evaluator.js` trata budget hard e soft.

`eligibility/evaluator.js` trata Cloudflare account/gateway missing.

`eligibility/evaluator.js` trata Ollama local installed overlay.

Conclusao:

Pre-runtime existe de verdade.

Gap:

Ainda precisa de criterios mais finos para acesso account-scoped por route selector e provider upstream.

### 3.6 Camada `routing`

`policy-engine.js` pontua candidatos deterministicamente.

`policy-engine.js` usa task profiles.

`policy-engine.js` usa allow/block provider.

`policy-engine.js` usa route layer.

`policy-engine.js` usa wire API.

`policy-engine.js` usa upstream provider.

`policy-engine.js` usa data policy.

`policy-engine.js` usa capacidades requeridas.

`policy-engine.js` usa contexto minimo.

`policy-engine.js` usa runtime health quando permitido.

`policy-engine.js` usa eligibility precomputada ou on-demand.

`policy-engine.js` bloqueia local private sem opt-in.

`policy-engine.js` preserva vision como soft preference.

`task-profiles.js` define perfis canônicos.

`task-profiles.js` define `local_private`.

`task-profiles.js` define `local_private_strict`.

Conclusao:

Selecao pre-runtime e efetiva existe.

Gap:

Ainda falta separar formalmente ranking de metadados, exclusao pre-runtime e runtime selection final em artefatos persistidos.

### 3.7 Camada `probes`

Probe chat existe.

Probe streaming existe.

Probe JSON existe.

Probe agent/tools existe.

Probe vision existe.

Matriz de probes existe.

Matriz inclui probes planejados.

Probes planejados incluem reasoning.

Probes planejados incluem forced tool choice.

Probes planejados incluem parallel tool calls.

Probes planejados incluem embeddings.

Probes planejados incluem audio transcription.

Probes planejados incluem TTS.

Probes planejados incluem rerank.

Probes planejados incluem image generation.

Probes planejados incluem gateway fallback.

Probes planejados incluem provider native.

Conclusao:

Probes basicos existem.

Gap:

Probes ainda nao formam uma camada persistente completa em SQLite.

Gap:

Probes provider-native ainda sao planejamento, nao runtime generalizado.

### 3.8 Camada `session`

`session/copilot-model-projection.js` projeta candidatos para `ModelInfo`.

`toCopilotModelInfo()` usa `selectorSyntax` como id do SDK quando existe.

`toCopilotModelInfo()` preserva `gatewayId`.

`toCopilotModelInfo()` preserva `routeCandidateId`.

`toCopilotModelInfo()` preserva `providerModel`.

`toCopilotModelInfo()` preserva `routeLayer`.

`toCopilotModelInfo()` preserva `wireApi`.

`toCopilotModelInfo()` preserva capabilities.

`toCopilotModelInfo()` preserva limits.

`toCopilotModelInfo()` preserva pricing.

Conclusao:

Ha fronteira clara entre id do gateway e id local do SDK.

Gap:

Precisamos de testes mais amplos para selectors automaticos por gateway.

### 3.9 Camada `terminal`

`terminal/commands/byok.js` e o cockpit principal.

O terminal expõe refresh.

O terminal expõe refresh plan.

O terminal expõe refresh log.

O terminal expõe diff.

O terminal expõe freshness.

O terminal expõe integrity.

O terminal expõe provider traits.

O terminal expõe env requirements.

O terminal expõe importers audit.

O terminal expõe probe matrix.

O terminal expõe probe backoff.

O terminal expõe SQLite mirror.

O terminal expõe OpenAI projection.

O terminal expõe explain.

O terminal expõe routes.

O terminal expõe overlays.

O terminal expõe accounts.

O terminal expõe eligibility.

O terminal expõe selection audit.

O terminal expõe model route preview.

`terminal/byok/session-binding.js` impede setModel cruzando provider.

`terminal/byok/admission.js` estima orcamento de turno e probes.

Conclusao:

Terminal esta fortemente acoplado ao gateway de modo intencional.

Gap:

`byok.js` e muito grande e deve ser fatiado por subcomandos mantendo barrel.

### 3.10 Camada `scripts`

`model-gateway-metadata-build.mjs` define o build do banco de metadados.

`model-gateway-metadata-build.mjs` suporta plan.

`model-gateway-metadata-build.mjs` suporta preview.

`model-gateway-metadata-build.mjs` suporta commit.

`model-gateway-metadata-build.mjs` suporta full.

`model-gateway-metadata-build.mjs` suporta incremental.

`model-gateway-metadata-build.mjs` suporta provider filter.

`model-gateway-metadata-build.mjs` suporta importer filter.

`model-gateway-metadata-build.mjs` suporta source filter.

`model-gateway-metadata-build.mjs` escreve JSONL progress log.

`model-gateway-metadata-build.mjs` espelha para SQLite no commit.

`model-gateway-metadata-build.mjs` reexecuta refresh log para SQLite.

`model-gateway-metadata-build.mjs` aplica retention operacional.

Conclusao:

O build do banco de metadados esta bem delineado.

Gap:

Precisamos provar mais cenarios de alteracao/remocao/substituicao de provider sem rebuild full.

`model-gateway-runtime-health-mirror.mjs` espelha health BYOK ja observado para SQLite.

Esse espelhamento nao chama provider.

Esse espelhamento nao executa modelo.

Esse espelhamento nao roda probe nova.

Esse espelhamento nao muta catalogo canonico.

Execucao inicial em 2026-05-26:

`npm run model-gateway:runtime-health:mirror`

Resultado:

`ok=true`.

Runtime executado:

false.

Provider fetched:

false.

Catalog mutated:

false.

Health observations:

17.

Runtime probe runs:

1.

Runtime probe results:

6.

Runtime rows:

24.

## 4. Invariantes Arquiteturais

### 4.1 Separacao De Camadas

Metadado canonico nao e runtime proof.

Runtime proof nao e metadado canonico.

Account overlay nao e runtime proof.

Eligibility nao chama provider.

Selection pre-runtime nao chama provider.

Runtime probe chama provider.

Runtime probe deve escrever em camada de runtime.

Runtime health pode influenciar eligibility observada.

Runtime health nao deve reescrever projection canonica.

Route decision nao e projection canonica.

SQLite pode estar no mesmo arquivo fisico.

SQLite deve manter tabelas logicas separadas.

JSON pode continuar como snapshot debug/interchange.

SQL deve ser a base para consultas ricas, historico e operacao.

### 4.2 OpenAI-First Sem Achatamento

Toda projection externa deve conseguir virar objeto tipo OpenAI model.

Campos OpenAI comuns devem ficar no topo da projection OpenAI.

Campos multi-provider devem ficar em `x_model_gateway`.

Campos de rota devem ficar em `x_model_gateway.route_options`.

Campos de provider upstream devem ficar em `x_model_gateway.provider`.

Campos de conta/key devem ficar fora do metadado canonico.

Campos runtime devem ficar fora do metadado canonico.

Campos de runtime podem aparecer em explain como camada separada.

Campos de runtime podem aparecer em selection effective como input observado.

Campos de runtime nao podem sobrescrever fatos de catalogo.

### 4.3 BYOK E SDK

O SDK continua boundary de sessao.

O gateway decide candidatos e rotas.

O terminal renderiza e aciona comandos.

Provider binding nasce na criacao/retomada da sessao SDK.

`/restart` nao e rebind de provider.

`/byok model <id>` so tenta setModel vivo dentro da mesma fronteira de provider.

Provider cross-boundary exige nova sessao SDK.

Gateway id global nao deve vazar como id local do provider quando o SDK espera id local.

`selectorSyntax` deve ser preservado para gateways com selector automatico.

### 4.4 Ollama Local

Ollama local e suportado.

Ollama local nao deve ser iniciado automaticamente.

Ollama local nao deve ser chamado por defaults.

Ollama local nao deve ser selecionado por defaults.

Ollama local pode entrar no catalogo se houver base URL configurada.

Ollama local deve exigir opt-in explicito para selecao.

Opt-in explicito inclui provider local solicitado.

Opt-in explicito inclui perfil local/private strict.

Opt-in explicito inclui active/current ja bound explicitamente a local.

Ausencia de daemon local deve gerar overlay/diagnostico, nao crash global.

### 4.5 Quotas E Limites

Quota de provider e estado de conta/key.

Rate limit e estado temporario de conta/key.

Spending limit e estado de conta/key.

Key disabled e estado de conta/key.

Modelo sem acesso por plano e estado de conta/key/modelo.

Modelo inexistente globalmente e metadado de catalogo ou rota.

Modelo nao visivel para key e overlay account-scoped.

Quota esgotada durante runtime deve virar health e overlay volatil.

Quota com reset conhecido deve expirar no reset.

Quota sem reset deve expirar por TTL conservador.

Quota nao deve remover o modelo do catalogo canonico.

Quota deve excluir pre-runtime enquanto ativa quando policy exigir.

### 4.6 Segurança

Segredos nunca devem aparecer no catalogo.

Segredos nunca devem aparecer no SQLite.

Segredos nunca devem aparecer em logs JSONL.

Segredos nunca devem aparecer no terminal.

Segredos nunca devem aparecer nos artefatos live.

`secretRef` pode aparecer.

`secretRef` nao e segredo.

Headers sensiveis devem ser redigidos.

Payloads brutos devem ser sanitizados.

Provider metadata deve ser sanitizado antes de persistir.

### 4.7 Operabilidade

Todo provider deve ter arquivo proprio quando tiver conhecimento estatico relevante.

Todo provider deve ter endpoint inventory quando houver fonte conhecida.

Todo importer deve declarar source.

Todo importer deve declarar auth mode.

Todo importer deve declarar env requirements.

Todo comando canônico deve existir no package ou Makefile ou terminal.

Todo processo longo deve ter log progressivo.

Todo build de metadados deve ter plan.

Todo build de metadados deve ter preview.

Todo build de metadados deve ter commit.

Todo build de metadados deve ter resumo final.

## 5. Situacao Ideal

### 5.1 Visao Geral

A situacao ideal e um gateway universal de modelos BYOK.

O gateway coleta todos os metadados disponiveis.

O gateway normaliza os metadados para um catalogo canonico.

O gateway expõe projection OpenAI-first.

O gateway preserva fatos provider-specific.

O gateway calcula account/key overlays sem vazar segredos.

O gateway calcula elegibilidade antes de runtime.

O gateway faz exclusoes baratas antes de gastar quota.

O gateway ranqueia por metadados antes de probes.

O gateway executa probes somente quando a fila ja foi filtrada.

O gateway persiste runtime proof separadamente.

O gateway usa runtime proof como evidencia dinamica de selecao.

O gateway preserva auditabilidade end-to-end.

O gateway suporta atualizacao incremental.

O gateway suporta rebuild full quando necessario.

O gateway tem comandos canonicos para operador humano.

O gateway tem comandos canonicos para LLM operadora.

O gateway tem logs suficientes para acompanhar builds longos.

O gateway tem testes unitarios, contratos, lint e typecheck.

### 5.2 Banco Canonico De Catalogo

O banco canonico guarda fontes.

O banco canonico guarda evidencias de modelo.

O banco canonico guarda evidencias de provider.

O banco canonico guarda projections de modelo.

O banco canonico guarda projections de provider.

O banco canonico guarda route options.

O banco canonico guarda conflitos.

O banco canonico guarda tombstones.

O banco canonico guarda import runs.

O banco canonico guarda raw payload refs sanitizados.

O banco canonico nao guarda segredo.

O banco canonico nao guarda quota runtime como fato global.

O banco canonico nao guarda probe runtime como fato global.

### 5.3 Banco De Conta E Key

O banco de conta/key guarda overlays.

O banco de conta/key guarda quota snapshots.

O banco de conta/key guarda rate limit snapshots.

O banco de conta/key guarda spending snapshots.

O banco de conta/key guarda visibility de modelo por conta.

O banco de conta/key guarda enabled models por conta.

O banco de conta/key guarda blocked models por conta.

O banco de conta/key guarda provider policy por conta.

O banco de conta/key guarda falhas de importer autenticado.

O banco de conta/key guarda falhas runtime derivadas como overlays volateis.

O banco de conta/key deve ter TTL e retention separados.

O banco de conta/key deve distinguir observacao publica de observacao autenticada.

### 5.4 Banco De Elegibilidade

O banco de elegibilidade guarda runs.

O banco de elegibilidade guarda decisions.

O banco de elegibilidade guarda policy profile.

O banco de elegibilidade guarda task profile.

O banco de elegibilidade guarda account scope.

O banco de elegibilidade guarda route selector.

O banco de elegibilidade guarda include boolean.

O banco de elegibilidade guarda disposition.

O banco de elegibilidade guarda hard exclusions.

O banco de elegibilidade guarda soft penalties.

O banco de elegibilidade guarda required runtime probes.

O banco de elegibilidade nao chama provider.

O banco de elegibilidade pode expirar decisions.

### 5.5 Banco De Runtime

O banco de runtime guarda probe runs.

O banco de runtime guarda probe results.

O banco de runtime guarda health observations.

O banco de runtime guarda route decisions vivas.

O banco de runtime guarda failure kind.

O banco de runtime guarda retry-after.

O banco de runtime guarda resetAt.

O banco de runtime guarda status HTTP.

O banco de runtime guarda wire API.

O banco de runtime guarda artefatos redigidos.

O banco de runtime nao altera catalogo global.

O banco de runtime alimenta selection effective.

### 5.6 Pipeline Ideal

Fase 0: inventario de sources.

Fase 1: coleta de metadados.

Fase 2: parse provider-specific.

Fase 3: facts/evidence.

Fase 4: normalizacao.

Fase 5: merge.

Fase 6: projection OpenAI-first.

Fase 7: account/key overlays.

Fase 8: eligibility pre-runtime.

Fase 9: ranking por metadados.

Fase 10: exclusao antes de runtime.

Fase 11: probe planning.

Fase 12: probes runtime.

Fase 13: runtime proof store.

Fase 14: selection final.

Fase 15: terminal/session binding.

Fase 16: observabilidade.

### 5.7 Primeiro Build Ideal Do Banco

Antes do primeiro build, rodar command inventory.

Antes do primeiro build, rodar lint escopado.

Antes do primeiro build, rodar typecheck strict.

Antes do primeiro build, rodar testes de contratos escopados.

Antes do primeiro build, rodar testes terminal BYOK escopados.

Antes do primeiro build, rodar metadata build plan.

Antes do primeiro build, rodar metadata build preview.

Antes do primeiro build, revisar importer failures.

Antes do primeiro build, revisar account importer failures.

Antes do primeiro build, revisar local importer failures.

Antes do primeiro build, revisar refresh log.

Antes do primeiro build, revisar SQLite diagnostics atual.

Build commit deve gravar JSON.

Build commit deve espelhar SQLite.

Build commit deve gravar refresh log events no SQLite.

Build commit deve aplicar retention operacional.

Build commit deve emitir resumo final.

Depois do build, rodar catalog integrity.

Depois do build, rodar SQLite diagnostics.

Depois do build, rodar selection effective strict.

Depois do build, rodar live readiness.

Depois do build, registrar resultado neste guia.

## 6. Bugs, Gaps E Oportunidades

### 6.1 Gaps Criticos

Runtime probes ainda nao persistem em SQLite como camada operacional completa.

Health observations SQLite existem no schema, mas diagnostico atual mostra 0 linhas.

Route decisions existem, mas ainda precisam de contrato de retention e explain mais amplo.

Selections efetivas ainda sao calculadas como preview nao persistido.

Account/key quota snapshots existem, mas precisam de relacao mais clara com provider-specific quota APIs.

SDK quota snapshots precisam ser avaliados cuidadosamente para BYOK.

`AssistantUsageQuotaSnapshot` pode ser util para SDK Copilot.

`AssistantUsageQuotaSnapshot` pode nao representar providers BYOK externos.

Integracao de quota SDK deve entrar como provider/account overlay separado.

Integracao de quota SDK nao deve virar fonte paralela de verdade.

### 6.2 Gaps De Provider

Anthropic tem endpoint inventory, mas nao OpenAI-family spec.

Gemini tem endpoint inventory, mas nao OpenAI-family spec.

OpenRouter tem adapter dedicado e endpoint inventory, mas precisa account overlay profundo.

Ollama tem endpoint inventory e adapter, mas precisa daemon online/offline mais forte.

Cloudflare precisa UX mais clara entre Workers AI direto e AI Gateway.

Kilo precisa endpoint dedicado de balance/allowlist se publicado.

OpenCode precisa adapter runtime por endpoint family.

Z.AI precisa runtime adapter/probes especificos.

Chutes precisa probes tools/JSON/reasoning.

NVIDIA NIM precisa health probes para management endpoints.

Hugging Face precisa eligibility por provider explicito.

OpenRouter precisa route eligibility por provider upstream explicito.

### 6.3 Gaps De Normalizacao

Capabilities ainda precisam diferenciar declaracao de docs, catalogo, account e runtime.

Tools precisa separar tool calling basico, forced tool choice e parallel tool calls.

JSON precisa separar JSON mode, JSON schema, structured outputs e best-effort.

Reasoning precisa separar parametro de raciocinio, budget, summaries e hidden reasoning.

Vision precisa continuar soft quando nao for requisito hard.

Embeddings precisa virar modalidade/probe propria.

Audio precisa virar modalidade/probe propria.

Rerank precisa virar modalidade/probe propria.

Image generation precisa virar modalidade/probe propria.

Provider-native precisa virar classe propria.

Gateway fallback/cache/retry precisa virar route trait e probe trait.

### 6.4 Gaps De Selecao

Selecao por metadados existe, mas precisa persistir decision audit quando apropriado.

Selecao efetiva existe, mas precisa deixar claro quando health observado entra.

Selecao final runtime ainda precisa fase propria.

Policy de unknown access precisa presets mais didaticos.

Policy de provider auto-selector precisa mais detalhe.

Policy de selector upstream precisa mais detalhe.

Policy de budget precisa preferencia por custo e hard limit separados.

Policy de local/private precisa diferenciar preferencia e obrigatoriedade.

Policy de privacy precisa data policy mais robusta.

Policy de compliance precisa surface futura.

### 6.5 Gaps De Build E Operacao

Build full existe.

Build incremental existe.

Provider-scoped refresh existe.

Ainda falta testar cenarios de provider removido.

Ainda falta testar cenarios de provider renomeado.

Ainda falta testar cenarios de key trocada.

Ainda falta testar cenarios de account overlay expirado.

Ainda falta testar cenarios de importer publico falhando.

Ainda falta testar cenarios de importer autenticado falhando.

Ainda falta testar cenarios de local daemon offline.

Ainda falta testar replay de refresh log apos falha parcial.

Ainda falta testar corrupcao de SQLite e recuperacao.

Ainda falta testar migracao de schema futura.

### 6.6 Gaps De Terminal

`src/copilot/terminal/commands/byok.js` concentra muitas responsabilidades.

Subcomandos de gateway deveriam migrar para modulos menores.

Renderizacao de account overlays deveria ser helper propria.

Renderizacao de eligibility deveria ser helper propria.

Renderizacao de selection audit deveria ser helper propria.

Renderizacao de refresh log deveria ser helper propria.

Renderizacao de live readiness deveria ser helper propria.

O cockpit deve permanecer uma superficie unica.

O codigo nao deve permanecer monolitico.

### 6.7 Gaps De Testes

Testes de contratos sao extensos.

Testes de terminal BYOK existem.

Ainda faltam testes de selecao final com runtime proof persistido.

Ainda faltam testes de SQLite operational retention sob carga maior.

Ainda faltam testes de migracao schema v4 para v5 futura.

Ainda faltam testes de build provider-scoped.

Ainda faltam testes de build preview sem commit.

Ainda faltam testes de refresh log replay.

Ainda faltam testes de SDK quota snapshots em BYOK vs non-BYOK.

Ainda faltam testes de provider removal/tombstone.

Ainda faltam testes de route selector auto.

### 6.8 Gaps De Documentacao

README do model-gateway ainda aponta para o guia legado.

O guia legado ainda nao tem banner de legado.

Este novo guia precisa ser apontado como fonte viva.

Comandos canonicos precisam aparecer neste guia em sequencia oficial.

Live test plan precisa aparecer neste guia.

Build do banco precisa aparecer neste guia.

## 7. Provider Matrix Atual

### 7.1 OpenAI

Provider id:

`openai`.

Catalog source autenticada:

`/v1/models`.

Docs source:

pricing/model docs.

Runtime families:

Responses.

Chat Completions.

Embeddings.

Possivel gap:

Integracao plena com Responses runtime.

Possivel gap:

Account-scoped eligibility mais profunda.

Possivel gap:

Quota SDK vs BYOK external precisa separacao.

### 7.2 Anthropic

Provider id:

`anthropic`.

Catalog source autenticada:

`/v1/models`.

Retrieve por modelo:

presente.

Docs source:

presente.

Runtime family:

Messages API.

Possivel gap:

Docs seed completo por familia.

Possivel gap:

Probes especificos de tool use Anthropic.

Possivel gap:

Spec nao entra como OpenAI-family.

### 7.3 Gemini

Provider id:

`gemini`.

Catalog source:

models list/get.

OpenAI-compatible route:

presente.

Runtime family:

Google generate content.

Possivel gap:

Diferenca AI Studio vs Vertex.

Possivel gap:

Probes JSON/tools/vision especificos.

Possivel gap:

Quota por key/projeto.

### 7.4 Mistral

Provider id:

`mistral`.

Catalog source autenticada:

presente.

Docs pricing:

presente.

Runtime family:

OpenAI-compatible.

Possivel gap:

Docs seed de limites completo.

Possivel gap:

Probes especificos.

### 7.5 Groq

Provider id:

`groq`.

Catalog source autenticada:

presente.

Docs source:

presente.

Runtime family:

OpenAI-compatible.

Possivel gap:

Eligibility usando active/account visibility.

Possivel gap:

Probes compound/built-in tools.

### 7.6 OpenRouter

Provider id:

`openrouter`.

Catalog source publica:

presente.

Account source:

presente.

Runtime family:

OpenAI-compatible gateway.

Route selectors:

provider/fallback/auto.

Possivel gap:

Provider-specific route eligibility.

Possivel gap:

Account overlay autenticado profundo.

Possivel gap:

Probes de provider explicit/fallback.

### 7.7 Kilo Gateway

Provider id:

`kilo`.

Provider aliases:

`kilo-code`.

`kilo-gateway`.

Catalog models:

presente.

Catalog providers:

presente.

Account overlay:

presente.

Runtime family:

gateway OpenAI-compatible.

Live real:

validado com `kilo-auto/free`.

Possivel gap:

Endpoint de balance/allowlist se publicado.

Possivel gap:

Probes live adicionais quando runtime persistence estiver pronta.

### 7.8 Hugging Face

Provider id:

`huggingface`.

Catalog source:

Inference Providers router.

Route selectors:

`:fastest`.

`:cheapest`.

`:preferred`.

Possivel gap:

Eligibility por provider explicito.

Possivel gap:

Probes por router/provider.

Possivel gap:

Account limits por token.

### 7.9 Cloudflare Workers AI / AI Gateway

Provider id:

`cloudflare-workers-ai`.

Catalog source:

Workers AI catalog.

Account source:

Cloudflare account/gateway configured.

Runtime surfaces:

Workers AI direct.

AI Gateway universal.

Possivel gap:

UX separada Workers AI direto vs AI Gateway.

Possivel gap:

Gateway fallback/cache/retry probes.

Possivel gap:

Account/gateway availability por rota.

### 7.10 NVIDIA NIM

Provider id:

`nvidia-nim`.

Hosted importer:

presente.

Self-hosted metadata:

presente.

Management endpoint metadata:

presente.

Possivel gap:

Health probes para management endpoints.

Possivel gap:

Hosted vs self-hosted eligibility.

### 7.11 Ollama

Provider ids:

`ollama-local`.

`ollama-cloud`.

Local tags/show:

presente.

Local daemon:

nao deve rodar agora.

Default selection:

deve excluir local.

Explicit opt-in:

obrigatorio para local.

Possivel gap:

Daemon online/offline eligibility mais rica.

Possivel gap:

Probe local sem segredo quando explicitamente solicitado.

### 7.12 OpenCode

Provider id:

`opencode`.

Env key:

`OPENCODE_API_KEY`.

API importer:

presente.

Docs importer:

presente.

Endpoint families:

chat completions.

messages.

responses.

Possivel gap:

Adapter runtime por endpoint family.

Possivel gap:

Eligibility por endpoint/wire API.

### 7.13 Chutes

Provider id:

`chutes`.

Rich models importer:

presente.

Pricing/context/features:

presente.

Confidential compute metadata:

presente.

Possivel gap:

Eligibility por confidential compute policy.

Possivel gap:

Probes tools/JSON/reasoning.

### 7.14 Z.AI

Provider id:

`zai`.

Docs/pricing importer:

presente.

OpenAPI importer:

presente.

OpenAI-compatible route:

presente.

Possivel gap:

Runtime adapter/probes especificos.

Possivel gap:

Built-in web search accounting.

### 7.15 Cerebras

Provider id:

`cerebras`.

Public catalog:

presente.

Authenticated account/catalog:

presente.

OpenAI-compatible route:

presente.

Possivel gap:

Rate limits/pricing reconciliados.

Possivel gap:

Quota/account overlay mais rico.

## 8. Roadmap Canonico

### Faixa A - Governanca Documental

- [x] Ler integralmente o guia legado de 2026-05-25.
- [x] Auditar a situacao atual do model-gateway antes de tocar codigo.
- [x] Criar novo guia canonico em arquivo separado.
- [x] Atualizar README do model-gateway para apontar para este novo guia.
- [x] Adicionar banner de legado no guia antigo.
- [ ] Adicionar link deste guia nos hubs documentais relevantes.
- [ ] Registrar no guia a data do primeiro build posterior a este documento.
- [ ] Manter checkboxes somente booleanos.
- [ ] Criar rotina de atualizar este guia a cada faixa entregue.
- [ ] Evitar que continuidade operacional infle demais este arquivo sem indices.

### Faixa B - Fronteiras De Dominio

- [x] Confirmar que `model-gateway` e dominio canonico de BYOK/model routing.
- [x] Confirmar que SDK permanece boundary de sessao.
- [x] Confirmar que terminal renderiza e aciona comandos.
- [x] Confirmar que observability nao deve inferir capabilities.
- [ ] Criar auditoria automatica de imports proibidos entre gateway e SDK.
- [ ] Criar auditoria automatica de imports proibidos entre terminal e internals instaveis.
- [ ] Reduzir dependencia direta de `terminal/commands/byok.js` em muitos exports.
- [ ] Fatiar cockpit BYOK por subcomando mantendo barrel publico.
- [ ] Documentar boundaries em README atualizado.
- [ ] Adicionar teste de governanca para este novo guia como link vivo.

### Faixa C - Schema Canonico De Catalogo

- [x] Definir source records.
- [x] Definir model evidence.
- [x] Definir provider evidence.
- [x] Definir canonical model projection.
- [x] Definir canonical provider projection.
- [x] Definir route option.
- [x] Definir account overlay.
- [x] Sanitizar payloads.
- [x] Redigir headers sensiveis.
- [ ] Planejar schema version 2 do catalogo com migracao explicita.
- [ ] Adicionar campo de confidence por camada, nao apenas por field.
- [ ] Adicionar tombstone semantics mais visivel em explain.
- [ ] Adicionar validacao estrutural por source kind.
- [ ] Adicionar contrato de provider removal sem corrupcao.
- [ ] Adicionar contrato de provider rename/alias migration.

### Faixa D - SQLite E Persistencia

- [x] Criar schema SQLite versionado.
- [x] Materializar catalogo em SQLite.
- [x] Garantir user_version igual ao schema version.
- [x] Separar tabelas logicas por camada.
- [x] Guardar account history.
- [x] Guardar eligibility decisions.
- [x] Guardar refresh logs.
- [x] Guardar route decisions iniciais.
- [x] Materializar runtime probe runs ja observados por mirror explicito.
- [x] Materializar runtime probe results ja observados por mirror explicito.
- [x] Materializar health observations ja observadas por mirror explicito.
- [ ] Persistir novos runtime probe runs diretamente no fluxo de probes.
- [ ] Persistir novos runtime probe results diretamente no fluxo de probes.
- [ ] Persistir novas health observations diretamente no fluxo de health.
- [ ] Criar comando de rebuild somente SQLite a partir do JSON.
- [ ] Criar comando de recover JSON a partir do SQLite quando possivel.
- [ ] Criar teste de migracao v4 para v5.
- [ ] Criar teste de schema mais novo que codigo atual.
- [ ] Criar teste de provider removed/tombstone no SQLite.
- [ ] Criar diagnostico de linhas orfas.
- [ ] Criar diagnostico de divergencia payload vs colunas indexadas.

### Faixa E - Importers

- [x] OpenRouter public importer.
- [x] OpenRouter account importer.
- [x] Kilo models importer.
- [x] Kilo providers importer.
- [x] Kilo account importer.
- [x] Cerebras public importer.
- [x] Cerebras authenticated importer.
- [x] OpenAI models importer.
- [x] OpenAI docs importer.
- [x] Anthropic models importer.
- [x] Anthropic docs importer.
- [x] Gemini models importer.
- [x] Gemini docs importer.
- [x] Mistral models importer.
- [x] Mistral docs importer.
- [x] Groq models importer.
- [x] Groq docs importer.
- [x] Hugging Face router importer.
- [x] Cloudflare catalog importer.
- [x] Cloudflare account importer.
- [x] NVIDIA NIM importer.
- [x] Ollama local importer.
- [x] OpenCode API importer.
- [x] OpenCode docs importer.
- [x] Chutes importer.
- [x] Z.AI models importer.
- [x] Z.AI OpenAPI importer.
- [ ] Criar auditoria que compara provider endpoint inventory com importers.
- [ ] Criar teste de default importer set com todas as env keys.
- [ ] Criar fixtures de importer publico sem rede.
- [ ] Criar fixtures de importer autenticado sem segredos reais.
- [ ] Criar politica de retry/backoff por importer.
- [ ] Criar relatorio de importer coverage por provider.
- [ ] Criar relatorio de metadata richness por importer.
- [ ] Criar importer failure matrix por provider.

### Faixa F - Provider Specs E Endpoints

- [x] Um arquivo de endpoints por provider relevante.
- [x] Um arquivo de spec OpenAI-family por provider compativel.
- [x] Provider endpoint inventory central.
- [x] Endpoint richness taxonomy.
- [x] Endpoint source records.
- [ ] Auditar providers sem spec e classificar se e intencional.
- [ ] Adicionar teste que exige endpoint inventory para todo importer provider.
- [ ] Adicionar teste que exige importer ou justificativa para todo catalog source endpoint.
- [ ] Separar endpoints de metadata, account, runtime e management.
- [ ] Adicionar versionamento de endpoint por provider.
- [ ] Adicionar coluna/metadata para estabilidade do endpoint.
- [ ] Adicionar rota para endpoints deprecated.
- [ ] Adicionar comandos terminal para endpoint gaps.
- [ ] Adicionar docs internas por provider com peculiaridades.

### Faixa G - Normalizacao OpenAI-First

- [x] Normalizar modalidades.
- [x] Normalizar capacidades OpenAI-compatible.
- [x] Normalizar limits.
- [x] Normalizar pricing USD.
- [x] Normalizar aliases.
- [x] Normalizar lifecycle.
- [x] Normalizar rate limit taxonomy.
- [x] Normalizar data policy.
- [x] Normalizar model identity traits.
- [x] Normalizar route policy traits.
- [ ] Separar declaracao de docs vs catalogo vs account vs runtime.
- [ ] Separar tools, forced tool choice e parallel tool calls.
- [ ] Separar JSON mode, JSON schema e structured outputs.
- [ ] Separar reasoning effort, reasoning budget e summaries.
- [ ] Normalizar embeddings como familia propria.
- [ ] Normalizar audio input/output como familia propria.
- [ ] Normalizar rerank como familia propria.
- [ ] Normalizar image generation como familia propria.
- [ ] Normalizar gateway fallback/cache/retry como traits.
- [ ] Adicionar coverage por normalizer.

### Faixa H - Account, Key, Quota E Limites

- [x] Resolver account access sem provider call.
- [x] Tratar missing secret.
- [x] Tratar missing overlay.
- [x] Tratar enabled models.
- [x] Tratar blocked models.
- [x] Tratar quota exhausted.
- [x] Tratar spending exhausted.
- [x] Tratar rate limited.
- [x] Tratar key disabled.
- [x] Derivar overlays volateis de health runtime.
- [ ] Integrar `AssistantUsageQuotaSnapshot` somente como overlay SDK-scoped se aplicavel.
- [ ] Documentar diferenca entre quota SDK Copilot e BYOK provider externo.
- [ ] Criar provider quota capability matrix.
- [ ] Criar account overlay freshness policy por provider.
- [ ] Criar reset window strategy por failure kind.
- [ ] Criar comando terminal para explicar quota ativa vs expirada.
- [ ] Criar retention separada para quota/rate/spending snapshots.
- [ ] Criar teste de quota que expira e deixa de bloquear.
- [ ] Criar teste de key trocada que nao contamina overlay antigo.
- [ ] Criar teste de provider plan sem acesso ao modelo.

### Faixa I - Elegibilidade Pre-Runtime

- [x] Criar contracts de eligibility.
- [x] Criar evaluator puro.
- [x] Criar explain helper.
- [x] Integrar secret registry.
- [x] Integrar account overlays.
- [x] Integrar route options.
- [x] Integrar lifecycle retired.
- [x] Integrar provider allow/block.
- [x] Integrar model allow/block.
- [x] Integrar budget.
- [x] Integrar health fatal conhecido.
- [x] Integrar Cloudflare account/gateway.
- [x] Integrar Ollama local installed overlay.
- [ ] Adicionar policy presets formais.
- [ ] Adicionar account-scoped route selector eligibility.
- [ ] Adicionar upstream provider eligibility para gateways.
- [ ] Adicionar route layer eligibility por task.
- [ ] Adicionar wire API eligibility por adapter.
- [ ] Adicionar unknown access explain mais acionavel.
- [ ] Persistir runs de eligibility por build/refresh de modo mais claro.
- [ ] Adicionar diff de eligibility entre builds.
- [ ] Adicionar teste de eligibility para provider removal.

### Faixa J - Selecao Por Metadados

- [x] Task profiles.
- [x] Candidate builder.
- [x] Route options como unidade de selecao.
- [x] Provider allow/block.
- [x] Route layer allow/block.
- [x] Wire API allow/block.
- [x] Upstream provider allow/block.
- [x] Data policy scoring.
- [x] Budget scoring.
- [x] Context window filtering.
- [x] Local provider opt-in guard.
- [x] Vision soft preference.
- [x] Selection audit.
- [x] Effective selection com observed health.
- [ ] Persistir selection audit quando solicitado.
- [ ] Criar explain diff entre metadata-only e effective.
- [ ] Criar score decomposition mais estavel.
- [ ] Criar policy para auto selectors.
- [ ] Criar policy para gateway fallback.
- [ ] Criar policy para provider direct required.
- [ ] Criar policy para privacy strict.
- [ ] Criar policy para no paid models.
- [ ] Criar policy para max estimated cost.
- [ ] Criar teste de selecao com provider upstream explicito.

### Faixa K - Runtime Probes

- [x] Chat probe.
- [x] Streaming probe.
- [x] JSON probe.
- [x] Agent/tools probe.
- [x] Vision probe.
- [x] Probe matrix planning.
- [x] Probe backoff planning.
- [x] Materializar probe run observado no SQLite via mirror explicito de health.
- [x] Materializar probe results observados no SQLite via mirror explicito de health.
- [ ] Persistir novos probe runs diretamente a partir do executor de probes.
- [ ] Persistir novos probe results diretamente a partir do executor de probes.
- [ ] Persistir artefato redigido.
- [ ] Criar reasoning probe.
- [ ] Criar forced tool choice probe.
- [ ] Criar parallel tool calls probe.
- [ ] Criar embeddings probe.
- [ ] Criar audio transcription probe.
- [ ] Criar TTS probe.
- [ ] Criar rerank probe.
- [ ] Criar image generation probe.
- [ ] Criar gateway fallback probe.
- [ ] Criar provider native probe.
- [ ] Criar probe planner baseado em eligibility.
- [ ] Criar probe planner baseado em custo.
- [ ] Criar probe planner baseado em freshness.
- [ ] Criar probe planner baseado em diff de catalogo.

### Faixa L - Runtime Health

- [x] Classificar falhas BYOK.
- [x] Capturar HTTP status.
- [x] Capturar retry-after.
- [x] Capturar resetAt.
- [x] Capturar limit headers.
- [x] Diferenciar credits.
- [x] Diferenciar rate-limit.
- [x] Diferenciar auth.
- [x] Diferenciar model-or-route.
- [x] Diferenciar timeout.
- [x] Diferenciar network.
- [x] Diferenciar upstream.
- [x] Expirar rate-limit fatal apos janela.
- [x] Persistir health observations no SQLite via mirror explicito de health ja observado.
- [x] Criar subscription storage-neutral para mudancas de health BYOK.
- [x] Criar instalador debounced de mirror SQLite para health BYOK.
- [x] Instalar mirror SQLite no boot do terminal com drain em shutdown.
- [x] Criar retention de health observations.
- [x] Criar retention de runtime probe runs/results.
- [ ] Criar explain de health por provider/modelo.
- [ ] Criar diff de health antes/depois de live tests.
- [ ] Criar rota de limpar health por scope.
- [ ] Criar teste de resetAt no futuro.
- [ ] Criar teste de retry-after textual.
- [ ] Criar teste de quota durante runtime.
- [ ] Criar teste de auth durante runtime.

### Faixa M - Ollama Local E Local/Private

- [x] Suportar Ollama local como provider.
- [x] Nao iniciar daemon automaticamente.
- [x] Nao selecionar local por default.
- [x] Exigir opt-in para local.
- [x] Criar `local_provider_requires_explicit_request`.
- [x] Permitir `provider:ollama` como opt-in.
- [x] Permitir active/current local como opt-in.
- [x] Criar `local_private_strict`.
- [x] Emitir supply warnings quando nao ha supply local.
- [ ] Decidir se `local_private` deve continuar flexivel por default.
- [ ] Criar policy global `excludeLocalProvidersByDefault`.
- [ ] Criar teste para todos os defaults sem Ollama local.
- [ ] Criar teste para opt-in local com daemon offline.
- [ ] Criar teste para opt-in local com fixture de daemon online.
- [ ] Criar comando terminal claro para habilitar local.
- [ ] Criar explain de por que local foi bloqueado.
- [ ] Criar docs de seguranca local/private.

### Faixa N - Terminal E Cockpit

- [x] `/byok gateway commands`.
- [x] `/byok gateway prebuild`.
- [x] `/byok gateway catalog refresh`.
- [x] `/byok gateway catalog refresh-plan`.
- [x] `/byok gateway catalog refresh-log`.
- [x] `/byok gateway catalog diff`.
- [x] `/byok gateway catalog freshness`.
- [x] `/byok gateway catalog integrity`.
- [x] `/byok gateway provider traits`.
- [x] `/byok gateway env`.
- [x] `/byok gateway importers`.
- [x] `/byok gateway probes matrix`.
- [x] `/byok gateway probes backoff`.
- [x] `/byok gateway catalog sqlite`.
- [x] `/byok gateway catalog openai`.
- [x] `/byok gateway catalog explain`.
- [x] `/byok gateway routes`.
- [x] `/byok gateway overlays`.
- [x] `/byok gateway accounts`.
- [x] `/byok gateway eligibility`.
- [x] `/byok gateway selection audit`.
- [x] `/byok models route`.
- [ ] Modularizar `commands/byok.js`.
- [ ] Criar renderers testaveis por subcomando.
- [ ] Criar snapshots textuais para subcomandos criticos.
- [ ] Criar modo JSON para mais subcomandos.
- [ ] Criar terminal help por fases do roadmap.
- [ ] Criar comando terminal para este novo guia.

### Faixa O - SDK Boundary E Session Binding

- [x] Provider binding nasce na sessao SDK.
- [x] `session-binding.js` classifica alinhamento.
- [x] `setModel` vivo respeita mesma boundary.
- [x] Projection para `ModelInfo` preserva provider local id.
- [x] Projection preserva route candidate id.
- [x] Projection preserva gateway id.
- [ ] Criar testes de selectors automaticos.
- [ ] Criar testes de gateway id nao enviado como id local indevido.
- [ ] Criar teste de provider boundary crossing recusado.
- [ ] Criar teste de nova sessao apos troca provider.
- [ ] Criar audit de SDK stream failed associado a BYOK.
- [ ] Criar mecanismo de explain para falha de stream no SDK.
- [ ] Integrar SDK quota snapshot com cautela.

### Faixa P - Build Do Banco De Metadados

- [x] Script `model-gateway-metadata-build.mjs`.
- [x] Plan mode.
- [x] Preview mode.
- [x] Commit mode.
- [x] Full mode.
- [x] Incremental mode.
- [x] Provider filter.
- [x] Importer filter.
- [x] Source filter.
- [x] JSONL progress log.
- [x] SQLite mirror.
- [x] Refresh log SQLite replay.
- [x] Operational retention.
- [ ] Rodar primeiro build apos este guia.
- [ ] Registrar primeiro build neste guia.
- [ ] Adicionar teste de plan sem fetch.
- [ ] Adicionar teste de preview sem commit.
- [ ] Adicionar teste de commit com fixture.
- [ ] Adicionar teste de provider-scoped refresh.
- [ ] Adicionar teste de importer failure blocking.
- [ ] Adicionar teste de importer failure allowed.
- [ ] Adicionar teste de local importer failure optional.
- [ ] Adicionar resumo live de progresso no terminal.

### Faixa Q - Refresh Incremental E Mudancas De Provider

- [x] Refresh incremental por TTL.
- [x] Refresh provider-scoped.
- [x] Source-id scoped refresh.
- [x] Refresh lock.
- [x] Tombstones iniciais.
- [ ] Testar adicionar provider novo sem rebuild full.
- [ ] Testar alterar provider existente sem rebuild full.
- [ ] Testar remover source sem corromper projections.
- [ ] Testar trocar key e atualizar overlays.
- [ ] Testar account overlay expirado.
- [ ] Testar retained evidences quando source nao refresca.
- [ ] Testar raw payload retention.
- [ ] Testar conflict retention.
- [ ] Criar comando de diff por provider.
- [ ] Criar comando de rollback de snapshot se necessario.

### Faixa R - Observabilidade

- [x] Eventos de catalog refresh.
- [x] Eventos de diff.
- [x] Eventos de conflict.
- [x] Eventos de route decision.
- [x] Eventos de eligibility.
- [x] Metricas de coverage.
- [x] Metricas de provider freshness.
- [x] Metricas de exclusion reason.
- [x] Eventos de runtime probe podem ser materializados no SQLite por mirror explicito ou mirror instalado.
- [x] Eventos de health observation podem ser materializados no SQLite por mirror explicito ou mirror instalado.
- [ ] Eventos de account quota refresh.
- [ ] Eventos de build metadata progress em UI terminal.
- [ ] Eventos de SQLite retention.
- [ ] Eventos de provider removal.
- [ ] Eventos de provider key changed sem segredo.
- [ ] Criar dashboards textuais por fase.

### Faixa S - Segurança E Redaction

- [x] Redaction central.
- [x] Secret refs em vez de valores.
- [x] Sanitizacao de payloads.
- [x] Sanitizacao de operational payloads.
- [x] Secret scan em live artifacts recente.
- [ ] Auditar redaction em todas as tabelas SQLite.
- [ ] Auditar redaction em todos os logs JSONL.
- [ ] Auditar redaction em terminal output.
- [ ] Auditar redaction em providerMetadata.
- [ ] Auditar redaction em error messages.
- [ ] Criar teste com segredo injetado em payload bruto.
- [ ] Criar teste com segredo injetado em header.
- [ ] Criar teste com segredo injetado em error message.
- [ ] Criar teste com segredo injetado em provider docs row.

### Faixa T - Testes E Validadores

- [x] `model-gateway:test:contracts`.
- [x] `model-gateway:test:terminal`.
- [x] `model-gateway:lint`.
- [x] `model-gateway:typecheck`.
- [x] `model-gateway:validate`.
- [x] `typecheck:strict:src.copilot`.
- [x] `lint:copilot`.
- [ ] Criar suite especifica de SQLite migrations.
- [ ] Criar suite especifica de build metadata script.
- [ ] Criar suite especifica de refresh incremental.
- [ ] Criar suite especifica de runtime persistence.
- [ ] Criar suite especifica de provider endpoint coverage.
- [ ] Criar suite especifica de redaction SQLite.
- [ ] Criar suite especifica de local provider defaults.
- [ ] Criar suite especifica de SDK quota overlay.
- [ ] Criar comando de testes live plan sem runtime.

### Faixa U - Live Tests

- [x] Fase control no-pr passou historicamente.
- [x] Fase BYOK fixture no-pr passou historicamente.
- [x] BYOK real no-pr passou historicamente.
- [x] BYOK real completo com Kilo passou historicamente.
- [x] Live readiness atual ok.
- [ ] Rodar live plan apos primeira consolidacao deste guia.
- [ ] Rodar live no-pr apos runtime persistence estar pronto.
- [ ] Rodar live fixture apos runtime persistence estar pronto.
- [ ] Rodar live real no-pr com escopo explicito.
- [ ] Rodar live real full com escopo explicito.
- [ ] Registrar runtime proof sem promover catalogo.
- [ ] Registrar health observations em SQLite.
- [ ] Registrar artefatos redigidos.
- [ ] Validar sem Premium Request quando BYOK ativo.
- [ ] Validar local Ollama ausente dos defaults.

### Faixa V - Cloudflare E MCP Relacionados

- [x] Cloudflare Workers AI catalog importer.
- [x] Cloudflare account importer.
- [x] AI Gateway route metadata.
- [x] Eligibility para account/gateway missing.
- [ ] Separar UX Workers AI direto vs AI Gateway.
- [ ] Criar probes de AI Gateway fallback/cache/retry.
- [ ] Criar account access mais fino por gateway.
- [ ] Integrar logs Cloudflare sem segredos.
- [ ] Documentar relacao com MCP Cloudflare sem misturar dominios.
- [ ] Garantir que comandos MCP Cloudflare nao sejam confundidos com build do model-gateway.
- [ ] Adicionar readiness de Cloudflare dentro de provider matrix.

### Faixa W - OpenAI Schema E Apps/SDK

- [x] Projection OpenAI-compatible.
- [x] `x_model_gateway`.
- [x] Export por terminal.
- [x] Export por SQLite.
- [ ] Auditar compatibilidade com OpenAI Apps SDK naming.
- [ ] Auditar campos que devem ficar fora do objeto OpenAI.
- [ ] Auditar ids para nao quebrar clientes OpenAI-compatible.
- [ ] Criar fixtures de OpenAI schema snapshot.
- [ ] Criar teste de estabilidade do schema exportado.
- [ ] Criar documentacao de extensoes `x_model_gateway`.
- [ ] Criar migracao futura se OpenAI model schema evoluir.

### Faixa X - Performance E Escala

- [x] Refresh tem progress events.
- [x] Build tem JSONL progress log.
- [x] SQLite tem indices iniciais.
- [x] Retention operacional existe.
- [ ] Medir tempo de full build por importer.
- [ ] Medir tamanho por tabela apos build.
- [ ] Medir custo de selection effective.
- [ ] Medir custo de OpenAI export.
- [ ] Medir custo de search.
- [ ] Adicionar paginas/limits para terminal.
- [ ] Adicionar streaming de progresso para build longo no terminal.
- [ ] Adicionar concorrencia controlada por provider.
- [ ] Adicionar rate limit por importer.
- [ ] Adicionar cache HTTP seguro onde fizer sentido.

### Faixa Y - UX Do Operador Humano E LLM

- [x] Comandos canonicos existem.
- [x] Makefile aliases existem.
- [x] Terminal cockpit existe.
- [x] Live plan existe.
- [x] Live readiness existe.
- [ ] Criar sequencia oficial "antes do build".
- [ ] Criar sequencia oficial "primeiro build".
- [ ] Criar sequencia oficial "apos build".
- [ ] Criar sequencia oficial "antes de live".
- [ ] Criar sequencia oficial "apos live".
- [ ] Criar guia de decisao para importer failure.
- [ ] Criar guia de decisao para quota exhausted.
- [ ] Criar guia de decisao para local Ollama.
- [ ] Criar guia de decisao para provider key changed.
- [ ] Criar guia de decisao para route selector auto.

### Faixa Z - Release Criteria

- [ ] README aponta para este guia.
- [ ] Guia legado tem banner.
- [ ] Catalog integrity ok.
- [ ] SQLite diagnostics ok.
- [ ] JSON/SQLite parity ok.
- [ ] Selection effective strict ok.
- [ ] Live readiness ok.
- [ ] Build plan ok.
- [ ] Build preview ok.
- [ ] Primeiro build commit ok.
- [ ] Retention ok.
- [ ] Redaction audit ok.
- [ ] Runtime persistence implementado.
- [ ] Runtime health SQLite implementado.
- [ ] Probes planned gaps priorizados.
- [ ] Terminal cockpit modularizado ou plano aceito.
- [ ] Ollama local defaults bloqueados.
- [ ] SDK quota overlay decidido.
- [ ] Live no-pr pos-build ok.
- [ ] Live full pos-build ok.

## 9. Sequencias Operacionais Canonicas

### 9.1 Orientacao

Comando package:

`npm run model-gateway:commands`

Comando JSON:

`npm run model-gateway:commands:json`

Comando Makefile:

`make model-gateway-commands`

Comando terminal:

`/byok gateway commands`

### 9.2 Validacao Escopada

Lint escopado:

`npm run model-gateway:lint`

Typecheck strict:

`npm run model-gateway:typecheck`

Testes de contratos:

`npm run model-gateway:test:contracts`

Testes terminal BYOK:

`npm run model-gateway:test:terminal`

Validacao consolidada:

`npm run model-gateway:validate`

### 9.3 Antes Do Primeiro Build

Rodar command inventory.

Rodar validacao escopada.

Rodar catalog integrity.

Rodar SQLite diagnostics.

Rodar selection effective strict.

Rodar live readiness sem runtime.

Rodar build plan.

Rodar build preview.

Revisar importer failures.

Revisar account failures.

Revisar local failures.

Revisar logs.

### 9.4 Primeiro Build Do Banco

Comando package:

`npm run model-gateway:metadata:build`

Comando Makefile:

`make model-gateway-metadata-build`

Comando de build composto:

`npm run model-gateway:build`

Nota:

`npm run model-gateway:build` executa prebuild e build de metadados.

Nota:

Esse build materializa o banco de metadados.

Nota:

Esse build nao e build da aplicacao.

### 9.5 Depois Do Build

Rodar catalog integrity.

Rodar SQLite diagnostics.

Rodar selection effective strict.

Rodar live readiness.

Registrar resultado neste guia.

Investigar divergencias.

Corrigir bugs.

So entao planejar live tests.

### 9.6 Antes Dos Live Tests

Rodar live readiness.

Rodar live plan.

Rodar selection effective strict.

Confirmar zero active runtime overlays bloqueantes.

Confirmar provider/modelo explicito.

Confirmar Ollama local fora dos defaults.

Confirmar que o live real usa escopo restrito.

Confirmar que runtime proof nao sera promovido ao catalogo.

### 9.7 Live Tests

Fase 1:

`npm run terminal:llm-b:live-test -- --no-pr --timeout-ms=180000`

Fase 2:

`npm run terminal:llm-b:live-test -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000`

Fase 3:

`npm run terminal:llm-b:live-test -- --byok-real --no-pr --timeout-ms=600000`

Fase 4:

`npm run terminal:llm-b:live-test -- --byok-real --timeout-ms=900000`

Fase 4 deve ter provider/modelo explicitos quando o objetivo for teste controlado.

## 10. Decisoes Arquiteturais Registradas

### 10.1 Metadados Antes De Runtime

Coleta de metadados vem antes de qualquer runtime.

Normalizacao vem antes de qualquer runtime.

Eligibility vem antes de runtime.

Selection por metadados vem antes de runtime.

Probe planning vem antes de runtime.

Runtime so entra depois dessas fases.

### 10.2 Exclusao Antes De Runtime

Modelo sem segredo obrigatorio nao entra em runtime.

Modelo sem account overlay quando policy exige overlay nao entra em runtime.

Modelo fora de enabled list fechada nao entra em runtime.

Modelo bloqueado pela conta nao entra em runtime.

Modelo com quota/spending/rate active exhausted nao entra em runtime.

Modelo retired nao entra em runtime salvo policy explicita.

Provider bloqueado nao entra em runtime.

Route sem adapter runtime nao deve entrar em runtime.

Local provider sem opt-in nao entra em runtime.

### 10.3 Runtime Como Prova Separada

Probe positiva gera runtime proof.

Probe negativa gera runtime failure.

Turno vivo pode gerar runtime health.

Runtime proof deve ter TTL/freshness.

Runtime proof deve ter provider/model/route scope.

Runtime proof deve ter wire API.

Runtime proof deve ter account scope quando aplicavel.

Runtime proof nao altera projection canonica.

### 10.4 Account/Key Dinamico

Account access muda frequentemente.

Quota muda frequentemente.

Rate limit muda frequentemente.

Spending muda frequentemente.

Key disabled muda frequentemente.

Catalogo global muda menos frequentemente.

Provider docs mudam menos frequentemente.

Runtime health muda muito frequentemente.

Por isso as camadas devem continuar separadas.

## 11. Hipoteses A Confirmar

`AssistantUsageQuotaSnapshot` provavelmente representa quota do SDK/Copilot.

`AssistantUsageQuotaSnapshot` pode nao representar provider BYOK externo.

Se usado, deve entrar em account overlay SDK-scoped.

Se usado, nao deve substituir overlay provider-scoped.

OpenRouter auto selectors podem esconder provider upstream ate runtime.

Kilo auto selectors podem esconder provider upstream ate runtime.

Hugging Face selectors podem escolher provider upstream dinamicamente.

Cloudflare AI Gateway pode ter fallback/cache/retry que altera semantica de runtime.

Ollama local installed models podem ser catalogo local, mas daemon offline e runtime estado.

Provider account list pode mostrar modelos visiveis, mas nao quota suficiente.

Provider quota API pode existir para alguns providers e nao para outros.

Provider quota pode ser por key, organization, project, model, route ou endpoint.

## 12. Perguntas De Auditoria Permanente

Este provider tem fonte publica de catalogo?

Este provider tem fonte autenticada de catalogo?

Este provider tem fonte de docs?

Este provider tem fonte de pricing?

Este provider tem fonte de rate limit?

Este provider tem fonte de quota?

Este provider tem fonte de account visibility?

Este provider tem endpoint management?

Este provider tem runtime OpenAI-compatible?

Este provider tem runtime provider-native?

Este provider tem gateway auto selector?

Este provider tem fallback?

Este provider tem cache?

Este provider tem retry?

Este provider tem route-specific billing?

Este provider tem model-specific access?

Este provider tem organization/project/account scope?

Este provider tem local daemon?

Este provider exige opt-in?

Este provider pode vazar segredo em erro?

Este provider precisa parser dedicado?

Este provider tem OpenAPI?

Este provider tem docs HTML?

Este provider tem docs Markdown?

Este provider tem SDK proprio?

Este provider tem streaming diferente?

Este provider tem tools diferente?

Este provider tem JSON diferente?

Este provider tem vision diferente?

Este provider tem reasoning diferente?

Este provider tem quota headers?

Este provider tem retry-after?

Este provider tem reset headers?

## 13. Acceptance Criteria Do Novo Ciclo

### 13.1 Antes De Alterar Codigo

- [x] Guia legado lido integralmente.
- [x] Codigo atual auditado em largura suficiente.
- [x] Diagnosticos de leitura executados.
- [x] Novo guia criado.
- [x] README atualizado para o novo guia.
- [x] Guia legado marcado como legado.

### 13.2 Antes Do Primeiro Build

- [ ] Roadmap atualizado apos README/legacy banner.
- [ ] Lint escopado verde.
- [ ] Typecheck strict verde.
- [ ] Testes de contratos verdes.
- [ ] Testes terminal BYOK verdes.
- [ ] Catalog integrity verde.
- [ ] SQLite diagnostics verde.
- [ ] Selection effective strict verde.
- [ ] Live readiness verde.
- [ ] Build plan revisado.
- [ ] Build preview revisado.

### 13.3 Para Considerar O Banco Consolidado

- [ ] Full build commit verde.
- [ ] JSON store atualizado.
- [ ] SQLite mirror atualizado.
- [ ] Refresh log SQLite atualizado.
- [ ] Retention aplicada.
- [ ] Paridade JSON/SQLite verde.
- [ ] Selection effective strict verde pos-build.
- [ ] Live readiness verde pos-build.
- [ ] Resultado registrado neste guia.

### 13.4 Para Avancar Para Runtime Persistence

- [ ] Runtime probe run schema usado por codigo.
- [ ] Runtime probe result schema usado por codigo.
- [ ] Health observations usadas por codigo.
- [ ] Retention runtime definida.
- [ ] Explain runtime por modelo/provider.
- [ ] Selection effective consome runtime persisted quando disponivel.
- [ ] Tests de runtime persistence verdes.

### 13.5 Para Avancar Para Live Tests Exaustivos

- [ ] Runtime persistence pronto.
- [ ] Health observations pronto.
- [ ] Redaction audit verde.
- [ ] Live plan verde.
- [ ] Provider/model explicitamente escolhidos.
- [ ] Ollama local fora dos defaults confirmado.
- [ ] Quota/active overlay revisado.
- [ ] Artifact secret scan pronto.

## 14. Plano Imediato Pos-Documento

### 14.1 Primeira Onda

- [ ] Atualizar README do `model-gateway` para este guia.
- [ ] Marcar guia antigo como legado.
- [ ] Adicionar este guia aos comandos ou docs quando apropriado.
- [ ] Rodar `git diff --check`.
- [ ] Revisar links.

### 14.2 Segunda Onda

- [x] Implementar persistencia de runtime health em SQLite por mirror instalado no terminal.
- [x] Implementar persistencia de probe results em SQLite por mirror instalado no terminal.
- [x] Integrar selection effective com runtime persisted quando existir.
- [x] Criar testes focados.

### 14.3 Terceira Onda

- [ ] Fortalecer build metadata tests.
- [ ] Fortalecer refresh incremental tests.
- [ ] Fortalecer provider endpoint coverage.
- [ ] Fortalecer redaction audit.

### 14.4 Quarta Onda

- [ ] Preparar primeiro build do banco.
- [ ] Executar build plan.
- [ ] Executar build preview.
- [ ] Executar build commit.
- [ ] Auditar resultados.
- [ ] Registrar resultados.

### 14.5 Quinta Onda

- [ ] Preparar live tests.
- [ ] Rodar live readiness.
- [ ] Rodar live plan.
- [ ] Rodar fases live progressivas.
- [ ] Persistir runtime proof.
- [ ] Corrigir bugs encontrados.

## 15. Registro De Estado Atual Para Continuidade

Catalogo atual esta integro.

SQLite atual esta em schema v4.

JSON/SQLite parity esta verde segundo readiness.

Runtime persisted tables foram preenchidas por mirror explicito de health ja observado.

Health observations SQLite foi preenchida por mirror explicito em 2026-05-26.

Runtime rows SQLite atuais apos mirror:

24.

Runtime account overlays derivados existem apenas como visao volátil.

Overlays runtime observados estao expirados.

Selection effective strict esta verde.

Live readiness esta verde.

Local Ollama nao esta rodando por escolha deliberada.

Local Ollama nao deve ser selecionado por default.

Local/private supply warnings sao esperados nessa situacao.

Kilo BYOK real ja passou em live historico.

Vision 404 em Kilo foi tratada como capability negativa, nao falha global.

Tool instructions warning transversal ja foi corrigido.

O proximo trabalho deve comecar pela Faixa A pos-documento.

Depois deve seguir para runtime persistence e build readiness.

## 16. Evidencias De Validacao Do Ciclo 2026-05-26

Novo guia:

3259 linhas.

`git diff --check`:

PASS.

`node --check scripts/model-gateway-runtime-health-mirror.mjs`:

PASS.

`node --check scripts/model-gateway-live-readiness.mjs`:

PASS.

`npm run model-gateway:runtime-health:mirror`:

PASS.

`npm run model-gateway:sqlite:diagnostics` apos mirror:

PASS.

Runtime rows apos mirror:

24.

Health observations apos mirror:

17.

Runtime probe runs apos mirror:

1.

Runtime probe results apos mirror:

6.

`npm run model-gateway:live:readiness` apos mirror:

PASS.

`runtime_not_promoted`:

PASS.

`runtime_sqlite_observability`:

PASS.

Teste focado `canonical model-gateway command inventory`:

PASS.

`npm run model-gateway:lint`:

PASS.

`npm run model-gateway:typecheck`:

PASS.

## 17. Notas De Governanca

Este documento deve ser atualizado ao fim de cada onda relevante.

Este documento nao deve receber logs longos brutos.

Logs longos devem ficar em artifacts ou logs.

Este documento deve receber resumos de resultados.

Este documento deve receber decisoes arquiteturais.

Este documento deve receber links para artefatos importantes.

Este documento deve manter faixas estaveis.

Novas faixas podem ser adicionadas.

Faixas antigas nao devem ser renumeradas sem necessidade.

Checkboxes devem continuar booleanos.

Itens concluidos devem ser marcados apenas quando testados ou auditados.

Itens pendentes devem permanecer pendentes mesmo se parcialmente iniciados.

## 18. Linha De Base De Comandos

`npm run model-gateway:commands`

`npm run model-gateway:commands:json`

`npm run model-gateway:lint`

`npm run model-gateway:typecheck`

`npm run model-gateway:test:contracts`

`npm run model-gateway:test:terminal`

`npm run model-gateway:validate`

`npm run model-gateway:catalog:integrity`

`npm run model-gateway:sqlite:diagnostics`

`npm run model-gateway:selection:audit`

`npm run model-gateway:selection:effective`

`npm run model-gateway:live:readiness`

`npm run model-gateway:live:plan`

`npm run model-gateway:runtime-health:mirror`

`npm run model-gateway:metadata:build:plan`

`npm run model-gateway:metadata:build:preview`

`npm run model-gateway:metadata:build`

`npm run model-gateway:build`

`npm run terminal:llm-b:live-test`

`make model-gateway-commands`

`make model-gateway-validate`

`make model-gateway-metadata-build-plan`

`make model-gateway-metadata-build-preview`

`make model-gateway-metadata-build`

`make model-gateway-build`

`make model-gateway-live-readiness`

`make model-gateway-live-plan`

`make model-gateway-runtime-health-mirror`

## 18.2 Atualizacao Runtime Health Mirror Instalado

Data: 2026-05-27.

Objetivo:

Materializar health BYOK no SQLite durante a vida normal do terminal.

Principio arquitetural:

Runtime registra fatos.

Provider-health continua storage-neutral.

SQLite mirror observa mudancas.

Terminal instala o mirror.

Shutdown drena o mirror antes do fechamento do banco.

Arquivos alterados:

`src/copilot/model-gateway/health/provider-health.js`

`src/copilot/model-gateway/health/sqlite-health-mirror.js`

`src/copilot/model-gateway/health/index.js`

`src/copilot/model-gateway/index.js`

`src/copilot/terminal/terminal-phases/boot-listeners.js`

`src/copilot/terminal/terminal-phases/boot-shutdown.js`

`tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`

Mudanca 1:

`provider-health.js` agora expoe `subscribeByokProviderHealthChanges`.

Essa funcao permite observar:

- `call_failure`
- `call_success`
- `agent_probe_failure`
- `agent_probe_success`
- `probe_result`
- `clear`

O observer recebe evento com:

- reason
- observedAt
- key
- record

Mudanca 2:

`provider-health.js` nao importa SQLite.

Isso evita dependencia circular.

Isso preserva a fronteira do dominio.

Isso permite outros sinks futuros:

- telemetry
- SSE
- terminal UI
- dashboards
- account overlays

Mudanca 3:

`sqlite-health-mirror.js` agora expoe `installByokProviderHealthSqliteMirror`.

O installer:

- assina mudancas de health
- aplica debounce
- espelha todos os health records atuais para SQLite
- registra state operacional
- nao executa provider
- nao chama modelo
- nao altera catalogo canonico

Mudanca 4:

O terminal instala esse mirror em `runTerminalRuntimeListenersPhase`.

O mirror e opt-out por env:

`MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_DISABLED=true`

O debounce e configuravel por env:

`MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_DEBOUNCE_MS`

Em testes Vitest o mirror fica desligado por default.

Para habilitar em teste explicito:

`MODEL_GATEWAY_RUNTIME_HEALTH_SQLITE_MIRROR_ENABLED=true`

Mudanca 5:

`registerTerminalShutdownHandlers` agora aceita `flushModelGatewayRuntimeHealthMirrorFn`.

Esse handler usa prioridade `RUNTIME_STATE_DRAIN`.

Motivo:

O mirror deve drenar antes de `copilot-db.close`.

O banco fecha em prioridade `DATABASE`.

Como prioridades menores rodam primeiro, `RUNTIME_STATE_DRAIN` preserva a ordem correta.

Estado depois desta atualizacao:

Health runtime tem tres caminhos coerentes:

1. ledger JSON historico do terminal
2. mirror explicito por comando canonico
3. mirror instalado no runtime do terminal

Nenhum desses caminhos promove runtime facts ao catalogo canonico.

O catalogo continua sendo metadata database.

Runtime health continua sendo operational state.

Mudanca 6:

Selection effective agora consome runtime persisted quando disponivel.

O modo default e `merged`.

Fontes suportadas:

- `--runtime-source file`
- `--runtime-source sqlite`
- `--runtime-source merged`

`merged` deduplica por key de health e preserva o registro com observacao mais recente.

Essa integracao permanece policy-driven.

Ela nao deve transformar health runtime em prova permanente.

`SqliteModelGatewayCatalogStore` agora expoe `listRuntimeHealthRecords`.

`scripts/model-gateway-effective-selection.mjs` usa:

- ledger JSON de health
- SQLite persisted runtime health
- merge nao-mutante
- `setDbLogger` em modo JSON para manter stdout parseavel

Mudanca 7:

Merge/dedup de runtime health virou contrato do dominio.

Funcoes expostas:

- `byokProviderHealthRecordKey`
- `byokProviderHealthRecordLastObservedAt`
- `mergeByokProviderHealthRecords`

Motivo:

Readiness, selection e futuros explain/cockpit devem usar a mesma semantica.

Nao deve haver merge ad hoc por script.

`model-gateway-live-readiness.mjs` agora tambem usa health `merged`.

O readiness report mostra:

- fileHealthRecords
- sqliteHealthRecords
- healthRecords merged
- sqliteRuntimeError

Mudanca 8:

SQLite operational retention agora cobre runtime tables.

Novas politicas:

- `runtimeProbeRunMaxRows`
- `runtimeProbeResultMaxRows`
- `healthObservationMaxRows`

Tabelas cobertas:

- `copilot_model_gateway_runtime_probe_runs`
- `copilot_model_gateway_runtime_probe_results`
- `copilot_model_gateway_health_observations`

Isso evita crescimento indefinido depois que o mirror instalado passar a observar execucoes live.

Retencao continua operacional.

Retencao nao toca catalogo canonico.

Retencao nao toca metadata projections.

Retencao nao exige rebuild.

`scripts/model-gateway-sqlite-retention.mjs` agora aceita:

- `--runtime-probe-run-max-rows`
- `--runtime-probe-result-max-rows`
- `--health-observation-max-rows`

Dry-run validado:

`node scripts/model-gateway-sqlite-retention.mjs --json --runtime-probe-run-max-rows=1 --runtime-probe-result-max-rows=1 --health-observation-max-rows=1`

Resultado observado:

`applied=false`

`beforeRuntime=24`

`afterRuntime=24`

`npm --silent run model-gateway:sqlite:retention -- --json`

Resultado observado:

`healthObservationMaxRows=100000`

Proximo passo:

Conectar runtime persisted aos explain/readiness finais com policy clara para cada perfil.

Validacoes executadas:

`node --check src/copilot/model-gateway/health/provider-health.js`

`node --check src/copilot/model-gateway/health/sqlite-health-mirror.js`

`node --check src/copilot/terminal/terminal-phases/boot-listeners.js`

`node --check src/copilot/terminal/terminal-phases/boot-shutdown.js`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "runtime health SQLite mirror"`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_boot_shutdown.spec.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "runtime health SQLite mirror|shutdown"`

`npm run model-gateway:typecheck`

`npm run model-gateway:lint`

`node scripts/model-gateway-effective-selection.mjs --json --strict`

Resultado observado:

`runtimeSource=merged`

`fileHealthRecordCount=17`

`sqliteHealthRecordCount=17`

`healthRecordCount=17`

`npm --silent run model-gateway:selection:effective -- --json --strict`

Resultado observado:

`merged:17`

`node scripts/model-gateway-live-readiness.mjs --json`

Resultado observado:

`healthRecords=17`

`sqliteHealthRecords=17`

## 19. Fim Do Documento Inicial

Este arquivo e a nova referencia de continuidade.

O guia legado permanece valido como historico.

As proximas alteracoes devem seguir este roadmap.

Antes de live tests amplos, consolidar runtime persistence.

Antes do primeiro build, consolidar documentacao canonica minima e validadores.

Antes de selecionar Ollama local, exigir opt-in explicito.

Antes de promover qualquer runtime fact, garantir camada separada.

Antes de tratar quota como metadado, lembrar que quota e account/key state.

Antes de tratar provider auto selector como modelo fixo, preservar selector semantics.

Antes de editar SDK, confirmar se o problema pertence ao SDK boundary ou ao gateway.

Antes de editar terminal, confirmar se a regra pertence ao gateway ou apenas a renderizacao.

Antes de rodar runtime, confirmar que pre-runtime ja excluiu o obvio.

Antes de rodar build full, confirmar se provider-scoped refresh resolve.

Antes de apagar dados, preferir tombstone e retention.

Antes de persistir logs, redigir segredos.

Antes de finalizar uma faixa, rodar validadores proporcionais.

Antes de considerar pronto, registrar evidencias neste guia.
