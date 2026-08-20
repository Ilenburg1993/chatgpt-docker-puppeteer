# Pesquisa estrutural exaustiva — redução de latência das repo tools MCP

Data: 2026-06-10  
Workspace: `/workspaces/chatgpt-docker-puppeteer`  
Foco: `repo_read_file`, `repo_search_text`, `repo_tree`, `repo_file_stats`, `repo_apply_patch`,
`repo_apply_file_batch`, validação/patch workflows, MCP/OAuth/HTTP2-QUIC/Cloudflare/Node.

---

## 1. Premissa forte

A latência **não** deve ser reduzida por perda funcional. Portanto, ficam proibidas como estratégia
primária:

- desativar OAuth/JWT/scope validation;
- deixar de validar `aud`, `iss`, `resource`, `exp`, `scope`;
- cachear respostas dinâmicas de `/mcp` em Cloudflare;
- remover hashes necessários para segurança de escrita;
- reduzir logs/auditoria sem retenção equivalente;
- trocar `repo_read_file` por versões incompletas sem oferecer caminho funcional equivalente;
- desligar diff/preview quando o usuário explicitamente pede diff textual.

A estratégia correta é: **mesma segurança e funcionalidade, menos trabalho repetido, menos
serialização, menos round-trips, melhor roteamento de IO, melhor batching, caches verificados e
observabilidade mais fina.**

---

## 2. Baseline observado no WORKSPACE

### 2.1 Runtime MCP

Após restart recente:

- MCP e `cloudflared` estão vivos.
- Conector público: `https://mcp.aurelin.org/mcp`.
- Túnel: `named-permanent`.
- Transporte Cloudflare: `quic`.
- Index local: disponível e fresh.
- Arquivos indexados: 1344.
- Símbolos indexados: 9677.
- Chunks indexados: 2507.

### 2.2 Métrica crítica inicial

A primeira métrica pós-restart mostrou algo importante:

```text
mcp_latency_dashboard total: 274 ms
authorization: 259 ms
handler: 13 ms
resultSize: 1 ms
```

Isso sugere que, pelo menos no início da sessão, **o gargalo mais promissor não é o handler da
tool**, mas o caminho de autorização/registry. É necessário coletar mais amostras, mas a alavanca
provável é clara: reduzir custo repetido por chamada sem enfraquecer OAuth.

### 2.3 Cloudflare/QUIC atual

Cloudflare está relativamente saudável:

```text
cloudflared: 2026.5.2
HA/register connections: 4
requestErrorRate: 0
QUIC present: true
QUIC totalConnections: 4
QUIC latestRttMs: 21
QUIC smoothedRttMs: 23
rpcClientLatency p50: 350 ms
rpcClientLatency p95: 1170 ms
rpcClientLatency p99: 1314 ms
```

Conclusão: há espaço de benchmark `quic` vs `auto` vs `http2`, mas a prioridade estrutural para repo
tools está dentro do servidor MCP e do caminho de autorização/IO.

### 2.4 Edge policy diff

O diff Cloudflare ainda aponta só:

```text
anonymous-mcp-rate-limit-mitigated-at-origin
```

Isto significa:

- não há rate-limit edge explícito para `/mcp` anônimo;
- há fallback na origem;
- não há critical diffs;
- cache bypass e non-interference de MCP/OAuth estão em estado aceitável.

---

## 3. Modelo de latência das repo tools

Cada chamada comum passa por:

```text
ChatGPT host / client
  → HTTPS / Cloudflare edge
  → cloudflared QUIC até Cloudflare global
  → cloudflared → origin HTTPS/HTTP2
  → adapter MCP HTTP2/Streamable HTTP
  → registry MCP
     → audit start
     → rate limit
     → auth / JWT / scopes
     → handler
        → path validation
        → repo IO/cache/index/diff
     → result size validation
     → optional output validation
     → audit completion
     → metric record
  → JSON-RPC response serialization
  → Cloudflare/client
```

