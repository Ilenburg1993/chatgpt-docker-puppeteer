# Auditoria Profunda — Repo DevContainer MCP

**Data:** 2026-06-10 a 2026-06-12 **Auditoria externa:** Claude Sonnet 4.6 (Anthropic), acesso via
MCP **Revalidação e remediação:** Codex **Workspace:** `/workspaces/chatgpt-docker-puppeteer`
**Base publicada antes desta revisão:** `main` @ `45f74116` **Escopo efetivo:** `src/copilot`
inteiro, seu MCP e os testes/validadores que provam esse código

---

## 1. Sumário Executivo

O baseline externo encontrou um sistema avançado, mas com duas falhas de barrel, gate unitário
incompleto, replay OAuth somente em memória, manutenção de startup ausente e várias classes de
persistência/cardinalidade sem garantias suficientes.

Após revalidação integral do escopo, foram confirmados ou invalidados todos os itens externos e
corrigidos **50 achados adicionais**. O gate `test:copilot:unit` agora descobre recursivamente 535
arquivos e fechou em `6389/6417` testes, `1946/1946` suites, zero falhas e 28 pendências esperadas.
Typecheck strict e lint Copilot também estão em PASS.

As causas de `degraded` controláveis por `src/copilot` foram tratadas: smoke de workspace agendado no
startup, cleanup bounded executado sobre 513 artefatos, quick-tunnel stale reconciliado e worktree
publicado. Em 2026-06-12, o processo permanente foi reiniciado no novo HEAD: origin HTTP/2 saudável,
quatro conexões HA Cloudflare, startup maintenance concluída e OAuth completo com `100/100` tools.

Persistem como trabalho relevante: benchmark controlado de transporte, decisão medida sobre ativar
L2 por perfil, plano de rotação de chaves OAuth com grace period e futuras avaliações de SDK v2
somente após release estável.

---

## 2. Baseline Externo Histórico e Estado Atual

> As subseções 2.1, 2.3 e 2.4 preservam a fotografia observada pela auditoria externa antes das
> remediações. O estado autoritativo pós-transformações está em 2.2 e no roadmap 5.0.

### 2.1 Runtime MCP

| Sinal            | Valor                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Status           | `degraded`                                                            |
| Warning          | Sem resultado `mcp_smoke_workspace` em memória                        |
| Informacional    | 513 artefatos além da retenção (`src/copilot/.ai/jobs`)               |
| Workspace        | dirty — `.codex/config.toml` modificado; arquivos não rastreados      |
| Index            | fresh, 1.481 arquivos, 9.916 símbolos, 2.664 chunks                   |
| Túnel permanente | `named-permanent`, último smoke: OK há 5 min                          |
| Túnel temporário | stale (morto há 26.823 min); processo não existe; state file persiste |

### 2.2 Validação pós-remediação

| Suite                                  | Status  | Detalhes                                                                 |
| -------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `npm run typecheck:strict:src.copilot` | ✅ PASS | Última execução após CDEX-049, 0 erros                                  |
| `npm run lint:copilot`                 | ✅ PASS | Gate espaçado pós-transformações                                         |
| `npm run test:copilot:unit`            | ✅ PASS | 535 arquivos; `6389/6417`; `1946/1946` suites; 28 pendências esperadas |
| Testes focados finais                  | ✅ PASS | `3/3` no smoke autenticado após `25/25` de turn trace/error alerter      |
| Runtime live                           | ✅ PASS | HTTP/2 200; 2 processos vivos; 4 HA; startup maintenance e OAuth OK       |
| Git                                    | ✅ PASS | `main` publicada e sincronizada após cada lote                           |

#### Falhas unit-copilot do baseline externo, já corrigidas

**W114.5 — Terminal barrel governance**

```
AssertionError: Imports cross-folder do terminal devem passar por barrels:
  commands/activity.js -> ../events/turn-trace-presentation.js
  commands/activity.js -> ../frontend/projections/now.js
  commands/byok.js    -> ../frontend/gateways/agent-runtime.js
  commands/byok.js    -> ../frontend/projections/config.js
  commands/config.js  -> ../frontend/projections/config.js
  commands/config.js  -> ../frontend/gateways/agent-runtime.js
  commands/context.js -> ../frontend/projections/timeline.js
```

**F151 — commands/config.js não usa barrel do frontend**

```
AssertionError: expected '...commands/config.js...' to contain "from '../frontend/index.js'"
```

Causa raiz: os arquivos em `src/copilot/terminal/commands/` importam diretamente de submódulos de
`../frontend/` e `../events/` sem passar pelos barrels `index.js` definidos na arquitetura
F30/F151/W114.

### 2.3 Performance MCP (métricas desta sessão)

| Tool             | Chamadas | Auth ms    | Handler ms | Total ms |
| ---------------- | -------- | ---------- | ---------- | -------- |
| `repo_root_tree` | 1        | 171        | 349        | 534      |
| `repo_tree`      | 1        | 0 (cache)  | 126        | 132      |
| `repo_read_file` | 18       | ~0 (cache) | ~3         | ~3       |

- **Authorization cache**: 186 hits / 1 miss — muito eficiente após warmup.
- **IO L1 cache**: 3 hits / 14 misses (17.6%) — esperado em sessão nova; L1 aquece rápido.
- **L2 SQLite**: desativado (`"reason": "disabled"`).
- **QUIC metrics**: p50=350ms, p95=1.170ms, p99=1.314ms — latência end-to-end alta no p99.

### 2.4 OAuth & Segurança

- `dev-oauth.js` v1.6.0: RFC 9728, RFC 9449 (DPoP), RFC 9207, PKCE, PAR, DCR, OIDC implementados.
- `auth.js` v1.3.0: JWKS remoto com TTL cache (10min), `authorizationDecisionCache` (4096 entradas,
  60s TTL).
- **Gap crítico**: `DPOP_REPLAY_CACHE_MAX_ENTRIES = 2000` e
  `PRIVATE_KEY_JWT_REPLAY_CACHE_MAX_ENTRIES = 2000` — **in-memory only, não persiste entre
  restarts**. Uma janela de replay attack até o processo reiniciar existe.
- `MAX_REGISTERED_CLIENTS = 100` e `MAX_REFRESH_TOKEN_RECORDS = 500` — sem política de
  expiração/rotação automática.

### 2.5 Estrutura do Repositório

Problemas estruturais detectados:

1. **Dois diretórios de documentação**: `DOCUMENTACAO/` (ASCII) e `DOCUMENTAÇÃO/` (UTF-8) coexistem.
2. **Arquivos raiz com `#` no nome**: `# Guia focado — Conexão do ChatGPT ao VS.md` e
   `# Relatório de Checagem Geral — MCP WOR.md` — nomes inválidos/problemáticos em sistemas de
   arquivo e git.
3. **Diretório `${containerUserHome}/`** na raiz do workspace — variável devcontainer não
   substituída; artefato de configuração.
4. **`.vscode/tasks.json.old`** — backup stale versionado.
5. **Arquivos de auditoria/conversa** espalhados na raiz: `DIAGNOSTICO-MCP-WORKSPACE-2026-06-09.md`,
   `AUDITORIA_FASE2_INVESTIGACAO.md`, `AUDITORIA_FINAL_CHECKPOINT.md`,
   `AUDITORIA_FINAL_CONSOLIDACION_COMPLETA.md`, `AUDITORIA_TOOLS_READ_COMPLETA.md`,
   `conversa-2026-06-08T15-52-41.md`, `CUSTOM-AGENTS-ARCHITECTURE-AUDIT.md` — deveriam estar em
   `DOCUMENTAÇÃO/AUDITORIAS/` ou `analysis/`.
6. **Git bundles grandes** em `analysis/backups/` (11MB+ rastreados).

---

## 3. Análise por Domínio

### 3.1 MCP Server (`src/copilot/mcp/`)

**Pontos fortes:**

- Arquitetura transport-neutral: stdio, HTTP/1.1 fallback e HTTP/2+ compartilham o mesmo registry.
- `server.js` v1.2.0 com validação de descritores contra prompt injection, fingerprint de
  descriptor, logging bounded.
- `registry.js` separa claramente surface policy, tool registration, scope enforcement e auditoria.
- Anotações `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` alinhadas ao Apps
  SDK.
- Suspicious descriptor patterns: 5 regexes contra prompt injection nos títulos/descrições de tools.

**Gaps:**

- Sem **surface profiles** por audiência (read-only, dev, admin, CI) — os 95+ tools são expostos
  uniformemente.
- Sem **schema Zod por tool** completo — há cobertura parcial; a maioria dos input schemas é
  `z.object({})` ou sem validação semântica forte.
- **`DEFAULT_MAX_TOOLS = 200`** é conservador mas sem alertas quando a contagem se aproxima.
- O `COPILOT_MCP_PROTOCOL_VERSION = '2025-11-25'` foi a versão mais recente em nov/2025; em jun/2026
  o spec foi atualizado para `2025-06-18`. **Verificar compatibilidade com a nova versão.**

### 3.2 OAuth & Autorização (`control-plane/auth.js`, `control-plane/dev-oauth.js`)

**Pontos fortes:**

- Implementação completa de RFC 9728 (PRM), RFC 9449 (DPoP), RFC 7636 (PKCE), RFC 7591 (DCR),
  RFC 9207.
- JWKS remoto cacheado com cooldown para evitar hammering.
- Decision cache com TTL adaptativo.
- Controles de budget por endpoint (rate limiting por sujeito).
- Validação `aud`, `iss`, `exp`, `resource` no JWT.

**Gaps:**

- **Replay cache in-memory**: `DPOP_REPLAY_CACHE_MAX_ENTRIES` e
  `PRIVATE_KEY_JWT_REPLAY_CACHE_MAX_ENTRIES` se perdem no restart. Janela de replay attack possível
  entre restarts.
- **Sem política de expiração de clientes** (`MAX_REGISTERED_CLIENTS = 100`): clientes expirados não
  são purgados automaticamente.
- **Refresh token store** (`oauth-refresh-tokens.json`): `MAX_REFRESH_TOKEN_RECORDS = 500` sem
  rotação automática de famílias antigas.
- **JWKS cold start**: primeira chamada da sessão custa ~171ms de autorização (lookup remoto +
  validação). Sem pre-warming ao iniciar o servidor.

### 3.3 Infra IO (`src/copilot/infra/`)

**Pontos fortes:**

- `io-locks.js`: mutex por resource key com fila Promise, deadline/abort, `AsyncLocalStorage` para
  deadlock detection, normalização de path.
- `io-cache.js` L1: LRU com TTL, fingerprint stale detection (mtime+size+SHA-256), invalidação ativa
  por prefixo, stats completas.
- `io-cache-l2-sqlite.js`: L2 SQLite preparado com circuit breaker.
- `io-parser-worker.js`: worker pool (2 workers) para parsing pesado.

**Gaps:**

- **L2 SQLite desativado**: `"reason": "disabled"` — o circuito está preparado mas nunca foi ligado.
  Com 14 misses em 17 chamadas de file na sessão atual, sessões frias são penalizadas.
- **L1 hit ratio 17.6%**: aguardado em sessão nova, mas sem estratégia de pre-warm para arquivos
  frequentes (ex: `package.json`, barrels principais).
- **`node:sqlite` (Node 24 built-in)**: disponível desde Node 24.0.0 — pode substituir
  `better-sqlite3` no L2, eliminando dependência nativa.
- **Worker pool size = 2**: estático, sem ajuste via env.

### 3.4 Terminal (`src/copilot/terminal/`)

**Pontos fortes:**

- Arquitetura REPL modular com commands, frontend, stores, events, state separados.
- Frontend projetions/gateways desacoplados via barrels.

**Bugs observados no baseline externo e já corrigidos:**

- `commands/activity.js`, `commands/byok.js`, `commands/config.js`, `commands/context.js` violam a
  governance de barrels W114.5: importam diretamente dos subdiretórios internos de `../events/` e
  `../frontend/` sem passar pelos `index.js`.
- `commands/config.js` viola F151: deve usar `from '../frontend/index.js'` como ponto de entrada
  único para o frontend, conforme a arquitetura F30.

### 3.5 Hooks (`src/copilot/hooks/`)

