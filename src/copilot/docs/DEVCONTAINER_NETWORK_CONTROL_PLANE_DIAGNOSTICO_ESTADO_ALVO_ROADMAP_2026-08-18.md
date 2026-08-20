# CHATGPT ↔ MCP END-TO-END INTERACTION LATENCY & NETWORK CONTROL PLANE

## Diagnóstico causal, estado atual, estado-alvo e roadmap — 2026-08-18

> **Status:** documento canônico especializado para latência de interação ChatGPT ↔ MCP, Network
> Control Plane, DevContainer, Cloudflare Tunnel e superfícies OpenAI/ChatGPT.
>
> **Escopo:** `/workspaces/chatgpt-docker-puppeteer`, com foco em `.devcontainer/**`,
> `src/copilot/**`, MCP HTTP/OAuth/stateful runtime, Cloudflare Tunnel, rede do DevContainer e
> circuitos externos relevantes.
>
> **Branch observada:** `main`.
>
> **HEAD observado nesta revisão:** `b4c4feb53`.
>
> **Relação com o roadmap mestre:** este documento aprofunda a dimensão de conectividade/latência do
> projeto e deve permanecer coerente com
> `src/copilot/docs/WORKSPACE_MCP_IO_LATENCIA_LIBERDADE_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-17.md`.
>
> **Mudança de tese desta revisão:** o objeto arquitetural não é mais apenas um _Network Control
> Plane_. As medições demonstraram que o principal problema percebido ocorre, na maior parte das
> janelas observadas, **fora da execução do MCP e fora do round-trip ordinário do Cloudflare
> Tunnel**. O estado-alvo passa a ser um **Interaction Latency Control Plane (ILCP)**, do qual o
> Network Control Plane (NCP) é um subsistema.

---

# 1. Síntese executiva

A investigação de 18 de agosto de 2026 alterou materialmente a compreensão do problema de
desempenho.

O sintoma central relatado é uma demora muito grande **entre tools**: depois que uma tool termina e
antes que a próxima tool seja efetivamente despachada ao MCP. A observação subjetiva de que o
sistema pode ficar muito mais rápido em certos horários também foi corroborada por histórico
persistido: o p50 de gaps reconstruídos varia de aproximadamente **5,5 s em janelas rápidas** para
aproximadamente **14–15 s em janelas lentas**, sem mudança proporcional no custo local das tools.

A instrumentação nova permite decompor o circuito de forma muito mais rigorosa:

```text
tool anterior retorna
        │
        ▼
T0  handler end
        │  origin post-handler: ~ms
        ▼
T1  HTTP response finish no origin MCP
        │
        │  ┌───────────────────────────────────────────────┐
        │  │ gap externo                                  │
        │  │                                               │
        │  │ requests auxiliares observáveis: ~1–2%       │
        │  │ silêncio no origin: ~98%                     │
        │  └───────────────────────────────────────────────┘
        │
        ▼
T2  próxima HTTP tools/call chega ao origin
        │  origin pre-handler: ~ms
        ▼
T3  guard/registry/authorization
        │
        ▼
T4  handler da próxima tool
```

Os resultados mais importantes da janela controlada mais recente foram:

| dimensão                                       |                                           valor representativo | leitura causal                                                       |
| ---------------------------------------------- | -------------------------------------------------------------: | -------------------------------------------------------------------- |
| `mcp_latency_pulse` handler                    |                                                        ~0–1 ms | workload da tool não explica a demora                                |
| handler médio MCP na attribution               |                                                  dezenas de ms | origin local saudável                                                |
| `preHandler`                                   |                                                        ~4–8 ms | parsing/SDK/dispatch local não explicam segundos                     |
| `postHandler`                                  |                                                       ~4–19 ms | serialização/finalização local não explicam segundos                 |
| gap externo p50                                | ~5–10 s em séries controladas; ~9,8 s no histórico natural 24h | atraso dominante fora do origin                                      |
| gap externo p95                                |                frequentemente 8–30+ s conforme workload/janela | cauda muito alta fora do origin                                      |
| **gap silencioso p50**                         |                     **~5–8 s em janelas controladas recentes** | quase todo o tempo não contém trabalho discreto observável no MCP    |
| cobertura auxiliar                             |                                                    **~0,2–2%** | initialize/OAuth/etc. são secundários                                |
| **tempo até o primeiro trabalho discreto p50** |                          **~6,87 s em amostra madura recente** | ~97% do gap ocorre antes do próximo `initialize`                     |
| cauda após o trabalho discreto p50             |                                                     **~83 ms** | handshake/notifications→`tools/call` são rápidos                     |
| primeiro RPC discreto                          |                                               **`initialize`** | atraso dominante antecede a própria negociação da nova sessão        |
| pulse `thinking=medium`                        |                **p50 5,59 s; média 5,47 s; n=7 estabilizados** | multi-segundo persiste em medium                                     |
| pulse `thinking=high`                          |                **p50 6,43 s; média 5,93 s; n=7 estabilizados** | ~15% pior na mediana; sinal contributivo, não explicação suficiente  |
| `chatgpt.com` endpoint TTFB                    |                                      **p50 83 ms; p95 121 ms** | rota DevContainer→endpoint muito menor que pre-dispatch silence      |
| `ws.chatgpt.com` endpoint TTFB                 |                                     **p50 240 ms; p95 614 ms** | endpoint apresenta alguma variabilidade, ainda subsegundo na amostra |
| `api.openai.com` endpoint TTFB                 |                                     **p50 274 ms; p95 414 ms** | também muito abaixo do atraso de vários segundos                     |
| public MCP self-loop p50                       |                                                   ~0,16–0,30 s | caminho ordinário Cloudflare é dezenas de vezes menor                |
| razão gap/self-loop                            |                                   ~30–60× em amostras recentes | tunnel/origin ordinário insuficiente para explicar o gap             |
| edge colo                                      |                                             quase sempre `GRU` | troca de colo não explica variação observada                         |
| QUIC RTT                                       |                                                  dezenas de ms | muito abaixo do atraso percebido                                     |
| HA cloudflared                                 |                                                              4 | tunnel operacional                                                   |
| connector smoke                                |                                                          verde | OAuth/tools-list/SSE/health funcionais                               |
| tools                                          |                             123 projetadas; default server 250 | contagem não é evidência da causa local                              |

A classificação causal atual do `mcp_latency_attribution` permanece:

```text
likely-pre-mcp-or-upstream-chatgpt
```

A confiança chega a **high** quando há amostra suficiente após o restart; imediatamente depois de um
novo epoch ela pode cair temporariamente para `medium` até acumular ≥3 transições silenciosas. A
classe causal, porém, tem permanecido estável porque handler/origin/tunnel continuam muito menores
que o atraso pré-dispatch.

com razões observadas como:

- `high-origin-http-external-gap`;
- `predominantly-silent-external-gap`;
- `pre-discrete-session-work-silence-dominates`;
- `per-call-stateful-session-initialize-churn`;
- `high-inter-tool-quiescent-gap`;
- `origin-external-gap-much-larger-than-public-self-loop`;
- `reported-slowness-not-explained-by-local-mcp-or-tunnel`.

A tese operacional passa a ser:

> **O principal imposto temporal atualmente observado é um imposto por round-trip modelo/host →
> tool, não um imposto de execução da tool.**

Isso não significa que “rede não importa”. Significa que a arquitetura deve distinguir:

1. **rede e origin que controlamos**;
2. **rede cliente ↔ OpenAI**;
3. **rede OpenAI ↔ Cloudflare/MCP**;
4. **orquestração/model scheduling/tool planning**;
5. **contexto/conversa/modelo**, que não são observáveis diretamente do workspace.

Consequência de engenharia:

> Quando um novo round-trip custa tipicamente vários segundos de silêncio externo, uma tool que
> executa 5–20 operações seguras em lote pode produzir ganhos de ordem de grandeza maiores do que
> reduzir um handler local de 30 ms para 10 ms.

Logo, o roadmap agora tem duas grandes linhas simultâneas:

- **atribuição causal e experimentação end-to-end**;
- **amortização segura de round-trips sob nosso controle**.

---

# 2. O que mudou em relação à arquitetura anterior

A versão anterior deste documento era correta ao tratar o DevContainer Network Control Plane como
infraestrutura crítica, mas implicitamente dava peso excessivo à hipótese de que a lentidão
percebida estivesse no caminho DNS/proxy/Cloudflare/MCP.

A nova instrumentação falsificou grande parte dessa hipótese.

O NCP continua necessário para:

- DNS;
- proxy;
- GitHub/Copilot;
- OpenAI reachability;
- Cloudflare Tunnel;
- observabilidade de transporte;
- recuperação de falhas;
- `authority` e freshness;
- correlação de eventos de WSL/Docker/tunnel;
- suporte ao problema raro de “aguardando conexão”.

Mas o NCP deixa de ser o plano superior.

O estado-alvo passa a ser:

```text
Interaction Latency Control Plane (ILCP)
├── Origin/MCP execution plane
├── Connector/session plane
├── Network Control Plane (NCP)
│   ├── DNS substrate
│   ├── proxy
│   ├── provider reachability
│   ├── Cloudflare tunnel
│   └── edge/transport evidence
├── Historical evidence plane
├── Experiment/A-B plane
└── External-unobservable plane
    ├── ChatGPT host/control plane
    ├── model inference / reasoning
    ├── scheduler / queue
    ├── tool planner / policy
    ├── conversation context
    └── client ↔ OpenAI WebSocket path
```

O ILCP não tenta “observar o invisível”. Seu objetivo é reduzir progressivamente a região não
observada por exclusão causal, produzindo uma fronteira explícita de autoridade.

---

# 3. Princípios de autoridade e epistemologia operacional

## 3.1 Estados de autoridade

Cada evidência deve ser marcada como uma destas classes:

- `observed-in-origin-process`;
- `observed-at-http-origin-request-response-boundary`;
- `reconstructed-from-persisted-origin-audit-events`;
- `observed-container-public-mcp-self-loop-reference`;
- `observed-from-local-cloudflared-metrics`;
- `observed-from-container`;
- `observed-from-client`;
- `official-provider-documentation`;
- `official-aggregate-status-not-individual-session-health`;
- `configured`;
- `inferred`;
- `cached-observation`;
- `stale-observation`;
- `not-observable-from-workspace`.

## 3.2 Regra de não-colapso causal

Nunca transformar:

```text
“não vejo falha local”
```

em:

```text
“sei exatamente qual serviço interno da OpenAI está lento”.
```

O máximo permitido é:

```text
“o atraso foi medido antes da próxima request chegar ao nosso origin,
while origin/tunnel/self-loop permaneciam saudáveis”.
```

Isso é evidência forte de localização **externa ao origin**, não telemetria do scheduler da OpenAI.

## 3.3 Regra de falsificação

Uma hipótese só sobe de prioridade quando possui:

1. assinatura esperada;
2. métrica observável;
3. teste diferencial ou temporal;
4. possibilidade de produzir evidência contrária.

Hipóteses não falsificáveis devem ser rotuladas explicitamente como tais.

---

# 4. Superfícies investigadas

A investigação acumulada desta frente leu e/ou modificou as seguintes famílias:

## 4.1 DevContainer e network lifecycle

