# Canonical Model Gateway / BYOK Roadmap

Data: 2026-05-24
Escopo: `src/copilot`, GitHub Copilot SDK 0.3.0, BYOK universal, seleção de modelos, probes, sessões e observability.

## 1. Diagnóstico

O relatório `src/copilot/docs/LLM_ROUTER_BYOK_ARCHITECTURE_AUDIT_2026-05-24.md` acerta o ponto central: o BYOK atual
tem partes valiosas, mas elas estão distribuídas em camadas que não devem ser a fonte de verdade de roteamento.

Hoje há quatro focos diferentes:

- `sdk/session/provider.js`: sabe resolver env, presets, `ProviderConfig`, discovery de modelos e `ModelInfo`.
- `sdk/models/*`: possui registry/selector/stats por `modelId`, ainda sem identidade provider-model.
- `terminal/byok/*`: classifica falhas e aplica admissão/orçamento terminal.
- `model-gateway/health/*`: classifica falhas externas e persiste health operacional provider/model.
- `model-gateway/probes/*`: roda probes descartáveis chat/agent/streaming/JSON, incluindo delta, tools e `ask_user`.

Isso funciona, mas cria uma ambiguidade arquitetural: terminal e SDK começam a possuir fatos de provider/model que deveriam
pertencer a um domínio próprio.

## 2. Validação crítica da auditoria base

### Validado

- O SDK deve permanecer a fronteira vanilla: criar sessão, retomar sessão, operar `ProviderConfig`, eventos, tools,
  handlers e `ModelInfo`.
- OpenRouter deve ser um adapter comum, não a fundação do sistema.
- A identidade canônica deve ser `providerId + providerModel`, não apenas `modelId`.
- `onListModels()` deve ser uma projection do registry, não um discovery avulso amarrado ao env ativo.
- Capabilities precisam carregar provenance e confiança: `static_seed`, `catalog`, `manual`, `probe_verified`,
  `probe_failed`.
- Probes devem alterar health/capabilities com rastreabilidade.
- Secrets não podem entrar em registry, logs, docs gerados, health ou traces.

### Refinado

- A migração não deve mover tudo de uma vez. O caminho correto é criar `model-gateway` como domínio canônico, importar o
  BYOK atual via compat layer e só então trocar consumidores.
- `VaultSecretRegistry` é desejável, mas não é fase inicial. Primeiro vem `EnvSecretRegistry` e redaction única.
- `OpenAICompatibleAdapter` deve ser base de transporte, não uma classificação suficiente de capability.
- Catálogos remotos não são verdade: eles são evidência. Probe real e override manual têm precedência.

### Rejeitado ou adiado

- Observability não deve inferir capability nem decidir roteamento. Ela deve receber eventos estabilizados do gateway.
- Terminal não deve manter health permanentemente como source of truth; durante migração ele pode renderizar o health
  legado, mas o destino é `model-gateway/health`.
- `sdk/session/provider.js` não deve importar `model-gateway`, pois isso inverteria a fronteira. A ponte deve ficar acima
  do SDK, em `config`, `agent` ou `model-gateway/session`.

## 3. Situação ideal

`src/copilot/model-gateway` passa a ser o domínio canônico para:

- Provider records.
- Model records.
- Provider/model identity.
- Secret refs redigidas.
- Catalog importers.
- Probes descartáveis.
- Health de provider/model.
- Failure taxonomy BYOK.
- Policy/routing.
- Usage ledger e custo estimado.
- Projection para `ModelInfo` e `ProviderConfig`.
- Eventos estabilizados para observability.

O SDK continua recebendo apenas:

- `model`: ID provider-local concreto.
- `provider`: `ProviderConfig` validado.
- `modelCapabilities`: override compatível com SDK.
- `onListModels`: projection segura do gateway.

O terminal continua sendo:

- cockpit de operador;
- renderer de decisões, health, probes e errors;
- executor de comandos;
- nunca source of truth de provider/model.

