# WORKSPACE — LLM-B / MCP `TaskGroup` / Live Readiness

## Auditoria profunda, análise causal, estado atual, estado-alvo e roadmap de correção

> **Data:** 2026-08-26  
> **Workspace:** `/workspaces/chatgpt-docker-puppeteer`  
> **Branch:** `main`  
> **HEAD auditado:** `5d5e0648ba7b461685bba27a70cd6ffc0504b0df`  
> **Estado inicial desta auditoria:** `main == origin/main`, worktree limpa, AURELIN 4 reconectado  
> **Escopo principal:** `src/copilot/model-gateway`, `src/copilot/mcp/integrations/model-gateway`,
> `src/copilot/mcp/tools/llm-b-live.js`, cancellation/registry, SQLite, workers de redaction e
> boundary host↔MCP  
> **Regra desta fase:** investigação primeiro; nenhuma correção de source foi aplicada antes da
> criação deste documento.  
> **Reauditoria de continuidade:** 2026-08-26, após as implementações locais das Faixas B/C/E;
> nenhuma transformação adicional de source foi feita nesta rodada.  
> **Estado de promoção:** o processo MCP conectado ainda executa o source anterior ao worktree; não
> houve reload/reconnect, commit ou push nesta reauditoria.  
> **SQLite real:** `data/copilot.sqlite` permaneceu somente-leitura nesta rodada e continua em Model
> Gateway schema `user_version=13`; schema v14 e retention foram exercitados apenas em cópias
> consistentes fora do repo.  
> **Leitura temporal:** as Seções 1–13 registram principalmente o baseline causal que originou a
> campanha. A matriz, o roadmap e a Seção 21 registram o estado corrente do worktree após a
> reauditoria e prevalecem quando houver diferença temporal.

---

# 0. Status e precedência

Este documento passa a ser a autoridade especializada para o incidente recorrente em que chamadas
relacionadas a `llmb_live_readiness` são seguidas por erro visível no host do tipo:

```text
ExceptionGroup: unhandled errors in a TaskGroup
```

Ele não substitui a Arquitetura 2.4 nem o roadmap de conexão AURELIN 4. Ele os complementa no
boundary específico:

```text
ChatGPT host/session
    -> MCP wire/tool lifecycle
        -> llmb_live_readiness
            -> MCP Model Gateway integration/cache
                -> canonical Model Gateway readiness
                    -> SQLite/catalog/health
                    -> redaction workers
                    -> selectors / terminal readiness
```

Ordem de autoridade neste escopo:

1. código/testes/evidência runtime no `HEAD`;
2. este documento especializado;
3. roadmap MCP 2.4 e README Model Gateway/MCP;
4. roadmaps históricos de LLM-B/Model Gateway como evidência temporal.

---

# 1. Veredito executivo

## 1.1 Conclusão principal

O incidente **não é um problema genérico da LLM-B nem uma falha demonstrada dos providers/modelos**.
O defeito central está no **control plane de readiness exposto por MCP**.

A auditoria encontrou uma combinação de problemas que se reforçam:

1. **`llmb_live_readiness` declara-se `cancellable`, mas não é realmente cancelável em
   profundidade.** O `AbortSignal` chega a `executeModelGatewayLiveReadiness()`, porém é consultado
   somente antes de `buildModelGatewayLiveReadiness()`. O signal não é passado ao builder, aos
   redaction workers, às leituras SQLite, aos snapshots ou aos selector audits.
2. O audit persistido comprova duas falhas recentes nas quais o caller cancelou, mas o handler não
   drenou em 15 s e continuou ativo por muitos minutos.
3. Cada fresh readiness executa **dois full redaction audits** de grande escala e cria/reutiliza
   workers persistentes dentro do próprio processo MCP.
4. Esses workers não têm idle TTL, idle reaper, memory budget, `resourceLimits`, heap telemetry ou
   terminação após sucesso.
5. A execução MCP atual pode atingir **~1,56 GiB de RSS high-water** e permanecer em ~**831 MiB
   RSS** depois da readiness.
6. O mesmo readiness canônico, quando executado pelo CLI em processo isolado, fecha em ~**8 s**;
   pela tool MCP observamos execução fresh de ~**39 s** no service e ~**75,9 s** end-to-end no
   registry. Portanto o custo não é intrínseco à lógica de seleção do Model Gateway.
7. A retenção SQLite definida em policy não é aplicada automaticamente. As tabelas de runtime health
   já excedem os próprios limites operacionais configurados.
8. A resposta wire duplica o objeto em `structuredContent` e JSON pretty-text. O overhead medido é
   ~30 KiB por resposta; é dívida real, mas **não é causa principal** deste incidente.
9. Existe ainda uma diferença de ~36 s entre o timing interno do adapter e o tempo observado pelo
   registry. O fingerprint SQL isolado custa apenas ~30 ms; logo há latência não instrumentada que
   precisa ser explicitamente decomposta antes de qualquer conclusão adicional.

### Classificação causal

**Root cause P0 confirmado:** cancellation contract falso / abort não propagado ao trabalho real.

**Amplificadores P1 fortemente sustentados:** full scans síncronos no wire path, workers
persistentes sem lifecycle/memory budget e pressão de CPU/memória dentro do processo MCP.

**Gap P1 confirmado:** retenção SQLite apenas declarada, não aplicada automaticamente.

**Boundary externo ainda não demonstrado internamente:** o texto `TaskGroup` é produzido pelo
host/session fora do processo MCP. O origin não registra `ExceptionGroup`; registra, porém, o evento
causal imediatamente anterior: caller cancellation seguido de failure-to-drain. Assim, o documento
não atribui implementação interna específica ao ChatGPT que não podemos observar.

---

# 2. Linha do tempo factual do incidente

## 2.1 Ocorrência imediatamente anterior a esta auditoria

Após a promoção do AURELIN 4 MCP 2026 em `5d5e0648b`:

- runtime novo estava vivo;
- `runtimeSourceDrift=false`;
- connector smoke MCP `2026-07-28` passou;
- 131/131 tools bateram com o registry;
- OAuth/CIMD e subscription moderna passaram;
- Cloudflare QUIC/HA passou.

Em seguida, chamadas `llmb_live_readiness` começaram a retornar `TaskGroup` no host. Após duas
chamadas, até tools curtas passaram a herdar o erro até restart/reconnect do connector.

Isso já excluía como causas primárias:

- indisponibilidade geral do origin;
- mismatch do registry;
- falha básica de OAuth;
- Cloudflare tunnel down;
- source/runtime drift.

## 2.2 Reprodução após restart/reconnect em 2026-08-26

Depois do restart/reconnect solicitado pelo usuário:

- `mcp_runtime_health`: verde para source/runtime;
- HEAD `5d5e0648b`;
- worktree limpa;
- tunnel named-permanent QUIC;
- nova `llmb_live_readiness(includeSqliteRuntimeHealth=true)` **completou**.

A chamada provou que o Model Gateway em si estava ready:

- runtime selector: 7/7 routes;
- terminal selector: 3/3 routes;
- blockers: 0;
- environment ready;
- redaction leaks: 0.

Porém o custo foi anormalmente alto, fornecendo uma reprodução segura do caminho problemático sem
precisar forçar outra falha do host.

---

# 3. Evidência histórica persistida — o bug é recorrente

O arquivo:

```text
src/copilot/.ai/audit/mcp-tool-calls.jsonl
```

foi lido por streaming, selecionando apenas eventos de `llmb_live_readiness`.

## 3.1 Histórico de latência

A tool já apresentou três regimes ao longo do tempo:

| Data / exemplo               | Registry duration | Interpretação                                   |
| ---------------------------- | ----------------: | ----------------------------------------------- |
| 2026-08-15, várias execuções |        ~7,1–8,8 s | regime historicamente saudável após otimizações |
| 2026-08-14                   |           ~16,3 s | regime anterior ainda caro                      |
| 2026-08-17                   |    **551.465 ms** | hang/extrema degradação histórica               |
| 2026-08-22                   |    **555.448 ms** | hang/extrema degradação histórica               |
| 2026-08-23                   |    **395.085 ms** | hang/extrema degradação histórica               |
| 2026-08-25                   |  **1.062.538 ms** | caller cancellation + failure-to-drain          |
| 2026-08-25 posterior         |         55.888 ms | completa, mas muito degradada                   |
| 2026-08-25 nova geração      |          8.243 ms | regime saudável ainda possível                  |
| 2026-08-26                   |    **963.058 ms** | caller cancellation + failure-to-drain          |
| 2026-08-26 pós-reconnect     |     **75.875 ms** | completa, porém muito degradada                 |

A recorrência precede a última campanha AURELIN 4. Portanto o bug não deve ser tratado como
regressão introduzida exclusivamente por `559159a5b`/`5d5e0648b`.

## 3.2 Prova direta de cancellation quebrada

Dois eventos recentes registrados pelo próprio origin:

```text
2026-08-25T17:12:44Z start
2026-08-25T17:30:26Z failed
~1.062.538 ms
Cancellable MCP tool llmb_live_readiness did not drain within 15000ms after caller cancellation.
```

```text
2026-08-26T02:41:36Z start
2026-08-26T02:57:39Z failed
~963.058 ms
Cancellable MCP tool llmb_live_readiness did not drain within 15000ms after caller cancellation.
```

Essa é a evidência causal mais importante de toda a auditoria.

O registry faz corretamente:

```text
caller abort
-> Promise.race(handlerOutcome, aborted)
-> para tools cancellable, aguarda drainTimeoutMs
-> se handler não drena, emite MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT
```

O problema está no handler/readiness, que não torna o seu trabalho realmente abortável.

---

# 4. Contrato declarado versus implementação real

## 4.1 Contrato semântico vigente

`src/copilot/mcp/tools/catalog/semantic-contracts.js` declara:

```text
llmb_live_readiness
  cancellation = cancellable
  drainTimeoutMs = 15000
  rationale = OperationContext.signal reaches the owned cancellable/acceptance boundary...
```

## 4.2 Caminho real do signal

`src/copilot/mcp/tools/llm-b-live.js` passa:

```text
operationContext.signal
    -> executeModelGatewayLiveReadiness(..., { signal })
```

`src/copilot/mcp/integrations/model-gateway/live-runs/readiness.js` faz somente:

```text
if (options.signal?.aborted) throw ...
```

antes de chamar:

```text
buildModelGatewayLiveReadiness({...})
```

O builder não recebe `signal`.

Consequentemente, depois que o fresh build começa, o abort não chega a:

- `readSourceCatalogIdentity`;
- `sourceStore.readSnapshot()`;
- `sqliteStore.readSnapshot()`;
- `sqliteStore.readStorageDiagnostics()`;
- `sqliteStore.listLatestRuntimeHealthRecords()`;
- `auditModelGatewayCatalogIntegrity()`;
- parity audit JSON↔SQLite;
- selector plans;
- catalog redaction worker;
- SQLite redaction worker;
- qualquer fila/promise já iniciada dentro desses workers.

## 4.3 Veredito de governança

A tool possui **tipagem/metadata de cancellation mais forte que a implementação real**.

Isso viola um princípio central da Arquitetura 2.4:

> semantic contracts devem descrever authority/effects/cancellation reais, não intenção futura.

A correção não deve ser trocar silenciosamente a tool para `bounded-non-cancellable` como forma de
normalizar o defeito. O trabalho é read-only e tecnicamente cancelável; o estado-alvo é tornar o
contrato verdadeiro.

---

# 5. Anatomia de performance da fresh readiness

## 5.1 Execução observada via MCP após reconnect

`llmb_live_readiness(includeSqliteRuntimeHealth=true)` retornou `ok=true`, mas o domain service
reportou aproximadamente:

| Phase                          | Tempo observado |
| ------------------------------ | --------------: |
| source catalog identity        |           ~4 ms |
| SQLite snapshot read           |       ~6.139 ms |
| SQLite storage diagnostics     |       ~6.846 ms |
| source JSON snapshot           |       ~6.714 ms |
| catalog integrity              |         ~121 ms |
| catalog↔SQLite parity          |          ~89 ms |
| selection env identity         |          ~76 ms |
| **SQLite runtime-health read** |  **~23.525 ms** |
| selection/selector plans       |       ~4.408 ms |
| catalog redaction outer phase  |      ~10.000 ms |
| SQLite redaction outer phase   |      ~10.711 ms |
| total domain service           |  **~39.248 ms** |

O registry, entretanto, registrou a call completa em **75.875 ms**.

### Gap de instrumentação

```text
registry total       ~75,9 s
mcpAdapter duration  ~39,2 s
não explicado        ~36,6 s
```

O `startedAt` interno ocorre somente depois da primeira construção do fingerprint/cache key. Porém o
fingerprint SQL equivalente foi medido isoladamente em ~30 ms, então **não há evidência para dizer
que o fingerprint sozinho explica os 36 s**.

O estado-alvo deve medir separadamente:

- pre-handler/queue delay;
- fingerprint total;
- workspace stat;
- BYOK persistence stat;
- SQLite logical fingerprint;
- single-flight wait;
- domain build;
- result construction;
- output validation;
- result-size accounting;
- serialization/wire handoff.

Sem isso, `mcpAdapter.durationMs` é uma métrica parcial apresentada como se cobrisse o caminho todo.

---

# 6. CLI isolado versus processo MCP

A mesma readiness canônica foi executada pelo CLI com composição SQLite correta:

```text
npm run -s model-gateway:live:readiness -- --sqlite-runtime-health
```

Resultado:

```text
domain readiness total ~7,998 s
wall                  ~8,86 s
user CPU             ~14,55 s
sys                   ~1,85 s
max RSS              ~1.649 MiB
```

Na execução CLI:

- `sqliteRuntimeHealthRead`: ~0,89 s;
- selection/plans: ~3,97 s;
- core catalog redaction worker: ~1,50 s;
- core SQLite redaction worker: ~1,59 s;
- full coverage preservada.

## Conclusão

O algoritmo canônico consegue operar próximo de 8 s. O salto para 39–76 s dentro do MCP é
contextual: contention/process state/lifecycle/cancellation/cache/worker reuse, e não custo
inevitável do selector.

---

# 7. Redaction audits: segurança correta, placement inadequado

## 7.1 Escala observada

A fresh readiness audita aproximadamente:

```text
catalog strings scanned ~945.249
SQLite strings scanned ~1.067.977
leaks                 0
```

A cobertura é valiosa e não deve ser simplesmente removida.

## 7.2 Problema arquitetural

Uma prova de ausência de secret leak sobre ~2 milhões de strings está acoplada ao synchronous wire
path de uma tool que deveria responder a uma pergunta operacional simples:

> “o Model Gateway/LLM-B está pronto para rodar?”

Essas são duas freshness dimensions diferentes:

1. **operational readiness freshness** — routes, environment, selectors, provider/terminal posture;
2. **deep redaction proof freshness** — o conjunto persistido auditado desde seu último fingerprint.

Executar o full security scan a cada fresh readiness é correto do ponto de vista conservador, mas
arquiteturalmente caro e torna a tool vulnerável a cancellation/host timeout.

