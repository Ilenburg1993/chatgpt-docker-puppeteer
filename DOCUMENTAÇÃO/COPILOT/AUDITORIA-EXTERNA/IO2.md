# Auditoria complementar e proposta estrutural — `src/copilot/infra`

**Data:** 2026-05-14 **Complementa:** `AUDITORIA-COPILOT-INFRA-NODE24-LLM-TOOLS.md` **Escopo:**
arquivos fornecidos como representação de `src/copilot/infra`, com foco em Node 24+ ESM, ferramentas
para LLMs, liberdade operacional controlada, reorganização física e endurecimento arquitetural.

---

## 0. Tese complementar

A auditoria anterior identificou bugs críticos e riscos operacionais. Esta continuação aprofunda o
diagnóstico em um nível estrutural: o problema não é apenas a presença de bugs isolados, mas a
mistura de **camadas com responsabilidades incompatíveis** no mesmo plano de arquivos.

Hoje `src/copilot/infra` concentra, no mesmo nível:

1. Primitivas puras ou quase puras: queue, lock helpers, path/cache key helpers.
2. Kernel de I/O local: leitura, escrita, patch, diff, busca, stat, mkdir, move, copy.
3. Memória semântica: cache L1/L2, parser, scanner, índice FTS/símbolos, session scope.
4. Borda operacional: SSE, fanout, webhooks.
5. Facades/barrels e documentação.

Essa mistura cria três efeitos:

- **Ciclos de importação:** especialmente
  `io-engine -> io-index-registry -> io-index-sqlite -> io-engine` e
  `io-engine -> io-index-registry -> io-index-sqlite -> io-parser -> io-engine`.
- **Política fraca de retorno para LLM:** limites aparecem como metadados, mas não governam saída,
  tempo, bytes ou paginação.
- **Dificuldade de evolução:** qualquer upgrade profundo em busca, índice, parser ou locks tende a
  tocar `io-engine.js`, que já tem cerca de 1.854 linhas.

A situação ideal é transformar `infra/` em um **substrato agentic de capacidades**, com camadas
separadas, acíclicas e testáveis:
`kernel -> io/fs -> cache/index/parse/scan -> services/runtime -> events/adapters -> public barrels`.

---

## 1. Complemento de investigação: fatos mecânicos levantados

### 1.1. Métricas locais

A pasta enviada contém:

| Item                     |                            Valor |
| ------------------------ | -------------------------------: |
| Arquivos JS              |                               23 |
| README                   |                                1 |
| Linhas JS aproximadas    |                            6.674 |
| Maior arquivo            |     `io-engine.js`, 1.854 linhas |
| Segundo maior arquivo    | `io-index-sqlite.js`, 775 linhas |
| Terceiro maior arquivo   |       `io-parser.js`, 557 linhas |
| Ciclos locais detectados |              2 ciclos principais |
| `catch` detectados       |            64 blocos aproximados |

O `node --check` em todos os `.js` enviados não acusou erro de sintaxe no ambiente disponível. Isso
apenas valida sintaxe; não valida aliases, dependências, comportamento de SQLite, compatibilidade de
pacote, testes nem runtime completo.

### 1.2. Grafo local de importações relevantes

Relações locais mais importantes:

```txt
io-engine.js          -> io-cache-l2-registry.js, io-cache.js, io-index-registry.js, io-locks.js, io-observability.js
io-index-registry.js  -> io-cache.js, io-index-sqlite.js
io-index-sqlite.js    -> io-engine.js, io-parser.js, io-scanner.js, io-observability.js
io-parser.js          -> io-cache.js, io-engine.js
io-prefetch.js        -> io-cache.js, io-engine.js, io-index-registry.js, io-parser.js, io-scanner.js
io-session-scope.js   -> io-cache.js, io-index-registry.js, io-parser.js, io-prefetch.js
io-health.js          -> io-cache-l2-registry.js, io-cache-tiering.js, io-cache.js, io-index-registry.js, io-parser.js, io-session-scope.js
```

Ciclos detectados:

```txt
io-engine.js -> io-index-registry.js -> io-index-sqlite.js -> io-engine.js
io-engine.js -> io-index-registry.js -> io-index-sqlite.js -> io-parser.js -> io-engine.js
```

Esses ciclos não necessariamente quebram o ESM hoje porque os bindings são usados tardiamente, mas
são arquiteturalmente frágeis: uma simples chamada top-level futura pode introduzir TDZ,
inicialização parcial ou comportamento diferente em testes.

---

## 2. Achados adicionais não enfatizados na primeira auditoria