Observability passa a gravar eventos como:

- `model_gateway:registry:snapshot`;
- `model_gateway:provider:imported`;
- `model_gateway:model:imported`;
- `model_gateway:route:decision`;
- `model_gateway:probe:completed`;
- `model_gateway:provider:failure`.

Ela registra contadores, gauges, traces e JSONL, mas não recalcula a decisão.

## 4. Arquitetura alvo

```txt
src/copilot/model-gateway/
  contracts/
    records.js
  registry/
    model-registry.js
    env-byok-compat-importer.js
    snapshot.js
  providers/
    ProviderAdapter.js
    OpenAICompatibleAdapter.js
    OpenRouterAdapter.js
    OllamaAdapter.js
    AnthropicAdapter.js
    GeminiAdapter.js
  secrets/
    EnvSecretRegistry.js
    redaction.js
  probes/
    ProbeEngine.js
    basic-text.js
    streaming.js
    tools.js
    ask-user.js
    json-schema.js
    vision.js
  health/
    ProviderHealthStore.js
    ProviderFailureClassifier.js
  routing/
    PolicyEngine.js
    scoring.js
    fallback.js
  session/
    copilot-model-projection.js
    ProviderConfigBridge.js
    CopilotSessionFactory.js
  observability/
    events.js
```

### 4.1. Catálogo universal normalizado

A investigação de 2026-05-24 mostrou que o registry atual é bom como **projection operacional**, mas ainda não é forte
o bastante como banco universal de modelos. O problema não é só “listar modelos”: cada provider expõe um subconjunto
diferente de fatos.

Exemplos confirmados em documentação oficial:

- OpenAI expõe `GET /v1/models`, mas esse endpoint é essencialmente identidade/listagem; a documentação de modelos e
  pricing precisa complementar capabilities e custo.
- OpenRouter expõe `/api/v1/models` com metadata rica: `architecture`, `pricing`, `top_provider`,
  `per_request_limits`, `supported_parameters`, `default_parameters` e datas de expiração/depreciação.
- Anthropic expõe API de lista de modelos, mas capability fina ainda precisa vir de docs/probes.
- Gemini `models.list`/`models.get` retorna `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods`,
  `thinking`, defaults e limites de parâmetros como temperature/topP/topK.
- Mistral `GET /v1/models` retorna `capabilities`, `max_context_length`, aliases, deprecation e replacement model.
- Groq usa endpoint OpenAI-compatible `/openai/v1/models` para modelos ativos; a página de modelos complementa limites.
- Ollama local usa `/api/tags` para modelos instalados e `/api/show` deve enriquecer detalhes de template/parameters.
- Hugging Face Inference Providers e Cloudflare Workers AI expõem catálogos públicos ricos em tabelas/docs, incluindo
  provider real, preço, contexto, latency/throughput, tools/structured outputs e task type.
- Cerebras tem `/v1/models` mínimo e catálogo/documentação pública mais rica para parâmetros/speed/depreciação.

Conclusão: o banco canônico não deve armazenar apenas `ModelRecord` achatado. Ele precisa de duas camadas:

1. **Evidence ledger imutável ou append-only**: fatos por campo, fonte, provider, modelo, confiança, timestamps e payload
   bruto sanitizado. Essa camada aceita conflito: OpenRouter pode dizer que um modelo tem tools, Hugging Face pode dizer
   que uma rota específica não tem, e o probe local pode provar o contrário para nossa key.
2. **Canonical projection**: visão atual normalizada por `providerId + providerModel + routeProfile`, usada como primeiro
   filtro do roteador antes de probes/runtime.

Esse desenho evita três erros clássicos:

- tratar endpoint `/models` pobre como verdade suficiente;
- sobrescrever metadata boa com uma fonte mais recente porém menos informativa;
- misturar capability do **modelo base** com capability da **rota provider/model**.

### 4.2. Metamodelo de evidências