## 7.3 Estado-alvo

Manter segurança fail-closed, porém transformar redaction proof em evidência fingerprintada:

```text
persisted-state fingerprint unchanged
    -> reuse last full-redaction proof

relevant persisted state changed
    -> run/recompute bounded deep audit
```

A readiness wire não deve alegar `redaction.ok=true` com proof stale; deve carregar explicitamente:

```text
proofFingerprint
proofGeneratedAt
proofAgeMs
proofMatchesCurrentState
scanCoverage
```

Assim a otimização não relaxa segurança.

---

# 8. Persistent workers: lifecycle e memória

## 8.1 Estado atual

`buildModelGatewayLiveReadiness()` pode usar dois workers persistentes:

- `catalog`;
- `sqlite`.

O processo mantém `persistentRedactionWorkers` em um `Map`.

Após sucesso, os workers permanecem vivos indefinidamente. Hoje não existe:

- idle TTL;
- idle reaper;
- máximo de requests por worker;
- máximo de heap;
- `resourceLimits` no constructor;
- heap sampling;
- RSS/worker telemetry;
- health score da pool;
- explicit teardown no idle path.

Há termination somente em erro/exit/timeout de request.

## 8.2 Evidência de memória no processo MCP

Depois de uma readiness fresh:

```text
MCP process RSS      ~830.9 MiB
MCP process HWM      ~1.564 GiB
Private_Dirty        ~757.6 MiB
Threads              17
```

Não foi medido o baseline RSS imediatamente anterior naquela mesma geração; logo este documento não
atribui todo o delta exclusivamente aos workers. Porém:

- o high-water coincide com a escala do benchmark CLI (~1,65 GiB max RSS);
- o processo mantém memória privada elevada depois do audit;
- workers persistentes são a principal diferença de lifecycle entre one-shot CLI e servidor MCP.

Isso é evidência suficiente para exigir lifecycle/memory governance, mas não para alegar memory leak
clássico sem heap snapshots comparativos.

## 8.3 Recursos nativos disponíveis no Node 24

A API atual de `node:worker_threads` oferece nativamente:

- `resourceLimits`;
- `worker.getHeapStatistics()`;
- `worker.terminate()`;
- `name`/`threadName` para diagnóstico.

Referência oficial:

- https://nodejs.org/api/worker_threads.html

Não há necessidade de nova dependência para impor esses guardrails.

---

# 9. SQLite runtime history e retention drift

## 9.1 Policy atual

A store define defaults aproximados:

```text
runtimeProbeRunMaxRows    10.000
runtimeProbeResultMaxRows 100.000
healthObservationMaxRows  100.000
```

## 9.2 Estado observado

```text
runtime probe runs       3.564
runtime probe results  143.527
health observations    177.541
```

Excesso acima da policy:

```text
probe results   +43.527
health rows     +77.541
combined       +121.068
```

## 9.3 Causa

`applyOperationalRetention()` existe, e há command explícito de retention, mas a busca de consumers
não encontrou aplicação automática no lifecycle normal. A policy é, portanto, **declarativa e
manual**, não um invariant operacional.

## 9.4 Impacto

As queries latest usam bons índices, e o SQL isolado mostrou ~0,27–0,29 s para as window queries;
logo o excesso não explica sozinho os 23,5 s observados dentro da readiness.

Ainda assim, permitir crescimento acima do próprio budget:

- aumenta working set;
- aumenta custo de scans/backup/integrity;
- eleva risco de contention;
- degrada previsibilidade de futuras queries;
- contradiz a governança declarada.

A retenção automática/bounded é um fix necessário independentemente da raiz do `TaskGroup`.

---

# 10. Cache e single-flight

## 10.1 Estado atual

A integration MCP mantém:

```text
TTL      30 s
max      8 entries
single-flight por fingerprint
```

O fingerprint considera:

- workspace root;
- includeSqliteRuntimeHealth;
- catalog JSON file stat;
- logical Model Gateway SQLite fingerprint;
- BYOK health persistence fingerprint.

Há evidência histórica de cache efetivo: uma execução em 2026-08-15 caiu para ~97 ms logo após uma
fresh readiness.

## 10.2 Gap

O TTL de 30 s é muito próximo — ou menor — que a duração de uma fresh execução degradada. Em um
regime de 39–76 s, chamadas humanas subsequentes normalmente já chegam fora da janela.

A resposta não deve simplesmente aumentar TTL e aceitar staleness. O estado-alvo é separar:

- TTL de conveniência;
- fingerprint validity;
- deep-proof validity;
- runtime-health freshness.

Se o fingerprint relevante não mudou, uma prova cara não precisa expirar apenas porque 30 s
passaram.

---

# 11. Result contract e wire payload

A tool faz:

```js
okResult(parsed, JSON.stringify(parsed, null, 2))
```

`okResult` publica simultaneamente:

- `structuredContent`;
- `content[0].text`.

Com um readiness representativo:

```text
compact structured JSON ~12.180 bytes
pretty text             ~18.064 bytes
combined logical copy   ~30.244 bytes
```

Isso não é grande o bastante para explicar os hangs de 395–1.062 s, mas é duplicação desnecessária.

Estado-alvo:

- structured result como authority;
- texto compacto de decisão, não dump pretty completo;
- detalhes grandes apenas quando explicitamente solicitados;
- size hint exato/conservador se útil para evitar stringify adicional no registry.

---

# 12. Testability e composition coupling

Uma tentativa de executar `buildModelGatewayLiveReadiness()` em um Node process sem bootstrap falhou
corretamente com:

```text
ERR_INFRA_SQLITE_PROVIDER_UNCONFIGURED
```

Isso revela que o chamado “application service” depende da SQLite provider authority configurada
pela composition root.

Essa dependência pode ser legítima, mas hoje dificulta:

- benchmark unitário isolado;
- fault injection de store lenta;
- teste de cancellation em cada phase;
- teste de worker lifecycle sem bootstrap global.

Estado-alvo: dependências caras/abortáveis explícitas ou ports injetáveis no builder, mantendo a
composition authority fora do domínio.

---

# 13. O que o `TaskGroup` significa — e o que não significa

## Podemos afirmar

- o erro visível ocorre no host/session boundary;
- o origin continua registrando seus próprios eventos;
- há duas ocorrências provadas em que o caller cancellation não drenou a readiness;
- depois do incidente anterior, tools curtas também deixaram de funcionar até reconnect;
- após reconnect, o mesmo source voltou a funcionar;
- Cloudflare/origin/OAuth estavam saudáveis antes da degradação;
- portanto o failure-to-drain é um forte precursor causal da degradação da sessão.

## Não podemos afirmar sem acesso ao runtime interno do host

- qual framework Python/AnyIO/asyncio produziu exatamente `TaskGroup`;
- que o ChatGPT “crashou” internamente;
- que existe um timeout fixo específico do host;
- que todo `TaskGroup` é causado exclusivamente por memória;
- que `worker_threads` sozinho é a raiz.

O roadmap deve corrigir tudo que controlamos no origin até que cancellation seja rápida e o host
nunca precise sustentar uma readiness longa o suficiente para entrar nessa condição.

---

# 14. Matriz de bugs, gaps e riscos — estado corrente após reauditoria

> Os itens históricos permanecem para rastreabilidade, mas seu estado abaixo distingue
> explicitamente **baseline**, **corrigido no worktree**, **não promovido** e **blocker atual**.

| ID            | Prioridade | Estado corrente                                                          | Achado                                                                                                                                                                                                                                                                                                                   |
| ------------- | ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLMB-TG-P0-01 | P0         | **corrigido localmente; host acceptance aberta**                         | o baseline tinha `cancellable` falso; o worktree moveu fresh readiness para Worker call-scoped terminável                                                                                                                                                                                                                |
| LLMB-TG-P0-02 | P0         | **histórico confirmado; regressão host ainda não revalidada**            | duas calls antigas não drenaram em 15 s e continuaram ~963 s/~1.063 s; unit boundary novo drena rápido, mas source ainda não foi promovido                                                                                                                                                                               |
| LLMB-TG-P0-03 | P0         | **corrigido localmente; operação real de retention ainda não executada** | prune global destruía latest facts; retention latest-preserving + latest pointers v14 evitam isso mesmo quando identities protegidas excedem budget                                                                                                                                                                      |
| LLMB-TG-P0-04 | P0         | **corrigido localmente com fault coverage**                              | `clear` é scope-aware no SQLite e o retry preserva causalidade quando clears/records novos chegam durante write failure                                                                                                                                                                                                  |
| LLMB-TG-P0-05 | P0         | **corrigido e coberto**                                                  | o caso `clear(A) -> record(A)` após write failure foi reproduzido, corrigido por causal requeue e passou a fazer parte da fault matrix com `clear->record`, `record->clear` e clear-all concorrente                                                                                                                      |
| LLMB-TG-P1-01 | P1         | **corrigido arquiteturalmente; performance residual aberta**             | redaction audit de ~2,01 M strings deixou de ser obrigatório em toda fresh call: proof content-aware/context-bound pode ser reutilizada; benchmark realista caiu de ~23,84 s fresh-proof para ~8,59 s proof-reuse, portanto o custo dominante restante migrou para snapshot/selection/fingerprints                       |
| LLMB-TG-P1-02 | P1         | **persistent-pool corrigida; governance incompleta**                     | workers agora são one-shot, mas faltam `resourceLimits`, heap telemetry, memory budget e fault handling OOM                                                                                                                                                                                                              |
| LLMB-TG-P1-03 | P1         | **baseline histórico; precisa rebaseline**                               | processo MCP antigo chegou a ~831 MiB RSS pós-audit / ~1,56 GiB HWM; o novo lifecycle ainda não tem benchmark 1/5/20 nem plateau comprovado                                                                                                                                                                              |
| LLMB-TG-P1-04 | P1         | **perfil atualizado**                                                    | worktree em cópia realista: builder ~7,04 s / outer Worker ~8,11 s; redaction domina, mas source snapshot (~2,70 s), SQLite snapshot (~1,66 s) e selection/plans (~3,54 s) também são materialmente caros                                                                                                                |
| LLMB-TG-P1-05 | P1         | **parcialmente instrumentado**                                           | fingerprint/process/total agora têm timing coerente com o subprocess outer; result validation/serialization/registry e gap host↔MCP continuam sem atribuição completa                                                                                                                                                    |
| LLMB-TG-P1-06 | P1         | **operacionalmente aberto**                                              | retention intencional continua não aplicada ao `data/copilot.sqlite` real; após remediação do incidente ele voltou a 177.541 health + 143.527 probe-result rows para budgets 100k+100k                                                                                                                                   |
| LLMB-TG-P1-07 | P1         | **corrigido localmente**                                                 | delta mirror elimina full-ledger por mudança e startup reconciliation hidratada repara aditivamente fatos ausentes/mais novos sem apagar SQLite-only evidence de outras lanes                                                                                                                                            |
| LLMB-TG-P1-08 | P1         | **divergência histórica caracterizada; reconciliation policy definida**  | baseline real mostrou 126 registros JSON vs. 134 grupos latest health SQLite, com 4 identidades só no JSON e 12 só no SQLite; por isso self-healing é aditivo/monotônico, não destructive equality sync                                                                                                                  |
| LLMB-TG-P1-09 | P1         | **corrigido e reproduzido pós-fix**                                      | hydration ganhou boundary authoritative fail-closed; o comparador canônico passou de `fileRecords=0` falso para `fileRecords=126` na mesma cópia segura                                                                                                                                                                  |
| LLMB-TG-P1-10 | P1         | **corrigido e coberto**                                                  | outer readiness agora é subprocesso supervisionado com `readinessEnvironment()` explícito; redaction Workers recebem `WorkerOptions.env`; testes negativos e execução real comprovam ausência de ambient MCP/OAuth/session                                                                                               |
| LLMB-TG-P1-11 | P1         | **corrigido com regression**                                             | fresh result só entra no cache quando `initialFingerprint === completedFingerprint`; mudança durante build retorna `unstableSnapshot=true`, `parsed=null`, erro retry-required e a execução seguinte precisa reconstruir o snapshot                                                                                      |
| LLMB-TG-P1-12 | P1         | **corrigido localmente e provado**                                       | proof publica coverage exata: catálogo `exhaustive` para o snapshot normalizado; SQLite `bounded` com fingerprint, rows/tabela, rowCount, tableCount, payloadBytes e scanned strings. Reuse exige fingerprint+coverage+authority-context idênticos; mutation same-length e race in-call invalidam fail-closed            |
| LLMB-TG-P1-13 | P1         | **corrigido localmente e benchmarkado**                                  | retention passou a batches de 5.000 rows/transação, índices covering de retention, retry `BUSY/LOCKED`, métricas e checkpoint explícito; o baseline monolítico de ~24,2 s permanece somente como comparação histórica                                                                                                    |
| LLMB-TG-P1-14 | P1         | **risco materializado por erro de harness e remediado**                  | um benchmark sem `COPILOT_DB_PATH` atingiu o DB real, migrou v13→v14 e removeu 43.527 probes + 20.000 health; snapshot/forensics permitiram reinserção seletiva idempotente, latest hash permaneceu idêntico e `integrity_check` voltou verde                                                                            |
| LLMB-TG-P1-15 | P1         | **restrição operacional quantificada**                                   | checkpoint PASSIVE foi offloaded para Worker/Infra e não bloqueia diretamente o event loop, mas checkpoint de ~172k WAL pages ainda exerce pressão de I/O: em ensaio isolado writer p95 ~674 ms/max ~1,68 s e reader p95 ~13 ms; a cauda volta ao baseline após o checkpoint e deve permanecer explicitamente observável |
| LLMB-TG-P2-01 | P2         | **separação concluída localmente**                                       | TTL 30 s pertence somente ao cache operacional; security proof não usa TTL e só é reutilizada por fingerprint+coverage+context idênticos dentro da mesma environment authority. Restart/authority nova força recompute                                                                                                   |
| LLMB-TG-P2-02 | P2         | **confirmado/rebaselineado**                                             | objeto current mediu ~12.562 B compacto / ~18.774 B pretty; `okResult` ainda envia a árvore em `structuredContent` e novamente como pretty text                                                                                                                                                                          |
| LLMB-TG-P2-03 | P2         | **avançado; ainda parcial**                                              | fault matrix cobre storage ordering/hydration/reconciliation/retention/checkpoint, env authority, operational cache instability, native-SQLite cancellation e security-proof reuse/invalidation/context mismatch/in-call race; permanecem host acceptance e memory plateau                                               |
| LLMB-TG-P2-04 | P2         | **confirmado**                                                           | builder ainda depende de provider global; fault injection de store/fingerprint/phase continua mais difícil do que deveria                                                                                                                                                                                                |
| LLMB-TG-P2-05 | P2         | **hipótese rejeitada no SQL exato**                                      | v14 não faz window scan no hot latest read; `EXPLAIN QUERY PLAN` da SQL real usa a pequena projeção latest + lookup por PK no histórico; benchmark sintético de escala ainda é necessário                                                                                                                                |
| LLMB-TG-P2-06 | P2         | **corrigido e provado end-to-end**                                       | boot e readiness compartilham `resolveApplicationSqlitePath`; `COPILOT_DB_PATH` é process-composition-only, não vem de `.env.local`; subprocess customizado abriu e reportou exatamente o mesmo DB path                                                                                                                  |
| LLMB-TG-P2-07 | P2         | **corrigido**                                                            | `catalogStaticReadinessCache`, `readinessStoreContext` e `modeContexts` foram removidos: com subprocess/Workers one-shot não havia lifetime cross-call que justificasse esses caches                                                                                                                                     |
| LLMB-TG-P2-08 | P2         | **corrigido e testado**                                                  | `repo_status` recuperou rationale próprio e `llmb_live_readiness` descreve explicitamente subprocess/process-group/child-close; registry regression garante que a rationale específica não vaza para outra tool                                                                                                          |
| LLMB-TG-P2-09 | P2         | **confirmado em cópia**                                                  | logical prune não reduz o arquivo físico: após delete ficaram ~46.854 freelist pages; checkpoint e space reclamation/VACUUM são políticas separadas, nunca parte implícita do hot path                                                                                                                                   |
| LLMB-TG-P3-01 | P3         | **operacional**                                                          | audit JSONL grande continua impróprio para scans cegos no diagnóstico normal                                                                                                                                                                                                                                             |

