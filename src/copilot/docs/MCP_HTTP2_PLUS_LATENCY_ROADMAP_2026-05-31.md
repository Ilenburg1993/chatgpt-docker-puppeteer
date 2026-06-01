# MCP HTTP/2+ latency roadmap — Node 24 / Cloudflare / OAuth

Data: 2026-05-31  
Escopo: `src/copilot/mcp`, Cloudflare Tunnel, Cloudflare edge policy, OAuth dev server e endpoint público `https://mcp.aurelin.org/mcp`.

Este documento é a trilha canônica para migrar o MCP HTTP atual de HTTP/1.1 para HTTP/2+ com redução estrutural de latência e preservação de compatibilidade com ChatGPT, Claude, MCP Inspector e OAuth.

---

## 1. Conclusão executiva

A situação atual não é “HTTP/2 parcial” no origin MCP. Ela é uma pilha com três camadas diferentes de protocolo:

1. **Cliente externo → Cloudflare edge**: Cloudflare oferece HTTP/2 no edge por padrão quando SSL/TLS está ativo. Esse trecho provavelmente já negocia HTTP/2 ou HTTP/3 com clientes modernos, mas precisa ser medido com probes que registrem ALPN/protocolo.
2. **Cloudflare edge → `cloudflared` connector**: o wrapper do projeto hoje normaliza `COPILOT_MCP_CLOUDFLARE_PROTOCOL`/`TUNNEL_TRANSPORT_PROTOCOL` para `http2` por padrão, embora Cloudflare documente `auto` como modo que tenta QUIC e faz fallback para HTTP/2. Isso é transporte do túnel, não HTTP/2 origin.
3. **`cloudflared` connector → MCP origin local**: hoje é **HTTP/1.1 claro** contra `http://127.0.0.1:3333`, porque `src/copilot/mcp/adapters/http.js` usa `node:http.createServer()` e a configuração canônica de Cloudflare origin é `http://127.0.0.1:3333`.

Portanto, a migração real para HTTP/2+ precisa ser feita em fases. O primeiro alvo estrutural é **HTTP/2 to origin com TLS local e ALPN**, não apenas ligar `originRequest.http2Origin=true`. Com o origin atual em `http://`, essa flag é incompatível e pode causar fallback silencioso, 5xx, ou diagnósticos enganosos.

A situação ideal é:

- Edge público com HTTP/2 e HTTP/3 habilitados, sem cache/transformação em `/mcp`.
- Túnel `cloudflared` em `auto` para produção quando UDP/QUIC funciona, com override `http2` para Dev Containers restritos.
- Origin MCP local em HTTPS + HTTP/2 usando Node 24 `node:http2`, com `allowHTTP1: true` durante rollout.
- Cloudflare Tunnel ingress apontando para `https://127.0.0.1:3333`, com `originRequest.http2Origin=true` somente quando o origin HTTPS estiver pronto.
- Verificação de compatibilidade completa com MCP Streamable HTTP, OAuth, CORS, streaming e abortos.
- Métricas de protocolo no `/health`, nos smokes e no benchmark de latência.

---

## 2. Fontes oficiais consultadas

Consulta feita em 2026-05-31.

- Cloudflare Learning Center — HTTP/2 vs HTTP/1.1: `https://www.cloudflare.com/learning/performance/http2-vs-http1.1/`
- Cloudflare Speed — HTTP/2: `https://developers.cloudflare.com/speed/optimization/protocol/http2/`
- Cloudflare Speed — HTTP/2 to Origin: `https://developers.cloudflare.com/speed/optimization/protocol/http2-to-origin/`
- Cloudflare Speed — Enhanced HTTP/2 Prioritization: `https://developers.cloudflare.com/speed/optimization/protocol/enhanced-http2-prioritization/`
- Cloudflare Tunnel origin parameters: `https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/cloudflared-parameters/origin-parameters/`
- Cloudflare Tunnel run parameters: `https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/cloudflared-parameters/run-parameters/`
- Node.js v24 — HTTP/2 API: `https://nodejs.org/docs/latest-v24.x/api/http2.html`

