# Diagnóstico amplo do sistema MCP / OAuth / HTTP2-QUIC / Cloudflare

Data: 2026-06-10
Workspace: `/workspaces/chatgpt-docker-puppeteer`
Conector público: `https://mcp.aurelin.org/mcp`
Escopo: MCP Streamable HTTP, OAuth, Cloudflare Tunnel, HTTP/2 origin, QUIC edge transport, edge posture, runtime, validação, observabilidade e próximos passos.

---

## 1. Sumário executivo

O sistema está **operacional e apto para uso**, com o conector permanente `https://mcp.aurelin.org/mcp` em modo OAuth, Cloudflare Tunnel permanente, transporte Cloudflare em **QUIC**, origin local em **HTTPS/HTTP2**, smoke público atualizado e post-change gates aprovados.

A situação atual é muito melhor que o estado inicial das rodadas anteriores:

- readiness geral: `ready=true`, sem blockers;
- OAuth: issuer, metadata, JWKS, PKCE S256, DCR/CIMD, resource parameter e scopes estão consistentes;
- Cloudflare Tunnel: remoto saudável, 4 conexões HA, QUIC presente, erro de request zero;
- latência QUIC: RTT normalizado corretamente como milissegundos, com `smoothedRttMs` na casa de dezenas de ms;
- edge posture: cache bypass e passthrough de MCP/OAuth configurados; nenhuma regra crítica bloqueando `/mcp`;
- runtime MCP: `status=ok` após refresh de smoke e `mcp_smoke_workspace`; sem erros de tools no snapshot recente;
- validação: typecheck e unit-mcp passaram.

Principais pontos ainda a tratar:

1. O workspace está sujo, com alterações não commitadas/untracked.
2. Há settings Cloudflare zone-wide potencialmente interferentes, mas há regra scoped passthrough mitigando MCP/OAuth. Ainda convém manter auditoria periódica.
3. Não há rate limit explícito para `/mcp` anônimo no edge; a mitigação atual está no origin fallback.
4. As tools mais lentas são diagnósticos Cloudflare remotos, não o hot path normal de uso do MCP.
5. Os logs antigos mostram erros de origin/TLS antes do smoke mais recente; após refresh, os gates dizem que não há origin errors acionáveis depois do último smoke.

Conclusão: **não há blocker funcional; há melhorias recomendadas de higiene, hardening e observabilidade.**

---

## 2. Premissas oficiais consideradas

### 2.1 MCP Streamable HTTP

A especificação MCP 2025-06-18 define que Streamable HTTP usa JSON-RPC sobre HTTP, com endpoint MCP único que suporta POST e GET; cada mensagem JSON-RPC enviada ao servidor deve usar um novo HTTP POST. Também exige `Accept: application/json, text/event-stream` e recomenda autenticação adequada, validação de `Origin` e bind local seguro para servidores locais.

Referência oficial: `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`

Implicação para este sistema: a otimização correta não é inventar transporte incompatível, mas reduzir overhead em volta de cada request: autenticação, validação, cache, I/O, auditoria, keep-alive, Cloudflare edge e origin HTTP2.

### 2.2 MCP Authorization / OAuth

A especificação MCP de autorização para HTTP-based transports é baseada em OAuth 2.x, Authorization Server Metadata, Dynamic Client Registration e Protected Resource Metadata. MCP clients devem usar Protected Resource Metadata para descobrir authorization servers; MCP servers devem usar `WWW-Authenticate` em 401 para indicar resource metadata.

Referência oficial: `https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`

Implicação para este sistema: manter OAuth forte é obrigatório para o modo público. Caches de metadata/JWKS são aceitáveis apenas quando preservam issuer, audience/resource, assinatura, expiração, scopes e challenge HTTP/MCP.

### 2.3 Cloudflare Tunnel QUIC/HTTP2

Cloudflare Tunnel suporta protocolos `auto`, `http2` e `quic`. QUIC exige saída UDP para a porta 7844; HTTP/2 usa TCP. Em ambientes com firewall/SNI, os hosts relevantes incluem `quic.cftunnel.com` e `h2.cftunnel.com`.

Referências oficiais:

- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/`
- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/`