---

# 15. Estado-alvo

A LLM-B readiness ideal deve obedecer aos seguintes invariants.

## 15.1 Cancellation

```text
caller abort
-> signal chega a toda operação call-scoped
-> novos phases não começam
-> workers em uso recebem cancellation/terminate
-> reads abortáveis encerram ou são bounded
-> handler drena <= 2 s normal / <= 5 s hard ceiling
-> nenhuma promise orphan permanece em liveReadinessInFlight
```

## 15.2 Performance

Targets iniciais propostos, sujeitos a rebaseline após profiling:

```text
memory-cache                <= 100 ms
fresh operational readiness <= 2 s p50 / <= 5 s p95
fresh + required deep proof <= 10 s p95
registry unexplained gap    <= 250 ms
```

Não normalizar 40–75 s como aceitável.

## 15.3 Memory

- worker heap explicitamente medido;
- `resourceLimits` definidos após benchmark;
- idle workers reapados;
- nenhum full scan deixa RSS crescer monotonamente entre chamadas;
- repetir readiness N vezes deve convergir para um plateau conhecido;
- worker failure/OOM deve falhar a proof de forma explícita, sem matar o MCP process inteiro.

## 15.4 Security

- authority de environment explicitamente minimizada também no `WorkerOptions.env`, não apenas em
  `workerData`;
- coverage de redaction proof declarada com precisão: `surface`, fingerprint, rows/tables/strings
  cobertos e modo `bounded` versus `exhaustive`;
- proof vinculada a fingerprint de conteúdo adequado à superfície realmente auditada;
- stale/partial proof nunca aparece como fresh/exhaustive;
- nenhum secret incluído em telemetry/heap diagnostics.

## 15.5 SQLite

- retention aplicada por lifecycle owner fora de request/main-thread e em transações bounded;
- budgets são invariants, não comandos opcionais, sem sacrificar latest facts;
- mirror delta é retry-safe, startup/self-healing-aware e só lê estado após hydration concluída;
- latest-health read proporcional ao número de grupos relevantes; query plan real usa latest
  projection + PK lookup;
- WAL/checkpoint, `SQLITE_BUSY`, freelist e space reclamation têm observabilidade/policy separadas;
- migration/reconciliation real só ocorre após backup/integrity proof e barrier explícito de
  promoção.

## 15.6 Wire

- structured authority única;
- texto compacto;
- resultado default task-first;
- detalhes somente opt-in;
- uma readiness nunca depende de manter uma tool call silenciosa por dezenas de segundos.

---

# 16. Roadmap de correção — revisado após auditoria de continuidade

## Faixa S — integridade de source, provenance e promotion barrier

A abertura manual de `json-catalog-store.js` em 2026-08-26 coincidiu com uma mutação semântica não
atribuída do arquivo em disco. O operador confirmou que não realizou edição concorrente. A
investigação não encontrou formatter/watcher de source ativo capaz de explicar a troca semântica;
Prettier pode participar de um save, mas não explica por si só mudança de APIs/comentários. A causa
exata permanece **não comprovada** e deve ser classificada como `unattributed source mutation`, não
como edição humana.

A configuração do workspace expôs uma combinação insegura para um repo operado simultaneamente por
editor + MCP: `files.autoSave=onFocusChange`, `files.restoreUndoStack=true` e
`files.saveConflictResolution=overwriteFileOnDisk`. O próprio VS Code define `askUser` como default
fail-closed para conflito de save; portanto stale/restored buffer + autosave é uma hipótese causal
plausível, mas ainda não uma conclusão forense.

Esta faixa é deliberadamente distinta de `mcp/diagnostics/runtime-source-drift`: o diagnóstico atual
responde **process generation vs source mtime**; S responde **source hash validado vs source hash
promovido** e provenance de transições.

- [x] mudar `files.saveConflictResolution` para `askUser`;
- [x] desabilitar autosave por perda de foco neste workspace e `files.refactoring.autoSave`,
      eliminando escrita implícita por simples navegação/focus;
- [x] preservar `formatOnSave` apenas para saves explícitos; formatter não é authority para mudanças
      semânticas;
- [x] garantir CAS por snapshot nas mutações de conteúdo de arquivo existente do MCP: patch/batch já
      faziam CAS interno contra o snapshot locked; `repo_write_file` passou a capturar hash full e
      usá-lo automaticamente quando o caller omite `expectedHash`;
- [x] manter `expectedHash` fornecido pelo caller como precondition adicional/explicável, nunca
      enfraquecê-lo;
- [x] criar manifest determinístico de barrier com `path + sha256 + bytes` e fingerprint agregado
      SHA-256 domain-separated;
- [x] implementar capture/verify fail-closed com erro estruturado `ERR_SOURCE_DRIFT` quando qualquer
      arquivo validado divergir;
- [x] ligar automaticamente a classificação de provenance ao audit MCP persistido: o verifier
      consulta `readTail()` somente quando há drift, projeta transições diretas e
      `targetTransitions` de patch-batch, e jamais transforma drift conhecido em sucesso;
- [x] testar writer externo entre snapshot/publish no IO, mutation same-length depois do barrier,
      stale-buffer-equivalent overwrite, provenance conhecida e deleção pós-capture;
- [x] completar integração do mesmo manifest nos boundaries de benchmark/reload/publish:
      `source-barrier.js run` verifica o mesmo fingerprint antes/depois do child; reload exige
      manifest+fingerprint e o runner destacado executa o restart através desse wrapper;
      `git_publish_changes` verifica pre-stage, pre-commit e pós-commit/pre-push;
      `repo_apply_patch_batch.postValidate` já captura barrier após apply e verifica novamente após
      o último validator;
- [x] documentar hashes/evidência do incidente e confirmar que gates novos serão sempre certificados
      sobre source byte-identical.

**Checkpoint S.3 — 2026-08-26 — FAIXA S FECHADA:** editor fail-closed, CAS de patch/full-write,
manifest/capture/verify, barrier de post-validation e provenance automática pelo audit persistido
estão implementados. Patch-batch agora persiste `targetTransitions` por target (`path`,
`previousHash`, `contentHash`, `traceId`), e o verifier consulta o audit apenas no caminho de drift.
Matriz atual: `63/63` testes focais, ESLint focal e TS7 strict verdes. O mesmo manifest/fingerprint
está agora executável nos boundaries de benchmark/promoção/reload: wrapper pre/post-child, reload
source-bound e publicação Git source-bound. A matriz de fechamento é `79/79`, com ESLint focal e TS7
strict verdes; nenhum reload, stage, commit ou push real foi executado.

Durante a implementação surgiu ainda um bug real de infraestrutura: o result validator de patch
tratava `.vscode/settings.json` como JSON estrito embora o workspace use JSONC. O erro bloqueou
corretamente a publicação (`ERR_PATCH_INVALID_JSON_RESULT`), porém por falso positivo. A source foi
corrigida para validar `.json` estrito e `.jsonc`/`.vscode`/`.devcontainer`/`tsconfig*`/`jsconfig*`
com `jsonc-parser`, preservando validação pre-publish. Como o MCP carregado ainda executa a geração
anterior até reload, a mudança emergencial de `.vscode/settings.json` foi feita por script CAS
atômico com hash inicial, validação JSONC, fsync do temp, recheck do hash imediatamente antes de
`rename()` e fsync do diretório.

**Gate S:** nenhuma validação/benchmark/promoção pode ser reutilizada depois que o manifest
correspondente divergir; conflitos editor-disco são fail-closed e mutações MCP existentes usam CAS
obrigatório contra o snapshot realmente lido.

## Faixa A — instrumentação causal e baseline de performance

- [x] adicionar timing explícito de `buildLiveReadinessFingerprint`;
- [x] eliminar o single-flight compartilhado cuja espera não tinha ownership de cancellation por
      caller;
- [x] medir fresh readiness do worktree em cópia consistente: builder ~7,04 s / outer Worker ~8,11
      s;
- [x] atribuir custos internos hoje materialmente grandes: `sourceSnapshotRead` ~2,70 s,
      `sqliteSnapshotRead` ~1,66 s, `selectionAndSelectorPlans` ~3,54 s, redaction outer ~7,02 s;
- [x] decompor catalog stat / BYOK stat / SQLite logical fingerprint individualmente
      (`catalogFileMs`, `byokHealthMs`, `sqliteMs`);
- [x] medir bootstrap/import/startup/exit overhead do subprocess outer e, quando a proof é fresh,
      dos dois redaction Workers;
- [x] instrumentar parse/serialization e os boundaries genéricos de `resultSize`/`outputValidation`
      do registry sem levá-los ao wire público;
- [ ] publicar `registryDurationMs` versus `domainDurationMs` como comparação direta em diagnóstico
      interno; as fases já existem separadamente, mas a projeção comparativa literal ainda não foi
      adicionada;
- [x] adicionar lifecycle counters call-scoped:
      `created/terminated/current/cancelled/timedOut/outputLimited/abnormalExit`;
- [x] adicionar heap statistics sanitizadas por redaction Worker somente em diagnostics;
- [x] adicionar process RSS/HWM apenas como diagnóstico opt-in;
- [x] executar baseline 1/5/20 fresh calls controladas após C/D/F, sob source barrier
      byte-identical.

**Gate A — fechado para promoção local, com um residual diagnóstico não bloqueante:** o rebaseline
final de publicação, hash-bound sobre os 79 arquivos modificados/untracked, fixa o SLO local de
`fresh-process` com security proof reutilizada em **p95 ≤ 7,0 s**. Em N=20: p50 **6,382 s**, p95
**6,552 s**, max **6,569 s**. O residual é apenas publicar a comparação direta registry-vs-domain;
os custos grandes do subprocess/domain já têm owner/phase e o registry mede separadamente
handler/result-size/output-validation/audit.

## Faixa B — cancellation contract verdadeiro end-to-end

- [x] remover `liveReadinessInFlight`/single-flight compartilhado;
- [x] remover pool persistente de redaction/pending maps compartilhados entre calls;
- [x] redaction workers filhos são one-shot e pertencem ao lifecycle da fresh readiness;
- [x] Worker outer provou cancellation rápida para JS/stuck work e registry-level nested-worker
      cancellation sem órfão;
- [x] corrigir semantic contract: restaurar rationale de `repo_status` e atribuir containment
      especificamente a `llmb_live_readiness`;
- [x] provar no registry-level focused test que cancellation após nested Worker iniciado não cai em
      `MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT`;
- [x] **rejeitar Worker thread como hard-cancellation boundary para SQLite nativo**: fault test que
      entrou de fato numa query `better-sqlite3` síncrona levou ~14,72 s para `Worker.terminate()`
      observar exit;
- [x] contraprova: a mesma classe de query em subprocesso isolado drenou via `SIGKILL` em ~1,06 ms;
- [x] substituir o outer Worker por **subprocesso call-scoped supervisionado**, reutilizando
      `live-runs/runtime.js` + `createAttachedChildProcessSupervisor`;
- [x] abort/timeout da readiness encerra process group com `SIGTERM` + `SIGKILL` imediato e settle
      somente após `close`;
- [x] registry-level fault test cancela após nested Worker efetivamente iniciado, sem
      `MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT` e sem efeito tardio;
- [x] registry-level fault test cancela durante query `better-sqlite3` nativa efetivamente iniciada
      e drena confortavelmente abaixo de `drainTimeoutMs`;
- [x] repetir registry-level proof sobre a arquitetura subprocess final: 2/2 fault cases verdes;
- [ ] repetir proof especificamente após **redaction Worker real** ter sinalizado início, se
      adicionarmos marker/test seam sem contaminar produção;
- [ ] repetir proof host-real somente após promoção controlada.

**Gate B:** **localmente fechado para a fronteira crítica de cancellation**. A arquitetura final usa
subprocess supervisionado; native SQLite e nested Worker foram cobertos no registry real. Permanecem
somente a acceptance host-real pós-promoção e, como prova adicional, marker de redaction real se for
introduzido de forma limpa.

## Faixa C — lifecycle, environment authority e memory governance da unidade isolada

- [x] redaction children reais: `mg-redact-cat` e `mg-redact-sql`, one-shot;
- [x] `WorkerOptions.env` explícito/minimal permanece nos redaction Workers;
- [x] `COPILOT_DB_PATH` entrou na projection read-only/common para bootstrap customizado correto;
- [x] foi criada projection semântica `readinessEnvironment()`: provider config/secrets podem ser
      inspecionados localmente, sem credenciais Copilot-model, MCP/OAuth ou ambient desconhecido;
- [x] subprocesso outer usa environment authority explícita; execução real contra cópia SQLite
      passou com exatamente 6 chaves de ambiente e `stderr=0`;
- [x] remover o runner/entrypoint outer Worker intermediário e seu teste, sem compat/shim;
- [x] redaction Worker entrypoint continua validando `workerData.env` versus `process.env` antes do
      SQLite bootstrap;
- [x] definir process lifecycle counters e RSS/HWM bounded/opt-in para a unidade outer;
- [x] coletar heap statistics somente dos redaction Workers quando diagnostics é solicitado;
- [x] definir `resourceLimits` explícitos dos redaction Workers (`old=768 MiB`, `young=128 MiB`,
      stack 8 MiB);
- [x] tratar process abnormal exit/output-limit/timeout e `ERR_WORKER_OUT_OF_MEMORY` como falhas
      classificadas/fail-closed; falta apenas um fault test que force OOM real sem seam artificial;
- [x] benchmark 1/5/20 calls prova plateau de RSS e ausência de leaked subprocesses: no rebaseline
      final de publicação N=20 HWM p50 ~645 MiB, p95 ~667 MiB, max ~684 MiB, `created=27`,
      `terminated=27`, `current=0`.

