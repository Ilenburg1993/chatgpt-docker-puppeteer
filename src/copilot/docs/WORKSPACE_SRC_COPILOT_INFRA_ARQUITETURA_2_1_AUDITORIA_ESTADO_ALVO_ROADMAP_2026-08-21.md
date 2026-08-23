# WORKSPACE — `src/copilot/infra` — Auditoria pós-2.0, arquitetura-alvo 2.1 e roadmap

**Data da auditoria:** 21 de agosto de 2026

**Workspace auditado:** `/workspaces/chatgpt-docker-puppeteer`

**Escopo primário:** `src/copilot/infra/**`

**Escopo relacional:** `src/copilot/core`, `src/copilot/infra/database`, `src/copilot/boot`,
MCP/control-plane, terminal, tools, Model Gateway, SDK, consumidores de `#copilot/infra/public/**`,
scripts de governança e testes arquiteturais.

**Documento de origem lido integralmente:**
`WORKSPACE_SRC_COPILOT_INFRA_ARQUITETURA_2_0_AUDITORIA_ESTADO_ALVO_ROADMAP_2026-08-21.md` — 2.353
linhas, ~350 KiB no estado observado.

**Estado Git antes da criação deste documento:** `main`, worktree limpo,
`HEAD == origin/main == b56686d87b6eb220d08f017dc186662f01e0487f`.

**Estado inicial deste documento:** a abertura foi feita em modo auditoria/investigação. Desde então
este arquivo tornou-se o ledger canônico da execução 2.1; checkpoints posteriores registram
implementação, provas causais e gates efetivamente fechados.

---

## 0. Sumário executivo

A Arquitetura 2.0 foi uma transformação estrutural real, e não cosmética. A auditoria atual confirma
que os pilares mais difíceis do desenho 2.0 já existem fisicamente e possuem provas causais
relevantes:

1. `filesystem/trusted` foi eliminado, sem shim de compatibilidade;
2. a authority de workspace usa capabilities opacas, brand privado e binding à instância exata da
   authority;
3. configured filesystem possui grants explícitos, path modes, operações e symlink policy
   governados;
4. caches, invalidation, parser cache, parser workers e registry deixaram de depender dos antigos
   singletons distribuídos e passaram a ter ownership de runtime/instância;
5. scopes e watchers possuem instâncias e teardown explícitos;
6. o registry de indexação possui scheduler, retries bounded, backoff/jitter e métricas próprias;
7. a membrane pública é nominal, possui manifest, classificação de privilege/audience/lifecycle/cost
   e ratchets de closure;
8. testes atuais provam isolamento entre runtimes, scopes iguais em runtimes distintos, coexistência
   de watchers e teardown reverso/idempotente.

Portanto, **a Arquitetura 2.1 não deve reiniciar a 2.0** e não deve se transformar em nova campanha
de renames, decomposição por LOC ou abstrações especulativas. O problema agora é mais preciso: a
topologia 2.0 já existe, mas alguns invariants semânticos ainda não alcançaram todas as surfaces e
todos os scopes.

A conclusão desta auditoria é que a 2.1 deve perseguir seis objetivos centrais:

1. **fechar a authority end-to-end**: nenhuma surface runtime privilegiada deve aceitar path
   operacional cru sem authority explícita;
2. **tornar o Process scope real**: `ProcessInfra` deve ser o composition root de produção, ou ser
   removido; não pode permanecer uma abstração testada mas ornamental;
3. **fechar config ownership**: nenhuma capability abaixo do composition root deve reler
   `process.env` ou capturar defaults ambientais em instantes diferentes;
4. **autenticar rollback como capability**: checksum não pode ser chamado nem tratado como prova de
   emissão;
5. **tornar observability rigorosamente scoped**: runtime health não pode misturar métricas
   process-global sem rotulagem/owner explícito;
6. **reduzir acoplamento/custo acidental**: micro-surfaces semânticas devem substituir mega-roots e
   path-based persistence pesada onde houver evidência empírica de benefício.

Há três achados de maior prioridade.

### P0-A — rollback token é verificável como checksum, mas não autenticado como capability

Foi comprovado em processo isolado, sem executar mutação, que um caller pode construir integralmente
um envelope v3, recalcular `SHA-256(JSON({changeSetId, steps}))` e obter
`verifyIoRollbackToken(token) === true`.

Isso **não** representa escape automático do workspace: o tool boundary atual ainda reautoriza paths
com a workspace policy, exige confirmação para aplicação e o executor verifica precondições de hash.
O problema é outro e é arquiteturalmente importante: o sistema documenta e apresenta o token como
artefato original emitido por uma mutação anterior, mas sua autenticidade não é verificável. O
`digest` prova autoconsistência, não proveniência.

A 2.1 deve substituir esse contrato por capability autenticada — HMAC/assinatura bound a
owner/audience/expiry ou handle opaco server-side — e preservar checksum apenas como mecanismo de
corrupção, se ainda necessário.

### P0-B — existem public runtime surfaces path-based que contornam as authorities 2.0

A membrane pública ainda expõe primitives como:

- `#copilot/infra/public/filesystem/write` → `writeFileAtomic`, `appendTextLocked`,
  `mkdirPathLocked`;
- `#copilot/infra/public/filesystem/mutation` → `deleteFileLocked`, `removePathLocked`,
  `moveFileLocked`, `copyFileLocked`, `patchTextLocked`, `patchTextBatchLocked`;
- `#copilot/infra/public/persistence/json` → `readJson(filePath)`, `writeJson(filePath)`,
  `fileExists(filePath)`;
- `#copilot/infra/public/persistence/jsonl` → writer/tail/repair path-based.

Essas primitives possuem locks, durability e validação sintática, mas não aplicam por si mesmas
workspace containment nem configured-grant authority. Os consumidores atuais encontrados usam paths
internos/fixos e não foi demonstrado um escape imediato; ainda assim, a **fronteira pública permite
o bypass** que a 2.0 pretendia tornar impossível.

O caso mais inequívoco de resíduo 1.0 é `src/copilot/infra/persistence/jsonl/trusted.js`:
`readJsonlTailTrusted()` apenas exige uma string `caller` não vazia e então lê um path arbitrário.
Não há consumidor de produção identificado. Essa pseudo-authority deve desaparecer cedo na 2.1.

### P0-C — a promessa de `InfraConfigSnapshot` imutável ainda era falsa para parte da árvore — **RESOLVIDO em 2026-08-22**

Foi comprovado causalmente:

- um `InfraRuntime` foi construído com snapshot contendo `IO_MAX_ACTIVE_SCOPES=7`;
- depois da construção, `process.env.IO_MAX_ACTIVE_SCOPES` foi alterado para `2`;
- o `WorkspaceScopeRuntime` criado posteriormente pelo runtime nasceu com `maxActiveScopes=2`.

Logo, a configuração observada pela capability depende do **instante de materialização**, não
exclusivamente do snapshot do runtime.

Há outros casos semelhantes: scanner, index build, refresh concurrency, parser process config, lock
observability, path-policy cache e alguns budgets ainda capturam ou releem ambiente fora do root de
composição.

A 2.1 deve introduzir uma hierarquia explícita de configuração —
`ProcessInfraConfig → InfraRuntimeConfig → WorkspaceInfraConfig` — e proibir fallback para
`process.env` abaixo desses boundaries em produção.

**Fechamento causal em 2026-08-22:** a hierarquia passou a ser real. `ProcessInfra` captura
`parser`, locks, compile-cache, path-policy, search budget/subprocess e `runtimeDefaults`;
`InfraRuntime` recebe o snapshot do process owner por referência e `WorkspaceInfra` recebe seu
`WorkspaceInfraConfig`. O teste A→mutação ambiental→materialização lazy prova que children
permanecem em A e somente uma nova generation explícita recebe B. O ratchet arquitetural permite um
único `process.env` operacional em `src/copilot/infra/**`: `composition/process/service.js`. Além
disso, `execSearchFile/streamSearchFile` passaram a sempre fornecer `spawn.env`: executáveis
nominais exigem ambiente process-owned explícito e não podem recuperar autoridade ambiental pela
herança implícita do Node.

---

## 1. Metodologia e evidências

A auditoria foi realizada em modo read-only até a criação deste documento.

### 1.1 Evidência documental

- leitura integral do documento 2.0: 2.353 linhas;
- reconciliação dos checkboxes ainda abertos com o código atual;
- distinção entre a matriz histórica do início do documento e o estado final efetivamente
  implementado.

Essa distinção é necessária porque o documento 2.0 é também um ledger temporal. Sua matriz inicial
ainda menciona owners que foram posteriormente removidos (`filesystem/trusted`, `validated-path`,
antigos registry/parser singletons etc.). A Arquitetura 2.1 deve usar **inventário atual + gates
executáveis** como fonte de verdade e tratar documentos anteriores como histórico.

### 1.2 Inventário físico atual

No estado observado:

- **422 arquivos** em `src/copilot/infra`;
- **420 arquivos JavaScript**;
- **166 diretórios**;
- aproximadamente **33.301 linhas JavaScript**.

Maiores arquivos atuais, sem inferir automaticamente que LOC seja defeito:

| arquivo                                       | linhas aproximadas | leitura arquitetural                                                                          |
| --------------------------------------------- | -----------------: | --------------------------------------------------------------------------------------------- |
| `filesystem/configured/physical.js`           |                760 | backend físico especializado; grande, mas coeso                                               |
| `indexing/registry/instance/service.js`       |                730 | registry/scheduler instance-owned; candidato a seams apenas por responsabilidade, não por LOC |
| `governance/public-api-manifest.js`           |                625 | dados de governança; tamanho esperado                                                         |
| `filesystem/workspace/mutation-io/service.js` |                617 | capability ampla; avaliar subports sem quebrar atomicidade                                    |
| `indexing/parser/worker/runtime.js`           |               ~410 | runtime de workers; ownership já corrigido                                                    |
| `filesystem/read/cache/text.js`               |               ~392 | cache/read kernel                                                                             |
| `filesystem/workspace/authority/service.js`   |                347 | security boundary; preferir coesão a decomposição artificial                                  |
| `concurrency/locks/local/resource-lock.js`    |                344 | state machine de lock; possui `Symbol.asyncDispose`                                           |
| `filesystem/configured/service.js`            |                337 | authority/configured service                                                                  |
| `cache/l2/sqlite/store.js`                    |                326 | adapter SQLite concreto                                                                       |

### 1.3 Buscas e governança

Resultados atuais:

- `check:copilot:no-trusted-io`: **0 references / 0 aliases / 0 implementation paths**;
- configured FS governance: **38 owners / 38 policy entries / 44 grant calls**;
- public API cost governance: sem violações;
- mutable-state governance: todos os 17 owners process-global declarados, sem `undeclared`, `stale`
  ou invalid scope;
- nenhum `TODO`, `FIXME`, `HACK` ou `XXX` encontrado em Infra;
- nenhuma dívida textual relevante de `legacy/compat/shim` na árvore principal.

A dívida restante da 1.0 é, portanto, **semântica e de boundary**, não uma pilha de TODOs
explícitos.

### 1.4 Testes focados executados nesta auditoria

Foram executados apenas testes arquiteturais dirigidos, não suíte ampla:

- `test_infra_barrel_governance.spec.js`;
- `test_arch_contracts.spec.js`;
- `test_infra_composition_scopes.spec.js`;
- `test_parser_worker_runtime_lifecycle.spec.js`.

Resultado: **4 arquivos / 121 testes / 121 pass**.

Isso prova que os gaps descritos neste documento não devem ser lidos como “Infra quebrada em bloco”.
Em vários casos são propriedades **ainda não cobertas pelo invariant atual**.

### 1.5 Provas causais adicionais

Foram executadas provas em memória/processo isolado:

1. **rollback forgery:** envelope inteiramente fabricado + digest recomputado →
   `verifyIoRollbackToken(...) === true`;
2. **hierarchical stale child:** `runtime.workspace(root).dispose()` seguido de
   `runtime.workspace(root)` retorna a **mesma instância disposed**, ainda presente no map do
   parent;
3. **config snapshot split:** runtime criado com `IO_MAX_ACTIVE_SCOPES=7`, env alterado depois para
   `2`, scope materializado posteriormente → `maxActiveScopes=2`;
4. **L2 health:** uma hipótese inicial de side effect foi rejeitada após prova causal;
   `readIoRuntimeHealthSnapshot()` usa `l2.snapshot()` e **não materializou L2**. Esse item não é
   tratado como bug neste documento.

A regra metodológica para a 2.1 deve ser preservada: suspeita de code review não vira bug
documentado quando um probe causal simples pode falsificá-la.

### 1.6 Baseline MCP/Cloudflare pós-restart

Após restart/reconnect informado pelo operador:

- connector smoke renovado: **131 local = 131 remote**;
- registry match: true;
- OAuth: verde;
- SSE: verde;
- runtime health: verde;
- MCP e cloudflared ativos;
- named permanent URL: `https://mcp.aurelin.org/mcp`;
- Cloudflare HA connections: **4**;
- tunnel transport: **QUIC**;
- origin: HTTP/2;
- RTT observado: ~25 ms;
- post-change gates: `critical=[]`;
- request error rate cumulativo histórico foi corretamente tratado como warning, não como falha de
  janela atual.

No período da auditoria, repo handlers locais permaneceram rápidos; a degradação do latency
dashboard foi dominada por smokes/health pesados e pelo silent external gap entre tool calls, não
por authorization ou result-size checks.

---

## 2. Estado real da Arquitetura 2.0

### 2.1 O que deve ser considerado concluído

#### Authority de workspace

A implementação atual possui propriedades fortes:

- capability opaca com brand privado;
- token bound à instância exata de authority;
- duas authorities com o mesmo root não aceitam capabilities uma da outra;
- read e mutable capabilities são distintas;
- modo incompatível é rejeitado;
- final symlink pode ser preservado para `lstat` sem permitir escape por ancestral;
- recursive delete protege o workspace root;
- paths externos e symlink escape são rejeitados.

O P0 da auditoria 2.0 sobre minting público cru foi, portanto, efetivamente fechado.

#### Configured filesystem

O configured backend deixou de ser um wrapper de trusted IO e possui backend físico especializado
com:

- grants não forjáveis;
- roots/exact paths;
- operation allowlist;
- symlink deny;
- durability policy;
- fresh snapshots;
- atomic publish;
- lock local + composição multiprocess quando policy requer;
- owners classificados em manifest.

Estado atual: **38 configured owners / 44 grants**.

Não há evidência que justifique introduzir agora uma árvore genérica de child grants. Roots +
store-bound filename validation atendem os casos reais com menos complexidade.

#### Cache/invalidation instance ownership

A antiga constelação de singletons foi substancialmente eliminada:

- L1 runtime;
- L2 runtime;
- line-offset runtime;
- byte-line-index runtime;
- read-hash runtime;
- invalidation bus runtime;
- cross-process invalidation runtime;
- external watcher instances;
- coherence runtime;
- parser cache runtime;
- parser worker runtime;
- telemetry runtime.

Timers possuem teardown e, quando apropriado, `unref()`.

#### Index registry

Itens antigos ainda marcados como abertos no ledger 2.0 já estão implementados:

- registry instance-owned;
- scheduler pertencente à instância;
- domínio explícito para refresh;
- retry bounded;
- exponential-style backoff bounded + jitter;
- exhaustion counters;
- pending age/high-water;
- dispose de timer/pending/invalidation hooks;
- await de in-flight durante teardown.

Esses itens **não devem reaparecer como dívida 2.1**.

#### Scopes/prefetch/watchers

Já existem:

- `WorkspaceScopeRuntime` instance-owned;
- prefetch session registry por runtime;
- cleanup em throw;
- scopes iguais isolados entre runtimes;
- dispose do scope runtime;
- coexistência de watchers de workspaces diferentes;
- teardown de um child sem parar o watcher sibling.

#### Parser

- parser cache é runtime-owned;
- worker pool é instanciado por InfraRuntime;
- worker dispose foi testado;
- cache symbol/file-context possui bounds.

O que falta não é “criar parser runtime”; é **colocar a policy processual do parser sob um
ProcessInfra real**.

### 2.2 O que está parcialmente concluído

| tema 2.0                             | estado atual                                   | dívida real para 2.1                                                        |
| ------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------- |
| Process / Runtime / Workspace scopes | runtime/workspace existem e são testados       | ProcessInfra não é root de produção; child deregistration incompleta        |
| config snapshot                      | grande parte do runtime recebe config          | há env/module-load/operation-time fallbacks fora do snapshot                |
| public API as authority boundary     | manifest e namespaces existem                  | raw path mutation/persistence ainda públicos                                |
| health/probes                        | runtime explícito e snapshots em vários owners | mistura métricas process-global em runtime health                           |
| SQLite abstraction                   | provider binding existe                        | concrete `better-sqlite3` types ainda atravessam Infra                      |
| Core boundary                        | aliases podem existir tecnicamente             | governance força mega-root em vários casos; 32 imports aproximados em Infra |
| cold-load governance                 | static closure ratchet existe                  | falta benchmark real cold import ratcheted e differential budgets           |
| scope lifetime                       | runtime dispose existe                         | handle de scope não é disposable/self-owned                                 |
| human documentation                  | 2.0 ledger completo                            | README/architecture descriptions possuem resíduos históricos                |

### 2.3 O que não deve ser reaberto sem evidência

- decomposição de arquivos apenas porque ultrapassam determinada contagem de linhas;
- substituição de `better-sqlite3` apenas para usar API built-in;
- criação genérica de child-grant DSL sem caso concreto;
- nova camada de cache L3 sem workload que a exija;
- tentativa de “resolver” silent external gap por micro-otimização de `repo_read_file`;
- retorno de mega-barrel raiz de Infra;
- shims de compatibilidade para aliases removidos.

---

## 3. Resíduos da Arquitetura 1.0 que ainda precisam de consolidação

### 3.1 Raw path primitives públicas

A 1.0 organizou primitives físicas em capabilities, mas algumas continuaram públicas. A 2.0
construiu authorities fortes sem retirar todas as rotas paralelas.

O problema arquitetural pode ser expresso como invariant:

> **Nenhuma função pública com privilege `mutate` ou `read-write` pode receber um path operacional
> cru, a menos que ela própria seja um issuer/authority boundary explícito e auditado.**

Para leitura, a regra pode ser menos rígida somente para surfaces declaradamente
diagnostic/read-only e sem acesso a protected paths; para runtime application IO, a preferência deve
ser capability/store bound.

### 3.2 Persistence como filesystem adapter genérico

`persistence/json` e `persistence/jsonl` ainda misturam duas responsabilidades:

1. formato/codec/repair/queue;
2. autoridade física para abrir um path.

A 2.1 deve separar:

- **kernel puro**: encode/decode, validation, tail projection, trim/repair algorithm;
- **storage port**: read/write/append/stat já autorizado;
- **bound store**: path/identity capturado uma vez pelo owner;
- **authority**: workspace/configured, fora do kernel.

Esse desenho já foi parcialmente validado pelo padrão `mcp/control-plane/persistence/jsonl-store`.

### 3.3 `persistence/jsonl/trusted.js`

É um resíduo nominal e conceitual claro. `caller` textual não é capability. Sem consumer de
produção, a opção preferida é **remoção**, não migração com shim.

### 3.4 Duplicação de executable discovery fora de Infra

Foram encontrados pelo menos três owners diferentes realizando resolução de executável/PATH:

- terminal capabilities;
- Secure Tunnel readiness;
- code tools/ESLint discovery.

A 2.1 deve consolidar isso como capability read-only de platform/process, com:

- `PATH`/env explícito;
- sem shell;
- verificação X_OK quando aplicável;
- resultado com source/provenance;
- comportamento cross-platform explícito;
- cache process-owned opcional e bounded.

### 3.5 DB adapter ainda fora do lifecycle arquitetural completo

Historicamente, `src/copilot/db/sqlite.js` era o adapter concreto e concentrava estado/process
concerns. Esse estado foi eliminado na migração estrutural de 2026-08-22: o runtime concreto agora
vive em `infra/database/sqlite/better-sqlite3`, sem singleton global, enquanto o ownership canônico
pertence ao `ApplicationInfraHost`. Isso não era necessariamente erro de localização final, mas o
contrato de Infra ainda conhece `better-sqlite3` concretamente. A 2.1 deve fechar a inversão de
dependência antes de discutir driver alternativo.

---

## 4. Bugs e gaps comprovados

## 4.1 P0/P1 — rollback capability sem autenticidade

### Estado atual

`verifyIoRollbackToken` recomputa um SHA-256 a partir do próprio conteúdo do token.

Propriedades que **já existem** e devem ser preservadas:

- precondition hash por step;
- payload/sidecar hash verification;
- locking;
- mutation-applied/partially-applied semantics;
- workspace reauthorization no tool boundary;
- explicit confirmation para aplicação;
- dry-run.

Propriedade ausente:

- prova criptográfica ou state-bound de que o token foi emitido pelo sistema para aquele
  changeSet/owner/audience.

### Estado-alvo

Preferência A — **opaque server-side handle** quando portabilidade entre processos não for
requisito:

```text
RollbackHandle {
  id: opaque random id
  workspaceId
  runtimeId
  changeSetId
  createdAt
  expiresAt
  audience
}
```

O plano completo permanece em registry/store interno.

Preferência B — **authenticated envelope** quando persistência/restart portability for necessária:

```text
version
keyId
workspaceIdentity
runtime/audience identity
changeSetId
createdAt/expiresAt
steps checksum
HMAC/signature
```

Nunca confundir checksum com autenticação.

### Gates necessários

- token fabricado com checksum válido deve falhar;
- alteração de qualquer step deve falhar;
- token de workspace A não funciona em B;
- audience mismatch falha;
- expiry falha;
- restart semantics documentadas e testadas;
- replay policy explícita;
- sidecar directory é owner-bound, não input aberto.

## 4.2 P1 — stale child após disposal direto

Prova causal atual:

```text
first = runtime.workspace(root)
await first.dispose()
second = runtime.workspace(root)
first === second            => true
second.lifecycle.state      => disposed
parent.listWorkspaces()     => 1
```

Isso mostra que a relação pai→filho não é completamente governada.

### Alternativas válidas

1. **parent-only disposal**: child não expõe dispose público para consumidores comuns; parent
   encerra children;
2. **deregister-on-dispose**: child recebe callback privado do parent e remove-se atomicamente do
   map;
3. **generation/recreate**: parent detecta disposed child e cria nova geração, com identity/version
   explícitos.

Recomendação: parent ownership estrito + handle disposable para recursos temporários, evitando
reanimação implícita de child estrutural.

O mesmo invariant deve valer para `ProcessInfra → InfraRuntime`.

## 4.3 P0/P1 — config snapshot split-brain

### Evidência

Na auditoria inicial, o runtime config capturava vários subsistemas, porém ainda existiam reads fora
dele: `IO_MAX_ACTIVE_SCOPES` em materialization-time; scanner/index defaults em
module/operation-time; parser/lock/path-policy em boundaries dispersos; e budgets com fallback
ambiental.

**Estado implementado em 2026-08-22:** esses reads foram eliminados do hot/lazy path. Os resolvers
inferiores recebem snapshots explícitos ou usam defaults determinísticos `{}`; os helpers `readEnv*`
não possuem mais `env = process.env`; L2 não captura env no import; search budget não usa first-use
ambiental; e subprocess search não herda `process.env` por `spawn()`.

### Estado-alvo

```text
ProcessInfraConfig
├─ parserProcessPolicy
├─ lockPolicy
├─ compileCachePolicy
├─ pathPolicyCachePolicy
├─ search
│  ├─ budget
│  └─ subprocess environment/capability policy
└─ runtimeDefaults

InfraRuntimeConfig
├─ l1/l2/read/coherence
├─ index
│  ├─ registry
│  ├─ scanner
│  ├─ build
│  └─ refresh
├─ parserCache
├─ telemetry
├─ rollback/capacity
└─ workspaceDefaults

WorkspaceInfraConfig
├─ blockedSegments/path policy
├─ maxActiveScopes
├─ watcher policy
└─ indexing/context policy
```

Regra implementada: **`process.env` só é lido no process composition root** dentro de Infra.
Factories inferiores aceitam snapshots/config explícitos e usam defaults puros quando standalone. A
regra cobre também autoridade ambiental indireta: subprocessos locais recebem `env` explícito e
executáveis nominais são rejeitados sem um ambiente process-owned.

## 4.4 P1 — runtime health mistura scopes distintos — **RESOLVIDO em 2026-08-22**

A auditoria inicial comprovou que `readIoRuntimeHealthSnapshot(runtime)` recebia runtime explícito,
mas incorporava locks process-global, path-policy cache process-global, aggregate stats de workspace
authority e um registry process-global de probes de scopes. Portanto atividade de B podia contaminar
o health nominalmente pertencente a A.

**Estado implementado:** observability foi separada por lifecycle, sem compat fields duplicados:

- `readIoRuntimeHealthSnapshot(runtime)` contém somente estado daquele runtime e de seus workspaces;
- `readIoProcessHealthSnapshot(processInfra)` concentra locks, Core process policy, path-policy,
  search budget/subprocess e aggregate lifetime de authority;
- cada facet process-global só é projetada quando seu `processId` ativo coincide com o
  `ProcessInfra` fornecido; caso contrário fica explicitamente `owned:false`;
- scope probes usam contrato owner-bound
  `{ scope:'workspace', ownerId, runtimeOwnerId, probeId, mayMaterialize:false, snapshot }`, e o
  registry filtra metadata **antes** de executar `snapshot()`;
- counters de `WorkspacePathAuthority` são por authority; o aggregate global existe somente no
  process health;
- watcher health é bounded e não transporta roots/paths nem mensagens de erro potencialmente
  sensíveis;
- `getIoLockStats({ emitStaleEvents:false })` permite que health observe lease state sem produzir
  telemetry como efeito da própria leitura.

A public membrane também passou a distinguir lifecycle: `#copilot/infra/public/observability`
permanece runtime-scoped e `#copilot/infra/public/observability/process` é um micro-entrypoint
process-scoped. O novo entrypoint foi medido em `69` módulos / `302.462` bytes e recebeu limites de
`104` módulos / `453.693` bytes, preservando aproximadamente 1,5× de headroom.

**Prova causal:** `test_io_health_scope_ownership.spec.js` executa authority, telemetry, parser e
scope work exclusivamente em runtime B e compara o snapshot integral de A antes/depois, normalizando
somente `generatedAt`; o snapshot de A permanece idêntico.

## 4.5 P1 — public governance não modela authority de path

O teste atual de “raw write primitives” procura essencialmente nomes `Unlocked`, `Portable` e
minting conhecido. Assim, `writeFileAtomic`/`removePathLocked` passam apesar de aceitarem paths
crus.

O manifest precisa declarar propriedades como:

```text
pathAuthority: none | workspace-bound | configured-bound | process-bound | diagnostic
acceptsOperationalRawPath: boolean
issuer: boolean
```

E o checker deve analisar assinatura/categoria, não apenas substring do nome.

## 4.6 P2 — documentation drift

