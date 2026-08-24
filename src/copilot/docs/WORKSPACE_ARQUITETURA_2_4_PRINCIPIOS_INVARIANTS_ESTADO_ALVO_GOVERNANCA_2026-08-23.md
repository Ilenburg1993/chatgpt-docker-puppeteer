# WORKSPACE — Arquitetura 2.4 — princípios, invariants, estado-alvo e governança contínua

**Data:** 23 de agosto de 2026 **Escopo:** `src/copilot/**`, com aplicação progressiva ao restante
do workspace quando semanticamente cabível. **Runtime de referência local no início desta
especificação:** Node.js `v24.15.0`, ESM (`"type": "module"`), npm `12.0.2`. **Natureza:**
especificação arquitetural canônica. Este documento não executa migrações; ele define o ideal contra
o qual auditorias e roadmaps de domínio devem ser construídos.

---

## 0. Tese executiva

A Arquitetura 2.4 consolida as lições das arquiteturas 1.0, 2.0, 2.1 e 2.3 e corrige ambiguidades
conceituais que se tornaram visíveis quando a gramática 2.3 foi aplicada ao MCP real.

O princípio central é:

> **O workspace deve ser composto por owners semanticamente sólidos, cada owner com uma boundary
> física identificável, conectados por um DAG de capabilities/protocols públicos exatos. A árvore
> física deve tornar ownership e parenthood legíveis; `public/` deve tornar toda travessia entre
> owners autônomos explícita; lifecycle, authority, configuration, state, custo e observability
> devem acompanhar o owner real.**

A 2.4 não é uma defesa de “mais pastas”, “mais barrels” ou microarquivos. Ela reduz ambiguidade:

- **todo owner possui boundary física; nem todo diretório é owner**;
- `contracts/`, `policy/`, `state/`, `adapters/`, `composition/`, `diagnostic/` e `public/` podem
  ser apenas taxonomia interna de um mesmo owner;
- um child directory pode ser um componente privado do parent ou um owner autônomo; essa decisão é
  semântica e deve ser explícita;
- `public/` é membrane arquitetural entre owners, não um ritual entre quaisquer duas pastas;
- alias/package boundary governa dependência, mas **não é security boundary**;
- capability/authority real é decidida em runtime por recursos, grants, principals e policy.

O estado-alvo generaliza os seguintes invariants:

1. **DAG completo:** runtime imports, reexports, JSDoc/type edges, dynamic imports, loaders, workers
   e subprocess entrypoints relevantes contam para o grafo.
2. **Ownership físico:** código privado vive sob o owner que controla identity, lifecycle, state,
   configuration e invariants.
3. **Public membrane física:** toda travessia entre owners autônomos passa por `public/` do owner
   consumido e por exact surface; componentes do mesmo owner continuam livres para usar private
   relative imports.
4. **Explicit hierarchical composition:** capabilities são entregues aos consumers no menor
   composition root semanticamente autorizado; nenhum service locator substitui wiring.
5. **Authority e custo são parte da API:** surface pública declara audience, exposure, privilege,
   lifecycle, stability, side effects e custo.
6. **Structured lifecycle:** timeout/cancelamento precisam alcançar o trabalho real; recurso só pode
   ser declarado encerrado depois que seu fechamento foi observado ou sua falha foi classificada.
7. **Configuration is snapshot:** leaf runtime não observa `process.env` continuamente.
8. **Transition is governed:** dívida existente pode ser ratcheted, mas regra transitória nunca pode
   ser confundida com o estado-alvo canônico.

A regra de parenthood passa a ser:

> **Se A é semanticamente pai de B e B não possui identity/lifecycle/authority autônomos, B é
> componente privado dentro do owner de A. Se B possui invariants e consumers independentes, B é um
> child owner autônomo; inclusive o parent passa a consumi-lo pela public membrane. Se múltiplos
> pais parecem existir, deve-se identificar o menor owner semântico legítimo ou inverter a
> dependência por port/protocol/capability.**

A Arquitetura 2.4 é simultaneamente rigorosa e econômica: deve maximizar legibilidade, liberdade de
evolução e segurança sem transformar governança, validação ou organização física em burocracia.

## 1. Evidência e contexto que fundamentam a 2.4

### 1.1 Evolução já concluída

A 2.4 parte de uma base significativamente mais rigorosa do que a existente antes das campanhas
2.0/2.1:

- `src/copilot/core` foi extinto fisicamente, sem `core2/shared/common` substituto;
- `src/copilot/db` foi absorvido pela arquitetura de Infra e também não existe mais;
- DI/service locator global foi removido;
- runtime/session state transversal passou a ser instance-owned;
- ProcessInfra/ApplicationInfraHost consolidaram lifecycle/config/SQLite application ownership;
- filesystem authority passou a usar capabilities opacas e boundaries governados;
- rollback ganhou provenance/integrity owner-bound;
- public Infra APIs ganharam manifest de authority/lifecycle/audience/cost;
- static closure e cold-import possuem ratchets;
- o analisador de dependências/custo foi corrigido para AST real, incluindo ESM multiline;
- package aliases são exatos e stale aliases são rejeitados;
- TypeScript 7 strict, zero suppressions, lint e format são gates reais;
- o grafo final do ciclo anterior estava em `0 cycles / 0 unresolved / 0 parse errors`.

### 1.2 Gap arquitetural atual que a 2.4 pretende fechar

A disciplina acima ainda não é universal. No snapshot inicial da 2.4:

- somente `src/copilot/infra` possui uma árvore `public/` generalizada;
- ainda existem aproximadamente **160 relative imports cross-domain** em `src/copilot`;
- vários domínios continuam expondo mega-root barrels:
  - `model-gateway/index.js`: ~590 linhas;
  - `sdk/index.js`: ~540;
  - `events/index.js`: ~452;
  - `agent/index.js`: ~216;
  - `hooks/index.js`: ~165;
  - `server/index.js`: ~159;
  - `config/index.js`: ~149;
  - `tools/index.js`: ~120;
- package aliases misturam root barrels, exact leaves, facades e surfaces públicas sem uma sintaxe
  física uniforme;
- algumas regras ESLint ainda descrevem o padrão histórico “use o barrel raiz”, enquanto a evolução
  recente demonstrou que **exact semantic surfaces** são frequentemente superiores ao mega-barrel;