**Gate C — fechado localmente para promoção:** least-privilege env, ownership, lifecycle counters,
HWM, heap diagnostics e resource budgets estão implementados. Um fault test de OOM físico permanece
melhoria residual em H, não evidência de falha causal atual.

## Faixa D — separar operational readiness de security proof com coverage explícita

- [x] reauditar a coverage atual: catalog audit percorre o snapshot normalizado inteiro; SQLite
      audit é bounded a 25 rows/tabela por default, embora payloads densos levem o total a ~2,01 M
      strings;
- [x] substituir “full proof” por metadata precisa de `surface`, `mode`, `fingerprint`,
      `maxRowsPerTable`, `tableCount`, `rowCount`, `payloadBytes` e `scannedStringCount`;
- [x] decidir o requisito de exhaustive histórica: **não pertence ao operational request path**; se
      um operador exigir prova histórica exaustiva, ela será maintenance/security audit out-of-band.
      `--deep-redaction` continua bounded a 100.000 rows/tabela e o alias semanticamente falso
      `--full-redaction` foi removido;
- [x] fingerprint de catálogo content-aware: SHA-256 domain-separated sobre o snapshot normalizado
      realmente auditado; raw-file hash inicial/final adicional protege contra mutation durante a
      build;
- [x] fingerprint SQLite content-aware sobre exatamente os mesmos `payload_json`/rowids/tabelas da
      janela bounded, sem JSON parse/traversal;
- [x] proof metadata não contém payload nem secret; fica process-scoped em `WeakMap` por environment
      authority, com `contextId` UUID opaco por geração;
- [x] reutilizar proof somente quando context + coverage + fingerprints correntes forem idênticos;
- [x] default readiness retorna freshness/coverage compactas e `proofReused` explícito;
- [x] primeira call após restart/nova authority recomputa; proof não usa TTL de conveniência;
- [x] modo deep explícito aumenta coverage bounded e necessariamente invalida proof com coverage
      diferente;
- [x] fail-closed: proof stale/context-mismatch/partial nunca é promovida; mutation da superfície
      durante build é detectada por recheck final e aborta a resposta;
- [x] regression de domínio prova janela bounded: mudança fora das últimas 25 rows não altera a
      identidade pedida; mudança dentro da janela altera fingerprint e leak fixture é detectado;
- [x] benchmark realista mantém a escala de ~2,01 M strings: 945.249 catalog + 1.067.977 SQLite;
- [x] execução canônica em cópia provou reuse: ~23,84 s fresh-proof -> ~8,59 s proof-reuse, com
      ambos redaction Worker cores em 0 ms na segunda call;
- [x] mutation `payload_json` same-length entre calls rejeitou proof antiga e recomputou; mutation
      same-length durante uma call de reuse falhou explicitamente no recheck final.

**Gate D — FECHADO LOCALMENTE em 2026-08-26:** segurança ficou semanticamente mais rigorosa e
observável; a readiness operacional não depende normalmente do scan de ~2 M strings depois que
existe proof válida para a mesma environment authority. O custo residual de ~8,6 s pertence agora
principalmente à Faixa A/F de snapshot, selection e fingerprints, não à redaction traversal.

## Faixa E — SQLite retention, hydration, delta mirror e latest-health

### E.1 — data model/latest read

- [x] escolher owner do retention: Model Gateway persistence owner; MCP apenas compõe/invoca
      reconciliation;
- [x] auditar retention em cópia do SQLite real;
- [x] provar que prune global antigo era inseguro: removia 28/134 health groups e 19/160 probe
      groups;
- [x] implementar retention latest-preserving por identidade canônica;
- [x] reportar `protectedLatestRows`, `remainingRows`, `budgetSatisfied` e rows pruned;
- [x] schema v14 com projeções pointer-only + backfill determinístico v13→v14;
- [x] hot read sem `ROW_NUMBER()` histórico;
- [x] `EXPLAIN QUERY PLAN` da SQL real confirmou scan da projeção latest via
      `idx_mg_*_latest_observed` + PK lookup no histórico;
- [x] benchmark sintético 100k/250k/500k por ledger, cold/warm, com query-plan assertions: latest
      pointers 134/160 e 144 records retornados permaneceram estáveis; cold p50 3,377/2,492/3,039
      ms, warm p50 2,073/1,751/2,074 ms; sem `TEMP B-TREE`, integridade/FK verdes.

### E.2 — delta mirror correctness

- [x] converter automatic mirror de full-ledger para delta por identidade;
- [x] scoped clear/clear-all removem latest pointers e history correspondente no happy path;
- [x] mudanças que chegam enquanto write está in-flight são rearmadas;
- [x] corrigir retry de batch `clear(A) -> record(A)` após write failure preservando causal
      last-write semantics;
- [x] fault tests cobrem `clear->record`, `record->clear` e clear-all com eventos mais novos
      chegando durante a falha;
- [x] definir self-healing **aditivo/monotônico**: ledger hidratado repara identidades ausentes ou
      estritamente mais novas no SQLite, sem apagar SQLite-only evidence de lanes de probe
      independentes;
- [x] startup reconciliation bounded foi conectada ao owner do mirror e só inicia depois de
      hydration authoritative;
- [x] full mirror permanece operação explícita/reconciliation; o hot path por evento continua
      delta-only.

### E.3 — provider-health hydration authority

- [x] introduzir `readHydratedByokProviderHealthSnapshot()` como boundary authoritative que aguarda
      hydration antes de `list/read`;
- [x] corrigir os consumers críticos auditados: `runtime-health-diff`, `effective-selection`,
      `runtime-selector`, clear e full mirror/reconciliation;
- [x] teste com read artificialmente atrasado prova que snapshot authoritative não observa
      `loaded=false` como vazio;
- [x] teste com schema persistido inválido prova fail-closed, em vez de promover store vazio
      silenciosamente;
- [x] teste de startup reconciliation prova que fato preexistente é materializado uma vez e não é
      regravado quando o latest SQLite já é equivalente;
- [x] reprodução no comando canônico após a correção: `runtime-health-diff` passou de
      `fileRecords=0` falso para `fileRecords=126`, com `sqliteRecords=144` na mesma cópia segura.

### E.4 — backlog reconciliation e operação real

- [x] cópia consistente do DB real passou `integrity_check` antes dos ensaios;
- [x] medir v13→v14 na cópia: ~309 ms na primeira amostra; amostras posteriores ficaram sensíveis à
      pressão de I/O do host;
- [x] medir prune 177.541→100k health + 143.527→100k probes: baseline monolítico de 121.068 deletes
      em ~24,2 s;
- [x] confirmar que logical delete não reduz o DB e deixa freelist reutilizável (~46.854 pages no
      ensaio baseline);
- [x] substituir transação monolítica por reconciliation chunked: default 5.000 rows/transação,
      yield entre batches e retry bounded para `SQLITE_BUSY/LOCKED`;
- [x] aplicar o mesmo executor chunked aos demais ledgers e ao orphan cleanup de handoff
      transitions, eliminando a antiga transaction agregadora;
- [x] adicionar índices covering `(observed_at_ms, key)` para runtime retention e assertions de
      `EXPLAIN QUERY PLAN` sem `TEMP B-TREE`;
- [x] métricas: rows/batch, batches, txn p50/p95/max, total duration, busy/retry count, WAL
      pages/bytes, checkpoint result, freelist/page-count before/after e `budgetSatisfied`;
- [x] tornar checkpoint policy explícita: `wal_autocheckpoint=0` durante maintenance, PASSIVE final
      medido, restauração no `finally`; checkpoint pesado foi offloaded para Worker no owner
      Infra/path-bound, nunca executado sincronamente pelo control-plane;
- [x] provar que checkpoint failure é pós-commit telemetry e não falso rollback da retention já
      persistida;
- [x] benchmark concorrente controlado de reader + writer + reconciliation convergiu para 100k+100k,
      sem `SQLITE_BUSY`, corruption ou FK violations;
- [x] benchmark checkpoint-only isolou a pressão de I/O: ~172.438 WAL pages em ~8,56 s; writer
      baseline p95 ~8,2 ms → checkpoint p95 ~674 ms/max ~1,68 s → pós p95 ~10 ms; reader baseline
      p95 ~5,2 ms → checkpoint p95 ~13,3 ms → pós ~4,0 ms;
- [x] VACUUM/space reclamation permanece maintenance separada, nunca hot/request path;
- [ ] backup/integrity gate imediatamente antes da **retention real intencional**;
- [x] `data/copilot.sqlite` está em v14; a migration ocorreu acidentalmente em harness mal
      direcionado depois de E.2/E.3 já verdes, foi investigada e não será tratada como promoção
      controlada;
- [ ] reconciliar history real para budgets somente na Faixa I, após os demais blockers de
      source/authority e backup imediato;
- [ ] integrity/latest-equivalence check pós-operação real intencional.

**Checkpoint E local — 2026-08-26:** storage spec chegou a **14/14**, Infra/boot afetados a
**12/12**, ESLint focal e TS7 strict verdes. Retry/hydration/self-healing e reconciliation chunked
estão fechados localmente. O banco real está v14, porém o histórico removido pelo incidente foi
reinserido seletivamente e voltou a 177.541 health + 143.527 probes; não houve retention real
intencional.

**Gate E:** **fechado localmente para prosseguir a B/C**, mas a parcela operacional sobre o DB real
permanece deliberadamente aberta e pertence à Faixa I: backup imediato, retention intencional,
integrity e latest-equivalence pós-op.

## Faixa F — cache/fingerprint e snapshot stability

- [x] separar operational-state fingerprint de security-proof fingerprint: cache operacional e proof
      content-aware possuem identities/lifetimes independentes;
- [x] cachear fresh result **somente** quando
      `initialFingerprint.value === completedFingerprint.value`;
- [x] se o estado mudar durante build, descartar cache e retornar fail-closed
      `unstableSnapshot=true`, `parsed=null` e retry-required; nunca rekeyar snapshot intermediário
      como final;
- [x] evitar TTL curto invalidando proof cara quando conteúdo não mudou: security proof é
      context/fingerprint-bound e não usa o TTL operacional;
- [x] explicitar/validar freshness budget operacional de 30 s; mudanças persistidas entram no
      fingerprint e teste injeta o clock no boundary exato 30.000/30.001 ms;
- [x] substituir fingerprint SQLite baseado em `COUNT(*)` por token O(1) governado
      (`PRAGMA data_version` + `total_changes` da conexão);
- [x] single-flight compartilhado foi removido; não reintroduzir até existir ownership por
      subscriber comprovado;
- [x] cancellation concorrente entre callers deixou de compartilhar a mesma Promise fresh;
- [x] remover `catalogStaticReadinessCache`, `readinessStoreContext` e `modeContexts`, que eram
      call-local após subprocess/Workers one-shot;
- [x] resolver `COPILOT_DB_PATH`: boot e readiness usam `resolveApplicationSqlitePath`; DB path é
      process-composition-only e `.env.local` não pode divergir a readiness do DB já composto pelo
      MCP;
- [x] testes de stable hit/miss, state mutation durante build, DB customizado, caller cancellation
      concorrente e proof reuse através de estados operacionais fresh;
- [x] adicionar boundary test explícito de expiração TTL sem esperar wall-clock real.

**Gate F — FECHADO LOCALMENTE:** snapshot stability, DB authority, cache cancellation semantics, TTL
boundary e separação operational/security estão comprovados. Durante o rebaseline, o fingerprint
O(1) revelou ainda uma migration histórica reexecutada em todo reopen v14; o migrator foi
version-gated e regression cross-connection prova `dataVersionDelta=0`/`totalChangesDelta=0` ao
reabrir schema corrente.

## Faixa G — result/wire contract compacto

- [x] rebaseline do objeto: ~12.562 B compact / ~18.774 B pretty na fresh readiness auditada;
- [x] remover pretty JSON integral duplicado do default `content.text`;
- [x] gerar resumo textual task-first de decisão;
- [x] manter `structuredContent` como authority única;
- [x] `includeDetails` opt-in para phases/large diagnostics;
- [x] adicionar conservative result-size hint não enumerável para o registry;
- [x] budget default <16 KiB para `includeDetails=false`, provado com árvore diagnóstica fixture >80
      KiB;
- [x] testar schema/output parity: default omite árvore grande e detailed preserva a structured tree
      inteira enquanto o texto continua curto.

**Gate G — FECHADO LOCALMENTE:** wire default é task-first, compacto e não duplica a árvore; details
continuam disponíveis explicitamente.

## Faixa H — testability/composition e fault matrix

- [x] extrair capabilities/ports onde trazem fault injection/authority real: SQLite fingerprint, env
      authority, explicit store/checkpoint e supervised live-command runner;
- [ ] reduzir adicionalmente dependência do provider global no builder apenas se nova fault
      injection justificar a abstração; não criar port ornamental;
- [x] slow/native SQLite path coberto por fixture que entra efetivamente em `better-sqlite3` antes
      do abort e prova hard-drain <2 s;
- [x] fake/stuck outer process/worker classes cobertas por cancellation/timeout/output-limit
      fixtures;
- [ ] redaction Worker **de produção** stuck após marker real; o nested-worker registry fault já
      cobre ownership, mas não introduzimos marker só para teste;
- [x] fake SQLite write failure + retry ordering (`clear->record`, `record->clear`, clear-all +
      newer events);
- [x] fake hydration delayed/failed e schema inválido fail-closed;
- [x] fake state mutation entre initial/completed fingerprint + stable retry;
- [x] teste de env authority/negative secret inheritance e DB-path authority;
- [x] duas readiness concorrentes com uma cancellation sem Promise compartilhada;
- [ ] shutdown do process host durante readiness ativa — residual de lifecycle host/composition,
      separado da cancellation por caller já provada;
- [x] registry-level usa a definição real `llmb_live_readiness`, inclusive nested-worker e
      native-SQLite cancellation, não apenas helper genérico.

**Gate H — fechado para os riscos causais críticos; dois residuais explícitos permanecem:** marker
do redaction Worker real e shutdown simultâneo do process host. Nenhum deles invalida os proofs de
caller cancellation/native SQLite já obtidos; devem ser fechados se um seam natural surgir ou se a
acceptance host-real revelar necessidade.

## Faixa I — migration/reload e host-safe MCP acceptance

- [x] **não executar reload enquanto E.2/E.3 não estiverem verdes**; esse barrier local foi
      respeitado para source promotion, embora um harness de benchmark tenha atingido diretamente o
      arquivo SQLite sem reload;
- [ ] focused barrier: storage retry/hydration/cache/env/cancellation + strict/lint verdes;
- [ ] backup + `integrity_check` do DB real imediatamente antes da retention real e antes da
      publicação/reload controlados;
- [x] registrar o incidente de migration v13→v14 fora da promotion path: latest pointers
      equivalentes à baseline, histórico removido reinserido seletivamente e `integrity_check`/FK
      verdes;