### A-01 — `io-engine.js` é engine, facade, busca, diff, patch e adapter de índice ao mesmo tempo

**Severidade:** alta **Evidência:** `io-engine.js` contém leitura, escrita, chunks, stat, mkdir,
delete, rm, copy, move, patch, diff, busca textual e busca simbólica.

O nome “engine” sugere uma porta canônica, mas o arquivo virou um **módulo-orquestrador
monolítico**. Ele importa índice para otimizar busca, ao mesmo tempo em que o índice importa a
engine para ler arquivos. Esse é o núcleo do ciclo.

**Correção estrutural:** decompor em módulos inferiores e serviços superiores:

- Baixo nível: `io/fs/read-text.js`, `io/fs/write-atomic.js`, `io/fs/mutate.js`.
- Alto nível: `io/search/text-search.js`, `io/search/symbol-search.js`.
- Facade pública: `public/io.js` ou `io/index.js`.

O índice nunca deve importar a facade que também importa o índice. Ele deve receber um `readText` de
baixo nível ou uma porta injetada.

---

### A-02 — O parser não é puro; ele lê disco e depende do engine

**Severidade:** alta **Evidência:** `parseAndCacheSymbols(filePath)` chama `readText(filePath)` e
importa `io-engine.js`.

Isso impede que `parse/` seja usado como biblioteca pura por indexador, session scope e testes.
Também participa do ciclo com `io-engine`.

**Correção ideal:** separar:

- `parse/js-ts-parser.js`: `parseFileSymbols(filePath, content)` puro.
- `parse/json-outline.js`, `parse/markdown-outline.js`: funções puras.
- `index/symbol-cache.js` ou `session/symbol-cache.js`: combina leitura + parser + cache.

Regra: `parse/` não importa `io/`, `cache/`, `index/` nem `session/`.

---

### A-03 — O índice usa busca FTS global e filtra `pathPrefix` depois

**Severidade:** média/alta **Evidência:** `search(query, options)` executa `stmtSearch.all(safe)` e
só depois filtra `row.filePath` por `pathPrefix`.

Em workspaces grandes, isso transforma uma busca escopada em uma busca global com filtro em memória.
O problema se agrava porque não há `LIMIT`, cursor ou paginação.

**Correção ideal:** usar SQL parametrizado com escopo:

```sql
SELECT ...
FROM copilot_io_index_fts
WHERE copilot_io_index_fts MATCH ?
  AND (file_path = ? OR file_path LIKE ?)
ORDER BY rank
LIMIT ? OFFSET ?;
```

E retornar:

```js
{
  rows,
  nextCursor,
  truncated,
  queryPlan: 'fts5-scoped'
}
```

---

### A-04 — `readTextChunks()` não sabe o total real de linhas quando `endLine` é usado

**Severidade:** média **Evidência:** o loop interrompe quando `totalLines > endLine`; portanto
`totalLines` representa as linhas percorridas até a interrupção, não o total real do arquivo.

Para tools LLM, `totalLines` é metadado de navegação. Se ele não é real, paginação, continuação e
range planning podem ficar incorretos.

**Correção ideal:** renomear para `scannedLines` ou continuar a contagem sem acumular conteúdo.
Alternativamente retornar:

```js
{
  totalLinesKnown: false,
  scannedLines,
  returnedRange,
  hasMoreAfter: true
}
```

---

### A-05 — Parser JSON quebra arrays JSON formatados em múltiplas linhas

**Severidade:** média **Evidência:** `extractJsonSchema` faz
`content.trimStart().startsWith('[') ? JSON.parse(content.split('\n')[0]) : JSON.parse(content)`.

Um JSON comum como:

```json
[
  { "id": 1 }
]
```

terá primeira linha `[` e falhará. O comentário fala em JSON/JSONL, mas a heurística confunde array
JSON com “primeira linha”.

**Correção ideal:**

1. Tentar `JSON.parse(content)` sempre.
2. Se falhar e o arquivo for `.jsonl`, parsear primeira linha não vazia.
3. Adicionar suporte explícito a `.jsonc` se o índice pretende indexar `.jsonc` como JSON.

---

### A-06 — `.jsonc` é indexado como JSON, mas parser classifica como `unknown`

**Severidade:** média **Evidência:** `io-index-sqlite.js` inclui `.jsonc` em
`DEFAULT_INDEX_EXTENSIONS`, mas `io-parser.js` só trata `.json` e `.jsonl` como JSON.

**Impacto:** health/índice podem sugerir suporte mais amplo do que o parser realmente entrega.

