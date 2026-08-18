# WORKSPACE — MCP, I/O compartilhado, latência e liberdade operacional

## Diagnóstico do estado atual, estado-alvo e roadmap de transformação — 2026-08-17

> Documento canônico desta nova frente de trabalho. O objetivo não é otimizar a LLM-B em si, mas reduzir sistematicamente a latência, o número de round-trips, o custo de bootstrap, o volume de payload, a duplicação de trabalho e as limitações de autonomia do ambiente compartilhado por ChatGPT/MCP e pela LLM-B local. A LLM-B importa aqui apenas porque compartilha o filesystem, o SQLite/index-store e a infraestrutura de I/O.

---

## 1. Escopo e princípios

Esta frente trata de seis superfícies que, na prática, compõem a latência observada pelo operador:

1. **round-trips ChatGPT ↔ MCP** — quantidade de chamadas necessárias para completar uma unidade lógica de trabalho;
2. **handler local MCP** — path validation, cache, leitura, busca, patch, indexação, Git e validação;
3. **payload/contexto** — bytes de `tools/list`, respostas de diagnostics/status e duplicação de metadata;
4. **estado compartilhado entre processos** — MCP e LLM-B possuem caches em memória distintos, mas enxergam o mesmo workspace e o mesmo index-store;
5. **bootstrap/restart** — auto-index, maintenance, OAuth/JWKS, registro de tools e aquecimento de subsistemas;
6. **rede/Cloudflare/OAuth** — túnel, edge, origem H2, descoberta OAuth, tools/list remoto e SSE.

Princípios desta transformação:

- **otimizar primeiro custo acumulado e call pressure**, não apenas a maior latência isolada;
- **não trocar segurança estrutural por microssegundos**: nenhum `trustPath=true` público, nenhum bypass arbitrário de symlink/containment, nenhum enfraquecimento de OAuth/TLS;
- **assumir o ambiente operacional como confiável**, permitindo menos cerimônia e mais batching, mas manter fronteiras explícitas contra inputs externos/acidentais;
- **compartilhar coerência, não necessariamente cache**: um L2 compartilhado só deve ser habilitado se vencer o filesystem em benchmark real;
- **preferir nomes/schemas estáveis no MCP**: mudanças de schema em uma tool já materializada pelo host não devem ser a única forma de expor nova capacidade;
- **diagnóstico profundo deve ser raro**: tools de vários segundos não podem fazer parte do bootstrap padrão de toda conversa;
- **medir antes e depois** e registrar cold, warm, payload e round-trips separadamente;
- **rollback automático continua desligado por padrão**; esta frente não reabre essa decisão.

---

## 2. Metodologia de medição

As medições abaixo foram coletadas após reconnect do connector e depois do commit anterior `8a525c58b` (`perf(copilot): cut hot-tool roundtrips and batch repo IO`). Foram usadas as próprias métricas do MCP, smokes locais/remotos, estado do index-store, benchmark já persistido do cache e leitura direta do código canônico.

### 2.1 Métricas principais

- `mcp_latency_dashboard`: tempo por tool, custo acumulado, call pressure, fases internas e bytes;
- `mcp_runtime_health(includeDetails=true)`: caches, index, parser, stateful transport, maintenance e artifacts;
- `mcp_smoke_workspace`: custo local de um conjunto representativo de operações;
- `mcp_connector_smoke_refresh`: custo remoto OAuth + tools/list + SSE;
- `mcp_cloudflare_metrics_snapshot`: QUIC RTT, conexões e métricas cloudflared;
- `mcp_cloudflare_*_audit`: custo e estado das auditorias externas;
- `repo_index_build`: custo real de scan/revalidação do index-store;
- leitura de `io-cache.js`, `io/invalidation/bus.js`, `io-index-sqlite.js`, `index-auto-build.js`, `workspace-io.js` e path policy para distinguir custo acidental de garantias necessárias.

### 2.2 Separação conceitual

Uma chamada pode ser lenta por quatro causas diferentes:

- **execução**: handler realmente demora;
- **serialização/payload**: handler é barato, mas devolve dezenas/centenas de KiB;
- **rede**: Cloudflare/API externa domina;
- **orquestração**: várias tools baratas são chamadas em sequência quando uma unidade lógica poderia ser resolvida em uma chamada.

O roadmap trata essas causas separadamente.

---

# PARTE I — ESTADO ATUAL

## 3. Resumo executivo do baseline

O sistema atual está funcional e relativamente rápido no hot path local. O gargalo dominante deixou de ser `read`/`search` isoladamente e passou a ser **arquitetura de interação**.

### 3.1 Hot path local já saudável

No processo MCP atual:

- `repo_read_file`: 11 chamadas, **9 ms de média**, última em 2 ms;
- `repo_search_text`: 16 chamadas, **37 ms de média**, usando `resultSizeHint` em todas;
- smoke local completo: **183 ms para 13 checks**;
- dentro do smoke:
  - read: 2 ms;
  - search: 7 ms;
  - stat: 1 ms;
  - symbol search: 3 ms;
  - outline: 35 ms;
  - status: 64 ms.

Isso confirma que insistir apenas em micro-otimizações de `fs.readFile()` teria retorno marginal.

### 3.2 Principais fontes de custo observadas na investigação

Snapshot com 36 chamadas:

| Tool | Chamadas | Média | Custo acumulado |
|---|---:|---:|---:|
| `mcp_cloudflare_edge_audit` | 1 | 4.606 ms | 4.606 ms |
| `mcp_cloudflare_skip_audit` | 1 | 3.476 ms | 3.476 ms |
| `mcp_cloudflare_remote_audit` | 1 | 3.307 ms | 3.307 ms |
| `mcp_cloudflare_config_audit` | 1 | 2.721 ms | 2.721 ms |
| `repo_index_build` | 2 | 1.046 ms | 2.092 ms |
| `mcp_connector_smoke_refresh` | 1 | 1.010 ms | 1.010 ms |
| `repo_search_text` | 9 | 30 ms | 266 ms |
| `repo_read_file` | 5 | 11 ms | 57 ms |

A conclusão é dupla:

1. deep diagnostics Cloudflare são corretamente caros, mas estavam sendo recomendados cedo demais no fluxo de sessão;
2. `read` e `search` são hoje baratos o suficiente para que **número de chamadas e tamanho da resposta** sejam mais importantes que o handler individual.

---

## 4. Gargalo P0-A — bootstrap de sessão e payloads de orientação

### 4.1 `mcp_tools_status`

A tool executa rápido (~7 ms), mas uma chamada retornou **110.142 bytes**. Ela inclui os 116 tools com título, risk class, annotations, security schemes e flags, além de profiles agregados.

Isso é uma forma de latência invisível no handler: transfere ~107 KiB para dizer ao modelo como trabalhar antes de o trabalho começar.

### 4.2 `mcp_session_profile`

A tool executa em ~1 ms, mas devolveu **43.895 bytes**. Além disso, recomenda **16 first calls**, entre elas deep diagnostics de Cloudflare, status, golden prompts, maintenance, readiness, OAuth e doctor.

O problema central não é o custo de `mcp_session_profile`; é a política que ela induz. Uma sessão pode gastar vários segundos validando subsistemas que não têm relação com a tarefa atual.

### 4.3 `mcp_runtime_health(includeDetails=true)`

É uma excelente tool de investigação, mas a última resposta detalhada chegou a **126.171 bytes**. Deve permanecer profunda, porém não fazer parte do caminho normal.

### 4.4 Estado-alvo deste domínio

- bootstrap operacional normal com **≤ 3 chamadas leves**;
- `mcp_tools_status` compacto: alvo < 15 KiB;
- `mcp_session_profile` compacto: alvo < 10 KiB;
- deep diagnostics fora de `recommendedFirstCalls`;
- diagnóstico de rede/Cloudflare acionado somente por mudança de rede/edge, erro ou investigação explícita;
- dashboard deve ranquear também **largest result payload** e **result-volume acumulado**.

---

## 5. Gargalo P0-B — coerência de I/O entre MCP e LLM-B é apenas intra-processo

`src/copilot/infra/io/invalidation/bus.js` mantém:

- array de hooks em memória;
- map de invalidações pendentes;
- debounce padrão de 50 ms;
- dispatch apenas dentro do processo atual.

MCP e LLM-B, entretanto, são processos diferentes.

### 5.1 Consequência atual

Quando um processo escreve por meio do I/O canônico:

- seu próprio L1 é invalidado;
- seus parser/session caches recebem o evento;
- seu index registry invalida o path;
- o outro processo **não recebe imediatamente o evento**.

A consistência ainda possui defesa por fingerprint:

- L1 TTL 60s;
- stale probe a cada 2s;
- fingerprint rico mtime + size + ctime + dev + ino;
- hash revalidation para casos ambíguos.

Portanto não há uma falha de segurança grave, mas existe uma janela de **staleness cross-process** e trabalho repetido. Essa janela obriga scans/revalidações mais conservadores e reduz a liberdade de ambos os agentes trabalharem simultaneamente no mesmo repo.

### 5.2 Estado-alvo

Criar um **cross-process invalidation journal** leve, durável o suficiente para sobreviver a restart curto e barato o suficiente para não aparecer no write hot path.

Requisitos:

- produtor registra invalidations em lote/debounce;
- consumidores mantêm sequence cursor próprio;
- evento contém apenas path normalizado + recursive + source/process + sequence/timestamp;
- nenhuma capacidade de executar comandos;
- consumo oportunista ou timer curto;
- fallback continua sendo fingerprint, nunca o journal como única garantia;
- journal deve ter retenção/compaction bounded;
- p95 de propagação desejado < 250 ms;
- overhead de escrita médio desejado < 2 ms, preferencialmente fora do critical path.

SQLite compartilhado é candidato natural porque já existe; um append-only file/journal também deve ser comparado. O desenho deve evitar lock contention no `copilot.sqlite`.

---

## 6. Gargalo P1-A — auto-index faz scan completo em todo restart

O index-store atual está saudável:

- 2.182 arquivos;
- 2.182 fresh;
- 15.581.279 bytes indexados;
- 11.938 símbolos;
- 3.912 imports;
- 3.540 chunks;
- zero stale/failed.

O auto-build do MCP, entretanto, sempre executa `buildIoIndexForDirectory(src/copilot)` depois do HTTP start.

### 6.1 Medição real

Auto-build após restart:

- 1.670 entries escaneadas;
- 1.436 arquivos candidatos;
- 1 arquivo realmente indexado;
- 1.435 unchanged;
- **1.435 hash verifications, todas hits**;
- duração **1.184 ms**.

Foram executados dois refreshes idênticos para decompor custo:

1. após o intervalo de hash expirar:
   - 1.436 hashes;
   - **1.253 ms**;
2. imediatamente depois:
   - 0 hashes;
   - **832 ms**.

Logo:

- scan/fingerprint de toda a árvore custa aproximadamente 0,8 s;
- hash periódico acrescenta aproximadamente 0,4 s;
- o intervalo default de hash é apenas **30 s**, de modo que praticamente todo restart normal volta a ler/hashar a árvore inteira.

### 6.2 Avaliação da política

O fingerprint já é rico (`mtime`, `size`, `ctime`, `dev`, `ino`). Em ext4/local devcontainer, re-hash integral a cada 30 s é muito conservador para o ganho obtido.

### 6.3 Estado-alvo

Em estado sem mudanças:

- restart/no-change index maintenance ideal < 200 ms;
- teto aceitável inicial < 400 ms;
- nenhum full hash sweep por restart;
- checkpoint persistido da geração do index;
- atualização incremental por paths alterados quando houver evidência;
- fallback para full scan em incerteza, schema migration ou journal gap.

A solução ideal combina:

1. cross-process invalidation journal;
2. checkpoint persistido (`HEAD`, geração/sequence e/ou workspace signature);
3. auto-build incremental;
4. intervalo de periodic full verification muito maior, como safety net, não como rotina.

---

## 7. Gargalo P1-B — materialização de schemas pelo host reduz liberdade

O servidor atual contém batching em `repo_read_file` e `repo_search_text`, mas, mesmo após reconnect do connector, o schema materializado nesta conversa continua exibindo as assinaturas antigas:

- `repo_read_file.path` ainda aparece obrigatório e não mostra `batch`;
- `repo_search_text` não mostra `batch`;
- descrição de `repo_apply_patch_batch` ainda menciona paths únicos apesar de o runtime já aceitar grouping por arquivo.

Conclusão: **mudar o schema de uma tool com nome já conhecido não é uma estratégia confiável para disponibilizar uma nova capacidade ao host no meio de uma continuidade de sessão**.

### 7.1 Estado-alvo

- tratar nome + schema MCP como contrato versionado/estável;
- para capacidades substantivamente novas, preferir uma nova tool compacta de nome estável;
- evitar multiplicar tools sem orçamento de `tools/list`;
- candidato: uma única `repo_io_batch` read-only com operações `read`, `search` e eventualmente `stat`, em vez de duas ou três novas tools;
- patch batch pode permanecer no nome existente porque seu input shape fundamental não mudou.

---

## 8. Gargalo P1-C — `tools/list` ainda está perto do teto

Fresh connector smoke:

- 116/116 tools;
- **127.971 bytes** em authenticated `tools/list`;
- sem tools ausentes ou inesperadas;
- teto operacional acompanhado: 128 KiB / 131.072 bytes;
- headroom atual: aproximadamente **3,1 KiB**.

O script já existente `mcp/scripts/tool-payload-audit.js` mede por tool:

- title;
- description;
- input schema;
- output schema;
- annotations;
- execution;
- `_meta`.

O fato de haver apenas ~3 KiB livres significa que adicionar ferramentas indiscriminadamente reduz robustez e pode reabrir o problema de `tools/list` acima do orçamento.

### Estado-alvo

- `tools/list` ≤ 120 KiB, preferencialmente com **≥ 8 KiB** de headroom;
- manter 100% de parity e segurança;
- descrições operacionais concisas;
- metadata compatível, mas sem repetição textual desnecessária;
- qualquer nova tool deve pagar seu orçamento removendo/compactando mais bytes do que adiciona.

---

## 9. Gargalo P2-A — path policy é executada duas vezes em várias tools MCP

O adapter MCP faz:

`resolveReadPath/resolveWritePath → validatePath → evaluateIoPathPolicyAsync`

Depois, várias tools passam o path absoluto para `createWorkspaceIo`, que executa novamente:

`resolveWorkspacePath → evaluateIoPathPolicyAsync`.

A política async inclui `realpath`/parent-realpath para fechar traversal via symlink. A garantia é correta; a duplicação é que não é necessária quando o segundo nível recebe uma capability já emitida pelo primeiro.

### Estado-alvo

Uma capability interna opaca de **validated workspace path**:

- só pode ser criada pelo resolver canônico;
- carrega workspace, realPath, policyVersion e mode;
- não pode ser construída por input da tool;
- `workspace-io` aceita capability e evita repetir realpath/policy;
- strings comuns continuam passando por validação completa.

Não implementar flag pública `trustPath`.

---

## 10. Cache: o que NÃO deve ser feito

O benchmark persistido do cache mostra:

| Fase | média | p95 |
|---|---:|---:|
| leitura fria | 12,233 ms | 12,879 ms |
| L1 | 1,758 ms | 1,794 ms |
| L2 SQLite | 14,267 ms | 16,479 ms |

O L2 tem p95 aproximadamente **27,95% pior** que a leitura fria do workload medido.

### Decisão

- **L2 permanece OFF por padrão**;
- compartilhar SQLite cache entre MCP e LLM-B não é justificativa suficiente;
- compartilhar invalidação/coerência é mais valioso que compartilhar payload cache;
- L2 só volta a ser candidato se outro workload demonstrar ganho real.

---

## 11. Cloudflare e rede — saudável como dataplane, caro como diagnostic plane

### 11.1 Dataplane

Cloudflared:

- versão 2026.5.2;
- 4 conexões QUIC registradas;
- 4 ativas;
- latest RTT 33 ms;
- smoothed RTT **24 ms**;
- MTU 1344;
- zero packet-too-big drops.

Remote tunnel:

- healthy;
- quatro colos GRU ativos;
- origin HTTPS `127.0.0.1:3333`;
- `http2Origin=true`;
- TLS verification ativa;
- SNI correto;
- connect timeout 5 s;
- keepalive profile alinhado 9/9 com o desejado.

### 11.2 Connector smoke

Fresh smoke:

- orquestração total: **976 ms**;
- unauthenticated: 227 ms;
- authenticated OAuth: **964 ms**;
- public discovery: 153 ms;
- auth metadata: 111 ms;
- registration: 76 ms;
- authorization flows: 205 ms;
- token lifecycle: 208 ms;
- runtime checks: 209 ms;
- SSE: 204 ms;
- tools/list: 127.971 bytes.

Esse custo é aceitável para smoke/bootstrap eventual; não representa o custo de cada tool stateful.

### 11.3 Diagnostic plane

Audits frios medidos:

- edge audit: 4,606 s;
- skip audit: 3,476 s;
- remote audit: 3,307 s;
- config audit: 2,721 s;
- edge snapshot composto: 4,901 s e ~64,9 KiB de resposta.

Cada família mantém caches TTL curtos (~5 s), porém os audits compostos ainda repetem consultas e perdem reutilização quando são chamados sequencialmente fora dessa janela.

### 11.4 Estado-alvo

- não mudar QUIC/H2/TLS agora;
- criar snapshot Cloudflare compartilhado com TTL mais útil para investigação, por exemplo 30–60 s, com `forceRefresh` explícito;
- deep audit bundle deve reutilizar um único snapshot;
- chamada quente a diagnóstico composto, após snapshot fresco, alvo < 100 ms local;
- chamadas remotas frias podem continuar levando segundos, mas devem ser raras e explicitamente justificadas.

### 11.5 Edge policy

Estado atual:

- cache bypass dinâmico presente;
- BIC/rocket loader/email obfuscation tratados pelo scoped config rule;
- response body buffering `none` para MCP;
- `/oauth/token` rate limit presente;
- nenhuma challenge/block relevante sobre `/mcp`;
- ausência de rate-limit edge anônimo em `/mcp` está mitigada por fallback do origin (40 requests/10 s) e não justifica mutação imediata.

**Não adicionar skip amplo nem nova regra de rate-limit sem evidência de incidente.**

---

## 12. OAuth — não é gargalo e não deve ser enfraquecido

- resource/issuer/audience alinhados;
- PKCE S256;
- CIMD suportado;
- access token TTL 1 h;
- refresh token TTL 7 d;
- rotação one-time persistente;
- JWKS cache com alto hit rate;
- auth config cache: 1006 hits / 1 miss no snapshot atual;
- reauth risk: low.

Estado-alvo: preservar.

---

## 13. Stateful MCP — saudável

- stateful policy ativa;
- session TTL 600 s;
- max sessions 256;
- 228 stateful requests no snapshot detalhado;
- **0 stateless fallback**.

Nenhuma transformação deve reintroduzir stateless fallback como solução de performance.

---

## 14. Parser/worker pool — saudável

- 4 workers adaptativos;
- queue max 128;
- nenhuma failure/timeout/restart;
- última parse entre 14–27 ms nas medições;
- no queue pressure significativo.

Não é prioridade atual.

---

## 15. Git/validação/artifacts

Validação efetiva no início desta frente:

- focused unit: passed;
- typecheck: passed;
- lint: passed;
- unit-mcp: passed.

Artifacts:

- 286 arquivos de jobs;
- ~425,9 KiB;
- 46 além da retenção;
- ~47 KiB candidatos a cleanup.

Isso não é gargalo material. Cleanup deve continuar bounded e oportunista.

Rollback:

- automático desabilitado;
- zero sidecars conhecidos;
- decisão permanece fechada.

---

# PARTE II — ESTADO-ALVO

## 16. Arquitetura-alvo

A arquitetura desejada pode ser resumida em cinco planos.

### 16.1 Fast Interaction Plane

ChatGPT deve conseguir executar trabalho normal usando:

1. no máximo uma leitura de estado curta;
2. uma operação task-specific;
3. batching quando houver independência ou múltiplas alterações.

Sem deep audits por padrão.

### 16.2 Shared Coherence Plane

MCP e LLM-B continuam com caches L1 próprios, mas compartilham imediatamente informação de **mudança**, não payload.

`write → local invalidation → cross-process journal → peer invalidation → incremental index update`

Fingerprint continua como safety net.

### 16.3 Incremental Index Plane

Startup não deve equivaler a “scan tudo”. O index deve saber:

- qual geração viu;
- quais invalidations ocorreram depois;
- se existe gap no journal;
- se HEAD/worktree evidence é compatível;
- quando precisa full reconciliation.

### 16.4 Stable MCP Contract Plane

- tools existentes mantêm schemas estáveis;
- nova capacidade recebe nome novo apenas quando necessário;
- novas tools têm orçamento explícito de bytes;
- compact descriptors são um requisito de arquitetura, não cleanup tardio.

### 16.5 Slow Diagnostic Plane

Cloudflare, OAuth deep diagnostics, broad validation e full index reconciliation ficam disponíveis, porém fora do caminho normal.

---

## 17. SLOs e critérios quantitativos

### Interação local

- `repo_read_file` warm p95 < 10 ms;
- literal `repo_search_text` warm p95 < 50 ms;
- batch de 4 reads deve ser materialmente menor que 4 round-trips separados do host;
- same-file patch batch deve manter um lock/read/write por arquivo.

### Bootstrap

- `mcp_session_profile` < 10 KiB;
- `mcp_tools_status` < 15 KiB;
- recommended first calls ≤ 3;
- `mcp_runtime_health` compact default < 15 KiB.

### Registry

- `tools/list` alvo ≤ 120 KiB;
- headroom ≥ 8 KiB;
- 100% parity local/remoto.

### Index

- no-change startup target < 200 ms;
- primeiro marco aceitável < 400 ms;
- zero 1.4k-file full hash sweep em restart normal;
- full reconciliation apenas por política/fallback.

### Cross-process coherence

- propagation p95 < 250 ms;
- write overhead médio < 2 ms ou totalmente amortizado fora do critical path;
- nenhuma stale read conhecida depois do propagation window;
- bounded journal retention.

### Cloudflare

- dataplane mantém 0 stateless fallback;
- QUIC/H2 sem regressão;
- cached diagnostic snapshot < 100 ms;
- cold deep audit pode ser lento, mas nunca bootstrap default.

### Segurança/liberdade

- OAuth/TLS/path containment preservados;
- sem input público de bypass de path;
- bounded writes ganham batching/approval efficiency;
- autonomy score ≥ 91 e idealmente melhora sem inflar tool surface.

---

# PARTE III — ROADMAP

## Fase 0 — Baseline e governança de performance

### 0.1 Congelar métricas atuais

- [x] hot read/search;
- [x] local smoke;
- [x] tools/list;
- [x] index cold-ish/warm;
- [x] L1/L2 benchmark;
- [x] Cloudflare QUIC/H2;
- [x] OAuth;
- [x] deep audit timings;
- [x] tool-result payload samples;
- [x] stateful/stateless counts.

### 0.2 Melhorar observabilidade

- [ ] adicionar rankings `largestResultPayloads` e `highestResultVolume` ao latency dashboard;
- [ ] registrar cold/warm quando a própria tool puder distinguir;
- [ ] expor index startup mode: `skip`, `incremental`, `full-reconcile`.

**Gate:** dashboard consegue apontar CPU/handler, calls e bytes separadamente.

---

## Fase 1 — Bootstrap compacto e eliminação de trabalho autoinduzido

### 1.1 Compactar `mcp_tools_status`

- [ ] remover array completo de 116 tool summaries do default;
- [ ] manter counts, risk classes, approval candidates e exceções importantes;
- [ ] detalhes completos continuam disponíveis via registry/capability tools existentes ou uma opção/tool específica, se realmente necessária.

### 1.2 Compactar `mcp_session_profile`

- [ ] remover full advertised tool list embutida;
- [ ] remover smoke prompts extensos do payload padrão;
- [ ] reduzir first calls a ≤3;
- [ ] mover Cloudflare deep audits para “after network/edge change or incident”.

### 1.3 Ajustar guidance

- [ ] priorizar task-specific action;
- [ ] não rodar maintenance/smoke/audit sem gatilho;
- [ ] manter focused validation por causalidade.

**Gate:** profile <10 KiB, tools status <15 KiB e smoke normal não regrede.

---

## Fase 2 — Cross-process invalidation/coherence

### 2.1 Design do journal

- [ ] escolher SQLite journal ou arquivo append-only após microbenchmark;
- [ ] sequence monotônico;
- [ ] process instance id;
- [ ] path + recursive + timestamp + source;
- [ ] retenção bounded.

### 2.2 Producer

- [ ] integrar com invalidation bus existente;
- [ ] batch/debounce;
- [ ] nunca bloquear a mutação por erro de telemetry/journal.

### 2.3 Consumer

- [ ] polling leve/sequence check;
- [ ] invalidar L1, parser, line offsets, repo-read result cache e index registry;
- [ ] ignorar evento do próprio processo quando já aplicado localmente;
- [ ] detectar journal gap e promover full reconcile.

### 2.4 Prova MCP ↔ processo auxiliar

- [ ] teste de dois processos sem usar provider/LLM;
- [ ] processo A escreve/invalida;
- [ ] processo B observa e derruba cache dentro do SLO.

**Gate:** p95 <250 ms, sem stale read após janela, overhead bounded.

---

## Fase 3 — Index startup incremental

### 3.1 Reduzir hash paranoia

- [ ] revisar default de 30 s;
- [ ] rich fingerprint estável não deve exigir hash sweep em todo restart;
- [ ] hash periódico vira safety reconciliation.

### 3.2 Checkpoint persistido

- [ ] generation/last journal sequence;
- [ ] HEAD/worktree marker onde for barato;
- [ ] schema version/index health.

### 3.3 Auto-build modes

- [ ] `skip`: nenhuma mudança desde checkpoint;
- [ ] `incremental`: paths do journal/diff;
- [ ] `full-reconcile`: gap/inconsistência/migration/manual.

### 3.4 Métricas

- [ ] scanned files;
- [ ] hashed files;
- [ ] incremental paths;
- [ ] reason for full reconcile.

**Gate:** no-change restart <400 ms no primeiro marco e convergindo para <200 ms.

---

## Fase 4 — Contrato MCP estável, batching materializável e `tools/list` com folga

### 4.1 Payload audit

- [ ] transformar o audit já existente em gate reproduzível de CI/validation;
- [ ] listar top schemas/descriptions/meta.

### 4.2 Compactação

- [ ] reduzir descriptions sem perder precisão;
- [ ] revisar metadata repetida;
- [ ] manter compatibility only where required.

### 4.3 Nova batch capability

- [ ] somente após liberar orçamento;
- [ ] preferir **uma** `repo_io_batch` read-only em vez de várias tools;
- [ ] operações: read/search/stat inicialmente;
- [ ] output compacto e bounded;
- [ ] nome/schema novos e estáveis, evitando depender de refresh de schema de tools antigas.

**Gate:** tools/list ≤120 KiB ou ≥8 KiB de headroom após a nova capacidade.

---

## Fase 5 — Capability segura de path validado

### 5.1 Tipo/capability interna

- [ ] issuer somente no policy layer;
- [ ] mode/workspace/policyVersion codificados;
- [ ] sem serialização pelo MCP.

### 5.2 Workspace IO fast path

- [ ] capability evita segundo realpath;
- [ ] string comum continua caminho completo.

### 5.3 Testes

- [ ] symlink escape continua bloqueado;
- [ ] capability não pode ser falsificada por objeto comum;
- [ ] microbenchmark antes/depois.

**Gate:** ganho demonstrável sem reduzir cobertura de segurança.

---

## Fase 6 — Cloudflare diagnostic plane compartilhado

### 6.1 Fresh snapshot cache

- [ ] um snapshot comum para remote/config/edge/skip;
- [ ] TTL 30–60 s por default de investigação;
- [ ] `forceRefresh` explícito preservado.

### 6.2 Composite audits

- [ ] reutilizar chamadas API já resolvidas;
- [ ] não fazer N lookups de zone/tunnel/rulesets no mesmo diagnóstico.

### 6.3 Session guidance

- [ ] deep Cloudflare calls somente após change/incident.

**Gate:** segundo diagnóstico composto sobre snapshot fresco <100 ms local.

---

## Fase 7 — Performance gates contínuos

### 7.1 Gates leves

- [ ] tools/list budget;
- [ ] session/profile payload budget;
- [ ] hot read/search microbench;
- [ ] no-change index startup budget;
- [ ] cross-process invalidation lag.

### 7.2 Escalação

- [ ] broad validation apenas quando alteração transversal justificar;
- [ ] Cloudflare remote smoke apenas quando camada de rede/connector mudar;
- [ ] provider/LLM nunca necessário para provar I/O/MCP performance.

---

# PARTE IV — PRIORIZAÇÃO

## 18. Ordem de implementação

### P0 — executar imediatamente

1. payload rankings no latency dashboard;
2. compactar `mcp_tools_status`;
3. compactar `mcp_session_profile` e reduzir first-call policy;
4. atualizar documentação/guidance e medir bytes.

### P0/P1 — próxima transformação estrutural

5. cross-process invalidation journal;
6. prova multi-process sem LLM/provider.

### P1

7. index checkpoint/incremental startup;
8. ampliar intervalo de safety hash somente com fallback claro;
9. compactar registry e liberar tools/list headroom;
10. expor batch por contrato novo estável, se o host continuar sem materializar schema alterado.

### P2

11. validated-path capability;
12. Cloudflare shared diagnostic snapshot.

### P3

13. tuning fino de TTL/trust windows somente depois de cross-process coherence;
14. novos caches apenas se benchmark provar necessidade.

---

## 19. Hipóteses explicitamente rejeitadas

- **“Ativar L2 porque há dois processos.”** Rejeitado pelo benchmark: L2 é mais lento que cold read.
- **“Cloudflare é o principal motivo de read/search lentos.”** Rejeitado: hot handlers locais estão em poucos/dezenas de ms e stateful reuse funciona.
- **“Trocar QUIC por H2 deve acelerar tudo.”** Sem evidência; QUIC RTT ~24 ms e 4 conexões saudáveis.
- **“Desligar OAuth reduz latência.”** Irrelevante para o hot path graças a caches e prejudicaria fronteira útil.
- **“Desligar realpath/path policy.”** Desnecessário; a solução correta é capability interna para eliminar duplicação.
- **“Full scan/hash a cada restart é necessário para consistência.”** Não quando houver journal, rich fingerprint, checkpoint e fallback de reconciliation.
- **“Mais tools sempre aumentam liberdade.”** Falso sob limite de `tools/list`; liberdade efetiva depende de capacidade por byte e schema realmente materializável.

---

## 20. Estado inicial desta nova frente

- HEAD de partida: `8a525c58b`;
- branch: `main`;
- upstream sincronizado no início;
- connector permanente: `https://mcp.aurelin.org/mcp`;
- tool parity: 116/116;
- tools/list: 127.971 bytes;
- autonomy score: 91/A;
- stateful fallback: 0;
- rollback automático: off;
- validação anterior: green;
- unrelated/preexisting working-tree changes devem permanecer intocados.

A partir deste ponto, qualquer implementação desta frente deve ser registrada neste arquivo com métricas antes/depois, commits e eventual mudança de prioridade.

---

# PARTE V — LOG DE EXECUÇÃO

## 21. Lotes implementados

### 21.1 Lote 1 — bootstrap compacto e governança de payload

Implementado:

- `mcp_tools_status` deixou de devolver os 116 summaries completos e passou a devolver counts, cobertura de metadata, approval strategy e listas realmente operacionais;
- `mcp_session_profile` tornou-se task-first: `recommendedFirstCalls` caiu de 16 chamadas para apenas `repo_status`; Cloudflare/OAuth/deep runtime diagnostics foram movidos para `diagnosticsOnDemand`;
- `mcp_latency_dashboard` ganhou `largestResultPayloads` e `highestResultVolume`, além de resumo do maior payload médio e maior volume acumulado;
- testes passaram a impor budgets explícitos de <15 KiB para tools status e <10 KiB para session profile.

Prova live após reload:

- `mcp_tools_status`: **110.142 → 4.572 bytes**;
- `mcp_session_profile`: **43.895 → 5.455 bytes**;
- `recommendedFirstCalls`: **16 → 1**;
- `tools/list`: **127.971 → 127.935 bytes**, mantendo **116/116** tools e parity integral;
- focused MCP tools: passed;
- strict typecheck: passed em 7,769 s;
- lint: passed em 18,342 s.

Esse lote fecha o maior desperdício de contexto encontrado no bootstrap sem remover capacidade: detalhes continuam disponíveis por tools específicas, mas deixam de ser pagos em toda sessão.

### 21.2 Lote 2 — coherence plane MCP ↔ processos locais

Implementado um journal de invalidação cross-process em SQLite/WAL, acoplado ao bus canônico **depois** do debounce local de 50 ms. MCP e demais processos locais que usam a mesma infra mantêm caches L1 próprios, mas propagam informação de mudança por `sequence`; eventos do próprio processo avançam o cursor sem serem reaplicados, e eventos remotos invalidam os hooks locais sem gerar loop. O fingerprint rico do filesystem continua sendo o fallback independente.

Provas:

- teste com duas conexões SQLite independentes: evento remoto recebido, own-row não reaplicada e source/recursive preservados;
- teste com **dois processos Node reais**: propagação exigida e aprovada em **<250 ms**;
- strict typecheck aprovado após integração;
- live MCP após reload: `published=1`, `ownRowsObserved=1`, `writeErrors=0`, `readErrors=0`, `gapDetections=0`;
- 213 polls medidos consumiram **26,43 ms** no total: **0,124 ms/poll** de média e 0,403 ms de máximo;
- com `pollMs=125`, isso representa aproximadamente **0,99 ms de trabalho por segundo de runtime**, pequeno o suficiente para preservar a janela sub-250 ms;
- um publish real consumiu **0,201 ms**, muito abaixo do SLO de 2 ms e fora do critical path do patch.

Decisão: manter `pollMs=125`. Aumentar o intervalo pouparia pouco e pioraria freshness; reduzir o intervalo não traz benefício operacional suficiente. O Lote 2 está fechado e habilita o próximo passo: usar mudança persistida/checkpoints para reduzir o full scan/hash do auto-index.

### 21.3 Lote 3 — auto-index checkpointed/incremental

O startup do index deixou de equivaler a um scan completo. Foi criado um checkpoint persistente em SQLite com `HEAD`, schema version e relógio da última full reconciliation, combinado com evidência Git scoped (`status --porcelain -z --untracked-files=all --no-renames`) e refresh explícito por path. O planner possui três modos observáveis:

- `skip`: HEAD e worktree scoped inalterados;
- `incremental`: HEAD mudou e/ou existem paths dirty/untracked;
- `full-reconcile`: checkpoint ausente, index vazio, schema mudou, Git ficou incerto, refresh incremental falhou ou chegou a safety reconciliation periódica (default 30 min).

O refresh incremental usa o fingerprint rico já persistido no index (`mtime/size/ctime/dev/ino`) antes de ler/parsing; dirty path com fingerprint idêntico vira stat-only skip. Arquivos removidos/non-indexable invalidam a entrada. A full reconciliation permanece como safety net e o hash periódico do index não foi removido.

Prova live em quatro etapas:

1. baseline anterior: **1.377–1.596 ms**, ~1.438 candidatos e ~1.434–1.436 hashes por restart;
2. primeiro reload com novo código e checkpoint ausente: `mode=full-reconcile`, **1.390 ms**, 1.439 candidatos, 1.434 hashes — comportamento conservador esperado;
3. segundo reload, mesmo HEAD e worktree dirty: `mode=incremental`, **217 ms**, apenas **11 paths**, 0 scans e 0 hashes — ~6,4× mais rápido;
4. steady-state sem mudança de conteúdo entre reloads: **49 ms**, 12 paths observados, **0 indexed / 12 unchanged**, 0 scans, 0 hashes; `gitSnapshotDurationMs=38`.

Resultado: o restart steady-state do auto-index caiu de ~1,39 s para **49 ms**, redução de ~96,5% e aceleração aproximada de **28×**, superando inclusive o SLO ideal <200 ms. O custo dominante restante nesse caminho já não é filesystem/index: é o snapshot Git scoped (~38 ms).

Gates do marco Lotes 1–3:

- focused cross-process invalidation: passed em 1,324 s, incluindo processo Node real e SLO <250 ms;
- focused index checkpoint planner: passed em 1,638 s;
- focused index SQLite: passed em 1,499 s;
- strict typecheck final: passed em 6,139 s;
- lint: passed em 23,590 s;
- `mcp_smoke_workspace`: **136 ms / 13 checks**, sem critical;
- connector smoke fresh: **927 ms** de orquestração, OAuth autenticado 911 ms, `tools/list=127.935 bytes`, **116/116** e parity integral.

Provas adicionais após o commit `d881b5035`:

- primeiro restart após a mudança de `HEAD`: `mode=incremental`, reason `head-changed`, **64 ms**, 12 paths, 1 indexed/11 unchanged, 0 hashes, Git snapshot 39 ms + committed diff 7 ms;
- restart seguinte, `HEAD` estável e `src/copilot` limpo: `mode=skip`, **48 ms**, **0 candidates / 0 scans / 0 hashes / 0 reads**, Git snapshot 40 ms.

### 21.4 Lote 4 — tools/list budget e metadata específica

Foi criada uma auditoria wire in-memory baseada no próprio SDK MCP e tornada também observável pela tool existente `mcp_tools_status`, porque o host desta conversa não materializou o novo nome `mcp_tool_payload_audit` mesmo após reload. Esse fato confirma que capacidades novas devem ter contrato estável para sessões futuras, mas não podem depender de hot schema discovery do host atual.

Baseline do audit com 117 tools:

- envelope: **128.591 bytes**;
- `inputSchema`: 48.997 bytes;
- descriptions dentro dos input schemas: 19.835 bytes, porém truncar todas a 48 chars economizaria apenas 2.506 bytes;
- `outputSchema`: **16.662 bytes**, quase integralmente 115 cópias do mesmo placeholder permissivo `success?: boolean`;
- `_meta`: 18.659 bytes;
- annotations: 10.465 bytes.

Decisão: preservar integralmente input schemas e suas descrições; remover apenas o **output schema genérico**, mantendo output schemas específicos onde há validação real (`search` e `fetch`). `securitySchemes` continua 100% obrigatório. A métrica de autonomia foi corrigida para `outputSchemaPolicy=specific-only`, evitando que o score incentive metadata sem poder de validação.

Prova live:

- audit in-memory: **128.591 → 110.766 bytes** (-17.825; -13,9%);
- authenticated remote `tools/list`: **128.782 → 110.957 bytes** com a nova audit tool já incluída;
- tools: **117/117**, parity integral;
- headroom interno: **20.306 bytes**;
- autonomy score: **91/A**, inalterado;
- focused registry/tools tests e strict typecheck passaram após a mudança.

O objetivo ≤120 KiB foi superado sem reduzir input validation, OAuth/security metadata ou capacidade funcional.

### 21.5 Lote 5 — latência dos validators

Depois de reduzir read/search/index/bootstrap, os validators passaram a dominar o tempo de iteração. O strict project já declarava `tsBuildInfoFile`, mas não habilitava `incremental`; a opção foi ativada sem alterar nenhum strict check, include ou `noEmit`.

Medição:

- runs strict recentes antes da mudança: aproximadamente **8,10–9,33 s** (com runs anteriores chegando a 15 s em cold state);
- primeiro run com `incremental=true`: **5,534 s**;
- segundo run consecutivo: **5,493 s**;
- ganho recorrente observado: aproximadamente **32–41%** sobre o baseline recente.

O ESLint já usava cache persistente. Foi testado `--concurrency auto` de forma A/B:

- concorrência auto: **20,506 s** em run verde;
- concorrência removida, mesma cache: **13,739 s**;
- decisão: **não habilitar concorrência** neste workload; a configuração original single-thread/cache é materialmente melhor.

A regra desta frente permanece: otimização de validator só entra quando preserva o mesmo conjunto de checks e vence benchmark real; mudanças que apenas parecem mais paralelas não são mantidas.

### 21.6 Lote 6 — Cloudflare diagnostic plane compartilhado

Os audits `edge`, `config` e `skip` inspecionavam famílias sobrepostas de zone rulesets, mas cada um pagava `rulesets.list` + `rulesets.get` próprios. Foi criado `cloudflare/ruleset-snapshot.js`: snapshot in-process de 60 s, chaveado por fingerprint não reversível do token + zone id, com `rulesets.get` em concorrência limitada a 6. O token nunca é retornado pelo snapshot. `forceRefresh` continua atravessando até a API e os caches aceitam override bounded.

Também foram alinhados para uma janela diagnóstica default de 60 s:

- edge audit;
- config audit;
- skip audit (que ganhou cache próprio);
- remote tunnel/DNS audit.

Medições live após reload, comparadas ao baseline frio anterior desta investigação:

- edge: **4.606 ms → 3.028 ms** no primeiro fetch (-34%); repetição quente **4 ms**;
- config: **2.721 ms → 1.564 ms** no primeiro fetch (-42%); repetição quente **14 ms**;
- skip: **3.476 ms → 521 ms** no primeiro fetch após edge/config (-85%); repetição quente **7 ms**;
- remote audit: cold ~**3.449–3.536 ms**, repetição quente **4 ms** com TTL 60 s.

O remote audit ainda aparecia como maior payload de diagnóstico: ~**51.284 bytes** por chamada, porque repetia o perfil desejado de `originRequest` em múltiplas subárvores. A função canônica rica foi preservada para policy/diff/backup; apenas a tool MCP foi compactada para estado operacional, score, drift e campos efetivos. Prova live após reload:

- `mcp_cloudflare_remote_audit`: **51.284 → 4.729 bytes** por resultado, redução de ~90,8%;
- cold handler continuou dominado pela API externa (~3,45 s), mas warm handler ficou **3–4 ms**;
- tunnel continua healthy, 4/4 conexões ativas, `http2Origin=true`, TLS verification ativa e DNS apontando para o tunnel esperado.

Testes focados de edge audit, config, remote API/compact presentation e strict typecheck passaram. O diagnostic plane agora paga a rede uma vez por janela de investigação e reutiliza a mesma evidência sem enfraquecer `forceRefresh`.

### 21.7 Lote 7 — batching materializado e capability opaca de path read-only

Durante esta sessão o host finalmente materializou os campos `batch` já existentes em `repo_read_file` e `repo_search_text`. Um experimento de nova tool `repo_io_batch` foi implementado e testado localmente, mas **retirado integralmente antes de commit** quando ficou claro que seria redundante: acrescentava ~1,6 KiB ao registry sem aumentar a liberdade do host atual. A decisão correta foi reutilizar as tools existentes.

Prova live do batching materializado:

- uma chamada `repo_read_file(batch=...)` executou **4 leituras independentes**, `4/4` success, concurrency 4;
- handler agregado warm: **6 ms** (prova anterior: 7 ms);
- efeito estrutural: 4 unidades lógicas de read passam de quatro round-trips MCP para **um**.

A investigação seguinte confirmou duplicação de path policy: `resolveReadPath` já executava `evaluateIoPathPolicyAsync`/realpath e, depois, `workspace-io` repetia a mesma policy ao receber o realPath absoluto. Foi criada uma capability interna read-only, com brand por `Symbol` privado, ligada ao workspace, à `IO_POLICY_VERSION` e a access=`read-only`. A capability é emitida no mesmo ponto do sucesso da policy canônica (`validatePath`) e só pode ser consumida por métodos internos explícitos para `read`, `search` e `stat`.

Garantias preservadas:

- input normal continua passando pela policy async completa;
- objeto lookalike sem brand é rejeitado (`EINVALIDVALIDATEDPATH`);
- capability de outro workspace é rejeitada (`EVALIDATEDPATHWORKSPACE`);
- capability read-only em modo mutável é rejeitada (`EVALIDATEDPATHMODE`);
- nenhum método validated existe para write/patch/delete;
- testes existentes de symlink/containment continuam cobrindo o primeiro gate canônico.

Observabilidade foi adicionada ao runtime health (`ioCache.validatedReadPath`). Prova live após reload:

- 4 reads + 4 searches produziram **8 `accepted`**, isto é, oito segundas walks de policy/realpath foram eliminadas;
- `rejectedUnbranded=0`, `rejectedWorkspace=0`, `rejectedMode=0` no uso normal;
- batch warm de 4 reads: **6 ms** de handler;
- batch de 4 searches: **9 ms** de handler;
- focused `test_workspace_io.spec.js` passou com testes específicos de brand/workspace/mode;
- focused `test_mcp_tools.spec.js` passou;
- strict typecheck passou após integração.

O ganho de latência absoluta por read é pequeno porque o hot path já estava em poucos milissegundos; o ganho principal é remover trabalho redundante em todas as chamadas read/search/stat sem enfraquecer a fronteira externa. O próximo critério continua sendo custo acumulado, round-trips e bytes, não micro-otimização isolada.

## 22. Faixa nova — Bulk Execution Plane e compressão de round-trips

### 22.1 Diagnóstico objetivo antes da implementação

A investigação de 17/08/2026 passa a tratar **round-trip como recurso de primeira classe**, separado da latência interna da operação. O estado medido no início desta faixa é:

- registry: **117 tools / 110.739 bytes**, com **20.333 bytes de headroom** sob o budget histórico de 128 KiB;
- corpo HTTP MCP: limite default **2 MiB** (`COPILOT_MCP_MAX_REQUEST_BODY_BYTES`);
- resultado MCP: limite default **2 MiB** (`COPILOT_MCP_REGISTRY_MAX_TOOL_RESULT_BYTES`), configurável até 64 MiB;
- `repo_read_file` e `repo_search_text`: batch máximo **10**, concorrência fixa **4**;
- prova live anterior: **4 reads em 1 call = 6 ms**; 4 searches em 1 call = 9 ms;
- porém uma exceção lançada por qualquer worker de `repo_search_text(batch=...)` faz o `Promise.all` rejeitar e transforma o batch inteiro em `MCP_TOOL_EXECUTION_FAILED`, perdendo os resultados úteis das demais suboperações;
- `repo_apply_patch_batch`: máximo **10** operações; para apply real executa **preflight completo** e depois executa novamente o conjunto;
- o engine compartilhado `patchTextBatchLocked` já garante, por arquivo, **1 lock + 1 read + simulação sequencial completa + 1 write**, e só grava depois de todas as operações daquele arquivo terem sido validadas;
- portanto o segundo passe de patch não é necessário para atomicidade **intra-target**, mas o preflight global atual fornece uma garantia adicional: nenhum target começa a gravar quando outro target já é inválido;
- `repo_apply_file_batch`: preview global + apply serial; uma exceção é capturada no nível externo e pode ocultar qual parte do lote já foi processada, o que força chamadas extras de diagnóstico;
- Git governado normalmente exige `stage_plan → stage → commit_plan → commit → push_plan → push`; além disso `git_push` repete um `push --dry-run` mesmo quando `git_push_plan` já fez um;
- validators exigem hoje `run_copilot_validator` + 1–N `job_get_summary` e, em falha, `job_get_output`; typecheck/lint normalmente terminam dentro de uma janela em que uma única chamada poderia esperar de modo bounded;
- a LLM-B local usa o mesmo `createWorkspaceIo`, caches, locks e invalidation plane, mas suas tools são distintas; `patch_file` continua single-operation. Logo otimizações que existam apenas no schema MCP não beneficiam o runtime local.

O diagnóstico também revelou um ponto de governança de payload: `mcp_runtime_health` ainda retorna ~**37,6 KiB no modo default** e ~50–56 KiB em detail; a compactação default já estava em implementação quando esta faixa começou e deve ser concluída antes dos novos lotes.

### 22.2 Estado-alvo arquitetural

Será criado um **Bulk Execution Plane compartilhado**, com primitive em `infra` e adapters MCP/LLM-B independentes. O contrato arquitetural terá:

1. **isolamento de falha por item**: exceção de uma suboperação não rejeita automaticamente o lote inteiro;
2. **failure policy explícita**:
   - `best-effort`: tenta todos os itens independentes;
   - `fail-fast`: interrompe após a primeira falha e marca o restante como `skipped`;
   - `atomic-per-target`: operações do mesmo target são sequenciais e atômicas sob um único lock; targets distintos continuam isolados;
3. **concorrência bounded e observável**, com default adaptado ao tipo de workload em vez de `Promise.all` irrestrito;
4. **budget duplo**: limite por número de operações **e por bytes agregados de input/output**;
5. **batchId/trace + feedback completo**: attempted/succeeded/failed/skipped, duração por item/target, wall time, concurrency efetiva, códigos de erro e próximo passo;
6. **result hints não enumeráveis** para o registry contabilizar `logicalOperations`, `failedOperations` e taxa de compressão de round-trip sem inflar o wire payload;
7. **nenhum segundo caminho de filesystem**: adapters continuam usando `createWorkspaceIo`, locks, cache, coherence journal e validated-path capability;
8. **segurança por capability**, não por repetição de validações: modos rápidos nunca recebem uma capability de write reutilizável fora da seção crítica;
9. **fallback conservador** sempre disponível; otimizações de patch que reduzam preflight serão opt-in/explicitamente nomeadas quando alterarem semântica entre targets;
10. **compatibilidade com LLM-B**: primitives de batch e métricas ficam abaixo do MCP; tools locais podem reutilizá-las sem compartilhar auth/schema MCP.

### 22.3 Arquitetura de reads/searchs massivos

O plano de leitura terá duas camadas:

- ampliar `repo_read_file`/`repo_search_text` existentes para lotes maiores, mantendo compatibilidade e passando a capturar falha por item;
- adicionar, se o custo de registry permanecer aceitável, uma **tool heterogênea de bulk read** capaz de combinar read/search/stat/outline/symbol em uma única chamada, com schema compacto (`op + args`) e validação interna específica.

Meta inicial:

- 32 operações por chamada como default hard cap inicial;
- concurrency bounded 4–8;
- `best-effort` default para reads;
- 100% dos itens retornam status explícito;
- nenhuma exceção de um item derruba resultados já disponíveis de outro;
- `logicalOperations/call` exposto no dashboard.

A elevação acima de 32 será condicionada ao budget de resultados, pois o gargalo real de leitura massiva passa a ser contexto/payload, não disco.

### 22.4 Arquitetura de patch massivo

Patch será tratado por **target groups**. O engine `patchTextBatchLocked` é a primitive canônica intra-arquivo. Dois modos de apply serão oferecidos:

- `global-preflight`: semântica conservadora atual; todos os targets são simulados antes de qualquer write;
- `per-target-fast`: elimina o passe global duplicado; cada target é validado e aplicado dentro de sua seção crítica atômica. Uma falha num target não invalida um target independente já concluído, e isso aparece explicitamente em `partial=true`/`failedTargets`.

O segundo modo existe para ambientes confiáveis e iteração de alta performance; não será escondido sob o mesmo nome sem sinalização. A meta é elevar o batch para **32–64 operações**, com limite agregado de input e número de targets, e paralelismo apenas entre targets independentes.

### 22.5 File mutations, Git e validators

`repo_apply_file_batch` será reforçado para nunca perder informação em falha: retorno deve conter `planned`, `applied`, `failed`, `skipped` e `failureIndex`, inclusive em execução parcial.

Será criada uma alternativa Git de alto nível, sem arbitrary shell/remotes/refspecs/force, que possa fazer **stage explícito + commit + push upstream** em uma chamada governada. As tools granulares continuam existindo como fallback e para investigações. O objetivo é reduzir o fluxo normal de 4–6 chamadas para 1, mantendo paths explícitos e HEAD/upstream preconditions.

`run_copilot_validator` ganhará espera bounded opcional. Quando o job concluir dentro da janela, a mesma chamada retorna summary e, somente em falha, um tail curto; se não concluir, retorna job id/running como hoje. Isso elimina polling no caso comum sem transformar jobs longos em chamadas bloqueadas indefinidamente.

### 22.6 Payload e transporte

Não há razão imediata para elevar o limite global de resultados: **2 MiB** já é muito acima do payload desejável para interação normal. O corpo HTTP de **2 MiB** pode se tornar gargalo para patch massivo; antes de elevá-lo, o Bulk Execution Plane terá budget próprio por bytes. Se os benchmarks mostrarem necessidade real, o default MCP poderá subir para 4–8 MiB mantendo um limite de input menor por tool e rate limiting existente.

O `tools/list` também não será artificialmente mantido abaixo de 128 KiB se isso impedir capacidades que eliminem muitos round-trips. O novo princípio é: **bytes de descriptor devem ser avaliados contra round-trips eliminados**, preservando security metadata e schemas que realmente validam.

### 22.7 Roadmap operacional desta faixa

**Fase R0 — concluir o lote interrompido**

- corrigir a tipagem da compactação de `mcp_runtime_health`;
- provar default <15 KiB e detail integral disponível.

**Fase R1 — shared Bulk Execution Plane**

- primitive bounded em infra;
- policies `best-effort`/`fail-fast`;
- metrics/result execution hint;
- testes de exception isolation, order preservation e concurrency cap.

**Fase R2 — read/search**

- migrar batch atual para a primitive compartilhada;
- 32 items;
- falha por item;
- métricas logicalOps/call;
- avaliar/implementar bulk read heterogêneo.

**Fase R3 — patches**

- elevar operação/byte budgets;
- target grouping compartilhado;
- manter `global-preflight`;
- adicionar `per-target-fast`;
- feedback partial/failure/skipped sem segunda chamada diagnóstica.

**Fase R4 — validators e Git**

- bounded wait em validator;
- combined governed Git publish;
- manter tools granulares como fallback.

**Fase R5 — LLM-B local**

- reutilizar o bulk executor em read/patch tools locais;
- sem compartilhar schemas MCP;
- verificar coherence journal/cache/invalidation sob chamadas concorrentes dos dois runtimes.

**Fase R6 — transport/payload tuning**

- somente após medições dos lotes anteriores;
- elevar request body/tools-list budgets se a capacidade nova justificar objetivamente.

Critério de saída: uma investigação/edição típica que hoje requer 10–30 chamadas deve ser realizável com **2–6 chamadas**, mantendo feedback suficiente para continuar após falha sem reler estado desnecessariamente.

### 22.8 Execução R0–R5 — implementação concluída e evidência

A arquitetura acima foi implementada de forma compartilhada entre MCP e a tool layer local da LLM-B, sem criar um filesystem paralelo.

**R0 — runtime health compacto**

- `mcp_runtime_health` passou a separar default operacional e detail rico;
- medição anterior desta mesma faixa: ~37,6 KiB → **14.180 bytes** no default, abaixo do SLO de 15 KiB;
- detail continua opt-in por `includeDetails=true`;
- após os reloads finais o runtime permaneceu `status=ok`, sem warnings/critical.

**R1 — Bulk Execution Plane compartilhado**

- nova primitive `src/copilot/infra/bulk-executor.js`;
- policies `best-effort` e `fail-fast`;
- ordem preservada, concorrência bounded, `executionId`, attempted/succeeded/failed/skipped e timings por item;
- budgets por item count e bytes de input;
- result execution hint não enumerável integrado ao registry/metrics;
- teste focado `test_bulk_executor.spec.js`: passed; retomada pós-crash: **5,643 s**.

**R2 — read/search massivos e bulk heterogêneo**

- `repo_read_file.batch`: **10 → 32** itens no contrato canônico;
- `repo_search_text.batch`: **10 → 32** itens;
- default concurrency **6**, hard max **8**;
- `best-effort` default; exceção/erro de um worker deixa de derrubar o batch inteiro;
- budget agregado de output: **1 MiB default / 1,5 MiB máximo**; campos pesados `content`/`output` podem ser truncados sem perder status/hash/erros;
- nova `repo_bulk_inspect`: até 32 operações heterogêneas `read | search | stat` no mesmo call, schema compacto `{op,args}` e validação específica interna;
- live pós-reload: **10 operações lógicas em uma call**, concurrency 6, `9 succeeded / 1 failed / 0 skipped`, falha ENOENT isolada, **37,355 ms** de wall time interno, 5.441 bytes de resultado e zero truncamentos;
- dashboard pós-prova: `repo_read_file logicalOperationsPerCall=10`, `compressedRoundTrips=9` para essa call.

**R3 — patch massivo por target**

- `repo_apply_patch_batch`: até **64 patches / 32 targets / 1,5 MiB de input**;
- operações do mesmo arquivo usam `patchTextBatchLocked`: 1 lock + 1 read + simulação sequencial + 1 write atômico;
- targets distintos passam pelo shared bulk executor;
- `global-preflight` preserva a garantia conservadora de zero writes quando qualquer target falha na simulação;
- `per-target-fast` elimina o passe global duplicado e permite partial success explícito entre targets independentes;
- retorno inclui `partial`, failed/skipped counts, concurrency, duration e feedback por operação;
- preflight bem-sucedido deixou de ser duplicado integralmente no resultado real: default retorna `preflightSummary`; detalhes completos são opt-in;
- testes provaram zero-write global-preflight, partial success cross-target e atomicidade same-target;
- plano com 12 patches passou, superando o limite legado de 10.

Uma prova live revelou ainda um edge case de adapter: uma chamada enviada com `dryRun=false, confirmBatch=true` chegou ao handler como se `dryRun` tivesse sido omitido e foi conservadoramente tratada como dry-run. Foi introduzido `resolveBatchDryRun`: `dryRun=true` sempre vence; `dryRun=false` continua real apply; quando o boolean opcional some, **`confirmBatch=true` é tratado como a intenção explícita de escrita**. O mesmo resolver é usado nos batches de patch e file mutations. Prova live após reload: no-op permitido com apenas `confirmBatch=true` retornou `dryRun=false`, preflight global green e apply concluído em **9,939 ms**, sem alteração lógica do arquivo.

**R4 — validators, file mutations e Git composto**

- `repo_apply_file_batch`: limite canônico ampliado para 32 operações; execução dependente continua serial, mas uma falha agora devolve `planned`, `applied`, `appliedCount`, `failureIndex`, `skippedCount`, `partial` e fase, evitando releitura defensiva;
- `run_copilot_validator` ganhou bounded wait in-memory; `unit-focused`, `typecheck` e `lint` usam inline completion por default e devolvem tail curto apenas em falha; suites amplas continuam assíncronas;
- prova pós-WSL: strict typecheck terminou **na própria call** em **6,516 s**; run posterior após ajustes finais: **9,002 s**;
- nova `git_publish_changes`: índice inicialmente limpo + paths explícitos + stage + commit + push opcional ao upstream já configurado, sem arbitrary remote/refspec/force; verifica após `git add` que nada fora dos paths explícitos entrou no index;
- `push --dry-run` na tool composta é opt-in, evitando o round-trip de rede duplicado por default;
- se push falhar depois do commit, o resultado informa `committed=true` e o HEAD criado, permitindo recuperação sem adivinhar estado;
- metadata corrigida para representar `git_publish_changes` simultaneamente como destructive e `openWorldHint=true`; `mcp_tools_status` agora conta open-world pela annotation, não por um riskClass mutuamente exclusivo.

Durante o gate final, `run_copilot_validator(unit-focused)` foi bloqueado **antes de chegar ao MCP** pela camada host da OpenAI (`CHATGPT_HOST_PRECALL_BLOCK`). `mcp_host_block_diagnostics` confirmou `mcpReachedServer=false`; a validação foi executada pelo fallback allowlisted `delegate_to_repo_autonomy_runner(validate-focused)` e passou em **5,347 s**. Isso deve ser tratado como host friction, não como falha do validator/repo.

**R5 — LLM-B local**

- nova `read_files_batch`: leitura UTF-8 massiva com o mesmo bulk executor e budget agregado de output;
- nova `patch_files_batch`: same-target atômico via `patchTextBatchLocked`, independent targets via shared executor;
- nenhuma tool local chama a tool MCP por baixo; MCP e LLM-B compartilham infra, locks, cache, validated-path/coherence plane, mas mantêm schemas/auth/presentation próprios;
- teste `test_bulk_file_tools.spec.js`: passed; retomada pós-crash: **1,879 s**;
- rollback automático permanece desligado nesse caminho.

### 22.9 Accounting de round-trip e estado live final

O registry agora contabiliza unidades lógicas sem inflar o payload do tool result. Snapshot live após o segundo reload:

- MCP calls observadas no snapshot: **4**;
- logical operations: **13**;
- logical operations/call: **3,25**;
- batch calls: **1**;
- compressed round-trips: **9**;
- batch `repo_read_file`: **10 logical ops/call**;
- failed logical operations: **1**, preservando 9 resultados úteis;
- handler médio global: **32 ms**;
- authorization médio: **3 ms**;
- slowest average tool no snapshot: **48 ms**;
- status do dashboard: **ok**, sem regressão material contra o snapshot anterior.

Payload/registry pós-implementação:

- tools locais/remotos: **119/119**, parity integral;
- authenticated remote `tools/list`: **116.092 bytes**;
- audit in-memory: **115.901 bytes**;
- headroom sob 128 KiB: **15.171 bytes**;
- `inputSchema` continua sendo a maior família de bytes; não foi removida validação para ganhar espaço;
- `mcp_tools_status`: `openWorldCount=4`, cobrindo `git_publish_changes`, `git_push`, `git_push_plan` e `llmb_live_test_run`;
- `CAPABILITIES_VERSION=46`;
- guidance operacional agora recomenda 2–32 reads/searches, `repo_bulk_inspect`, patch 64/32, inline validator completion e `git_publish_changes`.

Connector pós-reload final:

- permanent URL: `https://mcp.aurelin.org/mcp`;
- transport: QUIC;
- `mcp_post_restart_readiness`: **ready=true**;
- connector smoke: **ok**;
- OAuth authenticated smoke: **1.050 ms**;
- orchestration total: **1.059 ms**;
- SSE initial + reconnect: green;
- authenticated tools/list: 119/119 e zero missing/unexpected.

### 22.10 Incidente operacional — queda inesperada do WSL

No meio dos gates finais o WSL caiu inesperadamente, derrubando origin MCP, Cloudflare child processes e o container de execução; as chamadas passaram a 502 e o fallback local retornou `ENOENT`. Nenhuma dessas falhas foi classificada como regressão de código.

Após restart/reconnect:

- branch `main`, HEAD `880d3b47c`, upstream sincronizado;
- todo o lote não commitado sobreviveu no worktree;
- tunnel permanente voltou healthy em QUIC;
- strict typecheck inicialmente encontrou apenas um erro `exactOptionalPropertyTypes` no adapter `stat` de `repo_bulk_inspect`; corrigido sem mudança semântica;
- gates pós-correção: typecheck green, Bulk Executor green, MCP tools green, jobs green, registry green, runtime metrics green e bulk tools LLM-B green;
- dois reloads controlados foram suficientes para ativação e para o hotfix de `confirmBatch`; readiness final voltou a `true`.

O incidente reforça uma propriedade desejável do desenho: estado de source/worktree, checkpoints SQLite e evidência de validators sobreviveram à perda abrupta do runtime, e a retomada pôde continuar por gates compactos sem refazer a investigação arquitetural.

### 22.11 Decisão R6 — não elevar o ceiling global por enquanto

A elevação global de `COPILOT_MCP_MAX_REQUEST_BODY_BYTES` / `COPILOT_MCP_REGISTRY_MAX_TOOL_RESULT_BYTES` fica **adiada por evidência**, não por limitação arquitetural. Os novos envelopes por tool (1–1,5 MiB para read/search output e 1,5 MiB para patch input) mantêm cada operação massiva abaixo do ceiling MCP atual de 2 MiB. O `tools/list` possui ~15 KiB de headroom mesmo com 119 tools.

Portanto, elevar agora o default global para 4–8 MiB aumentaria blast radius/context pressure sem resolver um gargalo medido. R6 só deve reabrir quando telemetry mostrar rejeição real de input/output por ceiling global em workloads legítimos.

### 22.12 Estado desta faixa

R0–R5: **concluídos e provados**.

R6: **evidence-gated / não necessário no estado atual**.

Próximos ganhos de latência devem ser escolhidos pelo novo `highestCumulativeCost`, `highestCallPressure`, `highestResultVolume` e `roundTripAccounting`, evitando voltar ao padrão de otimizar apenas a chamada individual mais lenta.

### 22.13 Sublote pós-R5 — `mcp_tools_status` volta a ser status, não audit dump

O primeiro snapshot do novo dashboard mostrou que `mcp_tools_status` havia voltado a ser o maior payload do hot control plane: **17.886 bytes por chamada**. A causa não era a informação operacional de counts/risks/approvals, mas a inclusão integral de `fieldTotals`, 12 rows detalhadas de `topTools` e recomendações da auditoria wire. Além disso, cada chamada reconstruía um par MCP SDK client/server em memória para medir `tools/list`, embora o registry seja imutável durante a vida do processo.

Correção:

- `mcp_tools_status` mantém apenas summary wire: tool count, envelope/headroom, average/p50/p95, maior família de bytes e os 3 maiores descriptors apenas com `name + totalBytes`;
- `fieldTotals`, decomposição completa por descriptor e recomendações permanecem integralmente disponíveis em `mcp_tool_payload_audit`;
- summary wire ganhou cache por processo; erro invalida a promise para permitir retry, mas chamadas normais não reconstroem novamente o transport SDK in-memory;
- teste passou a impor payload de `mcp_tools_status` **<8 KiB** e a proibir `fieldTotals`, `topTools` e `recommendations` no status compacto.

Prova live após reload:

- payload por `mcp_tools_status`: **17.886 → 6.157 bytes** (**-65,6%**);
- duas chamadas consecutivas: 66 ms de handler acumulado, média 33 ms, porém **segunda chamada = 0 ms** de handler, provando o hot cache;
- dashboard global: slowest average tool **48 → 33 ms**; handler médio **32 → 23 ms** no snapshot comparável;
- strict typecheck: **6,045 s**, passed;
- focused MCP tools: **4,737 s**, passed;
- connector smoke pós-reload: **119/119**, parity integral, authenticated tools/list **116.092 bytes**, SSE green e orquestração **1.095 s**.

A regra operacional fica explícita: status frequente deve trazer apenas informação necessária para decisão imediata; diagnóstico volumoso fica em tool dedicada sob demanda.

### 22.14 Sublote — Git push single-RTT e health default novamente abaixo do SLO

O dashboard após uso real mostrou duas oportunidades diferentes: `git_push` em **2.397 ms** no fluxo anterior e `mcp_runtime_health` com **16.134 bytes**, ligeiramente acima do SLO histórico de 15 KiB.