- [ ] controlled reload para o source exatamente publicado;
- [ ] validar explicitamente o DB **já v14** no runtime promovido, sem depender de nova migration
      escondida em “primeira readiness”;
- [ ] `runtimeSourceDrift=false`;
- [ ] executar 3 fresh readiness em sequência sem `TaskGroup`;
- [ ] após cada uma executar tools curtas (`git_status`, `mcp_runtime_health`);
- [ ] cancelar deliberadamente uma readiness e provar drain rápido;
- [ ] repetir com `includeSqliteRuntimeHealth=true`;
- [ ] provar memory plateau pós-calls;
- [ ] Cloudflare/OAuth gates verdes;
- [ ] LLM-B control-only harness verde;
- [ ] somente então executar retention/reconciliation real chunked, com checkpoint telemetry, e
      validar latest-equivalence/integrity;
- [ ] live model/provider gate somente se ainda necessário.

**Gate I:** source promovido, DB migrado/reconciliado de forma observável e sessão host permanece
saudável após sucesso/cancelamento.

## Faixa J — documentação e fechamento

- [x] atualizar Model Gateway README com safety/performance/readiness/retention atuais;
- [x] atualizar MCP README com subprocess cancellation, cache/proof e wire contract;
- [x] atualizar este documento com a reauditoria profunda e o checkpoint quantitativo final de
      2026-08-26;
- [x] reconciliar roadmap 2.4 com checkpoint supersedente de hardening local, sem apagar a promoção
      histórica de 25/08;
- [x] registrar benchmarks before/after finais, incluindo E.1 100k/250k/500k e readiness 1/5/20
      hash-bound;
- [x] remover caches/rationales obsoletos revelados pela nova arquitetura; nenhum shim do outer
      Worker/single-flight foi preservado;
- [ ] commit/push coeso por barrier;
- [x] fechar checkboxes somente no nível comprovado (unit/registry/process); acceptance host-real e
      retention real permanecem explicitamente abertos.

**Gate J(pre) — fechado:** código, contratos e docs locais contam a mesma história. **Gate J(post)**
só fecha depois de publicação/reload, acceptance host-real, retention real intencional e rastreio
final de commit/push.

---

# 17. Critérios de validação desta campanha

Seguindo a política vigente do workspace, validação ampla é excepcional.

Durante transformação:

1. testes focais de cancellation/worker/cache/store;
2. TS7 strict ocasionalmente;
3. lint apenas nos arquivos afetados quando suficiente;
4. benchmark causal medido;
5. architecture gate apenas quando ownership/import/state contracts mudarem.

Somente no barrier de publicação:

- strict;
- lint pertinente;
- architecture/state/public-cost se afetados;
- Prettier/diff-check;
- focused matrix completa da campanha;
- suíte ampla MCP apenas se o raio da transformação justificar.

Não repetir full suite após pequenas correções.

---

# 18. Critérios de commit/push

Commit/push desta campanha só é permitido quando:

1. cancellation não está mais semanticamente falsa;
2. nenhum worker/promise call-scoped fica órfão nos testes de abort;
3. mudanças de memory lifecycle possuem métricas e regressions;
4. retention não destrói evidência necessária;
5. redaction proof continua fail-closed;
6. wire payload permanece compatível com o MCP output contract;
7. docs refletem o estado exato;
8. barriers focais pertinentes estão verdes;
9. o manifest capturado antes da validação continua byte-identical no verify pós-validação e
   imediatamente antes da publicação;
10. qualquer source drift é explicado por uma transition controlada ou bloqueia promoção como
    `unattributed source mutation`.

Host-real é gate de **promoção**, não motivo para esconder source certificado. Se o host falhar
depois da publicação, registrar o delta causal e corrigir em follow-up rastreável, como ocorreu com
o smoke MCP 2026.

---

# 19. Definition of Done especializada

A campanha pode ser considerada encerrada quando:

- [x] `llmb_live_readiness` é realmente cancellable end-to-end no boundary registry→subprocess;
- [x] abort drena dentro do budget comprovado, inclusive durante native `better-sqlite3`;
- [x] fault tests críticos não produzem `MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT`;
- [x] redaction workers têm lifecycle explícito one-shot;
- [x] worker memory possui telemetry opt-in e budget (`resourceLimits`);
- [x] RSS/HWM converge em chamadas repetidas e lifecycle retorna a zero;
- [x] deep redaction proof é fingerprint-aware e fail-closed;
- [x] fresh operational readiness não exige normalmente scan de ~2 M strings quando proof válida
      existe;
- [ ] SQLite retention está implementada por owner claro, mas a aplicação **real intencional** ainda
      aguarda Faixa I;
- [x] runtime-health query permanece eficiente com crescimento histórico até 500k/ledger no
      benchmark sintético;
- [x] cache/single-flight são cancellation-aware por remoção do shared in-flight;
- [ ] comparação direta registry-vs-domain ainda não é publicada, embora as fases individuais
      relevantes sejam medidas;
- [x] default wire result é compacto e não duplica dump integral;
- [x] unit/fault tests cobrem stuck outer work, native slow SQLite, retry/hydration e cancellation
      concorrente;
- [x] fresh operational proof-reuse atinge o SLO local rebaselineado p95 ≤7,0 s;
- [ ] 3 fresh host-real calls consecutivas não degradam a sessão;
- [ ] cancellation host-real não impede chamadas curtas subsequentes;
- [ ] LLM-B control plane no **source promovido** continua ready e provider routing não regrediu;
- [x] docs/roadmaps/semantic contract correspondem ao comportamento local certificado após a
      reconciliação final; host-real permanece separado na Faixa I;
- [ ] commit/push/reload/runtime promotion estão rastreados.

---

# 20. Próxima ação imediata — ordem revisada

E.1/E.2/E.3/E.4, B/C, D, F, G e S estão fechados no nível local necessário para promoção; A fechou o
rebaseline/SLO, restando apenas a projeção diagnóstica direta registry-vs-domain. H cobre todos os
fault cases causais críticos e mantém dois residuais não bloqueantes explicitamente abertos. O DB
real segue v14, com histórico restaurado após o incidente antigo e **sem retention real
intencional**.

Ordem obrigatória corrente:

```text
0  manter DB real v14 íntegro e sem retention intencional até o gate I
-> [x] E.1 latest-read 100k/250k/500k + query-plan assertions
-> [x] E.2/E.3 retry + hydration + self-healing
-> [x] E.4 reconciliation chunked + async checkpoint architecture em cópias
-> [x] B/C subprocess supervisionado + env authority + lifecycle/memory governance
-> [x] D security proof fingerprint-aware separada do estado operacional
-> [x] F cache/snapshot stability + fingerprint O(1) + DB-path authority
-> [x] G wire task-first <16 KiB por default
-> [x] S source-integrity/CAS/barrier/promotion boundaries
-> [x] A rebaseline final 1/5/20 hash-bound; SLO local proof-reuse p95 <= 7,0 s
-> [~] H fault matrix crítica fechada; redaction-real marker e shutdown-during-readiness continuam residuais explícitos
-> [x] J(pre) reconciliar canônico + READMEs + roadmap 2.4
-> barrier local/publicação: manifest -> focused matrix -> strict/lint/format/architecture pertinentes -> manifest verify
-> I backup/integrity do DB real -> publish do MESMO manifest -> reload controlado -> v14/runtimeSourceDrift -> host acceptance
-> I somente depois: retention real chunked -> latest-equivalence/integrity/FK
-> J(post) registrar evidência host/retention -> commit/push documental final se necessário -> worktree clean/sync
```

**Regra de promoção:** source só pode ser publicado/recarregado se o manifest verificado após
validação for exatamente o mesmo manifest apresentado ao boundary de publish/reload. Host-real é
acceptance pós-promoção; retention real continua proibida até passar os gates anteriores de I.

---

# 21. Reauditoria de continuidade — fotografia anterior à execução E.2–E.4 em 2026-08-26

> Esta seção preserva deliberadamente a fotografia forense da reauditoria **antes** das
> transformações subsequentes. O estado corrente supersedente está na Seção 22; não interpretar os
> itens históricos abaixo como status atual.

## 21.1 Estado do repo e do runtime naquela fotografia

- `HEAD == origin/main == 5d5e0648ba7b461685bba27a70cd6ffc0504b0df` durante a rodada;
- worktree continha as implementações locais B/C/E ainda não publicadas;
- processo MCP conectado não havia sido recarregado e portanto não representava o novo source;
- até aquele ponto não havia ocorrido commit, push, reload ou alteração do banco real;
- naquela fotografia `data/copilot.sqlite` permanecia `user_version=13` e sem as tabelas latest v14.

## 21.2 SQLite real — anatomia read-only

Estado observado:

```text
data/copilot.sqlite                         ~908 MiB
data/copilot.sqlite-wal                     ~20 MiB
health observations                         177.541
runtime probe results                       143.527
runtime probe runs                            3.564
health latest identities                        134
probe latest identity+kind                      160
```

As tabelas base de health/probes ocupam centenas de MiB quando payloads e índices são considerados.
Os dois índices históricos de latest ordering continuam úteis para lookups por modelo e não devem
ser removidos por inferência simplista.

## 21.3 Ensaio em cópia consistente — migration e retention

Uma `.backup` consistente foi criada fora do repo; `integrity_check` passou e as contagens bateram
com o real.

Resultados principais:

```text
v13 -> v14 store construction/backfill        ~309 ms
first latest read após migration               ~6,5 ms
retention 177.541 -> 100.000 health
        + 143.527 -> 100.000 probes         121.068 rows deleted
retention wall                                 ~24,2 s
WAL observado após prune                       ~153 MiB
freelist após prune                            46.854 pages
```

Conclusões:

1. migration v14 é relativamente barata no dataset atual, mas deve ser observada na promoção;
2. retention monolítica é cara demais para compartilhar writer lock com o runtime normal;
3. WAL permite readers concorrentes, mas SQLite continua com um writer por vez; reconciliation
   precisa de transações curtas/bounded e política de retry/busy;
4. delete lógico não é shrink físico; freelist, checkpoint e eventual VACUUM são problemas
   distintos.

## 21.4 Latest projections v14 — hipótese confirmada após correção do experimento

Um primeiro `EXPLAIN` simplificado sem o `ORDER BY` real sugeriu history scan; essa hipótese foi
**rejeitada** ao executar exatamente a SQL do método.

A SQL real de `listLatestRuntimeHealthRecords()` usa:

```text
SCAN latest USING COVERING INDEX idx_mg_runtime_*_latest_observed
-> SEARCH history USING primary/unique key (observation_key/result_key)
```

Logo o desenho latest pointer-only está correto. O benchmark sintético de escala permanece
obrigatório para prevenir regressão do planner/query shape.

## 21.5 Delta mirror — dois blockers de correctness

### Retry ordering

Foi reproduzido sem tocar arquivos:

```text
clear(A)
record novo(A)
write SQLite falha
requeue
=> pendingClear(A)=1
=> pendingRecord(A)=0
retry
=> apenas clear(A)
```

A causa é `requeueFailedBatch()` recolocar clears antes dos records e então descartar records
cobertos por um pending clear. Esse caso precisa de causal ordering/last-write semantics explícitos.

### Self-healing

Também foi reproduzido:

1. ledger já possui identidade A antes de instalar mirror;
2. instalar delta mirror;
3. `flush()` não escreve A;
4. alterar identidade B;
5. flush grava somente B.

O mirror antigo também não fazia startup sync imediato, mas qualquer mudança posterior reespelhava o
ledger completo e acabava reparando A. A versão delta remove essa propriedade eventual. É necessário
startup reconciliation/checksum separado do hot delta path.

## 21.6 Divergência real JSON ↔ SQLite

Leitura direta do estado real encontrou:

```text
byok-provider-health.json records      126
SQLite latest health groups            134
identidades apenas no JSON                4
identidades apenas no SQLite             12
```

Isso não autoriza escolher automaticamente um lado como “verdade” sem considerar clear, probe merge
e timestamps, mas comprova que reconciliation não é apenas preocupação teórica.

## 21.7 Hydration race

`provider-health.js` dispara `void hydrateByokProviderHealthFromDisk()` no import. Leitores
síncronos continuam disponíveis antes de `loaded=true`.

Na execução canônica `model-gateway-runtime-health-diff` contra a cópia SQLite, o comando reportou:

```text
fileRecords=0
sqliteRecords=144
```

mesmo com 126 records no JSON. O script chama `listByokProviderModelHealth()` sem aguardar
hydration. O mesmo padrão aparece em outros consumers e deve ser auditado owner por owner.

## 21.8 Worker containment versus environment authority

O novo outer Worker melhorou substancialmente cancellation/lifecycle. Porém `new Worker(...)` não
recebe a opção `env`; por semântica do Node ele herda uma cópia de `process.env` do pai. O processo
MCP atual contém nomes de chaves relacionadas a session hash/OAuth além das chaves Model Gateway.
Nenhum valor secreto foi lido nesta auditoria.

Portanto:

- `workerData.env` filtrado é útil para APIs que o respeitam;
- ele **não** constitui sandbox/least-privilege de `process.env`;
- outer e redaction Workers devem receber `WorkerOptions.env` explicitamente minimizado;
- deve existir teste negativo de não-herança.

Microteste separado confirmou que, no Node 24 deste ambiente, terminar o outer Worker impediu um
nested Worker controlado de produzir efeito tardio. Isso reduz a hipótese de worker filho órfão, sem
substituir os fault tests reais da readiness.

## 21.9 Fresh readiness do worktree em cópia isolada

Medição sem tocar o DB real:

```text
builder total                         ~7.040 ms
outer Worker observado               ~8.109 ms
catalog redaction outer              ~7.023 ms
SQLite redaction outer               ~7.022 ms
catalog redaction core               ~2.232 ms
SQLite redaction core                ~1.129 ms
source snapshot read                 ~2.696 ms
SQLite snapshot read                 ~1.665 ms
selection + selector plans           ~3.540 ms
redaction scanned strings            ~2,013 M
```

Os valores acima estão em **milissegundos** no objeto, equivalendo a ~7,04 s, ~8,11 s etc. Redaction
é a wall-clock dominant phase porque roda em paralelo com outras fases, mas não é o único custo
relevante. O target `<2 s` fresh exige otimização também de snapshot/parity/selection.

## 21.10 Coverage real do redaction check

O catalog audit percorre o valor do snapshot de catálogo. O audit SQLite chama
`auditStoredPayloadRedaction()` com default `maxRowsPerTable=25`, percorrendo até 25 payload rows
por tabela com `payload_json`.

Como esses payloads são densos, a amostra ainda contém ~1,07 M strings SQLite; isso não transforma,
porém, a amostragem bounded em prova exaustiva de todo o histórico. O output futuro precisa declarar
coverage para que `ok=true` tenha significado preciso.

## 21.11 Cache correctness

A fresh path calcula fingerprint inicial e final, mas atualmente faz:

```text
build sob estado inicial
-> estado pode mudar
-> fingerprint final muda
-> cache.set(fingerprintFinal, parsedConstruidoAntes)
```

