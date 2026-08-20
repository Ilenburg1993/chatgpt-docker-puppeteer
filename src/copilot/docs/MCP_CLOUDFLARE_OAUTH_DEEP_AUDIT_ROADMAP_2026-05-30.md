# MCP / Cloudflare / OAuth — auditoria profunda e roadmap amplo

Data: 2026-05-30  
Escopo primário: `src/copilot`, com foco em `src/copilot/mcp`, `src/copilot/mcp/cloudflare`,
`src/copilot/mcp/control-plane/auth.js`, `src/copilot/mcp/control-plane/dev-oauth.js`,
`src/copilot/mcp/scripts/oauth-smoke.js` e ferramentas MCP relacionadas a Cloudflare/OAuth.  
Modo desta etapa: investigação, reflexão e planejamento. Nenhuma mutação de Cloudflare, nenhum
pagamento, nenhuma ativação de Secure MCP Tunnel, nenhuma nova tool pública.

---

## 1. Resumo executivo

A camada MCP atual já tem uma base acima da média: há separação entre registry, controle de
autorização, ferramentas read-only, ferramentas write/plan/apply, auditorias Cloudflare, métricas
locais de `cloudflared`, OAuth embutido para desenvolvimento, smoke OAuth e testes unitários
cobrindo partes críticas. O estado atual, porém, mostra sinais claros de crescimento orgânico
rápido: há duplicação acidental em CLI, risco de tool bloat, inconsistências entre metadata e
registry em momentos de mudança, lacunas de hardening OAuth, e uma fronteira Cloudflare/OAuth/MCP
que precisa de invariantes mais formais.

A prioridade ideal não é criar mais ferramentas. A prioridade é consolidar, reduzir superfície
exposta, endurecer OAuth, transformar heurísticas Cloudflare em políticas testáveis, organizar
scripts locais, melhorar observabilidade e criar uma matriz de validação confiável.

Achados mais importantes:

1. `src/copilot/mcp/cloudflare/cli.js` tem duplicação concreta de `runPlanCapabilitiesAudit`,
   detectada por outline com `parseError: VarRedeclaration`. Este é um bug P0 porque pode quebrar
   parsing, typecheck, execução CLI ou validação dependendo do caminho carregado.
2. A camada OAuth melhorou recentemente com validação de `state` no smoke e restrição de bypass
   público ao modo `oauth`, mas ainda precisa de uma auditoria formal de conformidade OAuth/MCP,
   incluindo `WWW-Authenticate`, resource indicators, audience binding, DCR/CIMD, TTLs, refresh
   rotation, status codes 401/403 e CORS.
3. A camada Cloudflare já tem módulos bons (`config-audit`, `skip-audit`, `mcp-passthrough-plan`,
   `edge-policy-plan`, `edge-policy-apply`, `metrics`), mas precisa de uma fonte canônica única para
   expressões de path/host, invariantes de não interferência, e testes de equivalência entre plano,
   diff, apply e auditorias.
4. O registry MCP continua grande. A estratégia ideal é manter tools públicas apenas quando o host
   precisa delas. Diagnósticos ocasionais devem ser CLI/script local ou teste, não tool pública.
5. A camada de metadata/capabilities já sofreu drift. É necessário um contrato de paridade mais
   rígido entre registry, meta summaries, tests e ferramentas anunciadas remotamente.
6. O OAuth embutido tem boa estrutura, mas deve ser tratado como provedor dev/controlado, com
   política explícita de produção: limites, persistência, rotação de chaves, validação de
   redirect/CIMD, controles anti-SSRF, cache, auditoria e redaction.
7. O caminho Cloudflare deve ser tratado como plano de borda de baixa interferência: cache bypass
   para rotas dinâmicas, proteção de `/oauth/token`, proteção de `/mcp` anônimo, preservação de
   streaming, preservação de `Authorization`, `WWW-Authenticate`, `Location`, `Set-Cookie`, CORS e
   `Cache-Control`.

---

## 2. Fontes oficiais consultadas e implicações

### 2.1 MCP Authorization 2025-06-18

Referência: `https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`

Implicações principais para este repositório:

- Para transporte HTTP, quando autorização é suportada, o servidor MCP deve se alinhar à
  especificação de autorização MCP.
- O servidor MCP atua como OAuth resource server.
- O MCP server precisa de Protected Resource Metadata.
- Authorization Server Metadata também precisa existir e ser consumível por clientes.
- A descoberta deve funcionar por `authorization_servers` no protected resource metadata.
- Em 401, o servidor deve usar `WWW-Authenticate` apontando para resource metadata.
- Clients devem usar Resource Indicators; `resource` deve ser enviado tanto no authorization request
  quanto no token request.
