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
- `model-gateway/probes/*`: roda probes descartáveis chat/agent/streaming/JSON/vision, incluindo delta, tools,
  `ask_user` e attachment de imagem hermético.

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
- Kilo AI Gateway expõe um gateway OpenAI-compatible em `https://api.kilo.ai/api/gateway`, lista pública de modelos em
  `/models`, metadata de preço/contexto/features, BYOK interno por provider, headers próprios de organização/tarefa/modo
  e rotas `provider/model` parecidas com agregadores.
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
  kind: api | docs_markdown | html_table | static_seed | local_daemon | aggregator | gateway | manual | probe
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
  selectorKind: exact_model | provider_auto | aggregator_auto | gateway_auto | cheapest | fastest | preferred_provider |
    fallback_chain
  selectorSyntax
  sourceId
  sourceKind
  confidence
  providerSpecific
  normalizedPolicy

ProviderMetadataEvidence
  evidenceId
  providerId
  subjectProviderId
  fieldPath
  value
  normalizedValue
  sourceId
  sourceKind
  confidence
  observedAt
  expiresAt
  rawPayloadRef
  redactionStatus

ProviderAccountOverlay
  accountOverlayId
  providerId
  accountScope
  secretRef
  organizationIdRef
  sourceId
  sourceKind
  confidence
  enabledModels
  blockedModels
  byokProviderKeys
  quota
  rateLimits
  spendingLimits
  policyHeaders
  providerMetadata
  observedAt
  expiresAt
  redactionStatus

CanonicalProviderProjection
  providerId
  subjectProviderId
  displayName
  dataPolicy
  providerMetadata
  provenanceByField
  confidenceByField

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
  providerMetadata
  openai
  provenanceByField
  confidenceByField
  routingHints
  accountOverlayRefs
```

Para listas imensas de providers, a projection deve ir para SQLite em vez de depender apenas de JSON:

```txt
data/copilot/model-gateway/catalog.sqlite
  catalog_import_runs
  catalog_sources
  providers
  provider_evidences
  provider_projections
  provider_aliases
  models
  model_aliases
  model_routes
  model_capability_facts
  model_parameter_facts
  model_limit_facts
  model_price_facts
  model_lifecycle_facts
  provider_account_overlays
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
- Account/organization overlays, como allow lists, BYOK interno e spending limits de Kilo ou Cloudflare AI Gateway, têm
  precedência operacional sobre catálogo público, mas nunca viram capability global do modelo.
- Nomes como `:free`, `vision`, `instruct`, `coder`, `thinking`, `reasoning`, `latest` podem gerar heurísticas, mas
  sempre com confidence baixa.

### 4.4. Extração criativa de metadata

O gateway deve combinar importers especializados:

1. **API importers autenticados**: OpenAI, Anthropic, Gemini, Mistral, Groq, Cerebras, Ollama local/cloud, etc.
2. **Rich aggregator importers**: OpenRouter, Hugging Face Inference Providers, Cloudflare unified catalog. Eles ajudam
   a preencher preço/contexto/capabilities, mas a provenance deve deixar claro que são agregadores.
3. **Gateway importers**: Kilo AI Gateway, Cloudflare AI Gateway e LiteLLM/Kilo-like gateways. Eles expõem modelos e
   políticas de rota próprias; o import precisa preservar `gatewayId`, provider upstream, headers aceitos, políticas de
   organização e o fato de que BYOK pode ocorrer dentro do gateway.
4. **Docs/Markdown table importers**: para páginas oficiais que expõem capabilities melhor que API, como Cloudflare
   Workers AI e páginas de overview de provider.
5. **Local daemon importers**: Ollama `/api/tags` + `/api/show`, vLLM/LiteLLM/OpenAI-compatible `/v1/models`,
   containers NIM self-hosted.
6. **Probe importers**: probes de chat, streaming, tools, JSON schema, vision, context-window, parameter fuzzing e
   error taxonomy.
7. **Heuristic enrichers**: parser de nomes e famílias para inferir versão, tamanho, quantização, free tier, preview,
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
- **Gateway auto**: Kilo Gateway pode rotear `provider/model`, aplicar BYOK interno, políticas de organização, limites de
  gasto e hints como `x-kilocode-mode`; isso precisa ser representado como rota de gateway, não como provider direto
  puro.
- **Local auto**: Ollama/vLLM/LiteLLM podem ter tags locais que apontam para pesos diferentes ao longo do tempo.
- **Fallback chain nosso**: sequência auditável escolhida pelo `PolicyEngine`.

Cada opção precisa virar `ModelRouteOption`, com `selectorKind`, `selectorSyntax`, riscos e custo esperado. Assim, o
roteador consegue decidir se usa:

- `openrouter:model` com roteamento automático;
- `kilo:provider/model` com gateway BYOK ou conta Kilo;
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
- [x] Separar specs OpenAI-compatible em um arquivo por provider, para endpoint metadata/importers evoluírem por família
  sem reencher o adapter de conhecimento específico.
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
- [x] Adicionar probe de vision com fixture PNG inline segura e validação comportamental de cor.
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
- [x] Criar scoring por capability obrigatória.
- [x] Incluir custo, latência, contexto, confidence, health, allow/block provider.
- [x] Criar fallback auditável.
- [x] Explicar decisão ao operador com candidatos recusados e razão.
- [x] Tratar `vision` como requisito suave/preferência de rota, não como exclusão automática. Um modelo text-only que
  responde, streama e tem contexto mínimo continua elegível para o perfil `vision`; modelos com vision comprovável sobem
  no ranking e devem ser priorizados para probes multimodais.

### Faixa H — Terminal UX

- [x] Comandos:
   - `/providers list` via alias direto para `/byok providers`;
   - `/providers health` via alias direto para health operacional BYOK;
   - `/models list` via alias direto para `/byok models`;
   - `/models route <profile>` via `routeGatewayModels()` com modo `pre-probe` e `strict`;
   - `/byok probe <model>` com chat/agent/streaming/JSON/vision;
   - `/byok recommend <profile>` via filtros de catálogo e health/probe agent.
- [x] Filtros por:
   - free/paid/unknown;
   - vision;
   - tools;
   - streaming;
   - context window;
   - probe status;
   - provider.
- [x] Mostrar origem dos metadados e confiança.
- [x] Mostrar por que um modelo foi rejeitado.

### Faixa I — Observability

- [x] Gateway emite eventos estabilizados.
- [x] Event catalog inclui `model-gateway-events`.
- [x] Metrics collector registra counters/gauges de snapshot, route, probe e failure.
- [x] Usage ledger registra `sessionId`, `providerId`, `modelId`, `routeProfile`, tokens, custo estimado, fallback e failure
  para decisões de rota, sem prompt, headers, raw payload ou secrets.
- [x] Traces incluem `llm.provider`, `llm.model`, `llm.gateway.model_id`, `llm.route.decision_id`.
- [x] Observability não lê secrets nem raw provider payload para inferir decisão.

### Faixa J — Depreciação controlada

- [x] `sdk/session/provider.js` mantém `ProviderConfig`, validação e compat exports.
- [x] Presets atuais migram para o gateway via `EnvByokCompatImporter` sem remover a compat layer do SDK/config.
- [x] Discovery legado fica encapsulado no config port até os importers universais da Faixa L assumirem a descoberta
  profunda.
- [x] `terminal/byok/*` fica restrito a admissão de orçamento, binding de sessão e renderização; provider/model truth
  vem de `model-gateway`.
- [x] Antigos exports não são removidos nem marcados como deprecated antes de consumidores e importers K/L estarem
  migrados.
- [x] Gate booleano pré-K formalizado em `buildModelGatewayPreKCompatibilityReport()` e exposto no terminal por
  `/byok gateway`.
- [x] Gate pré-K definido: nenhuma depreciação remove ou quebra exports SDK/config atuais; terminal usa gateway para
  rota/probes/health quando disponível, mas mantém compat de env/presets até os importers universais existirem.
- [x] Critério de live `llm-b`: antes de promover modelo vivo, rodar `/models route <profile>`, `/byok probe chat`,
  `/byok probe streaming`, `/byok probe json`, `/byok probe vision` quando multimodal, e `/byok probe agent` para
  perfis agentic; promoção só via `/byok use` + `/byok model` + nova sessão SDK.

### Faixa K — Banco universal de catálogo e evidências

- [x] Criar `catalog/contracts` com `ProviderCatalogSource`, `ModelMetadataEvidence`, `ModelRouteOption` e
  `CanonicalModelProjection`.
- [ ] Criar store SQLite `data/copilot/model-gateway/catalog.sqlite`.
- [ ] Manter `registry.json` como export/snapshot redigido, não como banco completo.
- [x] Criar contratos storage-neutral para import runs, raw payload refs sanitizados e diff de projections antes do store.
- [ ] Persistir import runs com status, duração, fonte, quantidade de rows, erros sanitizados e diff gerado.
- [ ] Persistir raw payload sanitizado por hash/ref, sem segredos nem headers sensíveis.
- [x] Criar merge field-wise com `provenanceByField` e `confidenceByField`.
- [x] Implementar precedência por campo: manual > probe > authenticated catalog > official docs > aggregator >
  static_seed > heuristic.
- [x] Criar testes que provem que fonte mais pobre e mais recente não apaga metadata rica de fonte anterior.
- [x] Criar teste de regressão para nunca serializar segredo no snapshot JSON inicial de catálogo.
- [ ] Criar teste de regressão para nunca serializar segredo no catalog DB ou evento.
- [x] Criar store inicial redigido e storage-neutral antes do SQLite, para validar contrato, migração e diffs sem decidir
  prematuramente o backend permanente.
- [x] Persistir import runs e raw payload refs sanitizados no snapshot JSON inicial.

### Faixa L — Importers de catálogos oficiais e agregadores

- [x] Criar interface `CatalogImporter`:
  - `id`;
  - `providerId`;
  - `sourceKind`;
  - `requiresAuth`;
  - `fetchRaw()`;
  - `parseRows()`;
  - `toEvidenceFacts()`.
- [x] Criar runner storage-neutral de importers que monta `ProviderCatalogSource`, `rawPayloadRef`, evidências,
  `CatalogImportRun` e snapshot JSON secret-safe antes dos importers específicos.
- [x] Implementar `OpenAIModelsImporter` para `/v1/models` account-scoped.
- [ ] Complementar `OpenAIModelsImporter` com seeds/docs oficiais de capabilities e famílias.
- [x] Implementar `OpenRouterModelsImporter` para `/api/v1/models`, preservando `supported_parameters`, pricing,
  context, top provider e per-request limits.
- [x] Implementar `AnthropicModelsImporter` para lista oficial de modelos account-scoped.
- [ ] Complementar `AnthropicModelsImporter` com `GET /v1/models/{model_id}`, aliases resolvidos e docs de
  limites/capabilities por família.
- [x] Implementar `GeminiModelsImporter` para `models.list`/`models.get`, capturando token limits,
  `supportedGenerationMethods`, `thinking` e parâmetros.
- [ ] Complementar `GeminiModelsImporter` com seeds/docs oficiais de modalidades, capabilities de família e
  diferenças entre Gemini API direta, Vertex AI e endpoint OpenAI-compatible.
- [x] Implementar `MistralModelsImporter` para `/v1/models`, capturando capabilities, aliases,
  `max_context_length`, deprecation e replacement.
- [x] Implementar `GroqModelsImporter` para `/openai/v1/models` e `retrieve model`, capturando `context_window`,
  `active` e metadata account-scoped.
- [ ] Complementar `GroqModelsImporter` com seeds/docs oficiais de pricing, model cards, built-in tools e limites de
  rate por tier/modelo.
- [x] Implementar `OllamaCatalogImporter` para `/api/tags` + `/api/show`.
- [x] Implementar `HuggingFaceInferenceProvidersImporter` para catálogo de providers/modelos/rotas.
- [ ] Implementar `CloudflareWorkersAiCatalogImporter` para unified catalog/Workers AI docs.
- [x] Implementar `KiloGatewayCatalogImporter` para `https://api.kilo.ai/api/gateway/models`, capturando ids
  `provider/model`, provider upstream, pricing, context window, features, rotas gratuitas e endpoints auxiliares.
- [x] Implementar `KiloGatewayProvidersImporter` para `/providers` quando disponível, preservando provider upstream e
  diferença entre Kilo Gateway, Kilo Code e providers BYOK internos.
- [x] Implementar `CerebrasModelsImporter` para `/v1/models` + catálogo público.
- [ ] Implementar `NvidiaNimCatalogImporter` para docs/API catalog quando disponível.
- [x] Permitir importers `OpenAICompatibleGenericImporter` para vLLM, LiteLLM, Chutes, Z.AI e endpoints locais sem
  importer especializado.
- [x] Criar modo `accountScoped` para importers autenticados que retornam modelos habilitados por plano, organização,
  quota ou BYOK interno, sem serializar segredo.

### Faixa M — Normalização, enriquecimento e heurísticas controladas

- [x] Criar projeção OpenAI-compatible de catálogo (`id`, `object`, `created`, `owned_by`) com extensão
  `x_model_gateway` para metadados universais ricos.
