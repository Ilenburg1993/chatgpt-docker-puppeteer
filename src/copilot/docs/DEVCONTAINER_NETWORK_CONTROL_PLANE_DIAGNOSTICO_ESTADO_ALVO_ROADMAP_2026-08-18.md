# DevContainer Network Control Plane — diagnóstico profundo, estado-alvo e roadmap de transformação

**Data de referência:** 2026-08-18  
**Status:** canônico para a frente de rede / DevContainer / NCP / conectividade ChatGPT–OpenAI–MCP  
**Branch observada:** `main`  
**HEAD observado no início desta consolidação:** `64d80411d` — `perf(mcp): unlock atomic target batch progress`  
**Upstream observado:** `origin/main` alinhado com `HEAD` antes de qualquer nova publicação desta frente  
**Escopo primário:** `.devcontainer/`, `src/copilot/mcp/`, contratos/operadores associados e integrações adjacentes estritamente necessárias para conectividade e observabilidade  
**Relação com o roadmap mestre:** este documento aprofunda e especializa a frente de rede iniciada em `src/copilot/docs/WORKSPACE_MCP_IO_LATENCIA_LIBERDADE_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-17.md`; para decisões especificamente relacionadas ao Network Control Plane, conectividade ChatGPT/OpenAI, Cloudflare/MCP, DNS, proxy, provider reachability e lifecycle DevContainer, este documento passa a ser a referência arquitetônica mais detalhada.  
**Princípio de migração:** evolução interna, aditiva, compatível, observável e reversível. **Não criar uma segunda pilha OpenAI/ChatGPT em paralelo à infraestrutura existente.**

---

# 0. Sumário executivo

A infraestrutura atual de rede do projeto é sofisticada, porém historicamente assimétrica. Ela nasceu em grande parte para investigar e melhorar conectividade com GitHub e GitHub Copilot; ao longo do tempo acumulou DNS local com fail-safe e rollback, benchmarking, split-DNS, route-fix com histerese, proxy local, endpoint registry, advisor passivo, artifacts de estado, hooks de lifecycle, agregador de Network Control Plane, métricas Cloudflare, auditoria remota e tools MCP de observabilidade.

O problema principal não é ausência de mecanismos. O problema é que mecanismos potencialmente gerais ainda carregam semântica específica de GitHub/Copilot e, por isso, não representam de forma suficientemente rigorosa o circuito que hoje mais importa operacionalmente:

```text
usuário / cliente ChatGPT
    ↕
infraestrutura OpenAI / chatgpt.com
    ↕
endpoint MCP público https://mcp.aurelin.org/mcp
    ↕
Cloudflare edge / tunnel
    ↕
cloudflared no DevContainer
    ↕
origin local HTTPS + HTTP/2 127.0.0.1:3333
    ↕
MCP server / workspace / tools
```

Além desse circuito, o DevContainer possui egress para GitHub, Copilot, OpenAI API e outros providers. Esses caminhos compartilham substrato — DNS, TCP, TLS, proxy, container, host, WSL, Docker — mas **não são o mesmo leg e não podem servir como prova uns dos outros**.

O estado atual apresenta cinco problemas arquitetônicos dominantes:

1. **acoplamento provider-specific:** partes do que hoje se chama “Network Control Plane” ainda significam, semanticamente, “Network/Copilot Control Plane”;
2. **autoridade mal tipada:** artifacts stale, counters cumulativos e dados de ação/benchmark podem ser confundidos com estado runtime atual;
3. **substrato e provider misturados:** uma indisponibilidade GitHub/Copilot pode contaminar a interpretação da saúde do resolver ou do plano geral;
4. **duplicação de contratos e parsing:** scripts Bash grandes reimplementam helpers, defaults, registry parsing, sanitização, freshness, locks e status synthesis;
5. **observabilidade incompleta do caminho ChatGPT:** HTTPS reachability é insuficiente para representar WebSocket/long-lived connections, e um probe local jamais prova sozinho o leg OpenAI→MCP.

A arquitetura-alvo é um **único Network Control Plane provider-neutral**, construído por evolução do sistema atual, com:

- **substrato neutro:** DNS, egress, proxy/tunnel primitives, lifecycle, ownership, locks e artifacts;
- **registry declarativo versionado** de endpoints/probes com provider, product, scope, leg, transport, authority e mutation eligibility;
- separação explícita entre **observer**, **policy gate** e **actuator**;
- components provider-specific preservados como capabilities inferiores ao NCP, por exemplo `github-api-route-fix.sh`;
- **envelope normalizado de estado v2** com compatibilidade temporária para summaries v1;
- `openai-chatgpt` como foco operacional de primeira classe, sem converter OpenAI em dependência central do substrato;
- Cloudflare/MCP tratado como **transport/circuit**, e não como provider de aplicação;
- superfície MCP compacta, aproveitando as tools existentes em vez de proliferar uma tool por provider;
- temporalidade e recuperação de conexão como parte do modelo de estado;
- políticas de DNS e proxy compatíveis com VPN, split-horizon DNS e ambientes corporativos;
- fault injection cruzado entre substrate/provider/transport;
- publicação Git somente depois de validar modes, paths, untracked e ausência de segredos/artifacts acidentais.

A transformação deve seguir a sequência:

```text
investigação / contratos
  → correção de trust boundaries
    → neutralização do substrato
      → envelope NCP v2
        → migração GitHub/Copilot
          → OpenAI/ChatGPT first-class
            → correlação MCP/Cloudflare
              → fault injection / rollout
                → deprecação compatível
```

---

# 1. Método, proveniência e regra de verdade

## 1.1. Estados que nunca devem ser confundidos

Toda intervenção nesta frente deve distinguir explicitamente:

1. **estado versionado (`HEAD`)**;
2. **mudanças locais já existentes na worktree antes da intervenção atual**;
3. **novas mudanças produzidas por esta frente**;
4. **estado runtime live**, que pode estar executando código diferente do `HEAD` ou do worktree;
5. **estado remoto**, como Cloudflare edge/tunnel e ChatGPT connector;
6. **estado documental externo**, como recomendações atuais da OpenAI.

Nenhuma dessas camadas é autoridade universal para as outras.

## 1.2. Regra de autoridade

Qualquer conclusão operacional deve poder responder:

- **quem observou?**
- **qual leg observou?**
- **quando observou?**
- **qual versão/schema produziu o dado?**
- **o dado é medição, configuração, inferência ou documentação?**
- **o dado ainda está dentro do seu freshness budget?**
- **ele pode autorizar mutação ou é apenas advisory?**

A ausência dessas respostas é tratada como gap de contrato, não como detalhe de UX.

## 1.3. Princípio de não reescrita cega

A base contém mais de 1 MiB de shell ligado a lifecycle/rede. Uma reescrita monolítica teria alto risco de regressão e baixa auditabilidade. A estratégia correta é:

- extrair primitives realmente compartilhadas;
- corrigir invariantes em owners canônicos;
- migrar producers/consumers gradualmente;
- manter compatibilidade explícita;
- medir antes/depois;
- remover legado apenas quando nenhum consumer conhecido depender dele.

---

# 2. Investigação concluída — arquivos e superfícies auditadas

## 2.1. Scripts Bash lidos integralmente

A arquitetura foi formulada após leitura integral dos scripts diretamente associados ao lifecycle e à rede, sobretudo os `.sh`:

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
- `scripts/ops/copilot-network-diagnose.sh`;
- `src/copilot/mcp/cloudflare/install-cloudflared.sh`;
- `scripts/check-devcontainer-sync.sh`.

## 2.2. Configuração, contratos e operator surfaces auditados

Também foram cruzados:

- `.devcontainer/devcontainer.json`;
- `.devcontainer/Dockerfile`;
- `.devcontainer/scripts/network/contracts/summary-contracts.jsonc`;
- `.devcontainer/scripts/network/endpoints.github-copilot.tsv`;
- `package.json`;
- `Makefile`;
- `.vscode/settings.json` no estado local atual;
- documentação operacional e roadmaps pertinentes.

## 2.3. Consumidores e owners MCP auditados

- `src/copilot/mcp/tools/devcontainer-network-posture.js`;
- `src/copilot/mcp/registry.js`;
- `src/copilot/mcp/tool-surface.js`;
- `src/copilot/mcp/control-plane/jobs.js`;
- `src/copilot/mcp/tools/jobs.js`;
- `src/copilot/mcp/tools/meta.js`;
- `src/copilot/mcp/cloudflare/metrics-histograms.js`;
- `src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js`;
- `src/copilot/mcp/tools/connection.js`;
- `src/copilot/mcp/connection/profile.js`;
- `src/copilot/mcp/openai/secure-tunnel-readiness.js`;
- `src/copilot/mcp/openai/index.js`;
- `src/copilot/mcp/openai/secure-tunnel-cli.js`.

## 2.4. Model Gateway / OpenAI abstractions auditadas

- `src/copilot/model-gateway/providers/endpoints/openai.js`;
- `src/copilot/model-gateway/providers/endpoints/index.js`;
- `src/copilot/model-gateway/providers/endpoints/source-records.js`;
- `src/copilot/model-gateway/providers/specs/openai.js`;
- `src/copilot/model-gateway/providers/provider-adapter-registry.js`;
- `src/copilot/model-gateway/providers/openai-provider-family-adapter.js`;
- `src/copilot/model-gateway/providers/openai-compatible-adapter.js`.

