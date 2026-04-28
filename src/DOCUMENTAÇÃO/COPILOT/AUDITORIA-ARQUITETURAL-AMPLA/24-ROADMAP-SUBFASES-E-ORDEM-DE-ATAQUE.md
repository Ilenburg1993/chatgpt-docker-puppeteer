# 24 — Roadmap Detalhado: Subfases, Ondas e Ordem de Ataque

**Status**: backlog executivo detalhado **Última atualização**: 2026-04-27 **Escopo desta etapa**:
transformar o roadmap macro em um programa extremamente extenso, granular e executável de revolução
arquitetural para `src/copilot/`.

---

## 1. Objetivo deste documento

Este documento existe para impedir que a revolução arquitetural fique apenas no campo das intenções.

Aqui o programa é detalhado em:

- programas;
- frentes;
- ondas;
- subfases;
- critérios de pronto;
- dependências;
- sequência recomendada.

A ambição deliberada é alta:

> ao final deste processo, `src/copilot/` terá passado por uma reestruturação profunda, longa,
> sistemática e institucionalizada.

---

## 2. Estratégia de execução

A ordem de ataque proposta segue cinco regras:

1. **congelar antes de desmontar**;
2. **endurecer owners corretos antes de mover owners ambíguos**;
3. **promover seams antes de remover atalhos**;
4. **migrar consumers antes de destruir providers antigos**;
5. **transformar decisões em gates o mais cedo possível**.

---

## 3. Programas executivos da revolução

O roadmap detalhado está organizado em 12 programas:

| Programa | Nome                                                                 |
| -------- | -------------------------------------------------------------------- |
| P0       | Baseline, evidência e proteção estrutural                            |
| P1       | Soberania total da fronteira SDK                                     |
| P2       | Purificação do runtime `agent/`                                      |
| P3       | Sessão viva vs sessão persistida                                     |
| P4       | Sistema de sinais e semântica de eventos                             |
| P5       | Policies, hooks e capability governance                              |
| P6       | Shared edge layer e consumo de borda                                 |
| P7       | Bordas operacionais (`server`, `terminal`, `channel`)                |
| P8       | Adapters, infraestrutura e extensibilidade                           |
| P9       | Configuração, contratos, protocolo e artefatos                       |
| P10      | Gates institucionais, ADRs e enforcement                             |
| P11      | Descomissionamento, convergência final e estabilização pós-revolução |

---

## 4. Programa P0 — Baseline, evidência e proteção estrutural

## P0.1 — Completar a auditoria documental

- **Objetivo**: encerrar o pacote de auditoria e congelar a arquitetura atual.
- **Módulos**: todos.
- **Saídas**: docs 16–25 completos.
- **Pronto quando**: não restarem lacunas documentais relevantes por módulo.

## P0.2 — Expandir structural tests por owner

- criar testes por owner canônico de:
  - SDK boundary
  - projection boundary
  - hooks boundary
  - conversation ownership
  - channel role
- **Pronto quando**: cada owner central tiver ao menos um teste estrutural de soberania.

## P0.3 — Criar “mapa de seams oficiais” executável

- gerar checklist/gate para:
  - seams permitidos;
  - barrels oficiais;
  - imports proibidos.
- **Pronto quando**: regressões de seam básico falharem no CI.

## P0.4 — Capturar superfícies públicas canônicas

- snapshots de exports públicos por módulo-chave;
- superfície pública de `sdk/`, `agent/`, `presentation/`, `server/routes/sdk`, `hooks/`, `tools/`.

## P0.5 — Criar score inicial de maturidade por módulo

- escala sugerida: 0–5 em:
  - owner clarity
  - seam health
  - boundary hygiene
  - observability
  - doc coverage

## P0.6 — Definir lista oficial de anti-owners

- `.github/`
- `logs/`
- compat shims remanescentes
- barrels excessivamente oportunistas

---

## 5. Programa P1 — Soberania total da fronteira SDK

## P1.1 — Inventário final de capabilities SDK ainda não promovidas

Investigar e classificar definitivamente:

- `commands`
- `sessionFs`
- `createSessionFsHandler`
- `modelCapabilities`
- `defaultAgent`
- `customAgents`
- `onEvent`
- session-level auth/token multitenancy
- trace context propagation details
- provider/BYOK session nuances

## P1.2 — Fechar wrappers vanilla pendentes

- criar/expandir wrappers completos onde faltar;
- garantir JSDoc, assert, try/catch, classify/error normalization.

## P1.3 — Completar observabilidade L1 restante

- cobrir RPCs/read operations relevantes ainda não instrumentadas;
- decidir o que **não** merece métrica para evitar ruído.

