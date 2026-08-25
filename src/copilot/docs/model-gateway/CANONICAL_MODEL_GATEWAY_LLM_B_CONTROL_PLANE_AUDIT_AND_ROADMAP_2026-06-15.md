# Model Gateway e LLM-B: auditoria canônica, arquitetura-alvo e roadmap

Data canônica: 2026-06-15

Status: ativo, normativo e continuamente atualizado

> **Reconciliação 2026-08-14:** o `HEAD` atual foi novamente comparado com os itens abertos abaixo.
> A promoção de `deferred_until_turn_boundary` agora possui executor automático integrado a
> `assistant.turn_end` em `terminal/events/sdk-session-events.js`, antes do drain da mailbox, usando
> `terminal/byok/deferred-route-promotion.js`. A promoção continua fail-closed: mesma sessão SDK,
> mesma idempotency key, autorização explícita registrada e TTL válido; não existe fallback
> implícito para sessão nova. Os checkboxes históricos correspondentes foram atualizados nesta
> revisão, e itens sem evidência atual permanecem abertos.
>
> **Reconciliação 2026-08-24 — readiness como caso de uso canônico de domínio:** a implementação
> real de live readiness deixou de pertencer a `scripts/model-gateway/commands/`. O application
> service agora vive em `src/copilot/model-gateway/readiness/`, com public capability exata
> `#copilot/model-gateway/readiness`; CLI e MCP consomem a mesma implementação. O worker de
> redaction também foi reduzido a entrypoint e delega ao serviço de domínio. A sonda read-only
> pós-migração retornou `ok=true` em ~7,8 s e o MCP passou de um `import()` computado de script para
> dependency estática de domínio. A convergência global de todos os casos de uso de `/byok`
> permanece aberta.

Escopo exclusivo: `src/copilot`

## 1. Propósito

Este documento é a referência canônica para:

- catálogo de provedores e modelos;
- BYOK e resolução de credenciais;
- descoberta, coleta, normalização e atualização de modelos;
- elegibilidade, capacidades, custo, saúde e avaliação;
- roteamento e seleção automática;
- criação de sessão e troca de modelo em runtime;
- superfícies de operação para humano e para a LLM-B;
- persistência, observabilidade, testes e segurança do Model Gateway.

Ele substitui os roadmaps anteriores como fonte de verdade para trabalho novo. Os guias anteriores
continuam úteis como histórico e playbooks especializados, mas seus checkboxes não definem mais o
estado atual.

### 1.1 Invariante normativa de continuidade de sessão

- trocar modelo, rota, provider, perfil ou upstream **não autoriza criar outra sessão**;
- a operação padrão preserva a sessão e seu histórico, inclusive quando exige rebind de provider;
- nova sessão só pode ser criada por solicitação humana ou da LLM-B explicitamente dedicada a criar
  nova sessão;
- ausência de capability para rebind vivo é falha estrutural explícita, nunca justificativa para
  handoff implícito;
- nenhuma superfície pode registrar uma troca de provider como concluída após executar somente
  `setModel()` no transporte antigo.

## 2. Regra de atualização contínua

Este arquivo deve ser atualizado no mesmo incremento que altera o código:

- um checkbox somente muda para `[x]` quando existe código e evidência verificável;
- trabalho parcial permanece `[ ]` e recebe uma nota de progresso;
- cada fase concluída registra os comandos e resultados na seção de evidências;
- regressões reabrem o checkbox correspondente;
- nenhum status de prontidão pode depender apenas de narrativa ou da existência de arquivos.

## 3. Método e evidências da auditoria

Foram inspecionados os fluxos de `model-gateway`, `sdk`, `agent`, `boot`, `presentation`,
`terminal`, `tools`, `infra` e `observability` relacionados a modelos. Também foram executadas
consultas operacionais e testes focados.

Baseline observado:

| Evidência                        | Resultado em 2026-06-15 |
| -------------------------------- | ----------------------- |
| Schema SQLite                    | versão 11               |
| Linhas do catálogo               | 40.913                  |
| Evidências de modelo             | 34.700                  |
| Projeções de modelo              | 1.320                   |
| Opções de rota                   | 1.865                   |
| Provedores                       | 77                      |
| Execuções de probe               | 1.313                   |
| Resultados de probe              | 75.171                  |
| Observações de saúde             | 96.332                  |
| Planos standby persistidos       | 0                       |
| Execuções live                   | 333                     |
| Data do snapshot JSON            | 2026-05-28              |
| Tools estáticas da LLM-B         | 111                     |
| Tools dedicadas ao Model Gateway | 0                       |

O baseline focado de testes executou 406 testes: 363 passaram e 43 falharam. Todas as falhas
ocorreram em `tests/unit/copilot/terminal/test_commands_byok.spec.js`, principalmente por códigos
ANSI e quebra de linhas incompatíveis com os contratos de saída esperados.

## 4. Veredito executivo

O projeto possui um subsistema avançado de ingestão, normalização, SQLite, probes, saúde, roteamento
e automação. Desde o baseline desta auditoria, ele também passou a ter um control plane de
aplicação, bindings canônicos, trocas transacionais de modelo e rota, ledgers duráveis e 16 tools
estruturadas para a LLM-B.

A autoridade ainda não está totalmente unificada: presets legados permanecem no adapter SDK e alguns
casos de uso continuam dentro do comando monolítico `/byok`. A prova live entre providers distintos
preservando o mesmo `sessionId` foi obtida no incremento 35. A etapa restante é ampliar a
compatibilidade de rebind, incluindo ingress dinâmico onde o SDK não aceitar configuração pública
suficiente.

Em termos práticos:

```text
estado atual
  dados, decisão e read model canônico
  + sessão consumindo SessionBindingPlan
  + model/route switch transacional e auditável
  + 16 tools de gestão para a LLM-B
  + overview com perfil, modelo efetivo e capabilities do runtime selecionado
  + prova live cross-provider same-session
  + dívida residual em presets, terminal e ingress dinâmico

estado ideal
  um ModelControlPlane
  -> mesma autoridade para terminal, runtime e LLM-B
  -> operações transacionais e auditáveis
  -> schemas fechados, dry-run, confirmação e idempotência
  -> catálogo e sessão coerentes
```

## 5. Arquitetura atual reconstruída

### 5.1 Catálogo e persistência

```text
importers e fontes
  -> normalização
  -> snapshot JSON
  -> SQLite v11
  -> projeções, probes, saúde, decisões e eventos operacionais
```

Essa parte é funcional e rica em evidências. Há importers, catálogos por provedor, specs, endpoints,
overlays de conta, políticas de elegibilidade, seleção runtime e ledgers operacionais.

### 5.2 Criação de sessão real

```text
boot / initializer
  -> lê modelGatewayActiveRoute persistida
  -> projeta binding explícito do provider selecionado
  -> resolveModelGatewaySessionBinding
  -> adapter do provider + secret registry allowlisted
  -> createSession ou resume/reattach do mesmo sessionId no GitHub Copilot SDK
```

Rotas selecionadas pelo gateway carregam `providerId` autoritativo e não dependem dos defaults
específicos da tabela legada de presets. Perfis e configuração BYOK definidos diretamente pelo
operador ainda passam pelo parser compatível do SDK; essa dívida permanece explícita até existir um
profile store canônico do gateway.

### 5.3 Listagem de modelos exposta ao SDK

```text
buildModelGatewayOnListModelsHandler
  -> identifica o provider BYOK ativo
  -> lê o catálogo consolidado
  -> filtra projeções pela elegibilidade e provider
  -> projeta route options para ModelInfo do SDK
  -> usa o snapshot env apenas como fallback compatível
```

Essa projeção já usa o catálogo consolidado e decisões de elegibilidade. Saúde live e visibilidade
por conta continuam representadas nas decisões/read models do gateway, não como promessa implícita
do `ModelInfo` vanilla do SDK.

### 5.4 Troca de modelo e rota em runtime

```text
terminal / tool / agent facade
  -> cria operação idempotente persistida
  -> solicita setModel ou reattach do mesmo sessionId
  -> verifica provider/model e identidade da sessão
  -> commita ou executa rollback
```

Timeout com desfecho de reattach desconhecido não dispara rollback concorrente: a operação termina
em falha com `reconciliationRequired=true`. Divergência de identidade rejeita a troca e restaura o
binding anterior.

### 5.5 Superfície operacional

```text
humano
  -> /byok e scripts/model-gateway/run.mjs

LLM-B
  -> 16 tools `model_gateway_*` com schemas fechados, envelope versionado e annotations
  -> overview agrega catálogo/readiness e capabilities públicas do runtime selecionado
```

A LLM-B já não depende de parsing do terminal para os casos cobertos pelo control plane. Ainda há
casos legados no comando `/byok` que precisam migrar para serviços compartilhados.

## 6. Achados prioritários

### P0: bloqueadores de autoridade e segurança

#### MG-P0-001 — Autoridade dividida entre gateway e sessão

Evidência original:

- `agent/lifecycle/setup/session-setup.js` e `agent/session/initializers/initializer.js` resolvem
  BYOK pelo caminho legado;
- `sdk/session/provider.js` permanece a autoridade prática;
- o catálogo normalizado não governa o binding final.

Impacto: catálogo, roteamento e sessão podem discordar sobre provedor, modelo e elegibilidade.

Correção ideal: um serviço de aplicação `ModelControlPlane` deve produzir o único
`SessionBindingPlan` aceito pela camada de sessão.

Estado atual: parcialmente corrigido. Boot e session setup consomem
`resolveModelGatewaySessionBinding`; rotas selecionadas pelo gateway chegam como binding explícito e
passam pelos adapters canônicos. O parser legado permanece somente para perfis/env BYOK manuais e
para partes do contrato de resumo compatível.

#### MG-P0-002 — Troca runtime otimista e não transacional

Evidência:

- `agent/facades/agent-model-config.js` altera e persiste o modelo antes de receber resultado
  autoritativo;
- a chamada assíncrona é tratada como “despachada”, não como “confirmada”;
- mismatch e falha não restauram necessariamente o estado anterior.

Impacto: estado exibido, persistido e efetivamente ativo podem divergir.

Correção ideal: máquina de estados persistida:

```text
planned -> requested -> sdk_acknowledged -> verified -> committed
                                \-> failed -> rolled_back
                                \-> timed_out -> reconciled
```

#### MG-P0-003 — Contaminação de referências de segredo

Evidência: `registry/env-byok-compat-importer.js` associa ao provedor ativo todas as referências de
segredo configuradas no ambiente. O adapter compatível pode escolher a primeira referência
classificada, inclusive de outro provedor.

Impacto: ao tornar adapters vivos, autenticação pode usar a variável errada. Valores não são
persistidos, mas a seleção de referência ainda é um risco funcional e de isolamento.

Correção ideal: cada provider spec declara explicitamente suas referências permitidas e o importer
só projeta essas referências.

#### MG-P0-004 — Override de modelo pode atravessar boundary de provedor

Evidência: `resolveConfiguredByokSessionOverrides(env, requestedModel)` aceita um modelo concreto
solicitado e o projeta sobre o perfil selecionado sem validação canônica de pertencimento ao
provedor.

Impacto: um modelo persistido de outro provider ou do fluxo nativo pode ser aplicado a um endpoint
BYOK incompatível.

Correção ideal: validar o par `{providerId, providerModel}` no catálogo elegível antes de produzir o
binding.

#### MG-P0-005 — LLM-B sem API de gestão de modelos

Evidência: nenhuma das 111 tools estáticas é dedicada a catálogo, BYOK, avaliação, roteamento ou
troca.

Impacto: automação depende de shell, parsing de texto e conhecimento implícito do operador.

Correção ideal: tools estruturadas usando o mesmo control plane consumido pelas demais bordas.

#### MG-P0-006 — Mudança de provider era traduzida em nova sessão

Evidência:

- o initializer anulava o `savedSessionId` quando o binding BYOK divergia;
- a automação produzia `prepare_new_sdk_session` ao cruzar boundary de provider;
- standby recomendava `new_session_provider`;
- o terminal classificava a seleção como `next-boot-required`.

Impacto: troca de modelo/provider quebrava continuidade, identidade e naturalidade da sessão mesmo
quando `resumeSession(sessionId, { provider, model, modelCapabilities })` já permite reattach do
mesmo ID.

Correção canônica: tentar troca viva; quando o provider não puder ser rebindado no objeto vivo,
reanexar o mesmo `sessionId` com novo `SessionBindingPlan`. Falha de capability ou reattach é
explícita e nunca cria outra sessão.

### P1: coerência, operação e qualidade

#### MG-P1-001 — Adapters existem, mas não governam sessões

`ProviderAdapterRegistry`, `resolveModelGatewayProviderAdapter` e `toCopilotSessionOverrides` estão
implementados, porém não são o caminho vivo do binding. Isso preserva duplicação e torna a extensão
de providers dependente do arquivo monolítico de presets.

#### MG-P1-002 — `onListModels` projeta apenas compatibilidade de ambiente

O handler entregue ao SDK não representa o catálogo canônico nem os fatos de elegibilidade e saúde.
Coleta e atualização do catálogo não alteram necessariamente os modelos vistos pela sessão.

#### MG-P1-003 — Readiness permite snapshot obsoleto

`ops --json` reportou pronto apesar de o snapshot JSON ter sido gerado em 2026-05-28, sem gate de
idade, sem plano standby persistido e com confirmação recente de mismatch.

#### MG-P1-004 — Identidade de estatísticas é insuficiente

O registro em `sdk/models` usa principalmente o id do modelo. O mesmo id local pode existir em
provedores diferentes, causando colisão semântica em métricas, seleção e histórico.

#### MG-P1-005 — Tool factory falha aberta em conversão de schema

Falhas ao converter schema podem registrar uma tool sem `parameters`. Esse fallback não é aceitável
para operações de alto impacto como refresh, mudança de rota ou troca de modelo.

#### MG-P1-006 — Contrato das tools não possui output schema formal

O wrapper atual cobre input, descrição e permissões, mas não formaliza `outputSchema`, annotations
operacionais ou um envelope estruturado comum.

#### MG-P1-007 — Diagnóstico completo é caro para uso frequente

`ops --json` levou aproximadamente 60 segundos no banco atual, pois agrega leituras completas, scans
de redação e diagnósticos extensos. Isso é inadequado como chamada recorrente de tool.

