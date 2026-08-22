# A.13 — Decisões de Performance de I/O baseadas em evidência

**Data**: 2026-05-07 **Benchmark**: `benchmarks/io-read-benchmark.mjs` **Resultados brutos**:
`benchmarks/io-read-benchmark-results.json`

---

## 1. Resultados do benchmark (Node.js 24, devcontainer Debian 12)

| Operação                   | 4 KB       | 256 KB     | 2 MB       |
| -------------------------- | ---------- | ---------- | ---------- |
| `fs.readFile`              | ~3.3K op/s | ~2.6K op/s | ~890 op/s  |
| `stream.ReadStream`        | ~3.7K op/s | ~1.9K op/s | ~320 op/s  |
| `io-engine miss (L1 cold)` | ~2.8K op/s | ~2.8K op/s | ~900 op/s  |
| `io-engine hit (L1 warm)`  | ~350K op/s | ~365K op/s | ~370K op/s |
| `l1-cache.get direto`      | ~4.8M op/s | ~8.7M op/s | ~5.1M op/s |

### Speedup L1 vs fs.readFile

| Tamanho | L1 speedup | Gate mínimo | Status |
| ------- | ---------- | ----------- | ------ |
| 4 KB    | 1452x      | 10x         | ✅     |
| 256 KB  | 3383x      | 10x         | ✅     |
| 2 MB    | 5773x      | 10x         | ✅     |

### Hit/miss ratio do io-engine

| Tamanho | Ratio |
| ------- | ----- |
| 4 KB    | 126x  |
| 256 KB  | 132x  |
| 2 MB    | 408x  |

---

## 2. Decisões arquiteturais justificadas por estes números

### R5 — Cache L1 — ADOTADO ✅

**Justificativa**: L1 hit é >100x mais rápido que I/O frio em qualquer tamanho. Para workloads com
releituras de mesmo arquivo (ex: chat, session FS, mirror), o ganho é proporcional ao número de
re-reads. Workloads sem releituras não pagam custo adicional (apenas overhead de Map.get no hot path
de miss).

**Critérios de rollback**:

- Medir com `getIoCacheStats()` em produção: se `hits / (hits + misses) < 0.05` em workload típico,
  desabilitar via `IO_L1_CACHE_MAX_ENTRIES=0` ou `IO_L1_CACHE_TTL_MS=0`.
- Se memória cresce acima de threshold: reduzir `IO_L1_CACHE_MAX_ENTRIES`.

**Configuração de production recomendada**:

- `IO_L1_CACHE_TTL_MS=60000` (60s) — padrão
- `IO_L1_CACHE_MAX_ENTRIES=2000` — padrão
- Ajustar `MAX_ENTRIES` se o workspace tiver >2000 arquivos únicos ativos.

---

### R3 — `readFile` vs `stream` para threshold

**Resultado**: `ReadStream` é mais lento que `readFile` para arquivos pequenos (<64KB). Threshold
mínimo para stream ser vantajoso: **>512KB** (2MB: stream 3.4x mais lento).

**Decisão**: usar `fs.readFile` por padrão. Migrar para `stream` apenas quando:

- Arquivo > 10MB (evitar alocação de buffer enorme)
- Chamada tem `startLine`/`endLine` E arquivo > 1MB (evitar ler todo para slice pequeno)

**Critério de rollback**: se p99 de `readBytes` cresce >2x baseline sem cache hit, investigar
pressão de memória e considerar FileHandle + read por chunk.

---

### R6 — FTS5 SQLite — POSPOSTO

**Justificativa**: L1 cache cobre releituras de arquivo completo com speedup de 1000-5000x. FTS5
resolve busca textual cross-file, não releitura de arquivo já carregado. São problemas distintos.

**Critério de adoção de R6**: medir latência de `search_in_files` em workspaces reais com
`hyperfine 'rg "pattern" src/'`. Se p50 > 200ms em workspaces com >500 arquivos JS, FTS é
justificado.

---

### R7 — Scanner incremental e watcher — POSPOSTO

**Justificativa**: scanner frio (`scanDirectory`) usa io-scanner com denylist. Watcher adicionaria
complexidade sem evidência de que re-scan é gargalo atual.

