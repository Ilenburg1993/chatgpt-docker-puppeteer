# Auditoria profunda — `src/copilot/infra` para Node 24+ ESM e tools LLM

**Data:** 2026-05-14
**Escopo auditado:** arquivos fornecidos como a pasta `src/copilot/infra` do projeto, incluindo I/O, cache, índice, parser, prefetch, escopo de sessão, locks, storage, webhooks e SSE.
**Contexto assumido:** runtime local para tools de LLM no contexto de “GitHub SDK Copilot 0.3.0”. Como não encontrei, nos arquivos enviados, documentação do SDK em si nem contratos de tool registry, tratei esse item como um SDK interno/privado ou uma camada do projeto acima de `infra/`.

---

## 1. Sumário executivo

A base está acima da média para um projeto em JavaScript ESM: há uma intenção arquitetural clara, uma `io-engine` canônica, caches L1/L2, índice FTS, parser simbólico, scanner, prefetch, escopos de sessão, locks, health snapshot e observabilidade via `diagnostics_channel`. A documentação local também define regras corretas: toda leitura/escrita deve passar pela `io-engine`, os tiers de cache e índice devem ser invalidados pelo mesmo evento, e limites para LLM são informativos, não barreiras de segurança (`README.md:L36-L49`).

O problema central é que a implementação ainda está no estágio de **infraestrutura promissora**, não de **substrato plenamente confiável para tools LLM com máxima liberdade e poder**. Para dar liberdade real à LLM sem transformar a execução em comportamento opaco ou perigoso, a infra precisa ser simultaneamente mais forte em quatro eixos:

1. **Corretude transacional:** locks normalizados, lockfile interprocesso atômico, escrita durável, invalidação recursiva correta, rollback e snapshots.
2. **Controle de explosão de contexto:** `maxResults`, timeouts, paginação/cursor e limites de saída precisam ser funcionais, não apenas “advisory”.
3. **Índice confiável:** parse errors, símbolos, imports e frescor precisam refletir a realidade do workspace; hoje há bugs que podem marcar conteúdo quebrado como `fresh`.
4. **Superfície de tool para agentes:** a infra ainda não oferece plano/execução/rollback/testes/Git/GitHub como uma composição de ações rastreáveis; ela oferece primitivas locais boas, mas não um runtime de agência robusto.

**Avaliação aproximada do estado atual:**

| Eixo                               |   Nota | Diagnóstico                                                                                                                                         |
| ---------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arquitetura conceitual             | 8.0/10 | Boa separação entre engine, cache, índice, parser, scanner e health.                                                                                |
| Corretude operacional              | 5.5/10 | Há bugs de lock, cache/índice, invalidação e limites não aplicados.                                                                                 |
| Segurança para tools LLM           | 6.0/10 | Há sanitização e validação em pontos relevantes, mas falta política de capacidade, assinatura de webhook, auditoria forte e limites duros de saída. |
| Performance/escala                 | 6.0/10 | L1/L2/FTS ajudam, mas há fan-out de promises, duplicação de conteúdo, sem byte cap no L2 e sem paginação real.                                      |
| Observabilidade                    | 7.0/10 | Bom uso de `diagnostics_channel`, health snapshot e metadados; porém muitos `catch {}` ocultam falhas críticas.                                     |
| Prontidão para “tools LLM máximas” | 5.5/10 | Boa fundação, mas faltam transações, budgets, policies e orquestração agentic.                                                                      |

---

## 2. Metodologia

Foram lidos os arquivos completos no ambiente local. Além da leitura manual, rodei:

- `node --check` em todos os `.js` enviados: **sem erro de sintaxe** no Node disponível no ambiente (`v22.16.0`). Isso não prova compatibilidade total com Node 24+, mas indica que a sintaxe ESM/JS atual é válida.
- Análise estática simples de imports/exports, ciclos locais, contagem de `catch`, superfície pública do barrel e discrepâncias documentais.
- Teste mínimo de comportamento em `AsyncQueue` para validar o deadlock quando `concurrency=0`.

Métricas do pacote enviado:

