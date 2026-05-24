# Canonical Model Gateway / BYOK Roadmap

Data: 2026-05-24
Escopo: `src/copilot`, GitHub Copilot SDK 0.3.0, BYOK universal, seleção de modelos, probes, sessões e observability.

## 1. Diagnóstico

O relatório `src/copilot/docs/LLM_ROUTER_BYOK_ARCHITECTURE_AUDIT_2026-05-24.md` acerta o ponto central: o BYOK atual
tem partes valiosas, mas elas estão distribuídas em camadas que não devem ser a fonte de verdade de roteamento.

Hoje há quatro focos diferentes:

- `sdk/session/provider.js`: sabe resolver env, presets, `ProviderConfig`, discovery de modelos e `ModelInfo`.
- `sdk/models/*`: possui registry/selector/stats por `modelId`, ainda sem identidade provider-model.
- `terminal/byok/*` e `terminal/state/byok-provider-health.js`: classificam falhas, admitem orçamento e persistem health.
- `terminal/frontend/gateways/sdk-session.js`: roda probes descartáveis chat/agent, incluindo delta, tools e `ask_user`.

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

- [ ] Promover probe chat descartável para `model-gateway/probes`.
- [ ] Promover probe agente descartável com tools + `ask_user`.
- [ ] Adicionar probe streaming/delta.
- [ ] Adicionar probe JSON.
- [ ] Adicionar probe de vision quando houver fixtures seguras.
- [ ] Registrar cada probe em health e observability.
- [ ] Diferenciar `catalog says` de `runtime proved`.

### Faixa F — Health e failure taxonomy

- [ ] Migrar `terminal/state/byok-provider-health.js` para `model-gateway/health`.
- [ ] Migrar `terminal/byok/provider-failure.js` para classifier compartilhado.
- [ ] Separar falhas `auth`, `credits`, `rate-limit`, `model-or-route`, `timeout`, `network`, `upstream`, `unknown`.
- [ ] Persistir health por `providerId|providerModel|routeProfile`.
- [ ] Usar health no roteamento.

### Faixa G — Policy engine

- [ ] Definir task profiles: `cheap_chat`, `code`, `repo_agent`, `tool_agent`, `json_extraction`, `vision`,
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

## 6. Critérios de aceite

- Mesmo modelo em providers diferentes vira records diferentes.
- `ModelInfo.id` enviado ao SDK continua provider-local.
- Registry e snapshots não serializam segredo.
- `onListModels()` vem do gateway ou de fallback legado explicitamente documentado.
- Operador consegue ver providers disponíveis, modelos disponíveis, capabilities, limites e confidence.
- Probes descartáveis validam delta, final, tools e `ask_user`.
- Health e failures influenciam roteamento.
- Toda decisão de rota é explicável e observável.

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
