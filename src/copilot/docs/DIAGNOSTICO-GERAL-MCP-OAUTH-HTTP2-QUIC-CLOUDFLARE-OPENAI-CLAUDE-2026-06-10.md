# Diagnóstico geral MCP/OAuth/HTTP2-QUIC/Cloudflare/OpenAI/Claude — WORKSPACE

Data: 2026-06-10  
Workspace: `/workspaces/chatgpt-docker-puppeteer`  
Branch/HEAD observado: `main` / `e69ec3d8`  
Documento gerado por auditoria read-mostly do conector `WORKSPACE`, com validação controlada
`mcp-full` e consulta a documentações oficiais atuais.

---

## 1. Sumário executivo

O sistema está em um patamar funcional alto: o conector remoto permanente
`https://mcp.aurelin.org/mcp` está pronto para uso, com OAuth ligado em modo obrigatório, túnel
Cloudflare nomeado, transporte QUIC, origem HTTPS/HTTP2, regras Cloudflare de bypass de cache para
rotas dinâmicas e proteção de `/oauth/token`. A superfície MCP é ampla e bem categorizada: 96 tools
anunciadas, 74 read-only, 20 bounded-write, 2 destructive e 0 open-world. A pontuação interna de
autonomia é `96/A`.

Apesar disso, a situação não deve ser considerada “perfeita” nem “fechada”. A auditoria encontrou
problemas e oportunidades importantes:

1. **Validação CI local falhando por lint**: o `mcp-full` passou no typecheck, mas falhou no lint
   por dois imports `Cloudflare` não usados em `src/copilot/mcp/cloudflare/config-audit.js` e
   `src/copilot/mcp/cloudflare/edge-audit.js`.
2. **Estado Git sujo**: há alterações não commitadas em Cloudflare, runtime-health, tunnel-status,
   TTL cache e testes, além de arquivos MD não rastreados.
3. **Runtime “degraded” por ausência de smoke in-process**: o sistema está `ok`, mas o health report
   marca `degraded` porque não havia resultado registrado de `mcp_smoke_workspace` no processo.
4. **Latência ainda pouco instrumentada por requisição MCP real**: há métricas Cloudflare/QUIC e
   métricas por tool, mas faltam SLOs formais, histograma end-to-end por operação JSON-RPC,
   `cf-ray`, `colo`, payload size, compressão, versão de protocolo e custo de autenticação por
   chamada.
5. **QUIC atual parece saudável, mas precisa de benchmark comparativo**: QUIC está ativo, com 4
   conexões HA, RTT suavizado de ~30 ms e erro de request 0; porém há logs recentes de reconexão e
   erros antigos de TLS handshake com a origem.
6. **Cloudflare edge tem boa blindagem, mas gaps residuais**: há bypass de cache e passthrough para
   MCP/OAuth, mas ainda não há rate limit explícito de `/mcp` na borda; o fallback de origem está
   ativo para anônimo. Zone-wide Browser Integrity Check, Rocket Loader, RUM e Email Obfuscation
   aparecem ligados, embora uma regra route-scoped mitigue parte disso.
7. **OAuth está muito bom para ChatGPT, mas precisa de governança**: issuer, PRM, JWKS, PKCE S256,
   DCR/CIMD, resource parameter e refresh-token rotation estão alinhados. Ainda assim, a loja local
   já tem dezenas de clients/tokens e merece política de prune, auditoria e perfis de escopo menos
   “max-power” para usos fora do ChatGPT principal.
8. **MCP Streamable HTTP está robusto, mas falta avançar em sessões/resumability**: o endpoint
   `/mcp` é central, com headers de versão e CORS restrito. Porém a política atual é stateless;
   `Mcp-Session-Id`, GET SSE durável, `Last-Event-ID` e replay devem virar uma faixa experimental
   separada.
9. **OpenAI Apps SDK ainda não é explorado como camada de UI**: não há widget resource, CSP
   aplicável, `outputTemplate` ou shapes de Company Knowledge. Isso não é bug; é oportunidade
   funcional.
10. **Claude é compatível em tese, mas precisa de perfil próprio**: o servidor público e OAuth são
    adequados para remote MCP, mas Claude deve ter smoke, instruções, escopos, limites e
    recomendações próprias, especialmente porque o ecossistema Claude enfatiza review de permissões
    e cautela com write-tools.

Conclusão: a prioridade não é “reconstruir” o sistema. A prioridade é **estabilizar lint/validação,
formalizar SLOs, benchmarkar transporte, limpar gaps Cloudflare, evoluir observabilidade por chamada
e criar perfis de compatibilidade ChatGPT/Claude/OpenAI Apps SDK sem degradar a segurança atual**.

---

## 2. Pré-auditoria: objetivo, plano e execução

### 2.1 Objetivo da pré-auditoria

Antes da auditoria profunda, a pré-auditoria respondeu a quatro perguntas:

1. O workspace está em estado confiável para diagnóstico?
2. O conector está operacional de ponta a ponta?
3. Quais áreas têm maior risco: protocolo MCP, OAuth, Cloudflare, transporte, latência,
   compatibilidade OpenAI/Claude, código ou validação?
4. Qual roteiro de auditoria maximiza evidência e minimiza mutação acidental?

### 2.2 Plano detalhado da auditoria

