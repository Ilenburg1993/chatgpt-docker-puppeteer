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
- [x] Health observations usadas por codigo.
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

O dry-run continua sem persistir route decisions.

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
