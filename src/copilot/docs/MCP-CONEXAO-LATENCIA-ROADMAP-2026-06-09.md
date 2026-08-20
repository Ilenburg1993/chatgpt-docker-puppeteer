# MCP / Cloudflare / OAuth / conexão — análise estrutural de latência e roadmap

Data: 2026-06-09 Projeto: `chatgpt-docker-puppeteer` / `src/copilot/mcp` Conector público:
`https://mcp.aurelin.org/mcp`

## 1. Premissas oficiais e restrições de compatibilidade

### 1.1 MCP Streamable HTTP

A especificação MCP 2025-06-18 define Streamable HTTP como transporte remoto baseado em HTTP, com
mensagens JSON-RPC enviadas ao endpoint MCP por `POST`; servidores podem responder com
`application/json` ou `text/event-stream` conforme o fluxo. Isso significa que a otimização
estrutural deve reduzir overhead por request, I/O local, autenticação, validação, serialização,
auditoria e diagnósticos, sem mudar a semântica JSON-RPC nem exigir estado de sessão incompatível
com clientes como ChatGPT.

Fonte oficial: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports

### 1.2 Cloudflare Tunnel QUIC / HTTP2

Cloudflare Tunnel aceita `--protocol auto`, `--protocol http2` e `--protocol quic`. O modo `auto`
tenta QUIC e cai para HTTP/2 quando o caminho UDP não está disponível. Para QUIC, a rede deve
permitir saída UDP na porta 7844; para HTTP/2, a mesma porta usa TCP. Em firewalls com inspeção por
SNI, os hostnames relevantes incluem `quic.cftunnel.com` e `h2.cftunnel.com`.

Fontes oficiais:

- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/

### 1.3 OAuth remoto para MCP

O conector está em OAuth com enforcement total. A otimização de latência não pode enfraquecer
validação de issuer, JWKS, audience/resource, escopos, PKCE, resource metadata e challenge
`WWW-Authenticate`. Onde houver cache, ele deve ser curto, invalidável e aplicado apenas a artefatos
estáveis ou verificáveis.

### 1.4 Regra de ouro do roadmap

Nenhuma fase abaixo remove funcionalidade. As mudanças aceitáveis são:

- reduzir chamadas seriais por chamadas paralelas equivalentes;
- reutilizar conexão/cliente/agent;
- cachear artefatos estáveis com TTL curto e invalidação explícita;
- deslocar I/O não crítico para fora do caminho crítico;
- medir latência real por camada;
- corrigir normalizações que geram falsos diagnósticos de lentidão.

## 2. Situação atual observada

### 2.1 Estado operacional

- Readiness geral: `ready=true`, sem blockers.
- URL do conector: `https://mcp.aurelin.org/mcp`.
- Autenticação: OAuth, enforcement `all`.
- Edge Cloudflare: `quic`.
- Origin local: HTTPS/HTTP2 em `https://127.0.0.1:3333`, SNI `mcp.aurelin.org`.
- Smoke recente: ok.
- Cloudflare metrics: `haConnections=4`, `requestErrorRate=0`, `quic.present=true`.

### 2.2 Melhorias já aplicadas antes deste roadmap

1. QUIC permanente com scripts explícitos `h2`, `auto`, `quic` e rollback.
2. Smoke com retry para 530 transitório durante aquecimento de túnel.
3. Diagnósticos compactos por padrão para reduzir overhead de serialização.
4. Auditoria MCP assíncrona em lote, com `COPILOT_MCP_AUDIT_SYNC=true` para modo síncrono estrito.
5. Auditoria Cloudflare com cache TTL curto, deduplicação in-flight e paralelização parcial.
6. Probes locais HTTPS com `https.Agent` keep-alive.
7. Cache validado para leituras repetidas de arquivo (`repo_read_file`) por path + range.

### 2.3 Gaps estruturais ainda relevantes

1. Métrica QUIC RTT provavelmente normalizada de forma ambígua: alguns ambientes expõem RTT como
   segundos fracionários, outros como milissegundos inteiros. O estado atual reportou
   `smoothedRttMs` muito alto apesar de `rpcClientLatency.p95Ms` saudável e `requestErrorRate=0`.
2. Falta uma abstração única de cache TTL/in-flight para diagnósticos e probes; hoje há caches
   locais espalhados.
3. Falta uma camada única de cliente HTTP/HTTPS com keep-alive e timeout padronizado para probes
   internos, smoke, OAuth metadata e diagnósticos remotos.
4. OAuth/JWKS deve manter validação forte, mas pode ganhar cache positivo curto por
   `kid`/issuer/audience e cache negativo muito curto para evitar tempestade em falhas.
5. O registry mede duração por tool, mas ainda não separa fases internas: autorização, execução,
   serialização, auditoria e validação de payload.
6. Algumas tools de diagnóstico ainda misturam coleta remota, leitura local, avaliação e formatação
   no mesmo handler, dificultando paralelização e caching consistente.
7. Não há benchmark contínuo e comparável entre local origin, túnel público, authenticated
   tools/list e chamadas reais de tools.