- [x] Preservar no merge/projection metadados ricos essenciais para o schema OpenAI estendido: `description`,
  `aliases.*`, `lifecycle.*` e `providerMetadata.*`.
- [x] Criar normalizador de modalidades: text, image, audio, video, pdf, embedding, rerank, asr, tts, image-generation.
- [x] Criar normalizador de capability hints OpenAI-compatible vindos de catálogo: streaming, tools,
  forcedToolChoice, parallelToolCalls, JSON mode, JSON schema/structured outputs, reasoning, multimodal e search/code.
- [ ] Criar normalizador de capabilities agentic runtime: streaming, tools, forcedToolChoice, parallelToolCalls, JSON mode,
  JSON schema, structured outputs, reasoning effort, reasoning budget, code execution, web/search grounding.
- [x] Criar normalizador de limites: context window, max output, max request, TPM, RPM e daily requests.
- [x] Criar normalizador de pricing USD para input/output/cache/read/write/request/search com moeda e unidade
  explícitas.
- [ ] Expandir normalizador de pricing para image/audio e moedas não-USD quando providers oferecerem esses campos.
- [ ] Expandir normalizador de limites para burst/concurrency/account quotas quando providers oferecerem esses campos.
- [x] Criar normalizador de lifecycle: active, preview, scheduled_retirement/retired, createdAt, expiresAt e
  knowledgeCutoff.
- [x] Criar parser inicial de aliases/versionamento (`latest`, data compacta `YYYYMMDD` e data `YYYY-MM-DD`).
- [ ] Expandir parser de aliases/versionamento para famílias, tamanho, quantização, instruct/coder/reasoning e variants.
- [ ] Criar normalizador de providers/gateways que separe `direct_provider`, `aggregator`, `gateway`,
  `openai_compatible_proxy`, `local_daemon` e `sdk_native`.
- [x] Criar normalizador de overlays de conta: allow/block lists, organization headers, spending limits, quotas, free
  tiers e BYOK interno por provider.
- [ ] Criar heuristics engine com confidence baixa e sempre sobrescrevível por catálogo/probe/manual.
- [ ] Criar detector de conflitos por campo e comando de operador para listar conflitos de metadata.

### Faixa N — Modelagem de auto-seleção e rotas

- [x] Criar `ModelRouteOption` para modelar rotas exatas, aliases, provider-auto, aggregator-auto, cheapest, fastest,
  preferred-provider e fallback-chain.
- [x] Representar seleção automática de OpenRouter como rota própria, sem apagar provider upstream quando conhecido.
- [x] Representar Kilo Gateway como rota própria `gateway_auto`/`exact_model`, incluindo `provider/model`,
  `x-kilocode-mode`, `X-KiloCode-OrganizationId`, `X-KiloCode-TaskId`, BYOK interno e falha sem fallback quando a key
  BYOK interna falhar.
- [ ] Representar sufixos/seletores de Hugging Face Inference Providers, incluindo provider explícito e políticas de
  `fastest`/`cheapest` quando publicadas.
- [ ] Representar Cloudflare AI Gateway/Workers AI como camada de rota com cache, retry, rate-limit e fallback quando
  configurado.
- [ ] Representar tags locais de Ollama/vLLM/LiteLLM como aliases instáveis com digest/hash quando disponível.
- [ ] Fazer `PolicyEngine` escolher entre rota exata, auto-provider e fallback próprio com justificativa auditável.
- [ ] Expor no terminal por que uma rota automática foi aceita ou rejeitada.

### Faixa O — Refresh, diffs e governança operacional

- [x] Criar refresh programático de catálogo com importers, replacement de evidências por fonte, rebuild de projections,
  diff e resposta OpenAI-compatible.
- [x] Criar composição padrão de importers públicos/autenticados para refresh programático sem vazar segredo.
- [x] Criar comando terminal correspondente para `model-gateway catalog refresh`.
- [ ] Criar refresh incremental por provider, com cache TTL por fonte.
- [ ] Criar refresh por overlay de conta/organização quando houver secretRef configurado, mantendo snapshot público e
  snapshot account-scoped separados.
- [x] Criar diff entre snapshots: modelos novos, removidos e campos alterados.
- [x] Expandir diff entre snapshots para depreciação explícita, preço alterado, limits alterados, capabilities
  alteradas.
- [x] Emitir eventos:
  - `model_gateway:catalog:import_started`;
  - `model_gateway:catalog:import_completed`;
  - `model_gateway:catalog:model_added`;
  - `model_gateway:catalog:model_changed`;
  - `model_gateway:catalog:model_removed`;
  - `model_gateway:catalog:conflict_detected`.
- [x] Sugerir probes automaticamente para modelos novos de alto valor ou com capability agentic provável.
- [ ] Nunca trocar modelo ativo automaticamente por causa de catálogo novo; gerar recomendação auditável.

### Faixa P — UX de exploração do catálogo universal

- [x] `/models catalog refresh [provider]`.
- [x] `/models catalog diff`.
- [ ] `/models search <query>`.
- [ ] `/models explain <provider:model>`.
- [x] `/models conflicts`.
- [x] `/models route <profile> --show-rejected`.
- [ ] `/models gateways` com Kilo, OpenRouter, Cloudflare AI Gateway, LiteLLM e outros gateways/proxies configurados.
- [ ] `/models account-overlays` para mostrar modelos habilitados/bloqueados por conta ou organização sem expor secrets.
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
- Gateways como Kilo/OpenRouter/Cloudflare podem ser escolhidos como rota própria sem apagar o provider upstream nem as
  políticas de conta/organização.
- Overlays autenticados de conta/plano/BYOK interno afetam elegibilidade operacional sem contaminar o catálogo público.
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
- Kilo AI Gateway — gateway OpenAI-compatible, `/models`, `/providers`, BYOK interno, headers de organização/tarefa/modo
  e rotas `provider/model`.
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
6. Gateways como Kilo não são apenas "mais um preset": eles combinam catálogo público, roteamento `provider/model`,
   BYOK interno, limites de organização, modos operacionais e erro/fallback próprios.
7. A auditoria completa reforça que `sdk/session/provider.js` deve perder responsabilidade progressivamente, mas sem
   inversão de dependência: `onListModels()` recebe projection segura, e adapters/importers vivem no gateway.

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
- Refinadas as Faixas K-P para incluir Kilo/Kilo Gateway como gateway de primeira classe, overlays account-scoped,
  importers próprios, headers/políticas operacionais e rotas `gateway_auto`.

Próximo corte recomendado:

1. Criar contratos `CatalogSource`, `ModelMetadataEvidence`, `ModelRouteOption` e `CanonicalModelProjection`.
2. Criar `ProviderAccountOverlay` para separar catálogo público de plano/organização/BYOK interno.
3. Criar store SQLite `catalog.sqlite` com migrations e testes de redaction.
4. Implementar primeiro importer rico (`OpenRouterModelsImporter`), primeiro gateway importer
   (`KiloGatewayCatalogImporter`) e primeiro importer mínimo (`OpenAIModelsImporter`) para provar merge por campo.
5. Criar projection canônica que enriquece `ModelRecord` atual sem quebrar `/byok models` nem `onListModels()`.
6. Adicionar comando/serviço interno de refresh em dry-run, mostrando diff sem alterar seleção ativa.

## 9. Continuidade 2026-05-24 — fechamento da camada E-G antes de K

Pedido novo: antes de avançar para Faixa K e catálogo profundo, concluir a camada atual até J e deixar o caminho
funcional para lives com `llm-b` usando probes.

Implementado neste corte:

- Faixa E concluída com `runConfiguredByokVisionProbe`.
- O probe vision usa fixture PNG inline, hermética e redigível, enviada como `blobAttachment` pelo mesmo caminho
  `sendSessionAndWait` usado pelo runtime.
- `/byok probe vision` foi exposto no terminal, registra health genérico por `probeKind=vision` e emite
  `model_gateway:probe:completed`.
- Faixa G ganhou `scoreGatewayModelCandidate()` e `routeGatewayModels()`, com scoring determinístico por capabilities
  obrigatórias, contexto, preço, confidence, health, allow/block provider, latência opcional, fallbackChain e razões de
  rejeição.
- Faixa H ganhou aliases diretos `/models` e `/providers`, incluindo `/providers health`, para reduzir atrito operacional
  no terminal.
- `/models route <profile>` agora converte o catálogo terminal (`RuntimeModelInfo`) para candidatos do model-gateway e
  chama `routeGatewayModels()` com explicação de admissão, score, fallback chain e rejeições via `--show-rejected`.
- Os filtros de catálogo/roteamento agora cobrem `tools`, `streaming` e `probe-ok`, além de free/paid/unknown, vision,
  reasoning, contexto, request budget e provider.
- `renderModelTags()` passou a expor `source=` e `confidence=` quando o catálogo fornece esses metadados.
- Faixa I ganhou `buildRouteDecisionEvent()`, `projectRouteDecisionMetrics()` e um ledger bounded em processo para
  decisões de rota, persistindo apenas metadados sanitizados de decisão/fallback/tokens estimados/custo estimado.
- `/models route <profile>` agora emite `model_gateway:route:decision`, grava o ledger e mostra `decisionId` no terminal.
- Metrics collector passou a registrar seleção/não seleção e gauges de candidatos, rejeitados e fallback para decisões
  de rota.
- Faixa J ganhou o gate pré-K: manter compatibilidade SDK/config, não quebrar presets/env legados antes dos importers
  universais, e exigir matriz de probes antes de promoção em lives `llm-b`.
- `terminal:llm-b:live-test -- --byok-real` passou a exercitar `/models route repo_agent --show-rejected` e probes
  descartáveis chat, streaming, JSON, vision, agent e shortlist antes de qualquer live/promote.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
- PASS `npm run typecheck:strict:src.copilot`
- PASS `npm run lint:copilot`
- PASS `npm run test:copilot` após estabilizar contratos globais de lifecycle/hooks/event adapters/mocks
  (`5596` testes, `0` falhas; warning remanescente: `[erro] sdk stream failed` registrado pelo runner compacto).
- PASS `npm run test:copilot` após Faixa H
  (`5597` testes, `0` falhas; warning remanescente: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T00-06-10-929Z/summary.md`).
- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  após ledger de rota (`75` testes).
- PASS `npm run typecheck:strict:src.copilot` após ledger de rota.
- PASS `npm run lint:copilot` após ledger de rota.
- PASS `npm run test:copilot` após ledger/contrato J
  (`5598` testes, `0` falhas; warning remanescente: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T00-13-42-683Z/summary.md`).
- PASS `node --check scripts/copilot/run-terminal-llm-b-live-test.mjs`.
- PASS `npm run terminal:llm-b:live-test`
  (`artifacts/terminal-live/2026-05-25T00-16-15-956Z/summary.md`; canonical deltas/tools/ask_user/usage).
- PASS `npm run terminal:llm-b:live-test -- --byok-real --no-pr --timeout-ms 600000`
  (`artifacts/terminal-live/2026-05-25T00-20-33-489Z/summary.md`; route decision, chat, streaming, JSON, vision,
  agent, shortlist, model switch e no-secret-leak). Observação: vision probe registrou explicitamente falha provider
  HTTP 404 para o modelo ativo, mas o critério passou porque o caminho de attachment/capability ficou exercitado e
  auditável sem promover o modelo.

Fechamento antes de K:

1. A seleção `vision` foi rebaixada para requisito suave/preferência de rota, sem exclusão automática.
2. O gate pré-K passa a ser booleano e auditável; K começa apenas depois de A-J permanecerem verdes nos validadores.

## 10. Continuidade 2026-05-25 — seleção por acesso básico antes de capability fina

Pedido novo: continuar a camada atual sem tratar `vision` como característica automaticamente excludente, garantir um
arquivo por provider e preparar a investigação de endpoints como primeira etapa do banco universal.

Decisões consolidadas:

1. A primeira barreira operacional não é “tem vision/tools/JSON perfeito”, mas sim:
   - existe secret/conta/overlay que habilita o provider;
   - o endpoint responde;
   - o modelo aceita uma pergunta simples;
   - streaming básico funciona quando o perfil exige streaming;
   - há orçamento/context window razoável;
   - falhas de auth, rota, quota ou modelo inexistente são classificadas com precisão.
2. Capabilities finas (`vision`, `tools`, JSON schema, forced tool choice, parallel tool calls, reasoning budget) entram
   como ranking, recomendação de probe e promoção progressiva de confiança. Elas só devem virar gate duro quando o
   usuário ou o workflow explicitamente exige aquela capacidade para completar a tarefa.
3. O perfil `vision` agora mantém `text` e `streaming` como requisitos duros e move `vision` para `softRequires` +
   `prefers`. Assim, um modelo que ainda não tem metadata multimodal não desaparece do roteador; ele apenas perde pontos
   e carrega razão auditável `missing_soft_capability:vision`.
4. Todo provider OpenAI-compatible passa a ter spec próprio em `src/copilot/model-gateway/providers/specs/<provider>.js`.
   Isso prepara importers por família, endpoints próprios, overlays de conta e quirks sem acoplar tudo ao adapter.
5. O inventário de endpoints fica separado dos adapters em `src/copilot/model-gateway/providers/endpoints/<provider>.js`.
   Ele não decide capability; ele só diz onde coletar catálogo, overlay e runtime evidence.