Foram observadas descrições humanas ainda ancoradas na topologia anterior, inclusive referências a
`workspace/trusted` em summary de architecture manifest e estrutura antiga em README público.

A 2.1 deve tornar documentação derivável do manifest sempre que possível e limitar texto manual a
semântica, não inventário repetido.

---

## 5. Oportunidades de upgrade arquitetural

## 5.1 `ProcessInfra` deve virar composition root real

Hoje `createProcessInfra()` existe, possui lifecycle coerente e teste, mas não possui consumidores
de produção. `boot/application-infra.js` cria diretamente um singleton de módulo com
`createInfraRuntime()`.

Isso produz uma inconsistência conceitual: existe um scope processual no modelo, mas o processo real
pula esse scope.

### Proposta 2.1

Criar um `ApplicationInfraHost` process-owned que:

- resolve uma vez `ProcessInfraConfig`;
- cria um `ProcessInfra` real;
- cria o application runtime por ele;
- controla bootstrap SQLite/other process services;
- registra shutdown uma única vez;
- possui state machine `created → booting → active → disposing → disposed`;
- não permite getter de runtime após disposed sem boot explícito de nova geração;
- expõe snapshot de process/runtime identities.

Isso também oferece um owner natural para parser policy, compile cache, global locks diagnostics e
path-policy cache.

## 5.2 Ports estruturais para SQLite

Infra ainda possui tipos `import('better-sqlite3').Database` em vários pontos. O objetivo 2.1 não
deve ser “trocar o driver”; deve ser “Infra não conhece o driver”.

Definir ports mínimos por uso, por exemplo:

```text
SqliteDatabasePort
SqliteStatementPort<Row, Params>
SqliteTransactionPort
```

Somente métodos realmente usados entram no contrato.

### `node:sqlite`

No Node 24.19.0, `node:sqlite` está em **Stability 1.2 — Release candidate**; tornou-se release
candidate no Node 24.15.0. Portanto, a recomendação é:

1. criar primeiro o port;
2. manter `better-sqlite3` como adapter default;
3. opcionalmente criar adapter experimental `node:sqlite`;
4. rodar parity + benchmark de workload real;
5. só considerar troca de default após API/semântica/performance justificarem.

Não migrar por novidade.

## 5.3 Core semantic entrypoints em vez de mega-root

A Infra ainda importa `#copilot/core` em dezenas de pontos. A governance de deep imports, embora
criada para impedir acoplamento arbitrário, acabou incentivando mega-root.

Benchmark de processos Node frios nesta auditoria:

| surface                      | import interno mediano | RSS mediano aproximado |
| ---------------------------- | ---------------------: | ---------------------: |
| `#copilot/core`              |                 ~54 ms |              ~75,9 MiB |
| `#copilot/core/io-contracts` |                ~1,7 ms |              ~56,4 MiB |
| `#copilot/core/io-policy`    |                ~3,9 ms |              ~57,3 MiB |
| `#copilot/core/errors`       |                ~1,7 ms |              ~56,3 MiB |
| `#copilot/core/shutdown`     |                ~3,3 ms |              ~56,4 MiB |

A conclusão é clara: permitir **aliases exatos semânticos governados** é melhor que forçar root
barrel.

Proposta:

- remover/evitar wildcard conceitual para Core;
- allowlist de exact aliases;
- deep-import guard continua proibindo arquivos arbitrários;
- migrar Infra para micro-entrypoints;
- adicionar cost baseline por alias.

## 5.4 Persistence kernel leve

Benchmarks frios atuais:

| surface                          | import interno mediano |
| -------------------------------- | ---------------------: |
| `public/persistence/json`        |              ~123,5 ms |
| `public/persistence/jsonl`       |              ~138,5 ms |
| `public/persistence/jsonl/queue` |                ~2,1 ms |

O contraste mostra que o kernel já pode ser muito barato quando desacoplado de filesystem/telemetry
graph. A 2.1 deve expandir esse padrão.

## 5.5 Public surface minimization

Alguns aliases runtime não têm consumer de produção atual, incluindo:

- `composition/process`;
- `composition/operation`;
- `composition/workspace/instance`;
- `concurrency/locks`;
- `filesystem/read`.

Diagnostic/testing são exceções naturais.

Regra 2.1:

> Surface runtime sem consumer real e sem papel de extensão documentado volta a internal até existir
> use case.

Isso reduz API promises, closure e caminhos de bypass.

## 5.6 Namespace directories não precisam de barrels vazios

Há vários `public/**/index.js` vazios que existem apenas porque o checker exige index para todo
diretório. Se não há package alias naquele nível, o index vazio não é boundary; é decoração.

A governance 2.1 deve exigir barrel somente para **entrypoint real**. Namespace físico pode ser
apenas diretório.

## 5.7 Executable resolution como platform capability

Unificar descoberta de `node`, `npm`, `eslint`, `cloudflared` etc. sob uma primitive read-only:

```text
resolveExecutable(name, { env, cwd?, candidates? })
```

Sem shell, com provenance e comportamento determinístico.

## 5.8 Explicit Resource Management onde lifetime é natural

Locks locais já implementam `Symbol.asyncDispose`, um bom precedente.

Candidatos adequados:

- `ScopeHandle`;
- temporary watcher handle;
- process/runtime host em testes;
- session/prefetch handles quando o caller realmente owns lifetime.

Não converter objetos process-long-lived mecanicamente apenas para usar sintaxe nova.

## 5.9 Node Permission Model como defesa em profundidade seletiva

O Permission Model do Node 24 é Stable, mas a própria documentação o caracteriza como “seat belt”
para trusted code e não como sandbox contra malicious code. Ele restringe FS, child process,
workers, native addons etc.

No processo principal do Copilot, habilitação ampla conflitaria com workers, child processes, native
addons e o próprio `better-sqlite3`. Portanto:

- **não** usar como substituto para Workspace/Configured authority;
- avaliar apenas para subprocessos altamente delimitados/audits/runners;
- medir custo operacional e grants necessários.

## 5.10 `fs.glob` built-in

`fs.glob`/`fsPromises.glob` estão Stable no Node 24. O scanner runtime atual usa `minimatch` como
predicate e possui semântica própria de traversal/gitignore/fingerprint; não há justificativa
automática para reescrevê-lo.

Pode haver benefício em scripts CI que hoje dependem do pacote `glob`, mas isso é uma frente
secundária e separada de Infra runtime.

---

## 6. Performance e custo de composição

### 6.1 Static closure atual

A governance está verde, mas vários entrypoints possuem closures grandes por design ou acoplamento:

- composition/runtime: ~221 módulos / ~890 KiB;
- composition/process: ~223 / ~892 KiB;
- workspace/instance: ~164 / ~645 KiB;
- filesystem/mutation: ~152 / ~635 KiB;
- observability: ~157 / ~646 KiB;
- operations: ~193 / ~729 KiB;
- persistence/jsonl: ~143 / ~581 KiB;
- persistence/json: ~134 / ~551 KiB.

Esses valores não devem virar limite cego. A pergunta 2.1 é: **qual parte da closure é
semanticamente necessária para o entrypoint em questão?**

### 6.2 Cold import real

Medições de 5 processos Node frios por surface:

| surface                   | import mediano | wall mediano | RSS mediano |
| ------------------------- | -------------: | -----------: | ----------: |
| configured FS composition |         ~55 ms |      ~112 ms |     ~76 MiB |
| composition/runtime       |        ~228 ms |      ~309 ms |    ~139 MiB |
| workspace/read-io         |         ~89 ms |      ~148 ms |     ~92 MiB |
| filesystem/write          |        ~123 ms |      ~190 ms |    ~108 MiB |
| filesystem/mutation       |        ~143 ms |      ~199 ms |    ~122 MiB |
| persistence/json          |        ~124 ms |      ~191 ms |    ~108 MiB |
| persistence/jsonl         |        ~139 ms |      ~194 ms |    ~122 MiB |
| observability             |        ~176 ms |      ~234 ms |    ~126 MiB |
| operations                |        ~152 ms |      ~211 ms |    ~122 MiB |
| `#copilot/core`           |         ~54 ms |      ~106 ms |     ~76 MiB |

### 6.3 Política de performance 2.1

- static closure continua como structural ratchet;
- adicionar cold import benchmark **real** separado;
- usar regressão percentual + margem absoluta, não threshold frágil único;
- distinguir composition root pesado de leaf entrypoint;
- leaf entrypoint tem orçamento muito mais agressivo;
- medir RSS juntamente com tempo;
- não falhar CI por ruído de uma única execução: usar mediana de pequenos batches e tolerance
  calibrada;
- não transformar performance benchmark em validator frequente de desenvolvimento.

---

## 7. Arquitetura-alvo 2.1

## 7.1 Invariants fundamentais

### INV-2.1-01 — authority única por efeito

Toda operação física é uma das seguintes:

1. workspace-bound;
2. configured-bound;
3. process/platform-bound explicitamente classificada;
4. diagnostic read-only explicitamente classificada.

Não existe “trusted by caller string”.

### INV-2.1-02 — nenhuma privilege pública implícita por raw path

Uma runtime API pública `mutate/read-write` não aceita path cru sem ser authority boundary
declarada.

### INV-2.1-03 — config é dado, não ambient lookup

Depois do bootstrap, `process.env` não participa da decisão operacional de Infra.

### INV-2.1-04 — owner controla lifetime dos children

Child não permanece morto e memoizado no parent. Ownership e disposal são observáveis e
deterministicamente testados.

### INV-2.1-05 — health é observação, não composição

`status/snapshot/health`:

- não cria DB;
- não inicia timer;
- não registra hook;
- não inicia worker;
- não cria scope;
- não abre watcher;
- não amplia authority.

### INV-2.1-06 — health respeita scope

Process metrics só aparecem em process health; runtime/workspace metrics são owner-bound.

### INV-2.1-07 — capability integrity é autenticada quando a proveniência importa

Checksum nunca substitui autenticidade.

### INV-2.1-08 — ports não vazam drivers

Infra contracts não mencionam `better-sqlite3` nem outro adapter concreto.

### INV-2.1-09 — entrypoint é unidade de authority, lifecycle e custo

Barrel físico não basta. Cada package alias público tem metadata e budget coerentes com o que
promete.

### INV-2.1-10 — nenhum shim sem necessidade operacional demonstrada

Mudança arquitetural remove dívida na mesma onda, salvo compatibilidade externa estritamente
necessária e documentada.

---

## 7.2 Composition target

```text
ApplicationInfraHost                      [process owner]
│
├─ ProcessInfraConfig                    [snapshot único]
├─ ProcessHealth
├─ ProcessPlatform
│  ├─ executable resolver
│  ├─ compile cache
│  └─ process-scoped policy/cache diagnostics
│
├─ InfraRuntime A                        [runtime owner]
│  ├─ RuntimeConfig
│  ├─ database port binding
│  ├─ L1/L2/read/coherence
│  ├─ parser cache + worker runtime
│  ├─ index registry
│  ├─ telemetry
│  └─ WorkspaceInfra *
│     ├─ WorkspacePathAuthority
│     ├─ WorkspaceReadIo
│     ├─ WorkspaceMutationIo
│     ├─ WorkspaceIndexing
│     ├─ ScopeRuntime
│     └─ Watcher handles
│
└─ InfraRuntime B ...
```

Configured filesystem permanece como capability process/control-plane separada, com grants emitidos
apenas por owners bootstrap/config resolvers autorizados.

---

## 7.3 Persistence target

```text
JSON/JSONL codec + algorithms          [pure/micro]
            │
            ▼
Authorized storage port                [no path minting]
            │
   ┌────────┴────────┐
   ▼                 ▼
Workspace store    Configured store
   │                 │
   ▼                 ▼
WorkspaceAuthority  ConfiguredFsGrant
```

Nenhuma função de codec deve precisar saber o workspace root.

---

## 7.4 Observability target

```text
ProcessProbeRegistry
├─ locks
├─ path-policy cache
├─ compile cache
└─ parser process policy

RuntimeProbeRegistry(runtimeId)
├─ L1/L2/read/coherence
├─ parser worker/cache
├─ index registry
└─ telemetry

WorkspaceProbeRegistry(workspaceId)
├─ authority counters
├─ scopes
├─ watchers
└─ indexing context
```

Probes devem ser read-only e não materializantes.

---

## 7.5 Database target

Infra recebe `SqliteDatabasePort`; adapters vivem fora do domínio Infra puro.

`better-sqlite3` continua default até benchmark demonstrar razão concreta para mudança.

---

## 8. Roadmap Arquitetura 2.1

Os checkboxes abaixo formam o **ledger vivo de execução da 2.1**. Itens comprovadamente concluídos
são marcados somente após evidência causal e gates correspondentes; itens da 2.0 não são duplicados
como tarefas.

## Faixa A — authority closure e public membrane

### A.1 — inventário de privilege por entrypoint

- [x] Adicionar `pathAuthority`, `acceptsOperationalRawPath` e `issuer` ao public API manifest como
      metadata semântica obrigatória.
- [x] Classificar exaustivamente os **41 entrypoints públicos atuais**; o inventário é derivado do
      manifest/package map e cresceu novamente apenas por seams SQLite explicitamente
      audience-scoped.
- [x] Criar checker AST que resolve named exports/reexports até a implementação e inspeciona
      signatures path-based de surfaces privilegiadas.
- [x] Fazer o checker distinguir issuer explícito, capability bound e primitive física; metadata
      ausente ou de tipo inválido é violação explícita.
- [x] Adicionar teste causal name-independent: uma primitive sintética
      `persistAnything(path, content)` é rejeitada em runtime public sem authority e aceita quando
      formalmente workspace-bound.