**Critério de adoção de R7**:

- Medir frequência de invocações de `scanDirectory` em logs de produção
- Se > 10 invocações/minuto do mesmo path, watcher é justificado

---

### R12 — Benchmarks e gates — GATE ESTABELECIDO

**Gate mínimo para L1**: speedup >= 10x vs `fs.readFile` ✅ (medido: 1452-5773x) **Gate mínimo para
adoção de stream**: arquivo > 10MB (não medido nesta suite)

---

## 3. Plano de paginação/stream em mirror para workspaces grandes

Para workspaces > 10GB de arquivos JS (improvável mas possível em monorepos):

1. **Short term**: `readText` com `startLine`/`endLine` já implementado — limita alocação por
   operação.
2. **Medium term**: se `readBytes` for chamado em arquivo > 10MB, usar `fs.createReadStream` +
   chunked buffer.
3. **Long term**: FileHandle pool para arquivos frequentemente acessados > 1MB.

**Invariante**: nenhuma operação aloca buffer > `options.maxBytes ?? IO_DEFAULT_MAX_BYTES`.

---

## 4. Critérios de evidência para próximos cortes

| Corte            | Critério para ativar                         |
| ---------------- | -------------------------------------------- |
| R6 FTS           | `rg` p50 > 200ms em workspace típico         |
| R7 watcher       | > 10 `scanDirectory` calls/min em mesmo path |
| R3 stream        | arquivo > 10MB no hot path de leitura        |
| Cache LRU tuning | `evictions / (hits + misses) > 0.10`         |

---

## 5. Atualização contínua A.13.2 (2026-05-07)

### 5.1 Microbench sintético do hot path (novo)

Foi adicionado ao `io-read-benchmark.mjs` o cenário `map.get baseline` para comparação direta de
custo de lookup.

Resultados (op/s aproximado):

| Operação sintética               |   4 KB | 256 KB |   2 MB |
| -------------------------------- | -----: | -----: | -----: |
| `l1-cache.get` (io L1 real)      |  ~7.4M |  ~8.3M |  ~7.5M |
| `map.get baseline`               | ~13.7M | ~14.8M | ~13.7M |
| `lru-cache.get` (instância pura) | ~17.7M | ~17.0M | ~17.6M |

Leitura executiva:

- o hot path de lookup segue na ordem de **milhões de op/s**;
- overhead do wrapper canônico do L1 é aceitável frente ao ganho global de cache hit vs I/O frio;
- não há evidência de gargalo no `get` do cache para workloads reais atuais.

### 5.2 Hyperfine de R6/R7 (rodada contínua)

Arquivos:

- `benchmarks/hyperfine-rg-a13.json`
- `benchmarks/hyperfine-scan-a13.json`

Resultados:

- `rg "io-engine" src/copilot/`: **~11.25ms mean** (p50 ~11.51ms)
- `scanDirectory` depth=3 (`showHidden=false`): **~271ms mean**
- `scanDirectory` depth=3 (`showHidden=true`): **~270ms mean**

Decisão mantida:

- **R6 (FTS)** permanece posposto (muito abaixo do gatilho de p50 > 200ms para busca textual);
- **R7 (watcher)** permanece posposto até evidência de frequência alta de re-scan por mesmo path.

---

## 5. Rodada contínua (A.13.1) — hyperfine + comparação opcional com `lru-cache`

**Data**: 2026-05-07 (execução adicional)

### 5.1 Busca textual (`rg`) via hyperfine

Artefato: `benchmarks/hyperfine-rg-a13.json`

- `rg "traceId" src/copilot`: **~9.7 ms** (mean)
- `rg "workspace/mirror" src/copilot`: **~9.4 ms** (mean)

Leitura arquitetural:

- Latência de busca textual local segue **muito abaixo** do gatilho de adoção R6 (p50 > 200ms).
- Mantém-se decisão: FTS5 segue **postergado** até evidência em workspace maior/cenário real.

### 5.2 Scan de diretório (`scanDirectory`) via hyperfine

