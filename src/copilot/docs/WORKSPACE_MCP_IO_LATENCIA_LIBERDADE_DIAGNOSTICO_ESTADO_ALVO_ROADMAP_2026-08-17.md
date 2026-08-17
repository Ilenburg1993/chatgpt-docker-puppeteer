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