**Evidência A.1:** `PUBLIC_API_AUTHORITY` é um mapa exaustivo fundido por `definePublicApi`;
`check-infra-public-api-authority.mjs` reporta zero metadata/signature violations. O rebaseliner
oficial foi endurecido para alterar somente arrays nominais `exports` e compara fingerprint AST
semântico antes/depois; ciclo real `--write` preservou metadata (`semanticManifestPreserved=true`).
Governance focada: **27/27**.

### A.2 — retirar raw filesystem mutation da membrane runtime

- [x] Migrar `mcp/control-plane/dependency-maintenance` para capability/store bound adequada aos
      manifests root.
- [x] Migrar `mcp/control-plane/ai-artifacts` delete para configured/workspace-bound ownership.
- [x] Remover `#copilot/infra/public/filesystem/write` de produção ou reduzi-lo a uma surface que
      não aceita path cru.
- [x] Remover `#copilot/infra/public/filesystem/mutation` de produção ou substituí-lo por bound
      operations.
- [x] Auditar `public/filesystem/read`: nenhum use case justificava a surface pública; o
      alias/barrel foi removido em J e diagnostics usam o owner interno sem criar exceção de
      authority.
- [x] Não criar compatibility aliases após a migração.

### A.3 — remover pseudo-trusted residual

- [x] Confirmar zero consumers de `persistence/jsonl/trusted.js` no HEAD da implementação.
- [x] Remover `readJsonlTailTrusted` e o arquivo `trusted.js`.
- [x] Criar invariant `no pseudo-trusted caller-string authority`.

**Gate da Faixa A**

- [x] zero runtime public mutate/read-write raw-path bypass;
- [x] configured/workspace authority tests verdes;
- [x] public manifest/checker verdes;
- [x] TS7 strict dirigido verde.

---

## Faixa B — persistence 2.1: kernel + authorized stores

### B.1 — JSON

- [x] Separar encode/decode/validation de filesystem access.
- [x] Definir `JsonStoragePort` mínimo.
- [x] Criar bound JSON store com identidade/path capturado uma vez.
- [x] Migrar os consumers de produção da façade JSON path-based por ondas sem grant-from-input.
- [x] Retirar `writeJson(filePath, ...)` da public runtime surface.

### B.2 — JSONL

- [x] Extrair tail/repair/trim para `persistence/jsonl/kernel`: parse/tail ring, leading-partial
      handling, retention planning, repair policy e classificação são puros; adapters físicos retêm
      exclusivamente read/open/lock/truncate/sync/durability/mutation-applied.
- [x] Generalizar o padrão de bound JSONL store já usado no MCP control-plane.
- [x] Migrar logger/metrics/audit/terminal/Model Gateway para stores bound apropriados.
- [x] Preservar queue/ordering/backpressure semantics.
- [x] Retirar writer/tail path-based da public runtime surface.

### B.3 — cost target

- [x] Manter codec/queue micro-entrypoints com cold import próximo às micro-surfaces atuais.
- [x] Medir antes/depois de persistence JSON/JSONL.
- [x] Ratchet de static closure + cold import real.

**Gate da Faixa B**

- [x] nenhum persistence runtime API recebe path operacional aberto;
- [x] stores possuem owner/authority explícitos;
- [x] repair/trim/tail possuem prova dedicada: `test_jsonl_kernel` 5/5, readers/repair 14/14 e bound
      MCP store 2/2; fault após truncate continua marcado `mutationApplied=true`. O conjunto JSONL
      dirigido fechou **21/21**.

---

## Faixa C — rollback capability integrity

### C.1 — threat model e portability

- [x] Decidir formalmente se rollback deve sobreviver restart/process replacement: **não**; a
      capability é deliberadamente efêmera e process/runtime-owned.
- [x] Definir audience e replay semantics: `copilot.file.rollback`; dry-run reutilizável, execução
      real reservada contra concorrência e consumida após mutação física observada.
- [x] Definir expiry obrigatória com validade estrita `createdAtMs <= now < expiresAtMs` e TTL
      herdado da policy do runtime.
- [x] Definir vínculo a `workspaceId`, `runtimeId`, `changeSetId` e digest do workspace root.

### C.2 — authenticated capability

- [x] Implementar authenticated envelope v4 com HMAC-SHA-256 e signing secret efêmero pertencente ao
      `InfraRuntime`.
- [x] Separar checksum de conteúdo de autenticação/proveniência: recomputar o SHA-256 de conteúdo
      não permite fabricar `authTag` válido.
- [x] Eliminar `allowedPaths` como authority primária: emissão/verificação é workspace-bound e
      recusa steps fora do root; o executor interno mantém `allowedPaths` apenas como defesa
      adicional opcional.
- [x] Tornar sidecar inventory/cleanup owner-bound pela mesma capability de rollback e remover
      directory override dos consumers MCP/file-tool.
- [x] Remover suporte legado de token por inércia: somente v4 é estruturalmente aceito.

### C.3 — causal security tests

- [x] token fabricado com checksum correto falha;
- [x] token alterado falha;
- [x] token de outro workspace/runtime falha;
- [x] token expirado falha;
- [x] replay de execução real falha com `EROLLBACKREPLAY`; dry-run não consome a capability.
- [x] partial-apply/durability semantics permanecem corretas e token é consumido quando
      `mutationApplied`/`appliedCount > 0` evidencia mutação física.

**Gate da Faixa C**

- [x] rollback token/handle passa a ser uma capability autenticada, não uma convenção textual.

### Checkpoint executado — Faixas A/B/C

- public raw filesystem mutation/write aliases removidos sem shims; pseudo-`trusted` JSONL removido
  e `no-trusted` permanece `0/0/0`;
- configured authority chegou a **46 owners / 46 policy entries / 52 grant calls** no fechamento da
  persistence wave;
- `#copilot/infra/public/persistence/json` caiu de ~123 ms para ~2,5 ms no benchmark frio dirigido e
  passou a 3 módulos / 3.568 bytes;
- `#copilot/infra/public/persistence/jsonl` passou de ~139 ms históricos para ~18,4 ms na amostra
  fria dirigida e foi ratcheteado em 30 módulos / 74.045 bytes, sem pacote externo;
- public JSON/JSONL expõem somente stores/writers/readers bound; raw JSONL permanece exclusivamente
  implementação interna de Infra;
- rollback v4 usa HMAC-SHA-256, claims de runtime/workspace/root, expiry obrigatória, anti-replay e
  signing secret zerado no dispose;
- signer rejeita change sets com qualquer path fora do workspace antes de emitir a capability;
- sidecar inventory/cleanup e execução pertencem à capability workspace-bound; `public/operations`
  não exporta mais issue/parse/verify/execute/list/cleanup de rollback;
- evidência dirigida: rollback transaction/capability **9/9**, file-write boundary **27/27**,
  startup/AI-artifacts/capability **16/16**, Infra public governance **25/25**, TS7 strict verde no
  checkpoint.

---

## Faixa D — ProcessInfra e ApplicationInfraHost

### D.1 — tornar process scope real

- [x] Criar `ApplicationInfraHost` process-owned em `boot/application-infra-host.js`; a factory é
      isoladamente testável e não cria estado global por si própria.
- [x] Fazer produção criar InfraRuntime por `ProcessInfra`, não diretamente por module singleton:
      `application-infra.js` tornou-se façade fina sobre
      `ApplicationInfraHost → ProcessInfra → InfraRuntime`.
- [x] Mover bootstrap SQLite/process resources para o host: coalescing do bootstrap, provider
      binding e proteção bootstrap-vs-dispose pertencem ao host.
- [x] Registrar shutdown uma vez no host: processo fresco confirma exatamente um
      `copilot.application-infra.dispose`, prioridade `APPLICATION_INFRA=13`, timeout 30 s, anterior
      ao fechamento do DB.
- [x] Expor identities/generation em snapshot: host/process/runtime/workspace publicam identidade e
      generations monotônicas; runtime explícito de produção nasce como generation 1.

**Evidência D.1:** `test_application_infra_host` + bootstrap SQLite + composition scopes =
**21/21**; processo fresco confirmou
`copilot-application-host → copilot-application-process → copilot-application`, generation 1/1 e um
único shutdown handler; TS7 strict verde.

### D.2 — hierarchical ownership

- [x] Escolher deregistration callback para `WorkspaceInfra`, preservando uso standalone legítimo e
      evitando parent cache stale.
- [x] Aplicar o mesmo invariant a `ProcessInfra→InfraRuntime`.
- [x] Impedir parent de retornar child disposed ou `disposing`; recreate só ocorre após dispose
      concluído.
- [x] Definir recreate/new generation: cada child efetivamente criado recebe generation monotônica;
      IDs de workspace incluem a generation e não são reciclados.
- [x] Adicionar causal tests para stale-child, recreate, duplicate runtime preflight e teardown
      hierárquico.

Correção adjacente: duplicate runtime ID agora é rejeitado **antes** de construir o segundo
`InfraRuntime`, eliminando a possibilidade de recursos órfãos por validação tardia.

### D.3 — explicit resource management

- [x] `[Symbol.asyncDispose]` aplicado onde ownership lexical é natural: scope handles já eram
      generation-bound; `InfraRuntime` e `ApplicationInfraHost` agora reutilizam exatamente a mesma
      função/Promise idempotente de `.dispose()`.
- [x] `using`/`await using` **não** foi introduzido em singleton/process root long-lived apenas por
      estilo; explicit resource management fica disponível para owners lexicais sem criar um
      lifecycle concorrente.

**Evidência D.3:** `test_application_infra_host` 5/5 e `test_infra_composition_scopes` 16/16; os
testes provam identidade da Promise `asyncDispose === dispose` em efeito e teardown final
hierárquico.

**Gate da Faixa D**

- [x] um único process root governa o runtime canônico da aplicação; o único `createInfraRuntime()`
      operacional residual estava no worker isolado de benchmark e foi migrado para `ProcessInfra`
      nesta faixa;
- [x] nenhum child morto permanece reutilizável via parent.

**Correção causal adicional — benchmark IO cache:** o worker construía `InfraRuntime` em module-load
antes de definir `IO_L2_CACHE_PROFILE`, portanto podia medir L2 com config capturada incorretamente.
O worker agora faz `parse/config → ProcessInfra → InfraRuntime`, não materializa runtime no import e
desmonta pelo process root. Prova dirigida no mesmo DB isolado: `l2-prime` = **5/5 `l1-miss`, 61,474
ms**; novo processo `l2` = **5/5 `l2-hit`, 16,904 ms**, com zero recomputações de hash; artefato
temporário removido.

---

## Faixa E — config ownership total

### E.1 — schema de config por scope

- [x] Criar/fechar `ProcessInfraConfig`.
- [x] Expandir `InfraRuntimeConfig` para index scanner/build/refresh.
- [x] Criar `WorkspaceInfraConfig` para scopes/watch/index context.
- [x] Classificar cada env key de Infra por owner scope.
- [x] Remover `processExecutionDefaults` ornamental: nenhum runtime consumia o campo; manter
      configuração nominal seria ownership falso.
- [x] Agrupar search process config em `search.{budget,subprocess}` e ativá-lo pela mesma generation
      token-bound.

### E.2 — eliminar reads ambientais inferiores

- [x] `IO_MAX_ACTIVE_SCOPES` deixa de ser lido no scope state.
- [x] scanner defaults deixam module-load env.
- [x] index build max files deixa module-load env.
- [x] index refresh concurrency deixa operation-time env.
- [x] parser process policy passa a ProcessInfraConfig.
- [x] lock warn threshold passa a process config.
- [x] path-policy cache config passa a process config.
- [x] search budgets recebem defaults resolvidos, sem env escondido/first-use ambiental.
- [x] L1/L2/read/invalidation/advisory/index config resolvers inferiores usam snapshots explícitos
      ou defaults puros; `readEnv*` exige argumento `env`.
- [x] SQLite L2 não captura TTL/max/min no module-load.
- [x] search subprocess deixa de herdar ambiente global implicitamente: `spawn.env` é sempre
      explícito; named executables sem env recebem `ERR_SEARCH_SUBPROCESS_ENV_REQUIRED`.
- [x] ripgrep availability deixa singleton booleano sem generation e passa a lease/process owner com
      probe memoizado por owner.

### E.3 — config immutability tests

- [x] construir host/runtime com env A;
- [x] alterar `process.env` para B;
- [x] materializar capabilities lazy de runtime/workspace/index/search policies;
- [x] provar que todas permanecem em A;
- [x] provar que nova generation criada explicitamente com B recebe B.
- [x] provar que PATH/search subprocess da generation A continua A após live env mutation e volta a
      fallback determinístico após dispose.

**Gate da Faixa E — FECHADO em 2026-08-22**

- [x] zero operational `process.env` reads abaixo do process composition root em
      `src/copilot/infra/**`.
- [x] zero chamadas `readEnv*` sem snapshot explícito.
- [x] zero herança ambiental implícita em search subprocess named execution.
- [x] governance `test_infra_barrel_governance.spec.js`: 25/25 verde após ratchet para um único
      touchpoint.
- [x] `test_infra_config_ownership.spec.js`, `test_io_search_subprocess.spec.js` e
      `test_io_engine.spec.js` verdes.
- [x] `npm run typecheck:strict:src.copilot` verde e `npm run typecheck:strict:tests.unit` verde
      após o fechamento.

---

## Faixa F — scoped observability e health — **FECHADA em 2026-08-22**

### F.1 — probe contracts

- [x] Definir scope probe com `scope`, `ownerId`, `runtimeOwnerId`, `probeId`, `snapshot`,
      `mayMaterialize:false`.