#### MG-P1-008 — Ledgers sem política clara de retenção

O banco possui dezenas de milhares de probes e quase cem mil observações de saúde. Não há no caminho
auditado uma política operacional clara de compactação, retenção e agregados rápidos.

#### MG-P1-009 — Contrato de renderização BYOK está regressivo

O baseline focado apresenta 43 falhas por ANSI e wrapping. A saída humana pode continuar legível,
mas o contrato testado e qualquer automação textual ficam instáveis.

### P2: manutenção e governança

#### MG-P2-001 — Hotspots monolíticos

- `terminal/commands/byok.js`: cerca de 8.780 linhas;
- `model-gateway/catalog/sqlite-catalog-store.js`: cerca de 3.214 linhas;
- `sdk/session/provider.js`: cerca de 1.976 linhas;
- `model-gateway/routing/runtime-selector.js`: cerca de 1.838 linhas;
- `model-gateway/index.js`: 437 exports.

Esses hotspots elevam risco de regressão, dificultam ownership e tornam refactors transacionais mais
caros.

#### MG-P2-002 — Documentação anterior diverge do código e dela própria

Roadmaps antigos mantêm invariantes e critérios finais desmarcados enquanto seções narrativas
afirmam prontidão. Também há referências históricas ao schema v10, embora o runtime atual esteja em
v11.

#### MG-P2-003 — Semântica de expiração/depreciação precisa de contrato explícito

A inferência de alias e expiração diferencia datas futuras e passadas entre “deprecated” e
“retired”. Pode ser intencional, mas precisa de teste e documentação normativa para evitar
interpretação divergente.

## 7. Situação ideal

### 7.1 Um único control plane

Criar `src/copilot/model-gateway/control-plane/` com uma API de aplicação independente de terminal e
tools:

```text
ModelControlPlane
  inspectOverview(input)
  searchCatalog(input)
  planRoute(input)
  evaluateModels(input)
  planCatalogRefresh(input)
  applyCatalogRefresh(input)
  planModelSwitch(input)
  applyModelSwitch(input)
  applySameSessionRouteSwitch(input)
  reconcileModelSwitch(input)
  inspectOperation(input)
```

As três bordas passam a compartilhar esse serviço:

```text
terminal command  ─┐
LLM-B tool        ─┼─> ModelControlPlane -> domain ports -> SDK/runtime/storage
boot/session      ─┘
```

### 7.2 Contratos centrais

`ModelIdentity`:

```text
gatewayModelId
providerId
providerModel
catalogSnapshotId
profileId?
accountId?
```

`SessionBindingPlan`:

```text
bindingId
modelIdentity
endpoint
authRef
headers
capabilities
eligibilityEvidence
routeDecisionId
expiresAt
```

`ModelSwitchOperation`:

```text
operationId
idempotencyKey
fromBinding
toBinding
state
requestedAt
verifiedAt?
failure?
rollback?
```

`SameSessionRouteSwitchOperation`:

```text
operationId
sessionId imutável
fromBinding
toBinding
mode = live_rebind | same_session_reattach
requiresNewSession = false
state
verification
rollback
```

### 7.3 Invariantes

- Nenhuma sessão recebe modelo sem identidade de provider validada.
- Nenhum segredo é escolhido fora da allowlist do provider spec.
- Nenhum estado de modelo é persistido como ativo antes da verificação do SDK.
- Nenhuma mudança de modelo, rota ou provider cria outra sessão implicitamente.
- Reattach deve retornar exatamente o mesmo `sessionId`; divergência aciona rollback.
- Catálogo, decisão de rota, binding e confirmação compartilham correlation ids.
- Operações mutáveis suportam `dryRun`, `idempotencyKey` e confirmação explícita.
- `/restart` reinicia só a conversa; não muda provider, modelo nem identidade da sessão viva.
- Tools nunca recebem comandos shell arbitrários.
- Outputs são limitados, paginados, redigidos e versionados.
- Readiness distingue saúde estrutural, freshness, capacidade de fallback e divergência runtime.

## 8. Tools da LLM-B

### 8.1 Princípios de schema

Os contratos seguem três referências:

- GitHub Copilot SDK: tools declaradas com schema tipado e handler explícito;
- MCP Tools 2025-11-25: `inputSchema`, `outputSchema`, title e annotations;
- OpenAI function calling: objetos fechados, propriedades requeridas e validação estrita.

Como o SDK instalado não transmite todos os metadados MCP, a implementação local deve:

- usar JSON Schema fechado com `additionalProperties: false`;
- tornar todos os campos explícitos, usando `null` quando opcional;
- registrar `outputSchema` e annotations no metadado local;
- devolver um envelope JSON estruturado mesmo quando o transporte final for texto;
- falhar fechado se o schema não puder ser normalizado;
- separar tools read-only de tools mutáveis.

Envelope de saída:

```json
{
  "schemaVersion": "model-gateway.tool-result.v1",
  "operation": "catalog.search",
  "ok": true,
  "status": "completed",
  "dryRun": false,
  "data": {},
  "warnings": [],
  "errors": [],
  "nextActions": [],
  "observedAt": "2026-06-15T00:00:00.000Z"
}
```

### 8.2 Catálogo inicial de tools

| Tool                              | Natureza                   | Finalidade                                                                   |
| --------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `model_gateway_overview`          | read-only                  | resumo rápido, freshness, divergências, saúde e capabilities live do runtime |
| `model_gateway_catalog_search`    | read-only                  | busca paginada por provider, modelo, capability e status                     |
| `model_gateway_route_plan`        | read-only                  | explica candidatos, exclusões, ranking e fallback                            |
| `model_gateway_model_evaluate`    | read-only/network opcional | avaliação declarativa e comparável                                           |
| `model_gateway_policy_propose`    | read-only                  | propõe política revisável sem qualquer caminho de aplicação                  |
| `model_gateway_probe_plan`        | read-only                  | compõe shortlist, backoff/rate-limit e orçamento de probes                   |
| `model_gateway_probe_execute`     | mutável/network            | planeja ou executa uma sonda descartável confirmada e idempotente            |
| `model_gateway_catalog_refresh`   | mutável                    | planeja ou aplica coleta e atualização                                       |
| `model_gateway_model_switch`      | mutável                    | planeja ou aplica troca transacional                                         |
| `model_gateway_route_switch`      | mutável/network            | aplica rebind transacional preservando o mesmo `sessionId`                   |
| `model_gateway_operation_status`  | read-only                  | acompanha operação e confirmação                                             |
| `model_gateway_runtime_reconcile` | mutável                    | reconcilia mismatch, timeout e rollback                                      |
| `model_gateway_maintenance`       | mutável                    | retenção, compactação e validação controladas                                |

As descriptions devem explicar à LLM-B:

- quando usar a tool;
- quando não usar;
- efeitos e necessidade de confirmação;
- diferença entre planejar e aplicar;
- limites de saída;
- como interpretar warnings e próximos passos.

## 9. Roadmap executável

### Faixa 0 — Auditoria e governança

#### 0.1 Inventário

- [x] Mapear módulos e hotspots de Model Gateway, BYOK, SDK, agent, terminal e tools.
- [x] Reconstruir o fluxo real de criação de sessão.
- [x] Reconstruir o fluxo real de troca runtime.
- [x] Medir catálogo, SQLite, probes, saúde, decisões e execuções live.
- [x] Executar baseline focado de testes.
- [x] Comparar os schemas de tools com GitHub Copilot SDK, MCP e OpenAI.

#### 0.2 Documento canônico

- [x] Registrar situação atual, situação ideal, bugs, gaps e upgrades.
- [x] Criar roadmap booleano continuamente atualizável.
- [x] Atualizar hubs e marcar referências anteriores como históricas.
- [x] Manter log de evidências após cada incremento.

### Faixa A — Segurança e invariantes de provider

#### A.1 Segredos

- [x] Criar allowlist de referências de segredo por provider spec.
- [x] Impedir que o importer associe segredos de outros providers.
- [x] Corrigir detecção de headers configurados.
- [x] Adicionar diagnóstico redigido de referência ausente, ambígua ou inválida.
- [x] Cobrir múltiplos providers simultaneamente configurados.

#### A.2 Identidade e boundary

- [x] Introduzir `ModelIdentity` canônico.
- [x] Validar pertencimento de `providerModel` ao provider antes do binding.
- [x] Bloquear override persistido incompatível com o provider selecionado.
- [x] Incluir provider/profile/snapshot na identidade de métricas.
- [x] Formalizar semântica de deprecated, expiry e retired.

### Faixa B — Control plane e read model

#### B.1 Serviço de aplicação

- [x] Criar `model-gateway/control-plane`.
- [x] Definir ports para catálogo, rota, sessão, segredos e persistência.
- [x] Implementar overview rápido sem scan integral.
- [x] Implementar busca paginada e limitada do catálogo.
- [x] Implementar route plan explicável e sem efeitos.
- [x] Implementar consultas de operação por correlation id.

#### B.2 Autoridade

- [x] Definir `SessionBindingPlan`.
- [x] Fazer adapters produzirem bindings canônicos.
- [ ] Eliminar dependência de presets monolíticos para providers migrados.
  - [x] Fazer rotas selecionadas pelo gateway usarem binding explícito e `providerId` autoritativo.
  - [x] Neutralizar defaults específicos de preset no caminho de rota persistida.
  - [ ] Migrar perfis/env BYOK manuais para um profile store canônico do gateway.
    - [x] Criar store read-only redigido para identidade, inventário e diagnóstico.
    - [x] Materializar perfil ativo em env explícito `gateway_profile` antes da borda SDK.
    - [x] Fazer binding de sessão, importer e probe execute consumirem a materialização canônica.
    - [x] Migrar inventário/status principal do terminal para summaries do profile store.
    - [x] Migrar ativação de perfil do processo para uma mutação do profile store.
    - [x] Migrar criação/edição estrutural de perfis para uma porta mutável do store.
    - [x] Migrar usos avançados de descoberta/custo que ainda leem o JSON cru de perfis.
    - [x] Validar refs de segredo em novas escritas sem quebrar leitura de perfis legados.
- [x] Projetar o catálogo elegível no `onListModels`.
- [x] Manter fallback de compatibilidade explícito e observável durante migração.

### Faixa C — Troca runtime transacional

#### C.1 Máquina de estados

- [x] Definir `ModelSwitchOperation` e estados válidos.
- [x] Persistir operação pendente antes do efeito.
- [x] Aguardar acknowledgement e verificação do SDK.
- [x] Commitar estado desejado somente após confirmação.
- [x] Implementar timeout e reconciliação.
- [x] Implementar rollback ao binding anterior.
- [x] Tornar requests idempotentes.

#### C.2 Integração runtime

- [ ] Migrar `agent-model-config` para o control plane.
  - [x] Mover replay, operation id, recorder e state machine da troca transacional para o
        control-plane.
  - [x] Retirar o setter otimista dos fluxos reais de `/model` e confirmação da rota SDK.
  - [x] Redesenhar fallback interno do dialog loop para usar a troca transacional.
  - [ ] Remover adapters de compatibilidade restantes fora da composição real.
- [x] Migrar o fluxo `/byok` para a operação transacional.
- [x] Correlacionar eventos SDK, decisão, handoff e confirmação.
- [x] Tratar sessão ausente, encerrada ou sem suporte a troca.
- [x] Remover a regra de que mudança de provider exige nova sessão.
  - [x] Route plan preserva a sessão e sinaliza `providerRebindRequired`.
  - [x] Automação deixa de produzir efeito `prepare_new_sdk_session` por inferência de rota.
  - [x] Standby deixa de recomendar `new_session_provider`.
  - [x] Capability ausente é reportada como `live_provider_rebind_capability_missing`.
- [ ] Implementar rebind transacional de provider na sessão viva.
  - [x] Definir contrato canônico que preserva sessão e nunca usa nova sessão como fallback.
  - [x] Implementar state machine genérica de route switch com identidade de sessão imutável e
        rollback.
  - [x] Fazer mudança de binding no initializer tentar reattach do mesmo `sessionId` em modo
        fail-closed.
  - [ ] Criar ingress/proxy dinâmico do Model Gateway para providers que o SDK não consegue rebindar
        publicamente.
  - [x] Integrar resolução de secrets, wire API, headers e model capabilities ao rebind.
  - [x] Implementar confirmação, rollback e reconciliação do provider efetivo.
  - [x] Migrar tool, terminal e automação para o mesmo executor de troca de rota viva.
  - [x] Provar troca live entre providers distintos mantendo o mesmo `sessionId`.

### Faixa D — Readiness, freshness e fallback

#### D.1 Contrato de prontidão

- [x] Separar readiness estrutural, operacional e live.
- [x] Adicionar idade máxima configurável do snapshot.
- [x] Bloquear “ready” quando houver mismatch não reconciliado.
- [x] Validar existência e validade do fallback/standby.
- [x] Expor razões estruturadas e ações recomendadas.
- [x] Converter erro bruto `error` do SDK/client em evento rastreável, sem `uncaughtException`.

#### D.2 Retenção e performance

- [x] Criar agregados rápidos para overview e tools.
- [x] Definir retenção por ledger.
- [x] Implementar compactação com dry-run e limites.
- [x] Evitar leitura integral do JSON para consultas rotineiras.
- [x] Estabelecer orçamento de latência para overview e route plan.

### Faixa E — Fundação das tools

#### E.1 Contratos

- [x] Criar schemas fechados e reutilizáveis.
- [x] Criar envelope de resultado versionado.
- [x] Registrar output schema e annotations locais.
- [x] Adicionar modo estrito/fail-closed ao tool factory.
- [x] Validar schemas no contract verifier.
- [x] Redigir secrets, headers e dados de conta em todos os outputs.

#### E.2 Tools read-only

- [x] Implementar `model_gateway_overview`.
  - [x] Projetar capabilities reais de troca do runtime selecionado no overview.
  - [x] Permitir targeting por `runtimeId` e expor modelo efetivo/estatísticas.
  - [x] Expor inventário redigido e perfil BYOK ativo pelo profile store do gateway.
