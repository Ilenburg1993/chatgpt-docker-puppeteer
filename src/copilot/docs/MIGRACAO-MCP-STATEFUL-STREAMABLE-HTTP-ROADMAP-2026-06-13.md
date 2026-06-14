# Migração MCP Stateful Streamable HTTP, OAuth, Cloudflare e latência `read`

**Data:** 2026-06-13  
**Escopo primário:** `src/copilot` com foco em `src/copilot/mcp`, OAuth, Cloudflare Tunnel, HTTP/2+ origin, QUIC, session runtime, event-store, SSE/replay e tools de leitura.  
**Documento recriado em:** 2026-06-13, após auditoria operacional e implementação P0 parcial/estrutural.  
**URL operacional:** `https://mcp.aurelin.org/mcp`  
**Protocolo-alvo:** MCP Streamable HTTP `2025-11-25`  
**Estado-alvo:** stateful/resumable por padrão, stateless apenas como fallback temporário e removível.

---

## 0. Decisões normativas atuais

| Decisão | Valor |
|---|---|
| Transporte remoto canônico | Streamable HTTP em HTTPS, origin HTTP/2+ via Cloudflare Tunnel |
| Protocolo-alvo | `2025-11-25` |
| Inicialização | `POST /mcp` sem `Mcp-Session-Id`, corpo JSON-RPC `initialize` |
| Pós-initialize | `Mcp-Session-Id` obrigatório |
| Canal servidor→cliente | `GET /mcp` com `Accept: text/event-stream` e sessão |
| Replay | `Last-Event-ID` validado e delegado ao event-store/SDK |
| Encerramento | `DELETE /mcp`, tombstone e 204 quando o SDK não escrever resposta |
| Binding de sessão | Claims OAuth validadas quando no caminho operacional; nunca bearer bruto |
| Event store operacional | SQLite por padrão no caminho stateful operacional; memória apenas `useSqliteStore=false`/testes |
| Cloudflare | QUIC atual, HTTP/2 origin, passthrough scoped, cache bypass, `response_body_buffering=none` |
| Latência `read` | Não remover funcionalidade; otimizar por cache, singleflight, byte offsets e serialização |

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
- Resource Indicators, issuer, audience, JWKS, scopes e token claims são parte do envelope de segurança.

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
- `Cache-Control: no-store, no-transform` e regra scoped Cloudflare são necessários para API/streaming.

Referências oficiais:

- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/`
- `https://developers.cloudflare.com/cache/concepts/cache-control/`

---

## 2. Estado operacional observado nesta auditoria

| Área | Estado observado |
|---|---|
| Readiness remoto | `ready=true`, OAuth configurado, sem blockers |
| URL MCP | `https://mcp.aurelin.org/mcp` |
| Auth mode | OAuth obrigatório, enforcement `all` |
| PRM | root e `/mcp` publicados |
| Audiences aceitas | root, root slash, `/mcp`, `/mcp/` |
| JWKS | configurado em `/oauth/jwks.json` |
| Cloudflare tunnel | permanente, 4 conexões HA |
| Cloudflare transport | QUIC presente |
| Origin | `https://127.0.0.1:3333`, HTTP/2 origin habilitado |
| Config rule MCP/OAuth | scoped, habilitada, `response_body_buffering=none` |
| Cache bypass | regra Cloudflare scoped para MCP/OAuth/dynamic routes |
| Smoke workspace pós-implementação | `success=true`, `status=degraded` apenas por worktree dirty |
| `mcp-full` | execução final pós-testes de replay/gate concluída com `passed=true`, `exitCode=0`, job `7acbb95f-4a05-448f-aeeb-4b70bdf87808` |
| Cloudflare post-change gates | pós-restart `ok=true`; métrica viva `requestErrorRate=0`, 4 HA connections, QUIC presente; restam apenas warnings de transporte recuperado |

---

## 3. Diagnóstico de implementação atual

### 3.1 Implementado e confirmado por código