**Pontos fortes:**

- Sistema de hooks completo com presets (audit, deny-all, interactive, minimal, production, safe).
- `permission-controller.js`, `tool-filter.js`, `tool-interceptor.js` bem separados.
- `prompt-transformer.js` e `user-input.js` para elicitation.

**Gaps:**

- Sem teste unitário dedicado ao ciclo de vida de hooks (cobertura depende de testes de integração
  maiores).
- Hook elicitation sem timeout configurável via env.

### 3.6 Agent (`src/copilot/agent/`)

**Pontos fortes:**

- Arquitetura altamente modular: context, dialog, lifecycle, session, messaging, facades, ports,
  runtime.
- `always-alive-singleton.js` para keepalive.
- Ports pattern bem aplicado (conversation-port, mcp-port, hook-port, metrics-port, etc.).

**Gaps detectados por auditorias anteriores (não re-auditados nessa sessão):**

- Mutex race condition em `session/lifecycle` (reportado em auditoria 2026-03-01) — status de
  resolução não verificado.
- `handoff-manager.js` sem timeout explícito documentado.

### 3.7 CI/CD & Workflows

**Pontos fortes:**

- 22 workflows para diferentes aspectos (ci, lint, unit-tests, security, scorecard,
  dependency-review, etc.).
- `copilot-setup-steps.yml` (36KB) para setup completo.
- Dependabot configurado.

**Gaps:**

- `main_chatgpt-docker-puppeteer.yml` (1.8KB) parece um workflow de deploy Azure herdado — verificar
  se ainda é relevante.
- Nenhum workflow dispara `mcp_smoke_workspace` pós-deploy.
- `audit-nightly.yml` usa `--cloud-fallback off` — sem mecanismo de fallback em falhas de rede.

---

## 4. Situação Ideal

### 4.1 Runtime & Status

O estado ideal é o servidor iniciando sem `degraded`:

- Startup dispara `mcp_smoke_workspace` automaticamente (ex: após 30s de uptime, assíncrono).
- AI artifacts cleanup automático via job periódico ou tool bounded.
- Túnel temp stale limpo do state file na inicialização se processo não existe.
- Workspace commitado antes de qualquer operação destrutiva.

### 4.2 Testes

- 100% de testes passando em todos os validators.
- `unit-copilot` sem falhas de barrel governance.
- Coverage de hooks com testes dedicados.

### 4.3 Performance

- Autorização cold start < 30ms via JWKS pré-aquecido na inicialização.
- L1 hit ratio > 60% em sessão ativa (com pre-warm de barrels e arquivos críticos).
- L2 SQLite ativado para persistência entre sessões frias.
- QUIC latência p99 < 500ms (investigação e benchmark automático).

### 4.4 Segurança

- Replay cache DPoP/private_key_jwt persistido em SQLite (mesmo banco do L2).
- Política de expiração de clientes OAuth automática.
- Rotação de famílias de refresh token com TTL configurável.

### 4.5 Superfície MCP

- Profiles de superfície por audiência: `read-only`, `dev`, `cloudflare-admin`, `ci`.
- Schemas Zod fortes em todos os tools de escrita.
- Contagem de tools < 60 no profile padrão (foco nos mais usados).

### 4.6 Estrutura

- Um único `DOCUMENTAÇÃO/` consolidado (sem duplicata ASCII).
- Raiz limpa: sem `#`, sem `${var}`, sem `.old`, sem arquivos de conversa.
- Auditorias e diagnósticos em `DOCUMENTAÇÃO/AUDITORIAS/` com naming canônico.
- Git bundles em `.gitignore` ou removidos do histórico.

---

## 5. Roadmap Amplo com Faixas e Fases

> **Formato das subfases:** `[ ]` = pendente, `[x]` = concluído, `[~]` = parcial/em andamento
> **Severidade:** 🔴 crítico/bug, 🟠 gap importante, 🟡 melhoria, 🟢 upgrade/oportunidade

## 5.0 Revalidação independente Codex — 2026-06-11/12

### Escopo efetivo

- Apenas `src/copilot`, incluindo `src/copilot/mcp`, e os testes unitários que validam esse código.
- Itens sobre raiz do repositório, `.codex`, `.vscode`, `DOCUMENTACAO/`, `DOCUMENTAÇÃO/`,
  `analysis/`, workflows e scripts fora de `src/copilot` são **N/A nesta execução**.
- Validadores canônicos: `typecheck:strict:src.copilot`, `lint:copilot` e `test:copilot:unit`.

### Baseline reproduzido e fechamento

| Validador                              | Baseline inicial                         | Fechamento publicado                                      |
| -------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `npm run typecheck:strict:src.copilot` | PASS                                     | PASS após CDEX-046                                        |
| `npm run lint:copilot`                 | PASS                                     | PASS no gate espaçado                                     |
| `npm run test:copilot:unit`            | FAIL 3.880/3.882 no gate raso            | PASS 6.389/6.417 no gate recursivo, 28 pendências esperadas |

O runtime permanente também foi verificado: `named-permanent`, URL `https://mcp.aurelin.org/mcp`,
origin HTTP/2, edge QUIC, health 200, processos MCP e `cloudflared` vivos. O quick tunnel salvo está
morto e stale, mas é fallback legado e não representa indisponibilidade do túnel permanente.

### Veredito dos achados externos

| ID externo                     | Veredito                            | Evidência atual                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 barrels do terminal        | **CONFIRMADO E RESOLVIDO**          | Imports migrados aos barrels públicos e gate recursivo em PASS.                                                                                                                                                          |
| 1.2 workspace/root cleanup     | **N/A**                             | Fora de `src/copilot`; o worktree contém alterações intencionais em OAuth/docs que devem ser preservadas.                                                                                                                |
| 1.3 artefatos AI               | **CONFIRMADO E RESOLVIDO**          | Cleanup bounded removeu 513 candidatos e preservou 240 recentes, stores e arquivos não UUID.                                                                                                                            |
| 1.4 quick tunnel stale         | **CONFIRMADO E RESOLVIDO**          | Startup maintenance remove state apenas quando válido, stale e com PID comprovadamente morto.                                                                                                                          |
| 1.5/1.6 organização da raiz    | **N/A**                             | Fora do escopo solicitado.                                                                                                                                                                                               |
| 2.1 smoke no startup           | **CONFIRMADO E RESOLVIDO**          | Smoke read-only é agendado uma vez por processo, não bloqueante e configurável.                                                                                                                                          |
| 2.2 JWKS warmup                | **CONFIRMADO E IMPLEMENTADO**       | `createRemoteJWKSet` era lazy. O HTTP startup agora agenda `reload()` deduplicado, expõe estado/tempo/chaves em health e usa o cache TTL existente; a meta fixa `<30ms` ainda exige benchmark live controlado.                                                                          |
| 2.3 L2 SQLite                  | **CONFIRMADO PARCIAL**              | Implementação, invalidação, pruning, circuit breaker e métricas existem; default está off. `IO_L2_CACHE_PATH` não existe: o L2 usa `copilot.sqlite`.                                                                     |
| 2.4/5.6 QUIC p99               | **PENDENTE DE EXPERIMENTO**         | O p99 1.314ms é histórico e não prova causalidade do transporte; QUIC atual tem health/smoke OK.                                                                                                                         |
| 2.5 rate limit anônimo         | **ORIGIN RESOLVIDO; EDGE PENDENTE** | Origin valida confiança de proxy/IP e aplica teto real de buckets; regra Cloudflare continua operação externa.                                                                                                          |
| 2.6 cleanup bounded            | **CONFIRMADO E RESOLVIDO**          | Tool destructive/admin, dry-run por default, retenção e lote máximos implementados/testados.                                                                                                                            |
| 3.1 replay persistente         | **CONFIRMADO E RESOLVIDO**          | DPoP resource/issuer e `private_key_jwt` usam replay store SQLite, hash-only e resistente a restart/processos.                                                                                                           |
| 3.2 expiração/rotação OAuth    | **INVALIDADO**                      | DCR já tem TTL, pruning e persistência; refresh tokens já são one-time rotating, persistidos como hash e revogam família em reuse.                                                                                       |
| 3.3 surface profiles           | **INVALIDADO COMO AUSENTE**         | Já existem `full`, `latency`, `minimal`, `cloudflare`, `readonly`, `claude`, `safe`, `research`; 99 tools full e 37 no perfil safe/claude/research. Falta apenas nomenclatura/contrato `dev` e `ci`, se ainda desejados. |
| 3.4/3.5 docs/bundles           | **N/A**                             | Fora de `src/copilot`.                                                                                                                                                                                                   |
| 3.6 protocol version           | **INVALIDADO**                      | `2025-11-25` é a versão MCP corrente em 2026-06-11; `2025-06-18` é anterior. SDK v1.29.0 segue recomendado para produção; v2 ainda está em desenvolvimento.                                                              |
| 4.1 `node:sqlite` stable       | **INVALIDADO**                      | No Node atual, `node:sqlite` ainda está em release candidate; `better-sqlite3` 12.10.0 está instalado e integrado.                                                                                                       |
| 4.2 `await using` amplo        | **NÃO ACEITO COMO MIGRAÇÃO GLOBAL** | O código já centraliza timers/shutdown; troca ampla sem ganho medido elevaria risco.                                                                                                                                     |
| 4.3 worker pool dinâmico       | **MAJORITARIAMENTE INVALIDADO**     | `IO_PARSER_WORKER_POOL_SIZE` e métricas já existem; somente o default continua 2.                                                                                                                                        |
| 4.6 AbortSignal global         | **NÃO ACEITO COMO REGRA GLOBAL**    | Vários timers representam debounce, shutdown, socket timeout ou retry e não são substituíveis mecanicamente.                                                                                                             |
| 5.1 prefetch                   | **INVALIDADO COMO AUSENTE**         | `io-prefetch.js` e `io-session-scope.js` já fazem warmup; falta apenas provar hotset específico do MCP.                                                                                                                  |
| 5.2 alertas de latência        | **INVALIDADO COMO AUSENTE**         | Dashboard já possui budgets configuráveis por fase/tool/error rate e warnings; não foi criada duplicação.                                                                                                               |
| 5.3 Apps SDK/Company Knowledge | **BACKLOG DE PRODUTO**              | Não é correção operacional e `ai-plugin.json` não deve ser presumido requisito MCP atual.                                                                                                                                |
| 5.4 compressão/paginação       | **INVALIDADO PARCIAL**              | Edge desabilita compressão por benchmark anterior; `repo_tree` já limita depth 8 e 2.000 entries.                                                                                                                        |
| 5.5 OTEL                       | **INVALIDADO COMO AUSENTE**         | Export file/OTLP, spans e correlation tracing já existem; instrumentação MCP por fase pode ser ampliada.                                                                                                                 |
| 6.1 write schemas/path safety  | **INVALIDADO E ENDURECIDO**         | Schemas e containment já existiam; testes MCP agora cobrem traversal, manifesto/path forjado, symlink e divergência de hash.                                                                                            |
| 6.2 SSRF DCR/CIMD              | **CONFIRMADO PARCIAL E RESOLVIDO**  | Timeout/redirect/HTTPS/DNS pin existentes foram complementados com classificação IPv4/IPv6 robusta e testes focados.                                                                                                    |
| 6.3 key rotation               | **CONFIRMADO COMO BACKLOG**         | Não há rotação periódica/grace window documentada no módulo.                                                                                                                                                             |
| 6.4 DNS rebinding              | **INVALIDADO E COBERTO**            | Lookup pinado conecta ao endereço público validado; classificação IPv6 e self-SSRF estão cobertas.                                                                                                                      |
| 7.1 hooks tests                | **INVALIDADO**                      | Existem múltiplas suítes dedicadas para factory, registry, bus, presets, elicitation e otimizações.                                                                                                                      |
| 7.2 agent lifecycle tests      | **INVALIDADO E ENDURECIDO**         | Suites já existiam; handoff recebeu TTL/pruning e cobertura com relógio injetável.                                                                                                                                       |
| 7.3 surface contracts          | **RESOLVIDO PARA MODOS ATUAIS**     | `full`, `latency`, `minimal`, `cloudflare`, `readonly`, `claude`, `safe` e `research` possuem contratos.                                                                                                                 |
| 7.4 JSDoc thresholds           | **BACKLOG DE GOVERNANÇA**           | Não foi demonstrado como causa de bug; prioridade inferior a segurança e operação.                                                                                                                                       |