- [x] Evitar registry processual genérico ornamental: process health consulta owners reais e
      autentica cada facet por `processId`.
- [x] Criar runtime/workspace aggregation owner-bound; seleção de probe ocorre antes de
      `snapshot()`.

### F.2 — retirar mistura de scopes

- [x] locks saem do runtime health e entram em process health.
- [x] path-policy cache process-global sai do runtime health.
- [x] authority counters tornam-se por authority/workspace, mantendo aggregate lifetime apenas em
      process diagnostics.
- [x] scope probes ficam vinculados ao runtime/workspace owner.
- [x] public observability é separada por lifecycle em runtime e process micro-entrypoints.
- [x] MCP runtime health consome ambos os scopes sem recolocar process state dentro de `ioCache`.

### F.3 — non-materialization invariant

- [x] causal test: health não cria L2.
- [x] não cria index store.
- [x] não inicia parser worker pool.
- [x] não registra watcher/hook nem lazy workspace capability.
- [x] não cria scope runtime/probe.
- [x] não altera timers de L2/index/invalidation nem inicia cross-process polling.
- [x] não inicia/memoiza probe de ripgrep.

Prova: `test_io_health_non_materialization.spec.js` captura flags dos owners antes/depois de duas
leituras consecutivas de runtime + process health e exige igualdade integral. L2/index/cross-process
permanecem configuráveis/habilitados, porém não materializados sem uso/provider.

### F.4 — degraded state útil

- [x] retry exhaustion do index scheduler (`autoRefresh.exhausted`) gera
      `IO_INDEX_AUTO_REFRESH_EXHAUSTED` e `status:'degraded'` no runtime health.
- [x] pending persistente além do orçamento temporal derivado da própria policy de
      debounce/backoff/retry gera `IO_INDEX_AUTO_REFRESH_STALE_PENDING`, sem nova env e sem expor
      paths; `maxPendingAgeMs` preserva high-water após convergência.
- [x] payloads de watcher são bounded (`sample` máximo 20) e sem roots/paths/lastError.
- [x] `console.debug` residual do L2 foi removido; prune positivo publica telemetry estruturada
      `cache/l2.pruned` com `{ runtimeId, removed }`.
- [x] MCP promove alertas runtime e process para warnings/critical, conforme severity.

**Gate da Faixa F — FECHADO em 2026-08-22**

- [x] runtime A health não muda quando somente runtime B trabalha — prova integral em
      `test_io_health_scope_ownership.spec.js`.
- [x] `test_io_health_non_materialization.spec.js`, `test_io_observability_bounds.spec.js`,
      `test_io_index_registry.spec.js` e `test_mcp_runtime_metrics.spec.js` verdes.
- [x] governance `test_infra_barrel_governance.spec.js`: 25/25 verde após novo micro-entrypoint e
      baseline versionado.
- [x] `npm run typecheck:strict:src.copilot` verde após o fechamento.

---

## Faixa G — Core/Infra contracts e micro-entrypoints

### G.1 — exact semantic aliases — FECHADO em 2026-08-22

- [x] Definidos aliases semânticos exatos de Core em
      `config/architecture/copilot-core-import-boundaries.json`; o consumo real, o manifesto e
      `package.json#imports` são comparados por contrato.
- [x] `#copilot/core/*` foi removido; arbitrary deep import e o alias redundante
      `#copilot/core/index` não existem mais.
- [x] Os 34 imports runtime do mega-root `#copilot/core` encontrados em Infra foram migrados para
      micro-surfaces semânticas.
- [x] `test_core_import_governance.spec.js` impede wildcard, aliases órfãos/não usados e regressão
      do boundary.

### G.2 — ownership conceitual — FECHADO em 2026-08-22

- [x] `core/io-contracts.js` permanece Core: contrato puro, pequeno e independente de filesystem.
- [x] `core/io-policy.js` deixou de possuir path/filesystem authority; caiu de aproximadamente 23,2
      KiB para 4,45 KiB e contém apenas URL policy, advisory limits e sanitização.
- [x] Path policy lexical/versionada migrou para `infra/policy/workspace-path.js`; canonicalização
      física, symlink safety, nearest-existing-ancestor e cache processual pertencem a
      `infra/filesystem/workspace/path-policy/`.
- [x] SDK session FS, shell, presentation e server routes reutilizam `WorkspaceInfra.authority`; não
      foi criado raw-path evaluator público nem shim no Core.
- [x] Novo invariant de Core impede `node:fs`, `node:path`, `process.cwd/env`, `realpath()` e
      path-authority exports de regressarem a `core/io-policy.js`.

### G.3 — cost evidence — FECHADO em 2026-08-22

- [x] Medição cold-import em 15 processos Node isolados por entrypoint:
  - `#copilot/infra/public/composition/filesystem/configured`: mediana **8,271 ms**, p90 **11,197
    ms**, RSS mediano **58,04 MiB**;
  - `#copilot/infra/public/policy`: **10,514 ms**, p90 **11,772 ms**, RSS **58,50 MiB**;
  - `#copilot/core/io-policy`: **3,046 ms**, p90 **3,863 ms**, RSS **56,79 MiB**;
  - `#copilot/infra/public/diagnostic/indexing/scanner`: **130,571 ms**, p90 **132,438 ms**, RSS
    **120,13 MiB**;
  - `#copilot/infra/public/observability/process`: **124,357 ms**, p90 **128,763 ms**, RSS **119,87
    MiB**;
  - `#copilot/infra/public/operations`: **130,659 ms**, p90 **134,317 ms**, RSS **119,90 MiB**;
  - `#copilot/infra/public/composition/runtime`: **200,347 ms**, p90 **211,033 ms**, RSS **133,34
    MiB**.
- [x] Evidência confirma separação de custo: micro-surfaces pequenas não carregam os closures de
      scanner/operations/runtime.
- [x] Ratchets afetados pela nova path policy foram rebaselinados somente após medir o closure real,
      com ~1,5x de headroom: workspace/indexing 107 módulos / 406.709 bytes → limites 161 / 610.064;
      scanner diagnostic 105 / 398.445 → 158 / 597.668.

**Gate da Faixa G — FECHADO em 2026-08-22**

- [x] nenhum mega-root import é exigido por governance; Core exact-import governance e Infra
      governance estão verdes.

---

## Faixa H — SQLitePort e adapter isolation

### H.1 — structural ports — FECHADO em 2026-08-22

- [x] Inventário real reduz o contrato de Infra a DB `exec/prepare/transaction`, Statement
      `get/all/run` e RunResult `changes/lastInsertRowid`.
- [x] `infra/database/port/contract.js` define somente `SqliteDatabasePort`, `SqliteStatementPort`,
      `SqliteRunResultPort` e provider/read projections estruturais; não contém lifecycle, driver
      nem política transacional.
- [x] Política transacional possui owners semânticos separados em
      `database/transaction/{atomic,optional,required}`: `runSqliteTransaction`,
      `runSqliteTransactionOrDirect` e `runRequiredSqliteTransaction` não compartilham mais um
      aggregate hot-path.
- [x] Removidos todos os `import('better-sqlite3').Database` dos contratos de Infra;
      `test_sqlite_port_governance.spec.js` ratcheta a ausência do driver concreto.
- [x] L2, index registry e cross-process invalidation dependem do port canônico; replay exige
      transaction, enquanto owners cujo contrato histórico permite fallback usam
      `runSqliteTransactionOrDirect` explicitamente.
- [x] Mini-ports frouxos `prepare/exec/transaction: Function` foram eliminados. A troca de `any`
      implícito por `unknown` revelou 12 projeções de row antes não tipadas; elas agora são locais e
      correspondem ao SELECT que as produz.
- [x] Adapter concreto `infra/database/sqlite/better-sqlite3/adapter.js` projeta o driver default no
      port estrutural, confinando a tipagem específica de `better-sqlite3` ao boundary do adapter.
- [x] O primeiro fechamento do port mediu replay em 6 módulos / 11.190 bytes. A decomposição final
      por transaction policy reduziu-o para **5 módulos / 6.780 bytes**, sem elevar o ratchet
      existente; o runtime SQLite público ficou em **3 módulos / 2.147 bytes**.

### H.2 — default adapter/lifecycle — FECHADO em 2026-08-22

- [x] O runtime concreto default foi transferido para
      `infra/database/sqlite/better-sqlite3/runtime.js`: não lê `process.env`, não resolve paths,
      não cria diretórios e não registra signal/exit/shutdown handlers.
- [x] `createBetterSqliteApplicationRuntime({dbPath})` cria resources isoladas e instance-owned; não
      existe mais configuração, getter, status ou close application-global. Disposal é terminal e
      acessos posteriores falham com `ERR_INFRA_SQLITE_RESOURCE_DISPOSED`.
- [x] `ApplicationInfraHost` captura `COPILOT_DB_PATH`/workspace uma vez por geração, prepara o
      diretório no composition root e materializa a resource por
      `#copilot/infra/public/composition/database/sqlite`; esse seam é `configured-bound` e faz
      lazy-load do driver default interno antes de expor somente o port estrutural a Infra.
- [x] O host é o único owner de graceful shutdown da conexão default: consumers são desmontados,
      `runtime.database.reset()` revoga o provider e só então a resource SQLite é disposta; uma
      referência antiga não pode reabrir a conexão após teardown.
- [x] A árvore `src/copilot/db`, seus barrels e aliases `#copilot/db*` foram removidos
      integralmente, sem shim de compatibilidade. `ensureCopilotDbDir`, `resolveCopilotDbPath`,
      `getCopilotDb*`, `configureCopilotSqliteRuntime` e `closeCopilotDb` não existem mais.
- [x] Benchmark/multiprocess tests usam runtimes SQLite isolados explícitos em vez de mutar
      `COPILOT_DB_PATH` para retargetar singleton.
- [x] Provas verdes: `test_sqlite_better_runtime`, `test_sqlite_better_runtime_logger`,
      `test_sqlite_application_schema`, `test_application_infra_sqlite_bootstrap`,
      `test_application_infra_host`, `test_io_cache_l2_multiprocess`,
      `test_sqlite_lifecycle_governance`, `test_sqlite_port_governance` e TS7 strict.

### H.3 — `node:sqlite` experimental — FECHADO em 2026-08-22

- [x] Adapter experimental implementado em `infra/database/sqlite/node-sqlite/runtime.js`, fora do
      bootstrap default. `DatabaseSync` recebe o port estrutural diretamente; a única capability
      ausente (`transaction`) é composta com `BEGIN IMMEDIATE` + SAVEPOINTs aninhados, sem proxy de
      statement/row.
- [x] Parity funcional demonstrada contra `better-sqlite3`: positional/named bindings, nested
      transaction/rollback, `changes/lastInsertRowid`, schema/migrations completos, FTS via index
      real, L2, cross-process invalidation, backup e pragmas canônicos.
- [x] Busy/lock parity em duas conexões file-backed: ambos honram `busy_timeout` e liberam escrita
      após rollback. Diferença de erro é explícita e testada: `better-sqlite3` usa
      `code:'SQLITE_BUSY'`; `node:sqlite` usa `code:'ERR_SQLITE_ERROR'` + `errcode:5`.
- [x] Harness reproduzível `npm run copilot:sqlite:benchmark` mede cold import/open, transações, L2
      write/read, index build/search e invalidation publish usando apenas boundaries públicos de
      composição.
- [x] Evidência final no Node **v24.15.0**, 7 amostras + 1 warmup e 12 cold imports, workload 4.000
      inserts transacionais / 1.200 rows L2 de 4 KiB / 180 arquivos indexados / 240 buscas / 800
      invalidations:
  - cold import mediano: `better-sqlite3` **4,670 ms**, `node:sqlite` **0,190 ms**; RSS mediano
    **56,902 MiB** vs **55,691 MiB**;
  - open+migrations: **44,469 ms** vs **47,837 ms** (`node:sqlite` +7,57%);
  - SQL transaction: **5,739 ms** vs **3,397 ms** (`node:sqlite` -40,81%);
  - L2 write: **203,206 ms** vs **186,299 ms** (-8,32%); L2 read: **21,223 ms** vs **30,180 ms**
    (**+42,20%**);
  - index build: **430,702 ms** vs **406,937 ms** (-5,52%); index search: **69,050 ms** vs **70,178
    ms** (+1,63%);
  - invalidation publish: **243,445 ms** vs **230,651 ms** (-5,26%).
- [x] Versões SQLite diferem no ambiente medido: `better-sqlite3` **3.53.4** vs Node bundled
      **3.51.3**. A troca de driver não é semanticamente neutra em engine/error surface.
- [x] Decisão: **manter `better-sqlite3` como default e `node:sqlite` como adapter experimental
      validado**. O ganho de cold-load e writes não compensa ainda a regressão material de L2 read,
      a pequena regressão de open/search, a engine SQLite mais antiga e a diferença de error
      surface. Qualquer promoção futura exige novo benchmark/parity e mudança explícita do
      bootstrap; governance impede promoção implícita.

### H.4 — complete database ownership relocation — FECHADO em 2026-08-22

- [x] `src/copilot/db` foi transferido/decomposto integralmente para owners de Infra e removido do
      filesystem; não existe pasta vazia, barrel de transição, alias legado, shim ou compat layer.
- [x] `infra/database` tornou-se owner único de port, provider binding, transaction primitive,
      pragmas, driver adapters/runtime e application migration engine.
- [x] O schema do IO Index foi movido para `infra/indexing/registry/sqlite/schema/service.js`, seu
      owner natural.
- [x] O schema físico do Model Gateway foi movido para Infra e exposto por micro-entrypoint puro,
      eliminando a antiga seta `db/migrations → model-gateway` e preservando `infra/database` sem
      dependências ascendentes.
