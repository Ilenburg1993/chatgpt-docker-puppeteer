# Migração MCP Stateful Streamable HTTP, OAuth, Cloudflare e latência `read`

**Data:** 2026-06-13  
**Escopo primário:** `src/copilot` com foco em `src/copilot/mcp`, OAuth, Cloudflare Tunnel, HTTP/2+
origin, QUIC, session runtime, event-store, SSE/replay e tools de leitura.  
**Documento recriado em:** 2026-06-13, após auditoria operacional e implementação P0
parcial/estrutural.  
**Última auditoria ampla:** 2026-06-14 UTC, após restart MCP/Cloudflare, smoke remoto, OAuth
diagnostics, runtime health e validação `mcp-full`. **URL operacional:**
`https://mcp.aurelin.org/mcp`  
**Protocolo-alvo:** MCP Streamable HTTP `2025-11-25`  
**Estado-alvo:** stateful/resumable por padrão, stateless apenas como fallback temporário e
removível.

---

## 0. Decisões normativas atuais

| Decisão                    | Valor                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| Transporte remoto canônico | Streamable HTTP em HTTPS, origin HTTP/2+ via Cloudflare Tunnel                                  |
| Protocolo-alvo             | `2025-11-25`                                                                                    |
| Inicialização              | `POST /mcp` sem `Mcp-Session-Id`, corpo JSON-RPC `initialize`                                   |
| Pós-initialize             | `Mcp-Session-Id` obrigatório                                                                    |
| Canal servidor→cliente     | `GET /mcp` com `Accept: text/event-stream` e sessão                                             |
| Replay                     | `Last-Event-ID` validado e delegado ao event-store/SDK                                          |
| Encerramento               | `DELETE /mcp`, tombstone e 204 quando o SDK não escrever resposta                               |
| Binding de sessão          | Claims OAuth validadas quando no caminho operacional; nunca bearer bruto                        |
| Event store operacional    | SQLite por padrão no caminho stateful operacional; memória apenas `useSqliteStore=false`/testes |
| Cloudflare                 | QUIC atual, HTTP/2 origin, passthrough scoped, cache bypass, `response_body_buffering=none`     |
| Latência `read`            | Não remover funcionalidade; otimizar por cache, singleflight, byte offsets e serialização       |

---

## 1. Fontes oficiais e invariantes incorporados

### 1.1 MCP Streamable HTTP `2025-11-25`

Invariantes usados no desenho:

- servidor remoto expõe endpoint único, por exemplo `/mcp`;
- `POST` transporta mensagens JSON-RPC cliente→servidor;
- `GET` pode abrir SSE servidor→cliente;
- servidor pode emitir `Mcp-Session-Id` no initialize;
- cliente deve enviar `Mcp-Session-Id` nas chamadas posteriores;
- sessão ausente quando necessária deve retornar 400;
- sessão desconhecida/expirada deve retornar 404;
- `DELETE` encerra sessão;
- `Last-Event-ID` permite replay/resume;
- `Origin` deve ser validado contra DNS rebinding;
- `MCP-Protocol-Version` ausente implica fallback definido pela especificação.

Referência oficial: `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports`

### 1.2 MCP Authorization `2025-11-25`

Invariantes usados no desenho:

- HTTP remoto com auth deve usar OAuth quando suportado;
- MCP resource server deve publicar Protected Resource Metadata;
- clients devem descobrir authorization servers via PRM;
- `WWW-Authenticate` deve apontar `resource_metadata` quando necessário;
- Resource Indicators, issuer, audience, JWKS, scopes e token claims são parte do envelope de
  segurança.

Referência oficial: `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization`

### 1.3 SDK TypeScript MCP

Invariantes usados no desenho:

- `StreamableHTTPServerTransport` suporta modo stateful com `sessionIdGenerator`;
- `onsessioninitialized` registra sessão viva;
- `EventStore` sustenta resumability;
- o exemplo stateful oficial reusa transporte por sessão;
- o exemplo stateless cria transporte por request e não atende o alvo final deste sistema.

Referências oficiais:

- `https://github.com/modelcontextprotocol/typescript-sdk`
- `https://ts.sdk.modelcontextprotocol.io/`

### 1.4 Cloudflare Tunnel e cache

Invariantes usados no desenho:

- `cloudflared --protocol` aceita `quic`, `http2` e `auto`;
- QUIC só deve ser promovido se HA, smoke, p95/p99 e erro forem verdes;
- MCP/SSE não deve ser cacheado nem transformado;
- `Cache-Control: no-store, no-transform` e regra scoped Cloudflare são necessários para
  API/streaming.

Referências oficiais:

- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/`
- `https://developers.cloudflare.com/cache/concepts/cache-control/`

---

## 2. Estado operacional observado nesta auditoria

