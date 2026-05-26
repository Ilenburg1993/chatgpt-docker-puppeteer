# Canonical Model Gateway BYOK Universal Guide — 2026-05-25

Este documento passa a ser o guia operacional canônico para a evolução do
`src/copilot/model-gateway`.

Ele sucede e reorganiza o roadmap anterior:

`src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_ROADMAP_2026-05-24.md`

O roadmap antigo foi lido integralmente em 2026-05-25. Ele continua sendo um
diário histórico rico, mas deixou de ser o melhor guia de execução porque mistura
arquitetura, investigação, cortes já commitados, validações, próximos passos e
notas de continuidade em mais de três mil linhas.

Este guia consolida:

- a situação atual observada no código;
- a arquitetura ideal;
- o que já foi entregue;
- o que ainda falta;
- a separação entre metadados, elegibilidade pré-runtime, probes runtime e seleção;
- o roadmap com faixas, fases e subfases booleanas.

Todo checkbox deste arquivo é booleano: `[x]` significa feito de forma aceitável
para a camada atual; `[ ]` significa pendente. Não há estado parcial em checkbox.
Quando uma área estiver parcialmente feita, o item amplo fica pendente e as partes
entregues aparecem como subitens marcados.

---

## 1. Norte

O `model-gateway` deve se tornar a camada universal de provedores e modelos do
Copilot local, com normalização OpenAI-first e extensões próprias ricas.

O objetivo não é criar apenas uma lista de modelos.

O objetivo é construir um sistema capaz de:

- coletar metadados públicos, autenticados e locais;
- preservar evidência e proveniência;
- normalizar tudo para uma projeção OpenAI-compatible;
- manter extensões ricas em `x_model_gateway`;
- separar fatos globais de fatos da conta do operador;
- decidir elegibilidade antes de gastar runtime;
- executar probes runtime somente quando fizer sentido;
- selecionar modelos por política explícita;
- explicar toda decisão;
- evitar vazamento de segredo;
- suportar provedores diretos, agregadores, gateways, modelos locais e rotas
  auto-seletoras.

O sistema é universal, mas sua projeção externa deve falar primeiro a linguagem
OpenAI:

- `/v1/models`-like list;
- `id`;
- `object=model`;
- `created`;
- `owned_by`;
- extensão `x_model_gateway` para tudo que não cabe no schema OpenAI básico.

Essa escolha preserva interoperabilidade sem achatar a riqueza dos providers.

---

## 2. Fontes Consolidadas

Este guia foi escrito após leitura e inspeção local de:

- `CANONICAL_MODEL_GATEWAY_BYOK_ROADMAP_2026-05-24.md`;
- `src/copilot/model-gateway/catalog/contracts.js`;
- `src/copilot/model-gateway/catalog/normalizers.js`;
- `src/copilot/model-gateway/catalog/merge.js`;
- `src/copilot/model-gateway/catalog/json-catalog-store.js`;
- `src/copilot/model-gateway/catalog/importer-runner.js`;
- `src/copilot/model-gateway/catalog/default-importers.js`;
- `src/copilot/model-gateway/catalog/refresh.js`;
- `src/copilot/model-gateway/catalog/openai-schema.js`;
- `src/copilot/model-gateway/providers/endpoints/index.js`;
- `src/copilot/model-gateway/routing/policy-engine.js`;
- `src/copilot/model-gateway/probes/recommendations.js`;
- `src/copilot/model-gateway/secrets/env-secret-registry.js`;
- `src/copilot/model-gateway/session/copilot-model-projection.js`;
- `src/copilot/model-gateway/registry/model-registry.js`;
- `src/copilot/terminal/commands/byok.js`;
- `tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`;
- inventário de arquivos sob `src/copilot/model-gateway`.

Estado de git observado antes deste documento:

- branch: `main`;
- remoto: sincronizado com `origin/main`;
- worktree: limpo.

---

## 3. Vocabulário Canônico

### 3.1 Provider

Provider é a entidade que fornece uma superfície de catálogo ou runtime.

Exemplos:

- `openai`;
- `anthropic`;
- `gemini`;
- `mistral`;
- `groq`;
- `openrouter`;
- `huggingface`;
- `cloudflare-workers-ai`;
- `opencode`;
- `ollama-local`;
- `kilo-gateway`.

Provider não é necessariamente o fabricante do modelo. Um gateway pode expor
modelos de vários fabricantes.

### 3.2 Subject Provider

Subject provider é o provider real a que um registro se refere dentro de um
gateway ou agregador.

Exemplo:

- providerId: `kilo-gateway`;
- subjectProviderId: `anthropic`;
- providerModel: `claude-sonnet-4-5`.

### 3.3 Provider Model

Provider model é o id local do modelo no provider ou gateway.

Ele não deve ser confundido com o id global do gateway.

Exemplos:

- `gpt-4.1`;
- `claude-sonnet-4-5`;
- `openai/gpt-oss-120b`;
- `@cf/openai/gpt-oss-120b`;
- `gemma3:4b`;
- `deepseek/deepseek-chat-v3-0324:free`.

### 3.4 Gateway Model Id

Gateway model id é a identidade global interna.

Forma recomendada:

`providerId:providerModel:routeProfile`

Quando `routeProfile` for default, a visualização pode omitir o sufixo, mas o
armazenamento deve ser explícito.

### 3.5 Catalog Source

Catalog source descreve onde e como um fato foi coletado.

Exemplos:

- endpoint público de docs;
- endpoint autenticado `/v1/models`;
- API local Ollama `/api/tags`;
- HTML oficial;
- Markdown oficial;
- seed manual;
- probe runtime.

### 3.6 Metadata Evidence

Metadata evidence é o fato bruto normalizado, com:

- provider;
- modelo;
- campo;
- valor;
- fonte;
- confiança;
- observação temporal;
- sanitização.

Ela é a base do banco canônico.

### 3.7 Canonical Projection

Canonical projection é a visão consolidada por modelo após merge de evidências.

Ela responde:

- qual é o melhor valor atual para cada campo;
- qual evidência venceu;
- qual confiança venceu;
- onde há conflito.

Ela não prova runtime.

### 3.8 Provider Projection

Provider projection é a visão consolidada de um provider ou subject provider.

Ela preserva:

- data policy;
- política de retenção;
- hints de privacidade;
- metadados de gateway;
- metadados de provider upstream.

### 3.9 Route Option

Route option descreve uma forma possível de tentar usar um modelo.

Ela pode representar:

- modelo exato;
- seletor `:fastest`;
- seletor `:cheapest`;
- provider explícito;
- gateway fallback;
- gateway auto;
- rota local;
- rota OpenAI-compatible;
- rota nativa.

Route option ainda não é runtime proof.

### 3.10 Account Overlay

Account overlay descreve fatos vinculados à conta, key, org, workspace ou
gateway do operador.

Exemplos:

- key configurada;
- modelos visíveis por `/v1/models`;
- modelos bloqueados;
- plano;
- quota;
- rate limit;
- budget;
- headers de organização;
- Cloudflare account/gateway configurados;
- modelos localmente instalados no Ollama.

Account overlay não deve serializar segredos.

### 3.11 Eligibility Decision

Eligibility decision é a decisão pré-runtime que responde:

“Este modelo/rota deve entrar na fila de runtime?”

Ela usa:

- catálogo canônico;
- route options;
- account overlays;
- estado de segredo;
- políticas do operador;
- regras de exclusão sem execução;
- estado de saúde fatal já conhecido.

Ela não altera o banco canônico de metadados.

### 3.12 Runtime Probe

Runtime probe é uma chamada efetiva ao modelo ou ao endpoint.

Exemplos:

- chat básico;
- streaming;
- JSON;
- tools;
- forced tool choice;
- vision;
- reasoning;
- embeddings;
- audio;
- gateway fallback.

Runtime probe gera prova runtime, não substitui metadados.

### 3.13 Route Decision

Route decision é a escolha auditável de um modelo/rota para uma tarefa.

Ela deve explicar:

- candidatos;
- excluídos;
- motivos;
- pontuações;
- política;
- probes usados;
- fallback chain;
- resultado final.

---

## 4. Separação Fundamental De Camadas

Este é o ponto arquitetural mais importante.

O sistema deve ser dividido em fases que não se contaminam:

1. Coleta de metadados.
2. Normalização e merge.
3. Overlay de conta.
4. Elegibilidade pré-runtime.
5. Ranking por metadados e política.
6. Probes runtime.
7. Seleção runtime final.
8. Observabilidade e governança.

### 4.1 Metadados Não São Prova Runtime

Um provider pode declarar:

- `tools=true`;
- `vision=true`;
- `context=1M`;
- `price=0`;
- `active=true`.

Isso ainda não prova que:

- nossa key tem acesso;
- o plano permite o modelo;
- a região permite o modelo;
- o endpoint responde agora;
- tools funcionam no wire format escolhido;
- streaming entrega deltas;
- JSON obedece schema;
- o limite real é utilizável;
- o modelo não está bloqueado por quota.

### 4.2 Overlay Não É Prova Runtime

Um `/v1/models` autenticado geralmente prova visibilidade de conta.

Ele não prova:

- chat básico;
- tools;
- JSON;
- stream;
- custo real;
- latência;
- limite prático;
- fallback.

### 4.3 Elegibilidade Pré-Runtime Não É Probe

Elegibilidade pré-runtime é uma barreira barata.

Ela deve excluir candidatos que não vale a pena tentar.

Ela não deve chamar o modelo.

Ela pode chamar endpoints de catálogo/conta se essa chamada for parte da fase de
overlay, mas não deve executar inferência.

### 4.4 Runtime Probe Não Deve Mutar Catálogo Global

Runtime probe deve escrever em uma camada de prova runtime.

Ela pode influenciar seleção, health e promoção.

Ela não deve sobrescrever fatos globais como se o provider tivesse mudado sua
documentação.

### 4.5 Vision Não É Exclusão Automática

Vision é metadado, preferência ou requisito de tarefa.

Ela não deve excluir automaticamente modelos bons para tarefas textuais.

Se uma tarefa exige imagem, a ausência de vision pode excluir para aquela tarefa.

Se a tarefa não exige imagem, vision é no máximo bônus ou superfície a validar.

---

## 5. Situação Atual Observada No Código

### 5.1 Arquitetura Base

- [x] `src/copilot/model-gateway` existe como domínio canônico.
- [x] Há separação entre gateway, SDK e terminal.
- [x] O SDK continua sendo boundary de sessão.
- [x] O terminal chama projeções e comandos do gateway.
- [x] Há README local descrevendo fronteiras.

### 5.2 Contratos De Catálogo

- [x] `createProviderCatalogSource()`.
- [x] `createModelMetadataEvidence()`.
- [x] `createProviderMetadataEvidence()`.
- [x] `createCanonicalProviderProjection()`.
- [x] `createCanonicalModelProjection()`.
- [x] `createModelRouteOption()`.
- [x] `createProviderAccountOverlay()`.
- [x] Sanitização secret-safe em contratos.
- [x] Confidence vocabulary com `heuristic`, `static_seed`, `catalog`, `docs`,
  `authenticated_catalog`, `manual`, `probe_verified` e `probe_failed`.

### 5.3 Merge E Projeção

- [x] Merge field-wise por confiança.
- [x] Provenance por campo.
- [x] Confidence por campo.
- [x] Conflitos preservados.
- [x] Projeção OpenAI-compatible com `x_model_gateway`.
- [x] Provider projection acoplada na extensão OpenAI.

### 5.4 Store Atual

- [x] Store JSON redacted em `data/copilot/model-gateway/catalog.json`.
- [x] Snapshot com sources, evidences, providerEvidences, routeOptions,
  accountOverlays, projections, providerProjections, importRuns, rawPayloadRefs e
  conflicts.
- [x] Store SQLite normalizado inicial.
- [x] Migrations versionadas de SQLite para schema reservado.
- [x] Separação física planejada entre catálogo global, overlays, elegibilidade,
  probes, health e decisões de rota.

### 5.5 Importer Runner

- [x] Interface de importer com `fetchRaw`, `parseRows`, `toEvidenceFacts`.
- [x] Suporte a provider evidences.
- [x] Suporte a route options.
- [x] Suporte a account overlays.
- [x] Runs com status `completed` ou `failed`.
- [x] Erro de importer preservado sem quebrar todo o pipeline.
- [x] Raw payload refs sanitizados.

### 5.6 Importers Implementados

- [x] OpenRouter public models.
- [x] Kilo Gateway models.
- [x] Kilo Gateway providers.
- [x] Cerebras public catalog.
- [x] Cerebras account via generic OpenAI-compatible.
- [x] OpenAI authenticated `/v1/models`.
- [x] Anthropic authenticated `/v1/models` e model retrieve.
- [x] Gemini list/get.
- [x] Mistral models.
- [x] Groq authenticated models.
- [x] Groq public docs/pricing.
- [x] Hugging Face Inference Providers router.
- [x] Cloudflare Workers AI catalog Markdown/HTML.
- [x] Cloudflare AI Gateway route metadata.
- [x] NVIDIA NIM hosted/self-hosted.
- [x] Ollama local tags/show.
- [x] OpenCode Zen API.
- [x] OpenCode Zen docs.
- [x] Chutes models.
- [x] Z.AI docs/pricing.

### 5.7 Normalizadores Implementados

- [x] Modalidades.
- [x] Capacidades OpenAI-compatible de catálogo.
- [x] Limites de tokens/rate.
- [x] Pricing USD por milhão.
- [x] Aliases.
- [x] Lifecycle.
- [x] Traits técnicos de identidade do modelo.
- [x] Traits de rota/política.
- [x] Controles de account overlay.

### 5.8 Routing Atual

- [x] Policy engine deterministicamente pontua candidatos.
- [x] Perfis de tarefa existem.
- [x] Provider allow/block existe.
- [x] Health runtime já pode excluir falhas.
- [x] Vision é soft preference em teste.
- [x] Policy engine pode consumir/evaluar eligibility pré-runtime quando a opção
  de roteamento é ativada.
- [x] Policy engine possui entrada canônica para snapshot completo com route
  options, overlays e eligibility decisions.

### 5.9 Probes

- [x] Chat probe.
- [x] Agent/tools probe.
- [x] JSON probe.
- [x] Streaming probe.
- [x] Vision probe.
- [x] Recomendações de probes por diff de catálogo.
- [x] Matrix completa por provider/wire API.
- [ ] Probes para embeddings.
- [ ] Probes para audio.
- [ ] Probes para rerank.
- [ ] Probes para gateway fallback/cache/retry.
- [ ] Probes para forced tool choice e parallel tool calls como fatos separados.

### 5.10 Terminal

- [x] `/byok gateway catalog refresh`.
- [x] `/byok gateway catalog diff`.
- [x] `/byok gateway catalog conflicts`.
- [x] Inventário de endpoints por provider.
- [x] Pre-K gate.
- [x] Cockpit de modelos/provedores anterior.
- [x] UX dedicada de account overlays.
- [x] UX inicial de eligibility decisions via `/byok gateway eligibility`.
- [x] UX de explicação por modelo juntando catálogo, overlay, eligibility e
  probes.
- [x] Busca rica por metadados via `/byok gateway catalog search`.
- [x] Export OpenAI schema visível via `/byok gateway catalog openai`.

### 5.11 Observabilidade

- [x] Eventos de refresh.
- [x] Eventos de diff.
- [x] Eventos de conflito.
- [x] Ledger de route decision.
- [x] Métricas de catálogo.
- [x] Eventos sem prompt content.
- [x] Eventos iniciais de eligibility.
- [x] Métricas iniciais de exclusão pré-runtime.
- [x] Métricas de cobertura de metadados por provider.

### 5.12 Testes

- [x] Testes unitários extensos em `test_model_gateway_contracts.spec.js`.
- [x] Cobertura de importers principais.
- [x] Cobertura de normalizadores.
- [x] Cobertura de OpenAI schema.
- [x] Cobertura de secret redaction.
- [x] Cobertura de probes básicos.
- [x] Cobertura inicial da eligibility pré-runtime: secret ausente, allow list
  fechada, unknown access policy, Cloudflare account/gateway e Ollama local.
- [x] Testes iniciais de SQLite.
- [x] Testes iniciais de eligibility layer.
- [ ] Testes de seleção final usando catalog + overlay + eligibility + runtime.

---

## 6. Arquitetura Ideal

### 6.1 Pasta Alvo

Estrutura alvo aproximada:

```txt
src/copilot/model-gateway/
  catalog/
    contracts.js
    normalizers.js
    merge.js
    openai-schema.js
    refresh.js
    stores/
      json-catalog-store.js
      sqlite-catalog-store.js
      migrations/
    importers/
      index.js
      ...
  providers/
    specs/
    endpoints/
    adapters/
  accounts/
    overlays.js
    access-resolver.js
    policy.js
  eligibility/
    contracts.js
    evaluator.js
    store.js
    explain.js
  routing/
    policy-engine.js
    candidate-builder.js
    selector.js
  probes/
    chat-probe.js
    streaming-probe.js
    json-probe.js
    agent-probe.js
    vision-probe.js
    embeddings-probe.js
    audio-probe.js
    gateway-probe.js
  health/
  observability/
  session/
  terminal-projection/
```

Não é obrigatório criar exatamente esta árvore em um único corte. Ela define a
direção.

### 6.2 Bancos Lógicos

Mesmo que tudo comece em um SQLite único, as camadas lógicas devem ser separadas.