- `.devcontainer/devcontainer.json`;
- `.devcontainer/Dockerfile`;
- `.devcontainer/nss-gatekeeper.sh`;
- `.devcontainer/scripts/healthcheck.sh`;
- `.devcontainer/scripts/network-control-plane-state.sh`;
- `.devcontainer/scripts/post-attach.sh`;
- `.devcontainer/scripts/post-create.sh`;
- `.devcontainer/scripts/post-start.sh`;
- `.devcontainer/scripts/sync-local-auth.sh`;
- `.devcontainer/scripts/validate-env.sh`;
- `.devcontainer/scripts/network/copilot-route-advisor.sh`;
- `.devcontainer/scripts/network/github-api-route-fix.sh`;
- `.devcontainer/scripts/network/github-copilot-network-manager.sh`;
- `.devcontainer/scripts/network/local-copilot-proxy.sh`;
- `.devcontainer/scripts/network/local-dns-cache.sh`;
- `.devcontainer/scripts/network/contracts/summary-contracts.jsonc`;
- `.devcontainer/scripts/network/endpoints.github-copilot.tsv`;
- `scripts/ops/copilot-network-diagnose.sh`.

## 4.2 MCP / HTTP / OAuth / state

- `src/copilot/mcp/server.js`;
- `src/copilot/mcp/registry.js`;
- `src/copilot/mcp/tool-surface.js`;
- `src/copilot/mcp/adapters/http-shared.js`;
- `src/copilot/mcp/adapters/http-stateful-router.js`;
- `src/copilot/mcp/control-plane/metrics.js`;
- `src/copilot/mcp/control-plane/audit.js`;
- `src/copilot/mcp/control-plane/jobs.js`;
- `src/copilot/mcp/control-plane/session-runtime.js`;
- `src/copilot/mcp/control-plane/session-store.js`;
- `src/copilot/mcp/tools/runtime-health.js`;
- `src/copilot/mcp/tools/latency-dashboard.js`;
- `src/copilot/mcp/tools/latency-attribution.js`;
- `src/copilot/mcp/scripts/latency-benchmark.js`;
- testes focados correspondentes.

## 4.3 Cloudflare

- `src/copilot/mcp/cloudflare/**`;
- `metrics-histograms.js`;
- remote audit;
- edge audit;
- config audit;
- tunnel origin plan;
- transport benchmark;
- `http-latency-analytics.js`;
- logs/metrics do `cloudflared`.

## 4.4 Evidência oficial externa

Fontes primárias consultadas nesta revisão incluem:

- OpenAI Help — Network recommendations for ChatGPT errors on web and apps:
  - `https://help.openai.com/en/articles/9247338`
  - `https://help.openai.com/pt-br/articles/9247338-recomendações-de-rede-para-erros-do-chatgpt-na-web-e-em-apps`
- OpenAI Help — Troubleshooting ChatGPT Error Messages:
  - `https://help.openai.com/en/articles/7996703`
- Cloudflare Tunnel — firewall/connectivity:
  - `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/`
- Cloudflare Tunnel — run parameters:
  - `https://developers.cloudflare.com/tunnel/advanced/run-parameters/`
- Cloudflare Tunnel — troubleshooting:
  - `https://developers.cloudflare.com/tunnel/troubleshooting/`
- Cloudflare Tunnel — origin parameters:
  - `https://developers.cloudflare.com/tunnel/advanced/origin-parameters/`.

---

# 5. Modelo temporal end-to-end

## 5.1 Timeline observável

Para cada `tools/call`, o origin passa a observar:

```text
A. previous handler end
B. previous response finish
C. auxiliary request intervals
D. next tools/call request arrival
E. pre-handler end / guarded dispatch
F. handler end
G. response finish
```

Definições:

```text
originPostHandler = B - A
externalGap       = D - B
auxiliaryCoverage = union(requestIntervals ∩ [B,D])
silentExternalGap = externalGap - auxiliaryCoverage
originPreHandler  = E - D
handler           = F - E
nextPostHandler   = G - F
```

## 5.2 Por que `silentExternalGap` é a métrica central

Antes dessa instrumentação, um gap de 10 s poderia esconder:

- `tools/list`;
- initialize;
- OAuth refresh;
- metadata;
- SSE reconnect;
- outros requests do connector.

Agora isso é quantificado.

Na janela recente:

```text
externalGap p50        ≈ 8.5 s
silentExternalGap p50  ≈ 8.3 s
auxiliaryCoverage p50  ≈ 0.15 s
overall coverage       ≈ 1.8%
```

Logo, aproximadamente 98% do intervalo não contém trabalho HTTP/MCP observável no origin.

Essa observação é mais forte do que simplesmente dizer “handler é rápido”.

---

# 6. Experimento controlado `mcp_latency_pulse`

A tool `mcp_latency_pulse` existe para remover o workload como confounder.

Características:

- sem I/O de repositório;
- sem parsing de arquivos;
- sem consulta externa;
- payload mínimo;
- resultado mínimo;
- handler tipicamente ~0–1 ms.

Série controlada observada:

```text
~9.9 s
~5.2 s
~5.0 s
~7.9 s
~7.9 s
~8.4 s
~5.0 s
~5.3 s
```

Série adicional:

```text
~10.4 s
~6.3 s
~8.5 s
```

Conclusão:

> A variação de vários segundos sobrevive quando a tool executada é praticamente constante e
> trivial.

Isso enfraquece fortemente as hipóteses de:

- I/O do repo;
- parser;
- tamanho do arquivo;
- handler específico;
- result payload;
- serialização local.

---

# 7. Histórico longitudinal e efeito horário

O audit append-only já existente (`src/copilot/.ai/audit/mcp-tool-calls.jsonl`) permite reconstrução
retroativa de gaps.

A análise bounded:

- lê apenas tail limitado;
- ignora linha parcial;
- preserva concorrência;
- separa idle >60 s;
- reconstrói bursts;
- gera janelas 15 min / 1 h / 6 h / 24 h;
- produz buckets horários;
- produz baseline p25;
- identifica pulsos controlados.

Janelas observadas demonstraram variação temporal relevante:

- hora rápida: p50 ≈ **5,47 s**;
- hora lenta: p50 ≈ **14,65 s**;
- diversas janelas entre ~8 e ~13 s.

Isso é compatível com:

- carga upstream;
- scheduler/model queue;
- diferenças de modelo/turno;
- diferenças de workload;
- diferenças de contexto;
- diferenças regionais.

Não é prova causal isolada porque o workload histórico varia.

O `mcp_latency_pulse` é, daqui em diante, o controle para remover esse confounder.

---

# 8. Hipótese de degradação por conversa/sessão longa

Foi criada uma heurística limitada de _active work cluster_:

- um cluster termina após >30 min sem tool burst;
- gaps são classificados por idade do cluster:
  - 0–30m;
  - 30–60m;
  - 1–2h;
  - 2–4h;
  - 4h+.

Resultado representativo:

| idade heurística |     p50 |
| ---------------- | ------: |
| 0–30m            |  ~9,9 s |
| 30–60m           | ~12,7 s |
| 1–2h             | ~13,5 s |
| 2–4h             | ~11,5 s |
| 4h+              |  ~8,7 s |

`late/early ≈ 0,93`.

Conclusão:

> O audit MCP **não sustenta uma degradação monotônica simples em função da duração contínua de
> trabalho**.

Isso **não** falsifica a hipótese de contexto de conversa longa, porque o workspace não observa:

- token count real da conversa;
- tamanho do prompt interno;
- contexto comprimido;
- tool result ingestion do host;
- cache de contexto do modelo;
- tempo de inferência/model scheduling.

A OpenAI atualmente recomenda, para ChatGPT lento ou preso, testar **novo chat** quando a conversa é
longa, além de rede/browser/VPN. Essa recomendação torna o A/B “conversa nova vs conversa longa” um
experimento legítimo do lado cliente.

---

# 9. Stateful MCP: nova descoberta de churn por tool call

## 9.1 O servidor está realmente stateful

O runtime observado mostra:

```text
enabled=true
requested=true
statelessCompat=false
TTL=600000 ms
maxSessions=256
statelessFallbackRequests=0
```

Logo, não existe uma regressão simples para stateless.

## 9.2 O cliente/host inicializa uma sessão nova por chamada

A activity timeline demonstrou, aproximadamente 1:1:

```text
initialize
notifications/initialized
tools/call
```

por tool call.

Exemplo observado:

```text
8 tools/call
8 initialize
8 notifications/initialized
```

## 9.3 Acúmulo live

Após restart:

```text
activeSessions = 2
registered = 2
terminated = 0
```

Depois de três pulses + uma leitura adicional:

```text
activeSessions = 6
registered = 6
terminated = 0
expired = 0
```

Depois:

```text
activeSessions = 8
registered = 8
terminated = 0
```

Conclusão:

> O host cria uma nova sessão stateful por call e não termina imediatamente a anterior.

## 9.4 Por que isso não explica a latência principal

O initialize/notifications/SSE observado consome normalmente da ordem de **centenas de
milissegundos**, enquanto o `silentExternalGap` consome vários segundos.

Logo:

- **causa principal da latência:** não;
- **overhead real:** sim;
- **risco de capacidade:** potencialmente;
- **fonte de ruído operacional:** sim.

## 9.5 Política correta

Não reduzir TTL cegamente.

O runtime faz sweep de expirados em novos initializes, portanto não existe leak ilimitado; existe
uma janela deslizante definida pelo TTL.

O ILCP agora projeta:

```text
registrationsPerMinute
projectedSessionsAtTtl
projectedCapacityRatio
```

Na janela controlada pós-reload observada em 2026-08-18:

```text
activeSessions           = 7
registrationsPerMinute   ≈ 10,23
projectedSessionsAtTtl   ≈ 102,3
maxSessions              = 256
projectedCapacityRatio   ≈ 0,40
projectionStatus         = headroom-ok
```

Logo, **não existe evidência atual para baixar TTL ou elevar `maxSessions` como remediação**. O
churn deve continuar monitorado, mas o headroom projetado é suficiente na taxa observada.

Essas projeções devem ser usadas antes de decidir:

- TTL;
- maxSessions;
- reclaim adaptativo;
- mudança de compatibilidade.

Preferência de mitigação:

1. reutilização pelo cliente, se possível;
2. terminação explícita pelo cliente;
3. reclaim somente de sessões comprovadamente abandonadas;
4. TTL experimental controlado;
5. aumentar `maxSessions` apenas se necessário e com budget de memória/state store.

---

# 10. Network Control Plane atual

## 10.1 DNS

Estado observado:

- dnsmasq local operacional;
- `resolv.conf` apontando para `127.0.0.1`;
- warmup operacional;
- sem evidência de resolução quebrada para o circuito MCP;
- proxy global off.

O NCP agregado ainda pode aparecer degradado quando artifacts antigos de GitHub/Copilot são stale.
Isso deve ser corrigido semanticamente: artifact stale não pode governar runtime atual.

## 10.2 Cloudflare Tunnel

Config canônica:

```text
public  = https://mcp.aurelin.org/mcp
mode    = named-permanent
auth    = OAuth
edge    = Cloudflare
cf→origin protocol = HTTP/2 quando solicitado
origin  = https://127.0.0.1:3333
SNI     = mcp.aurelin.org
transport cloudflared→edge = QUIC atualmente
HA      = 4
```

## 10.3 Public self-loop

Probe:

```text
container → mcp.aurelin.org → Cloudflare → tunnel → origin → container
```

Resultados recentes:

```text
p50 ≈ 0,18–0,30 s
```