| Etapa | Pergunta                      | Ferramentas/Fontes                                                                                                           | Resultado esperado                                       |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A0    | Estado do repo                | `repo_status`, árvore raiz                                                                                                   | Dirty state, arquivos alterados, arquivos novos          |
| A1    | Superfície MCP                | `mcp_capabilities_summary`, `mcp_tools_status`, `mcp_autonomy_power_score`                                                   | Tools, escopos, anotações, risco, autonomia              |
| A2    | Runtime                       | `mcp_runtime_health`, `mcp_post_restart_readiness`, `project_doctor`                                                         | Saúde local, Node, processos, index, métricas            |
| A3    | Túnel e transporte            | `mcp_tunnel_status`, `mcp_cloudflare_metrics_snapshot`, `mcp_cloudflare_transport_benchmark_plan`                            | QUIC/HTTP2, HA connections, RTT, plano de benchmark      |
| A4    | Cloudflare edge/config        | `mcp_cloudflare_config_audit`, `mcp_cloudflare_remote_audit`, `mcp_cloudflare_edge_audit`, `mcp_cloudflare_edge_policy_diff` | Cache, WAF, rate-limit, transforms, originRequest        |
| A5    | OAuth                         | `mcp_auth_profile`, `mcp_oauth_issuer_diagnostics`, `mcp_oauth_friction_audit`, `mcp_connection_readiness`                   | PRM, issuer metadata, JWKS, scopes, reauth risk          |
| A6    | Compatibilidade OpenAI/Claude | `chatgpt_connector_profile`, `claude_connector_profile`, docs oficiais OpenAI/Anthropic                                      | Requisitos de conector e gaps funcionais                 |
| A7    | Código fonte                  | árvore `src/copilot/mcp`, busca textual, leitura seletiva                                                                    | Arquitetura adapters/http/cloudflare/control-plane/tools |
| A8    | Validação                     | `mcp_validation_plan`, `mcp_run_safe_validation_suite`, `job_get_summary`, `job_get_output`                                  | Estado real de CI local                                  |
| A9    | Documentação oficial          | MCP, RFCs OAuth, Cloudflare, OpenAI Apps SDK, Claude                                                                         | Critérios normativos para situação ideal                 |

### 2.3 Documentações oficiais consultadas

- MCP 2025-06-18 — Transports:
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- MCP 2025-06-18 — Authorization:
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>
- MCP — Security Best Practices:
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices>
- RFC 9728 — OAuth 2.0 Protected Resource Metadata: <https://www.rfc-editor.org/rfc/rfc9728.html>
- RFC 8414 — OAuth 2.0 Authorization Server Metadata: <https://www.rfc-editor.org/rfc/rfc8414.html>
- RFC 7591 — OAuth 2.0 Dynamic Client Registration Protocol:
  <https://www.rfc-editor.org/rfc/rfc7591.html>
- Cloudflare Tunnel — run parameters:
  <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/>
- Cloudflare Tunnel — origin parameters:
  <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/>
- OpenAI Apps SDK — Authentication: <https://developers.openai.com/apps-sdk/build/auth>
- OpenAI Apps SDK — Reference: <https://developers.openai.com/apps-sdk/reference>
- Anthropic/Claude — Custom connectors using remote MCP:
  <https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>
- Anthropic/Claude Code — MCP: <https://code.claude.com/docs/en/mcp>
- Anthropic API docs — MCP connector:
  <https://platform.claude.com/docs/en/agents-and-tools/mcp-connector>

---

## 3. Situação atual — inventário e diagnóstico

### 3.1 Estado do repositório

O repo está em `main`, HEAD `e69ec3d8`, com alterações não commitadas. Foram observadas mudanças em:

- `.vscode/settings.json`
- `src/copilot/mcp/cloudflare/config-audit.js`
- `src/copilot/mcp/cloudflare/edge-audit.js`
- `src/copilot/mcp/cloudflare/remote-api.js`
- `src/copilot/mcp/control-plane/ttl-cache.js`
- `src/copilot/mcp/tools/cloudflare-config.js`
- `src/copilot/mcp/tools/cloudflare-edge.js`
- `src/copilot/mcp/tools/cloudflare-post-change-gates.js`
- `src/copilot/mcp/tools/runtime-health.js`
- `src/copilot/mcp/tools/tunnel-status.js`
- testes unitários de Cloudflare smoke, post-change gates e TTL cache

Arquivos não rastreados relevantes:

- `DIAGNOSTICO-MCP-WORKSPACE-2026-06-09.md`
- `conversa-2026-06-08T15-52-41.md`
- `src/copilot/ANALISE-FERRAMENTAS-FALTANTES.md`
- `src/copilot/docs/DIAGNOSTICO-MCP-OAUTH-CLOUDFLARE-2026-06-10.md`

Diagnóstico: o sistema está operável, mas qualquer roadmap deve começar por uma faixa de higiene:
corrigir lint, registrar/commit ou separar alterações, e preservar snapshots antes de mudanças
Cloudflare.

### 3.2 Superfície MCP

Estado observado:

- Protocolo interno: `workspace-mcp/0.3.0`
- Capabilities version: `35`
- Tools anunciadas: `96`
- Read-only: `74`
- Bounded-write: `20`
- Destructive: `2`
- Open-world: `0`
- Plan-only: `12`
- Autonomy score: `96/A`
- Output schemas e security metadata: cobertura reportada como `1.0`

Categorias principais:

- Leitura de repo: `repo_tree`, `repo_read_file`, `repo_search_text`, `repo_file_outline`,
  `repo_symbol_search`, etc.
- Índice local: `repo_index_build`, `repo_index_search`, `repo_find_imports`,
  `repo_find_orphan_imports`.
- Escrita controlada: `repo_patch_plan` -> `repo_apply_patch`, `repo_create_file_plan` ->
  `repo_create_file`, quarantine/restore, batch ops.
- Git: status, diff, log, branch.
- Validação: typecheck, lint, unit, suites MCP, dashboard e jobs.
- Runtime/Cloudflare/OAuth: health, tunnel, metrics, audits, policy plan/diff/apply.
- Conexão: ChatGPT connector profile, Claude connector profile, OAuth diagnostics.
- Copilot SDK/session: list/get sessions.

Ponto forte: a divisão read-only/bounded/destructive e o padrão plan-first são adequados para
minimizar prompts de host e risco operacional.

Gaps:

- Ainda há 2 tools marcadas destructive (`repo_apply_file_batch` e `repo_remove_file`).
  `repo_apply_file_batch` deveria ser reavaliada: ela contém operações reversíveis e irreversíveis;
  talvez deva ser subdividida em `batch_safe_ops` e `batch_destructive_ops` para reduzir atrito sem
  mascarar risco.
- `job_cancel` aparece como bounded-write com `repo:admin`; deve continuar fora de remembered
  approval.
- Para Claude/Research, recomenda-se perfil de tools com write-tools desabilitadas por padrão.