### Novos achados confirmados

| ID       | Severidade | Estado | Achado                                                                                                                                                                                                                                                                                                                         |
| -------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CDEX-001 | 🔴 alto    | [x]    | `dev-oauth.js` classifica IPv6 de forma incompleta: IPv4-mapped privados como `::ffff:169.254.169.254`, parte de `fe80::/10` e multicast IPv6 podem passar como públicos. Corrigido com `BlockList` IPv4/IPv6 e testes focados.                                                                                                |
| CDEX-002 | 🟠 médio   | [x]    | `IO_L2_CACHE_ENABLED=true` não ativa L2; o registry aceita somente o literal `1`, divergindo do padrão booleano do projeto e do roadmap externo. Corrigido para `1/true/yes/on`.                                                                                                                                               |
| CDEX-003 | 🟠 médio   | [x]    | `cloudflare/cli-smoke.js` ainda usa `2025-06-18` por default, então o smoke principal não exercita a versão corrente `2025-11-25`. Default alinhado e coberto.                                                                                                                                                                 |
| CDEX-004 | 🟠 médio   | [x]    | Rate limit anônimo do MCP usava `cf-connecting-ip`/`x-forwarded-for` sem validar confiança da origem. Corrigido com política `loopback/true/false`, validação de IP e opt-in separado para XFF.                                                                                                                                |
| CDEX-005 | 🟡 baixo   | [x]    | O fast-path Claude CIMD presente no worktree não tem teste de integração dedicado nem aparece no status OAuth. Teste exato de authorize/callback e flag diagnóstica adicionados.                                                                                                                                               |
| CDEX-006 | 🟡 baixo   | [x]    | `HandoffManager` mantinha handoffs pendentes indefinidamente. Adicionados `expiresAt`, TTL configurável, pruning determinístico, histórico `expired` e teste com relógio injetável.                                                                                                                                            |
| CDEX-007 | 🟠 médio   | [x]    | `createErrorHandler` e `createCircuitBreakerHandler` mantinham mapas por sessão/contexto sem TTL ou limite, retendo sessões encerradas em processos longevos. Corrigido com poda oportunista, TTL de 30 minutos, LRU de 1.000 contextos e limpeza em abort fatal/irrecuperável.                                                |
| CDEX-008 | 🟡 baixo   | [x]    | `repo-index.js` guardava indefinidamente cada candidato de resolução de import em um `Map`; scans sobre árvores variáveis podiam causar crescimento monotônico. Migrado para o `TtlCache` canônico, com TTL de 5 minutos, LRU de 10.000 entradas e invalidação preservada.                                                     |
| CDEX-009 | 🟠 médio   | [x]    | O job manager mantinha todos os jobs concluídos do processo no `Map` global, embora os manifests persistidos já permitissem reload. Agora retém no máximo 200 registros em memória, remove somente terminais mais antigos e nunca sacrifica jobs ativos.                                                                       |
| CDEX-010 | 🟠 médio   | [x]    | `createTimingEnricherHook` usava apenas `sessionId:toolName`: chamadas concorrentes colidiam, a primeira conclusão apagava a segunda e falhas não limpavam o estado. Agora usa sessão runtime, filas FIFO, cleanup em sucesso/falha, TTL de 30 minutos e teto de 1.000 pendências.                                             |
| CDEX-011 | 🔴 alto    | [x]    | O rate limiter anônimo declarava `maxBuckets`, mas o sweep removia apenas expirados; um flood de identidades únicas dentro da janela ultrapassava o teto indefinidamente. Corrigido com expiração prioritária e evicção determinística do bucket ativo mais antigo.                                                            |
| CDEX-012 | 🔴 alto    | [x]    | `readJobManifest` aceitava `jobId` como path fragment e confiava em `logFile` vindo do JSON persistido, permitindo traversal/confused deputy com manifesto preparado. Corrigido com UUID estrito, paths reconstruídos, arquivos regulares sem symlink e tail real limitado a 1 MiB.                                            |
| CDEX-013 | 🟠 médio   | [x]    | Escritas de chunks/log/status de jobs eram fire-and-forget concorrentes, podendo reordenar output e gerar rejeições não observadas em falha de disco. Agora passam por fila serial por job, preservam ordem, emitem warning observado e liberam a fila ao drenar.                                                              |
| CDEX-014 | 🟠 médio   | [x]    | O histórico de latência executava `append → read-all → rewrite` sem lock sobre o ciclo completo; chamadas MCP concorrentes podiam perder snapshots durante trim. Corrigido com lock canônico reentrante por path e rewrite atômico, coberto por 20 writers concorrentes.                                                       |
| CDEX-015 | 🟠 médio   | [x]    | Manifests de validator jobs eram serializados, mas ainda gravados diretamente no destino; crash/kill durante a escrita podia deixar JSON truncado e ocultar o job persistido. Migrados para o writer atômico canônico, com modo `0600`.                                                                                        |
| CDEX-016 | 🟠 médio   | [x]    | State e smoke JSON do Cloudflare eram escritos diretamente no destino; kill/crash podia deixar arquivos truncados e forçar restart/diagnóstico incorreto. Agora usam writer portátil, atômico, serializado por path, com temp no mesmo diretório e modo `0600`.                                                                |
| CDEX-017 | 🔴 alto    | [x]    | `ensureDetachedProcess` destacava o filho antes de persistir PID/metadata e não fazia rollback se a persistência falhasse, podendo deixar MCP/cloudflared vivo sem supervisão. Agora grava metadata primeiro, PID por último e encerra o grupo/remover arquivos em falha.                                                      |
| CDEX-018 | 🔴 alto    | [x]    | Snapshot IDs aceitavam qualquer string e eram concatenados a `SNAPSHOT_DIR`; além do traversal direto, listagem aceitava payload cujo ID divergia do filename e o reutilizava em load. Corrigido com schema basename-safe, igualdade filename/payload, lookup exato e save atômico `0600`.                                     |
| CDEX-019 | 🟠 médio   | [x]    | Chamadas concorrentes de `patchToolsConfig()` escreviam diretamente e podiam concluir fora de ordem, persistindo configuração anterior à memória atual. Corrigido com snapshot por operação, fila serial e atomic write portátil `0600`.                                                                                       |
| CDEX-020 | 🟠 médio   | [x]    | Model cache disparava writes paralelos e `clearPersistentModelCache()` aguardava apenas o writer mais recente; um writer anterior podia terminar depois do clear e recriar o cache. Write e clear agora compartilham uma fila única e writes são atômicos `0600`.                                                              |
| CDEX-021 | 🔴 alto    | [x]    | Quarantine MCP movia o arquivo antes de gravar diretamente o manifesto; falha/crash podia deixar conteúdo órfão, e restore substituía o destino antes do commit. Agora usa ID/manifesto estritos, journal reconciliável, lock por item, atomic write `0600`, hash e rollback com backup.                                       |
| CDEX-022 | 🔴 alto    | [x]    | Estado Always-Alive era sobrescrito in-place e clears descartavam a fila ativa; clear assíncrono nem incrementava geração, permitindo write em voo recriar estado removido. Agora write/clear compartilham fila, snapshot é atômico `0600`, path configurado cria pai e leitura rejeita symlink.                               |
| CDEX-023 | 🔴 alto    | [x]    | O gate `test:copilot:unit` sofria expansão do glob pelo shell e executava somente suites exatamente um nível abaixo de `tests/unit/copilot`: 220 arquivos ficavam fora. Glob agora é citado e expandido recursivamente, ordenado e deduplicado dentro do runner.                                                               |
| CDEX-024 | 🔴 alto    | [x]    | Após corrigir o gate, o baseline real passou de `3928/3928` sobre 315 arquivos para `6276/6349` sobre 535 arquivos: 45 falhas em 29 suites antes fora do gate. Mocks/contratos obsoletos foram alinhados e o gate real fechou em `6389/6417`, 28 pendências esperadas e zero falhas/warnings.                                  |
| CDEX-025 | 🟠 médio   | [x]    | O registry de custom tools usava um único `custom-tools.json.tmp` e disparava persistências concorrentes sobre estado mutável; operações sobrepostas podiam colidir no temp ou concluir com snapshot antigo. Agora captura snapshot por mutação e usa fila + writer portátil atômico `0600`.                                   |
| CDEX-026 | 🟠 médio   | [x]    | O alias store disparava writes concorrentes fire-and-forget diretamente no destino; além de truncamento em crash, uma gravação antiga podia concluir por último. Agora captura cada snapshot, serializa a fila observada, aguarda writes antes de load e usa atomic write `0600`.                                              |
| CDEX-027 | 🟠 médio   | [x]    | Backups de snapshot Cloudflare eram gravados diretamente no destino final, permitindo JSON truncado em crash/kill. Migrados para o writer portátil atômico, serializado por path e privado (`0600`).                                                                                                                           |
| CDEX-028 | 🔴 alto    | [x]    | Writers JSONL de auditoria/observabilidade liberavam o flag `scheduled` antes do I/O terminar; novos flushes podiam disputar rotação e causar perda, sobrescrita do `.1` ou contabilidade incorreta. Ciclos de JSONL genérico, tool audit, permission audit e event collector agora são serializados e aguardados no shutdown. |
| CDEX-029 | 🟠 médio   | [x]    | Selection trace, policy e provider health do model gateway usavam temps baseados apenas em PID+milissegundo; writes concorrentes podiam colidir e `latest.json` podia regredir. Migrados para atomic write `0600`; selection trace serializa o ciclo trace+latest em ordem lógica.                                             |
| CDEX-030 | 🔴 alto    | [x]    | Chamadas concorrentes de `/byok persist` executavam `read → mutate → write` sem serialização, permitindo lost update de `.env.local`. O ciclo inteiro agora passa por uma fila única e preserva a ordem das mutações.                                                                                                          |
| CDEX-031 | 🟠 médio   | [x]    | Snapshots periódicos de métricas iniciavam um novo append mesmo com o tick anterior ainda em voo, acumulando writes concorrentes sob disco lento. Agora capturam snapshot por tick e usam uma cadeia observada única.                                                                                                          |
| CDEX-032 | 🟠 médio   | [x]    | Streams públicos da assistant sem evento `finalize` ficavam retidos indefinidamente com estado de renderização. Agora são podados por TTL de 10 minutos e teto de 64 streams, sem afetar streams finalizados normalmente.                                                                                                      |
| CDEX-033 | 🟠 médio   | [x]    | O mapa diagnóstico de contadores do `EventBus` aceitava cardinalidade arbitrária de tipos dinâmicos. Agora retém no máximo 1.000 tipos (configurável), descartando o contador mais antigo sem bloquear a entrega do evento.                                                                                                    |
| CDEX-034 | 🔴 alto    | [x]    | O acumulador de transcripts de `task.delta` aceitava tarefas abandonadas sem limite, cada uma com teto individual de 32 MiB. Agora aplica limite de 64 tarefas e orçamento agregado de 64 MiB, com evicção dos abandonados mais antigos e truncamento explícito.                                                                |
| CDEX-035 | 🟠 médio   | [x]    | Histogramas diagnósticos de I/O eram criados para qualquer string de operação sem limite. A cardinalidade agora é limitada a 64 operações, com evicção do histograma mais antigo.                                                                                                                                            |
| CDEX-036 | 🔴 alto    | [x]    | A chave privada PEM do issuer OAuth de desenvolvimento era sobrescrita diretamente; crash/kill durante geração/rotação podia truncar a chave e provocar rotação silenciosa no boot seguinte. Persistência migrada para atomic write privado `0600`.                                                                          |
| CDEX-037 | 🔴 alto    | [x]    | O cache de clientes Cloudflare usava `length:first8:last8` como identidade do API token, expondo fragmentos do segredo e colidindo tokens distintos com mesmas bordas; a colisão podia reutilizar o cliente autenticado errado. Chave migrada para SHA-256 e cache para LRU estrito de quatro clientes.                         |
| CDEX-038 | 🔴 alto    | [x]    | O rate limiter por tool mantinha bearer tokens brutos como chaves de cache e não limitava combinações subject × tool dentro da janela. O cache de tokens foi eliminado, subjects são derivados sem retenção do segredo e budgets possuem teto determinístico de 4.096 entradas com diagnóstico sem subjects.                  |
| CDEX-039 | 🟠 médio   | [x]    | Métricas MCP aceitavam tools e fases dinâmicas sem limite; fases como `__proto__` ainda atravessavam objetos com protótipo. Agora tools são limitadas a 1.000, fases a 64 por tool e snapshots/phase maps usam objetos sem protótipo.                                                                                           |
| CDEX-040 | 🟠 médio   | [x]    | O `ToolCallRegistry` expirava tools ativas, mas deixava índices por `requestId` apontando para entradas expiradas; aliases externos sem lifecycle também não tinham TTL/teto. Expiração agora limpa todos os índices e aliases têm TTL de 2 minutos e limite de 1.024.                                                          |
| CDEX-041 | 🟠 médio   | [x]    | O estado de interações SDK limitava somente entradas concluídas; elicitações, permissões e user inputs abandonados como `pending` podiam crescer indefinidamente. Pendências agora têm TTL de 24 horas e teto de 128 por tipo, preservando as mais recentes.                                                                    |
| CDEX-042 | 🔴 alto    | [x]    | `COPILOT_MCP_AUDIT_SYNC=true` escrevia fora da fila assíncrona já pendente, permitindo que um evento posterior fosse persistido antes dos anteriores. Escritas sync/async agora compartilham uma cadeia serial e há flush explícito reutilizado no `beforeExit`.                                                               |
| CDEX-043 | 🟠 médio   | [x]    | A telemetria geral de tools aceitava cardinalidade e aliases arbitrários, e snapshots por nome podiam interpretar `__proto__` como protótipo. Agora usa LRU de 1.000 tools, até 32 aliases por identidade e define chaves dinâmicas como propriedades próprias enumeráveis.                                                     |
| CDEX-044 | 🟠 médio   | [x]    | O correlation tracer limitava o número de correlation IDs, mas uma única correlação podia acumular eventos indefinidamente. Cada correlação agora retém no máximo 100 eventos recentes, configurável por instância.                                                                                                         |
| CDEX-045 | 🟠 médio   | [x]    | O archive SSE calculava o filename diário apenas na primeira gravação; processos atravessando UTC midnight continuavam escrevendo no arquivo do dia anterior. A resolução agora reavalia o dia e rotaciona automaticamente sem reiniciar o terminal.                                                                        |
| CDEX-046 | 🟠 médio   | [x]    | A projeção diagnóstica de lifecycle de tools mantinha toda entrada sem completion para sempre. Entradas ativas agora expiram após 10 minutos e são limitadas às 128 mais recentes, sem alterar o registry operacional session-scoped.                                                                                         |
| CDEX-047 | 🟠 médio   | [x]    | Um único turn trace podia acumular tools, arquivos, user inputs, escolhas e `dedupeKeys` sem teto até `turn_end`. Agora preserva apenas os eventos recentes sob limites explícitos (128/256/64), limita listas/campos variáveis e clona arrays internos ao produzir snapshots públicos.                                      |
| CDEX-048 | 🟡 baixo   | [x]    | O throttle de alertas recuperáveis guardava mensagens/contextos distintos indefinidamente. Agora o dedupe vale para qualquer callback, remove chaves após 30s e impõe teto de 512 assinaturas, com evicção determinística da mais antiga.                                                                                    |
| CDEX-049 | 🟡 baixo   | [x]    | `cloudflare oauth-smoke` entrava em modo autenticado sem validar `COPILOT_MCP_SMOKE_BEARER_TOKEN`, enviava `tools/list` sem bearer e reportava um falso negativo 401. Agora usa o env injetado e falha antes da rede com diagnóstico explícito, preservando o último smoke válido.                                               |
| CDEX-050 | 🟠 médio   | [x]    | O pool do parser tinha default fixo 2 e `IO_PARSER_WORKER_POOL_SIZE` inválido virava `NaN`, inicializando zero workers silenciosamente. Agora o default deriva de `availableParallelism()` (1–4), override é limitado a 16 e métricas expõem tamanho, origem e paralelismo detectado.                                           |
| CDEX-051 | 🟠 médio   | [x]    | O auditor de `tools/list` serializava objetos Zod internos e superestimava o envelope em 159.861 bytes. Agora conecta `McpServer` e `Client` pelo transporte em memória e mede o descriptor wire real: 113.236 bytes, `inputSchema` 42.008, maior tool 2.770 e folga de 17.836 sob budget regressivo de 128KiB; smoke OAuth também registra bytes remotos. |