#### 6.2.1 Banco Canônico De Catálogo

Guarda fatos sobre modelos e providers.

Tabelas lógicas:

- `catalog_sources`;
- `model_metadata_evidence`;
- `provider_metadata_evidence`;
- `canonical_model_projections`;
- `canonical_provider_projections`;
- `model_route_options`;
- `catalog_conflicts`;
- `raw_payload_refs`;
- `catalog_import_runs`.

Esse banco responde:

- o que existe;
- quem disse;
- quando foi observado;
- com que confiança;
- como normalizamos.

#### 6.2.2 Banco De Overlays De Conta

Guarda fatos dependentes do operador.

Tabelas lógicas:

- `provider_account_overlays`;
- `account_visible_models`;
- `account_blocked_models`;
- `account_quota_snapshots`;
- `account_rate_limit_snapshots`;
- `account_spending_snapshots`;
- `account_policy_headers_redacted`;
- `account_gateway_configs`.

Esse banco responde:

- o que esta key/conta/org/gateway aparentemente permite;
- o que está bloqueado;
- quais limites foram observados sem inferência;
- qual secretRef seria necessário.

#### 6.2.3 Banco De Elegibilidade Pré-Runtime

Guarda decisões derivadas.

Ele não é fonte canônica de metadados.

Tabelas lógicas:

- `model_eligibility_runs`;
- `model_eligibility_decisions`;
- `model_eligibility_reasons`;
- `model_eligibility_policy_inputs`.

Esse banco responde:

- entrou ou não entrou na fila de runtime;
- por quê;
- com qual política;
- contra qual snapshot de catálogo/overlay;
- qual decisão é hard exclusion;
- qual decisão é soft penalty.

#### 6.2.4 Banco De Probes Runtime

Guarda provas de execução.

Tabelas lógicas:

- `runtime_probe_runs`;
- `runtime_probe_results`;
- `runtime_probe_events`;
- `runtime_probe_artifacts_redacted`;
- `model_runtime_health`.

Esse banco responde:

- respondeu chat básico;
- fez stream;
- chamou tools;
- respeitou JSON;
- aceitou imagem;
- expôs erro auth/quota/rate;
- falhou por payload, endpoint, formato ou política.

#### 6.2.5 Banco De Decisões De Rota

Guarda auditoria da seleção.

Tabelas lógicas:

- `route_decision_runs`;
- `route_decision_candidates`;
- `route_decision_rejections`;
- `route_decision_selected`;
- `route_decision_fallbacks`.

Esse banco responde:

- por que um modelo foi escolhido;
- por que outro foi rejeitado;
- quais probes influenciaram;
- qual fallback chain foi montada.

---

## 7. Pipeline Alvo

### 7.1 Fase 0 — Inventário De Fontes

Entrada:

- provider specs;
- endpoint inventory;
- env secret registry;
- config do operador;
- URLs oficiais conhecidas;
- fontes locais.

Saída:

- lista de importers possíveis;
- lista de importers habilitados;
- lista de secrets ausentes;
- lista de fontes públicas.

### 7.2 Fase 1 — Coleta Profunda De Metadados

Entrada:

- importers públicos;
- importers autenticados;
- importers locais;
- importers de docs.

Saída:

- sources;
- raw payload refs;
- evidence facts;
- provider evidence facts;
- route options;
- account overlays.

Regra:

- coletar o máximo possível sem executar modelos.

### 7.3 Fase 2 — Normalização E Merge

Entrada:

- evidências.

Saída:

- canonical projections;
- provider projections;
- conflicts;
- OpenAI list.

Regra:

- confiança e proveniência por campo são obrigatórias.

### 7.4 Fase 3 — Overlay De Conta

Entrada:

- secret registry;
- account overlays;
- account catalog endpoints;
- org/workspace config.

Saída:

- visão account-scoped dos modelos;
- hints de acesso;
- bloqueios conhecidos;
- quotas e limites observados.

Regra:

- overlay não deve alterar metadado global.

### 7.5 Fase 4 — Elegibilidade Pré-Runtime

Entrada:

- canonical projections;
- route options;
- account overlays;
- secrets configurados;
- provider health fatal já conhecido;
- operator policy;
- task profile.

Saída:

- eligibility decisions.

Regra:

- não executar inferência.

### 7.6 Fase 5 — Ranking Por Metadados

Entrada:

- candidatos elegíveis;
- metadata;
- policy profile;
- preferences;
- budget;
- task.

Saída:

- shortlist para probes ou runtime.

Regra:

- ranking por metadados não substitui prova runtime.

### 7.7 Fase 6 — Probes Runtime

Entrada:

- shortlist;
- probe plan;
- policy de custo;
- secrets.

Saída:

- probe results;
- health;
- runtime confidence.

Regra:

- probes devem ser pequenos, explícitos, auditáveis e baratos.

### 7.8 Fase 7 — Seleção Runtime

Entrada:

- metadata ranking;
- eligibility;
- probe results;
- health;
- operator policy;
- current task.

Saída:

- selected route;
- fallback chain;
- explanation.

### 7.9 Fase 8 — Observabilidade

Entrada:

- import runs;
- eligibility runs;
- probe runs;
- route decisions.

Saída:

- eventos;
- métricas;
- relatórios;
- terminal UX.

---

## 8. Elegibilidade Pré-Runtime

Esta fase é nova e deve virar a próxima área estrutural.

Ela existe para evitar probes inúteis.

Exemplo central:

Um catálogo pode conter o melhor modelo do mundo. Se a key do operador não tem
acesso a ele, não há motivo para tentar runtime.

### 8.1 Princípios

- A elegibilidade não altera o catálogo canônico.
- A elegibilidade é derivada e temporária.
- A elegibilidade é account-scoped.
- A elegibilidade é policy-scoped.
- A elegibilidade é route-scoped.
- A elegibilidade pode expirar.
- A elegibilidade deve explicar motivos.
- A elegibilidade deve distinguir hard exclusion de soft penalty.
- A elegibilidade deve ser testável sem rede.

### 8.2 Chave Da Decisão

Chave recomendada:

```txt
providerId
providerModel
routeProfile
selectorKind
selectorSyntax
accountScope
secretRef
policyProfile
taskProfile
catalogSnapshotId
overlaySnapshotId
```

### 8.3 Resultado

Formato conceitual:

```js
{
  include: true,
  disposition: "eligible",
  hardExclusions: [],
  softPenalties: [],
  requiredRuntimeProbes: ["chat"],
  reasons: ["account_model_visible", "secret_configured"],
  evidenceRefs: [],
  overlayRefs: [],
  routeOptionRefs: []
}
```

Estados recomendados:

- `eligible`;
- `excluded`;
- `unknown_policy_allows_probe`;
- `unknown_policy_blocks_probe`;
- `deferred_missing_overlay`;
- `deferred_missing_secret`;
- `deferred_provider_unavailable`;

### 8.4 Exclusões Automáticas Fortes

Devem excluir antes de runtime:

- secretRef exigido e secret ausente;
- provider explicitamente bloqueado pela policy;
- modelo explicitamente bloqueado pela policy;
- account overlay contém `blockedModels` incluindo o modelo;
- account overlay autenticado existe e declara allow list fechada sem o modelo;
- provider desabilitado;
- modelo desabilitado;
- lifecycle `retired` quando a policy não permite retired;
- endpoint runtime necessário ausente do inventário;
- wire API necessária não suportada;
- rota local exige daemon local e overlay indica daemon ausente;
- modelo local exige instalação e overlay não lista o modelo;
- Cloudflare route exige `CLOUDFLARE_ACCOUNT_ID` e ele está ausente;
- Cloudflare AI Gateway route exige gateway id e ele está ausente;
- org/workspace header obrigatório ausente;
- spending hard limit observado como esgotado;
- quota restante observada como zero;
- rate limit fatal vigente;
- health fatal recente de auth, permission, not_found ou quota;
- provider region/account mismatch conhecido;
- route selector incompatível com o provider;
- adapter runtime inexistente para wire API escolhida.

### 8.5 Exclusões Fortes Condicionadas À Policy

Podem excluir dependendo da política:

- modelo preview/beta;
- modelo deprecated com data futura;
- preço desconhecido;
- preço acima do orçamento hard declarado pela policy;
- contexto abaixo do mínimo da tarefa;
- max output abaixo do mínimo da tarefa;
- data policy incompatível;
- retenção de prompts incompatível;
- provider sem BYOK interno;
- provider sem privacidade aceitável;
- rota via agregador quando a policy exige provider direto;
- rota local privada quando a policy exige cloud;
- rota cloud quando a policy exige local;
- rota sem fallback quando a task exige fallback;
- rota sem cache quando a policy exige cache;
- rota sem streaming quando a UX exige streaming.

### 8.6 Soft Penalties

Não devem excluir automaticamente:

- ausência de vision para tarefa textual;
- ausência de audio para tarefa textual;
- ausência de preço;
- preço acima da preferência, mas dentro do limite hard;
- confidence baixa;
- metadata só heurística;
- contexto menor, mas ainda suficiente;
- latência desconhecida;
- modelo novo sem probes;
- provider com docs incompletos;
- route option auto-seletora;
- gateway com provider upstream desconhecido;
- modelo grande e caro quando budget não é hard.

### 8.7 Unknowns

`unknown` não é sempre exclusão.

Políticas possíveis:

- `explore_unknowns`: permite probe barato;
- `block_unknown_access`: exige overlay positivo;
- `prefer_known`: permite, mas penaliza;
- `critical_only_verified`: só permite runtime provado;
- `cheap_probe_first`: permite chat básico, bloqueia probes caros.

### 8.8 Account Visibility

Interpretação recomendada:

- Se não existe overlay autenticado, acesso é `unknown`.
- Se existe overlay autenticado com `enabledModels` e o modelo está na lista,
  acesso é `visible`.
- Se existe overlay autenticado com `enabledModels` e policy trata a lista como
  fechada, modelo ausente é `excluded`.
- Se existe overlay autenticado com `blockedModels`, modelo presente é
  `excluded`.
- Se provider docs dizem público, mas conta não diz visível, acesso continua
  account-unknown.
- Se endpoint de account list falha por auth, provider inteiro deve ser
  excluído para aquela key até nova coleta.

### 8.9 Exemplo De Decisão

Modelo:

- provider: `groq`;
- model: `openai/gpt-oss-120b`;
- docs: ativo;
- account overlay: enabledModels não inclui o modelo;
- policy: `block_unknown_access`.

Decisão:

- excluded;
- reason: `account_model_not_visible`;
- sem runtime.

Outro caso:

- provider: `openrouter`;
- model: `some/new-model`;
- public catalog: existe;
- overlay autenticado: ausente;
- secret configured: sim;
- policy: `explore_unknowns`.

Decisão:

- include;
- soft penalty `account_visibility_unknown`;
- required probe `chat`.

---

## 9. Data Model OpenAI-First

### 9.1 OpenAI Entry

Saída externa:

```js
{
  id: "provider-model-id",
  object: "model",
  created: 1760000000,
  owned_by: "provider-or-upstream",
  x_model_gateway: {}
}
```

### 9.2 Extensão `x_model_gateway`

Campos mínimos:

- `schema_version`;
- `gateway_id`;
- `provider_id`;
- `provider_model`;
- `route_profile`;
- `display_name`;
- `description`;
- `lifecycle`;
- `aliases`;
- `family`;
- `modalities`;
- `capabilities`;
- `supported_parameters`;
- `unsupported_parameters`;
- `limits`;
- `pricing`;
- `rate_limits`;
- `data_policy`;
- `license`;
- `provider_metadata`;
- `provider_projection`;
- `routing_hints`;
- `account_overlay_refs`;
- `provenance_by_field`;
- `confidence_by_field`.

Campos futuros:

- `route_options`;
- `runtime_health`;
- `probe_summary`;
- `selection_summary`.

Campos opcionais ja suportados:

- `eligibility`;

### 9.3 Regra De Compatibilidade

Tudo que for universal e OpenAI-like fica no schema base.

Tudo que for nosso, rico, multi-provider ou experimental fica em
`x_model_gateway`.

---

## 10. Providers E Estado Atual

### 10.1 OpenAI

- [x] Importer autenticado.
- [x] Route options.
- [x] Capability hints por família.
- [x] Account overlay por modelos visíveis.
- [x] Docs seed oficial de preço/limites/capabilities.
- [ ] Integração plena com Responses runtime.
- [ ] Elegibilidade account-scoped.

### 10.2 Anthropic

- [x] Importer autenticado paginado.
- [x] Retrieve por modelo.
- [x] Overlay de conta.
- [x] Hints de Messages API.
- [ ] Docs seed completo por família.
- [ ] Probes específicos de tool use no wire Anthropic.

### 10.3 Gemini

- [x] `models.list`.
- [x] `models.get`.
- [x] OpenAI-compatible route metadata.
- [x] Overlay de conta.
- [ ] Diferença fina AI Studio vs Vertex.
- [ ] Probes de JSON/tools/vision específicos.

### 10.4 Mistral

- [x] Importer autenticado.
- [x] Model cards com lifecycle.
- [x] Overlay de conta.
- [ ] Docs seed de preço e limites completo.
- [ ] Probes específicos.

### 10.5 Groq

- [x] Importer autenticado.
- [x] Docs/pricing importer.
- [x] Max output.
- [x] Batch endpoint metadata.
- [x] Built-in tools pricing.
- [ ] Eligibility usando active/account visibility.
- [ ] Probes compound/built-in tools.

### 10.6 OpenRouter

- [x] Public models importer.
- [x] Pricing/capabilities/context.
- [x] Provider routing metadata.
- [ ] Account overlay autenticado profundo.
- [ ] Provider-specific route eligibility.
- [ ] Probes de provider explicit/fallback.

### 10.7 Kilo Gateway

- [x] Models importer.
- [x] Providers importer.
- [x] Route metadata de gateway.
- [x] BYOK internal hints.
- [ ] Account overlay real de allow/block/balance.
- [ ] Probes live com `llm-b` quando a camada J+ estiver pronta.
- [x] Seleção por provider upstream.

### 10.8 Hugging Face

- [x] Inference Providers importer.
- [x] Route selectors `:fastest`, `:cheapest`, `:preferred`.
- [x] Provider explicit route options.
- [x] Overlay autenticado.
- [ ] Eligibility por provider explícito.
- [ ] Probes por router/provider.

### 10.9 Cloudflare Workers AI / AI Gateway

- [x] Public Markdown catalog.
- [x] Workers AI direct route metadata.
- [x] AI Gateway universal route metadata.
- [x] Overlay com account/gateway configured.
- [ ] Account access validation sem runtime.
- [ ] Gateway fallback/cache/retry probes.
- [ ] Separação UX Workers AI direto vs AI Gateway.

### 10.10 NVIDIA NIM

- [x] Hosted importer.
- [x] Self-hosted metadata shape.
- [x] Management endpoint metadata.
- [x] Overlay account-scoped.
- [ ] Health probes para management endpoints.
- [ ] Diferenciar hosted vs self-hosted na elegibilidade.

### 10.11 Ollama

- [x] Local tags/show importer.
- [x] Digest/size/quantization/context.
- [x] Overlay de modelos instalados localmente.
- [x] Route local private.
- [ ] Elegibilidade daemon online/offline.
- [ ] Probe local sem segredo.

### 10.12 OpenCode

- [x] `OPENCODE_API_KEY` no padrão geral.
- [x] API models importer.
- [x] Docs importer.
- [x] Family-specific endpoint metadata.
- [x] Pricing tiers e deprecações.
- [ ] Adapter runtime por endpoint family.
- [ ] Eligibility por endpoint/wire API.

### 10.13 Chutes

- [x] Rich models importer.
- [x] Pricing/context/features.
- [x] Confidential compute metadata.
- [x] Overlay autenticado.
- [ ] Eligibility por confidential compute/policy.
- [ ] Probes tools/JSON/reasoning.

### 10.14 Z.AI

- [x] Docs/pricing importer.
- [x] OpenAPI URL preservada.
- [x] Pricing cache/web search.
- [x] Overlay autenticado.
- [ ] Parser OpenAPI estrutural.
- [ ] Runtime adapter/probes específicos.

### 10.15 Cerebras

- [x] Public rich catalog.
- [x] Account via generic OpenAI-compatible.
- [ ] Importer autenticado especializado.
- [ ] Docs de rate limits e pricing reconciliados.

---

## 11. Roadmap Consolidado

### Faixa A — Identidade Base

- [x] Definir `providerId`.
- [x] Definir `providerModel`.
- [x] Definir gateway model id.
- [x] Preservar provider-local SDK id.
- [x] Não misturar modelo global com modelo local.
- [x] Testar distinção identity/projection.

### Faixa B — Fronteira SDK

- [x] Manter SDK vanilla.
- [x] Projetar modelos gateway para `ModelInfo`.
- [x] Separar adapters de provider.
- [x] Evitar preset logic espalhado no SDK.
- [x] Completar projeção OpenAI-first para todas as rotas novas.

### Faixa C — Segredos

- [x] `EnvSecretRegistry`.
- [x] Redaction central.
- [x] `secretRef` em vez de valor.
- [x] Testes de não serialização.
- [x] `OPENCODE_API_KEY` incluído.
- [x] Policy de secrets por account/workspace.
- [x] UX para secrets ausentes por provider.

### Faixa D — Provider Specs E Endpoints