Conclusão: Model Gateway e NCP possuem interesses adjacentes, mas não devem formar dependência circular. O primeiro conhece **provider runtime/model endpoints**; o segundo conhece **network substrate/transport reachability**.

## 2.5. Testes auditados

- `tests/unit/copilot/mcp/test_mcp_jobs.spec.js`;
- `tests/unit/copilot/mcp/test_mcp_registry.spec.js`;
- `tests/unit/copilot/mcp/test_mcp_network_resilience_semantics.spec.js`;
- demais tests/references relevantes encontrados durante o cruzamento de contratos.

## 2.6. Documentação canônica e análises históricas auditadas

- `src/copilot/docs/WORKSPACE_MCP_IO_LATENCIA_LIBERDADE_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-17.md`, lido integralmente na investigação anterior desta mesma trilha;
- `src/copilot/mcp/README.md`;
- `src/copilot/model-gateway/README.md`;
- `src/copilot/docs/INDEX.md`;
- documentos locais ainda não versionados ligados a auditoria, tracing e Model Gateway.

---

# 3. Fotografia Git e worktree em 2026-08-18

## 3.1. Últimos commits observados

```text
64d80411d perf(mcp): unlock atomic target batch progress
f4bbe3f0d fix(io): converge working set file removals
8269656f0 perf(mcp): compact working set result flow
c6a190db1 perf(io): diversify bounded working set selection
0f4399c40 perf(mcp): compact patch batch result surfaces
ef66875b7 perf(io): collapse same-file patch round trips
a29bb018f chore(copilot): harden runtime dependency graph
5ac2f670a perf(index): filter startup replay by index domain
918d9fa93 perf(index): replay journal across startup checkpoints
99eaf8187 fix(mcp): complete widget submission metadata
5fe0ba7f8 perf(runtime): share Node 24 compile cache across MCP and terminal
d145d8166 perf(io): compose bounded working sets across cache parser and index
```

Essa sequência confirma que a frente imediatamente anterior concentrou-se em IO, batching, working set, index e liberdade operacional do MCP. A frente de rede deve aproveitar essas primitives em vez de construir mecanismos paralelos.

## 3.2. Worktree observada antes da criação deste documento

Arquivos modificados incluíam:

- `.devcontainer/Dockerfile`;
- `.devcontainer/devcontainer.json`;
- `.devcontainer/scripts/network-control-plane-state.sh`;
- `.devcontainer/scripts/network/contracts/summary-contracts.jsonc`;
- `.devcontainer/scripts/network/local-dns-cache.sh`;
- `.devcontainer/scripts/post-create.sh`;
- `.devcontainer/scripts/post-start.sh`;
- `.vscode/settings.json`;
- `src/copilot/mcp/cloudflare/metrics-histograms.js`;
- `src/copilot/mcp/control-plane/jobs.js`;
- `src/copilot/mcp/registry.js`;
- `src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js`;
- `src/copilot/mcp/tool-surface.js`;
- `src/copilot/mcp/tools/devcontainer-network-posture.js`;
- `src/copilot/mcp/tools/jobs.js`;
- `src/copilot/mcp/tools/meta.js`;
- `tests/unit/copilot/mcp/test_mcp_jobs.spec.js`;
- `tests/unit/copilot/mcp/test_mcp_registry.spec.js`.

Untracked observados:

- `DOCUMENTAÇÃO/tracing-background-task-display-report.md`;
- `audit_externa_src_copilot`;
- `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/LLM-B-TOOL-OPS-ANALISE-PROFUNDA-2026-06-14.md`;
- `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/model-gateway-route-switch-study.md`;
- `tests/unit/copilot/mcp/test_mcp_network_resilience_semantics.spec.js`;
- `workspaces/chatgpt-docker-puppeteer/catalog-analysis.md`;
- `workspaces/chatgpt-docker-puppeteer/manual-provider-investigation.md`.

## 3.3. Achado crítico de Git metadata: executable-bit regressions

O diff atual mostra alterações como:

```text
old mode 100755
new mode 100644
```

em arquivos como:

- `.devcontainer/Dockerfile`;
- `.devcontainer/devcontainer.json`;
- `.devcontainer/scripts/network/local-dns-cache.sh`;
- `.devcontainer/scripts/post-create.sh`;
- `.devcontainer/scripts/post-start.sh`.

Para scripts `.sh`, perder `+x` pode quebrar lifecycle hooks, comandos diretos e assumptions de execução após clone/rebuild. Mesmo quando um hook chama `bash script.sh`, o mode drift continua sendo alteração não intencional de metadata e pode afetar outros consumers.

**Regra de publicação:** nenhuma sincronização total da worktree deve ocorrer antes de revisar e restaurar intencionalmente os modes canônicos.

## 3.4. Achado de path-placement: diretório `workspaces/` dentro do repo

Existe:

```text
workspaces/chatgpt-docker-puppeteer/catalog-analysis.md
workspaces/chatgpt-docker-puppeteer/manual-provider-investigation.md
```

O workspace real já é `/workspaces/chatgpt-docker-puppeteer`. Logo, esse path interno parece ter sido criado a partir de um path absoluto/mental reproduzido como relativo.

Os conteúdos são documentação legítima, mas **a localização é provavelmente acidental**. Antes de publicar, deve-se decidir destino canônico sob `src/DOCUMENTAÇÃO/...`, `src/copilot/docs/...` ou outra árvore documental existente.

## 3.5. Achado de classificação: `audit_externa_src_copilot`

É um arquivo Markdown sem extensão, ~51 KiB, contendo auditoria técnica de `src/copilot/infra` e `tools/file`. A leitura não revelou segredo evidente. O problema é de naming/placement:

- nome sem extensão;
- localização na raiz;
- escopo documental compatível com a árvore `src/DOCUMENTAÇÃO/...`.

Deve ser normalizado antes de uma publicação “all worktree”.

## 3.6. Secret scan preliminar dos untracked

Busca bounded por padrões `sk-`, token, secret, password, api key e bearer nos principais untracked e `.vscode/settings.json` não encontrou ocorrência suspeita. Isso **não substitui** o gate final de segredo, mas reduz a probabilidade de exposição óbvia nesses arquivos.

---

# 4. Fotografia live do circuito MCP/Cloudflare após reconnect

## 4.1. Configuração atual

Observado após reconnect:

```text
mode: named-permanent
public MCP: https://mcp.aurelin.org/mcp
auth: OAuth
cloudflared edge transport: QUIC
origin: https://127.0.0.1:3333
origin transport: HTTP/2
origin TLS verification: enabled
origin server name: mcp.aurelin.org
HA connections: 4
```

Remote audit atual: **ok**.

## 4.2. Métricas atuais

Snapshot observado:

```text
cloudflared version: 2026.5.2
remote active HA connections: 4
local metrics haConnections: 4
QUIC RTT: ~24 ms
RPC client p95: ~1170 ms
requestErrors: 9
requests: 55
cumulative requestErrorRate: ~0.163636
response codes:
  200: 29
  202: 11
  302: 1
  400: 2
  415: 1
```

A taxa cumulativa de `requestErrors` não é uma taxa de falha do último intervalo. Ela precisa ser correlacionada com delta de counters, smoke, HA, origin logs e response-code deltas.

## 4.3. Evento de reconnect observado

No log houve um burst concentrado em aproximadamente:

```text
2026-08-18T17:07:34Z
```

com:

- `accept stream listener encountered a failure while serving`;
- `control stream encountered a failure while serving`;
- quatro `Connection terminated` / falhas equivalentes;
- reconexão das quatro sessões HA entre ~17:07:35Z e ~17:07:38Z.

Depois da recuperação:

- remote tunnel = healthy;
- 4/4 conexões;
- QUIC presente;
- remote audit = green;
- nenhum origin error acionável;
- somente `context canceled` classificados como benign lifecycle cancellations.

Esse evento é altamente compatível com o restart/reconnect deliberado informado pelo operador. Ele demonstra, porém, uma propriedade importante: **o modelo de saúde deve representar interruption → recovery**, e não apenas “houve erro recente”.

## 4.4. Smoke

O último connector smoke persistido estava ~33 minutos antigo, ainda dentro do budget de 60 minutos usado pelo runtime e com `ok=true`.

O estado atual não exige concluir que houve falha após o reconnect; os gates pós-mudança passaram. Todavia, para incident response ideal, um reconnect de tunnel deveria poder registrar um **recovery epoch** e opcionalmente invalidar/baixar a autoridade de smoke anterior quando a topologia mudou materialmente.

---

# 5. “Aguardando conexão” — modelo causal completo

A mensagem “aguardando conexão” no cliente ChatGPT não pode ser atribuída automaticamente ao MCP ou ao Cloudflare. Há pelo menos cinco legs independentes.

## 5.1. Leg A — cliente ChatGPT ↔ infraestrutura OpenAI

```text
app/web ChatGPT
  ↕ TLS / WebSocket / HTTP
chatgpt.com / ws.chatgpt.com / infraestrutura OpenAI
```

Possíveis causas:

- Wi‑Fi/ISP local;
- perda momentânea de rota;
- proxy corporativo;
- inspeção TLS;
- timeout de WebSocket;
- bloqueio/intermitência em `ws.chatgpt.com`;
- suspensão do aplicativo/background networking;
- instabilidade do serviço OpenAI.