6. A seleção final continuará em três camadas:
   - metadata coletada/projetada;
   - prova runtime básica;
   - prova runtime específica do workflow.

Fontes oficiais reconsultadas nesta continuidade:

- OpenAI API Reference: `GET /v1/models` lista modelos disponíveis com metadados básicos de identidade/owner.
- OpenRouter Models API: `/api/v1/models` expõe metadata rica, filtros por modalidade/parâmetros e campos como pricing,
  architecture, supported parameters e expiração.
- Anthropic Models API: `GET /v1/models` lista modelos disponíveis para a key, com paginação e identificação.
- Gemini API: `models.list`/`models.get` retorna limits e métodos suportados, útil para acesso por conta/API version.
- Mistral Models API: `GET /v1/models` traz `capabilities`, `max_context_length`, aliases e deprecation/replacement.
- Groq API Reference: endpoint OpenAI-compatible em `https://api.groq.com/openai/v1`, incluindo `/models`.
- Ollama API: `/api/tags` lista modelos locais com digest, formato, família, tamanho e quantização; `/api/show` deve
  enriquecer detalhes por modelo.
- Hugging Face Inference Providers: roteamento OpenAI-compatible em `https://router.huggingface.co/v1`, com seleção
  `:fastest`, `:cheapest`, `:preferred` ou provider explícito.
- Cloudflare Workers AI/AI Gateway: Workers AI tem catálogo público de modelos; AI Gateway tem endpoints por provider e
  Universal Endpoint `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}` com retry/fallback/headers.
- Kilo AI Gateway: endpoint OpenAI-compatible `https://api.kilo.ai/api/gateway`, catálogo público
  `/api/gateway/models`, providers, modelo `provider/model`, BYOK interno e controles de organização.
- Cerebras Inference: `GET /v1/models` lista modelos disponíveis com identidade/owner.
- NVIDIA NIM: catálogo NIM e endpoints OpenAI-compatible exigem importer híbrido docs/API porque a riqueza depende do
  microserviço/modelo.
- Chutes e Z.AI: tratados inicialmente como OpenAI-compatible/gateway specs próprios; precisam de investigação dedicada
  de catálogo/endpoints antes de virarem importers especializados.

Matriz de investigação por provider, antes da Faixa K:

| Provider | Arquivo spec | Endpoint/catálogo primário | Próxima pergunta de importer |
| --- | --- | --- | --- |
| OpenAI | `providers/specs/openai.js` | `GET /v1/models` + docs/pricing | Como enriquecer capabilities/preço sem confiar só no endpoint mínimo? |
| Kilo | `providers/specs/kilo.js` | `/api/gateway/models` e `/api/gateway/providers` | Como modelar BYOK interno, org allow lists, headers e `provider/model`? |
| Groq | `providers/specs/groq.js` | `/openai/v1/models` + docs de modelos | Quais limites/capabilities precisam vir de docs/probe? |
| Mistral | `providers/specs/mistral.js` | `/v1/models` | Como mapear `capabilities` para tools/vision/FIM/classification? |
| Hugging Face | `providers/specs/huggingface.js` | `router.huggingface.co/v1` + catálogo Inference Providers | Como preservar `:fastest`, `:cheapest`, `:preferred` e provider explícito? |
| Cloudflare | `providers/specs/cloudflare-workers-ai.js` | Workers AI catalog + AI Gateway universal/provider endpoints | Como separar Workers AI direto de AI Gateway com fallback/cache? |
| NVIDIA NIM | `providers/specs/nvidia-nim.js` | `integrate.api.nvidia.com/v1` + NIM catalog | Como descobrir modelos habilitados por conta e por microserviço? |
| Cerebras | `providers/specs/cerebras.js` | `/v1/models` + public model docs | Quais campos ricos só existem em docs públicas? |
| Chutes | `providers/specs/chutes.js` | OpenAI-compatible atual + docs Chutes | Existe endpoint público de modelos estável ou a fonte inicial é docs/API auth? |
| Z.AI | `providers/specs/zai.js` | OpenAI-compatible `api/paas/v4` + docs GLM | Quais endpoints separam chat, coding plan, vision e Anthropic-compatible? |

Alterações implementadas neste corte:

- `MODEL_GATEWAY_TASK_PROFILES.vision` passou a usar `softRequires: ['vision']`.
- `scoreGatewayModelCandidate()` pontua `softRequires` com razão auditável sem rejeitar candidato.
- Teste de contrato garante que modelo text-only continua candidato para perfil `vision`, enquanto multimodal ranqueia
  acima.
- Specs OpenAI-compatible foram extraídos para um arquivo por provider e reexportados pelo índice de specs.
- Inventário de endpoints por provider foi criado em `providers/endpoints/*`, cobrindo OpenAI, OpenRouter, Anthropic,
  Gemini, Ollama, Kilo, Groq, Mistral, Hugging Face, Cloudflare, NVIDIA NIM, Cerebras, Chutes e Z.AI.
- O barrel do `model-gateway` exporta `listProviderEndpointInventory()` e `resolveProviderEndpointInventory()`, para a
  futura Faixa K/L começar pelos endpoints oficiais sem depender de dispatch de adapter.
- `/byok providers endpoints [provider]` expõe esse inventário no terminal, sem chamar rede e sem confundir mapa de
  coleta com prova de acesso/capability.

Validação:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
- PASS `npm run typecheck:strict:src.copilot`
- PASS `npm run lint:copilot`
- PASS `npm run test:copilot`
  (`5599` testes, `0` falhas; warning remanescente conhecido: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T13-54-07-233Z/summary.md`).
- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  após inventário de endpoints (`30` testes).
- PASS `npm run typecheck:strict:src.copilot` após inventário de endpoints.
- PASS `npm run lint:copilot` após inventário de endpoints.
- PASS `npm run test:copilot` após inventário de endpoints
  (`5600` testes, `0` falhas; warning remanescente conhecido: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-00-03-450Z/summary.md`).
- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/terminal/test_commands_byok.spec.js`
  após `/byok providers endpoints` (`48` testes).
- PASS `npm run typecheck:strict:src.copilot` após `/byok providers endpoints`.
- PASS `npm run lint:copilot` após `/byok providers endpoints`.
- PASS `npm run test:copilot` após `/byok providers endpoints`
  (`5601` testes, `0` falhas; warning remanescente conhecido: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-05-35-227Z/summary.md`).

## 11. Continuidade 2026-05-25 — fechamento coerente das Faixas A-J

Pedido novo: revisar o roadmap, garantir checkboxes booleanos, fechar tudo até J antes de avançar para K e seguir o
modelo de barrels para imports/exports.

Visão organizada:

1. **A-D** agora formam a fundação estável: records, registry, secrets, adapters, specs por provider, endpoint inventory e
   barrels por subdomínio.
2. **E-G** formam a camada de prova e decisão: probes descartáveis, health/failure taxonomy, task profiles e policy
   engine com hard requirements separados de soft requirements.
3. **H-I** formam a camada operacional: terminal renderiza providers/modelos/rotas/probes/endpoints/gate, eventos
   estabilizados e ledger sanitizado de decisões.
4. **J** fecha a migração controlada: SDK/config continuam compatíveis; terminal não vira fonte de verdade; discovery
   legado fica encapsulado até importers universais; depreciação só acontece depois de K/L.

Alterações implementadas neste corte:

- Criados barrels faltantes:
  - `model-gateway/contracts/index.js`;
  - `model-gateway/registry/index.js`;
  - `model-gateway/secrets/index.js`;
  - `model-gateway/session/index.js`;
  - `model-gateway/observability/index.js`;
  - `model-gateway/migration/index.js`.
- O barrel raiz `#copilot/model-gateway` passou a reexportar esses subdomínios via barrels internos.
- `buildRouteDecisionEvent()` agora inclui `traceAttributes` com:
  - `llm.provider`;
  - `llm.model`;
  - `llm.gateway.model_id`;
  - `llm.route.decision_id`;
  - atributos auxiliares de profile, score, candidates, rejected, fallback e failure.
- Criado `buildRouteDecisionTraceAttributes()` para reutilização por qualquer span/telemetry writer.
- Criado `buildModelGatewayPreKCompatibilityReport()` com checks booleanos para o gate A-J.
- `/byok gateway` agora renderiza o gate pré-K no terminal.
- Checklist das Faixas I-J foi reorganizada para não conter estados parciais: cada checkbox descreve uma condição
  verificável e booleana.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`31` testes).
- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`49` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5603` testes, `0` falhas; warning remanescente conhecido: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-17-40-699Z/summary.md`).

Próxima direção:

1. Começar K com contratos de catálogo/evidências sem quebrar A-J.

## 12. Continuidade 2026-05-25 — início da Faixa K por contratos puros

Pedido permanente: após fechar A-J, avançar para K com transformações estruturais, mantendo barrels e checkboxes
booleanos.

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/contracts.js`.
- Criado barrel `src/copilot/model-gateway/catalog/index.js`.
- O barrel raiz `#copilot/model-gateway` passou a exportar os contratos de catálogo.
- Contratos criados:
  - `ProviderCatalogSource`;
  - `ModelMetadataEvidence`;
  - `ModelRouteOption`;
  - `ProviderAccountOverlay`;
  - `CanonicalModelProjection`.
- As factories normalizam `providerId`, timestamps, listas, seletor de rota e defaults seguros.
- Evidências, route options, overlays e projections sanitizam valores antes de serialização; payload bruto continua fora
  do contrato e deve entrar depois apenas por `rawPayloadRef` redigido.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`32` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5604` testes, `0` falhas; warning remanescente conhecido: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-22-10-569Z/summary.md`).

Próxima direção:

1. Commit/push deste início de K.
2. Em seguida, avançar K para merge field-wise/provenance sem ainda acoplar SQLite.

## 13. Continuidade 2026-05-25 — merge field-wise de evidências

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/merge.js`.
- Exportados `mergeModelMetadataEvidence()` e `rankCatalogEvidenceConfidence()` pelo barrel de catálogo e pelo barrel
  raiz do gateway.
- `mergeModelMetadataEvidence()` agrupa evidências por `fieldPath`, escolhe vencedor por precedência de confiança,
  desempata por `observedAt`, aplica o valor em uma `CanonicalModelProjection`, registra `provenanceByField` e
  `confidenceByField`, e preserva conflitos em lista auditável.
- A sanitização de valores de catálogo foi refinada para não redigir metadados legítimos como `contextWindowTokens`,
  mantendo redaction para headers, tokens, secrets e API keys.
- Teste cobre o caso crítico: evidência `catalog` mais antiga mantém `limits.contextWindowTokens=131072` contra uma
  heurística mais recente e pobre.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`33` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5605` testes, `0` falhas; warning remanescente conhecido: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-27-41-329Z/summary.md`).

Próxima direção:

1. Commit/push deste merge field-wise.
2. Avançar K para import runs/raw payload refs/diff ainda em memória ou JSON, antes do SQLite.

## 14. Continuidade 2026-05-25 — import runs, raw refs e diffs sem store

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/import-runs.js`.
- Exportados pelo barrel de catálogo e pelo barrel raiz:
  - `createSanitizedRawPayloadRef()`;
  - `createCatalogImportRun()`;
  - `diffCanonicalModelProjections()`.
- `createSanitizedRawPayloadRef()` sanitiza payload, calcula `sha256:<hash>`, registra `byteLength`, `mediaType` e
  `redactionStatus`, sem exigir persistência ainda.
- `createCatalogImportRun()` cria registro seguro de execução com status, provider/source, contagem de rows, erros
  sanitizados e diff sanitizado.
- `diffCanonicalModelProjections()` calcula adicionados, removidos e campos alterados por chave
  `providerId:providerModel:routeProfile`.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`34` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5606` testes, `0` falhas; warning remanescente conhecido: `[erro] sdk stream failed`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-32-20-372Z/summary.md`).

Próxima direção:

1. Commit/push deste corte storage-neutral.
2. Avançar K para um store JSON/SQLite mínimo ou para importers dry-run, dependendo do menor risco arquitetural.

## 15. Continuidade 2026-05-25 — limpeza do warning `sdk stream failed`

Investigação:

- O warning recorrente `[erro] sdk stream failed` não era falha real do SDK nem regressão do model-gateway.
- A origem era `tests/unit/copilot/test_terminal_dialog_engine.spec.js`: o teste simulava
  `runTerminalDialogTurnDetailed` rejeitando com `Error('sdk stream failed')`, mas importava o output real do terminal.
- O engine se comportava corretamente ao capturar a exceção e liberar display state; o problema era o spec vazar
  `println()` para `process.stdout`, fazendo o runner compacto classificar uma falha esperada como warning global.

Correção:

- O spec do engine agora captura `process.stdout.write` durante a execução do arquivo e restaura no `afterAll`.
- Isso preserva o engine real, mantém o teste de falha esperado, não silencia warnings de outros specs e remove o ruído
  falso do relatório global.