| Métrica                  |                                                                                            Valor |
| ------------------------ | -----------------------------------------------------------------------------------------------: |
| Arquivos JS              |                                                                                               23 |
| README                   |                                                                                                1 |
| Linhas JS aproximadas    |                                                                                            6.620 |
| Blocos `catch`           |                                                                                               64 |
| Arquivo mais complexo    |                                                                     `io-engine.js`, 1.855 linhas |
| Ciclos locais detectados | 2 ciclos principais envolvendo `io-engine`, `io-index-registry`, `io-index-sqlite` e `io-parser` |

---

## 3. Situação atual

### 3.1. Intenção arquitetural

A pasta se apresenta como um núcleo técnico compartilhado do Copilot local, com `io-engine.js` como porta canônica de I/O, L1/L2/índice, scanner, parser, prefetch e health (`README.md:L22-L34`). Essa é a direção correta: tools LLM precisam de uma superfície única de leitura/escrita para que locks, telemetria, cache, índice e políticas não se fragmentem.

O desenho atual tem estes componentes principais:

- `io-engine.js`: leitura, escrita atômica, append, stat, mkdir, delete/rm, copy, move, patch, diff e busca textual/simbólica.
- `io-cache.js`: cache L1 em memória com TTL, LRU, fingerprint `mtime+size` e hooks de invalidação.
- `io-cache-l2-sqlite.js` + registry: cache persistente de blobs/texto em SQLite.
- `io-index-sqlite.js` + registry: índice persistente com FTS5, chunks, símbolos e imports.
- `io-parser.js`: parsing JS/TS/JSON/Markdown via `@babel/parser`, quando disponível.
- `io-scanner.js`: enumeração canônica com denylist, `.gitignore`, fingerprint e eventos.
- `io-prefetch.js` e `io-session-scope.js`: aquecimento de contexto e símbolos para a LLM.
- `io-health.js`: snapshot agregado de cache, parser, índice e scopes.
- `io-locks.js` e `lockfile.js`: locks intra-processo e interprocesso.
- `webhooks.js` e `sse/*`: emissão externa e streaming.

### 3.2. Pontos fortes

1. **Boa ambição sistêmica.** A infra não é só wrapper de `fs`; ela tenta formar um plano de memória local para LLM: cache quente, índice pesquisável, símbolos, prefetch e health.
2. **Invalidação coordenada existe.** `io-engine` invalida L1 e L2 após mutações (`io-engine.js:L41-L72`, `io-engine.js:L910-L921`). O índice se conecta via hook (`io-index-registry.js:L18-L24`).
3. **Busca híbrida.** `searchText` tenta usar índice quando simples, depois `rg`, depois `grep` (`io-engine.js:L1539-L1697`).
4. **Observabilidade desacoplada.** `io-observability` publica eventos em canais específicos sem acoplar infra a collectors concretos (`io-observability.js:L15-L33`, `io-observability.js:L54-L71`).
5. **Scanner respeita `.gitignore` e denylist.** `io-scanner` usa `ignore`, bloqueia segmentos padrão e publica progresso (`io-scanner.js:L153-L204`).
6. **Escopo de sessão é uma ideia correta para LLM.** `declareScope` une prefetch, parsing e indexação por sessão (`io-session-scope.js:L155-L265`).

---

## 4. Achados críticos e bugs prováveis

### P0-01 — `lockfile.js` não é lock interprocesso atômico

**Severidade:** crítica
**Arquivo:** `lockfile.js`

`acquireLock` faz `existsSync(lockPath)` e depois `writeFile(lockPath, pid)`. Entre a checagem e a escrita, dois processos podem passar pela verificação e ambos “adquirirem” o lock (`lockfile.js:L23-L49`). Além disso, `releaseLock` apaga o lockfile sem verificar se o PID dentro dele pertence ao processo atual (`lockfile.js:L58-L65`).

**Impacto:** duas instâncias do agente podem executar mutações concorrentes acreditando possuir exclusão mútua. Para tools LLM com acesso amplo a filesystem/Git, isso é inaceitável.

**Correção ideal:**

- Adquirir com `fs.open(lockPath, 'wx')` ou `mkdir(lockDir)` atômico.
- Gravar `{ pid, hostname, startedAt, token }`.
- `releaseLock` deve remover somente se o token/PID coincidir.
- Stale lock deve ser revalidado com cautela e, em ambiente multi-host, não depender apenas de PID.

---

### P0-02 — Locks intra-processo usam chaves cruas, não paths canônicos