### Roadmap booleano revisado e autoritativo

#### P0 — correção e segurança

- [x] R0.1 — Corrigir W114.5/F151 usando os barrels existentes.
- [x] R0.2 — Fechar bypass SSRF IPv6 e adicionar testes focados.
- [x] R0.3 — Cobrir o fast-path Claude CIMD com teste de integração e status operacional.
- [x] R0.4 — Tornar replay DPoP/private_key_jwt persistente e atômico entre processos/restarts.
- [x] R0.5 — Confinar leitura de manifests/logs de jobs a UUIDs e arquivos regulares canônicos.
- [x] R0.6 — Confinar IDs e paths do session snapshot store e rejeitar metadata divergente.
- [x] R0.7 — Tornar persistência da chave privada OAuth atômica e privada.
- [x] R0.8 — Remover fragmentos de segredo e colisões da identidade do cache de clientes Cloudflare.
- [x] R0.9 — Eliminar retenção de bearer tokens brutos e limitar budgets por tool/subject.

#### P1 — operação MCP

- [x] R1.1 — Implementar cleanup bounded de artefatos AI, dry-run por default, retenção e limite por
      chamada.
- [x] R1.2 — Executar cleanup seguro dos 513 candidatos confirmados.
- [x] R1.3 — Agendar `mcp_smoke_workspace` não bloqueante no startup, configurável e cancelável.
- [x] R1.4 — Remover automaticamente state de quick tunnel somente quando comprovadamente stale e
      com PID morto.
- [x] R1.5 — Corrigir parser booleano do L2 e cobrir `1/true/yes/on`.
- [x] R1.6 — Alinhar smoke Cloudflare à versão MCP corrente.
- [x] R1.7 — Serializar e observar I/O assíncrono de cada validator job.
- [x] R1.8 — Tornar persistência de manifests de jobs atômica.
- [x] R1.9 — Serializar o ciclo completo de append/trim do histórico de latência e reescrever
      atomicamente.
- [x] R1.10 — Tornar state/smoke/PID/metadata Cloudflare atômicos e serializados por path.
- [x] R1.11 — Encerrar processo destacado quando a persistência de supervisão falhar.
- [x] R1.12 — Tornar quarantine/restore journalados, serializados e recuperáveis sem órfãos ou perda
      do destino sobrescrito.
- [x] R1.13 — Unificar writes e clears do estado Always-Alive numa fila e persistir snapshots
      atomicamente com permissões privadas.
- [x] R1.14 — Fazer `test:copilot:unit` expandir o glob recursivamente dentro do runner e provar que
      nenhuma profundidade de suite Copilot fica fora do gate.
- [x] R1.15 — Corrigir as 29 suites/45 assertions expostas pelo gate recursivo e estabelecer o
      baseline unitário Copilot completo.
- [x] R1.16 — Serializar e tornar atômicas as persistências do registry de custom tools e do alias
      store, preservando a ordem lógica de snapshots concorrentes.
- [x] R1.17 — Tornar backups locais de snapshot Cloudflare atômicos e privados.
- [x] R1.18 — Serializar ciclos append/rotate dos writers JSONL de auditoria e observabilidade e
      coordenar flushes de shutdown.
- [x] R1.19 — Atomizar e ordenar selection trace/policy/provider health do model gateway.
- [x] R1.20 — Serializar o ciclo read/mutate/write de `.env.local` usado por `/byok persist`.
- [x] R1.21 — Preservar ordem entre audit events MCP sync/async e expor flush coordenado.
- [x] R1.22 — Rotacionar diariamente o archive SSE também em processos que atravessam UTC midnight.
- [x] R1.23 — Pré-aquecer o JWKS remoto de forma deduplicada e não bloqueante, com estado em health,
      métricas do cache e configuração de enable/delay.

Execução de `R1.2` em 2026-06-11:

- dry-run: `513` candidatos UUID estritos, `500` selecionados no primeiro lote;
- apply 1: `500` removidos, `13` restantes;
- apply 2: `13` removidos, `0` candidatos restantes;
- retenção final: `240` artefatos recentes; nomes não UUID e todo estado OAuth/tunnel/PID/quarantine
  ficaram fora do domínio de deleção.

#### P2 — governança e observabilidade

- [x] R2.1 — Endurecer identidade do rate limit anônimo com política explícita de proxy confiável.
- [x] R2.2 — Adicionar warning configurável de aproximação do limite de tools.
- [x] R2.3 — Confirmado existente: thresholds configuráveis por ambiente para `authorization`,
      `handler`, `resultSize`, tool average e error rate no `mcp_latency_dashboard`; nenhuma
      duplicação criada.
- [x] R2.4 — Adicionar contratos para todos os surface modes atuais antes de inventar novos nomes.
- [x] R2.5 — Adicionar TTL/pruning ao `HandoffManager`.
- [x] R2.6 — Limitar estado de retry/circuit breaker dos hooks por TTL e LRU.
- [x] R2.7 — Limitar cache de resolução de imports do índice por TTL e LRU.
- [x] R2.8 — Limitar retenção em memória dos jobs concluídos sem afetar jobs ativos ou histórico
      persistido.
- [x] R2.9 — Tornar timing de hooks tolerante a concorrência e falhas dentro do contrato atual do
      SDK.
- [x] R2.10 — Fazer `maxBuckets` do rate limiter anônimo ser um limite real sob cardinalidade
      hostil.
- [x] R2.11 — Serializar e atomizar persistência de `tools-config`.
- [x] R2.12 — Serializar writes/clear do model cache e impedir ressurreição pós-clear.
- [x] R2.13 — Limitar cardinalidade de streams públicos abandonados e contadores diagnósticos do
      EventBus.
- [x] R2.14 — Serializar snapshots periódicos de métricas sob I/O lento.
- [x] R2.15 — Limitar acumuladores de task transcript e histogramas diagnósticos de I/O.
- [x] R2.16 — Limitar cardinalidade de métricas MCP e usar mapas seguros para chaves especiais.
- [x] R2.17 — Limpar índices expirados do lifecycle de tool calls e limitar aliases por request ID.
- [x] R2.18 — Limitar pendências abandonadas de elicitation, permission e user input SDK.
- [x] R2.19 — Limitar tools/aliases da telemetria geral e proteger snapshots contra chaves especiais.
- [x] R2.20 — Limitar eventos por correlation ID no tracer.
- [x] R2.21 — Expirar e limitar a projeção diagnóstica de lifecycle de tools.
- [x] R2.22 — Limitar cardinalidade, listas internas e tamanho dos campos de um único turn trace.
- [x] R2.23 — Aplicar TTL de 30s e teto de 512 chaves ao dedupe de alertas recuperáveis.
- [x] R2.24 — Fazer o smoke Cloudflare autenticado rejeitar credencial ausente antes de tocar rede.
- [x] R2.25 — Substituir a medição Zod incorreta pelo envelope wire real, impor budget regressivo
      de 128KiB e preservar integralmente validação/contratos dos schemas batch.

Transformações consolidadas nesta rodada:

- replay DPoP e `private_key_jwt` persistente, atômico, namespaced e hash-only em SQLite;
- smoke read-only de workspace agendado uma vez por processo após startup HTTP, com estado no
  `/health`;
- cleanup automático e conservador de quick-tunnel state apenas quando válido, stale e com PID
  morto;
- warning de saturação do registry e testes de `full`, `latency`, `minimal`, `cloudflare`,
  `readonly`, `claude`, `safe` e `research`;
- correção do teste legado de `HandoffManager`, cujo subpath não era exportado e fazia a suíte
  dedicada pular todos os casos;
