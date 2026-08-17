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

Prova causal no processo final:

1. baseline `validatedMutablePath`: **0 issued / 0 accepted / 0 rejects**;
2. uma chamada real de `repo_apply_patch` em `dryRun=true` com no-op permitido atravessou o adapter MCP;
3. a operação reportou **9 ms de I/O** e o handler **17 ms**;
4. novo health: **1 issued / 1 accepted / 0 rejects**.

Portanto uma operação MCP real em patch eliminou exatamente uma segunda walk de path policy/realpath, e o resultado é observável em produção em vez de inferido apenas pela estrutura do código.

`CAPABILITIES_VERSION` permanece em **49**: nenhuma tool, schema, permissão, annotation ou contrato MCP externo mudou; a transformação é interna ao plano de I/O. Uma elevação aqui confundiria versão de superfície anunciada com versão de implementação. A versão relevante para invalidação da capability é `IO_PATH_POLICY_VERSION=2026-08-17.r3.nearest-ancestor.v1`.