**Severidade:** crítica
**Arquivos:** `io-engine.js`, `io-locks.js`

A implementação de lock em `io-locks.js` serializa por `resourceKey` literal (`io-locks.js:L103-L124`). Porém `io-engine` chama `withIoResourceLock(filePath, ...)` usando o path recebido, sem normalizar/realpath (`io-engine.js:L875-L909`, `io-engine.js:L982-L1005`, `io-engine.js:L1085-L1112`). Isso permite que `./a.js`, `/abs/proj/a.js`, symlink e variantes de case em sistemas específicos sejam locks diferentes para o mesmo recurso.

**Impacto:** corrida em escrita/patch/move/copy; invalidação e cache podem ficar inconsistentes.

**Correção ideal:**

- Criar `normalizeIoResourceKey(path, { realpathIfExists: true })`.
- Para destino inexistente, normalizar diretório pai real + basename.
- Usar essa chave em todos os locks de `io-engine`.
- Registrar nos metadados `lockKey` e `originalPath`.

---

### P0-03 — Busca pode travar ou explodir memória/saída

**Severidade:** crítica
**Arquivo:** `io-engine.js`

`RG_SEARCH_TIMEOUT_MS` está definido como `undefined` (`io-engine.js:L35-L37`). `rg` e `grep` recebem `maxBuffer: 1024 * 1024 * 1024` (`io-engine.js:L1595-L1599`, `io-engine.js:L1647-L1650`, `io-engine.js:L1810-L1814`). Além disso, `maxResults` é apenas metadado em `advisoryLimits`, não é aplicado (`io-engine.js:L1515-L1519`).

**Impacto:** uma tool LLM pode disparar busca ampla, bloquear por tempo indefinido, gerar saída gigantesca e consumir memória demais. “Máxima liberdade” não deve significar ausência de orçamento; deve significar ação poderosa com paginação e controle.

**Correção ideal:**

- Timeout default real: por exemplo, 10–30s configurável.
- `AbortSignal` em buscas.
- Limite de bytes de saída e cursor/paginação.
- Aplicar `maxResults` de verdade.
- Retornar `truncated: true`, `nextCursor`, `totalEstimated`.
- Preferir `rg --json` e parser incremental em vez de stdout bruto.

---

### P0-04 — Índice pode marcar arquivo com parse quebrado como `fresh`

**Severidade:** alta/crítica
**Arquivo:** `io-index-sqlite.js`

Em `indexTextFile`, `parseError` só é preenchido se `parseAndCacheSymbols` lançar exceção (`io-index-sqlite.js:L451-L459`). Mas `parseFileSymbols` normalmente retorna um objeto com `parseError` em vez de lançar (`io-parser.js:L337-L351`). O upsert usa `status: parseError ? 'failed' : 'fresh'` (`io-index-sqlite.js:L467-L495`). Assim, um arquivo com erro de parse retornado no objeto pode ser persistido como `fresh`.

**Impacto:** `searchWorkspaceSymbols`, contexto de sessão e health podem confiar em um índice semanticamente incompleto.

**Correção ideal:**

```js
const parseError = symbols?.parseError ?? caughtParseError ?? null;
const status = parseError ? 'failed' : 'fresh';
```

Também convém persistir `parserVersion`, `babelVersion`, `truncated`, `parseErrorCode` e `parseMode`.

---

### P0-05 — Invalidação recursiva não invalida corretamente scopes de sessão

**Severidade:** alta
**Arquivos:** `io-cache.js`, `io-session-scope.js`

`invalidateIoCacheSubtree(filePath)` chama hooks passando apenas o path raiz (`io-cache.js:L299-L307`). Em `io-session-scope`, `markScopePathInvalidated` só invalida quando o path é exatamente igual a um path do escopo (`io-session-scope.js:L119-L137`). Se uma operação remove/move uma pasta inteira, scopes contendo arquivos sob aquela pasta podem continuar com símbolos antigos.

**Impacto:** LLM recebe contexto obsoleto após `rm -r`, move de diretório ou invalidação de subtree.

**Correção ideal:**

- Hooks devem receber `{ path, recursive }`.
- Scope deve invalidar todos os `scope.paths` cujo path seja igual ou descendente da raiz.
- `invalidatedPaths` deve armazenar paths normalizados.