- [x] Implementar `model_gateway_catalog_search`.
- [x] Implementar `model_gateway_route_plan`.
- [x] Implementar `model_gateway_operation_status`.
- [x] Implementar `model_gateway_model_evaluate`.
- [x] Implementar `model_gateway_policy_propose`.
- [x] Implementar `model_gateway_probe_plan`.
- [x] Documentar exemplos positivos, limites e contraindicações.

### Faixa F — Tools mutáveis e automação

#### F.1 Mutação segura

- [x] Implementar `model_gateway_catalog_refresh` com plan/apply.
- [x] Implementar `model_gateway_model_switch` com plan/apply.
- [x] Implementar `model_gateway_route_switch` com plan/apply e identidade de sessão imutável.
- [x] Implementar `model_gateway_runtime_reconcile`.
- [x] Implementar `model_gateway_maintenance`.
- [x] Implementar `model_gateway_probe_execute` com plan/apply.
- [x] Exigir confirmação explícita para efeitos irreversíveis ou de rede.
- [x] Registrar actor, correlation id, idempotency key e resultado.

#### F.2 Avaliação e ciclo de catálogo

- [x] Implementar coleta incremental por provider.
- [x] Implementar diff entre snapshots.
- [x] Implementar avaliação por capabilities, custo, contexto e saúde.
- [x] Implementar probes controlados com orçamento e rate limit.
  - [x] Compor planejamento read-only com shortlist, rate-limit/cooldown, tipos permitidos e
        orçamento de custo/quantidade.
  - [x] Expor execução autorizada, descartável, auditada e com confirmação explícita.
- [x] Implementar promoção/rebaixamento de elegibilidade por evidência.
- [x] Permitir que a LLM-B proponha, mas não silenciosamente aplique, mudança de política.

### Faixa G — Convergência das superfícies

#### G.1 Terminal e LLM-B

- [ ] Fazer terminal e tools chamarem o mesmo serviço de aplicação.
  - [x] Terminal e tool de probes usam `executeModelGatewayProbe`.
  - [x] `/model`, `/byok model` e tools usam a troca transacional do control-plane.
  - [x] Tool, `/byok provider`, `/byok use` e automação usam o mesmo executor de route switch.
  - [x] CLI live-readiness e MCP usam `#copilot/model-gateway/readiness`; `scripts/` ficou apenas
        como launcher/worker entrypoint e não contém mais a implementação canônica do caso de uso.
  - [ ] Migrar os demais casos de uso ainda implementados diretamente em
        `terminal/commands/byok.js`.
- [ ] Remover parsing textual como requisito de automação.
- [x] Corrigir ANSI/wrapping nos contratos BYOK.
- [x] Unificar a semântica de `/restart` como conversa-only nas ajudas, cockpit e hints de boundary.
- [ ] Decompor `terminal/commands/byok.js` por caso de uso.
- [ ] Preservar UX humana sem criar uma segunda semântica.

#### G.2 SDK e boot

- [x] Fazer criação e resume de sessão consumirem `SessionBindingPlan`.
- [ ] Preservar defaults e capabilities vanilla do GitHub Copilot SDK.
- [x] Validar `onListModels` contra o mesmo read model.
- [ ] Remover caminhos legados após telemetria provar migração.

### Faixa H — Testes, live e chancela

#### H.1 Testes automatizados

- [x] Zerar o baseline focado de falhas.
- [x] Cobrir isolamento de segredos entre providers.
- [x] Cobrir provider/model incompatível.
- [x] Cobrir sucesso, falha, timeout e rollback de switch.
- [x] Cobrir schemas estritos e rejeição de propriedades extras.
- [x] Cobrir paginação e limites de output.
- [x] Cobrir freshness e readiness.
- [x] Cobrir idempotência de mutações.
- [x] Cobrir identidade imutável, timeout incerto e replay da troca de rota.

#### H.2 Testes live autorizados

- [x] Executar diagnóstico SQLite e integridade.
- [ ] Executar refresh controlado sem exposição de segredo.
- [x] Executar route plan contra catálogo real.
- [x] Executar troca live e confirmar modelo efetivo.
- [ ] Executar falha induzida e confirmar rollback.
- [ ] Executar reconciliação após mismatch.
- [x] Registrar custo, duração, provider e evidência redigida.

#### H.3 Encerramento

- [x] Executar typecheck estrito focado em `src/copilot`.
- [x] Executar lint focado em `src/copilot`.
- [x] Executar testes focados do domínio.
- [x] Executar auditoria de referências legadas.
- [x] Atualizar este roadmap com todas as evidências finais.
- [ ] Declarar o control plane pronto para humano e LLM-B.

## 10. Critérios de aceite finais

- [ ] Catálogo elegível e sessão real concordam sobre provider e modelo.
- [x] Nenhuma troca é publicada como ativa antes de verificação.
- [x] Toda troca falha de forma determinística ou executa rollback.
- [x] Nenhuma referência de segredo cruza boundary de provider.
- [x] LLM-B coleta, consulta, avalia, planeja e opera por tools estruturadas.
- [x] Tools mutáveis têm dry-run, confirmação, idempotência e auditoria.
- [x] Readiness falha para snapshot obsoleto ou mismatch pendente.
- [ ] Terminal e tools compartilham casos de uso, sem semânticas paralelas.
- [ ] O caminho vanilla do GitHub Copilot SDK continua preservado.
- [ ] Testes focados e live autorizados passam sem exposição de segredo.

## 11. Log de evidências

### 2026-06-15 — baseline de auditoria

- [x] `node scripts/model-gateway/run.mjs sqliteDiagnostics --json`
  - schema v11;
  - catálogo e ledgers íntegros o suficiente para leitura;
  - nenhum plano standby persistido.
- [x] `node scripts/model-gateway/run.mjs catalogIntegrity --json`
  - sem chaves duplicadas;
  - sem identidade redigida inválida;
  - snapshot gerado em 2026-05-28.
- [x] `node scripts/model-gateway/run.mjs ops --json`
  - comando concluiu com sucesso;
  - readiness atual não bloqueou snapshot antigo;
  - duração aproximada de 60 segundos.
- [x] Baseline Vitest focado
  - 406 testes;
  - 363 passaram;
  - 43 falharam no contrato de renderização BYOK.
- [x] Inventário de tools
  - 111 tools estáticas;
  - nenhuma tool dedicada ao Model Gateway.

### 2026-06-15 — incremento 1: segurança e tools read-only

- [x] Isolamento de referências de segredo
  - OpenRouter configurado em conjunto com Anthropic projetou somente `OPENROUTER_API_KEY`;
  - headers customizados foram redigidos e `headersConfigured=true`;
  - valores de segredo não apareceram na projeção.
- [x] Control plane read-only
  - overview detectou `snapshot_stale`, `runtime_model_mismatch` e `standby_plan_missing`;
  - busca retornou três resultados elegíveis e limitados;
  - route plan retornou candidato, rejeições e fallback com `dryRun=true`;
  - status retornou decisões, handoffs e confirmações recentes.
- [x] Contrato de tools
  - total de tools estáticas passou de 111 para 115;
  - quatro tools do Model Gateway registradas;
  - zero erro, zero warning e zero violação de schema estrito no contract verifier.
- [x] Validação automatizada
  - typecheck estrito de `src/copilot`: passou;
  - ESLint focado: passou;
  - Vitest focado: 247/247 passaram.

### 2026-06-15 — incremento 2: mutações transacionais e ciclo de catálogo

- [x] Troca runtime transacional
  - estados persistidos: `planned`, `requested`, `sdk_acknowledged`, `verified` e `committed`;
  - mismatch induzido terminou em `rolled_back` e restaurou o modelo anterior;
  - replay com a mesma idempotency key não repetiu o efeito já concluído.
- [x] Tools de operação e avaliação
  - `model_gateway_model_switch` exige confirmação em `apply`;
  - `model_gateway_catalog_refresh` separa `plan` sem rede de `apply` com confirmação;
  - `model_gateway_model_evaluate` retornou score, elegibilidade e razões por candidato;
  - inventário estático passou a 118 tools, sendo sete dedicadas ao Model Gateway.
- [x] Refresh e avaliação
  - plano selecionou somente `openrouter-models`, vencido por TTL, sem chamada de rede;
  - avaliação distinguiu modelo elegível comprovado de modelo permitido apenas para probe.
- [x] Validação automatizada
  - typecheck estrito e ESLint focado: passaram;
  - baterias focadas intermediárias: 37/37, 244/244, 247/247 e 276/276 passaram.

### 2026-06-15 — incremento 3: autoridade de sessão e boundary

- [x] Catálogo e binding
  - `onListModels` projetou 355 modelos OpenRouter elegíveis do catálogo canônico;
  - fallback para snapshot env compat permanece explícito quando não há projeção canônica;
  - modelo ativo explícito passou a ser materializado no snapshot compat do provider.
- [x] Session binding via adapters
  - criação e resume de sessão consomem o binding do gateway pela porta de configuração;
  - OpenRouter foi ligado pelo adapter `openrouter`, com headers de atribuição e somente sua API
    key;
  - override `anthropic/claude` em profile OpenRouter foi bloqueado e o modelo válido permaneceu
    efetivo.
- [x] Validação automatizada
  - typecheck estrito de `src/copilot`: passou;
  - ESLint focado: passou;
  - Vitest focado de provider, binding, initializer e contratos: 278/278 passaram.

### 2026-06-15 — incremento 4: readiness e operação assistida

- [x] Readiness estratificada
  - overview separa prontidão estrutural, operacional e live;
  - snapshot com 433,75 horas, mismatch runtime e standby inválido bloquearam o estado global;
  - ações recomendadas retornadas: refresh planejado, reconciliação e geração de standby.
- [x] Tools operacionais
  - `model_gateway_runtime_reconcile` usa a mesma troca transacional e evita efeito quando já
    convergido;
  - `model_gateway_maintenance` limita-se aos ledgers SQLite e protege 40.913 linhas canônicas;
  - plano de manutenção com limite 50.000 identificou mais de 71 mil linhas candidatas sem aplicar
    deleção.
- [x] Validação automatizada
  - inventário do Model Gateway: nove tools estruturadas;
  - typecheck estrito e ESLint focado: passaram;
  - Vitest focado de contratos, verifier, provider e binding: 283/283 passaram.

### 2026-06-15 — incremento 5: chancela ampla e live LLM-B

- [x] Contratos e arquitetura
  - inventário estático final: 120 tools, sendo nove do Model Gateway;
  - verifier das nove tools: zero erro, zero warning e zero violação strict;
  - runtime-control das tools passou a ser injetado pela composition root;
  - gates de arquitetura, soberania, terminal, contratos, provider e binding: 413/413 passaram.
- [x] Validação ampla
  - typecheck estrito de `src/copilot`: passou;
  - `lint:copilot`: passou;
  - baseline focado do Model Gateway: contratos 219/219 e terminal BYOK 119/119;
  - suíte Copilot ampla: 6.757/6.799 passaram na primeira execução; duas falhas arquiteturais
    introduzidas no incremento foram corrigidas e revalidadas;
  - permanecem sete contratos amplos fora do baseline focado: quatro de bootstrap/toggle em
    `session-setup`, um que espera o override incompatível `gpt-4` dentro do provider Kilo e dois
    que esperam contagem sem o modelo ativo.
- [x] Diagnóstico live read-only
  - SQLite schema v11 e integridade do catálogo passaram;
  - 40.913 linhas canônicas, 1.320 projeções, 1.865 rotas e zero duplicatas;
  - snapshot canônico ainda é de 2026-05-28, standby persistido continua zero e a confirmação mais
    recente é mismatch;
  - o cockpit legado `ops` ainda reporta readiness própria como `ok`, enquanto o novo overview
    bloqueia corretamente: gap de convergência permanece aberto.
- [x] Live LLM-B
  - `node scripts/model-gateway/run.mjs llmBLiveTest --json` concluiu `PASS` em 74,715 segundos;
  - sessão BYOK Kilo abriu com 120 tools e zero erro terminal/SSE;
  - telemetria reportou custo LLM `0.0000` para o cenário;
  - chamadas SDK reais `report_intent`, `read_file_content` e `ask_user` foram observadas e
    correlacionadas;
  - ask/answer, export, SSE e encerramento limpo passaram; artefato:
    `artifacts/terminal-live/2026-06-15T02-43-24-142Z/summary.md`.
- [x] Auditoria de dívida residual
  - 43 referências legadas relacionadas a resolver/setters de modelo ainda existem no escopo
    analisado;
  - elas permanecem como migração controlada, não como justificativa para remover os novos
    invariantes.

### 2026-06-15 — incremento 6: identidade e diagnóstico seguro

- [x] `ModelIdentity` canônico
  - identidade versionada inclui canonical id, provider, provider model, route profile, provider
    profile e snapshot;
  - bindings de sessão e resultados de avaliação agora carregam a identidade;
  - decisões de rota propagam identity key, provider profile e snapshot para trace attributes quando
    disponíveis.
- [x] Diagnóstico redigido de segredos
  - overview expõe apenas nomes de referências permitidas/configuradas, nunca valores;
  - ambiente com OpenRouter e Anthropic simultâneos manteve somente `OPENROUTER_API_KEY` no binding
    ativo;
  - diagnóstico induzido detectou duas API keys OpenRouter como ambíguas e `ANTHROPIC_API_KEY` como
    ref inválida.
- [x] Validação automatizada
  - typecheck estrito e lint focado: passaram;
  - bateria focada de contratos, provider, binding, initializer e arquitetura: 283/283 passou antes
    da propagação de métricas; contrato exato de trace foi preservado para callers sem contexto de
    profile/snapshot.

### 2026-06-15 — incremento 7: timeout e reconciliação determinística

- [x] Limite temporal de troca
  - troca e rollback usam timeout explícito, com default de 30 segundos;
  - timeout registra fase e duração no erro operacional;
  - operação marca necessidade de reconciliação quando o resultado efetivo permanece incerto.
- [x] Prova de timeout
  - troca alvo induzida a não responder expirou em 10ms;
  - rollback ao modelo anterior foi verificado e terminou em `rolled_back`;
  - nenhum estado desejado foi commitado antes da confirmação.
- [x] Validação automatizada
  - typecheck estrito e lint focado: passaram;
  - contratos, arquitetura, provider e terminal BYOK: 399/399 passaram.

### 2026-06-15 — incremento 8: lifecycle canônico e redaction central

