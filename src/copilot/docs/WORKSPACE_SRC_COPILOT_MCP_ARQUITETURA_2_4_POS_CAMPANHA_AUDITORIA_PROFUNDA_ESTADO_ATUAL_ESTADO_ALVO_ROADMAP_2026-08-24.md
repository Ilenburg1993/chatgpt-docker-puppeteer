# WORKSPACE — `src/copilot/mcp` — Arquitetura 2.4 pós-campanha — auditoria profunda reconciliada com o HEAD, estado atual, estado-alvo e roadmap

**Data:** 24 de agosto de 2026  
**Escopo primário:** `/workspaces/chatgpt-docker-puppeteer/src/copilot/mcp/**`  
**Escopo complementar:** `src/copilot/infra/**`, `src/copilot/docs/**`, `tests/unit/copilot/mcp/**`,
`package.json`, `package-lock.json`, configuração de typing/testes e gates arquiteturais que
governam o MCP  
**Natureza:** ledger vivo de auditoria + execução da Arquitetura 2.4, investigação de
correctness/ownership/governança, transformação estrutural e preparação de promoção/publicação  
**Regra atual da campanha:** transformações de source/config/testes estão autorizadas quando
materializam o estado-alvo e passam barriers focais. Commit/push somente ocorre após a barreira de
publicação da Faixa N no mesmo worktree validado; `.ai/**` permanece estado operacional ignorado.  
**Arquitetura normativa de referência:**
`WORKSPACE_ARQUITETURA_2_4_PRINCIPIOS_INVARIANTS_ESTADO_ALVO_GOVERNANCA_2026-08-23.md`  
**Ledger MCP anterior de referência:**
`WORKSPACE_SRC_COPILOT_MCP_ARQUITETURA_2_4_AUDITORIA_ESTADO_ALVO_ROADMAP_2026-08-23.md`

---

# 0. Status deste documento, regra de precedência e finalidade

Este documento é a auditoria **pós-campanha reconciliada com o `HEAD` atual**. Seu objetivo não é
preservar a narrativa de uma etapa anterior, mas responder com precisão a quatro perguntas:

1. **o que a campanha 2.4 efetivamente resolveu;**
2. **qual é a arquitetura material que existe hoje;**
3. **quais dívidas, bugs, gaps e pontos cegos continuam reais;**
4. **qual deve ser a ordem segura da execução restante e quais barriers autorizam promoção, commit e
   push.**

A precedência adotada é a mesma exigida pela Arquitetura 2.4:

1. **código, testes e configuração presentes no `HEAD`;**
2. **manifests, scans, métricas e gates derivados do `HEAD`;**
3. **documentação live;**
4. **auditorias e ledgers históricos.**

Consequentemente:

- checkboxes do documento de 23/08 permanecem válidos como evidência histórica;
- paths antigos podem permanecer em documentos históricos quando descrevem corretamente o snapshot
  daquela época;
- métricas históricas não são promovidas automaticamente a métricas atuais;
- quando uma afirmação documental conflita com o `HEAD`, prevalece o `HEAD`;
- quando um gate verde não cobre determinado fenômeno, o documento não o interpreta como prova
  inexistente.

Este último ponto continua importante, mas o estado material avançou desde a auditoria inicial:
computed imports, owner ontology, config authority, state-scope, subprocess authority e cancellation
agora possuem gates/manifests ou contratos executáveis fail-closed. A dívida dominante migrou para
Tool Contract semântico — effects/authority/credentials/risk/output —, decomposição HTTP/exposure,
custo transitivo de surfaces, caching moderno e evidence gates de compatibilidade.

## 0.1 Classificação epistemológica usada neste documento

Para evitar transformar hipótese em dívida oficial sem prova suficiente, cada achado relevante
pertence a uma destas categorias:

| Categoria             | Significado                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| **Confirmado**        | reproduzido ou demonstrado diretamente no `HEAD` atual                                                  |
| **Alta confiança**    | mecanismo e evidência são fortes, mas falta uma prova isolada adicional para atribuição causal completa |
| **Hipótese dirigida** | merece investigação, mas não autoriza refatoração por si só                                             |
| **Evidence gate**     | código local pode estar correto, porém decisão depende de uso/host/produção real                        |
| **Resolvido**         | problema histórico que não deve continuar sendo carregado como dívida atual                             |

## 0.2 Severidade usada no roadmap

| Severidade | Interpretação                                                                               |
| ---------- | ------------------------------------------------------------------------------------------- |
| **P0**     | compromete a confiança na arquitetura, no gate ou na validação usada para promover mudanças |
| **P1**     | dívida estrutural relevante que deve anteceder ou acompanhar novas transformações amplas    |
| **P2**     | melhoria importante, mas que não bloqueia a integridade básica da próxima campanha          |
| **P3**     | limpeza, ergonomia ou otimização oportunística                                              |

---

# 0.3 Checkpoint de execução — 24/08/2026, primeira e segunda ondas

Após a auditoria inicial, a campanha de transformação foi autorizada. Este documento passou,
portanto, de **auditoria pré-execução** para **ledger vivo da execução 2.4**. As transformações
abaixo já estão no worktree e devem ser consideradas ao interpretar os achados históricos das seções
seguintes:

- **test hermeticity:** `repo-write` não possui mais `quarantineMetadataWriter` module-global
  mutável; `createRepoWriteTools()` cria dependencies de fault-injection por instância e o teste de
  rollback verifica apenas o `quarantineId` criado pela própria operação. O spec focal terminou
  29/29 verde mesmo com artifacts históricos no diretório de quarantine;
- **Cloudflare membrane:** `mcp_cloudflare_plan_capabilities_audit` deixou de construir/importar um
  path privado computado e agora depende da capability exata
  `#copilot/mcp/public/cloudflare/plan-capabilities-audit`;
- **owner ontology:** `config/architecture/copilot-mcp-owners.json` foi criado com 43
  owners/taxonomias/entrypoint spaces; os 23 protected boundaries usados pelo checker são agora
  derivados do manifest, não de uma lista manual;
- **dynamic/process graph:** `config/architecture/copilot-mcp-dynamic-graph.json` passou a ratchetar
  computed imports, child-process import authorities e worker-thread authorities. O checker usa AST
  Babel e falha em drift/stale entry;
- **computed imports MCP:** o baseline atual passou de 2 para **0**;
- **Model Gateway readiness:** a implementação de 987 linhas saiu de
  `scripts/model-gateway/commands/model-gateway-live-readiness.mjs` e passou para
  `src/copilot/model-gateway/readiness/live-readiness.js`; CLI e MCP usam
  `#copilot/model-gateway/readiness`;
- **redaction readiness:** a lógica do worker também foi absorvida por
  `src/copilot/model-gateway/readiness/redaction-audit.js`; o script worker ficou como entrypoint de
  bootstrap/message transport;
- **prova focal do readiness:** a execução read-only pós-migração retornou `ok=true` em ~7,8 s de
  serviço, com catalog integrity, SQLite parity, redaction, selection e live-runner presence verdes;
- **architecture checker focal:** owner manifest verde (`owners=43`, `protectedBoundaries=23`), 309
  arquivos MCP parseados, computed imports `declared=0 actual=0`, 16 child-process import
  authorities exatamente iguais ao manifesto e zero worker-thread authorities MCP.

Este checkpoint **não** significa que as Faixas A–C estejam integralmente encerradas. Ainda faltam,
em particular, full-suite hermeticity repetida, authority classes mais ricas no owner manifest e
classificação mais ampla de loaders/process entrypoints. Ele registra apenas o que já foi
efetivamente transformado e provado.

---

# 0.4 Checkpoint de execução — 24/08/2026, baseline atual após config/state/auth

Este checkpoint prevalece sobre números intermediários das ondas anteriores quando o assunto é
**estado atual**:

- architecture checker MCP: **verde**, com **359** arquivos MCP parseados;
- owner ontology: **48 owners**, dos quais **28 protected boundaries**, com parent graph validado;
- computed dynamic imports: **0 declarados / 0 observados**;
- child-process import authorities: **15 owners exatos**; worker-thread authorities MCP: **0**;
- config authority: **38 arquivos / 61 refs / 0 migration targets**; snapshot canônico singular em
  `composition/process-config/runtime.js`;
- mutable state top-level: **25 arquivos / 52 declarações / 0 migration targets**; todos os entries
  possuem `ownerId`, `scope`, `lifecycle`, `boundedness`, `bound`, `resetOrDispose`, declarations e
  rationale;
- audit, HTTP session runtime, round-trip analytics, AI-artifacts e Model Gateway SQLite fingerprint
  deixaram de depender de singletons reconfiguráveis e passaram a capabilities possuídas por uma
  geração/host apropriado;
- OAuth replay persistence deixou de ser singleton process-global; resource-server possui JWKS/DPoP
  state por geração; issuer tornou-se `createDevOAuthRuntime()` com authorization/PAR/client/cache/
  replay/refresh/persistence/key state lexical por geração;
- duas gerações OAuth concorrentes foram testadas sem compartilhamento acidental de state; restart
  real do host recarrega apenas o estado intencionalmente persistido;
- JWKS é reutilizado dentro da mesma geração e não é compartilhado entre duas gerações distintas;
- suíte MCP canônica executada **duas vezes consecutivas e isoladas**, ambas com **95/95 arquivos e
  538/538 testes verdes**, mantendo `testTimeout=15s`;
- o vermelho intermediário do patch-batch V2 era um fixture white-box que construía
  `OperationContext` sem a recém-explicitada audit capability; o fixture foi corrigido para usar
  `processHost.toolCapabilities`, sem enfraquecer o contrato de produção.

- Faixa G fechada: `http-shared` extinto; `adapters` confirmado como Node host owner;
  stateful/compat semantics movidas para `transport`; três compat edges lazy ratcheted; testing
  direct exceptions reduzidas de 7 para 5; grafo atual **2.238/6.000**, zero ciclos.

- Faixa G fechada: `http-shared` extinto; `adapters` confirmado como Node host owner;
  stateful/compat semantics movidas para `transport`; três compat edges lazy ratcheted; testing
  direct exceptions reduzidas de 7 para 5; grafo atual **2.238/6.000**, zero ciclos.

A partir deste checkpoint, números antigos de `30 migration targets`, `59 arquivos / 107 refs` de
config e a baseline unit vermelha são **história da campanha**, não dívida atual.

# 1. Conclusão executiva

A campanha Arquitetura 2.4 foi **substancialmente bem-sucedida na topologia física e no fechamento
de invariants estáticos**. O MCP atual não corresponde mais ao baseline problemático anterior:
`control-plane/` foi extinto; broad barrels centrais foram removidos; a raiz MCP foi reduzida a um
único arquivo JS; dependências cross-owner estáticas passam majoritariamente por membranes
`public/`; aliases MCP são exatos; o grafo Copilot está acíclico; SDK MCP v1 saiu do lock; o stack
moderno usa os packages oficiais v2; MCP `2026-07-28` é um caminho de execução real;
`McpProcessHost` e process supervision deram ownership verdadeiro a partes relevantes de lifecycle;
workspace virou capability explícita; e wire tools não carregam child-process authority direta.

Essa vitória, porém, **não fecha a Arquitetura 2.4 no sentido normativo**. A dívida dominante mudou
de natureza. Ela deixou de ser principalmente “arquivos no lugar errado” e passou a ser **semântica
operacional que ainda não é integralmente declarada, propagada, isolada ou provada**.

Os achados centrais desta auditoria, reconciliados após as transformações executadas, são:

1. **[P0, resolvido] Computed imports deixaram de ser um ponto cego operacional.** O bypass privado
   `tools → cloudflare` foi removido, o edge runtime → `scripts/model-gateway` foi extinto e o scan
   atual encontra **zero computed dynamic imports**. O manifest/gate falha fechado se um novo edge
   computado surgir sem contrato explícito.
2. **[P0/P1, resolvido — Faixa F] Cancellation deixou de significar apenas “resposta que ganhou uma
   corrida”.** As 131 tools possuem execution policy exata: **30 `cancellable`, 88
   `bounded-non-cancellable` e 13 `not-applicable`**. Para a classe `cancellable`, o registry
   aguarda drain real e falha explicitamente com `MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT` se a
   implementação viola o contrato; a classe bounded declara `workMayContinue` e bound em vez de
   prometer terminalidade inexistente.
3. **[P0/P1, resolvido — Faixa F] Git e subprocess owners relevantes possuem cancellation/process
   lifecycle concreto.** O graph atual contém **15 child-process owners e 22 launcher contracts**,
   com executable/entrypoint, cwd/env authority, completion/acceptance, cancellation, process-group
   e bound governados. Wire tools continuam sem child-process authority direta.
4. **[P0, resolvido] A baseline MCP voltou a ser hermética sob o paralelismo canônico.** Depois de
   remover o harness global de `repo-write` e fechar late effects/cancellation, a suíte atual foi
   executada **duas vezes consecutivas e isoladas**, ambas com **95/95 arquivos e 538/538 testes**,
   preservando `testTimeout=15s`.
5. **[P0/P1, resolvido no piso 2.4] Owner, dynamic/process graph, config authority e state-scope são
   machine-readable e fail-closed.** A retomada auditada em 2026-08-25 confirma **57 owners / 37
   protected boundaries**, **38 arquivos / 63 refs ambientais / 0 migration targets** e **25
   arquivos / 52 declarações de mutable state / 0 migration targets**. Os valores menores
   preservados em checkpoints anteriores são história da campanha, não o ratchet corrente.
6. **[Resolvido] O grafo Copilot permanece acíclico após a campanha.** O gate global atual analisa
   **2.238 arquivos e 6.000 edges**, com zero ciclos, zero unresolved local imports e zero parse
   errors.
7. **[Resolvido + dívida transitiva] As membranes `public/` físicas continuam projection-oriented e
   o gate de package imports voltou a proibir production → `testing` integralmente.** A correção do
   router HTTP stateful moveu inclusive seu type contract para a public membrane. A dívida agora é
   custo/pureza da closure transitiva, não a existência da membrane.
8. **[P1, residual] A audience `testing` possui 37 aliases MCP exatos e somente uma exceção
   white-box direta.** A auditoria do `package.json` em 2026-08-25 encontrou apenas
   `#copilot/testing/mcp/cli -> ./src/copilot/mcp/cli.js` fora de uma membrane física `testing/`.
   Trata-se do entrypoint fino já documentado; M.2 deve decidir entre facade física e rationale
   machine-readable, sem reabrir exceções eliminadas.
9. **[P1, resolvido semanticamente na Faixa I] A surface wire possui output contract explícito
   131/131.** São **131 tools, 93 read-only, 30 bounded-write, 8 destructive, 10 open-world, 10 com
   `outputSchema` específico e 121 `intentional-untyped` com rationale**. A ausência de schema
   deixou de significar contrato desconhecido; generic passthrough continua proibido.
10. **[P1, resolvido na Faixa I] Risk/authority deixaram de ser heurísticos.** Registry, server e
    auth consomem um `McpToolContract` exaustivo 131/131; annotations e OAuth scope são projeções
    derivadas. Os **34 warnings heurísticos caíram para zero** e
    `strictRiskValidation`/`strictToolRiskValidation` foram removidos: truthfulness de risco agora é
    invariant fail-closed, não toggle opt-in.
11. **[SUPERADO por K.4; snapshot histórico pré-K.4] O caminho moderno 2026 ainda não usava cache
    positivo neste ponto da auditoria.** A afirmação `ttlMs: 0` abaixo descreve o estado anterior à
    implementação K.4. O estado live/canônico posterior é `tools/list = 300000 ms / private`, com
    fingerprint generation-bound e regression de invalidation; `server/discover` permanece
    `0/private`.
12. **[P1, confirmado] Hotspots importantes ainda são multi-responsibility.** `repo-write`, auth
    issuer, diagnostics e alguns wire/application modules continuam candidatos a decomposição por
    função/authority. O antigo `http-shared` já foi extinto pela Faixa G. Tamanho permanece sinal
    secundário.
13. **[Resolvido] O default OAuth permanece alinhado ao objetivo operacional.** `max-autonomy` é o
    default, `least-privilege` é opt-in, `iss`/CIMD permanecem canônicos e DCR é compatibilidade.
14. **[P2, confirmado] Ainda existem resíduos documentais/físicos pequenos e evidence gates de
    publicação.** Compat 2025/DCR, cache TTL positivo, algumas testing exceptions, leafification e
    validação no runtime publicado continuam dependentes de evidência real — não de inferência.

## 1.1 Veredito arquitetural

O estado atual é melhor descrito como:

> **Arquitetura 2.4 fisicamente estabelecida e com seu piso de owner/config/state/dynamic/process/
> cancellation governado e verificável por máquina. A incompletude relevante agora se concentra no
> Tool Contract semântico, risk/output contracts, exposure/leafification, custo/pureza transitiva,
> caching moderno e evidence gates de compatibilidade/publicação.**

## 1.2 Implicação estratégica

As quatro pré-condições de governança que bloqueavam novas decomposições já foram satisfeitas:

1. baseline MCP **hermética e repetível**;
2. dynamic imports governados e bypasses privados extintos;
3. manifests fail-closed de owner, dynamic/process graph, config e state/lifecycle;
4. cancellation/process terminality contratada e testada.

A campanha pode, portanto, voltar a atacar hotspots, mas agora **sob essas invariants**. A sequência
corrente passa a ser: Tool Contract/risk/output → exposure/Cloudflare leafification →
custo/index/round-trip/cache/compat. Mass move continua proibido quando não houver fronteira
funcional/authority demonstrável.

---

# 2. Método, evidência e limites da auditoria

## 2.1 Leitura documental completa

A auditoria começou pela leitura integral do documento solicitado e pela reconciliação com os
documentos 2.4 de referência. O documento pós-campanha original tinha 1.618 linhas e já continha uma
análise importante, mas carregava métricas e conclusões de diferentes temporalidades.

A revisão tratou cada afirmação como hipótese até ser reconciliada contra o estado atual.

## 2.2 Snapshot Git atual

Estado observado durante a auditoria:

```text
branch: main
HEAD:   98765175994af1e8e1e327e22b1cd402fed3e834
commit: refactor(mcp): establish architecture 2.4 ownership
HEAD date: 2026-08-23T23:52:12-03:00
upstream: main...origin/main
```

O worktree não pode ser descrito simplesmente como “clean” durante esta rodada porque este documento
existe como artefato documental não rastreado enquanto é produzido. Nenhum outro arquivo tracked foi
alterado intencionalmente pela investigação.

## 2.3 Evidência estática coletada

Foram examinados:

- árvore física completa de `src/copilot/mcp`;
- tamanho/LOC e hotspots;
- `package.json#imports` e aliases MCP;
- membranes `public/` e `testing/`;
- imports estáticos, type imports e `import()`;
- dynamic imports computados;
- referências a `process.env` e `MCP_WORKSPACE_ROOT`;
- module-global mutable state;
- `node:child_process` e process listeners;
- registry/catalog/OperationContext;
- auth resource server/issuer;
- transport 2025/2026;
- Git/process/terminal runtimes;
- Tool Contract/annotations/output schemas;
- README e documentação live relevante.

## 2.4 Evidência executável da auditoria inicial

Antes da autorização da campanha de transformação, foram executados sem transformação de source:

- architecture gate canônico;
- docs gate;
- MCP typecheck;
- lint focal MCP/testes MCP;
- unit suite MCP;
- reruns isolados dos arquivos que falharam;
- sondas in-process do handler MCP moderno;
- scans AST ad hoc para dynamic imports, env-at-import e mutable state;
- leituras do descriptor manifest/tool catalog.

## 2.5 Restrições da auditoria inicial — status histórico

Na fase documental inicial, esta rodada não:

- move arquivos;
- cria manifests;
- altera gates;
- corrige tests;
- limpa `.ai/quarantine`;
- altera runtime/config;
- rebaselineia descriptors/cost;
- faz commit/push;
- promove/reinicia o servidor como consequência de mudança de source.

Essas restrições foram superadas quando a transformação foi explicitamente autorizada; preservam-se
aqui apenas como contexto histórico.

## 2.6 Limites epistemológicos

Algumas decisões exigem evidência que não pode ser inferida apenas do repo:

- uso real de 2025 versus 2026 por hosts suportados;
- CIMD versus DCR em sessões reais;
- efeito de cache hints sobre ChatGPT/Claude;
- contribuição exata de tool surface ao TTFT do host;
- frequência real de sequences inter-tool específicas;
- comportamento de reconnect/reauth após futuras mudanças de auth.

Esses pontos são marcados como **evidence gates** e não como dívidas confirmadas.

---

# 3. Baseline técnico atual

## 3.1 Corpus físico MCP

Medição direta sobre `src/copilot/mcp/**/*.js`:

```text
JavaScript files: 308
JavaScript LOC:   68.099
root JS files:    1
root JS LOC:      295
root file:        src/copilot/mcp/cli.js
```

Distribuição aproximada por tamanho:

| Faixa        | Arquivos |
| ------------ | -------: |
| `<= 150 LOC` |      190 |
| `151–300`    |       42 |
| `301–600`    |       47 |
| `601–1000`   |       21 |
| `1001–1500`  |        2 |
| `1501–2000`  |        3 |
| `2001–3000`  |        1 |
| `> 3000`     |        2 |

Estatísticas aproximadas:

```text
média:   ~221 LOC
mediana: 56 LOC
p90:     ~579 LOC
p95:     ~810 LOC
p99:     ~1.678 LOC
```

### Interpretação

A raiz deixou de ser o problema. O baseline antigo de dezenas de módulos raiz e dezenas de milhares
de LOC diretamente sob `mcp/` foi superado. A arquitetura agora possui hierarquia física real.

A fragmentação também cresceu. Isso não é defeito por si só, mas aumenta a importância de:

- ownership declarativo;
- public closure/cost governance;
- import-purity transitiva;
- dynamic edge governance;
- evitar surface-per-file como substituto de coesão.

## 3.2 Topologia de primeiro nível

Estrutura atual relevante:

```text
mcp/
├─ adapters/
├─ auth/
├─ cloudflare/
├─ composition/
├─ connection/
├─ diagnostics/
├─ indexing/
├─ integrations/
├─ maintenance/
├─ observability/
├─ openai/
├─ process/
├─ protocol/
├─ registry/
├─ runtime/
├─ scripts/
├─ server/
├─ tools/
├─ transport/
├─ validation/
├─ workspace/
├─ cli.js
└─ README.md
```

Esses diretórios representam um avanço substancial sobre `control-plane`. O próximo problema não é
renomeá-los; é **classificar formalmente quais são owners, quais são parent owners e quais são
apenas taxonomias/componentes**.

## 3.3 Hotspots atuais

Maiores arquivos encontrados na auditoria, por LOC aproximado:

| Arquivo                                      | LOC aprox. | Leitura arquitetural inicial                                          |
| -------------------------------------------- | ---------: | --------------------------------------------------------------------- |
| `auth/issuer/dev-oauth.js`                   |     ~4.368 | múltiplas state machines + config + persistence + protocol routes     |
| `tools/repo-write.js`                        |     ~2.035 | exposure/projection; domain write logic já parcialmente leafified     |
| `diagnostics/oauth-smoke/runtime.js`         |     ~2.410 | diagnóstico amplo; revisar se há orchestration demais                 |
| `diagnostics/latency/attribution/runtime.js` |     ~1.678 | aggregation/attribution state e projeção diagnóstica                  |
| `adapters/http/handler.js`                   |       ~529 | assembly/dispatch Node HTTP após decomposição; compat carregado lazy  |
| `auth/resource-server/service.js`            |     ~1.656 | config/verification/JWKS/DPoP/policy/cache                            |
| `registry/runtime.js`                        |     ~1.401 | validation, normalization, execution, budgets, cancellation, manifest |
| `tools/latency-dashboard.js`                 |     ~1.167 | parte significativa da application/diagnostic logic ainda no wire     |

O tamanho é apenas **sinal secundário**. Um arquivo grande e altamente coeso pode ser legítimo; um
arquivo pequeno com duas authorities incompatíveis pode ser pior. O roadmap usa função/ownership
como critério primário.

## 3.4 Public/testing membranes e aliases

Package map atual após a Faixa J:

```text
MCP public aliases exatos: 81
MCP testing aliases:       37
wildcard MCP aliases:      0
broad MCP root aliases:    removidos
```

A redução não veio de ocultar capabilities, mas de substituir facades per-file por membranes
semânticas. Em Cloudflare, especificamente, a surface pública caiu de 27 para **13 aliases**: seis
membranes exatas da foundation compartilhada, seis surfaces coesas de child owner e a surface de
`transport-benchmark`. Os entrypoints `public/` continuam projection-only; business logic permanece
nos owners físicos.

### Testing exceptions

As antigas exceções Cloudflare foram eliminadas. `cli-probe`, `cli-smoke`, post-change gates e
transport benchmark agora atravessam `observability/testing`, `process/testing`, `posture/testing` e
`transport-benchmark/testing` conforme a necessidade real de white-box. Onde o contrato público já é
suficiente, os testes usam a própria public membrane em vez de criar facade de teste artificial.

Resta **uma exceção explícita** no package map:

```text
#copilot/testing/mcp/cli -> ./src/copilot/mcp/cli.js
```

Ela corresponde ao próprio entrypoint fino do MCP, não a um owner de business logic. O objetivo
continua sendo eliminar exceções invisíveis, não impor `testing/` mecanicamente.

## 3.5 Grafo estático e gates

O architecture gate canônico está verde e reporta, no grafo Copilot atual:

```text
files: 2.238
edges: 6.000
cycles: 0
```

O gate também protege, entre outros pontos:

- aliases exatos;
- zero broad MCP aliases históricos;
- zero relative cross-top imports MCP estáticos;
- produção não consumindo testing surfaces;
- child-process authority fora de wire tools;
- ausência do antigo `control-plane`;
- outras constraints de ownership já materializadas.

### Conclusão correta

O **grafo estático representado pelo checker** está em excelente estado.

### Conclusão incorreta a evitar

Não é possível inferir disso que **todo dependency edge runtime** respeita as membranes, porque
imports computados não são resolvidos pela mesma análise.

## 3.6 Dynamic imports: ponto cego confirmado

A auditoria AST encontrou exatamente dois `import()` cujo source não é literal.

### 3.6.1 `tools/cloudflare-config.js`

Padrão atual:

```js
const modulePath = '../cloudflare/' + 'plan-capabilities-audit.js';
const mod = await import(modulePath);
```

Esse código:

- nasce no top-level owner `tools`;
- entra em `cloudflare`;
- importa uma implementação privada;
- não usa `#copilot/mcp/public/cloudflare/...`;
- escapa do checker porque a string é computada.

**Classificação:** P0 arquitetural, confirmado.

O problema não é dynamic import em si. O problema é um dynamic import usado para atravessar uma
membrane que seria rejeitada se o source fosse estático/literal.

### 3.6.2 Model Gateway live readiness

`integrations/model-gateway/live-runs/readiness.js` constrói uma URL estável para:

```text
scripts/model-gateway/commands/model-gateway-live-readiness.mjs
```

e depois a importa dinamicamente.

Esse edge é determinístico, mas:

- não é visto como dependency normal pelo grafo estático;
- liga runtime/integration a um módulo sob `scripts/`;
- requer decisão arquitetural explícita sobre quem é o owner real da lógica de readiness.

**Classificação:** P1, confirmado.

O script pode ser apenas um nome histórico para um module owner legítimo, ou pode ainda ser business
logic escondida em entrypoint space. Deve ser auditado por função antes de mover qualquer coisa.

## 3.7 Configuração ambiental

Contagem textual atual:

```text
process.env refs:   210
files com refs:      64
```

Também há:

```text
MCP_WORKSPACE_ROOT refs:  35
files com refs:            14
```

### 3.7.1 Import-time environment reads

A inspeção AST encontrou quatro arquivos com acesso a `process.env` em module scope:

```text
src/copilot/mcp/cli.js
src/copilot/mcp/cloudflare/cli.js
src/copilot/mcp/observability/audit/service.js
src/copilot/mcp/process/terminal/runtime.js
```

Os dois primeiros são CLIs/entrypoints e podem legitimamente capturar ambiente no boot.

Os dois últimos merecem análise de autoridade:

- `observability/audit/service.js` fixa a identidade do arquivo de audit no import e também possui
  toggles ambientais lidos durante operações;
- `process/terminal/runtime.js` captura `DEFAULT_SHELL` no import.

Nenhum deles é automaticamente bug. O gap é a ausência de um **config touchpoint contract** que diga
quais reads são bootstrap identity, quais são runtime policy e quais deveriam ser injetadas.

## 3.8 Mutable state process-local

Scan estrutural encontrou:

```text
files com top-level mutable bindings/collections: 48
let declarators top-level:                         69
Map/Set/Weak* top-level:                           54
```

Hotspots incluem:

- `auth/issuer/dev-oauth.js`;
- `registry/runtime.js`;
- `auth/resource-server/service.js`;
- latency analytics/monitors;
- registry surface policy;
- read cache;
- Model Gateway readiness;
- `company-knowledge`;
- validation jobs;
- terminal sessions;
- stateful sessions;
- Cloudflare caches;
- observability metrics.

### Interpretação

`module-global` não significa `incorreto`. Alguns estados são intrinsecamente process-global:

- memoized immutable metadata;
- bounded cache compartilhado por processo;
- singleton CLI identity;
- process-wide metrics.

O problema é **estado global sem declaração de owner/scope/lifecycle/reset semantics**.

O estado-alvo deve permitir state global legítimo, mas torná-lo explícito e verificável.

## 3.9 Process/subprocess surface

Contagem textual:

```text
node:child_process refs: 30
files:                   18
```

O gate reconciliado atual reconhece **15 import authorities de child process**, exatamente
coincidentes com o manifest, e **22 launcher contracts**. Não existem child-process imports em wire
tools.

A governança deixou de ser apenas uma lista de arquivos. Cada launcher relevante declara e é
ratcheted por:

- executable/entrypoint class;
- completion/acceptance model;
- cwd authority;
- environment/credential projection;
- caller cancellation model;
- process-group policy;
- bound/terminality semantics.

Para launchers `before-acceptance`, o architecture checker exige evidência estática de
`abortAware + detachedLaunch + spawnAcceptance + observesClose`. Sessões persistentes ganharam uma
classe mais precisa, `before-acceptance-then-explicit-control`: o caller possui a abertura somente
até o `spawn`; antes disso abort termina e drena o process group, depois disso lifecycle authority é
transferida deliberadamente para `terminal_session_control`.

Casos attached como Git, validation, maintenance e terminal one-shot usam supervisor/process group e
observam `close` antes de declarar terminalidade. IO-cache, Cloudflare benchmark, Model Gateway e
controlled reload possuem acceptance boundaries explícitas; no Model Gateway, acceptance ocorre
somente após manifest durável.

**Estado:** o process graph deixou de ser dívida não modelada. A dívida futura é ampliar/ajustar
contratos somente quando novos owners/launchers surgirem, sem relaxar o ratchet atual.

## 3.10 Process listeners

Foram encontrados cinco registrations `process.once(...)` no MCP:

- quatro em `cli.js`, associados a sinais/teardown de entrypoint;
- um em `observability/audit/service.js`, usado para flush em `beforeExit`.

Isso é pequeno e plausível, mas deve entrar no lifecycle manifest para que process-wide hooks não
sejam invisíveis.

## 3.11 Wire surface

Snapshot atual:

```text
tools:         131
readOnly:       93
destructive:     8
idempotent:     92
openWorld:      10
outputSchema:   10
```

Tools com output schema específico no snapshot:

```text
repo_status
git_status
git_diff
git_log
git_branch_info
terminal_exec
terminal_session_control
terminal_session_read
search
fetch
```

O payload observado de `tools/list` é de aproximadamente 158,7 KiB, contra limite operacional de
409,6 KiB. Há headroom significativo.

### Consequência

A contagem de 131 tools, por si só, **não é o problema técnico atual**. Antes de reduzir surface por
estética, é necessário medir:

- tool selection/TTFT no host;
- frequência de rediscovery;
- descriptors efetivamente usados;
- custo de descriptions/schemas;
- benefício de surface profiles em sessões reais.

## 3.12 Registry validation

Após a Faixa I, registry e server factory observam:

```text
validation errors:              0
validation warnings:            0
strictDescriptorValidation: false
risk truthfulness:      semantic/fail-closed
```

O antigo conjunto de 34 warnings deixou de existir porque as categorias que eram inferidas por nome
foram substituídas por contrato explícito. O snapshot semântico atual é:

```text
mutation:       93 none / 30 bounded-write / 8 destructive
network:        101 local / 20 fixed-external / 10 open-world
idempotency:    92 idempotent / 1 stateful-read / 38 non-idempotent
caller scope:   89 read / 20 write / 9 validate / 13 admin
output:         10 specific / 121 intentional-untyped
```

`strictDescriptorValidation=false` continua sendo uma decisão distinta: esse flag trata higiene
textual/metadata. Risco, authority, credentials, retry, cancellation e output class não dependem
dele. Os antigos `strictRiskValidation` e `strictToolRiskValidation` foram retirados porque
truthfulness de risco não deve ser opcional.

## 3.13 Protocolo MCP moderno

O repo declara packages oficiais MCP v2 e não possui o SDK v1 antigo no lock.

O caminho moderno usa explicitamente MCP `2026-07-28`, enquanto o compat owner preserva
versões 2025.

Sondas diretas do handler moderno confirmaram:

- envelope moderno é validado de verdade;
- requests sem metadata obrigatória 2026 são rejeitados;
- `tools/list` com envelope 2026 completo retorna HTTP 200;
- `server/discover` retorna HTTP 200;
- o caminho moderno não é apenas uma constante ou teste morto.

Isso é evidência positiva forte.

## 3.14 Cache hints do protocolo moderno

Nas sondas atuais:

```text
ttlMs:      0
cacheScope: private
```

`ttlMs: 0` equivale a descriptor imediatamente stale para fins de cache hint. Isso é seguro, porém
não explora a cacheabilidade positiva disponível no stack moderno.

Como o repo já possui:

- descriptor fingerprint;
- schema convergence tracking;
- `listChanged` capability;

há base técnica para uma futura política de cache com invalidação explícita.

**Não implementar antes de formalizar convergence/invalidation.** Cache positivo errado é pior que
nenhum cache.

## 3.15 Auth/OAuth atual

Pontos que esta auditoria considera **resolvidos ou corretamente deliberados**:

- `max-autonomy` é o default normalizado;
- `least-privilege` é opt-in;
- issuer e resource server são fisicamente distintos;
- CIMD é o caminho canônico;
- DCR é compatibilidade/fallback;
- issuer inclui `iss` na resposta de authorization;
- hardening DPoP/private_key_jwt/replay já existe de modo relevante;
- client metadata fetch possui proteção public-only na resolução/conexão.

Dívida real permanece em:

- size/state-machine concentration;
- config/env reads;
- process-global maps/caches;
- instance ownership;
- telemetry necessária para death decisions de compat.

## 3.16 Baseline de validação — checkpoint histórico e reconciliação atual

O bloco 3.16.1–3.16.3 preserva deliberadamente o **primeiro checkpoint vermelho** desta auditoria,
porque ele foi a evidência que motivou a correção de hermeticidade/cancellation. Ele **não
representa o estado atual**.

Resultados observados naquele primeiro checkpoint:

| Gate/validação              | Resultado                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| architecture gate           | verde                                                                                                              |
| docs gate                   | verde — mas não detectou o `core/` obsoleto em `src/copilot/README.md`, portanto sua cobertura semântica é parcial |
| MCP typecheck               | verde                                                                                                              |
| lint MCP + testes MCP       | verde                                                                                                              |
| `npm run mcp:stateful:unit` | **vermelho: 487/491**                                                                                              |

### 3.16.1 Unit suite — primeiro run

Falhas:

1. `test_mcp_runtime_metrics.spec.js` — timeout 15s;
2. `test_mcp_tools.spec.js` — timeout 15s;
3. `test_mcp_repo_write.spec.js` — fluxo quarantine/restore timeout 15s;
4. `test_mcp_repo_write.spec.js` — rollback test falhou no run completo; a atribuição causal foi
   refinada pelos reruns e pela inspeção do estado persistente.

### 3.16.2 Reruns isolados

Resultados:

- `test_mcp_runtime_metrics.spec.js`: 5/5 verde;
- `test_mcp_tools.spec.js`: 61/61 verde;
- `test_mcp_repo_write.spec.js`: 28/29; a única falha consultou um artefato
  `quarantine-commit-rollback` persistido pela execução anterior.

Na segunda execução isolada não foi produzido um novo par de artefatos com esse nome. Portanto a
auditoria **não conclui que o algoritmo atual de rollback deterministamente deixa resíduo**.

Ela conclui algo diferente e mais importante para o processo de engenharia:

> **o teste não é hermético em relação ao diretório persistente de quarentena e o timeout da suíte
> pode permitir trabalho assíncrono tardio depois que o framework já declarou o teste falho.**

### 3.16.3 Mecanismo de interferência

O arquivo de teste usa um `quarantineMetadataWriter` module-global mutável via
`repoWriteTestHarness`. O `afterEach` o restaura, mas um timeout não cancela automaticamente a
Promise/trabalho real.

Se a operação timed-out continua:

- ela pode observar uma mudança posterior desse writer global;
- pode terminar depois de o framework avançar;
- pode produzir artefatos no diretório persistente;
- testes seguintes podem enumerar esses artefatos globais.

A configuração do Vitest aumenta a relevância dessa classe de problema:

```text
testTimeout:      15000
pool:             threads
maxWorkers:       50%
fileParallelism:  true
```

A conclusão correta naquele checkpoint era **baseline/test hermeticity debt**, não “aumentar o
timeout para 30s”.

### 3.16.4 Reconciliação após as correções

O harness module-global foi extinto, fault injection passou a ser instance-local, cancellation/drain
foi governada pela Faixa F e os testes de quarantine/restore passaram a provar recovery sem depender
de enumeração histórica.

A geração atual foi executada duas vezes consecutivas e isoladas sob a configuração canônica:

```text
run 1: 95/95 files, 538/538 tests
run 2: 95/95 files, 538/538 tests
testTimeout: 15000 ms (inalterado)
```

Portanto os números 487/491 e 28/29 acima são **evidência histórica superseded**, preservada para
explicar o mecanismo descoberto; não são dívida aberta do HEAD atual.

---

# 4. O que a campanha 2.4 resolveu de forma convincente

Esta seção existe para evitar que o próximo ciclo desperdice esforço reabrindo problemas já
encerrados.

## 4.1 Extinção do `control-plane`

Resolvido e protegido por gate. Não recriar outro bag horizontal com nome diferente.

## 4.2 Root flattening

Resolvido. A raiz tem um único JS de entrypoint. O próximo problema está dentro dos owners, não no
root.

## 4.3 Broad barrels MCP

Os broad barrels centrais foram removidos e substituídos por surfaces exatas. Esse invariant deve
permanecer.

## 4.4 SDK v1

Resolvido. O stack está na família oficial v2 e o caminho 2026 funciona.

## 4.5 Workspace service location

Substancialmente resolvido para tool operations: `McpWorkspaceCapability` e
`OperationContext.workspace` criaram authority explícita.

## 4.6 ProcessHost/lifecycle

O `process/host` atual é um owner neutro, lease-based, com terminal states e disposal explícito.
`composition/process-host` concentra wiring concreto. Não há razão para desfazer essa separação.

## 4.7 Child-process authority no exposure plane

Resolvido por arquitetura: wire tools não importam `child_process`. Process execution está em
runtimes/owners próprios.

## 4.8 Child environment hardening

Broad ambient credential inheritance foi significativamente reduzida e virou invariant relevante.
Preservar.

## 4.9 Scripts como launchers

Vários scripts críticos deixaram de ser business owners escondidos e foram reduzidos. O edge Model
Gateway identificado nesta auditoria é uma exceção que deve ser examinada, não evidência de que toda
a estratégia falhou.

## 4.10 Public membranes físicas

As membranes públicas atuais são estruturalmente finas/projection-only. O próximo passo é governar
closure/cost/purity transitiva, não reinventar os facades.

## 4.11 OAuth default operacional

`max-autonomy` é deliberado e coerente com o objetivo do projeto. Não rebaixar silenciosamente em
nome de uma noção abstrata de least privilege; a melhora deve ocorrer na precisão de
authority/effects por operação.

## 4.12 Dual-era transport

Modern 2026 e compat 2025 estão separados o suficiente para serem tratados como owners/paths
diferentes. Compatibilidade ainda precisa de telemetry/death condition, mas não deve ser removida
por estética.

---

# 5. Ledger consolidado de achados — reconciliado com a execução atual

| ID          | Severidade | Status                    | Achado / estado atual                                                                   | Condição restante                                                                     |
| ----------- | ---------- | ------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| MCP24-P0-01 | P0         | **Resolvido**             | dynamic import privado `tools → cloudflare` foi eliminado                               | ratchet computed-import + membrane pública permanecem verdes                          |
| MCP24-P0-02 | P0         | **Resolvido**             | suíte canônica repetível na geração atual: 2 × `95/95`, `538/538`                       | preservar hermeticidade e `testTimeout=15s`; novo late effect deve falhar causalmente |
| MCP24-P0-03 | P0         | **Resolvido no piso 2.4** | owner/dynamic/state/config ontologies agora são machine-readable e fail-closed          | enriquecer owner/process authority classes sem perder o piso atual                    |
| MCP24-P1-01 | P1         | **Resolvido**             | runtime → `scripts/model-gateway` dynamic edge foi extinto                              | preservar owner `model-gateway/readiness` e launcher-only scripts                     |
| MCP24-P1-02 | P1         | **Resolvido — Gate F**    | execution policy 131/131; 30 cancellable, 88 bounded, 13 N/A; drain/acceptance testados | manter classification fail-closed e process lifecycle manifest coerente               |
| MCP24-P1-03 | P1         | **Resolvido**             | env authority confinada: 38 arquivos / 63 refs / **0 migration targets**                | manter parser-default/entrypoint authorities declaradas                               |
| MCP24-P1-04 | P1         | **Resolvido**             | mutable state ratcheted: 25 arquivos / 52 declarações / **0 migration targets**         | não aceitar novo state sem owner/scope/lifecycle                                      |
| MCP24-P1-05 | P1         | Residual                  | 37 testing aliases MCP; 1 white-box direto (`#copilot/testing/mcp/cli`)                 | facade ou rationale/manifest explícito para a única exceção                           |
| MCP24-P1-06 | P1         | Confirmado                | registry risk validation continua heurística/non-strict                                 | Tool Contract semântico e projections derivadas                                       |
| MCP24-P1-07 | P1         | Confirmado                | output schema específico continua 10/131                                                | classification/rationale por tool; ampliar apenas onde semanticamente estável         |
| MCP24-P1-08 | P1         | Parcialmente resolvido    | state/config ownership dos hotspots avançou, mas alguns arquivos ainda são grandes      | decomposição por função/owner, não por tamanho                                        |
| MCP24-P1-09 | P1         | Parcialmente resolvido    | 15 child-process import owners estão manifestados e ambient inheritance é proibida      | enriquecer executable/cwd/env/signal/process-group/terminality por launcher           |
| MCP24-P2-01 | P2         | Confirmado                | modern cache hints permanecem em TTL 0                                                  | política positiva ligada a fingerprint/convergence/invalidation                       |
| MCP24-P2-02 | P2         | Evidence gate             | 2025/DCR retirement                                                                     | telemetry real + janela de zero uso + reconnect/reauth                                |
| MCP24-P2-03 | P2         | Confirmado                | docs/resíduos live ainda precisam fechamento                                            | README/live docs e resíduos físicos alinhados ao HEAD                                 |
| MCP24-P2-04 | P2         | Evidence gate             | impacto da surface 131 no host                                                          | TTFT/tool-selection/refresh measurement real                                          |

---

# 6. Auditoria profunda por eixo

## 6.1 Gate completeness: estático não é sinônimo de completo

A campanha 2.4 acertou ao fortalecer gates antes/depois dos moves. O novo problema é mais sutil: **o
gate atual dá uma prova forte sobre um subconjunto de dependency edges**, mas não possui uma
representação unificada de:

- computed `import()`;
- worker entrypoints;
- subprocess entrypoints;
- file/URL loaders usados como code loading;
- runtime plugin/module resolution;
- child scripts que funcionam como business modules.

### Estado-alvo

O architecture checker não precisa “executar JavaScript” para descobrir tudo. Ele precisa adotar
política fail-closed:

- imports literais: resolvidos automaticamente;
- computed imports: proibidos por default ou registrados explicitamente;
- registered computed target: source owner, target owner, rationale e allowed audience;
- worker/subprocess code entrypoint: edge no dynamic/process manifest;
- novo loader não classificado: gate falha.

### Regra importante

Não banir dynamic import por princípio. Ele é útil para:

- optional native dependencies;
- lazy-loading pesado;
- feature boundaries;
- plugin systems controlados.

O que deve ser proibido é **dynamic import como mecanismo de invisibilidade arquitetural**.

## 6.2 Owner ontology: o próximo piso de governança

Hoje existem owners de fato, mas a máquina ainda depende de listas/knowledge codificados em checks.

Um owner manifest deve responder:

```text
ownerId
path
parentOwnerId
kind: owner | taxonomy | entrypoint-space
publicSurfaces
testingSurfaces
allowedDependencies
stateScopePolicy
configAuthority
lifecycleAuthority
processAuthority
networkAuthority
credentialAuthority
costTier
```

### O que o manifest não deve fazer

- não transformar toda pasta em owner;
- não atribuir owner id a helpers triviais;
- não produzir uma ontologia tão detalhada que manter o manifest custe mais que a arquitetura;
- não ser um arquivo escrito à mão que apenas duplica o gate sem validação de stale entries.

### O que deve ser derivável

A partir dele, o repo deve conseguir derivar pelo menos:

- protected owner roots;
- parenthood constraints;
- cross-owner public/testing rules;
- orphan owner detection;
- surface ownership;
- owner graph acyclicity;
- cost/state/config/dynamic policies.

## 6.3 Config authority e `McpProcessConfig`

A contagem de 210 env refs é um indicador de arquitetura de configuração ainda distribuída.

O objetivo **não** deve ser “zero `process.env`”. O objetivo deve ser:

> **Toda leitura ambiental tem autoridade declarada e ocorre em um boundary de bootstrap/config
> apropriado; owners recebem snapshots/projections imutáveis e não reinterpretam ambient state
> durante requests.**

### Estado-alvo conceitual

```text
McpProcessConfig
├─ identity/workspace
├─ protocol
├─ registry/toolSurface
├─ auth
│  ├─ resourceServer
│  └─ issuer
├─ transport
│  ├─ http
│  └─ compat2025
├─ connection
├─ process
├─ diagnostics
├─ observability
├─ maintenance
├─ cloudflare
└─ integrations
```

### Regras

- builder canônico no composition/bootstrap;
- deeply immutable;
- secrets separados de diagnostic projection;
- cada owner recebe apenas sua projection;
- config refresh, se existir, é operação explícita/versionada;
- test config é injetável sem mutação global de `process.env` como principal mecanismo.

## 6.4 State-scope governance

O MCP precisa de um state manifest semelhante em espírito ao de Infra, mas adequado aos scopes reais
do domínio.

Scopes mínimos candidatos:

```text
process
process-host/runtime
workspace
session
request/operation
persistent-store
```

Cada state binding relevante deve declarar:

- owner;
- scope;
- criação;
- lazy/eager;
- mutabilidade;
- boundedness;
- disposal/reset;
- persistence;
- recovery/restart semantics;
- testing reset/access policy.

### Exemplo de decisão correta

Um process-wide bounded cache pode permanecer module-global se:

- a identidade é process-wide por design;
- o size/TTL é limitado;
- não contém capability/request-secret indevido;
- possui invalidation/reset semantics;
- testes não dependem de order global implícita.

### Exemplo de decisão incorreta

Converter todo `Map` em uma classe instance-owned apenas para reduzir uma métrica textual.

## 6.5 Cancellation: contrato executável e terminalidade real

A Faixa F fechou o gap que existia no início desta auditoria. `OperationContext` continua fornecendo
caller signal, deadline composto por `AbortSignal.any`, `cancellationSource()` e workspace
capability, mas agora há também uma policy exaustiva por tool e uma semântica explícita no registry.

### Tool Execution Contract atual

As 131 tools são classificadas por nome exato e fail-closed:

```text
cancellable:              30
bounded-non-cancellable:  88
not-applicable:            13
-----------------------------
total:                    131
```

Um nome ausente ou stale invalida a construção do catálogo.

### Semântica do registry

Para `cancellable`:

1. pre-abort impede a invocação do handler;
2. abort durante execução é propagado ao handler;
3. o registry **aguarda o handler drenar** antes de devolver cancellation;
4. se o handler declarado cooperativo não drena dentro do bound, o registry devolve
   `MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT` — uma violação explícita de contrato, não um falso
   `cancelled`.

Para `bounded-non-cancellable`, o registry não inventa terminalidade: a resposta de cancellation
expõe `workMayContinue=true`, rationale e continuation bound. Essa classe permanece necessária para
operações nas quais a unidade atômica/recovery não pode ser interrompida de forma segura.

### Git e subprocessos attached

`workspace/git/runtime.js` não usa mais `execFileAsync` sem signal nem fallback global de cwd. O
runtime exige cwd explícito, projeta env, supervisiona process group e combina caller signal com
timeout. Teste causal encerra inclusive descendant/grandchild e só resolve após terminalidade
física.

Validation, maintenance e terminal one-shot seguem a mesma propriedade relevante: cancellation
solicita TERM→KILL conforme policy e aguarda `close`.

### Indexing

Signal alcança `refreshPaths`, `buildDirectory`, `reconcileAutoRefreshDomain` e o auto-build. O
sweep de reconcile verifica abort entre rows; full auto-build abortado não publica reconcile
posterior nem checkpoint de sucesso. `repo_index_build` pôde, por isso, ser promovido para
`cancellable`.

### Detached acceptance

Os launchers detached relevantes agora têm acceptance semantics explícitas:

- IO-cache benchmark: pre-acceptance abort termina/draina; acceptance transfere o job;
- Cloudflare benchmark: mesma regra;
- Model Gateway live run: acceptance exige `spawn` **e manifest durável**; abort durante publish
  remove manifest, termina e drena;
- controlled reload: pre-acceptance abort drena antes de persistir `failed`;
- terminal persistent session: `before-acceptance-then-explicit-control`.

### Mutations e recovery

Filesystem mutations ganharam signal em locks e safe boundaries de atomic write, mkdir, chmod, patch
single/batch, copy, move, delete e removePath. A regra é deliberadamente conservadora:

> cancellation pode impedir uma nova fase segura; uma publicação atômica já iniciada termina de
> forma determinística.

`repo-write` propaga signal ao **forward work**, mas rollback/reconciliation iniciado após uma
mudança física é cancellation-shielded. Fault injection prova:

- abort após quarantine move restaura a origem e remove journal/data residual;
- abort durante restore commit restaura destination anterior e mantém o item quarantined/restorable;
- abort após patch virtual validation, antes da publish boundary, deixa o arquivo byte-identical.

Por isso repo-write permanece corretamente `bounded-non-cancellable`: recovery pode continuar após o
cancelamento do caller para restaurar invariants. Isso é mais verdadeiro do que promover a tool
artificialmente a `cancellable`.

### Evidência

A malha focal da Faixa F passou **149 testes**; o terminal persistent boundary foi depois ampliado
para **13/13** testes; e a suíte MCP canônica, executada sem validators concorrentes, repetiu **duas
vezes 95/95 arquivos e 538/538 testes**.

**Conclusão:** cancellation no MCP atual é uma propriedade contratada. Para tools declaradas
`cancellable`, resposta cancelada depende de drain real; para bounded work, a continuação possível é
explicitamente declarada e limitada.

## 6.6 Test hermeticity e late effects

A falha da suíte é arquiteturalmente valiosa porque expõe um problema que testes isolados não
mostram.

### Três fatores se combinam

1. fixture usa diretório persistente global `.ai/quarantine`;
2. harness altera `quarantineMetadataWriter` module-global;
3. timeout do framework não aborta necessariamente o trabalho da Promise.

### Estado-alvo de teste

- cada teste que cria artifacts usa namespace/root único;
- enumeration não depende de lixo histórico de runs anteriores;
- harness mutation é instance/local quando possível;
- se global test hook for inevitável, test deve serializar explicitamente e restaurar somente após
  drain;
- afterEach não deve ser a única proteção contra work que continua depois de timeout;
- testes de cancellation devem garantir ausência de late mutation.

### Não fazer

Não resolver primariamente aumentando `testTimeout`. Isso mascara o sintoma e deixa o mecanismo
intacto.

## 6.7 Process authority e subprocess graph

A separação wire → runtime está correta. A próxima maturidade é declarar o contrato de cada process
owner.

### Manifest proposto

Cada launcher relevante registra:

```text
id
ownerId
kind: child-process | worker | detached-daemon | optional-native-loader
entrypoint/executable
cwdAuthority
environmentProjection
credentialProjection
signalPolicy
timeoutPolicy
processGroupPolicy
detachedPolicy
closeObservation
teardownOwner
```

### Git e checkpoint

`workspace/git/runtime.js` e `indexing/auto-build/checkpoint.js` ainda usam `execFile` diretamente.
Pode ser legítimo ter primitive Git específica; não é obrigatório passar pelo terminal genérico. Mas
ambos devem compartilhar os invariants de:

- env mínimo;
- cwd explícito;
- signal;
- bounded output;
- close/terminality;
- structured error semantics.

## 6.8 HTTP/transport — Faixa G fechada

O antigo `adapters/http-shared.js` foi **extinto sem shim**. Ele havia se tornado um bag horizontal
de aproximadamente 1.846 linhas, reunindo policy, proxy trust, rate limiting, security headers,
auth, envelope/protocol parsing, health, telemetry e dispatch. A decomposição foi feita por
responsabilidade e ownership, não por tamanho.

O estado atual é:

- `adapters/http/handler.js`: assembly/dispatch do Node host adapter (~529 linhas);
- `adapters/http/config.js`: policy/config HTTP normalizada;
- folhas coesas para request identity, rate limiter, envelope, response, security, auth-context,
  health, telemetry, runtime-state e timing;
- `adapters/http-body.js`: **somente bounded Node body I/O**, sem session semantics;
- `transport/http/stateful/router.js`: state machine de sessão/replay/SSE no owner de transport;
- `transport/http/stateful/request-contract.js`: classificação pura de initialize/session contract;
- `transport/http/compat/stateless`: lifecycle stateless da família 2025;
- public membranes stateful exatas (`config`, `runtime`, `streams`, `request-contract`, `router`).

A topologia `adapters/` foi, portanto, **confirmada como owner legítimo da borda Node host**, e não
como sinônimo de transport. Semântica MCP stateful/stateless pertence a `transport/http/*`; Node
request/response/listener integration pertence a `adapters/`.

O caminho moderno 2026 não carrega eager os internals de compatibilidade 2025. O handler possui três
`import()` literais, todos posteriores à decisão de compatibilidade:

1. stateful request contract;
2. stateful router;
3. stateless compatibility transport.

O architecture checker fixa os invariants:

- `mcp-modern-http-handler-keeps-compatibility-transports-lazy`: `literalLazyEdges=3`,
  `eagerCompatEdges=0`;
- `mcp-http-body-reader-is-host-io-only`: body I/O não pode voltar a possuir session semantics;
- `NodeStreamableHTTPServerTransport` não pode voltar ao host adapter;
- `http-shared`, `adapters/http-stateful-router` e suas antigas public/testing surfaces estão na
  lista de topologia aposentada e não podem reaparecer.

O rate limiter também deixou de possuir buckets process-globais: cada geração/listener possui sua
própria instância, com regressão explícita demonstrando isolamento entre duas gerações. Esse corte
reduziu o state manifest de 26/53 para **25 arquivos / 52 declarações**.

A barreira da Faixa G passou strict, lint, docs, architecture, 60/60 focais HTTP/security/dual-era e
a suíte MCP canônica **duas vezes consecutivas: 95/95 arquivos, 538/538 testes**.

## 6.9 Auth resource server e issuer

A separação resource-server/issuer é correta e deve permanecer.

### Issuer

`dev-oauth.js` é o maior hotspot e concentra, em graus diferentes:

- config;
- routes/metadata;
- client metadata/CIMD;
- DCR compat;
- authorization/PAR/code flows;
- token/refresh families;
- key/proof logic;
- state maps;
- persistence/recovery.

O estado-alvo não precisa criar dez owners. Provavelmente existe **um issuer owner com componentes
internos**, e algumas state machines podem merecer child modules sem autonomy pública.

### Resource server

Também precisa separar conceitualmente:

- config/metadata;
- bearer/JWT verification;
- JWKS;
- DPoP/replay;
- authorization/scope policy;
- decision cache;
- diagnostic projection.

### Security invariants a preservar

- CIMD canonical;
- DCR compat isolada;
- issuer identification (`iss`);
- public-only client metadata resolution;
- proof/replay hardening;
- secrets fora de health/status;
- `max-autonomy` como default deliberado enquanto essa for a política do projeto.

## 6.10 Tool Contract: authority antes de annotations

As ToolAnnotations MCP não são ricas o suficiente para representar completamente o modelo
operacional do repo. A Faixa I materializou, por isso, um contrato interno exaustivo 131/131, com
attachment fail-closed por nome canônico e projection derivada para o wire.

Contrato interno implementado:

```text
McpToolContract
├─ effects
│  ├─ mutation: none | bounded-write | destructive
│  └─ externalSideEffects: none | guarded | possible
├─ authority
│  ├─ callerScope: read | write | validate | admin
│  └─ network: local | fixed-external | open-world
├─ credentials
│  └─ none | cloudflare-api | git-upstream | model-provider | package-registry
├─ idempotency: idempotent | stateful-read | non-idempotent
├─ retry: safe | conditional | manual-only
├─ execution
│  └─ cancellation + rationale/bounds
├─ resultBudget
└─ output
   ├─ specific
   └─ intentional-untyped + rationale

Protocol projection derivada
├─ annotations
├─ OAuth/security scope
├─ registry/server risk summary
└─ output/result-budget validation
```

### Resultado observado

- annotations não são mais declaradas pelos owners wire: são projeções do Tool Contract;
- OAuth scope é derivado de `authority.callerScope` e preservou exatamente 89/20/9/13;
- risk validation é semântica e fail-closed, sem regex sobre nomes;
- registry/server passaram de 34 warnings heurísticos para zero;
- diagnostics/status reportam mutation/network/credentials/retry/output diretamente do contrato;
- `max-autonomy` continua coexistindo com authority explícita por operação;
- `defineMcpRawTool` contextualiza cada definição literal pelo próprio `inputSchema` Zod; o catálogo
  heterogêneo apaga o tipo uma única vez para `unknown`, sem `args:any` e sem parse duplicado.

## 6.11 Output schemas

A cobertura 10/131 não deve ser tratada como score que precisa chegar mecanicamente a 131.

Classes sugeridas:

1. **stable structured contract** — deve ter schema específico;
2. **heterogeneous diagnostic envelope** — pode ter schema parcial/union;
3. **large opaque/tool-dependent payload** — ausência pode ser deliberada, com rationale;
4. **legacy/untyped** — dívida explícita com prioridade.

### Prioridade

Adicionar schema onde isso:

- melhora host validation;
- reduz ambiguity;
- protege downstream structuredContent;
- possui formato estável.

Não reintroduzir `z.record(z.any())` passthrough apenas para obter 100% nominal.

## 6.12 Modern descriptor caching — análise histórica pré-K.4

> **SUPERADO:** esta subseção preserva a decisão antes da implementação K.4. O estado atual está na
> Faixa K.4: `tools/list = 300000/private`, `server/discover = 0/private`, fingerprint wire
> generation-bound e invalidation provada. A observação do origin é distinta do snapshot
> administrativo de actions do ChatGPT.

Naquele checkpoint, `ttlMs: 0` era conservador e correto, mas potencialmente desperdício. O
estado-alvo então proposto era:

- descriptor fingerprint é a identidade da surface;
- `tools/list`/discover recebe TTL positivo moderado;
- mudança de fingerprint dispara listChanged/invalidation;
- observação de `tools/list` comprova somente descriptor retrieval no origin; não prova atualização
  do snapshot administrativo do ChatGPT;
- cache é privado e não mistura auth-dependent surfaces indevidamente.

### Evidence gate

Antes de implementar, medir:

- frequência real de `tools/list`/discover;
- comportamento do ChatGPT com cache hints;
- refresh após descriptor change;
- benefício TTFT/payload.

## 6.13 Exposure-plane leafification

Os exemplos já finos da campanha devem servir como referência. A leafification restante deve ser
seletiva.

### `repo-write`

Provável extração por função:

- quarantine transaction/journal/reconcile;
- restore transaction/recovery;
- file-batch application orchestration;
- post-write validation orchestration.

Wire permanece responsável por:

- schema;
- confirmation/preflight semantics;
- selecionar application operation;
- projetar MCP result/error.

### `latency-dashboard`

Budgets, rankings, history comparison e SLO assessment pertencem mais naturalmente a
diagnostics/latency do que ao wire.

### `company-knowledge`

Corpus config/cache/scanner/search não deveria depender da tool como owner. `search`/`fetch` devem
ser projections do owner semântico.

### Outros hotspots

Entram apenas se outline/authority demonstrar multi-responsibility. Nenhum split só para diminuir
LOC.

## 6.14 Cloudflare

O domínio é legítimo e não deve ser empurrado artificialmente para Infra.

A estrutura atual resolveu broad barrel, mas possui muitas surfaces per-file. O owner manifest deve
testar se há children fortes:

```text
cloudflare/
├─ edge/
├─ tunnel/
├─ remote/
├─ process/
├─ observability/
└─ transport-benchmark/
```

Não criar essa árvore mecanicamente. Confirmar:

- shared state;
- fan-in/fan-out;
- lifecycle;
- public consumers;
- authority.

O bypass dinâmico atual `tools → cloudflare/private` deve ser eliminado independentemente dessa
reorganização futura.

## 6.15 Indexing e readiness

Auditorias anteriores observaram safety reconcile de dezenas de segundos mesmo com índice fresco.
Esse tema continua relevante, mas deve ser tratado como performance/correctness policy, não
misturado à topologia.

Estado-alvo:

- journal/checkpoint primeiro;
- full hash verification budgeted;
- rotating verification para eventual full coverage;
- `gapDetected` com semantics explícitas;
- full reconcile não bloqueia readiness salvo quando necessário para correctness;
- cancellation/drain real.

## 6.16 Round-trip e latência externa

A evidência histórica recente mostra origin/handler saudável e grande `silent external gap`. Isso
continua sugerindo que micro-otimização de helpers locais raramente será o maior ganho percebido.

Princípios:

- preferir batch/composite somente quando sequência recorrente for medida;
- same-call recovery/next-action;
- distinguir handler latency, result serialization, edge/network e model/host gap;
- não confundir redução de tool count com redução de TTFT sem measurement.

## 6.17 Compat 2025 e DCR

Não há evidência suficiente para remover.

Também não há justificativa para mantê-los eternamente.

Telemetria necessária:

- protocol era por request/session;
- CIMD versus DCR;
- reconnect/reauth outcome;
- host class quando seguro;
- janela longitudinal sem secrets.

Death condition:

> zero uso observado por janela suficiente + reconnect/link/reauth bem-sucedido nos hosts
> suportados + modern path comprovado.

## 6.18 Documentação e naming drift

Problemas confirmados de baixa severidade:

- `src/copilot/README.md` lista `core/` como camada viva;
- `tools/shared/` existe vazio;
- comentários de fases históricas permanecem em source;
- uma referência a “MCP control-plane runtime” precisa ser atualizada quando não estiver descrevendo
  contexto histórico.

A expressão “network control-plane” do DevContainer é conceitualmente distinta e não deve ser
removida por busca textual cega.

---

# 7. Estado-alvo ideal da Arquitetura 2.4

## 7.1 Definição

A Arquitetura 2.4 ideal não é uma árvore com mais subpastas. É uma arquitetura em que:

> **todo owner relevante possui identidade, parenthood, public/testing audience,
> config/state/lifecycle/authority e dynamic/process edges verificáveis; toda operação longa conhece
> sua cancellation policy; toda exception é deliberada; e os gates derivam dessas autoridades em vez
> de depender da memória da campanha.**

## 7.2 Propriedades do estado-alvo

1. grafo estático e dinâmico conhecidos;
2. cross-owner edges passam por membrane autorizada;
3. computed loader não cria dependency invisível;
4. config ambiente é bootstrap authority, não service locator temporal;
5. mutable state possui owner/scope/lifecycle;
6. cancellation devolvida ao caller corresponde ao máximo possível a trabalho realmente
   interrompido/drained;
7. testes são herméticos sob a configuração de paralelismo adotada;
8. subprocess authority é separada de wire authority;
9. Tool Contract interno é mais semântico que annotations MCP;
10. public/testing surfaces são consumer-driven;
11. cost/import purity é governada por closure, não apenas pelo facade;
12. compat possui consumer/death condition;
13. docs live descrevem o `HEAD`.

## 7.3 Topologia conceitual candidata

A árvore abaixo é **direcional**, não uma instrução de move. `[O]` indica owner provável; `[C]`
componente/taxonomia até prova em contrário.

```text
mcp/
├─ composition/                         [O]
├─ protocol/                            [O]
│  ├─ catalog/                          [O/C]
│  ├─ tools/                            [C]
│  ├─ apps-sdk/                         [O]
│  └─ version/                          [C]
├─ registry/                            [O]
├─ server/                              [O]
├─ auth/                                [O]
│  ├─ resource-server/                  [O]
│  │  ├─ config/                        [C]
│  │  ├─ verification/                  [C]
│  │  ├─ dpop/                          [C]
│  │  └─ policy/                        [C]
│  └─ issuer/                           [O]
│     ├─ config/                        [C]
│     ├─ metadata/                      [C]
│     ├─ clients/                       [C]
│     ├─ authorization/                 [C]
│     ├─ tokens/                        [C]
│     ├─ proofs/                        [C]
│     └─ persistence/                   [C]
├─ transport/                           [O]
│  ├─ stdio/                            [O/C]
│  └─ http/                             [O]
│     ├─ node/                          [C]
│     ├─ security/                      [C]
│     ├─ modern/                        [O]
│     └─ compat-2025/                   [O enquanto houver consumer]
├─ connection/                          [O]
├─ workspace/                           [O]
│  ├─ git/                              [O]
│  └─ repository/                       [O]
│     ├─ read/                          [O/C]
│     ├─ patch/                         [O]
│     ├─ quarantine/                    [O/C conforme lifecycle]
│     └─ cache/status/                  [C/O]
├─ process/                             [O]
├─ validation/                          [O]
├─ indexing/                            [O]
├─ diagnostics/                         [O]
├─ observability/                       [O]
├─ maintenance/                         [O]
├─ integrations/                        [O]
├─ cloudflare/                          [O]
│  ├─ edge/                             [O candidato]
│  ├─ tunnel/                           [O candidato]
│  ├─ remote/                           [O candidato]
│  ├─ process/                          [O candidato]
│  ├─ observability/                    [O/C]
│  └─ transport-benchmark/              [O]
├─ runtime/                             [taxonomia; children podem ser owners]
├─ tools/                               [exposure plane, não domain owner genérico]
└─ scripts/                             [entrypoints/launchers]
```

Nenhuma pasta deve ser movida apenas para aproximar o repo desse desenho. Primeiro o owner manifest
deve provar a classificação.

---

# 8. Autoridades declarativas necessárias

Os nomes abaixo são propostas. O requisito é semântico, não nominal.

## 8.1 `copilot-mcp-owners.json`

Deve registrar:

- owner id/path/parent;
- kind owner/taxonomy/entrypoint-space;
- public/testing surfaces;
- allowed dependencies;
- lifecycle/state/config/process/network/credential authority;
- cost tier.

## 8.2 `copilot-mcp-dynamic-graph.json`

Deve registrar ou derivar:

- computed imports;
- worker entrypoints;
- subprocess code entrypoints;
- optional native loaders;
- runtime code loaders;
- source/target owner;
- rationale;
- lazy/eager;
- allowed audience.

## 8.3 `copilot-mcp-config-touchpoints.json`

Para cada env/config source:

- owner;
- variable/key family;
- bootstrap versus request-time;
- secret-bearing;
- projection target;
- reload semantics;
- allowlist status.

## 8.4 `copilot-mcp-state-scopes.json`

Para cada state binding relevante:

- owner;
- scope;
- boundedness;
- lifecycle;
- reset/dispose;
- persistence;
- testing visibility.

## 8.5 `copilot-mcp-process-graph.json`

Pode ser separado do dynamic graph ou integrado nele. Deve provar:

- launcher;
- executable/entrypoint;
- env/credential projection;
- cwd;
- signal/deadline;
- process group;
- terminality;
- teardown.

## 8.6 Cost/purity baselines

No mínimo:

```text
copilot-mcp-public-cost-baseline
copilot-mcp-cold-import-baseline
```

Métricas úteis:

- static closure modules;
- source bytes;
- external packages;
- cold import wall time;
- RSS delta;
- import-time state/config/process side effects.

Rebaseline exige justificativa, não apenas “o gate ficou vermelho”.

---

# 9. Invariants pós-campanha

Os seguintes invariants devem ser preservados ou fortalecidos:

1. `control-plane/` nunca retorna como bag genérico.
2. Nenhum `common/`, `shared/`, `core2/` ou equivalente horizontal nasce sem função/ownership claro.
3. Root MCP continua mínimo.
4. Broad MCP barrels não retornam.
5. Cross-owner static dependency passa por membrane pública/testing autorizada.
6. Computed dynamic dependency também obedece à mesma regra.
7. Production não consome testing surface.
8. Testing white-box exception é explícita e manifestada.
9. Wire tool não possui child-process authority.
10. Child process não herda ambient credentials por default.
11. Modern 2026 não depende de compat internals.
12. Lifecycle terminal é observado, não presumido.
13. Cancellation declarada alcança o trabalho real ou a exceção bounded é explícita.
14. Workspace mutation passa por capability/policy/atomic IO.
15. Generic passthrough `outputSchema` não retorna.
16. Tool risk/authority não é inferido apenas por nome.
17. `max-autonomy` não é substituído silenciosamente por least-privilege default.
18. DCR/2025 não são removidos sem evidence gate.
19. DCR/2025 não são mantidos indefinidamente sem consumer/death condition.
20. Nenhum owner nasce apenas porque surgiu uma subpasta.
21. Nenhum public alias nasce apenas porque surgiu um arquivo.
22. Nenhum cost baseline é elevado apenas para fazer gate passar.
23. Scripts continuam launchers; runtime business logic não depende de script space sem exceção
    explícita.
24. Tests que usam persistent runtime dirs são namespaced/herméticos.
25. Timeout de teste não é tratado como cancellation do trabalho sem prova.
26. Global validation continua phase barrier, não feedback de cada patch.
27. Docs live descrevem o `HEAD`; docs históricas preservam o snapshot histórico.

---

# 10. Roadmap pós-campanha reconciliado

Este é o ledger novo. Ele substitui, para execução futura, a leitura literal dos checkboxes
pré-migração do documento de 23/08.

O ledger começou em modo somente auditoria e agora acompanha a campanha de transformação autorizada.
Um checkbox só pode ser marcado quando a transformação correspondente estiver materialmente no
worktree e possuir evidência focal adequada; itens de DoD/global publication permanecem abertos até
seus próprios barriers.

---

## Faixa A — restaurar baseline de prova antes de qualquer nova transformação ampla

### A.1 Auditoria já realizada

- [x] ler integralmente o documento pós-campanha anterior;
- [x] reconciliar afirmações históricas contra o `HEAD` atual;
- [x] confirmar branch/HEAD/upstream;
- [x] medir corpus físico atual;
- [x] medir aliases/public/testing surfaces;
- [x] executar architecture/docs/typecheck/lint focal;
- [x] executar unit suite MCP canônica;
- [x] rerodar arquivos falhos isoladamente;
- [x] investigar artifacts persistentes da quarentena;
- [x] mapear `process.env`, `MCP_WORKSPACE_ROOT`, mutable globals e `child_process`;
- [x] mapear computed dynamic imports;
- [x] validar handler moderno 2026 com envelope completo;
- [x] medir tool catalog/output schema/risk posture;
- [x] consolidar achados neste documento.

### A.2 Test hermeticity — baseline fechada

- [x] executar a suíte canônica sem validators concorrentes e reproduzir o resultado no mesmo
      worktree, inclusive com artifacts operacionais históricos ainda presentes;
- [x] tornar a área física de quarantine usada por testes completamente namespaced por run/test ou
      injetável quando isso não prejudicar a prova do path de produção — `createRepoWriteRuntime`
      preserva `.ai/quarantine` em production e aceita apenas override absoluto descendente dessa
      raiz; `test_mcp_repo_write` usa `.ai/quarantine/test-runs/<UUID>` e limpa o namespace após
      cada teste;
- [x] impedir, no rollback focal de quarantine, que a assertion enumere artifacts de runs
      anteriores;
- [x] extinguir o `repoWriteTestHarness`/metadata-writer global e substituir por dependency por
      instância em `createRepoWriteTools()`;
- [x] corrigir fixtures white-box para declarar as capabilities explícitas que simulam, em vez de
      enfraquecer `requireMcpTool*Capability` no runtime;
- [x] garantir drain/cancel genérico de operação timed-out antes de avançar para trabalho que
      compartilha state — fechado pela Faixa F;
- [x] adicionar regressions genéricas para late mutation após timeout/cancel — fechado pela Faixa F;
- [x] preservar `testTimeout=15s`: as duas execuções canônicas atuais cabem no budget sem elevar o
      teto;
- [x] provar `npm run mcp:stateful:unit` verde repetidamente sob configuração padrão: **duas
      execuções consecutivas, 95/95 arquivos e 538/538 testes em ambas**.

**Gate A: FECHADO para confiabilidade da baseline.** O trabalho de cancellation/late-effect que
havia sido transferido para a Faixa F também foi fechado. A suíte repetida provou que a campanha
pode usar `mcp:stateful:unit` como barrier global sem depender de order effects ou de aumento de
timeout.

---

## Faixa B — fechar o ponto cego do dynamic graph

### B.1 Violação confirmada

- [x] substituir `tools/cloudflare-config.js` → private dynamic import por public dependency exata;
- [x] criar uma membrane pública exata para plan-capabilities audit; ela existiu inicialmente como
      `#copilot/mcp/public/cloudflare/plan-capabilities-audit` e foi depois consolidada, sem shim,
      na surface coesa `#copilot/mcp/public/cloudflare/posture` durante a Faixa J;
- [x] adicionar ratchet AST que falha para computed import MCP novo/não declarado;
- [x] fechar a política em **computed import = proibido**; lazy loading deliberado exige specifier
      literal, entrada bijetiva no dynamic graph e validação de membrane/owner quando o target é
      MCP.

### B.2 Model Gateway

- [x] classificar o owner real do readiness como `src/copilot/model-gateway/readiness`;
- [x] mover a implementação canônica para o domínio Model Gateway e reduzir a CLI a launcher;
- [x] eliminar o MCP runtime → script code-loading dependency;
- [x] mover a regra de negócio do redaction worker para o mesmo owner de readiness;
- [x] usar import estático da capability canônica no MCP; lazy loading anterior não tinha benefício
      suficiente para justificar o edge invisível.

### B.3 Dynamic edge governance

- [x] adicionar scan AST de computed imports e import authorities relevantes;
- [x] classificar todos os literal/optional loaders runtime atuais por AST;
- [x] classificar worker-thread import authorities MCP atuais — zero;
- [x] classificar os **15 módulos atuais** que importam `child_process` (16 na fotografia anterior à
      consolidação física de launchers);
- [x] criar e evoluir o dynamic/process graph manifest para schema v3;
- [x] gate fail-closed para computed import, literal-lazy, child/worker authority e deepest-owner
      drift;
- [x] enriquecer o manifest de processo com executable/cwd/env/credentials/signal/terminality por
      launcher;
- [x] validar owner/membrane de toda lazy edge MCP; computed edge futura não é exceção autorizável,
      devendo ser convertida para specifier literal governado.

**Checkpoint B v3 — 2026-08-25:** o scan AST separa JSDoc `import()` de loading runtime e encontrou
**15 ocorrências literal-dynamic / 14 pares source+specifier / 0 computed imports**. As edges foram
classificadas em MCP-public, cross-domain-public ou external package e recebem `sourceOwnerId`,
`targetOwnerId` quando MCP, audience, `loadPolicy`, expected count e rationale. Relative dynamic
cross-owner foi eliminado em favor de alias público exato. Os **15 process-authority files / 22
launcher contracts** agora declaram `executableAuthority`, `cwdAuthority`, `environmentAuthority`,
`credentialAuthority`, `signalPolicy`, `terminality`, completion/cancellation/process-group e bound;
`ownerId` precisa ser o owner mais profundo. `architecture-contract-check.js` terminou com **0
failed checks** em ~**1,5 s** após a transformação.

**Gate B: FECHADO.** Não existe dependency runtime invisível: computed loading é proibido, lazy
loading literal é bijetivamente governado e subprocess authority possui owner e lifecycle
explícitos.

---

## Faixa C — owner ontology machine-readable

### C.1 Schema

- [x] definir e materializar `ownerId`, `path`, `parentOwnerId`, `kind` e `protectedBoundary`;
- [x] enriquecer authority classes;
- [x] tornar public/testing audiences atributos explícitos por owner;
- [x] definir allowed owner dependencies declarativas;
- [x] definir cost/state/config policy hooks.

### C.2 Inventário

- [x] classificar todos top-level MCP roots atuais;
- [x] registrar primeira onda de children com boundary/autonomy já demonstrada;
- [x] marcar taxonomies e `entrypoint-space` explicitamente;
- [x] manter subpastas privadas sem owner apenas por existirem fisicamente;
- [x] completar a classificação de children para a evidência state/config/process/surface atualmente
      materializada; novas authorities só entram se resolverem para `owner` concreto ou
      `entrypoint-space` explícito, nunca taxonomy implícita.

### C.3 Derivação de gates

- [x] derivar protected roots do manifest;
- [x] stale top-level owner entry falha;
- [x] top-level MCP root não classificado falha;
- [x] parent graph é validado e ciclos falham;
- [x] derivar public/testing surface ownership do manifest em vez de apenas validar targets
      existentes.

**Checkpoint C v2 — 2026-08-25:** `copilot-mcp-owners.json` passou a schema v2 com quatro campos
derivados por owner: `audiences`, `authorityClasses`, `policyHooks` e `allowedDependencies`. O grafo
estático usa a mesma resolução canônica de package imports/relative imports do cost engine e separa
`import` de `reexport`. Antes do ratchet, a auditoria encontrou dois SCCs reais: um de **16
owners**, reduzido a 6 após mover o launcher Cloudflare para `composition/cloudflare-cli`, e
eliminado ao promover o contrato leaf de URL a `mcp.connection.url`; o SCC
`latency -> dashboard/round-trip -> latency` foi eliminado removendo reexports parent→child e
criando surfaces exatas de round-trip e testing. Estado final medido: **68 owners / 211 direct owner
dependencies / 0 SCC / 0 mismatch**, gate ~**0,46–0,59 s**. Surface governance ficou em **75 public
/ 44 testing / 0 violações** (~0,31 s). Authorities de config/process podem pertencer a
`entrypoint-space` explícito; surface/cost/state exigem owner concreto. O comando
`copilot:mcp:owner-governance:rederive` só grava o manifest quando não há violations nem ciclos, e
`copilot:mcp:owner-governance:check` integra o architecture barrier.

**Gate C: FECHADO.** A arquitetura de owners, audiences, authorities, hooks e dependências diretas é
machine-readable, acíclica e fail-closed; não depende da memória de quem executou a campanha 2.4.

---

## Faixa D — config authority e `McpProcessConfig`

### D.1 Manifest

- [x] catalogar por AST todas as authorities MCP atuais de `process.env`;
- [x] materializar `config/architecture/copilot-mcp-config-authorities.json` com classes de snapshot
      canônico, parser-default, environment-projector, process-entrypoint e migration-target;
- [x] separar authority de secrets do config observável;
- [x] classificar semanticamente todos os touchpoints atuais: **38 arquivos / 61 refs / 0 migration
      targets**;
- [x] ratchet fail-closed: authority desconhecida/stale ou aumento acima do ceiling falha;
- [x] eliminar import-time/leaf env reads que eram migration targets; os reads remanescentes são
      parser-default, environment-projector ou process-entrypoint deliberados;
- [x] `MCP_WORKSPACE_ROOT` possui inventário próprio de identity authority, separado de
      `process.env`, com derivação canônica por `import.meta.url`, consumers exatos e baseline de
      `process.cwd()` igual a zero.

> **Checkpoint 2026-08-25 — Faixa D, workspace identity authority.** Foi materializado
> `config/architecture/copilot-mcp-workspace-identity.json`: **21 consumer files / 26 symbol imports
> / 0 ambient cwd calls**. O mesmo AST do architecture barrier valida definição, exports consumidos,
> owner mais profundo, stale/new consumers e uma allowlist de cwd deliberadamente vazia. Paths
> relativos de Cloudflare (token/state/PID/log) e audit são ancorados na geração contra
> `MCP_WORKSPACE_ROOT`; bindings que já prometem identidade absoluta (latency stores, index journal,
> artifacts e quarantine) agora rejeitam input relativo em vez de reinterpretá-lo pelo cwd. A
> composição genérica `ApplicationInfraHost -> ProcessInfra -> InfraRuntime` passou a encaminhar
> `defaultWorkspaceRoot` até `readIoRollbackPolicy`, sem criar dependência Infra -> MCP. A auditoria
> AST reduziu **19** `path.resolve(x)` de um argumento para exatamente **1** em todo MCP — a própria
> derivação canônica de `MCP_WORKSPACE_ROOT`. O grafo foi rederivado em **68 owners / 218 direct
> dependencies / 0 SCC / 0 mismatch**. Strict TS7, lint, architecture gate e **117 testes focais**
> (111 MCP/Infra + 6 ApplicationInfraHost) passaram. O aumento intencional da closure de
> `#copilot/mcp/public/cloudflare/config` de 6 para 7 módulos foi rebaselined com o headroom
> canônico de 1,5x: **7 módulos / ceiling 11**, sem violations de cost/import purity.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 1.** A métrica de `process.env` passa a ser
> AST, não grep textual. O checker prova correspondência fail-closed entre código e manifest,
> ceiling por authority e contagem **exata** para `migration-target`: qualquer redução precisa
> encolher o ratchet no mesmo incremento. Estado comprovado na geração processual 1: **65 arquivos /
> 205 refs / 51 migration targets**. O antigo número `210` permanece apenas como baseline textual da
> auditoria inicial e não deve ser usado como denominador operacional daqui em diante.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 2 (`connection`).** `connection/profile.js`,
> `connection/readiness.js` e `connection/oauth-diagnostics.js` foram reduzidos a **zero** leituras
> ambientais. O único authority do owner é agora `connection/config.js` (1 default explícito),
> capturado por `composition/process-config`. Composition combina essa projection com a projection
> Cloudflare sem criar `connection -> cloudflare` em runtime e entrega às wire tools somente
> `McpToolConfigProjection.connection`; `auth.secrets` não atravessa essa fronteira. Estado provado
> pelo checker: **63 arquivos / 189 refs / 48 migration targets**. `typecheck:strict:src.copilot`,
> lint focal, 17 testes connection/operation-context e 61 testes de tools passaram após a migração.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 3 (`auth` auxiliaries).** Decision cache,
> JWKS warmup e replay store deixaram de reler policy ambiental durante
> autorização/background/bootstrap. As três policies passam a integrar a geração composta com
> authority mínima e sem transformar `auth` em config bag irrestrito. O ratchet caiu para **63
> arquivos / 184 refs / 45 migration targets**; strict, lint e 16 testes auth focais passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 4 (`auth/issuer`).**
> `auth/issuer/dev-oauth.js` passou de **37 leituras `process.env` para zero**. O parsing completo
> do built-in issuer foi concentrado em `auth/issuer/config.js` como `DevOAuthProcessConfig`
> imutável/versionado: signing/key rotation, storage, token/client lifetimes, DPoP, resource
> indicator, introspection, rate-limit, proxy trust, CIMD ChatGPT/Claude, diagnostics e CORS. O HTTP
> recebe a mesma `auth.issuer` capturada por `McpProcessConfig`; `mcp_oauth_friction_audit` recebe
> somente a projection sanitizada via `McpToolOperationContext`; signing key material é cacheado por
> identidade da geração; e CORS é associado ao `ServerResponse` por `WeakMap` request-scoped, sem
> late env read. O shadow OAuth foi corrigido para criar a geração antes do listener em vez de mutar
> env após startup. Estado provado: **63 arquivos / 148 refs / 44 migration targets**.
> `typecheck:strict:src.copilot`, lint, 36 testes OAuth/connection e os testes dedicados de
> imutabilidade/normalização da geração passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 5 (`diagnostics/latency`).** Benchmark,
> monitor OpenAI, round-trip monitor e latency dashboard foram reduzidos a **zero ambient reads**.
> `diagnostics/latency/config.js` passou a ser a única authority do owner; composition retém a
> geração completa e as tools recebem somente a projection de thresholds necessária. Estado provado:
> **60 arquivos / 131 refs / 40 migration targets**; 11 testes focais, strict e lint passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 6 (`transport/http/stateful`).** Session
> policy, TTL, capacidade e segredo de hash foram concentrados em `stateful/session/config.js`;
> `session/runtime.js` passou a zero ambient reads. A troca memory → SQLite preserva a configuração
> da geração e mudança de geração é recusada enquanto recursos vivos são possuídos.
> `bootstrap/runtime.js` foi reduzido de quatro ambient reads a uma única authority de
> `process-entrypoint`, enquanto seus utilitários internos exigem `parentEnv` explícito. Estado
> provado: **60 arquivos / 125 refs / 38 migration targets**; testes session/router/bootstrap e
> strict passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 7 (`company-knowledge`).** Foi criado o
> owner protegido `mcp.company-knowledge`, com membrane `public/` e alias exato. Corpus roots,
> repository web base, cache policy e widget domain agora pertencem a um único
> `CompanyKnowledgeProcessConfig`; `tools/company-knowledge.js` e `protocol/apps-sdk/resources.js`
> têm zero ambient reads. O antigo cache singleton foi substituído por WeakMap workspace → WeakMap
> geração, sem retenção forte de hosts/configurações descartados. Estado provado: **59 arquivos /
> 118 refs / 36 migration targets**; 64 testes de catálogo/context mais 8 testes Company Knowledge
> passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 8 (`runtime/startup-maintenance`).**
> Scheduler policy foi extraída para `runtime/startup-maintenance/config.js`; o runtime deixou de
> ler `process.env` e também deixou de reler Cloudflare config durante o delayed work. Composition
> injeta a policy capturada e compõe a limpeza quick-tunnel com `processConfig.cloudflare`,
> preservando uma única geração durante todo o startup. Estado provado: **59 arquivos / 115 refs /
> 35 migration targets**; strict, lint, 5 testes startup e 2 testes de process-host lifecycle
> passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 9 (`observability/audit`).** File identity,
> enable/disable e sync policy foram concentrados em `observability/audit/config.js`. O audit
> service passou a zero ambient reads e é bindado uma única vez por `ProcessHost.prepare()` à mesma
> geração de `McpProcessConfig`; rebind incompatível é rejeitado depois que a authority foi
> assumida. Isso remove drift em uma dependência transversal usada por registry, Git/write tools,
> reload, LLM-B e maintenance sem propagar raw env por dezenas de APIs. Estado provado: **59
> arquivos / 113 refs / 34 migration targets**; 6 testes audit, strict e lint passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 10 (`runtime/reload`).** Planning e
> scheduling passaram a consumir um único `McpReloadProcessConfig`: perfil atual e runner
> environment operacional sanitizado são capturados no processo pai. `plan.js` e `runner.js` têm
> zero ambient reads; somente `scheduled-restart-runner.js`, que é um novo processo real, permanece
> `process-entrypoint` e reprojeta seu próprio ambiente antes do restart child. Estado provado: **59
> arquivos / 110 refs / 32 migration targets**; 15 testes reload/child-env/context, strict e lint
> passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 11 (`diagnostics/tool-payload` + auth
> projection).** Top/budget do audit de `tools/list` foram movidos para
> `diagnostics/tool-payload/config.js`; o runtime de medição ficou puro em relação ao ambiente.
> `mcp_tools_status` e `mcp_autonomy_power_score` também deixaram de reconstruir auth fora da
> geração e recebem `auth.config` sanitizado via `McpToolOperationContext`. O compact wire-payload
> cache virou `WeakMap` keyed pela identidade da policy, impedindo reuse entre gerações distintas.
> Estado provado: **59 arquivos / 109 refs / 31 migration targets**; 67 testes focais, strict e lint
> passaram.
>
> **Checkpoint 2026-08-24 — Faixa D, geração processual 12 (`diagnostics/devcontainer-network`).**
> Policy do network control plane, script normalizado, versão esperada e child environment
> operacional sanitizado passaram a um único `McpDevcontainerNetworkConfig`. Audit e refresh usam a
> mesma geração; o runtime tem zero ambient reads e o subprocesso passivo recebe somente a
> projection congelada, sem credenciais Cloudflare ou outras authorities ambientais. Estado provado:
> **59 arquivos / 107 refs / 30 migration targets**; 7 testes de semântica/context, strict e lint
> passaram.

> **Checkpoint final 2026-08-24 — Faixa D (`migrationTargets=0`).** Depois das ondas posteriores a
> D12, Cloudflare, tools, diagnostics remanescentes, terminal/process launchers e demais leaves
> foram absorvidos ou classificados. O checker atual prova **38 arquivos / 61 refs / 0 migration
> targets**. As classes permanecem fail-closed e sem `migration-target`; a distribuição por classe
> deve ser lida diretamente do manifest corrente, não congelada no texto.
> `mcp-process-config-snapshot-authority-is-singular` aponta exclusivamente para
> `composition/process-config/runtime.js`. Esta é a baseline atual; as contagens D1–D12 acima
> permanecem apenas como trajetória monotônica.