- a relação “arquivo principal ↔ helpers/children” ainda é informal e varia entre domínios;
- testing/diagnostic audiences ainda não seguem uma taxonomia física uniforme;
- composição explícita está avançada em Infra/Agent, mas não há um contrato universal sobre onde
  composition roots podem viver;
- performance governance detalhada ainda é praticamente exclusiva de Infra.

A Arquitetura 2.4 transforma essas práticas locais em invariants gerais.

---

## 2. O que a 2.4 herda das arquiteturas anteriores

### 2.1 Da Arquitetura 1.0

A 1.0 estabeleceu princípios que continuam absolutos:

- dependência unidirecional e DAG;
- ownership físico;
- barrels como fronteiras deliberadas, não conveniência universal;
- coesão acima de tamanho arbitrário;
- side effects e globals tratados como architecture concerns;
- dependências de tipo/JSDoc fazem parte do grafo.

### 2.2 Da Arquitetura 2.0

A 2.0 tornou o modelo operacional mais explícito:

- Process / Runtime / Workspace / Operation como scopes reais;
- config snapshot pertencente ao owner do scope;
- state e caches instance-owned sempre que não forem intrinsecamente process-wide;
- capabilities opacas para authority;
- health/observability sem materializar recursos;
- adapters concretos atrás de ports estruturais.

### 2.3 Da Arquitetura 2.1

A 2.1 fechou privilege e governança:

- public API como membrane de authority;
- audience e lifecycle como propriedades do entrypoint;
- raw-path privilege removida da surface runtime;
- public cost/static closure/cold import como ratchets;
- no stale/marker/speculative aliases;
- no compatibility shims sem necessidade operacional comprovada;
- configuration is data, not ambient lookup;
- authenticated capability quando provenance importa;
- owner controla lifetime de children.

### 2.4 Da extinção de Core

A campanha de Core adiciona uma lição decisiva:

> **“baixo nível”, “muito usado” ou “genérico” não constitui owner.**

Um componente só pode ser elevado a owner compartilhado quando possui semântica independente,
invariants próprios e dependência descendente coerente. Caso contrário, ele pertence ao domínio que
o governa ou deve ser expresso como port/protocol.

---

## 3. Ontologia arquitetural da 2.4

A 2.4 usa conceitos distintos que não devem ser colapsados.

### 3.1 Domínio

Um **domínio** é uma área semântica de primeira ordem, por exemplo `mcp`, `agent`, `sdk`,
`model-gateway`, `infra`, `presentation` ou `events`. Domínio não é necessariamente layer e pode
conter vários owners.

### 3.2 Owner

Um **owner** é a menor unidade semântica que controla coerentemente um conjunto relevante de
invariants/identity, state, lifecycle, configuration, authority, protocolo/capability, observability
e recovery.

**Todo owner possui uma boundary física identificável, normalmente um diretório. Nem todo diretório
é owner.** Um diretório de organização interna só se torna owner quando a semântica acima o exige.

### 3.3 Owner boundary e owner identity

A boundary física torna o ownership legível. A identidade lógica do owner não deve depender
acidentalmente de cada rename de path. Manifests podem atribuir `ownerId` estável e mapear esse ID
para o path atual.

### 3.4 Componente privado versus child owner autônomo

Um subtree B sob A é **componente privado de A** quando não possui
lifecycle/authority/state/consumers independentes. A e B pertencem ao mesmo owner e private relative
imports são normais.

B é **child owner autônomo** quando possui invariants/identity/lifecycle próprios ou consumers
legítimos fora do parent implementation. Nesse caso, parent e siblings são consumers externos de B e
devem atravessar sua `public/`.

### 3.5 Capability / protocol

Uma capability é uma operação/objeto explicitamente entregue a um consumer e cuja authority e
lifecycle são controláveis. Um protocol é um contrato de mensagens/dados/interação entre owners.
Capabilities podem ser atenuadas, bound a principal/resource/operation e, quando necessário,
revogáveis ou expirables. Publicação de símbolo não concede authority.

### 3.6 Composition root

Composition roots são **hierárquicos**: o root global conecta grandes subsistemas; roots inferiores
conectam concrete owners quando são o menor ancestral semântico com conhecimento legítimo dos dois
lados. Composition root não é domain service nem shared bag.

### 3.7 Audience e exposure

São eixos diferentes:

- **audience**: `runtime`, `composition`, `diagnostic`, `testing`;
- **exposure**: `owner-private`, `workspace-internal`, `package-public`, `external-wire`.

Uma testing surface pode ser workspace-internal; uma runtime surface pode ser externa.

### 3.8 Boundary arquitetural versus boundary de segurança

`package.json#imports`, `exports`, aliases e `public/` governam dependências; não constituem
sandbox. Security authority continua sendo decidida por capabilities, principals, scopes, grants,
resource handles e policy em runtime.

## 4. Regra fundamental: owner tem boundary física; diretório não implica owner

### INV-2.4-01 — ownership é semantic-first e boundary-explicit

A estrutura física deve tornar a semântica visível sem inventar owners artificiais.

Quando B é componente privado de A:

```text
owner-a/
├─ service.js
├─ policy/
├─ state/
└─ child-b/             # continua pertencendo a owner-a
```

Quando B é owner autônomo:

```text
owner-a/
└─ child-b/
   ├─ public/
   └─ ...private internals
```

No segundo caso, nesting não concede bypass: `owner-a` consome a surface pública de `child-b`.

### 4.1 Critério de parenthood

A é pai semântico de B quando uma combinação forte é verdadeira: A controla lifecycle de B; cria ou
destrói B; configuração/state/identity de B são projeções do aggregate de A; authority válida para B
é emitida/limitada por A; invariants de B preservam A; B não possui consumers legítimos
independentes.

**Call frequency, fan-in e proximidade física não definem parenthood.**

### 4.2 Diretórios taxonômicos não são owners por default

`contracts/`, `policy/`, `state/`, `adapters/`, `runtime/`, `composition/`, `diagnostic/` e
`public/` podem apenas organizar responsabilidades internas. Não ganham automaticamente ownerId,
membrane ou alias.

### 4.3 Arquivo principal dentro de um owner