- estado de recuperação dos hooks e cache de resolução de imports agora possuem TTL e limite LRU
  explícitos;
- jobs terminais possuem retenção bounded em memória, mantendo o histórico persistido;
- timing de hooks preserva chamadas concorrentes, limpa falhas e limita pendências abandonadas.

Validação focada adicional de `R2.6`/`R2.7`: hooks `113/113`, tools MCP `41/41` e
`typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R2.8`/`R2.9`: hooks + jobs MCP `123/123` e
`typecheck:strict:src.copilot` em PASS. Como o SDK não fornece call ID aos hooks pre/post,
correlação exata de conclusões fora de ordem permanece limitação contratual.

Validação focada adicional de `R2.10`: proxy/rate limit MCP `5/5` e `typecheck:strict:src.copilot`
em PASS.

Validação focada adicional de `R0.5`: jobs MCP `10/10`, incluindo traversal, path forjado e symlink,
e `typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R1.7`: jobs MCP `10/10` e `typecheck:strict:src.copilot` em PASS.

Gate espaçado após a segunda varredura: `npm run lint:copilot` em PASS.

Validação focada adicional de `R1.8`/`R1.9`: jobs + histórico MCP `11/11` e
`typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R1.10`/`R1.11`: state + supervisão Cloudflare `9/9` e
`typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R0.6`: session snapshot `12/12`, incluindo traversal e metadata
divergente, e `typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R2.11`/`R2.12`: tools state + model cache `17/17` e
`typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R1.12`: repo write MCP `20/20`, incluindo falhas injetadas nos
commits, restore concorrente, recuperação de journal, manifesto/path forjado, divergência de hash e
symlink de dados, e `typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R1.13`: state I/O `13/13`, incluindo write pausado seguido de clear,
modo `0600`, diretório configurado e symlink, e `typecheck:strict:src.copilot` em PASS.

Primeiro gate recursivo real após `R1.14`: `535` arquivos selecionados, `6276/6349` testes,
`1890/1919` suites, `45` falhas e `28` pendências. O gate anterior selecionava somente `315`
arquivos exatamente um nível abaixo de `tests/unit/copilot`; resumo real em
`artifacts/test-runs/copilot/2026-06-12T01-21-06-415Z/summary.md`.

Gate recursivo real após `R1.15`: `535` arquivos selecionados, `6389/6417` testes, `1946/1946`
suites, zero falhas, `28` pendências esperadas e zero warnings/errors; resumo em
`artifacts/test-runs/copilot/2026-06-12T02-20-30-203Z/summary.md`.

Validação focada adicional de `R1.16`/`R1.17`: custom tools + alias store + edge backup `51/51`,
incluindo ordem de snapshots concorrentes e modo privado do backup.

Validação focada adicional de `R1.18`: writers JSONL/audit/event collector `41/41`.

Validação focada adicional de `R1.19`/`R1.20`/`R2.14`: model gateway `226/226`, BYOK `119/119`,
event bus/public stream/metrics `68/68` e `typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R2.15`: task transcript + histogramas I/O e família relacionada
`71/71`.

Validação focada adicional de `R0.7`/`R0.8`: OAuth/SSRF `27/27`, Cloudflare remote e recorte
relacionado `34/34`, e `typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R0.9`/`R1.21`/`R2.16`/`R2.17`/`R2.18`: registry, métricas, audit
MCP, lifecycle de tool calls e interações SDK `58/58`.

Validação focada adicional de `R1.22`/`R2.19`/`R2.20`/`R2.21`: telemetria geral, correlation
tracer, archive SSE diário, lifecycle diagnóstico e recorte MCP relacionado `80/80`, com
`typecheck:strict:src.copilot` em PASS.

Validação focada adicional de `R2.22`/`R2.23`: turn trace e error alerter `25/25`, sem
warnings/errors, com `typecheck:strict:src.copilot` em PASS. Resumo:
`artifacts/test-runs/copilot/2026-06-12T03-06-43-387Z/summary.md`.

Validação focada adicional de `R2.24`: Cloudflare CLI probe `3/3`, ESLint focado e
`typecheck:strict:src.copilot` em PASS. O comando real sem token agora falha antes da rede com
diagnóstico explícito. Resumo:
`artifacts/test-runs/copilot/2026-06-12T03-09-40-428Z/summary.md`.

Validação focada adicional de `R1.23`: warmup JWKS, auth hardening, startup maintenance e HTTP smoke
`18/18`, zero warnings/errors, com `typecheck:strict:src.copilot` e ESLint focado em PASS. Resumo:
`artifacts/test-runs/copilot/2026-06-12T03-14-21-813Z/summary.md`.
O contrato de layout mais o warmup fecharam adicionalmente em `59/59`:
`artifacts/test-runs/copilot/2026-06-12T03-16-02-677Z/summary.md`.
Após publicar `0c604a7d` e reiniciar o runtime, `/health.authJwksWarmup` confirmou `success=true`,
`source=remote`, `keyCount=2`, `durationMs=614`; o OAuth smoke completo passou com `100/100` tools e
a primeira chamada autenticada registrou `authorization.lastDurationMs=2`.

Validação focada adicional de `CDEX-050`: parser + governança do barrel infra `27/27`, zero
warnings/errors, com `typecheck:strict:src.copilot` e ESLint focado em PASS. No runtime atual,
`availableParallelism=5`, `workerPoolSize=4` e `workerPoolSizeSource=adaptive`. Resumo:
`artifacts/test-runs/copilot/2026-06-12T03-19-20-469Z/summary.md`.

Validação focada adicional de `CDEX-051`: o novo auditor executa `tools/list` pelo SDK real em
memória, mede `113.236/131.072` bytes e `17.836` bytes de headroom; os dois testes regressivos,
ESLint focado e `typecheck:strict:src.copilot` passaram. A medição anterior de `159.861` bytes era
41% maior por incluir estado interno do Zod, e os quatro descriptors batch reais somam ~10,1KB em
vez de ~28,9KB. O smoke OAuth agora inclui `authenticatedTools.responseBytes` para confirmação
live após restart. Publicado em `7d783bf2`; o runtime reiniciado nos PIDs `71127`/`71133`
confirmou health 200, warmup JWKS remoto de 2 chaves em 275ms, quatro conexões QUIC e OAuth smoke
completo em PASS. O `tools/list` remoto mediu exatamente os mesmos `113.236` bytes e `100/100`
tools, eliminando diferença entre a medição local e a resposta Cloudflare.

Validação canônica pós-transformações em 2026-06-11:

| Gate                                   | Resultado final                                                        |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `npm run typecheck:strict:src.copilot` | ✅ PASS                                                                |
| `npm run lint:copilot`                 | ✅ PASS                                                                |
| `npm run test:copilot:unit`            | ✅ PASS — `6389/6417` testes, `1946/1946` suites, 28 pendências esperadas e zero warnings/errors |

O baseline inicial raso de `3880/3882` foi integralmente corrigido e o gate passou a descobrir
recursivamente todas as suites Copilot. A suíte final também cobre os novos
contratos de replay persistente, SSRF IPv6, proxy trust, startup maintenance, cleanup bounded,
surfaces do registry, expiração de handoff, bounds de hooks/jobs/cache, rate-limit cardinality e
confinamento de artefatos de jobs. Último resumo canônico recursivo:
`artifacts/test-runs/copilot/2026-06-12T02-20-30-203Z/summary.md`.

#### P3 — experimentos e backlog

- [ ] R3.1 — Benchmark controlado QUIC vs auto vs HTTP/2; não trocar default sem evidência.
- [ ] R3.2 — Avaliar ativação do L2 por perfil após medir hit ratio e custo no `copilot.sqlite`.
- [ ] R3.3 — Planejar rotação de chaves OAuth com grace period e runbook.
- [ ] R3.4 — Reavaliar SDK v2 apenas quando houver release estável.

#### Publicação

- [x] Seis commits temáticos publicados diretamente em `main`.
- [x] `main` local e `origin/main` confirmados no mesmo SHA de remediação `45f74116`.
- [x] Worktree confirmado limpo imediatamente após o push.
- [x] Lote CDEX-047/CDEX-049 e reconciliação integral publicados em `main`.
- [x] Restart/smoke live no novo HEAD: PIDs `60149`/`60155`, health 200, quatro conexões HA,
      `startupMaintenance.success=true`, stale quick-tunnel removido e OAuth smoke completo em PASS.

#### Fora do escopo desta execução

- [x] N/A — Limpeza/renomeação de arquivos na raiz, `.codex`, `.vscode` e diretórios globais de
      documentação.
- [x] N/A — Reescrita de histórico Git e remoção de bundles.
- [x] N/A — Aplicação de regras na conta Cloudflare ou mudanças em workflows externos a
      `src/copilot`.

---

### FASE 1 — Triage Imediata (bugs e quick wins)

**Objetivo:** Fazer todos os testes passarem e resolver estado `degraded` do runtime.

#### 1.1 Corrigir terminal barrel governance (W114.5 + F151) 🔴

- [x] 1.1.1 — `commands/activity.js`: substituir imports diretos de
      `../events/turn-trace-presentation.js` e `../frontend/projections/now.js` pelos equivalentes
      via barrels `../events/index.js` e `../frontend/index.js`
- [x] 1.1.2 — `commands/byok.js`: substituir imports diretos de
      `../frontend/gateways/agent-runtime.js` e `../frontend/projections/config.js` por
      `../frontend/index.js`
- [x] 1.1.3 — `commands/config.js`: migrar para `from '../frontend/index.js'` (F151) — garantir que
      `readTerminalConfigProjection`, `listTerminalAvailableModelsProjection`,
      `readTerminalModelStatsProjection`, `setTerminalModelProjection`,
      `setTerminalReasoningProjection`, `readTerminalRuntimeState` todos exportados pelo barrel
- [x] 1.1.4 — `commands/context.js`: substituir import direto de
      `../frontend/projections/timeline.js` por `../frontend/index.js`
- [x] 1.1.5 — Verificar demais arquivos em `commands/` (byok, outros) para imports restantes fora de
      barrels
- [x] 1.1.6 — Garantir que `src/copilot/terminal/frontend/index.js` re-exporte todos os itens
      necessários
- [x] 1.1.7 — Garantir que `src/copilot/terminal/events/index.js` re-exporte
      `turn-trace-presentation`
- [x] 1.1.8 — Executar `unit-copilot` e confirmar 0 falhas

#### 1.2 Limpar workspace sujo 🟠 — N/A fora de `src/copilot`; publicação concluída

- [x] 1.2.1 — N/A: `.codex/config.toml` pertence à configuração global fora do escopo desta
      auditoria
- [x] 1.2.2 — N/A: organização de conversa/relatório na raiz não altera o produto `src/copilot`
- [x] 1.2.3 — N/A: movimentação documental sem impacto funcional foi deliberadamente evitada
- [x] 1.2.4 — Executar `repo_status` pós-cleanup e confirmar workspace limpo (`45f74116`)

#### 1.3 Remover artefatos AI além da retenção 🟠

- [x] 1.3.1 — Substituído dentro do escopo por `control-plane/ai-artifacts.js` e tool MCP bounded;
      script global fora de `src/copilot` não foi necessário
- [x] 1.3.2 — Executar cleanup para os 513 artefatos candidatos (UUID .json/.log) preservando OAuth
      stores, tunnel token, pid files
- [x] 1.3.3 — Verificar que `src/copilot/.ai/jobs/` contém ≤ 240 artefatos (retenção configurada)
- [x] 1.3.4 — N/A: operação documentada/exposta pela tool `mcp_cleanup_ai_artifacts`, sem criar
      script global fora do escopo

#### 1.4 Limpar state file do túnel temporário stale 🟡

- [x] 1.4.1 — Identificar o arquivo de state do quick-tunnel
      (`src/copilot/.ai/cloudflare/quick-tunnel.json`)
- [x] 1.4.2 — Verificar se processo com PID registrado está vivo
- [x] 1.4.3 — Se morto, remover ou zerar o state file para evitar falsos `stale: true` perpétuos
- [x] 1.4.4 — Adicionar lógica de auto-cleanup de state stale no boot do MCP (`bootstrap.js` ou
      `runtime-bootstrap.js`)