---

## 3. Estado atual detectado no workspace

### 3.1 Arquivo principal: `src/copilot/mcp/adapters/http.js`

O adapter atual:

- importa `createServer` de `node:http`;
- não importa `node:http2`;
- cria servidor HTTP/1.1 com `createServer(async (req, res) => ...)`;
- define timeouts de keep-alive, headers e request em 90s/95s/120s;
- usa `StreamableHTTPServerTransport` do MCP SDK;
- cria um novo `createCopilotMcpServer()` e um novo transport por request;
- usa `sessionIdGenerator: undefined` e `enableJsonResponse: true`;
- mantém sessões stateful explicitamente desabilitadas por causa de bug anterior de replay de body;
- expõe `/health`, `/chatgpt-connector.json`, well-known OAuth, dev OAuth e `/mcp`;
- usa `no-store,no-transform` em `/mcp`, o que é correto para MCP/OAuth runtime.

Status: **HTTP/1.1 origin confirmado**.

### 3.2 Configuração Cloudflare local

Em `src/copilot/mcp/cloudflare/config.js`:

- `DEFAULT_CLOUDFLARE_ORIGIN_URL = 'http://127.0.0.1:3333'`;
- `DEFAULT_CLOUDFLARE_PUBLIC_URL = 'https://mcp.aurelin.org/mcp'`;
- `normalizeTransportProtocol()` aceita `auto`, `http2`, `quic`, mas usa `http2` como default;
- `buildCloudflaredRunFlags()` não injeta `--protocol`; o protocolo é passado por env `TUNNEL_TRANSPORT_PROTOCOL` em `cli.js`;
- `normalizeOriginUrl()` aceita `http://` e `https://`, mas o default real é HTTP claro.

Status: **túnel pode usar HTTP/2 no trecho edge↔connector, mas origin local segue HTTP/1.1**.

### 3.3 Auditoria Cloudflare originRequest

Em `src/copilot/mcp/cloudflare/origin-request-profile.js`, o perfil desejado atual recomenda:

- `http2Origin=false`;
- `disableChunkedEncoding=false`;
- `connectTimeout='5s'`;
- `keepAliveTimeout='1m30s'`;
- `keepAliveConnections=100`;
- `tcpKeepAlive='30s'`;
- invariantes que proíbem `http2Origin=true` enquanto o origin é `http://127.0.0.1:3333`.

Isso está correto para o estado atual, mas precisa virar política condicional quando habilitarmos origin HTTPS/H2.

### 3.4 Scripts e testes atuais

Scripts relevantes em `package.json`:

- `npm run copilot:mcp:http`
- `npm run copilot:mcp:smoke:local`
- `npm run copilot:mcp:oauth:smoke`
- `npm run copilot:mcp:latency:benchmark`
- `npm run copilot:mcp:cloudflare:doctor`
- `npm run copilot:mcp:cloudflare:status`
- `npm run copilot:mcp:cloudflare:remote-audit`
- `npm run copilot:mcp:cloudflare:edge-audit`
- `npm run copilot:mcp:cloudflare:edge-policy-diff`
- `npm run copilot:mcp:cloudflare:edge-policy-apply`

Limitação: os smokes e benchmarks atuais não registram ALPN/protocolo HTTP efetivo. Isso impede provar, em números, se um request foi HTTP/1.1, HTTP/2 ou HTTP/3 em cada trecho.

### 3.5 Dados de latência já documentados anteriormente

O documento `MCP_PAYLOAD_LATENCY_UPGRADE_2026-05-31.md` registrou padrão aproximado:

- `local.tools/list` p50: ~9 ms;
- `public.tools/list` p50: ~278 ms;
- `public.tools/list` TTFB p50: ~71 ms;
- `public.tools/list` download p50: ~169 ms;
- payload decodificado: ~101 KB.