- [x] Semântica de lifecycle
  - `active`, `deprecated`, `expired` e `retired` têm contrato canônico versionado;
  - elegibilidade usa o helper canônico: `retired` e `expired` bloqueiam, `deprecated` penaliza,
    `preview` permanece aviso suave compatível;
  - avaliação de modelos inclui lifecycle derivado no output.
- [x] Redaction central das tools
  - todas as tools `model_gateway_*` serializam o resultado via `redactModelGatewayAuditedValue`;
  - valores presentes em envs sensíveis são coletados só para remoção do output, sem exposição;
  - diagnóstico de segredos continua retornando apenas nomes de refs e classes de problema.
- [x] Validação automatizada
  - typecheck estrito de `src/copilot`: passou;
  - ESLint focado nos arquivos alterados: passou;
  - contratos funcionais focados: 411/411 passaram;
  - gates arquiteturais isolados com timeout ampliado: 11/11 passaram;
  - `model-gateway:lint` amplo ficou preso localmente e foi interrompido sem saída de erro; a
    evidência usada é o lint focado nos arquivos do incremento.

### 2026-06-15 — incremento 9: metadados operacionais das tools mutáveis

- [x] Auditoria de operação
  - tools mutáveis registram `operationMeta` com actor `llm-b`, source, correlation id, idempotency
    key e resultado esperado;
  - `model_gateway_catalog_refresh` usa a idempotency key como correlation id;
  - `model_gateway_maintenance` registra correlation id determinístico por limite de retenção.
- [x] Validação automatizada
  - typecheck estrito e ESLint focado: passaram;
  - contratos, terminal BYOK, verifier e gates arquiteturais: 354/354 passaram;
  - prova direta de `operationMeta` em refresh e manutenção dry-run passou.

### 2026-06-15 — incremento 10: proposta consultiva de política

- [x] `model_gateway_policy_propose`
  - tool read-only com input/output schemas fechados, annotations e instruções explícitas para a
    LLM-B;
  - combina política efetiva, patch proposto, validação canônica, evidência de rota e avaliação
    opcional de shortlist;
  - expõe riscos, rationale, campos alterados e presets disponíveis;
  - sempre retorna `dryRun=true`, `application.supported=false` e não possui modo ou handler de
    aplicação.
- [x] Prova direta e validação automatizada
  - proposta `higher_reliability` para `repo_agent` retornou status `proposed`, validação válida e
    rota selecionada;
  - typecheck estrito e ESLint focado: passaram;
  - contratos de Model Gateway e verifier de tools: 224/224 passaram;
  - `git diff --check -- src/copilot`: passou.

### 2026-06-15 — incremento 11: plano de probes orçado e consciente de rate-limit

- [x] `model_gateway_probe_plan`
  - aceita shortlist explícita ou deriva candidatos do último diff de catálogo;
  - compõe recomendações de capabilities com backoff por rate-limit/cooldown e, depois, orçamento
    por quantidade, custo estimado e tipos permitidos;
  - expõe candidatos adiados, itens omitidos e comandos apenas como evidência revisável;
  - sempre retorna `dryRun=true`, `execution.supported=false` e não chama providers nem cria sessão.
- [x] Prova direta e validação automatizada
  - shortlist real de Kimi gerou duas recomendações prontas, selecionou duas sondas pelo limite e
    omitiu as demais;
  - typecheck estrito e ESLint focado: passaram;
  - contratos de Model Gateway e verifier de tools: 224/224 passaram.
- [x] Próxima etapa de probes
  - migrar o terminal legado para o executor comum sem quebrar seus adapters e mocks;
  - manter a convergência terminal/tools aberta até essa etapa.

### 2026-06-15 — incremento 12: execução controlada e idempotente de probes

- [x] Executor canônico descartável
  - `executeModelGatewayProbe` seleciona a família de sonda, aplica admissão conservadora por
    envelope SDK, grava health operacional e persiste run/result redigidos no SQLite;
  - operation id é derivado de idempotency key e replay consulta o run persistido antes de qualquer
    nova chamada;
  - `operation_status` encontra runs de probe pelo mesmo operation id;
  - o resultado persistido não contém resposta do modelo, prompt, segredo ou header.
- [x] Convergência terminal/tools para probes
  - `/byok probe` e shortlist preservam parsing, renderer e UX humana, mas delegam execução ao mesmo
    `executeModelGatewayProbe` usado pela tool;
  - terminal injeta runner, admissão, health recorder e event builder pelos ports do executor;
  - lifecycle, persistência do run e evento estabilizado deixaram de ser recalculados no comando
    terminal;
  - gates terminal e arquitetura após a migração: 130/130 passaram.
- [x] `model_gateway_probe_execute`
  - `plan` reaplica orçamento de custo/quantidade, tipos permitidos e backoff;
  - `apply` exige aprovação e `confirm=true`, resolve o `SessionBindingPlan` e bloqueia divergência
    de provider;
  - replay idempotente ocorre antes do novo preflight para não ser bloqueado pelo cooldown criado
    pela primeira execução;
  - a tool nunca troca a sessão viva.
- [x] Provas locais e validação
  - executor injetado executou uma única vez e retornou replay na segunda chamada com o mesmo
    operation id;
  - admissão bloqueou limite de 4.096 tokens e permitiu limite de 128.000;
  - tool retornou plano autorizado e bloqueou `apply` sem confirmação;
  - typecheck estrito, ESLint focado, contratos Model Gateway, verifier e terminal BYOK: 343/343
    passaram.
- [x] Prova live controlada
  - probe `chat` descartável para `kilo/moonshotai/kimi-k2.6:free` foi autorizado e tentou o
    provider;
  - a chamada falhou após 17.021ms, sem produzir prova positiva, e foi registrada como falha
    redigida;
  - repetição com a mesma idempotency key retornou replay persistido sem segunda chamada ao
    provider;
  - o resultado não expôs o conteúdo de erro, segredo, header ou resposta do modelo;
  - esta falha live permanece evidência operacional a investigar, não é contada como teste live
    aprovado.

### 2026-06-15 — incremento 13: composição transacional de troca no control-plane

- [x] `executeModelGatewayRuntimeModelSwitch`
  - serviço de aplicação canônico passou a controlar operation id, replay persistido, recorder
    SQLite e state machine;
  - SDK switch e commit do estado do runtime são ports injetados;
  - ausência de sessão retorna falha estruturada e operation id determinístico quando há idempotency
    key.
- [x] `agent-model-config`
  - facade transacional deixou de instanciar store, procurar replay, construir recorder ou chamar
    diretamente o state machine;
  - facade agora fornece somente sessão SDK, reasoning e commit do estado do agente;
  - setter síncrono/otimista legado permanece aberto para migração de config/server.
- [x] Prova direta e validação
  - duas chamadas com a mesma chave executaram uma troca e um commit; a segunda retornou replay;
  - cenário sem sessão retornou `MODEL_SWITCH_SESSION_UNAVAILABLE` com operation id determinístico;
  - typecheck estrito, ESLint focado, contratos de agente, Model Gateway e arquitetura: 244/244
    passaram.

### 2026-06-15 — incremento 14: remoção de troca otimista nas superfícies reais

- [x] `/model`
  - comando passou a preferir `switchTerminalModelProjection`, com idempotency key e source;
  - operação não commitada é mostrada como falha e não é publicada como modelo alterado;
  - fallback para setter legado existe somente para adapters/mocks parciais de compatibilidade.
- [x] Rota SDK `POST /sessions/:id/model`
  - depois de `setSessionModel` verificado, a rota agora observa a confirmação no runtime;
  - removida a segunda chamada indireta de troca que ocorria via `setRuntimeModelProjection`;
  - setter otimista foi removido do port exposto pela rota.
- [x] Validação
  - typecheck estrito e ESLint focado: passaram;
  - comandos config, rotas SDK, targeting, ownership e arquitetura: 64/64 passaram antes do ajuste
    final de tipo;
  - repetição focada de config e rotas SDK após o ajuste: 53/53 passou.

### 2026-06-15 — incremento 15: budgets observáveis de latência

- [x] Contrato de latência
  - overview declara budget canônico de 1.000ms;
  - route plan declara budget canônico de 3.000ms;
  - ambos retornam `elapsedMs`, `budgetMs`, `withinBudget` e warning estruturado quando excedidos.
- [x] Medição real
  - overview: 3.942ms, acima do budget;
  - route plan `repo_agent`: 3.615ms, acima do budget, com rota ainda selecionada;
  - o excesso de latência é reportado sem transformar resposta funcional em falso erro.
- [x] Validação
  - typecheck estrito e ESLint focado: passaram;
  - contratos Model Gateway e verifier: 224/224 passaram.

### 2026-06-15 — incremento 16: read model SQLite focado e inicialização idempotente

- [x] Remoção da leitura JSON integral no caminho rotineiro
  - search, route plan, avaliação e probe plan usam `readRoutingSnapshot` SQLite;
  - a projeção carrega somente sources, providers, models, rotas, overlays, elegibilidade e, quando
    solicitado, import runs;
  - evidências, raw payloads, conflitos e demais layers pesados não são materializados nessas
    consultas;
  - stores JSON injetados continuam suportados como fallback de teste/compatibilidade.
- [x] Inicialização SQLite idempotente
  - schema e migrations deixam de ser reaplicados para cada store sobre a mesma instância de DB;
  - overview caiu de 3.942ms para 123ms cold e 48–61ms warm.
- [x] Paridade e latência
  - JSON e SQLite focado concordaram no snapshot id e nas contagens: 1.320 projeções, 1.865 rotas e
    1.963 decisões;
  - route plan preservou o mesmo candidato selecionado;
  - route plan isolado ficou entre 2.617ms e 2.900ms, dentro do budget de 3.000ms;
  - sob carga paralela o warning de excesso continuou funcionando.
- [x] Validação
  - typecheck estrito e ESLint focado: passaram;
  - contratos Model Gateway, verifier e arquitetura: 235/235 passaram.

### 2026-06-15 — incremento 17: rebind transacional preservando a sessão

- [x] Invariante de continuidade
  - route plan retorna `sameSessionRequired=true`, `providerRebindRequired=true` quando necessário e
    `requiresNewSession=false`;
  - automação usa `switch_live_route`; o efeito legado `prepare_new_sdk_session` é rejeitado como
    `implicit_new_session_forbidden`;
  - preset canônico passou a ser `auto_same_session_route`, mantendo alias de leitura para
    configuração antiga.
- [x] Lifecycle e operação durável
  - initializer reaplica rota persistida e executa resume-only do mesmo `sessionId` quando o binding
    muda;
  - sessão reanexada recebe provider/model efetivos para verificação autoritativa;
  - state machine persiste `planned`, `reattach_requested`, `reattached`, `verified` e `committed`;
  - divergência de `sessionId` executa rollback; replay por idempotency key não repete o reattach;
  - timeout do reattach alvo não compete com rollback: termina em `failed`, sem rollback concorrente
    e com `reconciliationRequired=true`.
- [x] Superfícies convergentes
  - `model_gateway_route_switch` oferece `plan/apply`, confirmação, schema fechado, idempotência e
    instruções para LLM-B;
  - `/byok model`, `/byok provider`, `/byok use <perfil|sdk>` e auto mode delegam ao mesmo executor;
  - rota nativa `github-copilot-sdk/auto` desativa BYOK e preserva a identidade da sessão;
  - `providerProfile` preserva endpoint e resolução de credencial de perfis BYOK customizados
    durante rollback;
  - URLs de rota com credenciais embutidas ou protocolo não HTTP(S) são rejeitadas antes de
    persistência ou reattach.
- [x] Provas locais
  - commit preservou `session-stable`;
  - retorno de `replacement-session` foi rejeitado e terminou em `rolled_back`;
  - replay durável chamou o adapter uma única vez;
  - timeout induzido terminou em falha reconciliável sem rollback concorrente;
  - URL `https://user:secret@example.com/v1` foi rejeitada sem chamar o adapter;
  - route plan real selecionou `zai/glm-4.5-flash`, sinalizou rebind e manteve
    `requiresNewSession=false`;
  - verifier aprovou 13 tools do Model Gateway com zero erro, warning ou violação strict.
- [x] Validação automatizada e live sem turno
  - typecheck estrito, ESLint focado e `git diff --check -- src/copilot`: passaram;
  - baterias focadas executaram 365 testes: 356 passaram e nove preservam expectativas antigas de
    nova sessão, próximo boot ou nome legado do preset; os testes ficam fora do escopo editável
    `src/copilot`;
  - `llmBLiveTest --no-pr` terminou `PASS` em 32,855 segundos, retomou a mesma sessão, registrou 124
    tools e zero erro terminal/SSE;
  - artefato: `artifacts/terminal-live/2026-06-15T06-04-51-497Z/summary.md`.
- [x] Evidência live cross-provider
  - `llmBLiveTest --no-pr --byok-real --byok-real-route-profile=repo_agent --byok-real-route-execute --byok-real-route-allow-probe`
    confirmou reattach na mesma `sessionId` da sessão #1 enquanto trocava de `glm-4.5-flash` para
    `kilo-auto/free`;
  - o cockpit posterior mostrou `Rota viva confirmada na mesma sessão` e `BYOK status` refletindo o
    vínculo ativo;
  - o summary do harness ainda marcou alguns critérios legados como fail, mas a prova de troca viva
    e preservação de sessão ficou observável no terminal e no artefato;
  - artefato: `artifacts/terminal-live/2026-06-16T02-29-07-462Z/summary.md`.

### 2026-06-15 — incremento 18: ports explícitos, capability preflight e visão runtime da LLM-B

- [x] Ports do control plane
  - contratos runtime-validados cobrem leitura e escrita de catálogo, persistência de operações,
    registro de segredos e troca de rota da sessão;
  - composição inválida falha cedo com `MODEL_GATEWAY_PORT_INVALID`, em vez de produzir erro tardio
    durante uma mutação;
  - read model, catálogo, model switch, route switch e session binding consomem os ports explícitos.
- [x] Capability de troca live
  - troca cross-provider aceita reattach da mesma sessão independentemente de `setModel`;
  - troca same-provider aceita `setModel` transacional ou reattach da mesma sessão;
  - ausência das duas capacidades falha antes de persistência ou efeito, sempre com
    `requiresNewSession=false`;
  - runtime publica `sdk.model-switch` e `sdk.same-session-route-reattach`, incluindo
    `implicitNewSessionAllowed=false`.
