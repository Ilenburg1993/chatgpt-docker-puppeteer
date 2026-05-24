# Plano Canonico Cloudflare Edge para MCP remoto

Data: 2026-05-24

Escopo unico deste plano: Cloudflare, Tunnel, dominio permanente `mcp.aurelin.org`, edge rules, observabilidade e relacao com o MCP remoto do repo.

## 1. Sumario executivo

O MCP do repo ja esta operando em regime permanente por Cloudflare Tunnel:

1. Hostname publico: `https://mcp.aurelin.org/mcp`.
2. Tunnel remoto: `workspace-mcp-dev`.
3. Origin local canonico: `http://127.0.0.1:3333`.
4. Transporte local do MCP: HTTP com OAuth.
5. Fallback temporario: Cloudflare Quick Tunnel ainda existe como mecanismo emergencial.
6. Metric endpoint local do `cloudflared`: `127.0.0.1:60123`.

O foco agora deixa de ser apenas "o tunnel conecta" e passa a ser "a edge Cloudflare nao atrapalha o protocolo MCP, OAuth, streaming, discovery, CORS e sessoes longas".

O diagnostico atual e bom no plano de tunnel:

1. `make copilot-mcp-status` indica `ready=true`.
2. `make copilot-mcp-remote-audit` confirma 4 conexoes ativas.
3. A rota remota aponta para `http://127.0.0.1:3333`.
4. A configuracao remota tem catch-all `http_status:404`.
5. O smoke anterior de OAuth e lista de tools passou para o endpoint permanente.

O diagnostico ainda e parcial no plano de zona/edge:

1. O token atual le Zero Trust Tunnel.
2. O token atual ainda nao conseguiu auditar DNS/Zone via API.
3. Portanto ainda nao ha visibilidade automatizada de Rulesets da zona:
   - cache rules;
   - WAF custom rules;
   - rate limiting rules;
   - transform rules;
   - headers de resposta;
   - configuracoes que poderiam interferir em MCP/OAuth.

Este documento consolida a situacao, a situacao ideal e o roadmap de transformacao.

## 2. Fontes oficiais consultadas

### 2.1. Cloudflare Codex + Cloudflare

URL oficial: `https://developers.cloudflare.com/agent-setup/codex/`

Conclusoes relevantes:

1. A Cloudflare recomenda instalar o plugin Cloudflare em Codex quando disponivel.
2. O plugin instala Cloudflare Skills e registra MCP servers da propria Cloudflare.
3. O MCP oficial principal da Cloudflare fica em `https://mcp.cloudflare.com/mcp`.
4. Ele usa Code Mode, expondo a API Cloudflare por poucas tools em vez de milhares de schemas.
5. Tambem ha MCPs especificos para docs, audit logs, DNS analytics, observabilidade, GraphQL e outros dominios.
6. Para nossa operacao, isso e util como camada complementar de administracao da conta Cloudflare, nao como substituto do nosso MCP do repo.

### 2.2. Cloudflare own MCP servers

URL oficial: `https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/`

Conclusoes relevantes:

1. Os servidores MCP da Cloudflare suportam transport `streamable-http` em `/mcp`.
2. O servidor `https://mcp.cloudflare.com/mcp` pode acessar mais de 2.500 endpoints Cloudflare usando Code Mode.
3. Ele pode operar com OAuth ou bearer token.
4. Para nossa arquitetura, ele pode ajudar em auditoria e mudancas Cloudflare:
   - DNS;
   - Rulesets;
   - WAF;
   - Tunnel;
   - logs;
   - auditoria de eventos;
   - analytics.
5. Ele nao deve ser dependencia dura do runtime do nosso MCP.
6. Nosso repo deve continuar possuindo diagnosticos locais suficientes para operar mesmo quando o MCP externo da Cloudflare nao estiver conectado.

### 2.3. Cloudflare Tunnel configuration

URL oficial: `https://developers.cloudflare.com/tunnel/configuration/`

Conclusoes relevantes:

1. Um tunnel cria quatro conexoes outbound por replica.
2. Replicas aumentam disponibilidade criando mais quatro conexoes por instancia.
3. O tunnel deve precisar apenas de egress para Cloudflare; ingress local nao precisa ser aberto.
4. `--metrics` expoe endpoint Prometheus local.
5. `--protocol` aceita `auto`, `quic` e `http2`.
6. Nosso default `http2` e coerente para Dev Container, porque UDP/QUIC pode sofrer bloqueios em redes restritas.

### 2.4. Cloudflare Tunnel metrics

URL oficial: `https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/monitor-tunnels/metrics/`

Conclusoes relevantes:

1. `cloudflared` expoe metricas em `/metrics`.
2. O endereco default varia, entao fixar `127.0.0.1:60123` melhora automacao.
3. Metricas importantes para nosso caso:
   - `build_info`;
   - `cloudflared_orchestration_config_version`;
   - `cloudflared_tunnel_ha_connections`;
   - `cloudflared_tunnel_active_streams`;
   - `cloudflared_tunnel_concurrent_requests_per_tunnel`;
   - `cloudflared_tunnel_request_errors`;
   - `cloudflared_tunnel_total_requests`;
   - `cloudflared_tunnel_timer_retries`.

### 2.5. Cloudflare API Node SDK e Rulesets

URL oficial: `https://developers.cloudflare.com/api/node/resources/rulesets/`

Conclusoes relevantes:

1. O SDK oficial `cloudflare` ja esta instalado no projeto.
2. A API de Rulesets permite listar e buscar rulesets de conta ou zona.
3. As fases relevantes para este MCP incluem:
   - `http_request_cache_settings`;
   - `http_request_firewall_custom`;
   - `http_ratelimit`;
   - `http_request_transform`;
   - `http_response_headers_transform`;
   - `http_config_settings`;
   - `http_request_origin`.
4. A auditoria deve ser read-only por padrao.
5. Mudancas automáticas de rulesets devem ser uma faixa posterior, com backup/diff/smoke/rollback.

## 3. Situacao atual

### 3.1. O que esta correto

1. O endpoint permanente existe e e canonico.
2. O tunnel remoto esta saudavel.
3. O origin remoto usa `127.0.0.1` em vez de `localhost`.
4. O processo local do MCP e o processo local do `cloudflared` estao vivos.
5. O OAuth ja opera no endpoint permanente.
6. O fallback temporario esta documentado e mantido.
7. O Makefile ja contem comandos operacionais:
   - `make copilot-mcp-up`;
   - `make copilot-mcp-down`;
   - `make copilot-mcp-restart`;
   - `make copilot-mcp-status`;
   - `make copilot-mcp-remote-audit`;
   - `make copilot-mcp-smoke`;
   - `make copilot-mcp-smoke-refresh`.
8. O MCP ja expoe tools Cloudflare:
   - `mcp_cloudflare_remote_audit`;
   - `mcp_cloudflare_metrics_snapshot`;
   - `mcp_tunnel_status`;
   - `mcp_connector_smoke_refresh`;
   - `mcp_post_restart_readiness`.

### 3.2. O que esta incompleto

1. Ainda nao ha auditoria automatizada de edge/rulesets.
2. Ainda nao ha matriz estruturada de interferencia potencial:
   - cache sobre `/mcp`;
   - cache sobre `/.well-known/*`;
   - cache sobre `/oauth/*`;
   - WAF challenge em cliente nao-browser;
   - rate limit baixo demais;
   - transform rule alterando headers sensiveis;
   - Access/mTLS interativo em `/mcp`;
   - alteracao de `Authorization`, `WWW-Authenticate`, `Set-Cookie`, `Location`, `Content-Type`, `Cache-Control` ou CORS.
3. O token atual parece insuficiente para DNS/Zone.
4. Ainda nao ha comando canonico `make` para edge audit.
5. Ainda nao ha tool MCP para ChatGPT/Claude perguntarem diretamente: "a edge Cloudflare esta pronta para MCP?".