#### 1.5 Corrigir nomes problemáticos na raiz 🟡 — N/A fora de `src/copilot`

- [x] 1.5.1 — N/A: renomeação de guia na raiz
- [x] 1.5.2 — N/A: renomeação de relatório na raiz
- [x] 1.5.3 — N/A: deduplicação documental global
- [x] 1.5.4 — N/A: limpeza de diretório da raiz
- [x] 1.5.5 — N/A: limpeza de configuração histórica do VS Code

#### 1.6 Consolidar relatórios de auditoria na raiz 🟡 — N/A fora de `src/copilot`

- [x] 1.6.1 — N/A: movimentação de relatório global
- [x] 1.6.2 — N/A: movimentação de relatório global
- [x] 1.6.3 — N/A: movimentação de relatório global
- [x] 1.6.4 — N/A: movimentação de relatório global
- [x] 1.6.5 — N/A: movimentação de relatório global
- [x] 1.6.6 — N/A: movimentação de relatório global
- [x] 1.6.7 — N/A: este arquivo permanece na localização solicitada pelo operador
- [x] 1.6.8 — N/A: índice documental global fora do escopo

---

### FASE 2 — Estabilização Operacional

**Objetivo:** Eliminar o status `degraded` de forma permanente e reduzir latência de sessão fria.

#### 2.1 Auto-trigger de smoke_workspace no startup 🟠

- [x] 2.1.1 — Identificar o ponto de boot do MCP server (`mcp/server.js` ou adaptador HTTP)
- [x] 2.1.2 — Adicionar trigger assíncrono de `mcp_smoke_workspace` após 15s por default (não
      bloqueante)
- [x] 2.1.3 — Registrar resultado no estado em memória para eliminar o warning de `degraded`
- [x] 2.1.4 — Adicionar envs `COPILOT_MCP_STARTUP_SMOKE_ENABLED` e
      `COPILOT_MCP_STARTUP_SMOKE_DELAY_MS` (0 = imediato)
- [x] 2.1.5 — Documentar comportamento em `src/copilot/mcp/README.md`

#### 2.2 Pre-aquecimento de autorização (JWKS warmup) 🟠

- [x] 2.2.1 — Startup HTTP agenda `jose.remoteJWKSet.reload()` sem token e sem bloquear o listener,
      pré-populando o resolver em `REMOTE_JWKS_CACHE`
- [x] 2.2.2 — Premissa corrigida: `authorizationConfigCache` mede parsing de configuração; o estado
      real está em `/health.authJwksWarmup` e o cache `oauth-remote-jwks` nas métricas TTL
- [x] 2.2.3 — Log DEBUG registra source, keyCount e durationMs do warmup
- [x] 2.2.4 — Scheduler fire-and-forget captura falhas, registra WARN/estado e não rejeita startup
- [x] 2.2.5 — Restart live: warmup remoto carregou 2 chaves em 614ms fora do caminho crítico; a
      primeira tool OAuth autenticada registrou fase `authorization=2ms` (< 30ms)

#### 2.3 Ativar L2 cache SQLite 🟠

- [x] 2.3.1 — Revisar `io-cache-l2-sqlite.js`: verificar que schema, circuit breaker e TTL estão
      corretos
- [x] 2.3.2 — N/A: ativação global em `.devcontainer/devcontainer.json` fica fora do escopo;
      habilitação permanece opt-in por ambiente
- [x] 2.3.3 — N/A: caminho operacional deve ser escolhido pelo ambiente que habilitar o L2
- [x] 2.3.4 — N/A: alteração de `.gitignore` global não é necessária enquanto o L2 seguir opt-in
- [ ] 2.3.5 — Monitorar `ioCache.l2.hits` no `mcp_latency_dashboard` para validar impacto
- [ ] 2.3.6 — Estabelecer threshold de hit ratio mínimo de 40% em sessões quentes

#### 2.4 Investigar e reduzir latência QUIC p99 🟠

- [ ] 2.4.1 — Executar `mcp_cloudflare_transport_benchmark_plan` para comparar QUIC vs http2 vs auto
- [ ] 2.4.2 — Analisar se p99=1314ms é de overhead de Cloudflare ou de handler interno
- [ ] 2.4.3 — Verificar `KeepAlive` e `NoDelay` nas configurações do adaptador HTTP
- [ ] 2.4.4 — Verificar se `connectionsCheckingIntervalMs=30000` e `keepAliveInitialDelayMs=30000`
      são adequados para o padrão de tráfego
- [ ] 2.4.5 — Documentar decisão de transporte em `src/copilot/docs/`
- [ ] 2.4.6 — Adicionar alerta no `mcp_latency_dashboard` quando p99 > 800ms

#### 2.5 Implementar rate-limit anônimo na edge Cloudflare 🟡 — N/A operacional externo

- [x] 2.5.1 — N/A: política externa; o rate limit no origin já foi endurecido em `src/copilot`
- [x] 2.5.2 — N/A: criação de regra na conta Cloudflare exige decisão operacional externa
- [x] 2.5.3 — N/A: limite na edge não pode ser aplicado apenas por alteração em `src/copilot`
- [x] 2.5.4 — N/A: atualização do plano externo não é transformação do produto
- [x] 2.5.5 — N/A: aplicação em conta Cloudflare está fora do escopo autorizado
- [x] 2.5.6 — N/A: verificação depende da regra externa não aplicada

#### 2.6 Ferramenta bounded de cleanup de artefatos AI 🟡

- [x] 2.6.1 — Criar `mcp_cleanup_ai_artifacts` tool (allowlisted, bounded, dryRun por padrão)
- [x] 2.6.2 — Parâmetros: `dryRun: boolean`, `retainNewest: number` (default 240),
      `maxDeleteCount: number` (default 100 por chamada)
- [x] 2.6.3 — Proteger: `oauth-*.json`, `*.token`, `connector-smoke.json`, `quick-tunnel.json`,
      `*.pid`
- [x] 2.6.4 — Adicionar ao registry com scope `repo:admin` e `destructiveHint: true`
- [x] 2.6.5 — Adicionar testes unitários em `tests/unit/copilot/mcp/`
- [x] 2.6.6 — N/A: a tool entrou no allowlist de metadata/maintenance; não é uma suite de
      validação executável

---

### FASE 3 — Governança Arquitetural

**Objetivo:** Resolver dívida técnica de barrels, docs, OAuth e superfície MCP.

#### 3.1 Replay cache persistente OAuth 🔴

- [x] 3.1.1 — Analisar impacto de restart na janela de replay para DPoP e `private_key_jwt`
- [x] 3.1.2 — Criar módulo `control-plane/oauth-replay-store.js` com backend SQLite
      banco dedicado)
- [x] 3.1.3 — Migrar replay DPoP para store persistido com TTL automático
- [x] 3.1.4 — Migrar `private_key_jwt` idem
- [x] 3.1.5 — Ao inicializar/operação: purgar entradas expiradas do banco
- [x] 3.1.6 — Isolar a API persistente e serializar operações críticas
- [x] 3.1.7 — Adicionar testes de rejeição de replay após restart simulado

#### 3.2 Política de expiração/rotação OAuth clients e refresh tokens 🟠

- [x] 3.2.1 — Confirmado existente: `pruneRegisteredClients()` remove clientes expirados
      `client_secret_expires_at < now`
- [x] 3.2.2 — Confirmado existente: stores removem tokens/famílias expirados e revogam família em
      reuse
      tokens expirados
- [x] 3.2.3 — Premissa ajustada: pruning ocorre no load e oportunisticamente nas operações, sem
      timer global adicional
- [x] 3.2.4 — N/A: load/pruning é comportamento canônico, sem opt-out inseguro
- [x] 3.2.5 — Estado de persistência/pruning é exposto no profile OAuth

#### 3.3 Profiles de superfície MCP por audiência 🟠

- [x] 3.3.1 — Premissa invalidada: já existem oito modos canônicos; não criar aliases sem caso de
      uso comprovado
- [x] 3.3.2 — Perfil `readonly`: apenas tools com `readOnlyHint: true` (repo_read, repo_status,
      repo_tree, etc.)
- [x] 3.3.3 — Equivalentes atuais: `full`/`safe`/`research`; alias `dev` rejeitado sem necessidade
- [x] 3.3.4 — Modo `cloudflare` cobre edge/config/tunnel
- [x] 3.3.5 — Modos `minimal`/`safe` cobrem superfícies reduzidas; alias `ci` permanece dispensável
- [x] 3.3.6 — Configuração canônica via `COPILOT_MCP_TOOL_SURFACE`
- [x] 3.3.7 — Expor perfil ativo em `mcp_tools_status` e `mcp_session_profile`
- [x] 3.3.8 — Adicionar contratos dos oito modos em `test_mcp_registry.spec.js`

#### 3.4 Consolidar diretórios de documentação 🟡 — N/A fora de `src/copilot`

- [x] 3.4.1 — N/A: inventário documental global
- [x] 3.4.2 — N/A: movimentação documental global
- [x] 3.4.3 — N/A: remoção de diretório documental global
- [x] 3.4.4 — N/A: reescrita de referências globais
- [x] 3.4.5 — N/A: nenhuma alteração funcional em `src/copilot` depende dessa consolidação

#### 3.5 Remover git bundles do histórico rastreado 🟡 — N/A fora de `src/copilot`

- [x] 3.5.1 — N/A: política de ignore global
- [x] 3.5.2 — N/A: reescrita destrutiva do histórico é incompatível com o escopo
- [x] 3.5.3 — N/A: política de armazenamento global

#### 3.6 Verificar MCP Protocol Version 🟠

- [x] 3.6.1 — Revisar spec `2025-06-18` vs `2025-11-25`; `2025-11-25` é posterior/corrente
      breaking
- [x] 3.6.2 — Checar `@modelcontextprotocol/sdk` v1.29.x e estado ainda não estável do v2
      branch v1.x
- [x] 3.6.3 — Manter `COPILOT_MCP_PROTOCOL_VERSION=2025-11-25`
- [x] 3.6.4 — Documentar decisão de versão em `src/copilot/mcp/README.md`

---

### FASE 4 — Modernização Node 24+ & SDK

**Objetivo:** Aproveitar APIs modernas do Node 24+ e manter alinhamento com SDKs externos.

#### 4.1 `node:sqlite` built-in para L2 cache 🟢

- [x] 4.1.1 — Avaliado: `node:sqlite` ainda é release candidate no Node usado; não substituir
      `better-sqlite3` agora
      no L2
- [x] 4.1.2 — Comparar API: `DatabaseSync` não oferece ganho que justifique migração imediata
      uso assíncrono
- [x] 4.1.3 — Decisão: não criar backend alternativo enquanto a API permanecer experimental
      `io-cache-l2-sqlite.js`
- [x] 4.1.4 — N/A nesta decisão: manter backend atual e reavaliar após estabilização
      bloquear)
- [x] 4.1.5 — `better-sqlite3` permanece backend canônico

#### 4.2 `await using` para cleanup de recursos 🟢

- [x] 4.2.1 — Migração global rejeitada: recursos têm semânticas distintas e teardown já
      centralizado
      `io-session-scope.js`, session lifecycle
- [x] 4.2.2 — N/A sem recurso concreto com ganho comprovado
- [x] 4.2.3 — N/A; preservar `try/finally` explícito
- [x] 4.2.4 — N/A; não ampliar target/lib sem necessidade de produto

#### 4.3 Worker pool dinâmico no io-parser 🟡

- [x] 4.3.1 — Confirmado existente: `IO_PARSER_WORKER_POOL_SIZE`
- [x] 4.3.2 — Default adaptativo usa `availableParallelism()` e `min(4, parallelism - 1)`, com
      mínimo 1; override explícito permanece disponível e limitado a 16
- [x] 4.3.3 — Métricas expõem `workerPoolSize`, `workerPoolSizeSource` e `availableParallelism`

#### 4.6 AbortSignal.timeout() em todos os ops async críticos 🟡

- [x] 4.6.1 — Auditado: timers incluem debounce, shutdown, socket timeout, retry e deadline
      semânticos
- [x] 4.6.2 — Regra global rejeitada; substituir apenas quando `AbortSignal` fizer parte do contrato
- [x] 4.6.3 — Fetches críticos já possuem timeout/budget; não aplicar mecanicamente a filesystem