**Git**

`git_push` granular fazia `git push --dry-run --porcelain` e depois `git push --porcelain` sempre. Isso duplicava rede apesar de a tool já validar HEAD, branch e upstream e de existir `git_push_plan` para quem quiser preflight explícito. A semântica foi alinhada a `git_publish_changes`:

- push real é única ida à rede por default;
- `pushDryRunFirst=true` torna o dry-run opt-in;
- `git_push_plan(runDryRun=true)` continua sendo a opção read-only de preflight;
- force, arbitrary remote e arbitrary refspec continuam impossíveis.

Prova live no mesmo HEAD/upstream sincronizados:

- `git_push` sem dry-run: **749 ms**;
- `git_push_plan` com dry-run: **660 ms**;
- portanto o par de rede que o comportamento antigo exigiria nesse mesmo estado custa aproximadamente **1,409 s**, enquanto o apply default novo paga apenas a push real;
- a observação histórica anterior de `git_push=2.397 ms` não é A/B puro por diferenças de rede/estado, mas é coerente com a remoção de um RTT remoto inteiro.

**Runtime health**

O default foi compactado sem remover `includeDetails=true`:

- slowest tools: top 8 → top 5;
- slowest phases: top 12 → top 6;
- benchmark de cache: séries cold/L1/L2 saem do default; decisão final permanece;
- TTL caches: totals + activeCount + top 3 ativos;
- L2 plan no default mantém decisão/evidence e apenas `recommendationCount`;
- teste exige default **<12 KiB** e, separadamente, prova que detail ainda contém `metrics.tools` e IO rico.

Prova live:

- `mcp_runtime_health`: **16.134 → 13.051 bytes** (**-19,1%**), novamente abaixo do SLO de 15 KiB;
- handler observado: **114 ms**;
- focused Git autonomy: **2,705 s**, passed;
- focused runtime metrics: **3,624 s**, passed;
- strict typecheck: **9,379 s**, passed.

Próxima pressão indicada pelo dashboard: `mcp_latency_dashboard` tornou-se ele próprio um dos maiores payloads quando usado em modo detalhado (~10–12 KiB/call). O próximo lote deve separar default decision view de rankings detalhados, mantendo persist/history/detail sob demanda.

### 22.15 Sublote — latency dashboard summary-first

O dashboard estava correto como ferramenta de investigação, mas caro como primeira chamada: resultados reais chegaram a **13.531 bytes**, e em um snapshot ele respondeu por **56,8%** de todo o volume retornado pelas tools observadas. O problema era semântico: `includeTools` defaultava a true e, mesmo quando false, várias rankings (`highestCumulativeCost`, call pressure, payload/volume e phases) ainda eram emitidas integralmente.

O contrato foi alterado sem criar nova tool:

- `includeTools` passa a default **false**;
- default continua calculando as rankings, mas retorna apenas uma decision view no `summary` com o top source de cada dimensão: cumulative cost, call pressure, largest payload, highest volume e slowest phase;
- `phaseTotals`, `byteAccounting` e os counters agregados de round-trip continuam no default;
- `roundTripAccounting.topCompressedTools` fica apenas no detail;
- `includeTools=true` preserva as tabelas completas existentes;
- teste novo exige default **<6 KiB** e prova ausência das arrays detalhadas, enquanto o teste antigo passou a solicitar explicitamente `includeTools=true`.

Prova live após reload:

- default medido pelo próprio result-size accounting: **4.953 bytes**, contra 13.531 bytes no último detail-heavy snapshot (**~−63,4%**);
- segunda chamada default permaneceu em ~4,97 KiB;
- `includeTools=true,maxRows=3` continuou devolvendo `slowestTools`, cumulative/call-pressure, payload/volume e slowest phases;
- handler do dashboard permaneceu praticamente irrelevante (~0–1 ms no snapshot), portanto o ganho é quase integralmente de transporte/contexto;
- focused MCP tools: **4,628 s**, passed;
- strict typecheck: **8,258 s**, passed.

Regra de uso: chamar `mcp_latency_dashboard` sem detail primeiro; somente se `status/summary` indicar pressão que exige decomposição, repetir com `includeTools=true` e `maxRows` pequeno.

### 22.16 Sublote — file batch com preflight conservador ou execução sequencial rápida

A revisão seguinte atacou uma redundância interna que ainda restava em `repo_apply_file_batch`: toda aplicação real executava primeiro um preview global completo e depois repetia resolução/stat/preconditions na fase de apply, embora cada primitive de mutação já valide seu target no estado efetivo imediatamente antes de escrever. Esse comportamento oferece uma garantia legítima — nenhuma escrita começa se uma operação futura já é inválida — mas não deve ser custo obrigatório quando o caller aceita partial prefix explícito.

A arquitetura foi separada em dois modos:

- `global-preflight` continua default e preserva a garantia conservadora de **zero write** quando uma operação futura já falha no preview;
- `sequential-fast` elimina o preview global duplicado e executa cada operação na ordem, sempre usando as primitives canônicas que revalidam o estado atual; se uma etapa falhar, o prefixo já aplicado permanece explícito e a resposta informa exatamente onde retomar;
- `runFileBatchPreflight()` passou a preservar previews anteriores, `failureIndex`, erro e duração quando uma operação posterior falha, em vez de perder evidência no `catch` externo;
- apply real bem-sucedido retorna `preflightSummary` e, por default, **não ecoa as rows completas do preview**; `includePreflightDetails=true` é opt-in;
- respostas de falha mantêm o contrato canônico de `errorResult`: `code/error` no topo e `phase`, `partial`, `failureIndex`, `appliedCount`, `skippedCount`, `preflightSummary`, timings e next action em `structuredContent.details`;
- `repo_apply_file_batch_plan` continua disponível, mas passa a ser recomendado apenas quando uma inspeção read-only separada é realmente útil; o apply conservador já faz preflight internamente.

Provas focadas:

- `global-preflight`: `create_file` válido seguido por `move_file` de source inexistente → erro em `failureIndex=1` e o primeiro arquivo **não é criado**;
- `sequential-fast`: o mesmo padrão → primeiro create aplicado, segunda operação falha, `partial=true`, `appliedCount=1`, `failureIndex=1`, `preflightSummary.ran=false`;
- dependências `create → move` continuam suportadas;
- `tests/unit/copilot/mcp/test_mcp_repo_write.spec.js`: **21/21 passed**, 4,903 s;
- strict typecheck após a integração: **9,098 s**, passed.

Prova live após reload, usando apenas os campos já materializados pelo host desta conversa:

- uma única chamada `repo_apply_file_batch` executou `create_file → move_file` com `confirmBatch=true`;
- resposta do runtime novo: `dryRun=false`, `applyMode=global-preflight`, `operationCount=2`;
- `preflightSummary`: `ran=true`, `plannedCount=2`, **4,15 ms**;
- `planned=[]` no resultado real, eliminando a duplicação de payload;
- apply: **74,92 ms**; total reportado **79,165 ms**;
- ambas as operações aplicadas, incluindo a dependência virtual; o artefato final foi removido depois por quarentena reversível.

O host desta conversa continua mostrando schema antigo para algumas tools já materializadas (`maxItems=10` e sem os campos novos), mesmo após reload. Isso é cache/materialização do cliente: source, testes e runtime já executam o contrato novo. Uma conversa/materialização futura deve receber `applyMode`, `includePreflightDetails` e os limites canônicos atualizados diretamente.

`CAPABILITIES_VERSION` foi elevado para **47** e a guidance passa a tratar plan como opção de inspeção, não como ritual obrigatório antes de apply governado.

Gate remoto pós-reload: connector smoke green, 119/119 tools em parity, authenticated `tools/list` **116.714 bytes** — apenas +622 bytes sobre os 116.092 anteriores e ainda ~14,3 KiB abaixo do envelope de 128 KiB — com OAuth e SSE initial/reconnect verdes.

### 22.17 Sublote — validators massivos no mesmo `run_copilot_validator`

Depois de eliminar polling por validator, o próximo round-trip residual era o número de chamadas para gates finais: focused test(s), typecheck e lint ainda exigiam uma chamada cada. A solução foi ampliar a tool existente, sem adicionar um novo nome ao registry.

`run_copilot_validator` agora suporta dois modos mutuamente exclusivos:

- single: contrato anterior preservado;
- batch: até **8** requests `{validator,testFile?,timeoutMs?,waitForCompletion?,waitMs?,failureTailBytes?}` em uma única chamada.

O batch reutiliza o `runBoundedOperationBatch` compartilhado e, crucialmente, todos os itens passam pela mesma função `executeValidatorRequest()` usada pelo modo single. Não existe uma segunda implementação de rules/job lifecycle. Permanecem idênticos: allowlist, validação de focused path, `spawnValidatorJob`, timeout, bounded inline wait, job summary e failure tail.

Política de execução:

- `best-effort` default, `fail-fast` opt-in;
- `batchConcurrency=1` default para evitar que lint/typecheck/vitest concorrentes degradem wall time por CPU/memory thrashing;
- hard max de concorrência **2**, útil para focused tests realmente independentes;
- broad suites preservam seu comportamento async por default, a menos que cada item peça wait explicitamente;
- input total limitado a 64 KiB;
- cada item retorna status/duration/job/error/tail sem invalidar resultados úteis dos demais;
- result execution hint contabiliza `logicalOperations`, failed/skipped e modo `validator-batch:*`.

Prova focada:

- batch de 2 requests em concurrency=1;
- item 0: `unit-focused` apontando para spec inexistente → falha localizada `ERR_INVALID_FOCUSED_TEST_FILE`;
- item 1: `tests/unit/copilot/infra/test_bulk_executor.spec.js` → executado mesmo após a falha anterior e passed;
- top-level: `requestCount=2`, `succeededCount=1`, `failedCount=1`, `skippedCount=0`;
- execution hint: **2 logical operations / 1 MCP call**, `failedOperations=1`, `mode=validator-batch:best-effort:c1`;
- `tests/unit/copilot/mcp/test_mcp_jobs.spec.js`: passed após a integração; última execução **6,853 s**;
- strict typecheck após o código principal: **8,608 s**, passed;
- registry focused gate: **3,225 s**, passed.

O primeiro reload desta faixa falhou (`exitCode=1`) sem derrubar o origin antigo. A investigação reproduziu o startup por `test_mcp_registry.spec.js` e encontrou a causa: uma vírgula ausente numa string de `IO_GUIDANCE` modificada **depois** do typecheck anterior. Após corrigir, registry + strict typecheck foram executados novamente e o segundo reload concluiu normalmente. Regra nova de processo: qualquer alteração posterior a metadata/registry-facing source invalida o gate de startup anterior e exige parse/registry gate antes de reload.

Superfície remota pós-reload:

- 119/119 tools, parity integral;
- authenticated `tools/list`: **117.809 bytes**;
- crescimento de ~1,1 KiB pelo schema batch, ainda com ~13,3 KiB de headroom sob 128 KiB;
- OAuth/SSE green.

O host desta conversa continua materializando a versão antiga do schema de `run_copilot_validator`; portanto o batch não pode ser invocado diretamente por esta sessão apesar de estar ativo no servidor e no `tools/list` remoto. Novas materializações devem receber o batch. Até lá, single mode continua operacional e os testes exercitam o handler canônico batch.

`CAPABILITIES_VERSION` foi elevado para **48** e a guidance recomenda agrupar gates causais numa única chamada, mantendo concorrência baixa por default.

### 22.18 Sublote — pós-reload em uma chamada e smoke summary-first

O workflow de reload ainda exigia, na prática, várias chamadas após o processo voltar: `mcp_reload_status`, `mcp_post_restart_readiness` e `mcp_connector_smoke_refresh`. Além do round-trip, o smoke externo devolvia ~8 KiB apesar de a maior parte do report detalhado só ser útil em diagnóstico.

A composição foi movida para `mcp_connector_smoke_refresh`, que já era bounded-write por persistir o smoke e portanto é o local correto para agregar o gate pós-restart sem tornar `mcp_post_restart_readiness` mutável.

Mudanças:

- `mcp_connector_smoke_refresh` executa/persiste o smoke canônico e, **na mesma chamada**, calcula post-restart readiness com o smoke recém-gravado;
- readiness compartilhado foi extraído para `buildPostRestartReadinessSnapshot()`; a tool read-only `mcp_post_restart_readiness` reutiliza a mesma primitive;
- quando chamado pelo smoke, o snapshot pula a leitura diagnóstica do log cloudflared (`includeDiagnostics=false`), pois origin log detail não participa da decisão de readiness;
- novo `summarizeConnectorSmokeReport()` mantém health, OAuth discovery/challenge, runtime health, tools-list parity/bytes e SSE initial/reconnect, removendo phase timings, nomes completos e outras estruturas diagnósticas do default;
- `includeDetails=true` preserva o report completo; `includeRemoteToolNames=true` implica detail;
- o smoke default agora também retorna `postRestartReadiness` compacto com processos, reload state, reconciliation/freshness e next actions;
- `mcp_reload_plan` passa a declarar `expectedFollowUp: ['mcp_connector_smoke_refresh']`; `mcp_reload_status`, `mcp_post_restart_readiness` e `mcp_runtime_health` ficam em `diagnosticFallback`.

Provas unitárias:

- summary puro preserva OAuth/tools parity/SSE e fica **<2 KiB** no fixture, sem `phaseTimings` ou `remoteToolNames`;
- reload plan prova exatamente um follow-up normal;
- `test_cloudflare_smoke_compact.spec.js`: **passed em 2,772 s**;
- `test_mcp_reload_state.spec.js`: **passed em 2,753 s**;
- registry parse gate após metadata: **passed em 3,923 s**;
- strict typecheck: **passed em 8,936 s**.

Prova live do workflow real:

1. `mcp_reload_schedule(delayMs=1000)`;
2. **sem chamar** `mcp_reload_status` ou `mcp_post_restart_readiness`;
3. primeira e única chamada pós-restart: `mcp_connector_smoke_refresh`.

A resposta mostrou simultaneamente:

- smoke `ok=true`;
- OAuth discovery/challenge green;
- authenticated runtime health green;
- tools-list **119/119**, `toolsMatchLocalRegistry=true`, zero missing/unexpected;
- authenticated tools-list **117.956 bytes**;
- SSE initial/reconnect green;
- `postRestartReadiness.ready=true`;
- reload `status=completed`, `completedSuccessfully=true`, `smokeAfterReload=true`, `reconciledWithConnectorSmoke=true`;
- processos MCP/cloudflared vivos e `healthReady=true`.

Payload externo do smoke composto: **4.026 bytes**, contra **8.150 bytes** no snapshot anterior (~**−50,6%**) apesar de agora incluir também readiness. O `mcp_runtime_health` de ~10.176 bytes observado no mesmo dashboard foi uma chamada **interna** feita pelo smoke OAuth contra o servidor e não o payload retornado por `mcp_connector_smoke_refresh`.

`mcp_reload_plan` no processo novo confirmou live `expectedFollowUp=['mcp_connector_smoke_refresh']` e o array separado de fallbacks diagnósticos.

Durante o gate, a regra pós-metadata capturou uma nova vírgula ausente em `IO_GUIDANCE` **antes do reload**, demonstrando que o parse/registry gate adotado após o incidente anterior previne lifecycle failures. Corrigido, o registry e o typecheck voltaram a verde antes da ativação.

`CAPABILITIES_VERSION` foi elevado para **49**. O fluxo operacional normal pós-reload passa de três chamadas de verificação para **uma**.

### 22.19 Sublote — capability mutável validada para write/patch e reforço da path policy

A assimetria restante no hot path de filesystem estava nas mutações single-target: reads/search/stat já conseguiam transportar uma capability opaca emitida pela policy canônica e evitar uma segunda resolução `realpath`; write/create/patch ainda faziam `validatePath/evaluateIoPathPolicyAsync` no adapter e, depois, repetiam a mesma policy ao entrar novamente em `createWorkspaceIo` com uma string absoluta.

A solução mantém a mesma fronteira arquitetural adotada para reads, mas com um tipo de capability separado e mais restrito:

- brand privado próprio para mutable paths, impossível de reconstruir por objeto vindo do input da tool;
- capability ligada a `workspaceRoot`, `realPath`, `access='mutable'`, `policyClass='write'` e à versão da **path policy efetivamente responsável pela autorização**;
- consumers iniciais aceitos apenas em `write | patch`;
- `append`, `delete`, `move`, `copy` e demais operações com invariantes adicionais permanecem no caminho completo e não recebem esse fast path neste lote;
- `createWorkspaceIo` ganhou métodos explicitamente separados (`writeFileAtomicValidated`, `createOrReplaceFileAtomicValidated`, `patchTextLockedValidated`, `patchTextBatchLockedValidated`); as APIs de string continuam executando a policy canônica integralmente;
- adapters MCP e tools locais da LLM-B fazem feature detection da capability e mantêm fallback para o caminho string seguro, preservando mocks/callers legados;
- runtime health passou a expor `validatedMutablePath` com `issued`, `accepted` e rejeições por brand/workspace/mode.

#### Revisão de segurança antes da ativação

A revisão do caminho completo revelou uma lacuna anterior à capability: `resolveRealTargetForPolicy()` tentava `realpath(target)` e, quando o target não existia, apenas `realpath(parent)`. Se target **e parent imediato** ainda não existissem, a função voltava ao path lexical. Assim, um create profundo como `escape/missing/deep/file.txt`, quando `escape` era um symlink existente para fora do workspace, podia deixar de enxergar o symlink porque os níveis intermediários ainda não existiam.

A policy foi fortalecida antes de confiar no fast path mutável:

- a resolução agora sobe até o **ancestral existente mais próximo**;
- resolve `realpath` desse ancestral;
- reconstrói apenas o sufixo ainda inexistente;
- containment e blocked-path checks continuam sendo aplicados sobre o real target reconstruído;
- nova regressão cria um symlink do workspace para um diretório externo e valida um target dois níveis abaixo ainda inexistente; o resultado esperado e observado é `PATH_SYMLINK_OUTSIDE`.

Também foi encontrado um drift de versionamento: `validated-path.js` importava `IO_POLICY_VERSION` do barrel, que corresponde ao contrato geral de metadata de I/O (`io-contracts.js`), enquanto a autorização real vinha de `io-policy.js`, exportada pelo barrel como `IO_PATH_POLICY_VERSION`. A capability era branded e segura, mas seu campo de versão não invalidaria automaticamente uma mudança da path policy.

Correção:

- read e mutable capabilities agora usam **`IO_PATH_POLICY_VERSION`**;
- a path policy fortalecida foi versionada como **`2026-08-17.r3.nearest-ancestor.v1`**;
- testes exigem que ambas as capabilities carreguem exatamente essa versão canônica.

Isso não pretende tornar corridas TOCTOU de filesystem matematicamente impossíveis. A fronteira continua sendo: policy async completa antes da emissão, capability efêmera interna, locks/preconditions/hash quando aplicáveis e publicação atômica nas primitives. O ganho deste lote é remover uma **segunda avaliação idêntica**; não transformar um path previamente validado em confiança pública ou reutilizável fora do fluxo controlado.

#### Gates e prova live

Gate completo retomado do ponto em que a conversa anterior terminou:

- workspace I/O: **passed em 1,377 s**;
- MCP repo-write: **passed em 5,341 s**;
- runtime metrics: **passed em 3,556 s**;
- LLM-B bulk file tools: **passed em 2,072 s**;
- LLM-B write tools: **passed em 2,242 s**;
- strict typecheck inicial: **passed em 5,040 s**.

Após o reforço de ancestral existente:

- core I/O policy: **passed em 0,959 s**;
- workspace I/O: **passed em 1,572 s**;
- strict typecheck: **passed em 19,065 s** após invalidar uma faixa maior do cache incremental.

Após corrigir o vínculo de versão da capability:

- workspace I/O: **passed em 1,594 s**;
- core I/O policy: **passed em 0,861 s**;
- strict typecheck: **passed em 17,727 s**.

Ativação final:

- reload controlado em QUIC: completed;
- post-reload em uma única `mcp_connector_smoke_refresh`: `ready=true`;
- OAuth e SSE initial/reconnect: green;
- tools local/remoto: **119/119**, parity integral;
- authenticated `tools/list`: **117.956 bytes**, exatamente sem crescimento de superfície pelo novo fast path;
- smoke total: **1.009 ms**, authenticated OAuth **996 ms**.

Prova causal inicial no processo final:

1. baseline `validatedMutablePath`: **0 issued / 0 accepted / 0 rejects**;
2. uma chamada real de `repo_apply_patch` em `dryRun=true` com no-op permitido atravessou o adapter MCP;
3. a operação reportou I/O de poucos milissegundos e incrementou `issued/accepted` de forma pareada;
4. portanto uma operação MCP real em patch eliminou uma segunda walk de path policy/realpath, observável em produção e não apenas inferida pela estrutura do código.

#### Refinamento final — autoridade mínima também na emissão

A primeira ativação revelou um problema mais sutil que não era uma vulnerabilidade de escape, mas contrariava o princípio de menor autoridade: o adapter genérico `resolveWritePath()` pedia `validatedWritePath` para **todo** caminho de escrita. Assim, quarantine/remove/move e outros fluxos que continuavam corretamente no caminho string podiam receber uma capability que nunca seria consumida. Em uma prova controlada após patch + create + quarantine, os contadores chegaram a **12 issued / 11 accepted**. O reject count permaneceu zero, mas `issued != accepted` mostrou capacidade emitida sem utilidade.

O contrato foi então endurecido em dois níveis:

- `validatePath(..., {mode:'write'})` **não** emite mutable capability por default; exige `issueMutableCapability:true`;
- `resolveWritePath(path)` também defaulta sem capability e aceita o mesmo opt-in interno;
- apenas consumidores que entram em `writeFileAtomicValidated`, `createOrReplaceFileAtomicValidated`, `patchTextLockedValidated` ou `patchTextBatchLockedValidated` pedem explicitamente a capability;
- `repo_write_file` e `repo_create_file` só pedem capability em apply real; seus dry-runs não recebem autoridade mutável desnecessária;
- patch single/batch pede capability porque até o dry-run usa a primitive canônica de patch;
- quarantine, remove, move, restore, Git paths e plans continuam sem emissão;
- a LLM-B segue a mesma política: write/create/patch opt-in; delete/copy/move não opt-in.

Teste adicional prova que `repo_remove_file` sem confirmação, embora execute a policy de path, deixa `validatedMutablePath` em **0 issued / 0 accepted**. Os testes locais também verificam que write/create solicitam explicitamente `issueMutableCapability:true`, enquanto delete e destinos de copy/move permanecem apenas em `{mode:'write'}`.

Segunda ativação controlada, já com emissão mínima:

1. baseline pós-reload: **0 issued / 0 accepted / 0 rejects**;
2. patch dry-run/no-op controlado: I/O **1 ms**;
3. create real temporário: I/O **15 ms**;
4. quarantine reversível do temporário: move I/O **15 ms**, mas sem capability mutável própria;
5. health final do processo: **3 issued / 3 accepted / 0 rejects**.

O número absoluto 3 inclui atividade MCP do mesmo processo além das duas operações explicitamente disparadas para a prova; o sinal importante é mais forte: **toda capability emitida foi consumida** (`accepted == issued`) e quarantine não voltou a criar emissão órfã. O handler observado de quarantine ficou em ~74 ms enquanto o move subjacente consumiu ~15 ms, indicando que metadata/audit/transaction overhead — e não a segunda path walk removida — passa a dominar esse fluxo.

Gates após o refinamento de autoridade mínima:

- MCP repo-write: **passed em 5,085 s**;
- LLM-B write tools: **passed em 1,986 s**;
- LLM-B bulk file tools: **passed em 1,809 s**;
- strict typecheck: **passed em 9,105 s**;
- reload QUIC + `mcp_connector_smoke_refresh`: `ready=true`, OAuth/SSE green, **119/119** tools e authenticated `tools/list` **117.956 bytes**.

`CAPABILITIES_VERSION` permanece em **49**: nenhuma tool, schema, permissão, annotation ou contrato MCP externo mudou; a transformação é interna ao plano de I/O. Uma elevação aqui confundiria versão de superfície anunciada com versão de implementação. A versão relevante para invalidação da capability é `IO_PATH_POLICY_VERSION=2026-08-17.r3.nearest-ancestor.v1`.

### 22.20 Sublote — emissão read explícita, scan validado e capabilities pair para copy/move

Depois do 22.19, o dashboard já não mostrava um novo gargalo interativo comparável aos anteriores: fora compiladores/linter, publish Git e smoke remoto, as repo tools estavam em dezenas de milissegundos. A próxima otimização foi então escolhida por **duplicação estrutural de policy/realpath**, e não por latência bruta de uma chamada isolada.

Duas assimetrias ainda permaneciam:

1. a capability read era emitida implicitamente por muitos `validatePath(..., {mode:'read'})`, inclusive em callers que não a consumiam; ao mesmo tempo, alguns scans ainda retornavam para a facade string e repetiam a policy;
2. copy/move validavam source/destination no adapter e depois chamavam `copyFileLocked`/`moveFileLocked` pela facade string, que revalidava os dois paths. Um move pagava portanto **duas avaliações de path redundantes por operação**.

A arquitetura final preserva autoridade mínima e não cria novas brands/modos:

- read capability passa a exigir `issueReadCapability:true`, simetricamente ao opt-in já adotado para mutable capability;
- `resolveReadPath()` também recebe esse opt-in; callers que só precisam do path validado não ganham capability desnecessária;
- `scan` foi incorporado aos modos compatíveis da capability read, e `createWorkspaceIo` ganhou `scanDirectoryValidated`;
- repo tree/root tree, read, stats, text search, symbol usages/search, outline, orphan-import inspection e o smoke canônico passaram a pedir capability apenas quando entram numa primitive validated;
- `read_files_batch` local da LLM-B também pede explicitamente read capability e reutiliza a mesma resolução;
- copy reutiliza **read(source) + mutable/write(destination)**;
- move reutiliza **mutable/write(source) + mutable/write(destination)**;
- nenhum novo tipo de capability pair foi criado: a facade apenas compõe duas capabilities independentes já autorizadas e branded;
- `copyFileLockedValidated` e `moveFileLockedValidated` continuam delegando para as mesmas primitives canônicas, portanto locks de dois recursos, hashes, overwrite, rollback/snapshots, publicação atômica e fallback cross-device permanecem intactos;
- APIs string continuam existindo como fallback para mocks/callers legados e continuam executando policy completa.

#### Correção de fidelidade da policy em move

A investigação encontrou uma diferença semântica importante: copy **lê** a origem; move **muta** a origem. A facade string original já refletia isso — copy source usa policy `read`, enquanto move source usa `move`, normalizada pela core policy para a classe `write`.

Alguns adapters, contudo, faziam preflight de move com `resolveReadPath(source)` e só descobriam a write-policy mais tarde dentro da primitive. Isso permitia um **falso-verde de plan/dry-run**: uma origem legível porém proibida para escrita podia passar o preview e falhar no apply.

Correções:

- `repo_move_file_plan` usa write policy na origem e destino;
- `repo_apply_file_batch` usa write policy na origem do move tanto no preflight quanto no apply;
- `repo_move_file` single usa write policy nos dois lados e só emite mutable capabilities quando `dryRun !== true`;
- `move_file` local da LLM-B usa `mode:'write', issueMutableCapability:true` em source e destination;
- regressão explícita usa uma origem `.sh`: a extensão é legível pela família read, mas bloqueada por `DEFAULT_BLOCKED_WRITE_PATH_PATTERNS`; `repo_move_file(..., dryRun:true)` agora a recusa sem mover o arquivo e sem emitir mutable capability.

#### Reconciliação de duas frentes simultâneas

Durante a implementação, outra frente no mesmo workspace começou a migrar os consumidores read/scan para emissão explícita. As preconditions SHA-256 impediram múltiplas sobrescritas stale. Em particular:

- `validated-path.js` ganhou `scan` em `READ_ONLY_MODES` enquanto esta frente estava aberta;
- `workspace-io.js`, `repo-plan.js`, `write-tools.js` e testes tiveram hashes alterados entre read/preflight e apply;
- chamadas stale foram recusadas por `EEXPECTEDHASH`, sem write parcial;
- a mudança foi então relida e reconciliada semanticamente em vez de sobrescrita;
- essa reconciliação encontrou uma interação real: depois de read capability tornar-se opt-in, `copy_file` continuaria correto por fallback string, mas perderia o fast path. O handler foi ajustado para pedir `issueReadCapability:true` na origem, preservando o ganho pair.

O resultado é um lote integrado, não duas implementações concorrentes do mesmo conceito: **capability só é emitida quando o caller vai consumi-la, e uma capability emitida cruza a fronteira até a primitive sem segunda policy idêntica**.

Uma tentativa inicial de aplicar um patch batch grande à facade foi bloqueada antes de chegar ao MCP pelo host da OpenAI. `mcp_host_block_diagnostics` classificou o evento como `CHATGPT_HOST_PRECALL_BLOCK`, `layer=chatgpt-host`, confidence high; o MCP não recebeu a chamada e nenhum arquivo foi alterado. O mesmo plano foi aplicado por patches menores/governados e, posteriormente, batches menores voltaram a funcionar. Portanto o incidente foi de classificação host-side, não falha da policy ou do executor MCP.

#### Gates causais

Pair mutation:

- workspace I/O: **passed em 1,808 s**;
- MCP repo-write: **passed em 5,361 s**;
- LLM-B write tools: **passed em 2,225 s**;
- regressão adicional de move-source write-policy: MCP repo-write **passed em 5,229 s**.

Validated-read/scan integrado:

- MCP tools/end-to-end smoke unitário: **passed em 4,388 s**;
- LLM-B bulk file tools: **passed em 2,107 s**;
- LLM-B write/copy/move após reconciliar `issueReadCapability`: **passed em 2,105 s**;
- strict typecheck final antes da ativação: **passed em 5,517 s**.

Um strict typecheck intermediário falhou durante uma janela de edição concorrente em `repo-index.js` e também apontou `resolveReadPath` órfão em `repo-write.js`. O import órfão foi removido; a frente concorrente completou a migração de `repo-index.js`; o typecheck subsequente ficou integralmente verde. Isso foi tratado como evidência de concorrência real e não como justificativa para sobrescrever arquivos por snapshot stale.

#### Prova live — pair move

No processo ativado antes da integração read final:

1. o processo já tinha atividade anterior, então a prova usou **deltas**, não valores absolutos;
2. após criar o source temporário, `validatedMutablePath` estava em **7 issued / 7 accepted**;
3. uma chamada real de `repo_move_file` moveu 26 bytes com I/O **40 ms** e handler ~**54 ms**;
4. health imediatamente posterior mostrou **9 issued / 9 accepted**, zero rejects;
5. delta do move: **+2 issued / +2 accepted**, exatamente source + destination;
6. o destino de prova foi removido do workspace por quarentena reversível.

Isso demonstra que o move real eliminou as duas reavaliações de path que antes ocorriam ao atravessar a facade string.

#### Ativação final integrada e prova live read/scan

Reload final controlado em QUIC:

- `mcp_connector_smoke_refresh`: **893 ms total**;
- authenticated OAuth: **891 ms**;
- SSE initial/reconnect: green, **160 ms**;
- post-restart readiness: `ready=true`, reload completed/reconciled;
- tools local/remoto: **119/119**, zero missing/unexpected;
- authenticated `tools/list`: **117.956 bytes**, sem qualquer crescimento de superfície.

No novo processo, antes do smoke in-process:

- `validatedReadPath`: **0 issued / 0 accepted / 0 rejects**;
- `validatedMutablePath`: **0 issued / 0 accepted / 0 rejects**.

`mcp_smoke_workspace` executou em **265 ms** e passou todos os checks funcionais: repo status, tree, root redaction, secret-read denial, read, stat, text search, symbol usages, symbol search, outline, index status, project doctor e runtime health. O único warning foi `WORKSPACE_DIRTY`, esperado durante desenvolvimento.

Health após o smoke:

- `validatedReadPath`: **8 issued / 8 accepted / 0 rejects**;
- modos: `read | search | stat | scan`;
- `validatedMutablePath`: permaneceu **0 / 0 / 0**;
- policy version: `2026-08-17.r3.nearest-ancestor.v1`.

A igualdade `issued == accepted` mostra que o novo opt-in não apenas reduz emissão de autoridade: **toda capability read criada nessa prova foi efetivamente consumida por uma primitive validated**.

`CAPABILITIES_VERSION` permanece em **49**. O lote não adiciona tool, schema, annotation, permissão nem contrato MCP externo; apenas torna mais estrita e eficiente a passagem interna de autoridade já validada.

### 22.21 Sublote — `mcp_runtime_health` como decision surface compacta

Depois da publicação do 22.20, o dashboard detalhado mostrou que já não havia um gargalo interativo normal relevante em repo I/O: reads estavam na ordem de poucos milissegundos, Git status em dezenas de milissegundos e index search em ~100 ms. Validators, push e connector smoke continuavam dominados por trabalho real ou rede externa.

