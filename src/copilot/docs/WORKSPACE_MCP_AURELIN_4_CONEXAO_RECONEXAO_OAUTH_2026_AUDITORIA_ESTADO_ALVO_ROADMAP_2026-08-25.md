# WORKSPACE MCP — AURELIN 4

## Auditoria profunda de conexão, reconexão, OAuth, MCP 2026, Cloudflare, schema freshness e roadmap de correção

> **Data:** 2026-08-25  
> **Workspace:** `/workspaces/chatgpt-docker-puppeteer`  
> **Branch auditada:** `main`  
> **HEAD inicial desta auditoria:** `91f2fe34f`  
> **Estado inicial:** `main == origin/main`, worktree limpa  
> **Conector exercitado:** `AURELIN 4`  
> **Endpoint permanente:** `https://mcp.aurelin.org/mcp`  
> **Escopo:** `src/copilot`, com foco em `src/copilot/mcp` e suas authorities externas imediatas.

---

# 0. Status e regra de precedência

Este documento é a autoridade especializada, a partir de 2026-08-25, para:

1. conexão e reconexão do AURELIN 4;
2. MCP 2026-07-28 versus compatibilidade 2025;
3. OAuth/CIMD/DCR, authorization code, refresh e revocation;
4. subscriptions modernas e continuidade após queda;
5. `tools/list`, cache hints, descriptor generation e freshness;
6. distinção entre MCP wire/catalog e snapshot administrativo do ChatGPT;
7. Cloudflare Tunnel/edge no caminho de conexão;
8. smokes e telemetria que alegam provar esses contratos.

Ele complementa, não apaga, a arquitetura 2.4. Quando houver conflito:

1. código e testes no `HEAD` validado vencem texto histórico;
2. documentação oficial atual de OpenAI/MCP vence inferência antiga sobre comportamento externo;
3. este documento vence roadmaps históricos somente no escopo especializado acima;
4. fatos host-real são separados de inferências e de testes in-memory.

---

# 1. Síntese executiva

## 1.1 Veredito

O **AURELIN 4 está operacional e robusto no caminho principal**, mas a auditoria encontrou uma
assimetria importante entre o runtime moderno já implantado e parte dos diagnósticos que ainda
raciocinam como MCP 2025.

O conector real demonstrou:

- MCP remoto vivo em `https://mcp.aurelin.org/mcp`;
- Cloudflare named permanent tunnel sobre QUIC;
- origin HTTP/2;
- OAuth enforcement completo;
- CIMD ChatGPT platform-wide reconhecido;
- PKCE S256;
- `private_key_jwt` para o client platform-wide;
- `offline_access` anunciado;
- refresh-token rotation/persistence;
- 131 tools;
- tráfego majoritariamente MCP 2026;
- `runtimeSourceDrift=false`;
- reconnect real depois de restart de MCP + Cloudflare, sem intervenção do usuário na UI;
- DCR dinâmico em zero no estado atual.

A principal dívida não é “o AURELIN 4 não reconecta”. A dívida é:

> **nossos smokes, nomes de métricas e parte da modelagem de convergence ainda podem declarar verde
> usando provas 2025 ou provas genéricas de MCP para fenômenos que, no ChatGPT, possuem lifecycle
> administrativo separado.**

## 1.2 Achados prioritários