Campos novos planejados, além de `ProviderRecord`/`ModelRecord` atuais:

```txt
ProviderCatalogSource
  id
  providerId
  kind: api | docs_markdown | html_table | static_seed | local_daemon | aggregator | manual | probe
  url | command | envRequirements
  authMode: none | api_key | bearer | account_scoped | local
  refreshPolicy: on_boot | scheduled | manual | cache_only
  ttlSeconds
  parserId
  trustTier

ModelMetadataEvidence
  evidenceId
  providerId
  providerModel
  routeProfile
  fieldPath
  value
  normalizedValue
  sourceId
  sourceKind
  confidence: unknown | heuristic | static_seed | catalog | docs | authenticated_catalog | manual | probe_verified | probe_failed
  observedAt
  expiresAt
  rawPayloadRef
  redactionStatus

ModelRouteOption
  providerId
  providerModel
  routeProfile
  selectorKind: exact_model | provider_auto | aggregator_auto | cheapest | fastest | preferred_provider | fallback_chain
  selectorSyntax
  providerSpecific
  normalizedPolicy

CanonicalModelProjection
  providerId
  providerModel
  routeProfile
  displayName
  lifecycle
  aliases
  family
  modalities
  capabilities
  supportedParameters
  unsupportedParameters
  limits
  pricing
  rateLimits
  dataPolicy
  license
  provenanceByField
  confidenceByField
  routingHints
```

Para listas imensas de providers, a projection deve ir para SQLite em vez de depender apenas de JSON:

```txt
data/copilot/model-gateway/catalog.sqlite
  catalog_import_runs
  catalog_sources
  providers
  provider_aliases
  models
  model_aliases
  model_routes
  model_capability_facts
  model_parameter_facts
  model_limit_facts
  model_price_facts
  model_lifecycle_facts
  model_probe_results
  canonical_model_projection
```

`registry.json` continua útil como export/snapshot redigido para debug e operador, mas o banco completo e normalizado
deve ser SQLite.

### 4.3. Precedência de fontes

A merge policy deve ser por campo, não por record inteiro:

```txt
manual override
  > probe_verified/probe_failed
  > authenticated provider catalog
  > provider public catalog/docs oficiais
  > aggregator catalog route-specific
  > static seed mantida pelo repo
  > heuristic/naming inference
```

Regras importantes:

- Capability agentic (`tools`, streaming delta, JSON schema, forced tool choice, parallel tool calls, vision) só vira
  `probe_verified` depois de probe real naquele `providerId|providerModel|routeProfile`.
- Catálogo remoto pode habilitar o candidato como "provável", mas não deve promovê-lo sozinho para `repo_agent` ou
  `tool_agent` se `requireAgentProbeOk=true`.
- Falha de probe não apaga o fato de catálogo; ela cria evidência concorrente com maior precedência operacional.
- Dados caros/instáveis como preço e depreciação precisam de `expiresAt` curto.
- Nomes como `:free`, `vision`, `instruct`, `coder`, `thinking`, `reasoning`, `latest` podem gerar heurísticas, mas
  sempre com confidence baixa.

### 4.4. Extração criativa de metadata

O gateway deve combinar importers especializados:

1. **API importers autenticados**: OpenAI, Anthropic, Gemini, Mistral, Groq, Cerebras, Ollama local/cloud, etc.
2. **Rich aggregator importers**: OpenRouter, Hugging Face Inference Providers, Cloudflare unified catalog. Eles ajudam
   a preencher preço/contexto/capabilities, mas a provenance deve deixar claro que são agregadores.
3. **Docs/Markdown table importers**: para páginas oficiais que expõem capabilities melhor que API, como Cloudflare
   Workers AI e páginas de overview de provider.
4. **Local daemon importers**: Ollama `/api/tags` + `/api/show`, vLLM/LiteLLM/OpenAI-compatible `/v1/models`,
   containers NIM self-hosted.
