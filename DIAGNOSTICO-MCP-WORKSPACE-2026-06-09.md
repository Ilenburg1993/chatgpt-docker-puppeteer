# Diagnóstico profundo do conector Workspace MCP

**Data:** 2026-06-09  
**Workspace:** `/workspaces/chatgpt-docker-puppeteer`  
**Branch:** `main`  
**Escopo:** MCP remoto do Workspace, Cloudflare Tunnel, OAuth, Apps SDK/ChatGPT, validação,
performance, segurança, autonomia e utilidades para desenvolvimento.

---

## 1. Sumário executivo

O conector Workspace MCP está em um estágio **avançado e funcional**, com postura muito acima do
normal para um MCP de desenvolvimento: URL permanente, OAuth ativo, Cloudflare Tunnel nomeado,
HTTP/2 até a origem, ferramentas anotadas por risco, workflows de plano antes de escrita, quarentena
reversível, validação allowlisted, índice local e auditorias específicas de Cloudflare/OAuth.

A pontuação interna de autonomia reportada foi **96 / A**, com **95 ferramentas anunciadas**, **73
read-only**, **20 bounded-write**, **2 destructive**, **0 open-world** e **12 ferramentas de
plano**. A superfície atual já resolve o problema central: permitir que o ChatGPT leia, navegue,
diagnostique, modifique e valide o repositório de forma auditável, sem shell arbitrário e sem
caminhos arbitrários.

A situação, porém, não é “ideal”. O runtime está **degraded**, não por falha crítica do protocolo,
mas por dívida operacional e de produto: smoke remoto antigo, readiness pós-restart falso por falha
de health local, testes antigos falhando, um teste de escrita com timeout, ausência de Apps SDK
widget/Company Knowledge, possível excesso de tokens OAuth persistidos, ausência de rate limit
explícito para tráfego anônimo `/mcp`, e alguns problemas de ergonomia para resultados grandes.

A linha estratégica correta é: **não tentar “burlar” confirmações do ChatGPT**. O próprio MCP
recomenda humano no loop para ferramentas, e o Apps SDK documenta que `readOnlyHint`,
`destructiveHint`, `openWorldHint` e `idempotentHint` apenas moldam a forma como o ChatGPT apresenta
a chamada; o servidor ainda precisa impor autorização. A autonomia ideal deve vir de ferramentas
estreitas, reversíveis, plan-first, batched, com escopos OAuth adequados, schemas fortes, saídas
compactas, validação agrupada e telemetria.

---

## 2. Referências oficiais consultadas

### MCP

- MCP Specification 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18
- MCP Tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP Authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- MCP Transports / Streamable HTTP:
  https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Official TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk

### OpenAI / Apps SDK / ChatGPT MCP

- Apps SDK reference: https://developers.openai.com/apps-sdk/reference
- Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- OpenAI MCP/connectors docs section: https://developers.openai.com/

### OAuth / OIDC / padrões associados

- RFC 9728 — OAuth 2.0 Protected Resource Metadata: https://www.rfc-editor.org/rfc/rfc9728.html
- RFC 8414 — OAuth 2.0 Authorization Server Metadata: https://www.rfc-editor.org/rfc/rfc8414.html
- RFC 7591 — OAuth 2.0 Dynamic Client Registration: https://www.rfc-editor.org/rfc/rfc7591.html
- RFC 8707 — Resource Indicators for OAuth 2.0: https://www.rfc-editor.org/rfc/rfc8707.html
- RFC 7636 — PKCE: https://www.rfc-editor.org/rfc/rfc7636.html
- RFC 6750 — Bearer Token Usage: https://www.rfc-editor.org/rfc/rfc6750.html

### Cloudflare

- Cloudflare Tunnel origin parameters:
  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/
- Cloudflare Configuration Rules: https://developers.cloudflare.com/rules/configuration-rules/
- Cloudflare Cache Rules: https://developers.cloudflare.com/cache/how-to/cache-rules/
- Cloudflare Rate Limiting Rules: https://developers.cloudflare.com/waf/rate-limiting-rules/

---

## 3. Diagnóstico da situação atual

### 3.1 Estado Git e Workspace

Estado observado:

```text
branch: main
HEAD: b53a97d0
status:
  M .codex/config.toml
  ?? conversa-2026-06-08T15-52-41.md
  ?? src/copilot/ANALISE-FERRAMENTAS-FALTANTES.md
```

**Diagnóstico:** o workspace está sujo. Isso não bloqueia o MCP, mas reduz a confiabilidade de
validações e torna qualquer patch mais arriscado. Antes de mudanças estruturais, convém separar o
que é alteração intencional, artefato temporário e relatório.

**Risco:** médio operacional. Não é risco de segurança, mas é risco de regressão e confusão em
auditorias.

**Ação ideal:** criar uma rotina de sessão MCP que sempre começa com `repo_status`, sumariza diffs
locais, e classifica arquivos não versionados como `source`, `artifact`, `report`, `tmp`,
`secret/protected` ou `unknown`.

---

### 3.2 Versões e dependências principais

Do `package.json`:

- Node exigido: `>=24.0.0`
- npm exigido: `>=11.0.0`
- Volta: Node `24.13.0`, npm `11.14.1`
- Runtime observado pelo doctor: Node `v24.15.0`
- `@modelcontextprotocol/sdk`: `^1.29.0`
- `@github/copilot-sdk`: `^1.0.0`
- `cloudflare`: `^6.3.0`
- `openai`: `^6.42.0`
- `zod`: `^4.4.3`
- `typescript`: `^6.0.3`
- `vitest`: `^4.1.8`

**Diagnóstico:** a base está moderna e coerente com Node 24+. O pacote oficial TypeScript do MCP,
entretanto, já está sinalizando uma transição: o repositório oficial informa que o branch principal
contém o SDK v2 em pré-alpha, enquanto v1.x permanece recomendado para produção até o ciclo estável
do v2. Como o projeto usa `@modelcontextprotocol/sdk ^1.29.0`, a opção atual é conservadora e
adequada.

**Gap:** falta uma política explícita de upgrade para MCP SDK v2 quando estabilizar. Sem isso, há
risco de uma migração reativa e cara.

**Ação ideal:** manter v1.29.x como linha de produção, congelar contratos de tool descriptors e
transports, e criar uma branch/lane experimental para MCP SDK v2 quando ele se tornar estável.

---

### 3.3 Superfície MCP anunciada

Resumo observado:

```text
protocolVersion: workspace-mcp/0.3.0
capabilitiesVersion: 34
advertisedToolCount: 95

read:
  repo_status, repo_tree, repo_read_file, repo_search_text,
  repo_file_outline, repo_symbol_search, repo_patch_plan, ...

index:
  repo_index_status, repo_index_build, repo_index_search,
  repo_index_find_symbol, repo_find_imports, ...

write:
  repo_apply_file_batch, repo_write_file, repo_create_file,
  repo_apply_patch, repo_move_file, repo_quarantine_file,
  repo_restore_quarantined_file, repo_remove_file

validation:
  mcp_run_safe_validation_suite, run_typecheck_copilot,
  run_lint_copilot, run_unit_copilot, mcp_validation_dashboard, ...

runtime / cloudflare / auth:
  mcp_tunnel_status, mcp_cloudflare_remote_audit,
  mcp_cloudflare_edge_audit, mcp_auth_profile,
  mcp_oauth_issuer_diagnostics, ...
```

**Pontos fortes:**

1. A superfície é ampla, mas não “open-world”: nenhum tool foi classificado como `openWorld`.
2. O servidor distingue leitura, plano, escrita bounded, escrita destrutiva e validação.
3. Há workflows de baixa fricção: plan-first, batch, quarantine, validation suite e delegated
   runner.
4. Há controles de tamanho de resultado e validação de descritores.
5. Há auditoria e métricas por tool.

**Gaps:**

1. A contagem de ferramentas é alta. Embora 95 ainda esteja dentro da política interna
   (`DEFAULT_MAX_REGISTERED_TOOLS = 250`), aumenta custo cognitivo para seleção automática.
2. O próprio perfil interno indica que tool-specific schemas são a próxima faixa de hardening. A
   cobertura existe, mas ainda há espaço para schemas semânticos mais fortes.
3. Há risco de over-disclosure de superfície: ferramentas Cloudflare/admin aparecem no mesmo
   servidor do fluxo comum de leitura/escrita.
4. Não há “profiles” por sessão/cliente suficientes para expor superfícies reduzidas: `read-only`,
   `dev`, `max-power`, `cloudflare-admin`, `ci`.

**Recomendação:** preservar o perfil max-power para uso privado, mas implementar perfis de
superfície MCP mais seletivos por audiência/cliente.

---

### 3.4 Autonomia e fricção de aprovação

Estado observado:

```text
Autonomy score: 96 / A
readOnly: 73
boundedWrite: 20
destructive: 2
openWorld: 0
planOnly: 12
```

O host ChatGPT ainda pode pedir confirmação para escrita e operações sensíveis. Isso não é bug do
servidor. É coerente com a especificação MCP e com o Apps SDK.

A especificação MCP recomenda humano no loop para invocações de ferramentas e indica que hosts devem
apresentar confirmações para operações. O Apps SDK, por sua vez, documenta que hints como
`readOnlyHint`, `destructiveHint`, `openWorldHint` e `idempotentHint` influenciam como o ChatGPT
enquadra a chamada, mas o servidor deve continuar impondo sua própria autorização.

**Diagnóstico:** a estratégia atual está correta: não tentar remover confirmações por meios frágeis.
O caminho certo é reduzir quantidade e ambiguidade de confirmações.

**O que já está bom:**

- `repo_patch_plan` antes de `repo_apply_patch`
- `repo_create_file_plan` antes de `repo_create_file`
- `repo_quarantine_file` antes de remoção definitiva
- `repo_apply_file_batch` para reduzir várias confirmações em uma só
- `mcp_run_safe_validation_suite` para agrupar validação
- `delegate_to_repo_autonomy_runner` para missões allowlisted

**Oportunidades:**

- Criar `repo_edit_session_plan`: agrupa leitura, impacto, plano de patch, validação proposta e
  rollback.
- Criar `repo_apply_patch_bundle`: aplica múltiplos patches com hashes esperados em uma confirmação.
- Criar `repo_safe_commit_plan`: não executa git commit, mas gera mensagem, arquivos afetados e
  riscos.