## P1.4 — Integrar emitter L1 ao event bus arquitetural

- não apenas `defaultMetrics`, mas também projeção canônica para bus/event stream observável.

## P1.5 — Implementar recovery por `SdkErrorKind`

- retry/backoff;
- circuit breaker integrado;
- abort semantics;
- quota exhaustion notifications.

## P1.6 — Endurecer `sdk/session/permissions.js`

- try/catch padronizado;
- decisão compatível com SDK 0.3.x+;
- métricas e error taxonomy.

## P1.7 — Endurecer `sdk/session/provider.js`

- revisar crude calls;
- revisar tipagem e ownership;
- revisar multitenancy/session-level provider role.

## P1.8 — Revisar `sdk/config.js` e `sdk-config-port`

- garantir separação limpa entre declarativo e vanilla boundary.

## P1.9 — Revisar barrels públicos de `sdk/`

- explicitar o que é público, experimental, interno e legado.

## P1.10 — Criar ADR do boundary SDK

- institucionalizar `sdk/` como L1 soberano.

---

## 6. Programa P2 — Purificação do runtime `agent/`

## P2.1 — Mapear subdomínios internos de `agent/`

Subgrupos a formalizar:

- lifecycle
- dialog
- state
- runtime registry
- messaging
- health
- context factories
- facades
- ports
- session helpers

## P2.2 — Reduzir poder semântico de `AgentContext`

- classificar campos como:
  - state vivo necessário
  - handle técnico
  - dependency injection convenience
  - resíduo histórico

## P2.3 — Extrair runtime read APIs estáveis

- snapshots oficiais;
- status/health APIs;
- state queries de baixo acoplamento.

## P2.4 — Extrair runtime command APIs estáveis

- start/stop/resume/recover/send/answer etc. com boundaries explícitos.

## P2.5 — Reforçar `agent/facades/*`

- separar leitura, comando, sdk session, runtime state;
- eliminar caminhos paralelos de acesso.

## P2.6 — Reforçar `agent/ports/*`

- tools port;
- hooks port;
- possivelmente runtime-signal ports e bridge ports.

## P2.7 — Revisar `AlwaysAliveAgent`

- definir o que deve permanecer nele;
- definir o que deve descer para subdomínios;
- definir o que deve subir para façades.

## P2.8 — Revisar `runtime-registry.js`

- preparar melhor cenário multi-runtime;
- clarificar seu papel perante `conversation-hub/`.

## P2.9 — Revisar `agent/lifecycle/*`

- separar boot, startup, host binding, session setup, recovery.

## P2.10 — Criar ADR do runtime vivo

- `agent/` como owner da sessão ativa viva.

---

## 7. Programa P3 — Sessão viva vs sessão persistida

## P3.1 — Formalizar taxonomia de sessão

- sessão vanilla;
- sessão ativa viva;
- sessão persistida.

## P3.2 — Auditar `conversation-hub/` internamente

- stores;
- orchestrator;
- realtime broadcast;
- session mapping;
- memory/replay.

## P3.3 — Definir contrato `agent ↔ conversation-hub`

- quem sincroniza o quê;
- quando runtime state persiste;
- quando persistence reacende runtime state.

## P3.4 — Separar history local de transportes do history persistido

- especialmente `channel/` e quaisquer stores locais.

## P3.5 — Formalizar ownership de memory/replay

- se necessário, subdomínio específico em `conversation-hub/`.

## P3.6 — Formalizar ownership de session routing cross-surface

- terminal/server/runtime store.

## P3.7 — Revisar APIs públicas de sessão em `presentation/`

- garantir que reflitam essa tripartição.

## P3.8 — Criar structural tests de session sovereignty

- impedir regressão entre sessão viva e persistida.

---

## 8. Programa P4 — Sistema de sinais e semântica de eventos

## P4.1 — Inventariar namespaces e catálogos atuais

- `SESSION_EVENTS`
- `AGENT_EVENTS`
- emitters diversos
- observability mappings
- audit mappings

## P4.2 — Classificar origem de cada sinal

- vendor
- translated
- runtime-native
- projection-side
- observability-only
- audit-only

## P4.3 — Definir pipeline canônico de sinais

- `sdk` -> `event-handlers` -> `events` -> runtime consumers -> observability/audit.

## P4.4 — Reduzir sinais duplicados

- nomes muito parecidos com significados distintos;
- mesmos eventos emitidos em múltiplos lugares.

## P4.5 — Harden `event-handlers/catch-all.js`

- transformá-lo num sentinela de compatibilidade de alto valor contínuo.

