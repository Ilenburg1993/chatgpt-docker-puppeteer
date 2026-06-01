# Roadmap Canônico Cloudflare Edge para MCP remoto

Documento original: 2026-05-24
Atualização canônica: 2026-05-30
Escopo: Cloudflare, Tunnel, domínio permanente `mcp.aurelin.org`, edge rules, OAuth, observabilidade e compatibilidade com MCP remoto do repo.

Este arquivo começou como um pré-plano. Em 2026-05-29 ele foi relido integralmente e promovido para roadmap canônico atualizado, incorporando:

1. O estado real atual do workspace e das tools MCP Cloudflare.
2. A aplicação já realizada de cache bypass para rotas MCP/OAuth.
3. A investigação recente da documentação oficial Cloudflare.
4. Requisitos de protocolo MCP Streamable HTTP.
5. Requisitos OpenAI Apps SDK para autenticação OAuth em MCP.
6. Um roadmap de implementação incremental, seguro e auditável.

## 0. Auditoria profunda de 2026-05-30 — baseline real, bugs e gaps

Esta auditoria foi executada a partir do workspace/connector, comparando o roadmap com o estado real do repo, registry MCP, Cloudflare Tunnel, Cloudflare Edge, métricas `cloudflared`, DevContainer/network e validação local.

### 0.1. Baseline operacional confirmado

1. Workspace em branch `main`, HEAD `80dee97d`, com mudanças locais não commitadas e novos arquivos MCP/Cloudflare ainda não versionados.
2. MCP remoto permanente está operacional em `https://mcp.aurelin.org/mcp`, modo `named-permanent`, túnel `workspace-mcp-dev`, origin `http://127.0.0.1:3333` e transporte `http2`.
3. Smoke remoto renovado em 2026-05-30 confirmou OAuth OK, health 200, 94/94 tools remotas, registry remoto igual ao local e critical tools presentes.
4. Quick Tunnel antigo continua salvo como fallback histórico, mas está morto/stale e é ignorado para readiness operacional do modo permanente.
5. Registry/capabilities MCP atuais anunciam 94 tools e `CAPABILITIES_VERSION=34`.
6. `suite-mcp-full` passou após as correções desta auditoria no job `2344c8c4-56ca-481d-bc5a-a242e648b8c7`.

### 0.2. Baseline real Cloudflare Edge

1. `http_request_cache_settings`: regra `copilot-mcp-cache-bypass-v1` ativa para `/mcp`, `/oauth/*`, `/.well-known/*` e `/health`, com `cache=false`.
2. `http_config_settings`: regra `copilot-mcp-passthrough-config-v1` ativa, com `bic=false`, `rocket_loader=false`, `email_obfuscation=false` e `response_body_buffering=none` nas rotas MCP/OAuth/health.
3. `http_ratelimit`: regra `copilot-mcp-oauth-token-rate-limit-v1` ativa para `/oauth/token`.
4. Nenhuma regra WAF/challenge/block ampla foi detectada para `/mcp`.
5. Nenhuma transform rule sensível foi detectada para headers MCP/OAuth/CORS.
6. Pendência real restante na edge: não existe rate limit explícito para `/mcp` anônimo; o dry-run agora planeja exatamente uma ação `append-rule` com `ruleRef=copilot-mcp-anonymous-rate-limit-v1`, expressão compatível com Ruleset Engine e janela `40/10s`, mas a mutação real continua bloqueada operacionalmente até confirmar quota/plano ou redesenhar uma regra combinada.

### 0.3. Config/Product posture real

1. Zone-wide `Browser Integrity Check` continua `on`, mas a regra scoped `copilot-mcp-passthrough-config-v1` desliga `bic` para rotas MCP/OAuth.
2. Zone-wide `Rocket Loader`, `RUM` e `Email Obfuscation` continuam `on`; a regra scoped desliga `rocket_loader` e `email_obfuscation`, mas `RUM` permanece warning/audit gap porque não foi confirmado como campo aplicável na `http_config_settings` atual.
3. `Polish` e `Hotlink Protection` estão `off`.
4. `bot_fight_mode` e `zaraz` não puderam ser lidos pela API atual e permanecem permission/capability gaps.
5. `request_body_buffering` segue não alterado, conforme decisão canônica de manter request body em modo padrão inicialmente.

### 0.4. Tunnel, originRequest e performance baseline

1. Cloudflare remoto reporta túnel saudável, 4 conexões HA em colos GRU e `cloudflared` 2026.5.0.
2. Config remoto do túnel aponta `mcp.aurelin.org` para `http://127.0.0.1:3333` e mantém catch-all `http_status:404`.
3. `originRequest` remoto está totalmente unset/null; isso é seguro por default, mas ainda não aplica o perfil de otimização desejado.
4. Perfil originRequest desejado permanece read-only por enquanto: `http2Origin=false`, `disableChunkedEncoding=false`, `connectTimeout=5s`, `keepAliveTimeout=1m30s`, `keepAliveConnections=100`, `tcpKeepAlive=30s`, sem Cloudflare Access extra.
5. Métricas locais `cloudflared` estão disponíveis em `127.0.0.1:60123/metrics`, com `requestErrorRate=0`, `haConnections=4`, `registerSuccess=4` e baseline `rpcClientLatency` aproximado: média 465 ms, p50 450 ms, p95 1260 ms, p99 1332 ms.
6. Experimento `auto`/QUIC permanece futuro: `http2` atual é o controle estável; `auto` é o primeiro candidato; `quic` só depois de evidência de UDP saudável.

### 0.5. DevContainer/network baseline

1. DNS cache local está efetivo e `/etc/resolv.conf` aponta para `127.0.0.1` sem drift.
2. `dnsmasq` está rodando e gerenciado, mas há warning de porta DNS `in-use`.
3. Docker embedded DNS split está desabilitado e o warmup DNS teve 1 falha.
4. Esses warnings não bloqueiam o MCP permanente agora, mas devem ser resolvidos/medidos antes de qualquer experimento de transporte ou tuning agressivo de latência.

### 0.6. Bugs corrigidos nesta auditoria

1. `src/copilot/mcp/cloudflare/remote-api.js` quebrava `typecheck` por conflito de import/local declaration de `auditOriginRequestProfile`; corrigido usando alias `auditOriginRequestProfileBase` e chamada compatível com a assinatura real.
2. `src/copilot/mcp/cloudflare/edge-policy-plan.js` estava stale: ainda documentava rate limits `120/min` e `240/min` como `period=60`/`mitigation=60`, embora a conta Cloudflare tenha exigido `period=10` e `mitigation_timeout=10`.
3. O mesmo plano usava expressão inválida/recusada para MCP anônimo: `not exists http.request.headers["authorization"][0]`. Foi corrigido para `not any(http.request.headers.names[*] eq "authorization")`, alinhado ao apply dry-run atual.
4. `tests/unit/copilot/mcp/test_cloudflare_edge_policy_plan.spec.js` foi atualizado para travar a nova expressão e a janela `40/10s`.

### 0.7. Bugs/gaps restantes no código MCP/Cloudflare

1. `mcp_cloudflare_skip_audit` foi corrigido localmente em 2026-05-30 para separar `skipRules` reais (`action=skip`) de `relatedDynamicRules`, reduzindo falso positivo causado por regras `set_config`/`block` dynamic-MCP-scoped. O MCP remoto precisa de restart/publicação antes de refletir essa saída.
2. `mcp_cloudflare_plan_capabilities_audit` foi corrigido localmente em 2026-05-30 para reportar `individualRuleRefApply=implemented-and-verified` e tratar a capacidade de rate-limit como possível limite/plano quando já existe `/oauth/token` mas ainda não existe `/mcp`. O MCP remoto precisa de restart/publicação antes de refletir essa saída.
3. CLI/Make ainda não expõem todas as tools MCP novas. Existem tools MCP para plan capabilities, post-change gates, transport benchmark, devcontainer network posture e passthrough apply, mas `package.json`/`Makefile` ainda não têm comandos equivalentes para todas elas.
4. Não há restore/rollback automation (`restore_plan`/`restore_apply`) baseada em snapshot; backups existem, mas restauração segura ainda é manual.
5. Não há integração Cloudflare Trace/Security Events/Ray ID para explicar bloqueios reais de edge.
6. Não há apply tool para `originRequest` remoto; o perfil desejado é auditado, mas ainda não pode ser aplicado/rollbackado de forma guardada.
7. Anonymous `/mcp` rate limit está dry-run ready no código local, mas a aplicação real deve esperar confirmação de quota/plano ou uma regra combinada Free-plan-aware.
8. O MCP em execução ainda expõe `mcp_cloudflare_edge_policy_plan` antigo até restart/publicação; a correção local passou em `suite-mcp-full`, mas precisa ser publicada no processo remoto antes de usar a tool pública como fonte de verdade para o plano.

### 0.8. Investigação oficial sobre camada de segurança do host/conector

A camada de segurança/aprovação do host não é controlável pelo MCP server. O servidor pode reduzir atrito com metadata correta (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), schemas menores, tools guardadas e workflows allowlisted, mas não deve tentar desativar ou contornar a política do host. Em ambientes Codex/CLI existem modos de sandbox e aprovação configuráveis no cliente, porém isso é configuração externa do host/ambiente, não uma capability que o conector MCP possa desligar de dentro.

Decisão canônica: otimizar para menor fricção legítima. Toda mutação Cloudflare deve continuar passando por plano, backup, diff, confirmação explícita e gates; leituras/auditorias devem ser `readOnly`; batches seguros devem agregar operações repetitivas para reduzir prompts sem remover proteção.