### 3.3. Risco principal

O maior risco atual nao e o tunnel cair. O maior risco e uma regra Cloudflare na zona produzir comportamento hostil a MCP:

1. challenge interativo que ChatGPT/Claude nao conseguem resolver;
2. cache indevido de metadata OAuth ou respostas MCP;
3. rate limit que corta sessoes longas ou validators;
4. transform header que quebra discovery, OAuth ou streaming;
5. bloqueio indistinguivel de falha do MCP local.

## 4. Situacao ideal

### 4.1. Propriedades desejadas

1. Tunnel permanente como padrao.
2. Quick Tunnel apenas fallback emergencial.
3. Edge publica minimalista para `/mcp`:
   - sem cache;
   - sem challenge interativo;
   - sem Access interativo;
   - sem mTLS obrigatorio para clientes ChatGPT/Claude;
   - sem transform de headers sensiveis;
   - rate limiting compatível com clientes autenticados.
4. Edge mais dura para rotas internas:
   - `/admin/*`;
   - `/metrics`;
   - `/internal/*`.
5. Observabilidade suficiente para diagnosticar:
   - tunnel;
   - origin;
   - OAuth;
   - tools MCP;
   - DNS;
   - Rulesets;
   - WAF/rate limit;
   - eventos com Ray ID quando disponivel.
6. Automacao read-only robusta antes de qualquer automacao mutante.

### 4.2. Contrato de edge para MCP

Para `https://mcp.aurelin.org/mcp`:

1. `POST` precisa passar sem cache.
2. `GET` de discovery/health precisa passar sem cache indevido.
3. `OPTIONS` precisa preservar CORS.
4. Headers OAuth precisam atravessar sem alteracao:
   - `Authorization`;
   - `WWW-Authenticate`;
   - `Set-Cookie`;
   - `Location`;
   - `Content-Type`;
   - `Cache-Control`;
   - `Access-Control-Allow-Origin`;
   - `Access-Control-Allow-Headers`;
   - `Access-Control-Allow-Methods`.
5. Respostas MCP streamable HTTP nao devem ser transformadas de modo que quebre streaming.

### 4.3. Contrato de permissao Cloudflare

O token de auditoria ideal deve ser separado do token de mutacao.

Token read-only minimo recomendado:

1. Account Cloudflare Tunnel: Read.
2. Zone: Read.
3. DNS: Read.
4. Zone Rulesets: Read.
5. Zone Settings: Read.
6. Logs/Audit Logs: Read, quando disponivel.

Token de mudanca futuro, guardado separadamente:

1. DNS: Edit.
2. Zone Rulesets: Edit.
3. Cloudflare Tunnel: Edit.
4. Access/Zero Trust: Edit somente se rotas internas forem automatizadas.

## 5. Papel do MCP oficial da Cloudflare

### 5.1. O que ele pode resolver

O MCP oficial da Cloudflare pode ajudar em quatro frentes:

1. Explorar a conta Cloudflare sem adicionarmos todos os endpoints no nosso repo.
2. Fazer consultas complexas de Rulesets, DNS e analytics com Code Mode.
3. Investigar eventos de seguranca e logs diretamente na plataforma.
4. Aplicar mudancas Cloudflare supervisionadas quando conectado e autorizado.

### 5.2. O que ele nao deve substituir

Ele nao deve substituir:

1. Nosso MCP do repo.
2. Os comandos locais de recovery.
3. O Makefile canonico.
4. A auditoria read-only embutida no repo.
5. A independencia da LLM-B em relacao ao MCP.

### 5.3. Decisao arquitetural

Decisao: tratar o MCP oficial da Cloudflare como acelerador operacional opcional.