5. **Probe importers**: probes de chat, streaming, tools, JSON schema, vision, context-window, parameter fuzzing e
   error taxonomy.
6. **Heuristic enrichers**: parser de nomes e famílias para inferir versão, tamanho, quantização, free tier, preview,
   deprecation provável e especialização (`coder`, `rerank`, `embed`, `image`, `tts`, `asr`).

O pipeline recomendado:

```txt
fetch source -> sanitize raw payload -> parse source rows -> emit evidence facts -> merge field-wise -> write projection
    -> diff previous projection -> emit model_gateway:catalog:* events -> suggest probes for high-value unproved models
```

### 4.5. Seleção automática dos providers

Vários providers já têm seleção automática própria. O nosso roteador não deve lutar contra isso; ele deve modelar essa
capacidade explicitamente:

- **Exact model**: `providerModel` concreto, sem auto routing.
- **Provider alias**: `latest`, `default`, `-latest`, aliases de família ou modelos versionados sem data.
- **Aggregator auto**: OpenRouter pode escolher upstream/provider para um mesmo model id; Hugging Face permite sufixos
  de provider e rotas como `:fastest`, `:cheapest` ou provider preferido; Cloudflare AI Gateway pode aplicar caching,
  retries e fallback em uma camada acima do provider.
- **Local auto**: Ollama/vLLM/LiteLLM podem ter tags locais que apontam para pesos diferentes ao longo do tempo.
- **Fallback chain nosso**: sequência auditável escolhida pelo `PolicyEngine`.

Cada opção precisa virar `ModelRouteOption`, com `selectorKind`, `selectorSyntax`, riscos e custo esperado. Assim, o
roteador consegue decidir se usa:

- `openrouter:model` com roteamento automático;
- `huggingface:model:provider`;
- provider local privado;
- fallback próprio multi-provider;
- ou modelo exato sem intermediário.

Essa é a peça que transforma "lista imensa de modelos" em banco útil: cada linha deixa de ser só um modelo e passa a ser
um **candidato de rota** com metadados, proveniência, risco e provas.

## 5. Roadmap

### Faixa A — Fundação e limites

- [x] Criar `src/copilot/model-gateway`.
- [x] Criar `ModelRecord` e `ProviderRecord` serializáveis sem segredo.
- [x] Criar `ModelGatewayRegistry` in-memory.
- [x] Criar `EnvByokCompatImporter` consumindo o BYOK atual.
- [x] Criar projection `ModelRecord -> ModelInfo`.
- [x] Criar eventos estabilizados de gateway.
- [x] Integrar catálogo de eventos e métricas observacionais.
- [x] Documentar boundary em `README.md`.
- [x] Testar fundação com typecheck estrito, lint focado e suíte unitária Copilot.

### Faixa B — Registry e projections operacionais

- [x] Expor snapshot do gateway no `/byok` sem trocar o fluxo legado de decisão.
- [x] Criar store JSON em `data/copilot/model-gateway/registry.json`.
- [x] Persistir records com `schemaVersion`.
- [x] Criar `RegistryProjection` para operador.
- [x] Trocar `/byok models` para ler projection do gateway, mantendo fallback legado.
- [x] Fazer `onListModels()` aceitar projection do gateway sem `sdk/session` importar gateway.
- [x] Adicionar snapshot de providers e models no `/health` e `/now`.

### Faixa C — Secrets e redaction

- [x] Criar `SecretRegistry`.
- [x] Criar `EnvSecretRegistry`.
- [x] Criar redaction canônica do gateway para textos e records aninhados.
- [x] Fazer `EnvByokCompatImporter` publicar apenas refs configuradas, nunca valores.
- [x] Classificar refs de autenticação em `apiKeyRefs` e `bearerTokenRefs` no record seguro de provider.
- [x] Centralizar redaction hoje duplicada entre `provider.js` e terminal health.
- [x] Garantir que snapshots e events nunca carreguem `apiKey`, `bearerToken` ou headers sensíveis.
- [x] Criar teste de regressão que falha se uma key aparece serializada.