Sem equality gate, o cache pode certificar snapshot misto como correspondente ao estado final. A
solução não é aumentar TTL: é garantir snapshot stability e separar validade de conveniência
temporal.

Além disso, `catalogStaticReadinessCache` e `modeContexts` ficaram dentro de Workers one-shot;
portanto não sobrevivem a uma fresh call e não podem ser tratados como mecanismo cross-call de
performance.

## 21.12 DB path authority

O report usa `<workspace>/data/copilot.sqlite` fixo e o environment authority explícito não
transporta `COPILOT_DB_PATH`. Hoje o deployment real usa o default, então isso não explica o
incidente atual; é, porém, um gap de portability/authority e impede considerar a composition correta
em ambientes customizados.

## 21.13 Wire result

Na fresh readiness medida:

```text
JSON compact parsed                  12.562 bytes
JSON pretty parsed                   18.774 bytes
```

`llmb_live_readiness` chama `okResult(parsed, JSON.stringify(parsed, null, 2))`; portanto
`structuredContent` e `content.text` duplicam a mesma árvore lógica. G permanece dívida real, embora
não seja a causa dos hangs históricos.

## 21.14 Validação executada nesta reauditoria

Sem transformar source:

- `test_model_gateway_runtime_health_storage.spec.js`: 5/5;
- `test_mcp_llmb_readiness_worker.spec.js`: 3/3;
- `test_mcp_registry.spec.js`: 25/25;
- matriz combinada: **33/33 verde**;
- ESLint focal dos arquivos da campanha: verde;
- `npm run typecheck:strict:src.copilot`: verde;
- syntax checks dos arquivos principais: verdes;
- DB real: somente leitura;
- cópias `/tmp`: usadas para migration/retention/readiness benchmarks e podem ser descartadas sem
  efeito no repo.

## 21.15 Decisões arquiteturais consolidadas

1. **Manter outer readiness Worker call-scoped.** A direção de containment é correta.
2. **Não restaurar persistent redaction pool.** Proof caching deve ocorrer como metadata governada,
   não como processo pesado imortal.
3. **Manter schema v14/latest projections**, condicionando promoção aos blockers E.2/E.3.
4. **Manter delta mirror no hot path**, mas somente após tornar retry ordering correto e adicionar
   self-healing/reconciliation separado.
5. **Não executar retention real monolítica.** Implementar job chunked/observável.
6. **Não fazer reload agora.** Primeiro fechar correctness + authority local; só depois
   migrar/promover de forma controlada.
7. **Não considerar tests verdes como prova dos casos ainda não escritos.** A campanha agora possui
   fault matrix explícita para impedir falso fechamento.

---

# 22. Continuação executiva E.2–E.4 — estado corrente após implementação e benchmarks

## 22.1 E.2/E.3 fechados localmente

A sequência posterior à reauditoria corrigiu os dois blockers de correctness que impediam qualquer
avanço seguro:

- `requeueFailedBatch()` preserva causalidade entre batch falho e eventos mais novos;
  `clear->record`, `record->clear` e clear-all concorrente passaram a ser fault cases explícitos;
- `readHydratedByokProviderHealthSnapshot()` tornou hydration uma authority aguardada e fail-closed;
- persistence com schema inválido não é mais promovida a store vazio;
- startup reconciliation é aditiva/monotônica: materializa ledger facts ausentes/mais novos sem
  apagar SQLite-only evidence de lanes independentes;
- `runtime-health-diff` contra a mesma cópia segura passou do falso `fileRecords=0` para
  `fileRecords=126`;
- o hot mirror permanece delta-only e full/reconciliation deixou de ser efeito colateral de toda
  mudança.

## 22.2 E.4 — retention chunked, query plan e WAL governance

A retention foi transformada de uma única transaction ampla para um executor bounded:

```text
batchDeleteRows default                 5.000
transaction boundary                    1 batch
busy/locked retry                       bounded + backoff
yield                                   entre batches
runtime latest                          protegido por pointer tables v14
standard ledgers                        também chunked
handoff orphan cleanup                  também chunked
```

Foram adicionados índices covering de retention `(observed_at_ms, observation_key/result_key)`.
`EXPLAIN QUERY PLAN` dos dois hot deletes usa os índices dedicados e não retorna `TEMP B-TREE`.

A instrumentação agora reporta transaction count, rows/batch, p50/p95/max, total duration, retries,
`budgetSatisfied`, freelist/page-count, WAL pages/bytes, checkpoint status e duração.
`wal_autocheckpoint` é temporariamente zerado durante a maintenance e sempre restaurado no
`finally`, evitando checkpoints automáticos invisíveis no meio dos commits.

## 22.3 Checkpoint: owner Infra e offload de `better-sqlite3`

O checkpoint PASSIVE deixou o `SqliteModelGatewayCatalogStore` como operação síncrona de driver. A
nova fronteira é:

```text
Model Gateway retention policy
-> capability async checkpoint()
-> ApplicationInfraHost
-> BetterSqliteApplicationRuntime (owner de dbPath/driver)
-> Worker thread dedicada
-> PRAGMA wal_checkpoint(PASSIVE)
```

O Worker recebe `env: {}` e somente `dbPath`/busy timeout via `workerData`; chamadas concorrentes do
mesmo runtime são coalescidas. Falha/timeout de checkpoint é registrada como telemetry pós-commit e
não converte retention já persistida em falso rollback.

Isso preserva o invariant arquitetural: domain Store não aprende `dbPath`, não importa
`better-sqlite3` e não ganha `child_process` authority.

## 22.4 Benchmarks de E.4

### Baseline monolítico

Na cópia consistente original:

```text
121.068 deletes                        ~24,2 s
WAL                                     ~153 MiB
freelist                                ~46.854 pages
```

### Implementação chunked + Worker checkpoint sob concorrência

Em cópia v13 limpa, com migration para v14, reader latest, writer runtime-health e reconciliation
concorrentes:

```text
retention deleted rows                  121.102
transaction count                            25
txn p50                                ~143,8 ms
txn p95                                ~161,6 ms
txn max                                ~182,3 ms
busy retries                                  0
checkpoint WAL pages                    178.815
checkpoint Worker duration              ~9,56 s
checkpoint outer duration               ~9,82 s
reader p95 durante checkpoint            ~4,31 ms
writer p95 durante checkpoint            ~9,08 ms
reconciliation errors                         0
final convergence health/probes          100k/100k
integrity_check                               ok
foreign_key_check violations                  0
```

Essa amostra teve um outlier writer/event-loop de ~7,43 s enquanto retention/checkpoint/other
synchronous SQLite work competiam por I/O, razão pela qual foi executado um experimento isolado.

### Checkpoint-only isolado

Primeiro foi criado WAL grande sem checkpoint; depois retention parou e writer/reader foram medidos
antes/durante/depois de um único Worker checkpoint:

```text
checkpoint WAL pages                    172.438
checkpoint wall                         ~8,56 s

writer baseline p95                      ~8,17 ms
writer checkpoint p95                  ~674,3 ms
writer checkpoint max                 ~1.679 ms
writer pós p95                           ~9,99 ms

reader baseline p95                      ~5,20 ms
reader checkpoint p95                   ~13,33 ms
reader checkpoint max                  ~347,7 ms
reader pós p95                           ~4,04 ms

SQLITE_BUSY/errors                            0
integrity_check                               ok
foreign_key_check violations                  0
```

Conclusão: Worker offload elimina o bloqueio JavaScript direto, mas não pode eliminar a competição
física de I/O de um checkpoint grande. A pressão é temporária, mensurável e reverte ao baseline. Por
isso checkpoint permanece uma fase explícita de maintenance com telemetry; VACUUM/shrink continua
separado.

## 22.5 Incidente control-plane durante benchmark e remediação do DB real

Um harness concorrente foi aberto sem `COPILOT_DB_PATH` para a conexão de maintenance. O
`SqliteModelGatewayCatalogStore()` default resolveu o provider da aplicação e atingiu
`data/copilot.sqlite` real. A execução foi interrompida assim que o target incorreto foi
identificado.

Impacto forense observado:

```text
schema real                              v13 -> v14
probe history removido                       43.527
health history removido                      20.000
latest pointers pós-incidente          160 probes / 134 health
integrity_check                                   ok
```

A baseline consistente anterior e um snapshot pós-incidente foram comparados por chave. Não havia
rows novos de health/probe entre os dois snapshots; outros subsistemas do DB, porém, haviam recebido
writes legítimos, de modo que restaurar o arquivo inteiro seria incorreto.

A remediação foi portanto seletiva e idempotente:

```text
probe rows reinseridos                       43.527
health rows reinseridos                      20.000
missing probes após restore                       0
missing health após restore                       0
latest hash before == after                    true
foreign_key violations                            0
```

Estado real validado após remediação:

```text
user_version                                  14
health observations                       177.541
runtime probe results                     143.527
runtime probe runs                          3.564
health latest                                 134
probe latest                                  160
integrity_check                                ok
```

A migration v14 não será artificialmente desfeita. O histórico voltou ao baseline e nenhuma
retention real intencional será executada antes da Faixa I.

## 22.6 Validação corrente

Após o checkpoint Worker e a nova fault semantics:

- `test_model_gateway_runtime_health_storage.spec.js`: **14/14**;
- Infra/boot diretamente afetados: **12/12**;
- checkpoint Worker real em arquivo temporário: verde;
- checkpoint failure pós-commit: verde;
- query-plan assertions: verdes;
- ESLint focal: verde;
- `npm run typecheck:strict:src.copilot`: verde;
- cópias de benchmark: `integrity_check=ok`, sem FK violations;
- nenhum commit/push/reload foi executado.

## 22.7 Próximo owner de ataque

E.2/E.3/E.4 deixam de ser o blocker local imediato. B/C avançaram em semantic contract e environment
authority, mas uma nova fault proof alterou o estado-alvo:

1. rationale de `repo_status`/`llmb_live_readiness` foi corrigido;
2. outer/redaction Workers receberam `WorkerOptions.env` explícito; `COPILOT_DB_PATH` foi
   incorporado à projection;
3. teste negativo outer+nested e execução real outer+redaction confirmaram ausência de ambient
   MCP/OAuth/session;
4. registry cancellation após nested Worker iniciado fechou sem drain timeout e sem child tardio;
5. porém cancellation **dentro de query `better-sqlite3` nativa** demonstrou que
   `Worker.terminate()` não é hard kill confiável.

O próximo owner é, portanto, substituir somente a unidade outer por subprocesso supervisionado,
mantendo redaction Workers one-shot dentro dele. Depois vêm F/cache-snapshot stability e D.

**NO-RELOAD continua vigente.** O fato de o DB já estar v14 não autoriza promover o source enquanto
B/C/F/H estiverem abertos.

## 22.8 Rejeição empírica do outer Worker como hard-cancellation boundary

Foi criado um fault case que escreve um marcador imediatamente antes de entrar numa query
`better-sqlite3` síncrona longa. O caller só aborta **depois** do marcador existir, removendo a
corrida observada em microtestes anteriores onde terminate podia vencer antes da entrada real no
código nativo.

Resultado no runner Worker atual:

```text
estado no abort                 dentro de query SQLite nativa
Worker.terminate -> exit        ~14.721 ms? não: ~14.721 s
registry drain budget           15.000 ms
margem                         praticamente nula
```

A mesma classe de query foi executada em um `child_process` isolado; após o marcador confirmar
entrada no native call, `SIGKILL` + observação de exit custou:

```text
kill drain                      ~1,06 ms
```

Isso não é argumento genérico contra Workers. Pelo contrário, confirma `INV-2.4-19/21.2`: Worker é
apropriado para CPU-bound redaction scanning, mas não deve ser usado como substituto de uma
fronteira de processo para I/O síncrono/native code quando o contrato exige hard cancellation.

**Decisão arquitetural:**

```text
MCP registry/main process
  -> subprocess readiness call-scoped, env authority explícita, process-group supervision
       -> synchronous SQLite/readiness work
       -> redaction Worker catalog (CPU scan)
       -> redaction Worker SQLite (CPU scan + bounded row reads)
```

O subprocess outer deve reutilizar o owner já existente
`mcp/integrations/model-gateway/live-runs/runtime.js`; não criar novo `child_process` owner em
tool/catalog. Abort/timeout usa supervisor `SIGTERM -> grace curta -> SIGKILL`, e o handler só
settle após `close`. O runner Worker intermediário deve ser removido, não mantido como compat/shim.

## 22.9 Implementação e validação do subprocess outer

A decisão acima foi implementada integralmente no worktree nesta rodada:

1. `readiness.js` deixou de importar/instanciar `readiness-worker.js` e passou a usar
   `runModelGatewayLiveReadinessProcess()` do owner `live-runs/runtime.js`;
2. `runModelGatewayLiveCommand()` seleciona `readinessEnvironment()` para o comando `readiness` e
   usa process-group supervision;
3. para readiness, abort/timeout usam grace `0`: SIGTERM e SIGKILL são solicitados no mesmo
   boundary, e a Promise só resolve após `close`;
4. authority subiu para schema v3 e ganhou projection semântica `readinessEnvironment()`, distinta
   de `liveRunEnvironment({ invokesRealProvider:true })`;
5. nomenclatura stale foi removida: `fresh-worker` -> `fresh-process`, `workerMs` -> `processMs`,
   `call-scoped-worker` -> `call-scoped-process`;
6. `readiness-worker.js`, `model-gateway-live-readiness-worker.mjs` e o teste específico desse shim
   foram removidos, sem camada de compatibilidade.

Fault proofs sobre a **tool canônica** `llmb_live_readiness`:

```text
registry -> readiness adapter -> subprocess -> nested Worker iniciado -> abort
resultado: MCP_TOOL_CANCELLED
MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT: não
nested efeito tardio: não
```

E, no caso mais importante:

```text
registry -> readiness subprocess -> better-sqlite3 native query iniciada -> abort
resultado: MCP_TOOL_CANCELLED
MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT: não
drain: < 2 s no gate do teste
```

A readiness real também foi executada contra `/tmp/llmb-readiness-process-real.sqlite`, cópia
isolada do baseline:

```text
process success                 true
process duration                ~19.914 s
exitCode                        0
signal                          null
parsed                          true
checks                          14
stdout                          18.880 bytes
stderr                          0 bytes
env keys                        6
SQLite user_version             14
SQLite integrity_check          ok
```

A projection mínima dessa execução continha somente `PATH`, `HOME`, `LANG`, `COPILOT_DB_PATH`,
`MODEL_GATEWAY_LOAD_DOTENV=false` e `COPILOT_TERMINAL_LOAD_DOTENV_LOCAL=false`; nenhum ambient
MCP/OAuth/session foi necessário.

Validação focal após a migração:

- syntax checks: verdes;
- `test_mcp_llmb_readiness_registry_cancellation.spec.js`: **2/2**;
- `test_mcp_model_gateway_live_run_boundaries.spec.js`: **9/9**;
- `test_mcp_registry.spec.js`: **26/26**;
- total focal: **37/37**;
- ESLint focal: verde;
- `npm run typecheck:strict:src.copilot`: verde.