Versus gap externo:

```text
p50 ≈ 6–12+ s
```

Esse A/B é uma das evidências mais fortes contra o tunnel ordinário como gargalo dominante.

## 10.4 Edge colo

Requests atuais chegam majoritariamente em `GRU`.

A latência externa varia de múltiplos segundos **mantendo `GRU`**.

Logo, mudança de colo não é necessária para produzir o problema.

Isso enfraquece:

- anycast colo switching;
- rota do edge como causa dominante;
- mudança aleatória de IP do origin como remediação primária.

## 10.5 Cloudflare rules

Auditorias confirmaram regra específica do hostname MCP que desliga ou neutraliza features
inadequadas para uma API dinâmica:

- Browser Integrity Check;
- Rocket Loader;
- Email Obfuscation;
- buffering de response;
- cache em paths dinâmicos.

WAF/rulesets atuais não exibiram bloqueio/challenge capaz de explicar o padrão de silêncio
observado.

## 10.6 Benchmark controlado QUIC ↔ AUTO ↔ HTTP/2

O runner fixo executou cinco smokes canônicos idênticos por perfil e restaurou automaticamente o
controle QUIC.

Resultados:

| perfil | p50 smoke | p95 smoke |  HA | smokes     |
| ------ | --------: | --------: | --: | ---------- |
| QUIC   |   7765 ms |   8042 ms |   4 | 5/5 verdes |
| AUTO   |   7860 ms |   7949 ms |   4 | 5/5 verdes |
| HTTP/2 |   7591 ms |   8016 ms |   4 | 5/5 verdes |

Diferença p95 em relação ao controle QUIC:

```text
AUTO   ≈ -1,16%
HTTP/2 ≈ -0,32%
```

Todos os perfis foram comparáveis e passaram os hard gates. Os deltas brutos de
`cloudflared requestErrors` permaneceram `review-required`, não veto, porque smokes, response codes
e HA ficaram saudáveis.

Conclusão:

> **QUIC vs TCP/HTTP2 não produz diferença de ordem de grandeza compatível com os gaps silenciosos
> de múltiplos segundos.**

Isso enfraquece fortemente hipóteses de UDP/QUIC/MTU como causa central do fenômeno atual. QUIC
permanece o controle porque está saudável; HTTP/2 permanece rollback/baseline TCP, não “correção de
latência”.

## 10.7 GraphQL analytics

Foi criada uma capability read-only para consultar Cloudflare HTTP Analytics.

O plano/token atual não expõe os timing fields desejados (`EdgeTimeToFirstByteMs` etc.) na
superfície consultada.

Isso deve ser tratado como:

```text
capability gap
```

não como:

```text
network failure
```

Melhoria futura opcional: introspecção de schema e escolha dinâmica de campos disponíveis.

---

# 11. OpenAI/ChatGPT: fatos de rede que importam

A documentação atual da OpenAI explicita que ChatGPT utiliza WebSocket seguro além de HTTPS em
algumas superfícies.

Destinos documentados incluem:

```text
wss://ws.chatgpt.com
wss://chatgpt.com/
```

A OpenAI recomenda verificar:

- TCP 443;
- WebSocket Upgrade;
- VPN;
- proxy;
- TLS inspection / SSL decryption;
- secure web gateways;
- WebSocket idle timeout;
- frame/message size limits;
- mudança para outra rede;
- hotspot celular;
- outro dispositivo/browser;
- conversa nova quando a conversa longa apresenta lentidão;
- HAR/console com timestamps em casos persistentes.

Esses fatos geram experimentos legítimos do lado cliente, mas não devem ser confundidos com
telemetria do origin MCP.

## 11.1 Três relógios que não podem mais ser confundidos

A investigação passou a separar explicitamente três famílias de tempo:

### A. ChatGPT UI TTFT

```text
submit do usuário → primeiro token do assistente renderizado/streamed no cliente
```

- é o TTFT que melhor descreve a sensação de “começou a responder?”;
- **não é observável diretamente pelo origin MCP**;
- requer timestamp do cliente, HAR ou observer local;
- agora possui contrato próprio de evidência sanitizada em `mcp_client_latency_evidence`;
- o histórico não armazena prompt, completion, HAR bruto, URL, cookie, token nem IP.

### B. OpenAI/ChatGPT endpoint TTFB visto do DevContainer

```text
request HTTPS nova no DevContainer → primeiros headers HTTP do endpoint fixo
```

O novo observador `mcp_openai_endpoint_latency` mede, no mesmo request:

```text
DNS → TCP → TLS → TTFB → body/end → total
```

Targets fechados:

```text
chatgpt.com
ws.chatgpt.com
api.openai.com
```

Authority:

```text
observed-from-devcontainer-to-fixed-openai-endpoints
```

Esse TTFB é um **canary de caminho/rede/edge**, não inferência de modelo e não TTFT da UI.

Primeiro baseline live no modo thinking high:

| target           | DNS p50 | TCP p50 | TLS p50 |   TTFB p50 | TTFB p95 | edge |
| ---------------- | ------: | ------: | ------: | ---------: | -------: | ---- |
| `chatgpt.com`    |    5 ms |   25 ms |   28 ms |  **83 ms** |   121 ms | GRU  |
| `ws.chatgpt.com` |    4 ms |   24 ms |   25 ms | **240 ms** |   614 ms | GRU  |
| `api.openai.com` |    3 ms |   29 ms |   27 ms | **274 ms** |   414 ms | GRU  |

Os status HTTP `403/404/401` observados são semanticamente aceitáveis como prova de reachability não
autenticada dos endpoints correspondentes; o observador mede o caminho até a primeira resposta, não
sucesso de produto/autorização.

### C. MCP pre-dispatch / pre-session delay

```text
response finish da tool anterior → primeiro trabalho discreto do ciclo seguinte
```

Em amostra madura:

```text
external gap p50                    ≈ 7,08 s
first discrete work delay p50       ≈ 6,87 s
first discrete / external ratio     ≈ 97,1%
primeiro RPC discreto               = initialize
tail após trabalho discreto p50     ≈ 83 ms
```

Logo:

> **o atraso dominante medido no tool loop surge antes até mesmo de o próximo `initialize` alcançar
> o MCP.**

Essa métrica não é TTFT, mas é hoje o melhor relógio server-side para localizar o imposto entre
tools.

## 11.2 Persistência e baseline dos endpoints OpenAI

Novo histórico bounded:

```text
src/copilot/.ai/mcp/openai-endpoint-latency.jsonl
```

Propriedades:

- conexão HTTPS fresca por sample;
- nenhuma resposta/body persistida;
- nenhum IP bruto persistido;
- colo Cloudflare reduzido ao sufixo seguro;
- até 1000 snapshots por default;
- tail de leitura bounded;
- baseline de 24h;
- regressão TTFB somente quando simultaneamente `>=2x` e `>=150 ms` sobre baseline, evitando alarmes
  por ruído pequeno.

## 11.3 Evidência TTFT de cliente

Novo histórico bounded:

```text
src/copilot/.ai/mcp/client-latency-evidence.jsonl
```

Amostras podem carregar somente:

- `source = manual|har|client-observer`;
- `ttftMs`;
- `firstToolDispatchMs` opcional;
- `turnCompleteMs` opcional;
- `thinkingMode`;
- labels sanitizados de modelo/rede/conversa/client/VPN/série.

O resumo produz p25/p50/p95 e comparação high↔medium, mas só marca a comparação como direcionalmente
suficiente quando há pelo menos cinco amostras em cada grupo.

## 11.4 API streaming TTFT

É uma quarta métrica possível:

```text
request autenticada ao modelo → primeiro delta/chunk de output
```

Ela exige uma chamada real de modelo e pode consumir quota/custo. Portanto:

- não deve ser executada escondida dentro de health checks;
- deve usar model/endpoint/prompt fixos e allowlisted;
- deve exigir opt-in explícito de uso;
- deve ser analisada separadamente do TTFT da UI do ChatGPT.

---

# 12. Catálogo causal — HYP-001 a HYP-055

Legenda:

- **CONFIRMADA-PRIMÁRIA:** evidência forte de contribuição dominante;
- **CONFIRMADA-SECUNDÁRIA:** existe, mas explica pequena fração;
- **ENFRAQUECIDA:** evidência atual vai contra a hipótese como causa principal;
- **FORTEMENTE ENFRAQUECIDA:** múltiplos experimentos contradizem;
- **PLAUSÍVEL:** compatível, ainda sem observabilidade suficiente;
- **NÃO OBSERVÁVEL:** workspace não tem autoridade direta;
- **A TESTAR:** há experimento concreto ainda não executado.

## 12.1 Origin / tool execution

### HYP-001 — handler das tools é lento

- **status:** FORTEMENTE ENFRAQUECIDA.
- **assinatura esperada:** handler p50/p95 acompanha demora percebida.
- **evidência:** pulses com handler ~0–1 ms ainda exibem 5–10 s.
- **mitigação:** manter otimizações locais, mas não tratá-las como solução do gap.

### HYP-002 — parsing/SDK dispatch do MCP é lento

- **status:** FORTEMENTE ENFRAQUECIDA.
- **métrica:** `preHandler`.
- **evidência:** poucos milissegundos.

### HYP-003 — serialização/finalização da resposta é lenta

- **status:** FORTEMENTE ENFRAQUECIDA.
- **métrica:** `postHandler`.
- **evidência:** poucos milissegundos.

### HYP-004 — I/O do repositório é o gargalo principal

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** pulse sem I/O mantém o problema.

### HYP-005 — parser/index/cache locais dominam

- **status:** FORTEMENTE ENFRAQUECIDA para o gap entre tools.
- **nota:** continuam relevantes ao custo **dentro** de tools pesadas.

### HYP-006 — validator CPU contention domina

- **status:** ENFRAQUECIDA como causa geral.
- **teste futuro:** comparar pulses com validator idle vs ativo.
- **mitigação:** validators sequenciais/bounded continuam corretos.

## 12.2 Tool schema / payload / count

### HYP-007 — quantidade total de tools é a causa local principal

- **status:** ENFRAQUECIDA.
- **evidência:** runtime local e pulse não dependem da listagem total durante cada call.
- **ressalva:** o host/model pode pagar custo interno de tool selection sobre o schema; isso é NÃO
  OBSERVÁVEL do workspace.
- **ação:** manter default 250 como headroom; não usar redução de tools como “cura” sem A/B.

### HYP-008 — tamanho do payload de `tools/list` domina cada call

- **status:** ENFRAQUECIDA.
- **evidência:** não houve `tools/list` entre pulses.
- **ação:** budget elevado proporcionalmente, mas fora da hipótese central.

### HYP-009 — tamanho do resultado da tool domina

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** pulse com resultado mínimo continua lento.

### HYP-010 — context ingestion do host após resultados grandes

- **status:** PLAUSÍVEL.
- **assinatura:** gaps maiores após results grandes, controlando modelo/horário.
- **experimento:** bucket de gap por result bytes da call anterior.
- **mitigação:** compact results, local persistence, references/hints.

## 12.3 Connector/session

### HYP-011 — `tools/list` é repetido entre cada tool

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** pulse chain registrou `initialize` e `notifications/initialized`, não `tools/list`
  por call.

### HYP-012 — OAuth refresh domina

- **status:** ENFRAQUECIDA.
- **evidência:** coverage auxiliar pequena; authorization local cache saudável.