1. Se disponivel no cliente Codex/Claude/ChatGPT, usar para administracao profunda da conta.
2. Se indisponivel, nosso codigo local deve continuar diagnosticando o essencial.
3. Nunca exigir que o runtime do MCP dependa do MCP da Cloudflare.
4. Documentar a URL oficial: `https://mcp.cloudflare.com/mcp`.
5. Documentar MCPs auxiliares:
   - docs: `https://docs.mcp.cloudflare.com/mcp`;
   - observability: `https://observability.mcp.cloudflare.com/mcp`;
   - audit logs: `https://auditlogs.mcp.cloudflare.com/mcp`;
   - DNS analytics: `https://dns-analytics.mcp.cloudflare.com/mcp`;
   - GraphQL: `https://graphql.mcp.cloudflare.com/mcp`.

## 6. Roadmap

### Faixa 0 — congelamento de escopo

Status: concluida para este turno.

Subfases:

1. [x] Ler integralmente `Auditoria Cloudflare 2.md`.
2. [x] Consultar documentacao oficial Cloudflare/Codex.
3. [x] Confirmar estado local do tunnel.
4. [x] Confirmar estado remoto do tunnel.
5. [x] Identificar lacuna de permissao DNS/Zone.

### Faixa 1 — documentacao canonica Cloudflare Edge

Status: em execucao.

Subfases:

1. [x] Criar este plano.
2. [x] Atualizar o relatorio consolidado principal com ponte para este plano.
3. [x] Documentar comandos canonicos novos.
4. [x] Documentar permissoes minimas de token.
5. [x] Documentar papel opcional do MCP oficial Cloudflare.

### Faixa 2 — auditoria read-only de edge/rulesets

Status: planejada para implementacao imediata.

Subfases:

1. [x] Criar modulo `src/copilot/mcp/cloudflare/edge-audit.js`.
2. [x] Reusar leitura segura de `.env.local`.
3. [x] Resolver `zoneId` quando possivel.
4. [x] Listar rulesets da zona nas fases relevantes.
5. [x] Buscar detalhes dos rulesets com regras.
6. [x] Normalizar output sem vazar IDs completos nem segredos.
7. [x] Detectar cache bypass ausente ou presente.
8. [x] Detectar WAF/challenge/block perigoso em `/mcp`.
9. [x] Detectar rate limit em `/oauth/token`.
10. [x] Detectar rate limit anonimo em `/mcp`.
11. [x] Detectar transforms sobre headers sensiveis.
12. [x] Retornar permission gaps como estado parcial, sem quebrar tunnel saudavel.

### Faixa 3 — superficie MCP e CLI

Status: planejada.

Subfases:

1. [x] Criar tool `mcp_cloudflare_edge_audit`.
2. [x] Registrar tool no registry canonico.
3. [x] Atualizar `mcp_capabilities_summary`.
4. [x] Atualizar smoke critical tools.
5. [x] Adicionar script `copilot:mcp:cloudflare:edge-audit`.
6. [x] Adicionar Make target `copilot-mcp-edge-audit`.
7. [x] Atualizar README MCP.

### Faixa 4 — testes unitarios

Status: planejada.

Subfases:

1. [x] Testar analise de cache bypass.
2. [x] Testar deteccao de challenge em `/mcp`.
3. [x] Testar deteccao de transform perigoso.
4. [ ] Testar estado parcial por falta de permissao em fixture dedicada.
5. [x] Atualizar teste do registry.

### Faixa 5 — validadores canonicos

Status: planejada.

Subfases:

1. [x] Rodar typecheck strict de `src/copilot`.
2. [x] Rodar lint de `src/copilot`.
3. [x] Rodar unit tests de `src/copilot`.
4. [x] Rodar `git diff --check`.

### Faixa 6 — validacao operacional Cloudflare

Status: planejada.

Subfases:

1. [x] Rodar `make copilot-mcp-status`.
2. [x] Rodar `make copilot-mcp-remote-audit`.
3. [x] Rodar novo `make copilot-mcp-edge-audit`.
4. [x] Rodar `make copilot-mcp-smoke-refresh`.
5. [x] Confirmar tool nova no registry remoto apos restart quando necessario.

Resultado operacional observado:

1. `make copilot-mcp-status`: `ready=true`, OAuth, tunnel e MCP HTTP vivos.
2. `make copilot-mcp-remote-audit`: tunnel `workspace-mcp-dev` healthy, 4 conexoes, ingress canonico; DNS segue com warning `403 Authentication error`.
3. `make copilot-mcp-edge-audit`: `edgeAuditable=true`, zona resolvida, `rulesets=[]`, sem critical, warnings por regras explicitas ausentes.
4. `make copilot-mcp-smoke-refresh`: 79/79 tools, `toolsMatchLocalRegistry=true`, tool `mcp_cloudflare_edge_audit` publicada.

### Faixa 7 — hardening posterior

Status: futuro.

Subfases:

1. [x] Criar export JSON de desired edge policy em modo plan-only.
2. [x] Criar diff entre desired e actual rulesets em modo plan-only.
3. [ ] Criar plano de mudanca sem aplicar.
4. [ ] Criar aplicador com backup previo.
5. [ ] Criar rollback automatizado.
6. [ ] Integrar Security Events/Ray ID.
7. [ ] Integrar Audit Logs MCP/Cloudflare API quando a permissao existir.
8. [ ] Avaliar replicas do tunnel.
9. [ ] Avaliar Load Balancing apenas se houver mais de uma origem real.

Continuidade pos-push:

1. [x] Criar `mcp_cloudflare_edge_policy_plan`.
2. [x] Criar `npm run copilot:mcp:cloudflare:edge-policy-plan`.
3. [x] Criar `make copilot-mcp-edge-policy-plan`.
4. [x] Documentar o comando no README MCP.
5. [x] Rodar validadores completos novamente.
6. [x] Reiniciar/smoke remoto para publicar a nova tool.
7. [x] Confirmar smoke remoto com 80/80 tools.

Continuidade apos correcao de token:

1. [x] Reexecutar auditoria remota com DNS Read ativo.
2. [x] Confirmar CNAME `mcp.aurelin.org` proxied apontando para o tunnel esperado.
3. [x] Confirmar `make copilot-mcp-remote-audit` sem warnings.
4. [x] Criar `mcp_cloudflare_edge_policy_diff`.
5. [x] Criar `npm run copilot:mcp:cloudflare:edge-policy-diff`.
6. [x] Criar `make copilot-mcp-edge-policy-diff`.
7. [x] Rodar validadores completos novamente.
8. [x] Reiniciar/smoke remoto para publicar a nova tool.
9. [x] Confirmar smoke remoto com 81/81 tools.

## 7. Criterios de pronto

Este turno Cloudflare sera considerado pronto quando:

1. Houver plano atualizado.
2. Houver auditoria read-only de edge/rulesets.
3. Houver tool MCP correspondente.
4. Houver comandos package/Makefile.
5. Houver testes unitarios.
6. Typecheck, lint e unit tests passarem.
7. O tunnel permanente continuar pronto.
8. A falta de permissao DNS/Zone, se persistir, aparecer como gap claro e nao como misterio operacional.

## 8. Comandos canonicos esperados apos implementacao

```bash
make copilot-mcp-status
make copilot-mcp-remote-audit
make copilot-mcp-edge-audit
make copilot-mcp-edge-policy-diff
make copilot-mcp-edge-policy-plan
make copilot-mcp-smoke-refresh
```

## 9. Preenchimento de conectores

### ChatGPT

Nome: Repo DevContainer MCP

URL: `https://mcp.aurelin.org/mcp`

Autenticacao: OAuth

### Claude

Nome: Repo DevContainer MCP

URL do servidor MCP remoto: `https://mcp.aurelin.org/mcp`

OAuth Client ID e OAuth Client Secret: deixar em branco enquanto o conector aceitar descoberta dinamica/CIMD. Preencher apenas se Claude exigir client pre-registrado.

## 10. Principio final

Cloudflare deve proteger o endpoint sem se comportar como uma pagina web interativa na frente de um cliente MCP. Para ChatGPT e Claude, o melhor edge profile e de API: sem cache, sem challenge interativo, com diagnostico, rate limiting cuidadoso e headers preservados.