Repo tools quentes normalmente gastam em:

1. **autorização**: JWT verify, scopes, config normalization, JWKS, DPoP path;
2. **path validation**: validação de path/workspace/protected paths;
3. **filesystem IO**: stat/read/hash/split lines;
4. **index/search**: FTS/SQLite vs ripgrep/scanner;
5. **diff/patch**: leitura, replace, diff preview, atomic write;
6. **serialização/result-size**: stringify de resposta grande;
7. **audit/metrics**: start/completion e escrita JSONL assíncrona.

---

## 4. Pesquisa oficial — implicações práticas

### 4.1 MCP Streamable HTTP

O MCP Streamable HTTP usa JSON-RPC UTF-8 e define stdio + Streamable HTTP como transportes padrão.
Streamable HTTP deve usar endpoint único, como `/mcp`, aceitando POST e GET. A especificação também
prevê múltiplas conexões, resumability via SSE event IDs/`Last-Event-ID`, session management via
`Mcp-Session-Id`, e header `MCP-Protocol-Version`.

Implicação:

- manter `/mcp` dinâmico e não-cacheável;
- avaliar sessão MCP opcional para clientes compatíveis;
- instrumentar melhor headers/version/session;
- preservar stateless como fallback para compatibilidade;
- usar resumability apenas para SSE/streaming, não como cache de tool result.

### 4.2 MCP Authorization / OAuth

A especificação MCP Authorization usa OAuth 2.1, RFC 8414, RFC 7591 e RFC 9728. MCP servers com HTTP
devem publicar Protected Resource Metadata e usar `WWW-Authenticate` com metadata URL em 401.

Implicação:

- não reduzir latência desativando OAuth;
- a otimização correta é cachear decisões positivas de autorização de forma segura;
- metadata e discovery podem ser cacheados, mas autorização de tool precisa preservar
  scopes/audience/resource/expiração.

### 4.3 RFC 9728

Protected Resource Metadata é um documento JSON em well-known. HTTP caching normal se aplica à
metadata e `Cache-Control: max-age` pode ser usado.

Implicação:

- cachear `/.well-known/oauth-protected-resource`, metadata OAuth e `chatgpt-connector.json` é
  seguro se GET-only e curto TTL;
- não cachear `/oauth/token` nem `/mcp`;
- reduzir discovery latency sem afetar chamadas dinâmicas.

### 4.4 Cloudflare Tunnel

Cloudflare Tunnel permite protocolo `auto`, `http2` e `quic`. `auto` configura QUIC e faz fallback
para HTTP/2 se UDP falhar. `cloudflared` também expõe endpoint Prometheus de métricas.

Implicação:

- manter `quic` como controle atual enquanto saudável;
- benchmarkar `auto` como alternativa resiliente;
- não promover `http2` sem evidência, pois perderia QUIC/PQC e pode piorar caminho local;
- medir sempre por gates: errorRate, HA connections, QUIC RTT, RPC p95/p99, smoke.

### 4.5 Cloudflare originRequest

`originServerName`, `noTLSVerify`, `http2Origin`, `disableChunkedEncoding`, `connectTimeout`,
`keepAliveTimeout`, `keepAliveConnections` e `tcpKeepAlive` são os campos centrais.

Implicação:

- estado atual de HTTP/2 origin + TLS validado + keepalive pinado é bom;
- `connectTimeout=5s` reduz hang quando origin cai;
- `keepAliveConnections=100` não limita concorrência total, só idle keepalives;
- não ativar Access JWT na frente de `/mcp` sem redesenho, pois já existe OAuth MCP.

### 4.6 Node.js filesystem

`fs.readFile()` lê o arquivo inteiro e bufferiza conteúdo. A própria documentação recomenda
streaming para reduzir memória quando possível e `fs.read()` direto quando a meta é leitura mais
rápida gerenciada pela aplicação.