| Área                                            | Estado observado                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness remoto                                | `ready=true`, OAuth configurado, sem blockers                                                                                                                                                                                                                                                                                                                                                         |
| URL MCP                                         | `https://mcp.aurelin.org/mcp`                                                                                                                                                                                                                                                                                                                                                                         |
| Auth mode                                       | OAuth obrigatório, enforcement `all`                                                                                                                                                                                                                                                                                                                                                                  |
| PRM                                             | root e `/mcp` publicados                                                                                                                                                                                                                                                                                                                                                                              |
| Audiences aceitas                               | root, root slash, `/mcp`, `/mcp/`                                                                                                                                                                                                                                                                                                                                                                     |
| JWKS                                            | configurado em `/oauth/jwks.json`                                                                                                                                                                                                                                                                                                                                                                     |
| Cloudflare tunnel                               | permanente, 4 conexões HA                                                                                                                                                                                                                                                                                                                                                                             |
| Cloudflare transport                            | QUIC presente                                                                                                                                                                                                                                                                                                                                                                                         |
| Origin                                          | `https://127.0.0.1:3333`, HTTP/2 origin habilitado                                                                                                                                                                                                                                                                                                                                                    |
| Config rule MCP/OAuth                           | scoped, habilitada, `response_body_buffering=none`                                                                                                                                                                                                                                                                                                                                                    |
| Cache bypass                                    | regra Cloudflare scoped para MCP/OAuth/dynamic routes                                                                                                                                                                                                                                                                                                                                                 |
| Smoke workspace pós-implementação               | `success=true`, `status=degraded` apenas por worktree dirty                                                                                                                                                                                                                                                                                                                                           |
| Runtime stateful vivo                           | `enabled=true`, `requested=true`, `statelessCompat=false`, `postSessionContractEnforced=true`, `statelessFallbackPossible=false`                                                                                                                                                                                                                                                                      |
| Smoke OAuth autenticado atual                   | `runtimeHealth.ok=true`; `authenticatedToolsList.ok=true`, 102/102 tools; `authenticatedSse.ok=true`; GET/SSE SDK real recebeu chunk inicial; replay histórico seeded same-stream provado remotamente com `realReplayCandidate=true`, `initialLastEventId=_GET_stream...`, `reconnectEventReceived=true`; parser de `id:` refinado localmente para ignorar IDs não conformes                          |
| Validação local pós-sonda SDK/replay/read-cache | `mcp-fast` passou integralmente após replay seeded same-stream e otimização de clone do cache `repo_read_file`, job `fd24b9bf-9da1-48b5-9804-aaa28dc812f6`; último lint verde: `e85e09ed-4d48-4ab1-a9b2-3176629685af`                                                                                                                                                                                 |
| Medição `repo_read_file` pós-restart            | leitura repetida do mesmo range confirmou `misses=1`, `sets=1`, `hits=1`; média da tool ~5 ms em 2 chamadas e handler do cache-hit ~0 ms; gargalo corrente maior está no smoke remoto completo, não no read local                                                                                                                                                                                     |
| `mcp-full`                                      | execução pós-parser SSE/JSON anterior concluída com `passed=true`, `exitCode=0`, job `36828763-587d-4f35-9127-c11fd87cfe30`                                                                                                                                                                                                                                                                           |
| Cloudflare/edge atual                           | readiness `ready=true`; tunnel permanente saudável; remoto Cloudflare config v3 sincronizado; DNS CNAME proxied correto; 4 conexões HA; QUIC + HTTP/2 origin; gate vivo ainda reprova por contador agregado `requestErrorRate`; código/teste já reclassificam esse caso como histórico quando smoke, HA e origin estão saudáveis, pendente de restart do processo MCP para carregar a heurística nova |

---

### 2.1 Auditoria profunda de latência `repo_read_file` / `repo_apply_patch` — 2026-06-14 UTC

**Objetivo desta rodada:** reduzir latência mesmo onde a latência absoluta já está baixa. A leitura
local deixou de ser gargalo funcional, mas ainda há custo fixo e custo de cauda que pode ser
reduzido sem sacrificar segurança, hash, diff, auditoria, rollback ou invalidação de cache.

#### 2.1.1 Medições observadas no processo pós-restart

**Queda 503 investigada:** a indisponibilidade anterior coincidiu com restart do origin/túnel. Após
o restart, `mcp_post_restart_readiness` voltou `ready=true`, health local/público 200, MCP HTTP e
cloudflared vivos. Logs mostram `Connection terminated` nas conexões cloudflared durante o restart e
depois apenas `context canceled` típico de stream fechado pelo cliente; não há sinal de falha
persistente de OAuth/Cloudflare.

| Sinal                                           |                                                  Medição | Interpretação                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------- |
| `repo_read_file`                                |             3 chamadas, média ~4 ms; handler médio ~3 ms | caminho local está saudável; segunda leitura idêntica confirmou cache-hit                                   |
| Cache de resposta `repo_read_file`              | `hits=1`, `misses=2`, `sets=2`, `size=1`, `bytes≈20 KiB` | cache funciona no processo novo; baixa amostra ainda não justifica L2 persistente por padrão                |
| Leitura repetida de mesmo range                 |     `misses=1`, `sets=1`, `hits=1` no cenário controlado | cache-hit real com clone estrutural carregado                                                               |
| `repo_apply_patch` observado em rodada anterior |                           ~39–105 ms em patches pequenos | latência dominada por caminho de mutação segura, lock, leitura integral, hash, diff/auditoria e invalidação |
| `repo_patch_plan` em arquivo ~19 KiB            |                  plano com diff suprimido e 1 ocorrência | custo aceitável para preflight; ainda lê/analisa conteúdo para contar matches e gerar metadados             |
| `mcp_connector_smoke_refresh`                   |                                                   ~8,1 s | maior gargalo corrente é smoke remoto composto; não deve contaminar baseline de read/patch                  |

#### 2.1.2 Decomposição causal — `repo_read_file`

1. **Resolução e política de path.** Cada chamada passa por `resolveReadPath`, bloqueios de path
   protegido e normalização workspace-relative. Custo baixo, mas fixo.
2. **Cache de resposta MCP acima do IO cache.** `repo-read-cache.js` mantém payload já formatado por
   range/chunk. A otimização aplicada substituiu `JSON.stringify/parse` por clone estrutural
   JSON-like, preservando strings imutáveis sem reserializar conteúdo de arquivo.
3. **Validação de cache-hit.** Mesmo em hit, `getValidatedRepoReadCacheEntry` faz `statPath` quando
   `COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS=0`. Isso preserva correção, mas impõe syscall fixa por
   hit.
4. **IO L1 de texto e line offsets.** O IO cache L1 e `lineOffsets` estão ativos; porém, em workload
   curto pós-restart, o hotset ainda é pequeno e L2 permanece desativado.
5. **Tamanho de resultado.** O caminho usa `withResultSizeHint`, evitando stringify pesado para byte
   accounting. O custo residual é serialização final do protocolo MCP/JSON-RPC pelo host.
6. **Invalidation bus.** Escritas e patches limpam o cache por path; isso é correto, mas reduz hit
   ratio quando a própria auditoria edita o arquivo recém-lido.

**Causa-raiz atual do custo residual em read:** não é disco puro; é combinação de validação segura
por `statPath`, clonagem de objeto estruturado, montagem de resposta e invalidação frequente durante
sessões de edição. A otimização de clone já removeu o maior custo evitável em hits com conteúdo
grande.

