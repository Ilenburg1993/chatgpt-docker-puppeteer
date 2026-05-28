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
- [x] Persistir novas health observations diretamente no fluxo de health.
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
- [x] Documentar diferenca entre quota SDK Copilot e BYOK provider externo.
- [x] Criar provider quota capability matrix.
- [x] Criar account overlay freshness policy por provider.
- [x] Criar reset window strategy por failure kind.
- [x] Criar comando terminal para explicar quota ativa vs expirada.
- [x] Criar retention separada para quota/rate/spending snapshots.
- [x] Criar teste de quota que expira e deixa de bloquear.
- [x] Criar teste de key trocada que nao contamina overlay antigo.
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
- [x] Adicionar policy presets formais.
- [x] Adicionar account-scoped route selector eligibility.
- [x] Adicionar upstream provider eligibility para gateways.
- [x] Adicionar route layer eligibility por task.
- [x] Adicionar wire API eligibility por adapter.
- [x] Adicionar unknown access explain mais acionavel.
- [x] Persistir runs de eligibility por build/refresh de modo mais claro.
- [x] Adicionar diff de eligibility entre builds.
- [x] Adicionar teste de eligibility para provider removal.

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
- [x] Persistir selection audit quando solicitado.
- [x] Criar explain diff entre metadata-only e effective.
- [x] Criar score decomposition mais estavel.
- [x] Criar policy para auto selectors.
- [x] Criar policy para gateway fallback.
- [x] Criar policy para provider direct required.
- [x] Criar policy para privacy strict.
- [x] Criar policy para no paid models.
- [x] Criar policy para max estimated cost.
- [x] Criar teste de selecao com provider upstream explicito.

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
- [x] Criar explain de health por provider/modelo.
- [x] Criar diff de health antes/depois de live tests.
- [x] Criar rota de limpar health por scope.
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
- [x] Criar policy global `excludeLocalProvidersByDefault`.
- [ ] Criar teste para todos os defaults sem Ollama local.
- [ ] Criar teste para opt-in local com daemon offline.
- [ ] Criar teste para opt-in local com fixture de daemon online.
- [x] Criar comando terminal claro para habilitar local.
- [x] Criar explain de por que local foi bloqueado.
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
- [x] Criar comando de testes live plan sem runtime.

### Faixa U - Live Tests

- [x] Fase control no-pr passou historicamente.
- [x] Fase BYOK fixture no-pr passou historicamente.
- [x] BYOK real no-pr passou historicamente.
- [x] BYOK real completo com Kilo passou historicamente.
- [x] Live readiness atual ok.
- [x] Rodar live plan apos primeira consolidacao deste guia.
- [x] Rodar live no-pr apos runtime persistence estar pronto.
- [x] Rodar live fixture apos runtime persistence estar pronto.
- [ ] Rodar live real no-pr com escopo explicito.
- [ ] Rodar live real full com escopo explicito.
- [ ] Registrar runtime proof sem promover catalogo.
- [x] Registrar health observations em SQLite.
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
- [x] Criar sequencia oficial "antes de live".
- [x] Criar sequencia oficial "apos live".
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
- [x] Runtime persistence implementado.
- [x] Runtime health SQLite implementado.
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

### 10.5 Limites Ativos Versus Expirados

Account/key limit e um overlay dinamico, nao um fato canonico do modelo.

Um bloqueio ativo pode impedir entrada no runtime antes de gastar quota.

Um bloqueio expirado deve aparecer para auditoria, mas nao deve continuar bloqueando por si so.

`quota_exhausted` e `rate_limited` sao bloqueios temporarios quando a janela ainda esta ativa.

`key_disabled` e `spending_exhausted` tendem a ser bloqueios de conta/key ate intervencao do operador.

Runtime health pode gerar overlay volatil, mas esse overlay continua sendo account/runtime scoped.

Runtime health nao reescreve catalogo canonico.

`/byok gateway limits` mostra active, expired e temporary antes de qualquer chamada de modelo.

`/byok gateway limits` combina overlays persistidos do catalogo com overlays derivados de runtime health ja observado.

`/byok gateway limits` tambem explicita `nextAction` para cada bloqueio.

`/byok gateway accounts` continua sendo a visao resumida de account/key.

`/byok gateway limits` e a visao operacional para decidir se uma rota deve nem entrar em runtime.

`AssistantUsageQuotaSnapshot` deve permanecer SDK/Copilot scoped.

`AssistantUsageQuotaSnapshot` pode bloquear ou alertar rotas nativas do SDK.

`AssistantUsageQuotaSnapshot` nao deve ser usado como verdade de quota de OpenRouter, Kilo, Groq, Gemini ou outro provider BYOK externo.

Se um dia for integrado ao gateway, deve entrar como overlay separado com `scope=copilot_sdk_entitlement`.

Essa separacao evita paralelismo falso entre quota do host e quota do provider externo.

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

- [x] Runtime probe run schema usado por codigo.
- [x] Runtime probe result schema usado por codigo.
- [x] Health observations usadas por codigo.
- [ ] Retention runtime definida.
- [ ] Explain runtime por modelo/provider.
- [ ] Selection effective consome runtime persisted quando disponivel.
- [ ] Tests de runtime persistence verdes.

### 13.5 Para Avancar Para Live Tests Exaustivos

- [x] Runtime persistence pronto.
- [x] Health observations pronto.
- [ ] Redaction audit verde.
- [x] Live plan verde.
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

Mudanca 9:

Runtime health writer deixou de ser truncate-and-replace.

Antes:

`writeRuntimeHealthRecords` apagava:

- runtime probe results
- runtime probe runs
- health observations

Depois:

`writeRuntimeHealthRecords` faz escrita historica/upsert por `runId`.

Chaves novas:

- health observation: `runId:healthKey`
- probe result: `runId:healthKey:probeKind`

Consequencias:

- rodadas live sucessivas preservam historico
- retention runtime passa a ter utilidade real
- diagnostics conseguem mostrar crescimento operacional
- leitura por modelo continua retornando fato mais recente
- leitura por modelo deduplica probe por kind

Esse ajuste e fundacional.

Sem ele, runtime persistence seria apenas um cache substituido a cada mirror.

Com ele, runtime persistence vira camada operacional auditavel.

Mudanca 10:

Runtime persistence agora usa chaves resistentes a colisao.

Antes:

- `runId:healthKey`
- `runId:healthKey:probeKind`

Problema:

Concatenacao crua pode colidir semanticamente quando `runId` e `healthKey` contem separadores.

Exemplo:

- `runId=a:b`, `healthKey=c`
- `runId=a`, `healthKey=b:c`

Depois:

- `runtime-health:<sha256(stableJson({ runId, key }))>`
- `runtime-probe:<sha256(stableJson({ runId, key, probeKind }))>`

Isso mantem IDs curtos, estaveis, redigidos e sem sobrescrita acidental.

Teste adicionado:

`collision-resistant runtime observation keys`

Esse teste preserva duas observacoes que antes poderiam virar uma unica chave bruta.

Mudanca 11:

`runId` default de runtime health agora e monotônico por processo.

Antes:

`model-gateway:runtime-health:<observedAtMs>`

Problema:

Duas escritas no mesmo milissegundo poderiam compartilhar `runId`.

Depois:

`model-gateway:runtime-health:<observedAtMs>:<pid>:<sequence>`

Isso preserva:

- runId explicito para idempotencia intencional
- runId default unico para mirrors normais
- historico confiavel em bursts de eventos

Teste adicionado:

`generates unique default runtime health run ids for same-millisecond writes`

Mudanca 12:

Runtime health status agora considera probe-only records.

Antes:

Somente `lastStatus` e `agentProbeStatus` influenciavam health observation status.

Problema:

Probes genericos como:

- streaming
- json
- vision

podiam registrar falha real sem alterar status agregado.

Nesse caso, SQLite recebia `unknown`.

Depois:

Quando nao ha status top-level conclusivo:

- o probe mais recente `ok=true` vira health `ok`
- o probe mais recente `ok=false` vira health `failed`
- `observed_at_ms` usa tambem `probe.lastAt`
- `classified_failure` pode vir de `probe.lastFailureKind`
- fallback de contexto pode vir de `probe.lastErrorContext`

Teste adicionado:

`derives runtime health status and failure context from generic probe-only records`

Mudanca 13:

Mirror instalado no runtime nao grava rodada vazia.

Antes:

`controller.flush()` sempre escrevia runtime rows quando chamado.

Problema:

Shutdown do terminal poderia gerar uma rodada historica mesmo sem mudanca BYOK pendente.

Depois:

`controller.flush()` retorna o estado atual sem escrita quando:

- mirror esta habilitado
- nao ha timer pendente
- nao ha flush em voo
- `pending=false`

O script canonico de mirror explicito continua usando `mirrorByokProviderHealthToSqlite` diretamente.

Assim:

- comando manual ainda materializa sob demanda
- mirror instalado evita historico artificial
- shutdown apenas drena trabalho real

Teste adicionado:

`does not write runtime health mirror rows when no BYOK health change is pending`

Mudanca 14:

SQLite diagnostics agora tem resumo runtime estruturado.

Novo campo:

`diagnostics.runtime`

Conteudo:

- `probeRuns`
- `probeResults`
- `healthObservations`
- `latestProbeRunCompletedAtMs`
- `latestProbeResultObservedAtMs`
- `latestHealthObservedAtMs`
- `healthStatusCounts`
- `probeStatusCounts`

Motivo:

Antes havia apenas `runtimeRows`.

Isso era insuficiente para decidir se o banco tinha:

- historico de runs
- resultados de probes
- health observations
- sinais recentes
- concentracao de falhas

`scripts/model-gateway-sqlite-diagnostics.mjs` agora imprime uma linha runtime compacta no modo humano.

Mudanca 15:

Leituras SQLite de runtime agora preservam campos relacionais normalizados.

Antes:

`readRuntimeHealthForModel` e `listRuntimeHealthRecords` retornavam somente `payload_json`.

Problema:

Campos gravados nas colunas relacionais podiam se perder na volta para as camadas superiores:

- `status`
- `classified_failure`
- `observed_at_ms`
- `expires_at_ms`

Depois:

Health records lidos do SQLite incluem:

- `runtimeHealthStatus`
- `runtimeClassifiedFailure`
- `runtimeObservedAtMs`
- `runtimeExpiresAtMs`

Probe records lidos do SQLite incluem:

- `runtimeObservedAtMs`
- `runtimeExpiresAtMs`
- provider/model/route normalizados
- kind/wireApi/status/ok normalizados

`explainModelGatewayCatalogEntry` agora respeita `runtimeHealthStatus`.

Isso impede que uma falha persistida corretamente volte a aparecer como `unknown`.

Mudanca 16:

Runtime account overlays agora entendem campos persistidos do SQLite.

`deriveModelGatewayRuntimeAccountOverlaysFromHealth` agora considera:

- `runtimeClassifiedFailure`
- `runtimeObservedAtMs`
- `runtimeHealthStatus`
- probe-only `lastAt`

Isso conecta:

SQLite runtime persistence -> runtime health records -> account/key overlays -> pre-runtime exclusion.

Sem essa ponte, uma falha probe-only persistida no SQLite poderia aparecer no explain, mas nao bloquear corretamente na selecao efetiva.

Testes adicionados/fortalecidos:

- `derives runtime health status and failure context from generic probe-only records`
- `derives runtime account overlays from persisted SQLite runtime classification fields`

Validacao:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "generic probe-only records|persisted SQLite runtime classification|volatile account overlays"`

Resultado:

`3 passed`

Mudanca 17:

SQLite store agora tem leitura latest-per-route para runtime health.

Novo metodo:

`listLatestRuntimeHealthRecords`

Semantica:

Retorna apenas o health observation mais recente por:

- provider_id
- provider_model
- route_profile

Implementacao:

Usa `ROW_NUMBER() OVER (PARTITION BY ...)`.

Motivo:

Selection effective e live readiness nao devem varrer historico bruto quando so precisam do estado runtime efetivo atual.

Historico completo continua disponivel em:

`listRuntimeHealthRecords`

Uso atualizado:

- `scripts/model-gateway-effective-selection.mjs`
- `scripts/model-gateway-live-readiness.mjs`

Isso prepara o banco para crescer sem tornar as camadas de selecao mais caras do que o necessario.

Validacoes deste ajuste:

`node --check src/copilot/model-gateway/catalog/sqlite-catalog-store.js`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "runtime health mirror runs|runtime health/probe facts|storage-neutral runtime health SQLite mirror|operational retention"`

Resultado:

`4 passed`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "collision-resistant runtime observation keys|runtime health mirror runs"`

Resultado:

`2 passed`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "generic probe-only records|same-millisecond|collision-resistant runtime observation keys"`

Resultado:

`3 passed`

`node scripts/model-gateway-sqlite-retention.mjs --json --runtime-probe-run-max-rows=10000 --runtime-probe-result-max-rows=100000 --health-observation-max-rows=100000`

Resultado observado:

`applied=false`

`beforeRuntime=24`

`afterRuntime=24`

Proximo passo:

Conectar runtime persisted aos explain/readiness finais com policy clara para cada perfil.

Mudanca 18:

SQLite runtime health agora tolera registros malformados no mirror.

Problema encontrado:

O mirror de runtime health recebe fatos operacionais de uma camada viva.

Essa camada pode evoluir, receber payloads parciais, sofrer bug transitorio, ou carregar registros antigos com formato incompleto.

Antes desta mudanca, um registro sem provider/model podia contaminar a persistencia com valores `unknown` ou interromper o flush inteiro.

Isso era ruim por tres motivos:

- dado operacional ruim nao deve derrubar o terminal;
- dado operacional ruim nao deve apagar ou impedir fatos bons do mesmo batch;
- diagnostico precisa indicar que houve descarte, sem misturar isso com falha de probe/modelo.

Nova semantica:

`writeRuntimeHealthRecords` agora separa:

- `records`: registros recebidos pela chamada;
- `writableRecords`: registros estruturados com provider e model;
- `skippedRecords`: registros nulos, nao-objeto, ou sem provider/model.

Somente `writableRecords` sao gravados em:

- `copilot_model_gateway_health_observations`
- `copilot_model_gateway_runtime_probe_results`

O run de persistencia registra `skipped_count`.

O payload JSON do run registra `skippedRecords`.

O retorno de `writeRuntimeHealthRecords` passou a incluir:

- `runId`
- `healthObservations`
- `probeResults`
- `skippedRecords`

O mirror SQLite propaga esse contador para:

- retorno de `mirrorByokProviderHealthToSqlite`
- `ByokProviderHealthSqliteMirrorState.lastSkippedRecords`
- store desabilitado do boot do terminal

Impacto arquitetural:

Runtime health passa a ter uma fronteira de saneamento explicita antes do banco relacional.

Isso fortalece a fundacao de pre-runtime porque:

- falhas reais de modelo continuam persistidas;
- falhas do transport/payload nao viram falsos bloqueios de modelo;
- runs defeituosos ficam auditaveis por `skipped_count`;
- mirror instalado no terminal nao perde batches inteiros por um item ruim.

Validacao focada:

`node --check src/copilot/model-gateway/catalog/sqlite-catalog-store.js`

`node --check src/copilot/model-gateway/health/sqlite-health-mirror.js`

`node --check src/copilot/terminal/terminal-phases/boot-listeners.js`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "malformed runtime health records|storage-neutral runtime health SQLite mirror|same-millisecond|generic probe-only records"`

Resultado:

`4 passed`

`npm run model-gateway:typecheck`

Resultado:

`ok`

Mudanca 19:

Redaction de payloads operacionais foi fortalecida antes do primeiro build/live.

Problema encontrado:

Alguns caminhos ja eram seguros por contrato porque os construtores de catalogo sanitizavam records antes da persistencia.

Mas a arquitetura nao deve depender apenas de callers disciplinados.

Havia dois pontos de defesa em profundidade a fortalecer:

- `JsonModelGatewayCatalogStore` redigia chaves sensiveis, mas strings soltas em campos nao sensiveis podiam ficar intactas se um caller pulasse os construtores;
- `SqliteModelGatewayCatalogStore` usava `payloadJson` em runtime health e route decisions, apesar de esses payloads serem operacionais e potencialmente carregarem mensagens/erros de provider.

Nova semantica:

`JsonModelGatewayCatalogStore` agora aplica `redactSecretText` a qualquer string antes de escrever/normalizar snapshot.

Payloads SQLite operacionais agora usam `operationalPayloadJson` em:

- runtime probe runs derivados de health;
- health observations derivadas de health;
- runtime probe results derivados de health;
- route decision events.

Impacto:

Mesmo que uma camada superior injete por engano:

- bearer token em mensagem de erro;
- API key em diagnostic;
- token bruto dentro de array de errors;
- segredo em campo nao chamado `token`/`secret`;

o armazenamento canonico redige antes de serializar.

Isso nao muda os campos relacionais de provider/model/route.

Tambem nao mistura runtime proof com metadados canonicos.

Efeito esperado:

Antes de rodarmos live tests ou build amplo, a base de persistencia passa a tratar segredo como um problema de borda, nao apenas como responsabilidade dos importers.

Validacao focada:

`node --check src/copilot/model-gateway/catalog/json-catalog-store.js`

`node --check src/copilot/model-gateway/catalog/sqlite-catalog-store.js`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "redacted JSON catalog snapshot|sanitized route decision events|malformed runtime health records|same-millisecond"`

Resultado:

`4 passed`

Mudanca 20:

Criado gate executavel de redaction para JSON/SQLite.

Motivo:

Antes de build/live, precisamos saber se o banco de metadados e as camadas operacionais persistidas contem qualquer segredo bruto.

So ter redaction nos writers nao basta.

Tambem precisamos de auditoria repetivel para:

- dados legados;
- payloads vindos de callers imperfeitos;
- SQLite ja materializado;
- logs/artefatos antes de live tests;
- chaves reais presentes no ambiente do operador.

Novos elementos:

- `src/copilot/model-gateway/secrets/redaction-audit.js`
- `auditModelGatewayValueRedaction`
- `collectModelGatewaySecretAuditEnvValues`
- `redactModelGatewayAuditedValue`
- `summarizeModelGatewayRedactionAudits`
- `SqliteModelGatewayCatalogStore.auditStoredPayloadRedaction`
- `SqliteModelGatewayCatalogStore.redactStoredPayloadLeaks`
- `scripts/model-gateway-redaction-audit.mjs`
- `npm run model-gateway:redaction:audit`
- `make model-gateway-redaction-audit`

Semantica:

Auditoria usa detector de alta confianca.

Ela verifica:

- valores exatos de secrets presentes no ambiente;
- bearer tokens fortes;
- JWTs;
- assignments obvios de API key/token/password;
- prefixos fortes de providers como `sk-`, `gsk_`, `hf_`, `csk-`, `nvapi-`, `cfat_`.

Ela nao deve marcar nomes legitimos de modelos como vazamento apenas por comecarem com `sk`.

Licao importante:

O primeiro detector baseado no redactor agressivo gerou falsos positivos em nomes legitimos de modelos e campos como `skipped`.

Por isso, redaction de persistencia e deteccao de auditoria foram separadas.

Persistencia pode ser mais conservadora e redigir demais.

Auditoria precisa ser mais precisa para virar gate operacional.

Reparo:

O script aceita `--repair`.

Esse modo redige somente `payload_json` de SQLite usando:

- valores exatos do ambiente;
- padroes fortes de token.

Nao busca provedores.

Nao roda modelos.

Nao altera catalogo JSON.

Nao imprime segredos crus.

Descoberta real neste turno:

SQLite local continha payloads antigos com valores exatos de env embutidos em refs/IDs de overlay/eligibility.

Executado:

`npm run model-gateway:redaction:audit -- --repair --json`

Resultado observado:

- `updatedRows=1624`
- account overlays reparados
- eligibility decisions reparadas
- snapshot payload reparado

Auditoria apos reparo:

`npm run model-gateway:redaction:audit -- --json`

Resultado:

- `ok=true`
- `leakCount=0`
- `catalog.leakCount=0`
- `sqlite.leakCount=0`
- `scannedStringCount=1929392`

Contrato futuro:

`createProviderAccountOverlay` agora redige `accountOverlayId` e `sourceId` quando eles contem token/secret bruto.

Isso evita que rebuilds futuros recriem o mesmo problema.

Validacao focada:

`node --check src/copilot/model-gateway/secrets/redaction-audit.js`

`node --check src/copilot/model-gateway/catalog/contracts.js`

`node --check src/copilot/model-gateway/catalog/sqlite-catalog-store.js`

`node --check scripts/model-gateway-redaction-audit.mjs`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "secret-safe universal catalog evidence|redaction leaks|SQLite payload surfaces|canonical model-gateway command inventory"`

Resultado:

`4 passed`

Mudanca 21:

Redaction audit foi conectado aos gates de build/readiness.

Antes:

`model-gateway:redaction:audit` existia como comando isolado.

Depois:

`scripts/model-gateway-live-readiness.mjs` agora inclui check:

`redaction_audit`

Esse check combina:

- catalog JSON redaction audit;
- SQLite payload redaction audit;
- valores exatos de secrets presentes no ambiente;
- detector de alta confianca para tokens.

O resumo `model-gateway-live-readiness` agora tem bloco:

`redaction`

Com:

- `ok`
- `envSecretCandidateCount`
- `catalog.leakCount`
- `catalog.scannedStringCount`
- `sqlite.leakCount`
- `sqlite.scannedStringCount`
- `sqlite.tableCount`

`scripts/model-gateway-metadata-build.mjs` tambem passa a calcular redaction no snapshot produzido.

Em modo commit, tambem audita o SQLite materializado.

O campo `summary.ok` do metadata build agora exige:

- integridade do catalogo;
- paridade SQLite quando commitado;
- redaction ok;
- nenhuma falha bloqueante de importer.

Validacao executada:

`node --check scripts/model-gateway-live-readiness.mjs`

`node --check scripts/model-gateway-metadata-build.mjs`

`node scripts/model-gateway-metadata-build.mjs --plan --json`

Resultado:

- `schema=model-gateway-metadata-build-plan`
- `ok=true`
- `selected=25`

`node scripts/model-gateway-live-readiness.mjs --json`

Resultado relevante:

- `redaction.ok=true`
- `redaction.catalog.leakCount=0`
- `redaction.sqlite.leakCount=0`
- `redaction.sqlite.tableCount=21`
- `redaction.sqlite.scannedStringCount=1288714`

Observacao:

Live readiness geral ainda retornou `ok=false` porque `catalog_integrity=false`.

Isso nao vem da nova redaction.

O novo check de redaction passou.

Mudanca 22:

Redaction de catalogo foi separada de redaction operacional agressiva.

Descoberta:

`model-gateway:catalog:integrity` apontou duplicatas com chaves como:

- `cloudflare-workers-ai-catalog:@[redacted]:aliases.providerModel`
- `cloudflare-workers-ai:@[redacted]:default`
- `openrouter-models:thedrummer/[redacted]:displayName`

Causa:

O redactor generico era agressivo demais para identidades de catalogo.

Ele podia interpretar nomes legitimos de modelos que comecam por `sk` como segredo.

Exemplos afetados:

- `skyfall`
- campos/ids derivados de modelos com prefixos parecidos com tokens;
- valores de catalogo que sao identidade publica, nao credencial.

Correcao:

As camadas de catalogo passaram a usar redaction de alta confianca:

- `JsonModelGatewayCatalogStore`
- `createModelMetadataEvidence`
- `createProviderMetadataEvidence`
- `createCanonicalProviderProjection`
- `createProviderAccountOverlay`
- `createCatalogImportRun`
- `createSanitizedRawPayloadRef`

Headers e chaves explicitamente sensiveis continuam redigidos.

Mas strings publicas de identidade de modelo nao devem ser redigidas por coincidencia lexical.

Contrato adicionado:

`thedrummer/skyfall-36b-v2` deve permanecer como identidade publica de modelo.

Validacao focada:

`node --check src/copilot/model-gateway/catalog/json-catalog-store.js`

`node --check src/copilot/model-gateway/catalog/contracts.js`

`node --check src/copilot/model-gateway/catalog/import-runs.js`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "secret-safe universal catalog evidence|redacted JSON catalog snapshot|redaction leaks"`

