# Auditoria arquitetural — Router LLM BYOK sobre GitHub Copilot SDK

Data: 2026-05-24  
Escopo: `src/copilot`  
Objetivo: transformar a base atual, construída sobre `@github/copilot-sdk` 0.3.x e BYOK, em um runtime próprio multi-provider, onde OpenRouter é apenas um provider entre muitos.

---

## Índice

1. [Resumo executivo](#1-resumo-executivo)
2. [Fontes analisadas](#2-fontes-analisadas)
3. [Premissas oficiais relevantes](#3-premissas-oficiais-relevantes)
4. [Situação atual do código](#4-situação-atual-do-código)
5. [Diagnóstico arquitetural](#5-diagnóstico-arquitetural)
6. [Riscos e dívidas principais](#6-riscos-e-dívidas-principais)
7. [Situação ideal proposta](#7-situação-ideal-proposta)
8. [Arquitetura alvo](#8-arquitetura-alvo)
9. [Contratos de dados recomendados](#9-contratos-de-dados-recomendados)
10. [Estratégia específica para OpenRouter](#10-estratégia-específica-para-openrouter)
11. [Estratégia para compatibilidade com o código atual](#11-estratégia-para-compatibilidade-com-o-código-atual)
12. [Roadmap por fases e subfases](#12-roadmap-por-fases-e-subfases)
13. [Critérios de aceite](#13-critérios-de-aceite)
14. [Plano de validação](#14-plano-de-validação)
15. [Glossário operacional](#15-glossário-operacional)
16. [Referências oficiais](#16-referências-oficiais)

---

## 1. Resumo executivo

A base atual já contém vários elementos valiosos para um router universal BYOK:

- wrapper canônico do `@github/copilot-sdk` em `src/copilot/sdk`;
- fronteira declarada entre SDK, agent, terminal, presentation, observability e config;
- suporte BYOK com perfis por env, presets de providers e descoberta remota de modelos;
- integração com `onListModels()` para projetar modelos customizados ao Copilot SDK;
- probes BYOK de chat e agente no terminal;
- saúde operacional de provider/modelo persistida em `byok-provider-health.json`;
- admissão por orçamento de tokens para evitar chamadas BYOK inviáveis;
- taxonomia de falhas externas BYOK.

A principal conclusão é que o projeto **não precisa começar do zero**. Ele já possui cerca de 60% das peças conceituais. O problema é que elas estão no lugar errado para o objetivo novo.

Hoje, BYOK está distribuído assim:

```txt
src/copilot/sdk/session/provider.js       -> presets, env, descoberta, ProviderConfig, resumo BYOK
src/copilot/sdk/models/*                  -> registry/selector/stats, mas ainda raso e model-centric
src/copilot/terminal/byok/*               -> admissão e classificação de falhas
src/copilot/terminal/state/byok-*.js      -> saúde operacional terminal-owned
src/copilot/terminal/frontend/gateways/*  -> probes chat/agent
src/copilot/config/byok.js                -> porta que reexporta a configuração SDK
```

Para um router próprio com dezenas ou centenas de modelos, isso precisa virar:

```txt
src/copilot/model-gateway/registry        -> fonte de verdade de modelos/providers/capabilities
src/copilot/model-gateway/providers       -> adapters por provider/protocolo
src/copilot/model-gateway/secrets         -> secret refs, env/vault, sem segredo no registry
src/copilot/model-gateway/probes          -> probes reutilizáveis de capacidade real
src/copilot/model-gateway/routing         -> seleção por tarefa, custo, latência e fallback
src/copilot/model-gateway/session         -> bridge limpa para Copilot SDK
src/copilot/model-gateway/telemetry       -> health, custo, latência, falhas e uso
```

A tese central é:

> `@github/copilot-sdk` deve continuar sendo o runtime agentic e a fronteira vanilla.  
> O novo domínio `model-gateway` deve ser o cérebro de catálogo, BYOK, roteamento, probes e governança.  
> OpenRouter deve ser somente um `ProviderAdapter`, não a fundação da arquitetura.

---

## 2. Fontes analisadas

### 2.1 Código local

Arquivos e módulos prioritários lidos durante a investigação:

| Área | Arquivos principais | Leitura arquitetural |
|---|---|---|
| Mapa canônico | `src/copilot/README.md` | Define `sdk/` como wrapper canônico do SDK vanilla e `agent/` como runtime contínuo. |
| SDK wrapper | `src/copilot/sdk/README.md` | Define surfaces estáveis como `#copilot/sdk/session`, `#copilot/sdk/models`, `#copilot/sdk/tools`, etc. |
| BYOK atual | `src/copilot/sdk/session/provider.js` | Concentra presets, env vars, descoberta de modelos, ProviderConfig, redaction e resolução de sessão. |
| Client options | `src/copilot/sdk/session/client-options.js` | Injeta `onListModels` quando BYOK está configurado. |
| Lifecycle SDK | `src/copilot/sdk/session/lifecycle.js` | Cria/retoma sessão e passa `provider` para o SDK. |
| Registry atual | `src/copilot/sdk/models/registry.js` | Catálogo estático simples: id, custo, velocidade, contexto, reasoning e vision. |
| Model seeds | `src/copilot/sdk/models/known-models.js` | Lista modelos conhecidos, mas sem provider, endpoint, supported parameters ou proveniência. |
| Selector atual | `src/copilot/sdk/models/selector.js` | Score por custo/velocidade/contexto/stats. Útil, mas ainda insuficiente para roteamento universal. |
| Stats atual | `src/copilot/sdk/models/stats-tracker.js` | Latência, sucesso e tokens por modelo; sem provider dimensionado. |
| Config BYOK | `src/copilot/config/byok.js`, `src/copilot/config/sdk-config-port.js` | Reexports seguros para consumidores fora do SDK, mas ainda acoplam BYOK ao SDK. |
| Saúde BYOK | `src/copilot/terminal/state/byok-provider-health.js` | Health operacional provider/modelo com persistência e redaction. |
| Probes BYOK | `src/copilot/terminal/frontend/gateways/sdk-session.js` | Probes descartáveis de chat e agent, incluindo tools e ask_user. |
| Admissão BYOK | `src/copilot/terminal/byok/admission.js` | Budget guard para contexto/token antes de probe ou turno vivo. |
| Falhas BYOK | `src/copilot/terminal/byok/provider-failure.js` | Taxonomia de erros externos: auth, créditos, rate limit, upstream etc. |

### 2.2 Documentação oficial consultada

- GitHub Copilot SDK — BYOK.
- GitHub Copilot CLI — modelos BYOK e requisitos.
- OpenRouter API Reference.
- Model Context Protocol — tools specification.

As referências estão no final do documento.

---

## 3. Premissas oficiais relevantes

### 3.1 GitHub Copilot SDK BYOK é preview

A documentação oficial informa que o Copilot SDK está em public preview e que funcionalidade/disponibilidade podem mudar. Isso implica que nossa arquitetura deve conter uma camada de isolamento explícita entre domínio próprio e SDK.

Decisão arquitetural derivada:

```txt
Não colocar registry, policy engine, probes e catálogo definitivo dentro de src/copilot/sdk.
```

O SDK deve ser tratado como runtime substituível/isolável, não como source of truth do roteamento.

### 3.2 ProviderConfig oficial é estreito

O `ProviderConfig` oficial aceita essencialmente:

```ts
type ProviderConfig = {
  type?: 'openai' | 'azure' | 'anthropic';
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  wireApi?: 'completions' | 'responses';
  azure?: { apiVersion?: string };
  headers?: Record<string, string>;
};
```

Isso é suficiente como ponte para o SDK, mas insuficiente como schema de router universal.

O registry próprio precisa conhecer:

- provider real;
- modelo nativo;
- protocolo;
- preço;
- limites;
- input/output modalities;
- `supportedParameters`;
- probes;
- health;
- proveniência;
- credenciais por referência;
- políticas de roteamento.

### 3.3 `openai` no SDK significa protocolo OpenAI-compatible

A documentação oficial do GitHub diz que provider type `openai` funciona com OpenAI e endpoints compatíveis, incluindo Ollama, vLLM, Foundry Local, LiteLLM e similares.

Isso favorece um adapter genérico:

```txt
OpenAICompatibleAdapter
  -> openai
  -> openrouter
  -> groq
  -> gemini openai-compatible
  -> mistral
  -> huggingface router
  -> ollama
  -> vllm
  -> litellm
  -> cerebras
  -> cloudflare workers ai
```

Mas isso não elimina adapters específicos. Ele só define a ponte final para o SDK.

### 3.4 `wireApi` é uma escolha de protocolo, não de capacidade

`wireApi: 'completions'` usa Chat Completions; `wireApi: 'responses'` usa Responses API para modelos compatíveis.

No registry próprio, isso deve estar em `transport` ou `copilotBinding`, não em `capabilities`.

### 3.5 BYOK exige modelo explícito

O código local já respeita essa restrição: `COPILOT_BYOK_MODEL` não pode ser `auto` quando BYOK está habilitado.

Isso é correto. Em um router próprio, `auto` deve existir apenas no domínio do roteador:

```txt
App pede: auto / repo_agent / cheapest_tools
Gateway escolhe: provider:model concreto
Copilot SDK recebe: model concreto + provider config
```

### 3.6 CLI agentic exige tool calling e streaming

A documentação do Copilot CLI exige que modelos BYOK suportem tool/function calling e streaming; recomenda janela de contexto de pelo menos 128k tokens para melhores resultados.

Isso justifica probes obrigatórios para qualquer modelo usado em perfis agentic.

### 3.7 OpenRouter normaliza, mas não deve ser o router interno

OpenRouter declara que sua API normaliza schemas entre modelos/providers em formato similar à OpenAI Chat API. Ele também oferece streaming, roteamento próprio e structured outputs. Entretanto, a própria documentação informa que parâmetros não suportados pelo modelo escolhido podem ser ignorados.

Conclusão:

```txt
OpenRouter é ótimo como provider agregado e fonte de catálogo.
OpenRouter não deve ser a fonte de verdade de capacidades reais do nosso sistema.
```

### 3.8 MCP é para tools/contexto, não inferência LLM

MCP padroniza descoberta e chamada de tools, incluindo `tools/list`, `tools/call` e `inputSchema`. Ele não é um schema universal de chamada de modelos.

Uso recomendado:

```txt
MCP -> tools/resources/prompts externos
Model Gateway -> modelos/providers/roteamento/capabilities
```

---

## 4. Situação atual do código

## 4.1 Arquitetura geral de `src/copilot`

O README raiz de `src/copilot` já estabelece uma arquitetura madura:

```txt
terminal:llm-b
  -> terminal/bootstrap.js
    -> boot/runtime-bootstrap.js
      -> runCopilotBootPlan()
        -> runtime-wiring.js
        -> terminal phase handlers
          -> server/index.js
          -> repl.js
```

E para eventos de sessão:

```txt
SDK/agent events
  -> event-handlers/
    -> agent/
      -> presentation/
        -> terminal/frontend/
          -> terminal/dialog/
            -> terminal/repl/repl.js
```

A regra do projeto é correta:

> quando existir conceito análogo no `@github/copilot-sdk`, o código local deve partir do SDK vanilla e só depois ampliar ergonomia, UX ou governança.

Essa regra deve continuar valendo.

O novo router universal não deve violá-la. Ele deve nascer como domínio próprio acima do SDK, não como mutação da camada SDK.

---

## 4.2 `src/copilot/sdk` está bem definido

`src/copilot/sdk/README.md` define o SDK como fronteira canônica para o `@github/copilot-sdk`, com surfaces explícitas:

```txt
#copilot/sdk/session
#copilot/sdk/session-runtime
#copilot/sdk/rpc
#copilot/sdk/telemetry
#copilot/sdk/tools
#copilot/sdk/agents
#copilot/sdk/models
#copilot/sdk/constants
#copilot/sdk/types
```

Há boa governança anti-drift:

- aliases folha legados foram removidos;
- importações diretas do root foram reduzidas;
- typecheck estrito do SDK existe;
- `module-map.js` funciona como contrato verificável;
- `sdk/config.js` foi removido, empurrando configuração para `#copilot/config`.

Essa camada está saudável como wrapper do SDK.

O problema é que BYOK e providers cresceram dentro dela além do ideal.

---

## 4.3 BYOK atual é poderoso, mas monolítico

`src/copilot/sdk/session/provider.js` hoje contém muitas responsabilidades:

1. tipos de `ProviderConfig`;
2. validação de provider;
3. redaction de segredo;
4. leitura de env vars BYOK;
5. perfis BYOK em JSON;
6. presets de muitos providers;
7. inferência de provider/baseUrl/model/auth;
8. descoberta remota de modelos;
9. cache de descoberta;
10. normalização de ModelInfo;
11. resumo BYOK para UI;
12. resolução de overrides para create/resume session.

Isso é funcional, mas concentra demais.

O arquivo hoje conhece providers como:

```txt
openai
openai-compatible
ollama-local
ollama-cloud
kilo-code
kilo-gateway
openrouter
groq
gemini
mistral
huggingface
cloudflare-workers-ai
nvidia-nim
cerebras
chutes
zai
```

Isso prova que o sistema já saiu do estágio “um provider BYOK”. Ele já é, na prática, um mini gateway. A questão é formalizar essa realidade em uma arquitetura própria.

---

## 4.4 `onListModels()` já está sendo usado corretamente

`src/copilot/sdk/session/client-options.js` chama `buildConfiguredByokModelListHandler(process.env)` e injeta o resultado em `ClientOptionsBuilder.onListModels()`.

Isso está alinhado à documentação oficial do SDK: quando a CLI não sabe quais modelos o provider suporta, o cliente pode fornecer uma lista customizada em formato `ModelInfo`.

Limitação atual:

```txt
onListModels atual = lista derivada de um perfil/env BYOK ativo
onListModels ideal = projeção do registry unificado com N providers e N perfis
```

---

## 4.5 Registry atual existe, mas é insuficiente para um router universal

`src/copilot/sdk/models/registry.js` define:

```txt
ModelRegistry
ModelSelector
ModelStatsTracker
AutoDowngradeDetector
```

O `ModelMeta` atual possui essencialmente:

```ts
type ModelMeta = {
  id: string;
  costTier: 'free' | 'low' | 'medium' | 'high' | 'premium';
  speedTier: 'slow' | 'medium' | 'fast';
  contextWindow: number;
  supportsReasoning: boolean;
  supportsVision: boolean;
  aliases?: string[];
};
```

Isso é uma boa semente, mas não resolve o objetivo descrito.

Faltam campos fundamentais:

- provider real;
- modelo nativo no provider;
- tipo de transport/protocolo;
- `baseUrl` ou endpoint profile;
- `wireApi`;
- input modalities;
- output modalities;
- `supports.tools`;
- `supports.streaming`;
- `supports.structuredOutputs`;
- `supports.jsonMode`;
- `supports.parallelToolCalls`;
- `supports.toolChoiceRequired`;
- `supportedParameters`;
- preço por token;
- limites por request/minuto/dia;
- max output tokens;
- fonte de dados;
- data de verificação;
- resultado de probes;
- health runtime;
- fallback chain.

---

## 4.6 `known-models.js` deve virar seed, não fonte de verdade

`known-models.js` contém IDs de modelos e aliases. Isso serve como fallback, mas não pode ser o catálogo autoritativo.

Problema: modelos mudam rapidamente, provedores alteram nomes, limites e capabilities, e alguns IDs no arquivo parecem antecipatórios ou específicos do projeto. Para uma base própria, todo model record precisa de proveniência:

```txt
manual
provider_catalog
openrouter_catalog
probe_verified
runtime_observed
```

Sem proveniência, o roteador não consegue decidir se um campo é confiável ou apenas uma suposição local.

---

## 4.7 Terminal já tem boas peças de operação BYOK

### Saúde operacional

`src/copilot/terminal/state/byok-provider-health.js` persiste saúde por combinação:

```txt
profile | provider | model
```

Ele registra:

- sucesso/falha de chamadas;
- sucesso/falha de agent probe;
- timestamps;
- contadores;
- mensagens sanitizadas;
- error contexts;
- redaction de segredos.

Essa peça é valiosa e deve ser promovida para domínio compartilhado.

### Probes

`src/copilot/terminal/frontend/gateways/sdk-session.js` já implementa:

- `probeTerminalConfiguredByokChat()`;
- `probeTerminalConfiguredByokAgent()`.

A probe agent exige capacidades operacionais reais, incluindo tool calls e `ask_user`. Isso é excelente, porque não testa apenas HTTP 200.

### Admissão por budget

`src/copilot/terminal/byok/admission.js` evita probes/turnos inviáveis quando o provider tem limite baixo.

### Taxonomia de falhas

`src/copilot/terminal/byok/provider-failure.js` classifica falhas externas em:

```txt
credits
rate-limit
auth
model-or-route
timeout
network
upstream
unknown
```

Isso deve virar taxonomia comum do gateway, não apenas UX terminal.

---

## 5. Diagnóstico arquitetural

## 5.1 Pontos fortes

### A. A arquitetura por camadas já existe

O projeto não é uma massa amorfa. Ele tem:

```txt
sdk/
agent/
terminal/
presentation/
server/
observability/
config/
infra/
tools/
event-handlers/
```

Isso reduz o custo de introduzir `model-gateway/` como novo domínio.

### B. O SDK wrapper já é governado

O `sdk/README.md` mostra que o projeto já passou por uma limpeza de aliases e surfaces. Isso é importante: o novo router não deve desfazer esse avanço.

### C. BYOK já suporta múltiplos providers

Apesar de monolítico, `provider.js` já conhece diversos providers e endpoints OpenAI-compatible.

### D. Existe noção de health/probe

Muitos routers falham porque tratam catálogo como verdade. Este projeto já entendeu que runtime health e probes são necessários.

### E. O terminal já possui affordances operacionais

Comandos como `/byok`, health, probe, diagnóstico e session status já têm base para evoluir para um cockpit multi-provider.

---

## 5.2 Pontos de desalinhamento

### A. `sdk/session/provider.js` virou gateway sem nome

Ele deveria ser um adapter fino para o `ProviderConfig` do SDK. Hoje ele é também:

- catálogo;
- source de env;
- source de presets;
- discoverer;
- normalizador;
- summary builder;
- resolver de sessão.

Esse crescimento conflita com a missão declarada da camada SDK.

### B. Registry atual é model-centric, não provider-model-centric

O ID `gpt-4.1` não é suficiente. Em router real, estas são entidades diferentes:

```txt
openai:gpt-4.1
openrouter:openai/gpt-4.1
azure:my-gpt-4.1-deployment
gateway-x:gpt-4.1
```

Todas podem ter custo, latência, headers, auth, limites e semântica distintos.

### C. Capabilities estão subdimensionadas

Hoje a maioria da camada BYOK se resume a:

```txt
reasoningEffort
vision
contextWindow
rate limits básicos
```

Para Copilot agentic, o mínimo deveria incluir:

```txt
streaming
tools
forced_tool_choice
parallel_tool_calls
json_mode
json_schema
structured_outputs
vision
audio
files
reasoning_effort
reasoning_budget_tokens
max_output_tokens
```

### D. Health está em `terminal/`

O terminal é uma borda. Health de provider/modelo deve ser domínio compartilhado, usado por:

```txt
terminal
server
agent
presentation
routing
probes
observability
```

### E. Falhas externas estão em `terminal/byok`

A taxonomia é boa, mas deveria estar em algo como:

```txt
src/copilot/model-gateway/errors/provider-failure.js
```

O terminal deveria apenas renderizar.

### F. OpenRouter está hard-coded como preset

Para o objetivo declarado, OpenRouter precisa ser um adapter normal. Ele pode ter importer próprio, headers próprios e capabilities próprias, mas não deve ocupar lugar especial.

---

## 6. Riscos e dívidas principais

## 6.1 Risco de acoplamento ao preview do SDK

Como o SDK está em public preview, mudanças em `ProviderConfig`, `onListModels`, eventos ou session semantics podem quebrar o domínio BYOK se ele continuar dentro de `sdk/session/provider.js`.

Mitigação:

```txt
Criar ModelGateway acima do SDK.
Manter apenas bridge fina para Copilot SDK.
```

## 6.2 Risco de catálogo incorreto

Catálogo estático envelhece rápido. `known-models.js` não deve decidir sozinho qual modelo suporta tools, JSON schema ou reasoning.

Mitigação:

```txt
ModelRecord com provenance + confidence + lastVerifiedAt + probe results.
```

## 6.3 Risco de parâmetro ignorado silenciosamente

OpenRouter documenta que parâmetros não suportados podem ser ignorados. Outros providers também podem aceitar campos e degradar sem erro.

Mitigação:

```txt
Probes comportamentais, não só requests 200.
```

## 6.4 Risco de `onListModels()` estreito

Hoje a lista de modelos BYOK vem do perfil ativo. Para dezenas de providers, isso não escala.

Mitigação:

```txt
onListModels = projection(registry.listRoutableModels())
```

## 6.5 Risco de segredo em configuração operacional

O código já redige segredos, mas o modelo futuro precisa separar rigorosamente:

```txt
ModelRegistry -> sem segredos
SecretRegistry -> resolve secretRef em runtime
SessionFactory -> injeta segredo ao criar sessão
```

## 6.6 Risco de duplicação de policy

Hoje já há policy em vários pontos:

- model selector;
- BYOK admission;
- fallback/downgrade;
- provider failure;
- session setup;
- terminal commands.

Mitigação:

```txt
PolicyEngine central com projections para terminal/server/agent.
```

---

## 7. Situação ideal proposta

## 7.1 Princípio de fronteira

A fronteira deve ser:

```txt
App / Terminal / Server / Agent
  -> ModelGateway
    -> Registry + Policy + Adapter + Probe + Health
      -> CopilotSessionFactory
        -> @github/copilot-sdk
```

Não:

```txt
App / Terminal / Agent
  -> sdk/session/provider.js gigante
    -> @github/copilot-sdk
```

---

## 7.2 Regras arquiteturais novas

1. `src/copilot/sdk` continua sendo a SSOT do contrato vanilla do SDK.
2. `src/copilot/model-gateway` passa a ser a SSOT de providers, modelos, BYOK, routing e probes.
3. `OpenRouterAdapter` não pode ser dependência de outros adapters.
4. `ProviderAdapter` não pode ler `process.env` diretamente.
5. `SecretRegistry` é o único mecanismo para resolver segredo.
6. `ModelRegistry` não armazena API key, bearer token ou header sensível.
7. `onListModels()` é uma projeção do registry, não uma descoberta ad hoc por env ativo.
8. Probes atualizam capabilities com confidence; catálogo nunca sobrescreve probe mais recente sem downgrade explícito.
9. Terminal renderiza estado; não é dono de health, probes ou falhas.
10. Todo model record deve ter `source`, `confidence` e `updatedAt`.

---

## 8. Arquitetura alvo

## 8.1 Estrutura sugerida

```txt
src/copilot/model-gateway/
  README.md
  index.js

  contracts/
    model-record.js
    provider-record.js
    capability-profile.js
    routing-profile.js
    probe-result.js
    secret-ref.js

  registry/
    ModelRegistry.js
    RegistryStore.js
    RegistryProjection.js
    JsonRegistryStore.js
    SqliteRegistryStore.js
    provenance.js

  providers/
    ProviderAdapter.js
    OpenAICompatibleAdapter.js
    OpenAIAdapter.js
    AzureOpenAIAdapter.js
    AnthropicAdapter.js
    OpenRouterAdapter.js
    OllamaAdapter.js
    VllmAdapter.js
    LiteLLMAdapter.js
    GeminiOpenAIAdapter.js
    index.js

  importers/
    OpenRouterCatalogImporter.js
    StaticManifestImporter.js
    EnvByokCompatImporter.js
    ProviderModelsImporter.js

  secrets/
    SecretRegistry.js
    EnvSecretRegistry.js
    VaultSecretRegistry.js
    redaction.js

  probes/
    ProbeEngine.js
    probe-basic-text.js
    probe-streaming.js
    probe-tools.js
    probe-forced-tool-choice.js
    probe-json-mode.js
    probe-json-schema.js
    probe-vision.js
    probe-agent-runtime.js

  routing/
    PolicyEngine.js
    TaskProfile.js
    scoring.js
    fallback.js
    admission.js

  session/
    CopilotSessionFactory.js
    CopilotModelProjection.js
    ProviderConfigBridge.js

  health/
    ProviderHealthStore.js
    ProviderFailureClassifier.js
    HealthProjection.js

  telemetry/
    UsageLedger.js
    CostEstimator.js
    LatencyTracker.js
```

---

## 8.2 Fluxo ideal de chamada

```txt
1. Operador/app pede uma tarefa:
   profile = repo_agent
   requirements = tools + streaming + context >= 128k

2. PolicyEngine consulta ModelRegistry:
   candidates = registry.find(requirements)

3. HealthStore remove candidatos degradados:
   candidates = health.filterHealthy(candidates)

4. PolicyEngine rankeia:
   custo, latência, qualidade, provider allow/block, probes, fallback

5. CopilotSessionFactory cria a sessão:
   ModelRecord -> ProviderAdapter -> ProviderConfig do SDK

6. Copilot SDK executa:
   createSession/send/events/tools

7. Telemetry grava:
   tokens, custo, latência, erro, provider failure, probe drift
```

---

## 8.3 Papel de cada camada

| Camada | Papel | Não deve fazer |
|---|---|---|
| `sdk/` | Bridge vanilla para Copilot SDK | Decidir provider ideal, ler todos os envs, guardar catálogo universal |
| `model-gateway/registry` | Fonte de verdade de modelos/providers/capabilities | Resolver segredo |
| `model-gateway/providers` | Converter provider/model para transport SDK | Renderizar UX terminal |
| `model-gateway/secrets` | Resolver `secretRef` em runtime | Salvar segredo em ModelRecord |
| `model-gateway/probes` | Verificar capacidades reais | Depender de comandos terminal |
| `model-gateway/routing` | Selecionar modelo/fallback | Criar sessão diretamente |
| `model-gateway/session` | Ponte final para Copilot SDK | Manter catálogo |
| `terminal/` | UX e comandos | Ser fonte de health/capability |
| `observability/` | Métricas, tracing, auditoria | Decidir roteamento |

---

## 9. Contratos de dados recomendados

## 9.1 `ProviderRecord`

```ts
export type ProviderKind =
  | 'openai'
  | 'azure-openai'
  | 'anthropic'
  | 'openrouter'
  | 'ollama'
  | 'vllm'
  | 'litellm'
  | 'groq'
  | 'gemini-openai-compatible'
  | 'mistral'
  | 'huggingface-router'
  | 'cloudflare-workers-ai'
  | 'nvidia-nim'
  | 'cerebras'
  | 'custom-openai-compatible';

export type ProviderRecord = {
  id: string;
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;

  transport: {
    sdkType: 'openai' | 'azure' | 'anthropic';
    baseUrl: string;
    wireApi?: 'completions' | 'responses';
    azureApiVersion?: string;
    defaultHeaders?: Record<string, string>;
  };

  auth: {
    mode: 'apiKey' | 'bearerToken' | 'headers' | 'none';
    secretRef?: string;
    headerSecretRefs?: Record<string, string>;
  };

  discovery?: {
    modelsEndpoint?: string;
    supportsRemoteList: boolean;
    ttlMs: number;
  };

  provenance: {
    source: 'manual' | 'env_compat' | 'provider_catalog' | 'openrouter_catalog';
    updatedAt: string;
  };
};
```

## 9.2 `ModelRecord`

```ts
export type ModelRecord = {
  id: string;              // provider-local unique id: openrouter:anthropic/claude-sonnet-4
  providerId: string;      // openrouter
  providerModel: string;   // anthropic/claude-sonnet-4
  displayName: string;
  enabled: boolean;

  modalities: {
    input: Array<'text' | 'image' | 'audio' | 'video' | 'file'>;
    output: Array<'text' | 'image' | 'audio' | 'embedding'>;
  };

  capabilities: {
    text: boolean;
    streaming: boolean;
    tools: boolean;
    forcedToolChoice: boolean;
    parallelToolCalls: boolean;
    structuredOutputs: boolean;
    jsonMode: boolean;
    jsonSchema: boolean;
    vision: boolean;
    reasoningEffort: boolean;
    reasoningBudgetTokens: boolean;
    logprobs: boolean;
    seed: boolean;
  };

  supportedParameters: string[];

  limits: {
    contextWindowTokens?: number;
    maxOutputTokens?: number;
    maxRequestTokens?: number;
    requestsPerMinute?: number;
    tokensPerMinute?: number;
    dailyRequests?: number;
  };

  pricing?: {
    inputUsdPerMillion?: number;
    outputUsdPerMillion?: number;
    requestUsd?: number;
  };

  routing: {
    tier: 'free' | 'cheap' | 'balanced' | 'frontier' | 'local';
    useCases: Array<'chat' | 'code' | 'repo_agent' | 'tool_agent' | 'json_extraction' | 'vision' | 'deep_reasoning'>;
    fallbacks: string[];
  };

  verification: {
    confidence: 'unknown' | 'catalog' | 'manual' | 'probe_verified' | 'probe_failed';
    sources: Array<'manual' | 'provider_catalog' | 'openrouter_catalog' | 'probe' | 'runtime'>;
    lastCatalogSyncAt?: string;
    lastProbedAt?: string;
  };
};
```

## 9.3 `ProbeResult`

```ts
export type ProbeKind =
  | 'basic_text'
  | 'streaming'
  | 'tools'
  | 'forced_tool_choice'
  | 'parallel_tools'
  | 'json_mode'
  | 'json_schema'
  | 'vision'
  | 'agent_runtime';

export type ProbeResult = {
  modelId: string;
  providerId: string;
  kind: ProbeKind;
  ok: boolean;
  status: 'ok' | 'failed' | 'timeout' | 'admission_blocked' | 'unsupported' | 'ignored' | 'unknown';
  latencyMs?: number;
  error?: {
    kind: 'auth' | 'credits' | 'rate_limit' | 'model_or_route' | 'network' | 'upstream' | 'timeout' | 'unknown';
    message: string;
    statusCode?: number;
  };
  checkedAt: string;
};
```

## 9.4 `TaskProfile`

```ts
export type TaskProfile =
  | 'cheap_chat'
  | 'code'
  | 'repo_agent'
  | 'tool_agent'
  | 'json_extraction'
  | 'vision'
  | 'deep_reasoning'
  | 'local_private';
```

Perfis recomendados:

| Perfil | Requisitos mínimos |
|---|---|
| `repo_agent` | `streaming`, `tools`, contexto >= 128k, agent probe ok |
| `tool_agent` | `tools`, `forcedToolChoice` preferencial, streaming |
| `json_extraction` | `jsonSchema` ou `jsonMode`; fallback com validator/healing |
| `vision` | input `image`, contexto suficiente |
| `deep_reasoning` | `reasoningEffort` ou modelo frontier marcado manualmente/probeado |
| `local_private` | provider local, sem egress externo, auth opcional |
| `cheap_chat` | custo baixo, streaming opcional, sem tools obrigatórias |

---

## 10. Estratégia específica para OpenRouter

## 10.1 OpenRouter como adapter comum

OpenRouter deve virar:

```txt
src/copilot/model-gateway/providers/OpenRouterAdapter.js
```

Responsabilidades:

- declarar `providerId = 'openrouter'`;
- converter `ModelRecord` para `ProviderConfig` SDK;
- aplicar `baseUrl = https://openrouter.ai/api/v1`;
- aplicar `sdkType = 'openai'`;
- aplicar headers recomendados (`HTTP-Referer`, `X-Title`/`X-OpenRouter-Title`) quando configurados;
- usar `secretRef`, não ler `process.env` diretamente;
- opcionalmente expor importer de catálogo.

## 10.2 OpenRouter como fonte de catálogo, não fonte de verdade

OpenRouter pode alimentar:

```txt
supportedParameters
pricing
modalities
context length
provider routing info
```

Mas `probe_verified` deve ter prioridade sobre `openrouter_catalog`.

Exemplo de precedence:

```txt
probe_verified > manual_override > provider_catalog > openrouter_catalog > static_seed > unknown
```

## 10.3 OpenRouter não deve decidir fallback interno

OpenRouter tem fallback próprio de GPUs/providers. Isso é útil quando a chamada já foi roteada para OpenRouter.

Mas o nosso router deve decidir primeiro:

```txt
usar OpenRouter?
usar provider direto?
usar local?
usar fallback interno?
```

---

## 11. Estratégia para compatibilidade com o código atual

Não recomendo remover o BYOK atual em um grande patch. O risco é alto. A migração deve ser incremental.

## 11.1 Compat layer

Criar importer compatível:

```txt
EnvByokCompatImporter
```

Ele lê o estado atual de:

```txt
readConfiguredByokState()
readConfiguredByokModelsFromEnv()
discoverConfiguredByokModelsFromEnv()
```

E produz:

```txt
ProviderRecord[]
ModelRecord[]
```

Assim, o novo registry começa consumindo o legado sem quebrar o terminal.

## 11.2 Reexport gradual

Inicialmente:

```txt
config/byok.js
  -> mantém exports atuais
  -> adiciona exports novos do model-gateway
```

Depois:

```txt
terminal/byok/*
  -> passa a usar model-gateway/health e model-gateway/probes
```

Por fim:

```txt
sdk/session/provider.js
  -> fica só com ProviderConfig validation/builders e compat shims
```

## 11.3 Manter comandos existentes

Comandos `/byok` devem continuar funcionando, mas mudar sua fonte:

```txt
antes: readConfiguredByokSummary()
depois: ModelGatewayProjection.readByokSummary()
```

---

## 12. Roadmap por fases e subfases

## Faixa 0 — Baseline, inventário e guardrails

Objetivo: congelar o entendimento atual e evitar regressão enquanto a extração começa.

### 0.1 Inventário de surfaces atuais

- Listar todos os consumidores de `resolveConfiguredByokSessionOverrides`.
- Listar todos os consumidores de `readConfiguredByokSummary`.
- Listar todos os consumidores de `probeTerminalConfiguredByokChat` e `probeTerminalConfiguredByokAgent`.
- Listar todos os imports de `#copilot/sdk/session` fora das camadas permitidas.

Entregáveis:

- `docs/BYOK_CURRENT_SURFACES.md` ou seção equivalente.
- Script ou teste de snapshot para impedir novo acoplamento direto.

### 0.2 Baseline de validação

Executar e registrar:

```bash
npm run typecheck:strict:src.copilot
npm run lint:copilot
npm run test:copilot:unit
```

Critério de saída:

- baseline conhecido;
- nenhum refactor iniciado sem estado de validação salvo.

### 0.3 Definir boundary oficial

Adicionar README inicial:

```txt
src/copilot/model-gateway/README.md
```

Conteúdo mínimo:

- missão;
- o que pertence ao domínio;
- o que não pertence;
- relação com `sdk/`, `terminal/`, `agent/`, `config/`.

---

## Faixa 1 — Contratos centrais

Objetivo: criar os tipos/capabilities antes de mover runtime.

### 1.1 Criar contratos

Arquivos:

```txt
src/copilot/model-gateway/contracts/model-record.js
src/copilot/model-gateway/contracts/provider-record.js
src/copilot/model-gateway/contracts/capability-profile.js
src/copilot/model-gateway/contracts/probe-result.js
src/copilot/model-gateway/contracts/secret-ref.js
```

### 1.2 Criar schema versionado

Cada record deve ter:

```txt
schemaVersion
id
enabled
createdAt
updatedAt
provenance
```

### 1.3 Mapear `ModelInfo` do SDK

Criar:

```txt
src/copilot/model-gateway/session/CopilotModelProjection.js
```

Função:

```ts
function toCopilotModelInfo(model: ModelRecord): ModelInfo
```

Critério de saída:

- `ModelRecord -> ModelInfo` testado;
- capabilities fora de `ModelInfo` preservadas no registry.

---

## Faixa 2 — Registry unificado

Objetivo: criar fonte de verdade independente do SDK.

### 2.1 `ModelRegistry`

Criar:

```txt
src/copilot/model-gateway/registry/ModelRegistry.js
```

Operações mínimas:

```ts
getProvider(id)
getModel(id)
listProviders()
listModels()
listEnabledModels()
findCandidates(requirements)
upsertProvider(record)
upsertModel(record)
```

### 2.2 Store inicial JSON

Começar simples:

```txt
data/copilot/model-gateway/registry.json
```

Depois evoluir para SQLite se necessário.

### 2.3 Importar legado

Criar:

```txt
EnvByokCompatImporter
KnownModelsSeedImporter
```

`KnownModelsSeedImporter` deve marcar tudo como:

```txt
source = static_seed
confidence = unknown/catalog baixo
```

Critério de saída:

- registry consegue listar modelos do BYOK atual;
- terminal ainda funciona com o fluxo legado.

---

## Faixa 3 — Provider adapters

Objetivo: transformar presets em adapters.

### 3.1 Interface base

```ts
export interface ProviderAdapter {
  kind: ProviderKind;
  toCopilotProvider(input: {
    provider: ProviderRecord;
    model: ModelRecord;
    secrets: SecretRegistry;
  }): CopilotProviderBinding;
  listModels?(provider: ProviderRecord): Promise<ModelRecord[]>;
  normalizeError?(error: unknown): ProviderFailure;
}
```

### 3.2 Adapters prioritários

Ordem recomendada:

1. `OpenAICompatibleAdapter`;
2. `OpenRouterAdapter`;
3. `AnthropicAdapter`;
4. `AzureOpenAIAdapter`;
5. `OllamaAdapter`;
6. `LiteLLMAdapter`;
7. `VllmAdapter`.

### 3.3 Migrar presets

Mover gradualmente os presets de `sdk/session/provider.js` para records/adapters.

Compatibilidade:

- manter aliases env antigos;
- emitir warning quando usando caminho legado;
- documentar novo formato.

Critério de saída:

- adicionar provider novo não exige editar `sdk/session/provider.js`.

---

## Faixa 4 — SecretRegistry

Objetivo: remover segredo da configuração operacional.

### 4.1 Interface

```ts
export interface SecretRegistry {
  get(ref: string): string | undefined;
  has(ref: string): boolean;
  describe(ref: string): { configured: boolean; source: 'env' | 'vault' | 'memory' };
}
```

### 4.2 Env implementation

```txt
EnvSecretRegistry
```

Resolve:

```txt
OPENROUTER_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
...
```

### 4.3 Redaction única

Mover redaction comum para:

```txt
model-gateway/secrets/redaction.js
```

Critério de saída:

- registry serializado não contém segredo;
- health/error logs continuam redigidos.

---

## Faixa 5 — CopilotSessionFactory

Objetivo: criar a única ponte autorizada para `createSession` com provider/model selecionados.

### 5.1 Factory

```txt
src/copilot/model-gateway/session/CopilotSessionFactory.js
```

Responsabilidades:

- receber `modelId` ou `RouteDecision`;
- buscar `ModelRecord` e `ProviderRecord`;
- resolver segredo;
- chamar adapter;
- produzir `SessionCreateOptions` compatíveis com `#copilot/sdk/session`;
- preservar `modelCapabilities` exigidos pelo SDK.

### 5.2 Bridge para `onListModels()`

Substituir:

```txt
buildConfiguredByokModelListHandler(process.env)
```

por:

```txt
buildModelGatewayListModelsHandler(registry)
```

Inicialmente, manter fallback para o handler antigo.

### 5.3 Reusar lifecycle atual

Não reimplementar `createSession`. Usar a função existente em `sdk/session/lifecycle.js`.

Critério de saída:

- terminal consegue criar sessão via factory;
- `ProviderConfig` final continua compatível com SDK.

---

## Faixa 6 — ProbeEngine e health compartilhado

Objetivo: promover probes e health de terminal para domínio do gateway.

### 6.1 HealthStore

Mover conceitos de `byok-provider-health.js` para:

```txt
model-gateway/health/ProviderHealthStore.js
```

Chave recomendada:

```txt
providerId | modelId | profile | routeProfile
```

### 6.2 ProviderFailureClassifier

Promover `terminal/byok/provider-failure.js` para:

```txt
model-gateway/health/ProviderFailureClassifier.js
```

O terminal passa a renderizar o resultado.

### 6.3 ProbeEngine

Criar probes reutilizáveis:

| Probe | Verifica |
|---|---|
| `basic_text` | sessão mínima responde |
| `streaming` | eventos de delta chegam |
| `tools` | modelo chama tool simples |
| `forced_tool_choice` | provider respeita tool_choice required |
| `json_mode` | retorna JSON válido |
| `json_schema` | obedece schema estrito |
| `vision` | aceita imagem mínima |
| `agent_runtime` | tools + ask_user + ciclo agentic |

### 6.4 Atualização de capabilities

Probe deve atualizar:

```txt
ModelRecord.capabilities
ModelRecord.verification
ProviderHealthStore
```

Critério de saída:

- `repo_agent` só escolhe modelo com `agent_runtime` ok ou confiança manual explícita.

---

## Faixa 7 — PolicyEngine e roteamento

Objetivo: selecionar modelos por tarefa, não por nome hard-coded.

### 7.1 Task profiles

Implementar:

```txt
cheap_chat
code
repo_agent
tool_agent
json_extraction
vision
deep_reasoning
local_private
```

### 7.2 Scoring

Score deve considerar:

- requisitos obrigatórios;
- confidence;
- health recente;
- custo;
- latência;
- contexto;
- provider allow/block;
- preferência local/remota;
- fallback chain;
- aging de probes.

### 7.3 Fallback

Fallback deve distinguir:

```txt
provider failure transient
provider failure auth/credits
model unsupported
context too large
runtime SDK failure
```

Critério de saída:

- falha 429/5xx pode tentar fallback;
- falha auth/credits bloqueia provider até correção;
- falha de capability não tenta modelo sem capability equivalente.

---

## Faixa 8 — UI terminal e server projections

Objetivo: trocar fontes internas sem quebrar comandos.

### 8.1 Terminal

Comandos recomendados:

```txt
/models list
/models route repo_agent
/providers list
/providers health
/byok profiles
/byok probe <model>
/byok recommend <profile>
```

### 8.2 Presentation/server

Adicionar projections:

```txt
readModelGatewaySummary()
readProviderHealthProjection()
readRoutingDecisionProjection()
```

### 8.3 Diagnóstico

`diagnose` deve mostrar:

```txt
registry records
providers enabled
secrets configured/não configurados
último catalog sync
últimos probes
modelo ativo
binding SDK atual
```

Critério de saída:

- operador entende por que um modelo foi escolhido ou rejeitado.

---

## Faixa 9 — Observability, custo e governança

Objetivo: transformar roteamento em sistema auditável.

### 9.1 UsageLedger

Registrar por chamada:

```txt
requestId
sessionId
providerId
modelId
routeProfile
latencyMs
success/failure
inputTokens
outputTokens
estimatedCost
failureKind
fallbackFrom
fallbackTo
```

### 9.2 Cost caps

Políticas:

```txt
maxUsdPerRequest
maxUsdPerDay
maxUsdPerProviderPerDay
preferFreeUntilProbePasses
```

### 9.3 Audit

Toda decisão de roteamento deve poder responder:

```txt
por que esse modelo?
quais candidatos foram recusados?
qual capability faltou?
qual health pesou?
qual custo estimado?
```

Critério de saída:

- decisões reproduzíveis via trace.

---

## Faixa 10 — Depreciação do BYOK monolítico

Objetivo: reduzir `sdk/session/provider.js` ao papel correto.

### 10.1 Primeiro estágio

`provider.js` mantém:

- `ProviderConfig` typedef;
- `validateProviderConfig`;
- `openaiProvider`, `azureProvider`, `anthropicProvider`;
- redaction mínima ou delegada;
- shims de compatibilidade.

### 10.2 Segundo estágio

Mover para `model-gateway`:

- presets;
- provider discovery;
- env profiles;
- model normalization;
- BYOK summary;
- route/session overrides.

### 10.3 Terceiro estágio

Marcar antigos exports como deprecated.

Critério de saída:

- SDK layer volta a ser vanilla bridge;
- model gateway vira source of truth.

---

## 13. Critérios de aceite

## 13.1 Arquitetura

- Novo provider pode ser adicionado sem editar `sdk/session/provider.js`.
- OpenRouter pode ser desabilitado sem quebrar outros providers.
- `ModelRecord` diferencia provider direto e provider agregado.
- `onListModels()` usa projection do registry unificado.
- BYOK env legado ainda funciona.

## 13.2 Operação

- `repo_agent` só escolhe modelo com tools + streaming.
- Probes conseguem marcar capability como `probe_verified` ou `probe_failed`.
- Falhas auth/credits/rate limit são classificadas e persistidas.
- Health influencia roteamento.
- Fallback é auditável.

## 13.3 Segurança

- Nenhum `ModelRecord` serializado contém API key, bearer token ou header sensível.
- Logs e health redigem segredos.
- Tokens estáticos expirados geram nova sessão, não retry cego.

## 13.4 DX

- Há README do `model-gateway`.
- Há exemplos de provider direto e OpenRouter.
- Há comando/projection para explicar decisão de rota.
- Há testes unitários para adapter/projection/policy.

---

## 14. Plano de validação

## 14.1 Validação imediata após documentação

Como esta etapa só adiciona documentação, não exige typecheck obrigatório. Mesmo assim, antes de refactors de código, registrar baseline:

```bash
npm run typecheck:strict:src.copilot
npm run lint:copilot
npm run test:copilot:unit
```

## 14.2 Validação por fase

| Fase | Validações mínimas |
|---|---|
| Faixa 1 | unit tests dos contracts e projections |
| Faixa 2 | registry load/save/import; snapshot do compat importer |
| Faixa 3 | adapters geram ProviderConfig válido e redigido |
| Faixa 4 | secrets nunca aparecem em registry/logs |
| Faixa 5 | sessão BYOK atual ainda cria com provider/model legado |
| Faixa 6 | probes chat/agent equivalentes aos atuais continuam passando |
| Faixa 7 | policy seleciona/rejeita modelos por capability real |
| Faixa 8 | comandos terminal mostram mesma informação + provenance |
| Faixa 9 | usage/cost/latency gravados sem segredo |
| Faixa 10 | `sdk/session/provider.js` reduzido sem quebrar compat exports |

---

## 15. Glossário operacional

| Termo | Definição |
|---|---|
| Provider | Serviço ou endpoint que executa modelos: OpenAI, Anthropic, OpenRouter, Ollama, vLLM etc. |
| ProviderAdapter | Código que converte ProviderRecord/ModelRecord para ProviderConfig do Copilot SDK. |
| ModelRecord | Registro canônico de um modelo específico em um provider específico. |
| Capability | Capacidade declarada ou verificada: tools, streaming, vision, json_schema etc. |
| Probe | Teste real, geralmente descartável, para verificar comportamento. |
| Confidence | Grau de confiança da capability: catalog, manual, probe_verified etc. |
| RouteProfile | Intenção operacional: repo_agent, cheap_chat, json_extraction etc. |
| Source of truth | Registro próprio do sistema, não a lista estática de modelos nem OpenRouter isoladamente. |
| OpenAI-compatible | Endpoint que aceita formato de Chat Completions/Responses compatível com OpenAI. |
| BYOK | Bring Your Own Key: uso de credenciais próprias de providers externos. |

---

## 16. Referências oficiais

1. GitHub Docs — Copilot SDK BYOK:  
   https://docs.github.com/en/copilot/how-tos/copilot-sdk/authenticate-copilot-sdk/bring-your-own-key

2. GitHub Docs — Copilot CLI BYOK models:  
   https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models

3. OpenRouter API Reference:  
   https://openrouter.ai/docs/api/reference/overview

4. Model Context Protocol — Tools specification:  
   https://modelcontextprotocol.io/specification/2025-11-25/server/tools

---

## Conclusão final

A recomendação é evoluir de:

```txt
BYOK env preset dentro do SDK wrapper
```

para:

```txt
ModelGateway próprio, com registry/adapters/probes/routing/health, usando o Copilot SDK como runtime agentic.
```

A base atual já tem os blocos corretos, mas ainda não a separação correta. O próximo passo mais importante é criar `src/copilot/model-gateway` como domínio explícito e mover gradualmente para lá as responsabilidades que hoje estão espalhadas entre `sdk/session/provider.js`, `sdk/models/*` e `terminal/byok/*`.
