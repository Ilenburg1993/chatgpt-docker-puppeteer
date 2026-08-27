# WORKSPACE — LLM-B / MCP Runtime Generation, Promotion, Host Acceptance e Retention Real

## Auditoria profunda, estado atual, estado-alvo, invariantes, riscos e roadmap canônico pós-publicação

**Data da auditoria:** 2026-08-26  
**Repositório:** `chatgpt-docker-puppeteer`  
**Workspace:** `/workspaces/chatgpt-docker-puppeteer`  
**Branch:** `main`  
**HEAD publicado no início desta campanha:** `dfbc8e0ce3d041603811d0c1f1a40fce86a79e1b`  
**Upstream:** `origin/main` no mesmo commit  
**Worktree no início da auditoria:** limpo  
**Documento predecessor:**
`src/copilot/docs/WORKSPACE_LLMB_MCP_TASKGROUP_READINESS_AUDITORIA_PROFUNDA_ESTADO_ATUAL_ESTADO_ALVO_ROADMAP_2026-08-26.md`

---

# 0. Status e autoridade deste documento

Este arquivo é o **guia canônico permanente da próxima campanha** de LLM-B/MCP/Model Gateway após a
publicação do hardening de 26/08. Ele não substitui o documento predecessor como registro histórico:
o predecessor continua sendo a fonte de verdade sobre a investigação TaskGroup/cancellation, SQLite
v14, redaction proof, retention chunked, source barrier e benchmarks locais que levaram aos commits
`badea2716` e `dfbc8e0ce`. Este documento começa exatamente **depois** daquela publicação.

A regra de precedência é:

1. este arquivo governa os próximos passos pós-publicação;
2. o documento predecessor governa a história e as decisões já fechadas;
3. READMEs e roadmaps mais amplos devem ser reconciliados com este arquivo à medida que cada faixa
   for concluída;
4. nenhuma checkbox deste documento deve ser marcada apenas porque uma implementação “parece”
   correta: toda marcação exige evidência observável no nível indicado;
5. toda onda futura de transformação deve atualizar este arquivo **antes de avançar para a faixa
   seguinte**;
6. estados históricos não devem ser apagados. Quando um checkpoint for supersedido, adicionar novo
   checkpoint e indicar explicitamente a supersessão.

## 0.1 Restrição específica da rodada que criou este arquivo

Nesta rodada foi autorizado **somente**:

- investigação;
- auditoria;
- leitura e reflexão arquitetural;
- consultas read-only;
- criação deste documento.

Não foi autorizado transformar código de produção/testes nesta rodada. Portanto, todas as ações de
implementação abaixo permanecem abertas para rodadas futuras.

## 0.2 Quando este documento poderá ser considerado “concluído”

O documento só poderá receber status final **CONCLUÍDO** quando, cumulativamente:

- todas as faixas classificadas como bloqueantes tiverem checkbox `[x]` com evidência registrada;
- a geração runtime carregada estiver vinculada de maneira verificável ao source promovido;
- `runtime/source drift` for fail-closed nos boundaries críticos, e não apenas um warning;
- o reload controlado tiver promovido exatamente o source certificado;
- a acceptance host-real de MCP + LLM-B tiver passado após o reload;
- o banco real tiver backup consistente, integridade/FK/latest comprovados no gate pré-op;
- retention real intencional tiver sido executada somente após acceptance e validada pós-op;
- Cloudflare/OAuth/connector estiverem reconciliados com a geração pós-reload;
- todos os residuais explicitamente aceitos tiverem justificativa, owner e risco residual
  documentados;
- strict, lint, architecture, docs, Prettier, `git diff --check` e suítes relevantes estiverem
  verdes sob um source barrier único;
- documentação live estiver reconciliada;
- commit/push final tiver ocorrido;
- `git status` estiver limpo;
- `HEAD == origin/main` e ahead/behind `0/0`.

---

# 1. Resumo executivo

A campanha anterior resolveu problemas profundos de correctness, cancellation, SQLite e segurança da
readiness. O source publicado em `dfbc8e0ce` implementa uma arquitetura em que a readiness LLM-B é
executada em **subprocesso call-scoped supervisionado**, não no antigo outer `Worker`; o arquivo
`model-gateway-live-readiness-worker.mjs` foi removido deliberadamente.

Entretanto, a auditoria pós-publicação revelou um problema diferente e mais sistêmico:

> **o processo MCP atualmente conectado ainda executa uma geração antiga de módulos em memória, ao
> mesmo tempo em que o filesystem/Git já contém a geração nova publicada.**

A prova direta foi a chamada da tool real `llmb_live_readiness`, que retornou:

```text
ERR_LLMB_LIVE_READINESS
Cannot find module
/workspaces/chatgpt-docker-puppeteer/scripts/model-gateway/commands/model-gateway-live-readiness-worker.mjs
```

No `HEAD` atual esse arquivo **não existe por design**, e nenhuma referência live do source atual
aponta para ele. O `HEAD` aponta para:

```text
scripts/model-gateway/commands/model-gateway-live-readiness.mjs
```

via:

```text
MODEL_GATEWAY_LIVE_COMMANDS.readiness
  -> runModelGatewayLiveReadinessProcess()
  -> runModelGatewayLiveCommand()
  -> child_process.spawn()
```

Logo, o erro observado não é evidência de regressão do source publicado. É evidência de
**runtime/source generation skew**: o processo MCP carregou código antigo antes das transformações e
continua vivo depois que seus artefatos físicos foram removidos/renomeados no disco.

O diagnóstico genérico `mcp_runtime_health` percebe parte do problema e retorna `degraded`, com
warning de runtime/source drift. Porém hoje esse diagnóstico é apenas observacional, amostra sete
arquivos e não cobre a closure de `llmb_live_readiness`. A tool continua executável, entra em
trabalho caro e só falha ao tentar resolver o artefato removido.

Portanto, a prioridade do próximo ciclo muda:

```text
NÃO:
mais otimização de readiness -> depois reload

SIM:
runtime generation truth
-> fail-closed stale-generation guard
-> promotion manifest persistido
-> controlled reload do source exato
-> post-reload source-generation reconciliation
-> host-real LLM-B acceptance
-> somente depois retention real
```

---

# 2. Guia para quem nunca viu o projeto

## 2.1 Componentes principais

### MCP

O MCP é o servidor que expõe tools do workspace para clientes como ChatGPT. O processo atualmente
conectado pode permanecer vivo por muitas horas enquanto o código-fonte no workspace muda.

### LLM-B

“LLM-B” é o lado model/terminal que precisa ser operável de forma contínua pelo projeto. As tools
MCP `llmb_live_*` são a ponte governada para readiness, leitura de runs e execução controlada do
harness.

### Model Gateway

É a camada que organiza catálogo de modelos, providers, perfis, eligibility, routing, health e
provas runtime. A readiness LLM-B inspeciona esse estado sem chamar providers.

### `llmb_live_readiness`

Tool MCP read-only que deveria dizer se o Model Gateway/terminal está apto para testes live. No
source publicado ela executa a auditoria em subprocesso call-scoped, com environment authority
explícita, redaction proof e cancellation física de process group.

### `copilot.sqlite`

Banco SQLite de aplicação, por padrão `data/copilot.sqlite`. O Model Gateway usa tabelas históricas
de health/probes e projeções `*_latest` v14 para evitar scans históricos no hot path.

### Source barrier

Manifest determinístico `{path, sha256, bytes}` de arquivos explícitos. O fingerprint agregado é
verificado antes/depois de validações, publish e reload. Drift nunca é aceito apenas porque há
provenance conhecida.

### Controlled reload

`mcp_reload_schedule` agenda um helper detached. O restart real é embrulhado pelo
`source-barrier run`, de modo que o source certificado seja verificado imediatamente antes e depois
do child que executa o restart stateful/Cloudflare.

### Runtime generation

É a identidade do código **efetivamente carregado no processo MCP em execução**. Este conceito é a
principal lacuna pós-publicação: Git HEAD e source barrier são fortes, mas o processo vivo ainda não
expõe uma identidade de geração suficientemente vinculada ao fingerprint promovido.

---

# 3. Baseline publicado — fatos verificados

## 3.1 Git

No início desta auditoria:

```text
branch: main
HEAD: dfbc8e0ce3d041603811d0c1f1a40fce86a79e1b
origin/main: mesmo commit
worktree: clean
ahead/behind: 0/0
```

Commits imediatamente anteriores:

```text
dfbc8e0ce 2026-08-26 20:15 -0300 fix(mcp): include repository integrity owner
badea2716 2026-08-26 20:07 -0300 refactor(model-gateway): harden LLM-B readiness and SQLite lifecycle
5d5e0648b 2026-08-25 23:39 -0300 fix(mcp): label connector smoke with modern protocol
```

A campanha principal foi publicada em dois commits porque o primeiro publish omitiu dois arquivos
untracked de `repository/integrity/` quando uma enumeração intermediária tratou o diretório
untracked como uma única entrada. Isso foi detectado imediatamente, os 82 arquivos finais foram
recertificados, e o segundo commit corrigiu o remoto. O estado final de `main` está correto e limpo.

**Lição permanente:** enumeração de dirty/untracked para publicação não pode assumir que uma entrada
`?? dir/` do porcelain representa um arquivo publicável. Diretórios untracked precisam ser
expandidos para seus arquivos concretos antes da certificação/publicação.

## 3.2 Source atual — readiness desejada

No `HEAD` atual:

```text
src/copilot/mcp/integrations/model-gateway/live-runs/contracts.js
  MODEL_GATEWAY_LIVE_READINESS_SCRIPT
    = scripts/model-gateway/commands/model-gateway-live-readiness.mjs
```

O arquivo existe. O antigo:

```text
scripts/model-gateway/commands/model-gateway-live-readiness-worker.mjs
```

não existe e foi removido intencionalmente.

A cadeia atual é:

```text
llmb_live_readiness
  -> executeModelGatewayLiveReadiness()
     -> initial operational fingerprint
     -> memory cache, se válido
     -> runModelGatewayLiveReadinessProcess()
        -> runModelGatewayLiveCommand(command='readiness')
           -> spawn(process.execPath,
                    ['scripts/model-gateway/commands/model-gateway-live-readiness.mjs', ...])
           -> explicit readinessEnvironment()
           -> process-group supervision
           -> await physical close
     -> redaction proof context-bound
     -> completed operational fingerprint
     -> cache somente se initial == completed
```

## 3.3 Cancellation/current isolation

A arquitetura publicada já contém:

- outer boundary como subprocesso, não `worker_threads`;
- `terminationGraceMs=0` para readiness porque native synchronous `better-sqlite3` não é uma hard
  cancellation boundary de Worker thread;
- process-group termination;
- Promise só settle após `close`;
- lifecycle counters `created/terminated/current/cancelled/timedOut/outputLimited/abnormalExit`;
- fault test registry-level após nested Worker iniciar;
- fault test registry-level durante query nativa `better-sqlite3`;
- duas readiness concorrentes, cancelando apenas uma.

## 3.4 Environment authority

A authority atual é schema v3 e separa:

```text
readOnlyEnvironment()
readinessEnvironment()
liveRunEnvironment(plan)
```

`readinessEnvironment()` recebe apenas configuração/provider secrets necessários para inspeção local
e redaction detection. Não recebe credenciais MCP/OAuth nem credenciais Copilot-model.

`COPILOT_DB_PATH` é process-composition-only: `.env.local` não pode trocar o DB de aplicação da
readiness.

## 3.5 Redaction/cache

A implementação atual possui:

- operational cache TTL de 30 s;
- cache máximo de oito entries;
- no shared in-flight Promise;
- security proof separada do TTL operacional;
- proof vinculada a uma environment authority e a `contextId` não reutilizável por outra geração;
- fail-closed se o subprocesso devolve proof de outro contexto;
- initial/completed fingerprints obrigatoriamente iguais para cache;
- bounded SQLite redaction explícita; `deep` aumenta limite, não promete exhaustividade histórica;
- wire default compacto; `includeDetails=true` é opt-in.

## 3.6 Performance local certificada antes da publicação

O último rebaseline local da campanha anterior, antes da publicação, registrou no regime
`fresh-process + security proof reuse`:

```text
N=20
p50  = ~6.382 s
p95  = ~6.552 s
max  = ~6.569 s
lifecycle = 27 created / 27 terminated / current=0
cache hit = sub-millisecond
```

O SLO local rebaselineado foi p95 <= 7,0 s para esse regime. Esses números **não são acceptance
host-real**, pois o processo MCP atualmente conectado não carregou essa geração.

## 3.7 Publicação barrier histórico

A recertificação final chegou a 82 arquivos e passou:

- focused integrity/governance;
- MCP fast suite: 617/617;
- strict;
- lint;
- architecture;
- docs;
- Prettier;
- `git diff --check`;
- source fingerprint pré/pós idêntico.

Fingerprint histórico da última certificação de 82 arquivos:

```text
63f235434a3cd0fd560fb822b94f665ebee0cba8c64cb462bdbf16586d47f046
```

O manifest daquela validação era transitório (`/tmp`) e **não deve ser usado como artefato de reload
agora**. O reload exige manifest workspace-relative resolvível pela authority.

---

# 4. Evidência do runtime atualmente conectado

## 4.1 Processo stale

`mcp_runtime_health(includeDetails=true)` informou:

```text
status: degraded
processStartedAt: 2026-08-26T15:31:15.836Z
runtime/source drift: true
changed sampled paths: 2
```

Os dois paths amostrados como posteriores ao start foram:

```text
src/copilot/mcp/tools/repo-write.js
src/copilot/mcp/runtime/reload/runner.js
```

Arquivos centrais da nova readiness têm mtime posterior ao processo:

```text
2026-08-26 19:58:42 -0300 scripts/model-gateway/commands/model-gateway-live-readiness.mjs
2026-08-26 19:58:43 -0300 src/copilot/mcp/integrations/model-gateway/live-runs/readiness.js
2026-08-26 19:58:44 -0300 src/copilot/mcp/integrations/model-gateway/live-runs/runtime.js
```

Isso confirma que o processo conectado não poderia ter carregado a implementação final publicada.

## 4.2 Reprodução real do skew

A tool real, através do processo conectado, falhou com:

```text
ERR_LLMB_LIVE_READINESS
Cannot find module .../model-gateway-live-readiness-worker.mjs
```

A métrica runtime registrou aproximadamente 19,6 s para essa falha. Isso é especialmente ruim porque
uma geração conhecida como potencialmente stale não falha cedo: ainda consome tempo antes de chegar
ao artefato removido.

## 4.3 Por que isto é geração stale, e não bug do HEAD

Fatos simultâneos:

1. `HEAD` referencia `model-gateway-live-readiness.mjs`;
2. o arquivo existe;
3. `HEAD` não referencia `model-gateway-live-readiness-worker.mjs` em source live;
4. o documento predecessor registra explicitamente a remoção daquele worker;
5. o processo conectado tenta exatamente o worker removido;
6. o processo começou antes das alterações finais.

Conclusão causal:

```text
loaded module graph != current filesystem source
```

## 4.4 Limitação do diagnóstico de drift atual

`runtime-source-drift/runtime.js` é deliberadamente observacional e amostra só sete paths:

```text
registry/runtime.js
server/runtime.js
adapters/http/handler.js
tools/repo-write.js
protocol/tools/contracts/operation-context.js
runtime/reload/runner.js
auth/resource-server/service.js
```

Ele usa mtime versus process start. Não usa:

- source-barrier fingerprint carregado;
- Git commit carregado;
- closure por tool;
- hash do launcher físico esperado;
- deleted-artifact compatibility;
- promotion request id;
- runtime epoch certificado.

Portanto ele consegue dizer “alguma coisa mudou” mas não consegue provar “esta tool ainda é
compatível com o filesystem atual”.

## 4.5 Limitação do post-restart readiness atual

`readMcpPostRestartReadiness()` combina:

- processo MCP vivo;
- `cloudflared` vivo;
- local/public health;
- reload state;
- connector smoke posterior ao reload.

Hoje `ready` **não inclui** runtime source generation/source barrier reconciliation. Assim é
possível ter transporte saudável e, ao mesmo tempo, módulos carregados stale.

O próximo desenho deve distinguir pelo menos:

```text
transportReady
connectorReady
sourceGenerationReady
applicationReady
```