- [x] Um arquivo por provider em `providers/specs`.
- [x] Um arquivo por provider em `providers/endpoints`.
- [x] Inventário central.
- [x] Separação entre catalog sources e runtime endpoints.
- [x] Completar richness padronizado por endpoint.
- [x] Adicionar schema de endpoint source.
- [x] Testar inventário contra importers existentes.

### Faixa E — Probes Base

- [x] Chat probe.
- [x] Agent probe.
- [x] JSON probe.
- [x] Streaming probe.
- [x] Vision probe.
- [x] Recomendações de probes por diff.
- [ ] Embeddings probe.
- [ ] Audio probe.
- [ ] Rerank probe.
- [ ] Gateway fallback probe.
- [ ] Provider-native probes por wire API.

### Faixa F — Health E Falhas

- [x] Health runtime separado do terminal.
- [x] Chat health.
- [x] Agent health.
- [x] Excluir falhas quando policy manda.
- [x] Classificação de falhas BYOK.
- [x] Integrar health fatal à elegibilidade pré-runtime.
- [x] Persistir health em SQLite.
- [x] Preservar `retry-after`, status HTTP e reset window em falhas runtime.
- [x] Não manter rate-limit fatal após expiração da janela observada.

### Faixa G — Policy Engine

- [x] Task profiles.
- [x] Score determinístico.
- [x] Provider allow/block.
- [x] Vision soft preference.
- [x] Runtime proved preference.
- [x] Consumo opcional de eligibility decisions no scoring.
- [x] Consumir route options diretamente.
- [x] Avaliar eligibility on-demand a partir de projection + overlays quando
  `evaluateEligibility` estiver ativo.
- [x] Emitir explicação completa catalog + overlay + eligibility + probe.

### Faixa H — Terminal

- [x] Cockpit BYOK existente.
- [x] Gateway pre-K gate.
- [x] Catalog refresh.
- [x] Catalog diff.
- [x] Catalog conflicts.
- [x] Endpoint inventory.
- [x] `/byok gateway catalog search`.
- [x] `/byok gateway catalog explain <model>`.
- [x] `/byok gateway overlays`.
- [x] `/byok gateway accounts`.
- [x] `/byok gateway probes backoff`.
- [x] `/byok gateway eligibility`.
- [x] `/byok gateway routes`.
- [x] Export OpenAI schema por comando.

### Faixa I — Observabilidade

- [x] Eventos de route decision.
- [x] Eventos de probes.
- [x] Eventos de catalog refresh.
- [x] Eventos de model added/removed/changed.
- [x] Eventos de conflict.
- [x] Evento `model_gateway:eligibility:evaluated`.
- [x] Métricas de coverage.
- [x] Métricas de provider freshness.
- [x] Métricas agregadas de eligible/unknown/excluded.
- [x] Métricas por exclusion reason.

### Faixa J — Pre-K Gate

- [x] Relatório booleano de compatibilidade.
- [x] Gate no terminal.
- [x] Checklist A-J fechada para camada inicial.
- [x] Atualizar gate para K+ quando SQLite/elegibility existirem.

### Faixa K — Universal Catalog

- [x] Evidence contracts.
- [x] Provider evidence contracts.
- [x] Route options.
- [x] Account overlays.
- [x] Field-wise merge.
- [x] Conflicts.
- [x] OpenAI projection.
- [x] JSON store.
- [x] SQLite store.
- [x] Snapshot ids estáveis.
- [x] Incremental refresh com TTL por source.
- [x] Tombstones.
- [x] Raw payload storage policy.

### Faixa L — Importers

- [x] OpenRouter.
- [x] Kilo models.
- [x] Kilo providers.
- [x] Cerebras public.
- [x] OpenAI.
- [x] Anthropic.
- [x] Gemini.
- [x] Mistral.
- [x] Groq API.
- [x] Groq docs.
- [x] Hugging Face.
- [x] Cloudflare.
- [x] NVIDIA NIM.
- [x] Ollama.
- [x] OpenCode API.
- [x] OpenCode docs.
- [x] Chutes.
- [x] Z.AI.
- [x] Auditoria canônica de importer set, hooks e cobertura de endpoints.
- [x] Default set inclui importers públicos disponíveis sem chave para Hugging
  Face, OpenCode, Chutes e Z.AI.
- [x] OpenAI official docs seed.
- [x] Comando terminal canônico `/byok gateway importers [provider]` para
  auditoria local de hooks, importers configurados e cobertura de endpoints
  sem rede.
- [x] Anthropic docs seed.
- [x] Gemini/Vertex docs seed.
- [x] Mistral docs pricing seed.
- [x] OpenRouter account overlay importer.
- [ ] Kilo account overlay importer.
- [ ] Cloudflare account access importer beyond configured flags.

### Faixa M — Normalização

- [x] Modalities.
- [x] Capabilities catalog hints.
- [x] Token limits.
- [x] USD pricing.
- [x] Lifecycle.
- [x] Aliases.
- [x] Account overlay controls.
- [x] Model identity traits.
- [x] Route policy traits.
- [x] Provider/gateway traits normalizados como camada própria.
- [x] Capability taxonomy runtime-agentic.
- [x] Pricing multi-currency.
- [x] Rate limit taxonomy completa.
- [x] Data policy taxonomy.
- [x] Deprecation/alias resolver robusto.

### Faixa N — Route Options E Seleção Por Metadados

- [x] Route option contract.
- [x] `routeTraits`.
- [x] Gateway/aggregator selectors preservados.
- [x] Hugging Face route policies.
- [x] Cloudflare direct/gateway routes.
- [x] OpenCode family endpoint routes.
- [x] Candidate builder baseado em route options.
- [x] Seleção por provider upstream.
- [x] Seleção por route layer.
- [x] Seleção por data policy.
- [x] Seleção por budget.
- [x] Seleção por confidence.

### Faixa O — Refresh E Governança

- [x] Import runs.
- [x] Diff canonical projections.
- [x] Probe recommendations.
- [x] Store redacted.
- [x] TTL por source.
- [x] Refresh incremental.
- [x] Refresh overlay separado de refresh público.
- [x] Lock de refresh.
- [x] Retention policy.
- [x] No automatic active swap sem policy.

### Faixa P — UX De Catálogo

- [x] Refresh/diff/conflicts no terminal.
- [x] Endpoint inventory.
- [x] Search/filter.
- [x] Explain por modelo.
- [x] Explain por provider.
- [x] Mostrar route options.
- [x] Mostrar overlays.
- [x] Mostrar projection OpenAI.
- [x] Mostrar conflito por campo.
- [x] Mostrar freshness por source.

### Faixa Q — Elegibilidade Pré-Runtime

- [x] Criar `eligibility/contracts.js`.
- [x] Criar `createModelEligibilityDecision()`.
- [x] Criar enum de dispositions.
- [x] Criar enum de hard exclusion reasons.
- [x] Criar enum de soft penalty reasons.
- [x] Criar evaluator puro.
- [x] Integrar presença de segredo via interface `has(ref)`.
- [x] Integrar `EnvSecretRegistry` concreto nos consumidores de eligibility.
- [x] Integrar account overlays para enabled/blocked/visibility.
- [x] Integrar route options e route traits.
- [x] Integrar lifecycle retired.
- [x] Integrar provider allow/block.
- [x] Integrar model allow/block.
- [x] Integrar policy de unknown access.
- [x] Integrar budget hard/soft.
- [x] Integrar health fatal por classificação pré-runtime inicial.
- [x] Criar explain helper.
- [x] Criar testes unitários iniciais.
- [x] Criar terminal view inicial.
- [x] Persistir decisões em store JSON como camada derivada.

### Faixa R — SQLite

- [x] Definir schema SQLite.
- [x] Criar migrations.
- [x] Criar `SqliteModelGatewayCatalogStore`.
- [x] Migrar JSON snapshot para SQLite por mirror explícito.
- [x] Manter export JSON para debug.
- [x] Testar redaction.
- [x] Testar idempotência.
- [x] Testar downgrade/unknown schema.
- [x] Criar índices por provider/model/route/account.
- [x] Criar views OpenAI schema.
- [x] Preparar snapshot JSON com `modelEligibilityRuns` e
  `modelEligibilityDecisions`, mantendo a futura migração SQLite separável.

### Faixa S — Account Access

- [x] Account overlays básicos.
- [x] Enabled/blocked models.
- [x] Quota/rate/spending normalizers.
- [x] Resolver de acesso por provider.
- [x] Account overlay refresh separado.
- [x] Access confidence.
- [x] Access expiration.
- [x] Access failure classification.
- [x] Account model visibility explain.
- [x] Separação explícita entre limite estático de catálogo, overlay dinâmico
  account/key e falha volátil de runtime.
- [x] Bloqueio pré-runtime por key desabilitada.
- [x] Bloqueio pré-runtime por rate limit account/key vigente.
- [ ] Multi-account/workspace.
- [ ] Region/organization support.

### Faixa T — Runtime Probe Matrix

- [x] Chat.
- [x] Stream.
- [x] JSON.
- [x] Tools/agent.
- [x] Vision.
- [ ] Reasoning probe separado.
- [ ] Forced tool choice probe.
- [ ] Parallel tool calls probe.
- [ ] Embeddings probe.
- [ ] Audio transcription probe.
- [ ] TTS probe.
- [ ] Rerank probe.
- [ ] Image generation probe.
- [ ] Provider-native probes.
- [ ] Gateway fallback probe.
- [x] Cost-bounded probe planner.
- [x] Matrix provider/wire API de probes como planejamento pré-runtime.

### Faixa U — Runtime Selection

- [x] Score básico.
- [x] Fallback chain básico.
- [x] Health-aware scoring.
- [x] Unificar candidate builder.
- [x] Usar eligibility como barreira opcional no policy engine.
- [x] Usar probes como promoção.
- [x] Usar route options como unidade de seleção.
- [x] Explicar rejeições.
- [x] Persistir decisão final.
- [x] SDK projection final por route option.

### Faixa V — Live Validation

- [ ] Rodar probes live com keys do operador quando autorizado.
- [ ] Rodar live `llm-b` depois de concluir até J/K operacional.
- [ ] Registrar resultados como runtime proof.
- [ ] Não promover modelo sem prova básica quando policy exigir.
- [ ] Não chamar modelos claramente inelegíveis.

### Faixa W — Segurança E Redaction

- [x] Redaction em contratos.
- [x] Redaction em JSON store.
- [x] Secret registry por ref.
- [x] Tests de não vazamento.
- [ ] Auditar redaction em eligibility.
- [ ] Auditar redaction em SQLite.
- [ ] Auditar logs de probes.
- [ ] Auditar raw payload refs.
- [ ] Auditar terminal output.

### Faixa X — Documentação Viva

- [x] Roadmap antigo preservado como histórico.
- [x] Novo guia canônico criado.
- [x] Linkar README do model-gateway para este guia.
- [ ] Criar changelog curto por corte.
- [ ] Atualizar roadmap a cada transformação estrutural.
- [ ] Manter checklist boolean.

### Faixa Y — Comandos Canônicos E Pre-Build

- [x] Inventário canônico como dados em `src/copilot/model-gateway`.
- [x] Helper CLI em `scripts/model-gateway-canonical-commands.mjs`.
- [x] Scripts package `model-gateway:*`.
- [x] Targets Makefile `model-gateway-*`.
- [x] Terminal `/byok gateway commands`.
- [x] Comando canônico JSON para LLMs.
- [x] Sequência `model-gateway:prebuild` antes do primeiro build.
- [x] Testes unitários do inventário.
- [ ] Primeiro build real usando apenas comandos canônicos.
- [ ] Registrar resultado do primeiro build no guia.

---

## 12. Ordem Recomendada De Execução Agora

Próximos cortes devem seguir esta ordem:

1. Criar contratos de elegibilidade pré-runtime.
2. Implementar evaluator puro com catálogo + route options + overlays + secrets.
3. Criar testes de exclusão por secret ausente, account blocked, allow list fechada,
   lifecycle retired, Cloudflare account/gateway ausente, Ollama daemon/modelo local
   ausente e health fatal.
4. Projetar decisões de elegibilidade em terminal.
5. Integrar policy engine para aceitar somente candidatos elegíveis.
6. Começar SQLite com schema que já reserva tabelas para eligibility.
7. Migrar JSON store sem quebrar comandos existentes.
8. Expandir importers de account access onde faltam.
9. Expandir probes runtime por capacidade.
10. Criar UX de explain por modelo.

---

## 13. Critérios De Validação

Validadores obrigatórios do escopo `src/copilot`:

- `npm run lint:copilot`;
- `npm run typecheck:strict:src.copilot`;
- `npm run test:copilot`.

Validações focadas recomendadas:

- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`;
- `git diff --check`;
- busca por checkboxes não booleanos no guia;
- busca por segredos serializados em snapshots de teste;
- smoke de importers públicos quando a rede for necessária e permitida.

---

## 14. Regras De Evolução

- Sempre preservar separação entre metadados, overlay, eligibility e runtime.
- Sempre normalizar para OpenAI schema com extensão rica.
- Sempre adicionar provider em arquivo próprio.
- Sempre exportar via barrels.
- Sempre preservar redaction.
- Sempre testar nova regra de exclusão.
- Nunca tratar vision como exclusão global automática.
- Nunca promover metadata para runtime proof.
- Nunca mutar catálogo canônico por resultado de probe.
- Nunca serializar secret value.
- Nunca misturar conta do operador com docs globais.
- Nunca executar runtime se eligibility hard-excluded.

---

## 15. Definição De Pronto Para A Próxima Grande Etapa

A próxima etapa só estará madura quando:

- [x] existir contrato formal de eligibility;
- [x] eligibility tiver testes suficientes;
- [x] terminal conseguir mostrar decisões;
- [x] policy engine consumir eligibility;
- [x] probes forem recomendados somente para candidatos elegíveis ou
  explicitamente permitidos por policy de exploração;
- [x] SQLite tiver schema planejado para catálogo, overlay, eligibility e probes;
- [x] OpenAI schema continuar compatível;
- [x] todos os validadores passarem.

---

## 16. Resumo Executivo

O projeto já avançou muito além do A-J inicial.

Hoje temos uma base séria de catálogo universal:

- importers amplos;
- evidência com proveniência;
- projeção OpenAI-compatible;
- overlays;
- traits técnicos;
- traits de rota;
- probes básicos;
- terminal de refresh/diff/conflict.

O maior gap arquitetural agora é a camada explícita de elegibilidade
pré-runtime.

Essa camada deve impedir tentativas inúteis, preservar o banco canônico, explicar
decisões e preparar o caminho para seleção runtime realmente robusta.

Depois dela, SQLite deixa de ser apenas persistência melhor: passa a ser o lugar
onde as camadas lógicas ficam consultáveis, auditáveis e combináveis.

Este documento deve ser atualizado antes e depois de cada corte estrutural.

---

## 17. Continuidade 2026-05-25 — Guia Canônico E Eligibility Inicial

Implementado neste corte:

- [x] Criado este guia canônico como sucessor operacional do roadmap anterior.
- [x] Adicionada nota no roadmap antigo apontando para este arquivo.
- [x] Criado módulo `src/copilot/model-gateway/eligibility`.
- [x] Criado contrato `createModelEligibilityDecision()`.
- [x] Criados enums de dispositions, hard exclusions e soft penalties.
- [x] Criado evaluator puro `evaluateModelGatewayEligibility()`.
- [x] Exportado o módulo pelo barrel principal de `model-gateway`.
- [x] Adicionados testes de eligibility no contrato principal.
- [x] Integrado o policy engine para consumir eligibility opcionalmente durante
  o scoring.
- [x] Criado helper `explainModelGatewayEligibilityDecision()` para terminal e
  observability.
- [x] Criada view `/byok gateway eligibility [strict] [filtro] [n]`.

Coberturas novas:

- [x] Decisão sanitizada não vaza segredo em `policyInputs`.
- [x] Secret ausente exclui antes de runtime.
- [x] Allow list fechada de account overlay exclui modelo não visível.
- [x] `unknownAccessPolicy=allow_probe` permite probe barato com penalties.
- [x] `unknownAccessPolicy=block` bloqueia acesso desconhecido.
- [x] Cloudflare AI Gateway exclui quando `accountId` ou `gatewayId` faltam.
- [x] Ollama local usa instalação local como input de elegibilidade, sem provar
  runtime.
- [x] Candidato inelegível é mantido em `rejected` com motivo
  `eligibility:<reason>`.
- [x] Explicação estruturada traz `summary`, `primaryReason` e `nextActions`.
- [x] Terminal mostra contagem `eligible/unknown/excluded`, policy usada e ações
  recomendadas sem expor segredos.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `77` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS `npm run lint:copilot`.
- [x] PASS `npm run test:copilot` com `5656` testes totais, `5623` passed,
  `33` pending, `0` failed e `0` warnings/errors.

Próxima direção:

- [x] Integrar `evaluateModelGatewayEligibility()` ao policy engine como barreira
  opcional, preservando rejeições `eligibility:<reason>`.
- [x] Criar explain helper para terminal e observability.
- [x] Persistir eligibility decisions no snapshot JSON atual.
- [x] Planejar SQLite já incluindo catálogo, overlays, eligibility, probes e
  route decisions como camadas lógicas separadas.

---

## 18. Continuidade 2026-05-25 — Eligibility Persistida E Observável

Implementado neste corte:

- [x] Adicionados `modelEligibilityRuns` e `modelEligibilityDecisions` ao snapshot
  JSON redacted.
- [x] Criado `createModelEligibilityRun()`.
- [x] Criado batch evaluator `evaluateModelGatewayCatalogEligibility()`.
- [x] Criado `applyModelGatewayEligibilityToSnapshot()` para materializar a
  camada derivada sem alterar catálogo canônico.
- [x] Terminal `/byok gateway eligibility refresh|persist|write|sync` passa a
  persistir decisões no snapshot.
- [x] Terminal emite evento de eligibility quando avalia a camada.
- [x] Criado evento `model_gateway:eligibility:evaluated`.
- [x] Criadas métricas `model_gateway.eligibility.*`.

Separação preservada:

- [x] Catálogo continua sendo fonte de metadados.
- [x] Overlays continuam sendo fatos de conta.
- [x] Eligibility é materializada como camada derivada.
- [x] Nenhum runtime probe é executado pela eligibility.

Próxima direção:

- [x] Expor `modelEligibilityDecisions` no OpenAI `x_model_gateway` somente como
  summary opcional, sem poluir o schema base.
- [ ] Criar explain por modelo combinando projection, route options, overlays,
  eligibility e probes.
- [x] Projetar o schema SQLite com tabelas separadas para a camada derivada.

---

## 19. Continuidade 2026-05-25 — SQLite Reservado Para Catálogo Universal

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/sqlite-schema.js`.
- [x] Exportado o schema via barrels de `catalog` e `model-gateway`.
- [x] Adicionada migration `create_model_gateway_catalog` em
  `src/copilot/db/migrations.js`.