Implicação:

- `repo_read_file` com janela de linhas não deveria necessariamente ler/splitar arquivo inteiro
  sempre;
- usar line-offset cache, streaming com early stop ou `fs.read()` por offsets para ranges
  frequentes;
- manter full read/hashes quando necessário.

### 4.7 Node module compile cache

Node 22+ oferece module compile cache por `module.enableCompileCache()` ou `NODE_COMPILE_CACHE`, com
possível slowdown no primeiro load, mas ganho em loads subsequentes do mesmo graph. Afeta instância
atual; workers/child processes precisam herdar env ou ativar também.

Implicação:

- bom para restart do MCP, validators e jobs Node recorrentes;
- não melhora muito uma tool quente dentro do processo já carregado;
- deve ser habilitado como otimização de startup/validators, não como principal melhoria de
  `repo_read_file`.

### 4.8 Node worker_threads

Workers ajudam CPU-bound JS; a documentação diz que não ajudam muito em I/O-bound, pois async IO
nativo é mais eficiente.

Implicação:

- usar workers para parse/diff/symbols grandes, não para `fs.readFile` normal;
- diffs enormes, parse AST e index incremental podem ir para worker pool;
- repo read simples deve continuar no event loop/async IO com cache.

### 4.9 Node HTTP/2 metrics

Node permite coletar métricas de `Http2Session` e `Http2Stream` via `PerformanceObserver`, incluindo
bytes e time-to-first-byte/header. Também expõe settings como `maxConcurrentStreams` e PING RTT.

Implicação:

- adicionar observabilidade HTTP/2 origin-side, não apenas Cloudflare;
- medir TTFB local do adapter e stream bytes;
- só ajustar HTTP/2 settings com métrica real.

---

## 5. Transformações estruturais prioritárias

## Faixa A — Auth fast path seguro

### A1. Positive authorization decision cache

Problema:

- cada tool call verifica JWT/scope mesmo para o mesmo bearer token e mesmo conjunto de scopes;
- a amostra inicial mostrou autorização em 259 ms contra handler em 13 ms.

Proposta:

Criar cache LRU/TTL de decisões positivas:

```text
key = sha256(token) + requiredScopes + authConfigFingerprint + dpopPresence + toolScopeClass
value = { allowed, method, requiredScopes, exp, iat, tokenHash, scopesHash }
TTL = min(tokenExp - now - skew, COPILOT_MCP_AUTH_DECISION_CACHE_TTL_MS, 60s/120s)
```

Regras de segurança:

- cachear **apenas decisões positivas**;
- nunca cachear falhas de JWT/scope;
- invalidar por mudança de JWKS/config/resource/issuer/audience;
- respeitar `exp`, `nbf`, `iat`, `maxTokenAge`;
- DPoP-bound tokens só podem ser cacheados se o proof atual for validado ou se DPoP for excluído do
  cache;
- incluir requiredScopes na chave;
- instrumentar `authorization.cache=hit|miss|bypass`.

Impacto esperado:

- maior ganho médio para repo tools quentes;
- sem perda funcional.

Risco:

- DPoP/replay. Solução: no primeiro passo, bypass cache para tokens com `cnf.jkt` ou com header
  `DPoP`.

### A2. Memoizar `readMcpAuthConfig()`

Problema:

- config OAuth é normalizada a partir de env em muitos caminhos.

Proposta:

- cache por fingerprint das env relevantes;
- TTL curto ou invalidation explícita em testes;
- export `readMcpAuthConfigCached()` e usar no registry hot path.

Impacto:

- pequeno por chamada, mas constante.

### A3. Precomputar scopes/security por tool

Problema:

- `collectToolSecurityScopes` e `scopesForMcpTool` aparecem no caminho quente.

Proposta:

- no registry build, anexar `_runtime.requiredScopes`, `_runtime.risk`, `_runtime.scopeClass` em
  mapa interno não anunciado;