e só declarar readiness global quando os gates necessários forem satisfeitos.

---

# 5. Reload state atual e sua interpretação correta

`mcp_reload_status` retorna um reload antigo concluído:

```text
status: completed
profile: quic
exitCode: 0
completedAt: 2026-08-26T02:40:27.012Z
```

Esse reload é anterior à campanha publicada em `badea2716/dfbc8e0ce` e, portanto, não promove o
`HEAD` atual.

**Invariante nova:** `status=completed` isoladamente nunca poderá significar “source atual
carregado”. Um reload só prova a promoção de source quando houver correlação explícita entre:

```text
reload request
+ expected source fingerprint
+ process/runtime generation
+ smoke pós-reload
```

---

# 6. Source-barrier e promotion manifest

## 6.1 O que já existe

O owner `workspace/repository/integrity` implementa barrier v1:

```text
schema: copilot.repository-source-barrier
algorithm: sha256
domain: copilot.repository-source-barrier.v1
entries: 1..500 arquivos
cada entry: path + sha256 + bytes
fingerprint agregado domain-separated
```

`verify` lê bytes fresh, não cacheados, e qualquer divergência gera `ERR_SOURCE_DRIFT`.

Provenance de audit é apenas explicativa e nunca converte drift em sucesso.

## 6.2 Reload já é source-bound

A implementação atual de reload:

1. recebe `sourceBarrierManifest` + `expectedSourceFingerprint`;
2. verifica o manifest antes de persistir launch/spawn;
3. passa manifest + fingerprint para o detached runner;
4. o runner executa o restart através de:

```text
source-barrier run
  --manifest ...
  --expected-fingerprint ...
  --
  node stateful-env.js run copilot:mcp:<profile>:restart
```

5. o barrier verifica antes e depois do child.

## 6.3 Gap operacional atual

Os manifests usados nos benchmarks/publication barriers anteriores eram em `/tmp`. Porém
`mcp_reload_schedule` resolve o manifest pela workspace authority e espera caminho
workspace-relative. Logo, a promoção deve criar um novo manifest persistido dentro do workspace.

Convenção recomendada para o próximo ciclo:

```text
src/copilot/.ai/jobs/mcp-promotion-<short-head>.source-barrier.json
```

Razões:

- `.ai/jobs` já é ignorado pelo Git;
- os testes de reload usam essa família de path;
- cleanup automático só remove arquivos com **nome estritamente UUID** + `.json/.log`;
- um nome `mcp-promotion-*` não corresponde ao regex de cleanup e, portanto, não é removido pela
  manutenção normal;
- não mistura o manifest de promoção com OAuth keys/tokens em `.ai/mcp`.

Essa convenção ainda deve receber uma prova end-to-end real `capture -> verify -> reload schedule`
antes de ser declarada definitiva.

---

# 7. SQLite real — baseline read-only pós-publicação

Nesta auditoria foram feitas somente consultas read-only.

## 7.1 Fatos atuais confirmados

```text
user_version                  = 14
health_observations           = 177541
runtime_probe_results         = 143527
runtime_probe_runs            = 3564
runtime_health_latest         = 134
runtime_probe_latest          = 160
health latest dangling refs   = 0
probe latest dangling refs    = 0
```

Esses números coincidem com o estado restaurado ao final da investigação anterior.

## 7.2 O que NÃO foi certificado nesta rodada

Um `PRAGMA integrity_check` read-only contra o banco live foi iniciado, mas ultrapassou 30 s e o
comando foi encerrado pelo timeout do harness. Portanto:

- não houve write;
- não houve evidência de corrupção;
- mas também **não há novo integrity_check completo certificado nesta rodada**;
- não se deve reutilizar o último resultado histórico como se fosse uma verificação imediatamente
  pré-operação.

A próxima operação real sobre o DB exige um backup consistente e uma checagem completa com timeout
adequado/persistent session.

## 7.3 Por que retention continua bloqueada

A implementação de retention está pronta e foi amplamente testada, mas a operação real ainda deve
obedecer:

```text
source generation correta
-> host acceptance
-> backup consistente
-> integrity/FK/latest baseline imediato
-> retention chunked
-> post-op latest equivalence
-> integrity/FK
```

A retention nunca pode ser executada para “resolver” um problema de runtime generation.

---

# 8. Arquitetura externa relevante

## 8.1 Node.js 24 — subprocessos versus Workers

Documentação oficial consultada:

- `https://nodejs.org/docs/latest-v24.x/api/child_process.html`
- `https://nodejs.org/docs/latest-v24.x/api/worker_threads.html`

Princípios aplicáveis:

- `child_process.spawn()` é assíncrono e não bloqueia o event loop do parent;
- `env` deve ser explícito quando não se quer herdar `process.env`;
- lifecycle correto deve observar `close` para saber que stdio/child encerraram;
- Workers são adequados principalmente a JavaScript CPU-bound e não resolvem I/O pesado;
- `resourceLimits` de Worker limitam V8/heap, não toda memória externa/nativa do processo.

Isso sustenta a decisão já tomada de usar subprocesso como hard cancellation boundary da readiness
que executa native synchronous SQLite.

## 8.2 SQLite WAL/checkpoint

Documentação oficial consultada:

- `https://www.sqlite.org/wal.html`
- `https://www.sqlite.org/pragma.html#pragma_wal_checkpoint`

Princípios relevantes:

- WAL separa leitura, escrita e checkpoint;
- autocheckpoint padrão ocorre por threshold de páginas;
- `PASSIVE` faz o máximo possível sem esperar readers/writers e pode terminar incompleto;
- checkpoint continua podendo gerar pressão de I/O mesmo quando offloaded do event loop.

Isso sustenta a separação entre mutation transactions de retention e checkpoint async/process-safe.

---

# 9. Registro de bugs, gaps e riscos atuais

| ID            | Severidade | Estado                            | Problema                                                                                               | Evidência                                                    | Consequência                                                                      |
| ------------- | ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| RG-P0-01      | P0         | aberto até Faixa 2                | Runtime carregado pode divergir do source publicado                                                    | `llmb_live_readiness` tentou worker removido                 | tool executa código stale e falha tarde                                           |
| RG-P0-02      | P0         | fechado-local / ativa pós-restart | Runtime não possuía identity forte vinculada à promoção                                                | `RuntimeSourceGeneration` v1 + propagação/testes completos   | nova geração passa a declarar binding forte; runtime antigo ainda precisa restart |
| RG-P0-03      | P0         | aberto                            | Tool crítica não falha cedo quando runtime drift é conhecido                                           | erro de readiness levou ~19,6 s                              | desperdício, erro confuso, possível side effect em outras tools                   |
| RG-P0-04      | P0         | aberto                            | `mcp_post_restart_readiness.ready` não inclui source-generation reconciliation                         | código atual                                                 | transporte pode estar ready e aplicação stale                                     |
| RG-P1-05      | P1         | aberto                            | Reload state histórico não prova source atual                                                          | reload concluído 02:40 UTC, commits atuais 20:07/20:15 local | falsa confiança em `status=completed`                                             |
| RG-P1-06      | P1         | aberto                            | Runtime drift cobre só 7 arquivos e não a closure da readiness                                         | lista hardcoded                                              | drift específico pode passar despercebido                                         |
| RG-P1-07      | P1         | aberto                            | Drift usa mtime, não hash/fingerprint da geração                                                       | implementation v1                                            | timestamps não são identidade forte                                               |
| RG-P1-08      | P1         | aberto                            | Manifests históricos de validation estavam em `/tmp`, incompatíveis com reload via workspace authority | API de reload                                                | recapture obrigatório antes de promoção                                           |
| RG-P1-09      | P1         | aberto                            | Testes cobrem source atual e fixtures, mas não geração antiga carregada + artefato removido no disco   | suíte atual                                                  | regressão de generation skew não é reproduzida                                    |
| RG-P1-10      | P1         | aberto                            | Publication path enumeration pode omitir conteúdo de diretório untracked                               | incidente do primeiro commit                                 | remoto transitório incompleto                                                     |
| DB-P1-01      | P1         | aberto                            | Não há integrity/FK full imediatamente pré-promoção/operação real                                      | integrity atual excedeu harness 30 s                         | retention/reload sem rollback baseline seria inseguro                             |
| DB-P1-02      | P1         | aberto                            | Retention real intencional ainda não ocorreu                                                           | documento predecessor                                        | histórico continua acima do target 100k/ledger                                    |
| HOST-P1-01    | P1         | aberto                            | Acceptance host-real da geração publicada não ocorreu                                                  | runtime ainda stale                                          | local benchmark não prova operação real                                           |
| HOST-P1-02    | P1         | aberto                            | Connector smoke está stale no runtime health observado                                                 | warning runtime                                              | conexão precisa reconciliação pós-reload                                          |
| LIFE-P2-01    | P2         | residual                          | Sem fault test específico de production redaction Worker stuck após marker real                        | predecessor                                                  | cobertura indireta já existe, mas não específica                                  |
| LIFE-P2-02    | P2         | residual                          | Sem prova de process-host shutdown durante readiness ativa                                             | predecessor                                                  | caller cancellation já provada; host shutdown ainda não                           |
| MEM-P2-01     | P2         | residual                          | Sem OOM físico controlado do redaction Worker                                                          | predecessor                                                  | resource limits existem, OOM path não provado diretamente                         |
| DIAG-P2-01    | P2         | residual                          | Comparação literal registryDurationMs vs domainDurationMs ainda não publicada                          | predecessor                                                  | atribuição existe em fases separadas, ergonomia incompleta                        |
| DOC-P2-01     | P2         | aberto                            | READMEs ainda mencionam barrier histórico de 79 arquivos                                               | publicação terminou com 82                                   | documentação live parcialmente stale                                              |
| HYGIENE-P3-01 | P3         | aberto                            | `restart-control.js` contém cabeçalho/JSDoc e `// @ts-check` duplicados                                | leitura direta                                               | baixo risco, dívida de higiene                                                    |