Interpretação: HTTP/2+ é importante, mas payload/transferência continua sendo gargalo material. A migração de protocolo deve rodar junto com tool-surface/payload compaction.

---

## 4. Modelo mental correto de HTTP/2+ nesta pilha

### 4.1 HTTP/2 no edge público

Cloudflare HTTP/2 no edge é voltado ao trecho cliente→Cloudflare. Benefícios gerais: multiplexing, compressão de headers e menor overhead de conexões. Para MCP, o ganho mais provável é redução de custo de conexão e estabilidade em chamadas repetidas, não cache.

Ações neste trecho:

- confirmar HTTP/2 habilitado na zona;
- confirmar HTTP/3 habilitado separadamente, se desejado;
- não transformar `/mcp`;
- manter cache bypass em `/mcp` e `/oauth/token`;
- manter short-cache apenas para metadados públicos GET-only.

### 4.2 Transporte do Cloudflare Tunnel

`TUNNEL_TRANSPORT_PROTOCOL=auto|http2|quic` controla o trecho Cloudflare edge↔`cloudflared`. Esse campo não significa `originRequest.http2Origin`.

Política proposta:

- produção/named tunnel: default desejado `auto`, para usar QUIC quando UDP funciona e fallback para HTTP/2 quando necessário;
- Dev Container ou ambientes com UDP bloqueado: override explícito `http2`;
- auditoria deve reportar claramente: `tunnelEdgeTransportProtocol`, não apenas `transportProtocol`.

### 4.3 HTTP/2 to origin

`originRequest.http2Origin=true` controla o trecho `cloudflared`→origin. Pelos parâmetros oficiais do Cloudflare Tunnel, `http2Origin=true` faz o `cloudflared` tentar HTTP/2 contra o origin e requer certificado SSL no origin.

Logo, a ordem segura é:

1. criar origin HTTPS local;
2. habilitar Node HTTP/2 com ALPN;
3. testar `h2spec`/`curl --http2`/client Node local;
4. atualizar ingress para `https://127.0.0.1:3333`;
5. só então ligar `originRequest.http2Origin=true`.

---

## 5. Bugs, gaps e riscos encontrados

### B1 — Origin MCP ainda é HTTP/1.1

Causa: `node:http.createServer()` em `http.js` e origin URL default `http://127.0.0.1:3333`.

Impacto: não há multiplexing HTTP/2 entre `cloudflared` e origin; cada request ainda chega ao Node pelo modelo HTTP/1.1.

Correção: introduzir servidor HTTPS/H2 com Node 24 e `allowHTTP1: true`.

### B2 — `http2Origin=true` é incompatível com o origin atual

Causa: Cloudflare requer origin SSL para HTTP/2 origin; nosso origin atual é HTTP claro.

Impacto: ligar a flag hoje é mudança perigosa e contrária à auditoria atual.

Correção: tornar `originRequest.http2Origin` condicional ao scheme `https:` e à presença de política TLS válida.

### B3 — Ambiguidade entre “tunnel protocol” e “origin HTTP/2”

Causa: o nome `transportProtocol` no config pode ser confundido com HTTP/2 to origin.

Impacto: operadores podem achar que `TUNNEL_TRANSPORT_PROTOCOL=http2` já migrou o MCP origin para HTTP/2. Não migrou.

Correção: renomear relatórios/docs para `tunnelEdgeTransportProtocol` e documentar `originRequest.http2Origin` separadamente.

### B4 — Comentário do adapter diverge do default real

O cabeçalho de `http.js` recomenda “Cloudflare Tunnel on auto/QUIC”, mas `config.js` defaulta para `http2`. Pode ter sido uma decisão consciente para Dev Containers com UDP bloqueado, mas precisa ficar explícito.

Correção: escolher política canônica:

- produção: `auto`;
- devcontainer restrito: `http2`;
- comentários, testes e docs alinhados.

### B5 — Falta telemetria de protocolo

`/health`, smoke e benchmark não registram:

- `req.httpVersion`;
- `req.httpVersionMajor`;
- ALPN negotiated protocol;
- HTTP/2 stream/session counters;
- tunnel edge protocol ativo;
- origin request `http2Origin` remoto;
- max concurrent streams remoto/origin.

Correção: adicionar `http.protocol` ao `/health` e aos relatórios de smoke/benchmark.

### B6 — Compatibilidade MCP SDK vs Node HTTP/2 precisa de spike

O SDK `StreamableHTTPServerTransport` espera objetos compatíveis com HTTP server request/response. Node `http2` oferece Compatibility API, mas a documentação deixa claro que nem todo comportamento interno de HTTP/1 é suportado.

Risco: `transport.handleRequest(req, res)` pode funcionar com `Http2ServerRequest`/`Http2ServerResponse`, mas precisa de teste real para:

- `initialize`;
- `tools/list`;
- `tools/call`;
- responses JSON;
- SSE/streamable HTTP;
- CORS preflight;
- abort/close;
- OAuth routes.

Correção: criar spike isolado com `createSecureServer({ allowHTTP1: true })` e manter fallback H1.

### B7 — TLS local precisa ser política explícita

Opções:

- ideal: certificado local com SAN para `127.0.0.1` e/ou hostname interno, verificado por CA local via `caPool` quando suportado pelo runtime do connector;
- canary temporário: `noTLSVerify=true` apenas para provar H2 origin em ambiente controlado;
- proibido como estado final: `noTLSVerify=true` permanente sem justificativa.

### B8 — H2 pode piorar se max streams/long requests forem mal configurados

Cloudflare alerta para 5xx quando origin não suporta multiplexing suficientemente bem ou quando requests longos ocupam conexões. MCP tools podem ter chamadas longas.

Correção: começar com max streams conservador, observar p95/p99 e erros 5xx, e aumentar gradualmente.

### B9 — Payload continua gargalo

Mesmo com HTTP/2, `tools/list` público já mostrou download dominante. A migração de protocolo não substitui compactação de tool descriptors.

Correção: seguir em paralelo com `COPILOT_MCP_TOOL_SURFACE=latency|minimal` e redução de schemas/descrições.

### B10 — Enhanced HTTP/2 Prioritization provavelmente é secundário

Recurso útil para páginas com muitos assets e prioridades de browser. Para MCP JSON API, o ganho esperado é menor. Deve ser avaliado, não priorizado como principal.

---

## 6. Arquitetura ideal proposta

### 6.1 Topologia final

```text
ChatGPT / Claude / MCP Inspector
        │
        │ HTTP/2 ou HTTP/3 público
        ▼
Cloudflare edge
        │
        │ Cloudflare Tunnel transport: auto → QUIC quando possível, fallback HTTP/2
        ▼
cloudflared connector no workspace/devcontainer
        │
        │ HTTPS + HTTP/2 to origin, ALPN h2, keepalive, multiplexing
        ▼
Node 24 MCP origin
        │
        ├─ /mcp                         no-store, no-transform
        ├─ /oauth/*                     no-store para token; public metadata curto
        ├─ /.well-known/*               public short-cache
        ├─ /chatgpt-connector.json      public short-cache
        └─ /health                      métricas + protocolo
```

### 6.2 Node server ideal

Usar Node 24 `node:http2` com:

- `createSecureServer()`;
- `allowHTTP1: true` durante transição;
- certificado e key configuráveis;
- `settings.maxConcurrentStreams` conservador inicialmente;
- push desabilitado/não usado;
- timeouts equivalentes ou melhores que os atuais;
- wrapper de handler compartilhado com o adapter HTTP/1.1;
- health expondo protocolo e counters.

### 6.3 Cloudflare origin ideal

Quando H2 origin estiver pronto:

```yaml
service: https://127.0.0.1:3333
originRequest:
  http2Origin: true
  noTLSVerify: false
  disableChunkedEncoding: false
  connectTimeout: 5s
  keepAliveTimeout: 1m30s
  keepAliveConnections: 100
  tcpKeepAlive: 30s
```