- [x] Reservadas tabelas para catalog sources, evidências de modelo, evidências
  de provider, projeções de modelo, projeções de provider, route options,
  overlays de conta, import runs, raw payload refs e conflitos.
- [x] Reservadas tabelas separadas para runs e decisões de eligibility
  pré-runtime.
- [x] Reservadas tabelas separadas para runs/resultados de probes runtime,
  observações de health e decisões finais de rota.
- [x] Criados índices iniciais por provider/model/route/account/policy/profile.
- [x] Adicionados testes que executam o schema em SQLite in-memory.
- [x] Adicionado store `SqliteModelGatewayCatalogStore` com round-trip redacted
  e idempotente do snapshot atual.
- [x] Criada ponte `mirrorModelGatewayCatalogSnapshotToSqlite()` para materializar
  o snapshot JSON atual no SQLite sem apagar o JSON.
- [x] Exposto `/byok gateway catalog sqlite` como comando sem rede para executar
  o mirror e mostrar contagens.
- [x] Criada view OpenAI schema a partir do SQLite via
  `SqliteModelGatewayCatalogStore.readOpenAIModelCatalogList()`.
- [x] Exposto `/byok gateway catalog openai [sqlite]` para inspecionar a lista
  OpenAI-compatible com extensão `x_model_gateway`.
- [x] Criado `explainModelGatewayCatalogEntry()` para unir projection, route
  options, account overlays, eligibility e OpenAI projection sem runtime.
- [x] Exposto `/byok gateway catalog explain <model>` como inspeção terminal
  sem rede.
- [x] Criado `searchModelGatewayCatalogEntries()` para busca/ranking de
  metadados antes do runtime.
- [x] Exposto `/byok gateway catalog search <query> [provider:<id>] [eligible]
  [tools] [streaming] [reasoning] [n]`.
- [x] Adicionados testes de migrations gerais criando as tabelas do
  model-gateway.

Separação arquitetural reafirmada:

- [x] Metadados globais entram como evidências e projeções canônicas.
- [x] Account overlays continuam como fatos de conta, não como runtime proof.
- [x] Eligibility continua como camada derivada pré-runtime.
- [x] Probes runtime ficam em tabelas próprias e não mutam o catálogo canônico.
- [x] Decisão final de rota fica separada de metadados e de probes.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `86` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS `npm run lint:copilot`.
- [x] PASS `git diff --check`.

- [x] PASS `npm run test:copilot` com `5663` testes totais, `5630` passed,
  `33` pending, `0` failed e `0` warnings/errors.

Próxima direção:

- [x] Criar `SqliteModelGatewayCatalogStore` lendo/escrevendo esse schema sem
  remover o JSON store de debug.
- [x] Criar migração de snapshot JSON para SQLite com redaction preservada.
- [x] Criar views/projeções OpenAI schema sobre o store SQLite.
- [x] Criar explain por modelo combinando projection, route options, overlays e
  eligibility.
- [x] Expandir explain por modelo com health e probe results persistidos.
- [x] Criar mirror SQLite dos fatos runtime de BYOK health/probes sem mutar o
  catálogo canônico.
- [x] Expor `/byok gateway health sqlite` para materializar health/probes
  operacionais no SQLite.
- [x] Expor `/byok gateway routes [filtro] [n]` para inspecionar route options
  sem runtime.
- [x] Expor `/byok gateway overlays [filtro] [n]` para inspecionar account
  overlays sem vazar segredos.
- [x] Criar `explainModelGatewayProviderEntry()` para unir sources, provider
  evidences, projections, routes, overlays, conflicts e freshness por provider.
- [x] Expor `/byok gateway provider explain <provider>`.
- [x] Expor `/byok gateway catalog freshness [filtro] [n]`.

---

## 20. Continuidade 2026-05-25 — Budget Hard/Soft Na Eligibility

Implementado neste corte:

- [x] Adicionados motivos formais `budget_exceeded` e `price_unknown` como hard
  exclusions possíveis.
- [x] Adicionado motivo formal `price_above_preference` como soft penalty.
- [x] `evaluateModelGatewayEligibility()` passa a ler preços normalizados de
  catálogo sem executar provider.
- [x] Budget hard suporta `maxInputUsdPerMillion`,
  `maxOutputUsdPerMillion`, `maxCacheReadUsdPerMillion`,
  `maxCacheWriteUsdPerMillion`, `maxRequestUsd` e
  `maxWebSearchUsdPerRequest`.
- [x] Budget soft suporta os pares `preferred*` equivalentes para ranking e
  explicação, sem excluir candidatos por si só.
- [x] `requireKnownPricing=true` pode transformar preço ausente em hard
  exclusion quando a policy exige preço conhecido antes de qualquer runtime.
- [x] `policyInputs.budget` registra limites/preferências observáveis e
  `observedPricing`, preservando redaction.
- [x] `explainModelGatewayEligibilityDecision()` agora orienta:
  `choose_lower_cost_model_or_raise_budget`,
  `refresh_pricing_or_relax_known_price_policy` e
  `prefer_lower_cost_model_when_possible`.

Separação preservada:

- [x] A decisão usa apenas metadados normalizados de preço.
- [x] Nenhum probe runtime é executado para calcular custo.
- [x] O catálogo canônico não recebe flags de exclusão account-scoped.
- [x] Budget é policy/account scoped dentro de eligibility derivada.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `88` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS `npm run lint:copilot`.
- [x] PASS `git diff --check`.
- [x] PASS `npm run test:copilot` com `5665` testes totais, `5632` passed,
  `33` pending, `0` failed e `0` warnings/errors.

Próxima direção:

- [x] Integrar `EnvSecretRegistry` concreto nos consumidores de eligibility.
- [ ] Persistir policy profiles de budget reutilizáveis para seleção terminal.
- [ ] Fazer selection/ranking final consumir penalties de budget de forma
  transparente ao lado de health/probes.

---

## 21. Continuidade 2026-05-25 — EnvSecretRegistry No Roteamento Terminal

Implementado neste corte:

- [x] `/byok route` passa a carregar o snapshot JSON do model-gateway para
  recuperar `routeOptions` e `accountOverlays` antes da seleção.
- [x] `/byok route` passa a avaliar eligibility on-demand durante
  `routeGatewayModels()`.
- [x] O consumidor terminal passa `createEnvSecretRegistry()` concreto para que
  `secretRef` ausente bloqueie antes do runtime.
- [x] O modo padrão preserva máxima exploração com
  `unknownAccessPolicy=allow_probe`.
- [x] O modo strict/verified usa `unknownAccessPolicy=block` para inspeções
  conservadoras.
- [x] Adicionado teste com `createEnvSecretRegistry({ env })` provando que
  `OPENAI_API_KEY` ausente gera `eligibility:secret_missing:*` e que a chave
  presente libera a admissão.

Separação preservada:

- [x] O policy engine continua recebendo a registry por injeção.
- [x] A camada de routing não lê segredos diretamente.
- [x] O terminal injeta ambiente real apenas no ponto de composição.
- [x] Eligibility segue pré-runtime e não executa provider.

Validação parcial deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `89` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS `npm run lint:copilot`.
- [x] PASS `git diff --check`.

---

## 22. Continuidade 2026-05-25 — Guarda De Schema SQLite

Implementado neste corte:

- [x] `SqliteModelGatewayCatalogStore` lê `PRAGMA user_version` antes de aplicar
  o schema.
- [x] Banco novo ou antigo conhecido recebe `MODEL_GATEWAY_SQLITE_SCHEMA_VERSION`
  após criação/atualização idempotente.
- [x] Banco com `user_version` maior que o suportado é rejeitado com erro
  acionável antes de qualquer escrita.
- [x] Adicionado teste de store novo com `user_version=0`.
- [x] Adicionado teste de schema futuro desconhecido para impedir downgrade
  acidental.

Separação preservada:

- [x] A proteção fica no store SQLite, não no JSON store.
- [x] A migração explícita JSON->SQLite continua intacta.
- [x] O schema normalizado continua separado de runtime health/probes e route
  decisions.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `90` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS `npm run lint:copilot`.
- [x] PASS `git diff --check`.

---

## 23. Continuidade 2026-05-25 — Resolver Account Access

Implementado neste corte:

- [x] Criado módulo `src/copilot/model-gateway/account-access`.
- [x] Criado `resolveModelGatewayAccountAccess()` para unir provider/model,
  account overlays, allow/blocked lists e secret registry sem runtime.
- [x] Criado enum `MODEL_GATEWAY_ACCOUNT_ACCESS_STATUS`.
- [x] Exportado o módulo pelo barrel principal `model-gateway`.
- [x] `evaluateModelGatewayEligibility()` passa a compor o resolver em vez de
  duplicar a interpretação de overlays e secrets.
- [x] `policyInputs.accountAccess` passa a registrar `status`, `canAttempt`,
  `secretConfigured` e `modelVisible` sem vazar valores.
- [x] Adicionados testes de acesso visível, secret ausente e modelo bloqueado.

Separação preservada:

- [x] Account access é derivado de overlay e segredo presente/ausente.
- [x] O resolver não executa provider e não altera catálogo canônico.
- [x] Eligibility continua responsável por lifecycle, budget, health e policy
  global.
- [x] O terminal segue injetando o registry concreto apenas na composição.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `91` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS `npm run lint:copilot`.
- [x] PASS `git diff --check`.

---

## 24. Continuidade 2026-05-25 — Expiração E Controles De Conta

Implementado neste corte:

- [x] `resolveModelGatewayAccountAccess()` classifica overlays expirados.
- [x] Overlay expirado deixa de provar visibilidade por padrão e vira
  `account_overlay_expired` soft, preservando `allow_probe` quando a policy
  permite explorar unknowns.
- [x] `requireFreshAccountOverlay=true` pode transformar overlay expirado em hard
  exclusion.
- [x] `allowExpiredAccountOverlay=true` permite políticas que aceitam overlays
  expirados como evidência fraca.
- [x] `quota.dailyRequests=0`, `quota.dailyTokens=0` ou
  `quota.remainingCreditsUsd=0` geram `account_quota_exhausted`.
- [x] `spendingLimits.remainingUsd=0` gera `account_spending_exhausted`.
- [x] Eligibility propaga o status de account access em `policyInputs`.
- [x] Explain sugere refresh de overlay, troca de conta/modelo ou ajuste de
  spending conforme o bloqueio.

Separação preservada:

- [x] Expiração e quota são fatos de conta, não metadados globais do modelo.
- [x] A decisão continua pré-runtime e não chama provider.
- [x] Overlay expirado não apaga o catálogo e não vira prova runtime negativa.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `92` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS `npm run lint:copilot`.
- [x] PASS `git diff --check`.

---

## 25. Continuidade 2026-05-26 — Candidate Builder Por Route Option

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/routing/candidate-builder.js`.
- [x] Criado `buildModelGatewayRouteCandidates()` para transformar projections
  e route options em candidatos de seleção sem runtime.
- [x] Uma projection com múltiplas route options gera múltiplos candidatos
  distintos, cada um com `selectorKind`, `selectorSyntax`, `routeOptionRef`,
  `normalizedPolicy`, `routeTraits`, `routing.routeLayer` e `routing.wireApi`.
- [x] Projection sem route option ainda pode entrar como fallback
  `candidateSource=projection`.
- [x] Exportado pelo barrel `routing` e pelo barrel principal
  `model-gateway`.
- [x] Adicionado teste de Cloudflare direct/gateway para garantir route option
  como unidade pré-runtime.

Separação preservada:

- [x] O builder usa só metadados normalizados.
- [x] O builder não executa provider e não lê segredos.
- [x] Runtime probes continuam fase posterior.
- [x] Eligibility continua recebendo route option/candidato como contexto, sem
  mutar catálogo.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `93` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `candidate-builder.js`, barrels e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 26. Continuidade 2026-05-26 — Route Options Na Seleção Terminal

Implementado neste corte:

- [x] `/byok route` mantém a descoberta atual de modelos e filtros do operador.
- [x] Quando existe snapshot do model-gateway, os candidatos do terminal são
  enriquecidos por `buildModelGatewayRouteCandidates()`.
- [x] Um mesmo provider/model pode gerar candidatos separados por
  `selectorKind`, `selectorSyntax`, `routeOptionRef`, `routeLayer` e `wireApi`.
- [x] Candidatos sem route option correspondente continuam disponíveis como
  fallback de projection/runtime catalog.
- [x] Eligibility continua recebendo `routeOptions` e `accountOverlays` do
  snapshot, agora com candidatos já anotados com a route option selecionável.

Separação preservada:

- [x] O terminal só compõe metadados e filtros; não executa provider.
- [x] Route option vira unidade de admissão e ranking antes do runtime.
- [x] Runtime proof continua vindo depois, por probes/health.
- [x] O SDK projection final ainda é etapa posterior.

Validação deste corte:

- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `src/copilot/terminal/commands/byok.js` e
  `src/copilot/model-gateway/routing/candidate-builder.js`.
- [x] PASS `git diff --check`.

---

## 27. Continuidade 2026-05-26 — Probe Recommendations Com Eligibility

Implementado neste corte:

- [x] `recommendCatalogDiffProbes()` passa a aceitar `eligibilityDecisions`.
- [x] `requireEligibilityDecision=true` impede recomendar probe para modelos sem
  decisão pré-runtime conhecida.
- [x] Modelos com eligibility `excluded` deixam de receber comandos de probe.
- [x] Modelos `eligible` seguem recomendáveis.
- [x] Modelos `unknown_policy_allows_probe` seguem recomendáveis como exploração
  explicitamente permitida.
- [x] Recomendações podem expor `eligibilityStatus` para UX/observability sem
  poluir o catálogo canônico.

Separação preservada:

- [x] O recomendador continua não executando probes.
- [x] Eligibility é só barreira pré-runtime; runtime proof vem depois.
- [x] Catálogo canônico não recebe status account-scoped.
- [x] O modo legado sem decisions continua funcionando para diffs simples.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `94` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `recommendations.js` e contrato unitário.
- [x] PASS `git diff --check`.

---

## 28. Continuidade 2026-05-26 — Terminal Probe Suggestions Com Eligibility

Implementado neste corte:

- [x] `/byok gateway catalog refresh` passa eligibility decisions persistidas ao
  recomendador de probes quando elas existem no snapshot.
- [x] `/byok gateway catalog diff` passa eligibility decisions persistidas ao
  recomendador de probes quando elas existem no snapshot.
- [x] Quando há decisões de eligibility, recomendações exigem uma decisão
  conhecida e pulam modelos hard-excluded.
- [x] Quando não há decisões de eligibility no snapshot, o modo legado continua
  recomendando probes a partir de diffs de catálogo.

Separação preservada:

- [x] O terminal apenas filtra sugestões; não executa probes.
- [x] Eligibility continua pré-runtime.
- [x] Runtime proof continua posterior.

Validação deste corte:

- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `byok.js` e `recommendations.js`.
- [x] PASS `git diff --check`.

---

## 29. Continuidade 2026-05-26 — Explain De Account Access

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/account-access/explain.js`.
- [x] Criado `explainModelGatewayAccountAccess()` com `summary`,
  `primaryReason`, `hardReasons`, `softReasons`, `overlayRefs` e
  `nextActions` estáveis.
- [x] Exportado pelo barrel `account-access` e pelo barrel principal
  `model-gateway`.
- [x] Adicionado teste de modelo não visível em allow list fechada de overlay.

Separação preservada:

- [x] O explain só formata fatos derivados pelo resolver.
- [x] O explain não executa provider e não lê segredos.
- [x] Eligibility pode continuar compondo account access sem duplicar UX.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `95` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `account-access`, barrel principal e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 30. Continuidade 2026-05-26 — Seleção Por Route Layer E Wire API

Implementado neste corte:

- [x] `scoreGatewayModelCandidate()` entende `preferredRouteLayers` e
  `blockRouteLayers`.
- [x] `scoreGatewayModelCandidate()` entende `preferredWireApis` e
  `blockWireApis`.