### 3.3 Runtime local

Estado observado:

- Node: `v24.15.0`
- Plataforma: Linux
- MCP HTTP process vivo
- `cloudflared` vivo
- Local health `200`
- Public health `200`
- Index disponível e fresh:
  - arquivos: `1333`
  - símbolos: `9632`
  - chunks: `2487`
- Runtime status: `degraded`, não por falha crítica, mas por ausência de resultado in-process de
  `mcp_smoke_workspace`.

Métricas internas recentes:

- Chamadas observadas: 5 no snapshot inicial de runtime health.
- Erros: 0.
- Fase handler média: ~80 ms.
- Fase authorization média: ~35 ms.
- `repo_root_tree` handler: ~346 ms em uma chamada ampla.
- `repo_status` authorization: ~174 ms, handler ~49 ms.
- JWKS cache: TTL 600s, com hits observados.

Diagnóstico: o runtime é saudável, mas precisa de:

1. smoke in-process obrigatório após restart;
2. métricas por rota/operação MCP, não apenas por tool;
3. decomposição mais fina da latência de autorização, serialização de resultado e transporte;
4. alertas para log noise de tunnel e TLS handshake.

### 3.4 MCP HTTP/2+/Streamable HTTP

O código aponta para uma arquitetura adequada:

- endpoint canônico `/mcp`;
- adapter HTTP compartilhado para HTTP/1.1 e HTTP/2 compatibility;
- CORS route-specific e origin-restricted;
- headers expostos: `Mcp-Session-Id`, `MCP-Protocol-Version`, `WWW-Authenticate`, `X-MCP-Origin-*`;
- política de keep-alive e request timeout;
- rate limit anônimo na origem;
- PRM e OAuth metadata expostos;
- versão de protocolo default observada no código: `2025-11-25`, com suporte a `2025-06-18` e
  fallback `2025-03-26`.

A especificação MCP 2025-06-18 exige que Streamable HTTP use um único endpoint que suporte POST e
GET, com `Accept: application/json` e `text/event-stream` para POST, e `text/event-stream` para GET
quando SSE for suportado. Ela também exige validação de `Origin`, autenticação adequada para
conexões e uso do header `MCP-Protocol-Version` em requisições HTTP subsequentes.

Gap relevante: a política atual de sessão é stateless; o próprio código declara que sessões stateful
estão desabilitadas para preservar compatibilidade com body parsing do SDK. Isso é defensável, mas
deixa incompletas as capacidades avançadas de:

- `Mcp-Session-Id` persistente;
- GET SSE durável;
- `Last-Event-ID`;
- replay/resumability;
- notificações server-to-client de longa duração.

Recomendação: manter stateless como baseline de produção e criar uma faixa experimental separada
para sessões/resumability, com feature flag e canary por cliente.

### 3.5 OAuth e autorização

Estado observado:

- Auth mode: `oauth`
- Enforcement: `all`
- PRM: `https://mcp.aurelin.org/.well-known/oauth-protected-resource`
- Issuer: `https://mcp.aurelin.org`
- Audience esperada: `https://mcp.aurelin.org`
- Accepted audiences: host e `/mcp`, com e sem trailing slash
- JWKS: configurado em `/oauth/jwks.json`
- Static bearer: desativado
- Initial scopes: `repo:read`, `repo:write`, `repo:validate`, `repo:admin`
- Metadata do authorization server: pronta
- PKCE: `S256`
- Grant types: `authorization_code`, `refresh_token`
- Token endpoint auth methods: `none`, `private_key_jwt`
- DCR/CIMD: suportados
- Resource parameter: suportado
- Reauth risk: baixo
- Access token TTL: 3600s
- Refresh token TTL: 604800s
- Refresh token rotation: one-time rotating persistent
- Tokens persistidos: apenas hashes
- Contagem observada: 117 refresh tokens e 40 dynamic clients

Diagnóstico: a implementação está fortemente alinhada a MCP Authorization, RFC 9728 e OpenAI Apps
SDK Auth. O servidor publica PRM, authorization server metadata, scopes, JWKS, PKCE S256, e usa
`WWW-Authenticate` com `resource_metadata`.

Gaps/opções de hardening:

1. Criar política de prune para dynamic clients e refresh tokens antigos.
2. Gerar dashboard de clients/tokens por idade, último uso, origem e escopos — sem expor token real.
3. Separar perfis de escopo:
   - `chatgpt-max-autonomy`: escopos máximos para este uso atual.
   - `chatgpt-read-validate`: leitura + validação.
   - `claude-safe`: leitura e validação, sem write/admin por padrão.
   - `public-diagnostics`: apenas health/OAuth/metadata.
4. Considerar `private_key_jwt` como modo preferencial para clients confidenciais futuros.
5. Avaliar DPoP apenas quando houver necessidade real; adiciona complexidade e pode reduzir
   compatibilidade.
6. Evitar Cloudflare Access ou outro desafio interativo na frente de `/mcp`, salvo redesign completo
   do auth flow.

### 3.6 Cloudflare Tunnel e transporte QUIC/HTTP2

Estado observado:

- Modo: named-permanent
- Tunnel name: `workspace-mcp-dev`
- Hostname: `mcp.aurelin.org`
- URL MCP: `https://mcp.aurelin.org/mcp`
- Origin URL: `https://127.0.0.1:3333`
- Cloudflare tunnel transport: `quic`
- Origin transport: `http2`
- `http2Origin`: true
- `originServerName`: `mcp.aurelin.org`
- `noTLSVerify`: false
- `disableChunkedEncoding`: false
- `connectTimeout`: 5s
- keepAlive timeout: 1m30s
- keepAlive connections: 100
- tcpKeepAlive: 30s
- Remote tunnel status: healthy
- HA connections: 4
- Colos observados: GRU08, GRU13, GRU11, GRU21
- Cloudflared version: `2026.5.2`
- QUIC RTT suavizado: ~30 ms
- QUIC latest RTT: ~44 ms
- Request error rate: 0
- RPC client latency observada: média ~385 ms, p50 ~350 ms, p95 ~1170 ms, p99 ~1314 ms