- [x] Fallback do dialog loop
  - composição real usa `switchModelTransactional` e não expõe mais o setter otimista;
  - fallback só é consumido após estado `committed`;
  - falha ou rollback mantém o fallback pendente para retry e preserva idempotency key estável.
- [x] Overview runtime-aware para a LLM-B
  - `ModelGatewayRuntimeControl` passou a expor leitura de capabilities do runtime selecionado;
  - `model_gateway_overview` agrega o mapa público no campo `data.runtime`, sem chamar provider nem
    duplicar política;
  - prova direta confirmou `sdk.model-switch` e `sdk.same-session-route-reattach` com preservação de
    `sessionId`.
- [x] Validação
  - typecheck NodeNext estrito, ESLint focado e `git diff --check -- src/copilot`: passaram;
  - correção mínima de interoperabilidade ESM do `js-yaml` restaurou o gate sem alterar o renderer;
  - prova dos ports validou cinco contratos e duas falhas fail-closed;
  - bateria focada executou 219 testes: 217 passaram e dois testes externos ainda exigem o preset
    removido `auto_prepare_new_session`; as expectativas contradizem a invariante canônica de
    continuidade e permanecem fora do escopo editável `src/copilot`.

### 2026-06-15 — incremento 19: binding explícito para rotas selecionadas pelo gateway

- [x] Identidade e configuração da rota
  - `buildModelGatewayRuntimeSelectorProbeEnv` projeta `COPILOT_MODEL_GATEWAY_PROVIDER_ID` como
    identidade autoritativa;
  - provider type, endpoint e wire API são explícitos antes da borda SDK;
  - `preset=custom` neutraliza defaults específicos da tabela monolítica sem perder suporte a
    headers de perfil;
  - capabilities e context window presentes na rota são preservados no binding.
- [x] Segredos e adapters
  - referências allowlisted do provider são projetadas para credencial genérica apenas no objeto env
    efêmero;
  - Kilo preserva bearer token, Anthropic preserva provider type nativo e Ollama local permanece sem
    autenticação;
  - importer usa o marker do gateway para identidade e continua persistindo somente nomes de refs,
    nunca valores.
- [x] Coerência de automação
  - comparação `already_aligned` usa `providerId` canônico e não o placeholder compatível `custom`;
  - prova direta confirmou bindings para OpenRouter, Anthropic, Kilo e Ollama local com adapters e
    endpoints esperados.
- [x] Validação
  - typecheck estrito, ESLint focado e `git diff --check -- src/copilot`: passaram;
  - contratos Model Gateway: 217/219 passaram; as duas falhas remanescentes exigem o preset
    histórico de nova sessão;
  - initializer: 15/17 passaram; as duas falhas remanescentes exigem criar sessão nova quando o
    binding muda, em contradição direta com a invariante normativa.
- [ ] Compatibilidade residual
  - perfis/env BYOK escolhidos diretamente pelo operador ainda são interpretados por
    `sdk/session/provider.js`;
  - migrar essa configuração para um profile store do gateway antes de marcar a eliminação total dos
    presets.

### 2026-06-15 — incremento 20: overview multi-runtime e profile store redigido

- [x] Visão do runtime para a LLM-B
  - `model_gateway_overview` aceita `runtimeId` opcional sem relaxar o schema fechado;
  - capabilities e estatísticas são lidas para o mesmo runtime alvo;
  - o payload inclui modelo efetivo, contadores do runtime e as capabilities de model switch/route
    reattach.
- [x] Profile store canônico
  - `ModelGatewayEnvProfileStore` possui port explícito e assume identidade, inventário e
    diagnóstico dos perfis;
  - descriptors incluem provider, endpoint, modelo, wire API, refs, headers configurados e metadata
    keys;
  - valores inline, valores de env e conteúdo de headers nunca entram no descriptor;
  - importer usa a identidade do perfil canônico antes de recorrer ao preset resumido pelo SDK.
- [x] Proveniência observável
  - bindings distinguem `gateway_route`, `gateway_profile` e `env_compat`;
  - a origem aparece no `activeByok` do overview e no `gatewayBinding`, sem depender de parsing de
    mensagens;
  - prova direta confirmou as três classificações.
- [x] Provas de redaction e composição
  - perfil com o mesmo segredo em campo inline, env e header retornou `inlineSecretConfigured=true`
    sem conter o valor;
  - overview real retornou perfil ativo `openrouter`, count limitado e zero ocorrência do segredo de
    prova;
  - targeting de `runtime-proof` chamou capabilities e stats com o mesmo id e retornou modelo
    `openrouter/free`.
- [x] Validação e live
  - typecheck estrito, ESLint focado e `git diff --check -- src/copilot`: passaram;
  - `llmBLiveTest --no-pr` terminou `PASS` em 14,283 segundos, retomou a sessão existente, registrou
    124 tools e teve zero erro terminal/SSE;
  - artefato: `artifacts/terminal-live/2026-06-15T06-28-38-138Z/summary.md`.
- [x] Próxima etapa do profile store
  - usos avançados de descoberta/custo foram migrados para o profile store nos incrementos 22-24.

### 2026-06-15 — incremento 21: materialização canônica de perfil BYOK ativo

- [x] Materialização SDK-facing
  - `ModelGatewayEnvProfileStore.materializeActiveEnv()` converte o perfil ativo em `COPILOT_BYOK_*`
    explícito;
  - `COPILOT_BYOK_PROFILE` é removido do env efêmero antes da borda SDK, evitando dupla
    interpretação do JSON;
  - a origem passa a ser `gateway_profile` quando o perfil é autoridade e `gateway_route` quando a
    rota já escolheu provider/model.
- [x] Autoridade da rota preservada
  - quando `COPILOT_MODEL_GATEWAY_PROVIDER_ID` já existe, o provider/model/endpoint da rota
    continuam autoritativos;
  - perfis associados só complementam campos auxiliares, como headers e refs genéricas;
  - caso o perfil ativo aponte para outro provider, ele não substitui `baseUrl`, `model` ou
    `wireApi` da rota.
- [x] Consumers migrados
  - `resolveModelGatewaySessionBinding` chama a materialização antes do resolver BYOK legado;
  - `EnvByokCompatImporter` importa provider/model a partir do env materializado e registra
    proveniência canônica;
  - `model_gateway_probe_execute` materializa `profileId` antes de executar o probe autorizado.
- [x] Provas e validação
  - prova direta confirmou perfil `openrouter` como `gateway_profile`, com marker removido e segredo
    projetado apenas no env efêmero;
  - prova direta confirmou rota `zai` + perfil divergente mantendo provider/model/baseUrl de `zai`;
  - typecheck NodeNext estrito e ESLint focado passaram;
  - contratos Model Gateway seguem em 217/219: as duas falhas ainda esperam
    `auto_prepare_new_session`;
  - initializer segue em 15/17: as duas falhas ainda esperam criar nova sessão ao mudar binding;
  - `llmBLiveTest --no-pr` terminou `PASS`, retomou a sessão existente, registrou 124 tools e teve
    zero erro terminal/SSE;
  - artefato: `artifacts/terminal-live/2026-06-15T06-46-34-574Z/summary.md`.
- [x] Pendências residuais do profile store
  - a política foi decidida no incremento 26: novas escritas falham fechado para refs fora da
    allowlist, enquanto perfis legados continuam legíveis/materializáveis por compatibilidade.

### 2026-06-15 — incremento 22: projeção e ativação de perfis pelo gateway

- [x] Summaries canônicos para o terminal
  - `ModelGatewayEnvProfileStore.listTerminalSummaries()` substitui
    `readConfiguredByokProfileSummaries()` no cockpit;
  - `/byok profiles` e `/byok providers` passam a classificar prontidão, auth e metadata por
    descriptor/materialização do gateway;
  - `readTerminalByokProjection()` lê summary/modelos a partir do env materializado e preserva o
    nome do perfil apenas como campo de UX.
- [x] Mutação de ativação no processo
  - `ModelGatewayEnvProfileStore.activateProfile()` valida existência, ativa `COPILOT_BYOK_ENABLED`
    e limpa seletores diretos incompatíveis;
  - `/byok use <perfil>` chama a mutação do store antes de acionar a troca viva;
  - `/byok persist profile <nome>` valida pelo store, grava `.env.local` com writer seguro existente
    e ativa o processo pelo store.
- [x] Segurança e redaction
  - summaries retornam apenas booleanos de auth, refs/metadados e erros acionáveis;
  - prova direta confirmou que o segredo materializado não aparece na projeção terminal;
  - perfil incompleto agora recebe erros do gateway como `model ausente` e `credencial ausente`.
- [x] Validação
  - typecheck NodeNext estrito passou;
  - ESLint focado passou para profile store, projection config, barrels e comando `/byok`;
  - contratos Model Gateway seguem em 217/219, apenas com as duas expectativas legadas de
    `auto_prepare_new_session`;
  - prova direta confirmou `summary.profile=openrouter_free`, `preset=custom`, modelo materializado
    e zero vazamento de segredo.
- [ ] Pendências remanescentes
  - avaliar live test após a próxima mudança que toque reattach ou execução viva, pois este
    incremento só alterou projeção/ativação local.

### 2026-06-15 — incremento 23: heurística de custo e descoberta de perfis via store

- [x] Custo/free-tier canônico
  - `readModelGatewayByokProfileCostHint()` saiu do parser cru e passou a usar o profile store;
  - `profileCostHint` é derivado do descriptor redigido, não do JSON bruto lido pelo terminal;
  - `/byok` continua exibindo `profile-free`, mas agora a origem vem da autoridade do gateway.
- [x] Descoberta por perfil materializada
  - `discoverByokCatalogForCommand()` materializa o env do perfil antes de pedir descoberta remota e
    projections;
  - o loop de descoberta já não depende de `readConfiguredByokProfilesFromEnv()` para reabrir o JSON
    cru no caminho principal do terminal;
  - a projeção por perfil fica coerente com o binding materializado do gateway.
- [x] Validação
  - typecheck NodeNext estrito e ESLint focado passaram;
  - prova direta de `readModelGatewayByokProfileCostHint()` confirmou `profile-free` para perfil com
    metadata gratuita;
  - prova direta de `discoverByokCatalogForCommand()` materializou o env com `gateway_profile`.
- [x] Pendências remanescentes
  - política de allowlist para `apiKeyEnv` arbitrário definida no incremento 26;
  - live test segue reservado para mudanças que toquem reattach, troca viva ou fluxo de execução
    real.

### 2026-06-15 — incremento 24: cockpit BYOK totalmente materializado

- [x] Projeção única do cockpit
  - `readTerminalByokProjection()` usa o mesmo env materializado para summary, models e snapshot do
    gateway;
  - `buildEnvByokModelGatewaySnapshot()` deixa de divergir entre o model-gateway e o cockpit
    terminal na superfície BYOK;
  - o cockpit passa a refletir a mesma autoridade que o binding/importer já usavam.
- [x] Prova direta de coerência
  - profile `freebie` com segredo inline-only materializado preservou `summary.profile`,
    `bindingSource=gateway_profile` e `model=openrouter/free`;
  - a projeção não vazou o segredo de prova e mostrou o modelGateway coerente com o env
    materializado.
- [x] Validação
  - typecheck NodeNext estrito e ESLint focado passaram;
  - prova direta confirmou o cockpit BYOK em um único env materializado.
- [x] Pendências remanescentes
  - política de allowlist para `apiKeyEnv` arbitrário definida no incremento 26;
  - live test segue reservado para mudanças que toquem reattach, troca viva ou execução real.

### 2026-06-15 — incremento 25: tool mutável de perfis BYOK

- [x] Porta mutável do profile store
  - `ModelGatewayEnvProfileStore.upsert()` escreve perfis estruturais em
    `COPILOT_BYOK_PROFILES_JSON`;
  - `ModelGatewayEnvProfileStore.remove()` remove perfis do mesmo registro canônico;
  - `upsertModelGatewayByokProfileEnv()` e `removeModelGatewayByokProfileEnv()` expõem a porta no
    barrel do gateway.
- [x] Tool LLM-B
  - `model_gateway_profile_manage` adiciona `plan/apply`, `upsert/remove`, `confirm` e
    `idempotencyKey`;
  - a tool bloqueia `apiKey`/`bearerToken` inline e orienta `apiKeyEnv`/`bearerTokenEnv`;
  - `plan` é dry-run e não altera `process.env`; `apply` confirmado altera o store vivo do processo.
- [x] Validação
  - typecheck NodeNext estrito passou;
  - ESLint focado passou;
  - prova direta confirmou, naquele incremento, `modelGatewayTools.length === 14` e presença de
    `model_gateway_profile_manage`;
  - o catálogo atual foi ampliado no incremento 33 para 16 tools com
    `model_gateway_control_plane_guide` e `model_gateway_workflow_plan`;
  - `tests/unit/copilot/tools/test_tool_contract_verifier.spec.js` passou com 5/5 testes;
  - prova direta confirmou `planned`, `committed` e bloqueio estruturado `invalid_profile` para
    segredo inline.
- [ ] Pendências remanescentes
  - persistência direta da tool em `.env.local` ainda deve ser decidida; por enquanto a mutação é no
    processo vivo;
  - avaliar live test somente quando a próxima mudança tocar reattach, troca viva ou execução real.

### 2026-06-15 — incremento 26: allowlist de refs em novas escritas de perfil

- [x] Falha fechada no caminho de escrita
  - `ModelGatewayEnvProfileStore.upsert()` valida `apiKeyEnv`/`apiKeyRef`/`keyEnv` e
    `bearerTokenEnv`/`bearerTokenRef`/`tokenEnv` contra `resolveModelGatewayProviderSecretRefs()`;
  - refs genéricas `COPILOT_BYOK_API_KEY` e `COPILOT_BYOK_BEARER_TOKEN` continuam válidas para
    providers conhecidos ou customizados;
  - refs específicas de outro provider são rejeitadas com
    `MODEL_GATEWAY_PROFILE_SECRET_REF_NOT_ALLOWED`.
- [x] Compatibilidade legada preservada
  - `list()`, summaries e `materializeActiveEnv()` não passam a invalidar retroativamente perfis já
    configurados;
  - a validação só ocorre em novas escritas via store/tool.