**Correção ideal:** ou remover `.jsonc` da lista semântica, ou suportar JSONC com parser tolerante a
comentários/trailing commas.

---

### A-07 — Extração simbólica promete CommonJS/dynamic imports, mas implementa majoritariamente ESM top-level

**Severidade:** média/alta **Evidência:** typedef inclui `ImportEntry.isDynamic`; documentação
menciona ESM e CommonJS; implementação extrai `ImportDeclaration`, `ExportNamedDeclaration`,
`ExportDefaultDeclaration` e `ExportAllDeclaration`, mas não percorre AST para `import()`,
`require()`, `module.exports` ou `exports.foo`.

**Impacto:** em Node ESM moderno o prejuízo é menor, mas projetos reais ainda usam `.cjs`,
`require`, exports condicionais, dynamic import, barrel re-exports e side-effect imports.

**Correção ideal:** adicionar traversal AST simples para:

- `CallExpression` com callee `Import`.
- `CallExpression` com callee `Identifier(require)`.
- `AssignmentExpression` para `module.exports` e `exports.*`.
- `ExportNamedDeclaration` com declaration deve popular também `exports` com nomes declarados.

---

### A-08 — Markdown outline perde linha real do heading

**Severidade:** baixa/média **Evidência:** `extractMarkdownOutline` retorna apenas strings, e
`parseFileSymbols` usa o índice do array como linha (`i + 1`).

**Impacto:** contexto para LLM aponta linhas erradas em Markdown com texto antes dos headings.

**Correção ideal:** retornar `{ heading, line, depth }` em vez de string.

---

### A-09 — Cache de parser usa path cru como chave

**Severidade:** média/alta **Evidência:** `_symbolCache.get(filePath)`,
`_symbolCache.set(filePath, symbols)` e `_symbolCache.delete(filePath)` usam o argumento recebido.

**Impacto:** `./src/a.js`, `/abs/src/a.js`, path com symlink e path normalizado viram entradas
diferentes. A invalidação pode falhar pelo mesmo motivo.

**Correção ideal:** centralizar `normalizeResourcePath()` e usar sempre em cache, locks, índice e
invalidation bus.

---

### A-10 — `index.js` público não exporta parte relevante da própria engine

**Severidade:** média **Evidência:** exports de `io-engine.js` ausentes no barrel atual:

- `statPath`
- `mkdirPathLocked`
- `removePathLocked`
- `searchText`
- `searchWorkspaceSymbols`

Também não exporta `warmReadThroughContext` de `io-prefetch.js` nem `registerInvalidationHook` de
`io-cache.js`.

**Impacto:** consumidores podem importar arquivos internos diretamente, criando acoplamento e
furando a arquitetura.

**Correção ideal:** criar barrels explícitos por domínio:

- `public/io.js`
- `public/cache.js`
- `public/indexing.js`
- `public/session.js`
- `public/events.js`

E manter `infra/index.js` apenas como compatibilidade.

---

### A-11 — `scanDirectory()` pode criar fan-out grande por diretório

**Severidade:** média **Evidência:** a função usa `Promise.all(names.map(...))` por diretório. O
`p-limit` limita `lstat`, mas a quantidade de promises criadas ainda acompanha o tamanho bruto do
diretório.

**Impacto:** diretórios com dezenas/centenas de milhares de entradas podem gerar pressão de memória
antes que o limite de I/O ajude.

**Correção ideal:** usar worker pool ou iteração assíncrona com batches:

```js
for (const batch of chunk(names, 512)) {
  const entries = await Promise.all(batch.map(processOne));
}
```

Ou usar `opendir()` com streaming.

---

### A-12 — Webhook sanitizer é raso e entrega não é autenticada

**Severidade:** alta para produção **Evidência:** `#sanitizePayload` varre apenas
`Object.entries(payload)` de primeiro nível; a entrega usa JSON simples sem assinatura HMAC ou
idempotency key.

**Impacto:** payloads aninhados podem conter segredo; receptores não conseguem verificar
origem/integridade; replays são difíceis de detectar.

**Correção ideal:**

- Sanitização profunda com limite de profundidade e detecção de ciclos.
- HMAC: `X-Copilot-Signature-256`.
- `X-Copilot-Event`, `X-Copilot-Delivery`, timestamp e tolerância contra replay.
- Outbox persistente se entrega for importante.

---

## 3. Diagnóstico arquitetural: o que a pasta deveria ser

Para um runtime de tools LLM com “máxima liberdade e poder”, a infra não deve ser apenas uma coleção
de helpers. Ela deve ser uma **máquina de capacidades**:

1. **Toda ação tem capacidade declarada:** leitura, escrita, delete, network, webhook, git, github,
   shell.
2. **Toda ação tem orçamento:** tempo, bytes lidos, bytes retornados, número de arquivos, número de
   mutações, risco.
3. **Toda mutação é observável:** trace, diff, snapshot anterior, rollback quando possível.
4. **Toda saída para LLM é paginável:** cursor, range, truncation metadata.
5. **Toda memória semântica é derivada:** cache/índice/parser nunca são fonte de verdade; a verdade
   é filesystem + VCS + policies.
6. **Toda camada é acíclica:** módulos baixos não importam serviços altos.

A estrutura física deve codificar essas regras. Se a árvore de pastas não expressa a arquitetura, a
arquitetura se dissolve rapidamente.

---

## 4. Nova estrutura proposta para `src/copilot/infra`

### 4.1. Árvore alvo rigorosa

```txt
src/copilot/infra/
  README.md
  index.js                         # barrel de compatibilidade; sem lógica

  public/
    io.js                          # facade pública de I/O local
    cache.js                       # facade pública de cache/tiers
    indexing.js                    # facade pública de índice/busca simbólica
    session.js                     # facade pública de escopos LLM
    events.js                      # facade pública de SSE/webhooks/fanout
    health.js                      # facade pública de health snapshots
    testing.js                     # exports explícitos para testes

  shared/
    env.js                         # leitura/validação de envs numéricos/booleanos
    time.js                        # nowMs/performance abstraída
    result.js                      # Result/Ok/Err opcional; sem dependências externas
    errors.js                      # erros infra padronizados
    disposable.js                  # helpers de cleanup/unref/dispose
    object.js                      # deepFreeze, safeJson, stableStringify

  observability/
    channels.js                    # diagnostics_channel names
    publisher.js                   # publishOperation/publishLifecycle
    redaction.js                   # sanitização profunda comum
    metrics.js                     # agregadores locais simples
    health-snapshot.js             # readInfraHealthSnapshot()

  policy/
    capabilities.js                # capability model: read/write/delete/network/git/github
    budgets.js                     # tempo, bytes, arquivos, resultados, risco
    output-window.js               # truncation/cursor/window para retorno LLM
    path-resource.js               # canonical path/resource key
    risk.js                        # low/medium/high/critical + policy helpers

  locks/
    async-resource-lock.js          # antigo io-locks.js, com resource key canônico
    file-lock.js                   # antigo lockfile.js, com aquisição atômica
    lock-registry.js               # stats/diagnóstico/test reset
    index.js

  queue/
    async-queue.js                 # antigo queue.js, validado e abortável
    index.js

  storage/
    json-store.js                  # antigo storage.js
    atomic-file.js                 # write temp + rename + fsync opcional
    index.js

  io/
    fs/
      read-bytes.js
      read-text.js
      read-lines.js
      read-chunks.js
      stat.js
      write-atomic.js
      append.js
      mkdir.js
      remove.js
      copy.js
      move.js
      index.js
    patch/
      text-patch.js
      text-diff.js
      index.js
    search/
      text-search.js               # compõe índice + rg + grep
      symbol-search.js             # compõe índice + rg
      rg-adapter.js
      grep-adapter.js
      search-budget.js
      result-paginator.js
      index.js
    invalidation/
      bus.js                       # evento canônico: path, recursive, reason, traceId
      events.js
      index.js
    index.js                       # facade interna de io/*

  cache/
    l1/
      keys.js                      # makeBytesKey/makeTextKey
      memory-cache.js              # antigo io-cache.js sem hooks globais crus
      registry.js
      index.js
    l2/
      sqlite-schema.js
      sqlite-cache.js              # antigo io-cache-l2-sqlite.js
      registry.js                  # antigo io-cache-l2-registry.js
      migrations.js
      index.js
    tiering/
      plan.js                      # antigo io-cache-tiering.js
      aggregate.js
      index.js
    index.js

  scan/
    scanner.js                     # antigo io-scanner.js, preferencialmente com opendir/batches
    gitignore.js
    glob.js
    fingerprint.js
    basename.js
    index.js

  parse/
    js-ts-parser.js                # puro: content -> symbols/imports/exports
    json-outline.js                # JSON/JSONL/JSONC separado
    markdown-outline.js            # preserva linha/depth
    comments.js
    outline.js
    types.js                       # JSDoc typedefs ou .d.ts se migrar a TS
    index.js

  index-store/
    sqlite/
      schema.js
      statements.js
      repository.js                # CRUD baixo nível
      migrations.js
      fts-query.js
    indexer.js                     # scan + read + parse + persist
    symbol-repository.js
    registry.js                    # antigo io-index-registry.js
    search.js                      # busca FTS escopada, paginada
    freshness.js
    index.js

  prefetch/
    warm-cache.js                  # antigo warmCacheForPaths/warmFromDirectory
    read-through-context.js
    import-resolver.js
    recent-paths.js
    index.js

  session/
    scope-registry.js
    declare-scope.js
    refresh-scope.js
    context-snapshot.js
    symbol-cache.js                # leitura + parse + cache, fora de parse puro
    index.js

  runtime/
    operation.js                   # envelope: plan/apply/result para tool actions
    transaction.js                 # grupo de mutações + rollback metadata
    rollback.js                    # estratégia de reversão local
    planner.js                     # dry-run/plano para LLM
    audit-log.js                   # append-only log opcional
    index.js

  events/
    fanout/
      event-fanout.js              # antigo fanout.js
      transports/
        in-process.js
        broadcast-channel.js       # futuro
        redis.js                   # futuro
      index.js
    sse/
      replay-buffer.js             # antigo replay-buffer.js
      state.js                     # antigo state.js
      writer.js                    # se existir fora da pasta atual
      index.js
    webhooks/
      manager.js                   # antigo webhooks.js
      sanitizer.js                 # sanitização profunda
      signer.js                    # HMAC
      delivery.js                  # retry/outbox/idempotência
      index.js
    index.js

  __tests__/
    locks.test.js
    queue.test.js
    parser.test.js
    json-outline.test.js
    scanner.test.js
    io-search-budget.test.js
    index-store.test.js
    session-invalidation.test.js
    webhooks-sanitizer.test.js
```

