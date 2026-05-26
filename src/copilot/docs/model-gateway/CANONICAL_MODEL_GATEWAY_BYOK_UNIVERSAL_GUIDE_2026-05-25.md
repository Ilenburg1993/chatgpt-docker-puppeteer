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
- [ ] Policy engine ainda opera principalmente em registros/projeções, não em
  route options completas + overlays + eligibility snapshots.

### 5.9 Probes

- [x] Chat probe.
- [x] Agent/tools probe.
- [x] JSON probe.
- [x] Streaming probe.
- [x] Vision probe.
- [x] Recomendações de probes por diff de catálogo.
- [ ] Matrix completa por provider/wire API.
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
- [ ] UX dedicada de account overlays.
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
- [ ] Métricas de cobertura de metadados por provider.

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
- [ ] Docs seed oficial de preço/limites/capabilities.
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
- [ ] Seleção por provider upstream.

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
- [ ] Completar projeção OpenAI-first para todas as rotas novas.

### Faixa C — Segredos

- [x] `EnvSecretRegistry`.
- [x] Redaction central.
- [x] `secretRef` em vez de valor.
- [x] Testes de não serialização.
- [x] `OPENCODE_API_KEY` incluído.
- [ ] Policy de secrets por account/workspace.
- [ ] UX para secrets ausentes por provider.

### Faixa D — Provider Specs E Endpoints

- [x] Um arquivo por provider em `providers/specs`.
- [x] Um arquivo por provider em `providers/endpoints`.
- [x] Inventário central.
- [x] Separação entre catalog sources e runtime endpoints.
- [ ] Completar richness padronizado por endpoint.
- [ ] Adicionar schema de endpoint source.
- [ ] Testar inventário contra importers existentes.

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
- [ ] Integrar health fatal à elegibilidade pré-runtime.
- [x] Persistir health em SQLite.

### Faixa G — Policy Engine

- [x] Task profiles.
- [x] Score determinístico.
- [x] Provider allow/block.
- [x] Vision soft preference.
- [x] Runtime proved preference.
- [x] Consumo opcional de eligibility decisions no scoring.
- [ ] Consumir route options diretamente.
- [x] Avaliar eligibility on-demand a partir de projection + overlays quando
  `evaluateEligibility` estiver ativo.
- [ ] Emitir explicação completa catalog + overlay + eligibility + probe.

### Faixa H — Terminal

- [x] Cockpit BYOK existente.
- [x] Gateway pre-K gate.
- [x] Catalog refresh.
- [x] Catalog diff.
- [x] Catalog conflicts.
- [x] Endpoint inventory.
- [x] `/byok gateway catalog search`.
- [x] `/byok gateway catalog explain <model>`.
- [ ] `/byok gateway overlays`.
- [x] `/byok gateway eligibility`.
- [ ] `/byok gateway routes`.
- [x] Export OpenAI schema por comando.

### Faixa I — Observabilidade

- [x] Eventos de route decision.
- [x] Eventos de probes.
- [x] Eventos de catalog refresh.
- [x] Eventos de model added/removed/changed.
- [x] Eventos de conflict.
- [x] Evento `model_gateway:eligibility:evaluated`.
- [ ] Métricas de coverage.
- [ ] Métricas de provider freshness.
- [x] Métricas agregadas de eligible/unknown/excluded.
- [ ] Métricas por exclusion reason.

### Faixa J — Pre-K Gate

- [x] Relatório booleano de compatibilidade.
- [x] Gate no terminal.
- [x] Checklist A-J fechada para camada inicial.
- [ ] Atualizar gate para K+ quando SQLite/elegibility existirem.

### Faixa K — Universal Catalog

- [x] Evidence contracts.
- [x] Provider evidence contracts.
- [x] Route options.
- [x] Account overlays.
- [x] Field-wise merge.
- [x] Conflicts.
- [x] OpenAI projection.
- [x] JSON store.
- [ ] SQLite store.
- [ ] Snapshot ids estáveis.
- [ ] Incremental refresh com TTL por source.
- [ ] Tombstones.
- [ ] Raw payload storage policy.

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
- [ ] OpenAI official docs seed.
- [ ] Anthropic docs seed.
- [ ] Gemini/Vertex docs seed.
- [ ] Mistral docs pricing seed.
- [ ] OpenRouter account overlay importer.
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
- [ ] Provider/gateway traits normalizados como camada própria.
- [ ] Capability taxonomy runtime-agentic.
- [ ] Pricing multi-currency.
- [ ] Rate limit taxonomy completa.
- [ ] Data policy taxonomy.
- [ ] Deprecation/alias resolver robusto.

### Faixa N — Route Options E Seleção Por Metadados

- [x] Route option contract.
- [x] `routeTraits`.
- [x] Gateway/aggregator selectors preservados.
- [x] Hugging Face route policies.
- [x] Cloudflare direct/gateway routes.
- [x] OpenCode family endpoint routes.
- [x] Candidate builder baseado em route options.
- [ ] Seleção por provider upstream.
- [x] Seleção por route layer.
- [ ] Seleção por data policy.
- [x] Seleção por budget.
- [x] Seleção por confidence.

### Faixa O — Refresh E Governança

- [x] Import runs.
- [x] Diff canonical projections.
- [x] Probe recommendations.
- [x] Store redacted.
- [ ] TTL por source.
- [ ] Refresh incremental.
- [ ] Refresh overlay separado de refresh público.
- [ ] Lock de refresh.
- [ ] Retention policy.
- [ ] No automatic active swap sem policy.

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
- [ ] Account overlay refresh separado.
- [ ] Access confidence.
- [x] Access expiration.
- [ ] Access failure classification.
- [x] Account model visibility explain.
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
- [ ] Cost-bounded probe planner.

### Faixa U — Runtime Selection

- [x] Score básico.
- [x] Fallback chain básico.
- [x] Health-aware scoring.
- [x] Unificar candidate builder.
- [x] Usar eligibility como barreira opcional no policy engine.
- [ ] Usar probes como promoção.
- [x] Usar route options como unidade de seleção.
- [ ] Explicar rejeições.
- [ ] Persistir decisão final.
- [ ] SDK projection final por route option.

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