- O servidor deve validar audience/resource dos access tokens e não aceitar tokens destinados a
  outro recurso.
- Invalid/expired tokens devem receber 401; escopo insuficiente deve ser 403.
- Redirects devem ser HTTPS ou localhost; endpoints do authorization server devem ser HTTPS em
  operação pública.
- Public clients exigem práticas como PKCE e refresh-token rotation.

Consequência para o roadmap: a auditoria OAuth deve virar uma matriz explícita de conformidade
MCP/OAuth, não apenas um smoke funcional.

### 2.2 OpenAI Apps SDK Auth / Reference

Referências:

- `https://developers.openai.com/apps-sdk/build/auth`
- `https://developers.openai.com/apps-sdk/reference`

Implicações principais:

- A integração com ChatGPT depende de metadata de autenticação e `securitySchemes` consistentes.
- Anotações como `readOnlyHint`, `destructiveHint`, `idempotentHint` e `openWorldHint` são
  importantes para reduzir fricção e melhorar o entendimento do host, mas não substituem autorização
  server-side.
- O host pode manter controles próprios de aprovação mesmo com OAuth correto. O roadmap deve separar
  claramente: OAuth reduz fricção de linking/401; annotations/plan/batch reduzem fricção de
  tool-call approval.

Consequência para o roadmap: manter minimização de tools públicas, annotations corretas, planos
read-only, applies guardados, e metadata sem drift.

### 2.3 Cloudflare Tunnel metrics e edge posture

Referências:

- `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/monitor-tunnels/metrics/`
- Cloudflare Ruleset Engine / Cache Rules / Rate Limiting / Configuration Rules devem ser usados
  como fontes oficiais em fases futuras antes de qualquer mutação real.

Implicações principais:

- O uso de métricas locais de `cloudflared` é correto como camada de observabilidade.
- Métricas devem alimentar gates pós-mudança: conexões HA, erros, latência p95/p99, response codes,
  estabilidade do túnel.
- Regras de cache/rate-limit/config precisam preservar OAuth e MCP, especialmente streaming e
  headers sensíveis.

Consequência para o roadmap: criar uma matriz de gates antes/depois de qualquer alteração
Cloudflare, com rollback e diff obrigatórios.

---

## 3. Inventário local lido / auditado

### 3.1 HTTP/MCP e auth

- `src/copilot/mcp/adapters/http.js`
  - Streamable HTTP adapter.
  - CORS gerenciado para `/mcp`, `/health`, OAuth well-known, `/oauth/*` e connector JSON.
  - Expõe protected resource metadata em `/.well-known/oauth-protected-resource` e
    `/.well-known/oauth-protected-resource/mcp`.
  - Encaminha bearer token para `createCopilotMcpServer` via `authContext`.
  - Risco/questão: CORS e `Access-Control-Allow-Origin: *` quando sem Origin precisam ser
    explicitamente documentados; para browser clients, Origin é validado, mas para non-browser
    clients não há Origin. Isso é esperado, mas deve estar nos invariantes.

- `src/copilot/mcp/control-plane/auth.js`
  - Define modos: `none-dev`, `mixed-auth`, `oauth`, `secure-mcp-tunnel`.
  - Define enforcement: `off`, `read`, `write`, `validate`, `admin`, `all`.
  - Define escopos `repo:read`, `repo:write`, `repo:validate`, `repo:admin`.
  - Constrói Protected Resource Metadata.
  - Constrói `WWW-Authenticate`.
  - Valida JWT via JWKS remoto ou static bearer.
  - Recentemente corrigido: bypass público de diagnóstico OAuth agora fica restrito a
    `config.mode === 'oauth'`.
  - Gaps: status code final da falha de autorização precisa ser auditado no ponto que converte
    `McpAuthorizationDecision` em resposta MCP/HTTP; `MCP_AUTH_SCOPE_MISSING` deve resultar em 403,
    não 401, quando aplicável.

- `src/copilot/mcp/control-plane/dev-oauth.js`
  - OAuth embutido para dev/control-plane.
  - Suporta authorization code, refresh token, DCR, CIMD, JWKS, userinfo, refresh token rotation e
    persistência por hash.
  - Já valida PKCE S256 e resource.
  - Gaps potenciais: rate limit local para `/oauth/token`, proteção contra body muito grande,
    limitação de número de dynamic clients, política de rotação de signing key, audit events
    estruturados para authorize/token/refresh, e clareza dev-vs-prod.

- `src/copilot/mcp/scripts/oauth-smoke.js`
  - Smoke OAuth completo: protected resource metadata, CORS, AS metadata, JWKS, DCR, authorization
    code, refresh token, MCP tool call, CIMD e userinfo.
  - Recentemente corrigido: `state` aleatório e validação de state; redirect absoluto/relativo com
    parsing seguro.
  - Gap: ainda pode retornar `ProbeResult.body` internamente contendo respostas brutas de token;
    hoje o relatório usa sumarizadores, mas a estrutura interna deveria ter helper explícito de
    redaction/sanitização em caso de logging futuro.