---

### P0-06 — L2 SQLite usa `INTEGER` para `mtime_ms`/`ctime_ms`, mas Node fornece float

**Severidade:** alta
**Arquivos:** `io-cache-l2-sqlite.js`, `io-engine.js`

O schema do L2 define `mtime_ms INTEGER` e `ctime_ms INTEGER` (`io-cache-l2-sqlite.js:L52-L66`). O Node fornece `stats.mtimeMs` e `stats.ctimeMs` como número possivelmente fracionário. `io-engine` passa `mtimeMs` para o L2 (`io-engine.js:L683-L691`), e o `set` grava esse valor diretamente (`io-cache-l2-sqlite.js:L241-L260`).

Em SQLite `STRICT`, valores reais em coluna `INTEGER` podem falhar. Como `set` captura erro e retorna `false` sem expor a causa (`io-cache-l2-sqlite.js:L241-L268`), o L2 pode simplesmente nunca persistir certos itens e só aumentar `errors`.

**Correção ideal:**

- Alterar schema para `REAL`, alinhado com `io-index-sqlite.js`, que já usa `mtime_ms REAL` e `ctime_ms REAL` (`io-index-sqlite.js:L167-L186`).
- Ou converter com `Math.round()`/`Math.trunc()` e padronizar comparação.
- Expor último erro do L2 em stats/health.

---

### P0-07 — `maxFiles` e `maxResults` são “informativos”, mas tools LLM precisam de budgets funcionais

**Severidade:** alta
**Arquivos:** `README.md`, `io-prefetch.js`, `io-engine.js`, `io-index-sqlite.js`

O README declara que limites para LLM são informativos, não bloqueantes (`README.md:L45-L49`). Isso faz sentido para não amputar ações internas, mas a camada de tool precisa de controle de saída. `warmFromDirectory` aceita `maxFiles`, porém não corta o scan nem a seleção (`io-prefetch.js:L307-L363`). `searchText` aceita `maxResults`, mas não aplica (`io-engine.js:L1512-L1519`).

**Impacto:** uma LLM pode receber volumes gigantescos, degradar custo/latência, ou cair em loop de leitura ampla.

**Correção ideal:** diferenciar:

- **Limites de execução:** podem ser altos e configuráveis.
- **Limites de retorno para LLM:** devem ser duros, paginados e explícitos.
- **Limites de segurança:** path policy, permissões, denylist e capability policy.

---

### P0-08 — `AsyncQueue` pode nunca executar tarefas com `concurrency <= 0`

**Severidade:** média/alta
**Arquivo:** `queue.js`

O construtor aceita qualquer número e grava direto (`queue.js:L37-L39`). O drain só roda enquanto `#running < #concurrency` (`queue.js:L65-L76`). Com `concurrency: 0`, tarefas ficam pendentes para sempre. Teste local confirmou `{ pending: 1, running: 0, done: false }` após adicionar uma tarefa.

**Correção ideal:** validar com:

```js
this.#concurrency = Math.max(1, Math.floor(Number(opts?.concurrency ?? 1)) || 1);
```

O mesmo padrão deve ser aplicado em `warmCacheForPaths`, `declareScope`, scanner e índice.

---

### P0-09 — `indexTextFile` faz leitura/parsing duplicado e pode indexar snapshot inconsistente

**Severidade:** média/alta
**Arquivo:** `io-index-sqlite.js`

`indexDirectory` lê o arquivo com `readText` e passa `content` para `indexTextFile` (`io-index-sqlite.js:L643-L665`). Dentro de `indexTextFile`, para símbolos, o código chama `parseAndCacheSymbols(filePath)`, que lê o arquivo novamente via `io-engine` (`io-index-sqlite.js:L451-L459`; `io-parser.js:L380-L388`).

**Impacto:** I/O duplicado, risco de indexar texto de uma versão e símbolos de outra se o arquivo mudar no meio, e pior desempenho em workspaces grandes.

**Correção ideal:** `indexTextFile` deve chamar `parseFileSymbols(filePath, input.content)` para parsear exatamente o snapshot indexado.

---

### P0-10 — Barrel público não expõe várias funções centrais da `io-engine`

**Severidade:** média
**Arquivos:** `index.js`, `io-engine.js`