Validação:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/test_terminal_dialog_engine.spec.js`
  (`22` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5606` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-40-55-032Z/summary.md`).

Decisão de roadmap:

- O próximo avanço de K deve criar um store inicial redigido/storage-neutral antes de SQLite. Isso reduz risco: primeiro
  validamos serialização, redaction, import runs, raw refs, diffs e merge em arquivo simples; depois migramos a mesma
  interface para SQLite sem trocar contrato.

## 16. Continuidade 2026-05-25 — store JSON redigido do catálogo

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/json-catalog-store.js`.
- Exportados pelo barrel de catálogo e pelo barrel raiz:
  - `DEFAULT_MODEL_GATEWAY_CATALOG_PATH`;
  - `JsonModelGatewayCatalogStore`;
  - `normalizeStoredCatalogSnapshot()`.
- O store grava snapshot versionado em `data/copilot/model-gateway/catalog.json` por padrão, com os arrays canônicos
  `sources`, `evidences`, `routeOptions`, `accountOverlays`, `projections`, `importRuns`, `rawPayloadRefs` e
  `conflicts`.
- A normalização rejeita schema version incompatível e sempre devolve shape completo, reduzindo risco para importers e
  migração futura para SQLite.
- A sanitização do store usa chaves sensíveis exatas (`authorization`, `apiKey`, `secret`, `token`, bearer/access token)
  e redação de texto, preservando metadados legítimos com nomes como `contextWindowTokens`.
- O teste de regressão cobre persistência de source/evidence/projection/raw ref/import run, ausência de segredo no
  arquivo bruto e preservação de `limits.contextWindowTokens`.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`35` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5607` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-47-41-535Z/summary.md`).

Decisão de roadmap:

- O JSON store fecha a primeira persistência storage-neutral da Faixa K sem congelar backend. A próxima etapa robusta
  deve ser escolher entre dois caminhos complementares:
  1. criar importers dry-run por provider que escrevam este snapshot;
  2. criar o store SQLite com a mesma semântica e migrar o teste secret-safe para DB.
- `registry.json` continua snapshot operacional legado; o catálogo JSON/SQLite passa a ser a camada de fatos,
  evidências e runs. Nenhum importer deve escrever segredo bruto em projection, raw payload ou run.

## 17. Continuidade 2026-05-25 — interface e runner de importers

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/importer-runner.js`.
- Exportado `runCatalogImporters()` pelo barrel de catálogo e pelo barrel raiz.
- Formalizada a interface `CatalogImporter` em JSDoc com:
  - `id`;
  - `providerId`;
  - `sourceKind`;
  - `requiresAuth`;
  - `fetchRaw()`;
  - `parseRows()`;
  - `toEvidenceFacts()`.
- O runner executa importers sem assumir rede: cada provider específico continua livre para implementar fetch real,
  fetch autenticado, parser HTML/docs, API pública, daemon local ou fixture dry-run.
- Para cada importer, o runner cria `ProviderCatalogSource`, sanitiza raw payload em `rawPayloadRef`, converte rows em
  evidências, registra `CatalogImportRun` concluído ou falho e pode persistir tudo no `JsonModelGatewayCatalogStore`.
- Erros de import são capturados como import run falho e sanitizados pelo contrato de run; segredo em mensagem de erro
  não vaza para snapshot.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`36` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5608` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-53-54-304Z/summary.md`).

Decisão de roadmap:

- Faixa L agora tem a espinha dorsal para importers reais. O próximo passo deve ser `OpenAIModelsImporter` ou
  `OpenRouterModelsImporter`; OpenRouter tende a entregar mais metadados por payload e é bom para provar parsing rico,
  enquanto OpenAI é o menor importer autenticado para provar `/v1/models`.

## 18. Continuidade 2026-05-25 — primeiro importer real: OpenRouter

Investigação:

- O endpoint público `https://openrouter.ai/api/v1/models` respondeu com payload `{ data: [...] }` e, na amostra local,
  `357` modelos.
- Cada row pode trazer `id`, `canonical_slug`, `name`, `description`, `context_length`, `architecture`,
  `pricing`, `top_provider`, `per_request_limits`, `supported_parameters`, `default_parameters`, `knowledge_cutoff`,
  `expiration_date` e links de endpoints.
- Este é um bom primeiro importer real porque combina identidade, preço, contexto, modalidades, parâmetros suportados e
  hints de provedor superior sem exigir segredo.

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/importers/openrouter-models-importer.js`.
- Criado barrel `src/copilot/model-gateway/catalog/importers/index.js`.
- Exportados pelo barrel de catálogo e pelo barrel raiz:
  - `OPENROUTER_MODELS_CATALOG_URL`;
  - `createOpenRouterModelsImporter()`.
- O importer usa `fetch` injetável, mantém `requiresAuth=false`, `sourceKind=public_api`, TTL de uma hora e a URL
  pública oficial.
- `parseRows()` extrai rows de `data`.
- `toEvidenceFacts()` emite evidências field-wise para:
  - `displayName`;
  - aliases (`canonicalSlug`, `huggingFaceId`);
  - `description`;
  - `limits.contextWindowTokens`;
  - `limits.maxOutputTokens`;
  - `modalities.input`/`modalities.output`;
  - `supportedParameters`;
  - preços por milhão de tokens de input/output/cache e web search por request;
  - `routingHints.openrouterTopProvider`.
- Importante: suporte a `tools`, `tool_choice` ou `structured_outputs` vindo do catálogo segue como evidência
  `catalog`, não como `probe_verified`; promoção agentic ainda depende dos probes da camada de runtime.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`37` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5609` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T14-58-58-311Z/summary.md`).

Próxima direção:

- Commitar/pushar este corte.
- Depois, implementar `OpenAIModelsImporter` como o menor importer autenticado e/ou criar um comando programático de
  refresh que permita rodar `OpenRouterModelsImporter` em snapshot JSON com diff.

## 19. Continuidade 2026-05-25 — importer autenticado OpenAI

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/importers/openai-models-importer.js`.
- Exportados pelo barrel de importers, barrel de catálogo e barrel raiz:
  - `OPENAI_MODELS_CATALOG_URL`;
  - `createOpenAIModelsImporter()`.
- O importer aponta para `https://api.openai.com/v1/models`, exige `OPENAI_API_KEY`, usa `requiresAuth=true`,
  `sourceKind=authenticated_api` e registra `envRequirements=['OPENAI_API_KEY']`.
- O fetch real recebe a API key apenas no header `Authorization`; a key não entra em source, raw payload, evidence,
  import run ou snapshot.
- `parseRows()` extrai rows de `data`.
- `toEvidenceFacts()` emite evidências `authenticated_catalog` para:
  - `displayName`;
  - `aliases.openaiModelId`;
  - `lifecycle.createdAt`;
  - `providerMetadata.ownedBy`.

Decisão arquitetural:

- `/v1/models` é fonte de disponibilidade/identidade account-scoped, não de capabilities completas. Por isso o checkbox
  de OpenAI foi dividido: importer account-scoped está fechado; seeds/docs oficiais de capacidades, famílias,
  reasoning/tools/modalidades e depreciações seguem como tarefa separada.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`38` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5610` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T15-03-50-067Z/summary.md`).

## 20. Continuidade 2026-05-25 — normalização para schema OpenAI com extensão rica

Investigação/ajuste conceitual:

- O gateway deve ser universal na ingestão e rico na metadata, mas a superfície interoperável deve falar primeiro a
  linguagem OpenAI-compatible.
- O schema público mínimo passa a ser o equivalente ao Models API:
  - `id`;
  - `object`;
  - `created`;
  - `owned_by`.
- Tudo que é nosso, rico ou provider-specific fica em `x_model_gateway`, sem poluir o contrato OpenAI básico.
- Também foi identificado um gap: evidências `aliases.*`, `lifecycle.*`, `description` e `providerMetadata.*` eram
  produzidas, mas a projection descartava parte delas por normalizar `aliases` e `lifecycle` de modo estreito demais.

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/openai-schema.js`.
- Exportados pelo barrel de catálogo e pelo barrel raiz:
  - `OPENAI_MODEL_OBJECT`;
  - `OPENAI_MODEL_LIST_OBJECT`;
  - `toOpenAIModelCatalogEntry()`;
  - `toOpenAIModelCatalogList()`.
- `toOpenAIModelCatalogEntry()` gera:
  - `id`: provider-local model id;
  - `object: "model"`;
  - `created`: unix timestamp quando houver `openai.created` ou `lifecycle.createdAt`;
  - `owned_by`: `openai.owned_by`, `providerMetadata.ownedBy` ou `providerId`.
- `x_model_gateway` carrega metadata ampla em estilo OpenAI-friendly/snake_case:
  - ids do gateway/provider;
  - display/description;
  - lifecycle/aliases/family;
  - modalidades/capabilities/parâmetros;
  - limits/pricing/rate limits/data policy;
  - provider metadata/routing hints;
  - overlays, provenance e confidence por campo.
- `createCanonicalModelProjection()` agora preserva:
  - `description`;
  - `aliases` como array ou mapa rico;
  - `lifecycle` como string ou objeto;
  - `providerMetadata`;
  - `openai`.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`39` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5611` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T15-14-46-640Z/summary.md`).

Próxima direção:

- Commitar/pushar este corte.
- Em seguida, conectar refresh/diff programático para gerar snapshots OpenAI-compatible a partir dos importers reais.

## 21. Continuidade 2026-05-25 — refresh programático com diff e saída OpenAI

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/refresh.js`.
- Exportado `refreshModelGatewayCatalog()` pelo barrel de catálogo e pelo barrel raiz.
- O refresh aceita importers e store/snapshot, roda os importers via `runCatalogImporters()`, substitui evidências das
  fontes reexecutadas e preserva evidências de fontes não tocadas, como overrides manuais ou outros providers.
- Depois do refresh, o pipeline:
  1. reagrupa evidências por `providerId/providerModel/routeProfile`;
  2. chama `mergeModelMetadataEvidence()` por grupo;
  3. reconstrói `projections`;
  4. coleta conflitos por projection;
  5. calcula diff contra `previous.projections`;
  6. persiste snapshot atualizado quando há store;
  7. retorna também `openai: { object: "list", data: [...] }`.
- A decisão de substituir evidências por fonte no refresh é importante para detectar remoções: se uma fonte pública não
  retorna mais um modelo, a projection daquele modelo desaparece, mas evidências manuais/de outras fontes permanecem.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`40` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5612` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T15-19-13-644Z/summary.md`).

Próxima direção:

- Commitar/pushar este corte.
- Depois, criar comando terminal ou script programático fino para acionar refresh OpenRouter/OpenAI e inspecionar diff.

## 22. Continuidade 2026-05-25 — composição padrão de importers

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/default-importers.js`.
- Exportado `createDefaultModelGatewayCatalogImporters()` pelo barrel de catálogo e pelo barrel raiz.
- A composição padrão inclui:
  - `OpenRouterModelsImporter`, público, sempre que `includePublic=true`;
  - `OpenAIModelsImporter`, autenticado, apenas quando `OPENAI_API_KEY` ou `COPILOT_OPENAI_API_KEY` existe e
    `includeAuthenticated=true`.
- A API aceita `fetchImpl` injetável, permitindo terminal, scripts e testes usarem o mesmo pipeline sem rede implícita.
- A API key fica fechada no importer e não aparece em JSON/stringificação de importers, snapshot, evidence ou output.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`41` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5613` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T15-23-21-473Z/summary.md`).

Próxima direção:

- Commitar/pushar este corte.
- Depois, expor o refresh em comando/superfície operacional, começando por uma saída resumida de diff e contagem
  OpenAI-compatible.

## 23. Continuidade 2026-05-25 — comando terminal de refresh do catálogo

Implementado neste corte:

- Adicionado `/byok gateway catalog refresh`.
- O comando usa:
  - `JsonModelGatewayCatalogStore(DEFAULT_MODEL_GATEWAY_CATALOG_PATH)`;
  - `createDefaultModelGatewayCatalogImporters({ env: process.env })`;
  - `refreshModelGatewayCatalog({ store, importers })`.
- A saída mostra apenas resumo operacional:
  - path do store;
  - importers habilitados;
  - schema `OpenAI+x_model_gateway`;
  - contagem de projections, itens OpenAI e runs;
  - diff resumido com até 5 adicionados/removidos/alterados.
- O comando não imprime raw payload, headers, API keys nem corpo de catálogo. A API key da OpenAI permanece fechada no
  importer e o snapshot continua passando pela sanitização do store.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`50` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5614` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T15-28-45-902Z/summary.md`).

Próxima direção:

- Commitar/pushar este corte.
- Depois, avançar normalizadores finos de Faixa M: modalidades/capabilities/limits/pricing com vocabulário OpenAI
  estendido e evidências sempre rastreáveis.

## 24. Continuidade 2026-05-25 — normalizadores de modalidades e capability hints

Implementado neste corte:

- Criado `src/copilot/model-gateway/catalog/normalizers.js`.
- Exportados pelo barrel de catálogo e pelo barrel raiz:
  - `normalizeCatalogModalities()`;
  - `parseModelModalityExpression()`;
  - `normalizeModelModalities()`;
  - `normalizeOpenAICompatibleModelCapabilities()`.
- O normalizador de modalidades converte vocabulários variados para o conjunto canônico:
  `text`, `image`, `audio`, `video`, `pdf`, `embedding`, `rerank`, `asr`, `tts`, `image-generation`.
- `parseModelModalityExpression()` entende expressões estilo OpenRouter, como `text+image->text`.
- `normalizeOpenAICompatibleModelCapabilities()` extrai hints de catálogo a partir de `supported_parameters` e
  modalidades:
  - `tools`;
  - `forcedToolChoice`;
  - `parallelToolCalls`;
  - `jsonMode`;
  - `structuredOutputs`;
  - `reasoningEffort`;
  - `streaming`;
  - `vision`;
  - `audio`;
  - `video`;
  - `codeExecution`;
  - `webSearch`.
- O `OpenRouterModelsImporter` agora usa esses normalizers e emite evidências `capabilities.*` como confidence
  `catalog`. Isso melhora seleção pré-probe sem confundir catálogo com `probe_verified`.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`42` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5615` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T15-34-20-304Z/summary.md`).

Próxima direção:

- Commitar/pushar este corte.
- Depois, continuar Faixa M em limites/pricing normalizados com unidade/currency explícitas no `x_model_gateway`.

## 25. Continuidade 2026-05-25 — normalizadores de limits/pricing com unidades explícitas

Implementado neste corte:

- `src/copilot/model-gateway/catalog/normalizers.js` ganhou:
  - `normalizeModelTokenLimits()`;
  - `normalizeUsdPricing()`.
- `normalizeModelTokenLimits()` normaliza campos de limite sem misturar com prova runtime:
  - `contextWindowTokens`;
  - `maxOutputTokens`;
  - `maxRequestTokens`;
  - `tokensPerMinute`;
  - `requestsPerMinute`;
  - `dailyRequests`.
- `normalizeUsdPricing()` normaliza preço em USD com unidade explícita:
  - `currency: "USD"`;
  - `tokenUnit: "per_million_tokens"`;
  - `requestUnit: "per_request"`;
  - `inputUsdPerMillion`;
  - `outputUsdPerMillion`;
  - `cacheReadUsdPerMillion`;
  - `cacheWriteUsdPerMillion`;
  - `requestUsd`;
  - `webSearchUsdPerRequest`.
- O `OpenRouterModelsImporter` agora usa esses normalizers para emitir evidências `limits.*` e `pricing.*`, incluindo
  moeda/unidade. Isso evita que o banco misture preço por token, por milhão de tokens e por request sem contexto.
- Preços por token são arredondados em escala de 6 casas após conversão para milhão de tokens, evitando ruído binário
  como `0.19999999999999998`.

Separação arquitetural reafirmada:

- `limits.*` e `pricing.*` vindos de catálogo são fatos de metadado/proveniência.
- Acesso real, cota efetiva do token do operador, quota por organização, rate-limit dinâmico e sucesso de chamada seguem
  na fase runtime/overlay/health, não na normalização base.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`43` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5616` testes, `0` falhas, `warnings/errors unique=0 total=0`;
  resumo `artifacts/test-runs/copilot/2026-05-25T15-47-33-052Z/summary.md`).