| Capacidade | Estado | Arquivos principais |
|---|---|---|
| Endpoint `/mcp` com `POST/GET/DELETE` | [x] | `adapters/http-shared.js` |
| Body reader JSON MCP bounded | [x] | `adapters/http-body.js` |
| Detecção de initialize via SDK | [x] | `adapters/http-body.js` |
| Stateful router com sessão viva | [x] | `adapters/http-stateful-router.js` |
| `Mcp-Session-Id` obrigatório pós-initialize | [x] | `adapters/http-stateful-router.js` |
| 400 para sessão ausente | [x] | `adapters/http-stateful-router.js` |
| 404 para sessão desconhecida/expirada | [x] | `adapters/http-stateful-router.js` |
| DELETE com tombstone e cleanup | [x] | `adapters/http-stateful-router.js`, `session-runtime.js` |
| Runtime process-local com TTL/maxSessions | [x] | `control-plane/session-runtime.js` |
| Store SQLite de metadados/tombstones | [x] | `control-plane/session-store.js` |
| Event-store memória e SQLite | [x] | `control-plane/event-store.js` |
| SQLite event-store no caminho operacional | [x] | `adapters/http-stateful-router.js` |
| Validação sintática de `Last-Event-ID` | [x] | `adapters/http-stateful-router.js` |
| Binding de sessão por claims OAuth validadas | [x] | `control-plane/auth.js`, `adapters/http-stateful-router.js` |
| Redação de issuer/subject/client_id | [x] | `control-plane/auth.js` |
| Fallback in-memory/teste sem bearer bruto | [x] | `adapters/http-stateful-router.js` |
| Cache MCP de resposta `repo_read_file` | [x] | `tools/repo-read-cache.js` |
| Cache MCP de resposta `repo_read_file_chunks` | [x] | `tools/repo-read-cache.js` |
| IO L1/L2 e line-offset cache | [x] | `infra/io/*` |
| FileContext cache para outline | [x] | `infra/io-parser.js` |
| Cloudflare passthrough/cache bypass | [x] | regras auditadas por tools Cloudflare |

### 3.2 Lacunas remanescentes

| Lacuna | Severidade | Status |
|---|---:|---|
| Smoke remoto autenticado de GET/SSE longo | P0 | [ ] pendente |
| Smoke remoto autenticado de reconnect + `Last-Event-ID` replay | P0 | [ ] pendente |
| Classificação dos 3 origin errors recentes | P0 | [ ] pendente |
| Gate Cloudflare separar 401/400 esperados de origin errors reais | P0 | [ ] pendente |
| Nova execução `mcp-full` após os últimos patches | P0 | [x] `passed=true`, `exitCode=0`, job `8d849b58-5486-4c3a-b1e4-dc25a623f504` |
| Sweeper periódico explícito de sessões | P1 | [ ] pendente |
| Teste de múltiplas SSE streams sem broadcast duplicado | P1 | [ ] pendente |
| Byte-offset seek UTF-8-safe para chunks | P1 | [ ] pendente |
| Singleflight de leituras concorrentes | P1 | [ ] pendente |
| Limite de cache `repo_read` por bytes além de número de entradas | P1 | [ ] pendente |
| Remoção final do fallback stateless | P2 | [ ] pendente |
| História HA multi-runtime | P2 | [ ] pendente |

---

## 4. Origem provável da latência

### 4.1 Evidência operacional

O dashboard de latência observado nesta auditoria não mostrou `repo_read_file` como gargalo local. A amostra viva indicou `repo_read_file` em milissegundos baixos, enquanto `search` e alguns fluxos remotos apresentaram custo superior. O smoke workspace posterior continuou mostrando `repo_read_file` em ~1-2 ms, com `repo_file_outline` e search variando conforme cache/index.

### 4.2 Interpretação

A latência percebida pelo cliente remoto provavelmente vem de uma composição de fatores:

1. **ruído/erro remoto no Cloudflare/cloudflared**, pois `requestErrorRate > 0` apareceu nos post-change gates;
2. **p95 RPC cloudflared** significativamente maior que RTT QUIC, indicando que RTT bruto não explica tudo;
3. **handshake OAuth + initialize/session lifecycle**, maior que o handler local de read;
4. **serialização e payload**, sobretudo para arquivos grandes;
5. **falta de byte-offset seek em chunking**, que ainda usa stream line scan;
6. **search/index/outlines**, que variam mais que leitura direta.

Conclusão: otimizar agressivamente `read` sem corrigir o caminho remoto e sem instrumentar serialização pode gerar pouco ganho perceptível.

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

Observação: o router mantém fallback redigido apenas quando `useSqliteStore=false`, usado por harnesses unitários/in-memory. O caminho operacional default continua indo para `resolveMcpSessionAuthBinding(...)` com JWKS/claims.

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
  - [x] P0.3.5 Provar replay real local com evento posterior por teste do router `GET + Last-Event-ID`.
  - [ ] P0.3.6 Provar replay remoto via Cloudflare.
- [ ] **P0.4 — Cloudflare post-change gates verdes**
  - [x] P0.4.1 Classificar amostra atual dos origin errors: 8 entradas `context canceled` após o smoke/gate recente.
  - [x] P0.4.2 Separar 401 OAuth esperado de erro operacional real no smoke sem auth: `tools/list` 401 é esperado e aceito como desafio OAuth.
  - [x] P0.4.3 Separar client close/SSE normal de origin error real no avaliador; exige restart do MCP para o gate vivo refletir a heurística nova.
  - [x] P0.4.4 Reexecutar post-change gates pós-restart: `ok=true`, `requestErrorRate=0`, QUIC e HA verdes.