Implicação para este sistema: QUIC é uma escolha correta quando os gates mostram RTT baixo, 4 HA connections, erro zero e smoke fresco. Rollback HTTP/2 deve permanecer disponível.

### 2.4 OpenAI Apps SDK / OAuth

A documentação oficial da OpenAI Apps SDK trata autenticação via schemes OAuth/security schemes e recomenda que tools protegidas indiquem desafios de autenticação de modo compatível com o cliente.

Referência oficial: `https://developers.openai.com/apps-sdk/build/auth`

Implicação para este sistema: o conector ChatGPT deve continuar recebendo OAuth metadata, WWW-Authenticate e scopes consistentes, sem Cloudflare Access/challenge interativo na frente de `/mcp`.

---

## 3. Estado atual consolidado

### 3.1 Conector e readiness

Estado observado:

- `ready=true`;
- `blockers=[]`;
- URL: `https://mcp.aurelin.org/mcp`;
- validação da URL: `ok=true`;
- formulário ChatGPT esperado: nome `LLM-B Workspace MCP`, URL `/mcp`, autenticação `OAuth`;
- política HTTP2+: Cloudflare QUIC + origin HTTP2 + HTTPS loopback.

Valores relevantes:

```text
connectorUrl = https://mcp.aurelin.org/mcp
auth.mode = oauth
auth.enforcement = all
http2Plus.cloudflareTunnelTransport = quic
http2Plus.originTransport = http2
http2Plus.cloudflareHttp2OriginRequested = true
originUrl = https://127.0.0.1:3333
originServerName = mcp.aurelin.org
```

Diagnóstico: **pronto para uso.**

Observação: havia smoke antigo, mas foi executado `mcp_connector_smoke_refresh` e os gates posteriores passaram com smoke fresco.

---

## 4. OAuth e autorização

### 4.1 Configuração de resource server

Estado observado:

```text
mode = oauth
enforcement = all
protectedResourceMetadataUrl = https://mcp.aurelin.org/.well-known/oauth-protected-resource
expectedIssuer = https://mcp.aurelin.org
expectedAudience = https://mcp.aurelin.org
jwksUri = https://mcp.aurelin.org/oauth/jwks.json
staticBearerConfigured = false
```

Audiences aceitas:

```text
https://mcp.aurelin.org
https://mcp.aurelin.org/
https://mcp.aurelin.org/mcp
https://mcp.aurelin.org/mcp/
```

Scopes:

```text
repo:read
repo:write
repo:validate
repo:admin
```

Challenge preview está presente e inclui `resource_metadata`, erro e descrição.

Diagnóstico: **OAuth está consistente com o modo público do conector.**

### 4.2 Authorization Server Metadata

`mcp_oauth_issuer_diagnostics` retornou `ready=true`.

Campos importantes observados:

- `issuer = https://mcp.aurelin.org`;
- authorization endpoint configurado;
- token endpoint configurado;
- JWKS URI configurado;
- userinfo endpoint configurado;
- registration endpoint configurado;
- revocation endpoint configurado;
- `client_id_metadata_document_supported=true`;
- `resource_parameter_supported=true`;
- `authorization_response_iss_parameter_supported=true`;
- `token_endpoint_auth_methods_supported = none, private_key_jwt`;
- `code_challenge_methods_supported = S256`;
- response type `code`;
- grant types `authorization_code`, `refresh_token`;
- scopes repo e OIDC presentes;
- missing required scopes: nenhum;
- missing recommended fields: nenhum.

Client Metadata CIMD também está ok:

```text
checkedUrl = https://mcp.aurelin.org/.well-known/oauth-client/codex-smoke.json
ok = true
status = 200
clientName = Copilot MCP CIMD smoke client
redirectUris = https://chatgpt.com/connector/oauth/codex-smoke
tokenEndpointAuthMethod = none
```

Diagnóstico: **OAuth issuer/metadata está saudável e compatível com os requisitos do conector.**

### 4.3 Pontos de atenção OAuth