Próxima direção:

- Commitar/pushar este corte.
- Depois, avançar lifecycle/aliases e começar a modelar explicitamente overlays account-scoped para acesso efetivo.

## 26. Continuidade 2026-05-25 — lifecycle, aliases e preservação ampla do payload útil

Implementado neste corte:

- `src/copilot/model-gateway/catalog/normalizers.js` ganhou:
  - `normalizeModelAliases()`;
  - `normalizeModelLifecycle()`.
- `normalizeModelAliases()` preserva ids e aliases sem tentar selecionar modelo:
  - `providerModel`;
  - `canonicalSlug`;
  - `huggingFaceId`;
  - `version` extraída de `YYYYMMDD` ou `YYYY-MM-DD`;
  - `isLatestAlias` quando o id é alias instável como `latest`.
- `normalizeModelLifecycle()` transforma metadata temporal em fatos auditáveis:
  - `createdAt`;
  - `expiresAt`;
  - `knowledgeCutoff`;
  - `providerStatus`;
  - `channel=preview` por hint de nome;
  - `status=active`, `scheduled_retirement` ou `retired`.
- O `OpenRouterModelsImporter` agora preserva mais campos oferecidos pelo endpoint em evidências:
  - aliases/version;
  - lifecycle/status;
  - `providerMetadata.openrouter.createdUnix`;
  - `providerMetadata.openrouter.canonicalSlug`;
  - `providerMetadata.openrouter.modality`;
  - `providerMetadata.openrouter.tokenizer`;
  - `providerMetadata.openrouter.instructType`;
  - `providerMetadata.openrouter.defaultParameters`;
  - `providerMetadata.openrouter.supportedVoices`;
  - `providerMetadata.openrouter.perRequestLimits`;
  - `providerMetadata.openrouter.detailsPath`.

Separação arquitetural reafirmada:

- Alias instável, preview, expiração e parâmetros default são metadados de catálogo.
- Eles podem afetar seleção e ordem de preferência depois, mas não provam acesso, execução, tool calling nem streaming.
- Acesso efetivo por token/conta, modelo pago liberado, cota real e sucesso de chamada entram em overlay/runtime.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`44` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5617` testes totais, `5584` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T15-53-37-408Z/summary.md`).

Próxima direção:

- Depois, avançar `accountScoped`/overlays: diferenciar catálogo público, modelos disponíveis para a key do operador,
  quotas efetivas e provas runtime.

## 27. Continuidade 2026-05-25 — overlays account-scoped como camada separada de acesso

Implementado neste corte:

- `CatalogImporter` agora pode retornar `toAccountOverlays(rows, context)` além de `toEvidenceFacts(rows, context)`.
- `runCatalogImporters()` persiste `accountOverlays` no snapshot com upsert próprio, mantendo:
  - `sources` como origem do endpoint/importer;
  - `evidences` como fatos de metadata por modelo;
  - `accountOverlays` como visão autenticada de conta/key;
  - `rawPayloadRefs` como referência redigida ao payload original.
- `createProviderAccountOverlay()` ganhou campos de proveniência e confiança:
  - `accountOverlayId`;
  - `sourceId`;
  - `sourceKind`;
  - `confidence`;
  - `providerMetadata`.
- `OpenAIModelsImporter` agora interpreta `/v1/models` também como overlay autenticado:
  - `enabledModels` recebe os modelos que a key atual consegue listar;
  - `secretRef` guarda somente o nome lógico da chave (`OPENAI_API_KEY`, `COPILOT_OPENAI_API_KEY` etc.);
  - `providerMetadata.semantics=account_visible_models` deixa explícito que isso não prova chamada runtime.
- `createDefaultModelGatewayCatalogImporters()` preserva qual variável de ambiente originou a key OpenAI e passa essa
  referência ao overlay sem serializar o valor secreto.

Separação arquitetural reafirmada:

- Catálogo público responde “o provider anuncia o modelo?”.
- Overlay account-scoped responde “esta conta/key lista ou habilita este modelo?”.
- Runtime probes continuam sendo a etapa posterior que responde “o modelo realmente executa chat, stream, tools,
  JSON/structured output, reasoning, visão etc. com esta configuração?”.
- Seleção final deve combinar as três camadas depois, junto com preferências do operador, custo, risco e saúde.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`44` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5617` testes totais, `5584` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T15-59-21-749Z/summary.md`).

Próxima direção:

- Começar a estruturar overlays account-scoped para outros providers e um contrato normalizado para quotas,
  rate limits, billing/free-tier e allow/block lists quando os endpoints oferecerem esses campos.

## 28. Continuidade 2026-05-25 — normalização de controles de overlay

Implementado neste corte:

- `normalizeAccountOverlayControls()` cria uma camada comum para informações autenticadas por conta/key:
  - `enabledModels`;
  - `blockedModels`;
  - `byokProviderKeys`;
  - `quota.dailyRequests`, `quota.dailyTokens`, `quota.monthlyBudgetUsd`, `quota.remainingCreditsUsd`,
    `quota.maxConcurrentRequests`;
  - `rateLimits.requestsPerMinute`, `rateLimits.tokensPerMinute`, `rateLimits.requestsPerDay`,
    `rateLimits.tokensPerDay`, `rateLimits.concurrentRequests`;
  - `spendingLimits.currency`, `spendingLimits.hardLimitUsd`, `spendingLimits.softLimitUsd`,
    `spendingLimits.remainingUsd`;
  - `providerMetadata.billingStatus`, `providerMetadata.plan`, `providerMetadata.freeTier` e metadados nativos.
- `OpenAIModelsImporter` já usa esse normalizador para montar o overlay de `/v1/models`.
- O normalizador fica exportado pelos barrels do catálogo e de `src/copilot/model-gateway`.

Separação arquitetural reafirmada:

- Quotas, billing, plano e listas allow/block são controles de conta.
- Esses controles podem restringir a seleção inicial, mas ainda não provam que um modelo responde uma chamada real.
- Provas de chat/stream/tools/JSON/visão/reasoning continuam reservadas para probes runtime.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`45` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5618` testes totais, `5585` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-04-12-369Z/summary.md`).

Próxima direção:

- Expandir providers/importers para preencher esse contrato quando endpoints autenticados oferecerem quotas,
  saldo, plano, allow/block lists ou BYOK interno.

## 29. Continuidade 2026-05-25 — primeiro gateway catalog importer: Kilo `/models`

Investigação consolidada neste corte:

- Documentação oficial Kilo confirma `https://api.kilo.ai/api/gateway` como base OpenAI-compatible.
- `GET https://api.kilo.ai/api/gateway/models` é público e retorna modelos com formato `provider/model-name`,
  pricing, context window e supported features.
- `GET /providers` também é público e deve virar uma segunda fonte para metadados de provider upstream, data policy,
  datacenters, ícones e políticas.
- O runtime Kilo continua separado em `/chat/completions` e FIM; nada deste corte promove capacidade runtime.

Implementado neste corte:

- Novo `KiloGatewayModelsImporter`:
  - aceita payload array direto ou `{ data: [...] }`;
  - preserva `displayName`, `description`, aliases, lifecycle e modalidades;
  - normaliza limits (`contextWindowTokens`, `maxOutputTokens`);
  - normaliza pricing USD por milhão/request/search quando o catálogo oferece esses campos;
  - infere capability hints de `supported_parameters`, inclusive `tools`, `vision`, `pdf` e `reasoningEffort`;
  - preserva `providerMetadata.kilo.upstreamProvider`, `isFree`, `preferredIndex`, `tokenizer`, `opencode` e
    `rawPricing`;
  - preserva `routingHints.kiloTopProvider`.
- `createDefaultModelGatewayCatalogImporters()` agora inclui Kilo junto com OpenRouter nas fontes públicas padrão.
- Barrels do catálogo e de `src/copilot/model-gateway` exportam o importer e a URL canônica.

Separação arquitetural reafirmada:

- Kilo `/models` alimenta o banco universal de metadata normalizada para OpenAI schema + `x_model_gateway`.
- Rotas `kilo-auto/*`, modelos free e provider/model são metadata/route candidates, não provas de chamada.
- `x-kilocode-mode`, organização, BYOK interno, allow/block lists e saldo entram em overlays; chat/stream/tools entram
  nos probes runtime posteriores.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`46` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5619` testes totais, `5586` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-10-25-239Z/summary.md`).

Próxima direção:

- Implementar `KiloGatewayProvidersImporter` para `/providers` e criar o primeiro contrato de metadata de
  provider/gateway, sem forçar tudo dentro de evidence por modelo.

## 30. Continuidade 2026-05-25 — provider metadata evidence e Kilo `/providers`

Implementado neste corte:

- Novo contrato `createProviderMetadataEvidence()` para fatos de provider/gateway que não pertencem a um modelo
  específico.
- O snapshot JSON ganhou `providerEvidences`, preservado pelo store com a mesma sanitização/redaction das outras
  coleções.
- `CatalogImporter` agora pode retornar `toProviderEvidenceFacts(rows, context)`, além de model evidences e
  account overlays.
- Novo `KiloGatewayProvidersImporter` para `https://api.kilo.ai/api/gateway/providers`:
  - preserva `displayName`;
  - preserva `providerMetadata.kilo.name`;
  - preserva `providerMetadata.kilo.slug`;
  - preserva `providerMetadata.kilo.headquarters`;
  - preserva `providerMetadata.kilo.datacenters`;
  - preserva `providerMetadata.kilo.iconUrl`;
  - normaliza `dataPolicy.training`, `dataPolicy.retainsPrompts` e `dataPolicy.canPublish`.
- Os importers padrão agora incluem:
  - OpenRouter `/models`;
  - Kilo `/models`;
  - Kilo `/providers`;
  - OpenAI `/v1/models` quando houver key.

Separação arquitetural reafirmada:

- `providerEvidences` descrevem providers upstream e políticas compartilhadas.
- `evidences` continuam descrevendo modelos/rotas.
- `accountOverlays` continuam descrevendo conta/key/plano.
- `runtime probes` continuam sendo a única fonte de prova de execução real.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`47` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5620` testes totais, `5587` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-15-51-069Z/summary.md`).

Próxima direção:

- Avançar o contrato de providers/gateways para projeção consolidada e uso na normalização OpenAI
  `x_model_gateway`, sem bloquear a etapa runtime.

## 31. Continuidade 2026-05-25 — provider projections consolidadas

Implementado neste corte:

- Novo contrato `createCanonicalProviderProjection()` para a visão atual por `providerId + subjectProviderId`.
- `mergeProviderMetadataEvidence()` faz merge field-wise de provider metadata com a mesma política de confiança,
  recência, proveniência e conflito usada em model metadata.
- O snapshot JSON ganhou `providerProjections`.
- `refreshModelGatewayCatalog()` agora:
  - retém provider evidences de fontes não atualizadas;
  - substitui provider evidences de fontes atualizadas;
  - gera `providerProjections`;
  - inclui conflitos de provider junto com conflitos de modelo.

Separação arquitetural reafirmada:

- `providerEvidences` são o ledger de fatos de provider.
- `providerProjections` são a visão atual consolidada, rápida para consulta e futura junção com modelos.
- `projections` continuam sendo modelos/rotas normalizados para OpenAI schema + `x_model_gateway`.
- Runtime permanece uma etapa posterior e não contamina provider/model catalog.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`48` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5621` testes totais, `5588` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-20-39-389Z/summary.md`).

Próxima direção:

- Decidir a junção entre `providerProjections` e model `x_model_gateway`: leitura rápida no refresh, projection
  materializada, ou join tardio no seletor/OpenAI list.

## 32. Continuidade 2026-05-25 — join tardio de provider projection no schema OpenAI

Decisão arquitetural:

- A junção entre modelos e providers fica tardia, no momento de criar o schema OpenAI-compatible.
- `projections` de modelo não duplicam `providerProjections`.
- `toOpenAIModelCatalogList(projections, { providerProjections })` pode enriquecer cada `x_model_gateway` com
  `provider_projection` quando houver match.
- `refreshModelGatewayCatalog()` passa `providerProjections` para `toOpenAIModelCatalogList()`.

Implementado neste corte:

- `toOpenAIModelCatalogEntry()` e `toOpenAIModelCatalogList()` aceitam `providerProjections` opcionais.
- `x_model_gateway.provider_projection` inclui:
  - `provider_id`;
  - `subject_provider_id`;
  - `display_name`;
  - `data_policy`;
  - `provider_metadata`;
  - `provenance_by_field`;
  - `confidence_by_field`.
- O match inicial usa:
  - `providerMetadata.kilo.upstreamProvider`;
  - `providerMetadata.ownedBy`/`owned_by`;
  - fallback para `providerId`.

Separação arquitetural reafirmada:

- Banco persistido segue normalizado: model projection e provider projection separados.
- API OpenAI-compatible pode entregar uma visão enriquecida pronta para consumo.
- Seleção e runtime ainda podem escolher se usam o join materializado na resposta ou se fazem consulta própria.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`48` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5621` testes totais, `5588` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-25-07-653Z/summary.md`).

Próxima direção:

- Avaliar `ModelRouteOption`/route candidates para representar `kilo-auto/*`, provider/model, aggregator auto e
  fallback-chain como metadata de rota, não runtime.

## 33. Continuidade 2026-05-25 — route options no pipeline de catálogo

Implementado neste corte:

- `createModelRouteOption()` ganhou `sourceId`, `sourceKind` e `confidence`.
- `CatalogImporter` agora pode retornar `toRouteOptions(rows, context)`.
- `runCatalogImporters()` coleta e faz upsert de `routeOptions`.
- `refreshModelGatewayCatalog()` retém/substitui route options por fonte atualizada, como já faz com evidências.
- `KiloGatewayModelsImporter` emite route options:
  - `provider_model` para ids `provider/model`;
  - `gateway_auto` para ids `kilo-auto/*`;
  - `normalizedPolicy.routeLayer=gateway`;
  - `normalizedPolicy.autoSelection=true` para rotas auto.

Separação arquitetural reafirmada:

- `routeOptions` descrevem como uma rota pode ser selecionada.
- `routeOptions` não provam que a rota funciona.
- Runtime probes continuam necessários para promover uma rota a confiável/saudável.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`48` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5621` testes totais, `5588` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-30-33-137Z/summary.md`).

Próxima direção:

- Expandir route options para OpenRouter aggregator auto/provider order e Hugging Face cheapest/fastest/preferred.

## 34. Continuidade 2026-05-25 — OpenRouter aggregator route options

Implementado neste corte:

- `OpenRouterModelsImporter` agora emite `routeOptions` por modelo:
  - `selectorKind=aggregator_auto`;
  - `selectorSyntax=<providerModel>`;
  - `normalizedPolicy.routeLayer=aggregator`;
  - `normalizedPolicy.autoSelection=true`;
  - `normalizedPolicy.supportsProviderOrder=true`;
  - `normalizedPolicy.supportsFallbackChain=true`;
  - `providerSpecific.topProvider` preserva o hint público do catálogo.

Separação arquitetural reafirmada:

- OpenRouter auto routing é metadata de rota/aggregator.
- Provider order e fallback-chain são políticas possíveis de seleção, não prova runtime.
- Probes posteriores ainda decidem se a rota realmente executa chat/stream/tools/JSON/visão.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`48` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5621` testes totais, `5588` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-33-36-452Z/summary.md`).

Próxima direção:

- Avaliar Hugging Face/Kilo route variants restantes.

## 35. Continuidade 2026-05-25 — Kilo route policies explícitas

Implementado neste corte:

- `KiloGatewayModelsImporter` passou a enriquecer `routeOptions` com políticas específicas do gateway:
  - `providerSpecific.acceptedHeaders` com `x-kilocode-mode`, `X-KiloCode-OrganizationId` e `X-KiloCode-TaskId`;
  - `providerSpecific.supportsInternalByok=true`;
  - `normalizedPolicy.supportsOrganizationOverlay=true`;
  - `normalizedPolicy.supportsTaskId=true`;
  - `normalizedPolicy.internalByokProviderFailureFallback=false`.

Separação arquitetural reafirmada:

- Esses campos dizem como a rota deve ser montada/selecionada.
- Eles não autorizam runtime nem provam sucesso de chamada.
- A falha sem fallback de BYOK interno fica registrada como política de rota para o seletor respeitar depois.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`48` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5621` testes totais, `5588` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-36-46-683Z/summary.md`).

Próxima direção:

- Seguir para Hugging Face route selectors ou outro importer direto.

## 36. Continuidade 2026-05-25 — importer genérico OpenAI-compatible

Implementado neste corte:

- Novo `createOpenAICompatibleModelsImporter()` para endpoints `/models` compatíveis com OpenAI.
- O importer exige `providerId` e `url` ou `baseUrl`.
- Quando há `apiKey`, a fonte vira account-scoped e gera:
  - model evidences de identidade;
  - `routeOptions` `exact_model`;
  - `accountOverlays` com `enabledModels`;
  - `providerMetadata.openAICompatible=true`.
- Quando não há `apiKey`, continua útil como catálogo identity-only público/local.
- A saída continua separada:
  - `/models` genérico não prova capabilities ricas;
  - provider docs/catálogos ricos complementam metadata;
  - probes runtime validam execução real.

Uso previsto:

- Groq `/openai/v1/models`;
- Cerebras `/v1/models`;
- Chutes/Z.AI/LiteLLM/vLLM/servidores locais OpenAI-compatible;
- endpoints privados do operador que ainda não justificam importer especializado.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`49` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5622` testes totais, `5589` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-41-32-578Z/summary.md`).

Próxima direção:

- Escolher entre Groq/Cerebras via generic importer ou Hugging Face route selectors.

## 37. Continuidade 2026-05-25 — composição account-scoped OpenAI-compatible

Implementado neste corte:

- `createDefaultModelGatewayCatalogImporters()` usa o generic importer quando encontra keys conhecidas:
  - Groq: `GROQ_API_KEY`/`GROQ_KEY`;
  - Cerebras: `CEREBRAS_API_KEY`/`CEREBRAS_KEY`;
  - Chutes: `CHUTES_API_KEY`/`CHUTES_AI`;
  - Z.AI: `ZAI_API_KEY`/`Z_AI_KEY`.
- O valor secreto continua preso em closure e não aparece em JSON/stringify.
- Cada importer gerado coleta `/models` como visão account-scoped identity-only, com `accountOverlays` e
  `routeOptions`, sem promover capabilities ricas.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`49` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5622` testes totais, `5589` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T16-45-06-288Z/summary.md`).

Próxima direção:

- Complementar Groq/Cerebras com docs/catálogos de limites quando disponíveis.

## 38. Continuidade 2026-05-25 — releitura integral, situação atual e Cerebras public catalog

Investigação feita neste corte:

- Este roadmap foi relido integralmente, incluindo diagnóstico, arquitetura, Faixas A-P e todos os capítulos de
  continuidade 8-37.
- Estado git inicial: `main` limpo e sincronizado com `origin/main`.
- Situação arquitetural atual:
  - A-J estão fechadas e continuam sendo o contrato de compatibilidade operacional;
  - K-L já têm ledger JSON, import runs, raw refs, importers reais, provider evidences, provider projections,
    account overlays e route options;
  - M já cobre normalizadores de modalidades, capabilities de catálogo, limits, pricing, lifecycle, aliases e overlays;
  - N já cobre route options de Kilo e OpenRouter, mas ainda falta Hugging Face, Cloudflare e aliases locais;
  - O ainda precisa de SQLite, refresh incremental, eventos de catálogo e diff semântico;
  - P ainda precisa UX de exploração do catálogo universal.
- O metamodelo de 4.2 foi atualizado para refletir o que já existe no código:
  - `ProviderMetadataEvidence`;
  - `CanonicalProviderProjection`;
  - `ModelRouteOption.sourceId/sourceKind/confidence`;
  - `ProviderAccountOverlay.accountOverlayId/sourceId/sourceKind/confidence/providerMetadata`;
  - `CanonicalModelProjection.providerMetadata/openai`.
- O plano SQLite de 4.2 foi atualizado para incluir `provider_evidences` e `provider_projections`.
- Investigação online/oficial:
  - Cerebras documenta endpoint público de modelos em `https://api.cerebras.ai/public/v1/models`.
  - O endpoint real respondeu `200 application/json` e retornou payload `object=list` com rows ricas contendo `pricing`,
    `capabilities`, `supported_parameters`, `architecture`, `limits`, lifecycle (`deprecated`, `preview`),
    `hugging_face_id`, `owned_by`, datacenters e quantization.
  - Isso confirma que Cerebras não precisa depender apenas do `/v1/models` autenticado identity-only: o catálogo público
    pode alimentar metadata rica antes de runtime.

Implementado neste corte:

- Novo `CerebrasPublicModelsImporter` para `https://api.cerebras.ai/public/v1/models`.
- O importer público Cerebras emite evidências para:
  - `displayName`;
  - aliases e `huggingFaceId`;
  - lifecycle;
  - description;
  - limits (`contextWindowTokens`, `maxOutputTokens`, RPM/TPM quando presentes);
  - modalidades;
  - supported parameters;
  - capabilities (`streaming`, `tools`, `forcedToolChoice`, `parallelToolCalls`, `jsonMode`,
    `structuredOutputs`, `reasoningEffort`, `vision`);
  - pricing USD por milhão;
  - `providerMetadata.ownedBy`;
  - `providerMetadata.cerebras.*` para object, tokenizer, instruct type, datacenters, deprecated, preview e quantization.
- O importer também emite `routeOptions` `exact_model` com `normalizedPolicy.routeLayer=direct_provider`.
- Barrels de importers, catálogo e root exportam `CEREBRAS_PUBLIC_MODELS_CATALOG_URL` e
  `createCerebrasPublicModelsImporter()`.
- `createDefaultModelGatewayCatalogImporters()` inclui Cerebras public catalog quando `includePublic=true`.
- A checkbox de Cerebras na Faixa L foi marcada como concluída porque:
  - `/v1/models` autenticado já fica coberto pelo generic OpenAI-compatible importer quando há `CEREBRAS_API_KEY`;
  - o catálogo público rico agora é coberto por importer dedicado.

Separação arquitetural reafirmada:

- Cerebras public catalog prova metadata pública rica, não acesso por conta.
- Cerebras `/v1/models` account-scoped continua sendo overlay/listagem por key via generic importer.
- Chat/stream/tools/JSON/reasoning reais continuam dependendo de probes runtime.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`50` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5623` testes totais, `5590` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T17-00-16-920Z/summary.md`).

Próxima direção:

- Avançar para Groq docs/model card enrichment ou para diff semântico de catálogo (`price/limits/capabilities`
  alterados).

## 39. Continuidade 2026-05-25 — diff semântico de catálogo

Implementado neste corte:

- `diffCanonicalModelProjections()` agora mantém `changedFields` e acrescenta `changedKinds`.
- `changedKinds` classifica mudanças em:
  - `pricing_changed`;
  - `limits_changed`;
  - `capabilities_changed`;
  - `lifecycle_changed`;
  - `deprecation_changed`;
  - `modalities_changed`;
  - `account_overlay_changed`;
  - `routing_changed`;
  - `provider_metadata_changed`;
  - `metadata_changed`.
- O diff continua storage-neutral e secret-safe, mas passa a ser útil para governança operacional:
  - preço mudou;
  - contexto/limites mudaram;
  - capability mudou;
  - lifecycle/deprecation mudou.