`io-engine` exporta `statPath`, `mkdirPathLocked`, `removePathLocked`, `searchText` e `searchWorkspaceSymbols` (`io-engine.js:L1036`, `io-engine.js:L1085`, `io-engine.js:L1194`, `io-engine.js:L1512`, `io-engine.js:L1725`). O barrel `index.js` não reexporta essas funções; ele reexporta apenas uma parte da engine (`index.js:L38-L52`).

**Impacto:** consumidores do módulo `infra` podem burlar o barrel e importar direto, ou simplesmente não ter acesso à superfície que as tools mais precisam.

**Correção ideal:** revisar a API pública e exportar explicitamente a superfície aprovada. Se algumas funções são internas, mover para arquivo interno e documentar.

---

## 5. Outros bugs e gaps relevantes

### 5.1. `readJson` apaga diferença entre “arquivo não existe” e “JSON corrompido”

`readJson` retorna `defaultValue` em qualquer erro (`storage.js:L23-L29`). Isso é prático, mas perigoso para estado de agente: JSON corrompido vira estado default silenciosamente.

**Recomendação:** oferecer `readJsonStrict`, ou retornar `{ ok, value, errorKind }` para storage de sessão/estado crítico.

### 5.2. Parser não captura CommonJS, dynamic imports e símbolos profundos

`io-parser` só percorre `ast.program.body` e trata imports/exports top-level (`io-parser.js:L191-L262`). Ele não extrai `require()`, `module.exports`, `exports.foo`, dynamic `import()`, métodos de classe, propriedades relevantes, calls de tool registry, nem dependências internas. Para um agente LLM poderoso, o parser simbólico precisa virar um índice semântico de projeto.

### 5.3. JSON array multi-line falha em `extractJsonSchema`

Se o conteúdo começa com `[`, o código tenta `JSON.parse(content.split('\n')[0] ?? content)` (`io-parser.js:L425-L440`). Isso quebra arrays JSON formatados em múltiplas linhas, porque a primeira linha pode ser apenas `[`.

**Correção:** tentar `JSON.parse(content)` primeiro; se falhar e for JSONL, parsear primeira linha não vazia.

### 5.4. Markdown outline usa número ordinal do heading, não linha real

Para Markdown, `extractMarkdownOutline` retorna apenas strings e depois `parseFileSymbols` usa `i + 1` como linha (`io-parser.js:L358-L367`, `io-parser.js:L454-L461`). Isso produz linhas falsas.

### 5.5. `declareScope` expõe `ready: false` fixo e não expõe `_warmPromise`

A documentação interna comenta que o chamador pode aguardar `scope._warmPromise` (`io-session-scope.js:L148-L154`), mas o retorno público só expõe `awaitReady` e um `ready: false` estático (`io-session-scope.js:L267-L287`). Isso cria API confusa.

**Correção:** retornar `get ready() { return getScopeStats(sessionId)?.ready ?? false; }` ou remover `ready` do retorno inicial.

### 5.6. Falhas de inicialização do índice são silenciosas demais

`getIoIndex` captura qualquer erro e retorna `null` (`io-index-registry.js:L30-L39`). `getIoIndexStats` só informa `unavailable`, sem o último erro (`io-index-registry.js:L41-L50`). O L2 registry guarda último erro; o index registry deveria fazer o mesmo.

### 5.7. L2 não tem limite por bytes

`io-cache-l2-sqlite` limita entradas (`maxEntries`), mas não limita bytes totais (`io-cache-l2-sqlite.js:L87-L104`, `io-cache-l2-sqlite.js:L187-L195`). Uma sequência de arquivos grandes pode inchar o SQLite.

### 5.8. FTS duplica conteúdo em `content` e `chunks`

O índice guarda conteúdo completo na FTS e chunks completos em tabela separada (`io-index-sqlite.js:L194-L199`, `io-index-sqlite.js:L230-L243`, `io-index-sqlite.js:L496-L507`). Isso acelera consulta, mas pode dobrar armazenamento. Para workspaces grandes, precisa de política de compressão, max file size, exclusões e vacuum/prune.

### 5.9. `searchWorkspaceSymbols` não tem fallback para `grep`

Ao contrário de `searchText`, a busca simbólica exige `rg` quando o índice não responde (`io-engine.js:L1786-L1788`). Isso pode ser aceitável, mas precisa estar documentado no contrato da tool.