#### 2.1.3 Decomposição causal — `repo_apply_patch`

1. **Lock por recurso.** `patchTextLocked` adquire lock exclusivo do path antes de ler e
   transformar. Essencial para segurança e consistência.
2. **Leitura integral do arquivo.** O patch engine lê o arquivo completo sob lock (`fs.readFile`) e
   decodifica UTF-8. Para arquivos pequenos isso é barato; para arquivos grandes vira custo linear.
3. **Hash obrigatório.** O caminho calcula `previousHash` e `contentHash`; se `expectedHash` é
   fornecido, também valida precondição. Isso é desejável, mas é custo O(n).
4. **Busca exact-string.** `computeTextPatch` usa busca textual para ocorrências; `replace_all` e
   `expected_occurrences` exigem contagem mais ampla. Patches com `occurrence_index` ou ocorrência
   única podem ser mais baratos se o engine tiver short-circuit.
5. **Rollback snapshot.** Mesmo em patch pequeno, o caminho prepara snapshot anterior; em arquivos
   grandes pode acionar sidecar. Segurança deve ser preservada.
6. **Diff preview.** Quando `includeDiffPreview=true`, `buildSimpleTextDiff` divide conteúdo antigo
   e novo por linhas e compara o arquivo inteiro. Mesmo com `maxDiffLines`, a comparação atual
   percorre todas as linhas para descobrir hunks. Este é o principal alvo de otimização estrutural
   para patches em arquivos médios/grandes.
7. **Escrita atômica e fsync.** Em aplicação real, `writeAtomicFileUnlocked` escreve arquivo inteiro
   atualizado; isso evita corrupção, mas faz patch pequeno custar como reescrita do arquivo.
8. **Auditoria e invalidação.** `appendMcpAuditEvent` e
   `clearRepoReadFileResultCacheForResolvedPath` são corretos, mas adicionam custo fixo e invalidam
   cache de leitura quente.

**Causa-raiz atual do custo residual em patch:** caminho é deliberadamente conservador. Mesmo patch
pequeno paga leitura integral, hash integral, possível diff integral, snapshot/rollback, escrita
atômica do arquivo inteiro, auditoria e invalidação. Reduzir latência sem perder funcionalidade
exige otimizar preflight/diff/cache, não remover proteções.

#### 2.1.4 Roadmap de micro-otimização sem perda funcional

| Faixa | Ação                                                                                                                                                                     |                                              Ganho esperado | Risco                                             | Estado                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------: | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| R1    | Manter clone estrutural no cache `repo_read_file`                                                                                                                        |                                menor CPU/GC em hits grandes | baixo                                             | implementado e validado por `mcp-fast`                                            |
| R2    | Introduzir trust window curto opcional para cache-hit de read, ex. 250–1000 ms em sessão MCP local                                                                       |               remove `statPath` repetido em reads imediatos | médio; precisa preservar invalidação por bus      | recomendado como opt-in, não default agressivo                                    |
| R3    | Adicionar campos de fase interna em `repo_read_file`: `resolvePathMs`, `cacheValidateMs`, `ioReadMs`, `cloneMs`, `shapeResultMs`                                         |                                  diagnóstico fino por etapa | baixo                                             | pendente                                                                          |
| R4    | Adicionar campos de fase interna em `repo_apply_patch`: `lockWaitMs`, `readMs`, `hashMs`, `matchMs`, `diffMs`, `snapshotMs`, `writeMs`, `auditMs`, `cacheInvalidationMs` |                              identifica cauda real de patch | baixo                                             | pendente                                                                          |
| R5    | Otimizar diff de patch usando range conhecido do match quando `replace_all=false` e há ocorrência única                                                                  | evita split/comparação do arquivo inteiro para diff preview | médio; exige testes de hunks/contexto             | implementado no core; `mcp-fast` verde job `f4753553-61c3-4f2f-a9d1-d556d8b863d2` |
| R6    | Para `includeDiffPreview=false`, manter `computeDiff=false` e auditar se algum wrapper ainda gera diff indireto                                                          |                         reduz custo de patches operacionais | baixo                                             | parcialmente já aplicado no tool handler                                          |
| R7    | Reutilizar metadados do `repo_patch_plan` em `repo_apply_patch` quando `expectedHash` e old/new são idênticos                                                            |             evita recontagem redundante em fluxo plan→apply | médio; precisa prevenir stale plan                | recomendado via token de plano curto/assinatura de hash                           |
| R8    | Batch de patches por arquivo com um único read/hash/write quando houver múltiplas edições no mesmo arquivo                                                               |                                   grande ganho em refactors | médio/alto; precisa resolver conflitos de offsets | futuro; hoje batch exige paths únicos                                             |
| R9    | Compactar/rotacionar `cloudflared.log` oversized                                                                                                                         |                reduz ruído operacional e custo de inspeções | baixo                                             | recomendado                                                                       |
| R10   | Separar baseline de latência local de smoke remoto composto                                                                                                              |                       evita diagnóstico falso de read/patch | baixo                                             | recomendado para dashboards                                                       |

#### 2.1.5 Critérios de aceite para próxima rodada

- `repo_read_file` cache-hit de arquivo médio: handler p50 ≤ 2 ms, p95 ≤ 8 ms, sem reduzir
  hash/correção.
- `repo_apply_patch` pequeno com `includeDiffPreview=false`: p50 ≤ 50 ms em arquivo <100 KiB.
- `repo_apply_patch` pequeno com `includeDiffPreview=true`: diff p95 reduzido por
  diff-local/range-aware, sem regressão nos testes de preview.
- Métricas internas por fase devem explicar ao menos 90% do tempo handler de read/patch.
- Smoke remoto deve ser excluído de SLO local de tool latency, ou exibido em categoria própria.

---

### 2.2 Auditoria ampla atual — 2026-06-14 UTC

**Veredito:** o núcleo stateful está consolidado no runtime atual e já atende chamadas autenticadas
de `mcp_runtime_health` e `tools/list` em sessão. A falha remota restante foi estreitada: depois de
normalizar respostas POST em SSE, `authenticatedToolsList` passou com 102/102 tools; o único
bloqueio P0 observado agora é `authenticatedSse` por timeout no GET SSE. A hipótese de fallback
stateless deixou de ser o sinal corrente do último smoke, embora continue como classe diagnóstica
histórica a preservar.