- Criar `approval_friction_report`: mede prompts reais usando os `mcp_golden_prompts`.

---

### 3.5 OAuth

Estado observado:

```text
mode: oauth
enforcement: all
protectedResourceMetadataUrl:
  https://mcp.aurelin.org/.well-known/oauth-protected-resource

resource:
  https://mcp.aurelin.org

authorization_servers:
  https://mcp.aurelin.org

scopes:
  repo:read
  repo:write
  repo:validate
  repo:admin

acceptedAudiences:
  https://mcp.aurelin.org
  https://mcp.aurelin.org/
  https://mcp.aurelin.org/mcp
  https://mcp.aurelin.org/mcp/

jwksUri:
  https://mcp.aurelin.org/oauth/jwks.json

staticBearerConfigured: false
```

Issuer diagnostics:

```text
ready: true
authorization_endpoint: configured
token_endpoint: configured
jwks_uri: configured
userinfo_endpoint: configured
registration_endpoint: configured
client_id_metadata_document_supported: true
resource_parameter_supported: true
authorization_response_iss_parameter_supported: true
token_endpoint_auth_methods_supported: none, private_key_jwt
code_challenge_methods_supported: S256
grant_types_supported: authorization_code, refresh_token
```

**Conformidade:** muito boa. A implementação segue a arquitetura esperada por MCP HTTP com OAuth:
protected resource metadata, authorization server metadata, JWKS, PKCE S256, DCR/CIMD e resource
parameter.

**Gap 1 — built-in issuer vs IdP estabelecido:** a documentação da OpenAI recomenda fortemente usar
um provedor de identidade estabelecido em vez de implementar auth do zero. O issuer embutido é
aceitável para ambiente privado/dev, mas não é a situação ideal para produção multiusuário.

**Gap 2 — lifetime divergente:** o `mcp_auth_profile` mostra templates com access token TTL de
36000s e refresh token TTL de 2592000s, mas o `mcp_oauth_friction_audit` reportou política efetiva
de 3600s e 604800s. Pode ser intencional, mas deve ser documentado como decisão de
segurança/fricção.

**Gap 3 — acúmulo de tokens/clientes:** foram reportados 102 refresh tokens persistidos e 40 dynamic
clients. O armazenamento guarda hashes, o que é bom, mas ainda há necessidade de retenção,
expiração, limpeza e dashboard.

**Gap 4 — escopos max-power por padrão:** max-power
(`repo:read repo:write repo:validate repo:admin`) reduz reauth e aumenta liberdade, mas amplia blast
radius. Para uso pessoal é aceitável; para uso compartilhado, deve haver perfis com escopos menores.

**Situação ideal OAuth:**

- Ambiente pessoal/max-power:
  - manter os quatro scopes por padrão;
  - refresh token rotation persistente;
  - auditoria por tool + escopo;
  - revogação e limpeza automáticas.
- Ambiente compartilhado/prod:
  - IdP externo;
  - CIMD preferido, DCR como fallback;
  - tokens audience-bound;
  - `resource` ecoado no authorization e token request;
  - assinatura JWKS;
  - rejeição por `iss`, `aud/resource`, `exp/nbf`, scopes e replay;
  - mTLS/egress allowlist se aplicável.

---

### 3.6 Cloudflare Tunnel e HTTP/2

Estado observado:

```text
mode: named-permanent
tunnelName: workspace-mcp-dev
zone: aurelin.org
publicHostname: mcp.aurelin.org
publicMcpUrl: https://mcp.aurelin.org/mcp
originUrl: https://127.0.0.1:3333
transportProtocol: http2
originTransport: http2
cloudflareHttp2OriginRequested: true
originServerName: mcp.aurelin.org
```

Remote audit:

```text
remote tunnel status: healthy
connections: 4
colos: gru21, gru13, gru07, gru02
clientVersion: 2026.5.2
remote ingress:
  hostname: mcp.aurelin.org
  service: https://127.0.0.1:3333
  originRequest:
    originServerName: mcp.aurelin.org
    noTLSVerify: false
    http2Origin: true
    disableChunkedEncoding: false
    connectTimeout: 5s
    keepAliveTimeout: 1m30s
    keepAliveConnections: 100
    tcpKeepAlive: 30s
```

**Pontos fortes:**

1. Named permanent tunnel evita a volatilidade do `trycloudflare`.
2. `http2Origin: true` está alinhado ao origin HTTPS.
3. `disableChunkedEncoding: false` preserva streaming/chunking quando aplicável.
4. `connectTimeout: 5s` melhora recuperação quando a origem cai.
5. Há auditoria remota e edge diff.

**Gap 1 — smoke antigo:** o último connector smoke persistido é de 2026-06-01, mais de 11.500
minutos antes do diagnóstico. Isso torna parte do readiness enganosa.

**Gap 2 — readiness pós-restart falso:** `mcp_post_restart_readiness` retornou `ready=false` por
`localHealth.ok=false` com `fetch failed`, embora processos MCP e cloudflared estejam vivos. Isso
indica problema de health endpoint, TLS local, bind, certificado, path, ou rotina de health.