Campos TLS (`originServerName`, `caPool`) devem ser definidos conforme a estratégia de certificado. Se Cloudflare Tunnel remoto/connector não conseguir validar a CA local no ambiente atual, o canary pode usar `noTLSVerify=true`, mas o roadmap deve tratar isso como exceção temporária.

### 6.4 Edge policy ideal

Manter:

- cache bypass para `/mcp`, `/mcp/*`, `/oauth/token`, OAuth runtime;
- short-cache para discovery metadata público GET-only;
- sem challenge/Access interativo em `/mcp`;
- sem transforms que alterem `Authorization`, `WWW-Authenticate`, `Content-Type`, `Cache-Control`, `Location`, CORS ou framing;
- compressão de `/mcp` reavaliada após H2, pois o benchmark anterior favoreceu `identity`.

---

## 7. Roadmap de execução

### Fase 0 — Baseline e guardrails

#### 0.1 Congelar baseline atual

Comandos:

```bash
cd /workspaces/chatgpt-docker-puppeteer
npm run copilot:mcp:cloudflare:status
npm run copilot:mcp:cloudflare:doctor
npm run copilot:mcp:cloudflare:remote-audit
npm run copilot:mcp:cloudflare:edge-audit
npm run copilot:mcp:smoke:local
npm run copilot:mcp:oauth:smoke
COPILOT_MCP_LATENCY_WARMUP_SAMPLES=2 COPILOT_MCP_LATENCY_SAMPLES=30 npm run copilot:mcp:latency:benchmark
```

Critério de aceite:

- baseline salvo em `src/copilot/.ai/cloudflare/` ou em snapshot documentado;
- p50/p95/p99 registrados;
- tool count e payload size registrados;
- nenhuma mudança de protocolo aplicada ainda.

#### 0.2 Adicionar telemetria de protocolo

Arquivos:

- `src/copilot/mcp/adapters/http.js`;
- `src/copilot/mcp/scripts/smoke-http.js`;
- `src/copilot/mcp/scripts/latency-benchmark.js`.

Saídas desejadas:

```json
{
  "http": {
    "server": {
      "protocolMode": "http1|h2|h2-compat",
      "lastRequestHttpVersion": "1.1|2.0",
      "lastRequestHttpVersionMajor": 1,
      "alpnProtocol": "http/1.1|h2|null",
      "timingPolicy": {}
    },
    "cloudflare": {
      "tunnelEdgeTransportProtocol": "auto|http2|quic",
      "originHttp2Enabled": false
    }
  }
}
```

#### 0.3 Separar nomenclatura

Renomear relatórios/docs:

- `transportProtocol` → `tunnelEdgeTransportProtocol` nos reports;
- `originRequest.http2Origin` → `originHttp2ToOrigin` nos summaries;
- manter nomes de env atuais por compatibilidade, mas documentar aliases.

#### 0.4 Gate de não regressão

Antes de mexer em HTTP/2:

```bash
npm run typecheck:strict:src.copilot
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp
npm run lint:copilot
```

---

### Fase 1 — Spike local de Node HTTP/2 com fallback HTTP/1

#### 1.1 Refatorar handler protocol-neutral

Extrair do `http.js` uma função interna compartilhável:

```js
async function handleMcpHttpLikeRequest(req, res) { ... }
```

Meta: manter toda a lógica de rota/CORS/OAuth/MCP igual, trocando apenas o servidor que entrega `req/res`.

Não fazer:

- não reintroduzir replay de body;
- não habilitar sessões stateful;
- não alterar payloads MCP;
- não mudar Cloudflare ainda.

#### 1.2 Criar modo H2 local

Opções de design:

1. Novo arquivo `src/copilot/mcp/adapters/http2.js`; ou
2. Mesmo `http.js` com `COPILOT_MCP_HTTP_PROTOCOL=http1|h2`.

Preferência: novo arquivo pequeno para reduzir risco e manter adapter H1 intacto.