### 0.9. OpenAI Secure MCP Tunnel — avaliação oficial

A documentação oficial de OpenAI Secure MCP Tunnel transforma a decisão de transporte: ele é uma alternativa ou faixa paralela ao ingress público por Cloudflare, não um controle de segurança que o MCP server possa desligar. O modelo oficial é outbound-only: o `tunnel-client` roda dentro da trust boundary do operador, conecta por HTTPS à OpenAI e encaminha requisições MCP para um servidor local HTTP ou stdio.

Implicações para este repo: Cloudflare permanente continua como caminho atual/fallback; Secure MCP Tunnel deve entrar como staging paralelo; `http://127.0.0.1:3333/mcp` é compatível como origin local; OAuth discovery pode trafegar pelo túnel, mas authorization server e callbacks continuam exigindo auditoria própria; são necessários `tunnel_id`, credencial runtime com Tunnels Read + Use e binário `tunnel-client`.

Primeiro artefato local criado nesta faixa: `mcp_openai_secure_tunnel_readiness`, tool read-only para auditar pré-requisitos locais sem criar túnel, chamar APIs externas ou retornar segredos. Após publicação/restart, `CAPABILITIES_VERSION` local passa para 35 e a registry deverá anunciar a nova tool; até lá, o MCP remoto pode seguir anunciando 94 tools/capabilitiesVersion 34.

### 0.9. OpenAI Secure MCP Tunnel — avaliação oficial

A documentação oficial de OpenAI Secure MCP Tunnel transforma a decisão de transporte: ele é uma alternativa ou faixa paralela ao ingress público por Cloudflare, não um controle de segurança que o MCP server possa desligar. O modelo oficial é outbound-only: o `tunnel-client` roda dentro da trust boundary do operador, conecta por HTTPS à OpenAI e encaminha requisições MCP para um servidor local HTTP ou stdio.

Implicações para este repo: Cloudflare permanente continua como caminho atual/fallback; Secure MCP Tunnel deve entrar como staging paralelo; `http://127.0.0.1:3333/mcp` é compatível como origin local; OAuth discovery pode trafegar pelo túnel, mas authorization server e callbacks continuam exigindo auditoria própria; são necessários `tunnel_id`, credencial runtime com Tunnels Read + Use e binário `tunnel-client`.

Primeiro artefato local criado nesta faixa: `mcp_openai_secure_tunnel_readiness`, tool read-only para auditar pré-requisitos locais sem criar túnel, chamar APIs externas ou retornar segredos. Após publicação/restart, `CAPABILITIES_VERSION` local passa para 35 e a registry deverá anunciar a nova tool; até lá, o MCP remoto pode seguir anunciando 94 tools/capabilitiesVersion 34.

## 1. Sumário executivo

O MCP do repo está operando em regime permanente por Cloudflare Tunnel:

1. Hostname público canônico: `https://mcp.aurelin.org/mcp`.
2. Tunnel remoto: `workspace-mcp-dev`.
3. Origin local canônico: `http://127.0.0.1:3333`.
4. Transporte do MCP: Streamable HTTP com OAuth.
5. Métricas locais do `cloudflared`: `127.0.0.1:60123`.
6. Fallback temporário: Cloudflare Quick Tunnel, apenas emergencial.

A meta agora não é apenas manter o túnel vivo. A meta é uma policy Cloudflare Edge MCP-native:

1. Máxima liberdade e desempenho para clientes MCP autenticados.
2. Nenhuma interferência de navegador, challenge, cache, rewrite ou buffering indevido.
3. Proteção seletiva contra abuso anônimo e brute force de OAuth.
4. Observabilidade suficiente para explicar falhas sem adivinhação.
5. Mutação de Cloudflare somente com backup, diff, smoke e rollback planejado.

Estado operacional atual em 2026-05-30:

1. Túnel permanente saudável.
2. DNS do hostname permanente aponta para o túnel esperado.
3. OAuth, health e lista de tools estão operacionais no endpoint permanente.
4. Edge real já contém cache bypass, MCP passthrough config e rate limit de `/oauth/token`.
5. Edge audit detecta 3 regras host-scoped relevantes: cache bypass, config passthrough e `/oauth/token` rate limit.
6. Policy diff real mantém apenas 1 advisory pendente: rate limit explícito para `/mcp` anônimo.
7. Backups locais de edge snapshot existem antes das mutações reais.
8. `mcp_connector_smoke_refresh` agora retorna JSON válido e smoke remoto com 94/94 tools; o bug `ERR_CONNECTOR_SMOKE_INVALID_JSON` fica apenas como histórico corrigido.
9. O código local do plano Cloudflare foi corrigido, mas o MCP em execução ainda expõe `mcp_cloudflare_edge_policy_plan` antigo até restart/publicação.

Decisão principal desta revisão:

> Não tratar `mcp.aurelin.org` como site comum. Tratar como API MCP remota com OAuth, JSON-RPC, possíveis streams SSE, headers de sessão e clientes não-browser.

## 2. Delta em relação ao pré-plano de 2026-05-24

O pré-plano original estava correto ao identificar que o risco principal não era apenas conectividade de túnel, mas interferência da edge Cloudflare no protocolo MCP/OAuth.

O que mudou desde então:

1. A lacuna de token DNS/Zone foi resolvida para auditoria atual.
2. `mcp_cloudflare_edge_audit` existe e audita a zona.
3. `mcp_cloudflare_edge_policy_plan` existe.
4. `mcp_cloudflare_edge_policy_diff` existe.
5. `mcp_cloudflare_edge_snapshot` existe.
6. `mcp_cloudflare_edge_backup_create` e `mcp_cloudflare_edge_backups_list` existem.
7. `mcp_cloudflare_edge_policy_apply` existe e já foi usado de forma limitada para aplicar cache bypass.
8. O cache bypass deixou de ser plano e virou estado real aplicado.
9. A pendência principal deixou de ser “não temos visibilidade de edge” e passou a ser “precisamos ampliar a política MCP-native e a granularidade das tools”.

O que continua válido do pré-plano:

1. Cloudflare deve proteger sem se comportar como uma página web interativa na frente de ChatGPT/Claude.
2. A edge deve preservar OAuth, discovery, CORS, headers sensíveis e streaming.
3. Mutação automática de Cloudflare deve ser posterior à auditoria read-only.
4. Quick Tunnel deve continuar apenas como fallback.
5. O MCP oficial da Cloudflare é acelerador opcional, não dependência do runtime do nosso MCP.

## 3. Fontes oficiais consultadas nesta revisão

### 3.1. Cloudflare Cache — default behavior

URL: `https://developers.cloudflare.com/cache/concepts/default-cache-behavior/`

Pontos relevantes:

1. Cloudflare não cacheia recurso quando `Cache-Control` é `private`, `no-store`, `no-cache` ou `max-age=0`.
2. Cloudflare não cacheia quando existe `Set-Cookie`.
3. Cloudflare não cacheia quando o método HTTP não é `GET`.
4. Cloudflare pode cachear por status code quando não há `Cache-Control`/`Expires`.
5. Cloudflare cacheia por extensão, não por MIME type; HTML e JSON não são cacheados por padrão.
6. Ainda assim, cache bypass explícito é correto para MCP porque evita regressões futuras quando regras de cache mudarem.

### 3.2. Cloudflare Cache Rules — available settings

URL: `https://developers.cloudflare.com/cache/how-to/cache-rules/settings/`

Pontos relevantes:

1. Cache Rules permitem expressões por host, path, headers, query etc.
2. `Bypass cache` torna requests correspondentes inelegíveis para cache.
3. O header de resposta pode aparecer como `DYNAMIC`, sem dizer explicitamente “bypass”; isso é esperado.
4. Cache Rules podem alterar Edge TTL/Browser TTL, mas isso não deve ser usado para rotas MCP/OAuth.

### 3.3. Cloudflare Browser Integrity Check

URL: `https://developers.cloudflare.com/waf/tools/browser-integrity-check/`

Pontos relevantes:

1. Browser Integrity Check procura headers HTTP comumente abusados.
2. Ele pode desafiar visitantes sem user-agent ou com user-agent não padrão.
3. Ele é habilitado por padrão.
4. Pode ser desativado globalmente, por skip rule ou por configuration rule.
5. Para MCP, BIC é arriscado porque clientes MCP não são necessariamente browsers convencionais.

### 3.4. Cloudflare Configuration Rules settings

URL: `https://developers.cloudflare.com/rules/configuration-rules/settings/`

Pontos relevantes:

1. Configuration Rules podem alterar `bic`, RUM, Zaraz, Email Obfuscation, Polish, Rocket Loader, SSL, buffering e outras configurações por expressão.
2. `request_body_buffering` aceita `standard`, `full` e `none`.
3. `request_body_buffering=standard` é o default e permite inspeção parcial quando necessário.
4. `request_body_buffering=none` envia body direto para a origem, mas pode reduzir efetividade do WAF.
5. `response_body_buffering` aceita `standard` e `none`.
6. `response_body_buffering=none` transmite resposta diretamente ao cliente sem inspeção de body, útil para streaming, mas pode reduzir inspeção de resposta.
7. Rocket Loader, Polish, Email Obfuscation, RUM e Zaraz são recursos de site/browser e devem ser auditados/desligados para endpoints MCP quando aplicável.

### 3.5. Cloudflare WAF Skip options

URL: `https://developers.cloudflare.com/waf/custom-rules/skip/options/`

Pontos relevantes:

1. Skip rules em nível de conta não pulam regras de nível de zona; para pular rules de zona, a skip rule também precisa estar na zona.
2. É possível pular fases: `http_ratelimit`, `http_request_sbfm`, `http_request_firewall_managed`.
3. Não é possível pular Bot Fight Mode comum; apenas Super Bot Fight Mode.
4. Produtos fora do Ruleset Engine, como Browser Integrity Check e Security Level, precisam ser pulados por `products`, não por `phases`.
5. Produtos puláveis incluem `bic`, `securityLevel`, `uaBlock`, `zoneLockdown`, `hot`, `rateLimit` legado e `waf` legado.
6. O default de logging para skip custom rule é habilitado quando não especificado.

### 3.6. Cloudflare Rate Limiting Rules

URL: `https://developers.cloudflare.com/waf/rate-limiting-rules/`

Pontos relevantes:

1. Rate limiting rules têm expressão, ação, características de contagem, período, requests por período e mitigation timeout.
2. Ações como Block param avaliação posterior de regras.
3. Rate limiting não garante número exato de requests que chegam à origem; pode haver atraso de alguns segundos por contadores distribuídos.
4. Disponibilidade de campos, características de contagem e número de regras varia por plano Cloudflare.
5. Para MCP, rate limiting deve ser seletivo e conservador.

### 3.7. Cloudflare Transform Rules

URL: `https://developers.cloudflare.com/rules/transform/`

Pontos relevantes:

1. Transform Rules podem ajustar URI path, query string e headers HTTP de requests e responses.
2. Request Header Transform Rules podem setar ou remover headers de request.
3. Response Header Transform Rules podem setar ou remover headers de response.
4. Managed Transforms rodam antes de transform rules customizadas de headers.
5. Regras posteriores podem sobrescrever alterações anteriores.
6. Cloudflare alerta que challenges combinados com Rules podem causar loops.
7. Para MCP, transforms sobre headers sensíveis são risco crítico.

### 3.8. Cloudflare Tunnel run parameters

URL: `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/`

Pontos relevantes:

1. `cloudflared` suporta protocolos `auto`, `http2` e `quic`.
2. O default oficial é `auto`.
3. `auto` tenta QUIC e cai para HTTP/2 quando UDP não está disponível.
4. Post-quantum key agreements não são suportados com `http2`.
5. O nosso `http2` atual é conservador e estável, mas um experimento controlado com `auto`/`quic` pode melhorar desempenho ou propriedades criptográficas quando a rede permitir.

### 3.9. Cloudflare Error 524

URL: `https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/`

Pontos relevantes:

1. 524 ocorre quando Cloudflare conectou à origem, mas a origem não respondeu antes do Proxy Read Timeout default de 120 segundos.
2. Também pode ocorrer por timeout de escrita para a origem.
3. Para processos longos, Cloudflare recomenda polling/status assíncrono ou outra arquitetura.
4. Enterprise pode aumentar timeout, mas isso não deve ser o primeiro remédio para MCP do repo.
5. Para tools longas, o servidor MCP deve emitir resposta/stream/heartbeat ou delegar para job assíncrono.

### 3.10. MCP Streamable HTTP

URL: `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`

Pontos relevantes:

1. MCP usa JSON-RPC.
2. Streamable HTTP usa um endpoint único que suporta `POST` e `GET`, por exemplo `/mcp`.
3. Cada mensagem JSON-RPC do cliente deve ser um novo HTTP POST para o endpoint MCP.
4. O cliente deve enviar `Accept` com `application/json` e `text/event-stream`.
5. O servidor pode responder com `application/json` ou iniciar `text/event-stream`.
6. O cliente pode fazer GET para abrir SSE, se o servidor suportar.
7. O servidor pode usar `Mcp-Session-Id` para sessões.
8. O cliente deve enviar `MCP-Protocol-Version` em requests subsequentes.
9. O servidor deve validar `Origin`, bindar localmente em `127.0.0.1` quando local e implementar autenticação.

### 3.11. OpenAI Apps SDK — MCP auth

URL: `https://developers.openai.com/apps-sdk/build/auth`

Pontos relevantes:

1. O servidor MCP é o resource server e deve verificar tokens em cada request.
2. ChatGPT espera protected resource metadata em `/.well-known/oauth-protected-resource` ou em `WWW-Authenticate` de `401`.
3. O fluxo usa authorization code + PKCE.
4. ChatGPT envia `Authorization: Bearer <token>` em requests MCP após OAuth.
5. O servidor deve validar assinatura, issuer, audience/resource, expiração e escopos.
6. Se a verificação falhar, o servidor deve retornar `401` com `WWW-Authenticate` apontando para metadata.
7. Portanto Cloudflare não deve remover/reescrever `Authorization` nem `WWW-Authenticate`.

## 4. Modelo mental correto para Cloudflare em MCP

MCP remoto não é site estático, SPA, landing page, painel administrativo ou API REST pública convencional. Ele é uma superfície de protocolo:

1. JSON-RPC sobre HTTP.
2. POST frequente.
3. GET opcional para SSE.
4. Respostas possivelmente longas e streamadas.
5. OAuth discovery e token exchange.
6. Headers de sessão e versão de protocolo.
7. Clientes não-browser.
8. Tool calls que podem acionar validações, indexação e tarefas longas.

Logo, a edge ideal deve ser “API passthrough autenticado com proteção seletiva”, não “website security defaults”.

Princípio central:

> Clientes autenticados devem ter o caminho mais livre possível. Tráfego anônimo e endpoints de token devem receber controles conservadores. Qualquer controle interativo de browser deve ficar fora do caminho MCP.

## 5. Contrato canônico da edge para MCP

Para `https://mcp.aurelin.org/mcp`:

1. Permitir `POST` sem cache.
2. Permitir `GET` quando usado para SSE ou compatibilidade, sem cache.
3. Permitir `OPTIONS`/CORS quando o servidor responder.
4. Preservar `Accept: application/json, text/event-stream`.
5. Preservar `Content-Type: application/json` e `Content-Type: text/event-stream`.
6. Preservar streaming; não bufferizar resposta MCP de modo que quebre SSE.
7. Preservar headers MCP:
   - `Mcp-Session-Id`;
   - `MCP-Protocol-Version`;
   - `Last-Event-ID`.
8. Preservar headers OAuth/auth:
   - `Authorization`;
   - `WWW-Authenticate`;
   - `Set-Cookie`;
   - `Location`;
   - `Cache-Control`;
   - `Access-Control-Allow-Origin`;
   - `Access-Control-Allow-Headers`;
   - `Access-Control-Allow-Methods`.
9. Não apresentar challenge interativo.
10. Não exigir Cloudflare Access browser-based na frente de `/mcp`.
11. Não exigir mTLS para ChatGPT/Claude se eles não puderem apresentar certificado cliente.
12. Não aplicar bot/browser heuristics que dependam de navegador real.
13. Não rate-limitar MCP autenticado por padrão.
14. Bloquear ou limitar apenas abuso anônimo e brute force de OAuth.

## 6. Estado real atual da policy Cloudflare

### 6.1. Cache settings

Já aplicado:

```text
phase: http_request_cache_settings
ref: copilot-mcp-cache-bypass-v1
name: MCP dynamic routes cache bypass
expression:
  http.host eq "mcp.aurelin.org"
  and (
    starts_with(http.request.uri.path, "/mcp")
    or starts_with(http.request.uri.path, "/oauth/")
    or starts_with(http.request.uri.path, "/.well-known/")
    or http.request.uri.path eq "/health"
  )
action: set_cache_settings
action_parameters.cache: false
```

Manter esta regra como base.

### 6.2. Pendências advisory atuais

Ainda não aplicado:

1. Rate limit explícito de `/oauth/token`.
2. Rate limit explícito de `/mcp` sem `Authorization`.

Ambos são advisory, não críticos. Devem vir depois de ampliar auditoria/config passthrough.

### 6.3. Lacunas de auditoria atuais

As tools atuais ainda não auditam profundamente:

1. Configuration Rules em `http_config_settings` com semântica MCP.
2. Skip Rules em `http_request_firewall_custom`.
3. Produtos legados/zone settings como BIC, Security Level, User Agent Blocking, Hotlink Protection e Zone Lockdown.
4. Super Bot Fight Mode/Bot Fight Mode efetivamente ativo.
5. Managed WAF rules que possam atingir `/mcp`.
6. Regras de response/request body buffering.
7. Regras de Rocket Loader, Zaraz, RUM, Polish, Fonts, Email Obfuscation.
8. Transform Rules de headers sensíveis MCP/OAuth/CORS.
9. Uso de Cloudflare Trace para simular avaliação por URL.
10. Security Events/Ray ID para explicar bloqueios reais.
11. Limites de plano aplicáveis a rate limiting rules e número de regras.

## 7. Policy alvo MCP-native

A policy alvo deve ser composta por blocos pequenos, aplicáveis em rodadas separadas.

### Bloco A — Cache bypass de rotas dinâmicas

Status: aplicado.

Escopo:

```text
/mcp
/oauth/*
/.well-known/*
/health
```

Ação:

```text
cache: false
```

Razão:

1. Evita cache indevido de metadata OAuth, health, responses JSON-RPC e SSE.
2. Torna a intenção independente dos defaults atuais de cache.
3. Reduz risco de regressão futura por regra “cache everything”.

### Bloco B — Configuration Rule “MCP API passthrough”

Status: planejado; não aplicar antes de implementar auditoria/diff específicos.

Escopo geral sugerido:

```text
http.host eq "mcp.aurelin.org"
and (
  starts_with(http.request.uri.path, "/mcp")
  or starts_with(http.request.uri.path, "/oauth/")
  or starts_with(http.request.uri.path, "/.well-known/")
  or http.request.uri.path eq "/health"
)
```