### HYP-013 — nova sessão MCP por tool call

- **status:** CONFIRMADA-SECUNDÁRIA.
- **evidência:** initialize/tool ≈ 1; sessions 2→6→8.
- **custo:** ~centenas de ms, não segundos.
- **mitigação:** observar/reduzir churn sem quebrar compatibilidade.

### HYP-014 — sessões acumuladas esgotam capacidade

- **status:** A TESTAR / projetável.
- **métrica:** `registrationsPerMinute × TTL / maxSessions`.
- **ação:** capacity projection first; nenhuma mudança cega de TTL.

### HYP-015 — session-store SQLite é o gargalo

- **status:** ENFRAQUECIDA.
- **assinatura:** initialize/touch teria duração material.
- **evidência:** coverage auxiliar baixa.

### HYP-016 — SSE reconnect churn explica o gap

- **status:** ENFRAQUECIDA como causa dominante.
- **evidência:** activity union explica ~1–2%.

## 12.4 Cloudflare / origin transport

### HYP-017 — Cloudflare Tunnel ordinário é lento

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** self-loop ~0,2–0,3 s; gap externo dezenas de vezes maior.

### HYP-018 — QUIC RTT alto explica segundos

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** RTT ~dezenas de ms.

### HYP-019 — UDP/QUIC/MTU causa stalls

- **status:** FORTEMENTE ENFRAQUECIDA como causa central.
- **evidência:** packet-too-big drops não aparecem; tunnel permanece 4 HA; benchmark com 5 smokes
  por perfil produziu p95 8042 ms (QUIC), 7949 ms (AUTO) e 8016 ms (HTTP/2), diferenças de ~1% ou
  menos.
- **conclusão:** a troca de protocolo não altera a ordem de grandeza do workload e não explica
  silent gaps de 6–17 s.
- **ação:** manter QUIC enquanto saudável e H2 como rollback/baseline.

### HYP-020 — troca de edge colo causa variação

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** variação grande mantendo `GRU`.

### HYP-021 — BIC/WAF/browser features degradam MCP

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** rule específica neutraliza features relevantes.

### HYP-022 — cache/buffering Cloudflare introduz latência

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** cache bypass e buffering none no path relevante.

### HYP-023 — origin TLS/H2 handshake é dominante

- **status:** ENFRAQUECIDA.
- **evidência:** self-loop inclui esse circuito e permanece subsegundo.

### HYP-024 — OpenAI→Cloudflare path é ruim, mas container→Cloudflare não

- **status:** PLAUSÍVEL.
- **autoridade:** não observável diretamente sem edge analytics/logs adicionais.
- **experimento:** Cloudflare request analytics/logpush, se plano permitir; comparar colos/TTFB.

## 12.5 DNS / proxy / DevContainer

### HYP-025 — DNS local lento causa gap

- **status:** FORTEMENTE ENFRAQUECIDA para tools/call.
- **evidência:** próxima call nem chega ao origin durante o silêncio.

### HYP-026 — dnsmasq ownership conflict degrada

- **status:** corrigida anteriormente; não suportada atualmente.

### HYP-027 — proxy global do DevContainer interfere

- **status:** FORTEMENTE ENFRAQUECIDA.
- **evidência:** proxy off.

### HYP-028 — WSL/Docker queda parcial causa o sintoma

- **status:** PLAUSÍVEL para “aguardando conexão” abrupto, não para gap persistente com health
  verde.
- **assinatura:** origin/tunnel indisponível, recovery epoch, smoke falhando.

## 12.6 ChatGPT/OpenAI host/model plane

### HYP-029 — model inference/reasoning entre tools consome segundos

- **status:** PLAUSÍVEL, PRIORIDADE MÁXIMA ENTRE AS CAUSAS NÃO OBSERVÁVEIS.
- **autoridade:** NÃO OBSERVÁVEL diretamente.
- **evidência de localização:** em amostra recente, `externalGap p50≈7,08 s`,
  `first discrete auxiliary delay p50≈6,87 s`, razão ≈97%; o primeiro RPC discreto foi `initialize`
  e a cauda posterior ficou ≈83 ms p50.
- **interpretação:** o atraso acontece majoritariamente **antes de o host iniciar a próxima
  negociação MCP**, portanto reasoning/scheduling/planning ganham peso relativo.
- **mitigação:** menos round-trips; modelo/configuração A/B quando possível.

### HYP-030 — scheduler/queue da OpenAI varia por carga

- **status:** PLAUSÍVEL, PRIORIDADE MÁXIMA ENTRE AS CAUSAS NÃO OBSERVÁVEIS.
- **evidência indireta:** forte variação horária + pulses triviais que continuam variando vários
  segundos antes do primeiro `initialize`.
- **experimento:** pulses recorrentes por horário/modelo, com labels experimentais persistidos no
  audit.

### HYP-031 — tool planner/policy evaluation do host é caro

- **status:** PLAUSÍVEL, ALTA PRIORIDADE.
- **evidência de localização:** ~94–97% do gap recente precede o primeiro `initialize`, compatível
  com deliberação/tool-selection anterior à abertura da sessão MCP.
- **experimento:** A/B com superfície reduzida vs completa, sem assumir causalidade antes da
  medição.
- **nota:** isso é diferente de dizer que “250 tools são o problema”; count/schema só podem ser
  promovidos causalmente por A/B controlado.

### HYP-032 — schema complexity pesa mais que contagem

- **status:** PLAUSÍVEL.
- **experimento:** mesma quantidade de tools com descriptors compactos vs ricos, se houver harness
  isolado.

### HYP-033 — contexto de conversa longa aumenta reasoning/selection

- **status:** PLAUSÍVEL.
- **evidência:** OpenAI recomenda novo chat em cenários de lentidão; heurística MCP não mede tokens
  reais.
- **experimento:** pulse em conversa nova vs conversa longa, mesmo modelo/horário/rede.

### HYP-034 — modelo/configuração de thinking possui maior inter-tool latency

- **status:** PLAUSÍVEL, com primeiro sinal quantitativo.
- **experimento executado:** `thinking-medium-20260818` vs `thinking-high-20260818`, pulse trivial,
  n=7 estabilizados por condição.
- **medium:** média ≈5,47 s; p50≈5,59 s; p95≈7,33 s.
- **high:** média ≈5,93 s; p50≈6,43 s; p95≈7,17 s.
- **leitura:** high foi ≈15% pior na mediana e ≈8% pior na média, mas o p95 foi praticamente igual e
  a amostra é pequena. Portanto thinking high pode contribuir, porém **não é suficiente para
  explicar o piso multissegundo**, que persiste nos dois modos.
- **próximo experimento:** séries intercaladas ABAB, maior n, mesma janela/rede/conversa,
  descartando explicitamente o primeiro pulse de warmup após troca de modo.

### HYP-035 — tier/account/load balancing altera scheduling

- **status:** NÃO OBSERVÁVEL diretamente.
- **ação:** histórico comparativo somente; evitar alegação causal forte.

### HYP-036 — serviço interno da OpenAI tem degradação sem status global

- **status:** PLAUSÍVEL.
- **nota:** Statuspage é agregada e não prova saúde individual.

## 12.7 Client ↔ OpenAI

### HYP-037 — WebSocket cliente está instável

- **status:** PLAUSÍVEL para spinner/stall/turn-level; menos convincente para silêncio server→MCP
  dentro de um turno.
- **fonte:** OpenAI documenta `ws.chatgpt.com` e problemas de proxies/TLS inspection.
- **experimento:** HAR/console + hotspot.

### HYP-038 — VPN/proxy do cliente introduz stalls

- **status:** A TESTAR.
- **experimento:** VPN off vs on, mantendo restante constante.

### HYP-039 — secure DNS / security filter do cliente interfere

- **status:** A TESTAR.
- **fonte:** OpenAI recomenda desabilitar secure DNS/Web Protect em troubleshooting.

### HYP-040 — browser extension interfere

- **status:** A TESTAR para UI/browser.
- **experimento:** incognito/clean profile.

### HYP-041 — aplicativo desktop vs browser possui diferença

- **status:** A TESTAR.
- **experimento:** mesmo modelo/conversa/rede, pulse sequence equivalente.

## 12.8 IP / ISP / route

### HYP-042 — trocar IP público do origin melhora muito

- **status:** ENFRAQUECIDA como ação primária.
- **razão:** self-loop atual já é subsegundo; origin IP não é o endpoint público do usuário, pois o
  tunnel é outbound.
- **experimento permitido:** reconectar WAN/ISP somente em janela A/B, medir
  self-loop/HA/colo/pulse.

### HYP-043 — trocar IP/rede do cliente melhora ChatGPT

- **status:** A TESTAR; legitimada por documentação OpenAI.
- **experimento:** Wi-Fi atual ↔ hotspot celular.
- **métricas:** pulse p50/p95, UI stall, WebSocket/HAR.

### HYP-044 — ISP/ASN do cliente possui peering ruim com OpenAI

- **status:** PLAUSÍVEL.
- **experimento:** hotspot de operadora distinta / VPN de teste bem controlada.

### HYP-045 — IPv6 do cliente possui rota pior que IPv4

- **status:** PLAUSÍVEL.
- **experimento:** A/B IPv4-only vs dual-stack apenas se seguro e reversível.

### HYP-046 — MTU/fragmentação na rede cliente

- **status:** PLAUSÍVEL para WebSocket/stalls; ENFRAQUECIDA para tunnel atual.
- **experimento:** path-MTU diagnóstico, não tuning aleatório.

### HYP-047 — NAT/router doméstico causa WebSocket idle reset

- **status:** PLAUSÍVEL para sessões longas.
- **experimento:** hotspot direto vs roteador atual.

### HYP-048 — IP do cliente foi classificado/limitado

- **status:** BAIXA PRIORIDADE sem mensagens de “atividade incomum”.
- **fonte:** OpenAI reconhece que VPN/proxy/IP podem participar de detecção de tráfego incomum.

## 12.9 Workstation/runtime

### HYP-049 — CPU/GPU/VS Code do cliente bloqueiam resposta da UI

- **status:** PLAUSÍVEL para rendering/UI, não para chegada server-side ao MCP.
- **experimento:** comparar browser/app/CPU load; origin timestamps continuam separando.

### HYP-050 — pressão de memória/WSL provoca jitter indireto

- **status:** PLAUSÍVEL para tools locais pesadas; ENFRAQUECIDA para pulse com origin quiet.
- **experimento:** correlacionar host/WSL health com gaps; distinguir crash/recovery de silêncio
  upstream.

## 12.10 TTFT / endpoint path / warmup

### HYP-051 — a rota DevContainer → `chatgpt.com` é a causa do gap de 5–10 s

- **status:** FORTEMENTE ENFRAQUECIDA na amostra atual.
- **evidência:** `chatgpt.com` TTFB p50≈83 ms, enquanto pre-session silence chega a vários segundos;
  `ws.chatgpt.com`≈240 ms e `api.openai.com`≈274 ms também ficaram subsegundo.
- **limite:** isso não mede o caminho de rede do cliente ChatGPT nem o tráfego interno da OpenAI.

### HYP-052 — degradação de endpoint TTFB acompanha janelas lentas

- **status:** A TESTAR LONGITUDINALMENTE.
- **instrumentação:** histórico `openai-endpoint-latency.jsonl`, baseline 24h e regressão
  `>=2x && >=150ms`.