### 3.2 Registry, tools e metadata

- `src/copilot/mcp/registry.js`
  - Centraliza as tools públicas.
  - Usa `authorizeMcpToolCall`, `recordMcpToolMetric`, `appendMcpAuditEvent`, `errorResult`.
  - Atualmente tem superfície ampla, com muitas tools Cloudflare/repo/job/git.
  - Diretriz futura: não adicionar tools por padrão; preferir CLI/script/teste local.

- `src/copilot/mcp/tools/meta.js`
  - Resume capabilities e advertised tool names.
  - Já houve drift com `mcp_openai_secure_tunnel_readiness` sobrando; foi removido.
  - Gap: `meta.js` deveria derivar mais dados do registry ou de um snapshot gerado/testado, para
    evitar listas manuais divergentes.

- `src/copilot/mcp/tools/oauth-friction-audit.js`
  - Boa ferramenta read-only para diagnosticar OAuth friction, metadata alignment, TTL e escopos.
  - Gap: `publicDiagnostic: true` é reportado de modo simplificado; deveria refletir config/env real
    e modo atual.
  - Gap: precisa incorporar checks de status code 401/403, `WWW-Authenticate`, CORS preflight real e
    resource indicator em smoke ou integração.

### 3.3 Cloudflare core

- `src/copilot/mcp/cloudflare/config.js`
  - Define defaults para túnel, hostname, metrics, protocolo, state files.
  - Valida hostname sob zone.
  - Gaps: `normalizePublicHostname` usa `endsWith(zone)`, o que pode aceitar `badexampleaurelin.org`
    se não houver ponto antes da zone. Ideal: aceitar
    `hostname === zone || hostname.endsWith('.' + zone)`.
  - Gaps: `normalizeOriginUrl` remove `/mcp`, mas aceita qualquer HTTP/HTTPS; para operação segura,
    o default deve ser loopback e qualquer origem remota deve ser explicitamente marcada como risco.

- `src/copilot/mcp/cloudflare/cli.js`
  - Agrega doctor/status/smoke/up/down/restart/audit/edge.
  - Achado P0: outline aponta `parseError: VarRedeclaration`, com duas funções
    `runPlanCapabilitiesAudit` nas linhas próximas de 465 e 471.
  - Gap: CLI está grande demais. Deve ser fatiado por subcomandos em módulos menores ou pelo menos
    ter testes de parse/import.
  - Gap: comandos que retornam JSON devem padronizar exit codes, schema mínimo e redaction.

- `src/copilot/mcp/cloudflare/remote-api.js`
  - Lê env/local env file, credenciais Cloudflare, audit remote tunnel, DNS e config drift.
  - Usa redaction.
  - Gaps: precisa de matriz explícita de permissões mínimas; distinguir `permission gap` vs
    `not configured` vs `API unavailable`; reforçar testes para parse de `.env` com aspas/escape.

- `src/copilot/mcp/cloudflare/config-audit.js`
  - Audita zone settings e config rules.
  - Detecta regras dinâmicas MCP e produtos Cloudflare potencialmente interferentes.
  - Gaps: precisa consolidar as expressões de rotas dinâmicas com `edge-policy-plan`,
    `mcp-passthrough-plan` e `skip-audit` em uma fonte única.

- `src/copilot/mcp/cloudflare/skip-audit.js`
  - Distingue skip rules reais de config rules / dynamic rules.
  - Bom avanço para evitar recomendar skip amplo quando passthrough/config rule basta.
  - Gaps: precisa tornar recomendação mais determinística: quando há config passthrough equivalente,
    skip deve ser explicitamente `not-recommended`; quando faltam settings, deve recomendar config
    rule estreita antes de skip.

- `src/copilot/mcp/cloudflare/mcp-passthrough-plan.js`
  - Planeja/diff/aplica regra única de `http_config_settings` para MCP/OAuth passthrough.
  - Bom caminho de baixa interferência.
  - Gaps: tests devem cobrir equivalência de regras com ordering diferente, expressão com espaços e
    action_parameters parciais.

- `src/copilot/mcp/cloudflare/edge-policy-plan.js`
  - Planeja cache bypass, rate-limit `/oauth/token`, rate-limit `/mcp` anônimo.
  - Gap importante: usa `starts_with(http.request.uri.path, "/mcp")`, que também pega
    `/mcp-anything`; pode ser desejado, mas precisa decisão formal. Talvez usar
    `http.request.uri.path eq "/mcp"` ou path prefix com `/mcp/` se houver subpaths.
  - Gap importante: anonymous detection usa ausência de header name `authorization`; isso não
    detecta header malformado. Precisamos separar: anonymous sem header, malformed bearer, bearer
    inválido. Edge só deve tratar o primeiro; servidor deve tratar os demais.