| ID            | Prioridade | Estado                     | Achado                                                                                                                                                      |
| ------------- | ---------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A4-CONN-P1-01 | P1         | confirmado                 | `oauth-smoke/runtime.js` se apresenta como 2026, mas runtime checks ainda usam `initialize`, `Mcp-Session-Id`, GET SSE e `Last-Event-ID`.                   |
| A4-CONN-P1-02 | P1         | confirmado                 | `mcp_connector_smoke_refresh` pode rotular reconnect verde com prova legacy 2025, sem provar `subscriptions/listen` 2026.                                   |
| A4-CONN-P1-03 | P1         | confirmado                 | smoke CIMD emite/rotaciona refresh token e não chama `/oauth/revoke`, acumulando credenciais diagnósticas persistentes.                                     |
| A4-CONN-P1-04 | P1         | confirmado conceitualmente | `schemaConvergence` mistura observação MCP do servidor/cliente com linguagem que pode ser lida como convergência do snapshot de actions do ChatGPT.         |
| A4-CONN-P1-05 | P1         | gap de prova               | não existe smoke remoto moderno completo via `@modelcontextprotocol/client` cobrindo `server/discover -> tools/list -> tools/call -> subscriptions/listen`. |
| A4-CONN-P1-06 | P1         | gap de prova               | testes modernos provam notification/cache eviction, mas não provam queda remota da subscription seguida de re-listen governado.                             |
| A4-CONN-P2-01 | P2         | confirmado                 | após restart, nova geração fica `server-descriptor-unlisted`; isso é evidence do origin, não prova de snapshot ChatGPT stale nem erro de runtime.           |
| A4-CONN-P2-02 | P2         | evidence gate              | novo client platform-wide ainda precisa demonstrar seu primeiro `refresh_token` natural depois da expiração do access token.                                |
| A4-CONN-P2-03 | P2         | risco residual             | `/oauth/token` é limitado no edge por IP+colo; adequado agora, mas refresh storms multi-client devem permanecer observáveis.                                |
| A4-CONN-P2-04 | P2         | drift documental           | o roadmap pós-campanha contém trechos pré-K.4 com `ttlMs=0` e checkpoints posteriores corretos com `300000/private`.                                        |
| A4-CONN-P2-05 | P2         | gap de modelo              | telemetry de continuidade atual (`stream-open`/`stream-resume`) representa melhor 2025 do que subscriptions 2026.                                           |
| A4-CONN-P3-01 | P3         | residual                   | Cloudflare possui produtos parcialmente não auditáveis por API; não há evidência atual de interferência.                                                    |

---

# 2. Evidência host-real do AURELIN 4

## 2.1 Geração inicial

No início desta auditoria:

```text
branch = main
HEAD = 91f2fe34f
origin/main = 91f2fe34f
worktree = clean
runtimeSourceDrift = false
canonical tools = 131
```

O SDK MCP instalado é:

```text
@modelcontextprotocol/client 2.0.0
@modelcontextprotocol/node   2.0.0
@modelcontextprotocol/server 2.0.0
```

O `npm-check-updates` atual não reportou upgrade desses três pacotes.

## 2.2 Restart controlado em uso

Durante esta própria conversa foi executado restart completo do MCP + Cloudflare permanente.

Depois do restart, sem reconectar manualmente o app na UI:

- o mesmo AURELIN 4 voltou a responder;
- a primeira chamada foi autorizada;
- o processo novo estava no mesmo HEAD publicado;
- `runtimeSourceDrift=false`;
- Cloudflare retornou sobre QUIC;
- não houve orphan de sessão stateful;
- chamadas subsequentes permaneceram funcionais.

### Conclusão correta

Isso prova:

- **origin/tunnel reconnect para tool calls: SIM**;
- **continuidade de access token através do restart: SIM**;
- **necessidade de UI reauth após restart: NÃO observada**.

Isso não prova, sozinho:

- refresh token do novo client após expiração;
- continuidade de uma `subscriptions/listen` aberta antes da morte do processo;
- re-listen automático do ChatGPT;
- atualização automática do snapshot administrativo de tools do ChatGPT.

## 2.3 OAuth histórico e novo client

A telemetria persistida contém sucessivos grants `refresh_token` CIMD/ChatGPT em clientes
anteriores, demonstrando que o issuer consegue manter conectividade ao longo do tempo.

O novo client platform-wide:

```text
https://chatgpt.com/oauth/client.json
```

foi autorizado com sucesso no novo fluxo. Seu primeiro refresh natural permanece um gate separado
porque o access token dura uma hora.

---

# 3. Contratos oficiais atuais

## 3.1 MCP 2026-07-28

Fontes primárias:

- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- documentação TypeScript SDK v2 em `https://ts.sdk.modelcontextprotocol.io/v2/`

Pontos normativos/arquiteturais relevantes:

1. core stateless;
2. `initialize`/session handshake deixa de ser o caminho moderno;
3. requests são self-describing;
4. `server/discover` é discovery opcional/canônico;
5. `Mcp-Method` e `Mcp-Name` permitem roteamento por header;
6. list results recebem `ttlMs`/`cacheScope`;
7. DCR entra em trajetória de depreciação em favor de Client ID Metadata Documents;
8. server notifications modernas dependem de subscription explícita;
9. a queda da subscription não deve ser confundida com replay SSE legacy.

## 3.2 OpenAI/ChatGPT

Fonte primária atual:

- https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt

Fatos especialmente relevantes:

- atualizações no MCP server **não são automaticamente habilitadas** no app aprovado;
- ChatGPT usa snapshot aprovado/congelado das actions/tools;
- admins podem usar **Refresh** para puxar novas actions ou mudanças em definitions;
- novas actions chegam desabilitadas por default em fluxos administrados;
- mudanças incompatíveis com o snapshot podem fazer tool calls falharem;
- em modalidades sem update de app publicado, recriação/republicação pode ser necessária.

### Consequência arquitetural

`notifications/tools/list_changed` e `ttlMs` são contratos do MCP/client cache. Eles **não
substituem** o lifecycle administrativo do ChatGPT.

---

# 4. A4-CONN-P1-01 — smoke autodeclarado 2026 executa state machine 2025

O cabeçalho de `src/copilot/mcp/diagnostics/oauth-smoke/runtime.js` diz explicitamente que a versão
1.4.0 foca MCP 2026-07-28.

Porém o runtime check atual faz:

```text
POST initialize
-> exige Mcp-Session-Id
-> POST notifications/initialized
-> tools/call ou tools/list session-bound
-> GET text/event-stream
-> Last-Event-ID
-> reconnect GET
-> DELETE session
```

A constante importada pelo arquivo é `MCP_PROTOCOL_LEGACY_DEFAULT_VERSION`.

## Prova causal

Ao forçar o smoke remoto a 2026-07-28:

- discovery OAuth/CIMD continuou verde;
- os runtime checks falharam em `missing Mcp-Session-Id after initialize`.

Isso não indica falha do servidor 2026. Indica que o cliente diagnóstico pediu um lifecycle removido
da revisão moderna.

## Estado-alvo

O smoke deve possuir dois engines explicitamente separados:

### modern-2026

Usar `Client` + `StreamableHTTPClientTransport` oficiais, com protocol pin 2026-07-28 e auth fetch
explícito.

Cobrir:

- connect/discover;
- `tools/list`;
- `tools/call mcp_runtime_health`;
- subscription opt-in;
- fechamento limpo;
- métricas de requests/methods;
- sem `Mcp-Session-Id`.

### legacy-2025

Preservar o engine stateful somente como compatibility smoke explícito:

- initialize;
- session id;
- notifications/initialized;
- SSE;
- Last-Event-ID;
- replay/resume;
- delete session.

Nunca mais retornar um único campo “SSE reconnect” como prova universal de reconnect.

---

# 5. A4-CONN-P1-03 — refresh-token hygiene do smoke

O issuer anuncia e implementa:

```text
revocation_endpoint = /oauth/revoke
```

O smoke, entretanto, não contém chamada de revoke.

A auditoria host-real encontrou, no store persistente:

```text
active refresh records = 49
  chatgpt historical handle CIMD = 26
  internal CIMD smoke            = 22
  ChatGPT platform CIMD          = 1

consumed refresh hashes = 323
  historical ChatGPT = 134
  historical DCR     = 44
  internal smoke     = 145
```

Dois smokes adicionais aumentaram os refresh records ativos em dois, provando causalidade.

## Estado-alvo

Todo smoke que obtiver refresh token deve possuir `finally` de higiene:

1. testar refresh rotation;
2. revogar a família/refresh token relevante;
3. validar resposta da revocation endpoint;
4. nunca imprimir token;
5. registrar somente resultado sanitizado;
6. cleanup não pode esconder a falha primária do smoke;
7. teste deve provar que repeated smoke não cresce indefinidamente o store.

DCR compatibility smoke deve aplicar a mesma regra quando explicitamente habilitado.

---

# 6. Reconexão moderna versus legacy

## 6.1 Cinco fenômenos distintos

A palavra “reconnect” fica proibida como métrica sem qualificador. O sistema deve distinguir:

1. **originReconnect** — uma nova request chega ao novo processo depois de restart;
2. **oauthContinuity** — o caller continua autorizado ou obtém novo access token;
3. **legacyStreamResume** — GET SSE + Last-Event-ID 2025;
4. **modernSubscriptionContinuity** — `subscriptions/listen`, remote close e re-listen;
5. **hostActionSnapshotRefresh** — ChatGPT atualiza o snapshot administrativo de actions.

## 6.2 Testes atuais

`test_mcp_cache_hints.spec.js` prova corretamente:

```text
server/discover
subscriptions/listen
tools/list
cache hit
notify.toolsChanged()
cache eviction
tools/list novamente
```

Esse teste é valioso, mas não cobre remote drop + re-listen.

## 6.3 Telemetria host-real

Na janela observada durante a auditoria:

```text
subscriptions-listen = 0
```