## P4.6 — Formalizar contracts de collector/observer

- `observability/collectors/*`
- `observability/observers/*`.

## P4.7 — Revisar SSE/event fanout boundaries

- impedir que SSE vire event-translation owner.

## P4.8 — Criar ADR do signal system

- papéis formais de `event-handlers`, `events`, `observability`, `audit`.

---

## 9. Programa P5 — Policies, hooks e governance de capability

## P5.1 — Classificar todos os hooks atuais

- permission
- tool pre/post
- prompt
- session lifecycle
- user input
- elicitation
- registry/composer/factory/presets

## P5.2 — Classificar cada hook como:

- policy pura
- callback de slot do SDK
- helper operacional legítimo
- smell de runtime leakage

## P5.3 — Reduzir responsabilidade de `hooks/`

- mover o que não for callback/policy.

## P5.4 — Formalizar interface entre `hooks/` e `agent/`

- apenas ports/factories específicas.

## P5.5 — Formalizar interface entre `hooks/` e `tools/`

- interceptação vs execução.

## P5.6 — Reavaliar `hooks/presets/*`

- verificar se perfis pertencem a hooks ou a config/policy packs.

## P5.7 — Criar matriz de decisões de permission handling

- owner, fallback, audit, observability, runtime impact.

## P5.8 — Criar ADR de policy surfaces

- onde policy mora, onde capability mora, onde runtime decision mora.

---

## 10. Programa P6 — Shared edge layer e consumo de borda

## P6.1 — Inventariar todas as projeções hoje existentes

- runtime status
- health
- overview
- controls
- requests
- sdk session state
- system config
- system metrics
- conversation hub projections

## P6.2 — Classificar projeções por tipo

- shared edge projection
- edge-specific final payload
- runtime internal snapshot

## P6.3 — Mover/absorver projeções duplicadas

- trazer para `presentation/` o que for compartilhado.

## P6.4 — Criar policy de shape ownership

- quem define o shape de cada payload compartilhado.

## P6.5 — Normalizar adapters `server`/`terminal`

- consumir `presentation/` em vez de reconstruir state.

## P6.6 — Criar testes estruturais de projection monopoly

- impedir bordas de reimplementarem projection sem justificativa.

## P6.7 — Criar ADR da shared edge layer

- `presentation/` como camada mandatória para consumo compartilhado.

---

## 11. Programa P7 — Bordas operacionais

## P7.1 — `server/`: taxonomia interna por rota/protocolo

- `/sdk`
- `/copilot-api`
- SSE
- Socket/WebSocket
- middleware
- route deps

## P7.2 — `server/`: isolar projection, protocol e wiring

- reduzir controllers mistos;
- reduzir knowledge leakage.

## P7.3 — `server/`: formalizar exceções legítimas ao uso direto de `sdk/`

- rotas `/sdk` continuam adapter específico.

## P7.4 — `terminal/`: mapear subdomínios internos

- frontend
- commands
- dialog
- render
- repl
- sdk interactions
- runtime frontend

## P7.5 — `terminal/`: separar UX de orquestração

- evitar que `terminal/index.js` e frontends acumulem domínio.

## P7.6 — `channel/`: reduzir e clarificar

- transporte בלבד;
- sem store ownership;
- sem projection owner.

## P7.7 — `channel/`: formalizar modos

- injection mode
- in-process client mode
- health/retry semantics.

## P7.8 — `terminal/server/channel`: criar ADR de bordas

- cada borda com papel único.

---

## 12. Programa P8 — Adapters, infraestrutura e extensibilidade

## P8.1 — `bridges/`: criar contracts formais por bridge

- Git
- GitHub CLI
- MCP
- NERV

## P8.2 — `bridges/`: padronizar health, retry, circuit breaker, metrics

- modelo único de adapter externo.

## P8.3 — `infra/`: classificar tudo por tipo

- queue
- lock
- storage
- registry técnico
- transport substrate

## P8.4 — `infra/`: retirar qualquer semântica de domínio incipiente

## P8.5 — `plugins/`: decidir mandato estratégico

Alternativas:

- feature pack interno
- API de extensão pública
- módulo experimental temporário

## P8.6 — `plugins/`: se mantido, definir governance completa

- install lifecycle
- compatibilidade
- isolamento
- observabilidade
- lifecycle.

## P8.7 — criar gates para impedir mistura entre adapters e domínio

---

## 13. Programa P9 — Configuração, contratos, protocolo e artefatos

## P9.1 — `config/`: reorganizar internamente por famílias

- env
- builders
- system prompt
- declarative registries
- ports

## P9.2 — `config/`: garantir pureza declarativa