**Importante:** este leg pode produzir “aguardando conexão” mesmo se o nosso MCP estiver perfeito.

## 5.2. Leg B — OpenAI backend ↔ endpoint MCP público

```text
infra OpenAI
  → https://mcp.aurelin.org/mcp
```

Esse leg não é provado por um `curl` local. Evidências adequadas:

- connector smoke real;
- tools/list/tool execution observadas pelo cliente;
- edge/tunnel request logs/metrics;
- OAuth discovery e callback reais.

## 5.3. Leg C — Cloudflare edge ↔ cloudflared

```text
Cloudflare edge
  ↔ QUIC/HTTP2 tunnel
cloudflared
```

Possíveis causas:

- QUIC path disruption;
- UDP/NAT timeout;
- reconnect do daemon;
- restart intencional;
- edge migration;
- route/ISP changes;
- event loop/runtime kill externo.

A arquitetura já mantém 4 HA connections, reduzindo blast radius de uma conexão individual.

## 5.4. Leg D — cloudflared ↔ origin local

```text
cloudflared
  → HTTPS/H2 127.0.0.1:3333
MCP origin
```

Possíveis causas:

- origin restart;
- TLS mismatch;
- port not listening;
- event-loop saturation;
- process crash;
- container pressure;
- request cancellation normal.

`context canceled` isolado não deve ser promovido automaticamente a origin failure.

## 5.5. Leg E — Windows/WSL/Docker/DevContainer

```text
Windows host
  → WSL2 VM
    → Docker Desktop / engine
      → container
        → cloudflared + MCP
```

Uma queda do WSL derruba simultaneamente origin, cloudflared e qualquer observabilidade local. Esse evento já ocorreu historicamente neste projeto e deve ser first-class no diagnóstico.

## 5.6. Estado-alvo para “aguardando conexão”

O sistema deve produzir uma classificação como:

```text
client_openai_leg: unknown / suspected / healthy-from-client-evidence
openai_mcp_leg: healthy / degraded / unknown
cloudflare_tunnel_leg: healthy / recovering / degraded
origin_leg: healthy / degraded
host_container_leg: healthy / degraded / restarted
correlation_confidence: low / medium / high
```

A ferramenta nunca deve responder “o problema foi Cloudflare” apenas porque houve um tunnel error em janela semelhante.

---

# 6. Documentação OpenAI atual e implicações arquitetônicas

## 6.1. Fontes oficiais consultadas

Em 2026-08-18 foram verificadas fontes oficiais, incluindo:

- `https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps`;
- `https://help.openai.com/en/articles/12111596-ip-allowlisting-for-chatgpt`;
- `https://platform.openai.com/docs/api-reference/realtime`;
- `https://platform.openai.com/docs/quickstart`;
- `https://developers.openai.com/`.

## 6.2. Implicação 1 — HTTPS não é suficiente

ChatGPT utiliza conexões persistentes/WebSocket em cenários relevantes. A documentação oficial cita `ws.chatgpt.com` e TCP/443, além de alertar para problemas com proxies e inspeção TLS.

Logo, o registry futuro deve representar:

- DNS;
- TCP;
- TLS;
- HTTP;
- WebSocket;
- UDP quando um produto específico exigir e quando fizer sentido observar.

## 6.3. Implicação 2 — allowlist facts não são probe list

A documentação OpenAI lista diversos domínios necessários ao produto. Isso não significa que todos devam virar probes ativos.

Separar:

- **external allowlist facts**;
- **canonical probe targets**;
- **provider runtime endpoints**;
- **third-party product dependencies**;
- **WebSocket capabilities**.

## 6.4. Implicação 3 — não pinning de IP genérico OpenAI

O route-fix GitHub usa lógica provider-specific, ranges e `/etc/hosts`. Nada na investigação justifica copiar esse modelo para OpenAI.

Regra: **não criar um `openai-route-fix` genérico por analogia.**

---

# 7. Arquitetura atual — mapa real

## 7.1. Lifecycle dominante

```text
DevContainer create
  └─ post-create.sh
      ├─ auditoria estrutural
      ├─ versions/contracts
      ├─ registry audit
      ├─ artifacts estruturais
      └─ readiness baseline

DevContainer start
  └─ post-start.sh
      ├─ NSS / identidade
      ├─ local-dns-cache.sh
      ├─ local-copilot-proxy.sh
      ├─ advisor/cache
      ├─ github-copilot-network-manager.sh
      ├─ github-api-route-fix.sh
      ├─ diagnósticos
      └─ network-control-plane-state.sh

VS Code attach
  └─ post-attach.sh
      ├─ reconciliação leve
      └─ UX/status

healthcheck
  └─ healthcheck.sh
      ├─ runtime fundamentals
      └─ network/provider checks misturados
```

## 7.2. Componentes atuais e papel ideal

| Componente | Papel atual | Papel ideal |
|---|---|---|
| `local-dns-cache.sh` | resolver/cache + benchmark + split + rollback | substrate observer/actuator |
| `github-copilot-network-manager.sh` | registry + probes + recommendations | provider observer/orchestrator |
| `copilot-route-advisor.sh` | recomendações passivas | provider observer |
| `github-api-route-fix.sh` | pin/histerese GitHub `/etc/hosts` | provider-specific actuator |
| `local-copilot-proxy.sh` | tinyproxy local + proxy env | scoped transport actuator |
| `network-control-plane-state.sh` | agregador | provider-neutral state projector |
| `post-start.sh` | super-orquestrador | lifecycle coordinator fino |
| `post-create.sh` | structural gate + matrix | bootstrap/contract validator |
| `post-attach.sh` | UX/status | projection consumer |
| `healthcheck.sh` | health geral + Copilot checks | substrate health + compact NCP view |
| MCP posture tool | lê artifacts e interpreta | canonical NCP consumer |

## 7.3. Cadeia producer → artifact → consumer → decision

```text
component
  → /tmp/<component>.summary|status|events
    → lifecycle / health / NCP / MCP
      → novo finding/status
        → operador ou actuator
```

Hoje cada camada ainda pode reinterpretar o mesmo fato com parser/default/semântica próprios. O estado-alvo reduz esse espaço de interpretação.

---

# 8. Bugs confirmados e problemas concretos

## B-001 — manager materializa registry antes da validação integral — **ALTA**

`github-copilot-network-manager.sh` resolve/monta endpoints antes de concluir todos os invariantes do registry.

**Risco:** registry posteriormente classificado como inválido ainda influencia execução.

**Invariante alvo:**

```text
read → validate all → freeze/materialize → consume
```

Mutação/recomendação sensível deve falhar closed.

## B-002 — proxy pode consumir registry inválido — **ALTA**

Para um actuator com potencial efeito global via proxy environment, um registry formalmente inválido não pode ser fonte de configuração.

## B-003 — advisor pode recomendar com dataset formalmente inválido — **MÉDIA**

Por ser passivo, a severidade é menor, mas a semântica ainda é incoerente.

## B-004 — defaults DNS divergentes entre observadores — **ALTA**

Dockerfile/devcontainer/post-start convergem em default enabled; outros hooks/health historicamente possuíam fallback diferente quando env não chegava.

**Resultado:** mesmo runtime pode ser classificado de modo diferente por observer.

## B-005 — post-create pode publicar verdade prematura — **ALTA**

Artifacts/manifest podem registrar readiness mais otimista antes da conclusão de todos os gates.

**Alvo:** final status só é autoridade depois do pipeline estrutural terminar.

## B-006 — DNS substrate acoplado a GitHub reachability — **ALTA**

Provider outage não pode provocar rollback de um resolver comprovadamente funcional.

## B-007 — takeover do dnsmasq precisa ownership mais forte — **ALTA**

Socket/PID/process-name isolados não bastam para provar que um processo é nosso.

**Ownership alvo:** PID + start identity + executable + cmdline/config + marker + fingerprint + socket.

## B-008 — proxy Copilot pode ter blast radius global — **ALTA**

O script é Copilot-specific em intenção, mas `HTTP_PROXY`/`HTTPS_PROXY` podem alterar qualquer processo proxy-aware.

## B-009 — NCP atual ainda considera Copilot componente estruturalmente central — **MÉDIA/ALTA**

Provider desabilitado deveria gerar `skipped/not-applicable`, não degradação do plano inteiro.

## B-010 — helper `sanitize_oneline` diverge entre scripts — **BAIXA, sintoma sistêmico**

Há normalização inconsistente de CR/LF e helpers copiados.

## B-011 — post-attach usa “read-only” de forma ambígua — **BAIXA**

É network-read-only, mas ainda pode escrever state/UX artifacts.

## B-012 — Makefile possui drift de metadados de versão — **BAIXA**

Reduz confiança em operator UX e release metadata.

## B-013 — contrato referencia validator/comando inexistente ou não canônico — **MÉDIA**

`summary-contracts.jsonc` precisa apontar para validation path realmente implementado.

## B-014 — `$schema` placeholder reduz valor do contrato — **BAIXA/MÉDIA**

Contrato aparenta formalização maior que a validação efetivamente disponível.

## B-015 — executable-bit removido na worktree — **ALTA / BLOQUEADOR DE COMMIT**