### D.2 Config snapshot

- [x] definir `McpProcessConfig` imutável e versionado;
- [x] criar builder canônico em `composition/process-config`;
- [x] impedir retenção do raw `process.env` no snapshot;
- [x] separar `auth.config` de `auth.secrets`, inclusive removendo o valor do static bearer do
      fingerprint de config;
- [x] criar projections iniciais de server, registry/surface, auth, HTTP request, HTTP/1 listener e
      HTTP/2 listener;
- [x] permitir config/env explícitos para composition e testes;
- [x] harden de `Set`/`Map` do snapshot contra mutação posterior.

### D.3 Migração

- [x] HTTP/transport e stateful session/bootstrap;
- [x] connection e registry/surface;
- [x] auth resource-server/issuer/replay/JWKS warmup;
- [x] latency diagnostics/monitors e observability/audit;
- [x] Company Knowledge/Apps SDK;
- [x] startup maintenance e runtime/reload;
- [x] tool-payload/tools-status e tools com antigas leituras ambientais;
- [x] DevContainer network diagnostics;
- [x] Cloudflare authorities;
- [x] terminal/process launchers classificados como entrypoints quando o raw environment é de fato
      authority do novo processo;
- [x] zero `migration-target` remanescente.

A regra de geração também foi fortalecida nos testes: listeners e process-hosts são recriados quando
se pretende simular restart/config generation; mutar `process.env` depois da composição não é mais
tratado como mecanismo válido de reconfiguração do runtime existente.

### D.4 Gate

- [x] `process.env` fail-closed fora das authorities declaradas no manifest;
- [x] allowlist/budgets derivados de `copilot-mcp-config-authorities.json`;
- [x] snapshot authority canônica singular e reconciliada com owner ontology;
- [x] migration targets usam contagem exata para não poder regredir silenciosamente;
- [x] server/registry/HTTP/auth hot path composto não relê ambient env no meio da operação;
- [x] **0 migration targets**; authorities finais são parser-default/projector/entrypoint
      deliberados.

**Gate D: FECHADO.** Configuração operacional agora é input explícito de geração/owner; ambient env
remanescente só existe em authorities declaradas e ratcheted. Workspace identity é governada por
manifest separado, deriva da localização do módulo e não do diretório de lançamento do processo; o
baseline MCP de `process.cwd()` é zero.

---

## Faixa E — state-scope/lifecycle governance

### E.1 Manifest

- [x] detectar por AST module-global mutable state;
- [x] classificar scope real (`process`, `process-generation`, `workspace`, `transport-identity`,
      `config-identity`);
- [x] exigir owner e rationale por entry;
- [x] exigir boundedness/bound para cache/state remanescente;
- [x] registrar lifecycle e `resetOrDispose` quando aplicável;
- [x] stale/unknown entry falha;
- [x] migration-target usa ratchet exato;
- [x] baseline atual: **25 arquivos / 52 declarações / 0 migration targets**.

### E.2 Owners prioritários

- [x] issuer state machine — removida do module scope e encapsulada por `createDevOAuthRuntime()`;
- [x] resource-server JWKS/DPoP/replay — runtime por geração; decision cache remanescente é bounded
      e explicitamente classificado;
- [x] registry caches/budgets;
- [x] tool surface policy caches;
- [x] validation jobs/queues;
- [x] terminal sessions;
- [x] repository read cache;
- [x] working sets;
- [x] latency monitors/analytics;
- [x] Model Gateway readiness/fingerprint state;
- [x] Company Knowledge cache;
- [x] Cloudflare caches/state;
- [x] stateful sessions — runtime owned pelo handler/listener, não singleton processual implícito;
- [x] audit/AI-artifacts/round-trip capabilities — lifetime possuído pela composition/host.

### E.3 Instance ownership seletivo

- [x] converter state cujo scope real não era process-global;
- [x] preservar process-global legítimo apenas quando manifesto, bounded e com lifecycle explícito;
- [x] remover os singletons configuráveis que serviam como service locator (`audit`, HTTP session,
      replay store, analytics/fingerprint/artifacts e auth runtime state);
- [x] remover test-only mutation global de `repo-write`;
- [x] provar coexistência de duas gerações OAuth sem compartilhamento acidental de state.

**Gate E: FECHADO.** Todo mutable state top-level MCP atual é conhecido e ratcheted; a dívida de
migração foi reduzida monotonicamente **15 → 9 → 8 → 7 → 4 → 3 → 1 → 0**. Novo state desconhecido ou
nova migration target falha no architecture checker.

---

## Faixa F — cancellation e process authority

### F.1 Contrato

- [x] adicionar cancellation policy ao Tool/Application Contract de execução;
- [x] classificar 131/131 como `cancellable | bounded-non-cancellable | not-applicable`;
- [x] rationale/bound obrigatório para `bounded-non-cancellable`;
- [x] coverage fail-closed por nome exato, sem fallback implícito.

Snapshot atual:

```text
cancellable:              30
bounded-non-cancellable:  88
not-applicable:            13
total:                    131
```

### F.2 Git

- [x] `workspace/git` recebe signal explícito;
- [x] cwd é authority obrigatória; fallback global removido;
- [x] env mínimo/projetado;
- [x] process terminality/abort test com process-group supervision;
- [x] descendant/grandchild cleanup observado antes de resolution;
- [x] Git mutations não continuam silenciosamente após deadline: terminality é observada ou a
      operação falha por contrato.

### F.3 Outros subprocess owners

- [x] indexing checkpoint;
- [x] auto-build/reconcile;
- [x] validation;
- [x] maintenance;
- [x] reload;
- [x] Cloudflare;
- [x] Model Gateway;
- [x] diagnostics com child-process authority;
- [x] terminal persistent sessions com acceptance → explicit-control lifecycle.

O process graph atual possui **15 child-process import authorities e 22 launcher contracts**. O gate
proíbe wire child-process authority, broad ambient env e launcher contracts inconsistentes.

### F.4 Fault injection

- [x] cancel antes de spawn;
- [x] cancel durante child execution;
- [x] cancel durante mutation antes de safe publish boundary;
- [x] cancel após mutation física com rollback/recovery cancellation-shielded;
- [x] grandchild/process-group cleanup;
- [x] ausência de falso “cancelled”: `cancellable` só retorna após drain; bounded work declara
      explicitamente `workMayContinue`/bound;
- [x] detached acceptance testada em IO-cache, Cloudflare, Model Gateway e reload;
- [x] persistent terminal ownership transfer testada dos dois lados da acceptance boundary.

### F.5 Evidência de fechamento

- focused matrix: **149 testes verdes**;
- terminal persistent boundary após ampliação: **13/13**;
- registry execution-contract/fault-injection: **23/23**;
- repo-write quarantine/restore cancellation/recovery: **31/31** no arquivo focal;
- canonical MCP: **2 × 95/95 arquivos, 538/538 testes**, preservando `testTimeout=15s`;
- `typecheck:strict:src.copilot`: verde;
- `lint:copilot`: verde;
- `copilot:architecture:check`: verde;
- graph: **2.238 arquivos / 6.000 edges / 0 ciclos**.

**Gate F: FECHADO.** Timeout/cancel representa a truthfulness do contrato de cada tool: drain real
onde `cancellable`, continuação limitada e declarada onde atomicidade/recovery exige
`bounded-non-cancellable`, e lifecycle transfer explícito para operações persistentes aceitas.

---

## Faixa G — HTTP/transport decomposition

### G.1 Pré-condições

- [x] Faixa C owner ontology concluída;
- [x] HTTP config migrada pela Faixa D;
- [x] protocol/security tests estáveis.

### G.2 Extinção de `http-shared`

- [x] request normalization/proxy trust extraídos;
- [x] CORS/security/rate-limit policy separadas;
- [x] auth challenge/projection separada;
- [x] body/envelope/protocol detection separados;
- [x] era routing reduzido a assembly/dispatch;
- [x] health/metrics/runtime-state projections separadas;
- [x] Node listener bindings permanecem no owner `adapters`;
- [x] `adapters/http-shared.js` extinto sem shim.

### G.3 Ownership `adapters` versus `transport`

- [x] `adapters/` classificado como owner da borda Node host;
- [x] stateful router movido para `transport/http/stateful`;
- [x] stateless 2025 movido para `transport/http/compat/stateless`;
- [x] request/session contract movido para `transport/http/stateful/request-contract`;
- [x] nenhuma public/testing surface antiga mantida por conveniência;
- [x] modern 2026 não carrega compat internals eager; três compat edges são literal dynamic imports;
- [x] architecture ratchets impedem retorno de compat eager e session semantics ao body reader;
- [x] rate-limit buckets pertencem à geração/listener, com isolamento testado.

### G.4 Evidência de fechamento

- strict TS7: verde;
- lint Copilot: verde;
- docs check: verde;
- architecture check: verde;
- focais HTTP/security/dual-era: **60/60**;
- canonical MCP: **2 × 95/95 arquivos, 538/538 testes**;
- graph: **2.238 arquivos / 6.000 edges / 0 ciclos**;
- config authority: **38 arquivos / 61 refs / 0 migration targets**;
- mutable state: **25 arquivos / 52 declarações / 0 migration targets**;
- testing direct exceptions: **5**, após eliminar as duas exceções HTTP.

**Gate G: FECHADO.** HTTP moderno é compreensível/testável sem materializar o compat stack; host
adapter e transport semantics possuem ownership físico distinto, config/policy clara e regressions
fail-closed contra retorno da topologia anterior.

---

## Faixa H — auth runtime/state-machine ownership e decomposição

### H.1 Resource server — ownership/runtime

- [x] config/metadata capturada pela geração;
- [x] token/JWT verification usa runtime explícito quando composto;
- [x] JWKS cache pertence à geração e não vaza entre duas gerações;
- [x] DPoP replay state pertence à geração;
- [x] replay persistente é capability injetada, não singleton de módulo;
- [x] authorization/policy usa `authRuntime.resourceServer.authorize(...)` no registry;
- [x] decision cache processual remanescente é bounded/classificado no state manifest;
- [x] diagnostic projection não requer service locator global.

### H.2 Issuer — ownership/runtime

- [x] config/policy em `issuer/config.js` e snapshot de processo;
- [x] key material state pertence à instância;
- [x] PAR/authorization-code state pertence à instância;
- [x] registered clients/CIMD metadata caches pertencem à instância;
- [x] DCR compat state pertence à instância;
- [x] access/refresh token family/revocation state pertence à instância;
- [x] DPoP/private_key_jwt replay/nonces pertencem à instância;
- [x] persistence/recovery é generation-owned e testada por restart real;
- [x] `createDevOAuthRuntime()` é a identidade explícita da state machine;
- [x] duas gerações concorrentes podem coexistir sem compartilhar state in-memory.

### H.3 Security barriers

- [x] public-only DNS/private-address/IPv4-mapped SSRF regressions: 17 testes focais verdes;
- [x] issuer `iss` no fluxo OAuth moderno;
- [x] DPoP/private_key_jwt/replay hardening preservado pela suíte auth;
- [x] persistence/restart testado recriando host/listener, não limpando globals;
- [x] secrets permanecem fora da projection observável de config;
- [x] `max-autonomy` default preservado e exercitado pelo shadow moderno 2026;
- [x] modern + compat HTTP shadow continua verde.

### H.4 Leafification física — fechada por fronteiras stateful estáveis

Ownership/state lifecycle permanece centrado em uma única `createDevOAuthRuntime()`, mas três
facetas que possuíam state/policy próprios foram extraídas sem fragmentar a identidade da state
machine:

- `issuer/request-budget/runtime.js`: `Map` de budgets, proxy-trust subject derivation e resposta
  429;
- `issuer/response/runtime.js`: `WeakMap<ServerResponse, DevOAuthProcessConfig>`, CORS/security
  headers, challenges e writers JSON/redirect;
- `issuer/dpop/runtime.js`: replay cache, nonce state, proof verification e JKT normalization, com a
  capability de replay persistente explicitamente injetada pelo parent.

Cada sub-runtime é criada exatamente uma vez dentro de `createDevOAuthRuntime()` e não possui
mutable state em module scope. `dev-oauth.js` caiu de aproximadamente **184 KiB para 164.430 bytes**
como efeito colateral da separação; o tamanho não foi usado como critério para criar fronteiras. A
investigação de `private_key_jwt`/client assertion mostrou o ponto de parada: separar esse domínio
agora exigiria atravessar o mesmo pipeline SSRF/CIMD, metadata normalization, logging e replay com
uma dependency bag larga ou duplicação de policy, portanto essa divisão foi deliberadamente
rejeitada.

- [x] separar facetas físicas apenas quando a fronteira preserve a mesma runtime instance;
- [x] evitar que a divisão reintroduza cross-module globals;
- [x] manter o hotspot budget como headroom secundário, não como critério de separação.

> **Checkpoint 2026-08-25 — H.4.** Foram provados: zero mutable declarations no module scope dos
> três leaves; isolamento real de request-budget entre duas gerações concorrentes (`register=1`, A
> recebe 429 sem contaminar B); isolamento de nonce/replay DPoP entre runtimes e fail-closed quando
> persistence replay fica indisponível. `typecheck:strict:src.copilot` está verde; a suíte focal
> auth/SSRF/modern+compat passou **37/37 testes**; owner governance ficou em **68 owners / 218
> direct dependencies / 0 SCC / 0 mismatch**; public surface/cost/import-purity e architecture
> checker têm zero violações; lint Copilot está verde.

**Gate H: FECHADO.** State/config ownership e leafification física agora possuem fronteiras
explícitas por geração, sem service locator, singleton mutável cross-module ou decomposição
orientada apenas a LOC.

---

## Faixa I — Tool Contract, catalog purity e output contract

### I.1 Tool Contract

- [x] args contract sem `any` opaco: 129/129 definições literais passam por `defineMcpRawTool`, com
      inference `z.output<z.ZodObject<TShape>>` e storage heterogêneo `args: unknown`;
- [x] effects;
- [x] authority;
- [x] credentials;
- [x] idempotency;
- [x] retry;
- [x] cancellation — derivada do execution contract exaustivo da Faixa F;
- [x] result budget;
- [x] protocol projection derivada.

### I.2 Risk validation

- [x] zero inferência de risk por regex/nome em registry/server/auth;
- [x] plan tools classificados semanticamente;
- [x] validators/runners classificados por side effect real;
- [x] remote/Git authority representada;
- [x] `strictRiskValidation`/`strictToolRiskValidation` removidos; risk truthfulness é fail-closed.

### I.3 Catalog purity

- [x] zero provider globals como assembly mechanism em `tools/catalog`;
- [x] catalog assembly usa imports estáticos + definição raw + attachment semântico explícito, sem
      `process.env`, `globalThis`, mutable provider/factory ou testing provider;
- [x] semantic contract attachment é determinístico, exaustivo e rejeita tool/contract stale;
- [x] builds independentes preservam ordem/nome, retornam arrays/tool objects independentes e
      contracts congelados;
- [x] preservar 131 baseline salvo diff intencional versionado.

### I.4 Output schemas

- [x] classificar 131 tools por output-contract class;
- [x] specific schema onde estável — 10/131;
- [x] intentional-untyped com rationale — 121/131;
- [x] ampliar parity tests de `structuredContent` onde houver stable specific contract — matriz
      exaustiva 10/10 executa handlers reais e valida o payload contra o schema publicado;
- [x] zero generic passthrough.

> **Checkpoint 2026-08-25 — I.4 parity executável.**
> `test_mcp_specific_output_schema_parity.spec.js` ratcheta o conjunto exato de specific schemas e
> exercita `repo_status`, quatro Git reads, `terminal_exec`, `terminal_session_control`,
> `terminal_session_read`, `search` e `fetch`. A prova usa sucesso real: Git/repo snapshots do
> workspace, terminal one-shot e sessão com teardown, e Company Knowledge search→fetch. Para cada
> chamada, o `structuredContent` retornado é submetido ao próprio Zod/raw-shape `outputSchema` da
> definição canônica. Resultado: **10/10 contracts cobertos, 4/4 testes verdes** e
> `typecheck:strict:src.copilot` verde.

### Checkpoint I — geração Tool Contract semântico

- 131/131 Tool Contracts exaustivos e fail-closed;
- effects: 93 read / 30 bounded-write / 8 destructive;
- network authority: 101 local / 20 fixed-external / 10 open-world;
- idempotency: 92 idempotent / 1 stateful-read / 38 non-idempotent;
- OAuth caller scope: 89 read / 20 write / 9 validate / 13 admin;
- output: 10 specific + 121 intentional-untyped;
- registry/server: 0 validation errors / 0 warnings;
- 129/129 definições literais Zod-inferred; `args:any` estrutural eliminado;
- architecture gates novos verdes: `mcp-raw-tools-declare-no-independent-risk-annotations`,
  `mcp-raw-tool-handlers-are-zod-inferred-and-type-erased-once` e
  `mcp-tool-risk-authority-is-semantic-not-name-heuristic`;
- TS7 strict verde e 195 testes focais verdes nesta geração (93 + 75 + 27), além de lint focal
  verde;
- após migrar três testes que ainda tratavam raw definitions como canonical tools, a suíte MCP
  canônica voltou a ficar hermética em **2 execuções consecutivas: 95/95 arquivos e 538/538 testes
  em ambas**, com `testTimeout=15s`; o único timeout observado antes da correção passou isoladamente
  em ~3,3s e não se repetiu nas duas barreiras canônicas subsequentes.

**Gate I: FECHADO.** Authority/risk/output são contratos de domínio e o catalog assembly foi
confirmado puro/determinístico. A única evolução incremental remanescente é ampliar parity tests e
schemas específicos **apenas** onde um stable output contract justificar — não há dívida estrutural
de risk/catalog a carregar para a próxima faixa.

---

## Faixa J — exposure-plane leafification e Cloudflare ownership

### J.1 `repo-write`

- [x] quarantine transaction/journal/reconcile — movido para
      `workspace/repository/write/quarantine`;
- [x] restore/recovery — mesma authority transacional, com rollback/cancellation/reconcile
      preservados;
- [x] file-batch application orchestration — movida para `workspace/repository/write/file-batch`;
- [x] post-validation orchestration — movida para `workspace/repository/write/post-validation`;
- [x] wire reduzido a schema/confirmation/projection — `repo-write.js` caiu de 3.184 para 1.484
      linhas; não possui mais acesso direto a `runtime.workspace`, `runtime.io`, primitives de patch
      ou invalidação de read-cache. Single-file mechanics vivem em `write/single-file`; patch
      execution reutiliza o owner canônico `repository/patch`; os state machines de patch/file batch
      vivem em `write/patch-batch` e `write/file-batch`. Os helpers grandes remanescentes no wire
      são exclusivamente projection/audit/result shaping.

**Checkpoint J.1 fechado:** novo owner protegido `mcp.workspace.repository.write`; strict, lint e
architecture verdes. `repo_apply_patch_batch` caiu de ~378 para 89 linhas e `repo_apply_file_batch`
de ~165 para 26. A barreira focal pós-swap preservou 8/8 patch-batch-v2, 61/61 tools e 31/31
repo-write quando executado isoladamente. Uma execução paralela combinada ficou 99/100 apenas porque
o cenário quarantine/restore atingiu o timeout global de 15 s sob contenção; o mesmo cenário passou
isoladamente em ~1,64 s, confirmando o problema não-hermético de concorrência já conhecido, e não
regressão funcional.

### J.2 Latency dashboard

- [x] budgets/assessment/rankings/accounting/history no owner `diagnostics/latency/dashboard`;
- [x] wire fino — `tools/latency-dashboard.js` caiu de 913 para 87 linhas e só projeta schema,
      config/capabilities explícitas e `okResult`.

**Checkpoint J.2:** owner protegido `mcp.diagnostics.latency.dashboard`, com `public/` e `testing/`
membranes distintas; **89/89 testes focais**, lint/strict/architecture verdes. Owner ontology atual:
**48 owners / 28 protected boundaries**; env/state ratchets permanecem em 38/61/0 e 25/52/0.

### J.3 Company Knowledge

- [x] owner semântico — `mcp.company-knowledge` concentra config + runtime do corpus;
- [x] corpus config/cache/scanner/search/fetch fora do wire — `tools/company-knowledge.js` caiu de
      502 para 101 linhas;
- [x] testing reset separado — cache reset e document-id codec vivem em `company-knowledge/testing`;
- [x] `search`/`fetch` compat preservada, incluindo output schemas, Apps SDK `_meta` e widget URI.

**Checkpoint J.3:** WeakMap de corpus migrou no state-scope manifest de `mcp.tools` para
`mcp.company-knowledge` sem mudar boundedness; **93/93 testes focais**, lint/strict/architecture
verdes; state/config ratchets permanecem sem migration targets.

### Incidente operacional Cloudflare — 2026-08-25

A tentativa de reconexão do ChatGPT às **09:49:35 BRT / 12:49:35 UTC** retornou Cloudflare 502 com
`Browser Working`, `Cloudflare Working` e `Host Error`. Os logs correlacionados provaram duas causas
locais distintas:

1. **startup race:** `cloudflared` já estava publicado enquanto `https://127.0.0.1:3333` ainda
   recusava conexão. O PID do MCP foi publicado em `12:49:06.973Z`, mas o listener HTTP/2 daquela
   geração só apareceu em `12:50:50.193Z`, abrindo uma janela anômala de ~103 s em que o hostname
   público podia devolver 502;
2. **origin-side H2 GOAWAY:** erros históricos `server sent GOAWAY` no `cloudflared` coincidiam
   exatamente com logs do MCP `Closing idle MCP HTTP/2 session after timeout`, causados pelo default
   `sessionIdleTimeoutMs=95000`. O origin estava encerrando unilateralmente sessões persistentes que
   pertencem ao pool HTTP/2 do `cloudflared`.

Correções implementadas, sem reiniciar a geração viva durante esta campanha:

- `startManagedStack()` agora estabelece a ordem **MCP process → origin health ready → cloudflared →
  public health ready**. PID/process existence deixou de ser sinônimo de readiness;
- readiness local é bounded/fail-closed por até 180 s, suficiente para absorver cold-paths anômalos;
  readiness pública é validada por até 45 s antes de `up/restart` retornar `ok=true`;
- se um origin recém-criado não alcançar readiness, ele é reaped em vez de permanecer como processo
  parcial;
- o default `COPILOT_MCP_HTTP2_SESSION_IDLE_TIMEOUT_MS` passou semanticamente para **0 = disabled**.
  Overrides positivos continuam suportados; os limites independentes de sessões, memória, streams e
  loopback-only permanecem ativos;
- **21/21 testes focais** de Cloudflare process/readiness + HTTP smoke + connector smoke passaram;
  TS7 strict, lint focal e architecture checker permaneceram verdes;