O maior desperdício remanescente era de **contexto retornado**: `mcp_runtime_health` havia respondido por ~63,9% de todo o volume da faixa observada. Foram **10 chamadas, 140.383 bytes totais, média 14.038 bytes e último resultado 14.703 bytes**. A frequência foi inflada pelas provas de capability desta rodada, mas revelou uma regressão conceitual: uma tool cujo default deveria responder “está saudável, qual é o principal problema e o que merece ação?” ainda carregava um mini-dashboard de diagnóstico completo.

A mudança preserva integralmente `includeDetails=true` e comprime apenas o default:

- `slowestTools[5]` e `slowestPhases[6]` viraram `slowestTool` e `slowestPhase` — um culpado principal por dimensão;
- `phaseTotals` default mantém somente `handler`, `authorization` e `resultSize` quando presentes;
- TTL caches mantêm contagens/totais, sem lista de entries ativas;
- auth caches mantêm hits/misses/size/disabled, sem counters administrativos de baixa utilidade na decisão imediata;
- repo-read cache mantém hits/misses/stale/singleflight/chunk hits/misses/size/bytes;
- I/O cache mantém L1, erros/gaps de coherence, counters de read/mutable capabilities e aggregate hit ratio, removendo timings e configuração detalhada do cross-process path;
- benchmark L2 deixa o default e fica representado somente pela decisão `l2Decision` + `recommendationCount`;
- parser mantém tamanho de file-context, queue pressure e failures/timeouts/fallbacks;
- artifacts mantêm apenas pressão de cleanup e estado/sidecars de rollback;
- o ramo detalhado continua retornando snapshots brutos de metrics/tools, index, TTL/auth caches, repo-read cache, I/O cache, parser, benchmark, artifacts e tunnel fallback.

O objetivo é separar dois produtos distintos dentro da mesma tool:

1. **default = decision surface** — barato o suficiente para uso recorrente;
2. **`includeDetails=true` = forensics** — volumoso por intenção explícita, usado somente quando o resumo aponta algo a investigar.

#### Contrato e gates

O teste `test_mcp_runtime_metrics.spec.js` passou a exigir:

- presença de `slowestTool` e `slowestPhase` singulares;
- ausência das tabelas `slowestTools`, `slowestPhases` e `ioCacheBenchmark` no default;
- preservation de `validatedMutablePath`, L1/coherence, decisão L2, parser failures e cleanup/rollback signals;
- **structured payload default <6 KiB**, contra o budget anterior de <12 KiB;
- `includeDetails=true` continua expondo `metrics.tools` e `metrics.ioCache` completos.

Gates:

- runtime metrics focused test: **passed em 3,379 s**;
- strict typecheck: **passed em 17,132 s**.

A variação maior do typecheck nesta execução foi tratada como custo de compilação/cache, não como evidência de regressão do handler runtime.

#### Ativação e medição live

Reload controlado em QUIC e gate pós-restart:

- `mcp_connector_smoke_refresh`: `ready=true`;
- OAuth/SSE green;
- tools local/remoto **119/119**;
- authenticated `tools/list`: **117.956 bytes**, sem crescimento de superfície;
- connector smoke: **1.092 ms total**, authenticated OAuth **1.084 ms**, SSE **164 ms**.

No processo novo, duas chamadas consecutivas do default preservaram todos os sinais operacionais e counters de capability. O dashboard posterior mediu:

- `mcp_runtime_health` **8.579 bytes médios**;
- último resultado: **8.924 bytes**;
- volume: **25.738 bytes em 3 chamadas**;
- handler médio: **111 ms**.

Comparando a faixa anterior:

- média de payload: **14.038 → 8.579 bytes (−38,9%)**;
- último payload observado: **14.703 → 8.924 bytes (−39,3%)**;
- handler médio observado: ~**181 → 111 ms (−38,7%)**, embora essa comparação de tempo não seja A/B perfeita porque o processo/cold state diferem.

A chamada live `includeDetails=true` confirmou que a informação removida do default continua integralmente disponível sob demanda: auto-build/index completos, per-tool/per-phase metrics, TTL/auth caches, repo-read cache rico, I/O cache integral, parser completo, benchmark/plan L2, artifacts/cleanup e tunnel fallback. O resultado detalhado ficou na ordem de **56 KiB**, custo alto mas agora explicitamente opt-in e coerente com sua função de forensics.

`CAPABILITIES_VERSION` permanece em **49**: não houve mudança de input schema, tool registry, annotation ou permissão; houve apenas separação mais rigorosa entre resposta operacional default e detalhe diagnóstico já existente.

### 22.22 Sublote — read-pair capability para diff e fechamento dos read tools locais

Depois do 22.21, uma pequena frente read permaneceu no worktree. A revisão mostrou que ela não era uma mudança lateral: fechava dois hot paths ainda assimétricos em relação ao modelo de capability já adotado.

O primeiro era `diffText`: adapters validavam `pathA` e `pathB` como read e depois chamavam `diffText` pela facade string, reexecutando policy/realpath nos dois operands. O segundo era a camada local da LLM-B (`list_directory` e `diff_files`), que ainda podia voltar ao scan/diff string mesmo depois de validar os paths.

A solução reutiliza exclusivamente authority já existente:

- `createWorkspaceIo` ganhou um binder read→read que compõe **duas read capabilities independentes**, sem nova pair brand;
- `diffTextValidated` resolve cada capability contra o mesmo workspace e `IO_PATH_POLICY_VERSION` e então chama a primitive canônica `diffText`;
- `repo_diff_files` passa a pedir `issueReadCapability:true` nos dois operands e usar `diffTextValidated`;
- `list_directory` local pede read capability e usa `scanDirectoryValidated` quando ela está disponível, mantendo fallback string para mocks/callers legados;
- `diff_files` local pede read capability nos dois paths e usa `diffTextValidated`, também com fallback seguro;
- nenhum novo modo, schema, permission ou annotation foi criado.

A facade ganhou uma regressão explícita: duas capabilities read branded são consumidas por `diffTextValidated`; o diff permanece canônico e os counters fecham em **2 issued / 2 accepted**.

#### Gates

- workspace I/O focused: **passed em 1,353 s**;
- MCP tools: **passed em 4,558 s**;
- LLM-B read tools: **passed em 2,082 s**;
- strict typecheck: **passed em 5,180 s**.

#### Ativação e prova live

Reload controlado em QUIC:

- connector smoke: **1.004 ms total**;
- authenticated OAuth: **993 ms**;
- SSE initial/reconnect: green em **137 ms**;
- `ready=true`;
- tools local/remoto **119/119**;
- authenticated `tools/list`: **117.956 bytes**.

A primeira tentativa de medir o delta de `repo_diff_files` cruzou a execução automática do startup maintenance. O baseline estava em **0/0**, e o health posterior mostrou **10 issued / 10 accepted**. O próprio estado do runtime mostrou que o maintenance havia concluído nesse intervalo e executado o smoke in-process, já conhecido por consumir 8 read capabilities. Assim, a decomposição era exatamente:

- **8** capabilities do smoke automático;
- **2** capabilities do `repo_diff_files`.

Para eliminar a variável concorrente, a prova foi repetida depois de `startupMaintenance.completed=true`:

1. baseline estável: **10 issued / 10 accepted**;
2. uma chamada real de `repo_diff_files` sobre dois arquivos do repo;
3. health posterior: **12 issued / 12 accepted**;
4. delta isolado: **+2 issued / +2 accepted**;
5. zero rejects de brand/workspace/mode.

Portanto o diff real agora elimina exatamente as **duas** avaliações redundantes de path que antes reapareciam ao atravessar a facade string. A mesma primitive continua responsável pelo diff e pelo tratamento de context lines; apenas a policy já validada deixa de ser recalculada.

`CAPABILITIES_VERSION` permanece em **49**: a mudança é interna ao plano de I/O e não altera a superfície MCP externa.

---

# PARTE VI — REBASELINE PÓS-22.22 E SEGUNDA GERAÇÃO DO ESTADO-ALVO

## 23. Nova investigação profunda — estado real em `8e918319c`

A partir do commit **`8e918319c`** (`perf(io): reuse validated read pairs for diff`), a otimização desta frente entra em uma segunda geração. Vários itens que aparecem como “futuros” no roadmap original já foram implementados e provados: coherence cross-process, startup incremental do índice, batching read/search/patch, Git publish composto, validators bounded/batch, compactação do control plane, capabilities read/mutable, scan/diff/copy/move validated e redução do pós-reload a uma chamada. Portanto o critério de prioridade precisa mudar novamente.

Estado reconciliado no início desta nova faixa:

- branch **`main`**, HEAD **`8e918319c`**, upstream sincronizado;
- worktree funcionalmente limpo para `src/copilot`; permanecem apenas `.vscode/settings.json` e untracked antigos/alheios, que não pertencem a esta frente;
- MCP runtime `status=ok`, stateful ativo e sem stateless fallback;
- índice: **2.226 arquivos / 2.226 fresh / 0 stale / 0 failed**, ~15,8 MiB, **12.172 símbolos**, 3.989 imports e 3.611 chunks;
- validated read: **8 issued / 8 accepted / 0 rejects** no snapshot corrente;
- validated mutable: **0/0/0** no snapshot corrente;
- parser worker pool sem failures/timeouts/fallback pressure;
- L2 blob cache continua **OFF**, conforme benchmark anterior em que perdeu para cold filesystem read;
- amostra MCP imediatamente após reconnect é pequena, mas hot handlers observados continuam em dezenas de milissegundos ou menos. Não existe evidência de que `fs.readFile` isolado seja hoje o maior gargalo.

A consequência metodológica é importante: **a próxima fronteira não é “fazer read 2 ms virar 1 ms”**. O maior retorno está em remover trabalho estrutural repetido que ainda aparece em manutenção de freshness, search routing, hashing/parsing e mutation pipelines.

### 23.1 Novo gargalo P0 — safety full-reconcile do índice continua excessivamente caro

O auto-index incremental funciona muito bem em steady state, mas a safety reconciliation periódica ainda cai no caminho antigo de scan + verificação criptográfica quase integral.

Snapshot live desta investigação:

- reason: `full-reconcile` / safety periódica;
- **1.680 entries** escaneadas;
- **1.445 candidates**;
- **1.443 unchanged**;
- **1.443 hash verifications / 1.443 hash hits / 0 misses**;
- apenas **2 arquivos** efetivamente indexados;
- duração: **1.948 ms**;
- Git snapshot: **50 ms**.

A causa arquitetural é a combinação de duas políticas temporais independentes:

1. `COPILOT_MCP_INDEX_FULL_RECONCILE_INTERVAL_MS`: default **30 min**;
2. `IO_INDEX_HASH_VERIFY_INTERVAL_MS`: default **30 s**.

Quando a safety reconciliation de 30 min ocorre, praticamente qualquer arquivo ≤1 MiB está “hash due”. Assim, mesmo quando o scanner já encontra igualdade de **mtime + size + ctime + dev + ino**, o index lê e calcula SHA-256 de ~1,4 mil arquivos. Nesta amostra, 100% das verificações criptográficas apenas confirmaram o fingerprint rico já existente.

Há ainda uma segunda redundância: quando o fingerprint rico coincide e o hash **não** está due, `indexDirectory()` chama `assertCurrentFileSnapshot()`, fazendo novo `stat` por arquivo embora o scan já tenha produzido fingerprint. Essa rechecagem reduz uma janela TOCTOU, mas para um arquivo classificado como “unchanged” nenhuma mutação é publicada no índice; portanto seu custo/benefício deve ser reavaliado separadamente do `confirmCurrent` necessário quando uma entrada é realmente reindexada/commitada.

**Estado-alvo:** separar safety reconciliation de metadata/fingerprint da verificação criptográfica de conteúdo. Full reconcile não deve significar automaticamente full hash sweep.

### 23.2 Novo gargalo P0/P1 — `searchText()` paga estatística diagnóstica antes de toda busca

O search router está funcionalmente sofisticado: literal SQLite, FTS5, alternation assistida pelo índice e fallback streaming para ripgrep. Entretanto toda chamada inicia com `getIoIndexStats()`.

Hoje `getIoIndexStats()` delega para `index.getStats()`, e `getStats()` executa **cinco agregações SQLite**:

1. count/sum de files por status;
2. count de symbols;
3. count de imports;
4. count de chunks;
5. `MAX(refreshed_at_ms)`.

Para decidir se tenta o índice, `searchText()` precisa essencialmente saber se a estrutura existe/tem linhas frescas; não precisa de counts de symbols/imports/chunks em todo hot search. Em index hits comuns, essas cinco queries são trabalho diagnóstico pago antes da query que realmente responde à busca.

**Estado-alvo:** o fast search plane não deve chamar o full stats plane. Opções, em ordem de preferência:

- tentar o índice diretamente e só materializar stats em fallback/diagnóstico;
- ou criar um search-state/availability snapshot barato e generation-aware;
- full `getIoIndexStats()` continua existindo para health/status, não para roteamento normal.

SLO inicial: index/literal hit deve evitar completamente as cinco agregações de stats; `repo_search_text` hot p95 desejado **<30 ms** para queries indexáveis pequenas.

### 23.3 Novo gargalo P1 — hashes duplicados em parsing/contexto

`repo_file_outline` executa:

`readTextValidated() → snapshot.contentHash → parseFileForContext(path, snapshot.content)`.

Porém `parseFileForContext()` forma sua cache key executando novamente:

`SHA256(content)`.

Logo um hash que já foi calculado pelo snapshot canônico é recalculado sobre o mesmo conteúdo apenas para identificar o cache de contexto. O mesmo padrão pode ocorrer em outros callers que já possuem snapshot/hash.

**Estado-alvo:** propagar o hash canônico já calculado até o parser/context cache. A API interna pode aceitar `contentHash`/snapshot evidence; callers sem hash continuam calculando localmente. Nenhum hash vindo de input MCP deve ser tratado como autoridade de filesystem — trata-se apenas de identidade de conteúdo para cache interno.

Meta: **zero re-hash duplicado** em `read snapshot → outline/context parse`.

### 23.4 Novo gargalo P1 — pipeline de hash em patch batch

`patchTextBatchLocked()` já é eficiente em I/O: um lock, um read, sequência virtual e um write. O custo remanescente está em hashing do conteúdo virtual.

No loop atual, para cada operação são calculados:

- `sha256(currentContent)` como `operationPreviousHash`;
- `sha256(updated)` como `operationContentHash`.

Depois do loop, `sha256(currentContent)` é calculado novamente como hash final. Entretanto:

- o `previousHash` da operação N é exatamente o `contentHash` da operação N−1;
- para a primeira operação, o previous hash já foi calculado sobre o snapshot inicial;
- o hash final é exatamente o último `operationContentHash`;
- no-op pode reutilizar o hash anterior.

Assim, a mesma sequência de hashes/preconditions pode ser preservada com aproximadamente **metade das passagens SHA-256** sobre o conteúdo virtual em batches grandes.

**Estado-alvo:** hash pipeline incremental por reutilização de resultados, sem mudar qualquer `expectedHash`, output hash ou atomicidade.

### 23.5 Cache — separar freshness canônica de revalidação redundante

O L1 canônico possui:

- invalidation ativa local;
- journal cross-process com poll de 125 ms;
- TTL 60 s;
- stale probe rico a cada 2 s;
- hash revalidation apenas quando fingerprint diverge e o arquivo é elegível.

Esse desenho permanece bom. O L2 blob continua sem justificativa empírica.

O response cache MCP de `repo_read_file`, contudo, mantém `COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS=0` por default. Portanto até um shaped-cache hit executa `statPathValidated()` novamente. Como writes canônicos locais e remotos já removem a entrada via invalidation bus/journal, esse stat serve essencialmente como defesa contra alteração externa não observada pelo journal.

Não será ativado um trust window amplo por conveniência. A nova frente deverá comparar:

- baseline atual `trust=0`;
- lease muito curto (ex.: 100–500 ms);
- ou uma estratégia generation/fingerprint em que invalidation observada invalida imediatamente e external-write safety continua com probe bounded.

**Gate obrigatório:** ganho real em repeated-read workload + janela externa explicitamente quantificada. Sem benchmark, default continua 0.

### 23.6 Index freshness durante runtime — invalidar é correto, mas reindexar pode ser mais autônomo

O cross-process coherence plane já propaga mudanças. O index registry reage à invalidation removendo/inativando path, o que preserva segurança: buscas podem cair para ripgrep quando o índice deixa de estar fresco. Porém essa arquitetura ainda pode transformar uma sequência `patch → search` em fallback temporário mesmo quando a mudança veio de uma primitive canônica e o path exato é conhecido.

Estado-alvo adicional: avaliar um **incremental refresh scheduler** bounded e debounce-aware alimentado pelos eventos já existentes. Após write/patch/move, o index pode reindexar os paths conhecidos em background/oportunisticamente, sem scan amplo. Requisitos:

- nunca atrasar commit de arquivo;
- coalescer múltiplas mudanças do mesmo path;
- respeitar rename/delete;
- zero loop de invalidation;
- usar `refreshIoIndexPaths()` canônico;
- fallback search por rg continua disponível até refresh concluir;
- medir freshness lag e CPU/SQLite contention.

Alvo inicial: canonical write → index fresh novamente em **<500 ms p95**, sem adicionar >2 ms ao write critical path.

### 23.7 Parsing — worker pool saudável; otimizar cópias e identidade, não paralelismo por reflexo

O worker pool atual está adaptativo (até 4), queue max 128 e sem pressure relevante. Não há evidência para ampliar workers.

A prioridade de parser passa a ser:

- reutilizar hash/snapshot;
- evitar serialização/cópia de conteúdo quando o caller já possui resultado derivado apropriado;
- explorar o índice persistido para responder navigation/outline quando ele já contém símbolos suficientes, sem reparse, **apenas se o contrato solicitado puder ser atendido integralmente**;
- manter `parseFileForContext` como fallback canônico para top comments/outline rico.

### 23.8 Search — nova política de roteamento e cache negativo apenas sob evidência

O index-first router deve permanecer. Mudanças planejadas:

- remover full stats do fast path;
- medir index hit/miss/fallback por engine e duração;
- evitar `rg` spawn quando o índice consegue provar resposta completa;
- preservar rg para regex complexa, contexto e casos em que FTS/literal não prova completude;
- considerar negative routing cache somente depois de medir queries repetidas; nenhum cache de “sem resultados” pode sobreviver a invalidation generation.

### 23.9 Read — liberdade de payload sem sacrificar preconditions

Reads já suportam batch, chunks, hash modes e shaped cache. A nova faixa não criará uma nova read tool sem necessidade. Melhorias potenciais:

- tornar `hashMode` realmente custo-aware até a primitive baixa quando o caller explicitamente não precisa de full hash;
- reutilizar hash já presente em L1/snapshot/index quando semanticamente equivalente;
- manter full hash como default onde ele serve de precondition para patch/write;
- medir repeated batch/singleflight e output/context, não apenas disco.

### 23.10 Mutations/I/O — durability e rollback como políticas explícitas, nunca bypass implícito

As primitives atuais incluem atomic rename/link, lock, hash precondition, capacity preflight, fsync/directory sync quando aplicável e rollback sidecar apenas quando habilitado. A investigação futura pode medir quanto durability domina writes pequenos.

Qualquer opção nova de performance nesta área deve obedecer:

- default permanece seguro;
- nenhuma flag pública “unsafe/no-validation”;
- se um perfil de durability local mais rápido for justificável, ele será nomeado explicitamente e restrito a operações/ambientes em que a perda de durability após power loss seja uma escolha consciente, não uma mudança silenciosa;
- rollback automático permanece OFF até decisão separada.

---

# PARTE VII — ESTADO-ALVO V2

## 24. Arquitetura-alvo depois da maturação do Bulk/Capability Plane

### 24.1 Freshness Evidence Plane

A decisão “preciso reler/hashar?” deve usar evidência em camadas:

1. invalidation canônica local/cross-process;
2. Git HEAD/worktree/committed diff;
3. fingerprint rico do filesystem;
4. hash criptográfico como verificação escalonada/safety net;
5. full scan/hash apenas quando existe gap/incerteza/migration/manual forensic request.

O hash deixa de ser um relógio global de 30 s e passa a ser **budgeted verification evidence**.

### 24.2 Search Fast Plane — revisado pela evidência da Faixa 23

A hipótese inicial `query → direct index attempt → rg fallback` foi **refutada empiricamente**.

O contrato-alvo passa a ser:

`repo_search_text → rg canônico quando disponível → índice apenas como fallback de disponibilidade`

`repo_index_search` permanece a superfície explícita para discovery/FTS derivado.

A razão é simultaneamente de performance e correção: uma row invalidada é removida imediatamente do índice; enquanto o derived-state refresh ainda não convergiu, um **hit parcial positivo** no índice não prova que todos os matches foram encontrados. `rg`, ao contrário, consulta o filesystem canônico atual. Além disso, o literal SQLite atual usa `instr(lower(content), lower(?))` sobre chunks e ficou muito mais caro sob cold/concurrent load.

Full index stats/health ficam fora do caminho normal de `repo_search_text`. O índice continua valioso para símbolos, imports, FTS/discovery explícito e ambientes onde `rg` não esteja disponível.

### 24.3 Snapshot Identity Plane

Um conteúdo lido uma vez deve transportar sua identidade derivada:

`read snapshot {content,fingerprint,hash} → parser/cache/index/patch preconditions`

Sem recalcular hash idêntico em cada camada.

### 24.4 Mutation Hash Pipeline

Em operações sequenciais sobre o mesmo conteúdo virtual:

`H0 → patch1 → H1 → patch2 → H2 ...`

`Hn` deve ser reutilizado como `previousHash` da operação seguinte. O sistema mantém auditabilidade por operação sem re-hash do estado anterior.

### 24.5 Background Derived-State Plane

Índice, parser prefetch e outros estados derivados podem convergir em background após canonical invalidation, desde que:

- canonical file commit já tenha terminado;
- jobs sejam bounded/coalesced;
- derived failure nunca reverta a mutação;
- freshness explícita determine se search usa índice ou fallback.

### 24.6 Profiled Performance sem weakening de policy

Liberdade adicional deve vir de **políticas nomeadas e observáveis**, não de bypasses ocultos. Candidatos futuros:

- index verification profile: `strict | balanced | throughput` interno/configurável;
- response-cache external probe window bounded;
- mutation durability profile apenas se benchmark justificar;
- search engine choice já pode ser obtida pelas tools dedicadas (`repo_index_search` versus `repo_search_text`), evitando inflar schema sem necessidade.

---

## 25. SLOs V2

### Index/freshness

- steady startup skip/incremental: manter **<200 ms ideal**;
- periodic metadata reconcile: alvo **<700 ms** no workspace atual;
- periodic content-hash verification: **budgeted**, nunca ~1.400 reads por ciclo sem evidência;
- full cryptographic sweep: manual/gap/migration ou política de baixa frequência mensurável;
- canonical write → index fresh: alvo **<500 ms p95** se background refresh for habilitado.

### Search

- `repo_search_text` canônico via rg: warm p95 alvo **<100 ms** no workspace atual, preservando streaming/early-stop;
- zero full `getIoIndexStats()` no successful rg hot path;
- `repo_index_search` continua disponível explicitamente para FTS/discovery e deve convergir após canonical writes em <500 ms p95;
- nenhum hit parcial de derived state pode ser tratado como prova de completude do filesystem;
- route/engine permanece observável com custo desprezível.

### Parsing

- zero SHA-256 duplicado em `read snapshot → parseFileForContext` quando snapshot já fornece hash;
- worker queue failures/timeouts = 0 no workload normal;
- outline quente deve preferir cache/derivado antes de reparse.

### Read/cache

- repeated shaped read deve evitar stat redundante somente quando freshness lease/generation provar benefício;
- external-write staleness window deve ser explicitamente bounded e observável;
- L2 continua off enquanto não vencer benchmark representativo.

### Patch

- same-target batch mantém 1 lock/read/write;
- aproximadamente **50% menos full-content SHA passes** no pipeline sequencial, preservando todos os hashes externos;
- nenhum enfraquecimento de expectedHash/atomicity.

### Context/round-trip

- manter control-plane defaults compactos;
- novas opções só entram se aumentarem capacidade líquida por byte/tool;
- usar batch/bulk existente antes de criar novos nomes.

---

# PARTE VIII — ROADMAP V2: FAIXA 23

## Fase 23.0 — Instrumentação causal e microbenchmarks reproduzíveis

### 23.0.1 Index reconcile breakdown

- [ ] medir scan/fingerprint, second-stat, file-read, hash, parse e SQLite commit separadamente;
- [ ] registrar bytes hashed e arquivos verificados;
- [ ] distinguir `metadataReconciled`, `contentVerified` e `contentReindexed`.

### 23.0.2 Search route accounting

- [ ] counters por `literal-index`, `fts5`, `regex-index`, `rg` e fallback reason;
- [ ] medir custo de full index stats no baseline;
- [ ] A/B sem full stats.

### 23.0.3 Hash accounting

- [ ] parser: cache-key hash computed versus reused;
- [ ] patch batch: hash computations versus reused hashes.

**Gate:** nenhuma otimização de freshness será aceita sem before/after causal.

---

## Fase 23.1 — Search hot path sem full stats — **primeiro sublote concluído**

### 23.1.1 Canonical rg routing

- [x] remover `getIoIndexStats()` do hot path quando rg está disponível;
- [x] usar rg como busca textual completa/canônica;
- [x] manter índice como fallback quando rg não existe;
- [x] manter `repo_index_search` como opção explícita de derived-state search;
- [x] impedir que hit parcial do índice masque arquivo invalidado ainda não reindexado.

### 23.1.2 Search-state leve

- [x] tornou-se desnecessário no caminho canônico: availability de rg decide diretamente;
- [ ] reavaliar apenas se futura plataforma sem rg tornar o fallback dominante.

### 23.1.3 Gates

- [x] regressões `test_io_engine` e `test_mcp_tools` verdes;
- [x] benchmark batch representativo;
- [x] prova de completude: `patchTextBatchLocked(` retornou 5 matches via rg contra 4 no índice parcial anterior;
- [x] seis searches concorrentes: ~88 ms no batch após ativação, contra ~6,8 s no cold literal-index baseline.

---

## Fase 23.2 — Index Safety Reconcile V2

### 23.2.1 Desacoplar intervalos

- [x] full metadata reconcile não implica full hash sweep;
- [x] `IO_INDEX_HASH_VERIFY_INTERVAL_MS` default elevado de 30 s para **6 h**;
- [x] removido o alinhamento patológico 30 min × 30 s;
- [x] SHA periódico continua disponível como safety net e via override explícito.

### 23.2.2 Budgeted/rotating hash verification

- [ ] definir budget por files e/ou bytes por reconcile;
- [ ] persistir age/coverage suficiente para rotacionar verificação;
- [ ] priorizar arquivos com fingerprint pobre/incerteza;
- [ ] permitir full cryptographic sweep explícito.

### 23.2.3 Eliminar second-stat sem commit, se prova de segurança sustentar

- [x] separado `unchanged observation` de `index commit`;
- [x] default metadata-only aceita fingerprint rico sem second-stat adicional;
- [x] `assertCurrentFileSnapshot` preservado antes de publicar/reindexar conteúdo;
- [x] modo estrito reativável por `IO_INDEX_RECHECK_UNCHANGED_SNAPSHOT`;
- [x] benchmark metadata-only reconcile: **496 ms**, 1.445 fast-path fingerprints, 0 second-stats/hashes.

### 23.2.4 Journal/checkpoint V2

- [ ] avaliar sequence/high-watermark persistido;
- [ ] detectar journal gap explicitamente;
- [ ] não substituir Git/fingerprint por journal; combinar evidências.

**Gate:** safety reconcile normal <700 ms e sem sweep de ~1,4k hashes.

---

## Fase 23.3 — Runtime Incremental Index Refresh

### 23.3.1 Scheduler

- [x] fila/coalescing por normalized path;
- [x] debounce default **100 ms**;
- [x] refresh após canonical invalidation, fora do write critical path;
- [x] batch bounded default 64; processamento interno permanece conservador/sequencial;
- [x] full build tem precedência e pending refresh é retomado depois;
- [x] derived refresh herda o **mesmo domínio semântico canônico** do lifecycle: scope root, extensions, hidden policy, `.gitignore`, include/exclude;
- [x] somente auto-build/startup adotam ou atualizam esse domínio; `repo_index_build` manual pode materializar outras slices sem redefinir a policy de convergência do runtime;
- [x] startup incremental recebe `scopeRoot`/`respectGitignore` e aplica a mesma policy antes de indexar explicit paths;
- [x] paths hidden/out-of-scope são descartados antes da fila; gitignored são filtrados por batch antes de `indexTextFile`;
- [x] domain reconciliation no lifecycle remove apenas rows históricas `refreshMode='explicit-path'` incompatíveis, preservando rows de builds manuais;
- [x] stats próprios: queue/coalescing/batches/lag/failures/high-water + `domainSkipped/gitignoredSkipped/domainReconciliations/domainPruned`.

### 23.3.2 Rename/delete/subtree

- [x] invalidar imediatamente antes da convergência derivada;
- [x] missing/deleted file permanece invalidado após refresh scoped;
- [x] recursive invalidation **não** é promovida implicitamente a scan; conta `recursiveSkipped`;
- [ ] provar move source+destination live e decidir se subtree mutation merece scoped reconcile explícito.

### 23.3.3 Cross-process proof

- [ ] processo A patcha;
- [ ] processo B/search index converge;
- [ ] medir write→fresh lag.

**Gate:** p95 <500 ms, sem loops, sem write latency material.

---

## Fase 23.4 — Snapshot/hash reuse em parser e outlines

### 23.4.1 API interna

- [x] `parseFileForContext(..., {contentHash})` implementado;
- [x] hash fornecido só é aceito no formato SHA-256 hex e usado como identidade de cache interna;
- [x] caller sem hash mantém fallback de cálculo atual;
- [x] telemetry `hashComputations/hashReuses` adicionada.

### 23.4.2 Migração

- [x] `repo_file_outline`;
- [x] orphan-import single-file path (`repo-index`);
- [x] `mcp_smoke_workspace`;
- [x] local LLM-B/index tool onde snapshot/hash já existe.

### 23.4.3 Benchmark

- [ ] arquivo pequeno, médio e grande;
- [ ] cold parse versus file-context cache hit;
- [ ] hash passes before/after.

---

## Fase 23.5 — Patch Hash Pipeline V2

### 23.5.1 Reuse chain

- [x] primeiro previous hash reutiliza snapshot inicial;
- [x] operação seguinte reutiliza hash final anterior;
- [x] final hash reutiliza última operação;
- [x] no-op reutiliza hash sem SHA adicional.

### 23.5.2 Segurança

- [x] todos `expectedHash` mantêm semântica exata;
- [x] hashes retornados por operação permanecem idênticos;
- [x] atomicidade e rollback permanecem iguais;
- [x] regressão dedicada valida cadeia H0→H1→H2 em dry-run sem alterar disco.

### 23.5.3 Benchmark

- [ ] 1, 8, 32 e 64 patches no mesmo arquivo;
- [ ] tamanhos 10 KiB / 100 KiB / 1 MiB;
- [ ] medir CPU/hash passes e wall time.

---

## Fase 23.6 — Read Response Cache V2 — **concluída sem ampliar trust window**

### 23.6.1 Baseline

- [x] repeated same-window reads com `trust=0`;
- [x] oito hits shaped simultâneos, concurrency 8: **7,479 ms no batch inteiro** (~6,45–6,83 ms por chamada observada);
- [x] cache/singleflight já existentes preservados; runtime health confirmou hits sem stale;
- [x] custo do `stat` validado é pequeno demais para justificar, no estado atual, uma janela de confiança default.

### 23.6.2 Freshness lease/generation

- [x] hipótese 100/250/500 ms avaliada contra o baseline e **rejeitada como default** antes de ampliar a janela: o ganho máximo plausível é de poucos milissegundos enquanto a stale window externa cresceria deliberadamente;
- [x] `COPILOT_MCP_REPO_READ_TRUST_WINDOW_MS` continua disponível como opção explícita e defaulta em **0**;
- [x] canonical invalidation continua imediata via bus/journal;
- [x] nenhuma alteração no stale-probe L1 default de 2 s neste sublote.

### 23.6.3 Rich fingerprint

- [x] `readText()` passa a propagar `ctimeMs/dev/ino` já presentes no L1/L2/fs snapshot, sem syscall adicional;
- [x] `readTextChunks()`/byte-line-index/stream materializado também propagam fingerprint rico;
- [x] shaped cache guarda e compara `size + mtime + ctime + dev + ino`;
- [x] regressão externa escreve conteúdo **same-size**, restaura o `mtime` anterior e, sem publicar invalidation canônica, prova que o shaped cache rejeita a entrada por fingerprint rico;
- [x] `test_mcp_tools`: verde em ~**4,471 s**; `test_io_engine`: verde em ~**2,497 s**; strict typecheck: verde em ~**14,863 s**.

**Decisão:** manter `trustWindowMs=0` por default e melhorar a qualidade da evidência, não trocar consistência por micro-latência. Uma futura lease só deve voltar à pauta se o profile real mostrar call pressure muito maior ou `stat` materialmente mais caro em outro filesystem.

---

## Fase 23.7 — Parsing/index derived-state reuse

- [ ] avaliar se outline/symbol requests podem ser satisfeitos diretamente pelo índice persistido quando contrato for completo;
- [ ] reutilizar parser snapshots entre index build e tool navigation quando process-local;
- [ ] evitar nova cache paralela se file-context/symbol cache já resolver;
- [ ] manter worker pool atual enquanto não houver pressure.