Diffs mostram `100755 → 100644` em scripts executáveis. Deve ser corrigido antes de publicação.

## B-016 — árvore `workspaces/...` criada dentro do próprio repo — **MÉDIA / BLOQUEADOR DE COMMIT TOTAL**

Conteúdo parece legítimo, path parece acidental.

## B-017 — arquivo documental raiz sem extensão — **BAIXA/MÉDIA**

`audit_externa_src_copilot` deve receber nome/path canônico antes de publicação.

## B-018 — `cloudflared_tunnel_request_errors` tratado historicamente como gate duro — **ALTA, parcialmente corrigido localmente**

Counters do cloudflared podem crescer com lifecycle/cancellations. A worktree já contém evolução para `requestErrors` advisory + response-code deltas.

## B-019 — response code parser não usava label canônico `status_code` e sobrescrevia samples — **MÉDIA, corrigido localmente**

A worktree passa a priorizar `status_code` e acumular samples duplicados por connection index.

## B-020 — NCP path drift `scripts/network/network-control-plane-state.sh` — **ALTA, corrigido localmente**

Config apontava para path inexistente enquanto o script canônico está em `.devcontainer/scripts/network-control-plane-state.sh`.

A worktree contém self-healing em `post-create`/`post-start` e metadata atualizada.

## B-021 — versão esperada do NCP estava stale — **MÉDIA, corrigido localmente**

Path fix isolado teria exposto mismatch 1.0.0/1.1.x. Worktree alinha versões.

## B-022 — próprio dnsmasq gerenciado era reportado como conflito de porta — **MÉDIA, corrigido localmente**

Worktree passa a distinguir listener gerenciado de conflito real.

## B-023 — artifact stale podia governar route state atual — **ALTA, corrigido localmente**

Worktree introduz `route_authority_state` e impede artifact stale de ser runtime authority.

## B-024 — schema cache do host pode ficar stale em sessão longa — **MÉDIA operacional**

Hot reload do backend não garante re-hidratação do schema de tools já carregado pelo harness ChatGPT. Isso já foi observado com enum de validators.

**Alvo:** descriptors future-proof, backend allowlist autoritativa, mudanças de shape minimizadas.

## B-025 — reconnect burst não possui epoch/recovery semantics unificado — **MÉDIA**

Há evidência de tunnel interruption e recovery, mas não um objeto normalizado que diga “recovered at T, prior errors historical relative to recovery”.

---

# 9. Gaps arquitetônicos

## G-001 — endpoint registry sem provider/product/scope/leg

TSV atual não possui dimensões suficientes para um NCP geral.

## G-002 — ausência de envelope comum versionado

Contracts existem, mas summaries ainda são heterogêneos.

## G-003 — observer/actuator não é primitive formal

Separação existe por convenção, não por contrato executável.

## G-004 — authority não é first-class em todo artifact

Falta distinguir configured/observed/inferred/cached/stale/external/not-observable.

## G-005 — substrate/provider/product/transport não formam hierarquia explícita

Isso permite que falhas de aplicação contaminem infraestrutura.

## G-006 — WebSocket/long-lived connection não é representável no registry atual

Crítico para ChatGPT e útil para outras integrações.

## G-007 — política de DNS corporativo/split-horizon não é primeira classe

Mechanisms existem, mas defaults públicos podem preceder a intenção de rede.

## G-008 — parsing/validation do registry duplicado em Bash

Manager/advisor/proxy/post-create não compartilham um owner único.

## G-009 — compatibilidade v1→v2 não possui projection generator comum

Sem isso, legado tende a ser mantido por cópia manual.

## G-010 — fault injection de rede não é sistemático

Faltam cenários cruzados provider/substrate/transport.

## G-011 — não há recovery epoch canônico

Erros “recentes” anteriores a um recovery comprovado podem permanecer visualmente ameaçadores.

## G-012 — não há correlação de host/WSL/container lifecycle com tunnel lifecycle

Um WSL crash parece, de baixo para cima, múltiplas falhas independentes quando na realidade existe uma causa comum.

## G-013 — não há classificação específica de client↔OpenAI leg

O repo não controla esse leg, mas deveria saber declarar **não observável** em vez de inferir.

## G-014 — não há publicação Git “all worktree” com normalization gate

A toolchain já permite staging explícito, mas ainda é necessário processo arquitetônico que classifique chmod/path/artifact antes de staging total.

---

# 10. Estado-alvo — um único Network Control Plane

## 10.1. Topologia lógica

```text
                         ┌──────────────────────────────────────┐
                         │        Network Control Plane         │
                         │ normalize / correlate / recommend    │
                         └─────────────────┬────────────────────┘
                                           │
             ┌─────────────────────────────┼─────────────────────────────┐
             │                             │                             │
     ┌───────▼────────┐            ┌───────▼────────┐            ┌──────▼─────────┐
     │ substrate      │            │ providers      │            │ transports      │
     │ DNS/egress     │            │ GitHub/OpenAI  │            │ MCP/Cloudflare  │
     │ proxy/lifecycle│            │ Copilot/etc.   │            │ Secure Tunnel   │
     └───────┬────────┘            └───────┬────────┘            └──────┬─────────┘
             │                             │                             │
        safe actuators              product observers              correlation only
                                           │
                                provider-specific actuators
                                ex.: GitHub API route-fix
```

## 10.2. O NCP não é um “universal network optimizer”

Ele deve:

- observar;
- normalizar;
- correlacionar;
- recomendar;
- autorizar actuators apenas quando policy permitir.

Ele não deve automaticamente:

- pin IPs;
- trocar DNS;
- ativar proxy;
- mudar Cloudflare;
- matar processos;
- assumir que um provider é crítico.

---

# 11. Modelo canônico de dimensões

Todo sinal relevante deve poder carregar:

```text
schema_version
contract_version
summary_kind
component
scope
provider
product
leg
transport
probe_kind
status
reason
enabled
effective
authority
observed_at
source_observed_at
age_ms
stale
recovery_epoch
mutation_class
container_fingerprint
registry_version
compat_mode
```

Nem todo artifact preenche tudo. Ausência deve ser `not-applicable`/`unknown` tipada, não campo inventado.

---

# 12. Taxonomia de scopes

Proposta inicial:

```text
substrate:dns
substrate:egress
substrate:proxy
substrate:host-runtime
provider:github
product:github-api
provider:copilot
product:github-copilot
provider:openai
product:openai-api
product:chatgpt
transport:mcp-local-origin
transport:mcp-cloudflare
transport:mcp-openai-secure-tunnel
client:chatgpt-openai
```

---

# 13. Modelo de legs

```text
container -> dns-resolver
container -> generic-internet
container -> github
container -> github-copilot
container -> api.openai.com
container -> chatgpt-equivalent-endpoint
client -> chatgpt/openai
openai -> public-mcp
cloudflare-edge -> cloudflared
cloudflared -> local-origin
host -> wsl
wsl -> docker
container -> cloudflare-edge
secure-tunnel-client -> openai
```

**Regra:** uma medição em um leg nunca prova automaticamente outro leg.

---

# 14. Modelo de authority

Valores mínimos:

- `observed` — medição direta;
- `configured` — configuração declarada;
- `inferred` — conclusão derivada;
- `cached-observation` — medição passada dentro do freshness budget;
- `stale-observation` — preservada apenas para forense;
- `external-documentation` — requisito vindo de fonte externa;
- `client-evidence` — evidência retornada pelo cliente;
- `remote-control-plane` — Cloudflare/OpenAI remote API quando aplicável;
- `not-observable-here` — leg fora da posição do observer.

---

# 15. Modelo temporal e recovery epoch

## 15.1. Problema

“Erro nos últimos N minutos” é insuficiente quando houve restart/recovery dentro de N.

## 15.2. Estado-alvo

Cada componente de transporte deve poder declarar:

```text
last_failure_at
last_recovery_at
recovery_epoch
consecutive_healthy_samples
active_since
errors_since_recovery
```

## 15.3. Regra

Um erro anterior ao `last_recovery_at`, sem recorrência posterior, continua disponível para forense, mas perde autoridade para classificar o estado presente.

Isso formaliza o que a worktree já começa a fazer com route artifact stale e `requestErrors` advisory.

---

# 16. Endpoint/probe registry v2

## 16.1. Pipeline obrigatório

```text
read bytes
  → validate header/schema/version
  → validate every row
  → validate uniqueness/cross-row invariants
  → materialize immutable records
  → filter enabled scopes/providers
  → execute observers
  → publish evidence
  → optional actuator consumes only eligible evidence
```

## 16.2. Campos propostos

Para manter compatibilidade com Bash, TSV ainda é opção forte:

```text
provider
product
scope
leg
url
id
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

## 16.3. Validação

O registry é inválido se houver:

- versão/header incorretos;
- número de campos incorreto;
- ID duplicado;
- URL/scheme incompatível;
- transport desconhecido;
- expected outcome impossível;
- actuator eligibility em probe que não pode autorizar mutação;
- provider/product sem scope coerente.

---

# 17. DNS — estado-alvo

## 17.1. Princípios

1. resolver health é provider-neutral;
2. provider outage não causa rollback do resolver;
3. inherited resolver deve ser preservado por default quando saudável;
4. split-DNS/VPN têm precedência sobre benchmark público;
5. takeover exige ownership forte;
6. qualquer rewrite de `resolv.conf` exige backup/preflight/post-proof/rollback;
7. warmup é performance hint;
8. benchmark é recommendation;
9. public upstream não deve ser hardcoded sem policy explícita.

## 17.2. Proof chain

```text
process/socket ownership
  → local dnsmasq query
  → neutral canary
  → inherited/split domain canary
  → provider observations
  → substrate state