Variáveis propostas:

```bash
COPILOT_MCP_HTTP_PROTOCOL=http1|h2
COPILOT_MCP_HTTP2_CERT_FILE=src/copilot/.ai/cloudflare/origin-cert.pem
COPILOT_MCP_HTTP2_KEY_FILE=src/copilot/.ai/cloudflare/origin-key.pem
COPILOT_MCP_HTTP2_CA_FILE=src/copilot/.ai/cloudflare/origin-ca.pem
COPILOT_MCP_HTTP2_ALLOW_HTTP1=true
COPILOT_MCP_HTTP2_MAX_CONCURRENT_STREAMS=50
```

#### 1.3 TLS local

Criar utilitário seguro para gerar material de dev:

- CA local dentro de `src/copilot/.ai/cloudflare/`, não commitada;
- certificado com SAN `IP:127.0.0.1` e `DNS:localhost`;
- permissões restritas;
- fingerprint exibido no `doctor`;
- nunca versionar key/cert.

#### 1.4 Testes locais

Novos testes:

- `test_mcp_http2_adapter.spec.js`;
- `test_mcp_http2_tls_config.spec.js`;
- `test_cloudflare_origin_request_profile_h2.spec.js`.

Cenários mínimos:

- GET `/health` via HTTP/2;
- GET `/health` fallback HTTP/1.1 com `allowHTTP1`;
- OPTIONS `/mcp`;
- POST `/mcp` `tools/list`;
- POST `/mcp` `tools/call mcp_runtime_health`;
- OAuth well-known;
- OAuth token route;
- close/abort sem leak;
- headers sem `connection`/`transfer-encoding` indevidos em H2.

Critério de aceite:

- todos os testes MCP existentes passam sem alteração de comportamento no modo H1;
- novos testes H2 passam localmente;
- `/health` mostra protocolo real.

---

### Fase 2 — HTTP/2 to origin via Cloudflare Tunnel

#### 2.1 Tornar originRequestProfile condicional

Atualizar `src/copilot/mcp/cloudflare/origin-request-profile.js`:

- se `originUrl` começa com `http://`: `http2Origin=false` continua recomendado e `true` é critical;
- se `originUrl` começa com `https://` e H2 local está habilitado: `http2Origin=true` passa a ser recomendado;
- se `https://` mas H2 local desconhecido: warning e não apply automático;
- `disableChunkedEncoding=false` permanece;
- `noTLSVerify=false` é recomendado para produção;
- `noTLSVerify=true` permitido apenas em canary explicitamente marcado.

#### 2.2 Atualizar remote audit

Em `remote-api.js`, incluir:

- scheme esperado do origin;
- `originRequest.http2Origin` desejado/atual;
- TLS validation mode;
- origin server name/CA pool quando configurados;
- warning se service HTTPS mas `http2Origin=false`;
- critical se service HTTP e `http2Origin=true`.

#### 2.3 Atualizar tunnel config

Adicionar envs:

```bash
COPILOT_MCP_ORIGIN_PROTOCOL=http1|h2
COPILOT_MCP_CLOUDFLARE_ORIGIN_URL=https://127.0.0.1:3333
COPILOT_MCP_CLOUDFLARE_ORIGIN_HTTP2=true
COPILOT_MCP_CLOUDFLARE_ORIGIN_TLS_VERIFY=true
```

Critério:

- H1 continua default até spike aprovado;
- H2 origin só vira default após canary público estável.

#### 2.4 Canary Cloudflare

Sequência:

```bash
npm run copilot:mcp:cloudflare:edge-backup-create pre-http2-origin
npm run copilot:mcp:cloudflare:remote-audit
npm run copilot:mcp:cloudflare:edge-audit
npm run copilot:mcp:cloudflare:restart
npm run copilot:mcp:cloudflare:smoke
npm run copilot:mcp:oauth:smoke
COPILOT_MCP_LATENCY_WARMUP_SAMPLES=2 COPILOT_MCP_LATENCY_SAMPLES=30 npm run copilot:mcp:latency:benchmark
```