- **assinatura:** TTFB/TLS sobe ao mesmo tempo que pulse/pre-dispatch.
- **mitigação se confirmada:** A/B rede/IP/ISP/IPv4-vs-IPv6 e investigação de edge/peering antes de
  qualquer tuning do MCP.

### HYP-053 — TTFT da UI sobe enquanto endpoint TTFB fica normal

- **status:** PLAUSÍVEL e altamente discriminante.
- **interpretação:** favorece client/app/model scheduling/context/tool planning sobre caminho básico
  DevContainer→endpoint.
- **instrumentação:** `mcp_client_latency_evidence` + endpoint observer + pulse rotulado.

### HYP-054 — primeiro call após restart/reconnect/troca de thinking sofre warmup/transição

- **status:** CONFIRMADA-SECUNDÁRIA como padrão experimental.
- **evidência:** primeiro pulse após mudança para high apresentou ~52,5 s e foi excluído do baseline
  estabilizado; transições pós-reload também produzem outliers.
- **regra:** sempre separar `warmup sample` da distribuição estacionária.

### HYP-055 — rota/IP do cliente e rota do DevContainer divergem materialmente

- **status:** PLAUSÍVEL.
- **razão:** o endpoint observer prova apenas `DevContainer→OpenAI`; o cliente ChatGPT pode usar
  outro ISP/ASN, DNS, proxy, VPN, TLS inspection e WebSocket path.
- **experimento:** combinar TTFT de cliente + networkLabel + hotspot/VPN A/B com endpoint TTFB
  simultâneo.

---

# 13. Matriz específica: “trocar IP poderia influenciar?”

A resposta precisa separar **qual IP**.

## 13.1 IP/rota do origin onde roda cloudflared

Pode influenciar:

- peering do cloudflared com Cloudflare;
- colo escolhido;
- UDP 7844;
- NAT/MTU;
- estabilidade QUIC;
- RTT do tunnel.

Mas os dados atuais mostram:

```text
self-loop ~0,2–0,3 s
QUIC RTT ~dezenas de ms
HA=4
mesmo GRU com gaps muito diferentes
```

Portanto a expectativa de ganho ao trocar IP do origin é baixa **para o problema principal atual**.

Não deve ser feito como “tentativa aleatória”.

## 13.2 IP/rota do cliente que usa ChatGPT

Pode influenciar:

- rota para OpenAI;
- WebSocket;
- proxy/VPN/security inspection;
- DNS;
- peering ISP↔OpenAI/Cloudflare;
- NAT/idle timeout;
- geolocalização/região de serviço.

A OpenAI recomenda explicitamente comparar Wi-Fi com hotspot celular para determinar se o problema é
de rede.

Este A/B é prioritário porque mede uma região hoje `not-observable-from-workspace`.

## 13.3 Protocolo experimental recomendado

Alterar **uma dimensão por vez**:

```text
A: rede atual / sem VPN
B: hotspot celular / sem VPN
C: rede atual / VPN off→on somente se A/B justificar
D: IPv4-only somente se A/B anterior sugerir route issue
```

Em cada condição:

- mesma conversa ou conversa nova conforme o experimento;
- mesmo modelo;
- série de 10–20 `mcp_latency_pulse`;
- registrar p50/p95;
- registrar `silentExternalGap`;
- registrar edge colo;
- registrar self-loop;
- registrar horário;
- registrar UI/WebSocket stall.

Sem esse controle, “mudei IP e pareceu melhor” não é evidência suficiente.

---

# 14. Estado-alvo: Interaction Latency Control Plane

## 14.1 Objetivo

Transformar cada percepção de lentidão em uma decomposição observável:

```text
perceived latency
├── local origin
│   ├── preHandler
│   ├── authorization
│   ├── handler
│   └── postHandler
├── connector/session auxiliary work
│   ├── initialize
│   ├── notifications
│   ├── tools/list
│   ├── OAuth
│   └── SSE
├── network-controlled
│   ├── DNS
│   ├── proxy
│   ├── Cloudflare HA
│   ├── QUIC/H2
│   ├── self-loop
│   └── edge colo
├── silent external interval
└── external-unobservable
    ├── host scheduling
    ├── model inference
    ├── tool planning
    ├── queue
    ├── conversation context
    └── client network/WebSocket
```

## 14.2 SLO dual

O dashboard deve manter duas verdades:

```text
originStatus
interactionStatus
```

Exemplo correto:

```text
originStatus      = ok
interactionStatus = degraded
```

quando:

- handler = 20 ms;
- silent external p50 = 8 s.

## 14.3 SLO inicial

Defaults atuais:

```text
silent p50 warn = 3000 ms
silent p95 warn = 8000 ms
min external samples = 3
```

Esses valores são thresholds operacionais iniciais, não “leis naturais”. Devem ser calibrados com
baseline controlado por modelo/horário.

---

# 15. Estratégia de mitigação em ordem de retorno esperado

## 15.1 Nível 1 — amortizar round-trips

Maior retorno potencial.

Quando:

```text
silent p50 ≈ 8 s
```

uma sequência de cinco chamadas independentes pode pagar ~40 s de imposto externo mesmo se os
handlers somados levarem <100 ms.

Portanto:

- `repo_bulk_inspect`;
- reads multi-file;
- searches em batch;
- patch batches;
- validators em batch;
- working-set composition;
- operações que retornem suficiente feedback para a próxima decisão;
- “macro tools” limitadas por trust boundary;
- stateful execution envelopes quando seguros.

A regra não é “faça tools gigantes”.

A regra é:

> **comprimir round-trips sem aumentar ambiguidade, blast radius ou perda de feedback.**

### 15.1.1 Ranking real de transições que mais pagam o imposto externo

O audit de 24 h agora agrega pares sequenciais por `totalGapMs`. A janela mais recente mostrou:

| transição                                         | ocorrências | gap acumulado |      p50 |
| ------------------------------------------------- | ----------: | ------------: | -------: |
| `repo_read_file → repo_apply_patch_batch`         |         110 |       ~2247 s | ~19,36 s |
| `repo_apply_patch → repo_apply_patch`             |         136 |       ~1694 s | ~11,86 s |
| `repo_read_file → repo_apply_patch`               |          96 |       ~1562 s | ~13,65 s |
| `repo_apply_patch_batch → repo_apply_patch_batch` |          69 |       ~1501 s | ~21,09 s |
| `repo_read_file → repo_search_text`               |          91 |       ~1210 s | ~10,53 s |
| `repo_search_text → repo_read_file`               |         149 |       ~1133 s |  ~6,64 s |
| `repo_read_file → repo_read_file`                 |         106 |        ~954 s |  ~7,03 s |
| `repo_apply_patch → run_copilot_validator`        |          77 |        ~874 s | ~10,08 s |
| `repo_apply_patch_batch → run_copilot_validator`  |          68 |        ~826 s | ~11,41 s |
| `repo_file_stats → repo_apply_patch`              |          25 |        ~523 s | ~20,12 s |

Isso prova que o ganho local de maior ROI está em **reduzir ciclos inspeção→nova inspeção e
fragmentação patch→patch**, não apenas tornar cada handler mais rápido.

### 15.1.2 Transformações de I/O já aplicadas a partir desse ranking

`repo-read.js`:

```text
batch requests           32 → 64
batch input hard max     1 MiB → 2 MiB
default result budget    1 MiB → 2 MiB
hard result budget       1.5 MiB → 3 MiB
search context max       10 → 48 linhas
```

Além disso, `repo_search_text` dirigido a **um único arquivo ≤5 MiB** passa a retornar metadata
patch-ready:

```text
searchTargetMetadata.type
searchTargetMetadata.sizeBytes
searchTargetMetadata.sha256
searchTargetMetadata.hashComputed
```

Isso permite eliminar muitos `search/file_stats → patch` round-trips sem enfraquecer `expectedHash`.

`repo-write.js`:

```text
file batch operations    32 → 64
patch batch operations   64 → 128
patch batch targets      32 → 64
patch batch input max    1.5 MiB → 3 MiB
```

Esses limites continuam bounded. A mudança **não** assume que payload maior é mais rápido; ela
aceita um pouco mais de trabalho local quando isso evita devolver o controle ao host/modelo e pagar
outro silent gap de vários segundos.

## 15.2 Nível 2 — reduzir output desnecessário

Ainda útil porque contexto pode afetar o host:

- compact por default;
- details opt-in;
- persistir diagnósticos localmente;
- refs/hints;
- bounded tails;
- evitar repetir payload já conhecido.

## 15.3 Nível 3 — session churn

- observar capacity projection;
- manter maxSessions headroom;
- não aumentar max apenas por reflexo;
- considerar TTL experimental;
- estudar se headers/session semantics podem estimular reuse sem incompatibilidade.

## 15.4 Nível 4 — client network A/B

- hotspot;
- VPN off;
- clean browser/app;
- HAR;
- WebSocket;
- DNS/security filter.

## 15.5 Nível 5 — model/context A/B

- conversa nova vs longa;
- mesmo modelo;
- modelos diferentes;
- horário rápido vs lento;
- séries `mcp_latency_pulse`.

## 15.6 Nível 6 — transport tuning

Somente se evidência mostrar regressão:

- QUIC ↔ H2;
- auto;
- MTU;
- edge;
- restart.

Não usar restart como remediação padrão para gap silencioso.

---

# 16. Network Control Plane provider-neutral — estado-alvo preservado

O NCP continua provider-neutral.

Dimensões mínimas do registry v2:

```text
provider
product
scope
leg
url/id
probeKind
transport
capability
criticality
authSemantics
expectedOutcome
mutationEligibility
sourceAuthority
sourceRef
stability
freshnessSeconds
enabledByDefault
```

Pipeline obrigatório:

```text
read
→ validate all
→ cross-row invariants
→ immutable materialize
→ filter
→ observe
→ publish evidence
→ optional policy gate
→ optional actuator
```

Nenhum consumidor pode usar registry parcialmente validado.

---

# 17. DNS substrate — estado-alvo

Princípios:

1. substrate health deve ser neutral;
2. inherited resolver deve ser preferido quando válido;
3. preservar VPN/split-DNS;
4. public DNS fallback deve ser explícito;
5. provider reachability não define saúde do DNS substrate;
6. ownership de listener deve ser comprovado por processo/socket;
7. warmup é performance hint, não autoridade de health.

Sequência de prova:

```text
process/socket ownership
→ query local dnsmasq
→ neutral canary
→ inherited/split domains
→ provider observations
```

---

# 18. Proxy — estado-alvo

Se o proxy continuar específico de Copilot:

- não exportar `HTTP_PROXY/HTTPS_PROXY` globalmente;
- provider-scoped;
- allowlist alinhada ao registry;
- blast radius mínimo.

Se houver evidência para proxy genérico:

- renomear semanticamente;
- política explícita por host/provider;
- compatibility aliases somente quando necessários.

OpenAI não deve receber `/etc/hosts` pinning ou proxy routing específico sem evidência
oficial/provider-specific.

---

# 19. Cloudflare — estado-alvo

Manter:

- named permanent tunnel;
- OAuth;
- HA=4;
- origin HTTPS;
- H2 origin quando validado;
- QUIC como controle enquanto saudável;
- H2 como rollback/baseline TCP;
- request error **delta** por janela, não contador cumulativo como veto;
- smoke pós-mudança;
- remote config audit;
- recovery epoch.

Adicionar/fortalecer:

- transport benchmark periódico sob demanda;
- safe edge-colo telemetry;
- self-loop reference;
- auxiliary request timeline;
- correlação com silent gap;
- capability-detected GraphQL analytics;
- diferenciação de benign cancellations de actionable errors.

---

# 20. Bugs atuais e dívida — B-001 a B-044

Os bugs B-001..B-025 históricos continuam válidos quando ainda não corrigidos. Os mais importantes
eram:

- registry consumido antes de validação completa;
- defaults DNS divergentes;
- optimistic truth em lifecycle;
- DNS substrate acoplado a provider reachability;
- proxy global com blast radius excessivo;
- NCP sem provider-neutral dimensions;
- stale route artifacts com authority excessiva;
- path/version drift;
- managed dnsmasq tratado como conflito;
- request-error semantics e response-code parsing;
- schema cache do host;
- ausência de recovery epoch.

Nova dívida desta investigação:

### B-026 — latência externa não era medida no boundary HTTP

- **estado:** `[~]` implementado localmente; validar/publicar.

### B-027 — auxiliary connector traffic era invisível

- **estado:** `[~]` implementado localmente.

### B-028 — silêncio externo não tinha distribuição própria

- **estado:** `[~]` implementado localmente.

### B-029 — dashboard podia dizer `ok` com 6–10 s entre calls

- **estado:** `[~]` corrigido localmente com `originStatus`/`interactionStatus`.

### B-030 — stateful session churn não era observado

- **estado:** `[~]` counters e projection adicionados localmente.

### B-031 — cliente cria aproximadamente uma sessão por tools/call

- **estado:** `[!]` comportamento externo confirmado; mitigação ainda não decidida.

### B-032 — `tools/list`/OAuth eram suspeitos sem coverage temporal

- **estado:** `[x]` hipótese quantificada; coverage ~1–2%.

### B-033 — faltava workload trivial controlado

- **estado:** `[~]` `mcp_latency_pulse` implementado e projetado.

### B-034 — Cloudflare analytics assumia field disponível

- **estado:** `[~]` capability failure é tratada como não-fatal; introspecção ainda opcional.

### B-035 — histórico não separava workload de horário

- **estado:** `[~]` pulse fornece futuro baseline controlado; histórico antigo continua confounded.

### B-036 — NCP stale GitHub artifacts podem degradar aggregate health

- **estado:** `[x]` o refresh atual publica `status=advisory`, `warnings=[]`, `critical=[]` e marca
  artifact antigo como `stale-summary-not-authoritative`; evidência histórica permanece visível sem
  governar runtime atual.

### B-037 — batching value não considerava external round-trip tax

- **estado:** `[~]` dashboard passa a expor estimativa contrafactual.

### B-038 — não há session capacity projection consolidada no diagnóstico

- **estado:** `[~]` implementação local em andamento/validada por gates focados.

### B-039 — client network experiments não têm protocolo persistido

- **estado:** `[ ]` criar runbook / evidence record.

### B-040 — falta correlation ID end-to-end fornecido pelo host

- **estado:** `[!]` impossível resolver integralmente sem suporte upstream; manter boundary
  evidence.

### B-041 — OpenAI/ChatGPT endpoint path não possuía baseline permanente por fase

- **estado:** `[~]` corrigido localmente com `openai-endpoint-latency.js` + histórico bounded + tool
  especializada.

### B-042 — TTFT, endpoint TTFB e MCP pre-dispatch eram semanticamente misturáveis

- **estado:** `[x]` taxonomia e authorities separadas; client TTFT agora possui evidence store
  próprio.

### B-043 — endpoint latency dependia de chamada manual

- **estado:** `[~]` monitor periódico non-blocking implementado: startup delay, ciclo 5 min, sem
  overlap, readiness-independent.

### B-044 — primeiro sample pós-restart/reconnect/thinking-change contaminava baseline estacionário

- **estado:** `[x]` warmup/outlier passa a ser explicitamente separado nos protocolos; exemplo high
  inicial ≈52,5 s não foi usado na comparação estabilizada.

### B-045 — WSL caiu abruptamente durante janela com validators concorrentes

- **evento:** por volta de `2026-08-18T22:08Z` (`19:08` BRT), o WSL desapareceu e derrubou
  Docker/DevContainer/MCP/cloudflared em conjunto;
- **evidência preservada:** jobs `2130fc2d-08ed-486a-96d9-fd4fab69b22b` (`test_mcp_tools.spec.js`) e
  `3fcf74b6-e7b3-4878-9ccb-29c46ada6d93` (`test_mcp_metrics.spec.js`) ficaram com `status=running`,
  `runtimeAttached=false`, `endedAt=null`, `exitCode=null`, `signal=null` após o reboot;
- **log:** ambos foram interrompidos antes de término normal; `test_mcp_tools` sequer chegou a
  imprimir o início normal da suite, portanto não há evidência de que o novo teste `postValidate`
  tenha alcançado o ponto de spawn interno;
- **causalidade:** **INDETERMINADA**. Concorrência/fan-out de validators é amplificador plausível,
  mas não há prova de OOM nem de que o composite causou diretamente a queda;
- **limitação:** logs de kernel/Windows anteriores ao reboot não estão disponíveis via workspace
  atual, portanto a causa raiz de WSL não pode ser reconstruída com autoridade suficiente.

### B-046 — harness permitia fan-out de validators pesados e nesting dentro de Vitest

- **estado:** `[~]` hardening local implementado e focadamente validado;
- `batchConcurrency` efetivo reduzido a 1;
- capacidade global do runtime: máximo 1 subprocess validator anexado;
- reserva atômica de spawn evita corrida entre requests simultâneos;
- subprocess validator é bloqueado quando `VITEST`/`NODE_ENV=test` está ativo;
- `repo_apply_patch_batch.postValidate` falha antes do write em test runner;
- Vitest iniciado pelo job manager recebe `VITEST_MAX_WORKERS=2` por padrão, com override explícito
  bounded;
- dashboard passa a expor `validatorCapacity`.

---

# 21. Gaps arquiteturais — G-001 a G-031

Gaps históricos relevantes:

- registry sem dimensões provider/product/scope/leg;
- summary envelope sem v2 universal;
- authority não first-class em todas superfícies;
- observer/gate/actuator insuficientemente formalizados;
- sem substrate→provider→product→transport hierarchy;
- sem WebSocket semantics;
- sem VPN/split-DNS first-class;
- sem fault-injection matrix;
- sem recovery epoch universal.

Novos gaps:

### G-015 — sem timestamp/model queue fornecido pela OpenAI

`not-observable-from-workspace`.

### G-016 — sem token/context size real da conversa

`not-observable-from-workspace`.

### G-017 — sem model/tool-planner latency metadata

`not-observable-from-workspace`.

### G-018 — sem host-provided session reuse policy

Apenas inferível pelo tráfego observado.

### G-019 — sem baseline pulse recorrente por modelo/horário

Criar série persistida.

### G-020 — client network evidence ingestion era inexistente

Parcialmente fechado: `mcp_client_latency_evidence` aceita TTFT e labels sanitizados de
rede/modelo/conversa/client/VPN. Captura automática do timestamp no cliente continua dependente de
observer/HAR externo.

### G-021 — sem A/B model/context runner no ChatGPT host

Fora do MCP; documentar experimentos reproduzíveis.

### G-022 — Cloudflare plan não expõe timing analytics desejados

Capability gap.

### G-023 — sem IP/ASN experiment record

Criar evidence schema.

### G-024 — sem round-trip tax budget no design de novas tools

Adicionar critério arquitetural.

### G-025 — sem stateful-session churn budget

Adicionar max projected capacity ratio / alarm.

### G-026 — sem distinção formal entre user-perceived SLO e origin SLO em todos dashboards

Propagar a nova semântica.

### G-027 — MCP não observa automaticamente o ChatGPT UI TTFT

O gap só fecha com client observer/HAR/manual evidence; é proibido inferir UI TTFT a partir de
endpoint TTFB ou pre-dispatch.

### G-028 — correlação endpoint-TTFB ↔ pre-dispatch ainda não possui série histórica suficiente

O monitor resolve coleta futura; o correlation score só deve ganhar autoridade após número mínimo de
pares temporalmente próximos.

### G-029 — API streaming TTFT canary ainda não implementado

Deve ser explicitamente opt-in, fixed model/prompt, allowlisted e cost-aware; nunca parte automática
de health/readiness.

### G-030 — causa raiz de crash WSL não possui evidence channel first-class

Hoje o workspace consegue observar consequência (`runtimeAttached=false`, tunnel/origin
desaparecem), mas não possui ingestão de eventos Windows/WSL como `LxssManager`, `Hyper-V`, WSL
kernel OOM, Docker Desktop VM reset ou host memory pressure. Criar um canal sanitizado de evidence
do host é desejável; sem ele, crash comum-causa continua parcialmente não observável.

### G-031 — validator resource budget não era first-class

Majoritariamente fechado no runtime MCP: max active, spawn reservation, Vitest worker cap,
`runtimeEpoch` e snapshots before/after de memória/load/cgroup agora existem e são persistidos no
manifest. Continua pendente correlacionar essa evidência com eventos externos Windows/WSL/Docker
para distinguir definitivamente OOM/VM reset/crash externo.

---

# 22. Architecture Decision Records — ADR-ILCP

### ADR-ILCP-001 — Silent external gap é métrica primária

`response-finish → next-request-arrival`, descontada a união temporal de requests auxiliares.

### ADR-ILCP-002 — NCP é subsistema, não causa presumida

Rede deve ser medida antes de ser modificada.

### ADR-ILCP-003 — Origin e interaction SLO são separados

Nunca retornar “ok” agregado ocultando multi-second silent gaps.

### ADR-ILCP-004 — Pulse trivial é benchmark de controle

Toda análise temporal/model/network deve incluir workload constante quando possível.

### ADR-ILCP-005 — Tool count/payload não são culpados sem A/B host-side

Limites de 250/maior payload são headroom; reduzir por superstição é proibido.

### ADR-ILCP-006 — Round-trip amortization é prioridade arquitetural

Batching seguro tem retorno proporcional ao imposto externo observado.

### ADR-ILCP-007 — Auxiliary activity é medida por cobertura temporal

Não apenas contagem.

### ADR-ILCP-008 — Session churn é tratado separadamente de silent gap

Overhead/capacity ≠ causa dominante automaticamente.

### ADR-ILCP-009 — TTL/maxSessions só mudam por projection + canary

Nunca tuning reativo.

### ADR-ILCP-010 — Cloudflare transport só muda por benchmark controlado

QUIC/H2/auto devem ser A/B com restore automático.

### ADR-ILCP-011 — Client network A/B é first-class evidence

Hotspot, VPN, browser/app e HAR devem ter protocolo reproduzível.

### ADR-ILCP-012 — Statuspage é evidência agregada, não session health

Fresh structured degradation vence banner genérico; stale não governa.

### ADR-ILCP-013 — Safe colo logging

Persistir apenas colo, nunca CF-Ray completo/IP em telemetria padrão.

### ADR-ILCP-014 — GraphQL analytics é capability-detected

Unavailable fields não degradam MCP health.

### ADR-ILCP-015 — Restart não é remediação de silent gap

Só reiniciar quando evidence aponta origin/tunnel lifecycle.

### ADR-ILCP-016 — TTFT, endpoint TTFB e pre-dispatch são clocks independentes