1. O modo `publicOauthDiagnosticsEnabled` aparece como parte do design anterior; isso é útil para diagnóstico, mas em janelas de hardening extremo pode ser reduzido se necessário.
2. Manter `COPILOT_MCP_OAUTH_REQUIRE_RESOURCE_CLAIM=true` é correto, pois reduz risco de confused deputy.
3. Não adicionar Cloudflare Access interativo na frente de `/mcp`, pois isso criaria uma segunda camada OAuth/browser que o conector MCP não necessariamente resolve.

---

## 5. Cloudflare Tunnel, HTTP2 origin e QUIC

### 5.1 Estado do túnel

Estado observado:

```text
mode = named-permanent
tunnelName = workspace-mcp-dev
zone = aurelin.org
publicHostname = mcp.aurelin.org
publicMcpUrl = https://mcp.aurelin.org/mcp
transportProtocol = quic
originUrl = https://127.0.0.1:3333
localMcpUrl = https://127.0.0.1:3333/mcp
```

Token:

```text
tokenPresent = false
tokenFilePresent = true
```

Diagnóstico: **modo permanente está correto; token por arquivo é aceitável e evita expor token no ambiente.**

### 5.2 HA connections e colos

Remote audit mostrou túnel remoto `healthy`, com 4 conexões Cloudflare ativas, todas sem pending reconnect, clientVersion `2026.5.2`, em colos GRU.

Exemplo de colos observados:

```text
gru07
gru02
gru13
gru18
```

Diagnóstico: **alta disponibilidade do tunnel está saudável.**

### 5.3 Origin request profile

A configuração remota do tunnel aponta para:

```text
hostname = mcp.aurelin.org
service = https://127.0.0.1:3333
catchAll = http_status:404
```

Origin request observado:

```text
originServerName = mcp.aurelin.org
noTLSVerify = false
http2Origin = true
disableChunkedEncoding = false
connectTimeout = 5s
keepAliveTimeout = 1m30s
keepAliveConnections = 100
tcpKeepAlive = 30s
```

Diagnóstico: **perfil originRequest está alinhado com HTTPS loopback + HTTP/2 origin.**

### 5.4 Métricas QUIC e cloudflared

Snapshot cloudflared:

```text
cloudflared version = 2026.5.2
goVersion = go1.26.3
haConnections = 4
registerSuccess = 4
requestErrors = 0
requestErrorRate = 0
rpcClientLatency.averageMs = 399
rpcClientLatency.p50Ms = 350
rpcClientLatency.p95Ms = 1170
rpcClientLatency.p99Ms = 1314
quic.present = true
quic.totalConnections = 4
quic.closedConnections = 0
quic.latestRttMs = 21
quic.smoothedRttMs = 32
quic.rttUnit = milliseconds
mtu = 1344
maxUdpPayload = 1360
packetTooBigDropped = 0
```

Diagnóstico: **QUIC está saudável.** O RTT está baixo, sem packet-too-big drops, sem request errors e com 4 conexões HA.

### 5.5 Post-change gates

Depois de refresh de smoke, gates:

```text
ok = true
lastSmokeFresh = true
remoteActiveConnections = 4
metricsOk = true
haConnections = 4
requestErrorRate = 0
quicPresent = true
rpcClientP95Ms = 1170
critical = []
warnings = []
```

Checks passados incluem:

- tunnel status success;
- smoke permanente fresco;
- nenhum origin error acionável após último smoke;
- remote audit ok;
- HA connections >= 4;
- metrics snapshot ok;
- request error rate zero;
- QUIC metrics presentes;
- QUIC RTT dentro do budget;
- RPC p95 dentro do budget.

Diagnóstico: **gates operacionais aprovados.**

---

## 6. Cloudflare Edge posture

### 6.1 Edge audit

Edge audit retornou:

```text
ok = true
edgeAuditable = true
critical = []
permissionGaps = []
inspectedRulesets = 3
inspectedRules = 3
hostScopedRules = 3
mcpScopedRules = 2
cacheBypassCandidateCount = 1
blockingMcpRuleCount = 0
hostWideChallengeRuleCount = 0
oauthTokenRateLimitCount = 1
mcpRateLimitCount = 0
sensitiveHeaderTransformCount = 0
```

Rulesets encontrados:

1. `MCP passthrough configuration`, phase `http_config_settings`;
2. `MCP OAuth token endpoint protection`, phase `http_ratelimit`;
3. `MCP dynamic routes cache bypass`, phase `http_request_cache_settings`.

Diagnóstico: **edge posture é funcionalmente seguro para MCP, sem challenge/browser block em `/mcp`.**

### 6.2 Cache bypass

Regra existente:

```text
Bypass cache for MCP/OAuth dynamic routes
paths: /mcp, /oauth/, /.well-known/, /health
cacheEnabled = false
```

Diagnóstico: **bom para evitar cache indevido em tráfego dinâmico MCP/OAuth.**

Observação: o policy plan desejado fala em short-cache para metadata pública GET-only, mas o audit atual mostra bypass para `/.well-known/`. Isso é seguro, mas não maximiza performance em metadata pública. É uma otimização opcional, não blocker.

### 6.3 Config passthrough

Config rule scoped para MCP/OAuth:

```text
bic = false
email_obfuscation = false
response_body_buffering = none
rocket_loader = false
```

Diagnóstico: **mitiga os settings zone-wide que poderiam interferir em clientes não-browser.**

### 6.4 Zone settings

Config audit observou zone-wide:

```text
browser_check = on
security_level = medium
rocket_loader = on
rum = on
email_obfuscation = on
polish = off
hotlink_protection = off
```

Warnings:

- Browser Integrity Check aparece habilitado zone-wide;
- Rocket Loader deve ser explicitamente desabilitado/bypassado para MCP routes;
- Browser RUM deve ser desabilitado/bypassado;
- Email Obfuscation deve ser desabilitado/bypassado;
- Bot Fight Mode e Zaraz não puderam ser auditados/foram Not Found/unknown.

Mitigação já existente: regra scoped `MCP/OAuth passthrough config for non-browser API traffic`.

Diagnóstico: **não há crítico, mas convém manter o passthrough como regra obrigatória e auditar drift periodicamente.**

### 6.5 Rate limiting

Existe rate limit para:

```text
/oauth/token
```

Não existe rate limit explícito para `/mcp` anônimo no edge. O policy diff aponta isso como informational/mitigated porque existe fallback no origin:

```text
originAnonymousRateLimit.enabled = true
windowMs = 10000
requestsPerWindow = 40
maxBuckets = 10000
```

Diagnóstico: **aceitável no momento; recomendável adicionar edge rate-limit para `/mcp` anônimo se o plano Cloudflare e a expressão por header Authorization permitirem sem afetar sessões autenticadas.**

---

## 7. Smoke, validação e runtime

### 7.1 Connector smoke

Foi executado refresh:

```text
success = true
connectorUrl = https://mcp.aurelin.org/mcp
protocolVersion = 2025-06-18
health.ok = true
health.status = 200
oauth.ok = true
protectedResource.status = 200
authorizationServer.status = 200
tools.status = 401
authChallenge.ok = true
wwwAuthenticatePresent = true
reason = oauth-challenge-accepted
criticalTools.missing = []
```

Interpretação: tools/list sem bearer retornou 401, que é correto no modo OAuth. O smoke aceitou o challenge e verificou ausência de critical tool gaps.

Diagnóstico: **smoke público correto.**

### 7.2 Workspace smoke

`mcp_smoke_workspace`:

```text
success = true
status = degraded
durationMs = 473
critical = []
warning = WORKSPACE_DIRTY
```

Checks relevantes:

```text
repo_status = ok, 42ms
repo_tree_default = ok, 5ms
repo_root_tree_redaction = ok, 24ms
secret_read_blocked = ok, 0ms
repo_read_file = ok, 3ms
repo_file_stats = ok, 1ms
repo_search_text = ok, 124ms
repo_find_symbol_usages = ok, 229ms
repo_symbol_search = ok, 15ms
repo_file_outline = ok, 17ms
repo_index_status = ok, 2ms
project_doctor = ok, 10ms
mcp_runtime_health = ok, 1ms
```

Diagnóstico: **workspace MCP está saudável; degradado apenas por workspace dirty.**

### 7.3 Runtime health

Após smoke refresh e workspace smoke:

```text
status = ok
warnings = []
critical = []
workspace.dirty = true
branch = main
head = e69ec3d8
index.available = true
index.files = 1322
index.freshFiles = 1322
symbols = 9606
chunks = 2472
tunnel.mode = named-permanent
tunnel.transportProtocol = quic
lastSmokeOk = true
lastSmokeAgeMinutes = 1
```

Diagnóstico: **runtime ok; única observação é dirty workspace.**

### 7.4 Validação

Validation dashboard:

```text
typecheck = passed
unit-mcp = passed
runningCount = 0
recommendedNextAction = none
```

Diagnóstico: **validação principal MCP está verde.**

Observação: há `failingJobIds` antigos no dashboard, mas os effective checks atuais estão passed. Isso é histórico, não falha atual.

---

## 8. Performance e latência por fase

### 8.1 Métricas agregadas

Runtime recente:

```text
metrics.calls = 19
metrics.errors = 0
metrics.tools = 16
```

Phase totals:

```text
handler: calls=19, total=39350ms, average=2071ms
authorization: calls=19, total=337ms, average=18ms
resultSize: calls=19, total=8ms, average=0ms
auditCompletion: calls=19, total=2ms, average=0ms
outputValidation: calls=19, total=0ms, average=0ms
rateLimit: calls=19, total=0ms, average=0ms
```

Interpretação:

- Autorização não é gargalo geral: média 18ms.
- Auditoria não é gargalo: média ~0ms, confirmando que a mudança assíncrona foi efetiva.
- Result size/output validation não pesam.
- Handler domina porque inclui chamadas remotas Cloudflare/API nos diagnósticos.

### 8.2 Tools mais lentas observadas

```text
mcp_cloudflare_edge_audit: ~13147ms
mcp_cloudflare_config_audit: ~6545ms
mcp_cloudflare_edge_policy_diff: ~4415ms
mcp_cloudflare_post_change_gates: ~3801ms média
mcp_cloudflare_remote_audit: ~3077ms
mcp_connector_smoke_refresh: ~1494ms
mcp_validation_dashboard: ~1077ms média
mcp_smoke_workspace: ~475ms
```

Interpretação: **latência pesada está concentrada em diagnósticos Cloudflare remotos e não no uso normal das repo tools.**

### 8.3 Repo tools e uso normal

Smoke local mostrou:

```text
repo_read_file = 3ms
repo_file_stats = 1ms
repo_tree_default = 5ms
repo_search_text = 124ms
repo_find_symbol_usages = 229ms
repo_symbol_search = 15ms
repo_file_outline = 17ms
```

Diagnóstico: **hot path de repo está rápido.** A maior oportunidade horizontal remanescente é cache/parallelização em diagnósticos Cloudflare/edge, não leitura de arquivos ou auditoria local.

---

## 9. Segurança e proteção

### 9.1 Pontos fortes

- OAuth enforcement `all`;
- static bearer desabilitado;
- issuer/audience/JWKS configurados;
- scopes repo explícitos;
- challenge WWW-Authenticate presente;
- Protected Resource Metadata publicada;
- Authorization Server Metadata ok;
- cache bypass dinâmico para MCP/OAuth;
- passthrough scoped para desabilitar browser features nas rotas MCP/OAuth;
- origin anonymous MCP rate limit habilitado;
- secret read blocked no smoke;
- root redaction funcionando.

### 9.2 Riscos residuais

1. **Workspace dirty**: pode misturar diagnóstico de runtime com alterações locais ainda não versionadas.
2. **No explicit anonymous `/mcp` edge rate limit**: mitigado no origin, mas edge seria mais cedo/barato.
3. **Zone-wide browser settings**: mitigados por config rule, mas requerem auditoria de drift.
4. **Audit gaps**: Bot Fight Mode/Zaraz não auditáveis via tool atual.
5. **Old origin log errors**: não acionáveis depois do smoke, mas devem continuar sendo filtrados por timestamp do último smoke.

---

## 10. Diagnóstico final por componente