Configurações desejadas quando disponíveis e suportadas pelo plano/API:

```text
bic: false
rocket_loader: false
polish: off
email_obfuscation: false
zaraz: disabled/off
rum: disabled/off
```

Para `/mcp` especificamente:

```text
response_body_buffering: none
request_body_buffering: standard
```

Decisão sobre buffering:

1. `response_body_buffering=none` é desejável para SSE/streamable HTTP.
2. `request_body_buffering=standard` deve permanecer inicialmente, porque JSON-RPC request bodies são pequenos e manter inspeção parcial preserva defesa WAF.
3. `request_body_buffering=none` só deve ser considerado se houver evidência de latência/buffering problemático em upload/request body, o que não é o caso atual.

Não alterar inicialmente:

1. SSL mode.
2. Automatic HTTPS Rewrites, salvo se auditoria provar interferência.
3. Opportunistic Encryption.
4. HTTP/2/HTTP/3 settings de zona.

### Bloco C — Skip rule para clientes MCP autenticados

Status: planejado; aplicar apenas após auditoria de produtos/regras ativas.

Escopo sugerido:

```text
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/mcp")
and exists http.request.headers["authorization"][0]
```

Ação desejada, dependendo do que estiver ativo:

```text
skip products: bic, securityLevel, uaBlock, zoneLockdown se interferirem
skip phases: http_request_sbfm, http_request_firewall_managed se interferirem
logging.enabled: true
```

Decisão importante:

1. Não pular `http_ratelimit` globalmente nesse skip, porque os rate limits desejados não devem atingir tráfego autenticado.
2. Não tentar pular Bot Fight Mode comum; Cloudflare só permite pular Super Bot Fight Mode.
3. Não usar skip amplo sem confirmar quais produtos estão ativos.
4. Preferir configuration rule para `bic=false` quando suficiente; usar skip quando houver produto/fase WAF real interferindo.

### Bloco D — Rate limit de `/oauth/token`

Status: planejado.

Escopo:

```text
http.host eq "mcp.aurelin.org"
and http.request.uri.path eq "/oauth/token"
```

Configuração inicial recomendada:

```text
period: 60s
requests_per_period: 120
mitigation_timeout: 60s
action: block
```

Razão:

1. Protege token exchange contra burst/brute force.
2. Não afeta chamadas MCP já autenticadas.
3. `block` é melhor que challenge para clientes não-browser.
4. Valor inicial é propositalmente alto para preservar liberdade operacional.

Ajuste futuro:

1. Se métricas mostrarem abuso, reduzir gradualmente.
2. Se houver falso positivo, aumentar para 240/min ou usar características mais específicas quando plano permitir.

### Bloco E — Rate limit de `/mcp` anônimo

Status: planejado.

Escopo:

```text
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/mcp")
and not any(http.request.headers.names[*] eq "authorization")
```

Configuração inicial recomendada:

```text
period: 60s
requests_per_period: 240
mitigation_timeout: 60s
action: block
```

Razão:

1. Protege contra scanners e abuso anônimo.
2. Não limita ChatGPT/Claude autenticados.
3. Mantém máxima liberdade para trabalho real.
4. Preserva OAuth como controle principal.

### Bloco F — Transform guard

Status: auditoria planejada; regra de “não fazer” mais importante que regra de apply.

Proibição canônica para rotas MCP/OAuth:

1. Não remover nem sobrescrever `Authorization`.
2. Não remover nem sobrescrever `WWW-Authenticate`.
3. Não remover nem sobrescrever `Set-Cookie`.
4. Não remover nem sobrescrever `Location`.
5. Não alterar `Content-Type`.
6. Não alterar `Cache-Control`.
7. Não alterar CORS.
8. Não alterar `Mcp-Session-Id`.
9. Não alterar `MCP-Protocol-Version`.
10. Não alterar `Last-Event-ID`.
11. Não reescrever path `/mcp` para outro path.
12. Não reescrever `/.well-known/*` OAuth.

A auditoria deve detectar transforms diretos e Managed Transforms quando possível.

### Bloco G — Cloudflare Access, mTLS e rotas internas

Status: diretriz.

Para `/mcp` público usado por ChatGPT/Claude:

1. Não colocar Cloudflare Access interativo.
2. Não exigir mTLS se o cliente externo não puder apresentar certificado.
3. Usar OAuth do próprio MCP como controle principal.

Para rotas internas, se existirem:

```text
/admin/*
/internal/*
/metrics
/debug/*
```

Aplicar postura diferente:

1. Não publicar por Cloudflare se não necessário.
2. Se publicar, considerar Access, IP allowlist, service tokens ou mTLS.
3. Nunca misturar regras internas com `/mcp` público.

### Bloco H — Long-running tools e 524

Status: requisito de runtime, não apenas edge.

Decisão:

1. Não confiar em aumento de timeout Cloudflare como solução principal.
2. Tools longas devem emitir progresso, stream ou virar job assíncrono.
3. Validadores longos devem preferir job tools (`run_*`, `job_get_summary`, `job_get_output`) em vez de request HTTP silencioso por mais de 120s.
4. Smoke deve testar pelo menos uma rota/tool que valide ausência de timeout silencioso.

### Bloco I — Tunnel protocol performance experiment

Status: experimento futuro, separado de edge rules.

Estado atual:

```text
transportProtocol: http2
```

Plano:

1. Medir baseline atual com `http2`:
   - smoke latency;
   - tool call latency;
   - cloudflared errors;
   - registered connections;
   - request/response codes.
2. Testar `auto` em janela controlada.
3. Se `auto` estabilizar em QUIC e melhorar latência/robustez, considerar adoção.
4. Se houver instabilidade de UDP em Dev Container/rede, manter `http2`.
5. Não misturar este experimento com mudanças de WAF/rate limit.

## 8. Tooling necessário antes de novas mutações Cloudflare

### 8.1. Corrigir smoke refresh

Problema atual:

```text
mcp_connector_smoke_refresh atualiza estado de smoke, mas retorna ERR_CONNECTOR_SMOKE_INVALID_JSON.
```

Requisito:

1. Separar stdout JSON final de logs diagnósticos.
2. Garantir JSON único parseável.
3. Preservar tails em `details` quando falhar.
4. Adicionar teste unitário para caso de stdout com logs grandes.

### 8.2. Granularidade por ruleRef

A tool atual `mcp_cloudflare_edge_policy_apply` aceita `phases`. Isso é insuficiente para aplicar rate limits um por vez.

Adicionar:

```json
{
  "ruleRefs": ["copilot-mcp-oauth-token-rl-v1"]
}
```

E:

```json
{
  "ruleRefs": ["copilot-mcp-anonymous-mcp-rl-v1"]
}
```

Requisitos:

1. `phases` continua suportado para compatibilidade.
2. `ruleRefs` tem prioridade quando informado.
3. Dry-run mostra exatamente quais regras seriam criadas/alteradas.
4. Apply real exige `dryRun=false` e `confirmApply=true`.
5. Cada apply cria backup `pre-apply`.
6. Idempotência por `ref` estável.
7. Nunca substituir ruleset existente sem preservar regras não gerenciadas pelo nosso `ref`.

### 8.3. Novo audit: Cloudflare config/product posture

Criar:

```text
mcp_cloudflare_config_audit
```

Objetivo:

1. Auditar `http_config_settings` rulesets.
2. Auditar zone settings relevantes quando API permitir:
   - Browser Integrity Check;
   - Security Level;
   - Bot Fight Mode/Super Bot Fight Mode;
   - Rocket Loader;
   - Zaraz;
   - RUM;
   - Polish;
   - Email Obfuscation;
   - Hotlink Protection;
   - User Agent Blocking;
   - Zone Lockdown;
   - buffering.
3. Classificar cada item:
   - safe;
   - irrelevant;
   - needs-explicit-off;
   - potentially-interfering;
   - unknown-permission-gap.

### 8.4. Novo plan/diff/apply: MCP passthrough

Criar:

```text
mcp_cloudflare_mcp_passthrough_plan
mcp_cloudflare_mcp_passthrough_diff
mcp_cloudflare_mcp_passthrough_apply
```

Escopo:

1. Configuration Rule para recursos de site/browser off nas rotas MCP/OAuth.
2. Response body buffering none para `/mcp`, se suportado.
3. Request body buffering standard.
4. Sem alterações em SSL.
5. Sem alterações em cache, pois cache já é bloco separado.

### 8.5. Novo audit/plan para skip rules

Criar:

```text
mcp_cloudflare_skip_audit
mcp_cloudflare_skip_plan
mcp_cloudflare_skip_diff
```

Objetivo:

1. Detectar skip rules existentes.
2. Detectar se BIC/Security Level/uaBlock/zoneLockdown podem atingir `/mcp`.
3. Detectar Managed WAF/SBFM que possam atingir `/mcp`.
4. Planejar skip apenas quando necessário.
5. Manter logging habilitado.

### 8.6. Restore e rollback

Criar antes de mutações mais amplas:

```text
mcp_cloudflare_edge_restore_plan
mcp_cloudflare_edge_restore_apply
```

Requisitos:

1. Receber snapshot backup como entrada.
2. Comparar actual vs backup.
3. Mostrar regras que seriam removidas, recriadas ou alteradas.
4. Preservar regras fora do namespace `copilot-mcp-*` salvo confirmação explícita.
5. Dry-run por default.
6. Apply real exige `confirmRestore=true`.

### 8.7. Capabilities e limites do plano Cloudflare

Criar:

```text
mcp_cloudflare_plan_capabilities_audit
```

Objetivo:

1. Descobrir limites aplicáveis de Rate Limiting Rules.
2. Descobrir disponibilidade de campos por plano.
3. Descobrir suporte a request headers em rate limit expressions.
4. Descobrir suporte a config rules de buffering.
5. Evitar planejar apply que o plano não suporta.

### 8.8. Cloudflare Trace e Security Events

Criar ou planejar:

```text
mcp_cloudflare_trace_probe
mcp_cloudflare_security_events_audit
```

Objetivo:

1. Simular avaliação de Cloudflare para URLs críticas.
2. Capturar quais rulesets/produtos seriam acionados.
3. Buscar eventos recentes relacionados a Ray ID quando houver falha.
4. Diferenciar falha de OAuth/MCP de bloqueio WAF/edge.

## 9. Roadmap atualizado

### Faixa 0 — Estado base e documentação

Status: concluída.

1. [x] Ler integralmente este arquivo pré-plano original.
2. [x] Auditar estado real atual das tools Cloudflare.
3. [x] Consultar documentação oficial Cloudflare atual.
4. [x] Consultar especificação MCP Streamable HTTP.
5. [x] Consultar documentação OpenAI Apps SDK para OAuth MCP.
6. [x] Atualizar este roadmap canônico.

### Faixa 1 — Correções operacionais imediatas

Status: concluída em 2026-05-29.

1. [x] Corrigir `mcp_connector_smoke_refresh` para sempre retornar JSON parseável.
2. [x] Adicionar teste unitário para stdout/logs grandes no smoke refresh.
3. [x] Tratar prefixos de log antes do JSON final do smoke, como `[db][INFO]`, sem aceitar JSON inválido.
4. [x] Rodar typecheck/lint/unit via `suite-mcp-full`.
5. [x] Publicar tool corrigida e confirmar smoke sem erro após restart MCP/Cloudflare.

Evidência de execução:

1. `mcp_connector_smoke_refresh` passou a retornar `success=true`, `health.status=200`, OAuth OK e 85/85 tools.
2. `mcp_post_restart_readiness` continuou `ready=true`, com `mcpHttp` e `cloudflared` vivos.
3. `mcp_autonomy_power_score` permaneceu `96/A`, sem blockers.
4. `suite-mcp-full` validou typecheck/lint/unit MCP após as correções.

Critério de pronto:

1. [x] `mcp_connector_smoke_refresh` retorna `success=true` quando o smoke passa.
2. [x] `mcp_post_restart_readiness` continua `ready=true`.
3. [x] Erros reais continuam retornando detalhes úteis, incluindo tail e erro de parse quando não houver JSON final parseável.

### Faixa 2 — Auditoria MCP-native de Cloudflare products/config

Status: publicada no servidor MCP em 2026-05-29; smoke remoto confirma 86/86 tools. A execução direta de `mcp_cloudflare_config_audit` ainda depende de refresh do catálogo invocável desta sessão ChatGPT/API tool.

1. [x] Criar `mcp_cloudflare_config_audit`.
2. [x] Auditar `http_config_settings` rulesets.
3. [x] Auditar zone settings relevantes quando permissões permitirem.
4. [~] Auditar BIC, Security Level, uaBlock, Zone Lockdown e Hotlink Protection.
   - Implementado agora: Browser Integrity Check, Security Level, Bot Fight Mode e Hotlink Protection.
   - Ainda pendente para versão seguinte: User Agent Blocking, Zone Lockdown e Super Bot Fight Mode específico, se a API/plano expuserem esses dados.
5. [~] Auditar Rocket Loader, Zaraz, RUM, Email Obfuscation, Polish, Fonts.
   - Implementado agora: Rocket Loader, Zaraz, RUM, Email Obfuscation e Polish.
   - Ainda pendente: Fonts/Cloudflare Fonts, se aplicável.
6. [x] Auditar request/response body buffering quando presente em `http_config_settings`.
7. [x] Classificar findings por impacto MCP: `safe`, `advisory`, `needs-explicit-off`, `potentially-interfering` e `unknown`.
8. [~] Adicionar fixtures unitárias.
   - Implementado: registry/metadata parity e smoke parser regression.
   - Pendente: fixtures específicas de `analyzeConfigPosture` com exemplos de zone settings/config rules.
9. [x] Adicionar Make target e npm script.
10. [x] Publicar tool no registry/capabilities metadata no código.
11. [x] Reiniciar MCP/Cloudflare para expor a nova tool no conector público.
12. [x] Rodar `mcp_cloudflare_config_audit` no conector público e registrar baseline real de settings/produtos.
13. [x] Confirmar que refresh do catálogo invocável disponibilizou a tool após recarregar o conector.

Baseline real capturado em 2026-05-29:

1. `mcp_cloudflare_config_audit` retornou `ok=true`, `success=true`, `configAuditable=true`.
2. Endpoint auditado: `mcp.aurelin.org`, URL `https://mcp.aurelin.org/mcp`, zona `aurelin.org`.
3. Zone settings avaliadas: 9.
4. `Browser Integrity Check`: `on`, status `potentially-interfering`.
5. `Security Level`: `medium`, status `advisory`.
6. `Rocket Loader`: `on`, status `needs-explicit-off`.
7. `Browser RUM`: `on`, status `needs-explicit-off`.
8. `Email Obfuscation`: `on`, status `needs-explicit-off`.
9. `Polish`: `off`, status `safe`.
10. `Hotlink Protection`: `off`, status `safe`.
11. `Bot Fight Mode`: `unknown`, API retornou `Undefined zone setting: bot_fight_mode`.
12. `Zaraz`: `unknown`, API retornou `Not Found`.
13. `http_config_settings`: zero config rules encontradas para a zona/hostname.
14. Não há `response_body_buffering=none` explícito para `/mcp`.
15. Não há regra explícita `bic=false` para rotas MCP/OAuth.
16. Edge audit cruzado confirmou cache bypass ativo, zero WAF/challenge rules, zero transform rules, zero config rules e zero rate-limit rules.

Critério de pronto:

1. [x] Sabemos se BIC/Security Level/browser products estão ativos para `mcp.aurelin.org`.
2. [x] Sabemos se há config rules já afetando `/mcp`.
3. [x] Permission gaps aparecem como warnings explícitos na execução real da tool.

Critério técnico já atingido:

1. [x] Código da auditoria criado: `src/copilot/mcp/cloudflare/config-audit.js`.
2. [x] Tool MCP criada: `src/copilot/mcp/tools/cloudflare-config.js`.
3. [x] CLI criado: `npm run copilot:mcp:cloudflare:config-audit`.
4. [x] Make target criado: `make copilot-mcp-config-audit`.
5. [x] Registry e capability metadata atualizados, com `CAPABILITIES_VERSION=27`.
6. [x] `suite-mcp-full` passou após a inclusão da nova tool.

### Faixa 3 — Auditoria e plano de skip/non-interference

Status: auditoria real concluída em 2026-05-29; `mcp_cloudflare_skip_audit` publicada como 87ª tool e executada contra a API real. Resultado: skip talvez seja necessário para BIC no futuro, mas a recomendação atual é preferir primeiro uma configuration rule MCP passthrough.

1. [x] Criar `mcp_cloudflare_skip_audit`.
2. [x] Detectar skip rules de zona existentes, via rulesets read-only em fases skip/config relevantes.
3. [x] Detectar possibilidade de skip por products e phases, incluindo alerta para skip amplo de `http_ratelimit`.
4. [ ] Criar `mcp_cloudflare_skip_plan`.
5. [ ] Criar `mcp_cloudflare_skip_diff`.
6. [~] Definir se skip é necessário ou se config rule basta.
   - Com base no baseline da Faixa 2, a recomendação esperada é preferir primeiro uma configuration rule MCP passthrough para BIC/browser features/buffering.
   - Skip deve ficar reservado para produto que não puder ser neutralizado por config rule ou evidência de Trace/Security Events.
7. [x] Não aplicar skip ainda.
8. [x] Adicionar Make target e npm script: `make copilot-mcp-skip-audit` e `npm run copilot:mcp:cloudflare:skip-audit`.
9. [x] Publicar no registry/capabilities metadata no código, com `CAPABILITIES_VERSION=28`.
10. [x] Rodar `suite-mcp-full` após inclusão da nova tool.
11. [x] Reiniciar MCP/Cloudflare para expor a nova tool no conector público.
12. [x] Rodar `mcp_cloudflare_skip_audit` no conector público e registrar baseline real.

Baseline real capturado em 2026-05-29:

1. Smoke remoto confirmou 87/87 tools e registry remoto igual ao local.
2. `mcp_cloudflare_skip_audit` retornou `ok=true`, `success=true`, `skipAuditable=true`.
3. Skip rules encontradas: zero.
4. MCP/OAuth-scoped skip rules: zero.
5. Broad skip rules: zero.
6. Produtos pulados: nenhum.
7. Config baseline incorporado: `inspectedConfigRules=0`, `bicOffRules=0`, `responseBodyBufferingNoneRules=0`.
8. `skipNeeded`: `maybe`.
9. `configRulePreferred`: `true`.
10. `preferredNextStep`: planejar uma configuration rule MCP passthrough antes de qualquer skip rule.
11. Possível produto que talvez precise de skip no futuro: `bic`.
12. Produtos melhores via config rule primeiro: `rocketLoader`, `rum`, `emailObfuscation`, `zaraz`.
13. Permission gaps herdados: `bot_fight_mode` e `zaraz` não foram lidos pela API atual.

Critério de pronto:

1. [x] Temos resposta clara: “precisamos de skip?”
   - Resposta atual: talvez para BIC no futuro, mas não agora; primeiro planejar MCP passthrough config rule.