- impedir runtime logic creeping.

## P9.3 — `types/`: reduzir à superfície realmente transversal

- revisão linha a linha de reexports.

## P9.4 — `dialog/`: decisão final de classificação

- manter como microdomínio de protocolo;
- ou mover para `contracts/protocols`.

## P9.5 — `.github/` interna: planejar realocação

- hooks state
- snapshots
- runtime state files.

## P9.6 — `logs/`: realocação completa

- output dir canônico fora do centro do código.

## P9.7 — revisar path resolution em `boot/`

- garantir compatibilidade da realocação.

## P9.8 — criar ADR de artifacts and runtime state

---

## 14. Programa P10 — Gates institucionais e enforcement

## P10.1 — expandir `check-copilot-global-architecture`

- refletir a nova taxonomia final.

## P10.2 — criar gates por fronteira específica

- sdk boundary
- projection monopoly
- hooks policy boundary
- session sovereignty
- artifacts outside domain tree

## P10.3 — lint/restricted-imports por domínio

- `presentation`
- `server`
- `terminal`
- `agent`
- `hooks`
- `config`

## P10.4 — structural tests por owner

- se owner muda, testes quebram.

## P10.5 — checklists de PR por eixo

- sdk
- agent
- presentation
- hooks
- events
- observability

## P10.6 — ADR registry resumido

- decisões curtas, rastreáveis e referenciáveis.

## P10.7 — scorecards de maturidade por módulo no CI

- opcional inicialmente, obrigatório depois.

---

## 15. Programa P11 — Descomissionamento e estabilização final

## P11.1 — inventariar compat shims e entrypoints legados restantes

## P11.2 — marcar superfícies internas deprecadas

## P11.3 — migrar últimos consumers

## P11.4 — remover caminhos paralelos estabilizados como deprecados

## P11.5 — revisar a árvore física final

## P11.6 — revisar docs mestres pós-revolução

## P11.7 — rodar auditoria de fechamento

## P11.8 — baseline final de arquitetura governável

---

## 16. Ordem de ataque recomendada

### Ordem 1 — Blindagem antes da cirurgia

- P0 completo
- P1 avançado
- começo de P2/P4

### Ordem 2 — Resolver soberania dos owners centrais

- P2
- P3
- P5

### Ordem 3 — Resolver bordas e projeções

- P6
- P7

### Ordem 4 — Resolver adjacências perigosas

- P8
- P9

### Ordem 5 — Congelar institucionalmente

- P10
- P11

---

## 17. Backlog de ondas detalhadas (W1–W72)

A seguir, um backlog extenso e sequenciado de ondas executáveis.

## Bloco A — Baseline e blindagem (W1–W8)

### W1

Fechar documentação 16–25.

### W2

Criar score inicial por módulo.

### W3

Criar testes estruturais adicionais para `sdk/`, `presentation/`, `hooks/`.

### W4

Criar testes estruturais para `conversation-hub/` vs `agent/`.

### W5

Criar checklist de seams canônicos por módulo.

### W6

Criar snapshots de superfície pública por módulo-chave.

### W7

Criar inventário de anti-owners e artefatos.

### W8

Congelar baseline arquitetural em documento mestre.

## Bloco B — SDK boundary soberano (W9–W16)

### W9

Inventário final de capabilities SDK ainda ausentes.

### W10

Fechar wrappers vanilla pendentes.

### W11

Cobrir observabilidade L1 restante.

### W12

Integrar emitter L1 ao event bus observável.

### W13

Implementar recovery por `SdkErrorKind`.

### W14

Endurecer `sdk/session/permissions.js`.

### W15

Endurecer `sdk/session/provider.js`.

### W16

Criar ADR final da fronteira SDK.

## Bloco C — Runtime `agent/` (W17–W26)

### W17

Classificar subdomínios internos do `agent/`.

### W18

Catalogar tudo que lê `AgentContext` cru.

### W19

Extrair runtime read façades finais.

### W20

Extrair runtime command façades finais.

### W21

Revisar `AlwaysAliveAgent` e classificar métodos por destino.

### W22

Revisar `runtime-registry.js` e multi-runtime semantics.

### W23

Revisar `agent/lifecycle/*` e separar startup/host/setup/recovery.

### W24

Criar tests de façade monopoly.

### W25

Remover acessos crus de módulos quentes restantes.

### W26

ADR do runtime vivo.

## Bloco D — Sessão viva vs persistida (W27–W34)

### W27

Definir modelos formais de sessão.

### W28

Revisar `conversation-hub/` em profundidade operacional.

### W29

Contratos `agent ↔ conversation-hub`.

### W30