---

# 10. Estado-alvo arquitetural

## 10.1 Princípio central

A verdade operacional deve ser uma cadeia verificável:

```text
Git target
  -> certified source manifest
  -> controlled reload request
  -> running process generation
  -> post-reload connector smoke
  -> LLM-B/Model Gateway acceptance
```

Nenhum elo pode ser inferido a partir de outro.

## 10.2 Runtime generation contract — v1 implementado na Faixa 1

O processo MCP agora compõe uma identidade imutável `McpRuntimeSourceGeneration` com:

```text
McpRuntimeSourceGeneration {
  schemaVersion: 1
  kind: 'mcp-runtime-source-generation'
  runtimeEpochId
  processStartedAtMs
  processStartedAt
  pid
  sourceBinding: 'controlled-promotion' | 'manual-unbound'
  promotionRequestId | null
  sourceBarrierFingerprint | null
  sourceBarrierManifestPath | null
}
```

A identidade é capturada **uma vez na composição/boot** por `mcp.composition.process-config`, fica
congelada e não depende de releitura de Git durante requests. `mcp.runtime.source-generation` é o
owner semântico/public surface; ele deliberadamente **não** possui `process.env` authority.

`loadedDescriptorFingerprint` não entrou no contrato v1 para evitar criar prematuramente uma segunda
autoridade de descriptor/source. A reconciliação explícita com descriptor/runtime drift permanece
trabalho das Faixas 3/5.

### Geração via controlled reload

O reload verificado projeta apenas três metadados não secretos e atômicos através das boundaries
internas de restart:

```text
COPILOT_MCP_PROMOTION_REQUEST_ID
COPILOT_MCP_PROMOTED_SOURCE_FINGERPRINT
COPILOT_MCP_PROMOTED_MANIFEST_PATH
```

A cadeia testada é reload runner -> source-barrier -> stateful bootstrap -> Cloudflare origin child
-> novo process config. Metadata parcial/malformada falha fechado e o runner inicial não herda
binding stale da geração anterior.

### Geração por startup manual

Se o MCP for iniciado fora do controlled reload:

```text
sourceBinding = manual-unbound
```

O sistema não fabrica fingerprint certificado. Isso é o comportamento esperado para o primeiro
restart manual deste checkpoint; a observabilidade passa a declarar explicitamente que a geração é
unbound, em vez de inferir frescor pelo `HEAD`.

## 10.3 Fail-closed para tools sensíveis a source generation

Uma tool que depende de launchers físicos, schemas ou files que podem ser removidos entre gerações
não deve continuar normalmente quando a geração é conhecida como stale.

Primeiro alvo obrigatório:

```text
llmb_live_readiness
```

Com runtime drift/source mismatch conhecido, o resultado ideal é rápido e explícito:

```text
ERR_RUNTIME_GENERATION_STALE
promotionRequired: true
loadedGeneration: ...
currentSource: ...
nextAction: controlled reload
```

Target inicial de fail-fast: ordem de centenas de ms, não dezenas de segundos.

A implementação futura deve evitar colocar um scan caro em toda tool call. Opções aceitáveis:

- capability de generation state calculada no boot + invalidation/cheap drift cache;
- contract flag em tools que dependem de source-generation freshness;
- guard no owner `live-runs` para o primeiro ciclo.

Escolher a solução que preserve ownership claro e não introduza cache global ornamental.

## 10.4 Post-restart readiness desejada

A readiness de conexão deve separar:

```text
transportReady
connectorReady
sourceGenerationReady
applicationReady
ready = combinação explícita dos gates necessários
```

Para controlled reload:

```text
running.promotedSourceFingerprint
  == reload.sourceBarrierFingerprint
```

mais smoke posterior ao reload.

## 10.5 Promotion manifest como artefato operacional

A promoção deve usar manifest workspace-relative persistido e ignorado pelo Git.

Proposta inicial:

```text
src/copilot/.ai/jobs/mcp-promotion-<short-head>.source-barrier.json
```

Ele deve ser recapturado se qualquer byte certificado mudar.

A Faixa 1 já valida e retransmite `sourceBarrierManifestPath` como parte do binding controlado e os
testes exercitam path workspace-relative. O lifetime/cleanup e a promoção host-real de um manifest
canônico permanecem conscientemente na Faixa 4; nenhum estado paralelo foi persistido nesta faixa.

## 10.6 Source set da promoção

Não confiar em enumeração textual de `git status` que possa colapsar diretórios untracked.

O source set deve ser derivado por mecanismo que resulte em **arquivos concretos**. Para a promoção
de bootstrap atual, usar um conjunto conservador que cubra todos os arquivos publicados desde a
geração conhecidamente anterior, mais launchers/composition owners necessários ao restart.

Quando a runtime generation authority existir, o conjunto poderá ser derivado de forma mais precisa
entre geração carregada e target.

---

# 11. Invariantes não negociáveis da nova campanha

1. **MD-first:** este roadmap é lido e atualizado continuamente.
2. **No hidden generation:** `HEAD` não implica runtime carregado.
3. **No stale-tool execution:** tools críticas devem falhar cedo quando a geração é stale.
4. **Source barrier is temporal:** validation de bytes A não certifica bytes B.
5. **Manifest must be persistent for reload:** `/tmp` não é promotion authority.
6. **No broad env inheritance:** subprocessos continuam recebendo projection explícita.
7. **Readiness stays provider-read-only:** provider secrets podem existir para inspeção/redaction,
   não para network calls.
8. **Hard cancellation boundary remains process-scoped:** não reintroduzir outer Worker para SQLite
   nativo.
9. **No shared in-flight readiness Promise:** cancellation de um caller não pode afetar outro.
10. **Security proof != operational cache:** lifetimes continuam separados.
11. **No readiness-side retention:** retention real nunca é efeito colateral de readiness/benchmark.
12. **No real DB operation without immediate backup/integrity gate.**
13. **No VACUUM in request path.**
14. **No source ceiling inflation as primeira resposta a hotspot:** extrair owners coerentes antes.
15. **No shim/legacy “temporário” sem necessidade demonstrada e documentação.**
16. **No commit/push enquanto barrier da faixa estiver vermelho.**
17. **No reload sem manifest + fingerprint que o runner realmente consiga resolver.**
18. **No acceptance global baseada apenas em HTTP/Cloudflare health.**
19. **No checkbox `[x]` sem nível de prova identificado.**
20. **Worktree clean + HEAD==origin/main é condição final, não inferência.**

---

# 12. Procedimento de atualização permanente deste arquivo