- O catálogo de eventos ganhou nomes canônicos para a governança futura de refresh:
  - `model_gateway:catalog:import_started`;
  - `model_gateway:catalog:import_completed`;
  - `model_gateway:catalog:model_added`;
  - `model_gateway:catalog:model_changed`;
  - `model_gateway:catalog:model_removed`;
  - `model_gateway:catalog:conflict_detected`.
- `buildCatalogRefreshCompletedEvent()` e `projectCatalogRefreshCompletedMetrics()` projetam refresh/diff em evento e
  métricas sem raw payload.
- `summarizeCanonicalModelProjectionDiff()` virou helper canônico para resumir diff:
  - `addedCount`;
  - `removedCount`;
  - `changedCount`;
  - `changedKinds`;
  - `changedKindCounts`, contando quantos modelos mudaram por tipo semântico.
- `/byok gateway catalog refresh` agora mostra `diff kinds` e inclui `changedKinds` por item alterado.

Separação arquitetural reafirmada:

- Diff semântico não troca modelo ativo automaticamente.
- Ele gera sinal auditável para operador, terminal e eventos futuros.
- Runtime probes continuam sendo etapa posterior quando uma mudança de capability ou lifecycle exigir reprovação.

Validação deste corte:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`102` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5625` testes totais, `5592` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T17-16-08-564Z/summary.md`).

Próxima direção:

- Validar, commitar/pushar e depois evoluir emissão real de eventos por run/model/conflict ou diff UX dedicado.

## 40. Continuidade 2026-05-25 — emissão real de eventos de catálogo

Implementado neste corte:

- A camada de observabilidade passou a ter builders canônicos para eventos de refresh:
  - `buildCatalogRefreshStartedEvent()`;
  - `buildCatalogRefreshModelEvents()`;
  - `buildCatalogConflictDetectedEvents()`;
  - `buildCatalogRefreshEventBatch()`.
- `buildCatalogRefreshEventBatch()` organiza a sequência pós-refresh sem raw payload:
  - eventos por modelo adicionado/removido/alterado;
  - eventos por conflito de evidência;
  - evento agregado `model_gateway:catalog:import_completed` ao final.
- `/byok gateway catalog refresh` agora aceita `eventBus` como as probes e o roteamento:
  - emite `model_gateway:catalog:import_started` antes da coleta;
  - emite o batch de modelo/conflito/completed depois do refresh;
  - continua usando o mesmo batch para exibir `diff kinds` no terminal.
- A checkbox de eventos da Faixa O foi marcada como concluída para o contrato atual.

Separação arquitetural reafirmada:

- `refreshModelGatewayCatalog()` permanece storage-neutral e não conhece `eventBus`.
- A camada de observabilidade transforma resultado de refresh em eventos estáveis.
- O terminal apenas emite eventos quando recebe um bus; sem bus, a experiência CLI continua determinística.
- Eventos de catálogo não executam probes, não promovem modelo e não alteram seleção ativa.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`103` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5626` testes totais, `5593` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T17-22-13-918Z/summary.md`).

Próxima direção:

- Commitar/pushar e avançar para UX de diff dedicada ou seleção de probes recomendadas por diff.

## 41. Continuidade 2026-05-25 — recomendações de probes derivadas do diff

Implementado neste corte:

- Novo `recommendCatalogDiffProbes()` em `model-gateway/probes/recommendations.js`.
- A função recebe somente `diff` + `projections` e retorna recomendações explícitas:
  - `key`;
  - `providerId`;
  - `providerModel`;
  - `routeProfile`;
  - `priority`;
  - `probeKinds`;
  - `reasons`;
  - `commands`.
- Regras atuais:
  - modelos novos de alto valor sugerem `chat` e probes específicas para `streaming`, `json`, `agent` e `vision`
    quando a projeção de metadata indica essas superfícies;
  - mudanças em capabilities/limits/modalidades também podem sugerir reprova runtime;
  - mudanças só de preço/lifecycle não executam probes por si mesmas.
- `/byok gateway catalog refresh` agora mostra `probe suggestions` após o diff quando houver recomendações.
- A checkbox da Faixa O para sugestão de probes foi marcada como concluída para o contrato inicial.

Separação arquitetural reafirmada:

- Metadata continua sendo fase anterior.
- `recommendCatalogDiffProbes()` não executa runtime, não chama SDK e não altera health.
- Os comandos sugeridos apontam para `/byok probe ...`, mantendo execução explícita pelo operador.
- Vision é tratada como superfície a validar quando metadata indicar suporte; ela não exclui automaticamente modelos.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`104` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5627` testes totais, `5594` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T17-28-07-810Z/summary.md`).

Próxima direção:

- Commitar/pushar e avançar para UX `/models catalog diff`.

## 42. Continuidade 2026-05-25 — UX persistida de diff do catálogo

Implementado neste corte:

- `refreshModelGatewayCatalog()` agora persiste um import run agregado:
  - `providerId=model-gateway`;
  - `sourceId=catalog-refresh`;
  - `diff` completo do refresh;
  - `rowCount` das projections finais.
- Nova UX sem rede:
  - `/byok gateway catalog diff`;
  - `/models catalog diff`.
- A UX lê o último diff persistido no snapshot JSON e mostra:
  - added/removed/changed;
  - `changedKinds`;
  - conflitos atuais do snapshot;
  - sugestões de probes derivadas do diff/projections.
- A checkbox `/models catalog diff` da Faixa P foi marcada como concluída.

Separação arquitetural reafirmada:

- `catalog diff` não chama importers e não toca rede.
- O diff exibido é o último resultado persistido do refresh.
- Sugestões continuam explícitas e não executam probes automaticamente.
- O run agregado prepara a futura migração SQLite sem exigir mudança no contrato de CLI.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`106` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5629` testes totais, `5596` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T17-34-38-974Z/summary.md`).

Próxima direção:

- Commitar/pushar e avançar para `/models catalog refresh [provider]` ou `/models conflicts`.

## 43. Continuidade 2026-05-25 — UX de conflitos do catálogo

Implementado neste corte:

- Nova UX sem rede para conflitos persistidos:
  - `/byok gateway catalog conflicts`;
  - `/models conflicts`;
  - `/models catalog conflicts`.
- A tela lê `snapshot.conflicts` e mostra:
  - `projectionKey`;
  - `fieldPath`;
  - evidência selecionada;
  - evidências conflitantes.
- A checkbox `/models conflicts` da Faixa P foi marcada como concluída.

Separação arquitetural reafirmada:

- Conflito de evidência não é falha runtime.
- A tela não chama importers, não executa probes e não altera seleção ativa.
- O objetivo é orientar normalização/manual override futuro e explicar por que um campo foi escolhido.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`107` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5630` testes totais, `5597` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T17-39-10-309Z/summary.md`).

Próxima direção:

- Validar, commitar/pushar e avançar para `/models catalog refresh [provider]`.

## 44. Continuidade 2026-05-25 — `/models catalog refresh [provider]`

Implementado neste corte:

- `/models catalog refresh [provider]` foi encaminhado para o refresh universal.
- `/byok gateway catalog refresh [provider]` também aceita o mesmo seletor.
- O seletor filtra importers por `id` ou `providerId`, permitindo refresh focado por provider/importer antes do TTL/cache
  incremental completo.
- A saída do refresh agora mostra `selector=<valor>` para deixar claro quando a coleta foi filtrada.
- A checkbox `/models catalog refresh [provider]` da Faixa P foi marcada como concluída.

Separação arquitetural reafirmada:

- O filtro escolhe quais importers coletar; ele não altera critérios de seleção runtime.
- O refresh focado continua gerando diff, eventos e sugestões de probes da mesma forma que o refresh completo.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  (`108` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5631` testes totais, `5598` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T17-43-17-128Z/summary.md`).

## 45. Continuidade 2026-05-25 — importer autenticado Mistral

Investigação oficial:

- A documentação da Mistral confirma `GET /v1/models` como listagem de modelos disponíveis para o usuário.
- O endpoint usa `Authorization: Bearer <key>`.
- A resposta documentada inclui `id`, `capabilities`, `created`, `owned_by`, `name`, `description`,
  `max_context_length`, `aliases`, `deprecation`, `deprecation_replacement_model`, `default_model_temperature`,
  `TYPE` e `archived`.
- Também há `GET /v1/models/{model_id}` para detalhe por modelo, reservado para uma fase posterior de enriquecimento
  incremental por modelo.

Implementado neste corte:

- Novo `MistralModelsImporter` para `https://api.mistral.ai/v1/models`.
- O importer é account-scoped/autenticado e usa `MISTRAL_API_KEY` ou `MISTRAL_KEY` na composição padrão.
- O payload vira evidências para:
  - `displayName`;
  - `description`;
  - aliases normalizados e aliases Mistral;
  - lifecycle created/retirement/replacement;
  - `limits.contextWindowTokens`;
  - modalidades text/image quando `vision=true`;
  - capabilities `chat`, `tools`, `codeCompletion`, `vision`, `classification`, `fineTuning`;
  - `providerMetadata.ownedBy` e campos Mistral específicos;
  - campos OpenAI-compatible `openai.created` e `openai.owned_by`.
- O importer também emite:
  - `ModelRouteOption` `exact_model`;
  - `ProviderAccountOverlay` com modelos habilitados pela key, sem serializar segredo.
- Barrels de importers, catálogo e root exportam `MISTRAL_MODELS_CATALOG_URL` e `createMistralModelsImporter()`.

Separação arquitetural reafirmada:

- Capabilities vindas de `/v1/models` têm confiança `authenticated_catalog`, não `probe_verified`.
- A conta/key prova visibilidade do modelo, não sucesso de chat/tools/vision.
- Probes continuam sendo a fase posterior para promoção runtime.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`55` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5632` testes totais, `5599` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T19-14-56-748Z/summary.md`).

Próxima direção:

- Rodar suíte completa, commitar/pushar e seguir para Anthropic, Gemini ou Groq especializado.

## 46. Continuidade 2026-05-25 — importer autenticado Anthropic

Investigação oficial:

- A documentação oficial da Anthropic confirma `GET /v1/models` como API para listar os modelos disponíveis para uma
  key/workspace.
- A chamada usa headers `x-api-key` e `anthropic-version`; mantemos `2023-06-01` como default explícito.
- A listagem é paginada por `before_id`, `after_id` e `limit`; `limit` aceita até `1000`.
- Cada item expõe `id`, `display_name`, `created_at` e `type`.
- A documentação também confirma `GET /v1/models/{model_id}` para resolver um modelo/alias específico. Esse detalhe
  fica reservado para enriquecimento incremental posterior, porque a listagem já resolve a camada de visibilidade da
  conta.

Implementado neste corte:

- Novo `AnthropicModelsImporter` para `https://api.anthropic.com/v1/models`.
- O importer pagina automaticamente com `limit=1000` e cursor `after_id`, até encerrar `has_more` ou atingir um teto
  defensivo de páginas.
- O importer é account-scoped/autenticado e entra na composição padrão quando `ANTHROPIC_API_KEY` ou `ANTHROPIC_KEY`
  estão presentes.
- O payload vira evidências para:
  - `displayName`;
  - aliases normalizados;
  - lifecycle `createdAt`;
  - `providerMetadata.ownedBy`;
  - `providerMetadata.anthropic.type`;
  - campos OpenAI-compatible `openai.created` e `openai.owned_by`.
- O importer também emite:
  - `ModelRouteOption` `exact_model`;
  - política normalizada `routeLayer=direct_provider` e `wireApi=anthropic_messages`;
  - `ProviderAccountOverlay` com modelos visíveis pela key, endpoint e versão Anthropic, sem serializar segredo.
- Barrels de importers, catálogo e root exportam `ANTHROPIC_MODELS_CATALOG_URL`,
  `ANTHROPIC_MODELS_API_VERSION` e `createAnthropicModelsImporter()`.

Separação arquitetural reafirmada:

- A listagem Anthropic prova visibilidade account-scoped, não sucesso de chamada Messages, tools, thinking, vision ou
  context window efetivo.
- Capabilities finas da Anthropic permanecem dependentes de docs/seeds por família e probes runtime posteriores.
- A rota normalizada continua OpenAI-schema-first no catálogo, mas preserva `wireApi=anthropic_messages` para o adapter
  não confundir schema catalogado com protocolo de transporte.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`56` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5633` testes totais, `5600` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T19-22-14-066Z/summary.md`).

Próxima direção:

- Depois da validação/push de Anthropic, seguir para Gemini `models.list`/`models.get`, porque ele oferece metadata rica
  de métodos suportados, input/output token limits e parâmetros diretamente na API oficial.

## 47. Continuidade 2026-05-25 — importer autenticado Gemini list/get

Investigação oficial:

- A documentação oficial do Google AI confirma que o endpoint Models permite listar modelos disponíveis e obter
  metadata estendida como funcionalidades suportadas e tamanho de contexto.
- `models.get` usa `GET https://generativelanguage.googleapis.com/v1beta/{name=models/*}` e exige que o nome corresponda
  a um item retornado por `models.list`.
- `models.list` usa `GET https://generativelanguage.googleapis.com/v1beta/models`, pagina por `pageSize`/`pageToken`,
  retorna no máximo `1000` modelos por página e expõe `nextPageToken`.