- guarded handler lê do mapa.

Impacto:

- reduz pequenas alocações por chamada.

---

## Faixa B — Serialização e result-size sem stringify total

### B1. `resultBytes` first-class

Problema:

- registry chama `stableJsonStringify(result)` para validar tamanho.
- Em tools de leitura/diff, isto pode custar mais que o handler quando a resposta é grande.

Proposta:

- `okResult()` aceitar metadata interna `estimatedBytes` ou `resultBytes`;
- repo tools computam bytes já conhecidos:
  - `content.length`/`Buffer.byteLength(content)`;
  - diff bytes;
  - JSON metadata estimada;
- registry usa `resultBytes` e cai para stringify apenas se ausente.

Impacto:

- alto para `repo_read_file`, `repo_diff_files`, `repo_apply_patch`, `repo_tree` grande.

Funcionalidade preservada:

- limite de tamanho continua existindo.

### B2. Phase separada `serialization/resultSize`

Problema:

- hoje sabemos `resultSize`, mas não distinguimos bem stringify/bytes/output serialization.

Proposta:

- adicionar fases `resultByteAccounting`, `jsonSerializationEstimate`.
- dashboard reporta P50/P95 por fase.

---

## Faixa C — Repo read: cache, ranges e line offsets

### C1. Hot read trust window com invalidação por write

Estado atual:

- `repo_read_file` tem cache local e `readText` tem L1/L2.
- Mesmo em hit, há validação por stat/mtime/size.

Proposta:

- adicionar micro trust window, ex.: 250–1000 ms, só para paths lidos recentemente;
- invalidar imediatamente quando write/patch/move/quarantine toca o path;
- manter validação normal fora da janela;
- env flag:

```text
COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS=500
```

Trade-off:

- se um processo externo editar o arquivo dentro de 500 ms, pode haver stale read ultracurto.
- default pode ser 0 ou 250 ms; perfil max performance pode aumentar.

### C2. Line offset cache

Problema:

- windowed reads ainda dependem de conteúdo completo e `split('\n')`.

Proposta:

- ao ler arquivo completo, armazenar:
  - content string/buffer;
  - contentHash;
  - lineOffsets;
  - totalLines;
  - mtime/size;
- range read usa offsets para slice sem resplitar tudo.

Impacto:

- alto para leituras repetidas de arquivos grandes e navegação por janelas.

### C3. Novo modo `repo_read_file` com `hashMode`

Problema:

- hash full é útil para writes, mas nem toda leitura precisa dele.

Proposta compatível:

```ts
hashMode?: 'full' | 'returned' | 'none'
```

Defaults atuais continuam `full` para não quebrar comportamento.

Uso de baixa latência:

- leitura exploratória: `hashMode='returned'` ou `none`;
- leitura antes de patch: `full`.

Funcionalidade preservada:

- comportamento default não muda.

### C4. `repo_read_window_fast`

Alternativa sem tocar default:

- nova tool para ranges e navegação rápida;
- sem full hash por padrão;
- com cursor/lineOffsets;
- recomenda `repo_read_file` quando o usuário precisa patch seguro.

---

## Faixa D — Search/tree: index-first sem perder rg

### D1. Router inteligente para busca

Estado atual:

- há índice FTS/símbolos fresh.
- `repo_search_text` usa textual/rg.
- `repo_index_search` existe, mas usuário/LLM precisa escolher.

Proposta:

- adicionar `repo_search_smart` ou `preferIndex` em `repo_search_text`:
  - literal simples → FTS primeiro;
  - regex/contexto exato → rg;
  - fallback automático quando índice stale.

Funcionalidade preservada:

- regex e contextLines continuam via rg.

### D2. Tree index-backed

Problema:

- `repo_tree` recursivo/root pode scanar muitos arquivos.

Proposta:

- `repo_tree` usa índice quando:
  - recursive true;
  - path dentro slice indexado;
  - showHidden false;
  - respectGitignore true;