### 5.10. `diffText` é algoritmo ingênuo

`diffText` compara linhas por posição, sem LCS/patience diff (`io-engine.js:L1410-L1484`). Em inserções no topo, gera diff enorme e pouco útil. Para LLM, diff ruim aumenta custo e diminui precisão.

### 5.11. `patchTextLocked` bypassa a `readText` canônica

O patch lê direto via `fs.readFile(filePath, 'utf8')` dentro do lock (`io-engine.js:L1363-L1386`). A mutação é bem observada como patch, mas a leitura não passa por sanitização/binário/trace da engine. Pode ser intencional por atomicidade, mas deveria ser documentado como exceção.

### 5.12. Webhooks não têm assinatura/HMAC

`WebhookManager` valida URL e mitiga DNS rebinding (`webhooks.js:L148-L171`), sanitiza payload de forma rasa (`webhooks.js:L99-L125`) e faz retry (`webhooks.js:L185-L232`). Falta assinatura HMAC do body, `eventId`, deduplicação e redaction recursiva. Para eventos de agente, isso é importante.

### 5.13. SSE replay buffer não valida tamanho

`SseReplayBuffer` recebe `maxSize` diretamente e só faz `shift` se exceder (`replay-buffer.js:L31-L52`). Se config vier como `0`, negativo ou não finito, o comportamento degrada. Deve validar e limitar.

### 5.14. `EventFanout` é documentado como plugável, mas não aceita transport

O comentário fala em Redis/BroadcastChannel futuro (`fanout.js:L29-L33`, `fanout.js:L91-L95`), mas o construtor só aceita `processId` (`fanout.js:L41-L48`). É um gap de arquitetura, não bug imediato.

### 5.15. `io-prefetch` documenta APIs inexistentes

O cabeçalho menciona `warmFromPattern` e `warmFromRecentFiles` (`io-prefetch.js:L11-L20`), mas o arquivo exporta `warmFromDirectory`, `warmRecentPaths` e `warmReadThroughContext` (`io-prefetch.js:L307-L459`). Documentação e API divergiram.

### 5.16. Arquivos SSE foram enviados achatados; barrel espera `./sse/index.js`

No pacote enviado, existem `fanout.js`, `replay-buffer.js` e `state.js` na raiz de `/mnt/data`, mas `index.js` reexporta de `./sse/index.js` (`index.js:L90-L97`). Se no projeto real existe `src/copilot/infra/sse/index.js`, está fora do material auditado; se não existe, o barrel quebra.

---

## 6. Ciclos arquiteturais detectados

Foram detectados ciclos locais relevantes:

```text
io-index-registry.js -> io-index-sqlite.js -> io-engine.js -> io-index-registry.js
io-index-registry.js -> io-index-sqlite.js -> io-parser.js -> io-engine.js -> io-index-registry.js
```

**Por que isso importa:** em ESM, ciclos podem funcionar quando não há uso prematuro de bindings, mas tornam bootstrap, testes, mocks e evolução mais frágeis. Aqui o ciclo também revela uma mistura conceitual: o índice depende da engine para ler, a engine depende do índice para buscar, e o parser depende da engine para ler.

**Situação ideal:**

- `io-core-readers`: leitura bruta/canônica mínima sem índice.
- `io-cache`: caches e invalidação.
- `io-parser`: puro, recebe conteúdo; não lê arquivo por padrão.
- `io-index`: recebe dependências por injeção (`readText`, `parseFileSymbols`, `scanDirectory`).
- `io-engine`: orquestra tudo e escolhe índice/rg/grep, mas o índice não importa a engine.

---

## 7. Situação ideal para tools LLM com máxima liberdade e poder

A “liberdade máxima” para uma LLM não deve ser confundida com `fs` irrestrito, `grep` sem timeout e payload gigante. O ideal é **poder operacional alto com contratos fortes**:

### 7.1. Princípios ideais