Preferir nomes semânticos previsíveis (`service.js`, `policy.js`, `protocol.js`, `state.js`,
`store.js`, `controller.js`, `adapter.js`, `factory.js`). Evitar `utils.js`, `helpers.js`,
`common.js`, `misc.js` como owners. Helpers pequenos permanecem próximos do comportamento que
ajudam.

## 5. Regra de múltiplos pais: o menor owner semântico legítimo

### INV-2.4-02 — nenhum “shared” por indecisão

Quando um componente B parece pertencer tanto a A quanto a C, aplicar esta ordem:

1. **Lifecycle owner:** quem cria/encerra B?
2. **Authority owner:** quem decide se a operação de B é permitida?
3. **State owner:** quem possui a identidade e o state que B manipula?
4. **Protocol owner:** de qual protocolo B é uma realização?
5. **Config owner:** qual snapshot determina o comportamento de B?
6. **Semantic independence:** B continua coerente se A e C desaparecerem?

### 5.1 Se existe um pai dominante

B fica no subtree desse owner. O outro domínio consome B pela `public/` do owner.

### 5.2 Se B é realmente comum a siblings

B pode viver no **menor ancestral semântico comum** somente se:

- tiver invariants próprios;
- não depender das implementações dos siblings;
- possuir nome semântico melhor que `shared`;
- seu lifecycle/authority puder ser explicado sem mencionar os siblings concretos.

### 5.3 Se não há owner comum legítimo

Usar dependency inversion:

- consumer-local `port`;
- producer-owned `protocol`;
- capability passada por composition root;
- adapter em uma borda autorizada.

Duplicar um primitive puramente trivial pode ser menos nocivo do que criar uma falsa abstração
compartilhada. A duplicação, porém, deve ser deliberada e pequena.

---

## 6. Public membrane generalizada

### INV-2.4-03 — toda travessia entre owners autônomos passa por `public/`

> **Um arquivo pertencente ao owner A não pode importar implementation privada do owner B. A edge
> A→B passa por uma pasta física `public/` de B e por exact surface governada.**

Vale para runtime imports/reexports, JSDoc/type imports, dynamic imports, testes external-consumer e
loaders/worker entrypoints que cruzem boundaries.

### 6.1 O que não é cross-owner

Parent e child component do **mesmo owner** podem usar private relative imports. Não criar `public/`
entre cada subdiretório taxonômico.

### 6.2 Child owner autônomo

Se um child directory é owner autônomo, inclusive o parent físico é consumer externo da boundary.

### 6.3 Public não significa internet/public API

`public/` é membrane arquitetural. Exposure externa é metadata separada.

### 6.4 Public é física e consumer-driven

Alias “public” não aponta diretamente para implementation privada. Ao mesmo tempo, owner sem
consumer cross-boundary não cria marker public folder.

### 6.5 Public surface não é security grant

Import permitido indica dependency edge legítima, não autorização operacional. Resource/capability
checks continuam obrigatórios.

## 7. Public entrypoints: regras estritas

### INV-2.4-04 — public entrypoint é projection, não implementação

Um `public/**/index.js` deve:

- ser barrel-only/projection-only;
- não criar state;
- não registrar handlers;
- não ler env;
- não fazer I/O;
- não decidir policy;
- não inicializar recursos;
- não conter test controls;
- não reexportar acidentalmente um mega-owner inteiro.

### 7.1 Exact surface

Preferir:

```text
#copilot/mcp/public/auth
#copilot/mcp/public/session
#copilot/mcp/public/tool-registry
```

em vez de:

```text
#copilot/mcp
#copilot/mcp/control-plane
```

quando o consumer precisa de apenas uma capability.

### 7.2 Root barrel

No estado ideal 2.4, `#copilot/<domain>` não é o default de cross-domain import. Mega-root aliases
devem desaparecer progressivamente ou provar que representam uma única surface pequena e
semanticamente coesa.

Um root `index.js` físico pode existir para organização interna, mas não recebe automaticamente
status de public API.

### 7.3 Public surface metadata

Cada public surface deve ter metadata governável, no mínimo:

- owner;
- audience;
- lifecycle;
- stability;
- authority/privilege;
- sideEffectFreeOnImport;
- cost tier;
- intended consumers ou consumer class;
- deprecation status quando aplicável.

---

## 8. Audience e exposure

### INV-2.4-05 — audience e exposure são explícitos e independentes

Audiences: **runtime**, **composition**, **diagnostic**, **testing**. Exposure: `owner-private`,
`workspace-internal`, `package-public` ou `external-wire` conforme o caso.

Quando necessário:

```text
owner/
├─ public/
│  ├─ runtime/
│  ├─ composition/
│  └─ diagnostic/
└─ testing/
   └─ public/
```

Não criar diretórios por template. Testing surface é explícita e estreita; `#copilot/testing/**` não
é autorização geral para furar owner internals.

## 9. Regras de import 2.4

### INV-2.4-06 — import local somente dentro do mesmo owner

Imports relativos são apropriados quando:

- origem e target pertencem ao mesmo owner;
- parent acessa child privado do próprio subtree;
- child acessa primitive/contracts mais baixos do mesmo owner sem subir para composition/public.

### INV-2.4-07 — zero relative cross-owner

Travessia de owner usa alias exato para a `public/` física do target.

### INV-2.4-08 — owner internals não importam a própria public membrane

Isso criaria inversão:

```text
implementation → public projection → implementation
```

O owner usa seus internals diretamente. Public é para quem está fora.

### INV-2.4-09 — no wildcard aliases

Package imports são exatos. Nenhum `#copilot/foo/*`.

### INV-2.4-10 — no speculative aliases

Alias sem consumer é stale, salvo entrypoint documental/CLI explicitamente declarado e governado.

---

## 10. Coesão de arquivos: a função é o critério primário

### 10.1 “Uma função clara” não significa “uma função JavaScript”

Um arquivo pode conter várias funções locais se todas servem ao mesmo invariant/state
machine/protocol.

Exemplos de arquivo coeso:

- parser de um protocolo com helpers privados;
- controller de lifecycle com state machine completa;
- policy de autorização com predicates locais;
- serializer + parser quando ambos formam um codec indivisível.

### 10.2 Sinais de que um arquivo precisa ser dividido

Split é recomendado quando existem múltiplas razões independentes para mudança:

- mistura protocol parsing com filesystem/network I/O;
- mistura state owner com rendering;
- mistura OAuth issuance, HTTP routing e persistence sem boundary;
- mistura policy pura com process orchestration;
- mistura composition/wiring com runtime hot path;
- contém subsistemas com consumers/lifecycles distintos;
- uma parte precisa de authority que outra não deve possuir;
- uma parte é hot/light e outra importa closure pesada;
- tests precisam mockar metade do arquivo para exercitar a outra metade.

### 10.3 LOC como sinal secundário

LOC não cria split automático. Como heurística de revisão, não como regra:

- > 300 LOC: revisar se há múltiplas responsabilidades;
- > 600 LOC: exigir justificativa explícita de coesão;
- > 1000 LOC: forte presunção de decomposição, salvo tables/generated/state machines/protocols cuja
  > coesão seja demonstrável;
- files de milhares de linhas com HTTP + persistence + policy + rendering são quase sempre owners
  múltiplos colapsados.

Budgets podem ser ajustados para expansão futura; **não podem substituir análise de coesão**.

---

## 11. Taxonomia de subpastas

Nomes têm significado arquitetural e não devem ser usados como decoração.

### `contracts/`

- shapes/protocol contracts puros;
- zero I/O;
- zero ambient config;
- zero implementation dependency ascendente.

### `protocol/`

- parsing/serialization/versioning de mensagens;
- normalization fail-closed quando security-relevant;
- idealmente pure ou explicitamente bounded.

### `policy/`

- decisões determinísticas a partir de dados/capabilities recebidos;
- sem ambient reads;
- clocks/randomness explícitos quando interferem na decisão.

### `state/`

- state ownership explícito;
- lifecycle visível;
- não pode significar “qualquer variável”.

### `store/` / `persistence/`

- persistência com owner e durability claros;
- ports separados de concrete adapter quando necessário.

### `adapters/`

- tradução entre protocolo/interface externa e domínio;
- não é local para business policy principal.

### `runtime/`

- execução viva e resource ownership;
- não deve virar “pasta para tudo que roda”.

### `composition/`

- wiring/construction/lifecycle registration;
- pode conhecer concrete adapters quando autorizado;
- não é hot-path library.

### `diagnostic/`

- leitura/observação;
- não materializa state nem amplia authority.

### `testing/`

- white-box/test controls;
- production import proibido.

### `scripts/`

- executáveis/process entrypoints;
- scripts que se tornam reusable runtime logic devem ser absorvidos por owner e o script vira thin
  launcher.

---

## 12. Dependency strata dentro de um owner

A 2.4 evita uma tabela global rígida de “L0/L1/L2” como única verdade. Em vez disso, cada owner deve
respeitar uma ordem local aproximada:

```text
pure contracts / protocol primitives
        ↓
policy / normalization / stateless kernels
        ↓
state / stores / resource adapters
        ↓
service / use-case orchestration
        ↓
composition
        ↓
external consumer
```

`public/` é uma **projection boundary**, não um novo runtime layer. Ela aponta para símbolos
permitidos sem criar comportamento.

O DAG global emerge da soma desses owner-local DAGs e das edges públicas entre owners.

---

## 13. Composition e dependency inversion

### INV-2.4-11 — concrete multi-owner wiring pertence ao menor composition root legítimo

Quando A precisa da capability de B, A define port quando precisa independência; B expõe
protocol/capability público; o menor ancestral semântico autorizado conecta os dois.

### 13.1 Composition roots são hierárquicos

Não substituir service locator por um `GodCompositionRoot`. O root global conhece apenas grandes
subsystems; roots locais conhecem children concretos dentro de sua authority.

### 13.2 Proibido

- `setDependencies(...)` global ou mutable registry de wiring;
- service locator;
- singleton `currentRuntime/currentSession/currentDb` acessível por leaf;
- leaf importando `boot/composition` para localizar dependency;
- owner pedindo ao bootstrap global o que seu parent poderia injetar.

### 13.3 Ports pertencem ao consumer

O adapter concreto vive no producer ou composition boundary adequada.

### 13.4 Composition entrega autoridade mínima

Consumer recebe a capability estreita de que precisa, não um host/runtime inteiro por conveniência.

## 14. Lifecycle, state e resource ownership

### INV-2.4-12 — quem cria, dispõe; estado terminal exige encerramento observado

O owner que cria recurso controla disposal ou transfere ownership explicitamente. Vale para sockets,
HTTP servers, streams, timers, workers, child processes, DB handles, watchers, caches, terminal
sessions e background tasks.

Recurso não pode ser marcado `closed/terminated/completed` antes de seu encerramento real ser
observado. Modelo preferido:

```text
active → closing → closed
                 ↘ close_failed
```

### 14.1 Explicit Resource Management

Avaliar `Symbol.dispose`/`Symbol.asyncDispose` e `using/await using` onde lifetime lexical e
baseline Node/tooling tornarem isso apropriado.

### 14.2 Cancellation e deadline

`AbortSignal` é o contrato preferido. Signal/deadline propagam downstream; child recebe budget
remanescente; timeout que só rejeita Promise sem cancelar trabalho é bug semântico;
subprocess/network operation observa cancellation quando possível; cancellation, timeout e close
failure são observáveis separadamente.

### 14.3 Structured concurrency

Fire-and-forget só existe dentro de owner que registra o trabalho, contém falha, define cancellation
e garante drain/disposal.

### 14.4 Retry e idempotência

Retry declara condição, max attempts/backoff/jitter/budget, idempotência ou idempotency key,
interaction com deadline e observability. Mutação não idempotente não recebe retry cego.

## 15. Configuration ownership

### INV-2.4-13 — configuration é snapshot owned, não ambient lookup em leaf

Somente config/composition owners leem ambiente/process flags. Leaf recebe dados normalizados e,
quando útil, snapshots defensivamente congelados.

```text
Process config
  └─ Runtime config
      └─ Workspace/session/resource config
          └─ Operation options
```

Dynamic config real deve ser state/protocol explícito e versionado, não leitura oportunista de
`process.env`. Feature flag pertence ao owner da capability que altera.

## 16. Authority e security

### INV-2.4-14 — privilege é capability, não convention nem import path