| Componente | Estado | Evidência | Ação |
|---|---:|---|---|
| MCP endpoint | Saudável | readiness ready, smoke ok, 401 correto sem bearer | manter |
| OAuth resource server | Saudável | issuer/audience/JWKS/scopes ok | manter |
| Authorization metadata | Saudável | PKCE S256, DCR/CIMD, resource parameter | manter |
| Cloudflare Tunnel | Saudável | remote healthy, 4 HA connections | manter QUIC |
| QUIC | Saudável | RTT 21/32ms, no drops, errors 0 | manter e monitorar |
| Origin HTTP2 | Saudável | remote originRequest http2Origin=true, SNI correto | manter |
| Edge cache | Seguro | bypass dinâmico presente | considerar short-cache metadata opcional |
| Edge passthrough | Seguro | BIC/rocket/email/body buffering mitigados | manter |
| Rate limit | Aceitável | `/oauth/token` edge + `/mcp` anônimo origin | considerar edge anon `/mcp` |
| Runtime MCP | Saudável | status ok, warnings vazias após smoke | manter |
| IO index | Saudável | 1322 arquivos, 9606 símbolos, 2472 chunks | manter |
| Repo tools | Rápidas | read_file 3ms; status/tree/stats baixos | manter |
| Validação | Verde | typecheck e unit-mcp passed | rodar full antes de release |

---

## 11. Recomendações priorizadas

### P0 — Fazer agora

1. Commitar ou limpar o workspace dirty.
2. Rodar `npm run copilot:mcp:quic:canary` após qualquer mudança de conexão/tunnel.
3. Manter `mcp_connector_smoke_refresh` como etapa obrigatória depois de restart.
4. Continuar usando `mcp_cloudflare_post_change_gates` como gate final.

### P1 — Hardening de borda

1. Avaliar regra Cloudflare edge para `/mcp` anônimo sem `Authorization`, preservando tráfego autenticado.
2. Manter origin anonymous fallback enquanto edge não estiver cobrindo `/mcp` anônimo.
3. Documentar que Cloudflare Access/challenge interativo não deve ser colocado diante de `/mcp`.
4. Verificar periodicamente se o scoped config rule continua ativo.

### P2 — Performance

1. Aplicar cache TTL/in-flight adicional para Cloudflare edge/config audits, se forem chamados em bursts.
2. Consolidar edge audit + config audit + policy diff em uma chamada composta paralela para reduzir latência diagnóstica.
3. Short-cache GET-only para `/.well-known/*` pode reduzir latência de metadata pública, mas só se a regra excluir `/oauth/token`, `/mcp`, `/health` e qualquer rota dinâmica.
4. Evitar otimizar prematuramente OAuth validation: authorization média está baixa.

### P3 — Observabilidade

1. Persistir pequenas séries temporais de:
   - QUIC RTT;
   - rpc p95;
   - request error rate;
   - HA connections;
   - phaseTotals;
   - smoke freshness.
2. Criar um `mcp_connection_diagnostics_bundle` compacto que rode em paralelo:
   - readiness;
   - auth profile;
   - oauth issuer diagnostics;
   - metrics snapshot;
   - post-change gates;
   - runtime health.
3. Separar latência Cloudflare API em subfases: zone lookup, rulesets, tunnel config, DNS audit.

### P4 — Release discipline

Antes de promover como baseline:

```bash
npm run copilot:mcp:quic:canary
npm run copilot:mcp:safe-suite -- mcp-fast
npm run lint:copilot
```

Para release mais forte:

```bash
npm run copilot:mcp:safe-suite -- mcp-full
```

---

## 12. Comandos operacionais recomendados

### Smoke/gates após restart

```bash
npm run copilot:mcp:quic:canary
```

### Verificação pelo MCP

```text
mcp_connector_smoke_refresh
mcp_cloudflare_post_change_gates
mcp_runtime_health
mcp_oauth_issuer_diagnostics
mcp_cloudflare_metrics_snapshot
```

### Verificação de Cloudflare edge

```text
mcp_cloudflare_remote_audit
mcp_cloudflare_config_audit
mcp_cloudflare_edge_audit
mcp_cloudflare_edge_policy_diff
```

### Validação local

```bash
npm run typecheck:strict:src.copilot
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp
```

---

## 13. Conclusão