Resultado:

`3 passed`

Consequencia:

O catalogo persistido atual ainda contem identidades ja redigidas de builds anteriores.

Isso exige rebuild/refresh de metadados para reconstruir as identidades a partir das fontes.

O codigo novo evita recriar esse dano em builds futuros.

Mudanca 23:

Build real do banco de metadados passou a preservar identidade publica e barrar segredo real.

Problema encontrado apos a Mudanca 22:

Mesmo com redaction menos agressiva para nomes de modelo, a auditoria ainda podia interpretar referencias publicas como atribuicoes de segredo.

Exemplo:

`cerebras:default:CEREBRAS_API_KEY:account-overlay`

O trecho `API_KEY:account-overlay` parecia uma atribuicao para a regex antiga.

Isso gerava falso positivo de redaction.

Pior:

Se o reparo de redaction fosse aplicado de modo amplo, poderia transformar ids publicos de account overlay em `[redacted]`.

Correcao:

`src/copilot/model-gateway/secrets/redaction-audit.js` agora separa:

- tokens reais de alta confianca;
- valores exatos do ambiente;
- atribuicoes que realmente parecem credenciais;
- referencias publicas a nomes de variaveis, como `OPENAI_API_KEY`.

A heuristica de atribuicao agora exige que o valor pareca segredo real.

Assim:

- `api_key:sk-assignment-secret-that-must-not-leak` continua vazamento;
- `CEREBRAS_API_KEY:account-overlay` nao e vazamento;
- `OPENAI_API_KEY` continua referencia publica a secretRef, nao segredo.

`src/copilot/model-gateway/catalog/contracts.js` tambem passou a canonicalizar `accountOverlayId`.

O id nao aceita mais o `accountOverlayId` recebido diretamente como fonte primaria.

O formato canonico passa a ser:

`providerId:accountScope:secretRef:sourceKind`

Quando `sourceKind` e desconhecido:

`providerId:accountScope:secretRef:account-overlay`

Isso evita que um importer injete acidentalmente segredo real em identidade de overlay.

`src/copilot/model-gateway/catalog/refresh.js` tambem normaliza overlays retidos de snapshots anteriores.

Isso corrige o caso em que um catalogo antigo ja continha ids danificados.

`scripts/model-gateway-metadata-build.mjs` agora sanitiza o snapshot resultante antes de:

- escrever JSON;
- espelhar SQLite;
- rodar audit de integridade;
- rodar audit de redaction.

A sanitizacao do build usa segredos exatos do ambiente e padroes de token reais, mas nao redige referencias publicas do tipo `*_API_KEY`.

Validacao focada executada:

`node --check scripts/model-gateway-metadata-build.mjs`

`node --check src/copilot/model-gateway/secrets/redaction-audit.js`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "secret-safe universal catalog evidence|redaction leaks|public secret references|redacted JSON catalog snapshot|separates public catalog refresh"`

Resultado:

`5 passed`

Preview estrito executado:

`node scripts/model-gateway-metadata-build.mjs --preview --all --force --json`

Resultado observado:

- `ok=true`
- `integrityOk=true`
- `redactionOk=true`
- `redactedIdentityCount=0`
- `blocking=[]`
- `nonBlocking=[ollama-catalog:optional_local_source_unavailable, gemini-models:account_state_unavailable]`

Build real executado:

`node scripts/model-gateway-metadata-build.mjs --commit --all --force --json`

Resultado observado:

- `ok=true`
- `committed=true`
- `integrityOk=true`
- `redactionOk=true`
- `catalogLeaks=0`
- `sqliteLeaks=0`
- `redactedIdentityCount=0`
- `parityOk=true`
- `projections=1315`
- `overlays=14`
- `logPath=/workspaces/chatgpt-docker-puppeteer/logs/model-gateway-metadata-build/2026-05-27T11-26-48-661Z.jsonl`

Auditoria de integridade pos-build:

`npm run model-gateway:catalog:integrity`

Resultado observado:

- `ok=true`
- `evidences.rowCount=34737`
- `providerEvidences.rowCount=614`
- `routeOptions.rowCount=1846`
- `projections.rowCount=1315`
- `providerProjections.rowCount=77`
- `accountOverlays.rowCount=14`
- `redactedIdentityCount=0`
- `snapshotId=catalog:88612faae132134557e24113`

Auditoria de redaction pos-build:

`npm run model-gateway:redaction:audit -- --fail`

Resultado observado:

- `ok=true`
- `envSecretCandidateCount=17`
- `leakCount=0`
- `scannedStringCount=1937064`
- `catalog.scannedStringCount=642762`
- `sqlite.tableCount=21`
- `sqlite.scannedStringCount=1294302`

Selecao efetiva pre-runtime pos-build:

`npm run model-gateway:selection:effective`

Resultado observado:

- `ok=true`
- `runtimeExecuted=false`
- `runtimeSource=merged`
- `mode=strict_access_only_with_observed_health`
- `eligibleCount=877`
- `unknownCount=355`
- `excludedCount=700`
- `selectedProfileCount=8`
- `localProviderOptIn.hasBlocks=false`

Observacao sobre Ollama:

O importer local `ollama-catalog` permanece nao bloqueante quando o daemon local nao esta rodando.

Isso corresponde a decisao arquitetural atual:

- Ollama local e suportado;
- Ollama local nao deve ser selecionado por default;
- Ollama local so deve entrar por pedido explicito do operador.

Observacao sobre Gemini:

`gemini-models` retornou `account_state_unavailable` por key invalida/expirada.

Isso nao invalida o banco canonico.

Isso pertence a camada de account/key state.

O build deve preservar o catalogo e expor a falha ao operador sem derrubar toda a coleta de metadados.

Checklist atualizada por esta mudanca:

- [x] Preservar identidades publicas de modelos que parecem segredo por coincidencia lexical.
- [x] Preservar referencias publicas a `*_API_KEY` em `secretRef` e `accountOverlayId`.
- [x] Canonicalizar `accountOverlayId` para nao aceitar ids sensiveis vindos de importers.
- [x] Normalizar overlays retidos de snapshots antigos.
- [x] Fazer build real do banco de metadados apos preview verde.
- [x] Confirmar paridade JSON/SQLite apos build real.
- [x] Confirmar zero vazamentos em JSON e SQLite.
- [x] Confirmar zero identidades redigidas no catalogo persistido.
- [x] Confirmar selecao pre-runtime sem executar runtime.
- [x] Investigar selecao `local_private`: ela nao seleciona Ollama por default, mas ainda podia escolher remoto quando nao ha local opt-in.

Mudanca 24:

Perfil `local_private` deixou de cair silenciosamente para remoto.

Descoberta:

A selecao efetiva pos-build ainda incluia `local_private` no conjunto default.

Como o perfil antigo exigia apenas:

- `text`
- `streaming`

E tratava:

- `local`
- `privacy`
- `no_remote_secrets`

como preferencias/supply warnings, o roteador podia selecionar um modelo remoto para um perfil chamado `local_private`.

Isso era semanticamente perigoso.

Decisao arquitetural:

O default do gateway deve selecionar modelos remotos/normais sem Ollama local.

O operador pode pedir local/private explicitamente.

Mas, quando pedir, o perfil local/private deve significar local/private de verdade.

Correcao:

`src/copilot/model-gateway/routing/task-profiles.js`

`local_private` agora:

- tem `defaultAudit=false`;
- exige `local`;
- exige `privacy`;
- exige `no_remote_secrets`;
- preserva `localProviderOptIn=true`.

Assim:

- o default nao avalia `local_private`;
- `local_private` explicito nao seleciona remoto por fallback;
- `local_private` explicito falha antes de runtime se nao houver local elegivel;
- `local_private_strict` permanece como perfil/alias estrito para comandos canonicos e checks dedicados.

`src/copilot/model-gateway/routing/explain.js`

Quando aparecem:

- `missing_capability:local`
- `missing_capability:privacy`
- `missing_capability:no_remote_secrets`

o plano de acao agora inclui:

`start_or_configure_explicit_local_provider`

Validacao focada executada:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "canonical task profiles|pre-runtime selection|Ollama local candidates"`

Resultado:

`4 passed`

Selecao efetiva default pos-mudanca:

`npm --silent run model-gateway:selection:effective`

Resultado observado:

- `ok=true`
- `profileCount=7`
- `selectedProfileCount=7`
- `selectedProviders={zai:1,chutes:5,cerebras:1}`
- perfis default: `cheap_chat`, `code`, `repo_agent`, `tool_agent`, `json_extraction`, `vision`, `deep_reasoning`
- `localProviderOptIn.hasBlocks=false`

Selecao efetiva explicita local/private:

`npm --silent run model-gateway:selection:effective -- --profile local_private`

Resultado observado:

- `ok=false`
- `profileCount=1`
- `selectedProfileCount=0`
- `selected=null`
- `topRejectedReasons` inclui `missing_capability:local`
- `topRejectedReasons` inclui `missing_capability:privacy`
- `topRejectedReasons` inclui `missing_capability:no_remote_secrets`
- `nextActions` inclui `start_or_configure_explicit_local_provider`

Checklist atualizada por esta mudanca:

- [x] Remover `local_private` do conjunto default.
- [x] Impedir fallback remoto silencioso para perfil local/private.
- [x] Manter Ollama/local como suporte opt-in, nao default.
- [x] Adicionar next action explicita para configurar provider local.
- [ ] Decidir se `local_private` e `local_private_strict` devem ser fundidos no futuro ou se um deles deve permanecer como alias operacional.

Mudanca 25:

Primeira bateria live `llm-b` do model-gateway executada em fases.

Contexto:

Depois do build real do banco de metadados, da paridade SQLite, da redaction audit e da selecao pre-runtime verde, avancamos para os testes live planejados.

A ordem seguiu o plano canonico:

1. controle sem turno de modelo;
2. fixture BYOK sem provider real;
3. probes BYOK reais sem turno explicito do operador.

Fase 1:

`npm run terminal:llm-b:live-test -- --no-pr --timeout-ms=180000`

Artifact:

`artifacts/terminal-live/2026-05-27T11-35-14-936Z/summary.md`

Resultado:

- `Status=PASS`
- `Exit code=0`
- `Duration=24354ms`
- `SSE connected=yes`
- `SSE errors=0`
- `no-explicit-turn=true`
- `usage-visible=true`
- `activity-visible=true`
- `sdk-session-command-catalog-visible=true`
- `sdk-session-events-cockpit-visible=true`
- `sdk-session-waits-cockpit-visible=true`
- `metrics-visible=true`
- `sse-event-ids-monotonic=true`
- `no-terminal-errors=true`
- `clean-quit=true`

Observacao:

O terminal estava em standalone.

Mensagem observada:

`MCP tools indisponiveis - tools locais ativas. Inicie src/server para habilitar.`

Isso nao bloqueia o model-gateway.

Mas testes MCP completos exigem server/control-plane ativo.

Fase 2:

`npm run terminal:llm-b:live-test -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000`

Artifact:

`artifacts/terminal-live/2026-05-27T11-35-47-772Z/summary.md`

Resultado:

- `Status=PASS`
- `Exit code=0`
- `Duration=12366ms`
- `SSE connected=yes`
- `SSE errors=0`
- `byok-status-visible=true`
- `byok-env-visible=true`
- `byok-profiles-visible=true`
- `byok-providers-visible=true`
- `byok-health-visible=true`
- `byok-fixture-profile-visible=true`
- `byok-fixture-profile-activation=true`
- `byok-fixture-model-list=true`
- `byok-fixture-remote-discovery=true`
- `byok-fixture-model-switch=true`
- `byok-fixture-provider-switch=true`
- `byok-no-secret-leak=true`
- `no-terminal-errors=true`

Observacao:

`/byok health` exibiu erros historicos de providers reais.

Isso nao foi erro do teste fixture.

O tracker do terminal permaneceu limpo.

Fase 3:

`npm run terminal:llm-b:live-test -- --byok-real --no-pr --timeout-ms=600000`

Artifact:

`artifacts/terminal-live/2026-05-27T11-36-23-918Z/summary.md`

Resultado:

- `Status=PASS`
- `Exit code=0`
- `Duration=138611ms`
- `SSE connected=yes`
- `SSE errors=0`
- `no-explicit-turn=true`
- `byok-real-dotenv-reload=true`
- `byok-real-status-ready=true`
- `byok-real-profile-active=true`
- `byok-real-model-catalog=true`
- `byok-real-provider-cockpit=true`
- `byok-real-sdk-session-cockpit=true`
- `byok-real-binding-cockpit=true`
- `byok-real-probe-session-cleanup=true`
- `byok-real-chat-probe=true`
- `byok-real-route-decision=true`
- `byok-real-streaming-probe=true`
- `byok-real-json-probe=true`
- `byok-real-vision-probe=true`
- `byok-real-shortlist-probe=true`
- `byok-real-chat-probe-ok=true`
- `byok-real-agent-probe-ok=true`
- `byok-real-model-filtering=true`
- `byok-real-recommendation=true`
- `byok-real-model-switch=true`
- `byok-real-alt-provider-switch=true`
- `byok-real-alt-model-switch=true`
- `byok-real-no-secret-leak=true`
- `byok-real-usage-not-pr=true`
- `byok-real-usage-classified=true`
- `byok-real-operator-health=true`
- `byok-real-health-command=true`

Resultados runtime especificos observados:

- `kilo-auto/free` chat probe: `ok`, `10481ms`
- `kilo-auto/free` streaming probe: `ok`, `10899ms`
- `kilo-auto/free` json probe: `ok`, `3391ms`
- `kilo-auto/free` agent probe: `ok`, `48982ms`
- shortlist agent para `openrouter/free` via `kilo-code`: `ok`, `49128ms`
- vision probe em `kilo-auto/free`: `failed`, HTTP 404 no provider Kilo.

Interpretação:

O runtime confirmou que `vision` nao pode ser tratado como filtro obrigatorio default.

Vision deve permanecer:

- metadado coletado;
- criterio soft quando o perfil pedir;
- prova runtime propria quando o fluxo exigir imagem;
- motivo de degradacao/alternativa quando o provider falhar.

Nao deve excluir modelos bons de texto/tools por default.

O teste tambem confirmou:

- troca viva de modelo dentro do mesmo provider/perfil;
- eventos `session.model_changed`;
- preservacao de boundary quando provider/perfil preparado diverge do binding vivo;
- exercicio de profile alternativo `ollama-cloud`;
- ausencia de vazamento de 25 valores locais de segredo no output do terminal.

Mirror runtime apos live:

`npm --silent run model-gateway:runtime-health:mirror`

Resultado:

- `ok=true`
- `runtimeExecuted=false`
- `providerFetched=false`
- `catalogMutated=false`
- `healthObservations=17`
- `probeResults=6`
- `skippedRecords=0`
- `records=17`
- `sqlite.runtimeRows=168`
- `sqlite.tableCounts.healthObservations=119`
- `sqlite.tableCounts.runtimeProbeRuns=7`
- `sqlite.tableCounts.runtimeProbeResults=42`

Readiness pos-live:

`npm --silent run model-gateway:live:readiness`

Resultado:

- `ok=true`
- `catalog_integrity=true`
- `sqlite_parity=true`
- `redaction_audit=true`
- `selection_allow_probe=true`
- `selection_strict_access=true`
- `selection_effective_observed_health=true`
- `selection_supply_warnings=true`
- `runtime_not_promoted=true`
- `runtime_sqlite_observability=true`
- `live_runner_present=true`
- `redaction.catalog.leakCount=0`
- `redaction.sqlite.leakCount=0`
- `redaction.sqlite.scannedStringCount=1295797`

Selecao efetiva pos-live:

`npm --silent run model-gateway:selection:effective`

Resultado:

- `ok=true`
- `runtimeSource=merged`
- `profileCount=7`
- `selectedProfileCount=7`
- `selectedProviders={zai:1,chutes:5,cerebras:1}`
- `eligibleCount=877`
- `unknownCount=355`
- `excludedCount=700`
- `runtimeAccountOverlaySummary.activeCount=0`
- `runtimeAccountOverlaySummary.expiredCount=2`

Observacao importante:

Embora os probes reais tenham confirmado Kilo com sucesso, a selecao efetiva canonica ainda escolhe outros providers para varios perfis.

Isso e esperado nesta fase porque:

- runtime proof nao deve contaminar metadados canonicos;
- runtime health e account state ficam em camada operacional separada;
- a politica de selecao ainda usa os perfis e o catalogo amplo, nao uma promocao automatica do provider testado manualmente;
- a etapa futura de selecao pos-runtime deve decidir como combinar runtime proofs recentes com preferencias do operador.

Checklist atualizada por esta mudanca:

- [x] Executar live no-pr control-plane sem modelo.
- [x] Executar live BYOK fixture sem provider real.
- [x] Executar probes BYOK reais sem turno explicito do operador.
- [x] Confirmar chat/streaming/json/agent reais em Kilo.
- [x] Confirmar shortlist agent real em `openrouter/free` via Kilo.
- [x] Registrar falha vision como prova especifica de capability, nao falha global.
- [x] Espelhar runtime health para SQLite apos probes.
- [x] Confirmar readiness verde pos-live.
- [x] Confirmar runtime proof nao promove facts para o catalogo canonico.
- [x] Criar camada de selecao pos-runtime que combine metadados, account/key state e provas runtime recentes sem misturar as tabelas canonicas.
- [ ] Melhorar UX de vision: quando provider retorna 404 em attachment, sugerir modelos vision-capable provados ou degradar para texto explicitamente.
- [ ] Planejar fase live full-turn com modelo real apenas depois de revisar custos/quota e risco de consumo.

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

Mudanca 26:

Foi criada a primeira camada explicita de selecao pos-runtime.

Objetivo:

- manter a separacao entre catalogo canonico, account/key state e runtime proof;
- permitir que scripts e readiness comparem selecao pre-runtime e pos-runtime;
- usar runtime health ja observado sem executar providers;
- usar runtime health ja espelhado em SQLite sem depender apenas do estado em memoria;
- impedir que uma prova runtime recente seja promovida para metadata canonica.

Arquitetura adicionada:

- `readGatewayModelHealthFromRecords(model, records, options)` em `routing/health-routing.js`;
- `runtimeHealthRecords` como input explicito da policy engine;
- `auditModelGatewayPostRuntimeSelection(snapshot, options)` em `routing/selection-audit.js`;
- export no barrel `src/copilot/model-gateway/routing/index.js`;
- export no barrel principal `src/copilot/model-gateway/index.js`;
- bloco `postRuntimeSelection` em `scripts/model-gateway-effective-selection.mjs`;
- check `selection_post_runtime_observed_health` em `scripts/model-gateway-live-readiness.mjs`.

Decisao importante:

A auditoria pos-runtime nao recebe `routeProfile` automaticamente como o id do task profile.

Motivo:

- `routeProfile` nos health records vivos representa muitas vezes perfil operacional BYOK ou perfil terminal;
- task profiles como `repo_agent`, `tool_agent` e `json_extraction` sao perfis de decisao;
- misturar esses dois conceitos faria os health records reais de `kilo`, `openrouter/free` e afins deixarem de ser considerados;
- quando um caller quiser filtrar por runtime route profile especifico, pode passar `runtimeRouteProfile`.

Separacao de camadas apos esta mudanca:

- pre-runtime selection:
  - le metadados canonicos;
  - le eligibility precomputada/effective;
  - ignora runtime health para score/proof;
  - mantem `runtimeProbeProofCount=0`;
  - continua sendo a camada de exclusao/seleção antes de provas vivas.

- effective selection:
  - monta snapshot nao persistido;
  - injeta eligibility derivada de account/key state e runtime account overlays;
  - continua sem executar provider;
  - passa a renderizar tambem uma visao pos-runtime.

- post-runtime selection:
  - usa o mesmo snapshot effective;
  - recebe health records mesclados de arquivo e SQLite;
  - aplica sinais como chat ok, agent probe ok e probes por tipo;
  - nao escreve no catalogo;
  - nao muda confidence canonica;
  - nao transforma quota/account state em metadata fixa.

Resultado observado em selecao efetiva:

`npm --silent run model-gateway:selection:effective -- --json`

Resumo:

- `ok=true`
- pre-runtime:
  - `selectedProfileCount=7`
  - `healthRecordCount=0`
  - `runtimeProbeProofCount=0`
  - `selectedProviders={zai:1,chutes:5,cerebras:1}`
- pos-runtime:
  - `selectedProfileCount=7`
  - `healthRecordCount=49`
  - `runtimeProbeProofCount=0`
  - `selectedProviders={nvidia-nim:5,chutes:1,cerebras:1}`

Interpretacao:

- a camada pre-runtime permaneceu pura;
- a camada pos-runtime ja consegue alterar ranking a partir de health observado;
- os probes vivos atuais ainda nao casam como probe proof por task profile nas rotas escolhidas;
- isso e aceitavel nesta etapa, porque post-runtime ainda e leitura/auditoria, nao decisao final automatica de runtime.

Resultado observado em readiness:

`npm --silent run model-gateway:live:readiness`

Resumo:

- `ok=true`
- `selection_post_runtime_observed_health=true`
- `healthMatches=49`
- `probeProofs=0`
- `runtime_not_promoted=true`
- `sqlite_parity=true`
- `redaction_audit=true`

Testes focados executados:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "runtime health|pre-runtime selection|probe proofs"`

Resultado:

- `17 passed`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "explicit merged runtime health|pre-runtime selection"`

Resultado:

- `3 passed`

Checklist atualizada por esta mudanca:

- [x] Ler runtime health de conjuntos explicitamente mesclados.
- [x] Manter lookup global antigo para chamadas existentes.
- [x] Fazer policy engine aceitar `runtimeHealthRecords`.
- [x] Criar auditoria pos-runtime separada da pre-runtime.
- [x] Expor auditoria pos-runtime pelos barrels.
- [x] Integrar selection effective com bloco pos-runtime.
- [x] Integrar live readiness com check pos-runtime.
- [x] Provar em teste que runtime health explicito nao hidrata estado global.
- [x] Provar em teste que pre-runtime continua com proof count zero.
- [x] Provar em teste que pos-runtime conta health/probe sem mutar confidence.
- [ ] Refinar semantica de probe proof por tipo quando o runtime profile operacional e diferente do task profile.
- [ ] Criar decisao final de runtime selection com politica explicita do operador.
- [ ] Expor no terminal um explain comparando pre-runtime vs pos-runtime.

Mudanca 27:

Foi refinada a explicabilidade de provas runtime.

Problema observado:

- a selecao pos-runtime tinha `healthRecordCount>0`;
- algumas rotas recebiam `agent_probe_verified`;
- mesmo assim o resumo mostrava apenas `runtimeProbeProofCount=0`;
- isso era tecnicamente correto para probes tipados em `probes`, mas insuficiente como explicacao operacional.

Correcao:

`explainGatewayRouteDecision` agora separa:

- `runtimeChatOkCount`;
- `runtimeAgentProbeProofCount`;
- `runtimeProbeProofCount`;
- `runtimeHealthProofCount`.

Semantica:

- `runtimeChatOkCount`: candidatos com chat/call health `ok`;
- `runtimeAgentProbeProofCount`: candidatos com agent probe dedicado `ok`;
- `runtimeProbeProofCount`: candidatos com probes tipados verificados, como `json`, `streaming`, `vision` ou `agent` quando registrados em `probes`;
- `runtimeHealthProofCount`: uniao logica de chat ok, agent probe ok e probes tipados verificados.

Tambem foi ajustado o scoring de `runtime_proved`.

Antes:

- `runtime_proved` favorecia apenas `agent_probe_verified`.

Agora:

- `runtime_proved` favorece qualquer prova runtime real reconhecida por `hasRuntimeProof`;
- isso inclui chat ok, agent probe ok e probes tipados;
- capabilities especificas continuam com pesos proprios, como `preferred_probe_verified:json`.

Resultado observado:

`npm --silent run model-gateway:selection:effective -- --json`

Resumo pos-runtime:

- `ok=true`
- `healthRecordCount=49`
- `runtimeHealthProofCount=14`
- `runtimeChatOkCount=14`
- `runtimeAgentProbeProofCount=7`
- `runtimeProbeProofCount=7`
- `selectedProviders={nvidia-nim:5,chutes:1,cerebras:1}`

Interpretacao:

- ha provas runtime gerais suficientes para alterar ranking;
- o agent probe dedicado agora tambem aparece como probe tipado `agent`;
- ainda e necessario evoluir probes especificos como `json`, `streaming` e `vision` por capability.

Testes focados executados:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "pre-runtime selection|explain|runtime probe proofs|explicit merged runtime health"`

Resultado:

- `11 passed`

Checklist atualizada por esta mudanca:

- [x] Separar chat ok, agent proof, probe proof e proof total.
- [x] Atualizar `runtime_proved` para usar qualquer prova runtime real.
- [x] Atualizar readiness/effective selection para mostrar health proofs e agent proofs.
- [x] Atualizar testes de explain e post-runtime audit.
- [ ] Criar normalizador de probes tipados por capability independente do runtime profile operacional.
- [x] Registrar, quando possivel, probe kind `agent` tambem em `probes` ao lado de `agentProbeStatus`.
- [ ] Expor no terminal ranking pos-runtime com explicacao dos contadores.

Mudanca 28:

Foi normalizada a relacao entre `agentProbeStatus` e o mapa generico `probes`.

Antes:

- o campo dedicado `agentProbeStatus` registrava sucesso/falha do probe agent;
- o mapa `probes.agent` podia nao existir;
- isso fazia `runtimeAgentProbeProofCount>0`, mas `runtimeProbeProofCount=0`;
- a explicacao ficava tecnicamente possivel, mas menos coerente para uma camada universal de probes por capability.

Depois:

- `recordByokProviderModelAgentProbeSuccess` grava tambem `probes.agent`;
- `recordByokProviderModelAgentProbeFailure` grava tambem `probes.agent`;
- registros legados carregados por `mergeByokProviderHealthRecords` sao normalizados;
- registros com `agentProbeStatus` mas sem `probes.agent` passam a sintetizar `probes.agent` durante normalizacao;
- o campo dedicado continua existindo por compatibilidade e leitura rapida.

Resultado observado:

`npm --silent run model-gateway:selection:effective -- --json`

Resumo pos-runtime:

- `ok=true`
- `healthRecordCount=49`
- `runtimeHealthProofCount=14`
- `runtimeChatOkCount=14`
- `runtimeAgentProbeProofCount=7`
- `runtimeProbeProofCount=7`
- `selectedProviders={nvidia-nim:5,chutes:1,cerebras:1}`

Testes focados executados:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "agent probe health|runtime health|pre-runtime selection|merge"`

Resultado:

- `18 passed`

Checklist atualizada por esta mudanca:

- [x] Escrever `probes.agent` em agent probe success.
- [x] Escrever `probes.agent` em agent probe failure.
- [x] Normalizar health records legados durante merge.
- [x] Fazer selection effective enxergar agent probe tambem como probe tipado.
- [ ] Criar politica para pesos distintos entre chat ok, agent probe e probes de capability especifica.
- [ ] Criar explain terminal com diff pre-runtime vs pos-runtime.

Mudanca 29:

O terminal passou a exibir a auditoria pos-runtime dentro de `/byok gateway selection audit effective`.

Antes:

- o comando efetivo calculava eligibility com health observado;
- depois chamava apenas a auditoria pre-runtime sobre o snapshot effective;
- o operador via `observedHealth` e `runtimeOverlays`, mas nao via como runtime proofs afetariam ranking.

Depois:

- o comando continua mostrando a selecao effective pre-runtime;
- quando `effective` esta ativo, tambem chama `auditModelGatewayPostRuntimeSelection`;
- a saida mostra:
  - `postRuntimeProfiles`;
  - `healthMatches`;
  - `healthProofs`;
  - `agentProofs`;
  - `probeProofs`;
  - `postProviders`.

Principio mantido:

- o terminal nao executa probes nessa auditoria;
- o terminal nao persiste nova eligibility;
- o terminal nao altera o catalogo canonico;
- a visualizacao serve para comparar metadata/account state com sinais runtime ja observados.

Teste focado executado:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js -t "seleção efetiva|seleção pré-runtime"`

Resultado:

- `3 passed`

Readiness observado:

`npm --silent run model-gateway:live:readiness`

Resumo:

- `ok=true`
- `selection_post_runtime_observed_health=true`
- `healthMatches=49`
- `healthProofs=14`
- `agentProofs=7`
- `probeProofs=7`

Checklist atualizada por esta mudanca:

- [x] Integrar auditoria pos-runtime ao terminal.
- [x] Reusar o mesmo `secretRegistry` no fluxo terminal effective.
- [x] Mostrar contadores de proof no comando humano.
- [x] Cobrir chamada terminal com teste unitario.
- [x] Criar formato de tabela comparando provider selecionado pre-runtime vs pos-runtime por perfil.
- [x] Permitir flag terminal para exigir runtime proof em auditoria pos-runtime.

Mudanca 30:

Foi criado um contrato de comparacao entre selecao pre-runtime e selecao pos-runtime.

Novo helper:

- `compareModelGatewaySelectionAudits(preRuntimeSelection, postRuntimeSelection)`.

Ele retorna:

- `schema=model-gateway-selection-comparison`;
- resumo com `changedCount`, `unchangedCount`, `preSelectedCount`, `postSelectedCount`;
- `postRuntimeProofSelectedCount`;
- `postRuntimeHealthProofCount`;
- `postRuntimeProbeProofCount`;
- linhas por perfil com:
  - `preSelected`;
  - `postSelected`;
  - `preRouteKey`;
  - `postRouteKey`;
  - `changed`;
  - `postSelectedHasRuntimeProof`;
  - `postDecisionLayers`.

Principio:

- comparacao nao decide automaticamente que pos-runtime deve vencer;
- ela apenas mostra o que muda quando health proof entra na pontuacao;
- a decisao final ainda depende da policy do operador.

Integracoes:

- `scripts/model-gateway-effective-selection.mjs` inclui `selectionComparison` no JSON;
- modo texto do script mostra resumo `comparison`;
- terminal `/byok gateway selection audit effective` mostra `compare changed=...`;
- terminal mostra por perfil a rota pos-runtime e se ela tem proof;
- terminal aceita `runtime-proof`, `proof`, `proved`, `--runtime-proof` e `--require-runtime-proof`;
- comando `runtime-proof` implica `effective` e `strict`;
- comandos canonicos incluem:
  - `npm run model-gateway:selection:effective -- --require-runtime-proof`;
  - `/byok gateway selection audit runtime-proof`.

Resultado observado:

`npm --silent run model-gateway:selection:effective -- --json`

Resumo:

- `ok=true`
- `comparison.profileCount=7`
- `comparison.changedCount=5`
- `comparison.unchangedCount=2`
- `comparison.preSelectedCount=7`
- `comparison.postSelectedCount=7`
- `comparison.postRuntimeProofSelectedCount=5`
- `comparison.postRuntimeHealthProofCount=14`
- `comparison.postRuntimeProbeProofCount=7`

Resultado observado com exigencia de proof:

`npm --silent run model-gateway:selection:effective -- --require-runtime-proof`

Resumo:

- `ok=false`
- `postRuntimeSelection.selectedProfileCount=5/7`
- `comparison.changedCount=7/7`
- `comparison.postRuntimeProofSelectedCount=5/7`

Interpretacao:

- exigir proof hoje e util como auditoria/gate, nao como default;
- ainda ha perfis sem rota provada suficiente;
- isso confirma que a fase final de runtime selection precisa de policy explicita.

Testes focados executados:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "pre-runtime selection|command inventory"`

Resultado:

- `3 passed`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js -t "seleção efetiva|prova runtime|seleção pré-runtime"`

Resultado:

- `4 passed`

Checklist atualizada por esta mudanca:

- [x] Criar helper de comparacao de auditorias.
- [x] Exportar helper nos barrels.
- [x] Integrar comparison ao script effective.
- [x] Integrar comparison ao terminal effective.
- [x] Adicionar flag terminal `runtime-proof`.
- [x] Adicionar comandos canonicos para runtime proof.
- [x] Criar policy final que decide quando pos-runtime vence pre-runtime.
- [ ] Criar pesos configuraveis para runtime proof por tipo.
- [ ] Persistir, quando solicitado, um decision trace da comparacao sem mutar catalogo.

## 19. Mudanca 31 - Policy Resolver Explicito Para Selecao Final

Depois da comparacao entre pre-runtime e pos-runtime, faltava uma camada clara que respondesse uma pergunta simples:

qual rota final o operador quer considerar vencedora neste momento?

Essa pergunta nao deveria ficar implicita em flags soltas.

Tambem nao deveria mutar o catalogo canonico.

Tambem nao deveria apagar a diferenca entre:

- escolha por metadados;
- escolha por metadados com saude observada;
- escolha por prova runtime;
- bloqueio por ausencia de prova runtime.

Foi criada a funcao canonica:

`resolveModelGatewaySelectionPolicy`

Ela vive em:

`src/copilot/model-gateway/routing/selection-audit.js`

E e exportada pelos barrels:

- `src/copilot/model-gateway/routing/index.js`
- `src/copilot/model-gateway/index.js`

O enum canonico adicionado foi:

`MODEL_GATEWAY_SELECTION_POLICY_MODE`

Modos iniciais:

- `metadata_first`
- `prefer_runtime_proved`
- `require_runtime_proof`

### 19.1 Semantica Do Modo `metadata_first`

Esse e o default conservador.

Ele preserva a decisao da auditoria pre-runtime.

Ele so usa pos-runtime como fallback quando a auditoria pre-runtime nao selecionou nada e existe uma selecao pos-runtime disponivel.

Ele e o modo correto para:

- auditoria normal;
- operador que quer ver a situacao efetiva sem alterar criterios;
- preparar runtime futuro sem tornar prova runtime obrigatoria;
- evitar que dados volateis de saude substituam metadados canonicos por acidente.

### 19.2 Semantica Do Modo `prefer_runtime_proved`

Esse modo promove a rota pos-runtime quando ela tem prova runtime.

Ele preserva pre-runtime quando o pos-runtime nao tem prova.

Ele tambem pode usar pos-runtime como fallback quando nao ha pre-runtime selecionado.

Esse modo e adequado para:

- dry-run de selecao mais operacional;
- avaliar o impacto de preferir modelos ja provados;
- preparar uma futura selecao efetiva sem exigir cobertura total.

### 19.3 Semantica Do Modo `require_runtime_proof`

Esse modo seleciona apenas rotas com prova runtime.

Perfis sem prova runtime ficam bloqueados com source:

`blocked_runtime_proof_missing`

Esse modo e propositalmente rigoroso.

Ele nao deve ser default global.

Ele e adequado para:

- gates;
- auditoria antes de live test;
- validar cobertura operacional;
- descobrir lacunas antes de delegar selecao para runtime real.

### 19.4 Saida Do Resolver

O schema retornado e:

`model-gateway-selection-policy-resolution`

Campos principais:

- `ok`
- `mode`
- `summary.profileCount`
- `summary.selectedCount`
- `summary.unselectedCount`
- `summary.metadataWinnerCount`
- `summary.postRuntimeWinnerCount`
- `summary.runtimeProofSelectedCount`
- `summary.changedFromPreRuntimeCount`
- `rows[]`

Cada linha registra:

- `profileId`
- `selected`
- `source`
- `changedFromPreRuntime`
- `hasRuntimeProof`
- `preSelected`
- `postSelected`

Sources possiveis:

- `pre_runtime_metadata`
- `post_runtime_proved`
- `post_runtime_fallback`
- `blocked_runtime_proof_missing`

### 19.5 Integracao No Script Efetivo

O script:

`scripts/model-gateway-effective-selection.mjs`

Agora aceita:

`--selection-policy metadata_first|prefer_runtime_proved|require_runtime_proof`

A flag:

`--require-runtime-proof`

Continua existindo e implica:

`selectionPolicy=require_runtime_proof`

A saida JSON agora inclui:

`policyResolution`

A saida textual agora inclui uma linha:

`policy: mode=... selected=... postWinners=... changed=...`

Isso torna o script util para humanos e LLMs sem exigir que cada consumidor reimplemente a semantica.

### 19.6 Integracao No Terminal

O comando:

`/byok gateway selection audit effective`

Agora mostra:

- policy ativa;
- finalSelected;
- postWinners;
- finalChanged.

O comando:

`/byok gateway selection audit runtime-proof`

Continua sendo o atalho rigoroso.

Tambem foi adicionado parser para:

- `policy:metadata_first`
- `policy:prefer_runtime_proved`
- `policy:require_runtime_proof`
- `--selection-policy=metadata_first`
- `--selection-policy=prefer_runtime_proved`
- `--selection-policy=require_runtime_proof`

### 19.7 Contratos Cobertos

Foram adicionadas verificacoes para:

- resolver exportado;
- modo default `metadata_first`;
- modo `prefer_runtime_proved`;
- modo `require_runtime_proof`;
- bloqueio de perfil sem prova;
- terminal chamando o resolver;
- terminal usando `metadata_first` por default;
- terminal usando `require_runtime_proof` no atalho runtime-proof.

### 19.8 Limites Ainda Intencionais

A policy final ainda e nao-mutante.

Ela nao persiste decisao.

Ela nao altera catalogo.

Ela nao executa runtime.

Ela nao transforma saude volatil em metadado canonico.

Isso e correto nesta fase.

Persistencia de decision trace deve vir em camada propria, e selecao efetiva real deve continuar separada dela.

### 19.9 Checklist Da Mudanca 31

- [x] Criar enum canonico de modos de selection policy.
- [x] Criar resolver nao-mutante de policy final.
- [x] Separar source pre-runtime, pos-runtime provado, fallback e bloqueio.
- [x] Exportar helper pelos barrels.
- [x] Integrar `--selection-policy` ao script efetivo.
- [x] Integrar `policy:<modo>` ao terminal.
- [x] Integrar `runtime-proof` ao resolver rigoroso.
- [x] Cobrir contratos de model-gateway.
- [x] Cobrir contratos de terminal.
- [x] Persistir decision trace opcional.
- [ ] Adicionar pesos configuraveis por tipo de prova runtime.
- [ ] Criar policy de producao para selecao efetiva real.
- [x] Ligar policy resolver ao futuro runtime selector.

## 20. Mudanca 32 - Decision Trace Persistente Sem Mutar Catalogo

Apos a policy final, a proxima lacuna era rastreabilidade.

Precisamos saber por que uma rota foi considerada vencedora.

Tambem precisamos guardar essa decisao sem alterar:

- catalogo canonico;
- fatos de metadados;
- fatos de account/key;
- fatos runtime;
- historico de probes.

Foi criada uma camada nova e separada:

`src/copilot/model-gateway/routing/selection-trace.js`

Ela cria e persiste um envelope de auditoria nao-mutante.

### 20.1 API Canonica Adicionada

Foram adicionadas as exports:

- `DEFAULT_MODEL_GATEWAY_SELECTION_TRACE_DIR`
- `buildModelGatewaySelectionDecisionTrace`
- `persistModelGatewaySelectionDecisionTrace`

O diretorio default e:

`data/copilot/model-gateway/selection-traces`

O schema do trace e:

`model-gateway-selection-decision-trace`

O schema do resultado de persistencia e:

`model-gateway-selection-decision-trace-persistence`

### 20.2 Conteudo Do Trace

O trace guarda:

- `traceId`
- `generatedAt`
- `source`
- resumo do snapshot;
- resumo da integridade;
- resumo runtime;
- resumo da auditoria pre-runtime;
- resumo da auditoria post-runtime;
- resumo da comparacao;
- resumo da policy final;
- linhas por profile.

Cada linha inclui:

- `profileId`
- `source`
- `changedFromPreRuntime`
- `hasRuntimeProof`
- `selected`
- `preSelected`
- `postSelected`

As rotas sao resumidas.

O trace nao inclui segredos.

O trace nao inclui payloads brutos de providers.

O trace nao promove runtime para metadado canonico.

### 20.3 Persistencia Atomica

A persistencia usa escrita atomica:

- cria diretorio;
- escreve arquivo temporario;
- faz rename para o arquivo final;
- opcionalmente atualiza `latest.json` tambem por arquivo temporario e rename.

Isso reduz risco de corrupcao em interrupcao de processo.

O arquivo principal usa o `traceId` normalizado.

`latest.json` e apenas ponteiro operacional.

Nao deve ser tratado como fonte canonica historica.

### 20.4 Integracao No Script Efetivo

O script:

`scripts/model-gateway-effective-selection.mjs`

Agora aceita:

`--write-trace`

Alias:

`--persist-trace`

Tambem aceita:

- `--trace-dir <path>`
- `--trace-id <id>`

O package script canonico novo e:

`npm run model-gateway:selection:effective:trace`

O Makefile alias novo e:

`make model-gateway-effective-selection-trace`

O inventario canonico tambem registra esses comandos.

Tambem foi adicionado:

`npm run model-gateway:selection:trace-diff`

E o alias:

`make model-gateway-selection-trace-diff`

Por default, o diff compara os dois traces historicos mais recentes do diretorio.

`latest.json` e ignorado para descoberta automatica, porque ele e ponteiro operacional e pode duplicar o trace mais recente.

Tambem aceita:

- `--left <path>`
- `--right <path>`
- `--trace-dir <path>`

O schema retornado e:

`model-gateway-selection-trace-diff`

O diff mede:

- perfis adicionados;
- perfis removidos;
- perfis alterados;
- mudanca de rota selecionada;
- mudanca de source;
- mudanca de prova runtime.

Esse diff e uma base importante antes do runtime selector real.

Ele permite comparar duas policies ou duas execucoes de auditoria sem chamar provider e sem mutar catalogo.

Tambem foi adicionado:

`npm run model-gateway:selection:trace-retention`

E o alias:

`make model-gateway-selection-trace-retention`

Por default, a retencao roda em modo preview.

Para aplicar remocao pelo script base, usar:

`--trace-retention-apply`

O limite default e `100` traces historicos, sem contar `latest.json`.

O limite pode ser ajustado com:

`--trace-retention-max <n>`

### 20.5 Integracao No Terminal

O cockpit BYOK tambem passou a usar a mesma API.

O comando:

`/byok gateway selection audit effective write-trace`

Grava um trace da decisao efetiva sem mutar catalogo.

Tambem pode receber:

- `trace-id:<id>`
- `--trace-id=<id>`
- `--trace-dir=<path>`

`write-trace` implica modo efetivo, pois o trace precisa da comparacao pre-runtime/post-runtime e da policy final.

O output mostra:

- `tracePersisted`
- caminho do arquivo gravado;
- caminho de `latest`;
- erro, quando houver.

Isso deixa humanos e LLMs com um caminho unico para auditar a decisao final dentro do terminal.

### 20.6 Papel Arquitetural

Essa camada nao decide modelos sozinha.

Ela nao altera estado canonico.

Ela nao executa probes.

Ela nao abre runtime.

Ela apenas congela uma decisao para auditoria.

Essa separacao e essencial para as proximas fases:

- comparar policies;
- explicar selecao final;
- preparar runtime selector;
- depurar divergencias entre pre-runtime e post-runtime;
- alimentar live tests com contexto auditavel.

### 20.7 Checklist Da Mudanca 32

- [x] Criar builder de decision trace.
- [x] Criar persistencia atomica de trace.
- [x] Exportar helpers pelos barrels.
- [x] Integrar `--write-trace` ao script efetivo.
- [x] Integrar package script canonico.
- [x] Integrar Makefile alias canonico.
- [x] Integrar inventario canonico.
- [x] Cobrir persistencia em teste unitario.
- [x] Adicionar comando terminal para gravar trace sob demanda.
- [x] Adicionar retention policy para traces.
- [x] Adicionar diff entre traces.
- [x] Conectar traces ao runtime selector real.

## 21. Mudanca 33 - Base Nao-Executora Do Runtime Selector Real

Com policy resolver, decision trace, retention e diff prontos, a proxima base era transformar a decisao final em um plano que o runtime real possa consumir.

Foi criada a camada:

`src/copilot/model-gateway/routing/runtime-selector.js`

Essa camada ainda nao chama provider.

Ela nao executa modelo.

Ela nao roda probe.

Ela nao faz retry.

Ela apenas materializa:

- qual profile tem rota selecionada;
- qual profile esta bloqueado;
- qual rota deve ser tentada primeiro;
- se a rota tem prova runtime;
- quais reasons explicam a decisao;
- quais nextActions esperadas;
- qual evento sanitizado de route decision representa essa escolha.

### 21.1 APIs Criadas

`buildModelGatewayRuntimeSelectorPlan`

Entrada:

- policy resolution; ou
- decision trace persistido.

Saida:

`model-gateway-runtime-selector-plan`

Campos principais:

- `ok`
- `ready`
- `mode`
- `sourceSchema`
- `traceId`
- `summary.profileCount`
- `summary.selectedProfileCount`
- `summary.blockedProfileCount`
- `summary.runtimeProofSelectedCount`
- `summary.runtimeEnvReadyCount`
- `summary.runtimeEnvBlockedCount`
- `routes[]`

`selectModelGatewayRuntimeRoute`

Seleciona a rota pronta de um profile especifico.

`buildModelGatewayRuntimeSelectorProbeEnv`

Cria um ambiente BYOK isolado para a rota selecionada.

Essa funcao limpa overrides BYOK herdados do provider atual do terminal e fixa:

- `COPILOT_BYOK_ENABLED=true`;
- `COPILOT_BYOK_PROVIDER_PRESET=<providerId da rota>`;
- `COPILOT_BYOK_MODEL=<providerModel da rota>`.

Ela preserva as chaves de provider reais do ambiente, como `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `KILO_API_KEY`, etc.

Isso fecha um gap arquitetural importante: o runtime selector nao pode executar uma rota `openrouter:*` herdando `baseUrl`,
`providerPreset` ou auth generica de uma configuracao atual `groq`, `kilo` ou outra.

`evaluateModelGatewayRuntimeSelectorRouteEnv`

Avalia, sem expor segredos e sem executar provider, se o env route-aware satisfaz os requisitos do provider selecionado.

Ela retorna:

- `status`;
- `configuredKeys`;
- `missingRequiredKeys`;
- `missingRecommendedKeys`;
- `providerPreset`;
- `model`.

Quando `buildModelGatewayRuntimeSelectorPlan` recebe `requireRuntimeEnvReady=true`, rotas cujo env esta `missing` ou
`partial` sao bloqueadas antes de qualquer live test.

`executeModelGatewayRuntimeSelectorPlan`

Executa a primeira etapa real do selector usando o probe chat canonico.