---

### FASE 5 — Performance & Observabilidade

**Objetivo:** Reduzir latência end-to-end e melhorar visibilidade do sistema.

#### 5.1 Estratégia de cache pre-warm na sessão 🟡

- [ ] 5.1.1 — Identificar os 20 arquivos mais lidos (barrels, package.json, tsconfig, arquivos de
      config)
- [x] 5.1.2 — Confirmado existente: `io-prefetch.js` já pré-carrega arquivos no L1
      L1
- [ ] 5.1.3 — Adicionar lista de prefetch em `src/copilot/infra/io-prefetch.js` via env ou config
- [ ] 5.1.4 — Disparar prefetch assíncrono no startup do MCP (após index build)
- [ ] 5.1.5 — Medir impacto: L1 hit ratio deve subir de ~18% para > 50% nas primeiras chamadas

#### 5.2 Alertas de threshold de latência por fase 🟡

- [x] 5.2.1 — Confirmados budgets de autorização, handler, result size, média por tool e error rate
- [x] 5.2.2 — Dashboard produz warnings estruturados quando budgets são excedidos
- [x] 5.2.3 — Warnings/fases são expostos no `mcp_latency_dashboard`
- [x] 5.2.4 — Configuração existente via `COPILOT_MCP_LATENCY_*_WARN_MS`

#### 5.3 Apps SDK widget / Company Knowledge 🟢

- [ ] 5.3.1 — Revisar `mcp_apps_sdk_readiness` tool — identificar o que falta para widget e CK
- [ ] 5.3.2 — Implementar endpoint `/.well-known/ai-plugin.json` (Apps SDK spec)
- [ ] 5.3.3 — Implementar Company Knowledge search se dados de workspace relevantes existirem
- [ ] 5.3.4 — Testar integração com ChatGPT connector usando Apps SDK authenticated flow

#### 5.4 Compressão de payloads grandes em tools 🟡

- [ ] 5.4.1 — Identificar tools que retornam > 50KB frequentemente (`repo_root_tree`,
      `repo_search_text`)
- [x] 5.4.2 — Não implementar compressão duplicada na tool; decisão depende do transporte/edge
- [x] 5.4.3 — Benchmark anterior desabilitou compressão no edge; preservar decisão até nova medição
- [x] 5.4.4 — `repo_tree` já aplica limites de profundidade e 2.000 entradas

#### 5.5 Telemetria OTEL exportável 🟢

- [x] 5.5.1 — Verificado: exporter file/OTLP já existe
- [x] 5.5.2 — Export OTLP já é configurável por env
      `OTEL_EXPORTER_OTLP_ENDPOINT`
- [ ] 5.5.3 — Instrumentar spans para fases de autorização, handler, resultSize no MCP registry
- [x] 5.5.4 — Correlation tracing já existe e agora é bounded por correlação

#### 5.6 Benchmark automatizado QUIC vs HTTP/2 🟡

- [ ] 5.6.1 — Usar `mcp_cloudflare_transport_benchmark_plan` para planejar benchmark controlado
- [ ] 5.6.2 — Executar 100 requests com `quic` e 100 com `auto` em período de baixo tráfego
- [ ] 5.6.3 — Comparar p50, p95, p99 nos dois modos
- [ ] 5.6.4 — Documentar resultado em `src/copilot/docs/cloudflare/TRANSPORT-BENCHMARK-RESULT.md`
- [ ] 5.6.5 — Definir transport canônico baseado nos resultados

---

### FASE 6 — Hardening de Segurança Avançado

**Objetivo:** Fechar gaps de segurança não cobertos pelas fases anteriores.

#### 6.1 Auditoria de input schemas dos tools de escrita 🟠

- [x] 6.1.1 — Auditar `repo_write_file`, `repo_create_file`, `repo_apply_patch`,
      `repo_apply_file_batch`: verificar validação de paths (null byte, path traversal, symlinks)
- [x] 6.1.2 — Verificado confinement canônico por realpath/path policy antes de I/O; não exigir uma
      função nominal única
- [x] 6.1.3 — Schemas fortes já existiam e foram preservados
- [x] 6.1.4 — Testar traversal, path/manifesto forjado e symlinks; todos rejeitados

#### 6.2 Hardening do dev-oauth contra SSRF em DCR 🟠

- [x] 6.2.1 — Verificar que `CLIENT_METADATA_TIMEOUT_MS = 5000` e
      `CLIENT_METADATA_MAX_REDIRECTS = 3` são enforced
- [x] 6.2.2 — Verificar validação HTTPS/host e lookup pinado para metadata
- [x] 6.2.3 — Garantir que requests de `client_metadata` não alcançam IPs privados (169.254.x.x,
      10.x, 172.16-31.x, 192.168.x)
- [x] 6.2.4 — Testar self-SSRF/loopback e confirmar bloqueio
- [x] 6.2.5 — Adicionar teste `test_dev_oauth_ssrf_protection.spec.js`

#### 6.3 Política de expiração de chaves OAuth 🟠

- [ ] 6.3.1 — Documentar TTL de `oauth-dev-es256-private-key.pem` e `oauth-dev-private-key.pem`
- [ ] 6.3.2 — Implementar rotação periódica (ex: anual) com grace period para tokens já emitidos
- [ ] 6.3.3 — Adicionar `mcp_oauth_key_rotation_plan` tool (read-only, plan-only)
- [ ] 6.3.4 — Documentar procedimento de rotação em `src/copilot/docs/MCP-OAUTH-KEY-ROTATION.md`

#### 6.4 DNS rebinding protection no dev-oauth 🟡

- [x] 6.4.1 — Verificar que `lookupDns` é usado e o fetch conecta ao endereço validado
      `redirect_uri`
- [x] 6.4.2 — Confirmar bloqueio de resolução privada IPv4/IPv6
- [x] 6.4.3 — Cobertura integrada à suíte SSRF; arquivo separado não é necessário

---

### FASE 7 — Qualidade de Código & Contratos

**Objetivo:** Aumentar cobertura de testes e contratos de qualidade.

#### 7.1 Cobertura de testes para hooks system 🟡

- [x] 7.1.1 — Suites dedicadas de hooks já existem; não duplicar por nome de arquivo
- [x] 7.1.2 — Factory, composer, registry, error-handler e presets cobertos
- [x] 7.1.3 — Tool filter/permission paths cobertos
- [ ] 7.1.4 — Meta: cobertura > 80% no módulo `src/copilot/hooks/`

#### 7.2 Testes de integração para ciclo de vida do agent 🟡

- [x] 7.2.1 — Suites de lifecycle já existentes foram incluídas pelo gate recursivo
- [x] 7.2.2 — Always-Alive/state clear concorrente coberto
- [x] 7.2.3 — `handoff-manager.js` coberto com relógio/TTL
- [x] 7.2.4 — Session lifecycle possui suites de boot, reconnect e teardown

#### 7.3 Contract tests para tool surface 🟡

- [x] 7.3.1 — Contratos adicionados ao `test_mcp_registry.spec.js`, sem arquivo redundante
- [x] 7.3.2 — `readonly` não contém tools destrutivas
- [x] 7.3.3 — Alias `ci` invalidado; `minimal`/`safe` têm contratos explícitos
- [x] 7.3.4 — Todos os tools registrados têm annotations explícitas

#### 7.4 JSDoc coverage mínima 🟡

- [ ] 7.4.1 — Executar `audit-jsdoc-coverage.mjs` e medir baseline
- [ ] 7.4.2 — Definir threshold mínimo: 80% para `src/copilot/mcp/`, 70% para `src/copilot/infra/`
- [ ] 7.4.3 — Adicionar verificação de JSDoc ao `suite-mcp-full`
- [ ] 7.4.4 — Priorizar cobertura JSDoc nos barrels (index.js) de cada módulo

---

## 5-B. Reinvestigação GPT-5.5 — 2026-06-12 — `src/copilot`, Node 24.5+

**Escopo desta rodada:** reabrir a auditoria a partir do estado real do workspace, restringindo a análise a `src/copilot`, `package.json`, validators MCP/Copilot e documentação oficial atualizada de MCP, GitHub Copilot SDK, GitHub MCP/Copilot e Node SQLite. Estado local observado: branch `main`, `HEAD 403252ca`, worktree limpo.

### 5-B.1 Baseline técnico atual

| Eixo | Estado observado em 2026-06-12 | Implicação |
| ---- | ------------------------------ | ---------- |
| SDK GitHub Copilot | `@github/copilot-sdk` está em `^1.0.0` no `package.json` | Tratar 0.3.0 como baseline histórico de migração, não como estado corrente |
| MCP TypeScript SDK | `@modelcontextprotocol/sdk` está em `^1.29.0` | Compatível com o ciclo 1.x; SDK v2 upstream ainda não é alvo produtivo |
| Runtime | `engines.node >=24.0.0`; Volta aponta Node 24.13.0; validação rodou em cache Node 24.15.0 | O alvo “Node 24.5+” está atendido; cuidado com APIs que mudaram dentro da linha 24.x |
| SQLite | Projeto mantém `better-sqlite3 ^12.10.0` | Decisão continua defensável: `node:sqlite` só virou release candidate em Node 25.7.0; em Node 24.x deve permanecer tratado como API experimental/instável para produção |
| Superfície MCP | `mcp_tools_status`: 100 tools; 76 read-only; 21 bounded-write; 3 destructive; 0 open-world | Boa postura de autonomia, mas há risco de contexto/tool selection por excesso de superfície |
| Apps SDK/CK | `mcp_apps_sdk_readiness`: sem widget resource, sem CSP aplicável, sem Company Knowledge `search/fetch` | Gap de produto; não é fonte atual de prompts, mas limita UX rica e integração CK |
| Validação | `suite-copilot-fast` job `f9a9dcfa-790a-40a3-a750-c6d0ce9040f6`: PASS | Novo baseline canônico para `src/copilot` no HEAD atual |

**Resultado de validação desta rodada:**

- `npm run typecheck:strict:src.copilot`: PASS em 5.068ms.
- `npm run lint:copilot`: PASS em 34.300ms.
- `npm run test:copilot:unit`: PASS em 137.637ms.
- Vitest compacto: 539 arquivos selecionados; 6.450 testes totais; 6.422 passed; 0 failed; 28 pending; 1.956 suítes passed; 0 warnings/errors únicos.

### 5-B.2 Atualização por documentação oficial

- **MCP:** a especificação oficial mais recente observada é `2025-11-25`, que define MCP como protocolo JSON-RPC 2.0 e enfatiza consentimento, controle do usuário, privacidade de dados, segurança de tools e descrições/annotations como material não confiável. Referência: https://modelcontextprotocol.io/specification/2025-11-25
- **MCP TypeScript SDK:** o repositório oficial indica que o branch principal contém v2 em desenvolvimento/pre-alpha, enquanto v1.x continua a recomendação produtiva até a estabilização upstream. Referência: https://github.com/modelcontextprotocol/typescript-sdk
- **GitHub Copilot SDK:** a documentação oficial de Getting Started exige Node.js 20+ para TypeScript e instala `@github/copilot-sdk`; a documentação também expõe streaming, tools, MCP e telemetria/OpenTelemetry como trilhas nativas. Referências: https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started e https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry
- **GitHub Copilot + MCP:** MCP é agora documentado como integração transversal para IDEs, Copilot CLI, Copilot app, cloud agent e code review; a própria documentação recomenda toolsets menores para performance, segurança, acurácia de seleção e economia de tokens. Referência: https://docs.github.com/en/copilot/concepts/context/mcp
- **Node SQLite:** a documentação oficial atual mostra `node:sqlite` como release candidate somente a partir de Node 25.7.0 e lista histórico de opções dentro de 24.x; para Node 24.5+ a decisão de não migrar automaticamente de `better-sqlite3` permanece correta até benchmark e contrato de estabilidade. Referência: https://nodejs.org/api/sqlite.html

### 5-B.3 Novos achados CDEX adicionados