O sistema MCP atual está **funcional, autenticado, protegido e performático** para o uso normal. O caminho normal de repo tools é rápido; o custo de latência observado está concentrado nos diagnósticos Cloudflare remotos, que são naturalmente mais pesados por dependerem de API Cloudflare e inspeção de regras.

A arquitetura recomendada é manter:

- MCP Streamable HTTP em `/mcp`;
- OAuth enforcement `all`;
- Cloudflare Tunnel permanente em QUIC;
- origin HTTPS/HTTP2 com SNI `mcp.aurelin.org`;
- config passthrough scoped para MCP/OAuth;
- cache bypass para tráfego dinâmico;
- smoke/gates após restart;
- phase metrics para guiar otimizações.

O sistema não precisa de rollback. A próxima evolução estrutural deve focar em:

1. reduzir latência de diagnósticos Cloudflare com bundle paralelo/cache TTL;
2. hardening opcional de `/mcp` anônimo no edge;
3. disciplina de commit/validação para remover o único estado degradante atual: workspace dirty.

---

## 14. Atualização P1/P2 pós-interrupção — 2026-06-10

Após a retomada da conexão, foram aplicadas e validadas melhorias estruturais adicionais com foco em latência horizontal, estabilidade dos gates e observabilidade:

### 14.1 P1 — correção de falso crítico nos post-change gates

O diagnóstico de `mcp_tunnel_status` agora separa três classes de eventos em `cloudflared.log`:

- `recentOriginErrors`: erros reais de origin/proxy/TLS, como `origin service`, `originService=`, `first record does not look like a TLS handshake`, `connection refused`, `502` e `1033`;
- `recentTunnelTransportErrors`: eventos transitórios/recoverable de transporte QUIC/túnel, como `failed to accept QUIC stream`, `no recent network activity`, `Serve tunnel error`, `Connection terminated`;
- `recentMetricsBindErrors`: colisões de porta do servidor de métricas, como `failed to bind to address`.

Com isso, `mcp_cloudflare_post_change_gates` continua falhando quando há erro real de origin após o último smoke, mas não reprova o gate por erro QUIC transitório já recuperado quando HA connections, smoke e métricas estão saudáveis. Esses eventos continuam visíveis como warnings.

### 14.2 P2 — cache TTL/in-flight para auditorias Cloudflare remotas

Foram adicionados caches curtos, process-local, com deduplicação in-flight para:

- `auditCloudflareEdgeRulesets` / `mcp_cloudflare_edge_audit`;
- `auditCloudflareConfigPosture` / `mcp_cloudflare_config_audit`.

O TTL padrão é 5 segundos e o limite é de 32 entradas. Isso reduz chamadas repetidas à API Cloudflare em rajadas de diagnóstico sem sacrificar funcionalidades, pois as tools agora aceitam:

```text
forceRefresh: true
cacheTtlMs: 0..60000
```

Assim, o caminho normal fica mais rápido, mas diagnósticos pós-mudança podem forçar leitura imediata.

### 14.3 P2 — reuso horizontal do Cloudflare SDK client

O helper `getCloudflareClient(apiToken)` foi exportado de `remote-api.js` e reutilizado por auditorias edge/config. Isso reduz overhead de criação de cliente e mantém um ponto único para política de retries/timeouts do SDK Cloudflare.

### 14.4 P2 — observabilidade dos caches no runtime

`createTtlCache` agora registra caches em um registry process-local, e `getTtlCacheStats()` expõe estatísticas agregadas:

```text
name, ttlMs, maxEntries, size, inFlight, hits, misses, inFlightHits, sets, evictions
```

`mcp_runtime_health` passa a incluir `metrics.ttlCaches` tanto no modo compacto quanto no detalhado. Isso permite medir se a redução de latência veio de cache hit, deduplicação in-flight ou execução remota real.

### 14.5 Validação

A validação final do bloco passou:

```text
suite = mcp-fast
typecheck = pass
unit-mcp = pass
Test Files = 36 passed
Tests = 173 passed
```

Observação operacional: como essas mudanças alteram módulos carregados pelo servidor MCP, é necessário reiniciar o MCP/Cloudflare para que o conector vivo passe a usar o novo código.