- `src/copilot/mcp/cloudflare/edge-policy-apply.js`
  - Guarded apply com backup e confirm.
  - Bom padrão.
  - Gaps: precisa garantir que apply nunca cria regra extra se `ruleRefs` não estiver selecionado
    quando plan capacity é incerta; precisa validar diff antes e depois; precisa de snapshot ID
    obrigatório em resposta.

- `src/copilot/mcp/cloudflare/plan-capabilities-audit.js`
  - Audita capacidade de aplicar plano.
  - Já corrigido parcialmente: recomendação local não deve dizer “implementar ruleRefs” se
    `individualRuleRefApply` está implementado.
  - Gap: o servidor remoto pode estar stale; roadmap precisa incluir restart/publish gates.

- `src/copilot/mcp/cloudflare/metrics.js` e `metrics-histograms.js`
  - Lê Prometheus metrics e calcula latência p50/p95/p99, counters e response codes.
  - Gaps: histogram quantile usa o último bucket finito como total, ignorando `+Inf`. Isso pode
    subestimar/omitir total real quando há bucket infinito. Ideal: usar `_count` como total quando
    disponível e buckets finitos para interpolação; reportar `hasInfBucket`.
  - Gap: parser de Prometheus é suficiente para métricas simples, mas não suporta timestamps
    opcionais. Pode ser aceitável, mas deve ser documentado/testado.

### 3.4 Tests relevantes

- `tests/unit/copilot/mcp/test_mcp_connection_profile.spec.js`
  - Cobre OAuth profile, auth enforcement, refresh-token persistence.
  - Novo teste cobre não-bypass de diagnóstico em `mixed-auth`.

- `tests/unit/copilot/mcp/test_oauth_smoke.spec.js`
  - Novo teste cobre mismatch de state.
  - Deve ser expandido para redirect relativo, redirect sem state, token endpoint não chamado em
    mismatch, CORS failure e token response redaction.

- `tests/unit/copilot/mcp/test_mcp_registry.spec.js`
  - Detecta drift entre registry e meta advertised names.
  - Foi útil para encontrar sobra de tool removida.
  - Deve ser mantido como gate obrigatório antes de qualquer mudança em tool surface.

---

## 4. Situação atual

### 4.1 Pontos fortes

- Boa separação entre transport HTTP, auth, registry, cloudflare modules e tools.
- OAuth embutido já possui PKCE S256, refresh-token rotation persistente por hash e client store.
- Protected Resource Metadata existe em duas rotas: base e `/mcp`.
- `WWW-Authenticate` é construído com `resource_metadata`.
- Cloudflare tem plano, diff, apply guardado, backup, snapshot, remote audit, config audit, skip
  audit e metrics.
- Testes unitários MCP estão fortes: última validação observada após correções passou com 23
  arquivos e 119 testes.
- Há mecanismos de redaction em remote-api/config-audit/skip-audit.
- Há cuidado explícito para não aplicar Cloudflare sem confirmação.

### 4.2 Fragilidades sistêmicas

- Tool surface está ampla e pode crescer sem necessidade.
- Metadata ainda tem listas manuais com risco de drift.
- CLI Cloudflare tem duplicação concreta de função.
- OAuth smoke e OAuth issuer ainda misturam funções de dev e possível produção; o contrato de
  produção precisa ser explícito.
- Cloudflare path expressions estão duplicadas em vários módulos.
- Há risco de inconsistência entre local workspace e MCP remoto stale após mudanças.
- As auditorias retornam recomendações parcialmente textuais; algumas deveriam virar códigos
  estáveis, severidades e actionable IDs.
- Falta uma matriz central de invariantes: headers que nunca podem ser reescritos, rotas que nunca
  podem ser cacheadas, caminhos que podem sofrer rate-limit, produtos Cloudflare proibidos para
  `/mcp`.

---

## 5. Situação ideal proposta

A arquitetura ideal para `src/copilot/mcp/cloudflare/oauth` deve ter estes princípios:

1. **OAuth e Cloudflare separados por contratos claros**
   - OAuth decide identidade, escopo, audience e token validity.
   - Cloudflare só protege disponibilidade e não interfere em protocolo, headers ou bodies.

2. **MCP resource server estrito**
   - `resource` canônico estável.
   - `audience` validado.
   - `issuer` validado.
   - `scope` validado.
   - `WWW-Authenticate` correto.
   - 401 para ausência/invalidade de token.
   - 403 para escopo insuficiente.