```

## 17.3. Upstream policies

```text
inherit-first
public-fallback
benchmark-select
split-preserving
explicit-static
```

Cada upstream deve declarar origem:

```text
docker
host
vpn
configured-public
benchmark
operator
```

## 17.4. Docker runArgs

A presença de `--dns=1.1.1.1` / `--dns=8.8.8.8` deve ser tratada como **decisão arquitetural**, não convenience.

Remoção só após:

- instrumentar inherited resolvers;
- recreate real;
- VPN/split scenario;
- failover scenario;
- confirmar que dnsmasq recebe upstream útil.

---

# 18. Proxy — estado-alvo

## 18.1. Decisão pendente

Duas arquiteturas são coerentes.

### A. Provider-scoped proxy

Preferível se o proxy existe apenas para Copilot:

- não exportar proxy global;
- injetar apenas nos consumers Copilot;
- host policy derivada de registry validado.

### B. Generic egress proxy

Só justificar se múltiplos consumers tiverem benefício comprovado:

- rename semântico;
- policy explícita;
- provider observations independentes;
- compat aliases.

## 18.2. Regra de segurança

Ativar proxy para Copilot não pode silenciosamente alterar tráfego OpenAI/MCP/Git sem policy explícita.

---

# 19. GitHub route-fix — especialização preservada

`github-api-route-fix.sh` depende de facts GitHub específicos:

- `api.github.com`;
- `/meta`;
- ranges GitHub;
- histerese;
- `/etc/hosts`.

Arquitetura correta:

```text
NCP evidence(provider=github)
  → policy gate
    → actuator capability github-api-route-fix
      → provider-actuator summary
        → NCP aggregation
```

Não existe obrigação de que todo provider possua actuator equivalente.

---

# 20. OpenAI API, ChatGPT e MCP — separação rigorosa

## 20.1. OpenAI API

Leg observável do container:

```text
container → DNS → TCP/TLS → api.openai.com
```

O Model Gateway já conhece `https://api.openai.com/v1` como provider endpoint. O NCP não deve copiar lógica de modelos ou autenticação.

## 20.2. ChatGPT product reachability

O container pode testar reachability equivalente, mas isso é:

```text
authority=observed-from-container
```

Nunca:

```text
chatgpt-client-proven=true
```

## 20.3. ChatGPT WebSocket

Registry deve suportar capability WebSocket bounded. O teste precisa ser:

- sem auth sensível;
- sem payload destrutivo;
- timeout curto;
- capaz de distinguir DNS/TCP/TLS/upgrade failure.

Se não existir probe seguro, registrar apenas requirement documental.

## 20.4. OpenAI → MCP

Provar por:

- connector smoke real;
- tools/list/tool call;
- Cloudflare request/edge metrics;
- OAuth flow;
- client evidence.

Não por probe local equivalente.

## 20.5. Secure MCP Tunnel

É transporte opcional e deve entrar como:

```text
transport:mcp-openai-secure-tunnel
```

não como provider health.

---

# 21. Cloudflare/MCP — estado-alvo

## 21.1. Topologia atual saudável

O estado live atual mostra:

- named tunnel;
- hostname permanente;
- DNS CNAME correto;
- 4 HA connections;
- QUIC ativo;
- HTTPS origin;
- HTTP/2 origin;
- TLS verification;
- SNI correto;
- connect timeout reduzido;
- keepalive pinado;
- remote audit sem gaps.

Isso deve ser preservado enquanto a frente NCP evolui.

## 21.2. Request error semantics

Counters cumulativos são telemetria, não gate isolado.

Hard gates adequados:

- smoke;
- 4 HA quando essa for a topologia esperada;
- metrics readable;
- origin health;
- remote config sync;
- p95 budget;
- transport-specific fatal signals.

`requestErrors delta != 0` = review/advisory, não veto automático.

## 21.3. Context canceled

`context canceled` pode refletir request lifecycle normal. Deve ser correlacionado com:

- HTTP response;
- client disconnect;
- smoke result;
- origin process health;
- connection epoch.

---

# 22. Summary contract v2

## 22.1. Evoluir o catálogo existente

Não criar um segundo arquivo concorrente ao `summary-contracts.jsonc`.

Promover o catálogo existente a provider-neutral.

## 22.2. Envelope conceitual

```text
schema_version=2
contract_version=2
summary_kind=network-component
component=local-dns-cache
scope=substrate:dns
provider=none
product=none
leg=container->dns-resolver
transport=dns
status=ok
reason=local-probe-and-neutral-canary-proven
authority=observed
enabled=true
effective=true
observed_at=...
age_ms=0
stale=false
recovery_epoch=...
mutation_class=global-resolver
registry_version=2
compat_mode=v1-projection
```

## 22.3. Compatibilidade

Durante migração:

- producer escreve v2;
- mantém keys v1 necessárias;
- consumer prefere v2;
- fallback legacy explícito;
- telemetria registra fallback;
- remoção somente após zero consumers conhecidos.

---

# 23. Observer, policy gate e actuator

## 23.1. Observer

Permitido:

- ler config/artifacts;
- DNS resolution;
- bounded TCP/TLS/HTTP/WS probe;
- medir latência;
- publicar findings.

Proibido:

- editar hosts;
- editar resolver;
- matar processo;
- exportar proxy global;
- alterar Cloudflare.

## 23.2. Policy gate

Combina:

```text
validated configuration
+ fresh evidence
+ correct scope/leg
+ authority class
+ actuator capability
+ explicit policy
= eligible mutation
```

## 23.3. Actuator

Precisa declarar:

- `mutation_class`;
- lock;
- preconditions;
- ownership proof;
- evidence inputs;
- rollback;
- idempotency;
- post-proof;
- failure mode;
- blast radius.

---

# 24. Segurança

## 24.1. Segredos

Nunca serializar:

- API keys;
- tunnel tokens;
- OAuth tokens/codes;
- cookies;
- bearer tokens;
- proxy credentials.

Pode registrar:

```text
configured=true
source=ENV_NAME
```

sem valor.

## 24.2. Process ownership

Para dnsmasq/tinyproxy:

```text
pid
proc start identity
exe realpath
cmdline
config path/fingerprint
runtime marker
socket binding
```

## 24.3. Artifact safety

- atomic writes;
- restrictive mode;
- symlink refusal quando necessário;
- bounded histories;
- timestamps;
- fingerprints;
- locks com timeout;
- stale lock handling seguro.

---

# 25. MCP tool surface — estado-alvo

## 25.1. Não proliferar tools

Preservar como núcleo:

- `mcp_devcontainer_network_posture_audit`;
- `mcp_devcontainer_network_control_plane_refresh`.

## 25.2. Refresh bounded

A tool de refresh local já evoluiu para uma primitive segura:

- command fixo;
- script canônico;
- args fixos;
- timeout;
- maxBuffer;
- nenhum path/comando fornecido pelo caller;
- nenhum probe externo.

Isso é o padrão a preservar.

## 25.3. Posture v2

Formato-alvo:

```json
{
  "substrate": {
    "dns": {},
    "egress": {},
    "proxy": {},
    "hostRuntime": {}
  },
  "providers": {
    "github": {},
    "copilot": {},
    "openai": {}
  },
  "products": {
    "github-api": {},
    "github-copilot": {},
    "openai-api": {},
    "chatgpt": {}
  },
  "transports": {
    "mcp-cloudflare": {},
    "mcp-openai-secure-tunnel": {}
  },
  "clientLegs": {
    "chatgpt-openai": {
      "authority": "not-observable-here"
    }
  },
  "findings": {},
  "recovery": {},
  "compatibility": {}
}
```

---

# 26. Node 24+ — papel na evolução

O NCP não precisa permanecer integralmente em Bash apenas por herança histórica.

## 26.1. Onde Bash continua ideal

- lifecycle hooks;
- process/socket primitives;
- resolver manipulation;
- early bootstrap;
- situações em que Node ainda não é confiável/levantado.

## 26.2. Onde Node 24 pode reduzir complexidade

- validation do registry;
- schema validation;
- normalized envelope parsing;
- report projection;
- JSON/JSONC handling;
- test fixtures;
- correlation engine;
- transport metrics analysis.

## 26.3. Regra

Não mover mecanismo crítico de boot para Node apenas por elegância. Primeiro identificar se ele roda em um ponto onde Node 24 é garantido pelo image contract.

## 26.4. Benefícios concretos

- parser mais seguro que shell word splitting;
- `AbortSignal.timeout()`/bounded operations;
- `node:dns/promises`;
- TLS/HTTP/WebSocket client primitives;
- melhor typed result envelopes;
- tests mais expressivos;
- menor duplicação de KV parsing.

---

# 27. Operator UX

## 27.1. Names provider-neutral

Introduzir gradualmente:

```text
network:status
network:summary
network:doctor
network:registry:status
network:dns:status
network:provider:github:status
network:provider:openai:status
network:transport:mcp:status
```