Isso não é bug por si só, pois subscription é opt-in. Significa apenas que não há evidence para
declarar continuidade de subscription do ChatGPT.

---

# 7. Schema/catalog convergence: decomposição necessária

O módulo atual `protocol/catalog/convergence.js` possui estados:

- `uninitialized`;
- `server-descriptor-unlisted`;
- `converged-observed`;
- `server-changed-client-unverified`;
- `notification-sent-awaiting-refresh`.

Ele mede corretamente fatos do origin, mas a expressão “schema convergence” é ampla demais quando o
consumer é ChatGPT.

## 7.1 Estado-alvo em três planos

### Plano A — descriptor observation

Fatos locais:

- descriptor fingerprint;
- tool count;
- generation/epoch;
- listChanged capability.

### Plano B — MCP client/catalog observation

Fatos observáveis no origin:

- `server/discover` observado;
- `tools/list` observado;
- protocol version;
- subscription observada;
- notification sent;
- generic client cache eviction em testes controlados.

### Plano C — ChatGPT action snapshot

Estado **externo** e não inferível pelo servidor:

- unknown;
- operator-reported refreshed;
- causally verified by changed-definition call.

O origin não deve declarar `ChatGPT snapshot converged` apenas porque recebeu `tools/list`.

## 7.2 Compatibilidade de API

A remodelagem deve preservar campos necessários aos callers atuais, mas pode:

- renomear o conceito interno para `descriptorConvergence`;
- adicionar `scope: 'origin-observation'`;
- adicionar advertência explícita `chatgptActionSnapshot: 'not-observable-from-origin'`;
- evitar criar fake host state.

---

# 8. Cloudflare e rate limiting

## 8.1 Estado atual

A auditoria encontrou:

- cache bypass das rotas dinâmicas;
- nenhum WAF/challenge bloqueando `/mcp`;
- passthrough config host-scoped;
- BIC/rocket loader/email obfuscation neutralizados nas rotas relevantes;
- nenhum sensitive-header transform;
- `/oauth/token` protegido no edge;
- authenticated `/mcp` sem rate-limit estreito no edge;
- anonymous `/mcp` mitigado no origin.

## 8.2 Rate limits

Edge OAuth:

```text
20 requests / 10 s
characteristics = cf.colo.id + ip.src
```

Issuer:

```text
/oauth/token = 60/min
```

Não houve blocker durante o restart real. Alteração agora seria prematura.

## 8.3 Estado-alvo

- manter política atual;
- criar evidência sanitizada de 429 por endpoint/classe;
- só reconfigurar após refresh-storm real ou benchmark específico;
- nunca introduzir interactive challenge em `/mcp` ou `/oauth/token`.

---

# 9. Compatibilidade 2025/DCR

A telemetria da geração real mostra que MCP 2026 domina, mas há histórico 2025/DCR e a janela de
retirement do roadmap 2.4 ainda não atingiu os critérios necessários.

A auditoria nova reforça uma regra:

> **smokes internos não podem fabricar uso da surface cuja aposentadoria está sendo medida.**

Portanto:

- DCR permanece opt-in;
- legacy protocol smoke permanece opt-in ou claramente classificado;
- retirement analytics devem poder excluir traffic class `diagnostic` ou garantir que o canonical
  smoke não contamine o contador de consumer demand;
- remoção continua bloqueada pelo gate temporal/evidence policy já definido.

---

# 10. Dependency audit

Em 2026-08-25, `npm-check-updates --target latest` reportou 14 upgrades gerais:

- `@types/node 26.2 -> 26.3`;
- `apache-arrow 18.1 -> 21.2` (**major**);
- `chrome-devtools-mcp 1.7 -> 1.8`;
- `eslint 10.8 -> 10.9`;
- `eslint-plugin-jsonc 3.4.1 -> 3.4.2`;
- `jose 6.2.9 -> 6.2.10`;
- `js-yaml 5.3 -> 5.4`;
- `mermaid 11.17.0 -> 11.17.2`;
- `npm-check-updates 23.0 -> 23.1`;
- `pm2 7.0.3 -> 7.0.4`;
- `puppeteer 25.8 -> 25.9`;
- `puppeteer-core 25.8 -> 25.9`;
- `typescript-eslint 8.67 -> 8.68`;
- `user-agents 2.1.157 -> 2.1.163`.

Os três packages MCP v2 não aparecem como outdated.

### Política