Artefato: `benchmarks/hyperfine-scan-a13.json`

- `scanDirectory(recursive, depth=3, showHidden=false)`: **~0.28 s** (mean)
- `scanDirectory(recursive, depth=3, showHidden=true)`: **~0.36 s** (mean)

Leitura arquitetural:

- Diferença `showHidden=true` é esperada por superfície maior.
- Ainda sem evidência de necessidade imediata de watcher (R7), mantendo critério de ativação por
  frequência (>10 scans/min no mesmo path).

### 5.3 Comparação opcional de cache (`Map` L1 vs `lru-cache`)

Artefatos:

- `benchmarks/io-read-benchmark-results.json`
- `benchmarks/io-read-benchmark-results.with-lru.json`

Mudança no benchmark:

- `benchmarks/io-read-benchmark.mjs` agora aceita `--out=<path>` para persistência versionável.
- Comparação com `lru-cache` é **opcional** (auto-detect), sem forçar dependência no projeto.

Resultado sintético (get-only, microbench):

- `lru-cache.get` ficou entre **~6x e ~12x** acima de `l1-cache.get` (Map atual).

Interpretação prudente:

- Esse resultado mede **lookup isolado**, não custo fim-a-fim de integração (invalidação, footprint,
  serialização do caminho, churn, manutenção).
- Portanto, a promoção de `lru-cache` continua condicionada ao benchmark de integração completo
  previsto no R5/R12 (não apenas microbench de `get`).

### 5.4 Decisão consolidada após rodada contínua

1. R5 permanece adotado com implementação atual (já aprovada por speedup de I/O real).
2. R6 e R7 continuam postergados por falta de evidência de gargalo no cenário atual.
3. `lru-cache` permanece **candidato forte**, mas sem adoção imediata até benchmark de integração.

---

## 6. Atualização A.13.3 (2026-05-07) — preparo gradual para L2/L3 + integração de tools

### 6.1 Fundação L2 (SQLite) adicionada

Foram adicionados componentes de preparação (feature-flagged) para rollout gradual do cache L2:

- `src/copilot/infra/io-cache-l2-sqlite.js`
  - `createIoL2SqliteCache()` com TTL, `maxEntries`, invalidação por path e `pruneExpired()`;
  - validação por `mtime/size` antes de promover item para L1;
  - stats de `hits/misses/sets/evictions/errors`.
- `src/copilot/infra/io-cache-l2-registry.js`
  - singleton controlado por `IO_L2_CACHE_ENABLED=1`;
  - fallback seguro: falha no L2 não derruba operação de leitura.
- `src/copilot/infra/database/sqlite/application/migrations.js`
  - migração v9 `create_io_cache_l2_entries` para estrutura durável.

### 6.2 Preparo L3 (planejamento canônico)

Foi criado `src/copilot/infra/io-cache-tiering.js` para consolidar:

- plano por tiers (`l1/l2/l3`) com recomendações por contexto;
- agregação de stats cross-tier para observabilidade e SLO futuro.

Observação: L3 permanece **desligado por default** e reservado para cenário multi-runtime.

### 6.3 Integração com tools para a LLM-B (escopo de leitura contínua)

Foram adicionadas file-tools de escopo para reduzir releitura ad hoc e melhorar continuidade da
LLM-B:

- `workspace_scope_declare`
- `workspace_scope_refresh`
- `workspace_scope_context`
- `workspace_scope_find_symbol`

Essas tools usam `io-session-scope` + parser/prefetch para orientar quais arquivos a LLM-B deve
manter quentes por mais tempo.

### 6.4 Estratégia de rollout (obrigatoriamente gradual)

1. **Fase 0 (atual)**: L1 ativo, L2/L3 desligados por default, ferramentas de escopo habilitadas.
2. **Fase 1**: ativar L2 em ambiente controlado (`IO_L2_CACHE_ENABLED=1`) e medir hit-ratio +
   evictions.
3. **Fase 2**: acoplar observabilidade por tier em `/observability/health` + convergence.
4. **Fase 3**: definir contrato de L3 (namespace, invalidation bus, consistência) somente se
   evidência justificar.