---

## Fase 23.8 — Mutation durability e I/O baixo nível — **concluída com perfis evidence-gated**

- [x] decompor atomic write em `tempPath`, capacity preflight, temp write + file flush, pre-publish hash check, publish rename/link, directory fsync e total;
- [x] medir o filesystem/container real com batches de 8 creates idênticos por perfil;
- [x] manter `file-and-directory` como default seguro e compatível;
- [x] expor apenas os três perfis internos já existentes, sem criar bypass de policy:
  - `file-and-directory`: file flush + directory fsync;
  - `file`: file flush, sem directory fsync;
  - `none`: sem pedido de file flush nem directory fsync;
- [x] preservar em **todos** os perfis path policy, validated capabilities, locks, capacity guards, temp sibling, atomic rename/link, expectedHash e rollback/audit aplicáveis;
- [x] instrumentar durability no runtime health com contagem por modo e médias bounded das fases;
- [x] levar a opção às mutações atomic-writer MCP e LLM-B: write/create/patch single, patch batch e create via file batch;
- [x] elevar `CAPABILITIES_VERSION` para **50** e documentar a diferença entre segurança lógica/transacional e persistência após crash/power-loss.

Benchmark warm no mesmo processo, 8 arquivos por grupo, payload idêntico:

- **`file-and-directory`: ~23,98 ms/write** no atomic writer;
- **`file`: ~14,18 ms/write** — ~**40,9%** abaixo do strict;
- **`none`: ~6,95 ms/write** — ~**71,0%** abaixo do strict e ~**51,0%** abaixo de `file`;
- directory fsync no strict warm: ~**6,55 ms/write**;
- capacity preflight: ~**0,01–0,03 ms/write**, irrelevante como gargalo;
- publish rename/link: ordem de ~**1,8–2,7 ms/write** nos grupos warm;
- `tempWriteMs` inclui a escrita e, quando solicitada, a flush do arquivo; por isso a diferença `file → none` captura o custo agregado dessa garantia sem fingir uma medição isolada de fsync interno do `fs.writeFile({flush:true})`.

**Decisão:** a liberdade adicional é material e justificada, mas o default **não muda**. Perfis mais rápidos são escolha explícita do caller quando throughput interativo importa mais que a garantia de persistência pós-crash.

---

## Fase 23.9 — Registry/liberdade e novas opções

- [ ] revisar quais opções já existem mas não estão materializadas pelo host atual;
- [ ] preferir ampliar capacidade por primitives/bulk existentes;
- [ ] nova tool somente se um workflow importante continuar exigindo múltiplos round-trips e não puder ser expresso pelo contrato atual;
- [ ] manter `tools/list` com headroom e security metadata integral.

---

## Fase 23.10 — Gates contínuos e publicação por sublotes

Cada sublote deve fechar:

1. focused tests causais;
2. strict typecheck quando source tipado for tocado;
3. lint ao fechamento publicável;
4. reload apenas quando runtime MCP exigir ativação;
5. smoke composto único pós-reload;
6. prova live before/after;
7. atualização deste documento;
8. stage por paths explícitos e publish governado.

Validações amplas continuam raras; o objetivo é reduzir custo de iteração, não transformar toda microalteração em suíte total.

---

## 26. Ordem inicial de execução da Faixa 23

### P0 imediato

1. **Search hot path sem full stats** — baixo risco, alta frequência, remoção clara de trabalho redundante;
2. **Patch hash pipeline** — transformação local, sem mudança de semântica e com ganho crescente com batch size;
3. **Parser content-hash reuse** — remove hash duplicado em outline/contexto.

### P0/P1 estrutural

4. **Index Safety Reconcile V2** — maior custo periódico medido: 1,948 s / 1.443 hash reads inúteis na última amostra;
5. **Runtime incremental index refresh** — reduz janela de fallback após writes e amplia autonomia MCP ↔ LLM-B.

### P1 evidence-gated

6. response-cache freshness lease/rich fingerprint;
7. parser/index derived-state reuse;
8. incremental refresh concurrency para dirty sets grandes.

### P2

9. durability profiling/opções;
10. novas surfaces MCP somente se round-trip accounting demonstrar necessidade.

A regra desta segunda geração é mais exigente que a anterior: **não basta uma ideia ser arquiteturalmente elegante; ela deve eliminar uma classe observável de trabalho, aumentar liberdade real ou fortalecer segurança/freshness com custo mensurável menor.**

---

# PARTE IX — EXECUÇÃO DA FAIXA 23

## 27. Sublote 23.A — search completo, hash reuse e derived-state convergente

Este sublote implementou os cinco primeiros eixos P0/P0-P1 da segunda geração em um único ciclo de ativação, mas com gates independentes por componente.

### 27.1 Search — hipótese index-first refutada

Benchmark baseline antes da mudança, seis buscas literais simultâneas em `src/copilot`:

- cold literal SQLite: chamadas individuais ~**6,35–6,55 s**, batch **6.802 ms**;
- segundo ciclo warm: ~**245–251 ms** por chamada;
- comparação sequencial warm por `patchTextBatchLocked(`: SQLite **47,9 ms**, rg **38,3 ms**.

Mais importante que a latência: SQLite retornou **4 matches**, enquanto rg retornou **5**. O match ausente estava neste próprio roadmap, cuja row havia sido invalidada pela edição corrente. Como ainda existiam outros hits frescos, a antiga estratégia index-first tratava o conjunto parcial como resposta suficiente e não fazia fallback.

Correção:

- `repo_search_text` prefere rg quando disponível;
- o hot path de rg não chama `getIoIndexStats()`;
- index literal/FTS permanece fallback quando rg não está disponível;
- `repo_index_search` continua sendo a opção explícita para FTS/discovery derivado.

Prova live pós-reload:

- 6 searches concorrentes: **88 ms no batch inteiro**;
- todas `engine=rg`;
- `patchTextBatchLocked(` retornou **5 matches**, incluindo o roadmap recém-modificado;
- o contrato de completude volta a ser o filesystem atual, não o derived state temporariamente incompleto.

### 27.2 Patch hash pipeline — identidade virtual encadeada

`patchTextBatchLocked()` passou de um esquema que recalculava o hash do estado anterior em cada operação e o hash final ao término para uma cadeia explícita:

`H0 → patch1 → H1 → patch2 → H2 ...`

Agora:

- `H0` vem do snapshot inicial;
- `Hn` é `previousHash` da operação seguinte;
- no-op reutiliza `Hn-1` sem SHA adicional;
- o hash final é o último hash já calculado;
- `expectedHash` continua verificado exatamente no mesmo estado virtual;
- nenhum lock/read/write/rollback mudou.

Uma regressão dedicada com dois patches e dry-run valida `H0`, `H1`, `H2`, hashes por operação e ausência de escrita. `test_io_engine`: verde após correção do teste; strict typecheck também verde.

### 27.3 Parser — snapshot content hash reutilizado

`parseFileForContext()` agora aceita opcionalmente `{ contentHash }` para formar a identidade do file-context cache sem SHA duplicado. Regras:

- somente SHA-256 hex de 64 chars é aceito como identidade fornecida;
- é identidade de conteúdo/cache interna, **não** autoridade de filesystem;
- caller sem hash continua calculando SHA localmente;
- telemetry separa `hashComputations` e `hashReuses`.

Migrados:

- `repo_file_outline`;
- orphan-import single-file path;
- `mcp_smoke_workspace`;
- local/index tool que já possuía `snapshot.contentHash`.

Prova live no processo novo, antes de qualquer outline manual adicional:

- `fileContextHashComputations=0`;
- `fileContextHashReuses=1`;
- worker failures/timeouts/fallbacks = 0.

Isso prova que o próprio smoke/startup já atravessou o novo caminho sem re-hash.

### 27.4 Safety Reconcile V2 — resultado causal

Baseline imediatamente anterior:

- 1.680 entries;
- 1.445 candidates;
- 1.443 unchanged;
- **1.443 SHA-256 verifications / 1.443 hits**;
- 2 arquivos reindexados;
- **1.948 ms**.

Mudança:

- hash periodic default: **30 s → 6 h**;
- metadata reconcile de 30 min continua intacto;
- fingerprint rico `(mtime,size,ctime,dev,ino)` é suficiente para o branch unchanged sem publicação;
- second-stat por unchanged deixa de ser default;
- `IO_INDEX_RECHECK_UNCHANGED_SNAPSHOT` reativa explicitamente a postura estrita antiga;
- `assertCurrentFileSnapshot` continua obrigatório antes de hash-refresh/index commit;
- novos counters distinguem `unchangedFingerprintFastPath` e `unchangedSnapshotRechecks`.

Prova live manual após reload, mesmo universo de **1.445 candidates**:

- indexed: **0**;
- unchanged: **1.445**;
- hash verifications: **0**;
- `unchangedFingerprintFastPath`: **1.445**;
- `unchangedSnapshotRechecks`: **0**;
- snapshot conflicts/failures: **0**;
- duração: **496 ms**.

Resultado: **1.948 → 496 ms (−74,5%)**, com eliminação de 1.443 file reads/hashes e ~1.445 second-stats no ciclo normal. O startup do mesmo processo já havia fechado seu `full-reconcile` em ~**583 ms**, corroborando a ordem de grandeza.

### 27.5 Runtime incremental index refresh

O index invalidation hook deixou de apenas apagar derived state. Fluxo novo:

1. invalidation canônica local/cross-process chega ao hook;
2. row do índice é invalidada imediatamente;
3. path normalizado entra em fila coalescida;
4. writer retorna sem esperar parser/SQLite;
5. após debounce default de **100 ms**, paths são enviados em batch bounded (default 64) a `refreshIoIndexPaths()`;
6. full build tem precedência; pending refresh é retomado depois;
7. eventos recursivos não promovem scan implícito e incrementam `recursiveSkipped`.

Configurações novas, internas e observáveis:

- `IO_INDEX_AUTO_REFRESH_ENABLED` (default ON);
- `IO_INDEX_AUTO_REFRESH_DEBOUNCE_MS` (default 100);
- `IO_INDEX_AUTO_REFRESH_MAX_BATCH` (default 64);
- `IO_INDEX_RECHECK_UNCHANGED_SNAPSHOT` para o perfil estrito de metadata reconcile.

Stats de auto-refresh entram em `getIoIndexStats()`/runtime health: queue, coalescing, pending/running, batches, requested/indexed/invalidated/failed, lag, high-water.

Prova live create:

- arquivo JS temporário criado por `repo_create_file`;
- write canônico: **153 ms**;
- `repo_search_text` encontrou imediatamente via rg;
- `repo_index_search` encontrou logo depois;
- auto-refresh: `queued=1`, `batches=1`, `requested=1`, `indexed=1`, `failed=0`;
- refresh work: **4 ms**;
- lag: **100 ms**.

Prova live delete do mesmo arquivo:

- delete canônico: **13 ms**;
- `repo_index_search` posterior: **0 matches**;
- acumulado: `queued=2`, `batches=2`, `requested=2`, `indexed=1`, `invalidated=1`, `failed=0`;
- último refresh: **1 ms**;
- último lag: **101 ms**;
- arquivo temporário removido do workspace.

O gate local do scheduler também prova que duas invalidações do mesmo path coalescem para um refresh e que invalidation recursiva não dispara scan implícito.

### 27.6 Gates do sublote até a ativação

- `test_io_engine.spec.js`: verde, ~**4,257 s** no gate final relevante;
- `test_io_parser.spec.js`: verde, ~**2,367 s**;
- `test_io_index_sqlite.spec.js`: verde, ~**1,779 s**;
- `test_io_index_registry.spec.js`: verde, ~**0,943 s**;
- `test_mcp_runtime_metrics.spec.js`: verde, ~**3,913 s**;
- strict typecheck: múltiplos gates verdes; último pré-reload relevante ~**8,880 s**;
- reload QUIC controlado;
- primeiro connector smoke caiu apenas na janela de restart; repetição canônica: `ready=true`, OAuth/SSE green, **119/119**, `tools/list=117.956 bytes`, total **1.117 ms**.

### 27.7 Pendências que permanecem deliberadamente abertas

- hash verification rotativo/budgeted por files/bytes continua útil como evolução posterior; o sublote atual apenas eliminou a cadência patológica;
- journal/checkpoint high-watermark ainda não foi promovido a freshness evidence persistente;
- cross-process write→refresh ainda requer prova live específica entre dois processos, embora o mesmo hook receba eventos do journal;
- move source+destination deve ganhar prova live própria;
- parser benchmark por 10 KiB/100 KiB/1 MiB e patch benchmark 1/8/32/64 operações continuam abertos;
- response-cache lease default foi rejeitada por evidência; derived-state reuse avançado e journal/checkpoint high-watermark permanecem evidence-gated.

A principal mudança de regime é que o sistema agora distingue claramente **fonte canônica** de **derived state**: rg/filesystem responde a busca completa; índice converge rapidamente para discovery; fingerprints sustentam freshness barata; SHA é safety evidence periódica; e hashes já derivados fluem entre camadas em vez de serem recalculados por hábito.

---

## 28. Sublote 23.C — durability mensurável e liberdade explícita sem weakening lógico

A investigação de durability começou sem alterar qualquer default. Primeiro, o low-level atomic writer passou a expor `phaseTimings` bounded e o runtime health ganhou um resumo de custo por fase. A decomposição cobre:

- sibling temp-path preparation;
- capacity preflight;
- temp write e file flush quando solicitado;
- reread/hash precondition antes do publish quando aplicável;
- atomic rename/link;
- parent-directory fsync;
- total atomic writer.

A telemetria também passou a registrar duração acumulada/máxima de syncs e distribuição dos modos de durability observados.

### 28.1 Baseline strict e identificação do gargalo

Em 8 creates reais, o primeiro profile strict mostrou atomic write médio ~**17,88 ms**, com directory fsync ~**5,36 ms** e temp write + flush ~**6,48 ms**. O primeiro grupo ainda continha cold-start overhead em temp-path preparation, portanto não foi usado isoladamente para decidir a API.

A evidência, contudo, mostrou que persistência pós-crash era uma fração material do write total e justificava comparar os modos já existentes internamente.

### 28.2 Perfis expostos

A superfície MCP/LLM-B agora aceita opcionalmente:

- `durability='file-and-directory'` — **default**; flush do arquivo + fsync do diretório;
- `durability='file'` — mantém file flush e omite apenas o directory fsync;
- `durability='none'` — não solicita file flush nem directory fsync.

A opção foi levada apenas aos caminhos que realmente atravessam o atomic writer:

- MCP `repo_write_file`;
- MCP `repo_create_file`;
- MCP `repo_apply_patch`;
- MCP `repo_apply_patch_batch`;
- `create_file` dentro de `repo_apply_file_batch`;
- LLM-B `write_file_content`;
- LLM-B `create_file`;
- LLM-B `patch_file`;
- LLM-B `patch_files_batch`.

Move/delete/quarantine/copy não receberam uma opção que não corresponde ao seu primitive real.

Batch records passam por `durabilityOption()`, que só produz o union canônico `file-and-directory | file | none`; strings internas arbitrárias não chegam às primitives mesmo se um caller contornar o Zod externo.

### 28.3 Fronteira de segurança

Nenhum perfil altera:

- path policy ou containment/symlink checks;
- validated path capabilities;
- locks;
- capacity preflight;
- sibling temp file;
- atomic rename/link publication;
- expectedHash/preconditions;
- rollback/audit aplicáveis.

A diferença é **somente** a garantia de persistência depois que o syscall de write/publish retorna, especialmente diante de crash/power-loss. Assim, `none` não é um modo “unsafe/no-validation”; é um perfil de crash durability mais fraco, apropriado apenas quando o caller conscientemente prefere throughput/latência.

### 28.4 Benchmark warm no mesmo processo

Foram executados grupos de 8 creates, mesmo payload e mesmo diretório, no mesmo processo MCP. Depois do cold group inicial, a comparação warm foi:

- `file-and-directory`: ~**23,98 ms/write** no atomic writer;
- `file`: ~**14,18 ms/write**;
- `none`: ~**6,95 ms/write**.

Deltas aproximados:

- `file` vs strict: **−40,9%**;
- `none` vs strict: **−71,0%**;
- `none` vs `file`: **−51,0%**.

No strict warm:

- directory fsync: ~**6,55 ms/write**;
- temp-path preparation: ~**0,055 ms/write**;
- capacity preflight: ~**0,011 ms/write**;
- publish: ~**2,27 ms/write**;
- temp write + file flush: ~**14,59 ms/write**.

No grupo `none`, `tempWriteMs` caiu para ~**4,11 ms/write** e directory sync foi zero. Como `fs.writeFile({flush:true})` faz a flush internamente, essa métrica agrega write+flush; o documento não a apresenta falsamente como um fsync isolado.

### 28.5 Superfície e gates

`CAPABILITIES_VERSION` passou de **49 → 50**.

Authenticated `tools/list` passou de **117.956 → 119.654 bytes**: +**1.698 bytes** (~**+1,44%**) para adicionar a opção às mutações existentes, sem criar nova tool; 119/119 parity permaneceu integral.

Gates funcionais antes/depois da ativação:

- low-level I/O engine: green;
- fault injection: green;
- observability bounds: green;
- MCP repo-write: green;
- LLM-B write: green;
- LLM-B bulk: green;
- registry: green;
- runtime metrics: green;
- strict typecheck: green;
- regressões adicionais provam `file` e `none` no low-level, `none` mantendo temp+rename com ausência de `flush`, e MCP aceitando perfil explícito sem alterar o default.

Reload v50: primeira tentativa caiu apenas na janela de restart; smoke canônico subsequente `ready=true`, OAuth/SSE green, **119/119** tools.

Todos os **32 arquivos temporários** dos quatro grupos de benchmark foram removidos em uma única file-batch, zero failures; o index auto-refresh recebe as invalidações e converge sem full scan.

### 28.6 Decisão operacional

O default continua `file-and-directory`. O ganho de `file` e `none` é grande o bastante para justificar a nova liberdade, mas insuficiente para justificar uma mudança silenciosa de persistência.

Regra prática:

- source/artefato valioso e operação normal: `file-and-directory`;
- workload regenerável ou iteração de desenvolvimento em que directory durability é dispensável: `file`;
- temporários/derived state/regeneráveis em que crash persistence não é requisito: `none`.

Essa separação transforma durability de custo oculto em **política explícita, mensurável e opt-in**, preservando a segurança lógica do write plane.

### 28.7 Correção pós-benchmark — auto-refresh não pode ampliar o domínio do índice

A limpeza dos 32 artefatos de benchmark e a leitura posterior de `repo_index_status` revelaram um efeito colateral do scheduler introduzido no 23.A: o full build normal trabalha com `showHidden=false` e `respectGitignore=true`, mas `refreshIoIndexPaths()` originalmente filtrava apenas extensão. Assim, mutações em `.ai/jobs/*.json|*.txt` — extensões formalmente indexáveis — podiam inserir derived rows que um full scan jamais criaria.

Isso explica por que o número de indexed files não retornou imediatamente ao baseline depois da remoção dos benchmarks: validators e outros artefatos hidden continuavam gerando invalidations e refreshes scoped.

Correção:

- o registry memoriza `scopeRoot`, `workspaceRoot`, extensions, `respectGitignore`, include e exclude do último build/startup refresh canônico;
- filtro lexical barato recusa out-of-scope, hidden e extensão/pattern incompatível **antes da fila**;
- `.gitignore` é aplicado uma vez por batch antes do refresh;
- `refreshIoIndexPaths(scopeRoot=...)` aplica a mesma policy, fechando também o startup incremental;
- paths recusados continuam invalidados; apenas não podem ser reintroduzidos no derived state;
- regressões provam:
  1. `.ai/jobs/job.json` não entra na fila;
  2. `ignored.js` entra no debounce mas é filtrado antes de `indexTextFile`;
  3. incremental startup com `.hidden.js` retorna `skipped=1` e não indexa.

Essa correção reforça um princípio do Estado-Alvo V2: **convergência não é apenas voltar a ter uma row; é convergir para exatamente o mesmo conjunto semântico que o build canônico produziria.**

---

# Parte X — Nova investigação profunda: Node 24+, scanner, libraries, scopes e Context Plane

## 29. Estado reconciliado após `03a250d0a`

Baseline de entrada desta rodada:

- `main == origin/main == 03a250d0a2f0c458ed0cd0d2630c98bd6d5ecd2e`;
- runtime MCP real: **Node v24.15.0 / Linux**;
- 119/119 tools, `CAPABILITIES_VERSION=50`;
- `repo_search_text` típico recente ~24 ms; `repo_read_file` ~17 ms; `repo_index_search` ~4 ms; patch single ~56 ms;
- o custo cumulativo dominante recente continua sendo validators/processos externos, não read/search normais;
- Safety Reconcile V2 permanece abaixo do antigo sweep de hashes (~0,5–0,65 s sobre ~1,4k candidatos, zero hashes no fast path recente);
- read response cache mantém trust window default 0 e fingerprint rico;
- durability possui `file-and-directory | file | none`, default estrito;
- derived index auto-refresh está bounded e domain-aware.

A consequência arquitetural é importante: **não há evidência para acrescentar cache indiscriminado ao hot path de read/write**. A nova rodada deve atacar trabalho duplicado, coerência externa, payload/context e composição de working sets.

## 29.1 Node 24 — capacidades nativas confirmadas

Investigação contra a documentação oficial do Node 24 e o runtime real confirmou:

1. `fs.watch({ recursive:true })` possui suporte Linux desde Node 19.1; portanto o comentário/caminho de `pinned-files` que trata recursive watch como macOS/Windows-only está obsoleto no nosso Node 24.15;
2. `fs.promises.glob()` é estável em Node 24 e suporta `withFileTypes`, `exclude` e `followSymlinks`;
3. `path.matchesGlob()` é estável em Node 24.8+;
4. `crypto.hash()` é one-shot, estável no runtime atual e é recomendado pelo próprio Node para payload prontamente disponível de até aproximadamente 5 MiB, exatamente a faixa dominante dos hashes internos desta arquitetura;
5. module compile cache está maduro em Node 24.15 (`enableCompileCache`, `getCompileCacheDir`, `flushCompileCache` e status estáveis);
6. o projeto **já ativou compile cache** cedo no MCP e o propaga para safe validation; portanto essa frente deve ser completada, não reimplementada.

### 29.1.1 Regra Node-native first

Estado-alvo:

> Preferir primitive nativa estável do Node 24 quando ela satisfaz nosso contrato; biblioteca externa só entra quando entrega semântica necessária ausente ou ganho comprovado por benchmark representativo.

Isso não significa remover bibliotecas úteis por princípio. Significa retirar dependência conceitual desnecessária.

## 29.2 Revisão de libraries/dependencies

### Manter

- `better-sqlite3`: continua adequado ao índice local; os antigos scans literais síncronos foram removidos do caminho canônico;
- `@babel/parser`: ainda necessário para AST/símbolos; worker pool atual não mostra pressão suficiente para justificar Piscina;
- `lru-cache`: política de tamanho/eviction já madura e observável;
- `p-limit`: Node não oferece hoje um limiter equivalente simples; está corretamente usado em scan/prefetch/index;
- `ignore`: mantém semântica de `.gitignore`, que `path.matchesGlob` não substitui.

### Benchmarkar antes de substituir

- `minimatch`: hoje só é importado pelo glob canônico de `src/copilot`; Node 24 possui `path.matchesGlob`, porém nosso contrato inclui plain-segment compatibility, braces, globstar, extglob, character classes, dot files e tratamento literal de `!/#`. Não trocar sem matriz de equivalência e benchmark;
- scanner `readdir/lstat`: comparar apenas em benchmark com `fs.promises.glob`/`opendir`/`rg --files`; scanner rico ainda precisa de policy, stats, fingerprint, redaction e forma de árvore, portanto native glob não é substituição automática.

### Não adicionar agora

- `chokidar`: recursive `fs.watch` existe no Node 24; watcher externo pode ser implementado como acelerador best-effort nativo. As caveats oficiais de Docker/virtualização exigem fallback por fingerprint/journal mesmo com Chokidar;
- `fast-glob`: Node 24 já fornece glob estável; não há lacuna demonstrada que justifique nova dependência;
- Piscina/worker-pool library: o parser já tem pool próprio bounded e a telemetria recente não mostra queue/timeout/failure pressure;
- `stream-json` / serializers especializados: só reavaliar se JSON grande/serialização voltar a aparecer como gargalo medido.

### Revisar/remover

- `xxhash-wasm`: não há import de produção em `src/`; permanece apenas como dependência histórica/documentação. Não usar para preconditions de segurança; avaliar remoção em fase de hygiene se package-lock puder ser atualizado de forma governada.

## 29.3 Scanner — novo gargalo estrutural identificado

`scanDirectory()` hoje pode pagar, por arquivo:

1. `evaluateIoPathPolicyAsync()` → `realpath` para garantir containment/symlink safety;
2. `lstat` para fingerprint rico;
3. `buildFileFingerprint()` → **novo `realpath` do mesmo arquivo**.

Após a remoção do sweep de SHA e do second-stat no Safety Reconcile V2, esse duplicate-realpath passa a ser candidato forte para o custo residual de ~0,5–0,65 s.

### Estado-alvo

- manter **uma** avaliação async de policy por entry quando necessária;
- reutilizar `policy.realPath` como canonical path do fingerprint;
- nunca enfraquecer symlink containment apenas para evitar syscall;
- medir contador `realpathReuses`/`realpathComputations` no scan para prova causal;
- preservar fallback a `buildFileFingerprint()` independente para callers sem policy evidence.

## 29.4 Coherence Plane externo — watcher como acelerador, não autoridade

O sistema já possui:

- invalidation bus local;
- journal cross-process para writers canônicos;
- rich fingerprint + stale probe para detectar alterações externas;
- derived index auto-refresh.

Falta um acelerador para alterações **não canônicas**: editor, Git checkout, processos externos.

### Estado-alvo

Adicionar `External Watch Plane` opcional/best-effort sobre `src/copilot`:

- Node `fs.watch(..., { recursive:true, persistent:false })` no Linux/Node 24;
- debounce/coalescing bounded por normalized path;
- evento nunca é prova de segurança nem de conteúdo; apenas chama a invalidação canônica;
- fallback existente de rich fingerprint/journal permanece obrigatório;
- `filename=null`, watcher error, overflow/unsupported não tornam o runtime degraded por si só; marcam watcher unavailable/degraded e preservam fallback;
- evitar indexar `.ai`, `.git`, `node_modules` e demais domínios protegidos;
- counters: events, coalesced, invalidated, nullFilename, errors, lastEventAt, maxBatch;
- benchmark/soak antes de reduzir qualquer stale-probe interval.

O mesmo conhecimento corrige `pinned-files`: no Node 24 Linux, preferir um watcher recursivo, eliminando fan-out manual de first-level subwatchers.

## 29.5 Hash Plane V3 — `crypto.hash` one-shot

O helper canônico `sha256()` ainda usa `createHash().update().digest()` mesmo para strings/Buffers já integralmente em memória.

Estado-alvo:

- usar `node:crypto.hash('sha256', data, 'hex')` para o helper one-shot canônico;
- manter `createHash` apenas onde houver streaming/incremental hashing real;
- contrato SHA-256 permanece idêntico; nenhuma precondition muda;
- provar igualdade em strings, Buffer, Uint8Array, UTF-8 e payload grande dentro do threshold;
- benchmarkar em workload representativo antes de atribuir ganho percentual.

## 29.6 Compile Cache V2

Já implementado:

- MCP CLI chama `enableCopilotNodeCompileCache()` cedo;
- helper propaga `NODE_COMPILE_CACHE`/portable para subprocessos de safe validation;
- o runtime real Node 24.15 suporta a API estável.

Lacunas a investigar/fechar:

- terminal/LLM-B não ativa explicitamente o helper no entrypoint;
- jobs MCP comuns herdam `process.env` do MCP, mas isso deve ser provado por teste/health;
- `flushCompileCache()` não é usado: pode ser vantajoso após boot/warm graph, antes de filhos recorrentes, sem esperar exit do processo;
- health deve mostrar compile cache enabled/status/directory/portable sem expor path sensível desnecessário.

## 29.7 Scope / Working Set — auditoria da LLM-B

A LLM-B possui sete tools:

- `workspace_scope_declare`;
- `workspace_scope_list`;
- `workspace_scope_refresh`;
- `workspace_scope_invalidate_path`;
- `workspace_scope_context`;
- `workspace_scope_find_symbol`;
- `workspace_scope_close`.

A infra compartilhada `io-session-scope` faz mais do que um filtro de arquivos:

1. scan/select de paths;
2. prefetch de L1;
3. parse simbólico em background;
4. symbol index por sessão;
5. invalidation automática pelo bus;
6. refresh de paths stale;
7. contexto resumido (`files/symbols/topExports`);
8. LRU-like eviction por `MAX_ACTIVE_SCOPES`.

### Problemas encontrados antes de qualquer exposição MCP

1. contrato `maxFiles` está inconsistente: comentários/tool o chamam advisory, mas `warmFromDirectory()` aplica `slice(0,effectiveMaxFiles)` e portanto é **hard selection limit**;
2. `indexMode='auto'` pode executar um `buildIoIndexForDirectory()` completo após scan+prefetch+parse, duplicando derived-state work que o índice global já pode ter pago;
3. scope context atual é pequeno, mas pouco informativo para investigação profunda: não fornece manifest bounded de paths/outline/import relationships;
4. sete novas tools MCP aumentariam `tools/list` e decisão do modelo desnecessariamente;
5. escopo process-local precisa de lifecycle e identificação segura se usado pelo MCP stateful runtime.

### Estado-alvo: Working Set V2 compartilhado

- manter `io-session-scope` como engine compartilhada LLM-B/MCP;
- corrigir semântica de maxFiles/limits;
- evitar full index rebuild por scope quando índice global já cobre/fresh;
- trabalhar por snapshots/hashes já existentes, sem reread/parser duplicado;
- gerar manifest compacto: files, stale, symbols, top exports, imports/related paths e budgets;
- MCP expõe **uma única tool composta**, proposta `repo_working_set`, com ação `open|context|find|refresh|close`, em vez de sete nomes;
- `open` gera scopeId opaco/unguessable ou liga ao contexto de sessão MCP; não aceitar collision-prone sessionId arbitrário como autoridade;
- máximo de scopes, files, bytes de contexto, lifetime e eviction explícitos;
- invalidation e close nunca apagam L1 global; removem somente estado derivado do working set;
- medir se um workflow real reduz calls/read/outline/search antes de manter a tool anunciada por default.

## 29.8 Context Plane — capabilities summary ainda excessivo

Medição recente:

- `mcp_capabilities_summary`: ~32,8 KiB em uma única chamada;
- handler ~1 ms: gargalo é **context/wire payload**, não CPU.

Causa:

- nomes das 119 tools são retornados por grupos;
- os mesmos nomes reaparecem em `advertisedTools`;
- toda `IO_GUIDANCE` é retornada no default.

Estado-alvo:

- default decision surface: versions, contagens por grupo, security/auth summary, deprecated/experimental counts, 5–8 guidance items essenciais;
- `includeDetails=true`: grupos completos, advertised names e guidance integral;
- internal delegation usa summary compacto salvo necessidade explícita;
- SLO default <8 KiB structured sem perder decisões operacionais.

## 29.9 Estado-Alvo V3 consolidado

### Invariantes

1. uma operação lógica deve pagar policy/realpath/hash/parse no máximo uma vez quando a evidência pode ser encadeada com segurança;
2. watcher acelera freshness, nunca substitui fingerprint/journal;
3. Node-native stable > nova dependência, salvo benchmark/semântica contrária;
4. derived state deve convergir sem entrar no critical path de write;
5. working set deve **compor** caches/index/parser existentes, não criar uma quarta cópia de conteúdo;
6. contexto default é decision-oriented; detalhes ficam opt-in;
7. segurança lógica, symlink containment, hash preconditions e crash durability continuam separadas e explícitas;
8. qualquer mudança de tool surface precisa justificar bytes adicionais de `tools/list`.

### SLOs V3

- full reconcile unchanged de `src/copilot`: alvo <450 ms neste ambiente, sem reduzir segurança;
- `repo_search_text` literal hot: manter <100 ms;
- `repo_read_file` small/medium hot: manter <50 ms;
- capabilities summary default: <8 KiB structured;
- external watch invalidation p50: <250 ms quando watcher saudável;
- working-set context: <16 KiB default, bounded;
- scope refresh de poucos paths: O(changed paths), nunca O(scope inteiro) por default;
- zero dependência de watcher para correctness;
- zero duplicação conhecida de realpath/hash/parser no mesmo pipeline causal.

---

# Faixa 30 — Roadmap de implementação V3

## Fase 30.1 — P0: Scan Identity Chaining

### 30.1.1 Duplicate realpath

- [x] capturar `policy.realPath` no scanner;
- [x] permitir fingerprint receber canonical path já validado;
- [x] preservar fallback independente;
- [x] adicionar counters `fingerprintRealpathReuses/fingerprintRealpathComputations` e regressões dos ramos reuse/fallback;
- [ ] acrescentar regressão scanner-specific para symlink-outside (a policy canônica já possui regressão própria);
- [x] benchmark full reconcile antes/depois.