1. **Toda ação é rastreável:** cada tool call gera `traceId`, plano, inputs normalizados, outputs paginados, diffs e evento de auditoria.
2. **Toda mutação é reversível:** antes de write/patch/move/delete, criar snapshot ou diff reverso.
3. **Toda saída é paginável:** nenhuma tool deve despejar conteúdo ilimitado na LLM.
4. **Toda permissão é declarada:** a tool sabe se pode ler, escrever, deletar, executar shell, mexer em Git ou chamar rede.
5. **Toda busca tem múltiplas camadas:** índice semântico, índice textual, AST/LSP, `rg` fallback e leitura paginada.
6. **Todo contexto é atualizável:** watchers e invalidadores mantêm cache/índice/scopes frescos.
7. **Toda operação longa é cancelável:** `AbortSignal` atravessa scanner, indexador, busca, prefetch e subprocessos.

### 7.2. Superfície ideal de tools

#### Filesystem

- `fs.read({ path, range, encoding, cursor })`
- `fs.readChunks({ path, chunkSize, cursor })`
- `fs.write({ path, content, mode, snapshot: true })`
- `fs.patch({ path, hunks, expectedHash, dryRun })`
- `fs.move/copy/delete({ ..., dryRun, snapshot })`
- `fs.tree({ root, depth, include, exclude, cursor })`
- `fs.search({ query, mode, maxResults, cursor })`
- `fs.symbols({ query, kind, pathPrefix, cursor })`

#### Projeto/código

- `code.outline(path)`
- `code.dependencyGraph(path|workspace)`
- `code.findReferences(symbol)`
- `code.findDefinitions(symbol)`
- `code.testImpact(changedFiles)`
- `code.applyPlan(planId)`

#### Execução

- `shell.run({ cmd, cwd, timeout, maxOutputBytes, allowlistProfile })`
- `npm.script({ name, timeout })`
- `test.run({ target, changedOnly })`
- `lint.run({ target })`

#### Git/GitHub

- `git.status`, `git.diff`, `git.branch`, `git.commit`, `git.restore`, `git.worktreeSnapshot`
- `github.issue.read`, `github.pr.create`, `github.pr.comment`, `github.actions.status`

#### Memória/planejamento

- `plan.create`, `plan.step`, `plan.review`, `plan.apply`, `plan.rollback`
- `workspace.index.status/build/search/symbol/clear`
- `agent.journal.read/write`

---

## 8. Roadmap proposto

### Fase 0 — Correções críticas imediatas, 1–3 dias

1. **Lockfile atômico:** trocar `existsSync + writeFile` por `open('wx')`/`mkdir` lock; validar dono no release.
2. **Normalização de locks:** usar chave canônica em todos os locks de path.
3. **Timeouts e budgets:** aplicar timeout real em `rg`/`grep`; reduzir `maxBuffer`; implementar limite de bytes e `maxResults` real.
4. **Fix parse status:** usar `symbols?.parseError` em `io-index-sqlite`.
5. **Fix L2 mtime/ctime:** migrar colunas para `REAL` ou arredondar consistentemente.
6. **Fix subtree invalidation em scopes:** hooks com `{ recursive }` e invalidação de descendentes.
7. **Validar `concurrency`:** `AsyncQueue`, prefetch, parser worker, scanner, índice e config env.
8. **Barrel público:** decidir e corrigir exports de `statPath`, `mkdirPathLocked`, `removePathLocked`, `searchText`, `searchWorkspaceSymbols`.

### Fase 1 — Confiabilidade para produção local, 1–2 semanas

1. **Remover ciclos ESM:** separar leitura pura, parser puro e índice injetável.
2. **Índice por snapshot:** parsear símbolos a partir do conteúdo já lido.
3. **Paginação universal:** `cursor`, `nextCursor`, `truncated`, `returnedBytes`, `totalKnown/estimated`.
4. **Diferenciar erros silenciosos:** último erro em L2/index/parser/scope; `catch` com evento em `diagnostics_channel`.
5. **Melhor diff/patch:** usar algoritmo de diff real; patch por hunks com `expectedHash`.
6. **Storage estrito:** `readJsonStrict` e migração de schemas.
7. **Webhook HMAC:** assinatura, event id, redaction recursiva e limite de payload.

### Fase 2 — Inteligência de workspace, 2–4 semanas