## 3. Situação ideal

### 3.1 Camada de transporte

- Cloudflare edge em QUIC quando UDP 7844 está estável.
- Rollback `http2` sempre disponível e automatizado.
- `auto` usado como modo de diagnóstico/canário quando o ambiente muda.
- Origin HTTPS/HTTP2 local estável com keep-alive e SNI correto.
- Health probes públicos e locais usando clients reutilizáveis.

### 3.2 Camada MCP

- Handlers stateless do ponto de vista do protocolo, mas com caches internos seguros e curtos.
- Tool registry com medição por fase:
  - autorização;
  - rate-limit;
  - execução da tool;
  - validação de resultado;
  - auditoria;
  - serialização aproximada.
- Nenhum I/O de auditoria/log bloqueando a resposta, salvo modo explícito.

### 3.3 Camada OAuth

- Metadata OAuth e JWKS cacheados com TTL/headers quando disponíveis.
- Validação de token forte preservada.
- Caches limitados por issuer/audience/kid e invalidação por rotação.
- Negative caching curto para erros de metadata/JWKS, evitando cascatas.

### 3.4 Camada Cloudflare/API

- Cliente Cloudflare SDK reutilizado por token.
- `.env.local` cacheado com TTL curto e invalidação em caso de mtime diferente.
- Chamadas independentes paralelizadas.
- Resultados remotos com cache TTL curto e `forceRefresh` em tools que exigem verdade imediata.

### 3.5 Observabilidade

- Métricas de latência por fase, por transporte e por tool.
- Gates distinguem:
  - falha crítica;
  - degradação de latência;
  - métrica ausente;
  - falso positivo de unidade.
- Relatórios mostram `cacheHit`, `phaseDurations`, `transport`, `origin`, `authMode`, `quicRttUnit`.

## 4. Roadmap por fases

### Fase 0 — Baseline e correções de diagnóstico sem risco

0.1. Corrigir normalização de RTT QUIC para aceitar segundos fracionários e milissegundos inteiros.

0.2. Registrar unidade inferida (`seconds`, `milliseconds`, `unknown`) no bloco `quic`.

0.3. Ajustar gates para usar RTT normalizado e não gerar warning falso quando Cloudflare expõe
valores em ms.

0.4. Manter `requestErrorRate`, `haConnections`, `rpcClientLatency.p95Ms` como sinais primários de
saúde.

### Fase 1 — Cache/TTL horizontal compartilhado

1.1. Criar helper comum `ttl-cache.js` para cache positivo, cache negativo e deduplicação in-flight.

1.2. Migrar caches manuais de Cloudflare remote audit, `.env.local`, connector state e OAuth
metadata para o helper.

1.3. Adicionar limites globais de entradas, TTL máximo e métricas de hit/miss.

### Fase 2 — Cliente HTTP/HTTPS comum

2.1. Criar módulo de probes HTTP com keep-alive, timeout, retry e backoff parametrizados.

2.2. Substituir `fetch` disperso e `https.request` local por esse módulo.

2.3. Separar perfis:

- local-loopback-insecure-diagnostic;
- public-cloudflare-smoke;
- oauth-metadata;
- cloudflare-api;
- mcp-json-rpc.

### Fase 3 — OAuth/JWKS performance sem perda de segurança

3.1. Cache JWKS por issuer + kid + eTag/cache-control quando disponíveis.

3.2. Cache de metadata OAuth positivo com TTL curto e `forceRefresh` em diagnósticos.

3.3. Negative cache curto para falhas de rede repetidas.

3.4. Métricas separadas de latência: metadata, JWKS, signature verify, scope/audience check.

### Fase 4 — Registry com phase timing

4.1. Medir separadamente autorização, execução, validação de resultado e auditoria.

4.2. Expor `slowestPhases` no runtime health.

4.3. Detectar automaticamente se uma tool é lenta por rede, disco, hashing, validação ou
serialização.

### Fase 5 — Benchmarks contínuos

5.1. Benchmark local origin vs Cloudflare public.

5.2. Benchmark unauthenticated 401 challenge vs authenticated tools/list.

5.3. Benchmark de tools reais mais usadas: `repo_status`, `repo_read_file`, `repo_search_text`,
`mcp_runtime_health`.

5.4. Guardar últimas N amostras em JSONL leve e gerar tendências.

### Fase 6 — Transporte e deploy

6.1. Confirmar QUIC por métricas e não por env apenas.

6.2. Monitorar `packetTooBigDropped`, MTU e reconnects.

6.3. Testar `auto` periodicamente como canário de fallback.

6.4. Só avaliar `--post-quantum` estrito depois de baseline QUIC estabilizado e com rollback
automatizado.

## 5. Prioridades imediatas

A próxima execução deve começar por Fase 0, porque o snapshot atual indica provável erro de unidade
em RTT QUIC. Essa correção melhora a qualidade das decisões de performance sem sacrificar
funcionalidade.

Depois, Fase 1 deve unificar caches curtos e deduplicação, reduzindo latência horizontalmente para
readiness, gates, OAuth e Cloudflare.