**Conclusão B/C:** o blocker de hard cancellation foi removido. A latência fresh continua alta
(~19,9 s nesta execução), portanto containment e performance permanecem concerns separados. O
próximo blocker de correctness volta a ser **F: snapshot/fingerprint/cache stability + DB-path
report authority**.

## 22.10 Faixa F — snapshot stability, caches mortos e DB-path authority

A revisão de F confirmou o bug de cache descrito na auditoria: depois de um build fresh, o adapter
usava o fingerprint final como nova chave sem exigir igualdade com o fingerprint inicial. O
comportamento foi corrigido fail-closed:

```text
initialFingerprint == completedFingerprint
  -> parsed pode ser cacheado sob a identidade comum

initialFingerprint != completedFingerprint
  -> unstableSnapshot = true
  -> parsed = null
  -> success = false
  -> nada é escrito no cache
  -> caller deve repetir explicitamente
```

Não foi adotado retry automático porque uma fresh readiness ainda custa dezenas de segundos;
duplicar implicitamente esse custo esconderia instabilidade e pioraria cancellation/latency
semantics.

Regression test `test_mcp_llmb_readiness_cache.spec.js` prova:

- fingerprint estável: primeira call `fresh-process`, segunda `memory-cache`, apenas um subprocesso
  executado;
- mutação entre initial/completed: primeira call falha como unstable e não cacheia; segunda
  reconstrói via subprocesso; somente a terceira pode ser cache hit.

Também foram removidos caches sem lifetime útil:

- `catalogStaticReadinessCache`;
- `readinessStoreContext`;
- `modeContexts` do redaction service.

Como cada fresh readiness agora vive em subprocesso próprio e cada redaction audit em Worker
one-shot, esses objetos nunca ofereciam cache cross-call. A remoção também elimina os campos de
report `sourceCatalogStaticHit/sourceSelectionStaticHit`, que transmitiam uma otimização inexistente
entre chamadas reais.

### 22.10.1 Uma única autoridade para `COPILOT_DB_PATH`

Foi criado `resolveApplicationSqlitePath()` no owner `infra/composition/database/sqlite`, exposto
pela membrane pública de composition. Boot e readiness usam agora a mesma resolução para default,
paths relativos, diretórios, paths absolutos e `:memory:`.

Além disso, `COPILOT_DB_PATH` foi separado das variáveis carregáveis de `.env.local`: ele pertence à
**process composition generation**. Isso evita o cenário em que o MCP principal já
compôs/fingerprintou DB A e uma readiness child, ao preparar sua authority a partir de `.env.local`,
troca silenciosamente para DB B.

Testes confirmam que:

- `.env.local` não entra com `COPILOT_DB_PATH` na projection;
- o valor capturado do processo permanece após `prepare()` mesmo se o arquivo tentar declarar outro
  path;
- default/relative/directory/absolute/`:memory:` têm resolução determinística.

Prova real em cópia isolada:

```text
configured/opened DB          /tmp/llmb-readiness-f-db-authority.sqlite
report sqlitePath             /tmp/llmb-readiness-f-db-authority.sqlite
paths equal                   true
cache field stale             ausente
process duration              ~15.808 s
stderr                        0 bytes
SQLite user_version           14
SQLite integrity_check        ok
```

Validação focal de F após os ajustes:

- `test_mcp_llmb_readiness_cache.spec.js`: **2/2**;
- `test_mcp_llmb_readiness_registry_cancellation.spec.js`: **2/2**;
- `test_mcp_model_gateway_live_run_boundaries.spec.js`: **9/9**;
- `test_sqlite_application_path.spec.js`: **4/4**;
- `test_mcp_registry.spec.js`: **26/26**;
- total: **43/43**;
- ESLint focal: verde;
- TS7 strict `src/copilot`: verde.

**Próximo ataque (atualizado):** F correctness e D security-proof correctness estão fechadas
localmente. Antes de medir A novamente, a campanha fecha **S: source-integrity/promotion barrier**,
motivada pela mutação semântica não atribuída observada às 16:46:37.761. Em seguida o owner volta a
ser **A: rebaseline causal de performance sobre a arquitetura final de subprocess + proof reuse**,
separando snapshot JSON/SQLite, selection/plans, security fingerprint initial/final,
bootstrap/import/process e serialization antes de qualquer otimização.

---

# 24. Fechamento local da Faixa D — security proof fingerprint-aware

## 24.1 Semântica final

A readiness passa a tratar duas freshness dimensions independentes:

```text
operational readiness
  -> cache curto/30 s
  -> invalidado por estado operacional

redaction security proof
  -> sem TTL de segurança
  -> context-bound à environment authority corrente
  -> catalog: exhaustive sobre snapshot normalizado
  -> SQLite: bounded sobre N rows/tabela
  -> reuse somente se context + coverage + content fingerprints forem idênticos
```

A proof fica somente em memória no MCP (`WeakMap` por environment authority). Isso é intencional:
restart ou rotação/recriação da authority força nova prova, em vez de carregar evidência de uma
geração de credenciais anterior. `contextId` é UUID opaco; não é hash de segredo. Nenhum
payload/secret é persistido ou transportado como metadata da proof.

## 24.2 Coverage observada na cópia realista

```text
catalog mode                    exhaustive (normalized snapshot)
catalog scanned strings         945.249
SQLite mode                     bounded
SQLite max rows/table            25
SQLite payload tables            30
SQLite rows in proof             678
SQLite payload bytes             79.360.659
SQLite scanned strings           1.067.977
total scanned strings            ~2.013.226
```

O nome/alias `--full-redaction` foi removido porque 100.000 rows/tabela não equivale logicamente a
exhaustive history. `--deep-redaction` mantém significado explícito de **bounded deep coverage**.

## 24.3 Benchmark fresh-proof versus proof-reuse

Cópia isolada: `/tmp/llmb-readiness-d-proof.sqlite`; DB real não foi escrito.

```text
                             fresh proof        proof reuse
process duration             ~23,839 s          ~8,594 s
proofReused                  false              true
catalog worker core          ~2.041 ms          0 ms
SQLite worker core           ~1.488 ms          0 ms
catalog file fp initial      ~402 ms            ~1.010 ms
catalog file fp final        ~699 ms            ~653 ms
SQLite proof fp initial      ~500 ms            ~477 ms
SQLite proof fp final        ~485 ms            ~460 ms
stderr                       0                  0
SQLite user_version          14                 14
integrity_check              ok                 ok
```

A proof retornada na segunda execução foi byte-for-byte equivalente à primeira e preservou
`generatedAt`, demonstrando reuse real em vez de nova auditoria mascarada.

## 24.4 Fault proof — mutation same-length entre calls

Após uma primeira proof válida, um `payload_json` dentro da janela bounded foi alterado para JSON
diferente com **o mesmo comprimento**. Counts/tamanho do payload e timestamps puderam permanecer
estruturalmente equivalentes para o fingerprint operacional antigo.

Resultado:

```text
same payload length          true
proofReused na segunda       false
old SQLite fp prefix         5f8c1c2123bcd1b4
new SQLite fp prefix         35f7b5c956194ab2
fingerprintChanged           true
generatedAtChanged           true
SQLite worker core 2ª call   ~2.015 ms
integrity_check              ok
```

Isto comprova que a identity de segurança é content-aware e independente dos atalhos de count/MAX
usados pelo cache operacional.

## 24.5 Fault proof — mutation durante a call

Foi iniciada uma segunda readiness com proof reutilizável. Quatro segundos depois, enquanto a build
ainda estava ativa, um `payload_json` da janela bounded foi alterado por outro JSON de mesmo
comprimento. O recheck final da superfície detectou a mudança.

```text
secondSuccess                false
secondParsed                 false
exitCode                     1
second duration              ~8,958 s
stderr                       contém "redaction proof surface changed during readiness build"
SQLite integrity_check       ok
```

Logo, nem mesmo uma mutation que ocorre **depois** da validação inicial da proof pode ser
certificada por uma resposta stale.

## 24.6 Regressions/gates

- `test_model_gateway_redaction_proof.spec.js`: **2/2**;
- `test_mcp_llmb_readiness_cache.spec.js`: **4/4**, cobrindo snapshot stability, context mismatch
  fail-closed e proof reuse somente dentro da mesma environment authority;
- suite focal D/B/C/F: **43/43**;
- TS7 strict `src/copilot`: verde;
- ESLint focal: verde;
- syntax checks: verdes.

**Conclusão:** D está fechado localmente. O ganho de ~15 s remove redaction traversal como custo
obrigatório de toda fresh call, mas o plateau de ~8,6 s ainda é muito acima do alvo operacional. A
próxima investigação deve rebaselinear A sobre proof reuse, sem relaxar os fingerprints exatos agora
provados.

---

# 25. Source-integrity incident, hardening e promotion barrier — 2026-08-26

## 25.1 Evidência forense e classificação

O operador confirmou que apenas abriu `src/copilot/model-gateway/catalog/json-catalog-store.js`, sem
editar o conteúdo. A mutação observada às `16:46:37.761 -03:00` foi semântica, portanto não é
explicável por um formatter isolado. Não havia processo ativo `prettier`, `eslint --fix`, `nodemon`,
`vitest --watch` ou equivalente identificado como writer. Logs do VS Code registraram
`workspace/didChangeWatchedFiles` imediatamente após a troca (~16:46:38.297), comprovando percepção
do evento, não autoria.

Configuração anterior relevante:

```text
files.autoSave                  onFocusChange
files.refactoring.autoSave      true
files.restoreUndoStack          true
files.saveConflictResolution    overwriteFileOnDisk
editor.formatOnSave             true
```

Essa combinação permitia que um buffer restaurado/stale fosse publicado automaticamente ao trocar
foco e explicitamente autorizava o editor a vencer conflito com conteúdo novo no disco. A causa
exata continua não demonstrada; classificação correta: **unattributed source mutation**, com
stale/restored buffer como hipótese forte, não como fato.

## 25.2 Hardening do editor

`.vscode/settings.json` foi alterado de forma CAS-atômica:

```text
before sha256   6d1f245f3a4f86b1e370f54c7eda803c123f9339a8b8ee58a96f53abe5587573
after sha256    d4d91bf47b3a26b84856b50418d656da2eef429d952f55527df4827e8b8f1d25
files.autoSave                  off
files.refactoring.autoSave      false
files.saveConflictResolution    askUser
files.restoreUndoStack          true
editor.formatOnSave             true (somente save explícito)
JSONC parse errors              0
```

O protocolo de publicação da configuração foi: validar hash inicial -> aplicar replacement exato ->
parse JSONC -> escrever temp sibling -> fsync temp -> reler destino e confirmar o mesmo hash inicial
-> `rename()` -> fsync parent directory.

## 25.3 Bug adicional encontrado — JSONC patch-result validation

O primeiro patch de `.vscode/settings.json` foi corretamente impedido de publicar, mas pelo motivo
errado: `repository/patch/result-validation.js` escolhia `JSON.parse()` apenas pela extensão
`.json`. Arquivos JSON-with-comments canônicos do próprio workspace eram tratados como inválidos, e
`.jsonc` explícito nem sequer recebia validator.

Correção:

- `.json` continua estrito por default;
- `.jsonc`, `.vscode/*.json`, `.devcontainer/*.json`, `tsconfig*.json` e `jsconfig*.json` usam
  `jsonc-parser` com comments/trailing commas;
- invalid result continua fail-closed antes do atomic publish com `ERR_PATCH_INVALID_JSON_RESULT`;
- regression test prova acceptance de JSONC válido e rejeição de resultado JSONC inválido sem
  alterar os bytes anteriores.

## 25.4 CAS de mutação — estado real após auditoria

A investigação corrigiu uma premissa inicial importante: `repo_apply_patch` e same-file patch batch
**já eram CAS-safe mesmo sem `expectedHash` do caller**. Dentro do lock eles calculam `previousHash`
dos bytes realmente lidos e passam esse digest a `writeAtomicFileUnlocked`, que relê o destino
imediatamente antes de publish e rejeita divergência com `EEXPECTEDHASH`.

O gap real estava em `repo_write_file`: ele lia o arquivo para gerar diff, mas só fornecia CAS ao
writer quando o caller explicitava `expectedHash`. Agora:

1. a leitura pede `hashMode='full'`;
2. ausência de hash falha com `ERR_WRITE_SOURCE_HASH_UNAVAILABLE`;
3. `effectiveExpectedHash = callerExpectedHash ?? sourceSnapshotHash`;
4. full replacement sempre chega ao atomic writer com CAS;
5. a resposta expõe `sourceSnapshotHash` e `expectedHashMode` para auditabilidade.

Os fault tests de IO já provam writer externo entre snapshot e `before-publish`: a alteração externa
é preservada e a mutation local falha com `EEXPECTEDHASH`.

## 25.5 Repository source barrier v1

Novo owner:

```text
src/copilot/mcp/workspace/repository/integrity/
├── runtime.js
└── public/index.js
```

Contrato:

- input: conjunto explícito de 1..500 arquivos;
- leitura: `readBytesFresh(..., {includeHash:true})`, sem L1/L2;
- entries: `path + sha256 + bytes`, normalizadas/sortidas/deduplicadas pela authority do workspace;
- fingerprint: SHA-256 domain-separated `copilot.repository-source-barrier.v1`;
- `capturedAt` deliberadamente não participa da identity;
- verify relê fisicamente todos os arquivos;
- alteração de conteúdo, tamanho, remoção ou unreadable => `ERR_SOURCE_DRIFT` +
  `promotionAllowed=false`;
- provenance conhecida é somente explicativa; mesmo `controlled-mcp-transition` continua invalidando
  a certificação antiga.

`repo_apply_patch_batch` agora captura automaticamente o barrier dos targets aplicados antes de
`postValidate` e verifica-o após o último validator. Se qualquer validator/process/editor tocar
nesses arquivos durante a janela, `postValidation.allPassed=false`, independentemente dos exit codes
dos validators.

## 25.6 Regressions/gates S.3

```text
test_mcp_source_barrier.spec.js        8/8
  deterministic ordering/fingerprint  green
  same-length external overwrite      ERR_SOURCE_DRIFT
  known MCP transition                explained, still blocked
  deletion after capture              ERR_SOURCE_DRIFT

test_mcp_repo_write.spec.js          32/32
  JSONC pre-publish validation        green
  repo_write_file snapshot CAS        sourceSnapshotHash == previousHash

test_io_fault_injection.spec.js      19/19
  external writer before publish      EEXPECTEDHASH + external bytes preserved
---------------------------------------------------------------
focal total                            79/79
ESLint focal                          green
TS7 strict src/copilot                green
persisted-audit provenance            green (5/5 source-barrier; direct + batch transition support)
```