### Faixa D — Provider adapters

- [x] Extrair `OpenAICompatibleAdapter`.
- [x] Cobrir `OpenAICompatibleAdapter` com teste de bridge record seguro -> override SDK.
- [x] Extrair `OpenRouterAdapter`.
- [x] Extrair `OllamaAdapter`.
- [x] Extrair `GeminiAdapter`.
- [x] Extrair `AnthropicAdapter`.
- [x] Criar registry de adapters do gateway.
- [x] Cobrir adapters de Kilo, Groq, Mistral, Hugging Face, Cloudflare Workers AI, NVIDIA NIM, Cerebras, Chutes e Z.AI.
- [x] Fazer novo provider ser adicionável sem editar `sdk/session/provider.js`.
- [x] Manter presets antigos como compat layer durante transição.

### Faixa E — Probes

- [x] Promover probe chat descartável para `model-gateway/probes`.
- [x] Promover probe agente descartável com tools + `ask_user`.
- [x] Remover wrappers legados `probeTerminalConfiguredByok*` do frontend terminal.
- [x] Adicionar probe streaming/delta.
- [x] Adicionar probe JSON.
- [x] Expor `/byok probe streaming` e `/byok probe json` sem degradar health de chat/agente.
- [x] Criar evento e métricas canônicas para conclusão de probes.
- [x] Emitir `model_gateway:probe:completed` pelo `/byok probe` via EventBus.
- [ ] Adicionar probe de vision quando houver fixtures seguras.
- [x] Registrar cada probe em health e observability.
- [x] Diferenciar `catalog says` de `runtime proved`.

### Faixa F — Health e failure taxonomy

- [x] Migrar `terminal/state/byok-provider-health.js` para `model-gateway/health`.
- [x] Migrar `terminal/byok/provider-failure.js` para classifier compartilhado.
- [x] Separar falhas `auth`, `credits`, `rate-limit`, `model-or-route`, `timeout`, `network`, `upstream`, `unknown`.
- [x] Persistir health por `providerId|providerModel|routeProfile`.
- [x] Usar health no roteamento.

### Faixa G — Policy engine

- [x] Definir task profiles: `cheap_chat`, `code`, `repo_agent`, `tool_agent`, `json_extraction`, `vision`,
   `deep_reasoning`, `local_private`.
- [ ] Criar scoring por capability obrigatória.
- [ ] Incluir custo, latência, contexto, confidence, health, allow/block provider.
- [ ] Criar fallback auditável.
- [ ] Explicar decisão ao operador com candidatos recusados e razão.

### Faixa H — Terminal UX

- [ ] Comandos:
   - `/providers list`
   - `/providers health`
   - `/models list`
   - `/models route <profile>`
   - `/byok probe <model>`
   - `/byok recommend <profile>`
- [ ] Filtros por:
   - free/paid/unknown;
   - vision;
   - tools;
   - streaming;
   - context window;
   - probe status;
   - provider.
- [ ] Mostrar origem dos metadados e confiança.
- [ ] Mostrar por que um modelo foi rejeitado.

### Faixa I — Observability

- [x] Gateway emite eventos estabilizados.
- [x] Event catalog inclui `model-gateway-events`.
- [x] Metrics collector registra counters/gauges de snapshot, route, probe e failure.
- [ ] Usage ledger registra `sessionId`, `providerId`, `modelId`, `routeProfile`, tokens, custo estimado, fallback e failure.
- [ ] Traces incluem `llm.provider`, `llm.model`, `llm.gateway.model_id`, `llm.route.decision_id`.
- [x] Observability não lê secrets nem raw provider payload para inferir decisão.

### Faixa J — Depreciação controlada

- [ ] `sdk/session/provider.js` mantém `ProviderConfig`, validação e compat exports.
- [ ] Presets migram para gateway.
- [ ] Discovery migra para importers.
- [ ] `terminal/byok/*` vira renderer/command layer.
- [ ] Antigos exports recebem marcação de deprecated apenas quando consumidores já migraram.