- [x] `scoreGatewayModelCandidate()` entende `preferredSelectorKinds` e
  `blockSelectorKinds`.
- [x] Route layer preferida soma score; route layer bloqueada rejeita candidato.
- [x] Wire API preferida soma score; wire API bloqueada rejeita candidato.
- [x] Selector kind preferido soma score; selector kind bloqueado rejeita
  candidato.
- [x] Adicionado teste com Cloudflare direct vs gateway para garantir seleção por
  metadados antes do runtime.

Separação preservada:

- [x] A seleção usa somente route metadata normalizado.
- [x] Nenhuma probe é executada.
- [x] O runtime proof continua posterior e separado.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `96` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `policy-engine.js` e contrato unitário.
- [x] PASS `git diff --check`.

---

## 31. Continuidade 2026-05-26 — Seleção Por Budget E Confidence

Implementado neste corte:

- [x] `scoreGatewayModelCandidate()` aceita `maxPricePerMillion` como limite de
  admissão por metadados.
- [x] `scoreGatewayModelCandidate()` aceita `preferredMaxPricePerMillion` como
  preferência positiva de ranking.
- [x] `scoreGatewayModelCandidate()` aceita `minimumConfidence` para excluir
  candidatos com evidência abaixo do perfil exigido.
- [x] Preço acima do limite gera `price_above_limit:*` antes do runtime.
- [x] Confidence abaixo do mínimo gera `confidence_below_minimum:*` antes do
  runtime.
- [x] Preço dentro da preferência soma score com razão auditável.
- [x] Adicionado teste de seleção entre cheap/catalog, expensive/manual e
  static_seed.

Separação preservada:

- [x] Budget de seleção usa metadados de catálogo.
- [x] Budget hard/soft account-scoped continua na eligibility.
- [x] Confidence é evidência de catálogo/probe já persistida, não chamada live.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `97` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `policy-engine.js` e contrato unitário.
- [x] PASS `git diff --check`.

---

## 32. Continuidade 2026-05-26 — Persistência SQLite De Route Decisions

Implementado neste corte:

- [x] `SqliteModelGatewayCatalogStore.writeRouteDecisionEvents()` persiste
  eventos finais de rota na tabela `copilot_model_gateway_route_decisions`.
- [x] `SqliteModelGatewayCatalogStore.readRouteDecisionEvents()` lê as decisões
  mais recentes em ordem decrescente.
- [x] A escrita é idempotente por `decisionId`.
- [x] `/byok route` continua emitindo evento e ledger em memória, mas também
  tenta materializar a decisão no SQLite.
- [x] Falha no SQLite não impede a rota, preservando UX terminal.
- [x] Adicionado teste de persistência, leitura e idempotência da camada de route
  decisions.

Separação preservada:

- [x] Route decisions ficam em tabela própria.
- [x] Snapshot/catálogo não é mutado por decisão final.
- [x] Runtime health/probes continuam em tabelas próprias.
- [x] Payload persistido é evento sanitizado, sem prompt ou segredo.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `98` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `sqlite-catalog-store.js`, `byok.js` e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 33. Continuidade 2026-05-26 — Explain De Route Rejections

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/routing/explain.js`.
- [x] Criado `explainGatewayRouteDecision()` com resumo estável de decisão,
  contagem de rejeições, top reasons, fallback chain e next actions.
- [x] Exportado pelo barrel `routing` e pelo barrel principal `model-gateway`.
- [x] Adicionado teste de rejeições por capability, contexto, budget e
  confidence.

Separação preservada:

- [x] O explain só formata resultado do policy engine.
- [x] Nenhum provider é chamado.
- [x] Runtime proof e catálogo canônico permanecem separados.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `99` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `routing/explain.js`, barrels e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 34. Continuidade 2026-05-26 — Runtime Probes Como Promoção De Rota

Implementado neste corte:

- [x] `health-routing.js` passou a expor leitura normalizada de probes por kind.
- [x] Adicionados predicados `isGatewayModelProbeVerified()` e
  `isGatewayModelProbeFailed()`.
- [x] Adicionado inventário `listGatewayModelVerifiedProbeKinds()` para o
  policy engine consumir provas runtime sem executar provider.
- [x] `scoreGatewayModelCandidate()` promove candidatos com probes verificados.
- [x] Perfis de tarefa inferem probes preferidos a partir de `requires`,
  `softRequires` e `prefers`.
- [x] O policy engine aceita `preferredProbeKinds`, `requiredProbeKinds`,
  `blockFailedProbeKinds` e `requireRuntimeProof`.
- [x] Adicionados testes para promoção por probe `json` e para exclusão por
  probe obrigatório ausente.

Separação preservada:

- [x] Probes continuam armazenados em health/runtime proof.
- [x] Catálogo canônico não tem `verification.confidence` mutado pela seleção.
- [x] Política de rota só lê fatos já registrados, sem chamar runtime.
- [x] Probes obrigatórios são uma política explícita, não o default global.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `101` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `health-routing.js`, `policy-engine.js`,
  barrels e contrato unitário.
- [x] PASS `git diff --check`.

---

## 35. Continuidade 2026-05-26 — SDK Projection Final Por Route Option

Implementado neste corte:

- [x] `toCopilotModelInfo()` passou a usar `selectorSyntax` como `id` SDK
  quando a entrada for route candidate.
- [x] `byok.gatewayId` permanece o identificador canônico do modelo.
- [x] `byok.routeCandidateId` identifica a rota selecionável específica.
- [x] `byok` agora preserva `sdkModelId`, `routeProfile`, `routeOptionRef`,
  `routeOptionRefs`, `selectorKind`, `selectorSyntax`, `routeLayer`, `wireApi`,
  `autoSelection` e `supportsFallback`.
- [x] `toCopilotRouteModelInfoList()` projeta `projections + routeOptions` via
  `buildModelGatewayRouteCandidates()`.
- [x] `buildModelGatewayOnListModelsHandler()` usa route options quando
  disponíveis e conserva projection-only fallback.
- [x] `buildModelGatewayRouteCandidates()` separa `canonicalModelId` de
  `routeCandidateId`.
- [x] Adicionado teste para selector `fastest` do Hugging Face e preservação de
  metadados de rota na projeção SDK.

Separação preservada:

- [x] SDK recebe o `selectorSyntax` necessário para provider/gateway.
- [x] Catálogo canônico continua identificado por `gatewayId`.
- [x] Route option é transportada como metadata BYOK, não como mutação do modelo.
- [x] Projection-only mantém compatibilidade com o handler anterior.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `102` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `session`, `candidate-builder.js`, barrel
  principal e contrato unitário.
- [x] PASS `git diff --check`.

---

## 36. Continuidade 2026-05-26 — Account Access Confidence E Failure Class

Implementado neste corte:

- [x] `resolveModelGatewayAccountAccess()` agora retorna `accessConfidence`.
- [x] `resolveModelGatewayAccountAccess()` agora retorna `failureClass`.
- [x] Criados contratos exportados
  `MODEL_GATEWAY_ACCOUNT_ACCESS_CONFIDENCE` e
  `MODEL_GATEWAY_ACCOUNT_ACCESS_FAILURE_CLASS`.
- [x] `explainModelGatewayAccountAccess()` inclui confiança e classe de falha.
- [x] `evaluateModelGatewayEligibility()` propaga `accessConfidence` e
  `failureClass` em `policyInputs.accountAccess`.
- [x] Testes cobrem `visible`, `missing_secret`, `blocked`, `not_visible`,
  overlay expirado e decisão de eligibility com segredo ausente.

Separação preservada:

- [x] A classificação é pré-runtime e baseada em overlay/secret/policy.
- [x] Nenhuma chamada de provider é feita.
- [x] A decisão não altera catálogo canônico nem runtime health.
- [x] Falhas de acesso agora podem orientar exclusão antes dos probes.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `102` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `account-access`, `eligibility/evaluator.js`,
  barrel principal e contrato unitário.
- [x] PASS `git diff --check`.

---

## 37. Continuidade 2026-05-26 — Seleção Por Upstream Provider E Data Policy

Implementado neste corte:

- [x] `buildModelGatewayRouteCandidates()` preserva `routeProviderSpecific`.
- [x] Route candidates passam a expor `routing.upstreamProvider`.
- [x] `scoreGatewayModelCandidate()` aceita `allowUpstreamProviders`,
  `blockUpstreamProviders` e `preferredUpstreamProviders`.
- [x] Rejeições de upstream geram razões auditáveis
  `upstream_provider_not_allowed:*` e `upstream_provider_blocked:*`.
- [x] Preferências de upstream somam score com
  `preferred_upstream_provider:*`.
- [x] `scoreGatewayModelCandidate()` aceita `requiredDataPolicy` e
  `preferredDataPolicy`.
- [x] Data policy é lida de `model.dataPolicy`, `routeProviderSpecific` e
  `normalizedPolicy.dataPolicy`.
- [x] Rejeições de data policy geram `data_policy_unknown:*` ou
  `data_policy_mismatch:*`.
- [x] `explainGatewayRouteDecision()` sugere ações para upstream/data policy.
- [x] Testes cobrem Hugging Face provider explicit e seleção por
  `training=false`/`retainsPrompts=false`.

Separação preservada:

- [x] Upstream provider é metadado de route option.
- [x] Data policy é metadado pré-runtime.
- [x] Nenhum provider é chamado.
- [x] Runtime probes continuam fase posterior.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `104` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `routing` e contrato unitário.
- [x] PASS `git diff --check`.

---

## 38. Continuidade 2026-05-26 — Cost-Bounded Probe Planner

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/probes/planner.js`.
- [x] Criado `estimateProbeCostUsd()` para estimar custo por kind de probe a
  partir de pricing de catálogo.
- [x] Criado `planCostBoundedCatalogProbes()` para transformar recomendações em
  plano executável limitado por budget, quantidade e kinds permitidos.
- [x] O planner separa `selected` e `skipped` com razões auditáveis.
- [x] Custos desconhecidos são bloqueados por default quando há budget máximo.
- [x] Exportado pelos barrels `probes` e `model-gateway`.
- [x] Adicionado teste com `json` selecionado e `agent` bloqueado por budget.

Separação preservada:

- [x] Planner só consome recomendações e metadados de pricing.
- [x] Nenhuma probe é executada.
- [x] Health/runtime proof não é alterado.
- [x] Catálogo canônico não é mutado.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `105` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `probes/planner.js`, barrels e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 39. Continuidade 2026-05-26 — Auditoria A-X E Consolidação De Metadados

Auditoria executada neste corte:

- [x] Guia canônico lido integralmente de ponta a ponta, linhas 1-2524.
- [x] Faixas A-X revisadas começando pela Faixa A.
- [x] Prioridade reafirmada para consolidação de metadados e pré-runtime.
- [x] Lacunas escolhidas para este corte: endpoint source schema, coverage
  metrics e snapshot ids estáveis.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/providers/endpoints/source-records.js`.
- [x] Criado `listProviderEndpointSourceRecords()` para projetar inventário de
  endpoints em registros estáveis com target, kind, method, locator, auth,
  placeholders, richness tags, route selectors e base URLs.
- [x] Criado `auditProviderEndpointImporterCoverage()` para comparar endpoint
  inventory com importers configurados sem rede e sem runtime.
- [x] Exportado endpoint source schema pelos barrels de `providers` e
  `model-gateway`.
- [x] Criado `src/copilot/model-gateway/catalog/coverage.js`.
- [x] Criado `summarizeModelGatewayMetadataCoverage()` para medir cobertura de
  projections, evidences, provider evidences, route options, overlays e
  eligibility decisions por provider.
- [x] Criado `projectModelGatewayMetadataCoverageMetrics()` com gauges globais e
  por provider.
- [x] Criado `createModelGatewayCatalogSnapshotId()` para ids determinísticos de
  snapshot de catálogo, independentes de `generatedAt`, `source` e ordem de
  arrays.
- [x] `normalizeStoredCatalogSnapshot()` passa a incluir `snapshotId`.
- [x] `JsonModelGatewayCatalogStore.writeSnapshot()` passa a persistir
  `snapshotId`.
- [x] Adicionados testes de endpoint source records, cobertura de importers,
  coverage metrics e snapshot id estável.

Separação preservada:

- [x] Endpoint source records são metadados de coleta, não adapters runtime.
- [x] Coverage é métrica de catálogo/overlay/eligibility, não prova runtime.
- [x] Snapshot id usa conteúdo redacted/normalizado e não inclui segredo.
- [x] Nenhum provider é chamado.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `109` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em endpoint source records, catalog coverage,
  JSON catalog store, barrels e contrato unitário.
- [x] PASS `git diff --check`.

---

## 40. Continuidade 2026-05-26 — Refresh Incremental Por TTL De Source

Auditoria executada neste corte:

- [x] Confirmado que sources já persistiam `refreshPolicy` e `ttlSeconds`.
- [x] Confirmado que importers já declaram TTL em seus metadados.
- [x] Confirmado que `refreshModelGatewayCatalog()` ainda executava todos os
  importers sem etapa prévia de seleção.
- [x] Confirmado que a lacuna pertence à Faixa O, sem relação direta com
  probes/runtime.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/refresh-plan.js`.
- [x] Criado `planModelGatewayCatalogRefresh()` como planner puro,
  storage-neutral e pre-runtime.
- [x] O planner classifica importers em `selected` e `skipped`.
- [x] Sources frescas por TTL recebem razão auditável `source_ttl_fresh`.
- [x] Sources expiradas recebem razão auditável `source_ttl_expired`.
- [x] Sources sem registro anterior recebem razão auditável `source_missing`.
- [x] Refresh forçado recebe razão auditável `forced_refresh`.
- [x] Filtro explícito por `sourceIds` recebe razão auditável
  `source_not_requested`.
- [x] `refreshModelGatewayCatalog({ incremental: true })` passa a executar
  apenas os importers selecionados pelo planner.
- [x] Refresh não incremental mantém o comportamento anterior e executa todos
  os importers recebidos.
- [x] O resultado do refresh incremental expõe `refreshPlan` para auditoria,
  observabilidade e UX de terminal.
- [x] Exportado pelos barrels de `catalog` e `model-gateway`.
- [x] Adicionados testes de planejamento TTL e refresh incremental preservando
  evidência fresca.

Separação preservada:

- [x] O planner não faz fetch.
- [x] O planner não executa modelos.
- [x] O planner não altera catálogo canônico.
- [x] TTL governa somente coleta de metadados por source.
- [x] Provas de runtime continuam fase posterior e separada.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `111` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em refresh planner, refresh, barrels e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 41. Continuidade 2026-05-26 — Refresh Separado De Account Overlays

Auditoria executada neste corte:

- [x] Confirmado que `runCatalogImporters()` já coleta `accountOverlays`.
- [x] Confirmado que `refreshModelGatewayCatalog()` ainda não incorporava
  `accountOverlays` importados.
- [x] Confirmado o risco arquitetural: refresh público e refresh account-scoped
  ficavam indistintos na API programática.
- [x] Confirmado que a correção pertence à Faixa O e à camada pré-runtime.

Implementado neste corte:

- [x] `refreshModelGatewayCatalog()` passa a expor `refreshAccountOverlays`.
- [x] O default preserva overlays anteriores e ignora overlays importados pelo
  refresh público.
- [x] Quando `refreshAccountOverlays: true`, overlays dos sources atualizados
  são substituídos pelos overlays importados.
- [x] O resultado passa a expor `overlayRefresh` com `enabled`, `imported`,
  `retained` e `total`.
- [x] Adicionado teste garantindo que refresh público preserva overlay antigo.
- [x] Adicionado teste garantindo que refresh account-scoped substitui overlay
  do source atualizado.

Separação preservada:

- [x] Refresh público de catálogo não altera visibilidade/account overlay.
- [x] Refresh de overlay exige opt-in explícito.
- [x] A decisão continua antes de probes/runtime.
- [x] Nenhuma chave ou segredo é exposto no relatório.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `112` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em `catalog/refresh.js` e contrato unitário.
- [x] PASS `git diff --check`.

---

## 42. Continuidade 2026-05-26 — Retention Policy De Histórico Operacional

Auditoria executada neste corte:

- [x] Confirmado que `importRuns`, `rawPayloadRefs`, `conflicts` e
  `modelEligibilityRuns` crescem como histórico operacional.
- [x] Confirmado que projections, evidences, routes, overlays e decisions
  canônicas não devem ser podados por uma policy genérica de histórico.