Pontos fortes:

- Origem HTTPS com HTTP/2 está habilitada, alinhada ao parâmetro `http2Origin` da Cloudflare.
- `disableChunkedEncoding=false` preserva framing/streaming.
- QUIC com 4 conexões HA e RTT baixo é adequado para latência em São Paulo/GRU.
- `connectTimeout=5s` evita travas longas quando a origem cai.

Riscos/gaps:

- Há logs recentes de `accept stream listener encountered a failure` e `Connection terminated` no
  momento de restart/reconexão.
- Há logs antigos de TLS handshake timeout com a origem.
- O plano de benchmark considera `auto` como candidato importante porque tenta QUIC e cai para
  HTTP/2 se UDP falhar.
- O candidato HTTP/2 deve ser mantido como rollback de TCP, especialmente para ambientes com UDP
  ruim.

Recomendação: manter QUIC como baseline enquanto requestErrorRate=0, HA=4 e smoke passa. Rodar
benchmark controlado `quic` vs `auto` vs `http2`, com pelo menos 5 amostras por protocolo, medindo
tool calls reais e não apenas métricas de túnel.

### 3.7 Cloudflare edge/config

Estado observado:

- Cache bypass ativo para `/mcp`, `/oauth/*`, `/.well-known/*` e `/health`.
- Config rule MCP/OAuth passthrough ativa, com:
  - BIC off para rotas dinâmicas;
  - email obfuscation off;
  - response_body_buffering none;
  - rocket_loader off.
- Rate limit ativo para `/oauth/token`.
- Não há regra explícita de rate-limit para `/mcp` na borda.
- Fallback de rate limit anônimo na origem está ativo: janela 10s, 40 requests/window, até 10.000
  buckets.
- WAF/challenge amplo não detectado para `/mcp`.
- Sensitive header transform não detectado.

Zone settings que ainda geram warnings:

- Browser Integrity Check zone-wide: on.
- Security Level: medium.
- Rocket Loader: on.
- RUM: on.
- Email Obfuscation: on.
- Bot Fight Mode: não audível/undefined.
- Zaraz: não audível/not found.

Diagnóstico: a regra route-scoped reduz impacto nas rotas MCP/OAuth, mas ainda há ruído operacional.
A situação ideal é que API routes sejam tratadas como API routes, não como browser pages.

Recomendação de edge:

1. Manter bypass de cache para runtime e token routes.
2. Avaliar short-cache apenas para discovery GET-only: `/.well-known/*` e `/chatgpt-connector.json`,
   com TTL curto e rollback simples.
3. Avaliar desabilitar compressão apenas para `/mcp` se benchmark confirmar ganho em `tools/list` e
   JSON-RPC pequeno/médio.
4. Não transformar `Authorization`, `WWW-Authenticate`, `Set-Cookie`, `Location`, `Content-Type`,
   `Cache-Control` ou CORS.
5. Adicionar rate limit edge apenas para `/oauth/token` e `/mcp` sem `Authorization`, sem limitar
   sessões autenticadas ChatGPT/Claude.
6. Nunca adicionar managed challenge, JS challenge, Under Attack ou Cloudflare Access interativo em
   `/mcp`.

### 3.8 OpenAI / ChatGPT / Apps SDK

Estado observado:

- Perfil ChatGPT: `chatgpt-max-autonomy-permanent-cloudflare-oauth`.
- Connector URL: `https://mcp.aurelin.org/mcp`.
- Auth: OAuth.
- A implementação já publica PRM, authorization server metadata, `securitySchemes`, scopes e
  challenge.
- `mcp_apps_sdk_readiness` não encontrou widget resource, CSP, frame domains, widget description ou
  output template.
- Company Knowledge shapes não foram detectados.

Diagnóstico: ChatGPT connector está operacional. Apps SDK UI ainda é uma oportunidade, não um
requisito de estabilidade. O ganho principal de curto prazo vem de latência, observabilidade e
metadata per-tool, não de widgets.

O que a documentação OpenAI reforça:

- ChatGPT precisa de PRM em `.well-known/oauth-protected-resource` ou de `WWW-Authenticate`
  apontando para PRM.
- O servidor deve publicar metadata OAuth, ecoar o `resource` parameter, suportar PKCE S256 e
  validar issuer/audience/scopes/expiração no servidor.
- Para tool-level OAuth UI, é preciso combinar `securitySchemes` por tool, PRM e
  `_meta["mcp/www_authenticate"]`/`WWW-Authenticate` em erro de auth.
- mTLS OpenAI pode virar camada opcional futura para autenticar o cliente ChatGPT no nível TLS,
  mantendo OAuth para usuário final.

Roadmap OpenAI:

1. Manter MCP connector como núcleo.
2. Adicionar `read-only dashboard widgets` só quando houver casos claros: health dashboard,
   validation dashboard, Cloudflare tunnel panel.
3. Adicionar `outputTemplate` e CSP apenas para componentes reais.
4. Criar adapter `search/fetch` se quiser compatibilidade com Company Knowledge-like workflows.
5. Avaliar mTLS OpenAI apenas depois de SLOs e OAuth estáveis.

### 3.9 Claude / Anthropic

Estado observado:

- Existe `claude_connector_profile` no MCP.
- O servidor remoto público e OAuth são compatíveis com o modelo de custom connector.
- O endpoint é público via Cloudflare, requisito para Claude cloud-based remote MCP.

O que a documentação Claude reforça:

- Custom connectors remote MCP estão em beta e são acessados por Claude cloud infra, então o
  servidor precisa ser publicamente alcançável.
- É possível adicionar remote MCP server URL e, opcionalmente, OAuth client ID/secret.
- Claude recomenda review cuidadoso de permissões, uso de “Allow always” apenas para tools
  confiáveis, e desabilitar tools irrelevantes.
- Claude Research pode invocar tools automaticamente; para esse modo, write-tools devem ficar
  desabilitadas.
- Claude Code recomenda remote HTTP para MCP remoto; SSE é legado/deprecated e `streamable-http` é
  alias de HTTP.

Roadmap Claude:

1. Criar perfil `claude-safe-read-validate` com tools de escrita/admin ocultas ou desaconselhadas
   por padrão.
2. Criar smoke prompts Claude específicos.
3. Implementar tool grouping/search se Claude Code ou grandes superfícies sofrerem com 96 tools.
4. Garantir descrições curtas, não ambíguas e sem prompt-injection surface.
5. Medir latência com Claude separadamente; Claude cloud pode sair de regiões diferentes das usadas
   pelo ChatGPT.

### 3.10 DevContainer e rede local

Estado observado:

- DNS cache local efetivo.
- `/etc/resolv.conf` aponta para cache local.
- Warmup DNS: 4 ok, 0 falhas.
- `dnsmasq` gerenciado e bound.
- Warning: target port conflict `in-use`.
- Docker embedded DNS split: disabled.
- Network control plane: skipped.

Diagnóstico: DNS local não é o gargalo principal no momento, mas o warning de porta e o control
plane skipped devem ser tratados para que a rede não seja uma “caixa preta”.

### 3.11 Validação

Resultado da suíte `mcp-full`:

- `typecheck`: passou em ~5,3s.
- `lint`: falhou em ~17,5s.
- Falhas:
  - `src/copilot/mcp/cloudflare/config-audit.js`: `Cloudflare` definido mas não usado.
  - `src/copilot/mcp/cloudflare/edge-audit.js`: `Cloudflare` definido mas não usado.

Classificação: **P0 operacional pequeno**. Não indica falha de arquitetura, mas bloqueia confiança
em qualquer mudança posterior.

---

## 4. Situação ideal proposta

### 4.1 Princípios

1. **API first, não browser first**: `/mcp`, `/oauth/*`, `/.well-known/*` e `/health` devem ser
   tratados como endpoints de API, sem otimizações/challenges de browser.
2. **MCP spec first**: Streamable HTTP, headers, Origin validation, PRM, OAuth metadata, version
   negotiation e backwards compatibility devem guiar decisões.
3. **Latência medida antes de tuning**: não promover QUIC, `auto`, cache metadata, compressão off ou
   rate-limit edge sem baseline e rollback.
4. **Autonomia com freios**: muitas tools são desejáveis, mas perfis por cliente e escopo evitam
   atrito e risco.
5. **Compatibilidade por perfil**: ChatGPT, Claude, Claude Code, OpenAI Apps SDK e eventuais
   clientes MCP não devem compartilhar exatamente o mesmo contrato operacional.
6. **Observabilidade e rollback como feature**: cada mudança Cloudflare/OAuth/MCP deve ter snapshot,
   diff, smoke e rollback documentado.
7. **Segurança anti-prompt-injection**: minimizar tool descriptions perigosas, outputs não
   confiáveis, write tools automáticas e mixed-context confusion.

### 4.2 SLOs propostos

| Métrica                         | Target inicial |     Target ideal | Observação                             |
| ------------------------------- | -------------: | ---------------: | -------------------------------------- |
| Public `/health` availability   |      99.5% dev |            99.9% | Medido por smoke externo               |
| MCP initialize/tools/list p50   |       < 900 ms |         < 500 ms | End-to-end pelo cliente                |
| MCP initialize/tools/list p95   |      < 2200 ms |        < 1200 ms | Separar cold/warm                      |
| Tool read-only simples p50      |       < 800 ms |         < 400 ms | Ex.: `repo_status`, `mcp_auth_profile` |
| Tool read-only simples p95      |      < 1800 ms |         < 900 ms | Incluir auth + transport               |
| Tool ampla com árvore/busca p95 |      < 3500 ms |        < 2000 ms | Depende de payload size                |
| Request error rate              |      0% steady |    < 0.1% mensal | Excluir restarts planejados            |
| HA connections                  |              4 |                4 | Túnel permanente                       |
| QUIC smoothed RTT               |        < 80 ms |          < 50 ms | Região GRU atual está boa              |
| OAuth reauth involuntário       |           raro |       quase zero | Exceto prune/rotação planejada         |
| CI `mcp-full`                   |           pass | pass obrigatório | Gate antes de Cloudflare mutation      |

### 4.3 Arquitetura alvo

```text
ChatGPT / Claude / Claude Code / MCP Clients
        |
        | HTTPS + OAuth 2.1 + MCP Streamable HTTP
        v
Cloudflare Edge
  - API route scoped config
  - cache bypass runtime
  - short-cache GET-only metadata
  - no browser challenges on MCP/OAuth
  - token + anonymous MCP rate limiting
        |
        | Cloudflare Tunnel: auto/quic/http2 benchmarked
        v
cloudflared named tunnel
        |
        | HTTPS to origin + http2Origin=true
        v
Node 24 MCP origin
  - Streamable HTTP adapter
  - OAuth resource server + dev issuer
  - JWKS cache + token validation
  - tool registry + per-tool securitySchemes
  - local index + validation jobs
  - observability spans + audit logs
        |
        v
Workspace repo / validators / Cloudflare audits / Copilot sessions
```

### 4.4 Estado ideal por área

#### MCP

- `/mcp` Streamable HTTP canônico.
- POST JSON-RPC e GET SSE compatíveis com spec.
- `MCP-Protocol-Version` validado com fallback controlado.
- `Origin` validado para todas as conexões relevantes.
- `Mcp-Session-Id` e `Last-Event-ID` em faixa experimental antes de produção.
- Backwards compatibility com HTTP+SSE apenas se houver cliente real que necessite.
- Tool descriptions curtas e seguras.
- `tools/list_changed` controlado por flag e usado apenas quando houver mutação real de tool
  surface.

#### OAuth

- PRM estável e cacheável por curto período.
- Authorization server metadata completa.
- JWKS com cache e rotação.
- PKCE S256 obrigatório para public clients.
- `resource` parameter propagado até `aud`/resource claim.
- Scopes por perfil, não apenas max-power.
- Dynamic clients e refresh tokens com prune.
- `WWW-Authenticate` e `_meta["mcp/www_authenticate"]` consistentes.
- Opcional futuro: `private_key_jwt` para clients confidenciais; mTLS OpenAI para autenticar cliente
  ChatGPT.