Ele reutiliza:

- `runConfiguredByokChatProbe`;
- `recordByokProviderModelCallSuccess`;
- `recordByokProviderModelCallFailure`;
- `flushByokProviderHealth`.

Isso evita criar um caminho paralelo ao terminal/probes.

O executor e injetavel para testes.

Ele grava health quando ha tentativa real.

Ele registra o `decisionEvent` sanitizado no route decision ledger antes da tentativa.

Ele nao executa rotas bloqueadas.

Ele agora classifica erro lancado pela probe com `classifyByokProviderFailure`.

Ele tambem injeta esse classificador na propria `runConfiguredByokChatProbe`.

Assim, `session.error` e erro lancado seguem a mesma taxonomia.

Quando uma excecao chega sem `providerFailure` normalizado, o executor ainda grava health com:

- `failureKind`;
- `failureStatusCode`;
- `retryAfterSeconds`;
- `resetAt`;
- `errorContext`.

Isso evita perder sinais de quota, rate-limit, auth e rota invalida durante a primeira execucao real.

`executeModelGatewayRuntimeSelectorPlanWithFallbacks`

Orquestra multiplas tentativas sobre o plano.

Ele tenta:

- o profile solicitado;
- os `fallbackProfileIds` explicitos;
- os demais profiles selecionados do plano.

Ele para no primeiro sucesso.

Cada tentativa usa `executeModelGatewayRuntimeSelectorPlan`, portanto:

- reutiliza o probe chat canonico;
- grava health no mesmo store;
- preserva a semantica de bloqueio;
- retorna detalhes de cada tentativa.

O retry temporal da mesma rota existe como opcao explicita:

- `attemptsPerRoute`
- `retryDelayMs`
- `maxRetryDelayMs`

O default continua sendo uma tentativa por rota.

Isso evita loops surpresa e deixa os live tests sob controle.

`resolveModelGatewayRuntimeRetryDecision`

Resolve, sem executar provider, o que fazer depois de cada tentativa:

- sucesso: nao retry, nao fallback;
- rota bloqueada: fallback;
- `auth`: fallback e sem retry da mesma rota;
- `credits`: fallback e sem retry da mesma rota;
- `model-or-route`: fallback e sem retry da mesma rota;
- `rate-limit`: retry somente se a janela couber no orcamento `maxRetryDelayMs`;
- `timeout`, `network`, `upstream`, `unknown`: retry da mesma rota quando ainda houver tentativa disponivel.

A decisao preserva:

- `failureKind`;
- `retryAfterSeconds`;
- `resetAt`;
- `waitMs`;
- `permanent`;
- `reason`.

O executor com fallback agora usa essa decisao dinamica entre tentativas.

Com isso, quota/auth/modelo inexistente deixam de consumir retries repetidos na mesma rota, enquanto falhas transientes ainda
podem tentar novamente antes de cair para outro profile.

### 21.2 Integracao Ao Script Efetivo

`scripts/model-gateway-effective-selection.mjs`

Agora inclui:

`runtimeSelectorPlan`

A saida textual mostra:

`runtime-selector: ready=... selected=... blocked=... envReady=... envBlocked=... proofSelected=...`

Isso permite validar a ponte para runtime real sem executar runtime.

### 21.3 CLI Canonica Do Runtime Selector

Foi criada a CLI:

`scripts/model-gateway-runtime-selector.mjs`

Comandos canonicos:

- `npm run model-gateway:runtime-selector`
- `make model-gateway-runtime-selector`

Por default, ela e dry-run.

Ela nao executa provider.

Ela nao roda probe.

Ela nao consome quota.

Ela monta:

- selecao efetiva strict/allow-probe;
- selecao post-runtime com health observado;
- policy resolution;
- runtime selector plan;
- readiness de env por rota;
- sumario de overlays runtime/account;
- proximos comandos.

Execucao real exige flag explicita:

`npm run model-gateway:runtime-selector -- --execute --profile <profile>`

Esse modo ficou deliberadamente atras do plano, dos gates e dos live tests controlados.

Ele usa `executeModelGatewayRuntimeSelectorPlanWithFallbacks`.

Quando `--execute` e usado, a CLI tenta persistir os decision events das tentativas no SQLite.

Quando `--execute` e usado, a CLI tambem espelha imediatamente o health BYOK observado para SQLite.

O dry-run continua sem persistir route decisions.

O dry-run continua sem persistir runtime health.

Ele respeita:

- `--attempts-per-route`;
- `--retry-delay-ms`;
- `--max-retry-delay-ms`;
- `--timeout-ms`;
- `--fallback-profiles`.

O script bloqueia execucao quando o plano nao esta pronto.

Assim, a entrada futura para runtime real existe, mas continua segura ate decidirmos iniciar live tests.

### 21.4 Snapshot E Diff De Runtime Health

Foi criada a CLI:

`scripts/model-gateway-runtime-health-diff.mjs`

Comandos canonicos:

- `npm run model-gateway:runtime-health:diff`
- `make model-gateway-runtime-health-diff`

Ela le health ja observado em:

- ledger JSON de BYOK provider health;
- mirror SQLite de runtime health.

Ela nao executa provider.

Ela nao roda probe.

Ela nao consome quota.

Ela pode gravar snapshot:

`npm run model-gateway:runtime-health:diff -- --write-snapshot`

Ela pode comparar com baseline:

`npm run model-gateway:runtime-health:diff -- --baseline artifacts/model-gateway-runtime-health/latest.json`

Ela reporta:

- registros adicionados;
- registros removidos;
- campos alterados;
- regressoes `ok -> failed`;
- status por provider;
- status por failure kind.

Isso prepara a disciplina de live tests:

1. gravar snapshot antes;
2. executar fase controlada;
3. gravar snapshot depois;
4. comparar baseline;
5. entender exatamente quais providers/modelos mudaram.

### 21.5 Relacao Com Traces

O runtime selector aceita tanto a policy resolution quanto o decision trace.

Isso e importante porque, durante testes live, poderemos:

- gerar trace;
- comparar trace;
- reproduzir plano de runtime a partir do trace;
- auditar o evento de decisao;
- so entao executar provider.

### 21.6 Limites Intencionais

Ainda faltam:

- rotina operacional completa de baseline antes/depois dos live tests;
- live tests llm-b.

Esses pontos pertencem a proxima camada.

### 21.7 Checklist Da Mudanca 33

- [x] Criar contrato nao-executor do runtime selector.
- [x] Aceitar policy resolution como entrada.
- [x] Aceitar decision trace como entrada.
- [x] Materializar rotas por profile.
- [x] Bloquear profile sem rota final.
- [x] Respeitar exigencia de runtime proof.
- [x] Produzir route decision event sanitizado.
- [x] Integrar plano ao script effective.
- [x] Cobrir contratos unitarios.
- [x] Criar executor runtime real inicial.
- [x] Persistir resultado runtime no health store.
- [x] Criar fallback multi-rota.
- [x] Criar retry temporal explicito por rota.
- [x] Executar probe com env BYOK isolado por rota selecionada.
- [x] Avaliar readiness de env por rota sem executar provider.
- [x] Bloquear plano live quando env route-aware nao esta pronto.
- [x] Classificar excecao da probe e gravar health no mesmo fluxo.
- [x] Injetar classificador na probe para normalizar `session.error`.
- [x] Registrar decision event sanitizado no ledger durante execucao runtime.
- [x] Criar decisao dinamica de retry/fallback por failure kind.
- [x] Conectar rate-limit/retry-after/resetAt ao retry budget.
- [x] Criar CLI canonica dry-run para o runtime selector.
- [x] Exigir `--execute` para chamadas reais do runtime selector.
- [x] Preparar persistencia SQLite de route decisions quando `--execute` for usado.
- [x] Preparar persistencia SQLite imediata de runtime health quando `--execute` for usado.
- [x] Integrar package script, Makefile e inventario canonico.
- [x] Criar snapshot/diff canonico de runtime health.
- [x] Detectar regressoes `ok -> failed` em runtime health.
- [ ] Criar live tests llm-b baseados no plano.

### 21.8 Gate De Live Readiness

O script:

`scripts/model-gateway-live-readiness.mjs`

Agora calcula tambem um `runtimeSelectorPlan`.

Foi adicionado o check:

`runtime_selector_plan_ready`

Esse check exige:

- plano `ready=true`;
- zero profiles bloqueados;
- contagem de rotas selecionadas coerente com os profiles.

O script:

`scripts/model-gateway-live-plan.mjs`

Agora inclui esse check como pre-requisito antes de qualquer fase llm-b.

Resultado observado sem runtime:

- readiness `ok=true`;
- `runtime_selector_plan_ready=true`;
- `7/7 routes selected`;
- `blocked=0`;
- `envReady=7`;
- `envBlocked=0`;
- `proofSelected=0`;
- proximo comando ainda e o controle seguro `--no-pr`.

Isso confirma que ainda nao devemos saltar direto para BYOK real/full turn.

A ordem correta agora e:

1. runtime selector dry-run;
2. snapshot baseline de runtime health;
3. controle terminal sem PR;
4. fixture BYOK;
5. BYOK real sem PR;
6. BYOK real full turn.

A ordem pos-live agora e:

1. diff de runtime health contra baseline;
2. mirror SQLite de runtime health;
3. runtime selector dry-run com health observado;
4. live readiness novamente.

O `model-gateway:live:plan` materializa `phases` e `postPhases`.

Nenhuma dessas fases pos-live executa provider.

## 21.34 Mudanca 34 - Account Limits Explicaveis Antes Do Runtime

Foi criada uma camada pura para explicar limites account/key.

Arquivo:

`src/copilot/model-gateway/account-access/summary.js`

Novo helper:

`explainModelGatewayAccountLimitOverlays()`

Ele recebe overlays de catalogo/account e overlays derivados de runtime health.

Ele nao chama provider.

Ele nao altera catalogo canonico.

Ele classifica:

- `activeBlocker`;
- `expiredSignal`;
- `temporaryBlocker`;
- `sourceLayer`;
- `limitStatus`;
- `nextAction`.

O objetivo e permitir exclusao pre-runtime antes de gastar quota real.

O terminal ganhou:

`/byok gateway limits [filtro] [n]`

Essa visao mostra:

- bloqueios ativos;
- sinais expirados;
- bloqueios temporarios;
- origem account/catalog/runtime;
- reset/retry/expires;
- acao recomendada.

Tambem foi adicionada ao inventario canonico:

`/byok gateway limits`

Essa mudanca consolida a regra:

quota e rate limit de provider externo sao account/key state.

`AssistantUsageQuotaSnapshot` e quota SDK/Copilot host-scoped.

Essas duas coisas nao podem ser misturadas como se fossem a mesma fonte.

Validadores focados adicionados:

- contrato puro de limite ativo/expirado;
- terminal `/byok gateway limits`.

## 21.35 Mudanca 35 - Elegibilidade Precomputada Account-Scoped

Foi corrigido um risco de contaminacao entre contas/scopes.

Arquivo:

`src/copilot/model-gateway/routing/policy-engine.js`

Antes, a selecao reaproveitava decisoes de elegibilidade precomputadas por:

- provider;
- model;
- route;
- selector.

Isso era insuficiente para um sistema BYOK universal.

Uma decisao de `accountScope=default` nao pode excluir uma rota de `accountScope=org-alpha`.

Uma decisao de uma policy/task tambem nao deve ser reaplicada cegamente quando a selecao pediu outro scope.

Agora `findEligibilityDecisionForModel()` tambem valida:

- `accountScope`;
- `policyProfile` quando explicitado;
- `taskProfile` quando disponivel.

Decisoes legadas sem policy/task explicita continuam aproveitaveis quando o scope bate.

`policyProfile=default` e `taskProfile=default` funcionam como decisoes gerais.

Foi adicionado teste para garantir que uma decisao excluida de um scope nao bloqueia outro scope elegivel.

Essa correcao fortalece a camada pre-runtime antes do runtime selector real.

Ela tambem reduz risco ao trocar key, account, organization ou profile sem rebuild global.

## 21.36 Mudanca 36 - Matriz De Quota Por Provider

Foi criada uma matriz canonica leve de capacidade quota/account por provider.

Arquivo:

`src/copilot/model-gateway/account-access/provider-quota-capabilities.js`

Novos helpers:

`listModelGatewayProviderQuotaCapabilities()`

`summarizeModelGatewayProviderQuotaCapabilities()`

A matriz descreve o que pode ser conhecido antes do runtime.

Ela separa:

- account visibility;
- quota snapshot;
- spending limit;
- rate limit;
- runtime failure overlay;
- env keys necessarias;
- endpoints relevantes.

A matriz tambem registra explicitamente:

`sdkQuotaAppliesToByok=false`

para todos os providers externos atuais.

Isso documenta a decisao arquitetural:

quota SDK/Copilot nao e verdade BYOK provider externa.

O terminal ganhou:

`/byok gateway quota-matrix [filtro] [n]`

Esse comando nao chama provider.

Esse comando ajuda o operador e a LLM a entender quando uma exclusao pre-runtime pode ser objetiva e quando so runtime failure pode produzir overlay.

O inventario canonico de comandos tambem foi atualizado.

## 21.37 Mudanca 37 - Trace De Selecao Com Scope De Conta

Foi reforcada a auditabilidade do caminho ate o runtime selector.

Arquivos:

`src/copilot/model-gateway/routing/selection-audit.js`

`src/copilot/model-gateway/routing/selection-trace.js`

`src/copilot/model-gateway/routing/runtime-selector.js`

O resumo da rota selecionada agora carrega:

- `accountScope`;
- `policyProfile`;
- `taskProfile`.

O trace persistido tambem preserva esses campos.

O runtime selector preserva esses campos quando transforma o trace/policy em rota executavel.

Isso nao muda a selecao.

Isso muda a auditabilidade.

Agora, ao trocar key, account, organization, workspace ou policy, o operador consegue ver qual scope gerou a decisao.

Essa informacao sera importante antes dos live tests com llm-b.

## 21.38 Mudanca 38 - Redaction De Secrets Provider Com Hifen

A suite completa de contratos encontrou um vazamento de fixture em snapshot JSON.

O problema nao era a arquitetura de store.

O problema era a regex de redaction do model-gateway.

Ela cobria variantes como `gsk_`, mas nao cobria `gsk-`.

Arquivos corrigidos:

`src/copilot/model-gateway/secrets/redaction-audit.js`

`src/copilot/model-gateway/catalog/contracts.js`

`src/copilot/model-gateway/catalog/json-catalog-store.js`

As regexes agora reconhecem variantes `-` e `_` para familias relevantes.

O caso `token gsk-secret-that-must-not-leak rejected` volta a persistir como:

`token [redacted] rejected`

Esse ajuste e importante antes de build e live tests porque runtime failures podem carregar mensagens de provider com formato de token nao uniforme.

## 21.39 Mudanca 39 - Freshness De Account Overlays

Foi criada uma politica explicita de freshness para account/key overlays.

Arquivo:

`src/copilot/model-gateway/account-access/freshness.js`

Novos helpers:

`resolveModelGatewayAccountOverlayFreshnessPolicy()`

`evaluateModelGatewayAccountOverlayFreshness()`

`summarizeModelGatewayAccountOverlayFreshness()`

A politica e provider/source scoped.

Exemplos iniciais:

- OpenRouter account/key: 900s;
- Kilo account/gateway: 900s;
- Cloudflare account/gateway: 900s;
- Ollama local daemon: 300s;
- runtime health overlay: 3600s;
- public api: 86400s.

O resolver de account access agora usa freshness mesmo quando `expiresAt` nao esta presente.

Isso fecha o bug conceitual:

overlay sem `expiresAt` nao pode ficar fresco para sempre.

Quando `requireFreshAccountOverlay=true`, overlays expirados por TTL bloqueiam pre-runtime.

O terminal passou a mostrar `freshness=` em:

- `/byok gateway accounts`;
- `/byok gateway limits`.

Essa mudanca nao altera catalogo canonico.

Ela altera apenas a leitura account/key scoped antes do runtime.

## 21.40 Mudanca 40 - Reset Window Strategy Para Account/Key

Foi criada uma camada formal para separar:

- janela conhecida de reset;
- retry-after;
- refresh recomendado;
- retencao de evidencia;
- bloqueio duravel que depende de acao do operador.

Arquivo:

`src/copilot/model-gateway/account-access/reset-windows.js`

Novos helpers:

`resolveModelGatewayAccountResetWindow()`

`summarizeModelGatewayAccountResetWindows()`

A normalizacao de limites agora retorna `resetWindow`.

Isso evita confundir `resetAt` com:

- quota diaria/mensal que ja resetou;
- rate-limit com retry-after;
- spending exhausted sem reset conhecido;
- key disabled/auth que nao deve auto-desbloquear;
- runtime overlay que deve expirar ou ser atualizado sem tocar no catalogo canonico.

Campos novos aparecem em summaries e terminal:

- `resetWindowClass`;
- `resetWindowSource`;
- `nextRefreshAfter`;
- `retentionExpiresAt`;
- `autoUnblocksAt`;
- `blocksUntilRefresh`.

`/byok gateway limits` agora mostra `resetWindow=` e `refresh=`.

Essa camada prepara o selector runtime para distinguir:

- candidatos bloqueados temporariamente ate uma janela conhecida;
- candidatos que precisam de refresh de account overlay;
- candidatos bloqueados ate troca de key/plano/limite;
- candidatos que podem voltar ao pool sem probe runtime imediata quando a janela expira.

## 21.41 Mudanca 41 - Retention Separada Para Quota, Rate-Limit E Spending

A retention operacional SQLite deixou de tratar toda historia account/key como um unico limite.

Agora existem knobs separados:

- `accountQuotaSnapshotMaxRows`;
- `accountRateLimitSnapshotMaxRows`;
- `accountSpendingSnapshotMaxRows`.

O antigo `accountHistoryMaxRowsPerTable` continua funcionando como fallback legado quando informado.

Defaults canonicos:

- quota snapshots: 20000;
- rate-limit snapshots: 50000;
- spending snapshots: 20000.

Scripts atualizados:

- `scripts/model-gateway-sqlite-retention.mjs`;
- `scripts/model-gateway-metadata-build.mjs`.

Flags novas:

- `--account-quota-max-rows=<n>`;
- `--account-rate-limit-max-rows=<n>`;
- `--account-spending-max-rows=<n>`.

Isso e importante porque rate-limit pode gerar muitas amostras curtas, enquanto spending/quota tendem a mudar em outra cadencia.

Tambem preserva o caminho para:

- trocar key sem rebuild full;
- manter historico suficiente para explicar bloqueios;
- podar sinais volateis sem apagar catalogo canonico;
- aplicar retention em SQLite sem tocar JSON canonical.

## 21.42 Mudanca 42 - Eligibility Account-Scoped Por Selector De Rota

O resolver de account access deixou de comparar apenas `providerModel`.

Agora ele recebe `providerModelAliases` e produz `modelIdentifiers`.

No fluxo de eligibility, `selectorSyntax` entra como alias do modelo.

Isso permite que account overlays expressem:

- modelo base visivel;
- selector de gateway visivel;
- selector de gateway bloqueado;
- politica upstream especifica sem chamada runtime.

Exemplo:

`providerModel = openai/gpt-oss-120b`

`selectorSyntax = openai/gpt-oss-120b:fastest`

Se o overlay habilita apenas `openai/gpt-oss-120b:fastest`, a rota agora fica visivel.

Se o overlay bloqueia `openai/gpt-oss-120b:fastest`, a rota fica excluida mesmo que o modelo base esteja habilitado.

Isso prepara:

- selectors automaticos de gateway;
- politicas fastest/cheapest/preferred;
- account access por rota;
- runtime selector sem perder o id que o SDK deve receber.

## 21.43 Mudanca 43 - Presets Formais De Eligibility Policy

Foi criada uma camada canonica de presets para eligibility pre-runtime.

Arquivo:

`src/copilot/model-gateway/eligibility/policy-presets.js`

Presets iniciais:

- `default`;
- `permissive_probe`;
- `strict_account`;
- `fresh_account`;
- `metadata_only`;
- `free_or_known_cost`.

Helpers:

- `resolveModelGatewayEligibilityPolicy()`;
- `getModelGatewayEligibilityPolicyPreset()`;
- `listModelGatewayEligibilityPolicyPresets()`.

O evaluator agora resolve `policyPreset` antes de aplicar overrides do caller.

Isto significa:

- selectors e terminal podem usar nomes estaveis;
- overrides continuam possiveis;
- runtime selector nao precisa conhecer combinacoes internas de flags;
- politicas como fresh account, strict account e free/known-cost deixam de ser ad hoc.

## 21.44 Mudanca 44 - Eligibility Para Upstream, Route Layer E Wire API

O evaluator pre-runtime agora entende tres dimensoes de rota antes do ranking:

- upstream provider;
- route layer;
- wire API.

Novas hard exclusions:

- `upstream_provider_not_allowed`;
- `upstream_provider_blocked`;
- `route_layer_not_allowed`;
- `route_layer_blocked`;
- `wire_api_not_allowed`;
- `wire_api_blocked`.

Novos campos aceitos em policy:

- `allowUpstreamProviders`;
- `blockUpstreamProviders`;
- `allowRouteLayers`;
- `blockRouteLayers`;
- `allowWireApis`;
- `blockWireApis`.

`policyInputs.routeContext` registra:

- `routeLayer`;
- `wireApi`;
- `upstreamProvider`.

Isso evita que uma rota de gateway entre no ranking quando a politica do operador ou tarefa ja exclui o upstream ou a API de fio.

Tambem alinha eligibility com o que o scorer de selecao ja fazia de modo mais tardio.

## 21.45 Mudanca 45 - Unknown Access Explain Acionavel

O explain de account access agora retorna `actionable`.

Campos novos:

- `category`;
- `dataNeeded`;
- `probeSafe`;
- `operatorHint`.

O objetivo e separar:

- bloqueio por hard gate;
- falta de overlay;
- falta de visibilidade;
- probe baixo custo permitido;
- acao humana ou automatica recomendada.

`account_model_not_visible` agora aponta explicitamente para `model_visibility`.

`account_visibility_unknown` sem hard gate agora aponta para probe baixo custo seguro.

O explain de eligibility tambem retorna `actionable`.

Isto permite que terminal, OpenAI projection e observabilidade usem a mesma leitura.

O terminal `/byok gateway eligibility` agora mostra:

- `hint`;
- `data`;
- `probeSafe`.

As gates de upstream provider, route layer e wire API agora possuem next actions especificas.

Exemplos:

- `choose_allowed_upstream_provider_or_relax_policy`;
- `choose_allowed_route_layer_or_relax_policy`;
- `choose_allowed_wire_api_or_relax_policy`.

Isto reduz ambiguidade antes do runtime selector real.

Tambem impede que `unknown` seja tratado como erro generico.

## 21.46 Proxima Frente Imediata

A proxima frente de alto retorno e persistir e comparar eligibility por build/refresh.

O objetivo e saber:

- qual politica gerou a decision;
- qual selector escopou a decision;
- qual account scope estava ativo;
- quais modelos mudaram de eligible para excluded;
- quais modelos mudaram de unknown para eligible;
- quais mudancas vieram de overlay;
- quais mudancas vieram de metadado;
- quais mudancas vieram de policy.

Esta frente deve permanecer pre-runtime.

Ela nao deve chamar provider.

Ela deve preparar o runtime selector real sem misturar camadas.

## 21.47 Mudanca 47 - Diff Semantico De Eligibility

Foi criado diff especifico para decisions de eligibility.

Modulo:

`src/copilot/model-gateway/eligibility/diff.js`

Funcoes:

- `diffModelGatewayEligibilityDecisions()`;
- `summarizeModelGatewayEligibilityDiff()`.

O diff usa a chave escopada de eligibility:

- provider;
- provider model;
- route profile;
- selector kind;
- selector syntax;
- account scope;
- policy profile;
- task profile.

Isto evita misturar decisions de contas, politicas ou routes diferentes.

O diff ignora mudancas puramente operacionais:

- `observedAt`;
- `expiresAt`;
- `redactionStatus`;
- `schemaVersion`.

O diff classifica mudancas semanticas:

- `disposition_changed`;
- `access_gate_changed`;
- `policy_scope_changed`;
- `route_scope_changed`;
- `account_overlay_changed`;
- `metadata_evidence_changed`;
- `runtime_probe_requirement_changed`;
- `secret_binding_changed`;
- `other_changed`.

O summary tambem informa:

- added;
- removed;
- changed;
- became eligible;
- became excluded.

`refreshModelGatewayCatalog()` agora inclui:

- `eligibilityRefresh.diff`;
- `eligibilityRefresh.diffSummary`.

O evento de progresso `eligibility_evaluated` agora inclui:

- `eligibilityAddedCount`;
- `eligibilityRemovedCount`;
- `eligibilityChangedCount`.

O terminal de refresh agora imprime o diff de eligibility.

Isto fecha uma lacuna importante antes do runtime selector real.

Agora e possivel auditar se uma mudanca pre-runtime veio de:

- account overlay;
- policy;
- route;
- metadado;
- secret binding;
- runtime probe requirement.

Esta camada continua sem executar providers.

Ela prepara a selecao efetiva sem contaminar o catalogo canonico.

## 21.48 Mudanca 48 - Eligibility Runs Com Diff Persistido E Terminal

O run de eligibility agora pode carregar:

- `diff`;
- `diffSummary`.

`createModelEligibilityRun()` sanitiza esses campos.

`refreshModelGatewayCatalog()` agora persiste o run enriquecido no snapshot.

O payload JSON do SQLite tambem recebe esses campos via caminho existente.

Nao houve alteracao destrutiva de schema SQL.

O terminal recebeu novas leituras sem rede:

- `/byok gateway eligibility runs`;
- `/byok gateway eligibility diff`.

`eligibility runs` mostra:

- run id;
- policy profile;
- task profile;
- account scope;
- contadores de modelos;
- diff do run quando presente.

`eligibility diff` mostra:

- added;
- removed;
- changed;
- became eligible;
- became excluded;
- changed kinds;
- amostras de added/removed/changed.

Essa mudanca torna claro qual foi o ultimo estado pre-runtime persistido.

Tambem ajuda o operador e a LLM a decidir se uma nova selecao precisa de:

- refresh de metadados;
- refresh de overlays;
- ajuste de policy;
- probes runtime posteriores.

Esta frente continua pre-runtime.

Ela nao executa inference.

Ela nao muda catalogo canonico.

Ela aumenta a auditabilidade antes do primeiro runtime selector real.

## 21.49 Mudanca 49 - Pruning De Eligibility Para Provider Removal

Foi corrigida a aplicacao da camada derivada de eligibility ao snapshot.

Antes, decisions antigas podiam sobreviver quando um provider/model sumia do catalogo.

Isso era perigoso porque:

- o catalogo canonico ja nao teria mais o modelo;
- a eligibility antiga ainda poderia aparecer em buscas;
- selection pre-runtime poderia interpretar decision stale;
- terminal poderia sugerir estado que nao existe mais.

`applyModelGatewayEligibilityToSnapshot()` agora calcula as chaves atuais de catalogo.

As chaves consideram:

- provider;
- provider model;
- route profile.

As chaves atuais sao derivadas de:

- `projections`;
- `routeOptions`.

Antes de fazer upsert das novas decisions, a funcao remove decisions antigas cujo modelo/rota nao existe mais.

O historico permanece em `modelEligibilityRuns`.

O estado corrente fica em `modelEligibilityDecisions`.

Isto preserva a separacao:

- runs sao historico operacional;
- decisions sao camada derivada corrente.

Foi adicionado teste explicito de provider/model removal.

Esse comportamento e essencial para refresh incremental seguro.

Tambem evita corrupcao logica quando providers forem removidos, renomeados ou deixarem de listar modelos.

## 21.50 Mudanca 50 - Selection Audit Persistido Com Status Correto

O terminal ja possuia caminho de persistencia para decision trace.

O problema era a UX declarar `persisted=nao` mesmo quando `write-trace` gravava artefato.

`/byok gateway selection audit effective write-trace` agora informa `persisted=sim` quando a gravacao ocorre.

Em falha de persistencia, informa `persisted=falha`.

A linha detalhada de trace continua exibindo:

- `tracePersisted`;
- caminho do arquivo;
- caminho do latest;
- erro quando existir.

Isto fecha a lacuna operacional de saber se a auditoria de selecao foi realmente materializada.

O artefato continua sendo selection decision trace.

Ele contem:

- snapshot;
- integrity;
- selecao pre-runtime;
- selecao efetiva observada;
- comparison;
- policy resolution;
- plano do selector.

O comando continua sem executar provider.

Ele apenas usa health observado ja existente.

Essa persistencia sera a base para diffs de selection audit e para o runtime selector real.

## 21.51 Mudanca 51 - Explain Do Diff Metadata-Only Vs Effective

Foi criado explain estruturado para comparison de selecao.

Funcao:

`explainModelGatewaySelectionComparison()`

Entrada:

`compareModelGatewaySelectionAudits()`

Saida:

- schema proprio;
- summary;
- reason counts;
- next actions;
- rows por profile.

Razoes iniciais:

- `both_unselected`;
- `post_runtime_discovered_route`;
- `post_runtime_fallback_route`;
- `post_runtime_lost_route`;
- `post_runtime_proved_better_route`;
- `post_runtime_changed_route`;
- `same_route_runtime_proved`;
- `same_route_no_runtime_proof`.

O objetivo nao e escolher vencedor.

O objetivo e explicar por que a selecao efetiva difere da metadata-only.

O terminal `/byok gateway selection audit effective` agora imprime:

- contagem de reasons;
- next actions;
- reason por profile.

Isso prepara o runtime selector real com diagnostico melhor.

Tambem evita que toda troca seja apenas `changed=true`.

Agora a camada consegue distinguir:

- rota melhor provada em runtime;
- fallback sem prova;
- perda de rota por health;
- mesma rota com prova;
- mesma rota sem prova.

Essa leitura sera usada para policy de auto selectors, gateway fallback e runtime proof.

## 21.52 Mudanca 52 - Score Breakdown Estavel

O scorer agora retorna `scoreBreakdown`.

Campos:

- `baseScore`;
- `finalScore`;
- `delta`;
- `hardGateCount`;
- `positiveSignals`;
- `negativeSignals`;
- `groups`;
- `rejectedGroups`.

O objetivo e explicar ranking sem alterar ranking.

O score final continua o mesmo.

O breakdown e derivado das reasons e rejected reasons existentes.

Grupos iniciais:

- capability;
- context;
- confidence;
- cost;
- data policy;
- eligibility;
- preference;
- route policy;
- runtime health;
- runtime probe;
- outros prefixos estaveis.

`selectedSummary()` agora preserva `scoreBreakdown` quando disponivel.

Isso melhora:

- selection audit;
- decision trace;
- terminal;
- futuro runtime selector real.

Tambem reduz dependencia de interpretar strings soltas no momento de explicar uma selecao.

Ainda ha espaco para uma decomposicao com deltas exatos por componente.

Mas a camada atual ja estabiliza categorias e sinais sem reescrever a politica.

## 21.53 Mudanca 53 - Policies Para Selectors, Auto Routes E Direct Provider

O scorer ganhou novas policies pre-runtime.

Novas options:

- `allowSelectorKinds`;
- `allowAutoSelectors`;
- `allowGatewayFallbacks`;
- `requireProviderDirect`.

`allowSelectorKinds` funciona como allow-list explicita de selector kind.

`allowAutoSelectors=false` bloqueia selectors automaticos.

Exemplos de auto selector:

- `auto`;
- `fastest`;
- `cheapest`;
- `best`;
- `router`;
- `policy`.

`allowGatewayFallbacks=false` bloqueia fallback de gateway.

`requireProviderDirect=true` exige `routeLayer=direct_provider`.

Novas rejected reasons:

- `selector_kind_not_allowed:<kind>`;
- `auto_selector_blocked:<kind>`;
- `gateway_fallback_blocked:<kind>`;
- `provider_direct_required:<routeLayer>`.

Isso fecha tres lacunas antes do runtime selector real.

Agora o operador pode separar explicitamente:

- rotas diretas;
- rotas por gateway;
- rotas automaticas;
- fallback de gateway.

Essas policies continuam sem executar provider.

Elas operam sobre metadados normalizados e route options.

## 21.54 Mudanca 54 - Policies De Privacidade E Custo

O scorer ganhou policies explicitas de privacidade e custo.

Novas options:

- `privacyStrict`;
- `noPaidModels`;
- `maxEstimatedCostPerMillion`.

`privacyStrict=true` exige pelo menos uma das condicoes:

- capability `privacy=true`;
- data policy com nao treinamento e nao retencao de prompts.

Campos aceitos para nao treinamento:

- `training=false`;
- `trainsOnPrompts=false`.

Campos aceitos para nao retencao:

- `retainsPrompts=false`;
- `retention=false`.

`noPaidModels=true` bloqueia modelos com custo conhecido maior que zero.

Se custo estiver desconhecido, tambem bloqueia com:

`price_unknown_for_no_paid_models`

`maxEstimatedCostPerMillion` e alias de policy para `maxPricePerMillion`.

Novas rejected reasons:

- `privacy_strict_not_satisfied`;
- `paid_model_blocked:<price>`;
- `price_unknown_for_no_paid_models`;
- `price_above_limit:<price>><limit>`.

Novo positive signal:

- `privacy_strict_satisfied`.

Estas policies seguem a separacao de camadas:

- usam metadados;
- nao executam provider;
- nao dependem de runtime proof.

Elas ajudam perfis sensiveis a custo e privacidade antes de qualquer probe.

## 21.55 Mudanca 55 - Teste De Upstream Provider Explicito Na Selecao

Foi adicionado teste de selecao com upstream provider explicito.

O teste usa rotas de gateway com:

- `providerSpecific.upstreamProvider=anthropic`;
- `providerSpecific.upstreamProvider=openai`.

Cobre:

- `allowUpstreamProviders`;
- `preferredUpstreamProviders`;
- `blockUpstreamProviders`.

O resultado esperado:

- upstream preferido vence quando permitido;
- upstream bloqueado sai do ranking;
- rota alternativa permitida continua selecionavel.

Isto fecha a ultima lacuna imediata da Faixa J.

O comportamento continua pre-runtime.

Nenhum provider e chamado.

O teste protege gateways como Kilo, OpenRouter, HuggingFace Router e Cloudflare AI Gateway.

## 21.56 Mudanca 56 - Policy Global Para Excluir Local Por Default

Foi adicionada option:

`excludeLocalProvidersByDefault`

Default:

`true`

Isto preserva o comportamento atual:

- Ollama/local suportado;
- Ollama/local nao selecionado por default;
- local selecionado apenas por opt-in explicito.

Quando `excludeLocalProvidersByDefault=false`, o caller assume conscientemente a responsabilidade de permitir local sem o bloqueio global.

O bloqueio por default continua emitindo:

`local_provider_requires_explicit_request`

O teste existente de Ollama/local agora cobre:

- default remoto vence;
- `allowProviders: ['ollama']` permite local;
- profile `local_private` permite local;
- `excludeLocalProvidersByDefault=false` permite local.

Isto torna a policy global explicita sem mudar defaults.

## 21.57 Mudanca 57 - Terminal Local/Ollama Sem Runtime

Foi adicionado comando:

`/byok gateway local`

Aliases:

- `local`;
- `ollama`;
- `local-private`.

O comando mostra:

- default excluido;
- daemon nao iniciado;
- runtime nao executado;
- opt-in obrigatorio;
- reason de bloqueio;
- policy global;
- comandos de opt-in.

Reason exibida:

`local_provider_requires_explicit_request`

Policy exibida:

`excludeLocalProvidersByDefault:true`

O comando nao altera env.

O comando nao inicia Ollama.

O comando nao faz probe.

Ele apenas orienta o operador humano e LLM.

Isto reduz ambiguidade operacional antes dos live tests.

## 21.58 Mudanca 58 - Identidade Operacional Completa No Runtime Selector

Foi corrigido um gap de base no caminho:

`selection audit -> selection trace -> runtime selector plan -> runtime probe env`

Antes, o runtime selector reduzia a rota selecionada a:

- `providerId`;
- `providerModel`.

Isso era insuficiente para rotas universais.

O problema afetava especialmente:

- gateways;
- agregadores;
- selectors automaticos;
- rotas Cloudflare;
- rotas OpenAI-compatible com `wireApi` explicito;
- rotas com `selectorSyntax` diferente de `providerModel`;
- providers novos com endpoint oficial no catalogo.

Agora a rota selecionada preserva:

- `selectorSyntax`;
- `routeCandidateId`;
- `canonicalModelId`;
- `routeOptionRef`;
- `routeOptionRefs`;
- `routeLayer`;
- `wireApi`;
- `runtimeKind`;
- `upstreamProvider`;
- `baseUrl`;
- `openAICompatibleBaseUrl`;
- `endpoint`;
- `aiSdkPackage`;
- `autoSelection`;
- `supportsFallback`;
- `localPrivate`.

O trace persistido tambem preserva esses campos.

O plano runtime passa a carregar a mesma identidade operacional.

O env de probe runtime agora:

- remove overrides BYOK antigos;
- mantem secrets provider-scoped;
- define `COPILOT_BYOK_PROVIDER_PRESET` a partir da rota;
- define `COPILOT_BYOK_MODEL` com `providerModel`, nao com `selectorSyntax`;
- projeta `COPILOT_BYOK_BASE_URL` quando a rota trouxer `openAICompatibleBaseUrl` ou `baseUrl`;
- converte `openai_chat_completions` para `COPILOT_BYOK_WIRE_API=completions`;
- converte `openai_responses` para `COPILOT_BYOK_WIRE_API=responses`;
- nao injeta valores de `wireApi` que o SDK ainda nao entende.

Isso fecha uma fronteira importante:

- `selectorSyntax` identifica a rota no catalogo/SDK/listagem;
- `providerModel` continua sendo o id enviado ao provider quando a chamada runtime e feita;
- `wireApi` fica preservado como metadado canonico;
- apenas wire APIs compativeis com o SDK atual viram env runtime.

Tambem foi adicionado preset SDK para:

`opencode`

Com:

- base oficial `https://opencode.ai/zen/v1`;
- secret `OPENCODE_API_KEY`;
- modelo default `gpt-5.1-codex`;
- catalogo estatico minimo para fallback.

Isso alinha importer, secrets, endpoint inventory e runtime BYOK.

Validacoes adicionadas:

- selection audit preserva selector/wire/upstream;
- trace preserva selector/wire/upstream;
- runtime plan preserva selector/wire/upstream;
- runtime probe env nao herda provider/baseUrl/wireApi antigos;
- runtime probe env usa `providerModel`, nao `selectorSyntax`;
- preset SDK `opencode` fica pronto com `OPENCODE_API_KEY`.

## 21.59 Mudanca 59 - Readiness Pre-Live Carrega Env E Corrige Falso Positivo HF

Durante o dry-run real do runtime selector foi identificado que:

- o catalogo estava `ok=false`;
- nenhuma rota strict era selecionada;
- o live test ainda nao estava pronto.

O erro de integridade tinha causa especifica.

A regex de segredo tratava `hf-inference` como se fosse token HuggingFace.

Isso redigia uma `selectorSyntax` legitima:

`katanemo/Arch-Router-1.5B:hf-inference`

Resultado anterior:

- `selectorSyntax` virava `...:[redacted]`;
- a auditoria de integridade marcava identidade redigida;
- o runtime selector dry-run ficava bloqueado antes de qualquer live.

Correcoes aplicadas:

- token HuggingFace agora exige formato `hf_` longo;
- `hf-inference` permanece como provider/upstream publico;
- redaction de `json-catalog-store`;
- redaction de `catalog/contracts`;
- redaction audit;
- teste de integridade com `hf-inference`.

Tambem foi criado bootstrap comum:

`scripts/model-gateway-env.mjs`

Ele carrega:

- `.env.local`;
- `.env`.

Com `override=false`.

Scripts atualizados:

- `model-gateway-effective-selection.mjs`;
- `model-gateway-runtime-selector.mjs`;
- `model-gateway-live-readiness.mjs`;
- `model-gateway-selection-audit.mjs`.

Isso alinha os comandos canônicos ao comportamento do terminal:

- terminal ja carrega `.env.local`;
- comandos de build/refresh ja carregavam `.env.local`;
- agora readiness/selection/runtime-selector tambem carregam.

Estado observado apos a correcao:

- integridade do catalogo voltou a `ok=true`;
- redacted identity count voltou a `0`;
- runtime selector ainda nao esta pronto para live porque overlays strict de conta estao expirados;
- portanto a proxima etapa nao e llm-b;
- a proxima etapa e refresh/build de metadados/account overlays antes de runtime.

Isso reforca a regra:

live test so depois de readiness strict com rotas selecionadas.

Mudanca 60:

Consolidacao final da ponte pre-runtime -> runtime selector antes dos testes live.

Problema identificado:

- o build real de metadados podia terminar com importer de conta falhando sem deixar isso visivel no resumo humano;
- o importer `gemini-models` registrou falha nao bloqueante por chave expirada;
- o runtime selector carregava status de conta `expired` em algumas rotas sem mostrar `canAttempt`;
- o plano live precisava deixar claro que nenhuma rota selecionada estava bloqueada por conta/key.

Correcoes aplicadas:

- `selection-audit` agora preserva `accountAccess.canAttempt`;
- `selection-audit` agora preserva `secretConfigured`, `modelVisible`, `hardReasons` e `softReasons`;
- `selection-trace` preserva os mesmos campos;
- `runtime-selector` bloqueia qualquer rota selecionada cujo `accountAccess.canAttempt === false`;
- `runtime-selector` inclui `accountAccessBlockedCount`;
- `live-readiness` mostra `accessBlocked=0` no gate do runtime selector;
- `model-gateway:metadata:build` imprime falhas de importer no resumo humano, mesmo quando nao bloqueiam o build.

Estado observado depois do build remoto sem Ollama local:

- catalog integrity: `ok=true`;
- SQLite parity: `ok=true`;
- redaction audit: `ok=true`;
- runtime selector readiness: `7/7`;
- env ready: `7/7`;
- access blocked: `0`;
- runtime proofs promovidos antes do live: `0`;
- overlays ativos: `0`;
- overlays expirados: `2`;
- live plan: `ok=true`.

Falha de importer observada:

- `gemini-models`;
- causa: `API key expired`;
- classificacao: falha de conta/key, nao de metadado publico;
- efeito: nao bloqueia o build quando ha fontes publicas/doc suficientes e a selecao default nao depende de Gemini;
- acao futura: trocar ou renovar `GEMINI_API_KEY`, depois rodar refresh seletivo do provider.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "audits pre-runtime selection"`

Resultado:

`1 passed`

Validacoes proporcionais apos a consolidacao:

`npm run model-gateway:test:contracts`

Resultado:

`193 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

`npm run model-gateway:lint`

Resultado:

`passed`

Comandos pre-live executados sem runtime:

`npm run model-gateway:runtime-selector -- --fail --allow-env-missing --json`

`npm run model-gateway:live:readiness -- --json`

`npm run model-gateway:live:plan -- --no-write --json`

Resultado:

- runtime selector: `ok=true`;
- readiness: `ok=true`;
- live plan: `ok=true`.

Proxima etapa:

- rodar baseline de runtime health;
- rodar controle `llm-b` sem PR;
- rodar fixture BYOK sem provider real;
- apenas depois rodar probes BYOK reais;
- apos cada fase real, diffar health, espelhar SQLite e recomputar selector/readiness.

Mudanca 61:

Execucao dos primeiros live tests completos com `llm-b` e melhoria do diff de runtime health.

Sequencia executada:

- baseline de runtime health sem chamadas a provider;
- controle terminal sem PR;
- fixture BYOK sem provider real;
- probes BYOK reais sem PR;
- turno BYOK real completo com tools, streaming, `ask_user`, troca de modelo e troca de provider alternativo.

Comandos executados:

`npm run model-gateway:runtime-health:diff -- --write-snapshot`

`npm run terminal:llm-b:live-test -- --no-pr --timeout-ms=180000`

`npm run terminal:llm-b:live-test -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000`

`npm run terminal:llm-b:live-test -- --byok-real --no-pr --timeout-ms=600000`

`npm run terminal:llm-b:live-test -- --byok-real --timeout-ms=900000`

Artefatos principais:

`artifacts/terminal-live/2026-05-28T00-59-32-668Z/summary.md`

`artifacts/terminal-live/2026-05-28T01-00-19-895Z/summary.md`

`artifacts/terminal-live/2026-05-28T01-01-23-674Z/summary.md`

`artifacts/terminal-live/2026-05-28T01-04-07-536Z/summary.md`

Resultado observado:

- controle terminal: `PASS`;
- fixture BYOK: `PASS`;
- BYOK real sem PR: `PASS`;
- BYOK real com turno completo: `PASS`;
- SSE conectado e monotônico;
- `ask_user` renderizado por uma unica fonte;
- tools dinamicas exercitadas;
- export Markdown gerado;
- segredos locais nao vazaram no output;
- telemetria BYOK nao foi renderizada como Premium Request;
- `kilo-auto/free` executou chat, streaming, JSON, agent probe e turno real;
- `kilo-auto/free` registrou falha de vision probe, e o terminal passou a refletir `no-vision` via cache/health;
- `moonshotai/kimi-k2.6:free` teve sucesso em uma fase e depois `agent probe empty` em shortlist posterior;
- apos o `empty`, `/byok recommend ... safe` nao promoveu `moonshotai/kimi-k2.6:free`, porque `safe` exige `agentProbeStatus=ok`.

Estado pos-live:

- runtime selector: `ok=true`;
- runtime selector readiness: `7/7`;
- access blocked: `0`;
- env ready: `7/7`;
- readiness: `ok=true`;
- SQLite parity: `ok=true`;
- redaction audit: `ok=true`;
- runtime health mirror: `ok=true`;
- health observations espelhadas: `18`;
- probe results espelhados: `17`;
- SQLite runtime rows: `842`.

Lacuna identificada no pos-live:

O diff de runtime health tratava o `moonshotai/kimi-k2.6:free` como registro adicionado e falho, mas nao possuia contador proprio para:

- falha nova;
- rota que passou de desconhecida para falha;
- rota recuperada.

Isso confundia a leitura operacional.

Nao e correto transformar toda falha nova em regressao fatal, pois live tests tambem descobrem candidatos ruins.

Mas tambem nao e correto esconder essa informacao dentro de `added`.

Correcoes aplicadas:

- criado modulo canonico `src/copilot/model-gateway/health/runtime-health-diff.js`;
- o script `model-gateway:runtime-health:diff` passou a usar o modulo do gateway, nao logica privada solta;
- o diff agora expõe `newFailures`;
- o diff agora expõe `becameFailed`;
- o diff agora expõe `recovered`;
- o resumo humano imprime esses contadores;
- a chave comparavel agora cai para identidade `routeProfile|providerId|providerModel` quando o registro ainda nao tem chave persistida;
- o barrel `health/index.js` exporta os helpers;
- o barrel principal `model-gateway/index.js` exporta os helpers;
- contrato unitario cobre regressao, falha nova e recuperacao.