Operações privilegiadas aceitam capability opaca, port autorizado, bound resource/store ou validated
resource handle. Evitar string/options que ampliem privilege silenciosamente.

### 16.1 Capability attenuation

Capabilities devem, quando aplicável, ser bound a principal/resource/operation, de menor privilege,
não amplificáveis, expirables/revogáveis e separadas por authority: executar processo não implica
herdar credenciais; observar não implica mutar; workspace access não implica network access.

### 16.2 Fail closed e validation-bound operation

Unknown/error security-relevant nega por default. SSRF valida o endereço realmente conectado;
filesystem mantém path bound à capability; rollback prova provenance; OAuth replay é atomicamente
consumido; malformed permission nunca vira allow.

### 16.3 Architecture boundary não é sandbox

`public/`, aliases, exports e Node Permission Model não substituem capability design.

### 16.4 Secrets e observability

Redaction precede persistence/publication. Payloads têm recursive budgets. Process environment deve
ser explicitamente construído quando o child não necessita de todos os secrets do parent.

## 17. Protocols, schemas e types

### INV-2.4-15 — contracts acompanham seu protocolo

Não criar `types/`, `schemas.js` ou `interfaces.js` globais para contratos que pertencem a owner
específico.

### 17.1 Type-only dependency também é architecture edge

JSDoc imports devem atravessar a mesma public membrane quando cross-owner.

### 17.2 Schema runtime

Zod ou outro validator deve ser importado apenas onde runtime validation é realmente exigida.
Hot/light consumers podem depender de contracts JSDoc puros se validation já ocorreu na boundary.

### 17.3 Versioning

Protocolos externos/persistidos precisam de versão explícita quando evolução incompatível é
plausível.

---

## 18. Errors

### INV-2.4-16 — error taxonomy é domain-owned

Não recriar `errors` horizontal universal.

Separar:

- normalization neutra mínima (`unknown → Error`) quando realmente universal;
- domain error classes;
- transport projection (HTTP/MCP status) na transport boundary;
- recovery classification no owner que conhece contexto.

`isTransient(error)` global é suspeito: transiência frequentemente depende da
operação/provider/lifecycle.

---

## 19. Events e observability

### INV-2.4-17 — evento é protocolo; bus é resource

- nomes/schemas de eventos pertencem ao protocol owner;
- EventBus/runtime dispatch tem owner e lifecycle;
- subscriber não ganha authority por observar evento;
- fire-and-forget precisa de contrato explícito de failure containment.

### 19.1 Observability não é composition

Health/diagnostic:

- não cria recursos;
- não registra watchers;
- não muda state operacional para obter resposta;
- não amplia privilege;
- deve respeitar scope/runtime/session.

### 19.2 Node `diagnostics_channel`

Para observability de baixo nível que não pode depender para cima de `observability/`,
`node:diagnostics_channel` merece avaliação como seam nativo process-local. Não deve ser adotado
automaticamente; precisa provar melhor direção de dependência e custo que ports/callbacks já
existentes.

---

## 20. Persistence e database

### INV-2.4-18 — storage mechanics e application schema são concerns distintos

- adapter SQLite/filesystem fica no owner infra correspondente;
- schema/migrations de aplicação pertencem ao application owner, podendo usar port de storage;
- public runtime surface não deve vazar concrete driver;
- transaction semantics são explícitas (`required/optional/atomic` etc.).

`node:sqlite` no Node 24.x atual é Release Candidate, portanto continua apropriado como adapter
experimental/validado enquanto o driver default é decidido por benchmark, semantics e estabilidade —
não por preferência estética.

---

## 21. Concurrency, backpressure e bounded work

### INV-2.4-19 — toda fila é um resource com budget

Queues, registries e maps vivos devem possuir:

- owner;
- max size/budget;
- eviction/overflow policy;
- cancellation;
- observability;
- disposal.

### 21.1 Streams

Protocol/transport code deve preferir streaming/backpressure quando payload pode crescer. Evitar
`Buffer.concat`/JSON materialization irrestrita em endpoints ou tool results grandes.

### 21.2 Workers

`worker_threads` é apropriado para CPU-bound work, não como substituto para async I/O. Quando
adotado:

- worker pool tem owner;
- `resourceLimits` avaliados;
- message protocol versionado/validated;
- lifecycle/disposal explícito;
- MessageChannel dedicado preferido a global implicit channel quando separa concerns.

---

## 22. Node 24+ como plataforma arquitetural

A 2.4 trata Node 24+ como plataforma, não apenas runtime compatível.

### 22.1 ESM e package imports

- `type: module` é o default;
- `node:` scheme para built-ins;
- `#copilot/...` para owner/public boundaries;
- evitar CommonJS bridges quando não exigidos por third-party package;
- import side effects são proibidos em public contracts salvo entrypoint executável explícito.

### 22.2 `fs.glob`

`fs.glob`/`fsPromises.glob` são Stable no Node 24. Devem ser avaliados antes de manter
wrappers/dependencies de glob apenas por legado. A migração só ocorre quando semantics de
ignore/symlink/performance forem equivalentes e medidas.

### 22.4 Permission Model

O Permission Model é Stable e útil como **defesa em profundidade / seat belt**, especialmente para
CLIs, subprocesses e test harnesses. Não substitui Workspace authority, capabilities ou sandbox
contra código malicioso.

### 22.4 Module compile cache

O compile cache pode reduzir startup repetido, mas:

- é optimization, não correctness;
- first load pode piorar;
- cache é Node-version-sensitive;
- coverage/test runs podem preferir desabilitá-lo;
- portable mode existe em Node 24.x recente e deve ser usado apenas quando o mínimo de runtime
  adotado o suportar.

### 22.5 Async context

`AsyncLocalStorage` é estável e no Node 24 oferece `name/defaultValue`; `bind/snapshot` também estão
estabilizados em linhas recentes. Deve ser usado para **context propagation**, não para esconder
service locator/state ownership.

### 22.6 Built-ins antes de libs, sem dogma

Antes de adicionar dependência externa, comparar com Node 24+ para:

- glob;
- SQLite;
- fetch/Web APIs;
- AbortController;
- WebCrypto;
- streams;
- worker threads;
- test runner/utilities;
- diagnostics channel.

A decisão considera semantics, maturity, performance e maintenance — não “built-in é sempre melhor”.