- benchmark isolado do caminho completo numa porta alternativa demonstrou estado normal em **~1,349
  s até listener** (`~1,302 s` import, `33 ms` prepare, `1 ms` adapter import, `13 ms` listener
  start). Logo, os ~103 s observados no incidente foram anomalia operacional real e não um `await`
  estrutural fixo de bootstrap;
- após o incidente, o endpoint vivo voltou a responder `HTTP/2 200` em `/health` e o `/mcp` não
  autenticado voltou ao `HTTP/2 401` OAuth esperado.

**Novo invariant operacional:** um managed stack jamais pode ser anunciado como pronto apenas porque
seus PIDs existem, e o origin MCP não deve encerrar por idle-timeout as sessões HTTP/2 persistentes
do seu tunnel proxy por default.

### J.4 Cloudflare

- [x] confirmar children `remote`, `edge`, `posture`, `tunnel`, `observability`, `process` e
      `transport-benchmark` pelo owner manifest — todos são protected boundaries sob
      `mcp.cloudflare`;
- [x] reduzir facade-per-file quando houver surface coesa por child — aliases públicos Cloudflare
      caíram de **27 para 13**, sem manter compat shims;
- [x] sem mega-barrel — a foundation sensível mantém membranes exatas para
      `config/environment/environment-authority/errors/origin-profile/routes`, enquanto cada child
      publica apenas sua surface semântica;
- [x] testing surfaces por necessidade semântica — `observability`, `posture`, `process`, `remote` e
      `transport-benchmark` têm testing membranes físicas; `edge`/`tunnel` são testados pela public
      surface quando não há motivo de white-box;
- [x] preservar plan/diff/apply/backup/provenance — edge mantém
      audit/plan/diff/apply/backup/snapshot, posture mantém
      config/passthrough/capability/post-change gates, tunnel mantém state/origin-plan e transport
      benchmark mantém runtime/state/plan.

A leafification também removeu orchestration do exposure plane: `tools/tunnel-status.js` caiu de 620
para **89 linhas**, `cloudflare-post-change-gates.js` de 329 para **37** e
`cloudflare-transport-benchmark.js` de 281 para **35**. Connector-smoke refresh e post-restart
readiness pertencem agora ao owner `mcp.connection`; status e diagnostics pertencem a
`mcp.cloudflare.tunnel`/`mcp.cloudflare.process`; smoke projection a `observability`; e os
post-change gates a `posture`. A antiga composição
`post-change-gates -> mcpTunnelStatusTool.handler` foi extinta: owner chama owner, nunca tool como
service.

**Checkpoint J.4 fechado:** owner ontology em **55 owners / 35 protected boundaries**; state ratchet
**25/52/0**; env ratchet **38/61/0**; child-process graph **15 owners / 22 launcher contracts**. A
barreira ampla terminou **24 arquivos / 176 testes verdes**, seguida pela extração final de
connector-smoke com **85/85 testes focais verdes**; lint, TS7 strict e architecture checker verdes.

**Gate J: FECHADO.** `tools/` ficou restrito a schema, capability extraction, confirmação/projeção e
result envelopes nos fluxos atacados; Cloudflare possui owner tree coerente, membranes públicas e de
teste explícitas, zero broad barrel e zero tool-to-tool orchestration.

---

## Faixa K — performance, index, round-trip e MCP 2026 caching

### K.1 Index

- [x] journal/checkpoint-first foreground — o startup lê checkpoint SQLite + replay bounded do
      journal antes de decidir trabalho de índice; Git/worktree complementa a evidência, não
      substitui o journal;
- [x] gap semantics explícitas — journal indisponível, gap, truncation, path inválido ou recursive
      invalidation promovem fail-closed para `full-reconcile`; committed diff incerto faz o mesmo;
- [x] hash verification budgeted/rotating — o fast path no-change agora chama
      `indexRegistry.verifyHashSample()` com **8 arquivos por default**, máximo hard 128, cursor
      lexicográfico persistido no checkpoint e SHA-256 comparado ao `content_hash` canônico do index
      store. A primitive vive no owner Infra do índice, não duplica filesystem/hash authority no
      MCP. Mismatch, metadata drift, erro de leitura ou verifier indisponível impedem `skip` e
      promovem full reconcile;
- [x] full reconcile background quando seguro — a auditoria confirmou que
      `workspace-index-auto-build` já é serviço background do `McpProcessHost`: `start()` dispara a
      promise do auto-build e devolve o disposer sem bloquear a publicação do listener. Não foi
      criado um segundo scheduler redundante;
- [x] cancellation/drain — `AbortSignal` atravessa Git evidence, hash sample, explicit refresh,
      directory build e domain reconcile; checkpoint de sucesso não é publicado após cancellation;
- [x] SLO para no-change readiness — config generation v2 introduziu
      `COPILOT_MCP_INDEX_NO_CHANGE_SLO_MS`, default **1000 ms**. O resultado `skip` publica
      `durationMs`, `noChangeSloMs` e `noChangeSloMet`; runtime-health compacta a evidência e emite
      warning quando o SLO é excedido, sem relaxar consistência.

**Checkpoint K.1 fechado:** `mcp.indexing.auto-build` tornou-se protected owner explícito, levando a
ontologia para **56 owners / 36 protected boundaries**. State/env ratchets permanecem **25/52/0** e
**38/61/0**; child-process graph permanece **15 owners / 22 launcher contracts**. O checkpoint
SQLite migra legados adicionando `hash_verification_cursor` com default vazio e reseta o cursor após
full reconcile. A nova capability Infra foi provada contra drift same-size e rotação
`a → b → c → a`; a prova end-to-end MCP demonstrou `skip` após amostra íntegra e fallback para full
reconcile após `content-hash-mismatch`. Barreiras: **43/43 testes Infra**, **10/10 auto-build**,
**61/61 tools**, **6/6 process-host/lifecycle**; TS7 strict, lint, docs e architecture verdes após
regeneração do `infra/public/API_REFERENCE.md`.

### K.2 Round-trip

- [x] medir sequences recorrentes — o derived index reconstrói apenas transições
      `tool_call_completed → tool_call_started` dentro da janela interativa e separa gaps acima de 5
      min como discontinuities. Medição viva de 24h encontrou **3.379 eventos**; os pares dominantes
      foram `terminal_exec→terminal_exec` **581**, `repo_bulk_inspect→repo_bulk_inspect` **184**,
      `terminal_exec→repo_bulk_inspect` **131** e `repo_bulk_inspect→terminal_exec` **109**. Em 6h,
      `terminal_exec→terminal_exec` permaneceu dominante com **108** ocorrências;
- [x] composite apenas com evidência de redução — `optimizationEvidence` classifica pressão contra
      mecanismos já existentes (`direct-governed-apply`, `repo_apply_patch_batch.postValidation`,
      validator inline/batch e `git_publish_changes`) e fixa
      `newCompositeRecommendation=none-from-analytics-alone`. A evidência viva favorece
      batching/bulk de chamadas independentes; não justificou uma nova tool composta;
- [x] same-call recovery/next-action — patch single/batch já devolvem `nextAction` causal; quando há
      `recoveryExactAnchor` + `recoveryOldString` + `currentHash`, o retry pode ocorrer sem reread.
      O audit v3 persiste somente booleans/contagens sanitizadas (`inlineNextAction*`,
      `inlineRecoveryAnchor*`) e mede coverage sem armazenar texto de patch ou da recomendação;
- [x] failure taxonomy causal — o normalizer **v3** preserva/reconstrói os mapas sanitizados
      `causalByCode`, `failureClassCounts` e `retryabilityCounts` de eventos batch. O índice é
      rebuildable: cursor `mcp-audit:v3` força replay do JSONL e a migration adiciona as novas
      colunas ao schema v2. A medição do processo vivo ainda em v2 mostrou exatamente a dívida
      corrigida: **178** falhas/24h e **34**/6h apareciam como
      `aggregate-or-legacy / unknown-or-legacy`;
- [x] origin versus external gap sempre separados — metrics mede handler phases, HTTP
      `preHandler/postHandler`, response-finish→next-request `externalGaps`, silent external gaps e
      inter-tool quiescence como autoridades distintas; attribution não imputa silêncio externo ao
      MCP quando origin/self-loop estão saudáveis.

**Checkpoint K.2 fechado:** `mcp.diagnostics.latency.round-trip` tornou-se protected owner
explícito; a ontologia passou a **57 owners / 37 protected boundaries** sem alterar state/env
ratchets (**25/52/0**, **38/61/0**). O antigo `analytics.js` monolítico foi separado por
responsabilidade em `analytics.js` (SQLite/cursor/capability), `normalizer.js`
(allowlist/sanitização), `summary.js` (sequence/recovery/taxonomy/evidence) e `monitor.js`
(lifecycle). Barreiras: **14/14** analytics/monitor, **83/83** round-trip + patch + tools, **16/16**
metrics/attribution; TS7 strict, lint e architecture verdes. A medição viva permanece na geração v2
até reload/restart do MCP; a correção v3 está no worktree e não exige alterar o processo corrente
para ser validada estaticamente.

### K.3 Tool surface

- [x] medir full versus reduced profiles no origin/SDK — baseline vivo `full` confirmado em **131
      tools / 158.743 B**. A surface `latency` antiga (62 tools / 66.105 B) cobria apenas **37,6%**
      das **1.496** chamadas observadas em 24h e foi rejeitada como perfil operacional. Após
      incorporar as primitives realmente dominantes (terminal, patch/file batch, working set e index
      status), `latency` passou a **71 tools / 105.022 B**, economiza **53.721 B (33,8%)** e cobre
      **100%** da amostra observada;
- [ ] medir TTFT/tool selection no **ChatGPT real** — payload, contagem, coverage e timings do SDK
      `register/connect/tools/list/close` já são medidos por
      `mcp_tool_payload_audit     compareSurfaces=true`; o comparador usa usage do round-trip index
      sem rescan e nunca recomenda troca automática de default. TTFT/tool-planning do host não é
      observável do origin e requer A/B controlado `full ↔ latency` após restart/reconexão do
      conector;
- [x] não reduzir 131 por estética — `full` permanece default. As três tools de terminal são os
      maiores descriptors individuais (~24,3 KiB combinados) **e** o principal caminho real de uso;
      removê-las seria falsa economia. Aliases implícitos (`fast/turbo/tiny/...`) foram eliminados:
      apenas os oito modos canônicos são aceitos, e configuração inválida falha explicitamente.

**Checkpoint K.3 local certificado:** a comparação de surfaces é capability lazy e bounded possuída
pelo registry; o catalog leaf não importa registry e o architecture checker permanece acíclico.
`.env.schema.json` v6.3 e `.env.expert.example` documentam surface/payload knobs. Barreiras:
**103/103** testes focados, lint, docs, TS7 strict e architecture verdes; ontologia/ratchets seguem
**57 owners / 37 boundaries**, state **25 arquivos / 52 declarações / 0 migration targets** e
config/env **38 arquivos / 61 refs observadas / ceiling 63 / 0 migration targets** na retomada
auditada de 2026-08-25. O checkpoint anterior `38/63/0` referia-se ao ceiling agregado do manifest,
não ao número de refs AST efetivamente observado; esta distinção passa a ser obrigatória na
documentação. O único gate K.3 ainda aberto é o A/B do host real; benchmark in-memory não é rotulado
como TTFT.

### K.4 2026 cache hints

- [x] medir frequência de `tools/list`/discover — na geração viva auditada em 2026-08-25 houve **197
      requests MCP modernos em ~122 min, todos `tools/call`, e zero `tools/list`**. Isso confirma
      forte reutilização de descriptors pelo host e reforça que `/mcp` deve continuar HTTP
      `no-store`;
- [x] projetar TTL positivo moderado — decisão: **300.000 ms (5 min), `cacheScope: private`, apenas
      para `tools/list`**. `server/discover` permanece no default conservador `ttlMs=0/private`; o
      knob de rollback aceita `0` para desabilitar cache positivo sem patch;
- [x] ligar TTL a descriptor fingerprint — o **registry** passou a possuir a projeção canônica do
      `tools/list` wire e o fingerprint `tools-list-wire-sha256-v1`, calculado sobre os descriptors
      e JSON Schemas 2020-12 completos. O namespace do cache combina esse SHA-256 com a policy
      efetiva `ttlMs/cacheScope`, portanto mudança de constraint **ou** de TTL/scope muda a geração.
      O full SHA permanece no manifest; a identidade efetiva usa prefixo criptográfico de 128 bits e
      fica bounded a 64 caracteres;
- [x] listChanged/invalidation — a surface canônica é imutável dentro de uma process generation e
      restart/replacement muda a identidade observada no próximo `server/discover`. Para conexões
      modernas abertas, regression com o SDK oficial prova `subscriptions/listen` +
      `notifications/tools/list_changed` => eviction imediata do `tools/list` positivo => próximo
      `listTools()` volta ao origin. Não foi criado trigger artificial dentro da geração porque não
      existe mutação dinâmica de descriptors no runtime atual;
- [x] schema convergence test — `test_mcp_cache_hints.spec.js` prova round-trip 2026 com
      `300000/private`, `server/discover=0/private`, hit real sem round-trip, miss entre `full` e
      `latency`, miss quando apenas o TTL muda, igualdade semântica
      `registry wire projection ==     official SDK tools/list`, mudança de fingerprint quando
      `minLength` muda sem renomear campo, limite de 64 caracteres na identidade e legacy wire sem
      `ttlMs/cacheScope`;
- [x] host real confirma refresh após descriptor change/reload da nova geração.

**Checkpoint de auditoria K.4 — 2026-08-25:** SDK `@modelcontextprotocol/{server,client,node}`
**2.0.0** foi inspecionado nos bundles/declarations efetivos. `ServerOptions.cacheHints` é público;
os resultados cacheáveis 2026 são `tools/list`, `prompts/list`, `resources/list`,
`resources/templates/list`, `resources/read` e `server/discover`; hints inválidos falham no
constructor. O encode moderno resolve handler → configured hint → `0/private`, enquanto o wire 2025
ignora completamente o carrier. No cliente, TTL positivo evita round-trip, `list_changed` evicta a
entrada e a geração de eviction impede stale write concorrente. O store padrão é limpo em reconnect;
um store fornecido pelo consumer é preservado, tornando o namespace de descriptor obrigatório para
correção entre gerações. Um probe HTTP moderno real do source corrente confirmou o controle: antes
da implementação K.4, `server/discover` e `tools/list` saíam como `ttlMs=0/private`.

**Invariantes adicionados por K.4:** (1) cache de descriptor nunca pode ser keyed por resumo de
shape/chaves; o fingerprint deve representar a semântica completa do `tools/list` wire, inclusive
constraints de JSON Schema; (2) mudança de cache policy é também mudança de geração; reduzir TTL não
pode herdar uma entrada criada sob TTL maior; (3) `server/discover` não recebe TTL positivo e é a
fonte de identidade fresca no reconnect; (4) SDK drift entre nossa projeção e o wire oficial deve
falhar em regression; (5) a identidade wire usada como namespace deve ser bounded, enquanto a prova
criptográfica integral permanece observável no manifest.

**Checkpoint K.4 local certificado — 2026-08-25:** factory `1.4.0`; `tools/list` source/worktree =
**300.000 ms / private**; fingerprint full atual da surface `full` =
`98aad6e8205ea09cb3b993385a97f5c6e4d0b37c2cac7f9fe88766069e78307e`; cache-generation default =
`da3b4445b5fc98c0439ed4257e66105bd05342aae9ec39695b3e82a24f779ff9`; identidade efetiva exemplo =
`1.1.4+mcp.2jtERbX8mMBDntQlfmYQWw`. Uma alteração isolada de `minLength 1 -> 2` muda o fingerprint;
uma alteração isolada do TTL `300000 -> 60000` mantém o descriptor fingerprint, mas muda
`descriptorCacheGeneration` e força miss. O cliente moderno oficial abriu `subscriptions/listen`,
recebeu `tools_changed`, invalidou a entrada e fez novo `tools/list`. Barreiras após a refatoração:
`test_mcp_cache_hints`, `test_mcp_modern_http_protocol`, `test_mcp_schema_convergence` e
`test_mcp_registry` verdes; TS7 strict, lint, `git diff --check` e architecture verdes. Ontologia
permanece **57/37**; state **25/52/0**; config/env **38 arquivos / 61 refs observadas / ceiling 63 /
0 migration targets**. **O processo MCP/conector que hospeda esta própria sessão ainda não foi
recarregado**, portanto a ativação no host real continua sendo o único gate restante de K.4 e deve
ser tratada junto da barreira N.3 para não confundir worktree certificado com runtime vivo.

**Checkpoint K.4 host-real promovido — 2026-08-25:** após publicação, o reload controlado promoveu
MCP + OAuth + Cloudflare permanente e o host voltou a observar a geração nova. `tools/list` remoto
retornou **131/131**, sem missing/unexpected tools, sob protocolo **2026-07-28**; schema convergence
registrou `toolsListObservedCount >= 3`, `listChangedSentCount=1`, zero `listChangedError`, e o
fingerprint wire permaneceu `98aad6e8205ea09cb3b993385a97f5c6e4d0b37c2cac7f9fe88766069e78307e`. O
runtime vivo reportou `runtimeSourceDrift=false`, workspace limpo e HEAD publicado. Assim, a
freshness proof de K.4 está fechada também no host real, não apenas localmente.

**Gate K:** ganho de performance é demonstrado end-to-end sem sacrificar freshness/correctness.

---

## Faixa L — compatibilidade 2025/DCR e retirement baseado em evidência

### L.1 Telemetria

- [x] protocol-era counters;
- [x] CIMD versus DCR;
- [x] reconnect/reauth;
- [x] host class quando seguro;
- [x] evidence persistida sem secrets.

**Checkpoint L.1 local certificado — 2026-08-25:** `observability/audit` passou a ser também a
authority persistente da evidência de compatibilidade, sem criar store paralelo. O evento
`mcp_compat_observation` v1 aceita somente uma projeção fechada de enums: era `2025|2026`, transport
`modern-2026|stateful|stateless-fallback`, classe RPC, continuidade
`none|stream-open|stream-resume`, source OAuth `cimd|dcr|unknown`, host class
`chatgpt|claude|unknown`, resolução do cliente, grant `authorization_code|refresh_token` e outcome.
Qualquer propriedade extra é descartada antes do JSONL; client ids, redirect URIs, tokens, subjects,
IPs, headers, user agents e erros livres não atravessam essa API. `Last-Event-ID` é reduzido ao
booleano de presença; seu valor não é persistido.

A prova executável cobre clientes oficiais modernos e legacy na mesma boundary HTTP, DCR seguido de
restart + `authorization_code` + restart + `refresh_token`, e os trusted CIMD fast-paths exatos de
ChatGPT e Claude. O lookup de `/oauth/authorize` foi consolidado em `resolveOAuthClientById`,
removendo um caminho paralelo que inicialmente contornava a instrumentação. A palavra **reauth**
neste roadmap não significa que o origin consegue observar uma decisão/UI de reautenticação do host:
o fato bruto persistido é `authorization_code` versus `refresh_token`; qualquer conclusão sobre
reauth é derivada e deve ser rotulada como tal. Reconnect, por outro lado, possui sinal causal
explícito por stream-open e presença de `Last-Event-ID`/stream-resume.

Barreira L.1: `test_mcp_audit`, `test_mcp_http_dual_protocol_shadow`, `test_mcp_connection_profile`,
`test_mcp_oauth_modern_2026_shadow` e `test_mcp_auth_runtime_generation` verdes; TS7 strict, lint,
`git diff --check` e architecture verdes. O architecture gate permaneceu sem rebaseline em
**57/37**, state **25/52/0**, config/env **38 arquivos / 61 refs observadas / 0 migration targets**
e ciclos **0**. Um primeiro uso de `Set` top-level para as allowlists foi rejeitado pelo ratchet de
state ownership e foi substituído por tuplas congeladas/pure validation, preservando a invariável de
não criar nova mutable process state.

### L.2 Decision gates

- [x] janela mínima de observação;
- [x] ChatGPT real;
- [ ] Claude real se continuar consumer suportado;
- [x] consumer/exit condition documentados;
- [ ] zero-use evidence.

**Checkpoint L.2 local certificado — 2026-08-25:** policy v1 de retirement é pura, versionada e não
lê env, filesystem nem host vivo. O piso inicial é **7 dias de janela retida + 100 requests MCP**,
com `2026` moderno observado e ao menos uma resolução CIMD bem-sucedida de cada host exigido. O
default exige `chatgpt`; `claude` deve ser acrescentado explicitamente a `requiredHostClasses` antes
de qualquer decisão de retirement caso Claude continue consumer suportado. A avaliação possui
somente três estados: `insufficient-evidence`, `blocked-by-use` e `candidate`. **Contador zero sem
shared evidence suficiente nunca é zero-use qualificado.**

2025 e DCR têm exit conditions independentes: 2025 só vira `candidate` se, depois do shared gate, a
janela qualificada contiver zero requests 2025; DCR só vira `candidate` se a mesma janela contiver
zero atividade de dynamic registration **e** zero grants associados a clientes DCR. Uso de uma
surface não bloqueia artificialmente a outra. `candidate` significa apenas evidência para uma
revisão explícita de L.3; não autoriza remoção automática. `mcp_oauth_friction_audit` passou a expor
o aggregate bounded e a retirement readiness sem criar nova tool/wire surface.

Prova local: `test_mcp_compatibility_retirement`, `test_mcp_tools` e `test_mcp_audit` verdes; TS7
strict, lint, `git diff --check` e architecture verdes, sem rebaseline e com state **25/52/0**,
config/env **38 arquivos / 61 refs / 0 migration targets**, owners/boundaries **57/37** e ciclos
**0**. Os três itens ainda abertos acima dependem deliberadamente da geração real pós-reload: o MCP
que hospeda esta conversa ainda não coleta essa telemetria nova. Portanto ChatGPT real, Claude real
(se mantido) e zero-use evidence permanecem gates de N.3; L.3 continua integralmente bloqueada até
essa evidência existir.

**Checkpoint L.2 host-real — 2026-08-25:** depois do reload e da reconexão real do ChatGPT, o
aggregate persistido observou **2 resoluções CIMD ChatGPT bem-sucedidas**, grant
`authorization_code` associado a ChatGPT e requests modernos 2026. O shared gate de retirement,
contudo, ainda é insuficiente: janela observada ~**1h44m** versus 7 dias e **76 requests MCP**
versus mínimo 100. Além disso, o aggregate contém uso 2025 e DCR (incluindo tráfego dos próprios
smokes de compatibilidade), portanto nenhum zero-use pode ser inferido. ChatGPT real está fechado;
Claude continua opcional/aberto se permanecer consumer suportado; L.3 permanece bloqueada.

### L.3 Retirement