Após cada onda futura:

1. reler `# 0`, `# 9`, `# 11`, `# 14` e o último checkpoint;
2. registrar arquivos/owners alterados;
3. registrar testes e benchmarks com números, não “passou” genérico;
4. marcar checkboxes somente após evidência;
5. se uma descoberta mudar a arquitetura, atualizar estado-alvo **antes** de continuar;
6. adicionar novo risco ao registro em vez de escondê-lo em narrativa;
7. registrar source fingerprint usado em benchmark/promotion;
8. antes de commit/push, reconciliar este documento integralmente.

---

# 13. Sequência operacional alvo da promoção

A ordem abaixo é mandatória enquanto este roadmap vigorar:

```text
A. hardening de runtime-generation no source
B. validação local completa
C. commit/push e HEAD limpo/sincronizado
D. promotion manifest persistido para o target exato
E. DB pre-reload backup + integrity baseline
F. controlled reload source-bound
G. reconnect / reload status / smoke
H. source-generation reconciliation
I. 3x host-real fresh readiness + short-tool interleaving
J. cancellation host-real
K. includeSqliteRuntimeHealth host-real
L. control-only LLM-B harness
M. somente então retention real
N. post-retention integrity/latest equivalence
O. docs + commit/push final se a campanha gerou novas mudanças
```

---

# 14. Roadmap canônico detalhado

## Faixa 0 — Auditoria e novo documento canônico

**Objetivo:** estabelecer uma visão autossuficiente do estado pós-publicação antes de qualquer nova
transformação.

- [x] confirmar `main` limpo e sincronizado em `dfbc8e0ce`;
- [x] reler o documento predecessor e reconciliar pendências herdadas;
- [x] auditar source atual da readiness e launcher map;
- [x] chamar a tool real e reproduzir o runtime/source generation skew;
- [x] confirmar que o worker procurado pelo runtime não existe no `HEAD` por design;
- [x] auditar `mcp_runtime_health` e provar runtime drift;
- [x] auditar `mcp_reload_status` e provar que o reload persistido é histórico;
- [x] auditar source-barrier/reload runner;
- [x] auditar tests atuais de cancellation/cache/environment/reload;
- [x] auditar DB real em modo read-only para schema/count/latest pointers;
- [x] registrar que integrity completo atual ainda não foi obtido;
- [x] criar este novo MD com estado atual, alvo, riscos, invariantes e roadmap;
- [x] não transformar código nesta rodada.

**Gate 0:** documento novo existe, é autossuficiente e toda implementação posterior começa por ele.

---

## Faixa 1 — Runtime Generation Authority

**Objetivo:** fazer o processo em execução saber, de modo explícito e imutável, qual source
generation foi carregada/promovida.

### 1.1 Design

- [x] definir contrato `RuntimeSourceGeneration` e owner arquitetural;
- [x] decidir se o owner pertence a process composition/runtime diagnostics, evitando duplicação;
- [x] definir `controlled-promotion` versus `manual-unbound`;
- [x] definir `runtimeEpochId` único por processo;
- [x] definir transporte do `sourceBarrierFingerprint` do reload runner para o novo processo;
- [x] garantir que fingerprint/manifest path não tragam segredo;
- [x] impedir mutação da generation identity depois do boot.

### 1.2 Implementação

- [x] propagar promotion fingerprint/request id no environment/config allowlisted do restart child;
- [x] capturar generation identity durante process composition;
- [x] expor projeção compacta em runtime health;
- [x] persistir apenas o mínimo necessário para reconciliação, sem criar outra SSOT concorrente ao
      reload state — nesta faixa, nenhum novo estado durável foi necessário;
- [x] definir comportamento seguro para startup manual sem promotion fingerprint.

### 1.3 Testes

- [x] controlled promotion gera runtime binding exato;
- [x] manual boot retorna `manual-unbound` sem fabricar fingerprint;
- [x] rotação de processo produz novo `runtimeEpochId`;
- [x] geração é immutable depois de composta;
- [x] nenhuma credential aparece na serialização;
- [x] `mcp_runtime_health` projeta corretamente `controlled-promotion` em compact e detailed.

**Gate 1: [x] FECHADO LOCALMENTE.** É possível perguntar ao processo “qual source generation você
está executando?” e obter resposta forte/imutável, sem inferir pelo Git atual. A ativação dessa nova
verdade no MCP externo depende apenas do restart da geração atualmente conectada.

---

## Faixa 2 — Stale-generation fail-closed

**Objetivo:** impedir que uma tool crítica execute código/launchers stale quando o source on-disk já
é incompatível com a geração carregada.

### 2.1 Primeiro caso: `llmb_live_readiness`

- [ ] adicionar guard generation-aware antes do fingerprint/process spawn;
- [ ] retornar erro estável `ERR_RUNTIME_GENERATION_STALE` ou equivalente;
- [ ] incluir `promotionRequired=true` e next action curta;
- [ ] manter resposta sanitizada sem path/secret desnecessário;
- [ ] target de fail-fast < 250 ms em cache quente de generation/drift.

### 2.2 Compatibilidade física

- [ ] validar a mapping do launcher requerido pela geração atual;
- [ ] diferenciar `launcher-missing` de `runtime-generation-stale`;
- [ ] não restaurar `model-gateway-live-readiness-worker.mjs` como shim apenas para fazer o runtime
      antigo parar de falhar;
- [ ] provar que o source atual continua usando apenas `model-gateway-live-readiness.mjs`.

### 2.3 Regression reproduzindo o incidente real

Criar fixture que represente:

```text
loaded generation expects launcher A
filesystem target generation removed A and uses B
```

- [ ] tool recusa antes de spawn/trabalho caro;
- [ ] erro é generation-stale, não `MODULE_NOT_FOUND` tardio;
- [ ] lifecycle `created/current` de readiness subprocess não aumenta;
- [ ] short tool subsequente continua saudável.

### 2.4 Escopo futuro

- [ ] decidir se guard fica específico no owner live-runs ou vira contract genérico do registry;
- [ ] só generalizar se houver pelo menos mais uma classe concreta de tool que dependa de artefato
      físico versionado.

**Gate 2:** geração stale conhecida não consegue iniciar uma readiness longa nem procurar artefato
removido.

---

## Faixa 3 — Runtime-source drift v2

**Objetivo:** transformar o diagnóstico atual de “sete mtimes” numa evidência coerente com runtime
generation, preservando baixo custo.

- [ ] manter a leitura atual como fallback barato, mas não como proof de identidade;
- [ ] incorporar `runtimeEpochId` e promoted fingerprint;
- [ ] definir estado `fresh | drifted | unbound | unknown`;
- [ ] incluir Model Gateway live-runs/readiness entre boundaries críticos enquanto não houver
      closure identity melhor;
- [ ] preferir hash/generation binding a mtime como autoridade;
- [ ] cache de diagnóstico deve continuar curto e bounded;
- [ ] adicionar teste de arquivo removido, não apenas mtime posterior;
- [ ] adicionar teste de mudança de mesmo tamanho;
- [ ] provar que provenance nunca converte stale runtime em fresh.

**Gate 3:** runtime health consegue distinguir corretamente “source mudou” de “runtime foi promovido
para este source”.

---

## Faixa 4 — Promotion manifest e publication-set robustos

**Objetivo:** tornar o artefato de promoção persistente, reproduzível e livre da falha de enumeração
de diretório untracked.

### 4.1 Path canônico

- [ ] validar end-to-end `src/copilot/.ai/jobs/mcp-promotion-<short-head>.source-barrier.json`;
- [ ] provar que workspace authority lê esse path;
- [ ] provar que maintenance não o remove;
- [ ] documentar lifetime/cleanup explícito de manifests antigos.

### 4.2 Source set

- [ ] derivar arquivos concretos, expandindo untracked directories;
- [ ] nunca alimentar `git_publish_changes` com placeholder `?? dir/`;
- [ ] garantir que novo owner público + implementation sejam ambos enumerados;
- [ ] incluir launchers/reload/integrity owners relevantes na promoção bootstrap;
- [ ] respeitar limite de 500 entries ou definir mecanismo de closure manifest caso a campanha
      ultrapasse esse teto.

### 4.3 Testes