**Checkpoint:** S.3 e a Faixa S estão fechados. A provenance automática já usa o audit persistido de
forma bounded e somente no caminho de drift; `repo_apply_patch_batch` persiste `targetTransitions`,
e teste com capability real de audit prova a atribuição sem liberar promoção. A matriz ampliada está
`63/63`, com ESLint focal e TS7 strict verdes. A mesma certificação de source está aplicada de forma
executável aos boundaries de benchmark, publicação Git e promoção/reload. Nenhum reload foi feito
nesta faixa; o DB real não recebeu retention intencional.

---

# 26. Fechamento local de A/E.1/F/G e rebaseline hash-bound — 2026-08-26

Esta seção **supersede os números de baseline anteriores apenas para o estado source final local
desta onda**. As medições históricas continuam preservadas acima para análise causal.

## 26.1 E.1 — latest-read independente do crescimento histórico

O ensaio foi executado exclusivamente em `/tmp/llmb-latest-scale.sqlite`, derivado da cópia forense
pré-incidente. O histórico foi primeiro normalizado a 100k e depois expandido monotonicamente com
rows antigas para 250k e 500k **por ledger**, sem alterar as projeções latest.

| Histórico por ledger | health latest | probe latest | records retornados | cold p50 |   cold p95 | warm p50 | warm p95 |
| -------------------: | ------------: | -----------: | -----------------: | -------: | ---------: | -------: | -------: |
|              100.000 |           134 |          160 |                144 | 3,377 ms | 20,289 ms* | 2,073 ms | 4,222 ms |
|              250.000 |           134 |          160 |                144 | 2,492 ms |   2,605 ms | 1,751 ms | 2,155 ms |
|              500.000 |           134 |          160 |                144 | 3,039 ms |   5,269 ms | 2,074 ms | 3,289 ms |

`*` O único outlier de 20,289 ms ocorreu em 100k e não se reproduziu em 250k/500k; portanto não há
sinal de crescimento com N.

O `EXPLAIN QUERY PLAN` foi assertado executavelmente em 500k:

```text
SCAN latest USING COVERING INDEX idx_mg_runtime_health_latest_observed
SEARCH h USING INDEX sqlite_autoindex_copilot_model_gateway_health_observations_1 (observation_key=?)
SCAN latest USING COVERING INDEX idx_mg_runtime_probe_latest_observed
SEARCH p USING INDEX sqlite_autoindex_copilot_model_gateway_runtime_probe_results_1 (result_key=?)
```

Não há `TEMP B-TREE`; latest hashes permaneceram idênticos; `integrity_check=ok`; FK violations = 0.
A query de runtime health deixa, portanto, de depender assintoticamente do volume histórico para
localizar as identidades atuais.

## 26.2 Bug descoberto pelo fingerprint O(1): reopen v14 reexecutava migrations de dados

O primeiro rebaseline source-bound falhou **corretamente** com
`Model Gateway readiness state changed during build; retry required.` O manifest de source
permanecia byte-identical, mas `PRAGMA data_version` mudava durante a própria readiness.

A reprodução cross-connection isolou a causa:

- DB já estava em schema v14;
- construir nova `SqliteModelGatewayCatalogStore` executava migrations históricas novamente;
- a conexão nova acumulava **299 `total_changes`**;
- outra conexão observava `data_version` 2→3;
- health/probe counts permaneciam semanticamente iguais.

Isso tornava o fingerprint O(1) mais correto que o bootstrap: ele detectava commits reais que o
domínio tratava indevidamente como no-op.

Correção:

1. `migrateModelGatewaySqliteSchema(db, fromVersion)` recebeu version gate explícito;
2. schema corrente retorna antes de qualquer data migration histórica;
3. constructor só executa migration/`PRAGMA user_version` quando a versão é realmente anterior;
4. regression com owner+observer prova reopen v14 com `dataVersionDelta=0`, `totalChangesDelta=0` e
   integridade verde.

O fix preserva a capacidade do fingerprint de detectar writers externos sem introduzir uma exceção
semântica artificial para commits do próprio bootstrap.

## 26.3 Remoção de analytics históricos do request path

O profiling final revelou outro custo sem valor decisório: `readStorageDiagnostics()` executava
`COUNT(*)` sobre todas as tabelas do Model Gateway e `GROUP BY` em históricos de health/probe apenas
para preencher observabilidade cujo check era sempre `ok=true`.

A readiness deixou de chamar esse diagnóstico administrativo. `readStorageDiagnostics()` continua
disponível para cockpit/maintenance, mas não participa mais do request path. O hot path mantém
apenas:

- source snapshot + content fingerprint;
- structural parity projection;
- bounded redaction fingerprint;
- runtime latest health somente quando solicitado;
- selection/eligibility e selector plans necessários à decisão.

A tentativa intermediária de um resumo SQLite menor ainda custava ~0,48 s cold e foi removida em vez
de virar nova API permanente sem benefício de correctness.

## 26.4 Rebaseline final 1/5/20 — source byte-identical

Cópia SQLite explícita:

```text
/tmp/llmb-rebaseline-final2.sqlite
schema v14
integrity_check=ok
foreign_key_check=0
```

Barrier de source:

```text
manifest: /tmp/llmb-final-source-manifest.json
entryCount: 47
fingerprint pre:  f655d2278883abeb0ee3003760f6e817f362fb0ad467c488e273f34fdec4b419
fingerprint post: f655d2278883abeb0ee3003760f6e817f362fb0ad467c488e273f34fdec4b419
child exit: 0
```

O conjunto contém exatamente o source alterado da campanha + `package.json`/barrier wrapper. Uma
tentativa anterior de certificar toda a árvore Model Gateway foi corretamente negada pela workspace
authority ao alcançar um path protegido; **nenhuma policy foi contornada**.

A seed calculou security proof fresh. As séries seguintes forçaram operational-state fresh sem
alterar a superfície de segurança, portanto reutilizaram a mesma proof context/fingerprint-bound.

| Série |   total p50 |   total p95 |   total max |  domain p50 | process-minus-domain p50 |      HWM p50 |      HWM p95 |
| ----- | ----------: | ----------: | ----------: | ----------: | -----------------------: | -----------: | -----------: |
| N=1   |     6,535 s |     6,535 s |     6,535 s |           — |                        — |     ~647 MiB |            — |
| N=5   |     6,453 s |     6,803 s |     6,803 s |     5,793 s |                  0,659 s |     ~652 MiB |     ~681 MiB |
| N=20  | **6,616 s** | **6,755 s** | **6,767 s** | **5,951 s** |              **0,664 s** | **~654 MiB** | **~678 MiB** |

N=20 phase p50/p95:

```text
initial operational fingerprint     0,546 / 0,809 ms
completed operational fingerprint   0,763 / 1,043 ms
source snapshot                     1.587 / 1.684 ms
selection + selector plans          2.949 / 3.093 ms
catalog integrity                   499 / 525 ms
SQLite structural parity            620 / 638 ms
catalog security fingerprint        682 / 698 ms
SQLite security fingerprint         482 / 493 ms
terminal post-runtime audit         483 / 518 ms
eligibility                         109 / 114 ms
```

Lifecycle final:

```json
{"created":27,"terminated":27,"current":0,"cancelled":0,"timedOut":0,"outputLimited":0,"abnormalExit":0}
```

HWM N=20: p50 669.808 KiB, p95 694.120 KiB, max 698.496 KiB; não há tendência de crescimento. O
processo pai terminou em ~106,6 MiB RSS e ~23,5 MiB heap used. A memory-cache subsequente respondeu
em ~0,56 ms.

A seed com proof de segurança **fresh** é uma classe distinta de operação: ~7,65 s nessa execução e
HWM transitório significativamente maior. Ela não deve ser misturada ao SLO de operational
proof-reuse nem ao cache hit.

## 26.5 SLO rebaselineado e gates resultantes

Para este ambiente e arquitetura:

```text
fresh operational readiness + valid security proof:
  target p95 <= 7.0 s
  hard local observation max = 6.767 s em N=20

memory-cache:
  ordem sub-ms no ensaio final

first security-proof build:
  classe separada, não coberta pelo SLO de proof-reuse
```

O alvo histórico `<2 s`/`≤5 s` deixa de ser um acceptance gate desta arquitetura porque não
corresponde ao trabalho correto ainda necessário. Isso **não** transforma 6–7 s em teto arquitetural
desejável: `sourceSnapshotRead` e `selectionAndSelectorPlans` continuam candidatos legítimos a
otimizações futuras, porém não há evidência de leak, scan histórico acidental ou custo sem owner que
justifique bloquear a promoção atual.

## 26.6 Validação focal associada

Depois dos fixes de migration/fingerprint e hot-path cleanup:

```text
runtime-health storage + SQLite fingerprint                 18/18 green
storage + fingerprint + readiness wire + readiness cache    26/26 green
ESLint focal                                                green
TS7 strict src/copilot                                      green
source barrier final benchmark                              pre == post
SQLite temp copy                                            integrity/FK green
```

A próxima barreira não é mais uma transformação de performance: é **J(pre) documentação →
validação/publication barrier → I backup/publish/reload/host acceptance**, preservando a proibição
de retention real antes desses gates.

---

# 27. Checkpoint supersedente final pré-publicação — 2026-08-26

Esta seção supersede os números de rebaseline da Seção 26.4/26.5 para o **source final local
imediatamente anterior ao publication barrier**. A Seção 26 continua preservada como evidência
causal da onda anterior.

## 27.1 Fechamento arquitetural descoberto pelo próprio architecture gate

A primeira tentativa de publication barrier fez o que deveria: testes focais, strict e lint
passaram, mas `copilot:architecture:check` bloqueou a promoção. Os blockers eram reais e foram
corrigidos arquiteturalmente, sem aumentar ceilings para fazê-los desaparecer:

1. `source-barrier.js` deixou de usar `process.cwd()` e `process.env` como authority implícita;
   passou a usar workspace identity canônica e `buildMcpChildEnvironment`, com child-process
   lifecycle declarado no dynamic graph;
2. state scopes foram reconciliados com a remoção do single-flight e com os lifecycle counters
   atuais;
3. `sqlite-catalog-store.js`, então com 205.966 bytes, foi decomposto por responsabilidade:
   retention passou para `sqlite-operational-retention.js` e migrations/version gate para
   `sqlite-schema-migration.js`; o store caiu para **165.188 bytes**, abaixo do ratchet de 175.000
   com headroom real;
4. reopen de schema v14 ficou semanticamente no-op: migrations históricas não são reexecutadas,
   preservando `data_version`/`total_changes` estáveis quando nenhum fato mudou;
5. `resolveApplicationSqlitePath` ganhou membrane pública própria
   `#copilot/infra/public/composition/database/sqlite/path`, evitando inflar a closure de lifecycle
   SQLite. A surface nova mede **2 módulos / 1.396 bytes / zero pacotes externos**; a antiga voltou
   exatamente a 1.004 bytes;
6. a nova API de repository source integrity foi governada como surface `micro`: **2 módulos /
   18.281 bytes / zero pacotes externos**, baseline 3 módulos / 27.422 bytes;
7. `jsonc-parser` foi registrado explicitamente nas closures que alcançam o validator JSONC. É
   dependência já declarada e semanticamente necessária para validar `.vscode`, `.devcontainer`,
   `tsconfig/jsconfig` antes de publish; nenhum tier foi elevado por esse delta;
8. owner governance foi rederivada pelo checker canônico. Estado final: 68 owners, 222 arestas
   diretas, zero SCC, zero mismatch/violation.

Depois dessas correções, `npm run copilot:architecture:check` fechou integralmente verde, incluindo
package imports, dependency graph, Infra authority/cost/cold-import/docs, MCP surface/owner
governance, MCP public API cost/import purity e MCP cold-import baseline.

## 27.2 Testes e type safety da extração

A matriz focal que cobre migration/reopen, retention, contracts, SQLite fingerprint e path authority
fechou em **251/251**. `npm run typecheck:strict:src.copilot` ficou verde; `git diff --check` também
ficou verde. O publication barrier completo ainda é executado depois deste checkpoint documental,
para que a certificação corresponda aos bytes efetivamente publicados.

## 27.3 Rebaseline final sobre o conjunto de publicação

A unidade de certificação foi fortalecida para **todos os 79 arquivos modificados/untracked da
campanha**, não apenas uma lista manual de source. Manifest:

```text
/tmp/llmb-publish-manifest-final.json
entryCount: 79
fingerprint pre:  c7c1d2513bc14d1d088c4158900775cd514945f020d3015b79c0b354c9c8d898
fingerprint post: c7c1d2513bc14d1d088c4158900775cd514945f020d3015b79c0b354c9c8d898
child exit: 0
```

O harness abriu exclusivamente `/tmp/llmb-rebaseline-final2.sqlite` e projetou `COPILOT_DB_PATH`
para o mesmo arquivo; antes e depois, schema = 14, `integrity_check=ok` e FK violations = 0. O DB
real não participou do benchmark.

A seed construiu uma security proof fresh em ~7,338 s. As séries N=1/5/20 seguintes forçaram fresh
operational state com proof válida/reutilizada:

| Série |   total p50 |   total p95 |   total max |  domain p50 | selection p50 |      HWM p50 |      HWM p95 |      HWM max |
| ----- | ----------: | ----------: | ----------: | ----------: | ------------: | -----------: | -----------: | -----------: |
| N=1   |     6,572 s |     6,572 s |     6,572 s |     5,928 s |       2,944 s |     ~664 MiB |            — |     ~664 MiB |
| N=5   |     6,362 s |     6,626 s |     6,626 s |     5,700 s |       2,771 s |     ~646 MiB |     ~657 MiB |     ~657 MiB |
| N=20  | **6,382 s** | **6,552 s** | **6,569 s** | **5,720 s** |   **2,824 s** | **~645 MiB** | **~667 MiB** | **~684 MiB** |

Lifecycle final permaneceu perfeitamente drenado:

```json
{"created":27,"terminated":27,"current":0,"cancelled":0,"timedOut":0,"outputLimited":0,"abnormalExit":0}
```

Memory-cache subsequente: ~0,616 ms reportado / ~0,651 ms wall. Processo pai ao final: ~104,6 MiB
RSS e ~22,9 MiB heap used.

**Conclusão quantitativa:** o SLO local de fresh operational proof-reuse **p95 ≤ 7,0 s** permanece
atendido com margem e melhorou em relação ao rebaseline anterior (6,755 s → **6,552 s** p95). A
seed/security-proof fresh continua classe separada e não deve ser confundida com esse SLO.

## 27.4 Estado exato antes do publication barrier

Localmente estão fechados os blockers de source-integrity, cancellation nativa, environment
authority, lifecycle/memory, proof security, snapshot/cache, wire contract, latest-read,
hydration/mirror e retention architecture. Continuam **explicitamente fora desta certificação**:

- acceptance host-real pós-publish/reload;
- retention real intencional no DB real;
- fault test OOM físico/redaction-worker marker se surgir seam natural;
- shutdown do process host durante readiness ativa;
- projeção diagnóstica literal `registryDurationMs - domainDurationMs`.

Nenhum desses residuais autoriza reclassificar a prova local como host-real. O próximo gate é o
publication barrier byte-identical; somente depois vêm publish/reload/acceptance da Faixa I.