### 4.2. Por que `index-store/` e não `index/`?

`index.js` é tradicionalmente usado como barrel. Uma pasta chamada `index/` dentro de uma base ESM
pode gerar ambiguidades cognitivas com `index.js`. `index-store/` deixa claro que se trata de um
índice persistente/semântico, não do barrel do pacote.

Se a preferência do projeto for manter o nome curto, usar `semantic-index/` também é aceitável.

---

## 5. Mapa de migração dos arquivos atuais

| Arquivo atual             | Destino proposto                                                              | Observação                                                       |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `di-tokens.js`            | `public/di-tokens.js` ou remover                                              | Arquivo vazio/especulativo; manter só se DI real voltar.         |
| `queue.js`                | `queue/async-queue.js`                                                        | Validar `concurrency`, adicionar abort/timeout e `onIdle`.       |
| `storage.js`              | `storage/json-store.js`                                                       | Depender de `storage/atomic-file.js`, não de facade monolítica.  |
| `lockfile.js`             | `locks/file-lock.js`                                                          | Reescrever com aquisição atômica `wx`/`mkdir` e token de dono.   |
| `io-locks.js`             | `locks/async-resource-lock.js`                                                | Usar `policy/path-resource.js` para chave canônica.              |
| `io-observability.js`     | `observability/publisher.js` + `observability/channels.js`                    | Separar nomes de canal, publicação e redaction.                  |
| `io-cache.js`             | `cache/l1/memory-cache.js`, `cache/l1/keys.js`, `io/invalidation/bus.js`      | Remover hook global cru por evento tipado.                       |
| `io-cache-l2-sqlite.js`   | `cache/l2/sqlite-cache.js` + `cache/l2/sqlite-schema.js`                      | Corrigir `mtime_ms`/`ctime_ms`; adicionar migrations.            |
| `io-cache-l2-registry.js` | `cache/l2/registry.js`                                                        | Health com último erro e estado de migrations.                   |
| `io-cache-tiering.js`     | `cache/tiering/plan.js` + `aggregate.js`                                      | Manter simples.                                                  |
| `io-engine.js`            | `io/fs/*`, `io/patch/*`, `io/search/*`, `public/io.js`                        | Maior migração; deve ser quebrada por função.                    |
| `io-scanner.js`           | `scan/scanner.js`, `scan/glob.js`, `scan/gitignore.js`, `scan/fingerprint.js` | Trocar fan-out ilimitado por batches/stream.                     |
| `io-parser.js`            | `parse/*` + `session/symbol-cache.js`                                         | Parser puro separado de leitura/cache.                           |
| `io-index-sqlite.js`      | `index-store/sqlite/*`, `index-store/indexer.js`, `index-store/search.js`     | Remover dependência da facade de I/O.                            |
| `io-index-registry.js`    | `index-store/registry.js`                                                     | Registry depende de store, não da engine.                        |
| `io-prefetch.js`          | `prefetch/*`                                                                  | `read-through-context` vira serviço separado.                    |
| `io-session-scope.js`     | `session/*`                                                                   | Registry, declare, refresh e context snapshot separados.         |
| `io-health.js`            | `observability/health-snapshot.js` + `public/health.js`                       | Health deve ser leitura, sem inicializar pesado sem necessidade. |
| `webhooks.js`             | `events/webhooks/*`                                                           | Separar manager, sanitizer, signer e delivery.                   |
| `fanout.js`               | `events/fanout/event-fanout.js`                                               | Preparar transport plugável.                                     |
| `replay-buffer.js`        | `events/sse/replay-buffer.js`                                                 | Manter quase igual, validar tamanho.                             |
| `state.js`                | `events/sse/state.js`                                                         | Manter, mas expor via `events/sse/index.js`.                     |
| `index.js`                | `index.js` + `public/*.js`                                                    | Compatibilidade apenas; lógica zero.                             |
| `README.md`               | `README.md` + docs por domínio                                                | README raiz vira mapa e regras de importação.                    |