- [x] Confirmado que retention pertence à governança de catálogo, antes de
  qualquer etapa runtime.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/retention.js`.
- [x] Criado `applyModelGatewayCatalogRetention()`.
- [x] Policy aceita `maxImportRuns`, `maxRawPayloadRefs`, `maxConflicts` e
  `maxModelEligibilityRuns`.
- [x] Retention preserva os registros mais recentes por `completedAt`,
  `startedAt`, `observedAt`, `createdAt` ou `timestamp`.
- [x] Retention retorna summary com `before`, `after` e `pruned`.
- [x] `refreshModelGatewayCatalog()` passa a aceitar `retentionPolicy`.
- [x] O resultado do refresh passa a expor `retention`.
- [x] Exportado pelos barrels de `catalog` e `model-gateway`.
- [x] Adicionados testes cobrindo pruning direto e integração com refresh.

Separação preservada:

- [x] Retention não remove catálogo canônico.
- [x] Retention não remove evidências canônicas.
- [x] Retention não remove route options.
- [x] Retention não remove account overlays.
- [x] Retention não executa provider/model/runtime.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `113` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em refresh, retention, barrels e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 43. Continuidade 2026-05-26 — Active Swap Explícito Por Write Policy

Auditoria executada neste corte:

- [x] Confirmado que `refreshModelGatewayCatalog({ store })` gravava o
  snapshot ativo automaticamente.
- [x] Confirmado que o terminal `/byok gateway catalog refresh` é o principal
  consumidor que deve optar por persistência ativa.
- [x] Confirmado que previews de refresh são necessários para diff,
  observabilidade e seleção pré-runtime sem mutar o store.

Implementado neste corte:

- [x] `refreshModelGatewayCatalog()` passa a aceitar `writePolicy`.
- [x] O modo default passa a ser `preview`.
- [x] Escrita no store só ocorre com `writePolicy: "commit"`.
- [x] O resultado passa a expor `writePolicy.mode`,
  `writePolicy.storeAvailable` e `writePolicy.committed`.
- [x] O terminal BYOK passa `writePolicy: "commit"` explicitamente.
- [x] O terminal BYOK também torna explícitos `incremental: true`,
  `refreshAccountOverlays: true` e `retentionPolicy`.
- [x] A UX do terminal mostra write mode, commit, overlays e runs retidos.
- [x] Adicionado teste garantindo que preview não escreve no store ativo.
- [x] Atualizado teste do terminal para exigir a policy explícita.

Separação preservada:

- [x] Preview de refresh calcula snapshot/diff sem mutar arquivo ativo.
- [x] Commit de refresh exige opção explícita.
- [x] O terminal continua podendo atualizar o catálogo ativo, mas agora com
  intenção declarada.
- [x] Nenhuma etapa runtime/probe é executada.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `114` testes.
- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  com `54` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em refresh, retention, terminal BYOK, barrels e
  contratos unitários.
- [x] PASS `git diff --check`.

---

## 44. Continuidade 2026-05-26 — Lock Process-Local De Refresh

Auditoria executada neste corte:

- [x] Confirmado que restava apenas `Lock de refresh` aberto na Faixa O.
- [x] Confirmado que o primeiro nível necessário é impedir overlap dentro do
  processo terminal/Node atual.
- [x] Confirmado que lock durável cross-process pode evoluir depois sob o
  mesmo contrato, sem mudar o pipeline de metadados.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/refresh-lock.js`.
- [x] Criado `ModelGatewayCatalogRefreshLockError`.
- [x] Criado `withModelGatewayCatalogRefreshLock()`.
- [x] Criado `isModelGatewayCatalogRefreshLocked()`.
- [x] Criado `resolveModelGatewayCatalogRefreshLockKey()` para derivar chave
  de store por `filePath` ou `databasePath`.
- [x] `refreshModelGatewayCatalog()` passa a aceitar `lockKey`.
- [x] `lockKey: false` permite desativar lock explicitamente.
- [x] Se não houver `lockKey` explícito, stores com path usam lock automático
  por path.
- [x] O resultado do refresh passa a expor `refreshLock`.
- [x] O terminal BYOK passa `lockKey: store.filePath`.
- [x] Exportado pelos barrels de `catalog` e `model-gateway`.
- [x] Adicionado teste de concorrência bloqueando refresh simultâneo pela
  mesma chave.
- [x] Atualizado teste do terminal para exigir lockKey explícito.

Separação preservada:

- [x] Lock coordena coleta/escrita de metadados.
- [x] Lock não executa provider/model/runtime.
- [x] Lock não altera elegibilidade ou health.
- [x] Lock não envolve segredo nem payload bruto.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `115` testes.
- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  com `54` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em refresh, refresh lock, terminal BYOK, barrels e
  contratos unitários.
- [x] PASS `git diff --check`.

---

## 45. Continuidade 2026-05-26 — Provider Freshness Metrics

Auditoria executada neste corte:

- [x] Confirmado que a Faixa O ficou completa.
- [x] Confirmado que `Account overlay refresh separado` da Faixa S foi
  resolvido pelo corte de `refreshAccountOverlays`.
- [x] Confirmado que `Métricas de provider freshness` permanecia aberto na
  Faixa I.
- [x] Confirmado que freshness é derivável de `sources` e `ttlSeconds`, sem
  rede e sem runtime.

Implementado neste corte:

- [x] Criado `summarizeModelGatewayProviderFreshness()`.
- [x] Criado `projectModelGatewayProviderFreshnessMetrics()`.
- [x] Freshness agrega source count, TTL known count e expired source count.
- [x] Freshness por provider expõe newest, oldest e average age em segundos.
- [x] Métricas globais usam prefixo `model_gateway.catalog.freshness`.
- [x] Métricas por provider usam prefixo
  `model_gateway.catalog.freshness.provider.<provider>`.
- [x] Exportado pelos barrels de `catalog` e `model-gateway`.
- [x] Adicionado teste unitário de freshness multi-provider.

Separação preservada:

- [x] Freshness usa apenas metadados de source.
- [x] Freshness não altera snapshot.
- [x] Freshness não chama provider.
- [x] Freshness não executa probes/runtime.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `116` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em coverage, barrels e contrato unitário.
- [x] PASS `git diff --check`.

---

## 46. Continuidade 2026-05-26 — Métricas Por Exclusion Reason

Auditoria executada neste corte:

- [x] Confirmado que a Faixa I ainda tinha `Métricas por exclusion reason`
  aberto.
- [x] Confirmado que decisões de eligibility já carregam `hardExclusions`,
  `softPenalties` e `disposition`.
- [x] Confirmado que o evento `model_gateway:eligibility:evaluated` ainda
  expunha apenas totais agregados.

Implementado neste corte:

- [x] `buildEligibilityEvaluatedEvent()` passa a aceitar `decisions`.
- [x] O evento passa a carregar `hardReasonCounts`.
- [x] O evento passa a carregar `softReasonCounts`.
- [x] O evento passa a carregar `dispositionCounts`.
- [x] `projectEligibilityEvaluatedMetrics()` passa a emitir gauges por
  `model_gateway.eligibility.exclusion_reason.hard.<reason>`.
- [x] `projectEligibilityEvaluatedMetrics()` passa a emitir gauges por
  `model_gateway.eligibility.exclusion_reason.soft.<reason>`.
- [x] `projectEligibilityEvaluatedMetrics()` passa a emitir gauges por
  `model_gateway.eligibility.disposition.<disposition>`.
- [x] Terminal BYOK passa as decisões para o evento de eligibility.
- [x] Teste unitário cobre hard reasons, soft reasons e disposition.

Separação preservada:

- [x] Métricas são derivadas de eligibility pré-runtime.
- [x] Métricas não chamam provider/model.
- [x] Métricas não alteram snapshot.
- [x] Métricas sanitizam labels para nomes estáveis.

Validação deste corte:

- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
  com `116` testes.
- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js`
  com `54` testes.
- [x] PASS `npm run typecheck:strict:src.copilot`.
- [x] PASS ESLint escopado em observability events, terminal BYOK e contrato
  unitário.
- [x] PASS `git diff --check`.

---

## 47. Continuidade 2026-05-26 — Alinhamento Do Roadmap Pós-Faixa O/I

Auditoria executada neste corte:

- [x] Revarridos os checkboxes abertos após os commits de refresh,
  freshness e exclusion metrics.
- [x] Identificados itens duplicados ou antigos que já estavam implementados
  no código e testados em cortes anteriores.
- [x] Confirmado que `/byok gateway overlays` existe no terminal.
- [x] Confirmado que `/byok gateway routes` existe no terminal.
- [x] Confirmado que `SqliteModelGatewayCatalogStore` existe e é testado.
- [x] Confirmado que refresh incremental por TTL foi implementado e testado.
- [x] Confirmado que coverage metrics por provider foram implementadas.

Atualização de checklist:

- [x] Marcado `UX dedicada de account overlays`.
- [x] Marcado `Métricas de cobertura de metadados por provider`.
- [x] Marcado `Consumir route options diretamente`.
- [x] Marcado `/byok gateway overlays`.
- [x] Marcado `/byok gateway routes`.
- [x] Marcado `SQLite store`.
- [x] Marcado `Incremental refresh com TTL por source`.

Separação preservada:

- [x] Este corte não altera código.
- [x] O guia passa a refletir melhor o estado real.
- [x] Itens ainda abertos permanecem booleanos e acionáveis.

Validação deste corte:

- [x] PASS `git diff --check`.

---

## 48. Continuidade 2026-05-26 — Faixa Y De Comandos Canônicos Pre-Build

Auditoria executada neste corte:

- [x] Revisado `package.json` para identificar scripts existentes de lint,
  typecheck, testes Copilot, terminal llm-b e build.
- [x] Revisado `Makefile` para identificar a superfície humana de operação.
- [x] Revisado terminal BYOK para mapear comandos de catálogo, routes,
  overlays, eligibility e seleção.
- [x] Confirmado que o primeiro build ainda não deve ser promovido antes de
  consolidar a superfície canônica.

Implementado neste corte:

- [x] Criada a Faixa Y — Comandos Canônicos E Pre-Build.
- [x] Criado `src/copilot/model-gateway/commands/canonical-commands.js`.
- [x] Criado barrel `src/copilot/model-gateway/commands/index.js`.
- [x] Exportado inventário pelo barrel principal `model-gateway`.
- [x] Criado helper CLI `scripts/model-gateway-canonical-commands.mjs`.
- [x] Adicionados scripts `model-gateway:commands` e
  `model-gateway:commands:json`.
- [x] Adicionados scripts canônicos de lint, typecheck, testes, validate e
  prebuild.
- [x] Adicionados targets Makefile `model-gateway-*`.
- [x] Adicionado comando terminal `/byok gateway commands`.
- [x] Adicionados testes unitários do inventário e do comando terminal.

Separação preservada:

- [x] `model-gateway:prebuild` ainda não executa build.
- [x] Comandos canônicos explicam a preparação antes do primeiro build.
- [x] A mesma fonte de dados alimenta package/helper/terminal.
- [x] Nenhum provider é chamado.
- [x] Nenhum runtime probe é executado.

Validação deste corte:

- [x] PASS `npm run model-gateway:commands`.
- [x] PASS `npm run model-gateway:commands:json`.
- [x] PASS `make model-gateway-commands`.
- [x] PASS `npm run model-gateway:test:contracts` com `117` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `55` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 54. Continuidade 2026-05-26 — Tombstones De Catálogo

Auditoria executada neste corte:

- [x] Revisitada a lacuna da Faixa K sobre tombstones.
- [x] Confirmado que `diffCanonicalModelProjections()` já detectava removidos,
  mas o snapshot não preservava registro próprio de remoção.
- [x] Confirmado que tombstones devem ser derivados do diff, sem apagar
  evidências históricas ou projections anteriores fora da política ativa.
- [x] Confirmado que provider models com `:` no id exigem parsing cuidadoso da
  chave `provider:model:routeProfile`.

Implementado neste corte:

- [x] Criado `createCatalogModelTombstones()`.
- [x] Snapshot JSON passa a normalizar `modelTombstones`.
- [x] `refreshModelGatewayCatalog()` cria tombstones para modelos removidos.
- [x] Tombstones são upsertados por `projectionKey`.
- [x] Exportado pelos barrels `catalog` e `model-gateway`.
- [x] Adicionado teste unitário com provider model contendo `:`.

Separação preservada:

- [x] Tombstone é metadado derivado de diff.
- [x] Tombstone não chama provider.
- [x] Tombstone não executa modelo.
- [x] Tombstone não altera eligibility ou runtime health.
- [x] Tombstone preserva a última projection sanitizada como referência.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `123` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 53. Continuidade 2026-05-26 — Raw Payload Storage Policy

Auditoria executada neste corte:

- [x] Revisitada a lacuna da Faixa K sobre política de armazenamento para raw
  payload refs.
- [x] Confirmado que `createSanitizedRawPayloadRef()` já redigia payloads, mas
  sempre preservava o payload sanitizado inline.
- [x] Confirmado que precisamos de modo hash-only e limite de bytes antes de
  ampliar refresh/importers.
- [x] Confirmado que a política deve ser aplicada antes de JSON/SQLite.

Implementado neste corte:

- [x] Criado `MODEL_GATEWAY_RAW_PAYLOAD_STORAGE_POLICY`.
- [x] `createSanitizedRawPayloadRef()` passa a aceitar `storagePolicy`.
- [x] Adicionado `payloadSha256`.
- [x] Adicionado `storagePolicy` no raw payload ref.
- [x] Modo `hash_only` remove `sanitizedPayload` e preserva hash/tamanho.
- [x] `runCatalogImporters()` passa a aceitar `rawPayloadStoragePolicy`.
- [x] `refreshModelGatewayCatalog()` propaga `rawPayloadStoragePolicy`.
- [x] Exportado pelo barrel de `catalog` e `model-gateway`.
- [x] Adicionado teste unitário de inline/hash-only/limite.

Separação preservada:

- [x] A política não altera evidences nem projections.
- [x] A política não chama provider.
- [x] A política não executa modelo.
- [x] A política não altera eligibility ou runtime health.
- [x] Hash/tamanho continuam disponíveis para auditoria.
- [x] Segredos continuam redigidos antes de qualquer armazenamento.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `122` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 52. Continuidade 2026-05-26 — UX De Requisitos De Env E Secrets Ausentes

Auditoria executada neste corte:

- [x] Revisitada a lacuna da Faixa C sobre UX para secrets ausentes por
  provider.
- [x] Confirmado que o operador precisa ver aliases aceitos sem exposição de
  valores.
- [x] Confirmado que alguns requisitos são configuração não secreta, como
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_ID` e base URL local Ollama.
- [x] Confirmado que esta camada deve ocorrer antes de refresh account-scoped,
  eligibility e runtime probes.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/secrets/requirements.js`.
- [x] Criado `MODEL_GATEWAY_PROVIDER_ENV_REQUIREMENTS`.
- [x] Criado `evaluateModelGatewayProviderEnvRequirements()`.
- [x] Criado `summarizeModelGatewayProviderEnvRequirements()`.
- [x] Exportado pelos barrels `secrets` e `model-gateway`.
- [x] Adicionado comando terminal `/byok gateway secrets [provider]`.
- [x] Adicionado o comando ao inventário canônico da Faixa Y.
- [x] Adicionados testes unitários de contrato e terminal.

Separação preservada:

- [x] A avaliação lê apenas presença/ausência de variáveis.
- [x] Nenhum valor de segredo é retornado.
- [x] Nenhum provider é chamado.
- [x] Nenhum modelo é executado.
- [x] Nenhuma eligibility decision é persistida.
- [x] O catálogo canônico não é mutado.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `121` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `59` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 50. Continuidade 2026-05-26 — Readiness Pré-Build K+/Y

Auditoria executada neste corte:

- [x] Revisitada a lacuna da Faixa J sobre atualizar o gate quando SQLite e
  elegibilidade existissem.
- [x] Confirmado que o gate `pre-k` deve continuar existindo como prova
  histórica A-J.
- [x] Confirmado que a camada atual precisa de um readiness K+/Y próprio antes
  do primeiro build.
- [x] Confirmado que readiness não deve executar build, provider, modelo ou
  probes runtime.

Implementado neste corte:

- [x] Criado `MODEL_GATEWAY_PREBUILD_STAGE`.
- [x] Criado `buildModelGatewayPreBuildReadinessReport()`.
- [x] O readiness agrega checks A-J e checks K/R/Q/O/M/Y.
- [x] Exportado por `migration` e pelo barrel principal `model-gateway`.
- [x] Adicionado comando terminal `/byok gateway prebuild`.
- [x] Adicionado `/byok gateway prebuild` ao inventário canônico da Faixa Y.
- [x] Adicionados testes unitários de contrato e terminal.

Separação preservada:

- [x] Readiness é relatório booleano estático da camada.
- [x] Readiness não chama provider.
- [x] Readiness não executa modelo.
- [x] Readiness não executa probes runtime.
- [x] Readiness não altera catálogo, SQLite, overlays ou health.
- [x] Primeiro build real continua pendente e deverá usar comandos canônicos.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `119` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `57` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 49. Continuidade 2026-05-26 — Traits Provider/Gateway Pré-Runtime

Auditoria executada neste corte:

- [x] Revisitada a lacuna aberta da Faixa M sobre traits provider/gateway.
- [x] Confirmado que o inventário de endpoints já possuía fatos suficientes
  para derivar topologia, seletor, fontes de catálogo e runtime kinds.
- [x] Confirmado que esses traits devem ser metadados pré-runtime, não prova de
  acesso, saúde ou capability executada.
- [x] Confirmado que o terminal precisava expor a camada de traits para operador
  humano e LLM antes do primeiro build.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/providers/traits.js`.
- [x] Criado `createProviderGatewayTraits()` para normalizar inventário/specs.
- [x] Criado `listProviderGatewayTraits()`.
- [x] Criado `resolveProviderGatewayTraits()`.
- [x] Exportado pelos barrels `providers` e `model-gateway`.
- [x] Adicionado comando terminal `/byok gateway provider traits [provider]`.
- [x] Adicionado o comando ao inventário canônico da Faixa Y.
- [x] Adicionados testes unitários de contrato e terminal.

Separação preservada:

- [x] Traits derivam apenas de specs estáticas e inventário de endpoints.
- [x] Nenhum provider é chamado.
- [x] Nenhum modelo é executado.
- [x] Nenhuma decisão de eligibility é persistida.
- [x] Nenhum catálogo canônico é mutado.
- [x] Runtime probes continuam fase posterior e separada.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `118` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `56` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 51. Continuidade 2026-05-26 — Matrix Provider/Wire API De Probes

Auditoria executada neste corte:

- [x] Revisitada a lacuna da Faixa T sobre matriz completa por provider/wire
  API.
- [x] Confirmado que a matriz deve ser planejamento pré-runtime, não execução de
  probes.
- [x] Confirmado que ela deve derivar de traits provider/gateway e endpoint
  inventory.
- [x] Confirmado que ela deve separar probes já implementadas de probes ainda
  pendentes.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/probes/matrix.js`.
- [x] Criado `MODEL_GATEWAY_IMPLEMENTED_PROBE_KINDS`.
- [x] Criado `MODEL_GATEWAY_PLANNED_PROBE_KINDS`.
- [x] Criado `listProviderWireProbeMatrix()`.
- [x] Criado `summarizeProviderWireProbeMatrix()`.
- [x] Estendido cost planner para tipos planejados como `reasoning`,
  `forced_tool_choice`, `parallel_tool_calls`, `embeddings`, audio, rerank,
  image generation, gateway fallback e provider native.
- [x] Exportado pelos barrels `probes` e `model-gateway`.
- [x] Adicionado comando terminal `/byok gateway probes matrix [provider]`.
- [x] Adicionado o comando ao inventário canônico da Faixa Y.
- [x] Adicionados testes unitários de contrato e terminal.

Separação preservada:

- [x] A matriz não chama provider.
- [x] A matriz não executa modelo.
- [x] A matriz não executa probes runtime.
- [x] A matriz não altera health runtime.
- [x] A matriz não altera catálogo, SQLite, overlays ou eligibility.
- [x] Probes pendentes continuam explicitamente pendentes.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `120` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `58` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 52. Continuidade 2026-05-26 — Fechamento B/C/D/F/G/M Pré-Runtime

Auditoria executada neste corte:

- [x] Revisitadas as faixas B, C, D, F, G e M após os cortes de route options,
  provider traits, matrix de probes, tombstones e raw payload policy.
- [x] Confirmado que a projeção OpenAI-first precisava carregar rotas
  candidatas completas em `x_model_gateway`, sem alterar o SDK vanilla.
- [x] Confirmado que secrets precisavam de precedência account/workspace/global
  antes de runtime, sem serializar valores.
- [x] Confirmado que endpoint richness precisava deixar de ser apenas string
  livre e virar taxonomia consumível por coverage, importers e planejamento.
- [x] Confirmado que fatal health já existia conceitualmente, mas precisava
  classificar contextos estruturados de erro antes de liberar runtime.
- [x] Confirmado que a Faixa M precisava separar capability runtime-agentic,
  pricing multi-currency, rate limits, data policy e alias/deprecation resolver.

Implementado neste corte:

- [x] `toOpenAIModelCatalogEntry()` e `toOpenAIModelCatalogList()` passam a
  aceitar `routeOptions`.
- [x] `x_model_gateway.route_options` passa a expor seletor, sintaxe,
  policy normalizada, route traits e metadados provider-specific sanitizados.
- [x] JSON store, SQLite store, refresh, explain e terminal passam route options
  para a projeção OpenAI-first.
- [x] O terminal `/byok gateway catalog openai` mostra contagem de rotas por
  modelo exportado.
- [x] Criado `MODEL_GATEWAY_ENDPOINT_RICHNESS_CATEGORIES`.
- [x] Criado `normalizeProviderEndpointRichness()`.
- [x] Endpoint source records passam a expor `richnessCategories` e
  `richnessCoverage`.
- [x] `EnvSecretRegistry` passa a resolver secrets por precedência account,
  workspace e global.
- [x] Criado `buildScopedSecretEnvKey()` para chaves como
  `COPILOT_BYOK_ACCOUNT_ACCT_42__OPENAI_API_KEY`.
- [x] `describe()` passa a expor labels seguros, escopo resolvido e env keys
  checadas sem retornar valor de segredo.
- [x] A elegibilidade fatal health passa a ler contextos estruturados de erro,
  como `{ code, message }`, e não apenas strings.
- [x] `explainGatewayRouteDecision()` passa a emitir summaries de candidatos,
  rejeições, eligibility, overlay refs, health/probes e decision layers.
- [x] Criado `normalizeRuntimeAgenticCapabilityTaxonomy()`.
- [x] Criado `normalizeModelPricingTaxonomy()` com multi-currency e conversão
  opcional para USD.
- [x] Criado `normalizeRateLimitTaxonomy()`.
- [x] Criado `normalizeDataPolicyTaxonomy()`.
- [x] Criado `resolveModelDeprecationAlias()`.
- [x] Exportado tudo pelos barrels canônicos `catalog`, `providers`, `secrets`
  e `model-gateway`.
- [x] Adicionados testes unitários cobrindo OpenAI route options, endpoint
  richness, secret scope policy, fatal health estruturado, route explanation e
  novas taxonomias M.

Separação preservada:

- [x] A projeção OpenAI-first continua sendo export/compatibilidade, não SDK
  fork.
- [x] Route options em `x_model_gateway` são metadados sanitizados, não segredo.
- [x] Endpoint richness é metadado estático de inventário.
- [x] Secret scope policy resolve presença/precedência, sem persistir valores.
- [x] Fatal health só decide elegibilidade pré-runtime; não executa provider.
- [x] Taxonomias M não provam acesso nem capability executada.
- [x] Runtime probes continuam fase posterior e separada.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `126` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `59` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 55. Continuidade 2026-05-26 — Auditoria Estrutural Da Faixa L

Auditoria executada neste corte:

- [x] Revisitada a Faixa L como camada inteira: factories de importers,
  default importer set, importer runner, raw payload refs, route options,
  account overlays e coverage contra endpoint inventory.
- [x] Identificado que alguns importers capazes de rodar em modo público
  ficavam fora do default set quando não havia chave.
- [x] Identificado que faltava um contrato canônico para auditar hooks de
  importer sem executar fetch.
- [x] Identificado desalinhamento entre aliases aceitos por importers/default
  set e aliases reconhecidos pelo `EnvSecretRegistry`.
- [x] Confirmado que a auditoria deve ser pré-runtime e não pode chamar
  providers nem modelos.

Implementado neste corte:

- [x] `createDefaultModelGatewayCatalogImporters()` passa a incluir importers
  públicos para Hugging Face, OpenCode models, Chutes e Z.AI quando não há
  variante autenticada selecionada.
- [x] O default set evita duplicar o mesmo importer público/autenticado quando
  uma chave está presente e `includeAuthenticated` está ativo.
- [x] Aliases de env aceitos pelo registry passam a incluir
  `COPILOT_OPENAI_API_KEY`, `ANTHROPIC_KEY` e `HUGGINGFACE_API_TOKEN`.
- [x] Criado `describeCatalogImporter()`.
- [x] Criado `auditCatalogImporterSet()`.
- [x] A auditoria mede importers públicos/autenticados, providers cobertos,
  hooks obrigatórios, hooks de provider evidence, route options e overlays.
- [x] A auditoria compara importers configurados contra
  `MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY`.
- [x] Exportado pelos barrels `catalog` e `model-gateway`.
- [x] Testes cobrem default set público ampliado, ausência de vazamento de
  segredo, audit de hooks e coverage de endpoints.

Separação preservada:

- [x] Auditoria não chama `fetchRaw()`.
- [x] Auditoria não executa provider.
- [x] Auditoria não executa modelo.
- [x] Auditoria não executa probes.
- [x] Auditoria não altera snapshot.
- [x] Segredos continuam ausentes de serialização.

Próximas lacunas L identificadas:

- [ ] OpenAI official docs seed de preço/limites/capabilities.
- [ ] Anthropic docs seed completo por família.
- [ ] Gemini/Vertex docs seed e distinção fina de superfície.
- [ ] Mistral docs pricing seed.
- [ ] OpenRouter account overlay importer profundo.
- [ ] Kilo account overlay importer real de allow/block/balance.
- [ ] Cloudflare account access importer além de flags configuradas.
- [ ] Parser estrutural do OpenAPI da Z.AI.
- [ ] Importer autenticado especializado para Cerebras.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `128` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 56. Continuidade 2026-05-26 — OpenAI Official Docs Seed

Auditoria executada neste corte:

- [x] Consultadas fontes oficiais OpenAI para confirmar a superfície pública de
  modelos, pricing e comparação de modelos.
- [x] Confirmado que `/v1/models` continua sendo fonte account-scoped de
  visibilidade, enquanto docs públicos devem entrar apenas como evidência
  global de metadados.
- [x] Confirmado que o seed não deve criar account overlay, route option ou
  prova de acesso.

Fontes oficiais consultadas:

- [x] `https://platform.openai.com/docs/models`.
- [x] `https://platform.openai.com/docs/pricing`.
- [x] `https://platform.openai.com/docs/models/compare`.
- [x] `https://platform.openai.com/docs/api-reference/models/list`.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/importers/openai-docs-models-importer.js`.
- [x] Criado `createOpenAiDocsModelsImporter()`.
- [x] Criado `parseOpenAiDocsRows()`.
- [x] O importer busca docs de modelos, pricing e comparação em paralelo.
- [x] O parser extrai ids OpenAI-like e gera evidências de docs URL, pricing
  quando presente, lifecycle, modalidades, capabilities e model traits.
- [x] O default importer set passa a incluir `openai-docs-models` em modo
  público.
- [x] Exportado pelos barrels de `importers`, `catalog` e `model-gateway`.
- [x] Teste unitário cobre parsing, pricing, lifecycle deprecated, embeddings e
  ausência de overlays/routes.

Separação preservada:

- [x] Docs seed não prova acesso.
- [x] Docs seed não executa modelo.
- [x] Docs seed não chama probes.
- [x] Docs seed não substitui account overlay autenticado.
- [x] Docs seed é evidência global de metadados.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `129` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 57. Continuidade 2026-05-26 — Terminal Importer Audit

Auditoria executada neste corte:

- [x] Revisitada a Faixa L sob o ponto de vista operacional: não basta existir
  `auditCatalogImporterSet()`; o operador humano e a LLM precisam conseguir
  consultar a cobertura ativa do ambiente sem abrir código e sem executar rede.
- [x] Confirmado que o comando deve montar o mesmo default importer set usado
  pelo refresh, mas parar antes de `fetchRaw()`.
- [x] Confirmado que a saída deve cruzar importers configurados com
  `MODEL_GATEWAY_PROVIDER_ENDPOINT_INVENTORY`, preservando a separação entre
  inventário de coleta, evidência de metadados, overlays account-scoped e
  provas runtime.
- [x] Confirmado que o comando não pode imprimir valores de segredo; apenas
  nomes de variáveis e hooks declarados.

Implementado neste corte:

- [x] Criado `/byok gateway importers [provider]`.
- [x] O comando instancia `createDefaultModelGatewayCatalogImporters({ env:
  process.env })` e filtra por provider quando solicitado.
- [x] O comando chama `auditCatalogImporterSet()` com o inventário completo ou
  provider-específico.
- [x] A saída mostra total de importers configurados, providers cobertos,
  importers públicos/autenticados, hooks de provider evidence, route options e
  account overlays.
- [x] A saída mostra `endpointCoverage`, `uncoveredCatalogSources`,
  `providersWithoutImporters` e `missingRequiredHooks`.
- [x] O comando foi adicionado ao help do `/byok`.
- [x] O comando foi adicionado ao inventário canônico de comandos
  `MODEL_GATEWAY_CANONICAL_COMMANDS`.
- [x] Teste de terminal cobre auditoria provider-específica sem rede e sem
  vazamento de segredo.

Separação preservada:

- [x] O comando não chama `fetchRaw()`.
- [x] O comando não chama provider.
- [x] O comando não executa modelo.
- [x] O comando não executa probes.
- [x] O comando não altera snapshot.
- [x] O comando não persiste decisões de elegibilidade.

Próximas lacunas L reforçadas:

- [ ] Usar a saída do comando como gate antes do primeiro build real.
- [ ] Criar importers de docs para Anthropic, Gemini/Vertex e Mistral seguindo
  o mesmo padrão de seed público da OpenAI.
- [ ] Criar overlays account-scoped profundos para OpenRouter e Kilo.
- [ ] Expandir Cloudflare de flags configuradas para evidência account-scoped.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:terminal` com `60` testes.
- [x] PASS `npm run model-gateway:test:contracts` com `129` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 58. Continuidade 2026-05-26 — Anthropic Official Docs Seed

Auditoria executada neste corte:

- [x] Revisitada a lacuna Anthropic da Faixa L: o importer autenticado
  `/v1/models` prova visibilidade account-scoped, mas não carrega sozinho
  pricing, limites, aliases Bedrock/Vertex e notas de capability publicadas nos
  docs.
- [x] Consultadas fontes oficiais Anthropic de overview de modelos, pricing e
  API de listagem de modelos.
- [x] Confirmado que a fonte pública precisa ser evidência global de metadados,
  sem route option, sem account overlay e sem prova de acesso.
- [x] Identificado que o inventário de endpoints Anthropic registrava apenas a
  API autenticada e precisava declarar também o seed oficial de docs para que a
  auditoria de importers enxergasse cobertura.

Fontes oficiais consultadas:

- [x] `https://docs.anthropic.com/en/docs/about-claude/models/overview`.
- [x] `https://docs.anthropic.com/en/docs/about-claude/pricing`.
- [x] `https://docs.anthropic.com/en/api/models-list`.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/importers/anthropic-docs-models-importer.js`.
- [x] Criado `createAnthropicDocsModelsImporter()`.
- [x] Criado `parseAnthropicDocsRows()`.
- [x] O importer busca overview, pricing e docs da API em paralelo.
- [x] O parser extrai ids Claude versionados e aliases `latest`, evitando
  promover aliases cloud como ids primários.
- [x] Evidências normalizadas incluem docs/pricing/API URLs, aliases,
  lifecycle, modalidades, capabilities, token limits, pricing, cloud aliases e
  model identity traits.
- [x] `createDefaultModelGatewayCatalogImporters()` passa a incluir
  `anthropic-docs-models` em modo público.
- [x] O inventário de endpoints Anthropic passa a declarar o source
  `official_docs`.
- [x] Exportado pelos barrels de `importers`, `catalog` e `model-gateway`.
- [x] Teste unitário cobre parsing, pricing, context/output limits,
  capabilities, ausência de route options/overlays e ausência de prova de
  acesso.

Separação preservada:

- [x] Docs seed não prova acesso.
- [x] Docs seed não executa modelo.
- [x] Docs seed não chama probes.
- [x] Docs seed não substitui `/v1/models` autenticado.
- [x] Docs seed é evidência global de metadados.

Próximas lacunas L reforçadas:

- [ ] Gemini/Vertex docs seed e distinção entre Gemini Developer API,
  Vertex AI e OpenAI-compatible surface.
- [ ] Mistral docs pricing seed.
- [ ] OpenRouter/Kilo account overlays profundos.
- [ ] Cloudflare account access importer além de flags configuradas.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `130` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 59. Continuidade 2026-05-26 — Gemini Vertex/OpenAI Docs Seed

Auditoria executada neste corte:

- [x] Revisitada a lacuna Gemini/Vertex da Faixa L: a API
  `generativelanguage.googleapis.com/v1beta/models` é account/key-scoped,
  enquanto os docs públicos carregam metadados que precisam entrar antes de
  qualquer prova de acesso.
- [x] Confirmado que Gemini exige separar ao menos três superfícies:
  Developer API, Vertex AI e OpenAI-compatible endpoint.
- [x] Consultadas fontes oficiais Google AI/Google Cloud de modelos, pricing,
  OpenAI compatibility e Vertex AI models.
- [x] Identificado que o inventário Gemini registrava apenas a API autenticada
  e precisava declarar também a fonte oficial pública de docs.

Fontes oficiais consultadas:

- [x] `https://ai.google.dev/gemini-api/docs/models`.
- [x] `https://ai.google.dev/gemini-api/docs/pricing`.
- [x] `https://ai.google.dev/gemini-api/docs/openai`.
- [x] `https://cloud.google.com/vertex-ai/generative-ai/docs/models`.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/importers/gemini-docs-models-importer.js`.
- [x] Criado `createGeminiDocsModelsImporter()`.
- [x] Criado `parseGeminiDocsRows()`.
- [x] O importer busca models docs, pricing, OpenAI compatibility e Vertex AI
  models em paralelo.
- [x] O parser extrai ids `gemini-*` explícitos e converte headings públicos
  `Gemini 2.5 Pro` para ids normalizados.
- [x] Evidências normalizadas incluem docs/pricing/OpenAI/Vertex URLs,
  superfícies, lifecycle, modalidades, capabilities, token limits, pricing e
  model identity traits.
- [x] `createDefaultModelGatewayCatalogImporters()` passa a incluir
  `gemini-docs-models` em modo público.
- [x] O inventário de endpoints Gemini passa a declarar o source
  `official_docs`.
- [x] Exportado pelos barrels de `importers`, `catalog` e `model-gateway`.
- [x] Teste unitário cobre Developer API, Vertex e OpenAI-compatible surfaces,
  pricing, context limits, multimodalidade e ausência de prova de acesso.

Separação preservada:

- [x] Docs seed não prova acesso.
- [x] Docs seed não executa modelo.
- [x] Docs seed não chama probes.
- [x] Docs seed não substitui `models.list` autenticado.
- [x] Docs seed mantém Developer API, Vertex AI e OpenAI-compatible como
  metadados, não como runtime selecionado.

Próximas lacunas L reforçadas:

- [ ] Mistral docs pricing seed.
- [ ] Account overlays profundos para OpenRouter e Kilo.
- [ ] Cloudflare account access importer além de flags configuradas.
- [ ] Parser estrutural adicional para OpenAPI docs onde o provider expõe
  schema legível por máquina.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `131` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 60. Continuidade 2026-05-26 — Mistral Docs Pricing Seed

Auditoria executada neste corte:

- [x] Revisitada a lacuna Mistral da Faixa L: `/v1/models` traz model cards
  account-visible, mas os docs públicos trazem contexto de modelos, limites,
  pricing e endpoints antes de qualquer chave.
- [x] Consultadas fontes oficiais Mistral de models overview, known limitations
  e API models endpoint.
- [x] Confirmado que a evidência pública deve enriquecer metadados e não criar
  route options, overlays ou prova de acesso.
- [x] Identificado que o inventário Mistral registrava apenas a API autenticada
  e precisava declarar a fonte oficial pública de docs.

Fontes oficiais consultadas:

- [x] `https://docs.mistral.ai/models/overview`.
- [x] `https://docs.mistral.ai/resources/known-limitations`.
- [x] `https://docs.mistral.ai/api/endpoint/models`.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/importers/mistral-docs-models-importer.js`.
- [x] Criado `createMistralDocsModelsImporter()`.
- [x] Criado `parseMistralDocsRows()`.
- [x] O importer busca overview, known limitations e API docs em paralelo.
- [x] Evidências normalizadas incluem docs/API/limitations URLs, aliases,
  lifecycle, modalidades, capabilities, context limits, pricing e model
  identity traits.
- [x] `createDefaultModelGatewayCatalogImporters()` passa a incluir
  `mistral-docs-models` em modo público.
- [x] O inventário de endpoints Mistral passa a declarar o source
  `official_docs`.
- [x] Exportado pelos barrels de `importers`, `catalog` e `model-gateway`.
- [x] Teste unitário cobre pricing, limites, structured outputs,
  code-completion e ausência de prova de acesso.

Separação preservada:

- [x] Docs seed não prova acesso.
- [x] Docs seed não executa modelo.
- [x] Docs seed não chama probes.
- [x] Docs seed não substitui `/v1/models` autenticado.
- [x] Docs seed é evidência global de metadados.

Próximas lacunas L reforçadas:

- [ ] Account overlays profundos para OpenRouter e Kilo.
- [ ] Cloudflare account access importer além de flags configuradas.
- [ ] Parser estrutural do OpenAPI da Z.AI.
- [ ] Importer autenticado especializado para Cerebras.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `132` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 61. Continuidade 2026-05-26 — OpenRouter Key Account Overlay

Auditoria executada neste corte:

- [x] Revisitada a primeira lacuna account-scoped profunda da Faixa L:
  OpenRouter já tinha catálogo público rico, mas faltava importar evidência da
  própria key antes de runtime.
- [x] Consultada documentação OpenRouter de limits/key endpoint, que indica
  consulta autenticada em `https://openrouter.ai/api/v1/key` para rate limits e
  créditos/limites da chave.