### 30.1.2 Gitignore matcher cache

- [ ] medir custo antes;
- [ ] se relevante, cache bounded por workspace + fingerprint/mtime;
- [ ] invalidar via canonical invalidation/external watch.

## Fase 30.2 — P0: Hash One-shot Node 24

- [x] migrar helper SHA in-memory para `crypto.hash`;
- [x] testes de identidade SHA-256;
- [x] manter `createHash` apenas nos callers que ainda usam hashing incremental/streaming próprio;
- [ ] benchmark hash sizes 1 KiB / 64 KiB / 1 MiB / 5 MiB antes de atribuir ganho percentual.

## Fase 30.3 — P0: Context Payload V2

- [x] compactar `mcp_capabilities_summary` default;
- [x] `includeDetails=true` para full manifest/guidance;
- [x] evitar duplicação `groups + advertisedTools` no default;
- [x] delegations usam compact summary;
- [x] SLO <8 KiB: **3.713 bytes** observados no runtime real.

## Fase 30.4 — P1: Native Watch / External Coherence

### 30.4.1 Pinned files

- [x] atualizar premissa Linux Node 24;
- [x] tentar um recursive watcher por root em qualquer plataforma suportada pelo runtime;
- [x] fallback somente em erro/unsupported real, não por platform hardcode;
- [x] regressão end-to-end de add/change em arquivo nested.

### 30.4.2 I/O external watch plane

- [x] módulo bounded/best-effort;
- [x] recursive `fs.watch`, debounce e coalescing;
- [x] invalidation bus canônico;
- [x] filtros de domínio hidden/denylist;
- [x] health/counters;
- [x] teste filesystem real de alteração nested fora do writer canônico;
- [x] deduplicação temporal contra a mesma mutação já coberta por invalidation canônica;
- [x] nenhum relaxamento de stale probe: rich fingerprint/journal continuam fallback de correctness.

## Fase 30.5 — P1: Working Set / Scope V2

### 30.5.1 Corrigir infra compartilhada

- [x] corrigir contrato `maxFiles` como hard selection cap para directory scopes;
- [x] separar `selectedFiles/candidateFiles/hardLimitReached`;
- [x] parser reuse por snapshot já aquecido;
- [x] remover full L2 directory rebuild implícito; `auto` converge apenas selected paths com workspace root canônico;
- [x] refresh paralelo bounded para changed paths e no-op O(1) sem delta;
- [x] stats de bytes/memory (`symbolBytes`) e ownership/eviction bounded na superfície MCP.

### 30.5.2 MCP compact surface

- [x] investigar binding com MCP stateful session; o handler atual não recebe transport context estável como authority;
- [x] expor uma única `repo_working_set` composta;
- [x] `open|context|find|refresh|status|close`, com `open` retornando contexto imediatamente;
- [x] scopeId opaco UUID + registry MCP-local, isolado dos scopes LLM-B;
- [x] benchmark integration-level de open/context/find/refresh e payload;
- [x] anunciar por default após ganho real, mantendo apenas +1 tool no registry.

Pendente apenas um A/B diretamente invocado pelo ChatGPT host após a próxima reconexão do connector, porque o binding desta conversa não hot-injeta novas funções adicionadas durante a própria sessão apesar de `tools/list` remoto já anunciar a tool.

## Fase 30.6 — P1: Compile Cache V2

- [x] tornar herança explícita em validator/job children via `withCopilotNodeCompileCacheEnv`;
- [x] ativar cedo no terminal/LLM-B com launcher mínimo + dynamic import do runtime pesado;
- [x] avaliar `flushCompileCache()` depois do boot/warm graph;
- [x] medir cold/warm process startup e parent→child pre-exit;
- [x] expor health compacto sem revelar diretório real.

## Fase 30.7 — P2: Native Glob Experiment

- [ ] matriz de equivalência `minimatch` vs `path.matchesGlob` para todos os contratos atuais;
- [ ] benchmark matcher puro;
- [ ] benchmark candidate enumeration `readdir` vs `fs.promises.glob` vs `rg --files`;
- [ ] não trocar scanner rico sem prova de semântica e ganho;
- [ ] se native matcher cobrir tudo, remover runtime dependency de minimatch desta camada.

## Fase 30.8 — P2: Dependency Hygiene

- [ ] confirmar `xxhash-wasm` sem consumer de produção;
- [ ] remover somente com package/package-lock governados e gates completos;
- [ ] mover qualquer dependency importada em runtime para `dependencies` apropriadas;
- [ ] revisar custo/supply-chain sem confundir install-size com hot-path latency.

## Fase 30.9 — P2: Journal/checkpoint high-watermark

- [ ] retomar sequence persistida no checkpoint;
- [ ] detectar gaps explicitamente;
- [ ] combinar Git + journal + fingerprint;
- [ ] reduzir safety work sem tornar journal autoridade única.

## Fase 30.10 — Gates da Faixa 30

A cada sublote:

1. teste causal focado;
2. strict typecheck;
3. lint antes de publish;
4. reload apenas quando runtime source exigir;
5. um `mcp_connector_smoke_refresh` pós-reload;
6. benchmark live antes/depois quando houver claim de performance;
7. stage/publish apenas de paths explícitos;
8. `.vscode/settings.json` e untracked antigos continuam fora.

Ordem inicial autorizada por evidência:

> **30.1 duplicate-realpath → 30.2 crypto.hash → 30.3 capabilities compact → 30.4 pinned/watch → 30.5 Working Set V2 → demais fases evidence-gated.**

Refinamento posterior necessário para preservar liberdade de indexação explícita:

- um `repo_index_build` manual em outro scope **não** passa a redefinir o domínio canônico do scheduler;
- somente o lifecycle de auto-build/full reconcile adota `adoptAutoRefreshDomain=true`;
- o startup incremental configura o domínio explicitamente via `scopeRoot`;
- `reconcileIoIndexAutoRefreshDomain()` lista as rows persistidas e considera para cleanup apenas `metadata.refreshMode='explicit-path'`;
- rows produzidas por `directory-scan`/builds manuais fora do scope são preservadas;
- a reconciliação é executada depois de startup incremental e full auto-build, e o resultado entra no próprio `indexAutoBuild.result`.

Prova unitária adicional constrói uma canonical domain, executa depois um build manual fora dela e confirma que o scheduler continua aceitando apenas o path canônico. Outra regressão oferece cinco rows persistidas — quatro `explicit-path` e uma manual — e exige exatamente **3 prunes**, preservando a row manual.

Prova live após o reload final:

- startup `full-reconcile`: **1.445 candidates / 1.445 unchanged**, 0 hashes, 0 second-stats, ~**601 ms**;
- domain reconciliation: **2.242 rows inspecionadas**, **30 explicit-refresh rows**, **10 podadas**;
- o índice global ficou em **2.232 rows** porque outras slices produzidas por builds explícitos legítimos foram deliberadamente preservadas;
- um arquivo temporário `src/copilot/.ai/jobs/domain-filter-live-20260818.txt` com token único foi criado normalmente e encontrado pelo `repo_search_text` canônico via **rg (1 match)**;
- `repo_index_search` para o mesmo token retornou **0 matches**;
- auto-refresh reportou `domainSkipped=1`, `queued=0`, `requested=0`, provando que o hidden write jamais entrou na fila derivada;
- o arquivo temporário foi removido imediatamente após a prova.

O cleanup histórico, portanto, é deliberadamente seletivo: corrige a contaminação causada pelo scheduler antigo sem transformar o domínio canônico numa proibição de indexes ad hoc.

---

# 31. Execução da Faixa 30.A — Node 24 fast paths, Context Plane e External Coherence

## 31.1 Scan Identity Chaining

A investigação do scanner mostrou uma duplicação estrutural que só ficou dominante depois do Safety Reconcile V2: cada arquivo podia pagar um `realpath` na policy assíncrona e outro em `buildFileFingerprint()`.

Implementação:

- `evaluateIoPathPolicyAsync()` continua sendo a autoridade para containment/symlink safety;
- o `policy.realPath` aprovado é encadeado para o fingerprint;
- `buildFileFingerprint()` aceita `canonicalPath`, mas mantém o `realpath` independente quando essa evidence não existe;
- `scanDirectory()` reporta `fingerprintRealpathReuses` e `fingerprintRealpathComputations`.

Prova unitária: scanner green e fallback independente preservado.

Prova live, mesmo scope `src/copilot`, **1.445 candidates / 1.445 unchanged / 0 hashes / 0 second-stats**:

- geração anterior: ~496–651 ms;
- após identity chaining: **275 ms**;
- redução observada: ~44,6% contra 496 ms e ~57,8% contra 651 ms.

O ganho não veio de relaxar policy; veio de pagar a mesma identidade canônica apenas uma vez.

## 31.2 Hash Plane Node 24

O helper SHA-256 one-shot compartilhado migrou de `createHash().update().digest()` para `node:crypto.hash('sha256', payload, 'hex')` no runtime Node 24.15.

Regressões cobrem:

- vetores conhecidos vazio/`abc`;
- string ASCII e Unicode;
- `Buffer` e `Uint8Array`;
- payload de 1 MiB;
- equivalência bit-a-bit com a implementação legada.

Nenhum contrato de precondition/cache/rollback mudou. Benchmark multi-size permanece pendente antes de qualquer claim percentual de CPU.

## 31.3 Capabilities Context Plane V2

`mcp_capabilities_summary` deixou de retornar por default nomes das 119 tools duas vezes e toda a guidance operacional.

Novo default:

- versions;
- `advertisedToolCount` + `groupCounts`;
- security/auth summary;
- deprecated/experimental counts;
- oito regras operacionais essenciais;
- `detailsAvailable=true`.

`includeDetails=true` preserva o manifest completo e toda `IO_GUIDANCE`; delegation runner passa a consumir o summary compacto por default.

Prova live:

- antes: ~**32.799 bytes** por retorno default;
- depois: **3.713 bytes**;
- redução: **~88,7%**;
- handler permanece ~0–2 ms;
- `CAPABILITIES_VERSION=51`;
- `tools/list`: ~119.654 → **119.810 bytes** (+156 bytes), mantendo 119/119 tools.

Logo, a mudança troca ~156 bytes persistentes de schema por ~29 KiB economizados a cada chamada do summary default.

## 31.4 Recursive Watch Node 24 em pinned files

O `PinnedFilesLoader` continha um pressuposto obsoleto: Linux era forçado para watchers não recursivos + fan-out de subdiretórios de primeiro nível.

No Node 24/Linux atual:

- tenta-se `fs.watch(root, { recursive:true, persistent:false })` primeiro;
- fallback bounded só é criado quando a própria chamada recursiva falha;
- erro posterior do watcher continua best-effort e não derruba o boot;
- regressão real de arquivo nested prova add/change hot reload.

## 31.5 External Coherence Plane

Foi introduzido `io/invalidation/external-watch.js` como **acelerador best-effort**, nunca como authority:

- root MCP: `src/copilot`;
- recursive `fs.watch`, `persistent:false`;
- hidden/denylist filtrados antes da fila;
- pending bounded, batch bounded, high-water e error/drop counters;
- hints entram no mesmo invalidation bus já consumido por L1/parser/scope/index;
- journal cross-process e rich fingerprint continuam responsáveis por correctness quando watcher não entrega evento.

A primeira versão (75 ms debounce) revelou um efeito live útil: um único create canônico gerou **2 auto-refresh batches / 2 requests**, porque o mesmo write era visto pelo invalidation normal e pelo watcher.

A arquitetura foi então refinada:

1. o bus mantém uma janela bounded das invalidações recém-despachadas, apenas como hint de deduplicação;
2. o watcher preserva o timestamp do evento de filesystem;
3. se uma invalidation canônica posterior já cobre exatamente aquele evento, o watcher incrementa `canonicalSuppressed` e não republíca;
4. evento externo realmente posterior continua elegível;
5. debounce default do watcher passou a **125 ms**, que com o debounce de 50 ms do bus ainda mantém o alvo externo nominal abaixo de 250 ms.

Prova live final com create+delete do mesmo probe temporário:

- após create: auto-refresh **1 batch / 1 request / 1 indexed**, `canonicalSuppressed=1`, watcher `invalidated=0`;
- após delete: totais **2 batches / 2 requests**, `canonicalSuppressed=2`, exatamente uma convergência por mutação;
- watcher permaneceu `enabled=true`, `watching=true`, **0 errors / 0 drops**;
- dezenas de eventos de `.ai/jobs`/startup foram filtrados e não chegaram ao coherence plane útil;
- probe removido ao fim.

A propriedade central fica explícita: **watcher reduz a janela de descoberta de writes externos sem cobrar um segundo ciclo derivado dos writes que o próprio Copilot já conhece.**

## 31.6 Gates 30.A

Gates executados durante o sublote:

- scanner unit: green;
- hash identity unit: green;
- MCP tools/meta: green;
- MCP registry: green;
- pinned-files watcher: green;
- external watcher: green;
- invalidation bus: green;
- runtime metrics: green;
- strict typecheck repetido após cada fronteira e green no estado mais recente;
- reloads controlados com connector smoke 119/119, OAuth/SSE green.

Próxima faixa operacional: **30.5 Working Set / Scope V2**, começando pela correção da infra compartilhada antes de anunciar qualquer nova tool MCP.

---

# 32. Execução da Faixa 30.B — Working Set / Scope V2

## 32.1 Diagnóstico do Scope V1

A investigação da implementação que já atendia a LLM-B confirmou que `workspace_scope_*` era uma capacidade real de working set, mas não estava pronta para ser copiada ao MCP. Os problemas encontrados foram:

1. `maxFiles` era descrito como advisory, porém `warmFromDirectory()` aplicava `slice(0, maxFiles)` e portanto já era um hard cap de seleção;
2. `indexMode='auto'` fazia `buildIoIndexForDirectory(directory)` depois de scan+prefetch+parse, pagando trabalho O(diretório) e podendo reescrever `workspace_root/relative_path` das mesmas rows com o subdiretório como nova raiz;
3. prefetch aquecia o L1, mas o parser não recebia o snapshot já lido;
4. o índice podia reler/reparsear o mesmo conteúdo que o pipeline acabara de produzir;
5. `refreshScope()` sem delta conhecido reparseava o escopo inteiro;
6. refresh invalidava caches antes de reconstruir e processava paths sequencialmente;
7. contexto de scope trazia contagens/topExports, mas não um manifest útil para reduzir reads/searches posteriores;
8. expor as sete tools LLM-B diretamente aumentaria demais `tools/list` e a decisão do modelo.

## 32.2 Pipeline encadeado — prefetch → parser → índice

O working set agora compõe evidência em vez de reconstruí-la:

- `warmTextSnapshotsForPaths()` aquece somente o L1 textual e retorna `TextFileSnapshot` efêmero;
- se o texto já está em L1 e foi revalidado, o snapshot é reconstruído a partir da própria entrada sem copiar o conteúdo;
- working sets usam `cacheBytes=false`, evitando primar uma segunda representação bytes desnecessária;
- `parseAndCacheSymbols()` recebe `snapshot` fornecido;
- `refreshIoIndexPaths()` aceita `snapshots` e `parsedSymbols`;
- snapshot fornecido só é aceito se sua rich fingerprint ainda coincidir exatamente com o `stat` atual;
- se divergir, o índice faz fallback para a leitura canônica normal;
- `indexTextFile()` aceita símbolos já parseados como opção interna, eliminando parse duplicado.

Counters causais adicionados ao refresh do índice:

- `snapshotReuses`;
- `parsedSymbolReuses`.

Regressão dedicada exige `snapshotReuses=1`, `parsedSymbolReuses=1`, zero `readTextFileSnapshot` e entrega dos símbolos fornecidos ao index writer.

## 32.3 Scope lifecycle V2

Mudanças de contrato:

- `workspaceRoot` canônico explícito;
- `maxFiles` = hard selected-file limit em directory scope;
- stats separados: `candidateFiles`, `selectedFiles`, `hardLimitReached`;
- `symbolBytes` estima memória do estado simbólico por scope;
- `indexMode='auto'` nunca mais faz full directory build implícito: executa apenas selected-path refresh no índice global;
- refresh é bounded/concurrent por `p-limit`;
- sem `modifiedPaths` e sem invalidations pendentes, refresh é **O(1) no-op**;
- path explícito fora do working set é `skipped`, não expande silenciosamente o escopo;
- arquivo pertencente ao escopo que desaparece durante refresh mantém o scope `degraded`;
- invalidation continua removendo somente estado derivado do scope; o L1 global não é desmontado no close.

## 32.4 Contexto bounded de verdade

`getScopeContext()` agora produz um manifest por arquivo sem conteúdo integral:

- path relativo ao workspace;
- symbol count;
- exports bounded;
- imports bounded;
- flag `stale`;
- top exports gerais;
- contagens de seleção/invalidation/memória.

Budgets:

- `maxFiles` default 40, hard max 200;
- `maxBytes` default 16 KiB, hard max 64 KiB;
- o budget cobre o **JSON completo** retornado, não apenas a soma das entries do manifest;
- manifest/topExports são reduzidos até o payload total caber no budget.

## 32.5 Superfície MCP compacta

Em vez de sete tools, foi adicionada apenas:

> `repo_working_set`

Ações:

- `open` — cria working set e já devolve `stats + context` no mesmo round-trip;
- `context` — reemite decision surface bounded;
- `find` — symbol lookup no índice process-local do scope;
- `refresh` — somente delta explícito/conhecido;
- `status`;
- `close`.

Segurança/ownership:

- ID sempre gerado pelo servidor como `mcp-ws-<UUID>`;
- registry MCP-local aceita somente IDs criados por essa própria tool;
- ID forjado é rejeitado antes de chegar à engine compartilhada;
- máximo de **8 working sets MCP-owned**; ao atingir o limite, somente o working set MCP-owned menos recente é elegível a eviction;
- scopes internos da LLM-B não são endereçáveis por IDs inventados no MCP;
- annotation correta: `readOnlyHint=true`, `idempotentHint=false`, porque o repositório não é modificado, mas open/close alteram estado derivado em memória.

## 32.6 Evidência integration-level real

Teste executado sobre o diretório real `src/copilot/mcp/tools`, com parser/cache/filesystem reais e `indexMode=off` para isolar o working-set plane:

- candidates: **48**;
- selected: **48**;
- parsed: **48**;
- preloaded: **48**;
- parser `suppliedSnapshots`: **48**;
- parser `snapshotReads`: **0**;
- `symbolBytes`: ~**138,8 KiB**;
- open em duas execuções representativas: **359,502–391,382 ms**;
- context: **1,108–1,166 ms**;
- contexto total: **11.725 bytes** em ambas;
- manifest: **40 files**;
- `findSymbol('repoWorkingSetTool')`: **0,266–0,286 ms**, 1 match;
- refresh sem delta: **0,115–0,146 ms**, `{refreshed:0, failed:0, skipped:0}`.

A evidência comprova o objetivo do scope: o custo maior é pago uma vez na abertura; operações posteriores de contexto/símbolo/delta tornam-se process-local e submilissegundo/low-ms sem nova busca global.

## 32.7 Custo de superfície e runtime remoto

Após reload v52:

- connector smoke: green, OAuth/SSE green;
- tools: **120/120**;
- `tools/list`: **121.987 bytes**;
- baseline v51: 119.810 bytes;
- custo incremental de uma única working-set tool: **+2.177 bytes (~1,8%)**;
- `CAPABILITIES_VERSION=52`;
- capabilities manifest remoto confirma `repo_working_set` no grupo read.

O binding de tools desta conversa não hot-injetou a nova função adicionada durante a própria sessão, embora o servidor remoto a anuncie corretamente. Por isso a prova operacional nesta rodada foi integration-level sobre a mesma engine real; uma invocação direta pelo ChatGPT host poderá ser feita após reconexão, sem mudança adicional de código.

## 32.8 Conclusão sobre scopes

A resposta arquitetural é **sim: scopes/working sets são úteis para o MCP**, mas não na forma original de sete tools da LLM-B.

Eles são especialmente úteis quando:

- a investigação é concentrada numa subárvore por vários turnos;
- contexto/imports/símbolos serão consultados repetidamente;
- queremos reduzir `search → read → outline → read` repetidos;
- mudanças posteriores são poucas e podem ser atualizadas em O(delta).

Não substituem:

- `repo_search_text` como superfície completeness-oriented global;
- full index navigation quando a pergunta atravessa o repositório inteiro;
- rich fingerprint/journal para correctness de freshness.

O estado-alvo é complementar: **search global para descoberta; working set para foco persistente e barato depois que a área de trabalho foi escolhida.**

---

# 33. Execução da Faixa 30.C — Compile Cache V2 / Node 24 process plane

## 33.1 Problema real encontrado

O MCP já ativava `enableCompileCache()`, mas a cobertura tinha duas lacunas arquiteturais:

1. o helper vivia em `mcp/runtime`, embora compile cache seja uma primitive de processo Node compartilhável por MCP, terminal/LLM-B e filhos;
2. `terminal/bootstrap.js` carregava todo o grafo pesado por imports estáticos **antes** de qualquer oportunidade de ativar o cache;
3. `mcp/cli.js` também importava `logMcp`/control-plane estaticamente antes do `enableCompileCache()`;
4. validator jobs copiavam `process.env` e portanto herdavam cache apenas por efeito colateral da ordem do bootstrap MCP.

Em ESM, ligar compile cache no corpo do módulo não retroage sobre dependencies estáticas já avaliadas. Portanto a correção precisava acontecer no **launcher**, não em uma linha tardia do runtime.

## 33.2 Fundação compartilhada

Criada `infra/runtime/node-compile-cache.js`, exposta por facade mínima `infra/public/node-runtime.js`.

Responsabilidades:

- `enableCopilotNodeCompileCache()`;
- `withCopilotNodeCompileCacheEnv()`;
- `flushCopilotNodeCompileCache()`;
- `getCopilotNodeCompileCacheHealth()`;
- estado de enable/flush apenas para observabilidade;
- failures permanecem não-fatais: compile cache é otimização, nunca requisito de correctness.

O caminho histórico `mcp/runtime/node-compile-cache.js` virou re-export de compatibilidade para não quebrar safe-suite/importers existentes.

## 33.3 Terminal/LLM-B — bootstrap realmente precoce

O antigo corpo de `terminal/bootstrap.js` foi movido para `terminal/bootstrap-runtime.js`.

Novo launcher mínimo:

1. importa somente a facade mínima de Node runtime;
2. carrega `bootstrap-dotenv.js` dinamicamente;
3. executa `enableCopilotNodeCompileCache()`;
4. importa `bootstrap-runtime.js` dinamicamente;
5. executa `flushCopilotNodeCompileCache()` após o grafo pesado ter sido compilado.

Isso preserva `.env` antes da configuração do cache e coloca SDK/model gateway/tools/observability/runtime-bootstrap sob compile cache desde sua primeira importação relevante.

## 33.4 MCP CLI — ordem ESM corrigida

`mcp/cli.js` agora:

- importa apenas a foundation de compile cache antes do enable;
- remove import estático de `logMcp`;
- carrega control-plane logger lazily depois do enable;
- continua carregando adapters dinamicamente;
- flush após adapter/server warm-up em HTTP;
- flush após carregar adapters e antes do loop longo de stdio.

Consequência adicional: importar `parseTransport` em teste não precisa mais carregar o control-plane inteiro antes de o cache ser configurado.

## 33.5 Herança explícita em validator jobs

`spawnValidatorJob()` passou de:

`env: { ...process.env, NO_COLOR: '' }`

para:

`env: withCopilotNodeCompileCacheEnv({ ...process.env, NO_COLOR: '' })`.

Logo, a propagação não depende mais de o caller ter sido iniciado pelo MCP CLI. O safe validation runner mantém o re-export histórico e continua compatível.

## 33.6 Benchmark cold/warm representativo

Grafo medido em subprocessos Node 24 isolados:

- `terminal/index.js`;
- `boot/runtime-bootstrap.js`.

Primeira rodada:

- compile cache disabled wall median: **1.182,168 ms**;
- warm wall median: **1.040,149 ms**;
- ganho wall: **12,01%**;
- disabled import median: **1.097,124 ms**;
- warm import median: **957,871 ms**;
- ganho imports: **12,69%**;
- primeira população: ~**1.648 ms wall**, mais lenta como esperado.

Repetição durante o A/B de flush:

- disabled wall median: **1.151,035 ms**;
- warm wall median: **920,489 ms**;
- ganho wall: **20,03%**;
- disabled import median: **1.065,339 ms**;
- warm import median: **860,487 ms**;
- ganho imports: **19,23%**.

Interpretação: cold population paga overhead; o benefício aparece em reloads/restarts recorrentes, exatamente o perfil operacional do MCP/terminal.

## 33.7 Benchmark `flushCompileCache()` parent→child

Cenário específico recomendado pela API do Node: pai aquece o grafo, lança filho **antes de encerrar** e ambos compartilham o mesmo compile-cache dir.

- sem flush, child import median: **1.363,399 ms**;
- com flush antes do spawn, child import median: **913,781 ms**;
- ganho: **32,98%**.

Isso justifica flush explícito depois do warm graph. A API oficial existe precisamente porque, sem flush, o code cache acumulado no processo tende a ser persistido apenas no exit e ainda não está disponível ao filho pré-exit.

## 33.8 Observabilidade

`mcp_runtime_health` passa a expor somente:

- `nodeVersion`;
- compile cache enabled/statusName;
- portable;
- `directoryKnown` boolean;
- último flush: success/duration/error.

O diretório real não é devolvido no default, evitando payload/path leakage desnecessário.

## 33.9 Política final

- compile cache **default on**;
- explicit disable permanece possível por `COPILOT_NODE_COMPILE_CACHE_DISABLED`;
- portable segue preferido e possui fallback;
- failures de enable/flush nunca tornam o runtime incorreto;
- flush só é feito depois que um grafo relevante foi carregado;
- não adicionar package externo para module caching: Node 24 já fornece a primitive adequada;
- benchmark pesado usado para a decisão não permanece na suíte unitária normal, evitando acrescentar ~20 s a validações futuras.

## 33.10 Prova live após reload

MCP real após ativação:

- Node: **v24.15.0**;
- compile cache: `enabled=true`;
- status: `ALREADY_ENABLED`;
- `portable=true`;
- `directoryKnown=true` sem expor path;
- último flush: **success**, ~**39,458 ms**;
- connector smoke: green;
- tools: **120/120**;
- `tools/list`: **121.987 bytes**.

O launcher LLM-B também foi exercitado pelo harness real em modo `control-only`, sem abrir turno/modelo/provider:

- run: `terminal-live:2026-08-18T03-39-56-369Z:control_only`;
- status: **passed**;
- duração: **29.814 ms**;
- exit code: **0**;
- critérios: **27/27 green**;
- terminal atingiu `ready`, REPL/TTY funcional, SSE conectado, zero terminal errors e clean `/quit`.

Portanto a refatoração de bootstrap não é apenas tipada/testada: o terminal permanente inicia corretamente pelo novo launcher mínimo em cenário operacional real.

---

# 34. Faixa 30.D — MCP Apps / Widget submission readiness e correção do blocker de domínio — 2026-08-18

## 34.1 Evidência externa que abriu a faixa

A tela de informações do plugin no ChatGPT passou a reportar, para `ui://copilot/company-knowledge.html`:

> `Domínio de widget não definido para este modelo. É necessário um domínio exclusivo para submeter o aplicativo.`

A documentação oficial atual da OpenAI confirma que plugins com UI precisam declarar um origin dedicado em `_meta.ui.domain`; o origin deve ser HTTPS e único por plugin. O alias ChatGPT `_meta["openai/widgetDomain"]` permanece suportado.

O diagnóstico interno `mcp_apps_sdk_readiness` não detectava esse blocker: ele verificava resource/MIME/CSP/widgetDescription/search+fetch, mas não procurava domínio. Isso é uma lacuna da própria observabilidade e será corrigido junto com o resource.

## 34.2 Auditoria do estado atual

`src/copilot/mcp/tools/apps-sdk-resources.js` já possui:

- `text/html;profile=mcp-app`;
- `_meta.ui.prefersBorder`;
- `_meta.ui.csp`;
- aliases `openai/widgetDescription`, `openai/widgetPrefersBorder` e `openai/widgetCSP`.

Lacunas encontradas:

1. não existe `_meta.ui.domain`;
2. não existe `_meta["openai/widgetDomain"]`;
3. `_meta.ui.csp` contém `redirectDomains`, embora o schema padrão documentado aceite somente `connectDomains`, `resourceDomains` e `frameDomains`; redirects continuam no alias legado `openai/widgetCSP.redirect_domains`;
4. `search` e `fetch` associam a UI somente por `_meta["openai/outputTemplate"]`, sem `_meta.ui.resourceUri`;
5. o HTML afirma que renderiza os resultados, mas é estático e não consome `ui/notifications/tool-result`;
6. `mcp_apps_sdk_readiness` produz um falso-green para submission readiness porque não verifica domínio nem standard resource linkage.

## 34.3 Estado-alvo do resource

- `COPILOT_MCP_WIDGET_DOMAIN` passa a ser override explícito;
- fallback do deployment atual: origin dedicado já existente `https://mcp.aurelin.org`;
- normalização estrita: HTTPS origin, sem path/query/hash/userinfo;
- resource publica simultaneamente:
  - `_meta.ui.domain`;
  - `_meta["openai/widgetDomain"]`;
  - `_meta.ui.csp` standard;
  - `_meta["openai/widgetCSP"]` compatibility;
- standard CSP não carrega redirects; `redirect_domains` permanece apenas na compatibilidade ChatGPT quando necessário;
- nenhuma dependência frontend ou package novo será adicionada nesta etapa: o widget é pequeno e pode usar JS/DOM/bridge nativos;
- `@modelcontextprotocol/ext-apps/server` foi considerado, mas não é necessário para corrigir a submissão: `McpServer.registerResource` + MIME correto já satisfaz o contrato atual e evita adicionar dependency sem ganho mensurável.

## 34.4 Estado-alvo das tools e UI

- `search/fetch` passam a anunciar `_meta.ui.resourceUri` e mantêm `openai/outputTemplate` como alias;
- o widget escuta o bridge MCP Apps `ui/notifications/tool-result` via `postMessage` e renderiza `structuredContent` de search/fetch;
- conteúdo recebido é tratado como untrusted: DOM criado por `textContent`, sem `innerHTML` dinâmico;
- links externos, se renderizados, são limitados a URLs HTTPS recebidas do corpus e abrem por link normal; nenhum token/secret entra no DOM;
- a tool continua útil sem iframe, preservando Company Knowledge data-first semantics.

## 34.5 Readiness V2

`mcp_apps_sdk_readiness` passará a reportar explicitamente:

- `hasWidgetDomain`;
- `hasStandardResourceUri`;
- `submissionReady` para a parte de UI metadata;
- markers de `_meta.ui.domain`, `openai/widgetDomain`, `ui.resourceUri` e legacy output template;
- ação de correção quando UI existe sem domínio.

Critério: a readiness interna não pode voltar a dar green quando o portal ChatGPT ainda detectaria ausência de widget domain.

## 34.6 Gates

- regressão unitária do resource exigindo domain standard + alias idênticos;
- regressão de CSP exigindo ausência de `redirectDomains` no standard e manutenção de `redirect_domains` somente no legacy quando configurado;
- regressão de search/fetch exigindo `_meta.ui.resourceUri` + alias;
- regressão do HTML exigindo bridge `ui/notifications/tool-result` e render seguro;
- regressão do readiness exigindo `hasWidgetDomain=true`, `hasStandardResourceUri=true`, `submissionReady=true`;
- strict typecheck + lint;
- reload controlado;
- connector smoke 120/120 ou novo count esperado caso nenhuma tool seja adicionada;
- `mcp_apps_sdk_readiness` live deve ficar green;
- leitura live do resource deve confirmar metadata enviada pelo servidor, não apenas o source.

A Faixa 30.7 (native glob) e a Faixa 30.9 (journal/checkpoint high-watermark) permanecem abertas e serão retomadas imediatamente após esse blocker de submissão ser removido.

## 34.7 Execução e prova live

Implementado:

- resource URI versionado para `ui://copilot/company-knowledge/v2.html` para evitar reuse de cache do HTML antigo;
- `_meta.ui.domain` + `_meta["openai/widgetDomain"]` com o mesmo origin;
- override `COPILOT_MCP_WIDGET_DOMAIN` validado como origin HTTPS puro;
- fallback derivado do public MCP URL e, no deployment atual, `https://mcp.aurelin.org`;
- standard `_meta.ui.csp` contém apenas `connectDomains/resourceDomains/frameDomains`;
- `redirect_domains` permanece apenas no alias legado `openai/widgetCSP`;
- `search/fetch` publicam `_meta.ui.resourceUri` e preservam `openai/outputTemplate`;
- widget passou de HTML estático a renderer bridge-first de `ui/notifications/tool-result`, sem dependency frontend nova;
- dados dinâmicos entram no DOM via `textContent`; `innerHTML` dinâmico não é usado; links são aceitos somente se HTTPS;
- `mcp_apps_sdk_readiness` passou de scanner marker-only para inspeção semântica do resource/tool descriptor real.

Gates focados:

- Company Knowledge/resource metadata: green;
- MCP tools/readiness: green;
- protocol-level resource test com `Client + InMemoryTransport + createCopilotMcpServer`: green;
- strict typecheck: green.