- [x] Tool LLM-B
  - `model_gateway_profile_manage` transforma a rejeição em `status=invalid_profile`;
  - o erro estruturado usa `PROFILE_MANAGE_SECRET_REF_NOT_ALLOWED` e orienta
    `replace_secret_ref_with_allowed_provider_ref`.
- [x] Validação
  - `npm run typecheck:node` passou;
  - ESLint focado passou para `env-profile-store.js` e `model-gateway-tools.js`;
  - `tests/unit/copilot/tools/test_tool_contract_verifier.spec.js` passou com 5/5 testes;
  - `git diff --check -- src/copilot` passou;
  - prova direta confirmou escrita permitida com `OPENROUTER_API_KEY`, rejeição de
    `ARBITRARY_SECRET`, `PROFILE_MANAGE_SECRET_REF_NOT_ALLOWED` na tool e materialização legada
    preservada.
- [ ] Pendências remanescentes
  - persistência direta da tool em `.env.local` ainda deve ser decidida;
  - avaliar live test somente quando a próxima mudança tocar reattach, troca viva ou execução real.

### 2026-06-16 — incremento 27: prova viva de reattach na mesma sessão

- [x] Reattach vivo confirmado
  - o live `--no-pr` atravessou o bootstrap e manteve a sessão SDK `#1`;
  - o terminal anunciou `rota viva confirmada na mesma sessão`;
  - o vínculo BYOK mudou de `glm-4.5-flash` para `kilo-auto/free` sem criar nova sessão como
    fallback.
- [x] Sondas e cockpit
  - `/session sdk` continuou exibindo a mesma sessão viva antes e depois da troca;
  - `/byok providers`, `/byok profiles`, `/byok models refresh`, `/byok recommend` e
    `/byok probe agent` ficaram operacionais no live;
  - `/byok probe chat`, `/byok probe streaming`, `/byok probe json` e `/byok probe shortlist`
    passaram durante a janela coletada.
- [ ] Validação residual
  - o harness ainda classificou parte da saída com critérios legados de `/events sources`,
    `/byok status` e copy de catálogo;
  - isso indica refinamento pendente no runner, não ausência da troca viva observada.

### 2026-06-16 — incremento 28: sinais técnicos no cockpit BYOK

- [x] Status técnico explícito
  - `/byok` agora projeta `enabled: sim|não` e `ready: sim|não` em uma linha de flags para alinhar
    diagnóstico humano e harness live;
  - a linha humana principal `ativo e pronto` continua preservada.
- [x] Validação
  - ESLint focado em `src/copilot/terminal/commands/byok.js` passou;
  - `git diff --check -- src/copilot` passou.
- [ ] Pendências remanescentes
  - reexecutar o live BYOK real quando a próxima rodada de ajuste justificar nova prova;
  - refinar os critérios legados do harness apenas se continuarem escondendo a troca viva já
    demonstrada.

### 2026-06-16 — incremento 29: aliases bilíngues no cockpit

- [x] Cockpits alinhados ao harness e ao operador
  - `/session sdk` agora projeta `Vínculo BYOK` além de `Vínculo SDK`, mantendo a linha
    `Limite BYOK` e a leitura humana já existente;
  - `/byok providers`, `/byok models`, `/byok recommend` e `/byok probe <modo>` passaram a expor
    alias em inglês na headline sem remover o texto PT-BR;
  - a intenção é facilitar tanto a leitura do operador quanto as provas automatizadas que esperam
    termos em inglês.
- [x] Validação
  - `npx eslint src/copilot/terminal/commands/byok.js src/copilot/terminal/commands/session.js`
    passou;
  - `git diff --check -- src/copilot` passou.
- [ ] Pendências remanescentes
  - reexecutar o live BYOK real para confirmar se os critérios do harness baixaram;
  - se algum critério ainda falhar, atacar apenas a copy remanescente que estiver mascarando a
    funcionalidade já provada.

### 2026-06-16 — incremento 30: instrumentação de erro bruto do SDK

- [x] Listener explícito de `error`
  - `wireSessionEvents()` registra o evento bruto `error` da sessão SDK antes dos handlers
    semânticos;
  - `stepRegisterClientLifecycleHandlers()` registra o evento bruto `error` do client SDK quando a
    API expõe `.on()`;
  - ambos convertem falhas emitidas por evento bruto em eventos rastreáveis, sem depender do
    wildcard do SDK.
- [x] Observabilidade preservada
  - erros brutos de sessão são emitidos como `session.error` com `errorType=raw_sdk_error`;
  - erros brutos do client são emitidos como `sdk.lifecycle` com `type=client.error`;
  - callbacks de emissão e unsubscribe ficam protegidos por `try/catch` para evitar novo
    `uncaughtException`.
- [x] Diagnóstico operacional
  - `/errors <n> detail|full|stack` passa a expor stack recente quando o tracker recebeu stack;
  - `/errors <n> json|raw` passa a imprimir `{ stats, recent }` para investigação automatizada;
  - `COPILOT_ERROR_TRACKER_LOG_STACK=1` habilita stack opt-in nos handlers globais de erro sem
    poluir runs normais.
- [x] Validação
  - `npx eslint src/copilot/agent/session/wiring/event-wirer.js src/copilot/agent/session/boot/boot-wiring.js tests/unit/copilot/agent/test_agent_session_event_handlers.spec.js`
    passou;
  - `npx vitest run tests/unit/copilot/agent/test_agent_session_event_handlers.spec.js --reporter=dot`
    passou com 34/34 testes;
  - `npm run typecheck:node` passou.
- [x] Limite da descoberta
  - o live seguinte ainda reproduziu `Client is not connected. Call start() first.` como fatal;
  - com stack habilitado, a causa real apareceu fora do canal de evento bruto: getter `client.rpc`
    lido pelo snapshot de health durante o rebind do SDK.

### 2026-06-16 — incremento 31: leitura segura de handles SDK durante rebind

- [x] Causa raiz fechada
  - `getSdkHandles()` lia `client.rpc`, `session.rpc` e `session.workspacePath` diretamente para
    montar snapshots de health;
  - durante a janela de stop/start do SDK, o getter `client.rpc` lança
    `Client is not connected. Call start() first.`;
  - essa exceção escapava do snapshot de readiness e entrava no tracker como `uncaughtException`,
    mesmo com a troca viva de modelo funcionando.
- [x] Correção aplicada
  - `readSdkHandleValue()` passa a ler handles via `Reflect.get()` protegido por `try/catch`;
  - `getSdkHandles()` degrada campos indisponíveis para `null` em vez de derrubar o processo;
  - o health snapshot continua observável, mas deixa de ser fonte de fatal durante rebind.
- [x] Validação automatizada
  - `npx eslint src/copilot/agent/facades/sdk/client.js src/copilot/observability/error-tracker.js src/copilot/terminal/commands/errors.js src/copilot/terminal/frontend/projections/metrics.js src/copilot/agent/session/wiring/event-wirer.js src/copilot/agent/session/boot/boot-wiring.js tests/unit/copilot/agent/test_agent_session_event_handlers.spec.js`
    passou;
  - `npm run typecheck:node` passou;
  - `npx vitest run tests/unit/copilot/agent/test_agent_session_event_handlers.spec.js --reporter=dot`
    passou com 34/34 testes.
- [x] Prova viva BYOK real
  - live `--byok-real --reuse-sdk-session` gerou o artefato
    `artifacts/terminal-live/2026-06-16T02-57-29-901Z/summary.md`;
  - o critério `no-terminal-errors` deixou de falhar;
  - `/metrics` mostrou `Erros Total 0` e `Buffer 0`;
  - `/errors 10` mostrou `0 total · 0 no buffer`;
  - a mesma sessão confirmou `rota viva confirmada na mesma sessão: kilo-code/kilo-auto/free`.
- [x] Pendências remanescentes
  - os critérios `sse-archive-json-parseable`, `events-sources-guidance-visible` e parte dos
    `byok-real-*` ainda falham no harness live;
  - fechadas no incremento 32 como aliases operacionais estáveis e roteiro live completo.

### 2026-06-16 — incremento 32: live BYOK real sem PR totalmente verde

- [x] Aliases operacionais para LLM-B e harness
  - `/session sdk` e `/byok` passam a expor `Alias BYOK` com `vínculo BYOK:`, `preparado:`,
    `limite BYOK:`, `preset:` e `model:` estáveis;
  - `/byok models route` passa a expor `BYOK model route`, `decision=<id>` e `fallback chain`;
  - `/byok probe <modo>` passa a expor `probe=<modo> resultado: ok|... provider=<id> model=<id>`;
  - `/byok probe shortlist` passa a expor `BYOK shortlist agent probe` e
    `Shortlist encerrada: ok=n/m`;
  - `/byok models` passa a expor `filtros=provider:<id>,free,reasoning,safe` sem remover a leitura
    humana PT-BR.
- [x] Roteiro live alinhado ao contrato que valida
  - o caminho BYOK-real `--no-pr` agora executa `/events 100 --json compact` e `/events sources`;
  - `sse-archive-json-parseable` e `events-sources-guidance-visible` deixam de depender de hints
    impressos por `/events --raw`.
- [x] Prova viva BYOK real
  - live `--byok-real --no-pr --reuse-sdk-session` gerou
    `artifacts/terminal-live/2026-06-16T03-07-25-903Z/summary.md`;
  - status `PASS`, exit code `0`;
  - todos os critérios obrigatórios passaram, incluindo route decision, streaming probe, JSON probe,
    shortlist, chat/agent probe ok, model filtering, binding cockpit, runtime selector route e
    `no-terminal-errors`;
  - `byok-real-vision-probe` permaneceu como warning explícito, registrando falha de visão sem
    degradar admissão de chat/agente.
- [x] Validação
  - `npx eslint src/copilot/terminal/commands/byok.js src/copilot/terminal/byok/session-binding.js src/copilot/terminal/byok/binding/index.js src/copilot/terminal/commands/session.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`
    passou;
  - `npm run typecheck:node` passou;
  - `git diff --check` focado passou.
- [ ] Próxima frente estrutural
  - ampliar a mesma camada de aliases/contratos para as tools locais do model-gateway quando o
    próximo bloco de tools mutáveis for implementado;
  - manter visão como capability opcional enquanto o provider retorna HTTP 400 para a fixture PNG.

### 2026-06-16 — incremento 33: workflow tool local para orquestração LLM-B

- [x] Guia operacional consultável pela LLM-B
  - `model_gateway_control_plane_guide` passa a explicar fases, tools por fase, invariantes BYOK,
    troca same-session, perfis, catálogo, probes, terminal commands e roteiro live;
  - a guia torna explícito que a superfície deve parecer una para operador e LLM-B, com nova sessão
    apenas por pedido humano explícito;
  - exemplos de `apply` são opcionais, sempre com `confirm=true`, idempotency key estável e sem
    segredo inline.
- [x] Tool read-only de plano operacional
  - `model_gateway_workflow_plan` passa a ser a entrada recomendada para a LLM-B planejar overview,
    refresh de catálogo, rota, avaliação, probes, troca de modelo, troca de rota e reconcile;
  - o resultado retorna etapas ordenadas com `tool`, `mode`, `args`, dependências, `idempotencyKey`
    estável e `confirmationRequired` para cada `apply`;
  - o plano permanece estritamente read-only: não chama providers, não altera runtime e não grava
    catálogo.
- [x] Guardrails same-session explícitos
  - o payload inclui `sameSessionRequired: true`, `requiresNewSession: false` e
    `explicitNewSessionOnly: true`;
  - `model_gateway_route_switch`, `model_gateway_model_switch` e `model_gateway_runtime_reconcile`
    só aparecem como etapas separadas de `plan` e `apply`;
  - quando `requireRuntimeProof=true`, o plano liga as etapas de switch às provas de probe
    planejadas.
- [x] Schema e catálogo de tools
  - `MODEL_GATEWAY_CONTROL_PLANE_GUIDE_INPUT_SCHEMA` define objetivo da guia e flags para comandos
    de terminal e exemplos de apply;
  - `MODEL_GATEWAY_WORKFLOW_PLAN_INPUT_SCHEMA` define objetivo, perfil de tarefa, runtime, provider,
    candidatos, probes preferidas, orçamento, limites e flags de roteiro;
  - `modelGatewayReadTools` agora contém 9 tools read-only e `modelGatewayTools` contém 16 tools no
    total;
  - os barrels `src/copilot/tools/model-gateway/index.js` e `src/copilot/tools/index.js` exportam as
    novas tools.
- [x] Validação
  - `npx eslint src/copilot/tools/model-gateway/model-gateway-tools.js src/copilot/tools/model-gateway/schemas.js src/copilot/tools/model-gateway/index.js`
    passou;
  - `npm run typecheck:node` passou;
  - prova direta por Node confirmou `modelGatewayTools.length === 16` e presença de
    `model_gateway_control_plane_guide` e `model_gateway_workflow_plan`;
  - chamada direta de `model_gateway_control_plane_guide` para `same_session_switch` retornou
    `operation=control-plane.guide`, `status=ready`, invariantes same-session, 13 comandos de
    terminal e exemplo de `routeSwitchApply`;
  - chamada direta de `model_gateway_workflow_plan` para `same_session_route_switch` retornou
    `operation=workflow.plan`, `status=planned`, `ok=true`, 10 etapas, guardrails same-session e
    `errors=[]`.
- [x] Teste dedicado de contrato
  - `tests/unit/copilot/tools/test_model_gateway_workflow_plan.spec.js` valida presença das tools no
    catálogo, 16 tools no total, guia operacional same-session, DAG com probes antes de route
    switch, `confirm=true` nos applies e ausência de fallback `requiresNewSession`;
  - `npx vitest run tests/unit/copilot/tools/test_model_gateway_workflow_plan.spec.js --reporter=dot`
    passou.
- [x] Verificador canônico cobrindo as 16 tools reais
  - `tests/unit/copilot/tools/test_tool_contract_verifier.spec.js` registra `modelGatewayReadTools`
    e `modelGatewayWriteTools` com a mesma categoria/tags do bootstrap;
  - a suíte exige 16 nomes esperados, `report.ok=true`, cobertura 100% de
    descrição/schema/categoria/tags/instruções, `strictSchemaViolationCount=0` e ausência de issues
    `MODEL_GATEWAY_*`;
  - `npx vitest run tests/unit/copilot/tools/test_tool_contract_verifier.spec.js --reporter=dot`
    passou com 6/6 testes.