1. **Parser de projeto robusto:** CommonJS, dynamic import, `module.exports`, métodos, classes, chamadas de registry, tool declarations.
2. **Tree-sitter ou Babel traversal completo:** AST incremental e robusto para TS/JS/JSX/TSX.
3. **Grafo de imports/exports:** resolver aliases, package exports, tsconfig paths e package.json.
4. **Indexador incremental com watcher:** `fs.watch`/chokidar, debounce, fila e backpressure.
5. **Busca híbrida:** FTS + símbolos + grafo + ranking por proximidade/importância/recência.
6. **Context packer para LLM:** montar contexto com budget de tokens e hierarquia: objetivo → arquivos relevantes → símbolos → trechos.

### Fase 3 — Runtime agentic poderoso, 1–2 meses

1. **Transações de agente:** `beginChangeSet`, `apply`, `commit`, `rollback`.
2. **Executor sandboxed:** shell com políticas, timeout, streaming, kill tree, redaction e output cursor.
3. **Integração Git/GitHub:** PRs, reviews, issues, Actions, blame, compare, labels.
4. **Planejador de tarefas:** steps, dependências, validações, checkpointing e replay.
5. **Avaliação automática:** cada mudança roda testes/lint/health e anexa evidências.
6. **Perf profiling:** medir hit ratio, cold-start, index throughput, search latency e memory pressure.

### Fase 4 — Escala multi-runtime, 2–3 meses

1. **L3 cache/distribuído:** Redis/SQLite shared/BroadcastChannel conforme topologia.
2. **Fanout real:** `EventFanout` com transport plugável.
3. **Coordenação interprocesso:** locks distribuídos ou SQLite advisory locks.
4. **Índice compartilhado por workspace:** versionamento, lease, WAL/busy timeout, vacuum.
5. **Governança de capabilities:** perfis `read-only`, `edit`, `dangerous`, `network`, `shell`, `github-write`.

---

## 9. Patch plan objetivo

### Patch 1 — Normalizar locks

- Criar `io-paths.js` com `normalizeResourcePath`, `normalizeResourcePair`.
- Aplicar em `writeFileAtomic`, `appendTextLocked`, `mkdirPathLocked`, `deleteFileLocked`, `removePathLocked`, `copyFileLocked`, `moveFileLocked`, `patchTextLocked`.
- Adicionar testes com path relativo vs absoluto e symlink.

### Patch 2 — Busca segura e paginada

- `RG_SEARCH_TIMEOUT_MS = readEnvPositiveInt('IO_SEARCH_TIMEOUT_MS', 15000)`.
- `maxBuffer` default 8–32 MiB, não 1 GiB.
- `maxResults` aplicado de verdade.
- Retorno com `truncated`, `nextCursor`, `outputBytes`.
- Migrar para `rg --json` para parsing robusto.

### Patch 3 — Índice confiável

- `indexTextFile` usa `parseFileSymbols(filePath, input.content)`.
- `parseError = symbols?.parseError ?? caught`.
- Persistir `truncated` e `parserUnavailable`.
- `getStats` expõe `failedFiles`, `parseErrorFiles`, `truncatedFiles`.

### Patch 4 — Invalidação recursiva

- Hook recebe objeto: `{ filePath, recursive }`.
- Parser cache: se recursive, deletar todos os keys descendentes.
- Scope: marcar descendentes invalidados.
- Índice: já tem delete por prefixo, mas deve receber `recursive` explicitamente.

### Patch 5 — Lockfile correto

- Adquirir com `open('wx')`.
- Escrever JSON com token.
- Release só se token confere.
- Stale detection com `pid`, `hostname`, `startedAt` e idade máxima.

---

## 10. Conclusão

O projeto já tem a intuição certa: uma LLM poderosa precisa de uma camada de I/O canônica, observável, cacheada, indexada e capaz de aquecer contexto. A direção é boa. O risco é que a busca por “máxima liberdade” se traduza, hoje, em caminhos sem timeout, sem paginação, com locks frágeis e sinais de frescor semânticos imprecisos.

A situação ideal não é restringir a LLM; é dar a ela mais poder com contratos mais fortes: transações, rollback, snapshots, timeouts, budgets, índices confiáveis, execução cancelável, logs auditáveis e tools especializadas para código, Git, GitHub e testes.

**Prioridade absoluta:** resolver locks, timeout/budgets de busca, parse status do índice, L2 `mtime`, invalidação recursiva de scopes e normalização de API pública. Depois disso, a infraestrutura pode evoluir para um runtime agentic realmente forte.