Não misturar major não causal com a correção do connector. Upgrades seguros serão feitos em uma onda
isolada; `apache-arrow` major exige validação/decisão própria.

---

# 11. Estado ideal

A conexão ideal do AURELIN 4 possui as seguintes propriedades:

1. um único endpoint permanente;
2. origin/tunnel reiniciáveis sem intervenção da UI enquanto credencial for válida;
3. OAuth client identity via CIMD platform-wide;
4. refresh automático provado e observável sem secrets;
5. revocation e cleanup corretos;
6. smoke moderno implementado pelo client SDK oficial;
7. legacy smoke explicitamente separado;
8. subscriptions modernas testadas como lifecycle próprio;
9. nenhuma alegação de replay legacy usada para provar subscription 2026;
10. descriptor cache fingerprinted e privado;
11. observabilidade de origin separada do snapshot administrativo do ChatGPT;
12. action refresh/review documentado como boundary externa;
13. Cloudflare não altera framing/auth headers;
14. 429/5xx/reconnect failures correlacionáveis;
15. compatibility retirement não contaminado por diagnostics;
16. docs sem truth epochs contraditórios;
17. testes focais rápidos para cada contrato;
18. barrier completo antes de commit/push/reload.

---

# 12. Roadmap executável

## Faixa A — consolidar authority documental e baseline

- [x] criar este documento canônico;
- [x] registrar prova de restart/reconnect AURELIN 4;
- [x] registrar fontes oficiais atuais;
- [x] registrar dependency baseline;
- [x] adicionar este documento ao `docs/INDEX.md`;
- [x] remover/retificar truth statements superseded sobre `ttlMs=0` no roadmap pós-campanha.

**Gate A:** existe uma única narrativa atual para conexão/reconexão.

## Faixa B — modernizar o canonical OAuth/MCP smoke

- [x] separar runtime checks em `modern-2026` e `legacy-2025`;
- [x] usar `@modelcontextprotocol/client` no engine moderno;
- [x] pin explícito de `2026-07-28` no modern smoke;
- [x] `server/discover` real via SDK;
- [x] `tools/list` real via SDK;
- [x] `tools/call mcp_runtime_health` real via SDK;
- [x] remover qualquer exigência de `Mcp-Session-Id` do modern path;
- [x] preservar legacy stateful/SSE como compatibility engine estreito;
- [x] output separar `modernRuntime`, `legacyCompatibility` e OAuth;
- [x] default canonical smoke deve ser 2026; legacy deve ser opt-in/evidence-driven;
- [x] focused unit tests cobrindo os dois engines;
- [ ] remote live smoke 2026 verde.

**Gate B:** `mcp_connector_smoke_refresh` não pode dizer “2026/reconnect verde” usando uma
prova 2025.

## Faixa C — OAuth credential hygiene

- [x] implementar helper de revocation no smoke;
- [x] revogar refresh family CIMD em `finally`;
- [x] aplicar cleanup equivalente ao DCR smoke opt-in;
- [x] cleanup failure não pode mascarar primary failure;
- [x] resultado de cleanup deve ser sanitizado;
- [x] teste unitário de repeated smoke sem crescimento de **credenciais ativas** no refresh store;
      tombstones de revogação permanecem somente como evidence anti-replay com TTL de 30 dias;
- [x] ferramenta/diagnóstico diferenciar consumer credentials de diagnostic credentials quando
      possível sem persistir identidade sensível;
- [x] limpar resíduos do smoke criados durante esta auditoria, preservando credenciais reais — dois
      smokes CIMD completos consecutivos retornam `tokenCount`/`tokens[]` ao baseline zero após
      refresh + revoke; permanecem apenas tombstones bounded anti-replay, não credenciais ativas.

**Gate C:** executar smoke repetidamente não aumenta indefinidamente o store persistente.

## Faixa D — reconnection semantics e telemetria 2026

- [x] substituir linguagem genérica `reconnect` por classes explícitas;
- [x] manter `legacyStreamResume` separado;
- [x] adicionar `modernSubscriptionOpen`/`modernSubscriptionClosed`/`modernRelisten` quando
      observáveis;
- [x] não mapear `Last-Event-ID` para continuidade 2026;
- [x] atualizar aggregate compatibility sem secrets;
- [x] regression de enum/privacy;
- [x] atualizar `mcp_oauth_friction_audit`/readiness se dependerem dos antigos nomes — auditoria de
      consumers confirmou que não havia dependência textual dos enums antigos; retirement foi
      atualizado para o novo aggregate v2.