---

## 6. Regras arquiteturais obrigatórias após a migração

### 6.1. Regra de dependência

```txt
shared
  ↓
policy + observability + locks + queue + storage
  ↓
io/fs + scan + parse
  ↓
cache + index-store
  ↓
prefetch + session + io/search
  ↓
runtime
  ↓
events + public
```

Nenhuma seta inversa deve existir.

### 6.2. Proibições explícitas

1. `parse/` não importa `io/`, `cache/`, `index-store/`, `session/` ou `runtime/`.
2. `io/fs/` não importa `index-store/`, `prefetch/`, `session/`, `runtime/` ou `events/`.
3. `index-store/` não importa `public/` nem `io/search/`; só pode importar `io/fs/read-text.js` ou
   uma porta injetada.
4. `events/` não importa `io/fs/` para buscar payloads; recebe payload pronto.
5. `public/` não contém lógica; apenas exports e compatibilidade.
6. Módulos de baixo nível não leem `process.env` diretamente; usam `shared/env.js`.
7. Todo retorno potencialmente grande passa por `policy/output-window.js`.

### 6.3. Interface de invalidação tipada

Substituir hooks `hook(filePath)` por eventos tipados:

```js
/**
 * @typedef {object} InvalidationEvent
 * @property {string} path
 * @property {string} normalizedPath
 * @property {boolean} recursive
 * @property {'write'|'append'|'delete'|'move'|'copy'|'patch'|'external'} reason
 * @property {string} traceId
 * @property {number} ts
 */
```

Isso corrige a invalidação recursiva de scopes e permite que L1, L2, parser e índice reajam de modo
coerente.

### 6.4. Interface de orçamento de saída para LLM

Todo serviço que retorna texto/lista deve aceitar:

```js
{
  maxBytes?: number,
  maxItems?: number,
  cursor?: string,
  timeoutMs?: number,
  signal?: AbortSignal
}
```

E retornar:

```js
{
  items,
  text,
  bytesReturned,
  truncated,
  nextCursor,
  budget: {
    maxBytes,
    maxItems,
    timeoutMs,
    elapsedMs
  }
}
```

“Limites informativos” podem continuar existindo para telemetria interna, mas a borda de tool
precisa de limite real.

---

## 7. Situação ideal para tools LLM com máxima liberdade

A liberdade da LLM deve ser ampliada por **composição segura**, não por acesso cru. A situação ideal
inclui:

### 7.1. Operações como unidades agentic

Toda ação de tool deve ser representada por um envelope:

```js
{
  id,
  traceId,
  capability: 'filesystem.write',
  risk: 'high',
  plan,
  preconditions,
  apply,
  rollback,
  evidence,
  result
}
```

Isso permite dry-run, revisão, replay, auditoria e rollback.

### 7.2. Mutação com snapshot e rollback

Para `write`, `patch`, `move`, `delete`:

- Capturar fingerprint anterior.
- Capturar conteúdo anterior quando tamanho permitir ou registrar backup temporário.
- Aplicar mutação.
- Invalidar caches/índice via bus.
- Registrar diff.
- Retornar rollback token.

### 7.3. Busca semântica escalável

Busca ideal em três níveis:

1. Índice FTS/símbolos escopado, paginado e fresco.
2. `rg --json` com timeout e max bytes.
3. Scanner fallback com batches e output window.