- A autenticação REST documentada para shell usa `?key=$GEMINI_API_KEY`.
- O recurso `Model` inclui `name`, `baseModelId`, `version`, `displayName`, `description`, `inputTokenLimit`,
  `outputTokenLimit`, `supportedGenerationMethods`, `thinking`, `temperature`, `maxTemperature`, `topP` e `topK`.

Implementado neste corte:

- Novo `GeminiModelsImporter` para `https://generativelanguage.googleapis.com/v1beta/models`.
- O importer pagina `models.list` com `pageSize=1000` e `pageToken`.
- Por padrão, cada item listado é enriquecido por `models.get`, com fallback sem falhar a importação se um detalhe
  individual retornar erro; erros de detalhe ficam no raw payload sanitizado como `detailErrors`.
- O importer entra na composição padrão quando `GEMINI_API_KEY` ou `GOOGLE_API_KEY` estão presentes.
- O payload vira evidências para:
  - `displayName`;
  - `description`;
  - aliases normalizados por `providerModel`, `baseModelId` e versão inferida quando houver;
  - `limits.contextWindowTokens` e `limits.maxOutputTokens`;
  - capabilities derivadas apenas de métodos declarados pelo endpoint: `chat`, `streaming`, `tokenCounting`,
    `embeddings`, `batch`, `prediction` e `reasoning` quando `thinking=true`;
  - `providerMetadata.ownedBy=google`;
  - `providerMetadata.gemini.*` com resource name, base model, version, métodos, thinking e parâmetros;
  - `openai.owned_by=google`.
- O importer também emite:
  - `ModelRouteOption` `exact_model`;
  - política normalizada `routeLayer=openai_compatible`;
  - `directWireApi=gemini_generate_content`;
  - `openAICompatibleBaseUrl=https://generativelanguage.googleapis.com/v1beta/openai`;
  - `resourceName=models/{model}`;
  - `ProviderAccountOverlay` com modelos visíveis pela key, versão da API e `authPlacement=query_key`, sem serializar
    segredo.
- Barrels de importers, catálogo e root exportam `GEMINI_MODELS_CATALOG_URL`, `GEMINI_MODELS_API_VERSION`,
  `GEMINI_OPENAI_COMPATIBLE_BASE_URL` e `createGeminiModelsImporter()`.

Separação arquitetural reafirmada:

- `models.list`/`models.get` oferecem metadata mais rica, mas ainda não provam runtime.
- Métodos como `generateContent`, `streamGenerateContent`, `countTokens` e `embedContent` viram capability hints
  autenticados; sucesso de chat/tools/vision/structured outputs continua dependendo de probes posteriores.
- Modalidades/capabilities de família vindas da página pública de modelos permanecem como próxima camada de seeds/docs,
  separada da camada de endpoint account-scoped.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`57` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5634` testes totais, `5601` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T19-28-42-394Z/summary.md`).

Próxima direção:

- Depois da suíte completa e push, seguir para Groq especializado ou Ollama. Groq fecha o caminho account-scoped
  OpenAI-compatible com docs de limite; Ollama fecha o caminho local com `/api/tags` + `/api/show`.

## 48. Continuidade 2026-05-25 — importer local Ollama tags/show

Investigação oficial:

- A documentação oficial do Ollama confirma `GET /api/tags` para listar modelos locais e seus detalhes.
- A resposta de `/api/tags` inclui `name`, `model`, `modified_at`, `size`, `digest` e `details` com `format`, `family`,
  `families`, `parameter_size` e `quantization_level`.
- A documentação oficial também confirma `POST /api/show` com body `{ "model": "..." }` e opção `verbose`.
- A resposta de `/api/show` inclui `parameters`, `license`, `capabilities`, `modified_at`, `details`, `template` e
  `model_info`, incluindo chaves como `*.context_length`, arquitetura, quantização e tokenizer.

Implementado neste corte:

- Novo `OllamaCatalogImporter` para daemon local, com defaults:
  - `OLLAMA_LOCAL_API_BASE_URL=http://localhost:11434/api`;
  - `OLLAMA_LOCAL_TAGS_URL=http://localhost:11434/api/tags`;
  - `OLLAMA_LOCAL_SHOW_URL=http://localhost:11434/api/show`;
  - `OLLAMA_LOCAL_OPENAI_BASE_URL=http://localhost:11434/v1`.
- O importer busca `/api/tags` e, para cada modelo local, chama `/api/show` com `verbose=false` por default.
- `baseUrl` aceita `http://host:11434`, `.../api` ou `.../v1`; o importer normaliza para APIs nativa e OpenAI-compatible.
- A composição padrão só inclui Ollama quando `OLLAMA_BASE_URL`, `OLLAMA_HOST` ou `COPILOT_OLLAMA_BASE_URL` estão
  presentes, evitando tentativas implícitas contra localhost em refresh genérico.
- O payload vira evidências para:
  - `displayName`;
  - aliases normalizados;
  - `limits.contextWindowTokens` por `num_ctx` dos parâmetros ou `*.context_length` do `model_info`;
  - capabilities declaradas por Ollama: `chat`, `vision`, `embeddings`, `tools` quando presentes;
  - modalidades text/image quando `vision` aparece;
  - `providerMetadata.ownedBy=local`;
  - digest, size bytes, modifiedAt, formato, família, famílias, parâmetro, quantização, parent model;
  - parâmetros parseados e texto bruto de parâmetros;
  - template, licença e `model_info` completo;
  - `openai.owned_by=local`.
- O importer também emite:
  - `ModelRouteOption` `exact_model`;
  - política `routeLayer=openai_compatible`, `runtimeKind=local`, `localPrivate=true`;
  - `nativeApiBaseUrl`, `openAICompatibleBaseUrl` e digest;
  - `ProviderAccountOverlay` sem segredo, com semântica `locally_installed_models`.
- Barrels de importers, catálogo e root exportam as constantes Ollama e `createOllamaCatalogImporter()`.

Separação arquitetural reafirmada:

- `/api/tags` + `/api/show` provam instalação local e metadata do daemon, não sucesso de chat/tools/vision em runtime.
- Tags locais são aliases instáveis; digest/hash é preservado como metadado de identidade forte.
- Ollama local entra como provider `ollama-local`, compatível com o adapter existente e marcado como rota privada/local.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`58` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5635` testes totais, `5602` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T19-34-39-605Z/summary.md`).

Próxima direção:

- Seguir para Groq especializado ou Hugging Face. Groq deve combinar `/openai/v1/models` account-scoped com docs de
  limites; Hugging Face exige preservar estratégias de provider/rota do Inference Providers Router.

## 49. Continuidade 2026-05-25 — importer autenticado Groq list/retrieve

Investigação oficial:

- A API Reference oficial da Groq expõe a seção Models com `List models` e `Retrieve model`.
- A base documentada é `https://api.groq.com/openai/v1`.
- O endpoint de chat referencia os modelos disponíveis e usa `Authorization: Bearer $GROQ_API_KEY`.
- A documentação de request confirma parâmetros OpenAI-compatible importantes como `tools`, `tool_choice`,
  `parallel_tool_calls`, `response_format`, `reasoning_effort`, `reasoning_format`, `max_completion_tokens`,
  `service_tier` e streaming.
- A documentação de modelo/API mostra campos de modelo como `context_window`, além de `active` e `public_apps`.

Implementado neste corte:

- Novo `GroqModelsImporter` para `https://api.groq.com/openai/v1/models`.
- O importer busca a lista account-scoped e, por padrão, enriquece cada item com `GET /models/{model}`.
- IDs com slash, como `openai/gpt-oss-120b`, são codificados como segmento (`openai%2Fgpt-oss-120b`) na chamada de
  retrieve.
- A composição padrão passa a usar `GroqModelsImporter` para `GROQ_API_KEY`/`GROQ_KEY`; Groq sai da lista genérica
  OpenAI-compatible para evitar duplicação.
- O payload vira evidências para:
  - `displayName`;
  - aliases normalizados;
  - lifecycle por `created` e status provider `active/inactive`;
  - `limits.contextWindowTokens`;
  - hints conservadores de capabilities: chat por default, ASR para modelos Whisper, reasoning para famílias
    explicitamente nomeadas como GPT-OSS/Qwen3/DeepSeek-R1;
  - modalidades text/text ou audio/text para Whisper;
  - `providerMetadata.ownedBy`;
  - `providerMetadata.groq.object`, `active`, `contextWindow`, `publicApps`;
  - campos OpenAI-compatible `openai.created` e `openai.owned_by`.
- O importer também emite:
  - `ModelRouteOption` `exact_model`;
  - política `routeLayer=openai_compatible` e `openAICompatibleBaseUrl`;
  - `ProviderAccountOverlay` com `enabledModels` para ativos e `blockedModels` para `active=false`, sem serializar
    segredo.
- Barrels de importers, catálogo e root exportam `GROQ_MODELS_CATALOG_URL`, `GROQ_OPENAI_BASE_URL` e
  `createGroqModelsImporter()`.

Separação arquitetural reafirmada:

- `context_window` e `active` são metadata account-scoped de catálogo, não prova runtime.
- Tool use, built-in tools, JSON/structured outputs e reasoning continuam como enriquecimento por docs/seeds e probes
  posteriores; o importer só infere hints mínimos a partir de famílias de modelo explícitas.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`59` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5636` testes totais, `5603` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T19-41-49-502Z/summary.md`).

Próxima direção:

- Continuar para Hugging Face ou Cloudflare. Hugging Face exige preservar rotas `:fastest`, `:cheapest`,
  `:preferred` e provider explícito; Cloudflare exige separar Workers AI direto de AI Gateway.

## 50. Continuidade 2026-05-25 — importer Hugging Face Inference Providers

Investigação oficial:

- A documentação oficial do Hugging Face Inference Providers confirma o router OpenAI-compatible em
  `https://router.huggingface.co/v1`.
- O comportamento default do router é selecionar o provider mais rápido, equivalente a `:fastest`.
- O operador pode escolher política via sufixo no model id: `:fastest`, `:cheapest` ou `:preferred`.
- O operador também pode escolher provider explícito anexando o provider ao model id, por exemplo
  `openai/gpt-oss-120b:sambanova`.
- A documentação pública descreve `GET /v1/models` como listagem de modelos com metadados por provider, incluindo
  preço, contexto, latência e throughput quando disponíveis.

Implementado neste corte:

- Novo `HuggingFaceInferenceProvidersImporter` para `https://router.huggingface.co/v1/models`.
- O importer aceita modo público ou autenticado; na composição padrão entra quando `HF_TOKEN` ou
  `HUGGINGFACE_API_TOKEN` estão presentes.
- O parser é tolerante aos shapes `data[]`, `models[]`, `providers[]`, `provider_mapping[]`,
  `inferenceProviders[]` e `providerMapping[]`.
- O payload vira evidências para:
  - `displayName`;
  - aliases normalizados e `huggingFaceId`;
  - `limits.contextWindowTokens` como máximo entre providers;
  - capabilities `chat`, `tools` e `structuredOutputs` quando qualquer provider declara suporte;
  - `providerMetadata.ownedBy=huggingface`;
  - `providerMetadata.huggingface.providers` com provider, routing badges, preço, contexto, latência, throughput,
    tools e structured outputs;
  - `providerMetadata.huggingface.fastestProvider` e `cheapestProvider`;
  - `openai.owned_by=huggingface`.
- O importer também emite `ModelRouteOption` para:
  - `model:fastest`;
  - `model:cheapest`;
  - `model:preferred`;
  - `model:{provider}` para cada provider explícito do catálogo.
- Rotas preservam `routeLayer=openai_compatible_aggregator`, `openAICompatibleBaseUrl`, política de seleção e hints de
  provider; rotas explícitas preservam provider e pricing normalizado em `providerSpecific`.
- Quando autenticado, o importer emite `ProviderAccountOverlay` com modelos visíveis e `routePolicySuffixes`, sem
  serializar token.
- Barrels de importers, catálogo e root exportam `HUGGINGFACE_ROUTER_BASE_URL`,
  `HUGGINGFACE_ROUTER_MODELS_URL`, `HUGGINGFACE_ROUTE_POLICY_SUFFIXES` e
  `createHuggingFaceInferenceProvidersImporter()`.

Separação arquitetural reafirmada:

- O catálogo Hugging Face modela seleção por provider/política, não prova runtime.
- `:fastest` e `:cheapest` são políticas dinâmicas do router; os providers sugeridos são hints observados no catálogo,
  não garantias absolutas de execução futura.
- A camada runtime/probes ainda deve validar disponibilidade real do token, 404 por modelo/região, tool calling e
  structured outputs.

Validação deste corte até agora:

- PASS `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  (`60` testes).
- PASS `npm run typecheck:strict:src.copilot`.
- PASS `npm run lint:copilot`.
- PASS `npm run test:copilot`
  (`5637` testes totais, `5604` passed, `33` pending, `0` failed, `0` warnings/errors únicos;
  summary `artifacts/test-runs/copilot/2026-05-25T19-47-23-006Z/summary.md`).

Próxima direção:

- Continuar para Cloudflare Workers AI/AI Gateway, separando catálogo público Workers AI, gateway universal e possíveis
  overlays de conta/gateway.