- fallback para scanDirectory.

Impacto:

- alto para navegação inicial.

### D3. Cache de directory scan

Proposta:

- LRU por `{path, recursive, depth, maxEntries, showHidden, gitignore}`;
- invalidado por write/move/quarantine dentro subtree;
- TTL curto, ex. 1–5s;
- retorna `cache: hit|miss`.

---

## Faixa E — Patch/write workflows

### E1. Patch batch

Problema:

- multi-file refactors exigem múltiplas chamadas, múltiplas autorizações, múltiplas auditorias e
  múltiplas aprovações host.

Proposta:

Nova tool:

```text
repo_apply_patch_batch
```

Recursos:

- array de patches exatos;
- expectedHash por arquivo;
- dryRun;
- atomicidade por arquivo;
- diff preview suprimido por default;
- rollback metadata;
- invalidação de caches por path;
- métrica agregada.

Impacto:

- enorme para refactors;
- reduz latência percebida e aprovações.

### E2. No-preview true fast path

Problema:

- mesmo com `includeDiffPreview=false`, garantir que o engine não gere diff textual completo
  desnecessário.

Proposta:

- auditar `patchTextLocked`;
- adicionar opção `computeDiff=false` quando preview suprimido;
- retornar apenas line/byte deltas e hashes.

Funcionalidade preservada:

- se usuário pede diff, calcula.

### E3. Patch from prior read cache

Proposta:

- quando `expectedHash` bate com cache L1/L2, patch engine pode usar buffer/text cache em vez de
  reler do disco;
- após atomic write, invalida/atualiza cache.

---

## Faixa F — Registry hot path

### F1. Audit completion fire-and-forget seletivo

Estado:

- audit já enfileira e usa `setImmediate`, mas chamadas são `await` no caminho do registry.

Proposta:

- eventos de sucesso `tool_call_started/completed` podem ser enfileirados sem await;
- eventos críticos, auth denied, tool failed, result rejected continuam await ou confirmados;
- manter beforeExit flush.

Impacto:

- reduz micro-latência e jitter.

### F2. Rate-limit subject cache

Problema:

- subject por token usa hash do bearer em toda chamada.

Proposta:

- cachear tokenHash por token object/string em LRU fraco/normal com max entries;
- ou calcular uma vez na auth decision cache.

### F3. Registry static runtime map

Proposta:

- mapa por tool name contendo risk, requiredScopes, annotations, output validation strategy, max
  result budget;
- evita recomputar classification/scopes/security a cada chamada.

---

## Faixa G — MCP transport/sessions

### G1. Sessões MCP opcionais

MCP permite `Mcp-Session-Id`. O sistema hoje mantém stateless por compatibilidade SDK.

Proposta:

- manter stateless como default;
- criar modo experimental:

```text
COPILOT_MCP_HTTP_SESSION_MODE=optional
```

Benefícios potenciais:

- sessão pode carregar cache por cliente:
  - auth decision cache por session;
  - preferred protocol version;
  - tool surface negotiated;
  - recent path cache;
- menor custo de repeated initialization.

Risco:

- compatibilidade com clients e body replay.

### G2. Resumability apenas para streams

Proposta:

- usar SSE event IDs/Last-Event-ID somente para streams longos, validators ou future long-running
  jobs;
- não usar para cachear tool results comuns.

### G3. HTTP/2 observability

Adicionar:

- PerformanceObserver para `http2`;
- métricas de `Http2Session`/`Http2Stream`;
- `pingRTT` controlado;
- TTFB local;
- bytes read/written por stream.

---

## Faixa H — Cloudflare edge e transporte

### H1. Manter atual como controle

Estado atual é bom:

- QUIC presente;
- RTT ~23ms;
- 4 HA connections;
- requestErrorRate 0;
- origin HTTP/2 configurado.