## 27.2. Compat aliases

Manter aliases Copilot durante migração.

## 27.3. Um diagnóstico principal

`scripts/ops/copilot-network-diagnose.sh` deve futuramente convergir para wrapper/provider filter do diagnóstico genérico.

---

# 28. Roadmap booleano completo

Legenda:

- `[x]` concluído/provado nesta trilha;
- `[~]` parcialmente implementado na worktree, ainda não publicado/fechado;
- `[ ]` pendente;
- `[!]` blocker/gate obrigatório.

---

## FAIXA A — investigação, verdade e baseline

### Fase A0 — investigação integral

- [x] **A0.1** Ler roadmap mestre integralmente.
- [x] **A0.2** Ler scripts Bash centrais integralmente.
- [x] **A0.3** Ler lifecycle hooks integralmente.
- [x] **A0.4** Ler registry/contracts/configuração.
- [x] **A0.5** Ler consumers MCP.
- [x] **A0.6** Ler abstrações OpenAI/Model Gateway adjacentes.
- [x] **A0.7** Auditar último HEAD e commits recentes.
- [x] **A0.8** Auditar worktree modificada/untracked.
- [x] **A0.9** Auditar estado live Cloudflare/MCP após reconnect.
- [x] **A0.10** Revisar documentação oficial atual da OpenAI.
- [x] **A0.11** Construir modelo causal do raro “aguardando conexão”.
- [x] **A0.12** Criar este documento canônico.

**Gate A0:** concluído.

### Fase A1 — normalização pré-publicação da worktree

- [x] **A1.1** Restaurar/confirmar executable bits canônicos. O `git_stage` governado detectou e reparou exatamente três drifts `0644 → 0755` ainda registrados como `100755` em HEAD: `local-dns-cache.sh`, `post-create.sh` e `post-start.sh`.
- [x] **A1.2** Classificar todos os untracked.
- [x] **A1.3** Mover `workspaces/...` para destino documental correto ou excluir se duplicado. Os dois relatórios foram preservados e movidos para `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/`.
- [x] **A1.4** Renomear/mover `audit_externa_src_copilot` para path canônico. O relatório foi preservado como `AUDITORIA-EXTERNA-INFRA-IO-TOOLS-FILE-2026-06-14.md`.
- [x] **A1.5** Revisar `.vscode/settings.json` e separar preference local de configuração repo-wide. As três mudanças atuais foram mantidas deliberadamente: browser user tools, Copilot local index e GPU acceleration `off` como postura estável para o problema de renderização observado neste ambiente.
- [x] **A1.6** Secret scan final de todos os paths candidatos ao staging. Os 32 paths então existentes foram varridos individualmente contra padrões de API key/token/private key/bearer sem matches; o runner shell criado em seguida não contém segredo materializado.
- [x] **A1.7** Validar que não há artifacts `/tmp`, state, tokens ou generated dumps sendo versionados.
- [x] **A1.8** Produzir staging plan explícito de toda a worktree normalizada. O plano final enumerou 33 arquivos e nenhum path implícito/glob.

**Gate A1:** concluído em 2026-08-18. O staging explícito foi aplicado sem stage escape e reparou os três executable-bit drifts antes de `git add`.

---

## FAIXA B — primitives e trust boundaries

### Fase B0 — shared Bash primitives

- [ ] **B0.1** Criar `network-common.sh` mínimo.
- [ ] **B0.2** Centralizar boolean/env parsing.
- [ ] **B0.3** Centralizar timestamp/age/freshness.
- [ ] **B0.4** Centralizar safe one-line normalization.
- [ ] **B0.5** Centralizar bounded list/CSV parsing.
- [ ] **B0.6** Evitar abstrações prematuras de helpers usados por apenas um owner.
- [ ] **B0.7** Adicionar nova library à allowlist `devcontainer-shell`.

### Fase B1 — canonical registry validator

- [ ] **B1.1** Definir owner único de validation.
- [ ] **B1.2** Validar header/version.
- [ ] **B1.3** Validar row field count.
- [ ] **B1.4** Validar unique IDs.
- [ ] **B1.5** Validar URL/scheme.
- [ ] **B1.6** Validar expected outcomes.
- [ ] **B1.7** Expor immutable materialization.

### Fase B2 — consumers fail-closed

- [ ] **B2.1** Manager: validate-before-consume.
- [ ] **B2.2** Proxy: invalid registry não gera config/actuation.
- [ ] **B2.3** Advisor: invalid registry não gera recommendation autoritativa.
- [ ] **B2.4** Post-create: usar o mesmo validator/contract.

**Gate B:** fixtures valid/invalid + bash syntax + focused tests.

---

## FAIXA C — contratos e lifecycle

### Fase C0 — summary contract v2

- [ ] **C0.1** Promover `summary-contracts.jsonc` para schema v2.
- [ ] **C0.2** Introduzir common envelope.
- [ ] **C0.3** Introduzir `authority`.
- [ ] **C0.4** Introduzir `scope/provider/product/leg/transport`.
- [ ] **C0.5** Introduzir `observed_at/age/stale`.
- [ ] **C0.6** Introduzir `recovery_epoch` quando aplicável.
- [ ] **C0.7** Corrigir `$schema` placeholder.
- [ ] **C0.8** Implementar/alinhar validator real do contract catalog.

### Fase C1 — compatibilidade v1

- [ ] **C1.1** Definir projection v2→v1.
- [ ] **C1.2** Marcar `compat_mode`.
- [ ] **C1.3** Instrumentar legacy reads.
- [ ] **C1.4** Remover legado somente após zero consumers.

### Fase C2 — lifecycle truth

- [ ] **C2.1** Post-create: status final-only.
- [ ] **C2.2** Separar orchestration state de component state.
- [ ] **C2.3** Reduzir hardcoded version matrix.
- [ ] **C2.4** Unificar defaults de DNS em create/start/attach/health.
- [ ] **C2.5** Formalizar network-read-only em post-attach.

---

## FAIXA D — neutralização do DNS/substrato

### Fase D0 — proof neutral

- [ ] **D0.1** Separar DNS health de provider probes.
- [ ] **D0.2** Introduzir neutral canary.
- [ ] **D0.3** Introduzir split/inherited canary.
- [ ] **D0.4** Provider probes passam a downstream observations.
- [ ] **D0.5** Rollback somente por substrate proof failure.

### Fase D1 — upstream policy

- [ ] **D1.1** Inventariar inherited resolvers.
- [ ] **D1.2** Registrar origem de upstream.
- [ ] **D1.3** Tornar `inherit-first` policy explícita.
- [ ] **D1.4** Preservar VPN/split-horizon.
- [ ] **D1.5** Tornar public fallback explícito.
- [ ] **D1.6** Benchmark-select opt-in.

### Fase D2 — ownership

- [ ] **D2.1** Ownership record forte do dnsmasq.
- [ ] **D2.2** Fail-safe no takeover.
- [ ] **D2.3** PID-reuse test.
- [ ] **D2.4** Foreign socket-owner test.

### Fase D3 — Docker DNS rollout

- [ ] **D3.1** Instrumentar estado antes de alterar runArgs.
- [ ] **D3.2** Recreate test sem public DNS hardcode.
- [ ] **D3.3** VPN/split test.
- [ ] **D3.4** Falha de inherited DNS test.
- [ ] **D3.5** Só então decidir remover `--dns` hardcoded.

---

## FAIXA E — NCP provider-neutral

### Fase E0 — registry v2

- [ ] **E0.1** Definir schema final.
- [ ] **E0.2** Migrar GitHub/Copilot first.
- [ ] **E0.3** Manter legacy registry projection.
- [ ] **E0.4** Source/freshness metadata.

### Fase E1 — aggregator v2

- [ ] **E1.1** Substrate matrix.
- [ ] **E1.2** Provider matrix.
- [ ] **E1.3** Product matrix.
- [ ] **E1.4** Transport matrix.
- [ ] **E1.5** Client/non-observable matrix.
- [ ] **E1.6** Recovery epochs.
- [ ] **E1.7** Flattened compatibility projection.

### Fase E2 — provider optionality

- [ ] **E2.1** Copilot disabled = not-applicable.
- [ ] **E2.2** GitHub disabled = not-applicable.
- [ ] **E2.3** OpenAI provider absence não degrada DNS.
- [ ] **E2.4** Transport health independente de provider catalog.

**Gate E:** NCP pode ficar `healthy` com Copilot explicitamente desabilitado.

---

## FAIXA F — OpenAI/ChatGPT first-class

### Fase F0 — external facts

- [ ] **F0.1** Criar metadata de fonte/data para facts OpenAI.
- [ ] **F0.2** Separar allowlist facts de active probes.
- [ ] **F0.3** Definir freshness de documentação externa.

### Fase F1 — OpenAI API

- [ ] **F1.1** DNS reachability.
- [ ] **F1.2** TCP/TLS reachability.
- [ ] **F1.3** HTTP semantics somente se estáveis e seguras.
- [ ] **F1.4** Não duplicar model/auth logic do Gateway.

### Fase F2 — ChatGPT product

- [ ] **F2.1** HTTPS reachability from container.
- [ ] **F2.2** Representar WebSocket requirement.
- [ ] **F2.3** Implementar bounded WS probe somente se semanticamente seguro.
- [ ] **F2.4** Guidance para TLS inspection/proxy timeout.
- [ ] **F2.5** Marcar `authority=observed-from-container`.