Evidencia apos a correcao:

`model-gateway:runtime-health:diff` contra o baseline pre-live reportou:

- `added=1`;
- `changed=10`;
- `regressions=0`;
- `newFailures=1`;
- `becameFailed=0`;
- `recovered=0`.

O `newFailures=1` corresponde a:

`kilo|kilo-code|moonshotai/kimi-k2.6:free`

Interpretacao:

- nao houve regressao de rota antes saudavel;
- houve descoberta de candidato que falhou no agent probe;
- a camada `safe` ja remove esse candidato de recomendacao operacional;
- o proximo ciclo pode investigar se `empty` deve gerar backoff temporal mais forte, sem contaminar metadados canonicos.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_provider_health.spec.js`

Resultado:

`6 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

Mudanca 62:

Backoff pre-runtime para falhas recentes de probe que nao sao quota/auth.

Problema identificado apos os lives:

- `moonshotai/kimi-k2.6:free` produziu `agent probe empty`;
- o diff pos-live agora mostra isso como `newFailures=1`;
- a camada `safe` ja deixa de recomendar o modelo;
- porem o `probe backoff planner` so adiava rate-limit de conta ou runtime;
- uma recomendacao de probe poderia tentar novamente imediatamente o mesmo `agent empty`;
- isso aumenta ruido, custo e chance de interpretar instabilidade como capacidade real.

Principio arquitetural:

- falha recente de probe nao e metadado canonico;
- falha recente de probe nao e necessariamente quota;
- falha recente de probe nao deve bloquear o catalogo para sempre;
- falha recente de probe deve criar uma janela volatil de reteste.

Correcoes aplicadas:

- `planModelGatewayProbeBackoff` passa a ler `health.probes[kind]`;
- falha recente de probe gera `runtime_probe_failed_recent`;
- o motivo inclui `probeKind`;
- cooldown padrao: `900s`;
- o cooldown pode ser sobrescrito por `probeFailureCooldownSeconds`;
- se o probe tiver `lastRetryAfterSeconds` ou `lastResetAt`, esses valores prevalecem;
- falha de `agentProbeStatus=failed` tambem alimenta o cooldown de `agent`;
- o terminal `/byok gateway probes backoff` mostra `probe=<kind>` nos itens adiados.

Separacao de responsabilidades:

- account overlays continuam representando quota/auth/rate-limit de conta/key;
- runtime health continua representando fatos observados;
- backoff planner apenas decide quando nao insistir em probes recentes;
- selecao segura continua exigindo evidencia positiva de `agentProbeStatus=ok`;
- catalogo canonico nao e modificado por falha transient de probe.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "defers recommended probes"`

Resultado:

`1 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

Mudanca 63:

Outcome sanitizado do runtime selector no ledger de decisoes.

Problema identificado:

- o runtime selector registrava a decisao antes da tentativa;
- o ledger sabia qual rota seria tentada;
- o ledger nao registrava, no mesmo contrato de route decision, o resultado sanitizado da tentativa runtime;
- isso deixava sucesso, falha de provider e fallback dependentes de health/probe em vez de tambem existirem como decisao operacional auditavel.

Correcoes aplicadas:

- `executeModelGatewayRuntimeSelectorPlan` agora registra a decisao pre-runtime como antes;
- apos a tentativa, registra tambem um evento de outcome;
- outcome bem-sucedido registra `runtime_outcome:ok`;
- outcome falho por probe registra `runtime_probe_failed:<status>`;
- outcome falho por excecao/provider registra `runtime_provider_failure:<kind>`;
- eventos de outcome usam `source=<source-original>:runtime-result`;
- eventos de outcome usam `mode=<mode-original>:runtime_result`;
- nao armazenam prompt;
- nao armazenam headers;
- nao armazenam payload de provider;
- nao armazenam segredo;
- a execucao retorna `routeDecisionRecordedCount`;
- falha de observador continua nao quebrando runtime.

Exemplo observado em teste:

- pre-decision: `source=unit-test-runtime-selector`, `failure=null`;
- runtime outcome ok: `source=unit-test-runtime-selector:runtime-result`, `failure=null`;
- runtime outcome rate-limit: `failure=runtime_provider_failure:rate-limit`.

Valor arquitetural:

- route ledger passa a responder "o que escolhemos" e "o que aconteceu";
- runtime health continua sendo a fonte de fatos de saude;
- route decision ledger continua sendo a trilha de decisoes sanitizadas;
- fallback pode ser auditado por sequencia de outcomes sem ler provider payload.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "audits pre-runtime selection"`

Resultado:

`1 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

Mudanca 64:

Agregacao de outcome auditavel em execucao com fallbacks.

Problema identificado:

- cada tentativa individual do runtime selector agora registra pre-decision e outcome;
- o executor com fallback retornava `attempts` e `retryDecisions`;
- mas nao retornava o total agregado de eventos de route decision gravados;
- isso exigiria somar manualmente cada tentativa para saber se a trilha de auditoria foi emitida.

Correcoes aplicadas:

- `executeModelGatewayRuntimeSelectorPlanWithFallbacks` retorna `routeDecisionRecordedCount`;
- sucesso com fallback soma todos os eventos gravados nas tentativas anteriores e na tentativa vencedora;
- falha final tambem soma os eventos gravados;
- comentario do modulo foi atualizado para refletir a arquitetura atual:
  - planning continua nao-executante;
  - helpers de execucao sao pontes runtime explicitas;
  - outcomes sanitizados nao contaminam metadados canonicos.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "audits pre-runtime selection"`

Resultado:

`1 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

Mudanca 65:

IDs de route decision sem colisao para pre-decision e outcome runtime.

Problema identificado:

- `copilot_model_gateway_route_decisions` usa `decision_id` como chave primaria;
- o `decisionId` anterior usava timestamp, task profile e model id;
- apos a Mudanca 63, uma mesma rota pode gerar pre-decision e runtime outcome em sequencia;
- se ambos cairem no mesmo milissegundo, o SQLite poderia sobrescrever o primeiro evento pelo segundo.

Correcoes aplicadas:

- `buildRouteDecisionEvent` agora inclui uma sequencia monotônica em processo;
- o id tambem inclui `source`;
- o id tambem inclui `mode`;
- o id tambem inclui `failure` ou `ok`;
- eventos de pre-decision e outcome no mesmo milissegundo passam a ter ids distintos;
- a mudanca preserva redacao/sanitizacao;
- a mudanca evita colisao sem depender de payload ou segredo.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "route decision"`

Resultado:

`4 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

Mudanca 66:

Baseline fixo por execucao no plano de live tests.

Problema identificado:

- o plano live gerava a fase `runtime_health_baseline` com `model-gateway:runtime-health:diff -- --write-snapshot`;
- a fase pos-live sugeria `--baseline artifacts/model-gateway-runtime-health/latest.json`;
- depois de uma primeira diff pos-live, `latest.json` pode deixar de representar o baseline pre-live;
- em sequencias longas, isso cria comparacoes contra a fase anterior, nao contra o inicio do plano.

Correcoes aplicadas:

- `model-gateway:live:plan` agora cria `runId`;
- baseline fica em `artifacts/model-gateway-runtime-health-baselines/<runId>/latest.json`;
- snapshots pos-live ficam em `artifacts/model-gateway-runtime-health-post-live/<runId>`;
- todas as pos-fases usam o baseline fixo do run;
- Markdown do plano mostra `runId`, `healthBaseline` e `postLiveHealthDir`;
- a fase baseline explica que o arquivo e fixo para todas as fases posteriores.

Validacao focada:

`npm run model-gateway:live:plan -- --no-write --json`

Resultado observado:

- `ok=true`;
- baseline command usa `--out-dir artifacts/model-gateway-runtime-health-baselines/<runId>`;
- post-live command usa `--baseline artifacts/model-gateway-runtime-health-baselines/<runId>/latest.json`;
- post-live command nao usa `artifacts/model-gateway-runtime-health/latest.json`.

`npm run model-gateway:typecheck`

Resultado:

`passed`

Mudanca 67:

Persistencia SQLite dos outcomes do runtime selector no comando canonico.

Problema identificado:

- o executor runtime passou a gerar dois eventos por tentativa: pre-decision e outcome;
- o script `model-gateway:runtime-selector -- --execute` ainda coletava apenas `attempt.route.decisionEvent`;
- isso persistiria no SQLite apenas a decisao pre-runtime;
- os outcomes sanitizados ficariam no retorno da execucao, mas nao na camada operacional SQLite.

Correcoes aplicadas:

- o comando `model-gateway-runtime-selector.mjs` agora injeta `recordRouteDecision`;
- todos os eventos emitidos pelo executor sao capturados em `runtimeRouteDecisionEvents`;
- a persistencia SQLite usa esse stream completo;
- pre-decision e runtime outcome passam a ser persistidos juntos;
- o output humano mostra `routeDecisionEvents=<n>`;
- o tipo de `executeModelGatewayRuntimeSelectorPlanWithFallbacks` passou a declarar `recordRouteDecision` em `deps`.

Separacao preservada:

- o comando continua dry-run por default;
- provider calls continuam exigindo `--execute`;
- payloads de provider continuam fora do ledger;
- segredos continuam redigidos por `operationalPayloadJson`.

Validacoes focadas:

`npm run model-gateway:runtime-selector -- --fail --json`

Resultado:

- `ok=true`;
- `runtimeExecuted=false`;
- `routeDecisionPersistence.attempted=false`.

`npm run model-gateway:typecheck`

Resultado:

`passed`

Mudanca 68:

Captura testavel de route decisions do runtime selector.

Problema identificado:

- o comando canonico `model-gateway:runtime-selector -- --execute` tinha logica propria para capturar e deduplicar eventos;
- isso deixava a persistencia SQLite do outcome menos reutilizavel;
- tambem dificultava testar o caminho sem chamar provider real.

Correcoes aplicadas:

- criada a primitiva `createModelGatewayRouteDecisionCapture`;
- criado `dedupeModelGatewayRouteDecisionEvents`;
- o capturador preserva o formato de `recordModelGatewayRouteDecision`;
- o capturador retorna listas clonadas para evitar mutacao acidental;
- a deduplicacao mantem a ordem de primeira ocorrencia e usa o payload mais recente por `decisionId`;
- o script `model-gateway-runtime-selector.mjs` passou a usar essa primitiva;
- os exports seguem o modelo de barrels em `observability/index.js` e `model-gateway/index.js`.

Separacao preservada:

- captura em memoria continua separada da escrita SQLite;
- escrita SQLite continua ocorrendo em lote apos a execucao;
- payloads de provider e segredos continuam fora dos eventos;
- provider calls continuam exigindo `--execute`.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "captures and deduplicates route decision streams"`

Resultado:

`1 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

`npm run model-gateway:lint`

Resultado:

`passed`

`npm run model-gateway:test:contracts`

Resultado:

`195 passed`

`npm run model-gateway:runtime-selector -- --fail --json`

Resultado:

- `ok=true`;
- `runtimeExecuted=false`;
- `routeDecisionPersistence.attempted=false`.

Mudanca 69:

Fallback profiles entram no planejamento da CLI antes da execucao.

Problema identificado:

- o executor aceita `--fallback-profiles`;
- o comando canonico filtrava o planejamento inicial apenas por `--profile` e `--profiles`;
- quando o operador passava `--execute --profile repo_agent --fallback-profiles tool_agent`, a rota `tool_agent` podia ser removida antes de chegar ao executor;
- isso tornava a fallback chain declarada na CLI ilusoria em cenarios filtrados.

Correcoes aplicadas:

- `readProfiles()` agora inclui `--fallback-profiles`;
- perfis sao normalizados, aparados e deduplicados antes da auditoria de selecao;
- o executor continua recebendo `fallbackProfileIds` separadamente para preservar a ordem de tentativa;
- o dry-run passa a mostrar todos os perfis que poderao participar da execucao real.
- o shape de execucao bloqueada no script agora inclui `routeDecisionRecordedCount=0`.

Validacoes focadas:

`npm run model-gateway:runtime-selector -- --allow-env-missing --profile repo_agent --fallback-profiles tool_agent --json`

Resultado:

- `ok=true`;
- `profiles=["repo_agent","tool_agent"]`;
- `selected=2`;
- `blocked=0`.

`npm run model-gateway:runtime-selector -- --fail --json`

Resultado:

- `ok=true`;
- `runtimeExecuted=false`;
- `selected=7`;
- `blocked=0`.

`npm run model-gateway:typecheck`

Resultado:

`passed`

`npm run model-gateway:lint`

Resultado:

`passed`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "captures and deduplicates route decision streams|audits pre-runtime selection"`

Resultado:

`2 passed`

Mudanca 70:

Flush deterministico de runtime health antes do mirror SQLite.

Problema identificado:

- scripts e terminal espelhavam health BYOK para SQLite lendo o estado em memoria/arquivo;
- o caminho correto para live tests exige garantir que o ledger JSON foi flushado antes da leitura operacional;
- sem uma primitiva unica, cada consumidor precisava lembrar a sequencia `flush -> mirror`;
- isso aumentava risco de divergencia entre artefato JSON, SQLite e readiness apos uma fase live.

Correcoes aplicadas:

- criada `flushAndMirrorByokProviderHealthToSqlite`;
- a funcao chama `flushByokProviderHealth()` e depois `mirrorByokProviderHealthToSqlite()`;
- o retorno inclui `flushed=true`;
- `model-gateway-runtime-health-mirror.mjs` passou a usar a nova primitiva;
- `model-gateway-runtime-selector.mjs -- --execute` passou a usar a nova primitiva depois da tentativa runtime;
- `/byok gateway health sqlite` passou a usar a nova primitiva e exibir `flushed=sim`;
- os exports seguem os barrels de `health/index.js` e `model-gateway/index.js`;
- mocks de terminal foram atualizados para o novo contrato.

Separacao preservada:

- a funcao nao executa provider;
- a funcao nao roda probe;
- a funcao nao altera catalogo canonico;
- a funcao apenas materializa fatos runtime ja observados em stores operacionais.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "flushes BYOK health before mirroring"`

Resultado:

`1 passed`

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js -t "health sqlite|comandos canônicos|runtime health"`

Resultado:

`2 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

`npm run model-gateway:lint`

Resultado:

`passed`

`npm run model-gateway:runtime-health:mirror -- --json`

Resultado:

- `ok=true`;
- `flushed=true`;
- `records=18`;
- `observations=18`;
- `probes=17`;
- `runtimeRows=878`.

`npm run model-gateway:test:contracts`

Resultado:

`196 passed`

`npm run model-gateway:test:terminal`

Resultado:

`80 passed`

Mudanca 71:

Reset windows numericas de provider agora distinguem epoch e duracao.

Problema identificado:

- providers usam `x-ratelimit-reset` de formas diferentes;
- alguns retornam ISO timestamp;
- alguns retornam Unix epoch em segundos;
- alguns retornam Unix epoch em milissegundos;
- outros retornam duracao relativa;
- o classificador tratava numero de reset como duracao relativa;
- isso podia transformar `1779930123` em uma janela muitos anos no futuro, em vez de `2026-05-28T01:02:03.000Z`.

Correcoes aplicadas:

- criada interpretacao dedicada para reset headers;
- numeros `>= 1_000_000_000_000` sao epoch em milissegundos;
- numeros `>= 1_000_000_000` sao epoch em segundos;
- numeros menores continuam sendo duracao relativa em segundos;
- ISO timestamps continuam aceitos;
- duracoes textuais continuam aceitas;
- retry-after continua seguindo semantica propria de duracao relativa.

Impacto arquitetural:

- overlays volateis de rate-limit passam a expirar na janela correta;
- pre-runtime exclusion evita bloquear modelos por decadas devido a parse errado;
- runtime retry budget recebe `resetAt` mais fiel;
- live readiness fica menos sujeita a falsos bloqueios de quota/rate-limit.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "classifies provider quota, auth and reset-window failures"`

Resultado:

`1 passed`

`npm run model-gateway:typecheck`

Resultado:

`passed`

`npm run model-gateway:lint`

Resultado:

`passed`

`npm run model-gateway:test:contracts`

Resultado:

`197 passed`

Mudanca 72:

Effective runtime overlay nao substitui eligibility canonica por unknown blockers.

Problema identificado:

- apos espelhar mais health observado para SQLite, `live-readiness` caiu para `0/7` rotas selecionadas;
- a causa era a reavaliacao effective com `unknownAccessPolicy=block`;
- essa reavaliacao gerava milhares de decisions `account_access_unknown`;
- ao montar o snapshot effective, essas decisions substituiam a eligibility persistida que ja estava apta;
- o resultado era um falso bloqueio total antes dos live tests, mesmo sem overlays runtime ativos.

Principio arquitetural consolidado:

- health/runtime observado pode sobrepor bloqueadores concretos;
- ausencia generica de account visibility nao deve apagar eligibility canonica;
- unknown access precisa continuar sendo tratado na camada de account overlay/refresh, nao como regressao runtime;
- effective snapshot deve preservar catalog eligibility e adicionar apenas blockers runtime/account concretos.

Correcoes aplicadas:

- criado `filterModelGatewayRuntimeEligibilityOverlayDecisions`;
- criado `isModelGatewayRuntimeEligibilityOverlayDecision`;
- o filtro mantem apenas blockers concretos como:
  - `health_fatal`;
  - `account_key_disabled`;
  - `account_spending_exhausted`;
  - `account_quota_exhausted`;
  - `account_rate_limited`;
  - `account_model_blocked`;
- `account_access_unknown` e `account_overlay_missing` nao sao promovidos para overlay runtime;
- `model-gateway-runtime-selector.mjs` passou a preservar `snapshot.modelEligibilityDecisions` e anexar apenas overlay decisions concretas;
- `model-gateway-live-readiness.mjs` passou a usar a mesma regra;
- a saida JSON informa `runtimeOverlayDecisionCount`/`runtimeOverlayDecisions`.

Impacto:

- mirror SQLite pode crescer sem colapsar o selector;
- rate-limit/quota/auth concretos continuam bloqueando quando ativos;
- readiness volta a refletir o que realmente impede runtime;
- live tests continuam bloqueados apenas por causa concreta, nao por ausencia generica de overlay.

Validacoes focadas:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js -t "runtime eligibility overlays concrete|classifies provider quota"`

Resultado:

`2 passed`

`npm run model-gateway:runtime-selector -- --fail --json`

Resultado:

- `ok=true`;
- `selected=7`;
- `blocked=0`;
- `envReady=7`;
- `runtimeOverlayDecisionCount=0`.

`npm run model-gateway:live:readiness -- --fail --json`

Resultado:

- `ok=true`;
- `runtimeSelector.selected=7`;
- `runtimeSelector.blocked=0`;
- `runtimeSelector.runtimeEnvReady=7`;
- `runtimeOverlayDecisions=0`.

`npm run model-gateway:typecheck`

Resultado:

`passed`

`npm run model-gateway:lint`

Resultado:

`passed`

`npm run model-gateway:test:contracts`

Resultado:

`198 passed`

Mudanca 73:

Live control no-pr foi reexecutado apos runtime persistence.

Evidencia:

`npm run terminal:llm-b:live-test -- --no-pr --timeout-ms=180000`

Resultado:

- `Status: PASS`;
- `Exit code: 0`;
- artefato: `artifacts/terminal-live/2026-05-28T13-08-08-672Z/summary.md`;
- terminal pronto em TTY interativo;
- nenhum turno LLM explicito aberto;
- `/usage now`, `/activity`, `/session sdk commands`, `/session sdk events`, `/session sdk waits`, `/metrics`, `/events` e `/errors` renderizaram corretamente;
- SSE conectado com ids monotonicos;
- nenhum erro rastreado pelo terminal.

Impacto:

- a camada terminal/SDK/SSE esta apta para a proxima fase live controlada;
- a fase ainda nao consome BYOK provider quota;
- o proximo degrau deve continuar sendo fixture BYOK antes de real provider.

Mudanca 74:

Runner live real passa a aplicar a rota do runtime selector.

Problema identificado:

- `model-gateway:runtime-selector` ja escolhia rotas por perfil de tarefa;
- o runner `terminal:llm-b:live-test -- --byok-real` ainda podia iniciar usando um perfil BYOK legado do `.env.local`;
- isso permitia testar um provider/modelo diferente daquele que a selecao canonica havia escolhido;
- em live real, esse desalinhamento poderia produzir falsos positivos, consumo de quota no provider errado, ou falhas que nao pertenciam a rota selecionada.

Correcoes aplicadas:

- adicionado `--byok-real-route-profile=<perfil>` ao runner live;
- adicionado `--byok-real-route-fallback-profiles=<a,b>` ao runner live;
- o runner chama `scripts/model-gateway-runtime-selector.mjs --json --fail`;
- a rota selecionada e aplicada no ambiente inicial do terminal;
- a rota selecionada tambem e aplicada explicitamente por `/byok provider <provider> <model> [baseUrl]`;
- quando o modo runtime-selector esta ativo, o runner nao troca para alt profiles depois da rota canonica;
- o plano live e o readiness passaram a recomendar:
  - `--byok-real-route-profile=repo_agent`;
  - `--byok-real-route-fallback-profiles=code,tool_agent`;
- o inventario canonico de comandos agora lista os comandos live control, fixture e real;
- o criterio `byok-real-runtime-selector-route` valida que o terminal renderizou o provider/modelo selecionado;
- corrigido detalhe de reason em `buildModelGatewayRuntimeSelectorPlan`: `blocked:runtime_proof_required` so aparece quando a prova realmente esta ausente.

Evidencia sem runtime:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --no-pr --dry-run --out-dir artifacts/terminal-live/dry-run-runtime-selector-handoff`

Resultado:

- prompt gerado sem abrir terminal real;
- primeira rota aplicada:
  - provider `chutes`;
  - model `Qwen/Qwen3-235B-A22B-Thinking-2507`;
  - base URL `https://llm.chutes.ai/v1`;
- o roteiro permaneceu na rota escolhida e nao retornou para perfil BYOK legado.

Impacto:

- live BYOK real fica alinhado com o runtime selector;
- o operador testa exatamente a rota escolhida por metadados + overlays + env readiness;
- reduzimos risco de gastar quota em provider incorreto;
- a fase full-turn fica bloqueada conceitualmente ate fixture e no-pr real passarem.

Mudanca 75:

Fixture BYOK no-pr passou apos o handoff runtime-selector.

Evidencia:

`npm run terminal:llm-b:live-test -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000`

Resultado:

- `Status: PASS`;
- `Exit code: 0`;
- artefato: `artifacts/terminal-live/2026-05-28T13-17-47-703Z/summary.md`;
- 31 criterios aprovados;
- fixture profile apareceu com metadata redigida;
- `/byok use codex-fixture` ativou o modelo fixture;
- descoberta remota fixture via `/v1/models` funcionou;
- `/byok model` e `/byok provider` funcionaram no processo atual;
- token fake `codex-fixture-token-never-print` nao apareceu no output;
- SSE conectado e sem erros;
- terminal error tracker permaneceu limpo.

Baseline associado:

`npm run model-gateway:runtime-health:diff -- --write-snapshot --out-dir artifacts/model-gateway-runtime-health-baselines/2026-05-28T13-18-runtime-selector-handoff`

Resultado:

- snapshot escrito em `artifacts/model-gateway-runtime-health-baselines/2026-05-28T13-18-runtime-selector-handoff/latest.json`;
- `diff.summary.regressions=0`;
- `diff.summary.newFailures=0`;
- estado observado antes do live real preservado para comparacao posterior.

Impacto:

- o controle BYOK local esta pronto;
- o proximo passo pode ser BYOK real no-pr, ainda sem turno LLM explicito;
- antes de full-turn real, comparar health contra baseline e garantir readiness ok.

Mudanca 76:

Live BYOK real expôs overlay de conta/runtime que precisava prevalecer sobre decisao antiga.

Evidencia inicial:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --no-pr --timeout-ms=600000`

Resultado:

- `Status: FAIL`;
- artefato: `artifacts/terminal-live/2026-05-28T13-19-11-953Z/summary.md`;
- rota aplicada:
  - provider `chutes`;
  - model `Qwen/Qwen3-235B-A22B-Thinking-2507`;
- provider retornou falha real de creditos:
  - HTTP `402`;
  - `failureKind=credits`;
  - mensagem operacional indicando creditos insuficientes.

Snapshot associado:

`artifacts/model-gateway-runtime-health-post-live/2026-05-28T13-19-real-no-pr/latest.json`

Problema estrutural:

- a falha de creditos foi corretamente observada como runtime/account state;
- porem o seletor ainda podia reutilizar uma decisao elegivel antiga, mais especifica por rota;
- isso fazia a rota concreta continuar selecionavel mesmo depois de uma falha de conta forte;
- o problema nao era do terminal;
- o problema era da prioridade entre decisoes de eligibility no policy engine.

Correcoes aplicadas:

- `findEligibilityDecisionForModel` agora prioriza runtime eligibility overlay blockers;
- um blocker de runtime/account com mesmo provider/model prevalece sobre decisoes elegiveis antigas;
- decisoes continuam respeitando escopo de conta/perfil;
- foi criado teste cobrindo o caso:
  - decisao antiga elegivel;
  - decisao runtime posterior com `account_spending_exhausted`;
  - resultado final rejeitado, sem selecionar a rota.

Impacto:

- falhas dinamicas de conta, quota, creditos e access passam a bloquear retries obvios;
- metadado canonico permanece separado de runtime/account state;
- o pre-runtime evita gastar chamadas repetidas em rotas que acabaram de provar indisponibilidade de conta;
- esta regra e essencial antes de full-turn real.

Mudanca 77:

Runtime selector live agora pode executar a rota antes de entrega-la ao terminal.

Problema identificado:

- o handoff anterior aplicava a rota selecionada por metadados/eligibility;
- isso ainda podia entregar ao terminal uma rota sem prova runtime recente;
- em caso de falha na execucao do seletor, o runner podia cair de volta para uma rota dry;
- esse fallback silencioso misturava camadas e podia consumir provider errado.

Correcoes aplicadas:

- `terminal:llm-b:live-test` recebeu:
  - `--byok-real-route-execute`;
  - `--byok-real-route-timeout-ms=<ms>`;
  - `--byok-real-route-selection-policy=<policy>`;
- quando `--byok-real-route-execute` esta ativo:
  - o runner chama `model-gateway:runtime-selector --execute`;
  - a rota efetiva vem de `execution.final.route`;
  - se a execucao falhar, nao ha fallback para a rota dry;
  - o terminal nao inicia com perfil BYOK legado se a rota runtime for obrigatoria;
- o resumo redigido do live inclui:
  - `runtimeSelector.executed`;
  - `runtimeSelector.selectionPolicy`;
  - `runtimeSelector.execution.status`;
  - `runtimeSelector.execution.attemptedCount`;
  - `runtimeSelector.execution.selectedProfileId`.

Comandos canonicos atualizados:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --no-pr --timeout-ms=600000`

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --timeout-ms=900000`

Impacto:

- o terminal live passa a testar a rota realmente promovida pelo runtime selector;
- a fase no-pr real fica mais forte porque inclui prova runtime curta antes do boot;
- evitamos falso positivo por perfil legado em `.env.local`;
- full-turn real deve usar exatamente o mesmo handoff.

Mudanca 78:

Fallback runtime selector nao repete a mesma rota por perfis diferentes.

Problema identificado:

- o plano pode selecionar a mesma rota concreta em mais de um perfil;
- quando a primeira tentativa falhava, o fallback podia tentar o mesmo provider/model de novo por outro perfil;
- isso consumia tempo/quota e nao acrescentava informacao nova.

Correcoes aplicadas:

- `executeModelGatewayRuntimeSelectorPlanWithFallbacks` agora deduplica tentativas por rota concreta;
- a chave usa `selectedRouteKey` ou `providerId:providerModel`;
- perfis distintos continuam elegiveis quando apontam para modelos concretos diferentes;
- teste novo valida:
  - rota duplicada falha uma vez;
  - fallback distinto continua sendo executado;
  - erro permanente ainda respeita classificacao de retry.

Impacto:

- menos chamadas repetidas;
- fallback passa a representar alternativas reais;
- logs de tentativa ficam mais limpos;
- selecao runtime fica pronta para mais provedores e mais perfis sem multiplicar retries redundantes.

Mudanca 79:

Shutdown e cleanup de probes SDK foram fortificados.

Problemas identificados:

- `model-gateway:runtime-selector --execute` podia produzir JSON completo e ainda assim manter processo vivo;
- uma sessao efemera com provider timeout podia demorar para limpar;
- falha em `sendAndWait` nao abortava explicitamente a sessao antes do cleanup.

Correcoes aplicadas:

- `scripts/model-gateway-runtime-selector.mjs` chama `shutdownClient({ force: true })` depois de execucao runtime;
- `withEphemeralSession` passou a ter timeout de cleanup para:
  - `asyncDispose`;
  - `disconnectSession`;
  - `deleteSession`;
- se cleanup efemero falhar, a camada chama `forceStopClient` como containment;
- `runConfiguredByokChatProbe` tenta `abortSession(session)` quando `sendAndWait` falha.

Impacto:

- comandos de selector executado encerram de modo deterministico;
- timeouts de provider nao seguram o processo indefinidamente;
- probes descartaveis ficam mais seguros para uso em loops de fallback;
- essa base e necessaria antes de testes live longos e matrizes maiores.

Mudanca 80:

Sinais runtime comprovados agora pesam mais na selecao `prefer_runtime_proved`.

Problema identificado:

- apos a rota NVIDIA passar runtime, a pontuacao de metadados ainda podia dominar;
- rotas com score estatico maior, mas sem prova recente, continuavam competindo forte demais;
- isso contrariava a finalidade da camada observada: depois do runtime, prova real deve pesar bastante.

Correcoes aplicadas:

- `chat_health_ok` passou a somar `140`;
- `agent_probe_verified` passou a somar `140`;
- cada probe verificado passou a somar `35`;
- a mudanca preserva filtros, hard exclusions, env readiness e account overlays;
- a politica continua distinguindo metadata/pre-runtime de runtime proof.

Evidencia:

`npm run model-gateway:runtime-selector -- --profile=repo_agent --fallback-profiles=code,tool_agent --selection-policy=prefer_runtime_proved --json`

Resultado observado:

- `repo_agent` continuou com rota pre-runtime quando nao havia prova melhor no proprio perfil;
- `code` passou a promover `nvidia-nim/openai/gpt-oss-120b` com `routeStage=post_runtime_proved`;
- rotas bloqueadas por creditos/timeout nao foram promovidas.

Impacto:

- provedores que realmente responderam ganham prioridade na fase runtime;
- a camada de metadados continua sendo a primeira selecao;
- a camada runtime passa a cumprir seu papel de refinamento observado;
- isto prepara a selecao efetiva antes de full-turn real.

Mudanca 81:

Live BYOK real no-pr passou com rota executada pelo runtime selector.

Comando:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --no-pr --timeout-ms=600000`

Resultado:

- `Status: PASS`;
- `Exit code: 0`;
- duracao aproximada `60438ms`;
- artefato: `artifacts/terminal-live/2026-05-28T13-58-30-298Z/summary.md`;
- runtime selector:
  - `executed=true`;
  - `attemptedCount=2`;
  - profile inicial `repo_agent`;
  - fallback selecionado `code`;
  - provider `nvidia-nim`;
  - model `openai/gpt-oss-120b`;
  - base URL `https://integrate.api.nvidia.com/v1`;
- terminal live:
  - binding BYOK alinhado com provider/model selecionado;
  - `/usage now` renderizou BYOK sem Premium Request;
  - `/session sdk` mostrou selecao preparada e provider vivo alinhados;
  - chat probe passou;
  - streaming probe passou;
  - JSON probe passou;
  - vision probe passou com fixture PNG;
  - agent probe passou com tools e `ask_user`;
  - `/errors 10` reportou `0` erros;
  - `/quit` encerrou limpo.

Ajustes de criterio do runner:

- `byok-real-route-decision` aceita o caminho diagnostico sem candidatos quando o endpoint ativo nao retorna catalogo roteavel;
- `byok-real-shortlist-probe` aceita shortlist vazia como diagnostico operacional valido;
- `byok-real-recommendation` aceita recomendacao vazia quando filtros excluem todos os candidatos;
- `byok-real-vision-probe` aceita resultado explicito `empty` como capacidade observada, sem transformar vision em hard exclusion automatica.

Snapshot pos-live:

`npm --silent run model-gateway:runtime-health:mirror`

Resultado:

- `ok=true`;
- `healthObservations=25`;
- `probeResults=28`;
- `sqlite.runtimeRows=2103`;
- `sqlite.tableCounts.healthObservations=1062`;
- `sqlite.tableCounts.runtimeProbeRuns=52`;
- `sqlite.tableCounts.runtimeProbeResults=989`.

`npm --silent run model-gateway:runtime-health:diff -- --write-snapshot --out-dir artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-00-real-selector-nvidia-pass`

Resultado:

- snapshot escrito em `artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-00-real-selector-nvidia-pass/latest.json`;
- `diff.summary.regressions=0`;
- `diff.summary.newFailures=0`;
- `diff.summary.becameFailed=0`;
- `diff.summary.recovered=0`.

Impacto:

- a cadeia `metadata -> eligibility -> runtime selector execute -> terminal BYOK live no-pr` esta comprovada em provider real;
- a rota ruim por creditos foi aprendida como estado runtime/account;
- a rota alternativa comprovada foi promovida;
- a fase seguinte pode avançar para full-turn real apenas depois de novo readiness e validadores.

Mudanca 82:

Cockpit `/byok models route ... active provider:<preset>` preserva o provider operacional.

Problema identificado:

- endpoints OpenAI-compatible podem devolver `owned_by` ou `provider` com o dono do modelo;
- em NVIDIA NIM, o modelo selecionado foi `openai/gpt-oss-120b`, mas a fronteira operacional era `nvidia-nim`;
- o terminal podia filtrar ou rotear pelo dono `openai` em vez do preset operacional;
- isso explicava parte dos diagnosticos `Nenhum candidato encontrado para roteamento` em comandos focados no provider ativo.

Correcoes aplicadas:

- `withByokCatalogSource` agora distingue provider operacional de owner do modelo em modelos descobertos por provider ativo;
- para modelos `remote/static` vindos do provider ativo, `byok.provider` passa a refletir o preset operacional;
- o owner anterior fica preservado em `byok.providerOwner`;
- `byok.profile` tambem recebe o preset quando nao ha profile nomeado;
- `toGatewayRouteCandidate` passa a enxergar o provider operacional correto sem mudar a arquitetura do policy engine.

Teste adicionado:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js -t "roteia modelos descobertos|modelos BYOK como candidatos"`

Resultado:

- `1 passed`;
- o fixture simula endpoint NVIDIA retornando modelo com owner `openai`;
- `/byok models route code active --show-rejected provider:nvidia-nim` envia candidato com:
  - `providerId=nvidia-nim`;
  - `providerModel=openai/gpt-oss-120b`;
- o cockpit seleciona o modelo e nao cai no diagnostico de zero candidatos.

Live revalidado:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --no-pr --timeout-ms=600000`

Resultado:

- `Status: PASS`;
- artefato: `artifacts/terminal-live/2026-05-28T14-08-27-863Z/summary.md`;
- `/byok models route code active --show-rejected provider:nvidia-nim` retornou:
  - `fonte=provider`;
  - `endpoint=https://integrate.api.nvidia.com/v1/models`;
  - `admissao=117/117`;
  - `rejeitados=0`;
  - selecionado `openai/gpt-oss-120b`;
  - `provider=nvidia-nim`;
  - `score=721`;
  - fallback chain com 117 candidatos NVIDIA;
- probes chat, streaming, JSON, vision e agent passaram;
- `/errors 10` reportou zero erros.

Health pos-live:

`npm --silent run model-gateway:runtime-health:mirror`

Resultado:

- `ok=true`;
- `healthObservations=25`;
- `probeResults=28`;
- `sqlite.runtimeRows=2481`;
- `sqlite.tableCounts.healthObservations=1237`;
- `sqlite.tableCounts.runtimeProbeRuns=59`;
- `sqlite.tableCounts.runtimeProbeResults=1185`.

`npm --silent run model-gateway:runtime-health:diff -- --write-snapshot --out-dir artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-08-real-selector-nvidia-route-cockpit-pass`

Resultado:

- snapshot escrito em `artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-08-real-selector-nvidia-route-cockpit-pass/latest.json`;
- `diff.summary.regressions=0`;
- `diff.summary.newFailures=0`;

Impacto:

- o operador passa a ver e testar a fronteira operacional correta;
- o live runner pode continuar usando `provider:nvidia-nim` sem depender de owner interno do modelo;
- a rota canonica fica alinhada entre endpoint ativo, cockpit terminal e model-gateway.

Lacunas ainda abertas apos Mudanca 82:

- full-turn real deve ser executado so depois de validar esses pontos ou aceitar conscientemente o risco operacional;
- resultados de vision devem alimentar refinamento de capability runtime, sem virar exclusao automatica.

Mudanca 83:

Runner live reaplica provider runtime imediatamente apos `/byok reload`.

Problema identificado:

- o roteiro live real carregava `.env.local`;
- em seguida, antes de reaplicar a rota runtime-selector, ainda imprimia paineis como `/byok env`, `/byok providers`, `/byok health` e `/byok profiles`;
- nesse intervalo, o operador via o perfil legado do arquivo local;
- depois a rota correta era reaplicada, mas o cockpit inicial ficava ruidoso e podia confundir analise automatica.

Correcao aplicada:

- `buildByokRealPreflightCommands` agora gera:
  - `/session sdk 8`;
  - `/byok reload --no-status`;
  - `/byok provider <provider> <model> <baseUrl>`;
  - somente entao `/byok env`, `/byok providers`, `/byok health`, `/byok profiles`;
- o caminho sem runtime-selector continua usando `/byok use` e `/byok model`;
- o comportamento de `--dry-run` permanece sem executar probes runtime reais, portanto pode mostrar a rota dry quando `--byok-real-route-execute` esta desativado por dry-run.
- `/byok reload --no-status` recarrega `.env.local`, omite o cockpit legado e instrui o operador a aplicar a rota preparada antes de chamar `/byok`.

Evidencia:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --no-pr --dry-run --out-dir artifacts/terminal-live/dry-run-runtime-reload-statusless`

Resultado:

- prompt escrito em `artifacts/terminal-live/dry-run-runtime-reload-statusless/prompt.txt`;
- ordem confirmada:
  - `/byok reload --no-status`;
  - `/byok provider cerebras gpt-oss-120b https://api.cerebras.ai/v1`;
  - `/byok env`;
  - `/byok providers`;
  - `/byok health`;
- em live executado, o mesmo ponto aplicara a rota final de `execution.final.route`.

Teste adicional:

`npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js -t "recarrega .env.local"`

Resultado:

- `2 passed`;
- reload normal continua exibindo status;
- reload `--no-status` recarrega sem imprimir `BYOK status` nem segredo.

Impacto:

- reduzimos ruido de boundary no live;
- os paineis passam a refletir a rota preparada antes de serem exibidos;
- o caminho para full-turn fica mais legivel e menos sujeito a falso diagnostico.

Mudanca 84:

Executor do runtime selector prioriza rotas com prova quando a politica pede `prefer_runtime_proved`.

Problema identificado:

- o plano `prefer_runtime_proved` ja conseguia identificar rotas com prova runtime;
- porem `executeModelGatewayRuntimeSelectorPlanWithFallbacks` ainda tentava primeiro o perfil solicitado;
- no caso real, isso significava tentar `repo_agent/cerebras/gpt-oss-120b`, que vinha dando timeout, antes de chegar em `code/nvidia-nim/openai/gpt-oss-120b`, que ja tinha prova;
- a politica dizia preferir runtime provado, mas a ordem de execucao ainda privilegiava a ordem textual de perfil.

Correcao aplicada:

- o executor agora ordena perfis por prova runtime quando `plan.mode === prefer_runtime_proved`;
- rotas com `hasRuntimeProof=true` sobem antes das sem prova;
- a ordem original permanece como desempate;
- dedupe de rota concreta continua valendo;
- politicas diferentes de `prefer_runtime_proved` preservam a ordem original.

Teste adicionado:

- plano com `repo_agent` sem prova;
- fallback `tool_agent` com prova e rota distinta;
- chamada com `profileId=repo_agent` e `fallbackProfileIds=[tool_agent]`;
- resultado esperado:
  - `attemptedCount=1`;
  - `selectedProfileId=tool_agent`;
  - modelo tentado `openai/gpt-oss-20b-tool`.

Evidencia real:

`node scripts/model-gateway-runtime-selector.mjs --profile=repo_agent --fallback-profiles=code,tool_agent --selection-policy=prefer_runtime_proved --execute --attempts-per-route=1 --timeout-ms=15000 --json --fail`

Resultado:

- `ok=true`;
- `execution.ok=true`;
- `execution.attemptedCount=1`;
- `execution.selectedProfileId=code`;
- primeira e unica tentativa:
  - provider `nvidia-nim`;
  - model `openai/gpt-oss-120b`;
  - `error=null`;
- artefato: `artifacts/model-gateway-runtime-selector/2026-05-28T14-14-prefer-runtime-proved-first.json`.

Impacto:

- evitamos timeout conhecido antes do provider comprovado;
- reduzimos gasto de quota e latencia no handoff live;
- full-turn real passa a ter caminho mais direto;
- o seletor runtime agora expressa melhor a intencao da policy.

Lacunas ainda abertas apos Mudanca 84:

- full-turn real ainda precisa ser executado e auditado;
- resultados de vision devem alimentar refinamento de capability runtime, sem virar exclusao automatica;
- o warning de `shutdownClient({ force: true })` no selector executado ainda e ruidoso, embora o encerramento seja deterministico;
- a rota `repo_agent` sem prova continua disponivel para policy metadata-first, mas nao deve prevalecer em prefer-runtime-proved.

Mudanca 85:

Live no-pr confirmou handoff statusless e prova runtime antes do full-turn.

Problema investigado:

- a correcao anterior precisava ser validada dentro do terminal real;
- o risco era o cockpit ainda imprimir o perfil legado de `.env.local` antes de aplicar a rota runtime;
- tambem era necessario confirmar que a ordenacao por runtime proof nao era apenas unidade isolada, mas afetava o runner live.

Evidencia live:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --no-pr --timeout-ms=600000`

Artefato:

- `artifacts/terminal-live/2026-05-28T14-17-53-222Z/summary.md`.

Resultado:

- status geral `PASS`;
- duracao `43350ms`;
- `byok-real-runtime-selector-route` passou;
- `byok-real-profile-active` passou;
- `byok-real-binding-cockpit` passou;
- `byok-real-no-secret-leak` passou;
- `byok-real-chat-probe-ok` passou;
- `byok-real-agent-probe-ok` passou;
- `byok-real-health-command` passou;
- `execution.ok=true`;
- `execution.attemptedCount=1`;
- `execution.selectedProfileId=code`;
- rota final:
  - provider `nvidia-nim`;
  - model `openai/gpt-oss-120b`;
  - base URL `https://integrate.api.nvidia.com/v1`;
- `/byok reload --no-status` apareceu antes da aplicacao da rota;
- o primeiro cockpit `BYOK status` apos reload ja apareceu com `preset: nvidia-nim`;
- nao houve cockpit legado `kilo-code` entre reload e rota ativa.

Saude apos live:

`npm --silent run model-gateway:runtime-health:mirror && npm --silent run model-gateway:runtime-health:diff -- --write-snapshot --out-dir artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-17-statusless-proof-first-no-pr`

Resultado:

- `runtimeRows=3237`;
- `healthObservations=1587`;
- `runtimeProbeRuns=73`;
- `runtimeProbeResults=1577`;
- `regressions=0`;
- `newFailures=0`;
- snapshot: `artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-17-statusless-proof-first-no-pr/latest.json`.

Impacto:

- o caminho no-pr esta pronto para servir de preflight imediato do full-turn;
- a selecao `prefer_runtime_proved` agora corta timeout conhecido antes de acionar a sessao real;
- o cockpit terminal mostra a fronteira correta entre estado carregado, rota preparada e provider ativo;
- a evidencia de runtime continua fora do catalogo canonico.

Lacunas ainda abertas apos Mudanca 85:

- executar full-turn real com a mesma rota comprovada;
- analisar custo, quota e classificacao de uso do full-turn;
- decidir se o resultado `vision=empty` deve virar health observation fraca ou capability override explicito;
- manter Ollama local fora dos defaults ate opt-in do operador.

Mudanca 86:

Full-turn real chegou ao modelo, mas bloqueou no protocolo vivo de `ask_user`.