#### Cloudflare

- Named tunnel permanente como baseline.
- `auto` benchmarkado como candidato default se QUIC estrito tiver instabilidade de UDP.
- `http2` como rollback TCP.
- `http2Origin=true` só com origem HTTPS válida.
- `disableChunkedEncoding=false` para preservar streaming.
- API route scoped config sem BIC/Rocket/Email Obfuscation/body buffering em `/mcp`.
- Cache bypass runtime; short-cache GET-only metadata se benchmarkado.
- Rate limit edge para `/oauth/token` e `/mcp` anônimo, sem afetar Authorization bearer.
- Snapshots antes/depois de qualquer mudança.

#### OpenAI/ChatGPT

- Connector OAuth estável.
- `securitySchemes` per-tool mantidos.
- Apps SDK widgets apenas para dashboards úteis.
- Company Knowledge search/fetch adapter avaliado separadamente.
- mTLS avaliado como hardening futuro, não como P0.

#### Claude

- Perfil de conector próprio.
- Read/validate por padrão.
- Write/admin opt-in.
- Research-safe mode sem destructive/write tools.
- Tool search/grouping para reduzir latência e confusão.
- Smoke suite Claude separada.

---

## 5. Roadmap com faixas, fases e subfases

### Faixa 0 — Higiene imediata e baseline de confiança

#### Fase 0.1 — Corrigir validação

Prioridade: P0  
Esforço: baixo  
Risco: baixo

Subfases:

1. Remover imports `Cloudflare` não usados em:
   - `src/copilot/mcp/cloudflare/config-audit.js`
   - `src/copilot/mcp/cloudflare/edge-audit.js`
2. Rodar `npm run lint:copilot`.
3. Rodar `npm run typecheck:strict:src.copilot`.
4. Rodar `mcp-full` novamente.

Critério de aceite:

- `typecheck`, `lint` e suite MCP passam.
- Nenhum novo warning crítico.

#### Fase 0.2 — Congelar estado de trabalho

Prioridade: P0  
Esforço: baixo/médio

Subfases:

1. Gerar `git diff` dos arquivos alterados.
2. Separar mudanças em grupos:
   - Cloudflare audit/edge;
   - runtime/tunnel health;
   - TTL cache;
   - testes;
   - docs.
3. Criar commit ou stash/snapshot lógico antes de alterações novas.
4. Marcar arquivos MD antigos como histórico ou integrar ao novo plano.

Critério de aceite:

- Estado Git compreensível.
- Nenhuma mudança futura misturada com a auditoria atual.

#### Fase 0.3 — Smoke obrigatório pós-restart

Prioridade: P0/P1

Subfases:

1. Rodar `mcp_smoke_workspace` após restart.
2. Persistir resultado no mesmo mecanismo consultado por `mcp_runtime_health`.
3. Tornar ausência de smoke “warning actionable” com comando exato.

Critério de aceite:

- `mcp_runtime_health.status` deixa de ser `degraded` quando todos os demais sinais estão bons.

---

### Faixa 1 — Observabilidade e SLOs de latência

#### Fase 1.1 — Modelo de métricas end-to-end

Prioridade: P1  
Impacto em latência: alto indireto

Adicionar spans por requisição:

- `request_received_at`
- `auth_start/end`
- `json_parse_start/end`
- `mcp_dispatch_start/end`
- `tool_handler_start/end`
- `serialization_start/end`
- `response_flush/end`
- `status_code`
- `mcp_method`
- `tool_name`
- `payload_bytes_in/out`
- `protocol_version`
- `http_version`
- `cf_ray`
- `cf_colo`
- `auth_cache_hit`
- `jwks_cache_hit`

Critério de aceite:

- Dashboard p50/p95/p99 por tool e método MCP.
- Comparação cold vs warm.
- Export compatível com Prometheus ou JSON snapshot.

#### Fase 1.2 — SLO dashboard

Subfases:

1. Criar `mcp_latency_dashboard` read-only.
2. Expor top slow tools.
3. Expor regressões desde último baseline.
4. Expor recomendações automáticas: payload grande, auth lenta, tunnel instável, Cloudflare edge
   etc.

Critério de aceite:

- Diagnóstico de latência não depende de ler logs manualmente.

#### Fase 1.3 — Golden prompts reais

Subfases:

1. Definir 10 prompts ChatGPT:
   - status;
   - list tools;
   - read file;
   - search;
   - validation summary;
   - create file plan;
   - apply patch;
   - Cloudflare audit;
   - OAuth diagnostics;
   - tunnel metrics.
2. Repetir com Claude.
3. Registrar approval prompts, tempo percebido e erros.

Critério de aceite:

- Latência técnica e atrito UX medidos separadamente.

---

### Faixa 2 — Transporte Cloudflare e edge performance

#### Fase 2.1 — Benchmark QUIC vs auto vs HTTP2

Prioridade: P1

Plano:

1. Baseline atual `quic` com pelo menos 5 rodadas.
2. Teste `auto` com mesmas rodadas.
3. Teste `http2` como rollback/candidato TCP.
4. Medir:
   - smoke ok;
   - HA connections;
   - requestErrorRate;
   - QUIC/HTTP2 connect latency;
   - MCP p50/p95/p99;
   - OAuth flow latency;
   - logs de origin/tunnel errors.

Critério de promoção:

- Promover `auto` se preservar 4 HA connections, erro 0, OAuth ok e p95 igual ou melhor que QUIC,
  com fallback útil.
- Manter `quic` se ele continuar superior e estável.
- Manter `http2` como rollback documentado.

#### Fase 2.2 — Cloudflare route rules refinadas

Subfases:

1. Manter cache bypass para `/mcp`, `/oauth/*`, `/health`.
2. Testar short-cache GET-only para `/.well-known/*` e `/chatgpt-connector.json`.
3. Testar compressão off para `/mcp`, apenas se benchmark confirmar ganho.
4. Validar headers sensíveis inalterados.

Critério de aceite:

- Nenhuma quebra de OAuth discovery.
- Nenhuma quebra de Streamable HTTP/SSE.
- p95 de metadata discovery e tools/list melhora ou não regride.

