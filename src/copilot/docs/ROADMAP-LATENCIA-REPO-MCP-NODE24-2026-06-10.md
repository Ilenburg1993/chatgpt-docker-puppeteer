# Roadmap atualizado — latência estrutural das repo tools MCP em Node 24

Data: 2026-06-10  
Runtime assumido: **Node 24.x**  
Escopo: MCP repo tools, OAuth/auth, registry hot path, repo IO/patch/search/tree,
HTTP/2/QUIC/Cloudflare, startup/jobs.

---

## 1. Mudança de premissa: Node 24

Este roadmap substitui a leitura anterior que tratava compile cache como recurso ainda
cauteloso/experimental. Em Node 24.15+, segundo a documentação oficial do Node 24,
`module.enableCompileCache()` já não é experimental e o module compile cache pode ser ativado por
API ou pela variável `NODE_COMPILE_CACHE=dir`. A documentação também registra
`portable`/`NODE_COMPILE_CACHE_PORTABLE=1` como modo para cache reutilizável quando o projeto muda
de caminho.

Implicação direta:

- `NODE_COMPILE_CACHE` entra no roadmap como otimização prática para startup, validators, job runner
  e processos filhos.
- Não deve ser vendido como principal ganho para chamadas MCP quentes dentro do processo já
  carregado.
- O ganho estrutural de calls quentes continua em auth-cache, byte-accounting, repo IO cache, index
  routing e batching.

---

## 2. Baseline atual resumido

### 2.1 Cloudflare/QUIC

Estado recente:

```text
cloudflared: 2026.5.2
HA connections: 4
requestErrorRate: 0
QUIC present: true
QUIC latestRttMs: 21
QUIC smoothedRttMs: 23
rpcClientLatency p50: 350 ms
rpcClientLatency p95: 1170 ms
```

Interpretação: o transporte externo está saudável. Deve ser benchmarkado, mas não é o primeiro
gargalo a atacar.

### 2.2 MCP runtime/auth

A primeira medição útil pós-restart apontou:

```text
mcp_latency_dashboard total: 274 ms
authorization: 259 ms
handler: 13 ms
resultSize: 1 ms
```

Interpretação: o hot path de autorização/registry tem prioridade sobre micro-otimizações prematuras
de handler.

### 2.3 Repo/index

O índice local já estava fresh:

```text
files: 1344
symbols: 9677
chunks: 2507
```

Interpretação: search/tree devem usar índice de forma mais agressiva quando semanticamente seguro,
preservando fallback por scan/rg.

---

## 3. Objetivos de design

1. Reduzir latência média geral sem perda funcional.
2. Preservar OAuth, scopes, hashes, auditabilidade e rollback.
3. Reduzir trabalho repetido no hot path.
4. Aumentar batching quando isso reduz chamadas/autorização/aprovação.
5. Tornar os gargalos visíveis por fase e por tool.
6. Usar Node 24 onde ele já é vantagem objetiva: compile cache, HTTP/2 metrics, fs streams/direct
   reads, worker threads para CPU-bound.

---

## 4. Roadmap revisado

## P0 — Auth hot path seguro e observável

### P0.1 Positive authorization decision cache

Implementar cache LRU/TTL apenas para decisões positivas OAuth/JWT.

Chave:

```text
sha256(token) + requiredScopes + authConfigFingerprint + authImplementationVersion
```

Regras:

- cachear somente decisões positivas;
- nunca cachear falhas;
- TTL máximo default: 60s;
- TTL real: menor valor entre env TTL e expiração do token menos skew;
- bypass para DPoP-bound tokens ou chamadas com header DPoP;
- incluir scopes e fingerprint de issuer/audience/jwks/algorithms/resource-claim;
- expor métricas: hits, misses, sets, bypasses, evictions, size.

Motivo: a amostra mostrou autorização em 259 ms contra handler em 13 ms.

### P0.2 Memoização de auth config

Memoizar `readMcpAuthConfig(process.env)` por fingerprint das envs relevantes. Chamadas com env
customizado continuam fresh para testes.

### P0.3 Registry runtime scope map

Precomputar por tool:

- risk;
- requiredScopes;
- scope class;
- validation strategy;
- high-impact flags.

---

## P1 — Node 24 startup/jobs acceleration

### P1.1 Compile cache global

Ativar para processos Node recorrentes:

```text
NODE_COMPILE_CACHE=/tmp/node-compile-cache
NODE_COMPILE_CACHE_PORTABLE=1
```

Ou bootstrap:

```js
import { enableCompileCache } from 'node:module';
enableCompileCache({ portable: true });
```

Aplicar em:

- MCP server startup;
- validator jobs;
- scripts `run-safe-validation-suite`;
- processos filhos Node.

### P1.2 Compile-cache diagnostics

Adicionar tool ou seção em runtime health:

```text
node.version
node.major
compileCache.enabled
compileCache.directory
compileCache.status
compileCache.portable
```

---

## P2 — Result-size byte accounting