**Gate D:** uma métrica nunca mistura replay 2025 e subscription 2026.

## Faixa E — subscriptions modernas e failure recovery

- [x] teste in-memory de remote subscription termination;
- [x] provar comportamento do SDK quando subscription fecha remotamente;
- [x] implementar/recomendar re-listen apenas onde o owner do client controla esse lifecycle;
- [ ] modern smoke remoto abrir `subscriptions/listen` de maneira bounded;
- [x] fechar/cancelar subscription de forma determinística;
- [x] provar ausência de orphan/stream leak;
- [x] não afirmar que ChatGPT fará re-listen se não houver evidence host-real.

**Gate E:** lifecycle moderno está testado sem importar semântica legacy.

## Faixa F — descriptor convergence versus ChatGPT snapshot

- [x] renomear/documentar o estado atual como origin descriptor observation;
- [x] adicionar `scope` explícito ao estado retornado;
- [x] tornar `chatgptActionSnapshot` explicitamente não observável pelo origin;
- [x] atualizar runtime health/tools status;
- [x] atualizar host block diagnostics para recomendar Refresh/admin review quando causalmente
      adequado;
- [x] regression para evitar inferência `tools/list observed => ChatGPT snapshot converged`;
- [x] documentar procedimento A->B de descriptor change e Refresh;
- [ ] executar teste host-real de mudança incompatível somente em barrier controlada e reversível.

**Gate F:** servidor não afirma conhecer estado administrativo do ChatGPT que não consegue observar.

## Faixa G — Cloudflare e OAuth resilience

- [x] adicionar/confirmar contadores sanitizados de 429 por classe de endpoint;
- [x] correlacionar refresh failures com edge/origin sem armazenar token/IP bruto;
- [x] manter cache bypass/passthrough invariants;
- [x] manter rate limit atual salvo evidence contrária;
- [x] fault test de 429/transient retry no smoke;
- [ ] fault test de tunnel restart durante modern requests;
- [ ] post-change gates verdes.

**Gate G:** edge failures são distinguíveis de OAuth/MCP failures.

## Faixa H — compatibility retirement hygiene

- [x] garantir que canonical smoke não gere uso DCR por default;
- [x] classificar/excluir diagnostics de retirement evidence quando necessário;
- [x] preservar gate 7d/100 requests;
- [x] ChatGPT real continua required host;
- [ ] decidir se Claude ainda é consumer suportado;
- [x] não remover 2025/DCR antes de zero-use qualificado;
- [ ] após gate futuro, remover compat/stores/config/tests órfãos em uma única campanha sem shims.

**Gate H:** compat existe apenas por consumer evidence, não por tráfego fabricado pelo próprio
diagnóstico.

### Checkpoint local B-H/J — 2026-08-25

O canonical smoke foi decomposto por era. O path moderno usa o `Client` e o
`StreamableHTTPClientTransport` oficiais, pin `2026-07-28`, executa `server/discover`, abre
`subscriptions/listen`, faz `tools/list` e `tools/call mcp_runtime_health` sem `initialize` nem
`Mcp-Session-Id`; a máquina stateful/SSE antiga ficou somente em compatibility 2025 opt-in. A
subscription do smoke é fechada deterministicamente e uma regression real do SDK prova
`remote close -> closed='remote' -> explicit listen() -> close -> closed='local'`, sem auto-relisten
inventado.

OAuth smoke agora executa refresh + revocation da family CIMD/DCR/private-key-jwt e reporta cleanup
separadamente do resultado primário. Compatibility evidence v2 separa
`legacy-stream-open|legacy-stream-resume|modern-subscription-open` e adiciona somente o enum
`actorClass=consumer|diagnostic|unknown`; eventos v1 continuam legíveis, mas recebem `unknown` em
vez de reclassificação retroativa. DCR retirement ignora apenas evidence nova inequivocamente
`diagnostic`; `unknown` permanece fail-safe como demanda externa.

O antigo `schemaConvergence` foi removido da API live sem shim semântico. O owner agora publica
`descriptorObservation` v2, scope `origin-mcp-descriptor-observation`, e declara
`chatgptActionSnapshot.observableFromOrigin=false`. Host-block diagnostics recomenda o fluxo
administrativo `Refresh/review` quando plausível e deixa explícito que reconnect/tools-list não
provam atualização do snapshot aprovado pelo ChatGPT.