Prova protocol-level:

- `resources/list` anunciou o resource v2 com MIME `text/html;profile=mcp-app`;
- `resources/read` devolveu o mesmo URI/HTML;
- descriptor e content carregam `ui.domain` HTTPS e `openai/widgetDomain` idêntico;
- o HTML servido contém o handler `ui/notifications/tool-result`.

Prova live após reload:

- connector smoke: green;
- OAuth/health/SSE: green;
- tools: **120/120**;
- `tools/list`: **122.117 bytes**, contra 121.987 antes — somente **+130 bytes** pela linkage standard `ui.resourceUri`;
- `mcp_apps_sdk_readiness` live:
  - `hasWidgetDomain=true`;
  - `widgetDomain=https://mcp.aurelin.org`;
  - `widgetDomainAliasesMatch=true`;
  - `hasStandardResourceUri=true`;
  - `hasLegacyOutputTemplate=true`;
  - `submissionReady=true`.

Durante o restart houve um único 502 transitório ao consultar status enquanto a origem estava sendo substituída; o estado persistido terminou `completed`/exit 0 e o smoke canônico pós-reload ficou integralmente green.

Conclusão: o blocker mostrado pelo portal ChatGPT foi removido no servidor. O portal ainda pode exibir o snapshot antigo até executar novo **Scan Tools/reconnect/rescan**; isso é refresh de metadata do host, não mudança adicional necessária no MCP.

---

# 35. Faixa 30.7 — Native Glob Experiment — concluída sem migração — 2026-08-18

## 35.1 Hipótese

O runtime Node **v24.15.0** já possui `path.matchesGlob()` estável e `fs.promises.glob()` estável. A hipótese era reduzir dependência/runtime overhead de `minimatch` e/ou tornar candidate enumeration mais barata usando primitives nativas.

A comparação foi feita sem alterar produção, preservando o contrato atual:

- dotfiles habilitados (`dot:true`);
- `!` e `#` literais (`nonegate/nocomment`);
- globstar/braces/extglob/classes;
- Windows separator normalization;
- matchBase para padrões sem `/`;
- plain path/segment subtree (`src/copilot`, `node_modules`) como compatibilidade histórica.

## 35.2 Matcher — resultado

Uma adaptação `path.matchesGlob + matchesPlainPathPattern + basename fallback` preservou 9/11 casos do corpus de contrato, mas divergiu em exatamente os dois casos de dotfiles:

- `src/copilot/.hidden.ts` vs `src/**/*.ts`;
- `.hidden.ts` vs `*.ts`.

O contrato atual retorna `true`; `path.matchesGlob()` retorna `false` nesses casos e não oferece option equivalente a `dot:true` nessa API.

Performance sobre arquivos reais de `src/copilot`, 200 iterações do workload de padrões:

- execução A: `minimatch` **55,524 ms**, native candidate **55,776 ms** (**-0,45%** para o nativo);
- execução B: `minimatch` **57,431 ms**, native candidate **56,291 ms** (**+1,98%** para o nativo).

Conclusão: diferença dentro de ruído; não existe ganho de throughput que justifique uma dual-path dotfile fallback nem troca de semântica.

## 35.3 Candidate enumeration — resultado

Mesmo conjunto visível de **1.470 arquivos** em `src/copilot`:

- recursive `readdir`: **25,342 ms**;
- `fs.promises.glob`: **49,075 ms**;
- `rg --files --no-ignore`: **14,058 ms**.

`fs.promises.glob` ficou ~**1,94x** mais lento que o traversal atual no workload representativo. `rg` foi ~11 ms mais rápido e, com `--no-ignore`, cobriu os mesmos 1.470 arquivos, mas a economia potencial é pequena frente ao full reconcile atual (~275–310 ms) e introduziria subprocess semantics, depth/ignore translation e uma segunda implementação de traversal na fundação.

Um detalhe de API também foi confirmado empiricamente: em Node 24.15, `exclude` com `withFileTypes:true` recebe um `Dirent`, não string; o benchmark inicialmente assumia string e falhou antes de ser corrigido.

## 35.4 Decisão

- **não migrar** o matcher canônico para `path.matchesGlob()`;
- **não migrar** o scanner rico para `fs.promises.glob()`;
- **não introduzir** `rg --files` no rich scanner por ~11 ms de ganho de enumeração;
- manter `minimatch-v10` como engine única da policy glob enquanto o contrato exigir dot/matchBase/plain-path;
- continuar usando APIs Node nativas quando elas vencem por evidência (`crypto.hash`, recursive watch, compile cache), não por preferência estética.

`minimatch` possui hoje um único import direto em produção (`infra/scan/glob.js`), mas esse import sustenta `matchesGlobPattern` e `simpleGlobToRegExp`; removê-lo agora exigiria reimplementar semântica sem ganho mensurável.

O benchmark temporário não permanece na suíte normal.

## 35.5 Dependency hygiene derivada

A busca de produção também confirmou novamente que `xxhash-wasm` permanece declarado em `package.json`, mas **não possui consumer em `src/copilot`**. A Fase 30.8 pode removê-lo de forma governada quando package/package-lock forem tratados como um sublote próprio; isso é hygiene/supply-chain, não hot-path performance.

---

# 36. Faixa 30.9 — Journal/checkpoint high-watermark V2 — implementação pré-live — 2026-08-18

## 36.1 Problema de recuperação identificado

O journal cross-process atual possui sequence monotônica, gap detection e retenção bounded, mas cada runtime inicializa seu cursor contínuo em `MAX(sequence)` no momento do boot. Isso é correto para propagação **daquele ponto em diante**, porém significa que um restart não usa rows persistidas anteriores ao novo processo para complementar o checkpoint do índice.

O checkpoint do startup, por sua vez, conhecia apenas `HEAD/schema/timestamps`. Git cobre tracked/dirty/untracked, e full reconcile periódico cobre o safety net de filesystem, mas faltava um high-watermark que dissesse até qual journal sequence já havia sido reconciliada pelo último startup bem-sucedido.

## 36.2 Princípio de segurança

O journal continua **não sendo autoridade única de freshness**. O novo fluxo combina:

> `checkpoint journal watermark + bounded journal replay + Git status/diff + rich filesystem fingerprint/full reconcile`.

Regras:

- runtime consumer contínuo permanece inalterado e continua iniciando no latest;
- startup replay usa uma API separada e nunca move o cursor do consumer;
- o watermark é capturado **antes** do Git snapshot/reconcile;
- checkpoint só persiste esse watermark depois de skip/incremental/full bem-sucedido;
- nunca se grava “latest depois do scan”, evitando marcar uma mutação concorrente como coberta sem evidência;
- journal vazio nunca suprime Git status/diff ou o full reconcile periódico.

## 36.3 Replay SQLite bounded e transacional

Nova primitive `readCrossProcessInvalidationReplay()`:

- lê em uma transaction o intervalo `sequence > checkpoint && sequence <= highWatermark`;
- default max rows **2.048** no startup, configurável por `COPILOT_MCP_INDEX_JOURNAL_REPLAY_MAX_ROWS` (64–10.000);
- retorna somente evidence bounded: rows, contagem, earliest/high-watermark, gap/truncation/error;
- não altera `lastSeenSequence` do journal runtime;
- `sqlite_sequence` é combinado com `MAX(sequence)` para preservar o high-watermark emitido mesmo quando retention cleanup remove todas as rows antigas.

Essa última regra evita um falso gap importante: tabela vazia depois de cleanup, mas checkpoint exatamente no último sequence emitido, é estado válido e não exige full reconcile.

## 36.4 Fail-closed conditions

Startup força full reconcile quando:

- replay indisponível;
- sequence gap detectado;
- checkpoint sequence maior que o high-watermark realmente emitido (reset/rollback de DB);
- replay excede maxRows/truncation;
- row contém path inválido/não absoluto;
- uma invalidation recursiva ou da raiz do scope aparece dentro do domínio.

Rows fora do scope são apenas contadas e ignoradas. Rows de arquivo válidas dentro do scope são deduplicadas com paths derivados de Git e alimentam a mesma `refreshIoIndexPaths()`.

## 36.5 Classificação de paths sem confused authority

`classifyIndexJournalReplayRows()` é uma função pura:

- exige paths absolutos;
- faz containment lexical contra o scope já resolvido pelo startup;
- deduplica paths in-scope;
- separa `outsideScopeRows` e `invalidPathRows`;
- recursive/root invalidation não é convertida artificialmente em refresh de arquivo; ela exige full reconcile.

O journal, portanto, continua sendo **hint/evidence**, não substituto da path policy nem autorização para acessar filesystem arbitrário.

## 36.6 Checkpoint backward-compatible

A tabela `copilot_mcp_index_startup_checkpoint` ganhou:

`journal_sequence INTEGER NOT NULL DEFAULT 0`.

Migração é idempotente via `PRAGMA table_info + ALTER TABLE` quando a coluna não existe. Um checkpoint legado começa em sequence 0; se retention já removeu o prefixo necessário, o primeiro boot novo faz um full reconcile de segurança e grava um watermark contemporâneo.

`full-reconcile`, `incremental` e `skip` preservam/avançam o watermark capturado. Se o journal estiver indisponível, a chave é omitida e o checkpoint anterior não é artificialmente avançado.

## 36.7 Planner e resultado compacto

`planIndexStartup()` agora aceita journal evidence adicional:

- replayable path com Git limpo → `mode=incremental`, `reason=journal-replay`;
- Git dirty/head changed continua levando ao incremental normal, com journal paths adicionados/deduplicados;
- qualquer uncertainty do journal listada acima → full reconcile;
- zero replay path + Git/head estáveis → skip normal.

O resultado do auto-build guarda apenas `journalSummary` (watermark/contagens/flags), nunca as rows/paths completos, evitando payload/context leakage.

## 36.8 Gates pré-live

Regressões já verdes:

- replay seq1→seq3 após checkpoint seq1 devolve somente seq2/seq3 e não move cursor runtime;
- truncation detectada;
- gap interno detectado;
- DB sequence menor que checkpoint detectado;
- cleanup de todas as rows **até o próprio checkpoint** preserva high-watermark via `sqlite_sequence` e não cria gap falso;
- classifier deduplica in-scope, ignora outside-scope, marca path relativo inválido e recursive invalidation;
- planner produz `journal-replay` e fail-closed reasons esperadas;
- migração de tabela legada sem `journal_sequence` retorna 0 e adiciona a coluna;
- checkpoint full seq7 → incremental seq9 preserva last-full clock e avança sequence;
- strict typecheck: green.

## 36.9 Prova live planejada pós-publish

Para isolar journal de Git, a prova será feita somente depois de publicar o source e deixar o worktree de `src/copilot` limpo:

1. primeiro reload: migração do checkpoint antigo; se houver gap de retention, espera-se um **full reconcile de segurança único**;
2. com checkpoint novo estabilizado, criar e remover um arquivo temporário não-hidden via writer canônico, deixando Git novamente limpo mas produzindo journal rows;
3. segundo reload: Git limpo + replay path deve gerar `reason=journal-replay`, incremental bounded do path final inexistente e novo watermark;
4. terceiro reload sem novas mutações: espera-se `skip`/`head-and-worktree-unchanged` com replay vazio;
5. qualquer gap/truncation inesperado invalida a prova e mantém full reconcile como fallback correto.

## 36.10 Primeira ativação live e refinamento de domínio

A primeira ativação do código publicado em `918d9fa93` produziu exatamente o safety behavior esperado para um checkpoint legado:

- `indexAutoBuild.mode=full-reconcile`;
- 1.450 candidates / 1.450 unchanged;
- full reconcile ~**398 ms**;
- journal replay `afterSequence=0`;
- `highWatermark=3721`;
- 74 rows retidas;
- `gapDetected=true`;
- 22 paths inicialmente classificados por containment;
- 3 rows fora do scope;
- full build preservou 2.245 rows do índice e não reportou failure.

O planner registrou `periodic-safety-reconcile` porque a janela periódica já havia vencido e essa condição tem precedência sobre o gap; o resultado, porém, preservou `journalReplay.gapDetected=true`. Um único full reconcile cobre simultaneamente as duas razões sem necessidade de dois scans.

A observação live revelou uma segunda questão: o journal é global e também recebe invalidations de artefatos operacionais dentro de `src/copilot/.ai` e paths não indexáveis. Containment sozinho era correto para segurança, mas insuficiente para decidir se havia trabalho de índice: um `.ai/jobs/*.json` poderia produzir `journal-replay` mesmo sendo posteriormente descartado por `refreshIoIndexPaths`.

Refinamento implementado após a primeira prova:

- `io-index-registry` expõe `filterIoIndexRefreshDomainPaths()` como preflight **sem mutar scheduler state**;
- essa primitive usa a mesma construção de domínio do auto-refresh: scope, hidden segments, extensões, include/exclude e `.gitignore`;
- startup replay passa por `containment/classifier → index-domain preflight → planner`;
- `journalEvidence.replayablePathCount` conta somente paths realmente admissíveis pelo índice;
- `journalSummary` separa `containedPathCount`, `hiddenScopeRows`, `domainSkippedRows` e `gitignoredSkippedRows`;
- invalidação recursiva hidden (`.ai`, `.git`, etc.) é ignorada como ruído operacional antes de marcar `recursiveScopeInvalidation`;
- recursive não-hidden dentro do scope continua fail-closed/full reconcile.

Regressões adicionais verdes:

- domain preflight deduplica path, rejeita `.ai`, extensão não indexável, outside-scope e gitignored path, preservando apenas o `.js` admissível;
- o preflight não altera counters/fila do scheduler;
- classifier comprova que `.ai/jobs` recursivo é `hiddenScopeRows`, enquanto uma subtree recursiva visível continua `recursiveScopeInvalidation=true`;
- strict typecheck: green.

Esse refinamento será publicado como follow-up sem reescrever o commit 30.9 original, pois foi derivado de evidência da primeira ativação live.

## 36.11 Prova live final — high-watermark fechado end-to-end

Após publicar o refinamento em `5ac2f670a`, a sequência de provas foi concluída em quatro boots controlados.

### Boot 1 — migração/safety full

- checkpoint legado sem watermark útil;
- replay `0 → 3721`;
- 74 rows ainda retidas;
- gap detectado;
- full reconcile sobre **1.450 candidates / 1.450 unchanged**;
- ~**398 ms**;
- sem failure.

### Boot 2 — composição Git + journal

HEAD mudou de `918d9fa93` para `5ac2f670a`:

- reason: `head-changed`;
- replay `3721 → 3761`;
- 40 rows;
- **27 hidden rows** removidas pelo domain preflight;
- 3 outside-scope;
- 5 paths admissíveis;
- Git diff também trouxe os mesmos 5 paths;
- dedupe final: **5 requests, não 10**;
- 5 unchanged, 0 failed;
- incremental ~**110 ms**.

### Boot 3 — recuperação puramente pelo journal

Com HEAD já estável em `5ac2f670a`, foi criado e removido `src/copilot/journal-replay-live-probe.js` pelo writer canônico. Antes do restart:

- Git voltou ao baseline sem qualquer dirty path em `src/copilot`;
- journal runtime registrou **2 publishes**, sequences **3762/3763**;
- external watcher marcou as duas como canonical-suppressed;
- create/delete já convergiram no runtime atual.

No restart seguinte:

- reason: **`journal-replay`**;
- mode: incremental;
- Git changed paths: **0**;
- replay `3761 → 3764`;
- 3 rows totais, incluindo 1 hidden operacional;
- create+delete do mesmo path deduplicado para **1 replayable path**;
- requested: **1**;
- como o arquivo já não existia, `invalidated=1`;
- `failed=0`;
- gap/truncated/invalid/recursive: todos zero;
- incremental completo: **71 ms**.

Isso prova a janela de recuperação que antes não existia: uma mutação canônica pode ocorrer, convergir no processo atual e desaparecer do estado Git final, mas ainda assim o próximo processo reconcilia explicitamente aquele path usando o watermark persistido.

### Boot 4 — estado realmente limpo

Sem nova mutação admissível de source:

- status: **skipped**;
- reason: **`head-and-worktree-unchanged`**;
- replay `3764 → 3765`;
- 1 row, inteiramente hidden operacional;
- contained/replayable paths: **0**;
- scannedEntries: **0**;
- candidateFiles: **0**;
- indexed/invalidated/hashVerifications: **0**;
- gap/truncated/invalid/recursive: zero;
- decisão completa: **53 ms**.

A Faixa 30.9 está encerrada: startup do índice agora possui recuperação bounded entre processos/restarts sem transformar journal em authority única e sem transformar ruído operacional hidden em trabalho de indexação.

---

# 37. Faixa 30.8 — Dependency/runtime hygiene — 2026-08-18

## 37.1 Auditoria global

A busca foi ampliada para `src`, `scripts`, `tests`, `config`, `package.json` e `package-lock.json`.

Resultados:

- `xxhash-wasm ^1.1.0` está em `dependencies`, mas não possui import/require em source, script, config ou teste executável;
- as únicas menções fora de package metadata são documentação histórica e `tests/fixtures/rag/sample.json`, que modela um package fictício e não carrega a library;
- `p-limit ^7.3.0` é runtime dependency legítima, com consumers em scanner, prefetch, session scope e SQLite index;
- `ignore ^7.0.5` é runtime dependency legítima, usada pelo scanner e pela policy `.gitignore` compartilhada;
- `minimatch ^10.2.5` sustenta a policy glob canônica em produção (`infra/scan/glob.js`), mas está incorretamente em `devDependencies`.

## 37.2 Correções-alvo

1. remover `xxhash-wasm` de `dependencies` e do root lock graph;
2. remover a entrada `node_modules/xxhash-wasm` do lockfile;
3. promover `minimatch ^10.2.5` para `dependencies` e removê-lo de `devDependencies`;
4. reconciliar lockfile v3: `node_modules/minimatch`, `brace-expansion` e `balanced-match` deixam de ser `dev:true`, pois agora fazem parte da árvore de produção;
5. manter `p-limit` e `ignore` em runtime dependencies;
6. não adicionar packages novos nesta faixa.

A mudança corrige um bug real de packaging: um deployment `npm install --omit=dev` podia omitir `minimatch` apesar de o scanner/import graph de produção depender dele.

## 37.3 Relação com Node 24

A remoção de `xxhash-wasm` é consequência do Estado-Alvo V3: hashing one-shot/seguro já usa `node:crypto.hash()` e o scanner incremental demonstrou que rich fingerprint + hash periódico satisfazem os requisitos atuais. Não existe workload medido que justifique manter um WASM hash package órfão.

Isso **não** significa substituir toda dependency por stdlib. A Faixa 30.7 demonstrou o contrário: `path.matchesGlob()` não preserva o contrato dotfile e `fs.promises.glob()` ficou mais lento que o traversal atual; por isso `minimatch` permanece conscientemente como runtime dependency.

## 37.4 Gates

- package/lock root graphs devem concordar;
- nenhum `xxhash-wasm` executável/importável deve permanecer fora de docs/fixture histórica;
- `minimatch` deve estar em root `dependencies`, não `devDependencies`;
- lock entries de `minimatch → brace-expansion → balanced-match` devem ser production-reachable (`dev` ausente/false);
- teste glob canônico green;
- scanner/index/working-set focused gates green;
- strict typecheck green;
- lint antes do publish;
- nenhum reload necessário: package metadata não muda source já carregado; runtime atual já possui `minimatch` instalado.

## 37.5 Execução

Aplicado sem installer/lifecycle scripts:

- `package.json`: `minimatch ^10.2.5` movido de `devDependencies` para `dependencies`;
- `package.json`: `xxhash-wasm` removido;
- root package do lockfile reconciliado da mesma forma;
- `node_modules/xxhash-wasm` removido do lock;
- `dev:true` removido de `node_modules/minimatch`, `brace-expansion` e `balanced-match`.

Foi adicionado `tests/unit/copilot/infra/test_runtime_dependency_contract.spec.js`, que parseia `package.json` e `package-lock.json` e impede regressão futura desse contrato.

Gates executados e verdes:

- runtime dependency contract;
- canonical glob policy;
- I/O scanner;
- strict typecheck.

Verificação negativa posterior:

- `package.json`: **0** ocorrências de `xxhash-wasm`;
- `package-lock.json`: **0** ocorrências de `xxhash-wasm`;
- root `package.json` contém uma única declaração de `minimatch`, em `dependencies`;
- lock entries production-reachable da cadeia não possuem `dev:true`.

A mudança não pretende melhorar hot-path latency diretamente. Ela reduz supply-chain/install surface por um package WASM órfão e, mais importante, corrige um deployment hazard real em instalações `--omit=dev`.

---

# 38. Faixa 31 — Patch Batch V2: baseline preconditions, single-target fast path e failure locality — 2026-08-18

## 38.1 Evidência que abriu a faixa

Snapshot do `mcp_latency_dashboard` depois das faixas 30:

- 39 calls / 0 errors / 15 tools;
- `repo_apply_patch`: **13 calls**, **33,3% de toda a pressão de chamadas**;
- average patch handler ~55 ms, portanto o problema não é uma chamada individual lenta;
- `repo_bulk_inspect` já comprime ~6,75 logical ops/call;
- validators continuam dominando tempo acumulado, mas isso é trabalho deliberadamente caro e não round-trip de edição.

Durante a própria execução das faixas anteriores, `repo_apply_patch_batch` foi tentado repetidamente e precisou ser decomposto quando same-file grouped preflight encontrou preconditions difíceis de expressar/diagnosticar. Portanto a oportunidade é reduzir **quantidade de chamadas e re-reads**, não acelerar `String.replace`.

## 38.2 Estado atual da primitive

`patchTextBatchLocked()` já possui a fundação correta:

- um resource lock por file;
- uma leitura inicial;
- operações aplicadas sequencialmente sobre conteúdo virtual;
- todos os patches são computados antes da publicação;
- uma única atomic write se o resultado final não for noop;
- uma única cache invalidation;
- hash do estado virtual é encadeado entre operações.

A limitação atual é de contrato/feedback:

1. `expectedHash` em cada operação é comparado ao hash **virtual daquele ponto**;
2. repetir o SHA obtido numa leitura inicial em todas as operações de um arquivo falha depois da primeira mutação;
3. `global-preflight` de um único target executa dry-run e depois apply, causando duas leituras do mesmo arquivo;
4. uma falha intermediária aborta atomicamente o grupo, porém a camada MCP tende a marcar todas as operações com o mesmo erro, sem destacar precisamente a operação causal.

## 38.3 Estado-alvo V2

### Baseline hash por target

Para same-file groups:

- se a **primeira operação** possui `expectedHash` e todo outro `expectedHash` fornecido no grupo é idêntico, o valor é interpretado como **baseline do target**;
- a primitive valida esse SHA uma vez contra o conteúdo inicial sob lock;
- os hashes repetidos deixam de ser reinterpretados como virtual-state hashes;
- preconditions `expectedOccurrences/occurrenceIndex/oldString` continuam sequenciais contra cada estado virtual;
- se hashes distintos forem fornecidos, preserva-se o modo avançado atual de precondition por operação;
- se apenas uma operação posterior possuir hash, ele permanece uma precondition virtual daquela operação e não é promovido.

Isso permite ao modelo ler um arquivo uma vez, copiar o mesmo `sha256` para todas as operações e manter proteção contra stale writes sem conhecer antecipadamente os hashes intermediários.

### Single-target preflight elision

Em apply real `global-preflight` com `targetCount===1`:

- não executar um dry-run separado;
- chamar diretamente a primitive atomic same-target, que computa/valida todas as operações antes de qualquer write;
- concorrência externa continua protegida por lock + expectedHash + pre-publish snapshot check;
- multi-target global-preflight permanece inalterado, pois aí a validação prévia de todos os targets possui valor semântico distinto.

Resultado esperado: um same-file batch default passa de **2 reads + 1 write** para **1 read + 1 write**.

### Failure locality

Low-level errors de batch passam a carregar:

- `operationIndex` causal;
- `completedOperationCount` virtual;
- código original da falha.

A camada MCP deve marcar:

- operação causal: erro/código original;
- demais operações do mesmo grupo: `ERR_PATCH_BATCH_GROUP_ABORTED` + `failedOperationIndex`;
- nenhum conteúdo é publicado em qualquer caso de failure durante o compute phase.

## 38.4 Não-objetivos

- não aumentar agora 64 operations / 32 targets / 1,5 MiB: nenhum limite foi atingido na telemetria;
- não remover expectedHash por conveniência;
- não tornar multi-file batch transacional entre arquivos;
- não enfraquecer lock, path policy, durability ou atomic publish;
- não criar nova tool MCP: a superfície existente deve ficar melhor, sem inflar `tools/list`.

## 38.5 SLOs e provas

- repeated identical baseline SHA em 3+ same-file edits: dry-run/apply green;
- hash inicial incorreto: grupo falha antes de qualquer compute/write;
- hashes encadeados distintos continuam válidos no modo per-operation;
- erro na operação #2 aponta #2 como causal e #1/#3 como group-aborted; file permanece byte-identical;
- single-target global-preflight real: uma única leitura da primitive, evidenciada por counter/metadata ou teste instrumentado;
- multi-target global-preflight conserva comportamento all-target preflight;
- same-file batch continua one lock/read/write/invalidation;
- focused MCP + low-level tests, strict typecheck e lint;
- reload + live probe com 3 operações em um único arquivo temporário e mesmo baseline hash;
- dashboard posterior deve demonstrar logicalOperations/call maior e permitir preferir batch sem decomposição.

## 38.6 Implementação pré-live

Motor low-level (`patchTextBatchLocked`):

- ganhou `baselineExpectedHash` separado das preconditions virtuais por operação;
- baseline é validado contra o conteúdo inicial já lido sob o mesmo resource lock;
- falha de baseline recebe `operationIndex=0`, `completedOperationCount=0`, `failurePhase=baseline-hash`;
- falhas durante compute sequencial recebem índice local causal, quantidade já computada e `failurePhase=operation`;
- o erro original/código são preservados;
- o modo existente de `expectedHash` distinto por operação continua intacto.

Camada MCP (`repo_apply_patch_batch`):

- `buildLockedPatchBatchGroup()` promove para `group-baseline` somente quando a primeira operação tem SHA e todos os SHA fornecidos no grupo são idênticos;
- hashes repetidos são retirados das operações individuais e enviados uma única vez como baseline do target;
- grupos com hashes distintos permanecem `per-operation`;
- rows de sucesso expõem `expectedHashMode`;
- em failure, somente a operação causal mantém código/mensagem original; as demais recebem `ERR_PATCH_BATCH_GROUP_ABORTED` e carregam `failedOperationIndex`, `failedGroupOperationIndex`, `completedOperationCount`, `failurePhase` e `causalFailure=false`;
- apply real `global-preflight` com exatamente 1 target define `preflightElided=true` e vai direto ao compute-before-write atômico; multi-target continua executando global preflight;
- resultado/audit carregam a evidência de elisão; nenhum limite de ops/targets/payload foi ampliado.

Metadata/guidance:

- schema de `expectedHash` explica que o SHA inicial pode ser repetido em operações same-file;
- `mcp_session_profile`, capabilities guidance e `mcp_tools_status` agora preferem direct bounded batch quando anchors/intenção já são conhecidos;
- plan é explicitamente condicional a preview/approval boundary com valor adicional;
- `approvalFrictionProfile` ganhou `directBatchWorkflows` e retirou patch/file batch do conjunto reflexivo `planFirstWorkflows`.

Regressões verdes:

- low-level baseline hash com 3 operações;
- stale baseline rejeitado antes de publish;
- operação intermediária #2 localizada, arquivo byte-identical;
- hashes virtuais distintos preservados;
- MCP apply real com três operações same-file + mesmo baseline SHA;
- MCP failure locality com demais rows group-aborted;
- single-target preflight elided;
- multi-target global preflight preservado;
- suíte `test_mcp_tools.spec.js` green após mudança de guidance;
- strict typecheck green.

A prova live ainda é necessária porque ela validará a composição completa no processo MCP remoto e medirá o novo `logicalOperations/call` em telemetria real.

## 38.7 Prova live executada

Após reload controlado:

- connector smoke: green;
- OAuth/health/SSE: green;
- tools: **120/120**;
- `tools/list`: **122.633 bytes**, contra 122.117 antes; +516 bytes de descrições/schema, sem tool nova.

Probe criado: `src/copilot/patch-batch-v2-live-probe.txt`, conteúdo inicial `alpha beta gamma` e SHA `adf7157c...`.

Uma única chamada `repo_apply_patch_batch` recebeu três operações same-file (`alpha→ALPHA`, `beta→BETA`, `gamma→GAMMA`) com o **mesmo SHA inicial repetido nas três rows**, sem plan prévio:

- success=true;
- operationCount=3;
- targetCount=1;
- appliedCount=3;
- `preflightElided=true`;
- reason=`single-target-atomic-compute-before-write`;
- preflight ran=false;
- todas as rows: `expectedHashMode=group-baseline`;
- um único traceId `io-msypzo8e-6ddc0c1b`;
- hashes virtuais evoluíram entre as operações sem input adicional do caller;
- somente a última row contabilizou `batchBytesWritten=17`/publicação final;
- duração MCP: ~**50,3 ms**;
- conteúdo final confirmado: `ALPHA BETA GAMMA`.

No mesmo arquivo foi executada uma prova de failure locality com baseline válido e anchor inexistente na operação #2:

- success=false, appliedCount=0;
- duração ~**1,7 ms**;
- operação global #1/local #1 marcada causal com `ERR_PATCH_NOT_FOUND`;
- operações #0 e #2: `ERR_PATCH_BATCH_GROUP_ABORTED`, `originalCode=ERR_PATCH_NOT_FOUND`;
- `completedOperationCount=1`, `failurePhase=operation`;
- arquivo relido depois da falha permaneceu com o mesmo SHA/conteúdo final anterior, provando zero partial publish.

O probe foi removido após as provas.

Dashboard pós-prova:

- `repo_apply_patch_batch`: 2 calls, 6 logical operations;
- **3 logicalOperations/call** para o batch;
- successful batch ~50 ms; failure batch ~2 ms no accounting arredondado;
- `roundTripAccounting.compressedRoundTrips=4` na pequena janela;
- para o caso representativo de três edits same-file, 3 chamadas individuais passam a **1 call**, redução de 66,7% nos round-trips de patch;
- handlers normais permanecem dentro do budget; o warning de dashboard veio apenas do connector smoke de rede (~1,3 s), não do I/O de patch.

A Faixa 31 está operacionalmente fechada: o principal motivo observado para decompor same-file patch batches foi removido sem reduzir stale-write protection, atomicity ou feedback causal.

---

# 39. Faixa 32 — Patch Batch Result Surface V2 — 2026-08-18

## 39.1 Evidência que abriu a faixa

Depois da Faixa 31, batches maiores passam a ser o workflow preferido. Isso desloca o custo potencial de round-trip para **payload de resposta**.

Medição live com `repo_apply_patch_batch` em dry-run, um único target, 12 operações noop e sem diff preview:

- operationCount: **12**;
- inputBytes: 2.449;
- duration: ~**9,1 ms**;
- result bytes observados pelo dashboard: **8.193 bytes**;
- ~**683 bytes/operação**;
- o resultado repete path, byte counts, hashes, line metadata, diff flags e hash mode em todas as rows.

Escala aproximada linear: 64 operações podem ultrapassar ~40 KiB mesmo sem diff preview. Portanto a compactação de round-trips da Faixa 31 precisa ser acompanhada por compactação de decision surface.

## 39.2 Auditoria de consumers

Nos testes/callers atuais:

- successes usam principalmente status, grouped same-file e algumas evidências de hash/trace em testes de prova;
- nenhum consumer operacional depende por default de `previousBytes/projectedBytes/firstMatchLine/lastMatchLine/diffPreview*`;
- failures dependem de detalhe causal e **não serão compactadas**;
- `includeDiffPreview=true` já representa intenção explícita de obter detalhe.

## 39.3 Estado-alvo

Adicionar `resultMode: compact | detailed`, default **compact**.

### compact

- successes retornam rows mínimas de decisão;
- metadata compartilhada por arquivo sobe para `targetSummaries` uma única vez;
- hashes intermediários, line metadata, byte accounting por operação e flags de diff repetitivas ficam fora;
- failures permanecem detalhadas, inclusive `failedOperationIndex`, code e failurePhase;
- top-level continua com execution/preflight/apply counters;
- resposta declara `resultMode` e `detailsAvailable=true`.

`targetSummaries` deve conter, no máximo por target:

- path;
- operationIndices;
- operationCount;
- expectedHashMode;
- traceId quando apply real;
- initialHash;
- final/projected hash;
- bytesWritten/projectedBytes quando disponível;
- noopCount/replacedOccurrences agregados.

Success row compacta:

- index;
- success;
- path;
- noop;
- replacedOccurrences;
- expectedHashMode.

### detailed

- preserva a superfície atual integral das rows de sucesso;
- usado para debugging/forensics ou quando o caller pedir explicitamente;
- `includeDiffPreview=true` força effective detailed mesmo se `resultMode` for omitido/compact.

## 39.4 Compatibilidade e versionamento