---

## 23. Performance é arquitetura

### INV-2.4-20 — entrypoint é unidade de custo

Toda public surface material deve poder responder:

- quantos módulos carrega;
- quantos bytes fonte;
- quais external packages;
- cold import time;
- RSS delta;
- side effects on import.

### 23.1 Hot versus heavy

Um domain pode ter implementation pesada e ainda oferecer micro-surfaces leves.

### 23.2 Barrel fan-out

Mega-barrel que aumenta closure de consumer é arquitetura ruim mesmo que tree-shaking teórico exista
— Node ESM executa o grafo importado.

### 23.3 Baseline discipline

- medir em processo isolado;
- não medir performance simultaneamente com lint/test pesado;
- parser de closure deve ser AST-based;
- rebaseline somente após explicar causalmente o delta;
- preferir reduzir fan-out antes de aumentar threshold.

---

## 24. Side effects e import purity

### INV-2.4-21 — library import não inicializa o mundo

Proibido em library/public import sem declaração explícita:

- abrir DB;
- iniciar HTTP server;
- criar timers;
- iniciar worker;
- registrar shutdown handler;
- mutar env;
- iniciar monitor;
- fazer network call;
- gravar arquivo.

Entry executável (`cli`, `main`, launcher) pode compor recursos explicitamente.

---

## 25. Testing architecture

### INV-2.4-22 — teste acompanha ownership

Quando responsabilidade muda de owner, o teste principal se move com ela.

### 25.1 Test categories

- **owner-unit:** testa invariants privados via public behavior ou white-box testing surface;
- **contract:** testa membrane/import/layer/authority/cost;
- **integration:** testa composition entre owners;
- **runtime smoke:** testa processo/transport reais sem substituir unit tests.

### 25.2 Test controls

Test-only clocks/resolvers/failure injection devem estar em `testing/public` ou white-box local
explicitamente governado. Não ampliar a runtime API para facilitar teste.

### 25.3 No fake architecture

Fixture não deve ressuscitar service locator, globals ou compat alias que produção já removeu.

---

## 26. Governance 2.4

A arquitetura ideal precisa ser executável e economicamente sustentável.

### 26.1 Owner manifest

```js
{
  ownerId: 'mcp/auth/resource-server',
  path: 'src/copilot/mcp/auth/resource-server',
  parentOwnerId: 'mcp/auth',
  publicEntrypoints: ['#copilot/mcp/public/auth/resource-server'],
  audience: ['runtime'],
  exposure: 'workspace-internal',
  lifecycle: 'process',
  authority: ['oauth-verification'],
  sideEffectFreeOnImport: true,
  costTier: 'standard',
  transitionState: 'target'
}
```

### 26.2 Gates mínimos

Detectar cross-owner relative/deep imports, own-public inversion, public side effects,
stale/speculative/wildcard aliases, owner cycles, JSDoc bypass, testing/composition leakage, raw
authority leakage, public cost regression, mega-barrel fan-out, stale ownership metadata e dynamic
load/worker/subprocess entrypoint não manifestado.

### 26.3 Dynamic dependency graph

O graph inclui `import()`, loaders, Worker entrypoints, subprocess JS entrypoints e plugin/adapter
registries. Computed dynamic loading que impede provar a edge é proibido por default; exceção exige
allowlist/manifest auditável.

### 26.4 Governança de transição

Regra transitória declara dívida exata, owner, ratchet `no-new-*`, condição objetiva de remoção e
checkpoint de morte. Compat shim/barrel sem consumer real e exit condition é proibido.

### 26.5 Precedência e freshness documental

Para fatos do estado atual: **code/tests/config HEAD → manifests/gates derivados → docs live →
ledgers históricos**. Documento normativo descreve estado-alvo; README obsoleto é drift, não
evidência.

### 26.6 Economia de validação

| momento            | gate esperado                                                               |
| ------------------ | --------------------------------------------------------------------------- |
| edição local       | checks/test/type/lint estritamente focalizados                              |
| conjunto no owner  | suite escopada do owner/dependents diretos                                  |
| boundary de fase   | contratos/graph tocados                                                     |
| grande commit/push | strict typecheck, lint, format, unit/integration e gates globais relevantes |

**Global-green é checkpoint/publication evidence, não feedback loop de cada edição.**

### 26.7 API/reference gerada

Public surfaces e ownership devem poder gerar referência de manifests/AST.

## 27. Regras de nome e raiz de domínio

### INV-2.4-23 — root é caro

Arquivo no root de um domínio deve provar que representa o próprio domínio, não apenas uma feature
sem pasta.

Root permitido normalmente para:

- `README.md`;
- `index.js` interno pequeno quando necessário;
- launcher/composition root explicitamente nomeado;
- poucos contracts realmente domain-wide.

Se root acumula 10–50 feature files, ownership está provavelmente submodelado.

### 27.1 File + child folder

Se `server.js` ganha muitos children conceitualmente pertencentes ao servidor, o target preferido é:

```text
server/
├─ service.js
├─ public/
└─ ...children
```

em vez de manter `server.js` no parent root enquanto `server/*` cresce paralelamente.

---

## 28. Exemplo abstrato de topologia 2.4

```text
domain-x/
├─ README.md
├─ composition/
│  └─ ...
├─ feature-a/
│  ├─ public/
│  │  ├─ runtime/
│  │  │  └─ index.js
│  │  └─ diagnostic/
│  │     └─ index.js
│  ├─ contracts/
│  ├─ policy/
│  ├─ state/
│  ├─ adapter/
│  └─ service.js
├─ feature-b/
│  ├─ public/
│  │  └─ index.js
│  └─ service.js
└─ private-feature-c/
   └─ service.js
```

Cross-owner:

```js
import { capabilityA } from '#copilot/domain-x/public/feature-a';
```

Inside `feature-a`, relative imports são normais e não atravessam `public/`.

---

## 29. Critério formal para colocar/mover um arquivo

Para cada arquivo F, responder nesta ordem:

1. Qual invariant principal F preserva?
2. Qual state F possui ou modifica?
3. Quem controla lifecycle desse state/resource?
4. Qual config governa F?
5. Qual authority F exige/emite?
6. Qual protocolo F implementa?
7. Quais são seus consumers fora do subtree?
8. F pode existir coerentemente sem esses consumers?
9. Há um owner já existente que responde melhor às perguntas 1–6?
10. Se F for movido, o grafo fica mais descendente ou cria ciclo?
11. A mudança reduz ou aumenta public closure?
12. O novo path torna a relação pai/filho mais legível para um agente que nunca viu o código?

Se as respostas não apontarem claramente para um owner, **não mover ainda**; primeiro decompor a
responsabilidade ou definir o protocol/port correto.

---

## 30. Critério para criar uma nova pasta

Criar owner novo quando existirem pelo menos dois dos seguintes sinais fortes:

- lifecycle próprio;
- state próprio;
- config própria;
- authority própria;
- protocolo próprio;
- múltiplos arquivos coesos que mudam juntos;
- public consumers próprios;
- custo de import que precisa ser isolado;
- teste/invariant próprio.

Não criar pasta apenas para reduzir quantidade de arquivos no root.

---

## 31. Critério para criar um public entrypoint

Criar somente quando existe consumer fora do owner subtree ou boundary externa explícita.

O entrypoint deve exportar o **menor contrato suficiente**.

Se dois consumers precisam de subconjuntos de custo/authority muito diferentes, criar surfaces
distintas em vez de um barrel agregador.

---

## 32. Forbidden patterns 2.4

No estado final, são proibidos salvo ADR/exceção explícita e ratcheted:

- `shared/common/misc/core2/foundation` como depósito genérico;
- service locator/global mutable dependency registry;
- leaf importando `boot/composition` para buscar dependency;
- cross-owner relative/private import;
- root mega-barrel default;
- public entrypoint com implementation/side effect;
- production import de testing surface;
- leaf lendo `process.env` por chamada;
- background task sem owner/cancellation/disposal;
- timeout cosmético que deixa mutação/trabalho vivo;
- recurso marcado terminal antes do close observado;
- queue/cache/map sem bounds;
- retry cego de mutação não idempotente;
- security validation dissociada da operação;
- runtime test controls;
- type/schema/error mega-hub horizontal;
- compatibility shim sem consumer/owner/exit condition;
- speculative alias;
- computed dynamic load que oculta owner edge sem manifesto;
- process capability que herda secrets do parent sem necessidade.

## 33. Gaps ainda não plenamente tratados pelas arquiteturas anteriores

A 2.4 reconhece explicitamente áreas que ainda exigem campanhas futuras.

### GAP-2.4-01 — public membrane não universal

Infra está muito à frente dos demais domínios. Generalização precisa ser gradual para não criar
centenas de marker barrels.

### GAP-2.4-02 — owner tree não é machine-readable

O grafo atual conhece arquivos/imports, mas não conhece formalmente a relação
`parentOwner → childOwner`. Isso dificulta validar a regra pai/filho automaticamente.

### GAP-2.4-03 — root barrels ainda são muito grandes

Model Gateway, SDK, Events, Agent e outros precisam ser auditados por surface/cost/authority, não
simplesmente “quebrados em arquivos menores”.

### GAP-2.4-04 — cross-domain relative imports persistem

Há cerca de 160 edges desse tipo no snapshot inicial. Algumas são composition seams legítimas hoje,
mas o estado-alvo deve torná-las públicas/exatas ou explicitamente composition-owned.

### GAP-2.4-05 — audience taxonomy inconsistente

`testing`, `diagnostic`, `composition` e `runtime` ainda não possuem convenção física universal.

### GAP-2.4-06 — import-side-effect governance incompleta

Ainda não existe gate geral capaz de provar que todos public entrypoints são import-pure.

### GAP-2.4-07 — lifecycle manifest global incompleto

Infra modela scopes profundamente; outros domínios ainda dependem mais de convenção.

### GAP-2.4-08 — error/recovery ownership ainda precisa auditoria transversal

Core foi eliminado, mas root/domain error surfaces ainda podem carregar abstrações mais amplas que o
necessário.

### GAP-2.4-09 — event protocol fan-out

Events continua grande e merece campanha própria para separar protocol constants/schemas/runtime
dispatch/public projections.

### GAP-2.4-10 — static/cold cost governance não é universal

Infra mede public closures; o mesmo padrão deve alcançar MCP, SDK, Model Gateway e demais hot
surfaces.

### GAP-2.4-11 — scripts versus runtime owners

Alguns `scripts/` ainda contêm lógica reutilizável e extensa. A 2.4 deve tornar script = thin
executable adapter sempre que possível.

### GAP-2.4-12 — process/global state fora de Infra

É preciso inventariar Maps/registries/timers/event listeners de módulo nos demais domínios e
classificar ownership, bounds e disposal.

---

### GAP-2.4-13 — owner ontology ainda não é universal

Documentação/configuração antiga ainda pode confundir diretório taxonômico com owner autônomo.

### GAP-2.4-14 — dynamic loading graph incompleto

Imports, workers, subprocess entrypoints e loaders precisam entrar no owner graph.

### GAP-2.4-15 — transition rules podem contradizer target rules

ESLint/package aliases/READMEs históricos precisam de precedência, ratchet e condição de morte.

### GAP-2.4-16 — lifecycle terminal state não é universalmente verificável

Close fire-and-forget e timeout cosmético ainda precisam ser eliminados nas campanhas de domínio.

### GAP-2.4-17 — capability attenuation e secret inheritance

Process/network/file capabilities precisam impedir transferência incidental de
authority/credentials.

## 34. Node 24+ — oportunidades específicas a investigar em futuras campanhas

Sem transformar isso em checklist dogmático:

1. substituir wrappers de glob por `fs.glob` quando semantics/benchmark permitirem;
2. acompanhar `node:sqlite` até estabilidade suficiente para reavaliar driver default;
3. explorar compile cache portable quando o runtime mínimo do workspace suportar a opção e
   benchmarks mostrarem valor;
4. usar AsyncLocalStorage `name/defaultValue` para tornar context channels diagnosticáveis, sem
   esconder ownership;
5. avaliar `diagnostics_channel` como downward-safe observability seam;
6. usar Worker resource limits para parsing/CPU pools quando necessário;
7. usar AbortSignal composition para deadlines/cancellation consistentes;
8. avaliar Permission Model em audit/enforce profiles de subprocesses e CLIs;
9. preferir built-in WebCrypto/URL/fetch/streams quando eliminarem dependência sem perder semantics;
10. explorar `Symbol.asyncDispose` consistentemente em transports/sessions/jobs/watchers.