- [ ] **P0.5 — Validação final**
  - [x] P0.5.1 Rodar `mcp-full` pós-patches finais; resultado final `passed=true`, `exitCode=0`, job `8d849b58-5486-4c3a-b1e4-dc25a623f504`.
  - [ ] P0.5.2 Rodar smoke remoto autenticado SSE.
    - [x] P0.5.2.a Instrumentar `oauth-smoke` para abrir GET SSE autenticado stateful e validar `text/event-stream` sem consumir stream infinito.
    - [x] P0.5.2.b Executar CLI equivalente via `mcp_connector_smoke_refresh` e registrar resultado real: `authenticatedOAuthSmoke.ok=false`, `authenticatedSse` abortou por timeout após ~10s.
  - [ ] P0.5.3 Fazer o smoke remoto autenticado reconnect + `Last-Event-ID` passar.
    - [x] P0.5.3.a Instrumentar `oauth-smoke` para tentar reconexão GET SSE com `Last-Event-ID` válido.
    - [x] P0.5.3.b Executar tentativa remota via `mcp_connector_smoke_refresh`; resultado real: timeout no GET SSE.
    - [ ] P0.5.3.c Corrigir entrega/flush do GET SSE remoto para que o smoke autenticado receba headers/event stream dentro do budget.
  - [x] P0.5.4 Atualizar este documento com os resultados finais e com a pendência real de SSE remoto.

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
mcp_full_after_final_patches_green: true
```

---

### P1 — Latência estrutural sem perda de funcionalidade

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
  - [x] P1.2.6 Validação completa: `mcp-full` `passed=true`, `exitCode=0`, job `4885088a-2079-4fbc-9c59-1d10b8ca7431`.
- [x] **P1.3 — Singleflight de read**
  - [x] P1.3.1 Coalescing de chamadas idênticas simultâneas para `repo_read_file` e `repo_read_file_chunks`.
  - [x] P1.3.2 Cleanup seguro de promises em sucesso/erro; sem manter inflight após resolução.
  - [x] P1.3.3 Métricas de leaders/joins/errors para arquivo e chunks.
  - [x] P1.3.4 Teste concorrente prova `misses=1`, `singleflightLeaders=1`, `singleflightJoins=1` para duas leituras idênticas simultâneas.
  - [x] P1.3.5 Validação isolada: typecheck `exitCode=0`, lint `exitCode=0`, unit-mcp `exitCode=0`.
- [x] **P1.4 — Cache por bytes**
  - [x] P1.4.1 Adicionar `COPILOT_MCP_REPO_READ_CACHE_MAX_BYTES`.
  - [x] P1.4.2 Adicionar limite por bytes para cache de arquivo e chunks.
  - [x] P1.4.3 Evicção LRU por peso real.
  - [x] P1.4.4 Deep clone JSON-like de resultados cacheados para impedir mutação de chunks em hits.
  - [x] P1.4.5 Reexecutar `mcp-full` após a correção final de lint do cache: `passed=true`, `exitCode=0`, job `7acbb95f-4a05-448f-aeeb-4b70bdf87808`.
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
```

---

### P2 — Rollout stateful e remoção do stateless

- [ ] P2.1 Ativar stateful como default local.
- [ ] P2.2 Ativar stateful como default HTTP2 origin.
- [ ] P2.3 Confirmar ChatGPT connector stateful.
- [ ] P2.4 Manter fallback stateless por janela curta.
- [ ] P2.5 Emitir warning quando fallback stateless for usado.
- [ ] P2.6 Remover fallback após duas janelas verdes.

**Critério booleano de saída P2:**

```yaml
stateful_default_local: false
stateful_default_remote: false
stateless_fallback_timeboxed: false
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

A migração saiu do estado stateless conceitual e já possui um núcleo stateful real. A rodada atual fortaleceu o ponto mais sensível: sessão agora pode ser vinculada a claims OAuth validadas no caminho operacional, com identificadores redigidos, e o event-store operacional passa a ser SQLite por default. Também foi adicionada validação explícita de `Last-Event-ID` malformado antes de abrir GET/SSE.

O P0, porém, só pode ser considerado encerrado quando três evidências estiverem verdes: `mcp-full` pós-patches, smoke remoto autenticado SSE/reconnect e Cloudflare post-change gates com erro zero ou erros esperados corretamente classificados. Até lá, o sistema está em estado **P0 estruturalmente implementado, mas operacionalmente ainda em validação**.