- [ ] Próximas melhorias
  - expandir a tool para sugerir templates distintos de `profile_manage` por provider quando o
    catálogo expuser requisitos estruturados de perfil;
  - manter a validação live das tools read-only no harness sempre que novas tools de orquestração
    forem adicionadas.

### 2026-06-16 — incremento 34: provas unitárias de profile_manage seguro

- [x] Cobertura plan/apply/remove
  - `tests/unit/copilot/tools/test_model_gateway_profile_manage_tool.spec.js` cobre
    `model_gateway_profile_manage` com o store real de perfis em `process.env`;
  - `mode=plan` gera preview redigido, `ready=true` quando `OPENAI_API_KEY` fake está configurado e
    não escreve `COPILOT_BYOK_PROFILES_JSON`;
  - `mode=apply` com `confirm=true` persiste o perfil no store vivo do processo e `operation=remove`
    remove o perfil.
- [x] Segurança e redaction
  - `apply` sem confirmação retorna `PROFILE_MANAGE_CONFIRMATION_REQUIRED` e não muta env;
  - segredo inline em `apiKey` retorna `status=invalid_profile`;
  - o teste garante que nem o segredo fake do env nem o segredo inline aparecem no JSON de resultado
    ou no store.
- [x] Limite explícito
  - a persistência validada é a do processo vivo via `COPILOT_BYOK_PROFILES_JSON`;
  - escrita direta em `.env.local` continua decisão pendente e deve permanecer separada de mutação
    automática sem confirmação humana.
- [x] Validação
  - `npx vitest run tests/unit/copilot/tools/test_model_gateway_profile_manage_tool.spec.js --reporter=dot`
    passou com 4/4 testes;
  - ESLint focado no teste passou.

### 2026-06-16 — incremento 35: prova viva completa de troca de modelo e provider

- [x] Harness ajustado para validar a UI real
  - `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` agora aceita os
    marcadores humanos atuais de perfil (`Perfil`, `ativo`, `perfil`) além do formato legado
    `profile:`;
  - critérios de route decision e shortlist passam a aceitar a saída PT-BR real em minúsculas:
    `nenhum candidato encontrado para roteamento` e `nenhum candidato cabe nos filtros atuais`;
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` passou.
- [x] Prova live read-only das tools da LLM-B
  - cenário `model-gateway-tools-readonly` foi adicionado ao harness com
    `model_gateway_control_plane_guide` e `model_gateway_workflow_plan`;
  - primeiro run gerou `artifacts/terminal-live/2026-06-16T03-37-39-850Z/summary.md`;
  - a execução real chamou as duas tools read-only, renderizou `Guia Model Gateway` e
    `Plano Model Gateway` com badge `VER`, e não chamou tool mutável;
  - o único fail desse artefato foi critério obsoleto do marcador `sameSessionRequired`; o harness
    foi corrigido para `sameSessionByDefault`.
- [x] Prova live completa de modelo e provider
  - run exploratório `artifacts/terminal-live/2026-06-16T03-40-38-918Z/summary.md` provou troca de
    provider via runtime selector para `kilo-code/kilo-auto/free`, mas manteve o mesmo modelo e
    falhou JSON naquele momento;
  - run exploratório `artifacts/terminal-live/2026-06-16T03-43-39-596Z/summary.md` provou troca de
    modelo `kilo-auto/free -> nex-agi/nex-n2-pro:free` e troca de provider para
    `ollama-cloud/qwen3-coder-next`, mas expôs critérios legados do harness;
  - run exploratório `artifacts/terminal-live/2026-06-16T03-45-44-593Z/summary.md` repetiu a troca
    completa, mas revelou instabilidade real de agent tool-calling em `kilo-auto/free`
    (`tool missing`);
  - run final `artifacts/terminal-live/2026-06-16T03-47-44-733Z/summary.md` terminou `PASS`, exit
    code `0`, com `nex-agi/nex-n2-pro:free` como modelo primário, `kilo-auto/free` como modelo
    alternativo e provider alternativo `ollama-cloud/qwen3-coder-next`.
- [x] Evidências do run PASS
  - `byok-real-model-switch`, `byok-real-alt-model-switch` e `byok-real-alt-provider-switch`
    passaram;
  - chat, streaming, JSON e agent probe passaram para `nex-agi/nex-n2-pro:free`;
  - `/activity` e os eventos SSE registraram trocas sucessivas na mesma sessão:
    `custom/nex-agi/nex-n2-pro:free`, `custom/kilo-auto/free` e `custom/qwen3-coder-next`;
  - o run não abriu turno explícito, não invocou tools de LLM-B, não vazou segredos e manteve
    `/errors 10` em zero.
- [ ] Gaps descobertos
  - `byok-real-vision-probe` continua warning: os providers testados retornam falha/502/400 para a
    fixture PNG sem degradar chat/agente;
  - `kilo-auto/free` apresentou `agent probe tool-missing` em um run vivo e deve ser rebaixado para
    tarefas que exigem tool-calling até nova prova positiva ou política de retry/consenso;
  - o catálogo remoto de `kilo-code` filtrado por `provider:kilo-code,free,reasoning,safe` retornou
    shortlist vazia, apesar de modelos funcionais existirem por seleção explícita; a normalização de
    provider/filtros precisa ser revista.

### 2026-06-16 — incremento 36: provas live das tools administrativas e gaps de orquestração longa

- [x] Harness expandido para cenários de tool surface
  - `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` agora contém
    cenários `model-gateway-tools-readonly`, `model-gateway-tools-all-plan`,
    `model-gateway-tools-apply-safe` e `model-gateway-admin-apply`;
  - o detector de tools inesperadas passou a aceitar também `renderedName` para eventos de lifecycle
    externos que só carregam o nome humano da tool;
  - os cenários administrativos usam perfil temporário `providerId=openai`,
    `baseUrl=https://api.openai.com/v1`, `model=gpt-4.1-mini` e `apiKeyEnv=OPENAI_API_KEY`, alinhado
    à política de secret refs.
- [x] Tolerância segura para `profile` serializado
  - `model_gateway_profile_manage` aceita `profile` como objeto ou JSON string de objeto, cobrindo
    tool calls que serializam argumentos aninhados como string;
  - string vazia vira `{}` e JSON que não representa objeto retorna erro estruturado;
  - `tests/unit/copilot/tools/test_model_gateway_profile_manage_tool.spec.js` cobre o caso
    serializado, preservando redaction e bloqueio de segredo inline.
- [x] Prova operacional de apply administrativo
  - `artifacts/terminal-live/2026-06-16T04-30-40-985Z/summary.md` executou
    `model-gateway-admin-apply` com exit code `0`;
  - os lifecycles de `model_gateway_catalog_refresh`, `model_gateway_maintenance` e
    `model_gateway_profile_manage` passaram sem falhas ou bloqueios;
  - os markers `operation.inspect`, `catalog.refresh`, `maintenance.retention`, `profile.manage` e
    `committed` foram observados em resultado de tool;
  - `/tools diag` registrou `Gerir perfil BYOK uso 3`, `Atualizar catálogo de modelos uso 2`,
    `Manutenção Model Gateway uso 2`, zero falhas e contrato de tools `ok`;
  - o único fail desse artefato foi `ux-tool-live-status-stays-single-line`, sem erro operacional.
- [x] Correção de UX da linha viva de heartbeat de tool
  - `src/copilot/terminal/events/agent-runtime-events.js` agora escreve heartbeat inline como
    `LLM-B ferramenta · <tool> · <tempo>`, mantendo a linha física compacta;
  - narração histórica detalhada continua separada quando `shouldPersistToolHeartbeatNarration()`
    estiver ativa;
  - `npx eslint src/copilot/terminal/events/agent-runtime-events.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs src/copilot/tools/model-gateway/model-gateway-tools.js tests/unit/copilot/tools/test_model_gateway_profile_manage_tool.spec.js`
    passou.
- [x] Evidência de apply de troca de modelo/rota e restore
  - `artifacts/terminal-live/2026-06-16T04-14-09-473Z/summary.md` executou
    `model_gateway_model_switch`, `model_gateway_route_switch` e `model_gateway_runtime_reconcile`
    em `plan/apply`;
  - o run ficou `BLOCKED` por `byok-route-no-response` depois de aplicar rota para
    `ollama-cloud/qwen3-coder-next`, expondo gap real de continuação pós-reattach;
  - `artifacts/terminal-live/2026-06-16T04-17-32-863Z/summary.md` restaurou a rota viva para
    `nex-agi/nex-n2-pro:free` com `PASS`, preservando sessão e probes BYOK.
- [ ] Gaps de orquestração longa
  - `model-gateway-tools-all-plan` provou as 16 tools em um run, mas o primeiro bloqueio foi falso
    positivo de renderedName e a repetição sofreu deriva de instrução; dividir em cenários menores é
    mais robusto;
  - `model-gateway-admin-apply` repetido com `--reuse-sdk-session` pode sofrer contaminação
    conversacional: um run chamou `ask_user` antes das DELTAs e outro emitiu marcador final
    prematuro;
  - o harness precisa isolar estado de cenário, limpar marcadores pendentes ou suportar um modo de
    nova conversa lógica que preserve a sessão SDK quando o objetivo for testar mesma sessão sem
    herdar instruções antigas.
- [ ] Próximas correções estruturais
  - corrigir `byok-route-no-response` após `model_gateway_route_switch apply` para que a continuação
    pós-troca de provider progrida naturalmente na mesma sessão;
  - criar testes live menores para cada família de tools: catálogo/avaliação/probes,
    switch/reconcile, perfis/manutenção;
  - revisar normalização `provider:kilo-code` no catálogo e política de tool-calling para
    `kilo-auto/free`;
  - repetir `model-gateway-admin-apply` após isolamento de cenário para transformar a evidência
    operacional em `PASS` integral também no validador de UX.

### 2026-06-16 — incremento 37: preservar dialog loop durante reattach interno de rota

- [x] Causa raiz isolada
  - no artefato `artifacts/terminal-live/2026-06-16T04-14-09-473Z/summary.md`, o bloqueio
    `byok-route-no-response` ocorreu após `model_gateway_route_switch apply`;
  - os eventos SSE mostram que o reattach de rota disparou `dialog.stopped` com
    `reason=reconnect_restart` e `promptReplayBlocked=true`;
  - a superfície exibiu
    `Conversa preservada após reconexão · reenvio automático de prompt bloqueado`, seguida de
    timeout de inatividade do turno;
  - portanto a falha primária não era apenas provider/modelo ruim: o reattach interno usado por uma
    tool da LLM-B desativava o dialog loop no meio do turno.
- [x] Correção estrutural aplicada
  - `src/copilot/agent/lifecycle/policies/reconnect-policy.js` recebeu a opção
    `preserveDialogLoopOnReconnect`;
  - o default permanece conservador: reconexões normais com dialog loop ativo continuam emitindo
    `dialog.stopped` para evitar replay duplicado;
  - `src/copilot/agent/always-alive.js` usa `preserveDialogLoopOnReconnect=true` somente no caminho
    `MODEL_GATEWAY_SAME_SESSION_ROUTE_REATTACH` de `switchRoute`;
  - o reattach interno de `model_gateway_route_switch` passa a preservar o loop ativo em vez de
    acionar o fluxo de restart/replay bloqueado.
- [x] Cobertura focada
  - `tests/unit/copilot/test_reconnect_policy.spec.js` agora valida os dois contratos: reconexão
    normal emite `dialog.stopped`; reattach interno preserva o loop, não chama `notifyReconnect` e
    não emite `dialog.stopped`;
  - `npx eslint src/copilot/agent/lifecycle/policies/reconnect-policy.js src/copilot/agent/lifecycle/orchestrators/agent-lifecycle.js src/copilot/agent/always-alive.js tests/unit/copilot/test_reconnect_policy.spec.js`
    passou;
  - `npx vitest run tests/unit/copilot/test_reconnect_policy.spec.js --reporter=dot` passou com
    23/23 testes.
- [ ] Prova live pendente
  - rerodar `model-gateway-tools-apply-safe` com o novo reattach preservado;
  - se a LLM-B ainda agrupar `route_switch apply` e `runtime_reconcile apply` no mesmo lote, avaliar
    guardrail de ordering no schema/instruções ou cenário dividido;
  - verificar se a continuação pós-switch chega às DELTAs/`ask_user` sem `byok-route-no-response`.

### 2026-06-16 — incremento 38: route_switch seguro durante tool-turn e idempotência por sessão

- [x] Bug adicional isolado no live mínimo
  - `artifacts/terminal-live/2026-06-16T05-04-07-495Z/summary.md` passou inicialmente, mas a
    inspeção do `toolResult` mostrou `operation.replayed=true`;
  - o replay usou o mesmo `idempotencyKey` de um artefato anterior e devolveu um `committed` antigo
    da sessão `4d746cad-1440-46ee-a714-206433c6205b` para a sessão viva nova;
  - isso provou que a idempotência de `model_gateway_route_switch` estava escopada apenas por key,
    não por `sessionId` + rota alvo, permitindo falso positivo operacional.
- [x] Idempotência corrigida
  - `src/copilot/model-gateway/control-plane/runtime-route-switch.js` agora só reaproveita operação
    final quando `operation.sessionId` coincide com a sessão atual e a identidade da rota alvo
    coincide campo a campo;
  - estados finais replayáveis incluem `committed`, `rolled_back`, `failed` e
    `deferred_until_turn_boundary`;
  - registros antigos com mesma key, mas outra sessão ou outra rota, deixam de mascarar uma
    tentativa nova.
- [x] Deferimento estruturado durante dialog loop ativo
  - `src/copilot/model-gateway/control-plane/same-session-route-switch.js` aceita
    `deferReason/deferDetails` e grava `deferred_until_turn_boundary` sem chamar `reattach`;
  - o resultado mantém `requiresNewSession=false`, `rollback.reason=target_route_not_applied`,
    `reconciliationRequired=false` e `retryable=true`;
  - `src/copilot/agent/facades/agent-route-config.js` ativa esse caminho quando
    `ctx.isDialogLoopActive()` está true, evitando orphan de tool response no meio do turno;
  - `src/copilot/tools/model-gateway/model-gateway-tools.js` transforma esse estado em erro
    semântico `ROUTE_SWITCH_DEFERRED_UNTIL_TURN_BOUNDARY`, com `nextActions` explícitas para retry
    fora do tool-turn ativo.