### 7.4. Session scope como “working set” real

`session/` deve virar uma camada de memória de sessão:

- Declaração de escopo.
- Prefetch controlado.
- Índice simbólico normalizado.
- Freshness por fingerprint.
- Invalidação recursiva.
- Snapshot compacto para LLM.
- Context packs por budget: `small`, `medium`, `deep`.

### 7.5. Git/GitHub como capability posterior

No contexto de GitHub/Copilot SDK, a infra deve estar pronta para capabilities como:

- `git.status`, `git.diff`, `git.applyPatch`, `git.rollback`, `git.commitDraft`.
- `github.issue.read`, `github.pr.read`, `github.pr.review`, `github.checks.read`.
- `repo.planChange`, `repo.applyChange`, `repo.explainImpact`.

Mas essas capabilities não devem ficar misturadas no kernel de I/O. Elas pertencem a `runtime/` ou a
uma camada acima de `infra/`, consumindo `public/io.js`, `public/indexing.js` e `public/session.js`.

---

## 8. Roadmap de aprimoramento

### Fase 0 — Estabilização antes da reorganização

Objetivo: corrigir bugs que podem corromper estado ou travar tools.

1. Validar `AsyncQueue.concurrency >= 1`.
2. Tornar `lockfile` atômico e dono-verificável.
3. Normalizar resource keys em `io-locks` e `io-engine`.
4. Aplicar timeout real e `maxBuffer` baixo em `rg`/`grep`.
5. Aplicar `maxResults`/`maxBytes` de verdade em `searchText` e `searchWorkspaceSymbols`.
6. Corrigir `parseError` do índice usando `symbols?.parseError`.
7. Corrigir L2 SQLite `mtime_ms`/`ctime_ms` para `REAL` ou coerção consistente.
8. Tipar invalidação com `{ recursive }` e corrigir session scope.
9. Normalizar cache key do parser.
10. Criar testes de regressão para cada item.

### Fase 1 — Quebra do monólito `io-engine.js`

Objetivo: decompor sem mudar API pública.

1. Criar `io/fs/read-text.js`, `read-bytes.js`, `write-atomic.js`, `mutate.js`.
2. Mover funções uma a uma mantendo re-export em `io-engine.js` temporário.
3. Criar `io/search/text-search.js` e `symbol-search.js`.
4. Fazer `io-engine.js` virar facade compatível ou deprecá-lo.
5. Atualizar imports internos para módulos específicos, não para a facade.

### Fase 2 — Separar parser puro e index-store

Objetivo: eliminar ciclos.

1. Mover parsing puro para `parse/`.
2. Criar `session/symbol-cache.js` para leitura + parse + cache.
3. Refatorar `index-store/indexer.js` para depender de `io/fs/read-text.js` e `parse/`, não de
   `io-engine.js`.
4. Refatorar busca para `io/search`, que pode consultar `index-store/search.js`.
5. Rodar verificador de ciclos no CI.

### Fase 3 — Output budgets e paginação para LLM

Objetivo: tornar tools robustas sob liberdade alta.

1. Criar `policy/output-window.js`.
2. Padronizar `{ maxBytes, maxItems, cursor, timeoutMs }`.
3. Retornar `{ truncated, nextCursor }` em scan, search, read chunks, symbol search.
4. Trocar `rg` stdout bruto por `rg --json` incremental.
5. Adicionar budgets por perfil: `interactive`, `deep-audit`, `batch`.

### Fase 4 — Runtime de operações agentic

Objetivo: preparar autonomia com controle.

1. Criar `runtime/operation.js`.
2. Criar `runtime/transaction.js` para grupos de mutações.
3. Criar rollback local para write/patch/delete/move.
4. Adicionar audit log append-only.
5. Integrar health e observability por trace.

### Fase 5 — Eventos/webhooks endurecidos

Objetivo: bordas seguras.

1. Sanitização profunda.
2. HMAC para webhooks.
3. Delivery idempotente.
4. Outbox opcional.
5. Fanout transport plugável.

### Fase 6 — Remoção de compatibilidade antiga

Objetivo: limpar dívida.

1. Deprecar imports diretos de `io-engine.js`.
2. Remover facades antigas depois de duas versões internas.
3. Congelar regras de importação no CI.
4. Documentar arquitetura final no README raiz e READMEs por domínio.

---

## 9. Testes mínimos obrigatórios

### 9.1. Locks

- Dois paths equivalentes (`./a.js` e `/abs/a.js`) devem adquirir o mesmo lock.
- `file-lock` deve falhar atomicamente quando dois processos tentam adquirir.
- `release` não pode remover lock de outro processo/token.