Separar history de transporte vs history persistido.

### W31

Formalizar ownership de replay/memory.

### W32

Formalizar ownership de realtime multi-surface.

### W33

Criar testes de soberania de sessão.

### W34

ADR de sessão tripartida.

## Bloco E — Sistema de sinais (W35–W42)

### W35

Inventário de namespaces e emissores.

### W36

Classificação por origem de sinal.

### W37

Padronização do pipeline vanilla→interno.

### W38

Redução de nomes duplicados/ambíguos.

### W39

Blindagem de `catch-all.js` como sentinela.

### W40

Revisão dos collectors/observers.

### W41

Revisão do SSE/fanout enquanto infra, não semântica.

### W42

ADR do sistema de sinais.

## Bloco F — Hooks, policy e capability governance (W43–W50)

### W43

Inventariar todos os hooks.

### W44

Classificá-los por tipo de responsabilidade.

### W45

Extrair leaks de runtime de `hooks/`.

### W46

Revisar integração hooks↔agent.

### W47

Revisar integração hooks↔tools.

### W48

Revisar presets de policy/perfis.

### W49

Criar matriz de permission governance.

### W50

ADR de policy surfaces.

## Bloco G — Presentation monopoly e bordas (W51–W60)

### W51

Inventário total de projeções atuais.

### W52

Classificar shared vs edge-specific payloads.

### W53

Absorver projeções duplicadas em `presentation/`.

### W54

Revisar `server/` por rota/protocolo/adapter.

### W55

Revisar `terminal/` por frontend/commands/dialog/render.

### W56

Reduzir domínio implícito em `server/`.

### W57

Reduzir domínio implícito em `terminal/`.

### W58

Clarificar `channel/` como transporte בלבד.

### W59

Criar tests de projection monopoly.

### W60

ADR de shared edge layer e bordas.

## Bloco H — Adapters, infra e extensibilidade (W61–W66)

### W61

Criar bridge contracts por sistema externo.

### W62

Padronizar health/retry/circuit breakers de bridges.

### W63

Classificar todo conteúdo de `infra/` por natureza técnica.

### W64

Extrair qualquer semântica indevida de `infra/`.

### W65

Decidir mandato estratégico de `plugins/`.

### W66

Criar gates para adapters/extensibility boundaries.

## Bloco I — Configuração, contratos e artefatos (W67–W72)

### W67

Reorganizar internamente `config/` por famílias conceituais.

### W68

Revisar e podar `types/` para transversalidade real.

### W69

Decisão final sobre `dialog/`.

### W70

Realocar `.github/` interna para runtime state path.

### W71

Realocar `logs/` para output dir explícito.

### W72

ADR final de config/contracts/artifacts.

## Bloco J — Enforcement e descomissionamento (W73–W84) — opcionalmente expandido depois

### W73

Expandir gate global com nova taxonomia.

### W74

Criar lint restrictions por domínio.

### W75

Criar structural tests por owner soberano.

### W76

Criar ADR registry curto.

### W77

Marcar superfícies internas deprecadas.

### W78

Migrar consumers finais.

### W79

Remover atalhos históricos.

### W80

Remover artefatos/shims remanescentes.

### W81

Reauditar árvore física final.

### W82

Revisar READMEs e docs mestres.

### W83

Executar auditoria de fechamento.

### W84

Consolidar baseline pós-revolução.

---

## 18. Critérios de priorização ao longo das ondas

Quando houver disputa de prioridade, aplicar esta ordem:

1. o que reduz owner concorrente crítico;
2. o que reforça soberania de owner correto;
3. o que transforma decisão em gate;
4. o que remove artefato ou drift de alto custo cognitivo;
5. o que apenas reorganiza cosmeticamente.

---

## 19. O que NÃO fazer durante a revolução

1. Não mover arquivos em massa sem owner target claro.
2. Não fundir módulos só porque ambos são pequenos.
3. Não criar mega-barrels para “simplificar”.
4. Não usar `plugins/` como escape hatch estrutural.
5. Não chamar output artifact de módulo de domínio.
6. Não enfraquecer testes/gates em nome de velocidade.
7. Não confundir mais documentação com menos disciplina executável.

---

## 20. Fecho desta etapa

Este documento representa um backlog deliberadamente extenso porque a transformação exigida também é
extensa. A ambição aqui não é remendar `src/copilot/`; é submetê-lo a uma **revolução arquitetural
controlada, progressiva, testável e institucionalizável**.

A partir daqui, a discussão deixa de ser “se devemos mudar profundamente” e passa a ser “em qual
onda, com qual gate, com qual owner e com qual critério de pronto”.