2. [ ] Se sim, o plano especifica products/phases exatos e expressão mínima.
3. [x] O plano/auditoria não pula `http_ratelimit` de forma ampla; broad skip/rate-limit skip é tratado como critical.

### Faixa 4 — Granularidade ruleRefs e capabilities de plano

Status: em andamento em 2026-05-29. Auditoria core read-only de capabilities criada e registrada como `mcp_cloudflare_plan_capabilities_audit`; `CAPABILITIES_VERSION=30`; `suite-mcp-full` passou no job `0220e5e7-dcd0-4dc8-a177-8409297e9525`. Nenhuma regra Cloudflare foi aplicada.

1. [ ] Adicionar `ruleRefs` em `mcp_cloudflare_edge_policy_apply`.
2. [ ] Adicionar `ruleRefs` em plan/diff quando aplicável.
3. [ ] Criar `mcp_cloudflare_plan_capabilities_audit`.
4. [ ] Verificar número de rate limiting rules permitido pelo plano.
5. [ ] Verificar se expressão com headers é suportada no plano.
6. [ ] Garantir idempotência por `ref`.
7. [x] Testar apply dry-run por regra individual.

Atualização em 2026-05-30:

1. Uma tentativa real prematura de `http_ratelimit` foi recusada pela Cloudflare antes de criar regra: a conta aceita `period=10`, não `period=60`.
2. Auditoria pós-recusa confirmou que nenhuma rate-limit rule foi criada; permanecem 0 regras em `http_ratelimit`.
3. O plano foi corrigido para limites equivalentes por janela de 10s: `/oauth/token` usa `20/10s`; anonymous `/mcp` usa `40/10s`; `mitigation_timeout=10` é obrigatório nesta conta/plano.
4. `mcp_cloudflare_edge_policy_apply` passou a aceitar `ruleRefs` e o planner filtra ações por ref explícito.
5. Rate-limit apply sem `ruleRefs` agora é bloqueado por preflight.
6. `suite-mcp-full` passou no job `aecd4f99-bfed-4961-ac85-d5470f55a326`, cobrindo typecheck, lint e unit-mcp.
7. Em 2026-05-30, uma nova tentativa real de `/oauth/token` foi recusada antes de criar regra porque a conta também exige `mitigation_timeout=10`; auditoria posterior confirmou `http_ratelimit=0`.
8. O plano local foi corrigido para `mitigation_timeout=10` em ambas as rate-limit rules; `suite-mcp-full` passou no job `7075918b-c505-4c76-8cab-6e95696e03a6`.
9. Histórico: antes do restart/publicação, o MCP em execução ainda mostrou dry-run com `mitigation_timeout=60`; por isso o apply ficou bloqueado até a publicação da correção.
10. A config rule `copilot-mcp-passthrough-config-v1` foi aplicada com sucesso em `http_config_settings`; config audit confirmou `bic=false`, `rocket_loader=false`, `email_obfuscation=false` e `response_body_buffering=none`.
11. Após restart/publicação, `/oauth/token` foi aplicado com `ruleRefs=[copilot-mcp-oauth-token-rate-limit-v1]`, `period=10`, `requests_per_period=20`, `mitigation_timeout=10`; edge audit confirmou `oauthTokenRateLimitCount=1` e `http_ratelimit=1`.
12. A tentativa de anonymous `/mcp` foi recusada pela Cloudflare porque a expressão `not exists http.request.headers["authorization"][0]` não é aceita pelo Ruleset Engine; auditoria confirmou que `mcpRateLimitCount` permaneceu 0.
13. A expressão anonymous foi corrigida localmente para `not any(http.request.headers.names[*] eq "authorization")`; `suite-mcp-full` passou no job `f0b11351-3b7b-4563-a2df-8519d4c53c14`.
14. Após novo restart/publicação, o dry-run anonymous mostrou exatamente 1 ação append-rule, com expressão corrigida e `period=10`, `requests_per_period=40`, `mitigation_timeout=10`; porém a checagem de quota indicou bloqueio operacional: a documentação Cloudflare lista Free=1, Pro=2, Business=5, Enterprise=100 rate limiting rules, e o edge audit atual já tem `oauthTokenRateLimitCount=1`, `mcpRateLimitCount=0`, `http_ratelimit=1`.
15. Decisão segura: não aplicar anonymous `/mcp` como segunda rate-limit rule enquanto o dashboard/plano indicar limite atingido; alternativas futuras são upgrade do plano ou substituir a única regra por uma regra combinada Free-plan-aware após novo design/review.

Critério de pronto:

1. Podemos aplicar apenas `copilot-mcp-oauth-token-rl-v1` sem aplicar `copilot-mcp-anonymous-mcp-rl-v1`.
2. Dry-run mostra apenas uma mutação.
3. Apply preserva regras existentes.

### Faixa 5 — MCP passthrough configuration rule

Status: aplicada e auditada em 2026-05-30. A regra `copilot-mcp-passthrough-config-v1` existe em `http_config_settings`, está enabled e já satisfaz o diff canônico. Nenhuma nova mutação é necessária nesta faixa.

1. [x] Criar `mcp_cloudflare_mcp_passthrough_plan`.
2. [x] Criar `mcp_cloudflare_mcp_passthrough_diff`.
3. [~] Criar `mcp_cloudflare_mcp_passthrough_apply` ou integrar em apply por `ruleRefs`; a regra real já foi aplicada por fluxo guardado, mas a cobertura CLI/Make ainda precisa ficar simétrica.
4. [x] Dry-run/plano da config rule sem mutação.
   - Desired ruleRef: `copilot-mcp-passthrough-config-v1`.
   - Phase: `http_config_settings`.
   - Expressão: host `mcp.aurelin.org` + rotas `/mcp`, `/oauth/`, `/.well-known/` e `/health`.
   - Desired action parameters: `bic=false`, `rocket_loader=false`, `email_obfuscation=false`, `response_body_buffering=none`.
   - RUM/Zaraz/Security Level permanecem como warnings/capability gaps até confirmação de suporte por plan/API.
5. [ ] Backup preflight.
6. [ ] Apply apenas da config rule se diff for seguro.
7. [ ] Edge audit.
8. [ ] Config audit.
9. [ ] Remote audit.
10. [ ] Smoke refresh.
11. [ ] Post-restart readiness.
12. [x] Adicionar Make targets e npm scripts: `make copilot-mcp-passthrough-plan`, `make copilot-mcp-passthrough-diff`, `npm run copilot:mcp:cloudflare:mcp-passthrough:plan`, `npm run copilot:mcp:cloudflare:mcp-passthrough:diff`.
13. [x] Publicar no registry/capabilities metadata no código, com `CAPABILITIES_VERSION=29`.
14. [x] Rodar `suite-mcp-full` após inclusão das tools read-only.
15. [x] Reiniciar MCP/Cloudflare para expor as novas tools no conector público.
16. [x] Rodar `mcp_cloudflare_mcp_passthrough_plan` e `mcp_cloudflare_mcp_passthrough_diff` no conector público e registrar baseline real.

Baseline real capturado em 2026-05-29:

1. Smoke remoto confirmou 89/89 tools e registry remoto igual ao local.
2. `mcp_cloudflare_mcp_passthrough_plan` retornou `ok=true`, `success=true`, `mode=plan-only`, `appliesChanges=false`.
3. Desired rule: `copilot-mcp-passthrough-config-v1` em `http_config_settings`.
4. Desired parameters: `bic=false`, `rocket_loader=false`, `email_obfuscation=false`, `response_body_buffering=none`.
5. Safety invariants: escopo apenas `mcp.aurelin.org` + rotas dinâmicas, não mexer em `http_ratelimit`, não enfraquecer rotas do site, aplicar só após backup/review.
6. `mcp_cloudflare_mcp_passthrough_diff` retornou `ok=true`, `success=true`, `mode=diff-only`, `appliesChanges=false`.
7. Actual: `inspectedConfigRulesets=0`, `inspectedRules=0`, `existingRuleByRef=null`, `equivalentRule=null`.
8. Diff: `needsCreate=true`, `needsUpdate=false`, `alreadySatisfied=false`.
9. Gaps: `missing-rule`, `bic-not-explicitly-off`, `response-body-buffering-not-none`.
10. Recommendation: criar/atualizar apenas a single ruleRef `copilot-mcp-passthrough-config-v1` após backup/review; `doNotApplyYet=true`.

Correção/validação em 2026-05-29:

1. Uma tentativa de preparar código de apply guardado deixou dois imports não usados em `mcp-passthrough-plan.js`.
2. `suite-mcp-fast` falhou por `TS6133` nesses imports.
3. A falha foi investigada pelo log do job e corrigida comentando as duas linhas que não eram usadas.
4. `suite-mcp-fast` voltou a passar no job `48691a92-1838-4e75-a6cd-6f985cf0041e`.
5. `suite-mcp-full` passou no job `48a0427c-14af-4981-a669-42d377a88e20`, cobrindo typecheck, lint e testes MCP.
6. Nenhuma regra Cloudflare foi aplicada nesta correção.

Critério de pronto:

1. [ ] BIC/browser features não interferem em MCP/OAuth.
2. [ ] `/mcp` preserva streaming.
3. [ ] OAuth discovery e token flow continuam OK.
4. [ ] Nenhum challenge aparece em smoke.

### Faixa 6 — Rate limit `/oauth/token`

Status: aplicada e auditada em 2026-05-30. A regra `copilot-mcp-oauth-token-rate-limit-v1` está ativa em `http_ratelimit`; esta faixa deixou de ser futura.