3. **Authorization server dev seguro por padrão**
   - PKCE S256 obrigatório.
   - state roundtrip testado.
   - refresh token rotation one-time.
   - token hashes persistidos, nunca tokens em claro.
   - dynamic clients limitados e auditáveis.
   - client metadata document com anti-SSRF forte.
   - rate-limit local para `/oauth/token` e `/oauth/register` mesmo antes da borda.

4. **Cloudflare como camada low-friction**
   - Cache bypass para `/mcp`, `/oauth/*`, `/.well-known/*`, `/health`.
   - Config/passthrough para desabilitar features que mexem em browser/body/header.
   - Rate-limit estreito para `/oauth/token` e `/mcp` anônimo.
   - Sem challenge/browser checks em `/mcp`.
   - Sem rewrites de auth headers.
   - Métricas obrigatórias antes/depois de qualquer mudança.

5. **Observabilidade e validação integradas**
   - Smoke OAuth completo.
   - Smoke MCP completo.
   - Remote audit Cloudflare.
   - Edge audit/diff.
   - Metrics p95/p99/error-rate.
   - Registry/meta parity.
   - Typecheck e unit-mcp como gates obrigatórios.

6. **Sem tool bloat**
   - Tools públicas só para operações que o host precisa acionar durante trabalho real.
   - Diagnósticos experimentais ficam como CLI/script/testes.
   - Qualquer nova tool exige justificativa, owner, teste de registry e impacto em auth scopes.

---

## 6. Achados priorizados

### P0 — Bugs/gaps que devem ser corrigidos antes de novas features

#### P0.1 — Duplicação em `cloudflare/cli.js`

Arquivo: `src/copilot/mcp/cloudflare/cli.js`  
Evidência: outline detecta `parseError: VarRedeclaration`; duas funções `runPlanCapabilitiesAudit`
aparecem próximas às linhas 465 e 471.

Impacto:

- Pode quebrar parsing ESM.
- Pode quebrar typecheck ou execução CLI.
- Pode invalidar qualquer comando Cloudflare local.

Correção planejada:

- Remover uma das funções duplicadas.
- Rodar typecheck.
- Rodar unit-mcp.
- Adicionar teste/import smoke para `cloudflare/cli.js` ou ao menos um teste de outline/import se
  viável.

#### P0.2 — Garantir status code correto para auth failures

Arquivo provável: registry/server/transport handling em `src/copilot/mcp/registry.js` e/ou error
handling MCP.

Pergunta de auditoria:

- `MCP_AUTH_SCOPE_MISSING` vira HTTP 403 ou JSON-RPC error genérico?
- Ausência/invalidade de token inclui `WWW-Authenticate` no nível HTTP quando apropriado?

Correção planejada:

- Localizar caminho exato de `authorizeMcpToolCall` até resposta.
- Criar testes HTTP reais para: missing bearer, expired/invalid token, missing scope.
- Ajustar status/header conforme MCP/OAuth.

#### P0.3 — Corrigir validação de hostname da zone

Arquivo: `src/copilot/mcp/cloudflare/config.js`

Problema:

- `normalizePublicHostname` usa `hostname.endsWith(zone)`.
- Ideal: `hostname === zone || hostname.endsWith('.' + zone)`.

Impacto:

- Evita falso positivo para hostname parecido que termina com a string da zone, mas não está de fato
  sob ela.

#### P0.4 — Formalizar e testar state/redirect no OAuth smoke

Arquivo: `src/copilot/mcp/scripts/oauth-smoke.js`

Estado atual:

- Já corrigido para state aleatório e validação.

Completar:

- Testar redirect relativo.
- Testar ausência de state.
- Garantir que token endpoint não é chamado quando state diverge.
- Garantir que nenhum token bruto aparece no relatório final.

---

### P1 — Hardening OAuth/MCP

#### P1.1 — Matrix de conformidade MCP Authorization

Criar arquivo/testes com checklist executável:

- Protected Resource Metadata existe e tem `authorization_servers`.
- Authorization Server Metadata existe.
- `resource` é aceito em authorize e token.
- `resource` é obrigatório no smoke para authorize/token.
- `aud` do JWT é validado.
- `iss` é validado.
- scopes são validados.
- 401 inclui `WWW-Authenticate`.
- missing scope vira 403.
- PKCE S256 obrigatório.
- refresh token rotation one-time.
- redirect URI HTTPS ou localhost.
- token não é logado.

#### P1.2 — Rate-limit local do OAuth dev issuer

Arquivos: `dev-oauth.js`, testes.

Objetivo:

- Mesmo com Cloudflare desativado, `/oauth/token`, `/oauth/register` e `/oauth/authorize` devem ter
  proteção básica local por IP/cliente.