#### Fase 2.3 — Rate limit edge para tráfego anônimo

Subfases:

1. Manter fallback origin atual.
2. Se Cloudflare plan suportar regra header-aware, adicionar rate limit para `/mcp` sem
   `Authorization`.
3. Não rate-limitar requests autenticados com Bearer válido na borda.
4. Manter `/oauth/token` com limite moderado.

Critério de aceite:

- Abuso anônimo contido.
- ChatGPT/Claude autenticados não sofrem throttling indevido.

---

### Faixa 3 — OAuth hardening e redução de atrito

#### Fase 3.1 — Governança de clients/tokens

Subfases:

1. Criar auditor read-only de OAuth store:
   - total clients;
   - total refresh tokens;
   - idade;
   - último uso;
   - escopos;
   - client type;
   - contagem por origem.
2. Criar prune dry-run.
3. Criar prune apply com backup.
4. Criar alerta para crescimento anômalo.

Critério de aceite:

- Tokens antigos podem ser removidos sem quebrar conectores ativos.

#### Fase 3.2 — Perfis de escopo

Subfases:

1. `max-autonomy`: atual.
2. `read-validate`: sem write/admin.
3. `claude-research-safe`: sem write/admin/destructive.
4. `diagnostics-public`: health/OAuth/metadata apenas.
5. UI/metadata para o usuário escolher perfil.

Critério de aceite:

- ChatGPT atual não perde autonomia.
- Claude e Research ganham perfil seguro.

#### Fase 3.3 — Token validation performance

Subfases:

1. Garantir JWKS cache e in-flight de-duplication.
2. Cachear parsing de policy por tool.
3. Opcional: cache curto de token verification por hash do token até `min(exp, ttlCurto)`, sem pular
   escopo/audience.
4. Medir auth phase antes/depois.

Critério de aceite:

- Redução de p50/p95 de `authorization` sem relaxar segurança.

---

### Faixa 4 — MCP protocol evolution

#### Fase 4.1 — Protocol negotiation matrix

Subfases:

1. Testar `2025-03-26`, `2025-06-18`, `2025-11-25`.
2. Mapear clientes:
   - ChatGPT;
   - Claude remote connector;
   - Claude Code HTTP;
   - MCP Inspector;
   - SDK TypeScript local.
3. Documentar headers e comportamento para cada um.

Critério de aceite:

- Nenhum cliente principal quebra por versão/header.

#### Fase 4.2 — Sessões stateful experimentais

Subfases:

1. Projetar adapter sem pre-parse inseguro do body.
2. Feature flag `COPILOT_MCP_HTTP_STATEFUL_SESSIONS=experimental`.
3. Gerar `Mcp-Session-Id` apenas no initialize.
4. Implementar DELETE session.
5. TTL e max sessions.
6. Smoke com MCP Inspector.

Critério de aceite:

- Stateless continua default.
- Stateful só ativa por canary.

#### Fase 4.3 — Resumability / Last-Event-ID

Subfases:

1. Definir event store em memória com TTL curto.
2. IDs por stream, não globais entre streams incompatíveis.
3. GET SSE com replay apenas do mesmo stream/session.
4. Teste de reconexão.

Critério de aceite:

- Replay não duplica respostas e não vaza mensagens entre sessões.

---

### Faixa 5 — OpenAI Apps SDK e ChatGPT UX

#### Fase 5.1 — Dashboard widget mínimo

Subfases:

1. Widget read-only para runtime health.
2. CSP estrito.
3. `outputTemplate` apenas para tools de dashboard.
4. Sem write action em widget inicial.

Critério de aceite:

- UI melhora diagnóstico sem aumentar prompt friction.

#### Fase 5.2 — Company Knowledge/search-fetch adapter

Subfases:

1. Criar tools shape-compatible `search` e `fetch` para docs do repo.
2. Indexar MDs, READMEs e docs selecionadas.
3. Retornar snippets e file refs, não conteúdo excessivo.
4. Separar de tools de repo write.

Critério de aceite:

- ChatGPT consegue pesquisar docs internas com menor tool surface.

#### Fase 5.3 — mTLS OpenAI opcional

Subfases:

1. Avaliar suporte real via Cloudflare/origin.
2. Testar validação de client cert sem bloquear Claude.
3. Usar por hostname/perfil separado se necessário.

Critério de aceite:

- mTLS não quebra OAuth, Claude ou MCP Inspector.

---

### Faixa 6 — Claude compatibility

#### Fase 6.1 — Perfil Claude seguro

Subfases:

1. `claude_connector_profile` com escopos mínimos.
2. Smoke prompts próprios.
3. Instruções de não usar write/admin em Research.
4. Lista de tools recomendadas/desabilitadas.

Critério de aceite:

- Claude consegue conectar e executar read/validate sem expor write por padrão.

#### Fase 6.2 — Tool search / grouping

Subfases:

1. Agrupar 96 tools por domínio.
2. Criar tool search/list resumida.
3. Expor detalhes sob demanda.
4. Medir impacto na descoberta de tools.

Critério de aceite:

- Menor latência de descoberta e menos confusão sem perder capacidade.

#### Fase 6.3 — Claude Code `.mcp.json` templates

Subfases:

1. Gerar template HTTP/streamable-http.
2. Gerar template com OAuth override se necessário.
3. Gerar template read-only.
4. Documentar debug.

Critério de aceite:

- Claude Code conecta com configuração copiável e smoke previsível.

---

### Faixa 7 — Performance de tools, índice e payload

#### Fase 7.1 — Payload budgeting

Subfases:

1. Definir limites padrão de linhas/bytes por tool.
2. `repo_root_tree` deve preferir resumo quando árvore for grande.
3. Paginação por cursor onde faltar.
4. Recomendar `repo_index_search` antes de leitura ampla.

Critério de aceite:

- Redução de respostas truncadas e latência de serialização.

#### Fase 7.2 — Index lifecycle

Subfases:

1. Auto-build já existe; adicionar freshness dashboard.
2. Invalidate automático após writes.
3. Métricas de index query p95.
4. Compactação/limpeza do índice se crescer muito.