- [ ] regression de untracked directory com dois arquivos;
- [ ] manifest inclui ambos;
- [ ] publish/source barrier falha se um deles estiver ausente;
- [ ] path de promotion manifest é aceito pelo reload real em dry/fixture.

**Gate 4:** a mesma certificação que autoriza publish/reload contém todos os arquivos concretos que
se pretende promover.

---

## Faixa 5 — Post-restart readiness generation-aware

**Objetivo:** impedir `ready=true` quando só a rede/processo estão saudáveis, mas o runtime está
stale.

- [ ] adicionar `sourceGeneration` ao snapshot pós-restart;
- [ ] adicionar `sourceGenerationReady`;
- [ ] reconciliar `running fingerprint == reload fingerprint`;
- [ ] diferenciar `transportReady`, `connectorReady`, `sourceGenerationReady`, `applicationReady`;
- [ ] `ready` global deve exigir source generation correta quando o reload foi source-bound;
- [ ] reload antigo/histórico não pode reconciliar com `HEAD` posterior;
- [ ] smoke posterior ao reload continua obrigatório;
- [ ] next actions devem apontar `controlled reload` quando source generation for o blocker.

### Testes

- [ ] process alive + smoke fresh + generation mismatch => `ready=false`;
- [ ] generation match + smoke posterior => source gate verde;
- [ ] manual-unbound recebe semântica explícita e não é confundido com controlled promotion;
- [ ] reload state antigo não satisfaz source generation atual.

**Gate 5:** “post restart ready” passa a significar runtime correto, não só processo/túnel vivo.

---

## Faixa 6 — Pre-promotion DB safety gate

**Objetivo:** criar rollback/evidência imediatamente antes de reiniciar o runtime que pode executar
boot/reconciliation contra o DB real.

- [ ] confirmar espaço livre suficiente para backup consistente;
- [ ] escolher path de backup persistente e fora do arquivo live;
- [ ] criar backup por mecanismo SQLite consistente, não `cp` cru de DB+WAL em atividade;
- [ ] registrar tamanho/hash/timestamp do backup;
- [ ] rodar `integrity_check` completo no backup com timeout suficiente/persistent session;
- [ ] rodar `foreign_key_check`;
- [ ] registrar counts históricos;
- [ ] registrar counts/hash/identity das duas latest projections;
- [ ] confirmar `user_version=14`;
- [ ] confirmar zero dangling latest pointers;
- [ ] não executar retention nesta faixa.

**Baseline read-only atual para comparação:**

```text
health=177541
probes=143527
runs=3564
health_latest=134
probe_latest=160
latest dangling=0/0
```

**Gate 6:** existe um ponto de recuperação consistente e íntegro imediatamente anterior ao reload.

---

## Faixa 7 — Controlled promotion do source publicado

**Objetivo:** finalmente carregar no MCP o source correto que já está publicado em `main`.

### 7.1 Preflight

- [ ] worktree clean;
- [ ] `HEAD == origin/main`;
- [ ] source barrier persistido e verificado;
- [ ] fingerprint registrado neste MD;
- [ ] DB Gate 6 verde;
- [ ] `mcp_reload_plan(profile=current)` confirma target esperado;
- [ ] nenhuma validation/job de escrita em execução.

### 7.2 Schedule

- [ ] chamar `mcp_reload_schedule` com: - `sourceBarrierManifest`; - `expectedSourceFingerprint`; -
      `confirmRestart=true`; - reason contendo commit/fingerprint curto;
- [ ] registrar request id;
- [ ] permitir que a resposta retorne antes do restart;
- [ ] não executar sequência de tools durante a janela em que o processo está reiniciando.

### 7.3 Pós-reconexão

- [ ] ler `mcp_reload_status`;
- [ ] exigir `completed + exitCode=0`;
- [ ] confirmar source generation do processo novo;
- [ ] confirmar fingerprint igual ao manifest;
- [ ] confirmar `runtimeSourceDrift=false/fresh` no modelo novo;
- [ ] executar `mcp_connector_smoke_refresh`;
- [ ] executar `mcp_post_restart_readiness`;
- [ ] executar `mcp_runtime_health`.

**Gate 7:** processo MCP novo está comprovadamente executando o source certificado.

---

## Faixa 8 — Host-real LLM-B/Model Gateway acceptance

**Objetivo:** transformar o benchmark local em prova operacional no mesmo MCP que será usado
continuamente.

### 8.1 Readiness sequencial

- [ ] executar 3 fresh readiness reais consecutivas;
- [ ] entre elas invalidar/esperar cache apenas pelo mecanismo correto, não alterando DB
      artificialmente;
- [ ] registrar `execution`, duration e process lifecycle;
- [ ] target fresh operational p95 local de referência <= 7 s; host-real deve ser interpretado com
      contexto de I/O, mas regressão material precisa ser explicada;
- [ ] nenhuma tentativa pode referenciar o worker removido;
- [ ] nenhuma `TaskGroup/UNKNOWN` atribuída ao runtime da tool.

### 8.2 Interleaving

Após cada readiness:

- [ ] `git_status`;
- [ ] `mcp_runtime_health`;
- [ ] opcional tool de leitura curta equivalente;
- [ ] provar que a sessão continua responsiva.

### 8.3 Cancellation

- [ ] iniciar uma fresh readiness;
- [ ] cancelar deliberadamente após trabalho real ter iniciado;
- [ ] provar drain sem `MCP_TOOL_CANCELLATION_DRAIN_TIMEOUT`;
- [ ] provar `workMayContinue=false`;
- [ ] executar short tool imediatamente depois.

### 8.4 SQLite health mode

- [ ] repetir com `includeSqliteRuntimeHealth=true`;
- [ ] validar mesma DB authority;
- [ ] confirmar latest projections e redaction proof.

### 8.5 Memory/lifecycle

- [ ] `created == terminated`;
- [ ] `current=0` depois das calls;
- [ ] RSS/HWM sem crescimento monotônico;
- [ ] sem orphan child/process group.

**Gate 8:** LLM-B readiness é estável, cancelável e reutilizável no host-real promovido.

---

## Faixa 9 — Control-only LLM-B harness acceptance

**Objetivo:** provar que o control plane LLM-B continua funcional sem consumir provider/model usage.

- [ ] `llmb_live_test_plan` default = `control-only`;
- [ ] `invokesModel=false`;
- [ ] `invokesRealProvider=false`;
- [ ] execução control-only verde;
- [ ] persistência/summary da run legível via `llmb_live_runs`;
- [ ] nenhum provider real chamado;
- [ ] cancellation detached continua verificando PID identity antes de sinalizar.

Provider/model live somente se houver necessidade explícita posterior.

**Gate 9:** control plane funciona na geração promovida sem custo/provider authority desnecessários.

---

## Faixa 10 — Retention real intencional

**Objetivo:** aplicar a policy de histórico somente depois de toda a acceptance acima.

### 10.1 Pre-op imediato

- [ ] recapturar counts do DB real;
- [ ] recalcular quantas rows serão removidas; não assumir os números antigos;
- [ ] novo backup consistente se o Gate 6 estiver temporalmente distante;
- [ ] integrity/FK/latest baseline imediatamente antes;
- [ ] escolher janela de baixa atividade;
- [ ] confirmar que nenhum benchmark/readiness pesada está concorrendo.

### 10.2 Execução

- [ ] retention chunked usando owner canônico;
- [ ] `batchDeleteRows` conforme configuração validada;
- [ ] sem broad transaction;
- [ ] checkpoint async pelo owner Infra;
- [ ] coletar telemetry de batches, tx duration, busy, checkpoint duration e WAL;
- [ ] não executar VACUUM automaticamente.

### 10.3 Pós-op

- [ ] health <= target configurado;
- [ ] probes <= target configurado;
- [ ] runs dentro do target;
- [ ] latest counts preservados;
- [ ] latest keys/hashes equivalentes à baseline salvo writes legítimos posteriores identificados;
- [ ] zero dangling refs;
- [ ] integrity/FK verdes;
- [ ] readiness verde após a operação;
- [ ] short tools continuam responsivas.

**Gate 10:** histórico governado sem perda de estado latest nem degradação da sessão.

---

## Faixa 11 — Residuais de lifecycle/diagnóstico