### Fase F3 — client/OpenAI leg

- [ ] **F3.1** Modelar `not-observable-here`.
- [ ] **F3.2** Consumir client evidence quando disponível.
- [ ] **F3.3** Nunca inferir client health de provider egress local.

---

## FAIXA G — MCP/Cloudflare correlation

### Fase G0 — tunnel recovery model

- [~] **G0.1** `requestErrors` passou a advisory na worktree.
- [~] **G0.2** response-code delta parser corrigido na worktree.
- [ ] **G0.3** Introduzir recovery epoch para cloudflared.
- [ ] **G0.4** Classificar errors-before-recovery como historical.
- [ ] **G0.5** Correlacionar HA reconnect timestamps.

### Fase G1 — connector evidence

- [ ] **G1.1** Correlacionar smoke com recovery epoch.
- [ ] **G1.2** Rebaixar smoke anterior a topology-changing restart quando necessário.
- [ ] **G1.3** Correlacionar OAuth discovery.
- [ ] **G1.4** Correlacionar real tools/list/tool call evidence.

### Fase G2 — rare “aguardando conexão” diagnostics

- [ ] **G2.1** Produzir multi-leg report.
- [ ] **G2.2** Não culpar MCP quando client leg unknown.
- [ ] **G2.3** Detectar common-cause host/container restart.
- [ ] **G2.4** Diferenciar intentional reload de spontaneous outage.
- [ ] **G2.5** Expor confidence score.

---

## FAIXA H — proxy e transport policy

### Fase H0 — blast-radius inventory

- [ ] **H0.1** Mapear consumers reais de HTTP_PROXY/HTTPS_PROXY.
- [ ] **H0.2** Mapear noProxy/host behavior.
- [ ] **H0.3** Testar OpenAI/GitHub/Git sob proxy.

### Fase H1 — decisão arquitetônica

- [ ] **H1.1** Escolher provider-scoped ou generic proxy.
- [ ] **H1.2** Definir host policy.
- [ ] **H1.3** Definir compat aliases.

### Fase H2 — rollout

- [ ] **H2.1** Migrar sem alterar tráfego não alvo.
- [ ] **H2.2** Cross-provider blast radius test.

---

## FAIXA I — MCP projection e autonomia operacional

### Fase I0 — posture v2

- [ ] **I0.1** Parser do envelope normalizado.
- [ ] **I0.2** Legacy fallback explícito.
- [ ] **I0.3** Findings por scope/authority.
- [ ] **I0.4** Recovery projection.

### Fase I1 — bounded refresh

- [~] **I1.1** Tool passiva já implementada localmente.
- [ ] **I1.2** Validar no novo schema.
- [ ] **I1.3** Retornar v2 state no mesmo round-trip.

### Fase I2 — validators

- [x] **I2.1** `devcontainer-shell` implementado e provado localmente: runner Node 24, allowlist fixa, ShellCheck `--shell=bash --severity=error` por arquivo, concorrência 4, timeout individual 20 s, process-group kill e diagnóstico incremental. O gate real concluiu 12/12 scripts em aproximadamente 10 s.
- [x] **I2.2** backend allowlist future-proof implementada localmente; o schema MCP aceita string bounded e o server mantém enforcement da allowlist runtime.
- [ ] **I2.3** Garantir que novas shared shell libs entram na syntax allowlist automaticamente ou via catálogo canônico.

---

## FAIXA J — fault injection

### Fase J0 — registry faults

- [ ] **J0.1** Truncated registry.
- [ ] **J0.2** Duplicate ID.
- [ ] **J0.3** Bad header/version.
- [ ] **J0.4** Invalid URL/transport.

### Fase J1 — DNS faults

- [ ] **J1.1** GitHub down + DNS healthy.
- [ ] **J1.2** OpenAI down + DNS healthy.
- [ ] **J1.3** neutral canary down.
- [ ] **J1.4** split resolver present.
- [ ] **J1.5** public DNS blocked.
- [ ] **J1.6** foreign process owns target socket.
- [ ] **J1.7** stale PID reused.

### Fase J2 — transport faults

- [ ] **J2.1** HTTPS healthy + WebSocket blocked.
- [ ] **J2.2** QUIC interrupted + auto recovery.
- [ ] **J2.3** one HA connection drops.
- [ ] **J2.4** all HA reconnect.
- [ ] **J2.5** origin restart.
- [ ] **J2.6** TLS mismatch.

### Fase J3 — circuit correlation faults

- [ ] **J3.1** Cloudflare healthy + connector smoke fails.
- [ ] **J3.2** connector healthy + local OpenAI probe fails.
- [ ] **J3.3** WSL crash common-cause.
- [ ] **J3.4** ChatGPT client disconnect with MCP healthy.

---

## FAIXA K — publicação e sincronização total

### Fase K0 — pre-publish

- [!] **K0.1** Corrigir executable bits.
- [!] **K0.2** Resolver paths/names dos untracked.
- [!] **K0.3** Secret scan final.
- [!] **K0.4** Rodar validators focados relevantes.
- [!] **K0.5** Revisar diff completo.
- [!] **K0.6** Confirmar que `.vscode/settings.json` deve mesmo ser repo-wide.
- [!] **K0.7** Confirmar ausência de state/generated artifacts.

### Fase K1 — staging

- [ ] **K1.1** `git_stage_plan` com paths explícitos.
- [ ] **K1.2** Conferir arquivo a arquivo.
- [ ] **K1.3** Verificar staged diff/modes.

### Fase K2 — commit

- [ ] **K2.1** Commit plan.
- [ ] **K2.2** Commit coerente e auditável.
- [ ] **K2.3** Confirmar HEAD.

### Fase K3 — push

- [ ] **K3.1** Push plan.
- [ ] **K3.2** Push para `origin/main` sem force.
- [ ] **K3.3** Confirmar `main == origin/main`.
- [ ] **K3.4** Confirmar worktree clean.

---

# 29. Ordem imediata recomendada após este documento

1. **Não iniciar pelo OpenAI probe.**
2. Normalizar worktree e publicação somente quando os blockers de mode/path estiverem resolvidos.
3. Fechar as mudanças locais de rede já iniciadas e seus testes.
4. Criar shared registry validation e corrigir validate-before-consume.
5. Evoluir contracts/envelope.
6. Neutralizar DNS health.
7. Tornar NCP provider-aware/optional.
8. Migrar GitHub/Copilot para o modelo novo.
9. Adicionar OpenAI/ChatGPT como scopes first-class.
10. Correlacionar MCP/Cloudflare/recovery.
11. Só depois alterar defaults globais de DNS/proxy.

Essa ordem maximiza informação e minimiza blast radius.

---

# 30. Gates de validação

| Mudança | Gate mínimo | Gate adicional |
|---|---|---|
| shared Bash helper | `devcontainer-shell` / ShellCheck Bash severity=error bounded | focused parser/runner unit |
| registry validation | fixtures valid/invalid | consumer integration |
| manager/proxy/advisor | devcontainer-shell | invalid registry fault |
| summary contract | parser/schema test | producer/consumer integration |
| DNS semantics | syntax + unit | provider outage injection |
| lifecycle | sync check | recreate/start/attach smoke |
| MCP JS | unit-focused | strict typecheck + lint focal |
| Cloudflare metrics | semantic unit | live window correlation |
| OpenAI probes | no-secret bounded test | false-positive analysis |
| WebSocket | bounded timeout | HTTPS-vs-WS fault case |
| resolver defaults | recreate | VPN/split-DNS test |
| proxy | process/socket | cross-provider blast radius |
| publication | full diff + modes | clean worktree after push |

Validadores amplos permanecem escalation-only.

---

# 31. Rollback

## 31.1. Código

- commits pequenos por invariant;
- compat aliases;
- v1 e v2 coexistem durante migração;
- comportamento global separado de refactor;
- nenhuma remoção massiva no mesmo commit que introduz replacement.

## 31.2. DNS

- backup;
- preflight;
- post-proof;
- rollback atômico;
- não depender de provider externo para restaurar resolver.

## 31.3. Route fix

Preservar rollback específico do GitHub actuator.

## 31.4. Proxy

Stop/revert deve funcionar offline.

## 31.5. NCP

Falha do agregador nunca deve mutar rede.

## 31.6. Git publication

Antes de commit total:

- staging explícito;
- modes revisados;
- paths revisados;
- untracked normalizados;
- no force push.

---

# 32. Definition of Done

A frente só está concluída quando:

- [ ] existe um único NCP provider-neutral;
- [ ] nenhum provider é obrigatório para substrate health;
- [ ] todos os registry consumers validam antes de consumir;
- [ ] DNS health independe de GitHub/OpenAI reachability;
- [ ] inherited/split-DNS é first-class;
- [ ] takeover de dnsmasq exige ownership forte;
- [ ] proxy possui escopo inequívoco;
- [ ] GitHub route-fix permanece especializado;
- [ ] OpenAI API, ChatGPT e OpenAI→MCP são legs distintos;
- [ ] WebSocket é representável;
- [ ] authority é first-class;
- [ ] stale evidence nunca governa runtime atual silenciosamente;
- [ ] recovery epoch existe para transports relevantes;
- [ ] “aguardando conexão” pode ser descrito por multi-leg report;
- [ ] client↔OpenAI unknown não é confundido com MCP failure;
- [ ] MCP posture consome envelope canônico;
- [ ] refresh permanece bounded;
- [ ] lifecycle hooks compartilham defaults coerentes;
- [ ] artifacts possuem schema/freshness/authority;
- [ ] fault injection cobre falhas cruzadas;
- [ ] executable bits canônicos estão preservados;
- [ ] nenhuma árvore/path acidental é publicada;
- [ ] worktree pode ser sincronizada integralmente com `main` sem segredo/generated artifact;
- [ ] testes focados e release gates pertinentes passam.