| Sinal auditado                |                                                                         Resultado atual | Interpretação                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------- |
| `git_status`                  |                                      `main...origin/main` com mudanças locais ampliadas | inclui gate Cloudflare, parser OAuth smoke, testes e MDs associados                                  |
| `mcp_post_restart_readiness`  |                                                  `ready=true`, health local/público 200 | publicação remota e origin estão funcionais                                                          |
| `mcp_connector_smoke_refresh` |                         `ok=true` no smoke canônico sem auth; smoke autenticado parcial | PRM/OAuth challenge e rotas públicas estão saudáveis; estado autenticado agora expõe detalhes úteis  |
| `authenticatedOAuthSmoke`     |                   `ok=false`; `runtimeHealth.ok=true`; `authenticatedToolsList.ok=true` | sessão autenticada executa tool runtime e lista 102/102 tools; P0 falha só em SSE                    |
| `authenticatedSse`            | retorna em ~110 ms: envelope diagnóstico SSE passou, stream longo SDK ainda não provado | Cloudflare/auth/session/envelope SSE estão vivos; P0 restante é o GET/SSE longo real do SDK e replay |
| `mcp_connection_readiness`    |           `ready=true`, OAuth enforcement `all`, PRM root e `/mcp`, JWKS e audiences ok | auth e descoberta não são o gargalo atual                                                            |
| `mcp_oauth_friction_audit`    |                        reauth risk `low`, metadata alignment ok, refresh rotation ativa | OAuth operacional está alinhado                                                                      |
| `mcp_cloudflare_remote_audit` |           tunnel healthy, 4 conexões, config version 3, DNS correto, HTTP/2 origin true | Cloudflare remoto está sincronizado com o desenho HTTP/2+                                            |
| `mcp_cloudflare_config_audit` |                            regra scoped MCP/OAuth ativa, `response_body_buffering=none` | streaming não deve estar sendo bloqueado por buffering scoped                                        |
| `mcp_latency_dashboard`       |                                 `ok`, 26 chamadas, erro 0; `repo_read_file` médio ~3 ms | a latência local de leitura não é o gargalo corrente; gargalo remanescente está em GET/SSE remoto    |
| `mcp_smoke_workspace`         |                                   `success=true`, degraded apenas por `WORKSPACE_DIRTY` | superfície local MCP/repo segue íntegra                                                              |
| `mcp_runtime_health`          |                `ok=true`, auth cache/JWKS cache funcionando, read cache por bytes ativo | runtime local está saudável; há excesso de artefatos de jobs acima da retenção                       |
| `mcp-full`                    |                 `passed=true`, `exitCode=0`, job `36828763-587d-4f35-9127-c11fd87cfe30` | código atual compila, lint passa e unit-mcp passa                                                    |

**Conclusão causal atual:** antes de tentar otimizações adicionais de Cloudflare/QUIC, o próximo
passo P0 é corrigir o caminho de abertura/flush do GET SSE autenticado. O initialize/tool-call
stateful autenticado já foi provado indiretamente por `runtimeHealth.ok=true` e
`authenticatedToolsList.ok=true` com 102/102 tools. O smoke deve continuar falhando duro se voltar a
detectar initialize sem `Mcp-Session-Id`, mas esse não é o sinal corrente do último probe.

**Riscos ainda abertos para consolidação stateful:**

- [x] o runtime profile expõe política stateful ativa sem revelar segredos;
- [x] o smoke autenticado distingue parser SSE/JSON, fallback stateless histórico e probe de
      envelope SSE;
- [x] o router/runtime expõem política stateful ativa em health/runtime profile sem revelar
      segredos;
- [ ] o stream longo GET/SSE SDK remoto ainda não foi provado;
- [ ] o replay remoto com `Last-Event-ID` ainda não foi provado;
- [ ] métricas de latência estão contaminadas pelo smoke autenticado lento; após P0, é preciso nova
      baseline limpa.

---

### 2.3 Auditoria adicional desta sessão — 2026-06-14 America/Sao_Paulo

Escopo auditado: leitura integral dos dois MDs canônicos pedidos e inspeção dos arquivos centrais do
caminho stateful/SSE/OAuth: `http-stateful-router.js`, `http-shared.js`, `session-runtime.js`,
`oauth-smoke.js` e testes unitários relacionados.

Achados novos:

- [x] O router stateful já impõe sessão após initialize, valida GET SSE, valida cursor de replay e
      reusa transporte vivo da sessão.
- [x] O smoke OAuth já distingue runtime health, listagem de tools, envelope SSE diagnóstico e
      replay seeded same-stream.
- [ ] O P0 ainda aberto foi estreitado para o GET/SSE longo do SDK e para replay remoto dentro do
      budget; não é mais runtime health nem `tools/list`.
- [ ] A escrita direta em arquivos-fonte ficou bloqueada pela política do workspace nesta sessão;
      portanto esta rodada atualiza os MDs e deixa o patch técnico abaixo como pendente, sem
      declarar implementação inexistente.
- [x] Diagnóstico adicional: as chamadas mutáveis testadas foram barradas antes de alcançar o MCP. A
      mitigação operacional é reduzir payload, suprimir diff, planejar com ferramenta read-only e
      aplicar em uma única chamada quando o host permitir.

Patch técnico pendente para a próxima janela com escrita em fonte liberada:

- [ ] `http-stateful-router.js`: transformar o probe SDK SSE opt-in em multi-tentativa, com timers
      curtos, payload contendo tentativa/timestamp e limpeza de todos os timers no `finally`.
- [ ] `oauth-smoke.js`: trocar leitura de primeiro chunk por acumulador de frame SSE até linha em
      branco, limite de bytes e timeout, parseando `id:` sobre o buffer acumulado.
- [ ] Testes: cobrir múltiplas tentativas do probe SDK e frame SSE fragmentado.

Critério booleano novo:

```yaml
sdk_sse_probe_multi_attempt_available: false
sse_smoke_frame_accumulator_available: false
sse_probe_default_contract_unchanged: true
remote_sse_get_failure_narrowed_to_sdk_long_stream: true
```

---

## 3. Diagnóstico de implementação atual

### 3.1 Implementado e confirmado por código

| Capacidade                                    | Estado | Arquivos principais                                         |
| --------------------------------------------- | ------ | ----------------------------------------------------------- |
| Endpoint `/mcp` com `POST/GET/DELETE`         | [x]    | `adapters/http-shared.js`                                   |
| Body reader JSON MCP bounded                  | [x]    | `adapters/http-body.js`                                     |
| Detecção de initialize via SDK                | [x]    | `adapters/http-body.js`                                     |
| Stateful router com sessão viva               | [x]    | `adapters/http-stateful-router.js`                          |
| `Mcp-Session-Id` obrigatório pós-initialize   | [x]    | `adapters/http-stateful-router.js`                          |
| 400 para sessão ausente                       | [x]    | `adapters/http-stateful-router.js`                          |
| 404 para sessão desconhecida/expirada         | [x]    | `adapters/http-stateful-router.js`                          |
| DELETE com tombstone e cleanup                | [x]    | `adapters/http-stateful-router.js`, `session-runtime.js`    |
| Runtime process-local com TTL/maxSessions     | [x]    | `control-plane/session-runtime.js`                          |
| Store SQLite de metadados/tombstones          | [x]    | `control-plane/session-store.js`                            |
| Event-store memória e SQLite                  | [x]    | `control-plane/event-store.js`                              |
| SQLite event-store no caminho operacional     | [x]    | `adapters/http-stateful-router.js`                          |
| Validação sintática de `Last-Event-ID`        | [x]    | `adapters/http-stateful-router.js`                          |
| Binding de sessão por claims OAuth validadas  | [x]    | `control-plane/auth.js`, `adapters/http-stateful-router.js` |
| Redação de issuer/subject/client_id           | [x]    | `control-plane/auth.js`                                     |
| Fallback in-memory/teste sem bearer bruto     | [x]    | `adapters/http-stateful-router.js`                          |
| Cache MCP de resposta `repo_read_file`        | [x]    | `tools/repo-read-cache.js`                                  |
| Cache MCP de resposta `repo_read_file_chunks` | [x]    | `tools/repo-read-cache.js`                                  |
| IO L1/L2 e line-offset cache                  | [x]    | `infra/io/*`                                                |
| FileContext cache para outline                | [x]    | `infra/io-parser.js`                                        |
| Cloudflare passthrough/cache bypass           | [x]    | regras auditadas por tools Cloudflare                       |

### 3.2 Lacunas remanescentes

| Lacuna                                                           | Severidade | Status                                                                                  |
| ---------------------------------------------------------------- | ---------: | --------------------------------------------------------------------------------------- |
| Smoke remoto autenticado de initialize/tool-call stateful        |         P0 | [x] `runtimeHealth.ok=true`; `authenticatedToolsList.ok=true`, 102/102 tools            |
| Smoke remoto autenticado de GET/SSE longo                        |         P0 | [ ] pendente; envelope diagnóstico passa em ~110 ms; stream longo SDK ainda não provado |
| Smoke remoto autenticado de reconnect + `Last-Event-ID` replay   |         P0 | [ ] pendente; instrumentado no smoke, ainda não provado remoto                          |
| Classificação dos origin errors recentes                         |         P0 | [x] `context canceled`/client close separado de falha origin real                       |
| Gate Cloudflare separar 401/400 esperados de origin errors reais |         P0 | [x] smoke canônico aceita 401 OAuth challenge esperado                                  |
| Nova execução `mcp-full` após os últimos patches                 |         P0 | [x] `passed=true`, `exitCode=0`, job `36828763-587d-4f35-9127-c11fd87cfe30`             |
| Sweeper periódico explícito de sessões                           |         P1 | [ ] pendente                                                                            |
| Teste de múltiplas SSE streams sem broadcast duplicado           |         P1 | [ ] pendente                                                                            |
| Byte-offset seek UTF-8-safe para chunks                          |         P1 | [x] implementado e validado                                                             |
| Singleflight de leituras concorrentes                            |         P1 | [x] implementado e validado                                                             |
| Limite de cache `repo_read` por bytes além de número de entradas |         P1 | [x] implementado e validado                                                             |
| Remoção final do fallback stateless                              |         P2 | [ ] pendente                                                                            |
| História HA multi-runtime                                        |         P2 | [ ] pendente                                                                            |

---

## 4. Origem provável da latência

### 4.1 Evidência operacional

O dashboard de latência observado nesta auditoria não mostrou `repo_read_file` como gargalo local. A
amostra viva atual ficou degradada porque `mcp_connector_smoke_refresh` levou ~14s e contaminou a
média de handler; o próprio relatório de runtime continua mostrando `repo_read_file` em
milissegundos baixos e smoke workspace com `repo_read_file` ~2 ms. Assim, a latência P0 atual é de
handshake/estado remoto, não da tool `read`.

### 4.2 Interpretação

A latência percebida pelo cliente remoto provavelmente vem de uma composição de fatores:

1. **handshake OAuth + initialize/session lifecycle**, agora com evidência de initialize remoto sem
   `Mcp-Session-Id`;
2. **smoke autenticado serializado**, que executa DCR/token/tools/SSE e hoje domina a amostra de
   latência;
3. **ruído de client close/tunnel recuperado**, que deve continuar separado de falha origin real;
4. **serialização e payload**, sobretudo para arquivos grandes, ainda sem métricas finas de
   stringify/flush;
5. **search/index/outlines**, que variam mais que leitura direta;
6. **transporte Cloudflare/QUIC**, que está saudável na auditoria remota, mas deve ser rebenchmarked
   só depois do P0 stateful remoto verde.

Conclusão: otimizar agressivamente `read` sem corrigir o caminho remoto e sem instrumentar
serialização pode gerar pouco ganho perceptível.

---

## 5. Implementação P0 aplicada nesta rodada

### 5.1 OAuth/session binding por claims

Arquivos alterados:

- `src/copilot/mcp/control-plane/auth.js`
- `src/copilot/mcp/adapters/http-stateful-router.js`
- `tests/unit/copilot/mcp/test_mcp_session_auth_binding_claims.spec.js`

Mudanças:

- [x] criado `buildMcpSessionAuthBindingFromVerifiedJwtPayload(...)`;
- [x] criado `resolveMcpSessionAuthBinding(...)`;
- [x] session binding usa JWT validado por JWKS no caminho operacional;
- [x] binding grava hashes de `iss`, `sub` e `client_id`/`azp`;
- [x] binding preserva apenas `resource`, `audience` e scopes suportados;
- [x] bearer bruto não é persistido no runtime;
- [x] DPoP-bound token passa por validação antes do binding;
- [x] static bearer, quando usado, vira fallback redigido `secure-mcp-tunnel`;
- [x] teste unitário novo garante hashing e remoção de identificadores crus.

Observação: o router mantém fallback redigido apenas quando `useSqliteStore=false`, usado por
harnesses unitários/in-memory. O caminho operacional default continua indo para
`resolveMcpSessionAuthBinding(...)` com JWKS/claims.

### 5.2 Event-store e `Last-Event-ID`

Arquivos alterados:

- `src/copilot/mcp/adapters/http-stateful-router.js`

Mudanças:

- [x] default operacional do stateful router usa `createSqliteMcpEventStore()`;
- [x] `createMcpInMemoryEventStore()` fica reservado para `useSqliteStore=false` e testes;
- [x] GET stateful valida `Last-Event-ID` com `parseMcpEventId(...)` antes de abrir stream;
- [x] event-store SQLite existente segue como base para replay stream-scoped;
- [ ] smoke remoto autenticado de replay ainda pendente.

### 5.3 Testes e validação

Mudanças:

- [x] criado `tests/unit/copilot/mcp/test_mcp_session_auth_binding_claims.spec.js`;
- [x] `mcp_smoke_workspace` passou após a implementação, degradado só por worktree dirty;
- [x] `mcp-full` detectou erro de typecheck intermediário em `auth.js`; corrigido;
- [x] `mcp-full` detectou erro de typecheck intermediário em typedef do router; corrigido;
- [x] rerun final completo `mcp-full` executado após correções: `passed=true`, `exitCode=0`.

---

## 6. Roadmap booleano atualizado

### P0 — Fechar integridade stateful/resumable e segurança de sessão

- [x] **P0.1 — Claims OAuth no session binding**
  - [x] P0.1.1 Criar helper que monta binding a partir de JWT já verificado.
  - [x] P0.1.2 Verificar issuer, audience, algoritmos e JWKS antes de usar claims.
  - [x] P0.1.3 Validar resource claim quando exigido.
  - [x] P0.1.4 Validar DPoP antes de binding quando `cnf.jkt` existir.
  - [x] P0.1.5 Hash de issuer, subject e client_id.
  - [x] P0.1.6 Preservar scopes suportados ordenados.
  - [x] P0.1.7 Não persistir bearer bruto.
  - [x] P0.1.8 Teste unitário de hashing/escopo.
- [x] **P0.2 — Router stateful usa binding forte**
  - [x] P0.2.1 Resolver binding no initialize.
  - [x] P0.2.2 Registrar sessão com binding resolvido.
  - [x] P0.2.3 Resolver binding em POST/GET/DELETE session-bound.
  - [x] P0.2.4 Comparar mode/resource/audience/issuer/subject/client/scopes.
  - [x] P0.2.5 Rejeitar mismatch com 403.
  - [x] P0.2.6 Fallback in-memory de teste não armazena bearer bruto.
- [x] **P0.3 — Event-store operacional e Last-Event-ID básico**
  - [x] P0.3.1 Usar SQLite event-store por default operacional.
  - [x] P0.3.2 Manter memória apenas para `useSqliteStore=false`.
  - [x] P0.3.3 Validar formato de `Last-Event-ID` no GET.
  - [x] P0.3.4 Retornar 400 para `Last-Event-ID` inválido.
  - [x] P0.3.5 Provar replay real local com evento posterior por teste do router
        `GET + Last-Event-ID`.
  - [ ] P0.3.6 Provar replay remoto via Cloudflare.
- [ ] **P0.4 — Cloudflare post-change gates e edge posture verdes**
  - [x] P0.4.1 Classificar amostra atual dos origin errors: 8 entradas `context canceled` após o
        smoke/gate recente.
  - [x] P0.4.2 Separar 401 OAuth esperado de erro operacional real no smoke sem auth: `tools/list`
        401 é esperado e aceito como desafio OAuth.
  - [x] P0.4.3 Separar client close/SSE normal de origin error real no avaliador; exige restart do
        MCP para o gate vivo refletir a heurística nova.
  - [x] P0.4.4 Implementar/testar reclassificação de `requestErrorRate` agregado como histórico
        quando smoke fresco, HA, auditoria remota e origin diagnostics estão saudáveis; gate vivo
        ainda requer restart do processo MCP para carregar a heurística nova.
  - [x] P0.4.5 Auditar Cloudflare remoto/config atual: tunnel healthy, config version 3, DNS CNAME
        proxied correto, `http2Origin=true`, `disableChunkedEncoding=false`,
        `response_body_buffering=none` scoped.