### H2. Benchmark controlado `quic` vs `auto` vs `http2`

Proposta:

- 3 janelas, mesmas golden prompts;
- medir:
  - `mcp_latency_dashboard`;
  - `mcp_cloudflare_metrics_snapshot`;
  - post-change gates;
  - smoke;
  - origin errors.

Critério:

- só promover se p50/p95 melhorar sem aumentar erro/reconexão.

### H3. Cloudflare cache apenas para discovery

Promover, se desejado:

- `/.well-known/*` GET-only;
- `/chatgpt-connector.json` GET-only;
- TTL edge 300s, browser 60s.

Nunca cachear:

- `/mcp`;
- `/oauth/token`;
- `/health` se health deve refletir readiness real;
- respostas com Authorization.

### H4. Compression policy experimental

Já há desired policy para desativar compressão em `/mcp` JSON-RPC. Deve ser tratado como
experimento:

- A/B com e sem compressão;
- medir payload pequeno vs grande;
- não aplicar se grandes payloads piorarem.

---

## Faixa I — Node/runtime

### I1. NODE_COMPILE_CACHE

Aplicar em:

- MCP server startup;
- validators;
- job runner;
- worker threads/child processes.

Proposta:

```text
NODE_COMPILE_CACHE=/tmp/node-compile-cache
NODE_COMPILE_CACHE_PORTABLE=1
```

Ou bootstrap:

```js
import { enableCompileCache } from 'node:module';
enableCompileCache({ portable: true });
```

Impacto:

- melhora restart, validator jobs e scripts;
- não é a maior alavanca para calls quentes.

### I2. Worker pool só para CPU-bound

Usar workers para:

- diff grande;
- parse AST/symbols;
- index incremental;
- hash de arquivos muito grandes, se bloquear CPU.

Não usar workers para:

- `fs.readFile` simples;
- directory scan simples;
- chamadas Cloudflare/OAuth IO-bound.

---

## Faixa J — Observabilidade nova necessária

### J1. `mcp_repo_latency_profile`

Nova tool proposta:

```text
mcp_repo_latency_profile
```

Retorna:

- top repo tools por calls/avg/max/p95;
- separação auth vs handler vs resultSize;
- cache hit rate de repo read;
- index hit rate;
- patch diff computation time;
- result bytes médios;
- recomendação automática.

### J2. Percentis reais in-process

Hoje métricas in-process guardam total/average/last/max aproximado. Propor:

- reservoir ou HDR-like compact histogram por tool/phase;
- p50/p90/p95/p99;
- retenção limitada.

### J3. Cache telemetry

Expor:

- repoReadFileResultCache hits/misses/stale;
- IO L1/L2 hits/misses;
- search index hits/fallbacks;
- auth decision cache hits/misses/bypass;
- resultSize fast-path/fallback stringify.

---

## 6. Roadmap de implementação

### P0 — Medição e auth cache seguro

1. Adicionar métricas percentis por tool/phase.
2. Adicionar auth decision positive cache com DPoP bypass.
3. Memoizar `readMcpAuthConfig` por env fingerprint.
4. Adicionar telemetry de auth cache ao `mcp_latency_dashboard`.
5. Validar com `mcp-full` e golden prompts.

### P1 — Result-size e repo read hot path

1. `okResult` com `resultBytes`/`estimatedBytes`.
2. Registry usa byte accounting antes de stringify.
3. Line offset cache para `repo_read_file`.
4. Write tools invalidam read/line caches.
5. `repo_read_file` ganha `hashMode`, mantendo default atual.

### P2 — Search/tree/index router

1. `repo_search_smart` ou `preferIndex` em `repo_search_text`.
2. `repo_tree` index-backed quando seguro.
3. Directory scan cache curto com invalidação por write.
4. Métricas de hit/fallback.

### P3 — Patch batch e no-preview fast path