1. [x] Confirmar capabilities do plano.
2. [x] Dry-run somente `copilot-mcp-oauth-token-rate-limit-v1`.
3. [x] Backup pre-apply.
4. [x] Aplicação real concluída.
5. [x] Edge audit.
6. [x] Policy diff.
7. [x] OAuth smoke.
8. [ ] Monitorar Security Events.

Critério de pronto:

1. `/oauth/token` tem rate limit explícito.
2. `/mcp` autenticado não é afetado.
3. OAuth continua funcionando.
4. Policy diff reduz para 1 advisory.

### Faixa 7 — Rate limit `/mcp` anônimo

Status: pendente em 2026-05-30.

1. [ ] Dry-run somente `copilot-mcp-anonymous-mcp-rl-v1`.
2. [ ] Backup pre-apply.
3. [ ] Apply real.
4. [ ] Edge audit.
5. [ ] Policy diff.
6. [ ] Smoke autenticado.
7. [ ] Teste anônimo controlado quando possível.

Critério de pronto:

1. `/mcp` sem Authorization tem rate limit explícito.
2. `/mcp` com Authorization não é limitado pela regra.
3. Policy diff canônico chega a 0, ou a pendências documentadas como aceitas.

### Faixa 8 — Restore/rollback automation

Status: obrigatório antes de mudanças mais amplas.

1. [ ] Criar restore plan baseado em snapshot.
2. [ ] Criar restore apply guardado.
3. [ ] Testar restore dry-run contra backups atuais.
4. [ ] Garantir que só refs `copilot-mcp-*` são revertidas por default.
5. [ ] Documentar procedimento manual emergencial.

Critério de pronto:

1. Qualquer apply futuro tem caminho de reversão claro.
2. Snapshot atual e snapshot anterior podem ser comparados.
3. Rollback não destrói regras manuais não gerenciadas.

### Faixa 9 — Observabilidade profunda

Status: posterior.

1. [ ] Integrar Cloudflare Trace para URLs críticas:
   - `/mcp` POST;
   - `/mcp` GET SSE;
   - `/oauth/token`;
   - `/.well-known/oauth-protected-resource`;
   - `/health`.
2. [ ] Integrar Security Events/Ray ID quando permissões permitirem.
3. [ ] Melhorar `mcp_cloudflare_metrics_snapshot` com análise derivada:
   - erros por janela;
   - response codes;
   - HA connections;
   - latency buckets;
   - active streams/sessions se disponíveis;
   - process uptime.
4. [ ] Adicionar score MCP edge health.

Critério de pronto:

1. Falhas 403/429/5xx podem ser explicadas por produto/regra quando vierem da Cloudflare.
2. Falhas de origin vs WAF vs OAuth ficam distinguíveis.

### Faixa 10 — Experimento de tunnel protocol

Status: futuro e separado de edge rules.

1. [ ] Capturar baseline `http2`.
2. [ ] Planejar `auto`/QUIC em dry-run/config.
3. [ ] Testar em janela controlada.
4. [ ] Comparar métricas.
5. [ ] Reverter se houver instabilidade.
6. [ ] Documentar decisão final.

Critério de pronto:

1. Decisão baseada em métricas, não em preferência teórica.
2. Edge rules e tunnel protocol não mudam no mesmo deploy.

## 10. Sequência segura de implementação

A sequência recomendada a partir deste documento é:

```text
1. Corrigir smoke refresh JSON.
2. Implementar config/product audit.
3. Implementar skip audit/plan/diff.
4. Implementar apply granular por ruleRefs.
5. Implementar capabilities audit de plano Cloudflare.
6. Planejar MCP passthrough config rule.
7. Dry-run MCP passthrough.
8. Apply MCP passthrough se seguro.
9. Auditar + smoke.
10. Dry-run e apply /oauth/token rate limit.
11. Auditar + smoke.
12. Dry-run e apply /mcp anônimo rate limit.
13. Auditar + smoke.
14. Implementar restore automation.
15. Só então experimentar tunnel auto/quic.
```

Não aplicar em lote:

1. Config passthrough + rate limits juntos.
2. Rate limit de OAuth + rate limit anônimo juntos.
3. Skip rules + managed WAF changes juntos.
4. Tunnel protocol + edge rules juntos.

## 11. Expressões canônicas

### 11.1. Dynamic routes base

```text
http.host eq "mcp.aurelin.org"
and (
  starts_with(http.request.uri.path, "/mcp")
  or starts_with(http.request.uri.path, "/oauth/")
  or starts_with(http.request.uri.path, "/.well-known/")
  or http.request.uri.path eq "/health"
)
```

### 11.2. MCP endpoint only

```text
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/mcp")
```

### 11.3. MCP authenticated

```text
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/mcp")
and exists http.request.headers["authorization"][0]
```

### 11.4. MCP anonymous

```text
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/mcp")
and not any(http.request.headers.names[*] eq "authorization")
```

### 11.5. OAuth token endpoint

```text
http.host eq "mcp.aurelin.org"
and http.request.uri.path eq "/oauth/token"
```

### 11.6. OAuth discovery

```text
http.host eq "mcp.aurelin.org"
and starts_with(http.request.uri.path, "/.well-known/")
```

## 12. Headers sensíveis canônicos

Auditoria e diffs devem tratar como sensíveis:

```text
Authorization
WWW-Authenticate
Set-Cookie
Location
Content-Type
Cache-Control
Access-Control-Allow-Origin
Access-Control-Allow-Headers
Access-Control-Allow-Methods
Access-Control-Allow-Credentials
Mcp-Session-Id
MCP-Protocol-Version
Last-Event-ID
Accept
Origin
```

Regra geral:

1. Transform que toca esses headers em rotas MCP/OAuth é warning alto ou critical.
2. Transform que remove `Authorization` ou `WWW-Authenticate` é critical.
3. Transform que altera `Content-Type: text/event-stream` é critical.
4. Transform que altera CORS em `/mcp` é warning alto até prova contrária.

## 13. Política de rate limit recomendada

### 13.1. Não fazer

1. Não rate-limitar `/mcp` autenticado inicialmente.
2. Não usar challenge como ação de rate limit para MCP.
3. Não usar JS challenge, managed challenge ou interactive challenge.
4. Não usar user-agent como critério principal para clientes MCP.
5. Não contar requests por path de forma que misture `/mcp` anônimo e autenticado.

### 13.2. Fazer

1. `/oauth/token`: `20/10s`, equivalente a 120/min, block, mitigation 10s.
2. `/mcp` anônimo: `40/10s`, equivalente a 240/min, block, mitigation 10s; aplicação real pendente por quota/plano ou redesign combinando regras.
3. Manter valores conservadores primeiro.
4. Ajustar apenas depois de métricas e Security Events.
5. Preferir contagem por IP no plano atual se headers/custom characteristics não estiverem disponíveis.

## 14. Critérios de pronto MCP Edge

A edge será considerada MCP-ready quando:

1. Cache bypass dinâmico existir e auditar OK.
2. BIC/challenge/browser checks não atingirem MCP/OAuth.
3. Response body buffering de `/mcp` for avaliado e configurado para não quebrar stream quando suportado.
4. Transform audit não encontrar alterações em headers sensíveis.
5. `/oauth/token` tiver rate limit ou decisão explícita documentada de não aplicar.
6. `/mcp` anônimo tiver rate limit ou decisão explícita documentada de não aplicar.
7. `/mcp` autenticado não tiver rate limit amplo prejudicial.
8. OAuth discovery, token exchange e tool list passarem no smoke.
9. Cloudflare remote audit continuar sem warnings críticos.
10. Backups de snapshot existirem antes de mutações.
11. Restore plan existir antes de mudanças amplas.
12. Métricas locais do cloudflared estiverem disponíveis.
13. Falhas de smoke não dependerem de parsing frágil de stdout.

## 15. Comandos canônicos

Comandos já esperados:

```bash
make copilot-mcp-status
make copilot-mcp-remote-audit
make copilot-mcp-config-audit
make copilot-mcp-edge-audit
make copilot-mcp-edge-backup-create
make copilot-mcp-edge-backup-list
make copilot-mcp-edge-policy-apply
make copilot-mcp-edge-policy-diff
make copilot-mcp-edge-policy-plan
make copilot-mcp-edge-snapshot
make copilot-mcp-smoke-refresh
```

Comandos a adicionar:

```bash
make copilot-mcp-cloudflare-config-audit
make copilot-mcp-cloudflare-skip-audit
make copilot-mcp-cloudflare-skip-plan
make copilot-mcp-cloudflare-mcp-passthrough-plan
make copilot-mcp-cloudflare-mcp-passthrough-diff
make copilot-mcp-cloudflare-plan-capabilities-audit
make copilot-mcp-cloudflare-restore-plan
make copilot-mcp-cloudflare-trace-probe
make copilot-mcp-cloudflare-security-events-audit
```

Nomes podem ser encurtados na implementação, mas o escopo funcional acima deve permanecer.

## 16. Conectores

### ChatGPT

Nome recomendado: `Repo DevContainer MCP`
URL: `https://mcp.aurelin.org/mcp`
Autenticação: OAuth

### Claude

Nome recomendado: `Repo DevContainer MCP`
URL do servidor MCP remoto: `https://mcp.aurelin.org/mcp`
OAuth Client ID/Secret: deixar em branco enquanto descoberta dinâmica/CIMD funcionar. Preencher apenas se Claude exigir client pré-registrado.

## 17. Papel do MCP oficial da Cloudflare

O MCP oficial da Cloudflare continua sendo acelerador opcional.

Usos apropriados:

1. Investigar docs e API Cloudflare.
2. Auditar conta, DNS, rulesets e analytics com ferramentas oficiais.
3. Aplicar mudanças supervisionadas quando desejado.
4. Cruzar nossos achados com Cloudflare Audit Logs/Security Events.

Não deve substituir:

1. Nosso MCP do repo.
2. Nossas tools read-only.
3. Nosso Makefile.
4. Nosso rollback local.
5. A capacidade de operar sem conector Cloudflare externo.

URLs oficiais úteis:

```text
https://mcp.cloudflare.com/mcp
https://docs.mcp.cloudflare.com/mcp
https://observability.mcp.cloudflare.com/mcp
https://auditlogs.mcp.cloudflare.com/mcp
https://dns-analytics.mcp.cloudflare.com/mcp
https://graphql.mcp.cloudflare.com/mcp
```

## 18. Decisões finais desta revisão

1. O cache bypass aplicado está correto e deve permanecer.
2. Não aplicar rate limits ainda antes de granularidade `ruleRefs` e capabilities audit.
3. A próxima mutação ideal não é rate limit; é MCP passthrough/configuration rule, mas só depois de auditoria própria.
4. BIC é risco real para MCP porque é default e desafia user-agents não padrão.
5. Response body buffering deve ser avaliado para `/mcp` por causa de SSE/streaming.
6. Request body buffering deve ficar `standard` inicialmente.
7. Skip rules devem ser cirúrgicas e baseadas no que estiver ativo.
8. Challenges interativos são proibidos no caminho `/mcp`.
9. OAuth e escopos continuam sendo o controle principal para clientes autenticados.
10. Tráfego anônimo deve ser limitado; tráfego autenticado deve ser livre.
11. Transform rules sobre headers sensíveis devem ser tratadas como risco alto.
12. Long-running tools devem evitar silêncio maior que o timeout Cloudflare; usar jobs/stream/progresso.
13. Experimento `auto`/QUIC é útil, mas deve ocorrer depois e separadamente.

## 18.1. Frente DevContainer/Tunnel/Origin/DNS — desempenho e segurança MCP

Aberta em 2026-05-30 após revisão da documentação oficial Cloudflare Tunnel e dos scripts `.devcontainer/scripts/network`.

Objetivo: otimizar conexão, latência e resiliência do MCP remoto usado por ChatGPT/Claude sem quebrar Docker/DevContainer, OAuth, streaming MCP ou resolução DNS interna do container.

Baseline real atual:

1. Túnel permanente `workspace-mcp-dev` saudável em `mcp.aurelin.org`.
2. Origin atual: `http://127.0.0.1:3333`.
3. Transporte atual: `http2`.
4. Cloudflare remoto tem 4 conexões ativas em colos GRU.
5. Métricas Prometheus locais do `cloudflared` ativas em `127.0.0.1:60123/metrics`.
6. Edge profile já aplicado: cache bypass, MCP passthrough config e `/oauth/token` rate limit.
7. Anonymous `/mcp` rate limit permanece bloqueado por quota/plano até novo design ou upgrade.

Implementação gradual planejada:

1. [x] Criar auditoria read-only de DevContainer/network/DNS posture.
   - Tool criada: `mcp_devcontainer_network_posture_audit`.
   - Lê artefatos runtime-only do DevContainer: `/tmp/devcontainer-local-dns-cache.status`, `/tmp/devcontainer-local-dns-cache.summary`, action summary e network-control-plane summary/events quando disponíveis.
   - Verifica campos de governança DNS: `runtime_effective`, `resolver_effective`, `resolv_conf_points_to_cache`, drift de `/etc/resolv.conf`, prova local DNS, split Docker embedded DNS, warmup, conflitos de porta e visibilidade de socket.
   - Mantém modo read-only; não altera `/etc/resolv.conf`, dnsmasq, Docker, Cloudflare ou MCP.
2. [x] Melhorar `mcp_cloudflare_metrics_snapshot` para calcular métricas úteis:
   - Adicionado módulo `src/copilot/mcp/cloudflare/metrics-histograms.js`.
   - Output agora inclui `latency.proxyConnectLatency` e `latency.rpcClientLatency` com `averageMs`, `p50Ms`, `p95Ms`, `p99Ms`, contagem e buckets.
   - Output agora inclui `operational.totalRequests`, `requestErrors`, `requestErrorRate`, sessões TCP/UDP, `haConnections`, `registerSuccess` e códigos de resposta.
   - Baseline capturado em 2026-05-30: `rpcClientLatency` count=4, average=361ms, p50=350ms, p95=1170ms, p99=1314ms; `requestErrorRate=0`; `haConnections=4`.
3. [x] Adicionar auditoria read-only de `originRequest`/origin parameters no remote audit local.
   - `buildDesiredRemoteConfigSummary` agora inclui `desiredOriginRequestProfile`.
   - `compareRemoteConfig` passa a extrair `hostnameRule.originRequest`, expor `actual` e apontar warnings/recommendations.
   - Warnings críticos de perfil: `http2Origin=true` com origin HTTP loopback, `disableChunkedEncoding=true` para MCP streaming, `noTLSVerify=true` desnecessário com HTTP loopback.
   - Recomendações read-only: considerar `connectTimeout=5s`, manter keepalive default/100 salvo evidência de churn, manter chunking unset/false.
   - Validação: `typecheck` passou no job `c9e0d1d4-0653-4fd4-b5ae-11659da144cd`; `suite-mcp-fast` passou no job `6db2cf1f-e435-4914-857d-7dc7368a86ef`; `suite-mcp-full` passou no job `2243eae5-b4fa-4f87-b044-414124fd65f6`.
   - Pendente: restart/publicação do MCP para o `mcp_cloudflare_remote_audit` público exibir os novos campos de `originRequest`.
4. [x] Criar plano read-only de benchmark A/B controlado de transporte:
   - Tool criada: `mcp_cloudflare_transport_benchmark_plan`.
   - `http2` atual é o controle; `auto` é o primeiro candidato; `quic` é candidato UDP-only de maior risco.
   - A tool não altera protocolo nem reinicia cloudflared; apenas gera plano, gates, stop conditions e política de decisão.
   - Baseline pré-implementação em 2026-05-30: túnel permanente `workspace-mcp-dev`, protocolo atual `http2`, origin `http://127.0.0.1:3333`, smoke fresh, sem origin errors recentes, `haConnections=4`, `requestErrorRate=0`, `rpcClientLatency` average=562ms, p50=750ms, p95=1290ms, p99=1338ms.
   - Validação: `suite-mcp-fast` passou no job `4e9d8e3d-c170-47da-983e-af36ab00b312`; `suite-mcp-full` passou no job `d3edf421-2176-44f5-931e-e3829e7aeea9`.
   - Pendente: restart/publicação do MCP para a tool aparecer no conector público.
4. [ ] Avaliar suporte a origin params no repo sem mutação remota imediata.
   - Perfil inicial desejado: `disableChunkedEncoding=false`, `connectTimeout=5s`, `keepAliveTimeout=90s ou 120s`, `keepAliveConnections=100`, `tcpKeepAlive=30s`, `http2Origin=false` enquanto o origin for HTTP loopback.
5. [ ] Investigar `.devcontainer/scripts/network/local-dns-cache.sh` e scripts irmãos.
   - Confirmar se DNS cache local melhora ou piora chamadas MCP/GitHub/Copilot dentro do DevContainer.
   - Garantir preservação do Docker embedded DNS `127.0.0.11` e split routing para domínios Docker/Compose.
   - Medir impacto em lookup time, falhas DNS, drift de `/etc/resolv.conf`, warmup e stale cache.
6. [x] Adicionar gates pós-mudança:
   - Tool criada: `mcp_cloudflare_post_change_gates`.
   - Agrega, em modo read-only, status do túnel, audit remoto Cloudflare, snapshot de métricas cloudflared e avaliação pass/fail.
   - Gates críticos: smoke permanente fresh, sem origin errors recentes, `remoteAudit.ok=true`, HA connections >= 4 no remoto e nas métricas, `requestErrorRate=0`, métricas disponíveis.
   - Warnings: `rpcClientLatency.p95Ms` indisponível ou amostragem insuficiente.
   - Validação: `suite-mcp-fast` passou no job `cc6a74b9-1d0e-49f2-8542-30ec5021693f`; `suite-mcp-full` passou no job `76a99859-e927-4a8d-9eb3-409fed33e612`.
   - Pendente: restart/publicação do MCP para a tool aparecer no conector público.

Decisões iniciais:

1. Não ativar `http2Origin=true` enquanto o origin for `http://127.0.0.1:3333`.
2. Não ativar `disableChunkedEncoding=true`; MCP/streaming deve preservar chunking/streaming.
3. Não usar `region=us`, pois o túnel atual já conecta em GRU e forçar EUA tende a piorar latência.
4. Manter `loglevel=info`; `debug` apenas temporário porque pode expor dados sensíveis.
5. Tratar DNS cache local como camada DevContainer opcional: útil para GitHub/Copilot/npm/apt se comprovado, mas não pode quebrar Docker service discovery nem deixar `/etc/resolv.conf` apontando para cache morto.

## 19. Princípio final

Cloudflare deve proteger `mcp.aurelin.org` como uma API MCP remota, não como uma página web. Para ChatGPT e Claude, o melhor edge profile é:

```text
sem cache dinâmico
sem challenge interativo
sem heurística browser no caminho autenticado
sem rewrite de headers sensíveis
sem buffering que quebre stream
com OAuth preservado
com rate limiting seletivo para abuso anônimo
com observabilidade forte
com rollback antes de mutação ampla
```

Esse é o caminho que maximiza liberdade, desempenho e segurança para o nosso uso real.