- [x] `SqliteModelGatewayCatalogStore`, Conversation Hub, Todo, MCP persistence/OAuth/analytics e
      Observability deixaram de conhecer driver/path global e passaram a consumir
      `SqliteDatabasePort`/application-owned capability.
- [x] Os comandos Model Gateway que realmente usam SQLite ganharam bootstrap explícito
      compartilhado; comandos que não usam persistência não pagam abertura de DB.
- [x] A migração revelou e corrigiu resurrection-after-dispose: o host revoga o provider e as
      resources SQLite possuem disposal terminal, com parity explícita de lifecycle entre os dois
      adapters.
- [x] A membrane SQLite é separada por audience, sem authority implícita: runtime usa
      `#copilot/infra/public/database/sqlite` (atomic transaction + structural types, sem raw-path)
      e o schema puro do Model Gateway; composition possui factory `configured-bound` explícita;
      diagnostic e test possuem concrete resource helpers exclusivamente sob authorities
      `diagnostic-only` e `test-only`, respectivamente.
- [x] Production governance proíbe imports de surfaces `diagnostic`/`test`; o default driver
      continua lazy e interno à composition, portanto a existência desses seams não cria rota
      runtime alternativa.
- [x] Aggregates/marker barrels `infra/database/index.js` e `infra/database/transaction/index.js`,
      bem como os aliases internos correspondentes, foram removidos após a decomposição. Consumers
      usam exclusivamente `database/port`, `database/provider` e
      `database/transaction/{atomic,optional,required}`.
- [x] Contract governance ratcheta ausência de `src/copilot/db`, ausência de `#copilot/db*`,
      ausência de service locator global e proíbe
      `infra/database → model-gateway|mcp|tools|conversation-hub|observability`.
- [x] Evidência dirigida pós-migração: DB/boot/Todo 119/119; Conversation Hub 117/117; MCP 93/93;
      Model Gateway contract 229/229; SQLite parity/IO 43/43; TS7 strict e lint verdes.
- [x] Onda final de seams/audiences: barrel/SQLite/boot contracts **43/43**, static-cost sem
      violações, authority metadata/signatures sem violações, TS7 strict escopado verde em
      `src.copilot`, `scripts.analysis` e `tests.unit`.
- [x] Closures finais dos novos seams: composition DB **3 módulos / 1.010 bytes**; diagnostic DB
      **48 / 250.482**; testing DB **48 / 250.664**; testing index-schema **6 / 13.410**. Baselines
      novas foram congeladas somente após essa decomposição final, com headroom nominal de 1,5x.

**Gate da Faixa H — FECHADO em 2026-08-22**

- [x] Infra contracts são driver-agnostic e ratcheted por teste.
- [x] Lifecycle do default possui owner único no application composition root.
- [x] Adapter alternativo possui parity e benchmark reproduzíveis sem contaminar o provider default.

---

## Faixa I — platform/process consolidation

### I.1 — executable resolver — FECHADO em 2026-08-22

- [x] Consolidada a descoberta duplicada de executáveis de terminal, Secure MCP Tunnel e code-tools
      em `infra/platform/process/executable`.
- [x] `resolveExecutable(command,{env,cwd?,candidates?,platform?})` é síncrono, stateless, sem
      shell/subprocesso e sem leitura de `process.env`; candidatos explícitos precedem direct
      command path e PATH.
- [x] Provenance explícita no resultado frozen:
      `source:'candidate'|'command-path'|'path'|'not-found'`, `candidateIndex`, `pathEntryIndex`,
      `extension`, `candidatesChecked` e `searchedPathEntries`.
- [x] POSIX exige arquivo + `X_OK`; Windows usa existência de arquivo + `PATHEXT`, com suporte a
      `PATH`/`Path`/`path` e casing de `PATHEXT`.
- [x] `code-tools` removeu `execFileSync('which',...)`: ESLint local é candidato prioritário e
      fallback PATH não abre processo auxiliar.
- [x] Terminal executa `--version` pelo path já resolvido; Secure Tunnel preserva redaction
      `*/tunnel-client` e não expõe o path absoluto retornado pela primitive.
- [x] Micro-surface pública `#copilot/infra/public/platform/process/executable` ratcheted em **3
      módulos / 8.655 bytes**, teto **5 / 12.983**, sem packages externos.
- [x] Governance proíbe a volta das três implementações paralelas e garante que o resolver canônico
      não importe `child_process` nem leia env ambiente.
- [x] Evidência: resolver 5/5, terminal capabilities verde, Secure Tunnel verde, code-tools verde,
      executable governance verde, infra barrel governance **25/25** e TS7 strict verde.

### I.2 — process special capabilities — FECHADO em 2026-08-22

- [x] `/proc/<pid>/cmdline` movido de `mcp/control-plane` para
      `infra/platform/process/introspection`; o antigo arquivo foi removido fisicamente, sem
      shim/reexport legado.
- [x] `readLinuxProcessArgv(pid,{maxBytes?})` permanece PID-only, Linux-only, `O_NOFOLLOW`, bounded
      (64 KiB default / 256 KiB hard max) e torna truncation explícita para callers fail-closed.
- [x] Métricas cgroup v2 (`memory.current`, `memory.max`, `memory.events`) deixaram de ser
      `ConfiguredFsIo`: pseudo-files são paths privados da capability processual, lidos com
      `O_NOFOLLOW` e teto de 16 KiB, fail-soft quando indisponíveis.
- [x] `readProcessResourceSnapshot()` concentra RSS, memória/loads do host, parallelism e cgroup;
      MCP jobs conserva somente a projeção validator-specific
      `processRssBytes → mcpProcessRssBytes`.
- [x] Removido grant `mcp.control-plane.jobs.cgroup` de `copilot-configured-fs-grants.json`;
      artifacts e focused-test stat continuam capabilities filesystem independentes.
- [x] Public surface `#copilot/infra/public/platform/process/introspection` não aceita path
      arbitrário e não expõe parsers cgroup internos.
- [x] Boot workspace discovery foi revisado e deliberadamente **mantido em `boot/workspace.js`**:
      decide workspace/Git de inicialização da aplicação, portanto mover para process introspection
      não melhoraria ownership.
- [x] Evidência: argv introspection verde, resource introspection verde, MCP jobs verde,
      process-introspection governance verde, configured-FS governance verde, infra barrel
      governance **25/25** e TS7 strict verde.

### I.3 — Node 24 upgrades seletivos — FECHADO em 2026-08-22

- [x] Permission Model avaliado somente contra runner delimitado: o Vitest real exige
      `--allow-child-process`, `--allow-worker` e `--allow-addons` — permissões para as quais o
      próprio Node emite warnings de que podem invalidar a contenção — além de escrita em
      `node_modules/.vite-temp` e leitura de bootstrap do editor fora do workspace. **Decisão:** não
      habilitar no safe-suite/validator principal; reavaliar apenas para worker hermético sem
      addons/workers/child-process.
- [x] `fs.globSync` avaliado separadamente no corpus CI real. No padrão dos gates de filesystem,
      Node 24.15.0 produziu conjunto idêntico de **1.708 arquivos**, mas mediana de **100,51 ms**
      contra **55,85 ms** do pacote `glob` em 20 iterações (~80% mais lento). Como `glob` continua
      utilizado por analysis/tests, não há remoção de dependência que compense a regressão.
      **Decisão:** manter `glob` nos scripts CI atuais.
- [x] Compile-cache preserva ativação precoce no launcher, mas a policy agora é adotada pelo
      `ProcessInfra` via token processual: config divergente gera
      `ERR_NODE_COMPILE_CACHE_CONFIG_MISMATCH`, owner concorrente gera
      `ERR_NODE_COMPILE_CACHE_OWNER_ACTIVE`, e ProcessInfra standalone sem early activation
      permanece `not-activated` — nunca habilita a otimização tardiamente.
- [x] Process health projeta compile-cache somente quando o owner `processId` coincide; MCP runtime
      health deixou de ler o singleton diretamente.
- [x] A façade histórica `mcp/runtime/node-compile-cache.js` foi removida fisicamente; safe
      validation e launchers consomem `#copilot/infra/public/platform/node` diretamente.
- [x] Ratchet `test_node_compile_cache_governance.spec.js` impede retorno do shim, exposição pública
      do owner interno ou leitura ambiental na foundation; `test_node_compile_cache.spec.js` prova
      adoption/mismatch/owner concorrente/no-late-enable.

**Gate da Faixa I — FECHADO em 2026-08-22**

- [x] executable resolver, process introspection e compile-cache ownership têm owners únicos e
      governance causal.
- [x] upgrades Node 24 foram adotados ou rejeitados por evidência concreta, sem migração por
      novidade nominal.

---

## Faixa J — public API simplification e documentation truth — FECHADA em 2026-08-22

### J.1 — aliases sem consumer — FECHADO

- [x] Reavaliados `composition/operation`, `composition/workspace/instance`, `concurrency/locks` e
      `filesystem/read` por consumer real, não por presença histórica no package map.
- [x] Removidos **4 aliases públicos** e seus entries de semantic manifest/cost baseline:
      `composition/operation`, `composition/workspace/instance`, `concurrency/locks`,
      `filesystem/read`.
- [x] `createInfraOperationContext` não possuía use case de produção e foi removido fisicamente,
      inclusive do barrel interno de composition; nenhum shim/reexport ficou ativo.
- [x] `createWorkspaceInfra` continua necessário como owner interno de `InfraRuntime`, mas o
      construtor público foi removido; testes passam a obter `WorkspaceInfra` por
      `runtime.workspace(...)`, preservando owner/lifecycle corretos.
- [x] Raw `filesystem/read` deixou de ser runtime public surface; `ci-gate`, `io-read-benchmark` e
      workload L2, que são diagnóstico/análise, usam o alias interno já existente em vez de criar
      uma nova API pública.
- [x] `composition/process` já estava integrado ao production root em
      `boot/application-infra-host.js`; não havia razão arquitetural para removê-lo.
- [x] Evidência: composition scopes verde, nenhuma referência ativa aos quatro aliases removidos e
      TS7 strict verde após J.1/J.2.

### J.2 — barrels vazios — FECHADO

- [x] Governance deixou de exigir `index.js` em todo diretório de namespace; agora exige uma
      **bijeção exata** entre aliases `#copilot/infra/public/...` e `public/**/index.js` reais.
- [x] Removidos fisicamente **13 marker/namespace barrels** sem alias e sem incoming import:
      `cache`, `composition`, `composition/filesystem`, `composition/workspace`, `concurrency`,
      `diagnostic`, `diagnostic/indexing`, `filesystem`, `filesystem/invalidation`, `indexing`,
      `persistence`, `platform` e `platform/process`.
- [x] Mega-barrel `public/index.js` continua proibido; um diretório pode organizar child entrypoints
      sem adquirir barrel próprio.
- [x] Evidência: `test_infra_barrel_governance.spec.js` **25/25 verde** após a remoção física dos
      markers.

### J.3 — docs derivadas — FECHADO

- [x] `governance/architecture-manifest.js` reconciliado: remove `OperationContext`, remove a antiga
      boundary `filesystem/trusted` e descreve `public/` como projection entrypoints declarados, não
      barrel por diretório.
- [x] `infra/README.md` e `infra/public/README.md` deixaram de manter listas manuais obsoletas;
      documentam package-map, semantic manifest, audiences e a bijeção aliases ↔ projection barrels.
- [x] Criado `scripts/analysis/infra-public-api-reference.mjs`, que usa somente
      `#copilot/infra/public/diagnostic/governance` e gera deterministicamente
      `infra/public/API_REFERENCE.md` a partir de `INFRA_PUBLIC_API_MANIFEST` + static closure
      corrente.
- [x] `API_REFERENCE.md` contém atualmente **41 entrypoints governados**, com audience, privilege,
      path authority, lifecycle, stability, cost tier, módulos, source bytes, dependências externas,
      cold-import evidence e exports.
- [x] Adicionados `copilot:infra:public-api-docs` e `copilot:infra:public-api-docs:check`;
      `copilot:architecture:check` agora falha quando a referência gerada está stale.
- [x] Documento 2.0 marcado explicitamente como **ledger histórico**, não live inventory; o
      documento 2.1 + manifests/gates executáveis são o estado corrente.
- [x] Evidência: `npm run -s copilot:architecture:check` verde, incluindo public API cost sem
      violações, mutable-state governance sem undeclared/stale scopes e
      `Infra public API reference: OK`.

### J.4 — exact package-map e audiences — FECHADO em 2026-08-22

- [x] O wildcard residual de `package.json#imports` foi eliminado em todo `#copilot/**`; resolução
      interna agora é exclusivamente por aliases exatos.
- [x] Criado parser AST compartilhado `scripts/lib/copilot-package-imports.mjs`, cobrindo imports,
      reexports, dynamic imports, mocks e JSDoc `import()` sem confundir strings/fixtures com uso
      semântico.
- [x] A cobertura foi ampliada de `src/copilot` para todo o workspace executável em `src/`,
      `tests/`, `scripts/` e `tools/`: checkpoint corrente **3.226 arquivos escaneados / 3.210 usos
      / 227 specifiers únicos**, zero non-exact, zero wildcard e zero parse error.
- [x] White-box leaf access foi separado para `#copilot/testing/**`: **45 aliases test-only**, todos
      com consumer em `tests/` e zero uso em `src/`, `scripts/` ou `tools/`.
- [x] A auditoria inversa `alias → propósito` removeu aliases preventivos/mortos, inclusive **20
      aliases barrel sem consumer** de Agent/Presentation/Terminal e quatro leaf aliases órfãos de
      Hooks/Observability. A mera presença de `index.js` não justifica package surface.