Observabilidade HTTP ganhou `byStatusClass` e `rateLimitedByRoute`, sem URL/IP/header. A retry
policy do OAuth smoke virou leaf testável e prova 429 transient -> retry -> sucesso. Validações
causais até este checkpoint: modern subscription lifecycle **2/2** (~0,45 s de tests), D/H **33/33**
(~11 s, dominado por process-host real), TS7 strict ~**3,2 s**, F **66/66** (~9,9 s) e G **9/9**
(~1,1 s de Vitest/~2,4 s wall). Suites amplas permanecem reservadas ao barrier de publicação.

## Faixa I — dependency upgrades isolados

- [x] reauditar outdated depois dos fixes MCP — após o lote, apenas `apache-arrow 18.1.0 -> 21.2.0`
      permanece e está bloqueado pelo peer contract do LanceDB;
- [x] aplicar upgrades patch/minor compatíveis em lote controlado — 13 upgrades patch/minor
      aplicados, lock resolvido com npm 12.0.2;
- [x] validar `jose`, eslint/types, Puppeteer e chrome-devtools-mcp — install/import/CLI e gates de
      código no barrier; browser launch live ficou separado porque o próprio Chromium 148 local
      trava antes do CDP e o Chrome externo não estava ativo;
- [x] tratar `apache-arrow 18 -> 21` separadamente como major — auditado e **não aplicado**:
      `@lancedb/lancedb@0.37.1` exige peer `apache-arrow >=15 <=18.1.0`; atualizar para 21.2
      quebraria o contrato do LanceDB atual;
- [x] lockfile/install/native smoke — `npm install` verde, nenhum install script não revisado,
      `better-sqlite3`/`node-pty`/LanceDB 3/3;
- [x] strict/lint/tests pertinentes — barrier único fechado: TS7 strict, lint, arquitetura/custo,
      format/diff e suíte MCP ampla verdes;
- [x] não alterar MCP v2 sem versão upstream realmente nova —
      `@modelcontextprotocol/{client,node,server}` 2.0.0 não apareceu como outdated;

**Gate I:** dependency maintenance não contamina causalidade dos fixes de conexão.

**Checkpoint I local — 2026-08-25:** `npm install-scripts ls` reporta zero scripts não revisados. A
policy `allowScripts` foi ratcheted de `puppeteer@25.8.0` para `25.9.0` e `.puppeteerrc.cjs` agora
torna `skipDownload: true` explícito, coerente com o Dockerfile que já instala `/usr/bin/chromium` e
com o modo principal `wsEndpoint`/Chrome externo. Isso evita baixar Chrome for Testing duplicado
durante install. O fallback `/usr/bin/chromium` 148 foi exercitado independentemente de Puppeteer e
trava antes de abrir CDP em quatro variantes de bootstrap; portanto o achado é do
Chromium/DevContainer local, não uma regressão demonstrada de Puppeteer 25.9. O Chrome externo
9224/9225 não estava ativo neste checkpoint, logo esse live gate de browser permanece fora da
certificação MCP.

## Faixa J — documentação e runbooks

- [x] atualizar MCP README;
- [x] atualizar connector runbook;
- [x] atualizar docs index;
- [x] reconciliar roadmap 2.4 histórico com este authority especializado;
- [x] documentar cinco significados distintos de reconnect;
- [x] documentar Refresh administrativo do ChatGPT;
- [x] remover afirmações live contraditórias; registros Quick Tunnel/`none-dev` antigos permanecem
      somente sob seção explicitamente histórica/superada.

**Gate J:** operador consegue diagnosticar connection failure sem confundir OAuth, origin,
subscription, legacy replay e action snapshot.

## Faixa K — validação, publicação e promoção

- [x] focused tests por onda;
- [x] TS7 strict;
- [x] lint;
- [x] architecture/state/config/public-cost/purity gates;
- [x] `git diff --check`;
- [x] Prettier/format;
- [x] MCP unit suite ampla — **102/102 files, 586/586 tests**, exit 0, ~34 s;
- [x] integration/regression pertinentes — process-host/OAuth/subscription/compact-health
      regressions incluídas nos barriers focais e na suíte ampla;
- [x] dependency/native smoke se Faixa I aplicada — `better-sqlite3`/`node-pty`/LanceDB **3/3**;
- [x] revisar e atualizar todos os checkboxes deste documento;
- [ ] commit coeso;
- [ ] push sem force;
- [ ] `main == origin/main`;
- [ ] reload controlado MCP + Cloudflare;
- [ ] runtime generation == HEAD publicado;
- [ ] modern canonical remote smoke verde;
- [ ] OAuth continuity após reload;
- [ ] primeiro refresh natural do AURELIN 4 platform CIMD observado, quando temporalmente
      disponível;