**Gap 3 — temporário stale:** o túnel `trycloudflare` está configurado, mas morto/stale. Como
fallback, está inútil no momento. Como o permanente está pronto, não é crítico.

**Gap 4 — benchmark bloqueado:** a chamada `mcp_cloudflare_transport_benchmark_plan` foi bloqueada
pelo host. Precisa ser classificada com `mcp_host_block_diagnostics` e talvez
renomeada/reestruturada para parecer claramente read-only.

**Situação ideal Cloudflare:**

- Permanent named tunnel como padrão.
- Quick tunnel só como fallback emergencial e com state limpo.
- Smoke remoto fresco, com política de stale < 60 min.
- Post-restart readiness precisa passar local health, remote audit, metrics e OAuth smoke.
- Benchmarks controlados de transporte (`http2`, `quic`, `auto`) devem ser plan-only e read-only.
- Edge rules devem manter MCP como API, não como site/browser.

---

### 3.7 Cloudflare Edge / WAF / Cache / Rate limit

Estado observado:

```text
edgeAuditable: true
inspectedRulesets: 3
hostScopedRules: 3
mcpScopedRules: 2
cacheBypassCandidateCount: 1
blockingMcpRuleCount: 0
hostWideChallengeRuleCount: 0
oauthTokenRateLimitCount: 1
mcpRateLimitCount: 0
sensitiveHeaderTransformCount: 0
```

Rules encontradas:

- `http_config_settings`: passthrough MCP/OAuth
  - `bic: false`
  - `email_obfuscation: false`
  - `response_body_buffering: none`
  - `rocket_loader: false`
- `http_ratelimit`: proteção moderada para `/oauth/token`
- `http_request_cache_settings`: bypass para `/mcp`, `/oauth/`, `/.well-known/`, `/health`

**Pontos fortes:**

1. Não há challenge amplo em `/mcp`.
2. Não há header transform sensível.
3. Há bypass de cache para rotas dinâmicas.
4. Há proteção do token endpoint.
5. Há config rule explícita para neutralizar recursos de browser em rotas MCP/OAuth.

**Gap principal:** não há rate limit explícito para tráfego anônimo em `/mcp`.

O diff desejado recomenda:

```text
Bound anonymous /mcp traffic:
  path: /mcp ou /mcp/*
  condição: sem Authorization
  período: 10s
  limite: 40 requests
  mitigation: 10s
  characteristics: cf.colo.id + ip.src
```

**Diagnóstico:** como sessões autenticadas devem permanecer de alta capacidade, o rate limit deve
mirar apenas tráfego anônimo e não mexer no fluxo ChatGPT/Claude autenticado.

**Gap secundário:** audit de config encontrou BIC, Rocket Loader, RUM e Email Obfuscation ligados em
nível de zona, embora haja regra scoped desativando alguns deles para MCP/OAuth. Bot Fight Mode e
Zaraz não foram determinados. Isso deve permanecer como gap de auditoria, não necessariamente como
bug.

---

### 3.8 Métricas operacionais

Cloudflared metrics:

```text
cloudflared version: 2026.5.2
registerConnectionCount: 4
totalRequests: 50
requestErrors: 0
requestErrorRate: 0
haConnections: 4
rpcClientLatency:
  count: 4
  averageMs: 485
  p50Ms: 450
  p95Ms: 1260
  p99Ms: 1332
```

MCP runtime health:

```text
status: degraded
warnings:
  - Cloudflare connector smoke is 11550 minutes old
  - No in-process mcp_smoke_workspace result has been recorded
informational:
  - Workspace has uncommitted or untracked changes
```

Depois foi executado `mcp_smoke_workspace` e o smoke local MCP retornou `status: degraded`, mas com
todas as checagens técnicas OK e apenas warning de workspace sujo.

**Diagnóstico:** a saúde real parece melhor do que o status agregado inicial, mas a política de
freshness está correta: smoke antigo degrada confiabilidade.

**Ação ideal:** refresh de smoke deve ser gatilho obrigatório após restart, mudança OAuth, mudança
Cloudflare, mudança registry e início de sessão longa.

---

### 3.9 Validações e testes

Dashboard observado:

```text
typecheck: passed
lint: passed
suite-mcp-fast: passed
suite-mcp-full: passed
unit-mcp: failed
unit-copilot: failed
```

Detalhe `unit-mcp`:

```text
tests/unit/copilot/mcp/test_mcp_repo_write.spec.js
1 failed: writes existing files with diff previews
Error: Test timed out in 15000ms
line: 27
```

O teste passa um caminho absoluto dentro de `src/copilot/.ai/jobs/...`, escreve `before\n`, chama
`repo_write_file` com `includeDiffPreview: true`, espera diff com `-before` e `+after`, e verifica
escrita.

**Hipóteses de causa:**

1. `repo_write_file` com diff preview textual e `writeFileAtomic` pode estar esperando lock/IO em
   cenários de teste.
2. O teste usa path absoluto, embora o contrato público diga “workspace-relative path”. Se absoluto
   for suportado por compatibilidade, deve ser documentado; se não for, o teste está errado.
3. Diretório dentro de `.ai/jobs` pode interagir com rotinas de job/log/lock.
4. A geração de diff é O(n) simples e não parece ser a causa para arquivo pequeno.
5. O timeout pode ser intermitente de CI ou contenda com SQLite/auditoria.