### Faixa K — Banco universal de catálogo e evidências

- [ ] Criar `catalog/contracts` com `ProviderCatalogSource`, `ModelMetadataEvidence`, `ModelRouteOption` e
  `CanonicalModelProjection`.
- [ ] Criar store SQLite `data/copilot/model-gateway/catalog.sqlite`.
- [ ] Manter `registry.json` como export/snapshot redigido, não como banco completo.
- [ ] Persistir import runs com status, duração, fonte, quantidade de rows, erros sanitizados e diff gerado.
- [ ] Persistir raw payload sanitizado por hash/ref, sem segredos nem headers sensíveis.
- [ ] Criar merge field-wise com `provenanceByField` e `confidenceByField`.
- [ ] Implementar precedência por campo: manual > probe > authenticated catalog > official docs > aggregator >
  static_seed > heuristic.
- [ ] Criar testes que provem que fonte mais pobre e mais recente não apaga metadata rica de fonte anterior.
- [ ] Criar teste de regressão para nunca serializar segredo no catalog DB, snapshot ou evento.

### Faixa L — Importers de catálogos oficiais e agregadores

- [ ] Criar interface `CatalogImporter`:
  - `id`;
  - `providerId`;
  - `sourceKind`;
  - `requiresAuth`;
  - `fetchRaw()`;
  - `parseRows()`;
  - `toEvidenceFacts()`.
- [ ] Implementar `OpenAIModelsImporter` para `/v1/models` + seeds oficiais complementares.
- [ ] Implementar `OpenRouterModelsImporter` para `/api/v1/models`, preservando `supported_parameters`, pricing,
  context, top provider e per-request limits.
- [ ] Implementar `AnthropicModelsImporter` para lista oficial de modelos e docs complementares.
- [ ] Implementar `GeminiModelsImporter` para `models.list`/`models.get`, capturando token limits,
  `supportedGenerationMethods`, `thinking` e parâmetros.
- [ ] Implementar `MistralModelsImporter` para `/v1/models`, capturando capabilities, aliases,
  `max_context_length`, deprecation e replacement.
- [ ] Implementar `GroqModelsImporter` para `/openai/v1/models` e docs de limites.
- [ ] Implementar `OllamaCatalogImporter` para `/api/tags` + `/api/show`.
- [ ] Implementar `HuggingFaceInferenceProvidersImporter` para catálogo de providers/modelos/rotas.
- [ ] Implementar `CloudflareWorkersAiCatalogImporter` para unified catalog/Workers AI docs.
- [ ] Implementar `CerebrasModelsImporter` para `/v1/models` + catálogo público.
- [ ] Implementar `NvidiaNimCatalogImporter` para docs/API catalog quando disponível.
- [ ] Permitir importers `OpenAICompatibleGenericImporter` para vLLM, LiteLLM, Chutes, Z.AI, Kilo e endpoints locais.

### Faixa M — Normalização, enriquecimento e heurísticas controladas

- [ ] Criar normalizador de modalidades: text, image, audio, video, pdf, embedding, rerank, asr, tts, image-generation.
- [ ] Criar normalizador de capabilities agentic: streaming, tools, forcedToolChoice, parallelToolCalls, JSON mode,
  JSON schema, structured outputs, reasoning effort, reasoning budget, code execution, web/search grounding.
- [ ] Criar normalizador de limites: context window, max output, max request, TPM, RPM, daily requests e burst.
- [ ] Criar normalizador de pricing: input/output/cache/read/write/request/image/audio, moeda e unidade.
- [ ] Criar normalizador de lifecycle: active, preview, beta, deprecated, retired, replacement, expiresAt.
- [ ] Criar parser de aliases/versionamento (`latest`, datas `YYYY-MM`, famílias, tamanho, quantização).
- [ ] Criar heuristics engine com confidence baixa e sempre sobrescrevível por catálogo/probe/manual.
- [ ] Criar detector de conflitos por campo e comando de operador para listar conflitos de metadata.