- [ ] remover 2025 apenas após gate;
- [ ] remover DCR apenas após gate;
- [ ] remover stores/config/tests órfãos;
- [ ] ratchet contra reintrodução.

**Gate L:** compat existe porque há consumer, não por inércia.

---

## Faixa M — cost/import purity, aliases e docs live

### M.1 Public closure cost

- [x] static closure por public surface;
- [x] module/source-byte/external-package budgets;
- [x] cost tiers;
- [x] cold import wall/RSS;
- [x] transitive import-side-effect checks;
- [x] rebaseline justificado.

**Snapshot M.1 pré-publicação — 2026-08-25:** a auditoria de closure foi executada sobre os **81
exact public aliases MCP** atuais reutilizando o analyzer AST canônico de Infra
(`buildStaticImportClosure`), sem criar parser paralelo e sem alterar budgets. O snapshot observado
foi **47 micro / 14 standard / 20 heavy**, com **zero static imports não resolvidos**. Os maiores
closures confirmam dívida real de acoplamento/cold load: `composition/process-host` = **959 módulos
/ 7.059.611 bytes**, `composition/process-config` = **943 / 7.009.138**, `adapters/http2` = **937 /
6.969.218**, `adapters/http1` = **937 / 6.956.766**, `server` = **913 / 6.792.920**, `registry` =
**911 / 6.754.036** e `tools/catalog` = **908 / 6.675.151**. A transformação planejada para
generalizar o cost-report de Infra em primitive domain-neutral foi **somente preflightada e
deliberadamente não aplicada antes deste checkpoint de publicação**. Após promoção/reconnect em N.3,
M.1 retoma por esse ponto: primitive compartilhada -> manifest MCP explícito -> baseline ~1,5x ->
cold wall/RSS -> import purity transitiva. Broad closures atuais são dívida medida, não modelo a ser
normalizado por rebaseline.

**Checkpoint M.1 implementado — 2026-08-25:** a mecânica foi separada da policy. O novo engine
`infra/governance/public-api-cost-engine.js` possui apenas parsing/resolução/closure e avaliação de
budgets; Infra mantém seu manifest/baseline e MCP ganhou `copilot-mcp-public-api-manifest.json` +
`copilot-mcp-public-api-cost-baseline.json`, inicialmente com bijeção exata dos **81 aliases** e
headroom **1,5x**. Após a racionalização M.2, o manifest/baseline caiu causalmente a **74 aliases**;
a Faixa C elevou o estado atual a **75** ao substituir o aggregate circular de latência por uma
surface exata `diagnostics/latency/round-trip`, sem reintroduzir compat broad. O snapshot inicial
permaneceu **47 micro / 14 standard / 20 heavy**, agora machine-enforced contra module count, source
bytes, pacotes externos novos e static imports não resolvidos. O checker MCP reutiliza uma única
closure cacheada e custa ~**4,48 s** para toda a surface.

Cold import foi decomposto em primitive compartilhada
`scripts/analysis/lib/public-api-cold-import.mjs`; o script Infra caiu de ~16,3 KiB para ~7,4 KiB
sem alterar sua CLI. A baseline inicial mediu **10 hot public entrypoints**; após M.2 extinguir o
aggregate `#copilot/mcp/public/transport/http/stateful`, o ratchet atual possui **9 entrypoints**
explicitamente marcados no manifest e a entrada cold-import stale foi removida, sem substituição
artificial. A medição inicial (2 samples, 0 warmup) levou **20,78 s**, portanto
`copilot:mcp:cold-import:check` é deliberadamente um gate raro; sua validação estrutural custa
apenas ~**0,15 s** e pode participar do architecture barrier.

A import purity transitiva foi fechada como **zero-baseline**, não por exceções. Um detector AST de
alta confiança percorre os **999 arquivos** alcançáveis pelos aliases MCP e proíbe side-effect-only
imports, top-level await/execution, mutação de `process.env`, timers/fetch/process lifecycle,
`listen`, subprocess/fs-write/Worker conhecidos. A primeira auditoria encontrou um único efeito
real: `src/copilot/sdk/session/client.js` registrava `setModelListClientProvider(getClient)` no
import-time. O registry mutável foi extinto. Uma primeira substituição por reverse edge lazy
`models -> session` eliminou o side effect, mas o barrier global detectou corretamente que o ciclo
semântico permanecia. A forma final é unidirecional: `sdk/models/helpers.js` expõe
`listModelsWithClient(getClient, ...)`, sem authority para adquirir cliente; `sdk/session/client.js`
injeta sua própria capability e publica `listModels`. Os ports transitórios
`models/session-client-port.js`, `models/session-resolution-adapter.js` e
`session/model-resolution-port.js` foram removidos, pois o lifecycle atual preserva `model="auto"`
nativo do SDK e não possui consumer operacional para resolução local paralela. O gate final voltou a
**0 findings** sem singleton, service locator ou reverse edge. Não há baseline de exceções a manter.

### M.2 Alias rationalization

- [x] revisar a surface pública contra owner/consumers — **81 -> 74 em M.2; 75 atuais** após a split
      exata de `latency/round-trip` na Faixa C;
- [x] revisar testing aliases — **37 -> 42 em M.2; 44 atuais**, com duas membranes exatas adicionais
      para dashboard/round-trip;
- [x] extinguir a direct-testing exception `#copilot/testing/mcp/cli -> cli.js`;
- [x] eliminar/demover aliases sem consumer operacional/authority concreta;
- [x] não recriar broad barrel.

**Checkpoint M.2 implementado — 2026-08-25:** a auditoria consumer-driven mostrou seis aliases
públicos cujo único consumer era teste (`adapters/http-protocol`, `cloudflare/errors`,
`cloudflare/origin-profile`, `cloudflare/routes`, `openai`, `tools/capabilities`). Todos foram
demovidos para membranes `testing/` próprias e os antigos public membranes foram removidos, sem
shims. Em seguida o aggregate `#copilot/mcp/public/transport/http/stateful` também foi extinto: seu
único consumer era um unit test, enquanto produção já dependia das micro-surfaces `stateful/config`,
`stateful/runtime`, `stateful/bootstrap` e correlatas. A surface pública caiu **81 -> 74**.

A antiga exceção `#copilot/testing/mcp/cli -> ./src/copilot/mcp/cli.js` foi eliminada
estruturalmente: parsing de transport foi extraído para `cli/transport.js`;
`#copilot/testing/mcp/cli` aponta agora para `cli/testing/index.js`, evitando importar o executable
e seu compile-cache bootstrap em testes. A nova pasta recebeu owner explícito `mcp.cli`.

O gate `copilot:mcp:surface-governance:check` faz scan **one-pass** dos consumers e correlaciona
cada alias exato ao owner mais específico. Ele exige membrane correta, consumer, owner concreto,
public com consumer operacional e testing sem leakage para runtime. A primeira execução custou
**0,29 s** e revelou ownership incompleto; foram criados owners concretos para os subdomínios reais
e `diagnostics/latency` foi corrigido de `taxonomy` para `owner`, pois possui
runtime/config/evidence/ persistence próprios além de child owners. Após a transformação final, o
gate percorreu **3.110 arquivos em 0,24 s**, com **74 public / 42 testing / 0 violações**. Não há
alias MCP exato sem consumer nem testing target fora de `/testing/`.

### M.3 Docs/resíduos

- [x] corrigir `src/copilot/README.md` sobre `core/`;
- [x] classificar docs como live/historical/superseded/runbook;
- [x] limpar comentários de fases quando não forem história útil — auditoria MCP não encontrou
      dívida relevante;
- [x] remover `tools/shared/` se continuar vazio;
- [x] atualizar MCP README depois das mudanças efetivas.

**Checkpoint M.3 implementado — 2026-08-25:** o README raiz deixou de declarar a pasta `core/`
extinta e passou a listar `mcp/` como camada canônica. `docs/INDEX.md` foi atualizado para 25/08 e
agora classifica explicitamente princípios 2.4 e o pós-campanha de 24/08 como **CANÔNICO / ATIVO**,
a auditoria MCP de 23/08 como **HISTÓRICO / SUPERADO PARCIALMENTE**, a extinção de Core como
**HISTÓRICO / CONCLUÍDO** e roadmaps predecessores como históricos/superados parcialmente. Runbooks
ficam classificados como **RUNBOOK ATIVO** somente enquanto seus comandos continuarem válidos e não
conflitarem com a 2.4.

O README MCP ganhou a disciplina live de surfaces; o snapshot atual pós-Faixa C é **75 public / 44
testing**, membranes físicas, consumer/owner gate, cost/import-purity gate e cold-import raro. A
documentação de `repo_search_text.contextLines` foi corrigida para o limite atual de **48**. A
auditoria física removeu diretórios vazios remanescentes (`tools/shared`, `tools/public`,
`openai/public` e dois `testing/` Cloudflare vazios). Busca focalizada por comentários de fases/IDs
históricos no código MCP não encontrou dívida editorial a remover; portanto nenhum comentário útil
foi reescrito por cosmética.

**Gate M:** surfaces são consumer-driven/cost-governed e docs live descrevem a arquitetura
existente.

---

## Faixa N — validação global, promoção e publicação

### N.1 Focused barriers por onda

- [x] owner/auth/state/config tests pertinentes às ondas executadas;
- [x] focused strict typecheck/lint nas ondas executadas;
- [x] manifests/gates após cada mudança estrutural relevante;
- [x] wire surface preservada em 131 tools nas mudanças de auth/composition;
- [x] fault-injection/cancellation completo — Gate F fechado com focused matrix e suíte canônica.

**Política de tempo de validação — 2026-08-25:** validação geral deixa de ser reflexo após cada
onda. O default é prova causal/focalizada, com duração registrada; suites amplas ficam reservadas a
mudança cross-cutting de alto risco ou barrier de publicação. Referências observadas nesta fase: MCP
static cost+purity ~**4,48 s**, TS7 strict ~**2,72 s**, focused matrix M.1/SDK **130/130** ~**6,05
s**, cold-baseline structural ~**0,15 s**, host-real LLM-B readiness ~**8,0 s**, cold baseline 10x2
~**20,78 s** e `mcp-fast` ~**50 s**. Logo, os quatro primeiros são adequados conforme causalidade;
cold measurement e `mcp-fast` são raros. Operações longas usam terminal persistente/cursor para não
amarrar uma execução longa a um request MCP one-shot.

### N.2 Global barrier

- [x] TS7 strict global;
- [x] coverage TS7;
- [x] lint;
- [x] Prettier/format;
- [x] zero suppressions proibidas;
- [x] full Copilot unit suite;
- [x] integration/regression pertinentes;
- [x] architecture/docs/cost/state/config/dynamic/process gates;
- [x] descriptor diff apenas intencional.

**Checkpoint N.2 pré-publicação — 2026-08-25:** a primeira execução global encontrou quatro defects
de release e foi corretamente bloqueada. O primeiro era uma cast JSDoc mal agrupada em
`registry/runtime.js`; a expressão foi corrigida sem relaxar tipos. O segundo era drift real do
manifest fail-closed de `ConfiguredFsGrant`: `mcp.observability.audit` usava identidade dinâmica
apesar de uma authority estruturalmente estável, a nova `cloudflare/environment-authority.js` ainda
não estava classificada e a antiga entrada `cloudflare/remote/remote-api.js` havia se tornado stale.
A authority de audit voltou a id estático, a nova owner foi classificada e a entrada órfã foi
removida. Os três failures restantes eram provas de Terminal não herméticas/defasadas: dois fixtures
configuravam explicitamente `deepseek/deepseek-v4-flash:free`, mas ainda esperavam o seed de 3
modelos e uma rota `kilo-code`; o contrato real do gateway inclui o modelo ativo fora do seed,
portanto a projeção correta é **4 modelos** e rota `openrouter · deepseek/deepseek-v4-flash:free`.
`/usage now` dependia de BYOK ambiente sem declará-lo; o teste passou a possuir/restaurar seu
próprio fixture BYOK e verifica também que a chave não é renderizada.

A rerun limpa de `copilot-fast` fechou typecheck strict, lint, docs-contract, architecture-contract
e a suíte unit Copilot: **7.191 testes / 7.163 pass / 0 fail / 28 pending; 2.214 suites / 2.214
pass**. O WARN `simulated detached reaper failure` é fault-injection esperado e a suite terminou
PASS. Cobertura TS7 adicional: **3.503/3.503 arquivos JS/TS nativos cobertos por 45 projetos
strict**; Vue SFC permanece inventariado separadamente sem falsa alegação de cobertura nativa tsc.
Suppressions: **0 diretivas em 3.546 arquivos ativos**. Integration Copilot: **12 pass / 0 fail / 5
pending**; regression Copilot: **31/31 pass**. `test_mcp_cache_hints`, `test_mcp_schema_convergence`
e `test_mcp_registry` também foram rerodados isoladamente e estão verdes, sustentando que as
mudanças de descriptor/cache/schema são as intencionais da campanha e que a surface continua
governada.

### N.3 Runtime/host

- [x] reload/promote controlado;
- [x] runtime generation == source `HEAD`;
- [x] Scan Tools/tools-list parity;
- [x] read-only call;
- [x] bounded write plan/apply;
- [x] cancellation real;
- [x] OAuth/CIMD reconnect/reauth — fatos brutos `authorization_code`/CIMD/reconnect; não inferir UI
      de reauth;
- [x] Cloudflare readiness;
- [x] modern/compat telemetry;
- [x] LLM-B readiness — geração publicada usa a mesma environment authority dos live runs e
      seleciona 7/7 runtime routes + 3/3 terminal routes;
- [x] ChatGPT real;
- [ ] Claude real se suportado.

**Checkpoint N.3 pós-reconnect — 2026-08-25:** reload allowlisted `current -> quic` completou com
exit code 0; MCP PID `99572` e cloudflared PID `99630` ficaram vivos, health local/público 200,
origin HTTP/2 e edge QUIC. O connector smoke autenticado provou OAuth metadata/challenge, SSE
initial/reconnect e `tools/list` **131/131**. `mcp_runtime_health` confirmou `main@20fb7d0ee`,
`dirty=false` e `runtimeSourceDrift=false`. Uma sonda ignorada pelo Git executou
`create plan -> create -> patch plan -> apply -> read -> delete` com hash precondition. Uma unit
suite real foi iniciada como child do runtime e cancelada por `job_cancel` via SIGTERM no mesmo
runtime epoch, sem orphaning.

A compatibility telemetry viva observou 2026 moderno, stateful, CIMD ChatGPT e grants OAuth. Os
gates Cloudflare pós-change ficaram verdes: 4 conexões HA, QUIC presente, RTT ~22 ms e RPC client
p95 ~1,17 s. A primeira geração promovida mostrou `llmb_live_readiness` com control plane íntegro,
mas `ok=false`: runtime selector 0/7 e terminal selector 0/3 por `runtime_env_not_ready`.

**Correção LLM-B readiness/environment authority — 2026-08-25:** a auditoria causal provou que o
blocker era um falso negativo arquitetural. O domain readiness já aceitava `options.env`, mas o
adapter MCP não passava a `ModelGatewayLiveRunEnvironmentAuthority`; ao mesmo tempo, o caminho
`make -> stateful-env -> Cloudflare CLI -> MCP child` não carrega `.env.local`, portanto o runtime
MCP não possuía as credenciais provider-specific que o terminal/Model Gateway pode usar. A
`ModelGatewayLiveRunEnvironmentAuthority` foi promovida para schema v2: capability opaca,
`prepare()` generation-bound, snapshot único de `.env.local` por grant exato/read-only, allowlist
somente de configuração BYOK/Model Gateway e secrets provider reconhecidos, precedence
`process env > file`, nenhuma serialização de secret e nenhuma leitura de arquivo dentro da handler.
`process-host.prepare` prepara a authority antes de aceitar operações; `llmb_live_readiness` agora
exige essa mesma authority e avalia em memória a mesma projeção provider-capable que um live run
usaria. GITHUB/Copilot-model/MCP credentials e secrets arbitrários continuam fora da projeção de
arquivo. A auditoria final também eliminou dois parsers `.env` duplicados: a sintaxe pura
`parseMcpEnvironmentFile` passou ao owner genérico `process/environment` (policy 1.1.0), enquanto
Cloudflare e Model Gateway mantêm exclusivamente seus grants/allowlists/authorities; a antiga
reexportação `Cloudflare remote -> parseEnvFile` foi removida em vez de virar shim.

Prova local da correção: teste de authority verifica allowlist, single-read concorrente,
process-over-file precedence, separação provider/model/read-only e zero secret serialization;
focused boundaries/tools **71/71** antes da centralização e **17/17** focais após a centralização;
TS7 strict, lint e architecture verdes sem rebaseline (owners/boundaries 57/37, state 25/52/0, env
38/61/0, ciclos 0). Um `ProcessHost` composto com a nova authority preparada executou o readiness
real com `success=true` e **`ok=true`**. A barreira canônica final `mcp-fast`, executada por
terminal persistente/cursor sobre o source definitivo, fechou **97/97 test files e 563/563 tests**,
além do strict, em ~50,8 s, com exit 0 e zero dropped output. O checkbox LLM-B permanece aberto
somente até reload da geração publicada e prova pela tool real.

**Incidente de transporte da sessão:** inicialmente apareceu logo após uma prova de cancellation,
mas a mesma sequência
(`run_unit_copilot -> job_cancel -> git_status -> terminal_exec -> LLM-B read`) foi reproduzida após
reconexão sem falha. Mais tarde o `ExceptionGroup: unhandled errors in a TaskGroup` reapareceu **sem
cancellation**, durante um `terminal_exec` one-shot longo que executava readiness/workers. O MCP
permaneceu vivo, chamadas curtas continuaram funcionando e não houve `ExceptionGroup`/`TaskGroup`,
crash ou erro correlato no runtime Node. A mesma carga executada por `terminal_session_control` +
leitura cursor-based concluiu corretamente. Classificação atual: **fragilidade host/session
transport associada a one-shot longo, não evidência de bug causal em cancellation ou handler Node**.
Para trabalho longo, preferir jobs/sessões persistentes + cursor; não introduzir workaround de
transport/cancellation no servidor sem nova evidência. Se reincidir, capturar timestamp + continuity
telemetry e correlacionar origin/Cloudflare.

**Checkpoint de promoção LLM-B fechado — 2026-08-25:** o delta foi publicado no commit `c367fb623`
(`fix(mcp): align LLM-B readiness environment authority`) e sincronizado com `origin/main`; o reload
`current -> quic` promoveu exatamente esse HEAD. `mcp_runtime_health` mostrou `main@c367fb623`,
`dirty=false` e `runtimeSourceDrift=false`. A tool **real** `llmb_live_readiness` retornou `ok=true`
em ~**8,0 s**, com **7/7 runtime routes** e **3/3 terminal routes** selecionadas, env-ready e sem
blockers, além de paridade/redaction/integrity verdes. N.3 LLM-B está encerrado; nenhum smoke geral
adicional foi executado porque a prova causal era suficiente.

**Checkpoint supersedente de hardening local — 2026-08-26:** uma nova auditoria especializada foi
aberta após recorrência do erro host `TaskGroup` e passou a ser autoridade da fronteira em
`WORKSPACE_LLMB_MCP_TASKGROUP_READINESS_AUDITORIA_PROFUNDA_ESTADO_ATUAL_ESTADO_ALVO_ROADMAP_2026-08-26.md`.
O source local posterior ao checkpoint de 25/08 substituiu o outer Worker por subprocesso
supervisionado para hard-cancellation durante native SQLite, separou operational cache de security
proof, tornou env/DB authority explícitas, introduziu latest projections v14 + retention chunked,
checkpoint PASSIVE assíncrono no owner Infra, wire compacto e source barriers hash-bound. O
rebaseline final 1/5/20 sob fingerprint pré/pós idêntico obteve fresh proof-reuse p50 ~6,62 s e p95
~6,76 s em N=20, lifecycle 27/27/current=0 e HWM sem tendência crescente. Esse delta **ainda não é
considerado promovido por este checkpoint**: publish/reload e acceptance host-real pertencem à Faixa
I do documento especializado e devem atualizar este roadmap novamente após a promoção.

### N.4 Git

**Incidente ChatGPT OAuth/CIMD pós-publicação — 2026-08-25:** após restart manual do MCP/Cloudflare
às ~19:48 BRT, duas tentativas de criar um novo app/conector no `chatgpt.com` falharam com
`invalid_request`. A correlação com `mcp-http.log` fechou a causa às **19:50:15** e **19:50:32
BRT**: o authorization endpoint rejeitou `client_id=https://chatgpt.com/oauth/client.json` com
`errors=["unknown_client"]`, `clientResolved=false`, callback
`https://chatgpt.com/connector_platform_oauth_redirect` e resource `/mcp`. O ChatGPT havia migrado o
novo fluxo para um **CIMD platform-wide fixo**, enquanto o issuer reconhecia no fast-path somente a
forma histórica `https://chatgpt.com/oauth/<handle>/client.json`.

Correções source desta barreira:

- o issuer 1.8.0 reconhece as duas formas ChatGPT CIMD; a forma platform-wide usa callback único,
  `private_key_jwt` e `jwks_uri=https://chatgpt.com/oauth/jwks.json`, preservando o formato com
  handle apenas como compatibilidade;
- `offline_access` passou a ser anunciado em `scopes_supported` e aceito pelo authorization server;
  isso acompanha o requisito atual do ChatGPT para conectividade via refresh token;
- o classificador de compatibility evidence reconhece o CIMD fixo como `cimd/chatgpt`;
- falhas genéricas de fetch/validation de CIMD agora geram diagnóstico sanitizado em vez de cair em
  `unknown_client` sem causa observável;
- PAR preserva códigos OAuth específicos (`invalid_target`, `invalid_scope`,
  `unsupported_response_type`) em vez de colapsar tudo em `invalid_request`;
- o custom DNS lookup SSRF-safe suporta o contrato Node 24 `lookup({all:true})`, filtrando **todas**
  as respostas antes de devolver `LookupAddress[]`; isso é necessário tanto para CIMD quanto para o
  JWKS usado por `private_key_jwt`;
- `mcp_oauth_issuer_diagnostics` passa a bloquear readiness quando `refresh_token` é anunciado sem
  `offline_access`, eliminando o falso-verde observado antes do incidente;
- o canonical connector smoke deixa de criar DCR por padrão: CIMD é a identidade moderna e DCR só é
  exercitado por opt-in explícito `COPILOT_MCP_OAUTH_SMOKE_DCR_COMPATIBILITY=true`. Isso impede que
  nosso próprio diagnóstico fabrique demanda de compatibilidade ou mantenha o store de clients no
  teto.