- [x] Um alias sem consumer só pode permanecer quando pertence a manifest arquitetural explícito; no
      checkpoint corrente o único caso é um diagnostic entrypoint de Infra já governado por
      `INFRA_PUBLIC_API_MANIFEST`.
- [x] `arch-health` deixou de usar heurística de mega-barrel/deep-import por regex: mede boundary
      coverage deliberada, exact package imports, mutabilidade real de module scope, fan-out e o
      checker global canônico. Estado corrente: **24/24 boundaries**, zero hard/soft findings e
      **96/A** (fan-out máximo 15 continua penalizado em vez de ser mascarado).
- [x] SDK ganhou policy executável derivada de `SDK_LAYER_ACCESS_POLICY`; root `#copilot/sdk` ficou
      restrito a **um único dynamic import**, no boot validation path. `#copilot/sdk/http-request`
      foi promovido como micro-surface bounded em vez de manter root import em Tools.
- [x] As **17 surfaces SDK** agora formam tríplice convergência exata entre `SDK_ALIAS_LAYOUT`,
      `package.json#imports` e `package.json#exports`, inclusive target físico idêntico.
- [x] Criado gate CI `scripts/ci/check-copilot-package-imports.mjs`, integrado a
      `copilot:architecture:check`; ele valida targets físicos, exactness, audiences, aliases órfãos
      e convergência SDK imports/exports/layout.
- [x] O antigo F33 baseado em `grep` + allowlists por arquivo foi substituído por contract derivado
      do parser/package-map/policy, removendo autoridade paralela e detectando drift real de
      `agent`/SDK durante a migração.

**Evidência localizada:** package-import gate verde; package/SDK contracts **5/5 verdes** após a
migração; TS7/lint da onda são validados no checkpoint M antes do fechamento final.

---

### J.5 — dependency graph acíclico e lifecycle MCP — FECHADO em 2026-08-22

- [x] Auditoria do grafo de `src` encontrou **1 SCC circular com 27 módulos** concentrado em
      `mcp/control-plane`, `mcp/tools`, `mcp/cloudflare` e `mcp/connection`, apesar de zero imports
      locais não resolvidos e zero parse errors.
- [x] O menor ciclo era
      `control-plane/index → startup-maintenance → tools/llm-b-live → control-plane/index`. Causa:
      `startup-maintenance.js` era lifecycle/composition, mas vivia e era reexportado pelo barrel de
      contratos do control-plane.
- [x] `startup-maintenance.js` foi movido fisicamente para `mcp/runtime/startup-maintenance.js`, sem
      shim/reexport legado; adapters/runtime-health consomem o owner novo e testes white-box usam
      `#copilot/testing/mcp/runtime/startup-maintenance`.
- [x] `control-plane/index.js` deixou de depender de qualquer tool/cloudflare por esse caminho; a
      mudança de ownership removeu o SCC inteiro sem criar micro-aliases de produção artificiais.
- [x] Criado `scripts/ci/check-copilot-dependency-graph.mjs`, integrado a
      `copilot:architecture:check`, que falha em ciclos, unresolved local/package imports ou parse
      errors. `orphanCandidates` permanece informativo porque launchers/workers/entrypoints são
      roots legítimos.
- [x] Estado após a correção: **2.018 arquivos / 5.602 edges / 0 ciclos / 0 unresolved / 0 parse
      errors** em `src`; `tests` e `scripts` também apresentaram zero unresolved/parse errors/ciclos
      no checkpoint de auditoria.
- [x] Evidência causal: TS7 strict `src.copilot`, `scripts.root` e `tests.unit` verdes; startup
      maintenance/runtime metrics/dependency graph/package imports **9/9 verdes**.

---

---

## Faixa K — index/context quality sem reabrir ownership já resolvido — FECHADA em 2026-08-22

### K.1 — scope handle — FECHADO

- [x] `declareScope()` retorna handle explícito, frozen e lifecycle-aware com `awaitReady`,
      `refresh`, `snapshot`, `close` e `Symbol.asyncDispose`.
- [x] `sessionId` permanece identidade lógica; ownership pertence à geração concreta capturada pelo
      handle. Redeclaração com o mesmo id invalida handles antigos, que não podem operar nem
      descartar a geração nova.
- [x] MCP `repo_working_set` possui o handle diretamente e não reconstrói lifecycle/authority a
      partir de strings.
- [x] Provas: `test_io_session_scope.spec.js` cobre redeclaração, stale handle e async disposal;
      `test_mcp_repo_working_set.spec.js` cobre ownership no boundary MCP.

### K.2 — retry health — FECHADO

- [x] Retry bounded/backoff/jitter/exhaustion existentes foram preservados; nenhum scheduler
      paralelo foi criado.
- [x] Pending persistentemente stale é classificado por `staleAfterMs` derivado da policy de
      debounce + retry, sem nova variável de ambiente nem threshold arbitrário independente.
- [x] `autoRefresh` expõe `stalePending`, `oldestPendingAgeMs`, `staleAfterMs` e `maxPendingAgeMs`;
      o high-water permanece observável após recuperação.
- [x] Runtime health converte exhaustion e stale-pending em sinais owner-bound
      `IO_INDEX_AUTO_REFRESH_EXHAUSTED` e `IO_INDEX_AUTO_REFRESH_STALE_PENDING`, sem paths em claro.
- [x] Provas: `test_io_index_registry.spec.js` e `test_io_observability_bounds.spec.js` verdes.

### K.3 — config injection — FECHADO

- [x] Persistent build, path refresh e `WorkspaceIndexing.scanDirectory()` já consumiam
      `InfraRuntimeConfig.index`; o último fallback ambiental indireto estava no scan interno de
      `declareScope({directory})`.
- [x] `indexRuntimeConfig.scanner` agora é projetado estreitamente como
      `{batchSize, hardMaxEntries}` para
      `WorkspaceScopeRuntime → ScopeRuntimeState → warmFromDirectory → scanDirectory`, sem fazer
      context depender do registry config inteiro.
- [x] A policy é generation-owned: runtime/workspace A mantém sua scanner policy mesmo quando
      `process.env` muda antes da materialização lazy; somente uma nova geração explícita B captura
      os novos valores.
- [x] Prova causal em `test_infra_config_ownership.spec.js`: geração A com `hardMaxEntries=2`
      seleciona 2/2 candidatos `.txt`; geração B com `hardMaxEntries=20` observa 6/6 no mesmo
      diretório.

**Gate da Faixa K — FECHADO em 2026-08-22**

- [x] `test_infra_config_ownership.spec.js`, `test_io_session_scope.spec.js`,
      `test_mcp_repo_working_set.spec.js`, `test_io_index_registry.spec.js` e
      `test_io_observability_bounds.spec.js` verdes.
- [x] `npm run typecheck:strict:src.copilot` verde após o fechamento de K.3.
- [x] Connector smoke pós-restart/reconnect renovado: 131 local = 131 remote, OAuth/SSE verdes e
      post-restart readiness `ready=true`.

**Não fazer nesta faixa:** recriar singleton registry, novo scheduler paralelo ou nova index
architecture sem workload.

---

## Faixa L — performance governance 2.1 — FECHADA em 2026-08-22

### L.1 — cold import ratchet real — FECHADO

- [x] `scripts/analysis/infra-public-api-cold-import.mjs` mede custo dinâmico separadamente da
      static closure e usa o mesmo `INFRA_PUBLIC_API_MANIFEST` como SSOT dos
      entrypoints/classificações.
- [x] Cada amostra nasce em processo Node realmente fresco; o compile cache é explicitamente
      desabilitado (`NODE_DISABLE_COMPILE_CACHE=1`, sem `NODE_COMPILE_CACHE`) para reduzir
      dependência do estado da sessão.
- [x] A baseline canônica usa mediana de **7 amostras + 1 warmup** por entrypoint e registra
      `importMs`, wall total do child, RSS final e RSS delta diagnóstico.
- [x] `config/architecture/infra-public-api-cold-import-baseline.json` governa atualmente **32 APIs
      `runtime`/`composition`** em Node 24.15.0 Linux x64; fingerprint de Node/platform/arch/cache é
      validado antes de qualquer comparação.
- [x] `copilot:infra:cold-import:check` usa **5 amostras + 1 warmup** e falha por tolerância
      composta percentual + absoluta, evitando tanto regressão material quanto flake de
      milissegundos.
- [x] Benchmark/check aceitam `--alias=<entrypoint>` repetível para validação localizada. Alias
      desconhecido/non-hot falha; `--write-baseline` e `--validate-baseline` recusam seleção
      parcial, preservando baseline/fingerprint exaustivos.
- [x] O novo composition SQLite foi baselineado após 7 amostras + 1 warmup em **1,904 ms import /
      56,002 ms wall / 56,23 MiB RSS** e rechecado localmente sem violação; a execução dinâmica de
      todos os 32 hot entrypoints fica reservada ao checkpoint global único da Faixa M.

### L.2 — differential budgets — FECHADO

- [x] `micro`: import `+30% + 5 ms`, wall `+20% + 20 ms`, RSS `+8% + 8 MiB`.
- [x] `standard`: import `+40% + 10 ms`, wall `+30% + 25 ms`, RSS `+12% + 10 MiB`.
- [x] `heavy`: import `+50% + 20 ms`, wall `+40% + 35 ms`, RSS `+18% + 16 MiB`; composition roots
      pesados continuam permitidos, mas não podem crescer silenciosamente.
- [x] `diagnostic`/`test` ficam deliberadamente fora do hot-path dinâmico; continuam submetidos ao
      ratchet estático de módulos/source bytes/external packages.
- [x] `copilot:architecture:check` executa somente a validação barata de
      completude/classificação/fingerprint da baseline; o benchmark dinâmico pesado fica em
      `copilot:performance:check`.
- [x] `infra/public/API_REFERENCE.md` é novamente derivado e agora projeta closure estática + cold
      import/wall/RSS para APIs hot-path.

### L.3 — MCP evidence — FECHADO

- [x] Snapshot de 2026-08-22 separa handler local de silent external gap: `repo_read_file` ~4 ms,
      `repo_search_text` ~47 ms, `repo_bulk_inspect` ~79 ms e último `repo_apply_patch_batch` ~38
      ms; authorization/result-size ~0 ms.
- [x] O status de interação permanece `degraded` por operações explicitamente pesadas
      (`terminal_exec`, smoke/validators) e sobretudo por silent external gap p50 ~10,9 s / p95
      ~66,6 s; essa latência não é atribuída à implementação de Infra sem evidência causal.
- [x] Batching desta janela representou 138 operações lógicas em 41 calls (`3,37` ops/call) e 97
      operações lógicas comprimidas; `repo_bulk_inspect` chegou a 8 ops/call e patch batches a ~6,8
      ops/call.
- [x] Validators não foram usados como proxy de performance: o ratchet possui comando próprio e o
      architecture gate mantém custo curto (~1,5 s no checkpoint observado).

**Recuperação de tooling descoberta durante L**

- [x] `typecheck:strict:scripts.analysis` revelou dívida pré-existente das migrações H/E; os
      workloads de index/L2 foram migrados para `createBetterSqliteApplicationRuntime` +
      `createBetterSqliteProvider` explícitos e para config generation-owned.
- [x] `copilot-io-index-workload.mjs` voltou a usar schema migrado pelo owner correto e provou
      index/search/invalidate/prune + índice SQLite no query plan.
- [x] `copilot-io-l2-workload.mjs` voltou a executar com runtime SQLite isolado; probe reduzido
      obteve 80/80 L2 hits e break-even de uma reutilização no workload observado.
- [x] `copilot-io-l2-soak.mjs` deixou de mutar `process.env` de runtime vivo; agora prova transições
      por novas gerações `experimental → on → off → on`, 7.200 sets, cap 500, zero batch failures,
      WAL truncado e `integrity_check=ok`.

**Gate da Faixa L — FECHADO em 2026-08-22**

- [x] `npm run typecheck:strict:scripts.analysis` verde.
- [x] `npm run copilot:architecture:check` verde, incluindo baseline fingerprint e docs derivadas.
- [x] O último `npm run copilot:performance:check` global pré-expansão foi verde; os novos seams
      foram comprovados por checks localizados e a baseline agora contém **32 entrypoints
      hot-path**. A repetição global fica deliberadamente concentrada no checkpoint final da Faixa
      M.
- [x] Baseline só é regravada por comando explícito `copilot:infra:cold-import:baseline`; mudança de
      baseline não é side effect de nenhum check.

---

## Faixa M — fechamento da 2.1 — FECHADA; REVALIDADA em 2026-08-23

### M.1 — targeted validation discipline — FECHADO

- [x] cada onda possui testes causais do invariant alterado;
- [x] TS7 strict foi executado em checkpoints estruturais, não após cada micro-edit;
- [x] lint focado foi usado por onda e lint Copilot global no checkpoint final;
- [x] governance focada foi executada a cada mudança de authority/surface/lifecycle;
- [x] suíte ampla foi reservada aos marcos excepcionais de fechamento e usada para descobrir
      contracts/fixtures stale que os testes focados não revelavam.

### M.2 — definition of done — FECHADO

- [x] zero pseudo-trusted authority;
- [x] zero runtime privileged raw-path public bypass;
- [x] rollback provenance autenticada;
- [x] production ProcessInfra root ativo;
- [x] config snapshot integral e causalmente provado;
- [x] scoped health sem cross-runtime contamination;
- [x] contracts/surfaces/consumidores SQLite driver-agnostic; adapters concretos ficam isolados em
      subárvores internas explícitas de Infra e `better-sqlite3` continua o default por decisão
      benchmarked;