### Faixa N — Modelagem de auto-seleção e rotas

- [ ] Criar `ModelRouteOption` para modelar rotas exatas, aliases, provider-auto, aggregator-auto, cheapest, fastest,
  preferred-provider e fallback-chain.
- [ ] Representar seleção automática de OpenRouter como rota própria, sem apagar provider upstream quando conhecido.
- [ ] Representar sufixos/seletores de Hugging Face Inference Providers, incluindo provider explícito e políticas de
  `fastest`/`cheapest` quando publicadas.
- [ ] Representar Cloudflare AI Gateway/Workers AI como camada de rota com cache, retry, rate-limit e fallback quando
  configurado.
- [ ] Representar tags locais de Ollama/vLLM/LiteLLM como aliases instáveis com digest/hash quando disponível.
- [ ] Fazer `PolicyEngine` escolher entre rota exata, auto-provider e fallback próprio com justificativa auditável.
- [ ] Expor no terminal por que uma rota automática foi aceita ou rejeitada.

### Faixa O — Refresh, diffs e governança operacional

- [ ] Criar `model-gateway catalog refresh` programático e comando terminal correspondente.
- [ ] Criar refresh incremental por provider, com cache TTL por fonte.
- [ ] Criar diff entre snapshots: modelos novos, removidos, deprecados, preço alterado, limits alterados, capabilities
  alteradas.
- [ ] Emitir eventos:
  - `model_gateway:catalog:import_started`;
  - `model_gateway:catalog:import_completed`;
  - `model_gateway:catalog:model_added`;
  - `model_gateway:catalog:model_changed`;
  - `model_gateway:catalog:model_removed`;
  - `model_gateway:catalog:conflict_detected`.
- [ ] Sugerir probes automaticamente para modelos novos de alto valor ou com capability agentic provável.
- [ ] Nunca trocar modelo ativo automaticamente por causa de catálogo novo; gerar recomendação auditável.

### Faixa P — UX de exploração do catálogo universal

- [ ] `/models catalog refresh [provider]`.
- [ ] `/models catalog diff`.
- [ ] `/models search <query>`.
- [ ] `/models explain <provider:model>`.
- [ ] `/models conflicts`.
- [ ] `/models route <profile> --show-rejected`.
- [ ] Filtros por preço, contexto, tools, JSON schema, vision, local/private, free tier, provider, confidence,
  probe status e lifecycle.
- [ ] Mostrar `catalog says`, `probe proved`, `manual override` e `health says` lado a lado.

## 6. Critérios de aceite

- Mesmo modelo em providers diferentes vira records diferentes.
- `ModelInfo.id` enviado ao SDK continua provider-local.
- Registry e snapshots não serializam segredo.
- `onListModels()` vem do gateway ou de fallback legado explicitamente documentado.
- Operador consegue ver providers disponíveis, modelos disponíveis, capabilities, limites e confidence.
- Probes descartáveis validam delta, final, tools e `ask_user`.
- Health e failures influenciam roteamento.
- Toda decisão de rota é explicável e observável.
- O banco completo de catálogo preserva fatos por campo com provenance/confidence, não apenas records achatados.
- Catálogos remotos, docs, agregadores, heurísticas e probes podem coexistir sem sobrescrever evidência mais forte.
- Rotas automáticas de provider/agregador são modeladas explicitamente e nunca confundidas com modelo exato.
- O roteador usa a projection canônica como primeiro filtro antes de probes/runtime, mas probes podem rebaixar ou
  promover capabilities com rastreabilidade.

## 7. Primeiro corte implementado

Esta rodada iniciou a Faixa A:

- `src/copilot/model-gateway/contracts/records.js`
- `src/copilot/model-gateway/registry/model-registry.js`
- `src/copilot/model-gateway/registry/env-byok-compat-importer.js`
- `src/copilot/model-gateway/registry/snapshot.js`
- `src/copilot/model-gateway/session/copilot-model-projection.js`
- `src/copilot/model-gateway/observability/events.js`
- `src/copilot/events/model-gateway-events.js`
- integração inicial do catálogo/metrics da observability.

O próximo corte deve trocar a primeira projection de terminal para ler o snapshot do gateway em paralelo auditável ao BYOK
legado, com teste garantindo paridade.

## 8. Continuidade 2026-05-24 — investigação de metadata universal

Pedido novo: criar formas criativas e robustas de extrair todos os metadados de providers/modelos para um banco completo,
normalizado e atualizável, usado como primeiro elemento de seleção antes de testes em runtime.

Fontes oficiais consultadas nesta continuidade:

- OpenAI API Reference — `GET /v1/models`.
- OpenRouter docs — `/api/v1/models` com `architecture`, `pricing`, `top_provider`, `per_request_limits`,
  `supported_parameters`, `default_parameters` e `expiration_date`.
- Anthropic API Reference — models list.
- Gemini API — `models.list`/`models.get` com token limits, generation methods, thinking e parâmetros.
- Mistral API — `/v1/models` com `capabilities`, aliases, `max_context_length`, deprecation e replacement.
- Groq docs — modelos ativos via endpoint OpenAI-compatible `/openai/v1/models`.
- Ollama docs — `/api/tags` para modelos locais e detalhes via APIs locais complementares.
- Hugging Face Inference Providers — catálogo com provider real, preço, contexto, latency, throughput, tools e
  structured outputs.
- Cloudflare Workers AI — catálogo/unified catalog com task types, capabilities e modelos hosted/partner.
- Cerebras Inference — `/v1/models` e catálogo público.
- NVIDIA NIM docs — APIs OpenAI-compatible e catálogo/docs de modelos.

Reflexão consolidada:

1. Não existe um schema comum suficientemente rico entre providers. Alguns endpoints são mínimos; outros são ricos; docs
   públicos às vezes carregam mais fatos que a API autenticada.
2. Um mesmo `providerModel` pode ter capacidades diferentes por rota, upstream, plano, região, conta, sufixo de
   provider ou agregador.
3. Portanto, `providerId + providerModel` continua sendo identidade mínima, mas o roteador precisa também de
   `routeProfile`/`ModelRouteOption`.
4. O banco deve guardar evidências conflitantes e fazer merge por campo; apagar tudo com o último catálogo baixado seria
   arquitetura frágil.
5. O primeiro filtro de seleção deve usar a projection canônica de metadata, mas perfis agentic continuam exigindo prova
   runtime para capabilities críticas.

Decisão incorporada ao roadmap:

- Adicionadas as seções 4.1 a 4.5 sobre catálogo universal, evidence ledger, merge por campo, extração criativa e
  seleção automática dos providers.
- Adicionadas as Faixas K, L, M, N, O e P:
  - K: banco universal e evidence ledger;
  - L: importers oficiais/agregadores;
  - M: normalização e heurísticas;
  - N: modelagem de auto-seleção e rotas;
  - O: refresh/diffs/governança;
  - P: UX de exploração do catálogo.

Próximo corte recomendado:

1. Criar contratos `CatalogSource`, `ModelMetadataEvidence`, `ModelRouteOption` e `CanonicalModelProjection`.
2. Criar store SQLite `catalog.sqlite` com migrations e testes de redaction.
3. Implementar primeiro importer rico (`OpenRouterModelsImporter`) e primeiro importer mínimo (`OpenAIModelsImporter`)
   para provar merge por campo.
4. Criar projection canônica que enriquece `ModelRecord` atual sem quebrar `/byok models` nem `onListModels()`.
5. Adicionar comando/serviço interno de refresh em dry-run, mostrando diff sem alterar seleção ativa.