Evidência local: `https://chatgpt.com/oauth/client.json` respondeu 200 com `client_id` exato,
callback platform-wide, `private_key_jwt` e JWKS oficial; um probe com a mesma política
public-only/SNI obteve **200** também em `/oauth/jwks.json`, com **1 chave**. A matriz focal
`oauth-smoke + connector-smoke + SSRF` fechou **26/26** em ~2,9 s e TS7 strict em ~3,0 s. O antigo
store persistente contém **100/100 clients** com nome exato `Copilot MCP OAuth smoke public client`,
confirmando que o teto era dívida causada pelo próprio smoke, não demanda externa. A limpeza desse
estado deve ocorrer junto da promoção para não competir com a geração antiga em memória.

**Gate de promoção deste incidente:** [x] commit/push source (`5b651dc8e`); [x] reload
MCP/Cloudflare `current -> quic`; [x] metadata live anuncia `offline_access`; [x] diagnostics live
`ready=true`; [x] canonical connector smoke `ok=true` sem criar novo DCR; [x] remover somente os 100
clients/refresh records pertencentes ao smoke histórico, com backup mode 0600; [ ] nova criação do
app/conector no ChatGPT usando `https://mcp.aurelin.org/mcp`; [x] authorization stage live para
`https://chatgpt.com/oauth/client.json` não produz mais `unknown_client`.

**Prova host-real pós-promoção — 2026-08-25:** runtime `main@5b651dc8e`, worktree limpa e
`runtimeSourceDrift=false`; OAuth metadata live lista `offline_access` e diagnostics retorna
`ready=true`, `offlineAccessSupported=true`, CIMD + `private_key_jwt` + PKCE S256. O cleanup removeu
100 clients diagnósticos, 38 refresh records ativos e 99 consumed records associados, preservando 45
refresh records não ligados ao smoke. Após restart o issuer carregou `dynamicClientCount=0`; o
canonical connector smoke terminou `ok=true` em ~2,0 s, com `tools/list` 131/131 e SSE reconnect
verde, e a contagem DCR permaneceu **0**. Uma reprodução pública do authorization request que havia
falhado — client ID platform-wide, callback platform-wide, seis scopes incluindo `offline_access`,
resource `/mcp` e PKCE S256 — retornou **302**, callback correto, authorization code presente, state
preservado e nenhum OAuth error. O log novo registra `Using trusted ChatGPT CIMD fast-path` para
`/oauth/client.json`; as ocorrências `unknown_client` permanecem apenas como evidência histórica
anterior à promoção. O único gate restante exige a chave privada real do ChatGPT e, portanto, é a
criação do novo app pela UI para provar o token exchange `private_key_jwt` end-to-end.

- [x] diff review;
- [x] runtime/artifact dirs limpos conforme policy;
- [x] commit coeso por barrier;
- [x] push;
- [x] `main == origin/main`;
- [x] ledger atualizado com commit/evidência.

**Checkpoint N.4 publicado — 2026-08-25:** a campanha auditada foi consolidada no commit
`0dec61ca63c1fc3800c9738659d4d6375b87665d`
(`refactor(mcp): complete architecture 2.4 post-campaign hardening`), com **410 arquivos**, **35.114
inserções** e **17.190 deleções**. O push foi executado exclusivamente para o upstream existente
`origin/main`, sem force, após dry-run verde; o resultado observado foi `ahead=0`, `behind=0`. A
limpeza governada removeu **2.868** artifacts UUID antigos além da retenção de 240, com **0
candidatos restantes**, sem alcançar OAuth stores, tunnel tokens/state, pid files, quarantine ou
rollback fora do schema permitido. O release permaneceu Prettier-clean, `git diff --check` verde,
TS7 strict/lint verdes e registry/schema 30/30 após a correção Prettier-stable final de
`registry/runtime.js`.

**Handoff de promoção após publicação:** este checkpoint não reinicia o processo MCP que hospeda a
própria sessão. Depois de commit/push e upstream sincronizado, a sequência causal é:

1. operador executa `make copilot-mcp-restart`;
2. operador executa `make copilot-mcp-status` e exige MCP HTTP vivo, Cloudflare vivo, health 200,
   origin HTTP/2, edge QUIC e URL permanente `https://mcp.aurelin.org/mcp`;
3. no `chatgpt.com`, reconecta/atualiza o conector **na mesma URL permanente**, com OAuth; não criar
   quick-tunnel nem trocar hostname sem evidência de necessidade;
4. na sessão seguinte, antes de nova transformação, provar `runtime generation == commit publicado`,
   Scan Tools/tools-list parity e 131 tools esperadas;
5. executar uma chamada read-only real e um bounded write **plan -> apply** real, seguidos da prova
   de cancellation/drain;
6. provar OAuth/CIMD reconnect/refresh, Cloudflare readiness, LLM-B readiness e que a nova telemetry
   `mcp_compat_observation` está sendo produzida pelo **runtime promovido**, sem secrets;
7. marcar ChatGPT real em L.2/N.3; Claude só entra como consumer requerido se ainda for
   explicitamente suportado e exercitado;
8. somente então acumular a janela L.2 de 7 dias/100 requests para zero-use qualificado; L.3 não
   remove 2025/DCR antes desse gate;
9. M.1–M.3 já estão certificados no source atual; após novas ondas pós-publicação, não regressar ao
   snapshot histórico de 81 aliases. Revalidar os manifests/surfaces correntes, publicar o delta e
   promover exatamente o novo HEAD antes de novos gates host-real.

**Barrier pós-publicação recertificado — 2026-08-25:** o delta aberto depois de `c367fb623` fechou
identity/surface governance, hermeticidade de authorities, leafification H.4 e parity I.4. O issuer
OAuth mantém uma única `createDevOAuthRuntime()`, mas request budget, response policy e DPoP
replay/nonces passaram a sub-runtimes generation-owned sem mutable state em module scope. A suíte
auth/security/modern+compat ficou verde (**37/37**), e a nova matriz de output parity executa
sucesso real dos **10/10** tools com schema específico e valida cada `structuredContent` contra o
schema publicado. Owner governance: **68 owners / 218 dependências diretas / 0 SCC / 0 mismatch**;
public surface: **75 aliases**, com cost/import-purity sem violações. O release source formatado
fechou Prettier, zero suppressions (**0 em 3.563 arquivos ativos**) e `mcp-fast`: strict TS7 +
**100/100 test files, 577/577 testes**. Este barrier autoriza commit/push do source; promoção/reload
do runtime e revalidação do conector pertencem ao checkpoint seguinte e devem provar o novo HEAD
publicado, não bloquear a publicação do source já certificado.

**Barrier AURELIN 4 / MCP 2026 recertificado — 2026-08-25:** a campanha especializada de
conexão/reconexão modernizou o canonical smoke para MCP `2026-07-28`, separou compatibility 2025,
fechou refresh-token hygiene, descriptor-observation boundary e telemetry por era, e aplicou o lote
seguro de dependências. O barrier source final passou TS7 strict, lint, Prettier/diff-check e
architecture integral; owners **68/49**, state **25/52**, env **38/61**, grafo **2.261/6.109/0
ciclos**, public-cost/import-purity/cold-import sem violações. A suíte MCP final fechou **102/102
arquivos, 586/586 testes**, exit 0. `oauth-smoke/runtime.js` permanece abaixo do hotspot budget em
**90.881 bytes** após extração de reporting puro, sem rebaseline de tier. O fallback local Chromium
148 continua classificado como gap independente de DevContainer: o binário trava antes de CDP mesmo
fora do Puppeteer; o caminho canônico do repo permanece Chrome externo via `wsEndpoint`, e o live
browser gate só pode ser refeito quando 9224/9225 estiver ativo. Publicação e host-real da nova
geração pertencem ao checkpoint subsequente.

**Gate N:** source, gates, runtime, host e upstream contam a mesma história.

---

# 11. Definition of Done revisada — Arquitetura 2.4 MCP

A Arquitetura 2.4 pode ser considerada encerrada em seu ideal quando:

- [x] unit baseline MCP é repetível e consistentemente verde (2 × 95/95, 538/538);
- [x] computed dynamic imports não podem bypassar membranes;
- [x] dynamic/worker/subprocess edges estão governados;
- [x] owner ontology é machine-readable e fail-closed;
- [ ] parenthood/taxonomy distinction é verificável;
- [x] public/testing surfaces pertencem a owners conhecidos;
- [x] testing white-box exceptions são explícitas;
- [x] env touchpoints estão confinados (0 migration targets);
- [x] `McpProcessConfig` e projections são imutáveis;
- [x] todo mutable state top-level MCP relevante possui scope/lifecycle (0 migration targets);
- [x] cancellation policy é explícita para 131/131 tools;
- [x] cancellation chega ao trabalho real onde declarada e `cancellable` aguarda drain;
- [x] subprocess env/credentials/process groups/terminality são conhecidos em 15 owners / 22
      launchers;
- [x] HTTP shared multi-responsibility foi decomposta; `http-shared` foi extinto sem shim;
- [x] `adapters/` foi confirmado como owner da borda Node host; transport semantics ficam em
      `transport/`;
- [x] auth issuer/resource server possuem state/config ownership explícitos;
- [x] Tool Contract declara authority/effects/credentials/idempotency/retry/cancellation/result
      budget;
- [x] registry/server/auth risk/authority não dependem de nomes;
- [x] catalog assembly não depende de hidden provider globals;
- [x] output schemas são verdadeiros ou sua ausência é deliberada/classificada com rationale;
- [ ] wire hotspots claros são leaf adapters;
- [ ] Cloudflare possui children coerentes quando justificados;
- [x] public closure/cold-import costs são ratcheted;
- [x] import purity é avaliada transitivamente;
- [ ] index readiness não depende de full safety scan foreground desnecessário;
- [x] round-trip/recovery é medido end-to-end;
- [x] cache hints modernos possuem freshness proof local e host-real completas;
- [x] compat 2025/DCR têm consumer + telemetry + exit condition ou foram removidos;
- [x] modern 2026 permanece primário;
- [x] `max-autonomy` permanece decisão explícita enquanto for a política adotada;
- [x] docs live descrevem o `HEAD`;
- [x] historical docs estão claramente históricos;
- [x] global validation barrier está verde;
- [x] connector real foi revalidado depois das transformações;
- [x] `main == origin/main` após publicação;
- [ ] cada faixa encerrada possui evidência e commit rastreável.

---

# 12. O que não fazer na próxima campanha

1. Não recriar bags horizontais como `http-shared`; novas decomposições devem seguir owner/function
   boundaries já provadas.
2. Não criar `control-plane2`, `common`, `shared`, `core2` ou bag horizontal equivalente.
3. Não transformar toda subpasta em owner.
4. Não transformar todo arquivo em public alias.
5. Não banir dynamic import indiscriminadamente; governar seu target/authority.
6. Não aceitar dynamic import como forma de escapar de membrane.
7. Não tratar `process.env` como problema puramente textual.
8. Não converter todo module-global state em objeto por métrica.
9. Não aumentar test timeout como solução principal para late work/non-hermeticity.
10. Não assumir que `Promise.race` cancela o trabalho real.
11. Não reintroduzir `strictRiskValidation`: risk truthfulness já é semântica e fail-closed, não
    opt-in.
12. Não perseguir `outputSchema` 131/131 com passthrough genérico.
13. Não reduzir tool surface apenas porque 131 parece um número grande.
14. Não ativar TTL positivo sem descriptor freshness/invalidation proof.
15. Não remover DCR/2025 sem telemetry real.
16. Não manter DCR/2025 indefinidamente sem death condition.
17. Não rebaixar `max-autonomy` silenciosamente.
18. Não rebaselinear cost para esconder regressão.
19. Não mover `adapters/` apenas por estética.
20. Não criar composite tool sem sequência recorrente medida.
21. Não confundir “MCP control-plane” histórico com o “network control-plane” legítimo do
    DevContainer.
22. Não reescrever documentos históricos para parecerem atuais; marcar seu status.
23. Não rodar global full suite após cada pequena alteração; usar focused barriers e global barrier
    por onda.
24. Não fazer commit/push antes da Faixa N: o commit deve corresponder exatamente ao worktree que
    passou strict, lint, format, architecture/docs e a suíte canônica; push somente após revisão de
    diff/upstream e sem force.

---

# 13. Baseline quantitativo consolidado

| Métrica                                               |                            Valor observado |
| ----------------------------------------------------- | -----------------------------------------: |
| branch                                                |                                     `main` |
| HEAD                                                  | `98765175994af1e8e1e327e22b1cd402fed3e834` |
| JS em `src/copilot/mcp`                               |                                        359 |
| LOC JS MCP                                            |                                     73.362 |
| JS na raiz MCP                                        |                                          1 |
| LOC JS na raiz                                        |                                        313 |
| public aliases MCP exatos — estado atual              |                                         81 |
| testing aliases MCP — estado atual                    |                                         37 |
| testing aliases diretos para implementation           |             1 (`#copilot/testing/mcp/cli`) |
| wildcard MCP aliases                                  |                                          0 |
| grafo Copilot — arquivos                              |                                      2.238 |
| grafo Copilot — edges                                 |                                      6.000 |
| ciclos                                                |                                          0 |
| computed dynamic imports MCP — estado atual           |                                          0 |
| `process.env` refs — baseline textual inicial         |                                        210 |
| `process.env` refs — estado atual AST                 |                                         61 |
| arquivos com `process.env` — estado atual AST         |                                         38 |
| config/env migration targets atuais                   |                                          0 |
| import-time `process.env` files — baseline auditoria  |                                          4 |
| `MCP_WORKSPACE_ROOT` refs                             |                                         35 |
| arquivos com `MCP_WORKSPACE_ROOT`                     |                                         14 |
| mutable state top-level — declarações ratcheted       |                                         52 |
| mutable state top-level — arquivos ratcheted          |                                         25 |
| mutable state migration targets                       |                                          0 |
| `node:child_process` refs                             |                                         30 |
| arquivos com `node:child_process`                     |                                         18 |
| child-process import authorities manifestadas         |                                         15 |
| MCP owners manifestados — estado atual                |                                         57 |
| MCP protected boundaries — estado atual               |                                         37 |
| arquivos MCP parseados pelo dynamic/authority checker |                                        359 |
| process listener registrations observados             |                                          5 |
| tools                                                 |                                        131 |
| read-only tools                                       |                                         93 |
| destructive tools                                     |                                          8 |
| idempotent tools                                      |                                         92 |
| open-world tools                                      |                                         10 |
| tools com output schema específico                    |                                         10 |
| descriptor validation errors                          |                                          0 |
| descriptor validation warnings                        |                                          0 |
| strict descriptor validation                          |                                      false |
| risk truthfulness                                     |                       semantic/fail-closed |
| tools/list payload observado                          |                                 ~158,7 KiB |
| payload budget operacional                            |                                  409,6 KiB |
| modern protocol                                       |                               `2026-07-28` |
| compat protocol                                       |                                2025 family |
| modern cache hint — geração viva pré-reload           |                       `ttlMs=0`, `private` |
| modern cache hint — source/worktree K.4 certificado   |                  `ttlMs=300000`, `private` |
| descriptor fingerprint kind                           |                `tools-list-wire-sha256-v1` |
| MCP unit run canônico atual                           |          538/538, repetido 2× consecutivas |
| canonical test files                                  |                                      95/95 |
| focused auth generation/JWKS isolation                |                                        5/5 |
| patch-batch V2 após capability fixture fix            |                                        8/8 |

### Nota sobre métricas

Esses valores descrevem o snapshot desta auditoria. O roadmap deve gerar baselines machine-readable
quando as transformações futuras começarem; este documento não deve se tornar a única fonte numérica
permanente.

---

# 14. Mapa de evidências e interpretações

## 14.1 Evidências fortes de sucesso

- root MCP praticamente vazio e `control-plane` extinto;
- broad aliases ausentes; public/testing membranes ratcheted;
- graph acíclico e computed imports MCP em zero;
- owner ontology machine-readable: 57 owners / 37 protected boundaries;
- config authority fail-closed: 38 arquivos / 61 refs AST observadas / ceiling agregado 63 / 0
  migration targets;
- state-scope fail-closed: 25 arquivos / 52 declarações / 0 migration targets;
- child process fora do wire e 15 import authorities manifestadas;
- modern 2026 executável, SDK v2 e max-autonomy default explícito;
- issuer/resource-server/replay state possuído por geração, com isolamento concorrente testado;
- baseline MCP repetível: 2 × 95/95 arquivos, 538/538 testes;
- execution contract exaustivo: 30 cancellable / 88 bounded / 13 N/A;
- process authority manifest: 15 child-process owners / 22 launcher contracts, com
  acceptance/terminality governadas.

## 14.2 Evidências fortes de dívida remanescente

- 1 testing direct exception explícita (`#copilot/testing/mcp/cli`);
- output schema específico permanece seletivo em 10/131; os outros 121 estão explicitamente
  classificados como `intentional-untyped`, portanto a dívida é ampliar contratos estáveis onde
  houver ganho real;
- cache moderno já está certificado no source/worktree, mas o processo/conector vivo desta sessão
  ainda está na geração pré-K.4 e precisa de reload + host proof em N.3;
- hotspots ainda multi-responsibility em alguns owners;
- docs live/resíduos físicos ainda precisam alinhamento final;
- compat 2025/DCR ainda depende de evidence gate real.

## 14.3 Pontos que ainda são hipóteses/evidence gates

- remover 2025;
- remover DCR;
- reduzir 131 tools como default — `latency` permanece opt-in até A/B real;
- promover/ajustar o TTL K.4 no host real após reload e observar comportamento do consumer;
- transformar cada top-level taxonomy em owner;
- transformar cada module-global cache em instance state;
- mover `adapters/` inteiro para `transport`;
- escolher children finais de Cloudflare sem owner analysis;
- elevar timeouts da suíte.

---

# 15. Próximo ataque recomendado

Quando a execução de transformações for autorizada, a ordem recomendada é:

```text
A. test hermeticity / baseline confiável
      ↓
B. computed dynamic edges / gate blind spots
      ↓
C. owner ontology + dynamic/process manifest
      ↓
D. config manifest + McpProcessConfig
      ↓
E. state-scope governance
      ↓
F. cancellation/process authority
      ↓
G/H. HTTP + auth decomposition sob governança
      ↓
I/J. Tool Contract + leafification + Cloudflare children
      ↓
K/L. performance/cache + compat evidence
      ↓
M/N. cost/docs + global validation/promotion/publication
```

A razão dessa ordem é técnica:

- **A** garante que o feedback é confiável;
- **B/C** garantem que a máquina enxerga a arquitetura que será modificada;
- **D/E/F** tornam config/state/lifecycle/cancellation explícitos;
- apenas depois disso faz sentido executar mass moves nos hotspots.

---

# 16. Conclusão final

A Arquitetura 2.4 já produziu uma mudança real e profunda. O MCP atual não precisa de outra campanha
de “organização de pastas” como primeira resposta. A maior parte da topologia estática difícil já
foi vencida.

A campanha já fechou uma parcela importante da **verdade operacional**: dynamic/process edges,
config authority, mutable-state scope, test hermeticity e cancellation/process terminality agora são
ratcheted e exercitados por testes causais.

O trabalho que resta deslocou-se para a camada semântica seguinte:

- Tool Contract precisa representar effects/authority/credentials/idempotency/retry/result budget,
  usando a cancellation policy já fechada como um de seus eixos;
- risk validation precisa derivar dessa semântica em vez de regex/nome;
- output contracts precisam ser específicos ou explicitamente intentional-untyped;
- public closure/cold-import cost, index readiness e round-trip precisam de ratchets/SLOs;
- cache positivo e retirada de compat 2025/DCR continuam dependentes de freshness/consumer
  telemetry;
- publication/runtime evidence ainda precisa comprovar que o processo ativo corresponde ao source
  validado.
- cost/import purity precisa considerar a closure transitiva;
- compat precisa sobreviver ou morrer por evidência.

A principal conclusão desta auditoria é, portanto:

> **não iniciar novas transformações amplas antes de tornar a própria capacidade de prova tão madura
> quanto a topologia que a campanha 2.4 criou.**

O próximo ciclo deve começar pela confiabilidade dos testes e pelos pontos cegos do grafo, avançar
para manifests declarativos e somente então atacar os grandes owners. Assim, a Arquitetura 2.4 deixa
de ser apenas uma arquitetura bem construída no `HEAD` atual e passa a ser uma arquitetura capaz de
**preservar a si mesma** durante as próximas grandes transformações.

---

# 17. Checkpoint supersedente — hardening LLM-B/MCP de 2026-08-26

A campanha especializada de 26/08 é governada em detalhe por
`WORKSPACE_LLMB_MCP_TASKGROUP_READINESS_AUDITORIA_PROFUNDA_ESTADO_ATUAL_ESTADO_ALVO_ROADMAP_2026-08-26.md`.
Este checkpoint não reabre as faixas históricas 2.4; registra apenas os efeitos arquiteturais que
passaram a integrar seus invariants.

- source-integrity ganhou barrier SHA-256 sobre conjuntos explícitos, CAS de mutações e provenance
  diagnóstica fail-closed; publicação/reload não podem reutilizar validação após source drift;
- `llmb_live_readiness` fresh usa subprocesso supervisionado call-scoped, não Worker como hard-kill
  boundary para `better-sqlite3`; redaction Workers permanecem one-shot/resource-bounded;
- environment authority é explicitamente projetada e não herda credenciais MCP/OAuth/session;
- operational cache e security proof possuem identities/lifetimes separados, e snapshot instável não
  é cacheado;
- SQLite v14 materializa latest pointers, retention é latest-preserving/chunked e checkpoint PASSIVE
  pesado é offloaded ao owner Infra;
- `sqlite-catalog-store.js` foi decomposto por função clara em owners de retention e schema
  migration, reduzindo o hotspot de 205.966 para 165.188 bytes sem elevar o ceiling de 175.000;
- `resolveApplicationSqlitePath` recebeu uma micro-surface pública própria, preservando a closure
  histórica do lifecycle SQLite;
- repository source integrity passou a ter micro-surface pública governada; JSONC validation via
  `jsonc-parser` é dependência explícita do patch owner, não efeito transitivo invisível;
- owner governance final: 68 owners, 222 arestas diretas, zero SCC e zero mismatch;
- `copilot:architecture:check` fecha integralmente verde no source local final.

O rebaseline final local foi executado sobre os 79 arquivos modificados/untracked sob fingerprint
pré/pós idêntico `c7c1d2513bc14d1d088c4158900775cd514945f020d3015b79c0b354c9c8d898`. Em N=20, fresh
operational proof-reuse mediu p50 ~6,382 s, p95 ~6,552 s e max ~6,569 s; lifecycle terminou 27
created/27 terminated/current=0. O SLO local permanece p95 <=7,0 s. Host-real acceptance, controlled
reload e retention real intencional continuam gates separados e não são inferidos desta prova local.