---

## 35. Estratégia de adoção da 2.4

Aplicar por domínio/owner, não por codemod global:

1. ler código/tests/config/docs live;
2. distinguir owners de diretórios taxonômicos;
3. medir static/dynamic graph, fan-in/out, cycles, root clutter e public surfaces;
4. classificar responsibility/lifecycle/authority/config/state;
5. desenhar owner tree e composition roots hierárquicos;
6. definir public membranes consumer-driven, exact aliases, audience/exposure;
7. criar ratchets `no-new-legacy-edge`;
8. corrigir lifecycle/authority/inversion que tornem moves inseguros;
9. migrar target-first owner por owner;
10. migrar tests/testing surfaces com seus consumers;
11. remover compat layers quando fan-in zerar;
12. medir cost quando surface estabilizar;
13. validar focalmente durante trabalho;
14. validar amplamente apenas em phase barriers/grande commit/push;
15. fechar docs/roadmap com evidência e remover regras transitórias vencidas.

A primeira campanha pós-especificação continua sendo `src/copilot/mcp`, regida pelo documento MCP
2.4.

## 36. Definition of Done da Arquitetura 2.4 — estado ideal global

- [ ] todo owner possui boundary física e ownerId/parenthood determinável;
- [ ] diretórios taxonômicos não são owners automáticos;
- [ ] todo cross-owner import atravessa `public/` física;
- [ ] child owner autônomo é consumido publicamente inclusive pelo parent;
- [ ] zero cross-owner relative/deep imports não modelados;
- [ ] exact public aliases; zero wildcard/stale/speculative aliases;
- [ ] root mega-barrels não são default cross-domain;
- [ ] public entrypoints são projection-only e import-pure transitivamente;
- [ ] audience e exposure são separadas;
- [ ] lifecycle/config/state/authority pertencem ao owner real;
- [ ] zero service locator e leaf→boot dependency lookup;
- [ ] background resources são bounded, cancellable e disposable;
- [ ] terminal state só após close observado/classificado;
- [ ] retry/idempotency são explícitos;
- [ ] capability attenuation impede privilege/secret inheritance incidental;
- [ ] contracts/JSDoc/dynamic loaders obedecem o mesmo owner DAG;
- [ ] transition exceptions têm owner, ratchet e exit condition;
- [ ] docs live não contradizem code/manifests;
- [ ] public hot surfaces têm cost ratchets;
- [ ] graph permanece 0 cycles/unresolved/parse errors;
- [ ] TS7 strict/lint/format/zero suppressions permanecem gates de checkpoint;
- [ ] focused validation é feedback padrão; global validation é checkpoint-driven;
- [ ] architecture reference pode ser derivada de manifests/AST;
- [ ] cada domínio possui docs coerentes com owner tree atual.

## 37. Decisões arquiteturais canônicas

### DEC-2.4-01 — owner é semântico e possui boundary física

Todo owner é identificável; nem todo diretório é owner.

### DEC-2.4-02 — public é obrigatório apenas entre owners

Componentes privados não ganham marker membranes; child owner autônomo é consumido publicamente.

### DEC-2.4-03 — public é architecture membrane, não security grant

Authority é runtime capability/policy.

### DEC-2.4-04 — parenthood é semântico

Lifecycle/authority/state/config/protocol vencem caller count e nesting.

### DEC-2.4-05 — múltiplos pais exigem owner independente ou inversion

Não resolver ambiguidade com `shared`.

### DEC-2.4-06 — coesão vence LOC

Split precisa melhorar responsibility/ownership/authority/cost.

### DEC-2.4-07 — exact surface vence mega-root por default

### DEC-2.4-08 — composition é hierárquica e explícita

Concrete wiring pertence ao menor composition root legítimo.

### DEC-2.4-09 — authority/lifecycle/cost/audience/exposure fazem parte da API

### DEC-2.4-10 — lifecycle terminal state precisa ser verdadeiro

Timeout cancela trabalho quando requerido; close é observado.

### DEC-2.4-11 — dynamic loading também é dependency graph

### DEC-2.4-12 — transition rule não é target rule

Toda exceção transitória possui ratchet e condição de morte.

### DEC-2.4-13 — validação maximiza informação por unidade de tempo

Checks focalizados dominam o ciclo; global-green é checkpoint.

### DEC-2.4-14 — architecture gates provam ausência

Após dívida ser extinta, gate muda de “não aumentar” para “zero”.

## 38. Referências de plataforma Node 24+

Referências oficiais consultadas para o horizonte 2.4 (a versão local do repo pode estar atrás do
último patch 24.x e deve governar feature adoption):

- Node.js 24 — Permissions:
  <https://nodejs.org/download/release/latest-v24.x/docs/api/permissions.html>
- Node.js 24 — File system / `fs.glob`:
  <https://nodejs.org/download/release/latest-v24.x/docs/api/fs.html>
- Node.js 24 — SQLite: <https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html>
- Node.js 24 — `node:module` compile cache:
  <https://nodejs.org/download/release/latest-v24.x/docs/api/module.html>
- Node.js 24 — Worker threads:
  <https://nodejs.org/download/release/latest-v24.x/docs/api/worker_threads.html>
- Node.js 24 — asynchronous context tracking:
  <https://nodejs.org/download/release/latest-v24.x/docs/api/async_context.html>

---

## 39. Próximo passo

Com a gramática 2.4 estabelecida, a campanha `src/copilot/mcp` deve aplicá-la sem confundir
reorganização física com correção arquitetural.

O documento MCP 2.4 deve manter inventário do estado real, priorizar
lifecycle/cancellation/authority e composition, distinguir SDK/protocol/OpenAI-host compatibility,
preparar a migração imediata para a linha MCP estável quando a primeira transformação de código for
autorizada, reconstruir owners e public membranes consumer-driven e manter roadmap detalhado com
checkboxes e acceptance gates focalizados.

Regra operacional: **baseline → modernize dependency/protocol boundary → target-first migration →
prove locally → delete old when fan-in/consumer evidence reaches zero**, reservando validação global
para checkpoints realmente relevantes.