- [ ] Cloudflare gates verdes;
- [ ] worktree limpa ao final.

**Checkpoint K source barrier — 2026-08-25:** após os últimos fixes de projeção, o barrier final
fechou sem relaxar budgets nem rebaselinear arquitetura: TS7 strict verde; lint verde;
`copilot:architecture:check` verde com **68 owners / 49 protected boundaries**, state **25 files /
52 declarations**, env **38 files / 61 refs**, grafo **2.261 arquivos / 6.109 edges / 0 ciclos**,
public-cost/import-purity/cold-import sem violações; `git diff --check` e Prettier verdes. A suíte
MCP canônica final passou **102/102 arquivos e 586/586 testes**. O hotspot
`diagnostics/oauth-smoke/runtime.js` foi decomposto em um leaf puro `report.js` e caiu para **90.881
bytes**, preservando o tier `standard` sem aumentar o teto. `mcp_runtime_health` compacto voltou a
respeitar `< 6 KiB` sem perder detalhe: a explicação completa de descriptor observation permanece em
`includeDetails=true`. Este checkpoint autoriza publicação do source; nenhuma alegação host-real da
nova geração é feita antes do reload correspondente.

**Gate K:** source, testes, documentação, runtime, connector e upstream contam a mesma história.

---

# 13. Critérios de commit/push

Commit/push só é permitido quando:

1. a onda técnica está coerente e sem shims provisórios;
2. testes focais causais estão verdes;
3. TS7 strict está verde;
4. lint/format/diff-check estão verdes;
5. architecture/owner/state/config/import-purity permanecem verdes;
6. o documento foi atualizado com o estado real;
7. mudanças host-real não são alegadas antes do reload correspondente.

A publicação não precisa esperar gates externos impossíveis de produzir localmente, como uma janela
de 7 dias de zero-use ou ação administrativa manual no ChatGPT. Esses permanecem checkboxes
explicitamente externos.

---

# 14. Definition of Done especializada

A campanha AURELIN 4 de conexão/reconexão está tecnicamente concluída quando:

- [x] canonical smoke usa MCP 2026 real por default;
- [x] legacy smoke é separado e evidence-driven;
- [x] nenhum modern check exige session id;
- [x] refresh-token hygiene é bounded e testada;
- [x] subscriptions modernas têm lifecycle/failure tests;
- [x] reconnect telemetry é semanticamente separada;
- [x] origin descriptor state não se apresenta como ChatGPT admin snapshot;
- [x] Cloudflare failures são causalmente classificáveis;
- [x] compatibility retirement não é contaminado por diagnostics;
- [x] docs live não possuem truth epochs contraditórios;
- [x] dependency maintenance segura foi avaliada separadamente;
- [x] strict/lint/architecture/unit/integration/regression pertinentes estão verdes;
- [ ] commit/push/reload fechados;
- [ ] runtime publicado é exatamente o HEAD validado;
- [ ] AURELIN 4 continua operando após restart sem intervenção UI quando OAuth ainda é válido;
- [ ] refresh token platform-wide é observado naturalmente ou permanece explicitamente como evidence
      gate temporal;
- [x] gates externos futuros permanecem documentados sem bloquear falsamente o release source.

---

# 15. Próxima ação imediata

As Faixas B–J foram implementadas e o source barrier de K está verde. A próxima ação imediata é
**publicar exatamente este worktree validado e promover a mesma geração**. A ordem executada foi:

```text
B modern smoke [feito]
-> C revoke/cleanup [feito]
-> D telemetry semantics [feito]
-> E subscriptions recovery local [feito; remote bounded ainda host gate]
-> F ChatGPT snapshot boundary [feito; incompat change host gate permanece]
-> G edge resilience local [feito; restart/post-change no promotion]
-> H retirement hygiene [feito; gates temporais permanecem]
-> I dependency maintenance [feito]
-> J docs [feito]
-> K source barrier [verde] -> commit/push -> reload -> host-real gates
```

A partir daqui, não repetir a suíte ampla por mudanças exclusivamente de ledger. O próximo gate é
causalmente de publicação/promoção: commit/push do worktree certificado, reload controlado e então
modern remote smoke, OAuth continuity e Cloudflare post-change sobre o HEAD publicado.