- Não precisa ser perfeito; pode ser janela fixa em memória para dev.

Subfases:

1. Implementar helper in-memory com limites conservadores.
2. Adicionar resposta `429` com JSON OAuth-friendly.
3. Testar burst em `/oauth/token`.
4. Expor status resumido em OAuth friction audit, sem tokens.

#### P1.3 — Limites de body e client store

Arquivos: `dev-oauth.js`.

Objetivo:

- `readRequestBody` deve ter limite máximo de bytes.
- `registeredClients` persistido deve ter limite máximo e pruning por idade.
- `clientMetadataDocumentCache` deve ter TTL e limite de entradas.

#### P1.4 — Key rotation policy

Arquivos: `dev-oauth.js`, `oauth-friction-audit.js`.

Objetivo:

- Documentar e auditar idade do signing key.
- Implementar rotação manual segura com overlap de JWKS, se necessário.
- Evitar quebrar tokens imediatamente sem plano.

---

### P2 — Cloudflare policy consolidation

#### P2.1 — Fonte única de rotas dinâmicas

Criar módulo local, sem tool pública, por exemplo:

- `src/copilot/mcp/cloudflare/routes.js`

Conteúdo planejado:

- paths canônicos: `/mcp`, `/oauth/`, `/.well-known/`, `/health`, `/chatgpt-connector.json`.
- expressões Cloudflare canônicas.
- funções para `eq`, `starts_with`, host expression.
- testes de snapshots de expressão.

Consumidores:

- `edge-policy-plan.js`
- `edge-policy-apply.js`
- `config-audit.js`
- `skip-audit.js`
- `mcp-passthrough-plan.js`
- `origin-request-profile.js`

#### P2.2 — Revisar semântica de `/mcp` prefix

Decisão necessária:

- O MCP endpoint é exatamente `/mcp` ou inclui subpaths?
- Se é exato, Cloudflare expression deve usar `http.request.uri.path eq "/mcp"`.
- Se subpaths são intencionais, usar `path eq "/mcp" or starts_with(path, "/mcp/")`.

#### P2.3 — Edge apply com capacity-aware behavior

Objetivo:

- Se rate-limit capacity é incerta, apply deve exigir `ruleRefs` explícito e bloquear apply amplo.
- Resposta deve conter snapshot/backup ID obrigatório.
- Pós-apply deve rodar ou recomendar gates explícitos.

#### P2.4 — Config passthrough como preferência formal

Objetivo:

- `skip-audit` deve recomendar config rule estreita antes de skip.
- Se passthrough equivalente existe, skip broad deve ser `not-recommended`.
- Tests devem cobrir cenários: sem regra, regra equivalente, skip broad, config conflicting.

---

### P3 — Observabilidade e gates

#### P3.1 — Corrigir quantile de histogram

Arquivo: `metrics-histograms.js`.

Problema:

- Quantile usa último bucket finito como total; ideal é usar `_count` ou bucket `+Inf` quando
  disponível.

Correção planejada:

- Passar count total para helper.
- Reportar quando bucket finito não cobre total.
- Adicionar testes com bucket `+Inf`.

#### P3.2 — Gates pós-mudança Cloudflare

Definir objeto estável:

- tunnel healthy.
- 4 HA connections ou threshold configurável.
- request error rate <= limite.
- p95/p99 não regrediu >10–20%.
- OAuth smoke passa.
- MCP smoke passa.
- Edge diff sem gaps inesperados.

#### P3.3 — Persistir baseline de métricas

Criar snapshot local antes/depois:

- `src/copilot/.ai/cloudflare/metrics-baselines/*.json`.
- Não expor como tool pública inicialmente.

---

### P4 — Registry, metadata e tool-surface governance

#### P4.1 — Policy anti-tool-bloat

Criar seção em docs e teste simples:

- Nova tool exige justificativa.
- Nova tool exige annotations.
- Nova tool exige auth scope esperado.
- Nova tool exige entrada em teste de registry.
- Diagnóstico ocasional deve ser CLI/script.

#### P4.2 — Derivar metadata de registry

Objetivo:

- Reduzir listas manuais em `meta.js`.
- `getAdvertisedMcpToolNames` deve ser derivado ou testado contra registry.
- Evitar drift como o que ocorreu com Secure Tunnel.

#### P4.3 — Scope matrix de tools

Gerar relatório local/teste:

- tool name.
- read/write/validate/admin.
- destructive/idempotent/openWorld.
- public/noauth/oauth2.
- justificativa.

---

### P5 — OAuth production posture

#### P5.1 — Separar dev issuer de production issuer

Estado atual:

- `dev-oauth.js` é robusto, mas o nome e comportamento indicam issuer dev.

Plano:

- Documentar claramente: dev issuer é para conector controlado, não IdP multi-tenant público.
- Se produção for objetivo, planejar external IdP ou issuer hardened com storage melhor, key
  rotation e admin UI mínima.

#### P5.2 — External issuer compatibility

Testar:

- Auth0/Okta/Cloudflare Access/OIDC genérico só como planos, sem pagamento.
- DCR ausente: caminho de client_id manual.
- CIMD: compatibilidade com ChatGPT connector.

#### P5.3 — Secure MCP Tunnel como linha separada, não default

Manter:

- Não ativar se exigir pagamento ou upgrade.
- Não substituir Cloudflare enquanto custo/capacidade não for confirmado.
- Auditoria local pode existir, mas não como tool pública.

---

## 7. Roadmap por faixas, fases e subfases

### Faixa 0 — Estabilização imediata e remoção de inconsistências

#### Fase 0.1 — Corrigir CLI duplicado

- Subfase 0.1.1: remover duplicata de `runPlanCapabilitiesAudit`.
- Subfase 0.1.2: rodar `typecheck`.
- Subfase 0.1.3: rodar `unit-mcp`.
- Subfase 0.1.4: criar teste/import smoke para CLI Cloudflare.

Critério de aceite:

- Sem `parseError: VarRedeclaration` no outline.
- Typecheck passa.
- Unit MCP passa.

#### Fase 0.2 — Fechar drift tool/meta

- Subfase 0.2.1: procurar referências residuais a Secure Tunnel tool pública.
- Subfase 0.2.2: garantir que `CAPABILITIES_VERSION` só muda quando tool pública muda.
- Subfase 0.2.3: reforçar teste de registry/meta.

Critério de aceite:

- Registry e advertised names idênticos.
- Nenhuma tool experimental anunciada.

#### Fase 0.3 — Corrigir validação de hostname Cloudflare

- Subfase 0.3.1: ajustar `normalizePublicHostname`.
- Subfase 0.3.2: adicionar testes para `mcp.aurelin.org`, `aurelin.org`, `evil-aurelin.org` e
  `evil.aurelin.org.attacker.tld`.

Critério de aceite:

- Somente hostname igual à zone ou subdomínio real passa.

---

### Faixa 1 — OAuth correctness e segurança do resource server

#### Fase 1.1 — HTTP auth behavior matrix

- Subfase 1.1.1: localizar conversão final de `McpAuthorizationDecision` em resposta.
- Subfase 1.1.2: teste HTTP missing bearer.
- Subfase 1.1.3: teste HTTP invalid bearer.
- Subfase 1.1.4: teste HTTP missing scope.
- Subfase 1.1.5: garantir `WWW-Authenticate` em 401.
- Subfase 1.1.6: garantir 403 para insufficient scope.

Critério de aceite:

- Comportamento compatível com MCP/OAuth.

#### Fase 1.2 — OAuth smoke hardening

- Subfase 1.2.1: teste redirect relativo.
- Subfase 1.2.2: teste redirect sem state.
- Subfase 1.2.3: teste token endpoint não chamado quando state diverge.
- Subfase 1.2.4: redaction explícita de token probes.
- Subfase 1.2.5: teste CORS failure.

Critério de aceite:

- Smoke não passa em fluxos inseguros e não expõe token bruto.

#### Fase 1.3 — Dev OAuth issuer hardening

- Subfase 1.3.1: limitar tamanho de body.
- Subfase 1.3.2: rate-limit in-memory para token/register/authorize.
- Subfase 1.3.3: limitar dynamic clients.
- Subfase 1.3.4: TTL para CIMD cache.
- Subfase 1.3.5: auditoria estruturada de token/refresh/register sem segredo.

Critério de aceite:

- Issuer dev resiste a abuso básico mesmo sem Cloudflare.

---

### Faixa 2 — Cloudflare policy e não-interferência

#### Fase 2.1 — Rotas e expressões canônicas

- Subfase 2.1.1: criar módulo local de rotas/expressões.
- Subfase 2.1.2: migrar plan/diff/audit para usar módulo.
- Subfase 2.1.3: snapshot tests de expressões.

Critério de aceite:

- Uma única fonte para path/host expressions.

#### Fase 2.2 — Cache/config/skip alignment

- Subfase 2.2.1: formalizar cache bypass dinâmico.
- Subfase 2.2.2: formalizar passthrough config rule.
- Subfase 2.2.3: tornar skip fallback raro e explícito.
- Subfase 2.2.4: testes de equivalência de config rules.

Critério de aceite:

- Auditorias não dão recomendações contraditórias.

#### Fase 2.3 — Rate-limit seguro