Nenhum pode ser usado como proxy automático do outro. A causalidade vem da convergência/divergência
longitudinal entre eles.

### ADR-ILCP-017 — Endpoint monitor é permanente, barato e não bloqueante

Um sample por target a cada 5 min, após delay de startup, sem overlap e sem tornar readiness
dependente da internet externa.

### ADR-ILCP-018 — Client TTFT evidence é sanitizada

Persistir apenas tempos e labels fechados; nunca prompt, completion, HAR body, cookies, tokens, URLs
de navegação ou IP bruto.

### ADR-ILCP-019 — Paid model TTFT canary exige opt-in explícito

Nenhum health check pode consumir quota de modelo silenciosamente.

### ADR-ILCP-020 — validators são serializados por segurança de host

O runtime MCP permite no máximo um subprocess validator ativo. Solicitações concorrentes recebem
feedback de capacidade em vez de competir silenciosamente por CPU/memória.

### ADR-ILCP-021 — test runner nunca inicia outro validator subprocess

`VITEST`/`NODE_ENV=test` é uma fronteira explícita: configuração/path ainda podem ser testados, mas
criação de `npx vitest`, `tsc`, `eslint` ou suites filhas é bloqueada. Integração real deve ser
provada a partir do MCP runtime normal, não de dentro da suite que o está testando.

---

# 23. Roadmap consolidado — FAIXAS A–U

Legenda:

- `[x]` concluído/publicado;
- `[~]` implementado localmente ou parcialmente validado;
- `[ ]` pendente;
- `[!]` bloqueado por superfície externa/capability.

## FAIXA A — normalização e publicação

### A0 — baseline

- [x] ler completamente network/lifecycle core;
- [x] registrar topologia DevContainer/MCP/Cloudflare;
- [x] registrar autoridade/freshness;
- [x] reconstruir documento canônico para ILCP.

### A1 — worktree

- [ ] reexecutar `repo_status`/diff após esta revisão;
- [ ] classificar todos untracked;
- [ ] verificar executable bits `.sh`;
- [ ] final secret scan;
- [ ] excluir `.ai`/state/generated da publicação;
- [ ] validar `.vscode` user-specific settings;
- [ ] staging explícito por paths;
- [ ] commit/push somente após gates.

## FAIXA B — registry trust boundary

- [x] validator central do registry implementado em frente anterior;
- [x] fail-closed para consumidores críticos principais;
- [ ] completar dimensões v2 provider/product/scope/leg;
- [ ] garantir immutable materialization universal;
- [ ] medir compat legacy usage.

## FAIXA C — summary contract / lifecycle truth

- [~] summary contracts existentes;
- [ ] promover envelope v2 universal;
- [ ] compat v1 explícita;
- [ ] recovery epoch;
- [ ] remover optimistic truth remanescente.

## FAIXA D — DNS substrate neutral

- [x] managed dnsmasq ownership semantics corrigidas;
- [~] neutral health implementado parcialmente;
- [ ] inherited/split-DNS canary completo;
- [ ] eliminar provider reachability como autoridade de substrate;
- [ ] revisar Docker explicit DNS somente após A/B VPN/split.

## FAIXA E — NCP provider-neutral

- [~] NCP aggregate existe;
- [ ] registry v2;
- [ ] provider matrices;
- [ ] provider optionality;
- [ ] stale artifacts deixam de degradar runtime atual.

## FAIXA F — OpenAI/ChatGPT network posture

- [x] endpoints fixos de reachability;
- [x] authority `observed-from-container`;
- [x] client leg explicitamente `not-observable-from-workspace`;
- [x] WebSocket facts oficiais registrados;
- [x] observer por fases DNS/TCP/TLS/TTFB/total para `chatgpt.com`, `ws.chatgpt.com`,
      `api.openai.com`;
- [x] baseline histórico bounded de endpoint implementado;
- [x] attribution consome medição atual + baseline quando disponível;
- [x] contrato de client TTFT evidence implementado;
- [ ] acumular baseline endpoint durante várias horas/dias;
- [ ] HAR/client observer produzir primeiras amostras de TTFT real.

## FAIXA G — Cloudflare correlation

- [x] response-code parser corrigido;
- [x] requestErrors cumulativo reclassificado como advisory;
- [x] safe edge colo;
- [x] public self-loop reference;
- [~] GraphQL capability audit;
- [ ] recovery epoch;
- [ ] stale smoke invalidation após topology epoch.

## FAIXA H — proxy

- [ ] mapear todos consumers `HTTP_PROXY/HTTPS_PROXY`;
- [ ] decidir provider-scoped vs generic;
- [ ] rollout sem blast global.

## FAIXA I — MCP autonomy/tool projection

- [x] default max tools 250;
- [x] payload/list diagnostic budget ampliado proporcionalmente;
- [x] `mcp_latency_attribution`;
- [x] `mcp_latency_pulse`;
- [~] schema host cache/reconnect semantics;
- [ ] usar descriptor version/epoch para diagnosticar projection stale automaticamente quando
      possível.

## FAIXA J — fault injection

- [ ] DNS fail/recover;
- [ ] tunnel restart/recovery epoch;
- [ ] QUIC blocked → H2 fallback;
- [ ] OAuth refresh failure;
- [ ] stateful capacity pressure;
- [ ] WSL crash common-cause recovery;
- [ ] stale artifact injection.

## FAIXA K — publicação/sincronização

- [ ] full diff review;
- [ ] focused validators;
- [ ] optional mcp-fast suite quando release gate justificar;
- [ ] explicit stage plan;
- [ ] commit plan;
- [ ] commit;
- [ ] push;
- [ ] `HEAD==origin/main`;
- [ ] clean worktree.

## FAIXA L — HTTP origin boundary attribution

- [~] request arrival timestamp;
- [~] response finish timestamp;
- [~] preHandler;
- [~] postHandler;
- [~] handler;
- [~] external gap;
- [~] edge colo;
- [ ] persist compact boundary summary por epoch quando necessário.

## FAIXA M — silent gap / auxiliary activity

- [x] sanitized route-class tracking;
- [x] sanitized JSON-RPC method tracking;
- [x] `mcp-stream` separado de trabalho discreto;
- [x] interval-union coverage sem dupla contagem;
- [x] silent gap distribution;
- [x] auxiliary coverage ratio;
- [x] primeiro trabalho discreto / tail-silence decomposition;
- [x] primeira assinatura live: `firstDelay/externalGap≈94–97%`, primeiro RPC=`initialize`;
- [x] dashboard interaction SLO separado de origin SLO;
- [ ] historical silent-gap reconstruction após dados suficientes;
- [ ] correlation por route/RPC método em janela temporal persistida.

## FAIXA N — controlled pulse baseline

- [x] pulse tool registrada;
- [x] primeiras séries controladas;
- [x] histórico reconhece pulse→pulse;
- [x] audit suporta labels sanitizados `seriesId/network/model/conversation/client/vpn` sem IP
      bruto;
- [x] histórico agrupa `controlledPulseSeries24h` somente dentro da mesma série/condição;
- [ ] baseline por hora durante vários dias;
- [ ] baseline por modelo;
- [ ] baseline por conversa nova/longa;
- [ ] baseline por rede cliente;
- [ ] anomaly score sobre pulse histórico.

## FAIXA O — stateful session churn/capacity

- [x] churn 1 initialize/tool confirmado;
- [x] active session accumulation confirmado;
- [x] runtime counters em health/dashboard/attribution;
- [x] capacity projection implementada;
- [x] janela curta atual projeta `~0,37–0,40` de capacidade e `headroom-ok`;
- [ ] validar projection em janela >TTL;
- [ ] medir expired/terminated após 10–20 min;
- [ ] canary TTL menor somente se projection justificar;
- [ ] investigar se host suporta reuse sob outra session negotiation;
- [ ] definir headroom SLO.

## FAIXA P — round-trip amortization

- [x] `repo_bulk_inspect` e diversas batch surfaces já existem;
- [x] dashboard estima silent-tax contrafactual por round-trip comprimido;
- [x] top sequential tool transitions extraídas por `totalGapMs`;
- [x] top 10 fluxos de maior ROI identificados;
- [x] `repo_search_text` context max ampliado 10→48 para reduzir `search→read`;
- [x] search em arquivo pequeno retorna SHA-256 patch-ready para reduzir `stats→patch`;
- [x] read/search/bulk batches ampliados 32→64 e budget até 3 MiB;
- [x] patch batches ampliados até 128 operações/64 targets/3 MiB;
- [~] `repo_apply_patch_batch + postValidate` implementado localmente como composite bounded; guards
  anti-nesting/capacity adicionados após incidente WSL; projeção do host desta conversa ainda
  anuncia schema antigo e impede prova externa do novo argumento até refresh/reconnect;
- [x] partial failure feedback preservado nas surfaces batch existentes;
- [x] result budgets permanecem bounded;
- [ ] benchmark antes/depois usando número de tool calls e wall-clock percebido em workflow real.

## FAIXA Q — client/model/context experiments

- [x] infraestrutura de labels experimentais sanitizados persistida no audit do pulse;
- [x] parser/histórico compara séries sem guardar IP bruto;
- [x] primeiro A/B `thinking=medium` vs `thinking=high` executado;
- [x] medium estabilizado: n=7, média≈5,47 s, p50≈5,59 s, p95≈7,33 s;
- [x] high estabilizado: n=7, média≈5,93 s, p50≈6,43 s, p95≈7,17 s;
- [~] sinal high≈15% pior na mediana, ainda insuficiente para causalidade forte;
- [ ] repetir thinking ABAB com n maior e mesma janela;
- [ ] conversa nova vs longa;
- [ ] modelo A vs B;
- [ ] janela rápida vs lenta;
- [ ] browser/app A/B;
- [ ] clean profile/incognito quando aplicável;
- [ ] VPN off/on somente como A/B;
- [ ] HAR timestamp capture;
- [x] persist experiment metadata sem dados sensíveis.

## FAIXA R — IP/network/ASN experiments

- [ ] Wi-Fi atual vs hotspot celular;
- [ ] ISP/ASN distinto quando possível;
- [ ] client public IP hash/label opcional, nunca IP bruto no audit padrão;
- [ ] IPv4 vs dual-stack somente se evidência justificar;
- [ ] route/MTU canary;
- [x] QUIC vs H2/AUTO transport benchmark executado;
- [x] resultado consolidado: diferenças p95 ~1% ou menos, insuficientes para explicar o gap;
- [ ] origin WAN IP A/B apenas baixa prioridade.

## FAIXA S — longitudinal evidence / upstream integration

- [ ] dashboard histórico inclui interaction SLO;
- [ ] pulse anomaly detector;
- [x] time-of-day gap buckets disponíveis no audit reconstruction;
- [ ] recovery/topology epoch;
- [x] client TTFT evidence store/tool implementado;
- [x] attribution projeta client TTFT evidence separadamente;
- [!] OpenAI scheduler/model queue timestamps — dependência upstream;
- [!] real conversation token/context metric — dependência upstream;
- [!] host tool-planner timing — dependência upstream.

## FAIXA T — fixed OpenAI endpoint latency baseline