Critério de aceite:

- Busca e símbolos continuam rápidos após edições.

#### Fase 7.3 — Tool handler micro-otimizações

Subfases:

1. Medir top 10 slow tools.
2. Remover leituras redundantes de env/config.
3. Aumentar TTL de audits caros quando seguro.
4. De-duplicar chamadas Cloudflare in-flight.
5. Usar compact summaries antes de logs grandes.

Critério de aceite:

- p95 das tools mais usadas cai sem perder precisão.

---

### Faixa 8 — Segurança, governança e release

#### Fase 8.1 — Security review anti-prompt-injection

Subfases:

1. Revisar tool descriptions.
2. Marcar outputs externos como não confiáveis.
3. Separar dados de instruções.
4. Sanitizar markdown/HTML em outputs de docs externas.
5. Impedir tool poisoning por arquivos do repo que pareçam instruções de sistema.

Critério de aceite:

- Menor risco de servidor/tool induzir ações indevidas.

#### Fase 8.2 — Release gates

Subfases:

1. `mcp-full` obrigatório.
2. `mcp_post_restart_readiness` obrigatório.
3. `mcp_cloudflare_edge_snapshot` antes de mutation.
4. `mcp_cloudflare_edge_policy_diff` antes/depois.
5. Smoke ChatGPT e Claude por perfil.

Critério de aceite:

- Nenhuma mudança Cloudflare/OAuth/MCP entra sem rollback e smoke.

#### Fase 8.3 — Documentação operacional

Subfases:

1. Runbook restart.
2. Runbook OAuth reauth.
3. Runbook Cloudflare rollback.
4. Runbook lint/typecheck/test.
5. Matriz de clientes: ChatGPT, Claude, Claude Code, MCP Inspector.

Critério de aceite:

- Qualquer sessão futura consegue operar o sistema sem redescobrir decisões.

---

## 6. Backlog priorizado

### P0 — agora

- Remover imports `Cloudflare` não usados e passar `mcp-full`.
- Registrar/organizar dirty state.
- Rodar smoke in-process e eliminar `degraded` falso.
- Capturar snapshot Cloudflare antes de qualquer alteração.

### P1 — próximo ciclo

- Implementar dashboard de latência end-to-end.
- Benchmark QUIC vs auto vs HTTP2.
- Criar SLOs e golden prompts ChatGPT/Claude.
- Prune dry-run de OAuth clients/tokens.
- Perfil Claude safe/read-validate.

### P2 — evolução funcional

- Short-cache metadata GET-only.
- Edge rate limit para `/mcp` anônimo se plano suportar.
- Tool grouping/search.
- Company Knowledge search/fetch adapter.
- Widgets read-only Apps SDK.

### P3 — pesquisa/experimental

- Stateful sessions.
- SSE resumability com `Last-Event-ID`.
- OpenAI mTLS.
- DPoP.
- Workers gateway para roteamento avançado por cliente/perfil.

---

## 7. Riscos e trade-offs

| Decisão                | Benefício                   | Risco                                       | Mitigação                               |
| ---------------------- | --------------------------- | ------------------------------------------- | --------------------------------------- |
| QUIC estrito           | menor RTT quando UDP é bom  | instabilidade se UDP falhar                 | benchmark `auto`; rollback HTTP2        |
| `auto` como default    | fallback QUIC->HTTP2        | pode esconder regressão QUIC                | registrar protocolo efetivo por conexão |
| HTTP/2 origin          | multiplexing e performance  | exige TLS/cert correto                      | `originServerName`, smoke TLS, rollback |
| short-cache metadata   | reduz discovery latency     | metadata stale em mudança OAuth             | TTL curto, cache bust, smoke OAuth      |
| edge rate limit `/mcp` | reduz abuso anônimo         | pode bloquear clientes legítimos sem header | limitar só sem `Authorization`          |
| max-power scopes       | autonomia ChatGPT           | excesso para Claude/Research                | perfis por cliente                      |
| stateful sessions      | resumability e notificações | complexidade e bugs de replay               | feature flag/canary                     |
| Apps SDK widgets       | UX rica                     | CSP/UI overhead                             | read-only primeiro                      |

---

## 8. Próximas ações recomendadas em ordem exata

1. Corrigir os dois imports não usados.
2. Rodar `mcp-full` até passar.
3. Rodar `mcp_smoke_workspace` e confirmar `mcp_runtime_health` sem `degraded` indevido.
4. Gerar snapshot Cloudflare local.
5. Criar baseline de latência com o transporte atual QUIC.
6. Rodar benchmark `auto` e `http2` com a mesma carga.
7. Decidir protocolo default por evidência, não por intuição.
8. Criar dashboard end-to-end de latência MCP.
9. Criar OAuth store audit + prune dry-run.
10. Criar perfil Claude read/validate e smoke próprio.
11. Planejar short-cache GET-only para metadata.
12. Planejar Apps SDK widget read-only apenas após SLOs estabilizados.

---

## 9. Veredito final

O sistema atual já é sofisticado e funcional: tem OAuth moderno, PRM, DCR/CIMD, JWKS, Cloudflare
named tunnel, QUIC, HTTP/2 to origin, edge bypass para rotas dinâmicas, índice local, tools
categorizadas e boas práticas de plan-first. O problema não é falta de engenharia; é falta de
**governança de maturidade**: validação limpa, SLOs, benchmarks, perfis por cliente, observabilidade
granular e runbooks.

A situação ideal não é aumentar indiscriminadamente a superfície. É criar uma plataforma MCP
multi-cliente com três qualidades simultâneas:

1. **rápida** — latência medida e otimizada em cada camada;
2. **compatível** — ChatGPT, Claude, Claude Code, MCP Inspector e Apps SDK com perfis próprios;
3. **segura/autônoma** — OAuth e tool permissions fortes, mas com pouco atrito para fluxos
   confiáveis.

O primeiro passo concreto é pequeno e simbólico: limpar os dois erros de lint. Depois disso, o
avanço real é construir a régua de latência e executar o benchmark de transporte antes de qualquer
mudança Cloudflare agressiva.