- [ ] **P0.5 — Validação final**
  - [x] P0.5.1 Rodar `mcp-full` pós-patches finais; resultado final `passed=true`, `exitCode=0`, job
        `36828763-587d-4f35-9127-c11fd87cfe30`.
  - [ ] P0.5.2 Rodar smoke remoto autenticado SSE.
    - [x] P0.5.2.a Instrumentar `oauth-smoke` para abrir GET SSE autenticado stateful e validar
          `text/event-stream` sem consumir stream infinito.
    - [x] P0.5.2.b Executar CLI equivalente via `mcp_connector_smoke_refresh` e registrar resultado
          real: `runtimeHealth.ok=true`, `authenticatedToolsList.ok=true`, 102/102 tools, envelope
          diagnóstico passa em ~110 ms, stream longo SDK ainda não provado.
  - [ ] P0.5.3 Fazer o smoke remoto autenticado reconnect + `Last-Event-ID` passar.
    - [x] P0.5.3.a Instrumentar `oauth-smoke` para tentar reconexão GET SSE com `Last-Event-ID`
          válido.
    - [x] P0.5.3.b Executar tentativa remota via `mcp_connector_smoke_refresh`; resultado real:
          timeout no GET SSE.
    - [x] P0.5.3.c Implementar probe SSE explícito e inofensivo no router, ativado apenas por
          `x-copilot-mcp-sse-probe: 1`.
    - [x] P0.5.3.d Fazer `oauth-smoke` enviar o header diagnóstico no GET SSE autenticado.
    - [x] P0.5.3.e Validar código com `mcp-full`: `passed=true`, `exitCode=0`, job
          `36828763-587d-4f35-9127-c11fd87cfe30`.
    - [x] P0.5.3.f Reiniciar MCP HTTP e reexecutar `mcp_connector_smoke_refresh` com o novo router
          carregado.
    - [x] P0.5.3.g Registrar resultado histórico: `authenticatedSse` chegou a receber
          `200 application/json` sem `Mcp-Session-Id`; classe diagnóstica preservada.
    - [x] P0.5.3.h Normalizar POST Streamable HTTP em SSE no `oauth-smoke`; `tools/list` autenticado
          passou a contar 102/102 tools.
    - [x] P0.5.3.i Tornar o restart stateful auditável/à prova de erro no nível de política: OAuth
          enforcement all agora ativa stateful automaticamente salvo opt-out explícito;
          readiness/runtime health expõem policy; stateless fallback tem warning e contador.
    - [ ] P0.5.3.j Reiniciar o processo remoto com este patch e provar initialize remoto com
          `Mcp-Session-Id`.
    - [ ] P0.5.3.k Só então provar GET SSE remoto e reconnect `Last-Event-ID` dentro do budget.
    - [ ] P0.5.3.l Implementar melhoria opt-in do probe SDK no router stateful.
    - [ ] P0.5.3.m Implementar leitura acumulativa de frame no smoke OAuth.
  - [x] P0.5.4 Atualizar este documento com os resultados finais e com a pendência real de SSE
        remoto.

**Critério booleano de saída P0:**

```yaml
claims_based_session_binding: true
raw_bearer_never_persisted: true
stateful_router_enforces_binding: true
sqlite_event_store_operational_default: true
last_event_id_malformed_rejected: true
last_event_id_replay_proven_local: true
last_event_id_replay_proven_remote: false
cloudflare_post_change_gates_green: false
cloudflare_post_change_gates_code_heuristic_validated: true
remote_edge_readiness_green: true
authenticated_oauth_smoke_executed: true
authenticated_oauth_smoke_green: false
authenticated_tools_list_green: true
remote_stateful_initialize_session_id_proven: true
remote_sse_get_green: false
remote_sse_reconnect_last_event_id_green: false
mcp_full_after_final_patches_green: true
latest_mcp_full_job: 700fada4-bea8-4327-9f78-50ba225d0aea
stateful_policy_auto_enabled_by_oauth_all: true
runtime_health_exposes_stateful_policy: true
stateless_fallback_metric_available: true
stateless_initialize_detected_error_available: true
```

---

### P1 — Latência estrutural sem perda de funcionalidade

**Baseline atual da auditoria:** `mcp_latency_dashboard` voltou a `ok` na amostra local viva: 26
chamadas, 0 erros, `repo_read_file` em torno de 3 ms médios. O gargalo P0 remanescente não está em
leitura local, mas em abertura/flush do GET SSE remoto autenticado. Portanto, a prioridade antes de
novas micro-otimizações de `read` é fechar SSE remoto e então colher uma baseline maior, separando
smoke diagnóstico de tools usuais.

- [ ] **P1.0 — Baseline limpa pós-P0**
  - [ ] P1.0.1 Após provar initialize stateful remoto, reexecutar `mcp_connector_smoke_refresh` sem
        timeout/fallback.
  - [ ] P1.0.2 Persistir novo `mcp_latency_dashboard` com amostra mínima maior que 30 chamadas.
  - [ ] P1.0.3 Separar latência de smoke diagnóstico da latência de tools usuais (`read`, `search`,
        `stats`).
  - [ ] P1.0.4 Definir SLO remoto: initialize p95, tools/list p95, `repo_read_file` p95,
        `repo_read_file_chunks` p95, GET SSE open p95.
- [ ] **P1.1 — Observabilidade fina**
  - [ ] P1.1.1 Medir auth/JWKS cache hit vs miss.
  - [ ] P1.1.2 Medir body parse.
  - [ ] P1.1.3 Medir session lookup.
  - [ ] P1.1.4 Medir handler.
  - [ ] P1.1.5 Medir `JSON.stringify`.
  - [ ] P1.1.6 Medir bytes de resposta e tempo de flush.
- [x] **P1.2 — `repo_read_file_chunks` byte-offset seek**
  - [x] P1.2.1 Projetar índice UTF-8-safe de byte offsets por linha.
  - [x] P1.2.2 Fingerprint por size/mtime e cache LRU do índice de linhas.
  - [x] P1.2.3 Fallback para stream scan atual.
  - [x] P1.2.4 Testes com UTF-8 multibyte.
  - [ ] P1.2.5 Benchmark arquivo pequeno/médio/grande.
  - [x] P1.2.6 Validação completa: `mcp-full` `passed=true`, `exitCode=0`, job
        `4885088a-2079-4fbc-9c59-1d10b8ca7431`.
- [x] **P1.3 — Singleflight de read**
  - [x] P1.3.1 Coalescing de chamadas idênticas simultâneas para `repo_read_file` e
        `repo_read_file_chunks`.
  - [x] P1.3.2 Cleanup seguro de promises em sucesso/erro; sem manter inflight após resolução.
  - [x] P1.3.3 Métricas de leaders/joins/errors para arquivo e chunks.
  - [x] P1.3.4 Teste concorrente prova `misses=1`, `singleflightLeaders=1`, `singleflightJoins=1`
        para duas leituras idênticas simultâneas.
  - [x] P1.3.5 Validação isolada: typecheck `exitCode=0`, lint `exitCode=0`, unit-mcp `exitCode=0`.