1. Auditar `patchTextLocked` para evitar diff full quando preview=false.
2. Criar `repo_apply_patch_batch`.
3. Reusar cache de leitura quando expectedHash bate.
4. Adicionar rollback metadata por batch.

### P4 — Transport/Cloudflare experiments

1. HTTP/2 PerformanceObserver no origin.
2. PING RTT controlado.
3. Benchmark `quic` vs `auto` vs `http2`.
4. Edge discovery cache GET-only.
5. Compression experiment para `/mcp`.

### P5 — Runtime startup/validators

1. `NODE_COMPILE_CACHE` no devcontainer/MCP/scripts.
2. Warmup pós-restart:
   - index status;
   - critical files read warm;
   - auth JWKS warm;
   - capabilities manifest warm.
3. Worker pool para parse/diff grandes.

---

## 7. Priorização por impacto provável

| Prioridade | Transformação                | Impacto provável |       Risco | Observação                                     |
| ---------- | ---------------------------- | ---------------: | ----------: | ---------------------------------------------- |
| 1          | Auth decision positive cache |       Muito alto |       Médio | Maior gargalo observado: auth 259ms            |
| 2          | Result-size byte accounting  |             Alto |       Baixo | Evita stringify de respostas grandes           |
| 3          | Patch batch                  |             Alto |       Médio | Reduz chamadas/aprovações e latência percebida |
| 4          | Line offset cache            |             Alto | Baixo/Médio | Grande ganho em leituras repetidas             |
| 5          | Search smart index-first     |             Alto |       Baixo | Mantém rg fallback                             |
| 6          | Tree index-backed/cache      |       Médio/Alto |       Baixo | Melhora navegação inicial                      |
| 7          | No-preview patch fast path   |       Médio/Alto |       Baixo | Especialmente em patches grandes               |
| 8          | HTTP/2 origin metrics        |            Médio |       Baixo | Medição antes de tuning                        |
| 9          | Cloudflare discovery cache   |            Médio |       Baixo | Só metadata GET-only                           |
| 10         | NODE_COMPILE_CACHE           |            Médio |       Baixo | Startup/jobs, não hot calls                    |
| 11         | Workers CPU-bound            |      Situacional |       Médio | Só diffs/parse/hash grandes                    |
| 12         | MCP sessions optional        |            Médio |  Médio/Alto | Depende de compatibilidade host                |

---

## 8. Transformações que eu não recomendo

1. **Cache Cloudflare para `/mcp`**: quebra semântica dinâmica e autorização.
2. **Desabilitar OAuth em repo tools**: viola premissa de segurança.
3. **Reduzir escopos JWT sem redesenho de OAuth**: pode causar reauth/fricção.
4. **Forçar HTTP/2 tunnel no lugar de QUIC sem benchmark**: QUIC atual está saudável.
5. **Workers para IO simples**: Node diz que workers não ajudam muito em I/O-bound.
6. **Retirar full hashes do default de `repo_read_file`**: quebraria workflows de patch seguro. Use
   `hashMode` opcional.
7. **Desativar audit globalmente**: trocar por audit assíncrona seletiva, não apagar
   rastreabilidade.
8. **Compressão off para tudo**: testar só `/mcp`; metadata/discovery pode se beneficiar de
   compressão/cache.

---

## 9. Conclusão

O caminho mais promissor para reduzir latência média das repo tools não é “mexer mais no túnel”
primeiro. O túnel está saudável. O ganho estrutural maior está em:

1. cache seguro de decisões OAuth positivas;
2. redução de stringify/serialização de resposta;
3. line-offset cache para leituras por janela;
4. roteamento index-first para search/tree;
5. batch de patches;
6. métricas percentis por fase;
7. HTTP/2 origin observability antes de tuning Cloudflare;
8. compile cache para startup/jobs.

Essas mudanças preservam funcionalidade e, se implementadas com gates, tendem a reduzir tanto
latência real quanto latência percebida em fluxos profundos de repo.