Abortar se:

- `tools/list`, `tools/call` ou `initialize` retornarem 400;
- OAuth falhar;
- CORS falhar;
- Cloudflare retornar 520/522/524;
- logs mostrarem `ERR_HTTP2_PROTOCOL_ERROR`;
- p95/p99 piorarem materialmente sem ganho de estabilidade.

---

### Fase 3 — Política do transporte do túnel

#### 3.1 Revisar default `http2` vs `auto`

Hoje o config defaulta para `http2`. A documentação Cloudflare descreve `auto` como modo que tenta QUIC e faz fallback para HTTP/2 quando UDP não conecta.

Política recomendada:

- `auto` para named permanent tunnel em produção;
- `http2` para Dev Container quando UDP é bloqueado;
- `quic` apenas quando explicitamente desejado e validado.

#### 3.2 Atualizar testes

`test_mcp_cloudflare_config.spec.js` hoje espera `http2` como default. Atualizar depois de decisão explícita.

#### 3.3 Medir

Rodar matriz:

```bash
TUNNEL_TRANSPORT_PROTOCOL=http2 npm run copilot:mcp:cloudflare:restart
COPILOT_MCP_LATENCY_SAMPLES=30 npm run copilot:mcp:latency:benchmark

TUNNEL_TRANSPORT_PROTOCOL=auto npm run copilot:mcp:cloudflare:restart
COPILOT_MCP_LATENCY_SAMPLES=30 npm run copilot:mcp:latency:benchmark

TUNNEL_TRANSPORT_PROTOCOL=quic npm run copilot:mcp:cloudflare:restart
COPILOT_MCP_LATENCY_SAMPLES=30 npm run copilot:mcp:latency:benchmark
```

Critério:

- escolher menor p95/p99 com menor taxa de erro;
- se UDP for instável, manter `http2` no ambiente atual e documentar.

---

### Fase 4 — Cloudflare zone/edge settings

#### 4.1 Confirmar HTTP/2 edge

Verificar via dashboard/API:

- HTTP/2 enabled;
- HTTP/3 enabled, se aplicável;
- zone SSL válido;
- sem page rules/transform rules conflitantes.

#### 4.2 Enhanced HTTP/2 Prioritization

Avaliar apenas se o plano Cloudflare suportar. Baixa prioridade para MCP API, pois o endpoint principal é JSON-RPC e não uma página com múltiplos assets.

#### 4.3 Revalidar compressão

Edge policy atual desabilita compressão para `/mcp` por benchmark. Após H2:

- testar `accept-encoding: identity`;
- testar default compression;
- testar `Accept: application/json` vs `application/json, text/event-stream`;
- manter a política que melhora p95/p99 e estabilidade.

---

### Fase 5 — App-level latency em paralelo

#### 5.1 Tool surface mode

Finalizar wiring de `COPILOT_MCP_TOOL_SURFACE`:

- `full`: comportamento atual;
- `latency`: superfície de alta utilidade;
- `minimal`: emergência/debug.

#### 5.2 Payload compaction

Reduzir especialmente:

- schemas repetitivos;
- descrições longas de ferramentas pouco usadas;
- metadata redundante em `tools/list`;
- tool families grandes que não precisam estar sempre anunciadas.

#### 5.3 Stateful sessions

Não reativar agora. HTTP/2 melhora reutilização de conexão, mas o problema anterior era parsing/body replay no SDK. Sessões só voltam com hook seguro ou transporte SDK compatível.

---

### Fase 6 — Rollout, rollback e critérios finais

#### 6.1 Rollout recomendado

1. Baseline H1 atual.
2. H2 local sem Cloudflare.
3. H2 local + fallback H1.
4. Cloudflare Tunnel para HTTPS origin com `http2Origin=false` inicialmente, só para validar TLS/connect.
5. Cloudflare Tunnel com `http2Origin=true` em canary.
6. Public canary com smoke OAuth/MCP.
7. Benchmark 30–100 samples.
8. Default gradual.