| ID | Severidade | Achado | Evidência local | Recomendação |
| -- | ---------- | ------ | --------------- | ------------ |
| CDEX-052 | 🟠 Alta | O documento ainda referencia MCP 2025-06-18, enquanto o código e a documentação atual já apontam para MCP 2025-11-25 | `dev-oauth.js` menciona MCP 2025-11-25 em comentários de `CIMD` e resource indicators; refs finais ainda listavam 2025-06-18 | Atualizar matriz de compatibilidade para 2025-11-25; manter testes de OAuth/resource indicator contra esse baseline |
| CDEX-053 | 🟡 Média | Baseline histórico do relatório cita SHAs anteriores; estado atual real é `HEAD 403252ca` | `repo_status`: branch `main`, worktree limpo, head `403252ca` | Toda revalidação futura deve registrar HEAD, job id e data absoluta antes de marcar PASS |
| CDEX-054 | 🟠 Alta | Dashboard de validação pode induzir leitura errada quando há jobs antigos falhos | Antes do novo run, `unit-copilot` efetivo apontava job antigo `97959911...` com falha; após `suite-copilot-fast`, efetivo passou | Manter política de “rodar dashboard + job novo” antes de decisões; opcional: ocultar falhas históricas quando há job mais novo e efetivo verde |
| CDEX-055 | 🟡 Média | Arquivos com `#` existem dentro do escopo `src/copilot/docs`, não apenas na raiz | `src/copilot/docs/# Auditoria Cloudflare — MCP externo.md`; `src/copilot/docs/# Plano completo de patches OAuth.md` | Renomear para nomes ASCII/slug sem `#` e atualizar links; mitiga glob/shell/markdown tooling bugs |
| CDEX-056 | 🟠 Alta | Monólito crítico de OAuth concentra issuer, PAR, DCR/CIMD, PKCE, DPoP, refresh rotation, JWKS, SSRF e logs no mesmo arquivo | `src/copilot/mcp/control-plane/dev-oauth.js`: ~157KB, versão interna 1.6.0, mais de 4.200 linhas, 12 exports | Dividir por módulos: issuer metadata, request parsing, client metadata fetch, token service, refresh store, DPoP/private_key_jwt, diagnostics/logging |
| CDEX-057 | 🟠 Alta | Comando BYOK/model-gateway virou macroarquivo de altíssima entropia | `src/copilot/terminal/commands/byok.js`: 376.989 bytes, modificado em 2026-06-12 | Separar parser, renderers, provider commands, sqlite/catalog actions, live-test commands e redaction; manter façade compatível |
| CDEX-058 | 🟡 Média | Outros arquivos de terminal ainda excedem orçamento saudável de manutenção | `session.js` ~127KB; `sdk.js` ~113KB; `events/sdk-session-events.js` ~106KB | Adotar budget por arquivo (ex: soft 40KB, hard 80KB) com exceções documentadas; refatorar por subdomínio |
| CDEX-059 | 🟠 Alta | Store SQLite do model-gateway é monolítica e security/performance-critical | `src/copilot/model-gateway/catalog/sqlite-catalog-store.js`: 141.743 bytes; depende de decisões L2/cache/catalog | Separar migrations/schema, prepared statements, retention, query/search, refresh log e diagnostics; adicionar contract tests de lock/busy timeout |
| CDEX-060 | 🟡 Média | `src/copilot/docs` contém documentos gigantes dentro do hot path de árvore/índice | Docs em `terminal` e `model-gateway` passam de centenas de KB; um roadmap terminal passa de 695KB | Mover docs históricas para archive fora do hot path ou marcar exclusões no índice; manter docs operacionais curtas no escopo ativo |
| CDEX-061 | 🟠 Alta | Superfície de 100 tools é poderosa, mas pode degradar tool selection e custo de contexto | `mcp_tools_status`: 100 tools; GitHub recomenda toolsets menores por performance/segurança/acurácia | Criar perfis por host: `chatgpt-default`, `chatgpt-maintenance`, `claude-audit`, `local-admin`; medir envelope `tools/list` por perfil |
| CDEX-062 | 🟡 Média | Apps SDK widget/CSP e Company Knowledge ainda não existem | `mcp_apps_sdk_readiness`: `hasWidgetResource=false`, `searchFetchToolsDetected=false` | Não gastar tempo com CSP antes de widget; planejar resource widget só se houver UX concreta; para CK, criar ferramentas `search/fetch` exatas quando o corpus justificar |
| CDEX-063 | 🟠 Alta | OTEL existe, mas os spans de fases MCP continuam pendentes | Roadmap 5.5.3 permanece aberto; docs oficiais do Copilot SDK tratam OTEL como trilha nativa | Instrumentar `authorization`, `handler`, `resultSize`, `cloudflareEdge`, `toolPayloadAudit`, propagando `traceparent` em tool invocations |
| CDEX-064 | 🟡 Média | Prefetch L1 ainda não é orientado por telemetria real | Roadmap 5.1.3/5.1.4 abertos | Derivar hotset dos últimos jobs/sessões, invalidar por mtime/hash e medir L1 hit ratio antes/depois |
| CDEX-065 | 🟠 Alta | Benchmark QUIC vs auto/http2 segue como decisão aberta apesar de scripts prontos | Scripts `copilot:mcp:quic:*`, `h2:*` e `mcp_cloudflare_transport_benchmark_plan` existem; roadmap 5.6 aberto | Executar benchmark controlado com p50/p95/p99 e registrar artefato canônico em docs Cloudflare |
| CDEX-066 | 🟠 Alta | Rotação de chaves OAuth continua sem runbook final | Roadmap 6.3 aberto; `dev-oauth.js` já tem ES256, legacy overlap, `kid`, key file e key rotation flag | Criar `MCP-OAUTH-KEY-ROTATION.md`, tool plan-only e testes de rollover com JWKS overlap/grace period |
| CDEX-067 | 🟡 Média | Node 24.5+ permite estudar `node:sqlite`, mas migração imediata seria prematura | `better-sqlite3` em produção; Node docs indicam release candidate só em Node 25.7 | Manter `better-sqlite3`; criar branch experimental de compat layer para `node:sqlite` somente com benchmark e feature flag |
| CDEX-068 | 🟡 Média | Exports/import maps do SDK interno já são amplos e podem cristalizar APIs experimentais | `package.json` exporta `./copilot/sdk/rpc/experimental` e vários aliases `#copilot/sdk/*` | Definir semver interno: `experimental` sempre feature-gated; gerar API report para evitar vazamento de contrato instável |
| CDEX-069 | 🟡 Média | O pacote usa `@types/node ^25.9.2` enquanto runtime alvo declarado é Node 24+ | `package.json`: engines Node >=24; devDependency `@types/node ^25.9.2` | Avaliar pin para tipos Node 24 LTS ou matriz dupla; evita usar tipos/APIs Node 25 por acidente no código Node 24.5+ |
| CDEX-070 | 🟢 Oportunidade | GitHub Copilot SDK 1.0 já tem trilhas oficiais de MCP, BYOK, streaming events e OTEL | `package.json` em `@github/copilot-sdk ^1.0.0`; docs oficiais confirmam trilhas | Transformar o wrapper `src/copilot/sdk` em camada de compat/observabilidade, não em fork conceitual do SDK oficial |

### 5-B.4 Roadmap incremental desta rodada

#### P0 — Baseline e segurança documental

- [ ] Atualizar todas as referências MCP 2025-06-18 para 2025-11-25 onde a semântica realmente mudou.
- [ ] Renomear os dois arquivos `src/copilot/docs/# ...md` para slugs sem `#` e corrigir links internos.
- [ ] Adicionar cabeçalho “validated at HEAD/job id” em futuras auditorias.

#### P1 — Manutenibilidade dos monólitos críticos

- [ ] Refatorar `dev-oauth.js` em módulos de OAuth sem mudar superfície pública.
- [ ] Refatorar `terminal/commands/byok.js` por subcomandos e renderers.
- [ ] Refatorar `model-gateway/catalog/sqlite-catalog-store.js` por store/migrations/retention/queries.
- [ ] Criar gate de filesize por `src/copilot` com allowlist explícita para exceções.

#### P2 — Observabilidade e performance

- [ ] Instrumentar spans OTEL MCP por fase e correlacionar com Copilot SDK trace context.
- [ ] Gerar hotset de prefetch a partir de telemetry/jobs e medir L1 hit ratio.
- [ ] Executar benchmark QUIC vs auto/http2 e publicar artefato com p50/p95/p99.
- [ ] Medir envelope `tools/list` por perfil e reduzir default ChatGPT quando possível.

#### P3 — Produto e integração rica

- [ ] Planejar Apps SDK widget apenas após caso de uso concreto; antes disso, manter CSP fora da prioridade.
- [ ] Implementar Company Knowledge `search/fetch` somente se houver corpus indexável com benefício claro.
- [ ] Transformar `src/copilot/sdk` em façade explícita do `@github/copilot-sdk` 1.0, com API report e testes de compatibilidade.

---

## 6. Prioridade de Execução Atualizada

| Prioridade | Item                                                 | Estado         | Próxima evidência necessária                       |
| ---------- | ---------------------------------------------------- | -------------- | -------------------------------------------------- |
| P1         | JWKS warmup não bloqueante                          | Validado live  | 2 chaves; warmup 614ms; primeira auth 2ms          |
| P2         | Decisão medida sobre ativação do L2 por perfil      | Em aberto      | Hit ratio, latência e custo no `copilot.sqlite`    |
| P2         | Benchmark QUIC vs auto/http2                        | Em aberto      | p50/p95/p99 controlados                            |
| P2         | Orçamento do envelope `tools/list`                  | Validado live  | 113.236/131.072 bytes local e remoto                |
| P2         | Rotação de chaves OAuth com grace period            | Em aberto      | Design, runbook e testes de rollover               |
| P3         | Instrumentar spans MCP por fase                     | Parcial        | Traces authorization/handler/resultSize            |
| P3         | Hotset de prefetch MCP                              | Parcial        | Top arquivos e ganho medido de L1                  |
| P4         | SDK v2                                              | Bloqueado upstream | Release estável oficial                         |

---

## 7. Métricas de Sucesso

Para cada fase, os critérios de conclusão são:

| Fase | Critério de Sucesso                                                                       |
| ---- | ----------------------------------------------------------------------------------------- |
| 1    | `unit-copilot` 0 falhas, workspace publicado e runtime live saudável                       |
| 2    | Autorização cold-start < 30ms; L1 hit ratio > 50% em sessão quente; smoke OK no startup   |
| 3    | 0 barrels violados e surface profiles funcionais; docs globais são N/A neste escopo       |
| 4    | Decisão de manter `better-sqlite3` documentada; SDK v2 aguarda release estável            |
| 5    | L2 hit ratio > 40% em sessão quente; p99 QUIC < 500ms ou decisão de transport documentada |
| 6    | SSRF/DNS privado bloqueados e replay cache sobrevive restart; rotação de chaves pendente   |
| 7    | Contract tests de surface passando; percentual de coverage hooks ainda não medido          |

---

## 8. Referências Consultadas

- MCP Specification 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25
- @modelcontextprotocol/sdk v1.29.x / v2 pre-alpha: https://github.com/modelcontextprotocol/typescript-sdk
- GitHub Copilot SDK Getting Started: https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started
- GitHub Copilot SDK MCP: https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/mcp
- GitHub Copilot SDK OpenTelemetry: https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry
- GitHub Copilot MCP overview/toolsets: https://docs.github.com/en/copilot/concepts/context/mcp
- OpenAI Apps SDK: https://developers.openai.com/apps-sdk/reference
- RFC 9728 (PRM): https://www.rfc-editor.org/rfc/rfc9728.html
- RFC 9449 (DPoP): https://www.rfc-editor.org/rfc/rfc9449.html
- RFC 7636 (PKCE): https://www.rfc-editor.org/rfc/rfc7636.html
- RFC 7591 (DCR): https://www.rfc-editor.org/rfc/rfc7591.html
- Node.js 24 `node:sqlite`: https://nodejs.org/api/sqlite.html
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Cloudflare Rate Limiting: https://developers.cloudflare.com/waf/rate-limiting-rules/

---

_Documento gerado por auditoria automatizada via MCP. Para verificação independente, rodar
`mcp_run_safe_validation_suite` com suite `mcp-full` e comparar com resultados desta sessão._