- Subfase 2.3.1: revisar `/oauth/token` thresholds.
- Subfase 2.3.2: revisar `/mcp` anônimo.
- Subfase 2.3.3: bloquear apply amplo com capacity incerta.
- Subfase 2.3.4: exigir backup/snapshot ID.

Critério de aceite:

- Nenhuma regra extra é criada às cegas.

---

### Faixa 3 — Observabilidade, gates e regressão

#### Fase 3.1 — Métricas robustas

- Subfase 3.1.1: corrigir histogram quantile.
- Subfase 3.1.2: suportar timestamps Prometheus opcionais ou documentar limitação.
- Subfase 3.1.3: adicionar tests para buckets `+Inf`.

Critério de aceite:

- p95/p99 mais confiáveis.

#### Fase 3.2 — Gate bundle local

- Subfase 3.2.1: definir schema de gate.
- Subfase 3.2.2: combinar metrics, remote audit, edge diff, oauth smoke e mcp smoke.
- Subfase 3.2.3: persistir baseline before/after.

Critério de aceite:

- Toda mudança Cloudflare tem diagnóstico antes/depois.

---

### Faixa 4 — Governança de tools e approvals

#### Fase 4.1 — Anti-tool-bloat formal

- Subfase 4.1.1: documentar política.
- Subfase 4.1.2: teste que falha se tool nova não tiver justificativa em manifest local.
- Subfase 4.1.3: mover diagnósticos experimentais para CLI/scripts.

Critério de aceite:

- Nenhuma tool nova entra por acidente.

#### Fase 4.2 — Annotation matrix

- Subfase 4.2.1: gerar matriz tool -> annotations -> scope.
- Subfase 4.2.2: testar destructive/admin.
- Subfase 4.2.3: revisar tools write para batch/plan-first.

Critério de aceite:

- Menos prompts de aprovação sem reduzir segurança.

---

### Faixa 5 — Production posture opcional

#### Fase 5.1 — Decisão de issuer

- Subfase 5.1.1: decidir dev issuer hardened vs external IdP.
- Subfase 5.1.2: comparar sem custo pago obrigatório.
- Subfase 5.1.3: documentar caminho escolhido.

#### Fase 5.2 — Secure MCP Tunnel como pesquisa controlada

- Subfase 5.2.1: manter auditoria local sem tool pública.
- Subfase 5.2.2: confirmar custo/plan antes de qualquer uso.
- Subfase 5.2.3: não ativar se pago/upgrade.

---

## 8. Sequência recomendada para a próxima rodada de implementação

1. Corrigir duplicação em `cloudflare/cli.js`.
2. Typecheck + unit-mcp.
3. Corrigir `normalizePublicHostname`.
4. Adicionar testes de hostname.
5. Expandir testes OAuth smoke para redirect relativo/state/token redaction.
6. Auditar status code 401/403 e `WWW-Authenticate` em chamadas HTTP reais.
7. Criar módulo de rotas/expressões Cloudflare canônicas.
8. Migrar plan/diff/audit para usar esse módulo.
9. Corrigir histogram quantile.
10. Criar policy anti-tool-bloat em docs/test manifest.

---

## 9. Critérios globais de sucesso

- `npm run typecheck:strict:src.copilot` passa.
- `npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp` passa.
- Nenhum parse error em outline/import de arquivos centrais.
- Registry e metadata em paridade.
- Nenhuma tool pública nova sem justificativa.
- OAuth smoke falha em fluxos inseguros.
- Cloudflare plans são deterministicamente derivados de rotas canônicas.
- Edge apply não executa sem backup, confirm e seleção segura.
- Métricas de túnel suportam gates antes/depois.
- Documentação separa claramente OAuth linking, host approval prompts e Cloudflare edge protections.

---

## 10. Itens explicitamente fora de escopo nesta etapa

- Mutar Cloudflare.
- Criar nova tool pública MCP.
- Ativar OpenAI Secure MCP Tunnel.
- Pagar por recurso, plano ou add-on.
- Fazer restart/publicação do MCP remoto.
- Trocar Cloudflare por outra camada.
- Migrar para IdP externo sem decisão posterior.

---

## 11. Observações finais

O projeto já tem maturidade significativa, mas a próxima evolução deve ser menos “mais ferramentas”
e mais “contratos testáveis”. O ponto central é transformar OAuth/Cloudflare/MCP em uma fronteira
formal:

- OAuth decide quem pode fazer o quê.
- MCP valida e aplica escopos.
- Cloudflare protege disponibilidade e não interfere no protocolo.
- Registry expõe só o necessário.
- Scripts locais e testes fazem diagnóstico profundo sem aumentar a superfície pública.

O primeiro passo de implementação posterior deve ser pequeno e cirúrgico: remover a duplicação em
`cloudflare/cli.js`, validar, e só depois avançar para hardening OAuth e consolidação Cloudflare.