#### 6.2 Rollback imediato

```bash
export COPILOT_MCP_HTTP_PROTOCOL=http1
export COPILOT_MCP_CLOUDFLARE_ORIGIN_URL=http://127.0.0.1:3333
# remoto: originRequest.http2Origin=false
npm run copilot:mcp:cloudflare:restart
npm run copilot:mcp:cloudflare:smoke
npm run copilot:mcp:oauth:smoke
```

#### 6.3 Critérios finais de sucesso

- `/health` prova HTTP/2 no origin quando habilitado;
- `remote-audit` confirma ingress HTTPS e `http2Origin=true`;
- `cloudflare:smoke` e `oauth:smoke` passam;
- `tools/list` e `tools/call` passam com ChatGPT/Claude/MCP Inspector;
- p95/p99 melhoram ou ficam estáveis com menor erro sob burst;
- nenhuma regressão de CORS/OAuth;
- nenhuma volta de HTTP 400 por body replay;
- rollback testado.

---

## 8. Sequência de implementação proposta para a próxima etapa

### Patch 1 — Observabilidade sem mudança de protocolo

Arquivos:

- `src/copilot/mcp/adapters/http.js`
- `src/copilot/mcp/scripts/smoke-http.js`
- `src/copilot/mcp/scripts/latency-benchmark.js`

Objetivo: adicionar telemetria protocolar e deixar a baseline provável.

Risco: baixo.

### Patch 2 — Refactor handler protocol-neutral

Arquivos:

- `src/copilot/mcp/adapters/http.js`
- possível novo `src/copilot/mcp/adapters/shared-http-handler.js`

Objetivo: preparar H2 sem alterar comportamento H1.

Risco: médio, por tocar roteamento MCP/OAuth.

### Patch 3 — Adapter HTTPS/H2 experimental

Arquivos:

- novo `src/copilot/mcp/adapters/http2.js`
- `src/copilot/mcp/index.js`
- testes novos

Objetivo: rodar Node 24 H2 local com fallback H1.

Risco: médio/alto; precisa validar SDK.

### Patch 4 — TLS dev origin

Arquivos:

- novo helper de cert dev;
- config Cloudflare;
- `.gitignore` se necessário.

Objetivo: criar origem HTTPS verificável.

Risco: médio.

### Patch 5 — Cloudflare originRequest condicional

Arquivos:

- `src/copilot/mcp/cloudflare/origin-request-profile.js`
- `src/copilot/mcp/cloudflare/remote-api.js`
- edge/apply/diff se aplicável
- testes.

Objetivo: permitir `http2Origin=true` apenas no estado certo.

Risco: médio.

### Patch 6 — Canary público e benchmark

Objetivo: provar valor em produção.

Risco: alto operacionalmente; exige rollback pronto.

---

## 9. Lista “não fazer”

- Não ligar `originRequest.http2Origin=true` com `service: http://127.0.0.1:3333`.
- Não tratar `TUNNEL_TRANSPORT_PROTOCOL=http2` como migração do origin para HTTP/2.
- Não usar `noTLSVerify=true` como postura final sem justificativa explícita.
- Não reativar sessões stateful via replay de body.
- Não cachear `/mcp`, `/oauth/token` ou responses autenticadas.
- Não adicionar Cloudflare Access/challenge interativo na frente de `/mcp`.
- Não transformar/remover headers de auth, CORS, OAuth ou content-type.
- Não otimizar apenas protocolo ignorando payload de `tools/list`.
- Não trocar default sem smoke local + OAuth + Cloudflare + benchmark.

---

## 10. Estado deste documento

Status: **roadmap criado, implementação ainda não aplicada**.

Próxima ação recomendada: começar pelo **Patch 1 — Observabilidade sem mudança de protocolo**, porque ele reduz risco e nos dá provas antes de qualquer mudança em HTTP/2.