- [x] **P1.4 — Cache por bytes**
  - [x] P1.4.1 Adicionar `COPILOT_MCP_REPO_READ_CACHE_MAX_BYTES`.
  - [x] P1.4.2 Adicionar limite por bytes para cache de arquivo e chunks.
  - [x] P1.4.3 Evicção LRU por peso real.
  - [x] P1.4.4 Deep clone JSON-like de resultados cacheados para impedir mutação de chunks em hits.
  - [x] P1.4.5 Reexecutar `mcp-full` após a correção final de lint do cache: `passed=true`,
        `exitCode=0`, job `7acbb95f-4a05-448f-aeeb-4b70bdf87808`.
- [ ] **P1.5 — Payload enorme sem mudar default**
  - [ ] P1.5.1 Desenhar `delivery: inline|resource` opcional.
  - [ ] P1.5.2 Manter `inline` como default.
  - [ ] P1.5.3 Garantir compatibilidade total com clientes atuais.

**Critério booleano de saída P1:**

```yaml
read_functionality_reduced: false
byte_offset_seek_available: true
singleflight_enabled: true
cache_weighted_by_bytes: true
serialization_metrics_available: false
transport_mode_metrics_available: true
stateless_fallback_counter_available: true
```

---

### P2 — Rollout stateful e remoção do stateless

**Diagnóstico atualizado:** o sinal corrente mudou: `mcp_runtime_health` e `tools/list` autenticados
já passam via fluxo stateful, com 102/102 tools. P2 continua necessário para eliminar fallback e
fechar rollout, mas o bloqueio operacional imediato é GET/SSE autenticado por timeout, não a
listagem de tools nem o parser de resposta POST.

- [ ] **P2.1 — Tornar stateful impossível de esquecer no restart operacional**
  - [x] P2.1.1 Registrar stateful policy em runtime health.
  - [x] P2.1.2 Fazer OAuth enforcement `all` ativar stateful por política, mesmo se o restart direto
        `copilot:mcp:quic:restart` for usado, salvo opt-out explícito.
  - [x] P2.1.3 Expor em readiness/runtime health: `enabled`, `statelessCompat`,
        `postSessionContractEnforced`, `sessionIdHashSecretPresent`.
- [ ] **P2.2 — Provar initialize stateful remoto**
  - [x] P2.2.1 Smoke autenticado falha explicitamente com `stateless_initialize_detected` quando não
        houver `Mcp-Session-Id`.
  - [x] P2.2.2 Smoke autenticado exige `Mcp-Session-Id` presente e não expõe valor bruto.
  - [x] P2.2.3 Reexecutar via Cloudflare/QUIC e origin HTTP/2+; `tools/list` stateful autenticado
        retornou 102/102 tools.
- [ ] **P2.3 — Confirmar ChatGPT connector stateful**
  - [x] P2.3.1 `tools/list` autenticado via sessão stateful.
  - [x] P2.3.2 `mcp_runtime_health` autenticado via sessão stateful.
  - [ ] P2.3.3 GET SSE autenticado com probe diagnóstico retorna `text/event-stream`.
- [ ] **P2.4 — Timebox do fallback stateless**
  - [ ] P2.4.1 Manter fallback apenas sob flag explícita `COPILOT_MCP_HTTP_STATELESS_COMPAT=true`.
  - [x] P2.4.2 Emitir warning/metric quando fallback stateless for usado.
  - [x] P2.4.3 Adicionar contador `statelessFallbackRequests` em runtime health.
- [ ] **P2.5 — Remover fallback após duas janelas verdes**
  - [ ] P2.5.1 Duas execuções verdes de `mcp_connector_smoke_refresh` autenticado.
  - [ ] P2.5.2 Duas execuções verdes de `mcp-full`.
  - [ ] P2.5.3 Remover fallback ou deixá-lo apenas em script de rollback documentado.

**Critério booleano de saída P2:**

```yaml
stateful_default_local: true
stateful_default_remote: true
remote_initialize_session_id_required: true
runtime_health_exposes_stateful_policy: true
stateless_fallback_timeboxed: true
stateless_fallback_removed: false
```

---

### P3 — Alta disponibilidade e multi-runtime

- [ ] P3.1 Documentar single-origin/sticky como requisito atual.
- [ ] P3.2 Expor health `multiRuntime=false` enquanto não houver owner routing.
- [ ] P3.3 Definir owner process por session ID.
- [ ] P3.4 Definir pub/sub ou queue.
- [ ] P3.5 Provar replay cross-process.
- [ ] P3.6 Definir failover: 404 vs reconstrução controlada.

**Critério booleano de saída P3:**

```yaml
multi_runtime_story_closed: false
sticky_or_owner_routing_enforced: false
cross_process_replay_validated: false
ha_runbook_ready: false
```

---

## 7. Plano imediato após esta atualização

1. Rodar `mcp-full` novamente após os patches finais.
2. Se falhar, corrigir typecheck/lint/testes e atualizar checkboxes P0.5.
3. Implementar teste local de replay real com evento posterior a `Last-Event-ID`.
4. Criar smoke remoto autenticado GET/SSE + reconnect.
5. Auditar Cloudflare post-change gate para classificar request errors.
6. Só depois iniciar P1 de latência estrutural.

---

## 8. Conclusão operacional

A migração saiu do estado stateless conceitual e já possui um núcleo stateful real. A rodada atual
fortaleceu o ponto mais sensível: sessão agora pode ser vinculada a claims OAuth validadas no
caminho operacional, com identificadores redigidos, e o event-store operacional passa a ser SQLite
por default. Também foi adicionada validação explícita de `Last-Event-ID` malformado antes de abrir
GET/SSE.

O P0, porém, só pode ser considerado encerrado quando três evidências estiverem verdes: `mcp-full`
pós-patches, smoke remoto autenticado SSE/reconnect e Cloudflare post-change gates com erro zero ou
erros esperados corretamente classificados. Até lá, o sistema está em estado **P0 estruturalmente
implementado, mas operacionalmente ainda em validação**.