- [x] Core micro-entrypoints governados;
- [x] public membrane sem aliases/marker barrels sem função e package-map ratcheted;
- [x] cold import ratchets ativos;
- [x] docs live coerentes com manifests e API reference derivada;
- [x] zero unresolved local/package imports, zero parse errors e zero ciclos no grafo de `src`;
      roots/launchers sem incoming edge permanecem apenas `orphanCandidates` informativos;
- [x] zero `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` no escopo auditado;
- [x] TypeScript 7 strict global verde;
- [x] lint/format verdes;
- [x] tests focados de todos os invariants 2.1 verdes;
- [x] suíte unitária Copilot global verde;
- [x] performance ratchet isolado verde;
- [x] MCP/Cloudflare smoke/readiness verdes após refresh/recovery;
- [x] Model Gateway/LLM-B readiness verde com SQLite observability e redaction audit;
- [x] roadmap 2.1 atualizado com evidência final.

### M.3 — evidência final consolidada — REVALIDADO em 2026-08-23

- [x] **TS7 strict global:** `npm run -s typecheck:strict` → exit 0 no snapshot final de código.
- [x] **Lint:** `npm run -s lint:copilot` → exit 0.
- [x] **Format:** `npm run -s format:check` → `All matched files use Prettier code style!`.
- [x] **Architecture:** `npm run -s copilot:architecture:check` → verde, incluindo package imports,
      authority/signatures, static cost, mutable-state, cold baseline e API reference.
- [x] **Package-map:** 234 aliases Copilot, 45 testing aliases e 16 SDK surfaces; zero
      broken/wildcard, testing leak, stale alias ou divergência
      `SDK_ALIAS_LAYOUT ↔ imports ↔ exports`.
- [x] **Dependency graph:** 2.031 source files / 5.654 edges / **0 cycles / 0 unresolved / 0 parse
      errors** no snapshot final pós-extinção de Core e hardening da network membrane.
- [x] **Suppressions/authority I/O:** 0 TS suppressions; configured-FS governance verde; zero
      trusted-I/O proibido.
- [x] **Unit suite final:** `7.061 total / 7.033 passed / 0 failed / 28 pending`, `2.170/2.170`
      suites verdes, artifact `artifacts/test-runs/copilot/2026-08-23T04-16-11-466Z/summary.md`. Os
      três WARNs do detached LLM-B reaper são uma falha sintética deliberada do próprio teste e não
      assertion failures.
- [x] **Integration/regression:** integration Copilot `17 total / 12 passed / 0 failed / 5 pending`
      (`artifacts/test-runs/copilot/2026-08-23T04-20-19-189Z/summary.md`) e regression Copilot
      `31/31` (`artifacts/test-runs/copilot/2026-08-23T04-20-22-455Z/summary.md`).
- [x] **Performance final isolada:** 38 public hot aliases × 5 amostras (+1 warmup), `success=true`,
      zero violações de import time, wall time ou RSS; baseline cold não foi relaxada para obter o
      verde.
- [x] **Network membrane hardening:** `#copilot/infra/public/platform/network` é fail-closed por
      construção e não exporta resolver injection/private-network bypass. O seam white-box permanece
      interno; `WEBHOOK_ALLOW_PRIVATE_HOSTS` foi removido por ser authority órfã. Closure estática
      final **10 módulos / 21.838 bytes**, ratchet **15 / 32.757**; performance final **22,140 ms
      import / 77,559 ms wall / 62,047 MiB RSS**.
- [x] **Workspace MCP smoke:** 13/13 checks operacionais verdes; status `degraded` apenas enquanto o
      Git estava deliberadamente dirty antes do commit, sem critical findings.
- [x] **Connector smoke refresh:** MCP protocol `2025-11-25`, OAuth metadata/challenge verdes,
      runtime health 200, **131/131 tools**, SSE inicial/reconnect/Last-Event-ID verdes.
- [x] **Cloudflare post-change gates:** `ok=true`, 4 HA connections, QUIC presente, RTT 20 ms e
      smoke fresh. `requestErrorRate=0,244027` permaneceu histórico e RPC p95 ficou em 1.170 ms;
      ambos são evidência observacional, sem blocker atual.
- [x] **Incidente transitório observado e preservado:** após o refresh houve janela de 502 do
      conector; post-restart diagnostics registraram TLS handshake timeouts no origin entre
      aproximadamente 23:00–23:01 UTC. O serviço recuperou sem mudança de código: MCP HTTP e
      cloudflared vivos, health local/público 200 e readiness `ready=true`. Não reclassificar esses
      logs como inexistentes; eles são evidência operacional útil para investigação de latência
      futura.
- [x] **LLM-B readiness:** `ok=true`; catalog integrity e SQLite parity verdes; redaction
      `catalogLeaks=0/sqliteLeaks=0`; 7/7 perfis selecionáveis; runtime selector 7/7 e terminal live
      selector 3/3 prontos; SQLite observability com `runtimeRows=324632`,
      `healthObservations=177541`, `probeResults=143527`, sem blockers de acesso/ambiente.

**Gate da Faixa M — FECHADO; REVALIDADO em 2026-08-23**

A arquitetura 2.1 satisfaz integralmente o Definition of Done técnico e o gate de publicação foi
executado: commits coerentes foram enviados a `main`, `HEAD == origin/main == ls-remote` foi provado
com divergência `0:0` e working tree limpa. O smoke MCP executado já sobre o snapshot publicado
retornou `status=ok`, 13/13 checks, zero warnings e zero critical findings.

---

## 9. Sequenciamento recomendado

A ordem importa porque algumas faixas reduzem a complexidade das seguintes.

### Onda 1 — fechar privilege antes de otimizar

1. Faixa A — authority/public membrane;
2. Faixa C — rollback integrity;
3. Faixa B — persistence bound.

Motivo: não faz sentido otimizar closures de uma API que será removida ou redesenhada.

### Onda 2 — tornar ownership completo

4. Faixa D — ProcessInfra/ApplicationInfraHost;
5. Faixa E — config ownership total;
6. Faixa F — scoped observability.

Motivo: process root e config hierarchy definem onde probes/configs devem viver.

### Onda 3 — reduzir acoplamento e drivers

7. Faixa G — Core exact semantic entrypoints;
8. Faixa H — SQLitePort;
9. Faixa I — platform/process consolidation.

### Onda 4 — simplificar e ratchetar

10. Faixa J — public API/docs;
11. Faixa K — scope UX/health refinements;
12. Faixa L — performance ratchets;
13. Faixa M — fechamento.

---

## 10. Matriz de achados

| ID      | severidade | confiança  | achado                                                   | evidência                              | ação 2.1                        |
| ------- | ---------- | ---------- | -------------------------------------------------------- | -------------------------------------- | ------------------------------- |
| A21-001 | P0/P1      | alta       | rollback digest não autentica provenance                 | token fabricado retorna verified=true  | authenticated/opaque capability |
| A21-002 | P0/P1      | alta       | raw mutation primitives públicas contornam authority     | public exports + consumers diretos     | bound IO only                   |
| A21-003 | P1         | alta       | persistence JSON/JSONL path-based pública                | source + fan-in                        | kernel + bound store            |
| A21-004 | P1         | alta       | `jsonl/trusted.js` é pseudo-authority morta              | source + zero prod consumers           | remover                         |
| A21-005 | P0/P1      | alta       | runtime config snapshot incompleto                       | probe 7→2 após env mutation            | config hierarchy fechada        |
| A21-006 | P1         | alta       | disposed child permanece memoizado no parent             | causal probe                           | parent ownership/deregister     |
| A21-007 | P1         | alta       | runtime health mistura process-global probes             | source inspection                      | scoped probes                   |
| A21-008 | P1         | alta       | ProcessInfra não é production root                       | zero prod consumers + boot singleton   | ApplicationInfraHost            |
| A21-009 | P1         | alta       | concrete SQLite driver types vazam por Infra             | type/import inventory                  | SqlitePort                      |
| A21-010 | P1/P2      | alta       | Core mega-root custa muito mais que semantic aliases     | cold benchmark                         | exact governed aliases          |
| A21-011 | P2         | alta       | public governance detecta nomes, não authority semântica | test source                            | manifest/checker richer         |
| A21-012 | P2         | alta       | executable discovery duplicada                           | 3 owners                               | platform resolver               |
| A21-013 | P2         | alta       | public aliases/marker barrels sem uso real               | fan-in inventory                       | minimize membrane               |
| A21-014 | P2         | média/alta | docs humanas contêm topologia histórica                  | README/manifest inspection             | derive/update docs              |
| A21-015 | não-bug    | alta       | L2 health side-effect suspeito foi falsificado           | causal before/after materialized=false | não alterar por essa hipótese   |

---

## 11. Decisões arquiteturais recomendadas

### DEC-2.1-01

**Authority vale mais que convenção de caller.** String `caller`, nome de função ou path “conhecido”
não constituem capability.

### DEC-2.1-02

**Bound store é o padrão para estado persistente.** O owner resolve identity/path uma vez; operações
não recebem `filePath` aberto.

### DEC-2.1-03

**ProcessInfra deve existir em produção ou deixar de existir.** Arquitetura não deve manter scope
ornamental.

### DEC-2.1-04

**Config é resolvida uma vez por owner scope.** Lazy resource creation não implica lazy env
interpretation.

### DEC-2.1-05

**Health não é probe ativo por default.** Se um diagnóstico precisa tocar DB/rede/FS, chamar
explicitamente `probe`/`check`, nunca `snapshot`.

### DEC-2.1-06

**Cold-load budget é por entrypoint, não por diretório.** Composition roots podem ser pesados; leaf
API não deve carregar o mundo.

### DEC-2.1-07

**Driver swap só após port + benchmark.** `node:sqlite` é oportunidade, não objetivo arquitetural.

### DEC-2.1-08

**Sem compat debt por conveniência.** Remover aliases/legacy token versions quando não houver
consumidor externo obrigatório.

---

## 12. Riscos de implementação

### 12.1 Fechar public raw IO pode quebrar owners que hoje dependem de paths fixos

Mitigação: migrar owner por owner para configured/workspace store bound antes de retirar alias.

### 12.2 ProcessInfra real muda lifecycle bootstrap

Mitigação: introduzir host com estado explícito, teste de shutdown e restart generation; não fazer
troca big-bang sem causal tests.

### 12.3 Config snapshot total pode alterar testes que hoje mutam `process.env` após imports

Isso é desejável se o teste dependia de comportamento não arquitetural. Fixtures devem criar
config/host explícitos.

### 12.4 Rollback authentication e restart portability

Não escolher HMAC process-ephemeral se rollback após restart é requisito. Resolver requisito antes
da implementação.

### 12.5 SqlitePort excessivamente genérico

Evitar “mini ORM”. O port deve refletir somente as operações usadas pelos adapters atuais.

### 12.6 Performance gates frágeis

Não usar uma execução única nem wall time absoluto rígido em CI/WSL. Mediana + headroom + regressão
relativa.

---

## 13. Antiobjetivos 2.1

A 2.1 **não** tem como objetivo:

- reescrever toda a Infra;
- trocar ESM/barrels por outra convenção sem benefício;
- reduzir LOC como KPI;
- introduzir DI container genérico em toda a árvore;
- criar abstrações de cloud/distributed cache sem workload;
- trocar `better-sqlite3` por `node:sqlite` de imediato;
- mover toda leitura de `node:fs` para um único arquivo monolítico;
- eliminar process-global state que é intrinsecamente process-global e bem governado;
- perseguir zero external packages como meta ideológica;
- usar Node Permission Model como sandbox de segurança;
- repetir suíte ampla a cada subfase.

---

## 14. Referências técnicas externas consultadas

Fontes oficiais Node.js usadas apenas para decisões de oportunidade tecnológica:

- Node.js v24.19.0 — SQLite: `https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html`
  - `node:sqlite` em Stability 1.2 / Release candidate;
  - release candidate desde v24.15.0.
- Node.js v24.19.0 — Permission Model:
  `https://nodejs.org/download/release/latest-v24.x/docs/api/permissions.html`
  - Stability 2 / Stable;
  - explicitamente descrito como mecanismo de restrição/“seat belt”, não proteção contra malicious
    code.
- Node.js v24.x — File system/glob:
  `https://nodejs.org/download/release/latest-v24.x/docs/api/fs.html`
  - `fs.glob`/`fsPromises.glob` stable na linha 24.x.

---

## 15. Conclusão

A Infra atual é qualitativamente superior ao estado auditado antes da Arquitetura 2.0. O trabalho
mais difícil de topologia e instance ownership já foi feito. O risco agora é declarar vitória cedo
demais porque os testes de barrels e os manifests estão verdes, quando ainda existem rotas
semanticamente paralelas ao modelo de authority.

A Arquitetura 2.1 proposta é, por isso, uma arquitetura de **fechamento**:

- fecha o efeito físico sob authority;
- fecha proveniência de rollback;
- fecha configuração sob owner scope;
- fecha lifecycle pai→filho;
- fecha observability sob scope correto;
- fecha SQLite sob port;
- fecha Core/public entrypoints sob custo e semântica reais.

O estado-alvo não é uma árvore maior. É uma árvore em que cada operação consegue responder, sem
ambiguidade, a cinco perguntas:

1. **quem me possui?**
2. **qual authority permite este efeito?**
3. **qual snapshot de configuração governa meu comportamento?**
4. **quem encerra meu lifetime?**
5. **qual entrypoint paga o custo de me carregar?**

Quando essas cinco respostas estiverem codificadas e testadas, a Arquitetura 2.1 estará concluída e
a Infra terá deixado para trás não apenas os nomes da 1.0, mas também seus últimos padrões
implícitos de autoridade e ownership.