Esses itens não devem bloquear a promoção se não houver evidência concreta de risco adicional, mas
devem ser avaliados após o host estar correto.

- [ ] decidir se vale adicionar marker de produção/test seam para redaction Worker stuck;
- [ ] se adicionado, fault test deve provar termination física;
- [ ] testar process-host shutdown durante readiness ativa sem introduzir API ornamental;
- [ ] avaliar OOM path controlado respeitando que Worker `resourceLimits` não cobre toda memória
      external/native;
- [ ] adicionar comparação interna direta `registryDurationMs` vs `domainDurationMs` se ela melhorar
      diagnóstico sem inflar wire;
- [ ] remover duplicação de cabeçalho em `restart-control.js`;
- [ ] reconciliar READMEs de 79 -> 82 arquivos históricos ou substituir pelo conceito correto de
      promotion manifest regenerado.

**Gate 11:** qualquer residual mantido aberto tem owner, justificativa e risco explicitamente
aceito.

---

## Faixa 12 — Documentation + final publication barrier

- [ ] reler este MD integralmente;
- [ ] atualizar todas as checkboxes;
- [ ] registrar todos os fingerprints/reload ids/benchmarks/DB evidence;
- [ ] atualizar Model Gateway README;
- [ ] atualizar MCP README;
- [ ] atualizar roadmap arquitetura 2.4/seguinte quando aplicável;
- [ ] strict completo verde;
- [ ] lint completo verde;
- [ ] architecture verde;
- [ ] docs contracts verdes;
- [ ] testes focais verdes;
- [ ] MCP fast/full conforme risco da onda;
- [ ] Prettier verde;
- [ ] `git diff --check` verde;
- [ ] source barrier pré/pós suite idêntico;
- [ ] nenhum arquivo untracked escondido por directory placeholder;
- [ ] commit/push somente após tudo acima;
- [ ] `git status` clean;
- [ ] `HEAD == origin/main`;
- [ ] ahead/behind `0/0`.

**Gate 12 / DoD FINAL:** todas as condições de `# 0.2` satisfeitas.

---

# 15. Procedimento concreto para o bootstrap da próxima rodada

A pessoa/LLM que assumir a próxima rodada deve começar exatamente assim:

## 15.1 Não executar readiness live imediatamente

Enquanto a geração atual estiver stale, a chamada conhecida falha no worker removido. Primeiro:

```text
repo_status
git_status
mcp_runtime_health(includeDetails=true)
mcp_reload_status
```

Registrar o estado neste MD.

## 15.2 Começar pela Faixa 1, não pelo reload imediato

É tentador simplesmente reiniciar agora. Porém isso esconderia o gap sistêmico que permitiu a tool
stale executar. Primeiro implementar pelo menos o mínimo de runtime-generation truth/fail-closed que
previna recorrência futura; validar e publicar esse source; depois executar a promoção controlada.

Exceção: se a sessão ficar inutilizável para desenvolver/validar, um reload de recuperação pode ser
necessário. Nesse caso ele deve ser registrado como **recovery reload**, não como fechamento dos
Gates 1–7.

## 15.3 Promotion manifest futuro

Forma de CLI esperada:

```bash
npm run copilot:mcp:source-barrier -- capture \
  --manifest src/copilot/.ai/jobs/mcp-promotion-<short-head>.source-barrier.json \
  <arquivo-1> <arquivo-2> ...
```

Depois:

```bash
npm run copilot:mcp:source-barrier -- verify \
  --manifest src/copilot/.ai/jobs/mcp-promotion-<short-head>.source-barrier.json \
  --expected-fingerprint <sha256>
```

Não usar `/tmp/...json` como manifest passado a `mcp_reload_schedule`.

## 15.4 Reload tool futuro

A tool exige conceitualmente:

```text
profile=current|quic|h2|auto
sourceBarrierManifest=<workspace-relative>
expectedSourceFingerprint=<64 hex>
confirmRestart=true
```

Após agendamento, aceitar que a conexão atual possa cair durante o restart. Depois da reconexão, a
primeira sequência é status/reconciliation, não nova transformação de código.

---

# 16. Test matrix mínima da próxima campanha

## Unit/domain

- runtime generation identity;
- source generation propagation no reload;
- stale readiness fail-fast;
- removed launcher artifact;
- source barrier manifest path;
- untracked-directory publication enumeration;
- post-restart generation mismatch;
- cache/proof regressions existentes;
- environment negative inheritance.

## Registry/process

- readiness cancellation nested worker;
- readiness cancellation native SQLite;
- timeout/output/abnormal exit;
- stale generation antes de spawn;
- independent concurrent callers.

## Architecture

- public membranes;
- owner governance;
- process/env authority;
- child process authority;
- mutable-state ratchets;
- package imports;
- hotspots/cost ratchets.

## Host-real

- reload fingerprint reconciliation;
- connector smoke;
- runtime health;
- 3 fresh readiness;
- short-tool interleaving;
- cancellation;
- SQLite health mode;
- control-only harness.

## Database

- consistent backup;
- integrity;
- FK;
- latest counts/keys;
- retention telemetry;
- post-op equivalence.

---

# 17. Critérios de rollback

## Runtime/source promotion

Abortar promoção se:

- barrier fingerprint divergir;
- worktree ficar dirty depois da validação;
- HEAD/upstream mudar;
- manifest não for resolvível;
- DB safety gate estiver incompleto;
- restart child sair não-zero;
- runtime fingerprint novo não reconciliar com o esperado;
- connector smoke pós-reload falhar.

## Database

Não restaurar arquivo inteiro automaticamente se houver writes legítimos posteriores sem antes fazer
forensics. O incidente anterior demonstrou que selective remediation pode ser mais segura do que
rollback total quando outras tabelas continuam recebendo writes.

Retention deve abortar/ser tratada como falha se:

- integrity/FK pré-op falhar;
- backup consistente falhar;
- busy/tx/checkpoint telemetry exceder thresholds definidos;
- latest projection divergir sem causa identificada;
- qualquer write atingir DB diferente do path explicitamente certificado.

---

# 18. Decisões que NÃO devem ser revertidas sem nova evidência

1. readiness outer boundary = subprocess, não Worker thread;
2. redaction workers podem continuar Worker threads dentro do subprocesso;
3. explicit child env authority;
4. `COPILOT_DB_PATH` process-owned;
5. schema v14 com latest projection tables;
6. migration current-version reopen deve ser no-op;
7. retention chunked;
8. checkpoint fora do event loop owner;
9. proof fingerprint-aware;
10. operational cache separado da security proof;
11. no shared single-flight readiness;
12. compact default wire;
13. source barrier fail-closed;
14. publish/reload source-bound;
15. architecture ceilings não sobem só para acomodar acoplamento novo.

---

# 19. Evidência histórica herdada — o que já está fechado localmente

Não reabrir estes tópicos sem regressão nova:

- causal retry ordering do health mirror;
- authoritative hydration/reconciliation;
- SQLite latest projections v14;
- query latest escalando até 500k/ledger sem scan histórico proporcional;
- reopen v14 sem data migrations idempotentes;
- retention chunking e query-plan indexes;
- async checkpoint capability no owner Infra;
- process boundary para hard cancellation de SQLite nativo;
- environment least privilege da readiness;
- redaction proof reuse/invalidation/race fail-closed;
- 30 s operational TTL com teste determinístico;
- compact wire < 16 KiB default no regime testado;
- lifecycle counters/fault classification;
- source barrier/provenance;
- publication barrier de 82 arquivos;
- Git final sincronizado antes desta nova campanha.

O fato de estes itens estarem fechados localmente **não fecha** host-real/promotion/retention real.

---

# 20. Checkpoint inicial desta nova campanha

**Data:** 2026-08-26  
**Tipo:** auditoria/documentação apenas  
**Código transformado nesta rodada:** nenhum  
**Novo MD:** este arquivo

## Estado

```text
Git source:        clean/synced @ dfbc8e0ce
Runtime MCP:       stale relative to source
Runtime health:    degraded por source drift + smoke antigo
LLM-B readiness:   BLOCKED no runtime atual por launcher removido esperado pela geração antiga
HEAD readiness:    usa subprocesso + model-gateway-live-readiness.mjs
DB real:           v14; counts/latest pointers coerentes; full integrity atual ainda não recertificado
Reload state:      completed, mas histórico e não correspondente ao HEAD atual
Retention real:    ainda não executada intencionalmente
```