- [x] Capability mais honesta para LLM-B
  - `src/copilot/agent/facades/agent-runtime-capabilities.js` mantém
    `sdk.same-session-route-reattach.available=true`, mas usa `state=degraded` quando
    `dialogLoopActive=true`;
  - os detalhes expõem `immediateApplyDuringActiveDialogLoop=false` e
    `deferredUntilTurnBoundary=true`;
  - a LLM-B passa a ver que a superfície existe, mas que o apply imediato deve ser tratado como
    operação adiada.
- [x] Harness ajustado para o contrato real
  - cenário `model-gateway-route-apply-minimal` agora espera `deferred_until_turn_boundary` em vez
    de `committed`;
  - a `idempotencyKey` do cenário é única por processo do harness e igual entre `plan` e `apply`;
  - o texto do cenário foi corrigido para provar que o apply não trava durante tool-turn ativo, sem
    prometer reattach imediato dentro da própria chamada.
- [x] Cobertura e validação
  - `tests/unit/copilot/model-gateway/test_same_session_route_switch.spec.js` cobre deferimento sem
    chamar `reattach`;
  - a mesma suíte cobre replay cruzado: um `committed` de outra sessão com a mesma key não é
    reaproveitado e a operação atual vira `deferred_until_turn_boundary`;
  - `npx eslint src/copilot/model-gateway/control-plane/runtime-route-switch.js tests/unit/copilot/model-gateway/test_same_session_route_switch.spec.js scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`
    passou;
  - `npx vitest run tests/unit/copilot/model-gateway/test_same_session_route_switch.spec.js --reporter=dot`
    passou com 2/2 testes.
- [x] Prova live correta
  - `artifacts/terminal-live/2026-06-16T05-11-58-163Z/summary.md` terminou `PASS`, exit code `0`,
    com sessão SDK `forced-new`;
  - `model_gateway_route_switch` foi chamado em `plan` e `apply`, ambos retornaram rápido e sem
    falha de tool;
  - o `apply` retornou `status=deferred_until_turn_boundary`, `ok=false`,
    `errors[0].code=ROUTE_SWITCH_DEFERRED_UNTIL_TURN_BOUNDARY`, `requiresNewSession=false` e
    `operation.sessionId=bd47c6be-58af-47c4-b4d3-250b3389176c`;
  - a LLM-B continuou o mesmo turno, emitiu as oito DELTAs, chamou `ask_user`, recebeu `SIM` e
    encerrou com o marcador final esperado;
  - `/tools diag`, `/events`, `/errors 10`, `/health full` e export Markdown passaram sem erro
    terminal.
- [x] Próxima frente estrutural — promoção same-session no limite seguro do turno
  - [x] implementar comando/caminho terminal controlado para promover o deferimento
        `deferred_until_turn_boundary` a `committed` sem criar sessão nova;
  - [x] implementar executor automático em limite de turno para promover deferimentos explicitamente
        agendados;
    - evidência 2026-08-14: `terminal/events/sdk-session-events.js` agenda a promoção em
      `assistant.turn_end` e só drena a mailbox depois da tentativa;
      `terminal/byok/deferred-route-promotion.js` exige sessão viva compatível, autorização, TTL e
      mesma idempotency key;
    - cobertura: `tests/unit/copilot/terminal/byok/test_deferred_route_promotion.spec.js` e
      `tests/unit/copilot/test_terminal_sdk_session_events.spec.js`;
  - [ ] repetir `model-gateway-tools-apply-safe` após essa camada para validar troca real de
        provider/modelo como fluxo de duas etapas naturais: tool-turn retorna deferido, runtime
        aplica no limite seguro e a próxima continuação permanece na mesma sessão;
  - ajustar `model_gateway_runtime_reconcile` para reconhecer e completar operações deferidas, em
    vez de tratar o estado como falha genérica.

### 2026-06-16 — incremento 39: promoção explícita de route switch diferido pelo terminal

- [x] Primitiva de promoção implementada
  - `src/copilot/model-gateway/control-plane/runtime-route-switch.js` agora aceita
    `forceApplyDeferred=true`;
  - esse modo não reaproveita replay `deferred_until_turn_boundary`, mas mantém as mesmas guardas de
    sessão e identidade da rota alvo antes de permitir reaproveitamento de estados finais;
  - a chamada com a mesma `idempotencyKey` pode sobrescrever o ledger da operação diferida com
    transições reais: `planned -> reattach_requested -> reattached -> verified -> committed`;
  - a regra padrão continua segura para a LLM-B: sem `forceApplyDeferred`, tool-turn ativo segue
    retornando deferimento estruturado e não chama `reattach`.
- [x] Projeções e terminal preparados
  - `src/copilot/agent/facades/agent-route-config.js`, `src/copilot/presentation/runtime/models.js`,
    `src/copilot/terminal/frontend/projections/config.js` e `src/copilot/agent/always-alive.js`
    propagam as opções `allowActiveDialogLoopReattach` e `forceApplyDeferred`;
  - `src/copilot/terminal/byok/live-model-switch.js` passa `allowActiveDialogLoopReattach=true` no
    caminho terminal, porque esse caminho representa intenção humana/operacional fora do tool
    response ativo;
  - `/byok provider` aceita tokens `idempotency:<chave>` e `force-deferred`, permitindo concluir
    exatamente a operação que `model_gateway_route_switch` diferiu.
- [x] Cobertura focada
  - `tests/unit/copilot/model-gateway/test_same_session_route_switch.spec.js` adicionou caso que
    grava `deferred_until_turn_boundary` e depois promove a mesma operação para `committed` com o
    mesmo `sessionId`;
  - `tests/unit/copilot/terminal/byok/test_live_model_switch.spec.js` valida que o helper terminal
    passa `allowActiveDialogLoopReattach=true`, `forceApplyDeferred=true` e a `idempotencyKey`
    informada;
  - `npx eslint tests/unit/copilot/terminal/byok/test_live_model_switch.spec.js src/copilot/terminal/commands/byok.js src/copilot/terminal/byok/live-model-switch.js src/copilot/model-gateway/control-plane/runtime-route-switch.js src/copilot/agent/facades/agent-route-config.js`
    passou;
  - `npx vitest run tests/unit/copilot/model-gateway/test_same_session_route_switch.spec.js tests/unit/copilot/terminal/byok/test_live_model_switch.spec.js --reporter=dot`
    passou com 2 arquivos e 4 testes.
- [ ] Gaps ainda abertos
  - falta ligar essa promoção ao limite automático do turno (`assistant.turn_end`) ou a uma tool de
    scheduling que a LLM-B possa acionar sem tentar reattach dentro do próprio tool-turn;
  - `model_gateway_runtime_reconcile` ainda reconcilia modelo por `expectedModelId`, mas não
    reconhece nem conclui uma operação `same-session-route-switch:*` diferida;
  - `npx vitest run tests/unit/copilot/terminal/test_commands_byok.spec.js --reporter=dot` falhou
    por mocks legados do spec que não expõem exports atuais (`readModelGatewayByokProfileCostHint`,
    `materializeModelGatewayActiveByokProfileEnv`, `activateModelGatewayByokProfileEnv`) e por
    expectativas antigas de `/session sdk next new`; esse spec precisa ser atualizado para a regra
    canônica "nova sessão só com pedido explícito";
  - [x] criar live test em duas etapas: LLM-B deferindo `model_gateway_route_switch`, terminal
        promovendo a mesma `idempotencyKey` com
        `/byok provider ... idempotency:<key> force-deferred`, e LLM-B continuando na sessão
        preservada;
  - [ ] repetir o live test em duas etapas após a correção do critério `expectedPlainOutputMarkers`
        para obter PASS formal do harness.

### 2026-06-16 — incremento 40: live test em duas etapas para deferimento + promoção terminal

- [x] Harness preparado para promoção pós-resposta
  - `scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` agora aceita
    `postAnswerCommands` por cenário;
  - o cenário `model-gateway-route-apply-minimal` executa, após o marcador final da LLM-B, o
    comando:
    `/byok provider ollama-cloud qwen3-coder-next https://ollama.com/v1 wire:completions idempotency:<same-key> force-deferred`;
  - o harness separa `expectedOutputMarkers` de tool result e `expectedPlainOutputMarkers` de
    terminal output, evitando confundir evidência de tool com evidência de comando pós-turno.
- [x] Evidência live operacional
  - artefato: `artifacts/terminal-live/2026-06-16T07-26-30-692Z/summary.md`;
  - a LLM-B executou `model_gateway_route_switch` em `plan/apply` durante tool-turn ativo;
  - o tool result registrou `deferred_until_turn_boundary`, `same_session`, `route.switch` e
    `operation.inspect`;
  - a LLM-B continuou o turno, emitiu as oito DELTAs, chamou `ask_user`, recebeu `SIM` e emitiu o
    marcador final;
  - o comando pós-resposta promoveu a mesma key
    `live-route-minimal-1781594790688:route-switch-ollama-cloud`;
  - o terminal exibiu `rota viva confirmada na mesma sessão: ollama-cloud/qwen3-coder-next`;
  - `/usage now` e `/health full` mostraram rota BYOK ativa em `ollama-cloud/qwen3-coder-next`;
  - `/tools diag` reportou `Trocar rota runtime uso 2`, zero falhas, zero bloqueios e contrato de
    tools `ok`;
  - `/errors 10` permaneceu com `0 total`.
- [x] Correção pós-run
  - o run terminou `FAIL` porque o harness ainda procurava `rota viva confirmada` dentro de tool
    results, embora a evidência estivesse corretamente na saída terminal pós-resposta;
  - esse erro de critério foi corrigido com `expectedPlainOutputMarkers`;
  - `npx eslint scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs` passou;
  - `npx vitest run tests/unit/copilot/model-gateway/test_same_session_route_switch.spec.js tests/unit/copilot/terminal/byok/test_live_model_switch.spec.js --reporter=dot`
    passou com 2 arquivos e 4 testes.
- [ ] Gaps restantes
  - repetir o cenário mínimo uma vez com o harness corrigido para obter `PASS` formal, não apenas
    evidência operacional;
  - investigar os critérios auxiliares que ainda falharam no artefato
    (`sse-archive-human-source-labels`, `sse-archive-human-operational-events`,
    `byok-real-usage-classified`, `byok-real-operator-health`);
  - [x] mover a promoção terminal para scheduling automático em `assistant.turn_end` quando a LLM-B
        pedir explicitamente uma operação `deferred_until_turn_boundary` com confirmação
        humana/política suficiente — concluído em 2026-08-14, com promoção antes do drain da próxima
        mensagem e sem criar sessão nova;
  - atualizar `model_gateway_runtime_reconcile` para inspecionar operações deferidas e explicar o
    caminho correto de promoção sem recomendar nova sessão.

### 2026-06-16 — incremento 41: `/restart` explicitamente conversa-only

- [x] Semântica de ajuda e cockpit alinhada
  - `src/copilot/terminal/commands/help.js` passou a descrever `/restart` como
    `reinicia só a conversa`;
  - `session.js`, `byok.js` e `config.js` já narravam a fronteira correta entre conversa, sessão SDK
    e binding BYOK;
  - o roadmap canônico agora registra `/restart` como reset de conversa apenas, sem mudança de
    provider, modelo ou identidade da sessão viva.
- [x] Validação
  - `npx eslint src/copilot/terminal/commands/help.js` passou;
  - `git diff --check -- src/copilot` passou.

### 2026-08-24 — incremento 42: readiness absorvido pelo domínio canônico

- [x] Ownership do caso de uso
  - `scripts/model-gateway/commands/model-gateway-live-readiness.mjs` deixou de conter a aplicação
    de readiness e virou launcher fino;
  - `src/copilot/model-gateway/readiness/live-readiness.js` passou a ser a implementação canônica;
  - `src/copilot/model-gateway/readiness/public/index.js` expõe a capability exata
    `#copilot/model-gateway/readiness`;
  - o adapter MCP `integrations/model-gateway/live-runs/readiness.js` importa essa capability
    estaticamente, sem carregar business logic de `scripts/`.
- [x] Redaction worker
  - a lógica de auditoria de catálogo/SQLite saiu do worker script e passou para
    `readiness/redaction-audit.js`;
  - `model-gateway-live-redaction-worker.mjs` ficou responsável apenas por bootstrap SQLite,
    worker/CLI messaging e delegação ao serviço canônico;
  - o readiness service recebe explicitamente paths de runner/worker e mantém o worker como boundary
    de isolamento, não como owner da regra de negócio.
- [x] Prova focal
  - `node scripts/model-gateway/commands/model-gateway-live-readiness.mjs --help` passou;
  - import direto de `#copilot/model-gateway/readiness` expôs exatamente os serviços esperados;
  - `node scripts/model-gateway/commands/model-gateway-live-readiness.mjs --json` concluiu com
    `ok=true`, paridade SQLite verde, zero leaks de redaction e 7/7 profiles selecionados;
  - duração observada: ~7,8 s de serviço / ~8,6 s de processo, sem executar provider/model/runtime
    probes;
  - o architecture checker MCP confirmou `declared=0 actual=0` para computed dynamic imports após a
    convergência.
- [ ] Continuidade da Faixa G
  - os demais casos de uso ainda concentrados diretamente em `terminal/commands/byok.js` continuam
    abertos;
  - este incremento fecha readiness como semântica paralela, não autoriza marcar a convergência
    terminal/tools inteira como concluída.

## 12. Referências técnicas externas

- GitHub Copilot SDK, definição de tools:
  <https://github.com/github/copilot-sdk/blob/main/nodejs/README.md>
- Model Context Protocol, Tools, versão 2025-11-25:
  <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>
- OpenAI, function calling e strict mode:
  <https://developers.openai.com/api/docs/guides/function-calling>
- OpenAI, tools: <https://developers.openai.com/api/docs/guides/tools>
- OpenAI, structured outputs: <https://developers.openai.com/api/docs/guides/structured-outputs>