Evidencia:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --timeout-ms=900000`

Artefato:

- `artifacts/terminal-live/2026-05-28T14-26-35-109Z/summary.md`.

Resultado:

- status `BLOCKED`;
- blocker `byok-live-tool-protocol-missed`;
- rota runtime correta:
  - provider `nvidia-nim`;
  - model `openai/gpt-oss-120b`;
  - profile `code`;
- `report_intent` materializou como tool real;
- `read_file_content` materializou como tool real;
- a resposta publica emitiu `DELTA-CANONICAL-1..8`;
- `ask_user` nao materializou como tool real;
- o modelo escreveu JSON textual com `"function": "ask_user"` e `"question": "ASK-CANONICAL..."`;
- nao houve vazamento de segredo;
- uso foi classificado como `byok_user_message`, nao Premium Request;
- SSE conectado, com `431` eventos e `0` erros.

Correcao aplicada no runner:

- o prompt canonico agora deixa explicito que pseudo-tool JSON nao conta;
- o detector `findByokRealLiveToolProtocolMiss` reconhece:
  - `tool_calls` textual;
  - `"function": "report_intent"`;
  - `"function": "read_file_content"`;
  - `"function": "ask_user"`;
  - JSON textual de pergunta;
  - declaracoes textuais de execucao;
- o runner passa a bloquear cedo em vez de esperar timeout quando a tool viva foi textificada;
- diagnostics de protocolo devem aguardar retorno ao prompt para nao intercalar comandos no meio do streaming;
- o detalhe do probe vision no runner separa prova positiva de resultado explicito nao conclusivo.

Correcao aplicada no terminal:

- `/byok probe vision` nao diz mais que a fixture foi interpretada quando `probe.ok=false`;
- resultado `empty` passa a ser descrito como sinal multimodal nao conclusivo;
- chat e agent nao sao degradados por falha multimodal isolada.

Interpretacao arquitetural:

- a rota NVIDIA e boa para chat, streaming, JSON e tools simples em turnos de continuation;
- o turno vivo ainda expõe uma lacuna especifica no final do fluxo: `ask_user` pode ser textificado;
- isso nao deve ser promovido como runtime proof completo de automacao;
- o selector precisa distinguir `agent_probe_ok` de `live_ask_user_ok`;
- enquanto `live_ask_user_ok` nao existir, esse modelo pode ser bom para chat/codigo, mas nao deve ser preferido para automacao que dependa de ask_user vivo.

Lacunas abertas apos Mudanca 86:

- criar metrica/prova separada para `live_tool_protocol` e `live_ask_user`;
- evitar que agent probe descartavel seja interpretada como equivalencia plena ao turno vivo;
- reexecutar full-turn apos sincronizacao de diagnostics;
- investigar se outro modelo NVIDIA com tool-calling mais forte passa `ask_user` vivo;
- investigar se o problema e do provider, do SDK boundary, do prompt, ou da ponte terminal de `ask_user`.

Mudanca 87:

Runner live agora bloqueia protocolo textificado sem poluir streaming e sem falsificar vision.

Problema identificado apos Mudanca 86:

- o detector de pseudo-tool estava certo, mas acionava diagnostics enquanto o modelo ainda transmitia;
- isso podia intercalar `/activity 40` dentro do bloco publico em streaming;
- o criterio de vision no runner podia atravessar a proxima secao e ler `resultado: ok` do agent probe;
- o comando `/byok probe vision` tambem narrava `empty` como se a imagem tivesse sido interpretada.

Correcao aplicada:

- `pendingByokLiveProtocolDiagnostics` marca o blocker durante streaming;
- diagnostics so disparam depois de o prompt REPL voltar;
- `findByokProbeResultStatus` captura o primeiro status da secao vision;
- `byok-real-vision-probe` diferencia `ok` de `empty`;
- `/byok probe vision` imprime resultado multimodal nao conclusivo quando `probe.ok=false`;
- teste unitario cobre `vision empty`.

Revalidacao live:

`npm run terminal:llm-b:live-test -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-timeout-ms=15000 --timeout-ms=900000`

Artefato:

- `artifacts/terminal-live/2026-05-28T14-30-43-120Z/summary.md`.

Resultado:

- status `BLOCKED`;
- blocker unico `byok-live-tool-protocol-missed`;
- `execution.ok=true`;
- `execution.attemptedCount=1`;
- `execution.selectedProfileId=code`;
- rota `nvidia-nim/openai/gpt-oss-120b`;
- `report_intent` real passou;
- `read_file_content` real passou;
- `ask_user` vivo foi textificado;
- diagnostics rodaram apos retorno ao prompt;
- `byok-real-vision-probe` agora reporta `empty` como nao conclusivo;
- `byok-real-usage-classified` passou com uso BYOK;
- `byok-real-no-secret-leak` passou.

Saude apos revalidacao:

`npm --silent run model-gateway:runtime-health:mirror && npm --silent run model-gateway:runtime-health:diff -- --write-snapshot --out-dir artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-30-full-turn-live-ask-user-blocked`

Resultado:

- `runtimeRows=4641`;
- `healthObservations=2237`;
- `runtimeProbeRuns=99`;
- `runtimeProbeResults=2305`;
- `regressions=0`;
- `newFailures=0`;
- snapshot: `artifacts/model-gateway-runtime-health-post-live/2026-05-28T14-30-full-turn-live-ask-user-blocked/latest.json`.

Impacto:

- temos uma prova negativa limpa de `live_ask_user` para essa rota;
- o seletor runtime deve passar a separar provas de probe descartavel e provas de turno vivo;
- o caminho para futuras lives fica mais curto porque falhas de protocolo nao esperam timeout;
- vision nao contamina selecao como sucesso multimodal quando o provider retorna vazio.

Lacunas abertas apos Mudanca 87:

- criar runner para testar modelos alternativos da NVIDIA que declaram tool capability;
- avaliar se `openai/gpt-oss-20b` ou modelos Qwen/Nemotron passam `ask_user` vivo;
- registrar `vision=empty` como capability runtime nao conclusiva, separada de erro de chat.

### Mudanca 88 - Probes canonicos de protocolo live e bloqueio pre-runtime

Status: implementado em 2026-05-28.

Objetivo:

- separar definitivamente `agent_probe_ok` de prova de protocolo vivo;
- impedir que uma rota com `ask_user` textificado continue sendo tentada como se fosse apenas "chat/probe OK";
- persistir fatos de live full-turn no mesmo health store usado pelo selector e pelo SQLite mirror;
- manter o banco canonico de metadados imutavel diante de fatos volateis de runtime.

Alteracoes aplicadas:

- `MODEL_GATEWAY_LIVE_PROTOCOL_PROBE_KINDS` criado com:
  - `live_tool_protocol`;
  - `live_ask_user`.
- `profileProbeKinds` agora prefere estes probes quando o perfil exige tools ou tool-agent behavior;
- `explainGatewayRouteDecision` agora expoe:
  - `liveToolProtocolStatus`;
  - `liveAskUserStatus`;
  - `runtimeLiveToolProtocolProofCount`;
  - `runtimeLiveAskUserProofCount`;
  - `runtimeLiveProtocolFailureCount`.
- `auditModelGatewayPostRuntimeSelection` agora preserva:
  - `failedProbes`;
  - status live de tool protocol;
  - status live de ask_user.
- `scripts/model-gateway-runtime-selector.mjs` ganhou:
  - `--preferred-probes=a,b`;
  - `--block-failed-probes=a,b`;
  - resumo JSON com probes preferidos/bloqueados;
  - exposicao dos probes live canonicos.
- `scripts/copilot/run-terminal-llm-b-live-test.mjs` agora:
  - chama o runtime selector com `--preferred-probes=live_tool_protocol,live_ask_user`;
  - chama o runtime selector com `--block-failed-probes=live_tool_protocol,live_ask_user`;
  - registra resultado live full-turn no provider health;
  - grava dois probes por rota full-turn BYOK real:
    - `live_tool_protocol`;
    - `live_ask_user`.
- o summary JSON/MD do live runner agora informa se o fato live foi gravado no health store.

Semantica nova:

- `agent` continua sendo probe descartavel de capacidade basica de tool/ask_user;
- `live_tool_protocol` e prova de que o turno terminal real materializou tools SDK;
- `live_ask_user` e prova de que o turno terminal real materializou pergunta, resposta humana e final pos-resposta;
- falha de `live_ask_user` nao apaga o modelo do catalogo canonico;
- falha de `live_ask_user` pode bloquear a rota em uma handoff live posterior;
- a decisao fica no overlay de health/runtime, nao nos metadados canonicos.

Validacoes executadas:

- `node --check scripts/copilot/run-terminal-llm-b-live-test.mjs`;
- `node --check scripts/model-gateway-runtime-selector.mjs`;
- `npm run model-gateway:typecheck`;
- `npm run model-gateway:lint`;
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/model-gateway/test_model_gateway_provider_health.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`;
- `git diff --check`;
- dry-run do runtime selector com:
  - `--preferred-probes=live_tool_protocol,live_ask_user`;
  - `--block-failed-probes=live_tool_protocol,live_ask_user`;
  - `--selection-policy=prefer_runtime_proved`.

Resultado do dry-run:

- `ok=true`;
- `ready=true`;
- `selected=3`;
- `blocked=0`;
- `preferred=[live_tool_protocol, live_ask_user]`;
- `block=[live_tool_protocol, live_ask_user]`.

Teste unitario novo:

- cobre rota com `live_ask_user=failed`;
- confirma que `blockFailedProbeKinds=['live_ask_user']` rejeita a rota antes de outro handoff;
- confirma que uma alternativa nao marcada pode ser escolhida.

Impacto arquitetural:

- o sistema passa a ter tres niveis claros:
  - metadados canonicos;
  - probes/health volateis;
  - live protocol proof;
- o runtime selector deixa de depender apenas de "modelo respondeu";
- uma live bloqueada agora produz memoria operacional reutilizavel;
- o proximo live test deve gravar a falha atual no health e, depois do mirror, permitir que o selector evite a mesma rota.

Lacunas abertas apos Mudanca 88:

- criar runner para testar modelos alternativos da NVIDIA que declaram tool capability;
- avaliar se `openai/gpt-oss-20b` ou modelos Qwen/Nemotron passam `ask_user` vivo;
- registrar `vision=empty` como capability runtime nao conclusiva, separada de erro de chat.

### Mudanca 89 - Selector aprende com live failed e bloqueia quedas ruins

Status: implementado em 2026-05-28.

Problema revelado pela Mudanca 88:

- depois de gravar `live_ask_user=failed`, o selector evitou a rota NVIDIA;
- porem, a queda inicial podia ir para vencedores de metadados com health ruim ja conhecido;
- isso acontecia porque:
  - o plano final do runtime consumia apenas a rota vencedora da policy row;
  - health global sem `routeProfile` nao servia como fallback para uma rota com `routeProfile`;
  - o harness live gravava `live_tool_protocol/live_ask_user=failed` tambem quando o bloqueio ocorria em preflight.

Correcoes aplicadas:

- `readGatewayModelHealth` e `readGatewayModelHealthFromRecords` agora usam health profileless como fallback;
- `buildModelGatewayRuntimeSelectorPlan` recebe `runtimeHealthRecords`;
- o plano final bloqueia rota com:
  - `chat_health_failed`;
  - `agent_probe_failed`;
  - probe bloqueado por `--block-failed-probes`;
  - account access negando tentativa;
  - env runtime ausente quando exigido.
- o plano final pode usar `postSelected` como fallback quando o primario foi bloqueado por health/probe runtime;
- o fallback e marcado com `runtime_selector_fallback:postSelected`;
- o harness live agora grava `live_tool_protocol/live_ask_user` apenas quando:
  - o full-turn vivo foi realmente tentado; ou
  - o blocker foi `byok-live-tool-protocol-missed`.
- blockers de preflight, admission, quota e provider nao gravam falso `live_ask_user=failed`;
- o registro incorreto de `repo_agent|mistral|devstral-medium-2507` criado durante a transicao foi limpo.

Evidencia live gravada:

Artefato:

- `artifacts/terminal-live/2026-05-28T15-11-12-447Z/summary.md`.

Resultado:

- status `BLOCKED`;
- blocker `byok-live-tool-protocol-missed`;
- rota `code|nvidia-nim|openai/gpt-oss-120b`;
- `live_tool_protocol=failed`;
- `live_ask_user=failed`;
- health record gravado no arquivo operacional;
- mirror SQLite executado em seguida.

Mirror apos live:

- `runtimeRows=5183`;
- `healthObservations=2487`;
- `runtimeProbeRuns=109`;
- `runtimeProbeResults=2587`;
- snapshot: `artifacts/model-gateway-runtime-health-post-live/2026-05-28T15-11-live-protocol-health-recorded/latest.json`.

Evidencia de selector:

- apos gravar a falha live, NVIDIA deixou de ser selecionado para o handoff;
- Chutes `moonshotai/Kimi-K2.5-TEE` foi tentado e falhou com `402 credits`;
- Groq `llama-3.1-8b-instant` foi tentado e falhou com `413/TPM rate-limit`;
- Zai `glm-4-32b-0414-128k` foi tentado e falhou por timeout;
- Mistral `devstral-medium-2507` passou chat selector, mas falhou no agent preflight com `429`;
- o proximo plano selecionou Zai `glm-4.5-flash`.

Evidencia preflight Mistral:

Artefato:

- `artifacts/terminal-live/2026-05-28T15-24-07-146Z/summary.md`.

Resultado:

- status `BLOCKED`;
- blocker `byok-preflight-probe-failed`;
- chat/stream/json passaram;
- vision falhou `HTTP 400` como capability separada;
- agent preflight falhou com `429`;
- nenhum turno vivo foi enviado;
- apos correcao, esse caso nao deve gravar `live_ask_user=failed`.

Validacoes executadas:

- `npm run model-gateway:typecheck`;
- `npm run model-gateway:lint`;
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/model-gateway/test_model_gateway_provider_health.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`;
- `node --check scripts/model-gateway-runtime-selector.mjs`;
- `node --check scripts/copilot/run-terminal-llm-b-live-test.mjs`.

Impacto arquitetural:

- metadados fortes nao bastam para runtime se a account/key falha;
- health global agora protege rotas especificas do mesmo provider/model;
- preflight e live protocol proof ficam separados;
- o selector agora tem memoria operacional para desviar de falhas reais;
- o proximo trabalho deve consolidar account/provider-level blocking para falhas de cota/credito repetidas.

Lacunas abertas apos Mudanca 89:

- consolidar bloqueio por provider/account quando varios modelos do mesmo provider falham por credito/cota;
- classificar melhor `429` sem body de Mistral como rate-limit em vez de provider.unknown;
- impedir que preflight agent failed faca o cockpit narrar texto ambiguo de sucesso;
- executar probe bounded para Zai `glm-4.5-flash`;
- se Zai passar, executar full-turn live;
- se Zai falhar, continuar a cadeia ate uma rota com agent preflight positivo;
- avaliar modelos NVIDIA alternativos em probes menores sem repetir o live de `openai/gpt-oss-120b`.

### Mudanca 90 - Cooldown provider-scoped e overlays account-wide

Status: implementado em 2026-05-28.

Problema identificado apos a cadeia de probes live:

- Zai apresentou timeouts sucessivos em modelos diferentes:
  - `glm-4-32b-0414-128k`;
  - `glm-4.5-flash`;
  - `glm-4.6v-flash`;
  - `glm-4.6v-flashx`.
- mesmo assim, o runtime selector continuava escolhendo outro modelo Zai ainda sem health proprio;
- a memoria operacional era forte para `provider/model`, mas fraca para `provider/account`;
- isso consumia tempo e podia gastar quota ou latencia em tentativas obviamente pouco promissoras.

Regra consolidada:

- metadado canonico continua imutavel;
- falha runtime de um modelo continua registrada como health de modelo;
- falhas temporarias repetidas em varios modelos do mesmo provider geram cooldown provider-scoped;
- credito, auth e rate-limit podem gerar overlay account-wide no runtime selector;
- nenhum desses estados vira fato permanente do catalogo.

Implementacao:

- `evaluateGatewayProviderHealthCooldown` em `routing/health-routing.js`;
- `MODEL_GATEWAY_PROVIDER_COOLDOWN_FAILURE_KINDS`;
- cooldown default:
  - falhas `timeout`;
  - falhas `network`;
  - falhas `upstream`;
  - falhas `model-or-route` quando aparecem em modelos distintos do mesmo provider, pois isso normalmente indica base URL,
    catalogo remoto ou acesso da key incompatível com a rota OpenAI-normalizada atual;
  - janela curta de 15 minutos;
  - minimo de 2 modelos distintos falhando;
  - sucesso posterior do provider desfaz o cooldown.
- `scoreGatewayModelCandidate` rejeita candidatos de provider em cooldown quando recebe `runtimeHealthRecords`;
- `buildModelGatewayRuntimeSelectorPlan` tambem bloqueia a rota final se a policy ainda trouxer provider em cooldown;
- o plano expõe `providerCooldownBlockedCount`;
- a rota bloqueada inclui:
  - `blocked:provider_health_cooldown:<kinds>`;
  - `wait_for_provider_cooldown_or_probe_different_provider`.

Overlay account/key:

- `deriveModelGatewayRuntimeAccountOverlaysFromHealth` agora aceita `accountWideFailureKinds`;
- o runtime selector usa `auth`, `credits` e `rate-limit` como account-wide;
- isso evita repetir modelos do mesmo provider quando a propria key/conta ja demonstrou bloqueio externo;
- por default historico, a funcao continua model-scoped quando a opcao nao e informada.

Evidencia que motivou:

- Chutes falhou com `402 credits`;
- Groq falhou com limite de tokens/rate;
- Zai falhou repetidamente por timeout;
- Mistral passou chat selector, mas falhou agent preflight com `429`;
- NVIDIA falhou live protocol `ask_user`.

Efeito esperado:

- o selector para de trocar apenas o modelo quando o problema observado e do provider/conta;
- reduzimos tentativas redundantes;
- preservamos o catalogo de metadados;
- a selecao pre-runtime continua barata;
- a etapa runtime continua separada e audivel.

Lacunas restantes apos Mudanca 90:

- classificar melhor `429` sem body de Mistral;
- calibrar TTL por provider e failure kind;
- expor cooldown provider-scoped no cockpit `/byok health`;
- registrar no summary live quando o provider foi pulado por cooldown;
- continuar a cadeia para achar uma rota com chat e agent preflight positivos antes do full-turn.

### Mudanca 91 - Prova live canônica e hardening do harness

Status: implementado em 2026-05-28.

Durante a investigacao foi feita uma chamada equivocada:

- `node scripts/copilot/run-terminal-llm-b-live-test.mjs --help`;
- o harness nao tratava `--help`;
- por isso iniciou um teste live real em vez de imprimir uso.

Correcao:

- o harness agora trata `--help` e `-h`;
- imprime as flags canonicas;
- encerra com `exit 0`;
- nao abre terminal;
- nao consome runtime;
- nao envia turno ao provider.

Evidencia do help:

- `node --check scripts/copilot/run-terminal-llm-b-live-test.mjs`;
- `node scripts/copilot/run-terminal-llm-b-live-test.mjs --help`;
- saida mostra `--byok-real-route-profile`, `--byok-real-route-fallback-profiles`, `--byok-real-route-execute` e demais flags.

Evidencia live gerada pelo acionamento acidental:

- artefato: `artifacts/terminal-live/2026-05-28T15-45-41-220Z/summary.md`;
- status: `PASS`;
- provider ativo: `kilo-code`;
- modelo ativo: `kilo-auto/free`;
- binding: BYOK ready;
- `report_intent` executou como tool real;
- `read_file_content` executou como tool real;
- `ask_user` apareceu como interação real do SDK;
- resposta `SIM` foi registrada como resposta humana;
- marcador final `POST-ASK-CANONICAL-FINAL: usuário confirmou SIM` apareceu apenas apos resposta;
- SSE conectado;
- eventos monotônicos;
- erros rastreados: `0`;
- export gerado.

O que essa evidencia cobre:

- terminal live;
- delta streaming;
- `assistant.message`;
- tool telemetry;
- user input/ask_user real;
- export;
- SSE;
- health terminal.

O que essa evidencia nao cobre:

- handoff via runtime selector;
- rota `zai/glm-4.7-flash`;
- full-turn BYOK usando a rota selecionada pelo gateway;
- agent preflight da rota selecionada pelo gateway;
- persistencia `live_tool_protocol/live_ask_user` para a rota `zai`.

Falhas descobertas no handoff real:

- o harness exigia `exit 0` do runtime selector mesmo quando havia fallback selecionado;
- o CLI do selector pode sair com falha global se alguns perfis ficaram bloqueados;
- isso nao significa que a rota de fallback e inutilizavel;
- o harness agora considera `selectedRoute` e `execution.ok` para aceitar fallback;
- se a rota obrigatoria nao existir, o harness neutraliza `COPILOT_BYOK_PROFILE`, `COPILOT_BYOK_PROVIDER_PRESET`, `COPILOT_BYOK_MODEL` e `COPILOT_BYOK_BASE_URL` herdados;
- assim ele nao cai silenciosamente no provider default do `.env.local`.
- o harness agora bloqueia antes de iniciar o terminal quando a rota obrigatoria esta indisponivel;
- o blocker prioriza `summary.execution.error` do runtime selector em vez de uma linha genérica de stderr.

Evidencia apos a correcao:

- `artifacts/terminal-live/2026-05-28T16-00-27-712Z/summary.md`;
- status `BLOCKED`;
- blocker `byok-runtime-selector-route-unavailable`;
- terminal nao iniciou;
- SSE nao conectou;
- default Kilo nao foi usado;
- redacted JSON preservou o erro do runtime selector;
- a rota obrigatoria ficou sem identidade porque o selector falhou por timeout antes do live.

Evidencia de selector apos Mudanca 90:

- `zai/glm-4.7-flash` passou probe bounded simples;
- o sucesso posterior do provider limpou o cooldown temporario;
- o runtime selector passou a promover `zai/glm-4.7-flash` como `post_runtime_proved`;
- todos os perfis ficaram selecionados no plano apos a prova.
- em seguida, `repo_agent|zai|glm-4.7-flash` e `repo_agent|zai|glm-4.7-flashx` falharam por timeout;
- o limiar default foi reduzido de 3 para 2 modelos distintos para evitar insistir no mesmo provider durante handoff live.

### Mudanca 92 - Alternativas reais, diversidade de fallback e health cross-profile

Status: implementado em 2026-05-28.

Problema identificado nos probes de handoff:

- o runtime selector tinha apenas a rota vencedora por perfil;
- quando `repo_agent`, `code` e `tool_agent` apontavam para o mesmo provider/model, o fallback por perfil nao era fallback real;
- uma falha `code|cerebras|zai-glm-4.7` nao bloqueava automaticamente `repo_agent|cerebras|zai-glm-4.7`;
- isso permitia repetir o mesmo provider/model em outro perfil, gastando tempo e quota em uma rota ja provada ruim;
- rotas `model-or-route` da NVIDIA tambem mostraram que catalogo remoto e acesso real da key podem divergir.

Implementacao:

- `auditModelGatewaySelection` agora preserva `candidateAlternates` por perfil;
- `compareModelGatewaySelectionAudits` carrega alternativas pre-runtime e post-runtime;
- `resolveModelGatewaySelectionPolicy` entrega essas alternativas ao runtime selector;
- `buildModelGatewayRuntimeSelectorPlan` avalia `selected`, `postSelected`, `preSelected` e alternativas rankeadas;
- o plano prefere o primeiro candidato nao bloqueado por:
  - account access;
  - env runtime;
  - health de chat/agent;
  - probes live bloqueantes;
  - cooldown provider-scoped.
- entre perfis, o plano evita repetir `provider/model`;
- quando possivel, tambem evita repetir provider, para que `fallback-profiles` representem familias distintas;
- `readGatewayModelHealthFromRecords` agora prefere:
  - health exato do perfil;
  - health global sem perfil;
  - health cross-profile do mesmo provider/model.

Efeito esperado:

- fallback por perfil vira fallback operacional, nao apenas outra etiqueta para a mesma rota;
- falha de runtime de um provider/model passa a proteger todos os perfis;
- live harness recebe uma rota mais honesta ou um bloqueio claro;
- o catalogo canonico continua limpo, pois tudo ocorre na camada volátil de health/selection.

Evidencia local apos Mudanca 92:

- `model-gateway-runtime-selector --execute` tentou tres rotas distintas no mesmo comando:
  - `repo_agent|zai|glm-4.5-air`;
  - `code|cerebras|zai-glm-4.7`;
  - `tool_agent|zai|glm-4.6v`.
- as tres falharam por timeout e foram persistidas em runtime health;
- o dry-run seguinte passou a bloquear todas as rotas env-ready conhecidas por `chat_health_failed`;
- nenhum full live com llm-b deve iniciar enquanto o selector nao produzir rota executavel.

Lacunas restantes apos Mudanca 92:

- melhorar a explicabilidade quando todas as alternativas sao bloqueadas;
- expor contagem de alternativas avaliadas e principais motivos de bloqueio por perfil;
- separar claramente `sem rota executavel agora` de `catalogo sem modelos`;
- investigar se devemos ter TTL model-scoped para `timeout` sem sucesso posterior;
- ampliar fornecedores env-ready antes de tentar novo full live.

Proximo passo correto:

- rodar o harness com:
  - `--byok-real`;
  - `--byok-real-route-profile=repo_agent`;
  - `--byok-real-route-fallback-profiles=code,tool_agent`;
  - `--byok-real-route-execute`;
  - `--byok-real-route-selection-policy=prefer_runtime_proved`;
  - `--byok-real-route-timeout-ms=20000`.
- se passar preflight, executar full-turn;
- se falhar em agent/tool protocol, registrar health separado;
- se passar, registrar `live_tool_protocol=ok` e `live_ask_user=ok`.

## 22. Fim Do Documento Inicial

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