## Próxima ação canônica

A Faixa 1 está concluída. Quando este roadmap sair da pausa, retomar pela **Faixa 2 —
stale-generation fail-closed**.

Não começar pela retention. Não reintroduzir o worker removido. Não tratar
`mcp_reload_status=completed` como prova de source atual carregado.

## 20.1 Checkpoint de pausa após a Faixa 1

**Data de fechamento local:** 2026-08-26/27  
**Estado da Faixa 1:** concluída; Gate 1 verde  
**Estado do roadmap global:** conscientemente pausado após esta faixa; Faixas 2–12 continuam abertas

### Implementação fechada

- novo owner protegido `mcp.runtime.source-generation` e public membrane micro;
- `McpRuntimeSourceGeneration` v1 imutável, process-stable e observável;
- `controlled-promotion` e `manual-unbound` explícitos;
- promotion request/fingerprint/manifest propagados somente por environment/config allowlisted;
- `process-config` continua autoridade singular de `process.env`;
- source-barrier retransmite a identity do process snapshot, sem reler ambient env;
- runtime-health compact preserva budget histórico e detailed expõe o contrato completo;
- public API passou de 76 para 77 aliases com baseline específica do novo alias:
  `2 modules / 8.914 bytes`, headroom `3 / 13.371`, zero package externo.

### Evidência de validação final

```text
mcp-full safe suite:          GREEN
MCP unit files:               109/109
MCP unit tests:               624/624
strict TS7 src/copilot:       GREEN
lint:copilot:                 GREEN
docs-contract:                GREEN
architecture contract:        GREEN (257 checks)
owner governance:             GREEN (69 owners; 0 SCC; 0 mismatch)
public API cost/purity:       GREEN (77 aliases; 0 violation)
surface governance:           GREEN (77 public aliases; 0 violation)
cold-import governance:       GREEN
git diff --check:             GREEN
```

O primeiro `mcp-full` encontrou somente um ratchet legítimo ainda fixado em 76 aliases; o teste foi
atualizado para 77 e a suíte completa foi repetida do zero com 624/624 verde.

### Estado externo pré-restart

```text
mcp_connection_readiness:     ready=true; blockers=[]
public MCP URL:                https://mcp.aurelin.org/mcp
Cloudflare remote config:     coerente
named tunnel:                 saudável; 4 conexões HA
DNS/origin:                    corretos; HTTPS loopback + HTTP/2 origin
workspace smoke:              critical=[]; único warning = worktree dirty pré-commit
```

`mcp_cloudflare_post_change_gates` ainda observa smoke histórico (~22 h) e erros acumulados do
**runtime/túnel antigo**. Isso não é configuração remota divergente e deve ser recertificado somente
após publicar este checkpoint, reiniciar MCP/Cloudflare e executar smoke novo. Não marcar host-real,
Faixa 5 ou DoD global com essa evidência pré-restart.

### Procedimento seguro para o interregno

1. publicar este checkpoint e exigir `HEAD == origin/main` + worktree clean;
2. reiniciar o perfil permanente QUIC/Cloudflare a partir do commit publicado;
3. no novo runtime, esperar `sourceBinding=manual-unbound` porque este primeiro restart é manual;
4. executar connector smoke novo e `mcp_post_restart_readiness`/post-change gates;
5. somente então reconectar/atualizar o conector em `chatgpt.com`;
6. durante a pausa do roadmap, qualquer nova edição de source runtime-critical MCP/LLM-B exige novo
   restart antes de usar aquela superfície; o fail-closed automático para stale generation continua
   sendo explicitamente a Faixa 2.

Nenhuma retention real, migration nova, VACUUM ou outra operação destrutiva no DB real foi executada
para fechar a Faixa 1; portanto não houve motivo para criar novo backup físico nesta etapa.

---

# 21. Referências de código essenciais

Quem chegar ao projeto deve começar por estes arquivos:

```text
src/copilot/mcp/integrations/model-gateway/live-runs/contracts.js
src/copilot/mcp/integrations/model-gateway/live-runs/environment.js
src/copilot/mcp/integrations/model-gateway/live-runs/readiness.js
src/copilot/mcp/integrations/model-gateway/live-runs/runtime.js
src/copilot/mcp/tools/llm-b-live.js
scripts/model-gateway/commands/model-gateway-live-readiness.mjs
scripts/model-gateway/commands/model-gateway-live-redaction-worker.mjs
src/copilot/model-gateway/readiness/live-readiness.js
src/copilot/model-gateway/catalog/sqlite-catalog-store.js
src/copilot/model-gateway/catalog/sqlite-operational-retention.js
src/copilot/model-gateway/catalog/sqlite-schema-migration.js
src/copilot/mcp/diagnostics/runtime-source-drift/runtime.js
src/copilot/mcp/diagnostics/runtime-health/runtime.js
src/copilot/mcp/runtime/source-generation/runtime.js
src/copilot/mcp/runtime/source-generation/public/index.js
src/copilot/mcp/connection/readiness.js
src/copilot/mcp/runtime/reload/plan.js
src/copilot/mcp/runtime/reload/runner.js
src/copilot/mcp/runtime/reload/state.js
src/copilot/mcp/tools/restart-control.js
src/copilot/mcp/workspace/repository/integrity/runtime.js
src/copilot/mcp/scripts/source-barrier.js
src/copilot/mcp/scripts/scheduled-restart-runner.js
src/copilot/mcp/scripts/stateful-env.js
```

Testes-chave:

```text
tests/unit/copilot/mcp/test_mcp_llmb_readiness_registry_cancellation.spec.js
tests/unit/copilot/mcp/test_mcp_llmb_readiness_cache.spec.js
tests/unit/copilot/mcp/test_mcp_model_gateway_live_run_boundaries.spec.js
tests/unit/copilot/mcp/test_mcp_model_gateway_live_command_lifecycle.spec.js
tests/unit/copilot/mcp/test_mcp_model_gateway_sqlite_fingerprint.spec.js
tests/unit/copilot/mcp/test_mcp_reload_state.spec.js
tests/unit/copilot/mcp/test_mcp_source_barrier.spec.js
tests/unit/copilot/mcp/test_mcp_runtime_source_generation.spec.js
tests/unit/copilot/mcp/test_mcp_runtime_metrics.spec.js
tests/unit/copilot/mcp/test_mcp_child_environment_boundaries.spec.js
tests/unit/copilot/mcp/test_mcp_stateful_env.spec.js
tests/unit/copilot/mcp/test_mcp_server_child_environment.spec.js
tests/unit/copilot/mcp/test_mcp_autonomy_mutations.spec.js
tests/unit/copilot/model-gateway/test_model_gateway_runtime_health_storage.spec.js
```

---

# 22. Conclusão arquitetural

A campanha anterior resolveu o problema que parecia central — readiness pesada, cancellation e
SQLite history — e publicou um source localmente consistente. A auditoria pós-publicação mostrou que
havia uma camada acima ainda não formalizada: **a identidade entre o source que foi
validado/publicado e a geração que o processo MCP efetivamente carregou**.

A Faixa 1 agora formaliza essa camada: a nova geração do processo passará a declarar sua identity de
source como `controlled-promotion` ou `manual-unbound`, com epoch imutável e observabilidade
explícita. O problema arquitetural prioritário remanescente é impedir execução stale automaticamente
(Faixa 2) e, depois, reconciliar essa identity com drift/readiness/host acceptance sem inferências.

O estado ideal não é “reiniciar sempre que algo parecer stale”. O estado ideal é:

```text
source validated
  -> source published
  -> source fingerprint promoted
  -> runtime records that fingerprint
  -> connection readiness verifies it
  -> sensitive tools fail closed if it diverges
```

Quando essa cadeia estiver estabelecida, o reload deixa de ser uma operação administrativa implícita
e vira uma **transição verificável de geração**. Só então faz sentido usar a readiness host-real
como gate para a retenção física do banco.

Este documento permanece canônico, porém entra deliberadamente em pausa após o checkpoint local da
Faixa 1. Quando a campanha for retomada, a continuação começa pela Faixa 2; o DoD FINAL da Faixa 12
não é considerado concluído por este checkpoint.