**Não dá para cravar raiz sem reproduzir focado.** O relatório deve tratar isso como bug real até
prova em contrário.

Detalhe `unit-copilot`:

Falhas em:

- `tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
- `tests/unit/copilot/model-gateway/test_model_gateway_provider_failure.spec.js`
- `tests/unit/copilot/sdk/test_sdk_consumer_migration_f30.spec.js`
- `tests/unit/copilot/terminal/test_build_user_prompt.spec.js`

Sinais:

- contrato de model-gateway esperando seleção estática, mas runtime venceu;
- taxonomia de falhas BYOK mudou de `model-or-route` para `capability-unsupported`;
- campo `asr` apareceu em metadata;
- há falhas tipo `STACK_TRACE_ERROR` em migração SDK e buildUserPrompt;
- job `unit-copilot` expirou em 120s.

**Diagnóstico:** isso é dívida maior fora do MCP, mas afeta a confiabilidade do workspace como
ambiente de desenvolvimento. O conector MCP está melhor que o restante da suíte.

---

### 3.10 Índice local e navegação

Estado observado:

```text
index enabled: true
files: 1317
freshFiles: 1317
symbols: 9491
imports: 2883
chunks: 2456
bytesIndexed: 13,098,337
autoBuild duration: 2861ms
indexed: 29
skipped: 1274
failed: 0
```

**Ponto forte:** índice local existe, é fresco e acelera buscas. Auto-build está habilitado.

**Gap:** a métrica `indexed: 29` vs `files: 1317` e `skipped: 1274` precisa de semântica mais clara
no relatório. Pode significar “arquivos novos/alterados indexados nesta build” e “inalterados
pulados”, mas para o operador humano parece baixa cobertura.

**Problema real observado:** uma chamada ampla de
`repo_tree path="." recursive=true depth=3 maxEntries=1000` produziu 17,7 MB e foi rejeitada pelo
registry. O limite de resultado é 2 MB. Isso é bom como proteção, mas a ferramenta deveria antecipar
o tamanho e devolver um resumo paginado em vez de rejeitar depois.

**Ações ideais:**

- `repo_tree` deve ter `estimateOnly`, paginação real e limite seguro padrão.
- Criar `repo_tree_summary` com contagem por diretório/extensão sem despejar tudo.
- Criar `repo_context_pack` para montar um pacote de contexto para uma tarefa sem exceder orçamento.

---

### 3.11 Apps SDK / Widgets / Company Knowledge

Readiness observado:

```text
appsSdk.hasWidgetResource: false
cspApplicable: false
hasCsp: false
hasFrameDomains: false
hasWidgetDescription: false
outputTemplate: []
companyKnowledge.searchFetchToolsDetected: false
```

**Diagnóstico:** não é bug para um conector de repositório. É gap de produto se a ambição for
transformar o Workspace MCP em app visual do ChatGPT ou fonte pesquisável de Company Knowledge.

**Oportunidade Apps SDK:**

- Dashboard visual de saúde MCP.
- UI para seleção de planos de patch.
- UI para validação/falhas de teste.
- UI para Cloudflare/OAuth readiness.
- UI para aprovar batches de alteração com diff compacto.

**Oportunidade Company Knowledge:**

- Adicionar ferramentas no shape exato `search`/`fetch` para documentos do workspace.
- Expor relatórios, ADRs, READMEs e decisões arquiteturais como conhecimento pesquisável.
- Separar busca documental de busca de código.

**Cuidado:** ao adicionar widget, CSP passa a ser relevante. Hoje não é fonte de fricção.

---

## 4. Bugs e gaps priorizados

### P0 — Corrigir antes de mudanças maiores

#### P0.1 — Smoke remoto stale

**Evidência:** `connectorSmoke.checkedAt = 2026-06-01T06:31:57.805Z`, `fresh=false`.

**Impacto:** readiness pode parecer melhor do que está. OAuth/Cloudflare podem ter drift não
detectado.

**Correção:**

```bash
npm run copilot:mcp:cloudflare:smoke:refresh
npm run copilot:mcp:oauth:smoke:persistent
```

Depois chamar:

```text
mcp_connector_smoke_refresh
mcp_connection_readiness
mcp_post_restart_readiness
```

#### P0.2 — `mcp_post_restart_readiness` retorna `ready=false`

**Evidência:** processos vivos, mas `localHealth.ok=false` com `fetch failed`.

**Impacto:** qualquer restart fica operacionalmente ambíguo.

**Correção provável:**

- verificar URL local `https://127.0.0.1:3333/mcp` e `/health`;
- checar certificado/SNI local;
- checar se health usa HTTP enquanto origin está HTTPS;
- padronizar health local para tolerar certificado de dev de forma explícita e segura;
- diferenciar `health endpoint failed` de `MCP endpoint failed`.

#### P0.3 — `unit-mcp` falha por timeout em `repo_write_file`

**Evidência:** `test_mcp_repo_write.spec.js`, teste “writes existing files with diff previews”.

**Impacto:** ferramenta de escrita central tem teste vermelho. Mesmo que produção funcione,
confiança cai.