- [x] Confirmado que isso não prova que um modelo específico roda, mas pode
  alimentar pré-runtime/exclusão quando a key está desabilitada, limitada,
  zerada ou sob rate limit.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/catalog/importers/openrouter-key-account-importer.js`.
- [x] Criado `createOpenRouterKeyAccountImporter()`.
- [x] Criado `parseOpenRouterKeyRows()`.
- [x] O importer consulta `/api/v1/key` com bearer token sem serializar segredo.
- [x] O importer emite provider evidence de label, usage, limit, free tier,
  disabled e rate limit.
- [x] O importer emite account overlay com spending limits, remaining credits,
  rate limits e metadata sanitizada.
- [x] `createDefaultModelGatewayCatalogImporters()` passa a incluir
  `openrouter-key-account` quando `OPENROUTER_API_KEY` ou `OPEN_ROUTER_KEY`
  está configurado.
- [x] O inventário de endpoints OpenRouter passa a declarar o source
  `authenticated_account_api`.
- [x] Exportado pelos barrels de `importers`, `catalog` e `model-gateway`.
- [x] Teste unitário cobre overlay, provider evidence, remaining credits,
  rate limits e ausência de vazamento de segredo.

Separação preservada:

- [x] Account overlay não prova execução de modelo.
- [x] Account overlay não cria route option.
- [x] Account overlay não substitui o catálogo público de modelos.
- [x] Account overlay serve à etapa pré-runtime/exclusão antes dos probes.

Próximas lacunas L reforçadas:

- [ ] Kilo account overlay real de allow/block/balance.
- [ ] Cloudflare account access importer além de flags configuradas.
- [ ] Parser estrutural do OpenAPI da Z.AI.
- [ ] Importer autenticado especializado para Cerebras.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `133` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 62. Continuidade 2026-05-26 — Quotas Dinâmicas, Rate Limits E Falhas Runtime

Auditoria executada neste corte:

- [x] Revisitada a pergunta central: quando a quota acaba durante runtime, a
  chamada para, mas o sistema precisa registrar se isso é crédito/spend, quota,
  rate limit temporário, key desabilitada ou erro genérico.
- [x] Confirmado que esses fatos não pertencem ao catálogo canônico global.
- [x] Confirmado que o banco canônico deve continuar guardando metadados raros
  e estáveis, enquanto account overlays e runtime health guardam fatos
  dinâmicos e expiráveis.
- [x] Consultada a documentação OpenAI de rate limits e error codes: `429` pode
  significar tanto envio rápido demais quanto quota/crédito/spend esgotado, e
  limites são vistos na página de limits da organização.
- [x] Consultada a documentação OpenRouter de limits: `/api/v1/key` é o endpoint
  oficial para rate limit e créditos restantes da key.
- [x] Consultada a documentação Anthropic de rate limits: `429` vem com
  `retry-after` e headers `anthropic-ratelimit-*` com remaining/reset.
- [x] Consultada a documentação Gemini/Vertex: Gemini API avalia RPM/TPM/RPD por
  projeto e RPD reseta à meia-noite Pacific Time; Vertex pode usar quota
  padrão, DSQ ou Provisioned Throughput.
- [x] Consultada a documentação Groq: headers `retry-after`,
  `x-ratelimit-*` expõem remaining/reset, e spend limit pode bloquear a org.
- [x] Consultada a documentação Mistral: rate limits variam por tier/modelo,
  aplicam por API key e expõem `X-RateLimit-Remaining`.
- [x] Consultada a documentação Cloudflare Workers AI: limites são por tipo de
  tarefa, alguns por modelo, e modelos beta podem ter limites menores.

Arquitetura consolidada:

- [x] Metadados globais continuam em evidences/projections do catálogo.
- [x] Estado account/key fica em `accountOverlays`, com TTL curto e refresh
  separado.
- [x] Estado de falha runtime fica em BYOK provider health e SQLite runtime
  layer, não em canonical projections.
- [x] Elegibilidade pré-runtime consome overlays e health como barreiras
  derivadas.
- [x] Rate limit só deve excluir enquanto a janela observada ainda estiver
  ativa.
- [x] Quota diária/mensal com reset conhecido só exclui enquanto a janela
  observada ainda estiver ativa.
- [x] Quota/spending sem reset conhecido permanece bloqueio hard até refresh de
  overlay, sucesso posterior, troca de conta/key ou política explícita.
- [x] O operador deve enxergar a diferença entre `account_spending_exhausted`,
  `account_quota_exhausted`, `account_rate_limited`, `account_key_disabled` e
  `health_fatal`.

Implementado neste corte:

- [x] Criado `src/copilot/model-gateway/account-access/limits.js`.
- [x] Criado `MODEL_GATEWAY_ACCOUNT_LIMIT_STATUS`.
- [x] Criado `normalizeModelGatewayAccountLimitState()`.
- [x] O normalizador separa spending, quota, rate limit e key disabled.
- [x] O normalizador entende `retryAfterSeconds`, `resetAt`,
  `remainingRequests` e `remainingTokens`.
- [x] Rate limit com reset expirado deixa de bloquear pré-runtime.
- [x] Quota diária/mensal zerada com `resetAt` expirado deixa de bloquear
  pré-runtime e expõe `quota.resetExpired` para UX/seleção.
- [x] `resolveModelGatewayAccountAccess()` passa a bloquear key desabilitada.
- [x] `resolveModelGatewayAccountAccess()` passa a bloquear rate limit account
  ativo.
- [x] Eligibility passa a receber status `key_disabled` e `rate_limited`.
- [x] `MODEL_GATEWAY_ELIGIBILITY_HARD_REASONS` passa a incluir
  `account_key_disabled` e `account_rate_limited`.
- [x] `explainModelGatewayAccountAccess()` passa a sugerir ações específicas
  para key desabilitada e rate limit.
- [x] `classifyByokProviderFailure()` passa a extrair `retry-after`,
  `x-ratelimit-*` e headers Anthropic de reset/remaining quando disponíveis.
- [x] `classifyByokProviderFailure()` passa a preservar `retryAfterSeconds`,
  `resetAt`, `statusCode` e `limitHeaders`.
- [x] BYOK provider health foi evoluído para schema v3.
- [x] Health passa a persistir `lastFailureKind`, `lastFailureStatusCode`,
  `lastRetryAfterSeconds` e `lastResetAt`.
- [x] Sucesso posterior limpa os campos de falha runtime atuais, preservando
  contadores/histórico.
- [x] Terminal `/byok health` passa a mostrar kind/status/retry/reset quando
  houver falha dinâmica.
- [x] Criado `/byok gateway accounts [filtro] [n]` para mostrar status
  account/key normalizado a partir dos overlays.
- [x] Criado `summarizeModelGatewayAccountOverlays()` para UX/LLM sem runtime.
- [x] Criado `planModelGatewayProbeBackoff()` para adiar probes durante janelas
  ativas de rate limit account/key ou runtime health.
- [x] Criado `/byok gateway probes backoff` para explicar `READY` vs `DEFER`
  antes de qualquer probe runtime.
- [x] Criado `deriveModelGatewayRuntimeAccountOverlaysFromHealth()` para
  projetar falhas runtime já observadas de auth/crédito/rate-limit como
  overlays account/key voláteis, sem executar provider e sem alterar metadados
  canônicos.
- [x] `/byok gateway accounts` passa a unir overlays persistidos do catálogo
  com overlays voláteis derivados do runtime health, deixando visível quando um
  bloqueio operacional recente ainda deve afetar pré-runtime.
- [x] Criado `summarizeModelGatewaySdkQuotaSnapshots()` para normalizar
  `AssistantUsageQuotaSnapshot` em uma visão `copilot_sdk_entitlement`,
  preservando a fronteira com BYOK provider quotas.
- [x] `/sdk quota` e `classifyTerminalSdkQuota()` passam a consumir o
  normalizador canônico, eliminando uma segunda regra paralela de percentuais.
- [x] `evaluateModelGatewayCatalogEligibility()` passa a aceitar
  `healthRecords`, derivar overlays account/key voláteis e repassar o health
  correspondente para cada modelo sem executar runtime.
- [x] `/byok gateway eligibility` passa a considerar o BYOK provider health
  atual na avaliação em lote, mantendo o catálogo canônico separado dos fatos
  runtime.
- [x] Probes e turnos vivos passam a gravar os campos estruturados de limite no
  health.
- [x] Health fatal em eligibility deixa de bloquear rate limit após
  `retryAfterSeconds`/`resetAt` expirar.
- [x] OpenRouter key overlay agora duplica crédito restante em
  `quota.remainingCreditsUsd`, mantendo `spendingLimits` como visão de budget.
- [x] SQLite schema v2 passa a reservar e materializar snapshots separados de
  quota, rate limit e spending account-scoped.

Separação preservada:

- [x] Nenhum runtime probe é executado por esse corte.
- [x] Nenhum resultado runtime altera o catálogo canônico.
- [x] Headers de limite são sanitizados e não contêm segredos.
- [x] Account/key limits continuam account-scoped.
- [x] Runtime health continua volátil e operacional.
- [x] Overlays derivados de runtime health continuam expiráveis e não são
  promovidos a evidência canônica.
- [x] `AssistantUsageQuotaSnapshot` do SDK é tratado como entitlement
  GitHub/Copilot host-scoped, não como quota de provider BYOK.
- [x] A quota SDK pode orientar rotas Copilot-native e diagnóstico do operador,
  mas não deve bloquear nem pontuar OpenRouter/Groq/Gemini/etc. como se fosse
  account overlay BYOK.
- [x] SQLite runtime layer continua espelho de health/probes, não fonte de
  metadados globais.

Próximas lacunas reforçadas:

- [ ] Criar importers account/key de limites para Groq, Anthropic e Gemini
  quando houver endpoint autenticado documentado ou API administrativa
  apropriada.
- [x] Criar UX agregada `/byok gateway accounts` para mostrar overlays e
  limits account/key sem runtime.
- [x] Persistir snapshots separados de `account_quota_snapshots`,
  `account_rate_limit_snapshots` e `account_spending_snapshots` no SQLite a
  partir dos overlays atuais.
- [x] Criar policy explícita para tratar quota diária/mensal com reset conhecido
  de forma diferente de spending/crédito sem reset.
- [x] Criar backoff planner para probes/runtime usando `retryAfterSeconds` e
  `resetAt`.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `141` testes.
- [x] PASS `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_provider_failure.spec.js tests/unit/copilot/model-gateway/test_model_gateway_provider_health.spec.js`
  com `9` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `62` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 54. Continuidade 2026-05-26 — Policy Engine Por Snapshot Completo

Auditoria executada neste corte:

- [x] Revisitado o item antigo que dizia que o policy engine ainda operava
  principalmente em registros/projeções soltos.
- [x] Confirmado que `buildModelGatewayRouteCandidates()` já tratava route
  options como unidade de seleção, mas faltava uma entrada única para snapshot.
- [x] Confirmado que a entrada canônica deve consumir projections, route
  options, account overlays e eligibility decisions juntas, sem runtime.

Implementado neste corte:

- [x] Criado `routeModelGatewayCatalogSnapshot()`.
- [x] A nova entrada constrói candidatos a partir de `snapshot.projections` e
  `snapshot.routeOptions`.
- [x] A nova entrada passa `accountOverlays` e `modelEligibilityDecisions` para
  o policy engine.
- [x] O retorno expõe `snapshotContext` com contagens de projections, rotas,
  overlays, eligibility decisions e candidatos.
- [x] Exportado pelos barrels `routing` e `model-gateway`.
- [x] Teste unitário cobre seleção por snapshot completo com route option,
  overlay e eligibility decision.

Separação preservada:

- [x] A função é puramente pré-runtime.
- [x] Nenhum provider é chamado.
- [x] Nenhum modelo é executado.
- [x] Nenhuma probe runtime é executada.
- [x] O catálogo canônico não é mutado.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `127` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.

---

## 53. Continuidade 2026-05-26 — Uso Das Taxonomias Em Coverage E Search

Auditoria executada neste corte:

- [x] Confirmado que as taxonomias M recém-criadas não deveriam ficar apenas
  como helpers exportados.
- [x] Confirmado que coverage deve medir completude de taxonomias antes de
  seleção e probes.
- [x] Confirmado que search pré-runtime deve usar capability taxonomy
  runtime-agentic, não somente flags cruas de provider.
- [x] Confirmado que provider/gateway traits deve consumir a richness
  padronizada de endpoints para não duplicar parsing livre.

Implementado neste corte:

- [x] `summarizeModelGatewayMetadataCoverage()` passa a contar modelos com
  runtime-agentic taxonomy, pricing taxonomy, rate-limit taxonomy e data-policy
  taxonomy.
- [x] `projectModelGatewayMetadataCoverageMetrics()` passa a emitir gauges
  globais e por provider para essas taxonomias.
- [x] `searchModelGatewayCatalogEntries()` passa a filtrar tools, streaming e
  reasoning a partir de `normalizeRuntimeAgenticCapabilityTaxonomy()`.
- [x] `createProviderGatewayTraits()` passa a usar
  `normalizeProviderEndpointRichness()`.
- [x] Provider/gateway traits passam a expor `richnessCategories`.
- [x] Metadata flags de provider traits passam a derivar de categorias
  padronizadas, incluindo lifecycle, data policy e runtime.
- [x] Terminal `/byok gateway provider traits` passa a mostrar categorias de
  richness junto das tags originais.
- [x] Testes unitários cobrem coverage por taxonomia, search por reasoning via
  taxonomy e richness categories em provider traits.

Separação preservada:

- [x] Coverage continua lendo apenas snapshot/metadados.
- [x] Search continua pré-runtime e não chama provider.
- [x] Provider traits continuam derivados de specs/endpoints.
- [x] Nenhum runtime probe é executado.
- [x] Nenhum segredo é serializado.

Validação deste corte:

- [x] PASS `npm run model-gateway:test:contracts` com `126` testes.
- [x] PASS `npm run model-gateway:test:terminal` com `59` testes.
- [x] PASS `npm run model-gateway:typecheck`.
- [x] PASS `npm run model-gateway:lint`.
- [x] PASS `git diff --check`.