- failures não perdem informação;
- nenhum input antigo deixa de ser aceito;
- o default de **output** muda, portanto `CAPABILITIES_VERSION` deve subir de 52 para **53**;
- schema ganha apenas um enum pequeno; o aumento de `tools/list` deve ser muito menor que a redução de payload em batches médios/grandes;
- guidance deve preferir compact e pedir detailed somente para investigação.

## 39.5 SLOs

- 12-op dry-run representativo: **<3 KiB** structured result;
- redução de payload ≥60% versus baseline 8.193 bytes;
- 3-op apply live mantém informação suficiente para confirmar target/hash/trace no `targetSummary`;
- failure live/unit continua detalhada e causal;
- detailed mode reproduz campos atuais (`previousHash`, `contentHash/projectedHash`, line/diff metadata);
- includeDiffPreview força detailed;
- strict typecheck + focused MCP tests + lint;
- reload e A/B live repetindo o mesmo dry-run de 12 no-ops.

## 39.6 Execução e prova live

Implementação concluída:

- `repo_apply_patch_batch` ganhou `resultMode=compact|detailed`, default `compact`;
- `includeDiffPreview=true` promove automaticamente para `detailed`;
- success rows compactas mantêm apenas a decision surface por operação;
- metadata compartilhada foi elevada para `targetSummaries` por arquivo;
- failures continuam detalhadas e causais;
- `CAPABILITIES_VERSION` avançou para **53**;
- guidance passou a preferir compact e detailed somente quando necessário.

Durante o primeiro gate, o SLO de payload falhou por margem pequena: **3.141 B** para o teste representativo, contra teto de 3.072 B. O limite não foi relaxado. A causa residual era `groupedSameFile=true` repetido em todas as success rows compactas, embora a informação já estivesse implícita no summary do target. O campo foi removido somente do modo compacto; permanece disponível em `detailed`. O gate foi repetido e ficou verde.

Gates finais verdes:

- `tests/unit/copilot/mcp/test_mcp_patch_batch_v2.spec.js`;
- `tests/unit/copilot/mcp/test_mcp_tools.spec.js`;
- strict typecheck;
- lint.

Reload controlado pós-implementação:

- connector ready;
- **120/120 tools**;
- OAuth/SSE green;
- `tools/list`: **122.864 B**, aumento de apenas **231 B** versus 122.633 B da Faixa 31.

A/B live usando exatamente o workload baseline: 12 no-ops same-file em `src/copilot/mcp/README.md`, mesmo baseline SHA, sem diff preview:

- baseline Faixa 31: **8.193 B**;
- Result Surface V2: **3.029 B**;
- redução: **~63,0%**;
- duração: ~**8 ms**;
- `logicalOperationsPerCall`: 12 para essa chamada;
- `resultMode=compact`;
- uma única `targetSummary` com hash inicial/final e índices 0..11;
- failures vazias.

Prova live do modo detalhado por compatibilidade: o binding desta conversa ainda não hot-injetou o novo parâmetro `resultMode` em seu wrapper já materializado após o reload, porém `includeDiffPreview=true` — parâmetro já conhecido pelo host — forçou corretamente `resultMode=detailed`. A resposta devolveu `previousHash`, `projectedHash`, line/byte metadata e diff preview. Portanto clientes com descriptor antigo ainda conseguem acionar detalhe explicitamente via preview, enquanto a nova superfície remota já está ativa no MCP.

A Faixa 32 está fechada: batches maiores agora reduzem simultaneamente **round-trips** e **payload/contexto**, sem remover failures diagnósticas nem o modo forense completo.

---

# 40. Faixa 33 — Working Set Selection V3: cobertura estrutural + seeds bounded — 2026-08-18

## 40.1 Evidência live que abriu a faixa

Após a reconexão do ChatGPT, `repo_working_set` tornou-se finalmente invocável diretamente neste binding. O primeiro `open(path="src/copilot", maxFiles=80)` mostrou:

- candidates: **1.450**;
- selected: **80**;
- hardLimitReached: true;
- parsed: 78;
- preload: 80;
- contexto ~16 KiB conforme budget;
- porém o manifest ficou concentrado quase integralmente no primeiro subtree lexical, `src/copilot/agent/...`.

Prova causal: `find(symbol="repo_apply_patch_batch")` no working set retornou **0 matches**, apesar de o símbolo existir e a própria tool MCP estar ativa. Logo o problema não é parser/index nem budget; é a política de seleção inicial.

A implementação confirmou a causa: `warmFromDirectory()` calcula candidatos corretamente e depois executa `allCandidateFiles.slice(0, effectiveMaxFiles)`.

## 40.2 Estado-alvo

Preservar integralmente os invariantes da Working Set V2:

- hard selected-file cap;
- snapshot reuse prefetch→parser→index;
- selected-path index refresh;
- refresh O(delta)/O(1) quando vazio;
- context budgeted;
- ownership/lifecycle MCP;
- nenhuma expansão silenciosa do escopo.

Alterar apenas **quais candidatos entram no hard cap**.

### `selectionMode=coverage|lexical`

- `coverage` passa a ser o default para session scopes/working sets;
- `lexical` preserva explicitamente a semântica V2 para compatibilidade/testes;
- nenhum novo scan ou stat: a política opera somente sobre a lista de candidatos já produzida pelo scanner.

### Coverage-first determinístico

1. normalizar candidatos relativos ao directory root;
2. separar por bucket top-level (`agent`, `infra`, `mcp`, `model-gateway`, root, etc.);
3. ordenar os arquivos dentro de cada bucket por menor profundidade e depois lexicalmente;
4. selecionar em round-robin entre buckets até atingir `maxFiles`;
5. nenhum arquivo pode ultrapassar o hard cap;
6. mesma entrada produz sempre a mesma seleção.

Isso evita gastar todo o orçamento no primeiro subtree e dá cobertura estrutural ampla sem inferência semântica cara.

### `preferredPaths` / MCP `seedPaths`

- seeds são paths explícitos do caller e têm prioridade antes do round-robin;
- contam **dentro** do mesmo hard cap;
- somente candidatos elegíveis pelo scan/include/exclude podem ser selecionados como seed;
- seeds duplicados não consomem slots extras;
- paths fora do working-set root são rejeitados no adapter MCP;
- nenhum seed permite acessar path que a read policy já bloquearia.

## 40.3 Observabilidade compacta

`ScopeStats` passa a carregar somente:

- `selection.mode`;
- `candidateBuckets`;
- `selectedBuckets`;
- `preferredRequested`;
- `preferredSelected`;
- `seedSymbolsRequested`;
- `seedSymbolPathsResolved`.

Não retornar buckets/path lists adicionais em stats para evitar aumentar payload.

## 40.4 SLOs e provas

- fixture com ≥3 top-level buckets e `maxFiles` menor que candidates deve selecionar de mais de um bucket em `coverage`;
- `lexical` deve reproduzir o prefixo antigo;
- seeds elegíveis entram primeiro e contam dentro de `maxFiles`;
- seeds não elegíveis não aumentam `pathCount`;
- broad live `src/copilot maxFiles=80` deve cobrir múltiplos top-level buckets;
- `find` deve localizar um símbolo de `src/copilot/mcp` que antes ficava fora do prefixo lexical;
- open/context payload continuam bounded;
- zero reread regressions no integration test;
- strict typecheck + focused prefetch/session/MCP/working-set tests + lint;
- reload + prova live comparando V2 lexical bias vs V3 coverage.

## 40.5 Prova live intermediária V54 — breadth resolvida, precisão ainda insuficiente

O primeiro reload da faixa ativou `coverage` sem ainda incluir `seedSymbols`/source-first:

- connector smoke green;
- **120/120 tools**;
- `tools/list`: **123.240 B**;
- broad open idêntico ao baseline: `path=src/copilot`, `maxFiles=80`, `maxBytes=16 KiB`;
- candidates: **1.450**;
- selected: **80**;
- `selection.mode=coverage`;
- `candidateBuckets=27`;
- `selectedBuckets=27` — cobertura de **100% dos buckets top-level presentes nos candidatos**;
- contexto: **14.937 B**, abaixo do budget;
- index selected-path refresh: 80 requested / 80 unchanged / 9 ms.

Isso eliminou o viés lexical global. Porém o primeiro representative de muitos buckets ainda era `README.md`, e apenas **53/80** arquivos foram parseados como source. Além disso, `find(repoWriteTools)` — símbolo JS real persistido no índice global em `src/copilot/mcp/tools/repo-write.js` — continuou retornando 0 no broad set. Com 80 slots distribuídos por 27 buckets, coverage breadth não pode garantir sozinho um arquivo profundo específico.

Conclusão: aumentar `maxFiles` seria desperdício de memória/parse. A resposta correta é aumentar **utilidade por slot** e permitir precisão causal bounded.

## 40.6 Refinamento V55 — source-first + `seedSymbols`

### Source-first dentro de cada bucket

Coverage continua top-level round-robin, mas a ordenação interna passa a priorizar:

1. source parseável JS/TS/MJS/CJS/JSX/TSX/MTS/CTS;
2. JSON;
3. Markdown;
4. demais extensões;
5. dentro da mesma classe, menor profundidade e depois ordem lexical.

Assim README/docs deixam de consumir os primeiros slots quando há código elegível no mesmo bucket. `lexical` permanece exatamente sem esse ranking, preservando a compatibilidade histórica.

### `seedSymbols`

`declareScope()` agora aceita símbolos exatos como hints causais:

- dedupe + hard max interno de 32 symbols;
- resolução por `findIoIndexSymbol(... exactMatch=true, pathPrefix=directory)` no índice local já materializado;
- no máximo 4 rows por símbolo antes de dedupe;
- nenhum fallback para scan/search adicional se o índice não retornar match;
- paths do índice entram apenas como preferred candidates; `warmFromDirectory` ainda exige que estejam no conjunto elegível depois de extensão/include/exclude/gitignore;
- todos continuam contando dentro do mesmo `maxFiles`.

O MCP expõe `seedPaths` + `seedSymbols`; a LLM-B `workspace_scope_declare` recebeu a mesma superfície e o mesmo containment de seed path. Isso colapsa o workflow `index_find_symbol → declare/open scope` em **uma chamada** quando o símbolo causal já é conhecido.

Observabilidade bounded adicionada:

- `seedSymbolsRequested`;
- `seedSymbolPathsResolved`.

### Provas automatizadas

Verdes:

- coverage em 3 buckets com cap=3 seleciona 3 buckets;
- lexical limitado reproduz exatamente o prefixo lexical ilimitado;
- source-first escolhe JS profundo sobre README raso no mesmo bucket com cap=1;
- preferred path é priorizado, deduplicado e não ultrapassa `maxFiles`;
- MCP rejeita seed path legível porém fora do root aberto;
- LLM-B encaminha coverage/seedPaths/seedSymbols e rejeita seed fora do directory;
- integration real: um único `refreshIoIndexPaths(repo-write.js)` prepara o símbolo; `declareScope(directory=src/copilot/mcp,maxFiles=1,seedSymbols=['repoWriteTools'])` resolve exatamente um preferred path e `findSymbol` encontra `repo-write.js` dentro desse único slot;
- integration V2 continua com 48 supplied snapshots e **0 snapshot rereads**;
- strict typecheck green.

O último integration benchmark representativo permaneceu saudável: 48/48 files, 48 supplied snapshots, 0 rereads, context 11.449 B, local find ~0,20 ms e empty refresh ~0,41 ms.

## 40.7 Runtime final V55

Reload final pós-refinamento:

- connector smoke green;
- OAuth/SSE green;
- **120/120 tools**;
- `tools/list`: **123.452 B**;
- `mcp_capabilities_summary.capabilitiesVersion=55`;
- guidance remota já recomenda source-first coverage + `seedPaths/seedSymbols`.

O host desta conversa redescobriu `repo_working_set` após o reload, mas o wrapper materializado continuou expondo o schema anterior sem os novos argumentos. Portanto `seedSymbols` não pôde ser enviado live por este binding sem uma nova reconexão manual; a semântica ficou coberta pelo integration test real com índice e hard cap=1. O runtime remoto, entretanto, confirma V55 e a guidance nova.

A repetição live do mesmo broad open `src/copilot`, `maxFiles=80`, `maxBytes=16 KiB` mostrou:

- candidates: **1.450**;
- selected: **80**;
- `candidateBuckets=27`;
- `selectedBuckets=27`;
- parsed: **75/80**, contra **53/80** no primeiro coverage V54 — aumento de **~41,5%** na densidade de arquivos parseáveis sem ampliar o cap;
- symbols: **630**, contra **334** em V54 — aumento de **~88,6%** na superfície simbólica disponível;
- context: **15.866 B / 16.384 B**;
- selected-path index refresh: 80 unchanged / 9 ms;
- `findSymbol('parseTransport')` encontrou `src/copilot/mcp/cli.js` diretamente no working set;
- refresh sem delta retornou `{refreshed:0, failed:0, skipped:0}`;
- close liberou o working set e deixou `activeOwnedWorkingSets=0`.

Conclusão da Faixa 33: o hard cap deixou de ser uma janela lexical. Broad scopes agora maximizam cobertura estrutural e source utility; causal scopes podem fixar arquivos diretamente ou resolver símbolos no índice dentro do mesmo open, e MCP/LLM-B compartilham a mesma fundação e invariantes.

---

# 41. Faixa 34 — Working Set Result Flow V4: text dedupe + context-aware refresh — 2026-08-18

## 41.1 Evidência que abriu a faixa

Dashboard pós-V55, após o ciclo live `open → find → refresh → close`:

- 16 MCP calls / 0 errors;
- `repo_working_set`: **4 calls**, 25% da pressão de chamadas;
- `repo_working_set`: **77.820 B** de resultados, **67,9% de todo o volume** da janela;
- média: **19.455 B/call**;
- handler médio ~161 ms; portanto o problema dominante é payload/context, não CPU.

A revisão do handler encontrou duas fontes de redundância:

1. `action=refresh` sempre chama e retorna `getScopeContext()`, inclusive em delta vazio `{refreshed:0,failed:0,skipped:0}`;
2. `okResult(structuredContent)` sem `text` chama `stringifyForModel(structuredContent)`, duplicando o objeto completo em `content[0].text` e `structuredContent`. Como `repo_working_set` não fornece texto explícito em nenhuma action, manifests grandes são serializados duas vezes no mesmo tool result.

## 41.2 Estado-alvo

### Texto decisório compacto

Todas as actions passam a fornecer `okResult(structured, conciseText)`:

- `open`: id/path/selected/parsed/context bytes;
- `context`: files/symbols/context bytes;
- `find`: símbolo + matchCount;
- `refresh`: refreshed/failed/skipped + se contexto foi incluído;
- `status`: status/pathCount/parsed/invalidated;
- `close`: confirmação + activeOwnedWorkingSets.

`structuredContent` continua sendo a fonte rica e machine-readable; o texto não replica JSON/manifest.

### `contextMode=auto|include|omit`

Um único input controla contexto inline sem criar nova tool:

- `open`: `auto` equivale a include; `omit` abre/preaquece e retorna ID/stats sem manifest;
- `refresh`: default `auto`; inclui contexto somente se houve `refreshed>0` ou `failed>0`; refresh vazio não repete manifest;
- `include`: força contexto em open/refresh;
- `omit`: nunca inclui contexto em open/refresh;
- `context`: sempre retorna contexto, independentemente de `contextMode`;
- `find/status/close`: não incluem contexto.

Isso evita um round-trip extra quando a mudança real exige contexto, mas elimina custo no caso comum de refresh vazio.

## 41.3 Invariantes

- nenhuma mudança na engine shared scope/cache/parser/index;
- IDs/ownership/eviction inalterados;
- context budgets e manifest limits inalterados;
- failures não compactadas a ponto de perder diagnóstico;
- nenhum contexto é omitido da action `context`;
- clientes sem o novo parâmetro continuam válidos: open continua trazendo contexto e refresh vazio fica mais compacto por default.

## 41.4 SLOs e provas

- open default ainda retorna structured context;
- open `contextMode=omit` não chama `getScopeContext`;
- refresh vazio default não chama `getScopeContext`, retorna `contextIncluded=false` e `contextAvailable=true`;
- refresh com `refreshed>0` em auto inclui contexto;
- refresh `contextMode=omit` não inclui mesmo com delta;
- refresh `contextMode=include` inclui mesmo vazio;
- action=context sempre inclui;
- `content[0].text` deve ser curto e não conter manifest/JSON serializado;
- teste com contexto representativo deve mostrar redução substancial de bytes do CallToolResult;
- focused MCP tests + strict typecheck + lint;
- reload + A/B live comparando o ciclo open/refresh vazio com a janela V55.

## 41.5 Execução e A/B live V56

Implementação concluída na projeção MCP, sem alterar a engine shared scope:

- `contextMode=auto|include|omit` adicionado;
- open `auto` continua trazendo contexto; `omit` aquece e retorna ID/stats sem chamar `getScopeContext`;
- refresh `auto` inclui contexto somente se `refreshed>0 || failed>0`;
- refresh vazio retorna `contextIncluded=false`, `contextAvailable=true` e não materializa manifest;
- action=context sempre materializa manifest;
- todas as actions usam texto decisório curto em `okResult(structured, text)`, evitando a serialização textual automática de todo o structured payload;
- race rara de contexto indisponível ganhou `ERR_WORKING_SET_CONTEXT_UNAVAILABLE` explícito em vez de non-null assertion;
- `CAPABILITIES_VERSION` avançou para **56**.

Provas automatizadas verdes:

- open default mantém contexto;
- open omit não chama `getScopeContext`;
- refresh vazio auto não chama `getScopeContext` novamente;
- refresh delta auto inclui;
- refresh omit nunca inclui;
- refresh include inclui mesmo vazio;
- texto de decisão permanece curto e não contém manifest;
- fixture de manifest grande demonstra CallToolResult <70% do tamanho legacy-like com JSON estruturado duplicado no texto;
- strict typecheck e lint green.

Reload V56:

- connector/OAuth/SSE green;
- **120/120 tools**;
- `tools/list`: **123.643 B**;
- `mcp_capabilities_summary.capabilitiesVersion=56`.

A/B live repetindo o mesmo ciclo broad de quatro calls `open → find(parseTransport) → refresh vazio → close`:

| métrica | V55 | V56 | variação |
|---|---:|---:|---:|
| `repo_working_set` calls | 4 | 4 | igual |
| total result bytes | **77.820 B** | **19.566 B** | **-74,9%** |
| average result bytes | **19.455 B** | **4.892 B** | **-74,9%** |
| refresh vazio | repetia contexto | `contextIncluded=false` | manifest eliminado |
| errors | 0 | 0 | igual |

O broad open preservou 80/1.450 files, 27/27 buckets, 75 parsed e 630 symbols. A economia portanto não veio de reduzir a informação inicial útil, e sim de eliminar **duplicação intra-result** e **reenvio de contexto sem delta**.

A Faixa 34 está fechada. A próxima lacuna descoberta durante a revisão é de correctness, não payload: `refreshScope()` atualmente tenta reler um arquivo removido e transforma delete legítimo em `failed/degraded`, em vez de convergir removendo path/symbols/index state do scope.

---

# 42. Faixa 35 — Working Set delete convergence V57 — 2026-08-18

## 42.1 Problema confirmado

A revisão integral do documento + código no HEAD `8269656f0` confirmou a lacuna registrada ao fim da Faixa 34:

- `refreshScope()` invalida parser/L1 e chama `warmCacheForPaths(..., silent:false)`;
- quando um arquivo selecionado foi legitimamente removido, o read lança `ENOENT`/equivalente;
- o catch anterior tratava qualquer erro como `recordScopeFailure(..., 'refresh')`;
- o resultado era `failed=1`, `degraded=true`, embora a verdade canônica fosse simplesmente “este arquivo não pertence mais ao conjunto vivo”.

Isso era incompatível com a semântica incremental já adotada para working sets e com a própria primitiva `refreshIoIndexPaths()`, cujo contrato já invalida paths missing/non-indexable sem full scan.

## 42.2 Arquitetura adotada

A convergência de delete foi implementada no mesmo delta, sem `stat` redundante e sem scan do diretório:

1. o prefetch canônico continua sendo a primeira tentativa de refresh;
2. somente `ENOENT`, `ENOTDIR` e `EISDIR` são interpretados como remoção/non-file legítima;
3. EACCES/EIO/parser/index failures continuam falhas reais e podem degradar o scope;
4. em remoção legítima:
   - símbolos e `symbolBytesByPath` são removidos;
   - o path sai de `scope.paths`;
   - invalidations correspondentes são limpas;
   - `selectedFiles` passa a refletir o conjunto vivo;
   - `candidateFiles` e estatísticas de seleção permanecem como evidência histórica da seleção inicial;
   - não há backfill silencioso para ocupar o slot liberado;
   - o índice global recebe `refreshIoIndexPaths([p])`, que converge o row missing;
5. `refreshScope()` agora retorna `{refreshed, removed, failed, skipped}`;
6. a projeção MCP inclui `removed` no texto decisório e `contextMode=auto` considera remoção um delta real, devolvendo o contexto atualizado;
7. terminal/LLM-B recebem a mesma semântica shared;
8. `CAPABILITIES_VERSION` avança para **57**.

Se a remoção do arquivo for bem-sucedida mas a convergência do índice falhar, o path ainda sai do working set canônico, porém o resultado contabiliza `removed + failed` e o estado fica degraded por falha derivada — não se perde a verdade do filesystem para mascarar um erro de índice.

## 42.3 Provas

Gates focados verdes:

- `tests/unit/copilot/infra/test_io_session_scope.spec.js`;
- `tests/unit/copilot/mcp/test_mcp_repo_working_set.spec.js`;
- strict typecheck `src/copilot`;
- lint `src/copilot`.

O teste da engine prova explicitamente:

- `refreshed=0`;
- `removed=1`;
- `failed=0`;
- `skipped=0`;
- `pathCount 1→0`;
- `selectedFiles 1→0`;
- `candidateFiles=1` preservado como evidência da seleção original;
- `parsed 1→0`;
- `symbolBytes→0`;
- `invalidated=0`;
- `ready=true`;
- `degraded=false`;
- `lastError=null`;
- símbolo removido deixa de ser encontrado.

### Prova live pós-reload

Foi criado um probe descartável `src/copilot/mcp/zz-working-set-delete-v57-probe.mjs`, fixado via `seedPaths` em um scope `maxFiles=1`, removido pela tool canônica `repo_remove_file` e em seguida atualizado via `repo_working_set refresh`.

Resultado live:

- open: `pathCount=1`, `selectedFiles=1`, `parsed=1`, `symbolBytes=371`, símbolo `workingSetDeleteV57Probe` presente;
- delete: operação canônica `io-engine.fs.unlink`, sem rollback sidecar;
- refresh: **`removed=1`, `failed=0`**;
- após refresh: `pathCount=0`, `selectedFiles=0`, `parsed=0`, `symbolBytes=0`, `invalidated=0`, `ready=true`, `degraded=false`;
- `contextMode=auto` incluiu manifest vazio atualizado;
- probe apagado e working set fechado.

A Faixa 35 está tecnicamente fechada; resta publicar o sublote depois de concluir a atualização documental desta rodada.

---

# 43. Investigação de conexão/rede — baseline completo de 2026-08-18

## 43.1 Motivação e decomposição causal

O sintoma raro observado na interface do ChatGPT — **“aguardando conexão”**, às vezes seguido de interrupção — não deve ser atribuído automaticamente ao MCP. O circuito tem pelo menos cinco legs independentes:

1. **cliente ChatGPT ↔ infraestrutura OpenAI** — HTTPS/WebSocket da própria conversa e notificações;
2. **infraestrutura OpenAI ↔ endpoint MCP público** — requests MCP/OAuth/SSE contra `https://mcp.aurelin.org/mcp`;
3. **Cloudflare edge ↔ cloudflared** — quatro conexões HA, hoje QUIC;
4. **cloudflared ↔ origin MCP local** — HTTPS/HTTP/2 para `https://127.0.0.1:3333`;
5. **origin MCP ↔ runtime/IO/index/workspace** — Node, event loop, filesystem, SQLite/index e tools.

Uma falha em (1) pode mostrar “aguardando conexão” mesmo se o MCP estiver perfeito. Uma falha/restart em (2–4) pode interromper um turno que esteja usando tools sem significar que a conexão cliente↔OpenAI caiu. Uma pausa extrema em (5) pode fazer o leg MCP parecer travado sem haver perda de rede.

## 43.2 Evidência OpenAI/client-side

Documentação oficial atual da OpenAI confirma que recursos do ChatGPT usam WebSocket seguro em `wss://ws.chatgpt.com` sobre TCP/443 e que proxy/firewall, inspeção TLS/SSL, filtragem web, VPN/security tooling, timeout de idle ou limites de frame/message podem produzir sessões que conectam e depois travam/desconectam.

No momento desta investigação, a Statuspage oficial da OpenAI informava **fully operational / no known issues**. Isso reduz a probabilidade de uma indisponibilidade global corrente, mas não exclui perda transitória no ISP, roteador, cliente, sessão WebSocket ou edge específico do usuário.

Consequência: o texto “aguardando conexão” é um **sinal da interface**, não um diagnóstico de que Cloudflare/MCP caiu.

## 43.3 Estado live do MCP/Cloudflare após restart/reconnect do usuário

### Runtime

`mcp_runtime_health`:

- status `ok`;
- index disponível/fresco: 2.251 files, 12.285 symbols, 3.661 chunks;
- Node **v24.15.0**;
- compile cache `ENABLED`;
- stateful MCP ativo, TTL 600 s, max 256 sessions;
- external watch ativo, sem erro;
- nenhum critical/warning de runtime além de dirty worktree e retenção de job artifacts.

### Conector remoto

Fresh connector smoke:

- OAuth/health: green;
- 120/120 tools;
- `tools/list=123.643 B`;
- SSE initial: green;
- SSE reconnect: green;
- Last-Event-ID: aceito.

Após o reload V57, o smoke completou em **1.128 ms**, SSE/reconnect em **222 ms**.

### Tunnel remoto

`mcp_cloudflare_remote_audit`:

- tunnel `workspace-mcp-dev`: **healthy**;
- conexões: **4 total / 4 active**;
- colos: GRU13/GRU08/GRU18;
- client `cloudflared 2026.5.2`;
- CNAME do hostname público converge para o tunnel esperado;
- origin remoto: `https://127.0.0.1:3333`;
- `http2Origin=true`;
- TLS verification ativa (`noTLSVerify=false`);
- keepalive origin explícito;
- drift/critical/warnings: zero.

### Edge

A política host/path está correta:

- cache bypass em `/mcp`, OAuth, `.well-known` e `/health`;
- regra de passthrough desliga BIC/Rocket Loader/email obfuscation e `response_body_buffering=none` para o tráfego dinâmico;
- nenhum challenge/block sobre `/mcp`;
- nenhum sensitive-header transform;
- rate-limit moderado em `/oauth/token`;
- ausência de rate-limit explícito em `/mcp` é warning de abuso/segurança, não evidência de perda de conexão, e não deve ser corrigida com throttling sem necessidade.

## 43.4 QUIC e a ruptura das 15:16:00

O log do tunnel mostrou uma concentração de `Connection terminated`, datagram/control-stream errors e `context canceled` **exatamente às 15:16:00Z**, instante do restart do MCP/cloudflared feito pelo usuário. Depois dessa ruptura controlada, não houve nova sequência equivalente de transport failures; os eventos seguintes classificados pelo próprio diagnóstico foram `recentBenignOriginCancellations` de requests encerradas/canceladas.

Métricas atuais do QUIC:

- 4 conexões;
- `closedConnections=0` no processo pós-restart;
- RTT latest ~17–23 ms;
- smoothed RTT ~20–25 ms;
- MTU 1.344;
- max UDP payload 1.360;
- `packetTooBigDropped=0`.

A documentação Cloudflare atual recomenda QUIC quando funciona e informa que `auto` cai para HTTP/2 quando UDP não pode ser estabelecido. Também alerta que sessões QUIC idle podem sofrer em NAT/firewalls com UDP idle timeout agressivo e recomenda comparar HTTP/2 quando há drops idle repetidos.

**Decisão atual:** não trocar QUIC por H2/auto sem evidência. O transporte está saudável agora. Primeiro corrigir observabilidade; somente depois, se houver novos drops espontâneos fora de restart, executar benchmark controlado QUIC×H2×auto.

## 43.5 `cloudflared_tunnel_request_errors`: por que o percentual bruto engana

Antes do fresh smoke:

- total requests = 71;
- request errors = 14.

Depois de um smoke **integralmente verde**:

- total requests = 120;
- request errors = 19.

Ou seja, a janela green adicionou +49 requests e +5 ao contador chamado `request_errors`. Isso prova empiricamente que esse contador cumulativo, isoladamente, **não equivale a falha perceptível do connector**. OAuth 401 esperado, encerramentos SSE/cancelamentos e outras classes de request podem contaminar a leitura operacional.

O código já inclui `requestErrorRateSemantics` avisando que é contador cumulativo de processo e exige delta + smoke/origin diagnostics. Ainda assim, a nomenclatura e o benchmark atual (`clean = requestErrors delta === 0`) podem superestimar sujeira de uma janela saudável. Estado-alvo: preservar o contador bruto como evidência, mas nunca promovê-lo sozinho a diagnóstico de transport loss.

## 43.6 Payload/context como amplificador de fragilidade percebida

A leitura integral deste documento em um único `repo_read_file_chunks` retornou aproximadamente **508,5 KiB** de tool result. O handler local gastou apenas ~29 ms, mas o payload representou ~88% do volume MCP da janela diagnóstica.

Isso não prova causa do “aguardando conexão”, que pertence primariamente ao leg cliente↔OpenAI, mas respostas/tool results grandes aumentam serialização, ingestão e pressão de contexto no caminho host/model. Portanto:

- leitura integral continuará possível quando semanticamente necessária;
- operações ordinárias devem usar working sets, outlines, search/batches e budgets compactos;
- o objetivo não é reduzir liberdade, mas evitar transferir centenas de KiB quando a decisão requer dezenas.

## 43.7 Bug real: Network Control Plane do DevContainer está apontando para path inexistente

A auditoria `mcp_devcontainer_network_posture_audit` retorna `controlPlane.status=skipped`.

Causa fechada no repositório:

- script real: `.devcontainer/scripts/network-control-plane-state.sh`;
- referências incorretas: `.devcontainer/scripts/network/network-control-plane-state.sh`.

Drift encontrado em três pontos:

1. `.devcontainer/devcontainer.json` — `DEVCONTAINER_NETWORK_CONTROL_PLANE_SCRIPT`;
2. `.devcontainer/scripts/post-create.sh` — default de `NETWORK_CONTROL_PLANE_SCRIPT`;
3. `.devcontainer/scripts/post-start.sh` — default de `NETWORK_CONTROL_PLANE_SCRIPT`.

O erro não derruba Cloudflare, mas deixa o agregador passivo de rede fora do boot e prejudica correlação/atribuição de incidentes.

**Correção planejada:** alinhar os três consumidores ao script real e cobrir com validação estrutural para impedir novo drift.

## 43.8 Falso warning: porta DNS “in-use” é o próprio dnsmasq gerenciado

Estado live:

- local DNS status `ok`;
- resolver efetivo;
- `/etc/resolv.conf → 127.0.0.1`;
- probe local via `dig`: green;
- warmup: 4/4;
- `dnsmasq_process_status=running-managed`;
- `dnsmasq_port_status=bound-managed`;
- `dnsmasq_target_port_conflict_status=in-use`.

A inspeção do produtor mostrou que `port_in_use()` define `in-use` para **qualquer** listener na porta alvo, antes de o mesmo fluxo identificar se o dono é o dnsmasq gerenciado. O consumidor MCP, por sua vez, transforma qualquer valor diferente de `none` em warning de conflito.

Portanto o warning corrente não é evidência de port collision; é erro de semântica/observabilidade.

**Estado-alvo:**

- quando o listener é o dnsmasq gerenciado, `in-use` deve ser tratado como ocupação esperada, não conflito;
- warning só quando a porta estiver tomada por owner incompatível/unmanaged ou ownership for realmente inseguro;
- manter visível `dnsmasq_port_status` para auditoria.

## 43.9 Roadmap imediato da frente de conexão

Ordem de execução após esta atualização documental:

1. publicar/fechar V57 Working Set;
2. corrigir os três paths do Network Control Plane;
3. corrigir a classificação de conflito DNS no produtor e no audit MCP, mantendo compatibilidade com artifacts antigos;
4. adicionar testes estruturais/semânticos focados;
5. revisar o `request_errors` do transport benchmark para separar `raw counter changed` de `window unhealthy`, sem apagar sinal bruto;
6. reload único e gates live;
7. repetir `mcp_devcontainer_network_posture_audit`, remote audit, metrics e connector smoke;
8. somente se restarem drops espontâneos, fazer benchmark QUIC×H2×auto e considerar `auto`/H2;
9. em episódio futuro de “aguardando conexão”, correlacionar timestamp exato com:
   - status/log do cliente/OpenAI quando disponível;
   - chegada/ausência de MCP request;
   - cloudflared connection events;
   - request-error deltas;
   - SSE smoke/reconnect;
   - origin cancellations/errors;
   - event-loop/tool latency.

A meta é reduzir tanto **quedas reais** quanto **falsos diagnósticos**, porque sem essa separação qualquer tuning de QUIC/DNS corre risco de trocar um sistema saudável por uma configuração inferior.