**Correção:**

1. Rodar teste focado.
2. Trocar path absoluto por relativo se o contrato for relativo.
3. Adicionar timeout maior apenas se houver justificativa.
4. Instrumentar `repo_write_file` com fases:
   - resolve path
   - read previous
   - build diff
   - write atomic
   - append audit
   - return
5. Se o gargalo for lock, ajustar lock scope e timeout.
6. Se o problema for audit/SQLite, tornar audit best-effort e não bloqueante no teste.

#### P0.4 — Resultado grande de `repo_tree` é rejeitado depois de custar caro

**Evidência:** tentativa de tree profunda gerou 17.768.603 bytes para limite de 2.097.152 bytes.

**Impacto:** desperdício, fricção e falhas evitáveis.

**Correção:**

- limite padrão mais conservador;
- truncamento por diretório antes de montar JSON gigante;
- paginação/cursor obrigatória;
- `estimateOnly`;
- mensagem sugerindo chamada menor.

---

### P1 — Segurança/produção privada

#### P1.1 — Rate limit anônimo em `/mcp`

**Evidência:** edge diff reporta `anonymous-mcp-rate-limit-missing`.

**Impacto:** tráfego não autenticado pode bater no endpoint MCP sem limite edge específico.

**Correção:**

- Aplicar rate limit apenas para requests sem `Authorization`.
- Não limitar sessões autenticadas ChatGPT/Claude.
- Rodar backup antes:
  - `mcp_cloudflare_edge_snapshot`
  - `mcp_cloudflare_edge_backup_create`
  - `mcp_cloudflare_edge_policy_diff`
  - `mcp_cloudflare_edge_policy_apply dryRun=true`

#### P1.2 — Retenção de OAuth clients/tokens

**Evidência:** 102 refresh tokens, 40 dynamic clients.

**Impacto:** manutenção, auditoria e revogação mais difíceis.

**Correção:**

- política de TTL/retention;
- ferramenta `mcp_oauth_token_store_audit`;
- ferramenta `mcp_oauth_token_store_prune dryRun=true`;
- dashboard com contagem por client, último uso, expiração, hash-only.

#### P1.3 — Auditoria incompleta de Bot Fight Mode/Zaraz

**Evidência:** Cloudflare config audit não conseguiu determinar ambos.

**Impacto:** incerteza sobre recursos de browser/API.

**Correção:** melhorar permissões/queries de API ou documentar limitação por plano/produto.

---

### P2 — Ergonomia e produtividade

#### P2.1 — Perfis de superfície MCP

Criar perfis:

```text
read-only
repo-dev
repo-dev-max
cloudflare-admin
oauth-admin
ci-validation
company-knowledge
```

Cada perfil deve controlar quais tools aparecem em `tools/list`.

#### P2.2 — Tool bundles orientados a tarefa

Adicionar ferramentas de alto nível, sem shell arbitrário:

- `repo_task_context_pack`
- `repo_failure_triage`
- `repo_patch_bundle_plan`
- `repo_patch_bundle_apply`
- `repo_validation_refresh`
- `mcp_readiness_full_report`
- `mcp_cloudflare_safe_rollout_plan`
- `mcp_oauth_store_audit`

#### P2.3 — Apps SDK dashboard

Criar widget opcional com:

- status MCP
- status OAuth
- status Cloudflare
- últimas validações
- bugs P0/P1
- ações recomendadas
- diff/patch preview compacto

Só então CSP passa a ser prioridade.

---

### P3 — Produção robusta / multiusuário

#### P3.1 — IdP externo

Migrar de issuer embutido para IdP estabelecido se o conector deixar de ser pessoal.

Requisitos:

- OAuth 2.1 authorization code + PKCE S256;
- CIMD preferido;
- DCR opcional;
- JWKS;
- audience/resource binding;
- refresh token rotation;
- revogação;
- logs de auditoria.

#### P3.2 — mTLS / allowlist ChatGPT

OpenAI documenta que ChatGPT apresenta certificado de cliente gerenciado em conexões MCP e também
publica egress IP ranges. Para hardening de produção, usar mTLS para autenticar o cliente ChatGPT no
transporte, mantendo OAuth para usuário final.

#### P3.3 — Observabilidade longa

- Cloudflare Logpush/analytics.
- Métricas MCP por tool e por escopo.
- Histograma de duração por tool.
- Erros por causa: host block, auth denied, cloudflare, validation, output too large.
- SLO:
  - readiness fresco < 60 min;
  - `/mcp` p95 < 1.5s para `tools/list`;
  - smoke OAuth diário;
  - zero host-wide challenge em `/mcp`.

---

## 5. Situação ideal proposta

A situação ideal não é “ChatGPT sem pedir nada”. Isso seria incompatível com o espírito do MCP para
operações sensíveis. A situação ideal é:

### 5.1 Para liberdade máxima

- OAuth max-power em ambiente privado.
- Ferramentas bounded-write com aprovação lembrável.
- Batch de alterações em uma chamada.
- Quarentena em vez de delete.
- Plan-first para toda escrita.
- Runner local allowlisted para missões longas.
- Índice local sempre fresco.
- Resultado compacto por padrão.
- Validação agrupada em suite única.
- Perfis de superfície para reduzir ruído.