### 9.2. Queue

- `concurrency=0`, negativo, `NaN` e `Infinity` devem lançar `RangeError` ou normalizar
  explicitamente.
- `clear()` deve rejeitar pendentes.
- `onIdle()` deve resolver quando fila e execução zerarem.

### 9.3. Parser

- `export function foo(){}` deve aparecer em `symbols` e em `exports`.
- `module.exports = { foo }` deve ser reconhecido em `.cjs`.
- `const x = await import('./x.js')` deve produzir import dinâmico.
- JSON array multi-linha deve extrair shape.
- JSONL deve usar primeira linha válida.
- Markdown heading deve preservar linha real.

### 9.4. Índice

- Arquivo com `parseError` deve persistir `status='failed'`.
- Busca com `pathPrefix` deve filtrar no SQL.
- Busca deve respeitar `limit/cursor`.
- `invalidatePath(dir, recursive=true)` deve remover descendentes.

### 9.5. Search/budgets

- `maxResults=5` retorna no máximo 5 itens.
- `maxBytes` trunca com `truncated=true` e `nextCursor`.
- Timeout aborta `rg`/`grep`.
- `rg` indisponível cai para fallback com os mesmos budgets.

### 9.6. Session scope

- Invalidar diretório invalida símbolos dos filhos.
- Refresh normaliza paths.
- Scope fechado cancela/ignora warm-up pendente.

### 9.7. Webhooks

- Sanitização profunda remove `token`, `authorization`, `password`, `secret`, `key` em objetos
  aninhados.
- Assinatura HMAC é gerada e verificável.
- 4xx não faz retry; 5xx faz retry; timeout limpa timers.

---

## 10. Ordem prática de PRs

### PR 1 — Safety hotfixes

- Queue validation.
- Search timeout/maxBuffer/maxResults real.
- Index parseError status.
- Parser cache path normalization.
- L2 timestamp type/coercion.

### PR 2 — Lock correctness

- Resource key canonical.
- Lockfile atomic.
- Tests de concorrência.

### PR 3 — Invalidation bus

- Evento tipado.
- L1/L2/parser/index/session subscribers.
- Recursive invalidation real.

### PR 4 — Split `io-engine`

- Mover read/write/mutate para `io/fs`.
- Facade compatível.
- Atualizar imports internos.

### PR 5 — Parser puro

- Criar `parse/` puro.
- Mover read+cache para `session/symbol-cache.js`.
- Corrigir JSON/JSONC/Markdown/CommonJS/dynamic import.

### PR 6 — Index-store acíclico

- Mover SQLite para `index-store/`.
- Remover import de facade.
- Busca escopada no SQL.

### PR 7 — Runtime agentic

- Operation envelope.
- Transaction + rollback.
- Audit log.

### PR 8 — Events hardening

- Webhook signer/sanitizer/deep redaction.
- Fanout transports preparados.

---

## 11. Critérios de aceite da nova arquitetura

A migração só deve ser considerada concluída quando:

1. `madge` ou ferramenta equivalente reportar **zero ciclos** em `src/copilot/infra`.
2. Nenhum arquivo em `parse/` importar `io/`.
3. Nenhum arquivo em `io/fs/` importar `index-store/`.
4. `io-engine.js` tiver sido reduzido a facade compatível ou removido.
5. Toda busca retornar `truncated` e `nextCursor` quando aplicável.
6. Toda mutação publicar invalidação tipada.
7. Todo lock usar resource key canônico.
8. O barrel público exportar tudo que é API pública e nada que seja detalhe interno.
9. Testes cobrirem locks, parser, índice, busca, invalidação e budgets.
10. README documentar regras de importação e matriz de capabilities.

---

## 12. Conclusão

A arquitetura atual é promissora, mas está no ponto exato em que precisa deixar de crescer
horizontalmente em arquivos monolíticos e passar a crescer verticalmente por camadas. O objetivo não
é reduzir poder da LLM; é criar um substrato em que a LLM possa agir com mais profundidade, sabendo
que cada ação terá lock correto, budget, trace, invalidação, rollback e saída paginada.

A reorganização proposta não é meramente estética. Ela corrige a causa de vários bugs já observados:
ciclos, parser impuro, engine inchada, busca sem orçamento, invalidação sem semântica recursiva e
bordas de evento pouco endurecidas. O melhor caminho é migrar por compatibilidade: primeiro
estabilizar, depois quebrar o monólito, depois impor regras de importação e finalmente introduzir
runtime agentic.