Problema atual provável: registry valida tamanho por stringify completo do resultado.

Mudança:

- `okResult()` passa a aceitar metadado interno de `estimatedBytes`/`resultBytes`;
- repo tools preenchem bytes conhecidos;
- registry usa fast path quando confiável;
- fallback para stringify segue existindo.

Tools prioritárias:

- `repo_read_file`;
- `repo_read_file_chunks`;
- `repo_tree`;
- `repo_diff_files`;
- `repo_apply_patch`;
- `repo_apply_file_batch`.

---

## P3 — Repo read/cache estrutural

### P3.1 Line-offset cache

Criar cache por `{path, size, mtime}` com:

- texto/buffer;
- contentHash;
- returnedHash;
- offsets de linha;
- totalLines.

Ganhos:

- range reads deixam de fazer `split('\n')` completo repetidamente;
- navegação em arquivos grandes fica mais barata.

### P3.2 `hashMode` opcional

Adicionar a `repo_read_file`:

```text
hashMode = full | returned | none
```

Default permanece `full` para manter compatibilidade e segurança de patch.

### P3.3 Invalidation por write

Toda write tool deve invalidar caches de leitura/offset para os paths afetados.

---

## P4 — Search/tree index-first

### P4.1 `repo_search_smart`

Roteador:

- literal/fuzzy simples → índice FTS;
- regex/contextLines exatos → `rg`/scan;
- índice stale → fallback automático.

### P4.2 `repo_tree` index-backed

Quando seguro:

- `showHidden=false`;
- `respectGitignore=true`;
- path dentro slice indexado;
- recursive/depth compatível.

Fallback sempre preservado.

---

## P5 — Patch/write batching

### P5.1 `repo_apply_patch_batch`

Batch de patches exatos com:

- `expectedHash` por arquivo;
- dry-run;
- rollback metadata;
- preview suprimido por default;
- invalidação de caches por path;
- uma autorização/uma tool call.

### P5.2 No-preview fast path

Garantir que `includeDiffPreview=false` não gere diff textual completo desnecessário.

---

## P6 — HTTP/2/Cloudflare experiments

### P6.1 HTTP/2 origin metrics

Node 24 mantém API HTTP/2 estável e permite observar métricas com `PerformanceObserver` para
`Http2Session` e `Http2Stream`. Adicionar:

- TTFB local;
- bytes in/out;
- stream duration;
- session RTT/PING se disponível;
- remote/local settings.

### P6.2 Benchmark controlado de transporte

Testar:

```text
quic atual vs auto vs http2
```

Promover só com:

- menor p95 sem perda de p99;
- erro 0;
- HA >= 4;
- smoke fresh;
- sem regressão de auth/handler.

### P6.3 Cache de discovery público

Cache GET-only para:

- `/.well-known/*`;
- `/chatgpt-connector.json`.

Nunca cachear:

- `/mcp`;
- `/oauth/token`;
- respostas com Authorization.

---

## P7 — Worker threads apenas para CPU-bound

Node documenta que workers são úteis para CPU-intensive JS e pouco ajudam IO-bound. Portanto:

Usar workers para:

- diff grande;
- parse AST grande;
- index incremental pesado;
- hash de arquivo muito grande quando CPU-bound.

Não usar para:

- `fs.readFile` simples;
- stat simples;
- Cloudflare/OAuth network IO.

---

## 5. Ordem de execução imediata

1. Atualizar roadmap Node 24. **feito neste documento**
2. Implementar P0.1/P0.2: auth decision cache + auth config memoization.
3. Expor métricas de auth cache em runtime health/latency dashboard.
4. Validar `mcp-full`.
5. Implementar P2 result-size byte accounting.
6. Implementar P3 line-offset cache.
7. Implementar P5 patch batch.
8. Rodar benchmark real com golden prompts.

---

## 6. Critérios de sucesso

### Métrica de curto prazo

Após P0:

```text
authorization average < 80 ms depois de warmup
auth cache hit rate > 70% em sequências repetidas de repo tools
0 regressões de auth/scope/JWT
```

### Métrica de médio prazo

Após P2/P3/P5:

```text
repo_read_file avg reduzido em leituras repetidas
repo_apply_patch avg reduzido quando preview=false
repo_search_text/search_smart reduzido em consultas literais
total tool calls menor em refactors multi-file via batch
```

### Métrica de segurança

Sempre:

```text
mcp-full pass
auth tests pass
OAuth metadata unchanged unless explicit
no cache of negative auth decisions
no cache of /mcp at edge
```

---

## 7. Veredito

Com Node 24, há uma linha adicional forte para startup/jobs via compile cache estável. Mas para
latência média das repo tools mais usadas, a prioridade correta permanece:

1. cache seguro de auth positiva;
2. menor serialização/result-size;
3. cache de offsets/IO;
4. index-first search/tree;
5. patch batching;
6. observabilidade HTTP/2/Cloudflare para experiments posteriores.