### 5.2 Para segurança

- Nenhum shell arbitrário.
- Nenhum path arbitrário fora do workspace.
- Protected paths bloqueados.
- Secrets redigidos.
- OAuth obrigatório em todo endpoint.
- Escopos por risco.
- JWT verificado por issuer, audience/resource, exp/nbf, assinatura e scopes.
- `WWW-Authenticate` correto em 401.
- Cloudflare sem challenge interativo em `/mcp`.
- Rate limit anônimo.
- Token endpoint protegido.
- Auditoria append-only de tool calls.
- Destructive tools raras e nunca aprovadas “lembradas”.

### 5.3 Para performance

- HTTP/2 no tunnel e na origem quando TLS estiver correto.
- `disableChunkedEncoding=false`.
- `connectTimeout=5s`.
- keepalive padrão explícito.
- cache bypass em rotas dinâmicas.
- cache curto apenas em discovery metadata GET-only.
- compressão testada por benchmark, não por intuição.
- `repo_tree` e logs sempre paginados.
- diffs textuais suprimidos por padrão.
- `structuredContent` compacto.
- índice local incremental.

### 5.4 Para utilidade

- Ferramentas de leitura, edição, validação, Cloudflare, OAuth e diagnóstico.
- Dashboard Apps SDK opcional.
- Company Knowledge search/fetch opcional.
- Relatórios markdown gerados no workspace.
- Golden prompts para medir fricção real.
- Roadmap embutido no próprio MCP via `mcp_readiness_full_report`.

---

## 6. Roadmap completo

### Fase 0 — Estabilização imediata

**Objetivo:** fazer o estado reportado voltar a “green”.

1. Classificar alterações locais.
2. Atualizar smoke:
   - `mcp_connector_smoke_refresh`
   - `mcp_connection_readiness`
   - `mcp_post_restart_readiness`
3. Corrigir health local.
4. Reproduzir `unit-mcp` focado.
5. Corrigir timeout de `repo_write_file`.
6. Rodar `mcp_run_safe_validation_suite suite=mcp-full`.
7. Registrar resultado em relatório.

**Critério de aceite:**

- `mcp_runtime_health.status = ok`
- `mcp_post_restart_readiness.ready = true`
- `unit-mcp` passa
- `typecheck` e `lint` passam
- smoke remoto fresco

---

### Fase 1 — Hardening do conector privado

**Objetivo:** reduzir riscos sem reduzir autonomia pessoal.

1. Aplicar rate limit anônimo `/mcp`.
2. Adicionar auditoria/limpeza de OAuth tokens.
3. Documentar lifetime efetivo vs template.
4. Criar `repo_tree_summary`.
5. Criar `repo_task_context_pack`.
6. Melhorar erros de tool result grande.
7. Classificar host block do benchmark Cloudflare.
8. Adicionar política de freshness obrigatória.

**Critério de aceite:**

- edge diff sem advisory crítico;
- tokens antigos auditáveis;
- tree profunda não explode resultado;
- benchmark plan não bloqueia host ou tem substituto;
- smoke freshness aparece no dashboard.

---

### Fase 2 — Ergonomia de desenvolvimento

**Objetivo:** transformar o MCP em ambiente de trabalho mais fluido.

1. Criar profiles:
   - `read-only`
   - `repo-dev`
   - `repo-dev-max`
   - `cloudflare-admin`
   - `oauth-admin`
2. Criar patch bundles.
3. Criar failure triage automático.
4. Criar validation refresh tool.
5. Criar relatório MCP completo como tool.
6. Integrar resultados de testes com links/linhas.
7. Melhorar descrições de ferramentas com linguagem compacta e componentes padronizados.

**Critério de aceite:**

- menos ferramentas por sessão comum;
- menos prompts redundantes;
- falha de teste gera plano de correção automaticamente;
- patch multi-file acontece com uma confirmação.

---

### Fase 3 — Apps SDK / UI

**Objetivo:** criar uma camada visual para decisões humanas.

1. Registrar resource widget.
2. Definir CSP:
   - `connectDomains`
   - `resourceDomains`
   - `frameDomains` se necessário
3. Criar dashboard:
   - saúde MCP
   - Cloudflare
   - OAuth
   - validação
   - patches planejados
4. Expor tool output template para flows de diff/validação.
5. Testar aprovação de tools com widget.

**Critério de aceite:**

- Apps SDK readiness detecta widget/CSP.
- UI não vaza `_meta` ao modelo.
- approval-gated tool input chega após aprovação.
- Dashboard melhora decisão, sem aumentar ruído.

---

### Fase 4 — Company Knowledge / documentação pesquisável

**Objetivo:** separar conhecimento documental de navegação de código.

1. Criar tools de shape `search` e `fetch`.
2. Indexar:
   - ADRs
   - relatórios
   - READMEs
   - guias operacionais
   - changelogs
3. Não misturar secrets nem `.ai` sensível.
4. Criar política de atualização.

**Critério de aceite:**

- Company Knowledge readiness detecta search/fetch.
- Busca documental não depende de `repo_search_text`.
- Resultados têm citações/trechos compactos.

---

### Fase 5 — Produção multiusuário