- [x] targets fechados `chatgpt.com`, `ws.chatgpt.com`, `api.openai.com`;
- [x] conexão fresca e decomposição DNS/TCP/TLS/TTFB/server-wait/total;
- [x] edge colo sanitizado;
- [x] nenhum body/IP/token persistido;
- [x] history JSONL bounded;
- [x] baseline 24h e regression rule implementados;
- [x] primeiro baseline live: TTFB p50 83/240/274 ms respectivamente;
- [x] persistência automática provada: monitor executou sozinho (`runs=1`, `failures=0`) e
      attribution leu `snapshotsRead=1` sem chamada manual à tool de endpoint;
- [ ] baseline ≥24h com dezenas de snapshots;
- [ ] correlação temporal endpoint-TTFB ↔ pulse/pre-dispatch;
- [ ] A/B por `networkLabel` do cliente sem confundir rotas.

## FAIXA U — TTFT real e evidence fusion

- [x] taxonomia UI TTFT vs endpoint TTFB vs MCP pre-dispatch definida;
- [x] `mcp_client_latency_evidence` implementada com source/labels fechados;
- [x] high-vs-medium summary exige ≥5 amostras por grupo para flag de suficiência;
- [ ] obter primeira amostra UI TTFT de fonte client-observer/HAR;
- [ ] repetir ≥10 amostras high e ≥10 medium no mesmo cliente/rede;
- [ ] conversa fresh vs long com TTFT + pulse simultâneos;
- [ ] hotspot vs Wi-Fi com TTFT + pulse + endpoint TTFB;
- [ ] desenhar canary API streaming TTFT opt-in, fixed prompt/model e custo explícito;
- [ ] nunca executar canary pago dentro de health/readiness automático.

## FAIXA V — WSL / validator resource resilience

- [x] incidente de queda WSL registrado com causalidade explicitamente indeterminada;
- [x] jobs órfãos identificados como consequência de process-namespace loss;
- [x] `batchConcurrency` de validators serializado em 1;
- [x] capacidade global de subprocess validator limitada a 1;
- [x] reserva de spawn impede corrida entre chamadas simultâneas;
- [x] validator subprocess proibido dentro de Vitest/test runner;
- [x] `postValidate` possui recursion guard pré-write;
- [x] Vitest de validator limitado a 2 workers por default;
- [x] `validatorCapacity` provado live: `runtimeEpoch=c9d1c7f9-1814-4912-9a7c-ab0675da2e10`, owner
      PID `26558`, `maxActive=1`, `vitestMaxWorkers=2`, `activeCount=0`;
- [x] snapshot de memória/load/cgroup persistido imediatamente antes e depois de cada validator;
- [x] runtime epoch first-class: jobs novos carregam `ownerRuntimeEpoch` e `runtimeSameEpoch`;
      manifests antigos permanecem legíveis e não são reclassificados artificialmente;
- [x] canary focado pós-reload provou telemetria: job `a08006c2-3ffe-46a4-8531-ff5f3350ac72`, child
      PID `26917`, `oom=0`, `oom_kill=0`, RSS MCP estável ≈456 MB e delta cgroup ≈+0,5 MB durante
      ~2,1 s;
- [x] ausência de `resourceAfter` passa a ser evidência explícita de interrupção abrupta quando
      `resourceBefore` existe;
- [ ] estudar ingestão sanitizada de eventos Windows/WSL/Docker para OOM/crash/reset;
- [ ] executar stress canary controlado somente após evidence channel do host; nunca reproduzir
      queda por força bruta.

---

# 24. Protocolos experimentais obrigatórios

## EXP-01 — pulse temporal

```text
10–20 pulses
mesmo modelo
mesma conversa
mesma rede
registrar horário
```

Comparar p50/p95 `silentExternalGap`.

## EXP-02 — conversa nova vs longa

Alterar somente conversa.

Objetivo: testar context pressure real do host.

## EXP-03 — client network

```text
A = rede atual
B = hotspot celular
```

Mesmo modelo/conversa; repetir pulse.

## EXP-04 — VPN

Somente após baseline sem VPN.

Nunca combinar troca de VPN + rede + modelo no mesmo experimento.

## EXP-05 — Cloudflare transport

```text
QUIC control
HTTP/2
AUTO
```

Cinco smokes idênticos por perfil, HA=4, request-error delta, restore automático.

## EXP-06 — session TTL

Executar somente se capacity projection justificar.

Não confundir melhoria de capacity com melhoria de silent gap.

## EXP-07 — batching

Mesmo objetivo lógico:

```text
A = N chamadas simples
B = 1 bounded batch
```

Medir:

- total calls;
- handler total;
- silent gap total;
- wall-clock;
- payload total;
- failure semantics.

## EXP-08 — endpoint TTFB permanente

Durante uma janela lenta e uma janela rápida, comparar os snapshots automáticos de:

```text
chatgpt.com
ws.chatgpt.com
api.openai.com
```

Usar DNS/TCP/TLS/TTFB/server-wait/total. Só promover `endpoint-path-regression` se houver baseline
suficiente e regressão material.

## EXP-09 — thinking mode ABAB

```text
A1 = medium, 10–20 pulses após warmup
B1 = high,   10–20 pulses após warmup
A2 = medium, repetir
B2 = high,   repetir
```

Fixar conversa, modelo, rede, client e VPN. Descartar o primeiro pulse após cada troca como
transição/warmup. Comparar p50/p95 e bootstrap/intervalo quando n permitir.

## EXP-10 — TTFT de cliente

Para cada condição:

```text
T0 = submit do usuário
T1 = primeiro token renderizado/streamed
TTFT = T1 - T0
```

Registrar somente `ttftMs`, source e labels sanitizados em `mcp_client_latency_evidence`. Coletar
endpoint TTFB e pulse/pre-dispatch na mesma janela para evidence fusion.

## EXP-11 — Wi-Fi ↔ hotspot com clocks separados

Em A/B de rede do cliente, coletar simultaneamente:

- UI TTFT;
- pulse/pre-dispatch;
- endpoint TTFB do DevContainer;
- self-loop MCP;
- edge colo;
- WebSocket/HAR quando disponível.

Isso permite distinguir mudança na rota do cliente de mudança no backend/model plane.

## EXP-12 — validator resource canary

Resource telemetry básica já existe e foi provada. Qualquer canary adicional deve permanecer
conservador até existir evidence channel do host. Sequência segura:

```text
1 validator focused
→ observar memória/load/cgroup
→ aguardar conclusão
→ verificar MCP/tunnel/WSL health
```

Não executar dois validators pesados em paralelo. Não executar validator dentro de Vitest. O
objetivo é provar headroom, não procurar o limite de crash.

---

# 25. Segurança e privacidade da telemetria

Não persistir por default:

- bearer token;
- OAuth token;
- cookie;
- raw Authorization;
- IP do usuário;
- CF-Ray completo;
- URL com query sensível;
- request body arbitrário;
- conversation content.

Persistir apenas labels sanitizados quando necessário:

- route class;
- JSON-RPC method;
- edge colo;
- status;
- duration;
- opaque internal call id já existente;
- hashes quando explicitamente necessários.

A telemetria deve ser suficiente para causalidade sem virar uma nova superfície de dados sensíveis.

---

# 26. Node 24+ — papel no estado-alvo

Manter Bash para:

- early boot;
- lifecycle;
- resolver/process/socket;
- mutações de sistema.

Usar Node 24+ para:

- AsyncLocalStorage request context;
- schema/registry validation;
- HTTP/H2 diagnostics;
- bounded analytics;
- percentile/histogram;
- JSONC/contracts;
- audit reconstruction;
- concurrency-safe interval union;
- session projections;
- tests.

A compile cache Node 24 já está ativa e não aparece como gargalo relevante nesta frente.

---

# 27. Definition of Done do ILCP

Esta frente só pode ser considerada madura quando:

- [ ] uma percepção de lentidão é automaticamente decomposta em origin vs auxiliary vs silent
      external;
- [ ] dashboard não produz falso `ok` quando interaction SLO está ruim;
- [ ] pulse baseline possui histórico por horário/modelo;
- [ ] endpoint OpenAI/ChatGPT monitor possui baseline ≥24h e dezenas de snapshots;
- [ ] client UI TTFT possui amostra reproduzível e authority explícita;
- [ ] TTFT/TTFB/pre-dispatch nunca são agregados como se fossem a mesma métrica;
- [ ] client-network A/B foi executado pelo menos uma vez;
- [ ] QUIC/H2 benchmark possui resultado consolidado;
- [ ] session churn possui capacity headroom comprovado;
- [ ] NCP stale artifacts não degradam runtime atual;
- [ ] top round-trip workflows foram amortizados com batch seguro;
- [ ] recovery epoch diferencia falha passada de estado atual;
- [ ] nenhuma remediação mutante é acionada por artifact stale;
- [ ] documentos e tool descriptions refletem authority corretamente;
- [ ] full focused validation fica verde;
- [x] validator harness não cria nested subprocesses em test runner e mantém `maxActive=1`;
- [~] resource telemetry distingue pressão no runtime/cgroup e preserva `oom/oom_kill` before/after;
  distinguir crash externo/WSL reset com alta autoridade ainda requer evidence channel do host;
- [ ] worktree publicável sem secrets/generated state;
- [ ] `main == origin/main` após publicação.

---

# 28. Conclusão arquitetural

A descoberta central desta revisão é simples, mas altera profundamente a prioridade do projeto:

> **A maior parte do tempo perdido entre tools não está atualmente dentro das tools, dentro do
> origin MCP, nem dentro de uma viagem ordinária pelo Cloudflare Tunnel.**

A série controlada, o boundary HTTP e a nova coverage timeline mostram que o origin pode permanecer
silencioso por **vários segundos** entre uma resposta terminada e a próxima `tools/call` chegar.
Requests auxiliares de initialize/session existem e constituem uma ineficiência real, mas explicam
apenas uma pequena fração do tempo.

Por isso, o projeto deve abandonar duas tentações:

1. culpar automaticamente o número de tools/payload;
2. tentar curar toda lentidão com restart/tuning de network local.

O caminho correto é:

```text
medir
→ separar autoridade
→ falsificar hipóteses
→ executar A/B controlado
→ reduzir round-trips sob nosso controle
→ manter network transport saudável
→ preservar evidência do que permanece externo
```

A vantagem estratégica do workspace é que, mesmo sem acesso à telemetria interna da OpenAI, podemos
tornar a região de incerteza cada vez menor.

A partir desta revisão, toda transformação de desempenho deve responder explicitamente a uma
pergunta:

> **ela reduz tempo dentro do origin, reduz número de round-trips, melhora uma rota comprovadamente
> degradada, ou apenas move complexidade sem atacar o silent external gap?**

Se não houver resposta mensurável, a transformação não deve ser promovida como otimização de
latência.

---

# 29. Log de revisão — 2026-08-18

Nesta revisão foram incorporados ao estado arquitetural:

- default de tools elevado para 250 como headroom;
- budget de payload/list ampliado proporcionalmente;
- `mcp_latency_attribution`;
- HTTP origin-boundary timing;
- `mcp_latency_pulse`;
- reconstrução histórica de gaps;
- hourly variation;
- active-work-cluster heuristic;
- safe edge colo;
- public MCP self-loop;
- Cloudflare GraphQL capability probe;
- auxiliary request timeline;
- interval-union coverage;
- silent external gap;
- origin vs interaction SLO;
- per-call stateful session churn;
- active-session counters;
- capacity projection;
- round-trip amortization framing;
- protocolo de experimentos client/IP/network/model/context.

O documento deve ser atualizado sempre que uma das hipóteses HYP-001..HYP-050 mudar de estado por
nova evidência.