---

# 33. ADRs

## ADR-NCP-001 — um plano, vários providers

**Decisão:** OpenAI/ChatGPT será integrado ao mesmo NCP; nenhuma pilha paralela.

## ADR-NCP-002 — provider health não domina substrate health

**Decisão:** GitHub/OpenAI outage não significa DNS failure.

## ADR-NCP-003 — GitHub route-fix continua especializado

**Decisão:** não generalizar `/etc/hosts`/CIDRs para OpenAI.

## ADR-NCP-004 — auth é adjacente

**Decisão:** NCP registra presença/configuração, nunca segredo; OAuth permanece no auth control plane.

## ADR-NCP-005 — Model Gateway e NCP não importam runtime um do outro

**Decisão:** compartilhar facts/convenções apenas por contrato estável.

## ADR-NCP-006 — passive MCP refresh continua bounded

**Decisão:** nenhuma execução shell arbitrária será adicionada para conveniência.

## ADR-NCP-007 — external facts possuem provenance

**Decisão:** allowlists OpenAI têm fonte/data/freshness.

## ADR-NCP-008 — artifact stale é histórico

**Decisão:** stale state não governa runtime atual.

## ADR-NCP-009 — recovery é first-class

**Decisão:** erros anteriores a recovery comprovado perdem autoridade presente.

## ADR-NCP-010 — client ChatGPT leg pode ser `not-observable-here`

**Decisão:** declarar limites de observabilidade é melhor que inferir.

## ADR-NCP-011 — Node 24 entra onde reduz parsing/contract complexity

**Decisão:** não substituir boot Bash indiscriminadamente.

## ADR-NCP-012 — publicação Git total exige normalization gate

**Decisão:** “commit tudo” não significa `git add -A` cego.

---

# 34. Traceabilidade finding → transformação → prova

| Finding | Transformação | Prova |
|---|---|---|
| B-001 | manager validate-before-consume | invalid registry fixture |
| B-002 | proxy fail-closed | config não emitida |
| B-003 | advisor fail-closed/reduced authority | invalid advisor fixture |
| B-004 | canonical defaults | lifecycle sync test |
| B-005 | final-only manifest | degraded post-create fixture |
| B-006 | neutral DNS proof | provider outage + DNS success |
| B-007 | strong ownership | foreign owner / PID reuse |
| B-008 | scoped proxy | cross-provider test |
| B-009 | provider optionality | Copilot disabled NCP healthy |
| B-015 | restore modes | git diff summary clean |
| B-016 | path normalization | no nested workspace artifact |
| B-018/19 | advisory + response deltas | semantic unit + live window |
| B-020/21 | canonical path/version | self-heal audit |
| B-022 | managed port semantics | DNS finding test |
| B-023 | temporal authority | stale/fresh route fixtures |
| B-025 | recovery epoch | reconnect fault injection |
| G-006 | WS transport | HTTPS healthy + WS blocked |
| G-012 | host correlation | WSL crash scenario |
| G-013 | not-observable client leg | posture projection |

---

# 35. Riscos deliberadamente não resolvidos ainda

1. remover public DNS hardcode de `runArgs` sem recreate test;
2. generalizar proxy antes de mapear consumers;
3. criar active WebSocket probe sem confirmar semântica segura;
4. alterar Cloudflare edge apenas para “otimizar” sem evidência;
5. criar OpenAI IP pinning;
6. inferir cliente ChatGPT health do container;
7. publicar untracked em paths evidentemente acidentais;
8. versionar scripts após perda involuntária de executable bit.

---

# 36. Estado das mudanças locais já em curso

A subfrente local foi consolidada como unidade de estabilização candidata a baseline e está integralmente staged no momento desta atualização:

- `[x]` Dockerfile/devcontainer version sync staged;
- `[x]` canonical NCP path self-healing staged;
- `[x]` NCP 1.1.1 temporal authority para route artifact staged;
- `[x]` DNS 1.8.1 managed listener semantics staged;
- `[x]` Cloudflare response-code parsing staged;
- `[x]` requestErrors advisory semantics staged;
- `[x]` `devcontainer-shell` validator redesenhado e provado 12/12;
- `[x]` validator backend allowlist future-proof staged;
- `[x]` passive NCP refresh MCP tool staged;
- `[x]` focused resilience semantic tests verdes;
- `[x]` atomic writer passou a preservar POSIX mode em replacement;
- `[x]` Git staging governado ganhou proteção observável contra perda acidental de x-bit em scripts HEAD-executable com shebang preservado;
- `[x]` executable mode regressions reparadas fisicamente antes do staging;
- `[x]` new/untracked placement normalizado sem perda documental;
- `[x]` secret scan dos candidatos ao baseline sem matches materiais.

Esta unidade deve ser publicada e sincronizada antes de iniciar a grande migração provider-neutral das Faixas B–H.

---

# 37. Estratégia de commit/push futuro

O objetivo de manter `main`, `origin/main` e worktree totalmente sincronizados é correto, mas a sincronização deve ocorrer apenas depois dos blockers de integridade.

Fluxo recomendado:

```text
classify all files
  → normalize modes
  → normalize untracked paths/names
  → secret/generated scan
  → focused validators
  → full diff review
  → git_stage_plan(explicit paths)
  → staged diff review
  → commit plan
  → commit
  → push plan
  → push origin/main
  → verify HEAD == origin/main
  → verify worktree clean
```

O commit pode ser amplo se todas as mudanças formarem um baseline coerente, mas não deve esconder path mistakes ou chmod drift.

---

# 38. Conclusão arquitetônica

A base atual é valiosa demais para ser substituída e específica demais para permanecer como está. O caminho correto é uma **generalização interna disciplinada**.

O sistema já possui quase todas as primitives difíceis:

- bounded tools;
- atomic IO;
- locks;
- summaries;
- metrics;
- health projections;
- Cloudflare remote audit;
- provider registry concepts;
- lifecycle hooks;
- rollback;
- test infrastructure;
- Node 24 runtime;
- MCP observability.

O trabalho daqui em diante é principalmente de **semântica, autoridade, redução de duplicação e composição correta**.

O NCP ideal não responderá simplesmente “a rede está boa” ou “o Copilot está ruim”. Ele deverá ser capaz de dizer, por exemplo:

```text
substrate:dns                  healthy / observed
substrate:host-runtime         healthy / observed
provider:openai                healthy-from-container / observed
product:chatgpt                partial / observed-from-container
client:chatgpt-openai          unknown / not-observable-here
transport:mcp-cloudflare       recovered / observed + remote-control-plane
transport:mcp-local-origin     healthy / observed
openai->public-mcp             healthy / client-evidence + connector-smoke
recent tunnel failure          historical-before-recovery
confidence                     high for MCP path, unknown for client path
```

Essa granularidade é o que permitirá reduzir de fato o raro “aguardando conexão”: não apenas tentar evitar toda interrupção — impossível em sistemas distribuídos —, mas minimizar causas controláveis, acelerar recuperação, impedir falsos positivos e identificar corretamente a camada responsável quando um evento ocorrer.

---

# 39. Log desta frente

## 2026-08-18 — investigação profunda e arquitetura

- [x] retomada após reconnect;
- [x] confirmação de `main` em `64d80411d` e upstream alinhado antes desta criação;
- [x] leitura/auditoria integral das superfícies críticas já listadas;
- [x] auditoria de diffs locais;
- [x] identificação de chmod regressions;
- [x] identificação de nested `workspaces/` path;
- [x] leitura dos principais untracked;
- [x] secret-pattern scan preliminar dos untracked principais;
- [x] auditoria live do connector atual;
- [x] auditoria live Cloudflare post-change;
- [x] observação do burst de reconnect em 17:07:34Z e recuperação 4/4;
- [x] consolidação de `requestErrors` como sinal cumulativo/advisory;
- [x] incorporação dos requisitos oficiais atuais de ChatGPT/OpenAI;
- [x] definição do NCP provider-neutral;
- [x] definição do roadmap A–K com fases/subfases booleanas;
- [x] criação deste documento.

**Próximo passo arquitetonicamente permitido:** normalizar e estabilizar a worktree atual; só depois iniciar as transformações amplas das Faixas B–J.

---

# 40. Regra de manutenção deste documento

Atualizar este arquivo quando houver mudança arquitetural relevante. Cada faixa implementada deve registrar:

- arquivos alterados;
- invariant adquirido;
- compatibilidade mantida/removida;
- teste/gate executado;
- evidência live quando necessária;
- risco residual;
- próximo bloco.

Não transformar o documento em log de cada patch. Sua função é preservar **verdade arquitetônica, estado-alvo, decisões, gates e sequência de migração**.