**Objetivo:** tornar o conector seguro fora do ambiente pessoal.

1. IdP externo.
2. mTLS/egress allowlist.
3. Escopos por papel.
4. Logs e SLO.
5. Backups Cloudflare obrigatórios.
6. Rollback automatizado.
7. Testes e2e com ChatGPT/Claude.
8. Auditoria de tool poisoning e prompt injection em descritores.

**Critério de aceite:**

- cada usuário tem identidade e scopes próprios;
- revogação funciona;
- nenhum admin tool aparece para perfil comum;
- logs permitem investigação;
- produção não depende de issuer dev.

---

## 7. Comandos e chamadas recomendadas

### Rotina de início de sessão

```text
repo_status
mcp_tools_status
mcp_capabilities_summary
mcp_runtime_health
mcp_connection_readiness
mcp_validation_dashboard
```

### Após restart ou mudança Cloudflare/OAuth

```text
mcp_post_restart_readiness
mcp_connector_smoke_refresh
mcp_cloudflare_remote_audit
mcp_cloudflare_metrics_snapshot
mcp_oauth_issuer_diagnostics
mcp_oauth_friction_audit
```

### Validação compacta

```text
mcp_validation_plan suite=mcp-full
mcp_run_safe_validation_suite suite=mcp-full
mcp_validation_dashboard
job_get_summary <jobId>
job_get_output <jobId> tailBytes<=8000 somente se falhar
```

### Escrita segura

```text
repo_patch_plan
repo_apply_patch expectedHash=<sha256>
```

ou

```text
repo_apply_file_batch_plan
repo_apply_file_batch dryRun=false confirmBatch=true
```

### Remoção segura

```text
repo_quarantine_file_plan
repo_quarantine_file
repo_restore_quarantined_file se necessário
```

---

## 8. Decisões arquiteturais recomendadas

### ADR-001 — Manter MCP SDK v1.x até estabilização do v2

**Decisão:** manter `@modelcontextprotocol/sdk ^1.29.0` como linha operacional.

**Motivo:** o repositório oficial indica v2 em desenvolvimento/pre-alpha, enquanto v1.x segue
recomendado para produção.

### ADR-002 — Max-power só para ambiente pessoal

**Decisão:** manter scopes max-power para uso privado, mas criar perfis de menor privilégio.

**Motivo:** reduz fricção para operador único, mas evita blast radius em multiusuário.

### ADR-003 — Cloudflare como API passthrough, não website

**Decisão:** `/mcp`, `/oauth`, `/.well-known` e `/health` devem ter regras scoped de API.

**Motivo:** recursos de browser, challenge interativo, transforms e caching agressivo são
incompatíveis com MCP/OAuth.

### ADR-004 — Human-in-loop por design

**Decisão:** não tentar contornar confirmações do host. Otimizar por ferramentas estreitas,
reversíveis e agrupadas.

**Motivo:** MCP e Apps SDK modelam consentimento e confirmação como parte da segurança.

### ADR-005 — Widgets só quando houver valor decisório

**Decisão:** não priorizar CSP/widget até haver dashboard útil.

**Motivo:** readiness atual mostra que CSP não é fonte de fricção. Widget mal feito aumenta
superfície sem ganho.

---

## 9. Backlog de ferramentas novas

### Alta prioridade

- `repo_tree_summary`
- `repo_task_context_pack`
- `repo_patch_bundle_plan`
- `repo_patch_bundle_apply`
- `repo_validation_refresh`
- `mcp_readiness_full_report`
- `mcp_oauth_token_store_audit`
- `mcp_oauth_token_store_prune`
- `mcp_connector_smoke_freshness_gate`

### Média prioridade

- `repo_failure_triage`
- `repo_test_focus_plan`
- `repo_safe_commit_plan`
- `mcp_cloudflare_host_block_triage`
- `mcp_cloudflare_transport_benchmark_readonly`
- `mcp_tool_description_quality_audit`
- `mcp_tool_payload_budget_audit`

### Baixa prioridade / produto

- Apps SDK dashboard widget
- Company Knowledge `search`/`fetch`
- UI de diff/patch
- UI de OAuth token store
- UI de Cloudflare edge plan

---

## 10. Conclusão

O Workspace MCP está muito próximo de uma arquitetura ideal para desenvolvimento pessoal assistido
por ChatGPT: seguro, auditável, rápido, rico em ferramentas e com boa separação entre leitura,
plano, escrita e validação. O maior ganho agora não vem de adicionar mais poder bruto; vem de
**estabilizar readiness**, **corrigir validações**, **reduzir resultados grandes**, **criar
perfis**, **limpar OAuth state**, **fechar gaps Cloudflare edge** e **consolidar utilidades
orientadas a tarefa**.

A prioridade deve ser:

1. deixar health/smoke/validação verdes;
2. corrigir o timeout de escrita;
3. aplicar rate limit anônimo `/mcp`;
4. criar ferramentas compactas de contexto e patch bundle;
5. só depois investir em Apps SDK widget e Company Knowledge.

Com isso, o conector deixa de ser apenas “um MCP poderoso” e vira uma estação de trabalho agentic
madura: liberdade máxima para o operador, mas com limites formais, reversibilidade, auditoria e
performance previsível.
