# WORKSPACE MCP — ROUND-TRIP, HOT TOOLS, BATCH E ORQUESTRAÇÃO

## Auditoria profunda, programa de correções, programa de upgrades e governança permanente — 2026-08-26

> **Status do documento:** CANÔNICO / VIVO / REFERÊNCIA OBRIGATÓRIA.
>
> **Revisão documental:** 6.1 — **ROADMAP II CONCLUÍDO E PUBLICADO**. Roadmap I permanece concluído
> e publicado; Roadmap II foi rebaselineado sobre cohorts pós-I, II-1/II-2 foram promovidos por
> evidência controlada e II-3→II-11 receberam disposição formal por evidência. A implementação foi
> publicada em `36006c8e19ee43d417aa6c7f2917062b39e27b0f`; esta revisão 6.1 fecha apenas a
> sincronização documental pós-publicação.
>
> **Workspace:** `/workspaces/chatgpt-docker-puppeteer`.
>
> **Foco:** `src/copilot`, especialmente `src/copilot/mcp`, com prioridade empírica para as tools
> que dominam o uso real do AURELIN 4: `terminal_exec`, `repo_read_file`, `repo_bulk_inspect`,
> `repo_search_text`, `repo_apply_patch_batch` e `repo_apply_patch`.
>
> **Baseline Git da auditoria original:** `main`, `HEAD = fad6aab1a`, `main == origin/main`,
> worktree limpa antes da criação deste arquivo.
>
> **Conector observado:** AURELIN 4 / MCP permanente em Cloudflare / OAuth.
>
> **Protocolo MCP observado:** `2026-07-28`.
>
> **Snapshot quantitativo principal congelado:** `2026-08-27T02:00:00Z`, equivalente a
> `2026-08-26T23:00:00-03:00` em `America/Sao_Paulo`.
>
> **Escopo desta revisão:** investigação, implementação, promoção live, disposição evidence-gated e
> encerramento técnico do Roadmap II, preservando o Roadmap I como fundação já publicada.

---

# Índice

1. [Contrato de governança deste documento](#1-contrato-de-governança-deste-documento)
2. [Decisão arquitetural: dois roadmaps sequenciais](#2-decisão-arquitetural-dois-roadmaps-sequenciais)
3. [Síntese executiva](#3-síntese-executiva)
4. [Escopo, não-objetivos e critérios epistemológicos](#4-escopo-não-objetivos-e-critérios-epistemológicos)
5. [Glossário operacional](#5-glossário-operacional)
6. [Metodologia e autoridades de evidência](#6-metodologia-e-autoridades-de-evidência)
7. [Baseline quantitativo das hot tools](#7-baseline-quantitativo-das-hot-tools)
8. [O dado de 22,586 h: confirmação matemática e limite semântico](#8-o-dado-de-22586-h-confirmação-matemática-e-limite-semântico)
9. [Relações entre hot tools](#9-relações-entre-hot-tools)
10. [Auditoria aprofundada do plano de medição](#10-auditoria-aprofundada-do-plano-de-medição)
11. [Auditoria de execution accounting e batching](#11-auditoria-de-execution-accounting-e-batching)
12. [Auditoria de guidance e decisão do modelo](#12-auditoria-de-guidance-e-decisão-do-modelo)
13. [Auditoria de failure semantics e recovery](#13-auditoria-de-failure-semantics-e-recovery)
14. [Auditoria de payload e framing](#14-auditoria-de-payload-e-framing)
15. [Auditoria por hot tool](#15-auditoria-por-hot-tool)
16. [Inventário canônico de achados](#16-inventário-canônico-de-achados)
17. [Estado-alvo após o Roadmap I](#17-estado-alvo-após-o-roadmap-i)
18. [ROADMAP I — correções de bugs e gaps comprovados](#18-roadmap-i--correções-de-bugs-e-gaps-comprovados)
19. [Gate obrigatório entre Roadmap I e Roadmap II](#19-gate-obrigatório-entre-roadmap-i-e-roadmap-ii)
20. [Estado-alvo de evolução](#20-estado-alvo-de-evolução)
21. [ROADMAP II — upgrades evidence-gated](#21-roadmap-ii--upgrades-evidence-gated)
22. [Experimentos controlados e indicadores](#22-experimentos-controlados-e-indicadores)
23. [Gates de validação, rollout e publicação](#23-gates-de-validação-rollout-e-publicação)
24. [O que não fazer](#24-o-que-não-fazer)
25. [Definition of Done da frente](#25-definition-of-done-da-frente)
26. [Registro de evolução do documento](#26-registro-de-evolução-do-documento)
27. [Fontes e arquivos auditados](#27-fontes-e-arquivos-auditados)
28. [Conclusão](#28-conclusão)

---

# 1. Contrato de governança deste documento

Este arquivo não é um relatório descartável. A partir desta revisão, ele passa a ser a **fonte
canônica de planejamento, evidência e progresso da frente de redução de round trips/hot-tool
orchestration do WORKSPACE MCP**.

## 1.1 Obrigatoriedade

Toda rodada futura que altere comportamento relacionado a esta frente deve:

1. ler este documento antes de iniciar a onda relevante;
2. confrontar o estado real do código e do runtime com o que o documento afirma;
3. atualizar o inventário de achados quando aparecer evidência nova;
4. atualizar checkboxes somente quando houver prova correspondente;
5. registrar métricas before/after quando a mudança tiver objetivo mensurável;
6. registrar hipótese rejeitada ou reformulada quando a investigação mudar a interpretação anterior;
7. atualizar o documento **na mesma rodada** em que a implementação mudar seu estado;
8. preservar a distinção entre correção comprovada e upgrade experimental;
9. jamais declarar a frente concluída apenas porque o código foi alterado; os gates e a evidência
   precisam fechar.

## 1.2 Regra de evidência para checkboxes

Um checkbox `[x]` significa **concluído e provado**, não “código escrito”. Quando aplicável, deve
existir combinação de:

- inspeção do código final;
- teste focado;
- validação estática;
- métrica runtime;
- A/B ou baseline comparável;
- live connector gate;
- atualização documental.

`[~]` é permitido apenas para capacidade parcialmente existente ou rollout parcial claramente
descrito.

## 1.3 Novos achados têm precedência sobre o plano antigo

O roadmap é obrigatório como referência, mas **não é uma ordem cega de implementação**. Se uma
investigação posterior demonstrar que:

- uma hipótese estava errada;
- um bug tem causa diferente;
- um upgrade deixou de fazer sentido;
- surgiu uma correção de prioridade maior;
- uma solução planejada cria regressão de segurança, compatibilidade ou resource pressure;

este documento deve ser atualizado primeiro ou na mesma onda, com a justificativa explícita.

## 1.4 Liberdade de implementação

As faixas e subfases são o plano mínimo conhecido. A implementação futura pode adicionar correções,
testes, abstrações ou refactors não listados quando necessários para atingir o estado-alvo, desde
que:

- sejam coerentes com a arquitetura do projeto;
- não relaxem invariants de segurança/correctness;
- sejam documentados aqui;
- não sejam usados como desculpa para antecipar upgrades do Roadmap II antes do gate.

## 1.5 Ordem normativa

```text
AUDITORIA / DOCUMENTO
        ↓
ROADMAP I — CORREÇÕES
        ↓
DoD + GATE I→II
        ↓
ROADMAP II — UPGRADES
        ↓
DoD FINAL
```

**A implementação de upgrades do Roadmap II fica bloqueada até o Roadmap I estar concluído.**
Investigações necessárias para executar o próprio Roadmap I obviamente continuam permitidas; a
investigação específica de cada upgrade será feita quando o Roadmap II começar.

---

# 2. Decisão arquitetural: dois roadmaps sequenciais

O roadmap original misturava três categorias diferentes:

1. bugs e gaps já demonstrados;
2. instrumentation necessária para tornar as métricas confiáveis;
3. upgrades promissores que ainda precisam de nova investigação e A/B.

Essa mistura criava risco de implementar otimizações antes de corrigir a autoridade de medição usada
para julgá-las.

A nova divisão é deliberada.

## 2.1 Roadmap I — Correções

Inclui somente problemas cuja deficiência já está comprovada ou cuja ausência impede medir
corretamente o sistema atual. Exemplos:

- `callId` existe no audit raw, mas é descartado pelo índice derivado;
- o summary usa estado global para parear transições;
- recovery também usa `pendingFailure` global;
- `terminal_exec.batch` não produz execution hint;
- execution hints process-local não chegam ao audit histórico;
- guidance de validação é contraditória;
- failure taxonomy de patch é conhecida, mas path-resolution bypassa essa taxonomy;
- o limite de 100.000 rows do summary pode tornar uma janela incompleta sem sinalizar incompletude;
- nomes como `compressedRoundTrips` são semanticamente mais fortes que a evidência disponível.

O objetivo do Roadmap I é **verdade, coerência, observabilidade e eliminação de desperdícios já
comprovados**.

## 2.2 Roadmap II — Upgrades

Inclui mudanças de capacidade/comportamento que parecem valiosas, mas cuja forma ótima ou benefício
líquido ainda precisam ser investigados. Exemplos:

- heavy structured result framing compacto;
- terminal long-poll;
- machine outcome contract transversal;
- search hydration;
- Working Set V3;
- Shadow Round-Trip Advisor;
- adaptive tool surface;
- aumento de batch caps/budgets;
- novos bounded composites.

O objetivo do Roadmap II é **reduzir round trips comprovadamente evitáveis**, já apoiado por
métricas confiáveis produzidas pelo Roadmap I.

---

# 3. Síntese executiva

O MCP local já é rápido na maior parte dos handlers de repositório. O custo interativo dominante
continua sendo o período entre uma resposta de tool e a próxima chamada, mas o sistema atual ainda
não consegue separar com rigor:

```text
raciocínio legítimo
polling
paginação/continuation
recovery
fragmentação por baixa adoção de batch
fragmentação por cap/budget
workflow diferente que chegou em seguida
round trip realmente evitável
```

As primitives centrais já são fortes:

- `repo_read_file.batch`;
- `repo_search_text.batch`;
- `repo_bulk_inspect` heterogêneo;
- `repo_apply_patch_batch` com até 128 operações / 64 targets;
- `repo_apply_patch_batch.postValidate`;
- `terminal_exec.batch` com até 32 comandos;
- validator batch e inline completion;
- `git_publish_changes` one-shot;
- `repo_working_set` com delta refresh;
- fail-rich patch;
- round-trip analytics incremental em SQLite.

Portanto, a frente não deve começar criando uma mega-tool ou elevando limites. Primeiro deve
corrigir o **plano de verdade**.

Na janela congelada de 7 dias existem **12.485 tool starts**. Seis tools concentram **10.462 starts
= 83,80%**:

| tool                     |  starts 7d |      share |
| ------------------------ | ---------: | ---------: |
| `terminal_exec`          |      4.577 |     36,65% |
| `repo_read_file`         |      1.414 |     11,33% |
| `repo_bulk_inspect`      |      1.296 |     10,38% |
| `repo_search_text`       |      1.255 |     10,05% |
| `repo_apply_patch_batch` |      1.152 |      9,23% |
| `repo_apply_patch`       |        768 |      6,15% |
| **Total**                | **10.462** | **83,80%** |

O número que motivou a revisão foi confirmado:

```text
terminal_exec → terminal_exec
3.275 transições / 7d
81.310.080 ms de gaps somados
= 22,586 h de aggregate gap pressure
```

Mas **não são 22,586 h de tempo perdido nem 22,586 h recuperáveis**. O algoritmo histórico atual não
possui lineage suficiente para essa afirmação.

A auditoria complementar desta revisão encontrou dois gaps adicionais relevantes:

1. o problema de lineage também contamina o **recovery analytics**, porque existe apenas um
   `pendingFailure` global, sem workflow/trace/target;
2. `MAX_SUMMARY_ROWS = 100_000` limita a leitura de uma janela e o SQL usa
   `ORDER BY ts ASC LIMIT 100000`; se a janela crescer acima desse volume, o summary passa a
   representar apenas o prefixo mais antigo sem publicar uma marca de incompletude.

Também foi refinada uma conclusão anterior: duplicação de `structuredContent` + `content.text` em
heavy outputs é uma oportunidade real de eficiência, mas a mudança de framing deve permanecer no
**Roadmap II**, porque existe uma dimensão de compatibilidade MCP/client que precisa ser validada em
A/B antes de remover redundância deliberada.

---

# 4. Escopo, não-objetivos e critérios epistemológicos

## 4.1 Escopo

Esta frente cobre:

- round trips entre host/model/orchestrator e MCP;
- hot-tool frequency;
- batch adoption;
- self-loops;
- inspect↔patch↔terminal;
- recovery e follow-up;
- payload/context pressure;
- guidance que influencia escolha de tools;
- métricas causais;
- composição bounded;
- critérios de rollout e de regressão.

## 4.2 Não-objetivos desta rodada documental

Nesta revisão não são realizados:

- refactors de código;
- alterações de schema/runtime;
- aumento de caps;
- criação de composites;
- alteração Cloudflare/OAuth;
- reload/reconnect;
- commit/push.

A única mutação da rodada é este MD.

## 4.3 Classes de evidência

Todo achado deve ser tratado segundo uma destas classes:

### PROVADO — BUG

Há comportamento objetivamente incorreto em relação ao contrato ou à própria semântica declarada.

### PROVADO — GAP

Uma capacidade/telemetria necessária está ausente, ainda que o comportamento operacional principal
continue correto.

### PRESSURE SIGNAL

A métrica mostra concentração ou repetição, mas não prova causalidade ou desperdício.

### UPGRADE CANDIDATE

Existe mecanismo plausível de melhoria, mas benefício líquido e desenho precisam ser investigados.

### HIPÓTESE REJEITADA

A evidência disponível contradiz a interpretação simplista anterior.

A distinção é normativa: **pressure signal não pode ser promovido diretamente a implementação do
Roadmap II**.

---

# 5. Glossário operacional

## Tool call

Uma invocação MCP `tools/call` observada pelo origin.

## Operação lógica

Unidade de trabalho executada dentro de uma tool. Doze reads em um batch são doze logical operations
em uma tool call.

## Coalesced logical operation

Operação lógica adicional executada dentro da mesma call além da primeira. É mensurável como:

```text
max(0, logicalOperations - calls)
```

Isso **não prova** que a operação exigiria um round trip separado no contrafactual.

## Gap inter-tool

Intervalo temporal entre conclusão de uma tool e início da próxima segundo a autoridade observada.

## Aggregate gap pressure

Soma de gaps de uma classe de transição. Não é wall-clock exclusivo, saved time ou wasted time.

## Lineage-bound gap

Gap em que as duas calls possuem evidência suficiente de pertencer à mesma trace/workflow.

## Round trip evitável

Só pode ser classificado assim quando houver evidência de que operações poderiam ter sido agrupadas
sem depender de informação semântica produzida entre elas e sem comprometer segurança/correctness.

## Saturação

Uso do limite material de uma batch/tool, seja item cap, byte budget ou output cap.

## Continuation

Follow-up exigido por cursor, truncation, output restante ou outra limitação mecânica explicitamente
retornada.

---

# 6. Metodologia e autoridades de evidência

Foram combinadas as seguintes autoridades:

1. `mcp_latency_dashboard` da geração corrente;
2. `mcp_round_trip_analytics` / índice SQLite derivado;
3. queries read-only ao `data/copilot.sqlite` para reproduzir e decompor métricas;
4. audit raw JSONL;
5. inspeção direta do código-fonte;
6. inspeção dos testes existentes;
7. documentação oficial MCP 2026-07-28.

Arquivos centrais auditados incluem:

- `src/copilot/mcp/diagnostics/latency/round-trip/normalizer.js`;
- `.../summary.js`;
- `.../analytics.js`;
- `src/copilot/mcp/diagnostics/latency/dashboard/runtime.js`;
- `src/copilot/mcp/registry/runtime.js`;
- `src/copilot/mcp/protocol/tools/contracts/operation-context.js`;
- `src/copilot/mcp/protocol/tools/contracts/result.js`;
- `src/copilot/mcp/tools/terminal.js`;
- `src/copilot/mcp/process/terminal/runtime.js`;
- `src/copilot/mcp/tools/repo-read.js`;
- `src/copilot/mcp/workspace/repository/read-cache/runtime.js`;
- `src/copilot/mcp/workspace/repository/read/navigation.js`;
- `src/copilot/mcp/workspace/repository/patch/failure-semantics.js`;
- `src/copilot/mcp/workspace/repository/patch/operations.js`;
- `src/copilot/mcp/tools/session-profile.js`;
- `src/copilot/mcp/tools/tools-status.js`;
- `src/copilot/mcp/tools/meta.js`;
- `tests/unit/copilot/mcp/test_mcp_round_trip_analytics.spec.js`.

## 6.1 Nota MCP 2026

No MCP `2026-07-28`, o core protocolar é stateless; `initialize`/`initialized` e `Mcp-Session-Id`
foram retirados para essa era. Cada request carrega sua própria informação de protocolo/client.
Portanto, não devemos reconstruir causalidade futura supondo sessão protocolar.

O `OperationContext` local já captura:

```text
requestId
protocolEra
requestMeta = mcpReq._meta
requestEnvelope
```

Logo, se o host propagar W3C trace context em `_meta`, a infraestrutura necessária para enxergá-lo
já atravessa a boundary. O trabalho de correção é **extrair e sanitizar**, não criar nova sessão.

Por privacidade, o estado-alvo **não deve persistir `traceparent`, `tracestate` ou `baggage` crus**.
A investigação de implementação deve extrair apenas a identidade mínima necessária, validar formato
e derivar uma chave de correlação bounded/pseudonimizada. `tracestate` e `baggage` não são
necessários para o objetivo de round-trip analytics e devem permanecer fora do índice por default.

---

# 7. Baseline quantitativo das hot tools

## 7.1 24 horas

No snapshot congelado:

```text
total starts = 1.713
hot six = 1.282
share = 74,84%
```

| tool                     | starts 24h | self-loop | self-loop / starts |
| ------------------------ | ---------: | --------: | -----------------: |
| `terminal_exec`          |        361 |       113 |              31,3% |
| `repo_read_file`         |        338 |        66 |              19,5% |
| `repo_search_text`       |        258 |        58 |              22,5% |
| `repo_apply_patch_batch` |        148 |        27 |              18,2% |
| `repo_apply_patch`       |        102 |        16 |              15,7% |
| `repo_bulk_inspect`      |         75 |        13 |              17,3% |

## 7.2 Sete dias

```text
total starts = 12.485
hot six = 10.462
share = 83,80%
```

| tool                     | starts |  share | self-loop | self-loop / starts | aggregate self-loop pressure |
| ------------------------ | -----: | -----: | --------: | -----------------: | ---------------------------: |
| `terminal_exec`          |  4.577 | 36,65% |     3.275 |             71,55% |                     22,586 h |
| `repo_read_file`         |  1.414 | 11,33% |       276 |             19,52% |                      0,998 h |
| `repo_bulk_inspect`      |  1.296 | 10,38% |       472 |             36,42% |                      2,992 h |
| `repo_search_text`       |  1.255 | 10,05% |       325 |             25,90% |                      ~1,13 h |
| `repo_apply_patch_batch` |  1.152 |  9,23% |       232 |             20,14% |                      1,454 h |
| `repo_apply_patch`       |    768 |  6,15% |       263 |             34,24% |                      0,791 h |

## 7.3 Quatorze dias

```text
total starts = 35.535
hot six = 24.234
share = 68,20%
```

Distribuição:

- `terminal_exec`: 5.568;
- `repo_read_file`: 5.664;
- `repo_search_text`: 4.594;
- `repo_apply_patch`: 4.512;
- `repo_apply_patch_batch`: 2.154;
- `repo_bulk_inspect`: 1.742.

A mudança de shares entre 14d e 7d é também mudança de workload/campanha. Não usar como A/B
automático.

---

# 8. O dado de 22,586 h: confirmação matemática e limite semântico

A matemática foi reproduzida diretamente no índice derivado:

```text
terminal_exec → terminal_exec
count = 3.275
sum(gapMs) = 81.310.080 ms
81.310.080 / 3.600.000 = 22,586133... h
p50 ≈ 17.938 ms
p95 ≈ 66.734 ms
```

Distribuição acumulada:

| threshold | calls | share |     soma | share da soma |
| --------- | ----: | ----: | -------: | ------------: |
| ≤ 10 s    |   249 |  7,6% |  0,564 h |          2,5% |
| ≤ 20 s    | 1.919 | 58,6% |  7,466 h |         33,1% |
| ≤ 30 s    | 2.616 | 79,9% | 12,119 h |         53,7% |
| ≤ 60 s    | 3.078 | 94,0% | 17,174 h |         76,0% |
| ≤ 120 s   | 3.240 | 98,9% | 20,809 h |         92,1% |
| ≤ 300 s   | 3.275 |  100% | 22,586 h |          100% |

O número é útil para **priorização de pressure**, não para atribuição causal.

O algoritmo atual, em essência:

```text
on completion:
    lastCompleted = call

on next start:
    if gap <= 5 min:
        aggregate transition previousTool → currentTool
```

Sem trace/workflow, a transição pode atravessar workflows distintos. Além disso, grande parte do
intervalo pode ser raciocínio necessário do modelo.

**Regra permanente:** nenhuma comunicação futura deve converter `aggregateGapMs` em “horas
economizáveis” sem lineage + compressibility proof + experimento comparável.

---

# 9. Relações entre hot tools

Definições:

```text
inspect = repo_read_file | repo_search_text | repo_bulk_inspect
patch   = repo_apply_patch | repo_apply_patch_batch
```

## 9.1 Clusters em 7 dias

| cluster            | transitions | aggregate pressure |      p50 |
| ------------------ | ----------: | -----------------: | -------: |
| inspect ↔ inspect  |       2.227 |            ~9,56 h |  9,915 s |
| inspect → patch    |         803 |            ~5,13 h | 18,924 s |
| patch → inspect    |         507 |            ~1,84 h |  9,683 s |
| terminal ↔ inspect |       1.178 |            ~6,80 h | 13,551 s |
| terminal ↔ patch   |         691 |            ~3,43 h | 13,411 s |

## 9.2 Pares prioritários

| transição                                       |     n | aggregate pressure |      p50 |
| ----------------------------------------------- | ----: | -----------------: | -------: |
| `terminal_exec→terminal_exec`                   | 3.275 |           22,586 h | 17,938 s |
| `repo_bulk_inspect→repo_bulk_inspect`           |   472 |            2,992 h | 13,345 s |
| `repo_read_file→repo_apply_patch_batch`         |   279 |            1,985 h | 21,310 s |
| `terminal_exec→repo_bulk_inspect`               |   348 |            1,807 h | 13,196 s |
| `repo_bulk_inspect→terminal_exec`               |   196 |            1,728 h | 22,145 s |
| `repo_apply_patch_batch→terminal_exec`          |   335 |            1,613 h | 12,738 s |
| `repo_apply_patch_batch→repo_apply_patch_batch` |   232 |            1,454 h | 20,945 s |
| `repo_bulk_inspect→repo_apply_patch_batch`      |   191 |            1,389 h | 22,820 s |
| `terminal_exec→repo_read_file`                  |   227 |            1,143 h | 11,474 s |
| `repo_search_text→repo_search_text`             |   325 |            ~1,13 h |  8,622 s |
| `repo_search_text→repo_read_file`               |   389 |            1,104 h |  7,804 s |
| `repo_read_file→repo_search_text`               |   282 |            1,083 h | 10,501 s |
| `repo_read_file→repo_read_file`                 |   276 |            0,998 h |  9,415 s |
| `repo_apply_patch→repo_apply_patch`             |   263 |            0,791 h | 10,233 s |

## 9.3 Interpretação correta

Self-loop não significa automaticamente “batch missed”. Precisamos conhecer:

- mode anterior;
- logical ops;
- item cap;
- byte budget;
- truncation;
- cursor/continuation;
- dependência semântica;
- lineage.

O estado ideal de transformação continua sendo uma **wave** curta:

```text
batched inspect
→ decisão semântica
→ batched patch (+ postValidate causal)
→ follow-up somente quando resultado exigir
```

---

# 10. Auditoria aprofundada do plano de medição

## 10.1 BUG: o índice derivado descarta `callId`

`registry/runtime.js` cria um UUID por tool call e grava `callId` em `tool_call_started` e
`tool_call_completed`. Porém `normalizer.js` não o projeta, e a tabela derivada não possui
`call_id`.

Consequências:

- o summary não casa explicitamente start↔completion;
- não consegue reconstruir overlap com precisão histórica;
- transições são próximas temporalmente, não causalmente.

## 10.2 GAP: `requestId` existe, mas não resolve workflow lineage

`OperationContext` também possui `requestId = JSON-RPC id`. Isso é útil para integridade da
invocação, mas em MCP 2026 stateless cada tools/call é seu próprio request. Portanto **requestId não
deve ser confundido com conversation/workflow id**.

## 10.3 BUG metodológico: `lastCompleted` global

`summary.js` mantém um único:

```text
let lastCompleted = null
```

Qualquer próximo `tool_call_started` dentro de 5 min consome esse estado. Isso faz `topTransitions`
ser uma métrica de **adjacência temporal global**, não de workflow causal.

A própria descrição atual “Causal sequence/recovery/workflow summary” é forte demais para a
implementação real.

## 10.4 NOVO BUG metodológico: `pendingFailure` global

A auditoria complementar confirmou que recovery usa:

```text
let pendingFailure = null
```

Após uma falha de patch, qualquer inspection tool posterior pode marcar `inspected=true`, e qualquer
patch posterior dentro da janela pode fechar o recovery trace.

Sem trace e sem target identity no índice derivado, é possível atribuir:

```text
falha do workflow A
→ read do workflow B
→ patch do workflow B
```

como se fosse um único `failure→inspection→retry`.

Portanto os números históricos:

```text
recovery trace count
withInspectionCount
recovery roundTrips
recovery totalGapMs
```

são **pressure evidence**, não causal recovery evidence, até o Roadmap I corrigir a correlação.

## 10.5 GAP de testes

Os testes atuais exercitam sequência serial de recovery/transitions, mas não possuem cenário de
calls concorrentes/intercaladas. A busca por `concurrent` no teste de round-trip analytics não
encontrou cobertura.

## 10.6 NOVO GAP: janela pode ficar silenciosamente incompleta

`analytics.js` possui:

```text
MAX_SUMMARY_ROWS = 100_000
SELECT ...
WHERE ts_ms >= ?
ORDER BY ts_ms ASC, id ASC
LIMIT 100000
```

No snapshot atual de 14 dias ainda está abaixo do limite, portanto **não há corrupção do baseline
congelado**. Mas se uma janela futura exceder 100 mil rows:

- o summary retorna o prefixo mais antigo da janela;
- eventos mais recentes ficam ausentes;
- não há `truncated=true`/coverage metadata;
- uma métrica “24h/7d/14d” pode parecer completa quando não é.

Isso é um gap de correctness latente e pertence ao Roadmap I.

## 10.7 GAP de source-generation segmentation

Recovery e outras capacidades foram implantadas durante a janela histórica. Uma taxa única de 7 dias
mistura eras de instrumentation diferentes. O estado-alvo deve segmentar pelo menos:

- event/normalizer generation;
- runtime source generation quando disponível e apropriado;
- rollout boundary material.

## 10.8 Nomenclatura excessiva: `compressedRoundTrips`

No dashboard:

```text
compressedRoundTrips = logicalOperations - calls
```

O valor mede compressão **in-call de operações lógicas**. Ele não prova que cada operação teria sido
enviada em um tools/call separado.

O campo já possui caveat, mas o nome induz leitura contrafactual forte. O Roadmap I deve introduzir
nomenclatura como:

```text
coalescedLogicalOperations
inCallOperationCompression
```

mantendo alias/deprecation se necessário para compatibilidade.

---

# 11. Auditoria de execution accounting e batching

## 11.1 O mecanismo process-local existe

`withResultExecutionHint()` suporta:

```text
logicalOperations
failedOperations
skippedOperations
mode
```

O registry lê o hint e o envia para métricas in-process.

## 11.2 BUG: execution hint não chega ao audit histórico

`tool_call_completed` grava:

```text
callId
tool
durationMs
isError
risk
```

mas omite `executionMetric` já calculado naquele mesmo ponto.

Logo, o dashboard live sabe mais que o histórico 7d/14d.

## 11.3 BUG: `terminal_exec.batch` não gera execution hint

`terminal_exec.batch` já retorna:

```text
requestCount
succeededCount
failedCount
```

mas `terminalResult()` chama somente `okResult()`.

Nesta auditoria uma única call com cinco comandos foi contabilizada como uma logical operation no
dashboard. A correção é direta: o batch deve produzir accounting coerente com seu resultado real.

A semântica exata de failed/skipped deve ser verificada contra o runtime antes da implementação; não
assumir que `failedCount` e `skippedCount` são intercambiáveis.

## 11.4 GAP: batch-size e saturation não são persistidos

Sem histórico de:

- `logicalOperations`;
- mode;
- capacity;
- result budget;
- truncation;
- continuation;

não sabemos por que um batch foi seguido por outro.

## 11.5 Capacidade existente relevante

- terminal: batch 32, concurrency 16;
- repo read/search: batch 64;
- bulk inspect: 64 ops heterogêneas;
- patch batch: até 128 operações / 64 targets;
- validators: batch bounded;
- Git publication: composite one-shot existente.

A prioridade é **observabilidade e adoção**, não cap expansion.

---

# 12. Auditoria de guidance e decisão do modelo

## 12.1 BUG confirmado: três superfícies divergem

`mcp_tools_status` declara corretamente:

```text
planFirstWorkflows = []
escalationOnlyPlans = [mcp_validation_plan]
direct batch = run_copilot_validator
```

`mcp_session_profile` ainda publica validation routing:

```text
mcp_validation_plan
→ run_copilot_validator
→ job_get_summary
```

`meta.js` ainda instrui:

```text
Use mcp_validation_plan ... by default
```

na mesma guidance em que afirma que inline completion elimina polling salvo timeout do wait.

## 12.2 Efeito

O modelo recebe regras incompatíveis e pode gerar exatamente os round trips que já não deveriam
existir:

```text
plan ritual
→ validator
→ summary/poll ritual
```

## 12.3 Correção de raiz

Não basta editar três strings. O Roadmap I deve criar uma **Workflow Policy SSOT**, usada para
derivar ou validar:

- `mcp_tools_status`;
- `mcp_session_profile`;
- guidance de `meta.js`;
- testes de semantic parity.

O happy path conhecido deve ser expresso uma vez.

## 12.4 Guidance mínima alvo após correção

Validation:

```text
run_copilot_validator diretamente
→ terminou inline: parar
→ retornou running após wait bounded: consultar somente quando necessário
mcp_validation_plan = escalation/preview only
```

Patch:

```text
quando anchors e intent já são conhecidos:
repo_apply_patch_batch direto
plan separado somente quando adiciona informação/approval boundary
```

Terminal:

```text
comandos independentes já conhecidos antes da execução:
terminal_exec.batch
```

---

# 13. Auditoria de failure semantics e recovery

## 13.1 Taxonomy já existe

`failure-semantics.js` já classifica, entre outros:

- `ERR_PATCH_NOT_FOUND`;
- ambiguous/occurrence errors;
- invalid JSON result;
- `EEXPECTEDHASH`;
- `ERR_PATH_DENIED`;
- batch abort;
- no-op;
- shape/config errors.

Também gera `nextAction` específico.

## 13.2 BUG: path resolution bypassa a taxonomy

Em `operations.js`, antes de `patchResolvedTarget`, existe:

```text
resolveWritePath(...)
if (!resolved.ok)
  return {success:false, error:resolved.reason, code:resolved.code}
```

Esse caminho não chama o classificador já existente.

## 13.3 Evidência recente

24h:

```text
causal failures = 49
ERR_PATH_DENIED = 10
failureClass=unknown = 10
inlineNextActionTargetCount = 39
coverage = 79,59%
```

7d:

```text
unknown = 16
ERR_PATH_DENIED = 14
ENOENT = 1
EISDIR = 1
```

A correspondência sustenta a causa: erros pré-engine conhecidos chegam sem a mesma semantics.

## 13.4 Recovery histórico e rollout

7d:

```text
causalFailureCount = 764
ERR_PATCH_NOT_FOUND = 619
recovery trace pressure = 279
recovery round-trip pressure = 706
aggregate recovery gap pressure ≈ 3,352 h
inlineNextActionCoverage = 15,71%
```

Mas a evolução diária mostra rollout no meio da janela:

| UTC date           | causal | not found | path denied | inline next | coverage |
| ------------------ | -----: | --------: | ----------: | ----------: | -------: |
| 2026-08-20         |     68 |        44 |           0 |           0 |       0% |
| 2026-08-21         |     87 |        69 |           0 |           0 |       0% |
| 2026-08-22         |    101 |        81 |           0 |           0 |       0% |
| 2026-08-23         |    143 |       102 |           0 |           0 |       0% |
| 2026-08-24         |    156 |       145 |           0 |           0 |       0% |
| 2026-08-25         |    146 |       138 |           4 |          67 |    45,9% |
| 2026-08-26         |     52 |        30 |          10 |          42 |    80,8% |
| 2026-08-27 parcial |     11 |        10 |           0 |          11 |     100% |

A cobertura atual deve ser julgada por cohort pós-rollout, não pelo agregado misto.

## 13.5 Exact recovery anchor

A Infra já produz `recoveryExactAnchor=true` em casos provados, como line-ending e quote-escape
normalization únicos, e existem testes. O analytics live mostrou zero no recorte observado. Isso é
**uma pergunta empírica**, não um bug automaticamente. Ampliar heurísticas fica fora do Roadmap I
salvo se a investigação de uma falha específica revelar defeito objetivo.

---

# 14. Auditoria de payload e framing

## 14.1 Fato técnico

Single `repo_read_file` atualmente produz:

```text
structured.content = snapshot.content
content.text = snapshot.content
```

Single search produz:

```text
structured.output = result.output
content.text = result.output
```

`repo_tree`, quando não fornece text explícito, usa o fallback de `okResult`, serializando o
structured object como texto.

Portanto há duplicação material de bytes/semântica no wire.

## 14.2 Por que a transformação ficou no Roadmap II

A duplicação é ineficiente, mas structured tool output possui uma história de compatibilidade em que
clientes podem depender do `content` textual. A geração atual e os SDKs modernos permitem padrões
com structured payload completo e summary text, mas precisamos provar que **o ChatGPT/AURELIN 4
real** consome o structured payload sem induzir reread ou perda de informação.

Assim:

- **Roadmap I:** medir com rigor bytes duplicados e estabelecer telemetry/compat baseline;
- **Roadmap II:** mudar framing, somente após A/B de compatibilidade.

Isso corrige a classificação excessivamente forte do documento anterior, que tratava framing como
bug P1 direto.

---

# 15. Auditoria por hot tool

## 15.1 `terminal_exec`

Estado:

- 4.577 starts / 7d;
- 36,65% de todas as calls;
- batch já suporta 32 commands;
- self-loop pressure extremamente alto;
- batch accounting incompleto.

Correção imediata: execution hint + audit accounting.

Upgrade futuro: apenas após telemetry, avaliar sequential intent mais explícito, cap tuning ou
composites.

## 15.2 `repo_bulk_inspect`

Estado:

- 1.296 starts / 7d;
- 472 self-loops;
- já mistura read/search/stat;
- já possui result budget e truncation count.

Correção imediata: persistir execution/budget/truncation telemetry suficiente para distinguir batch
completo de batch limitado.

Upgrade futuro: só alterar cap/budget se saturation demonstrar necessidade.

## 15.3 `repo_read_file`

Estado:

- 1.414 starts / 7d;
- single e batch até 64;
- hashes patch-ready;
- cache/singleflight;
- duplicação textual em single.

Roadmap I: medir batch adoption e payload duplication.

Roadmap II: compact framing, se compatibilidade provar segurança.

## 15.4 `repo_search_text`

Estado:

- 1.255 starts / 7d;
- batch até 64;
- context até 48 lines;
- cursor e total counts;
- search→read = 389 temporal transitions / 7d;
- duplicação de output no single.

Roadmap I: telemetry causal/continuation.

Roadmap II: bounded hydration apenas se search→read mecânico for provado material.

## 15.5 `repo_apply_patch_batch`

Estado:

- 1.152 starts / 7d;
- batch→batch 232;
- per-target-fast, same-file grouping, fail-rich e postValidate já existem.

Roadmap I: persistir logical ops/mode; corrigir path failures; medir histogram/adoption.

Roadmap II: nenhum aumento de cap ou novo composite sem evidence.

## 15.6 `repo_apply_patch`

Estado:

- 768 starts / 7d;
- 263 self-loops temporais;
- sem evidência suficiente para afirmar que todos deveriam ser batch.

Roadmap I deve permitir medir séries de singles do mesmo trace quando múltiplos edits já estavam
conhecidos.

## 15.7 `terminal_session_read`

Não está nas hot six, mas apresenta assinatura de polling:

```text
~430 starts / 7d
204 self-loops
p50 ~7 s
p95 ~12,5 s
```

Long-poll é upgrade claro, porém deve começar apenas no Roadmap II com investigação de
runtime/cancellation/resource behavior.

---

# 16. Inventário canônico de achados

## 16.1 Correções comprovadas — pertencem ao Roadmap I

| ID         | Classe         | Severidade | Achado                                                                                       |
| ---------- | -------------- | ---------- | -------------------------------------------------------------------------------------------- |
| RT-COR-001 | BUG            | P0         | derived analytics descarta `callId` já existente no audit raw                                |
| RT-COR-002 | BUG            | P0         | `lastCompleted` global transforma adjacência temporal em aparente sequence/workflow evidence |
| RT-COR-003 | BUG            | P0         | `pendingFailure` global pode cruzar recovery entre workflows/targets                         |
| RT-COR-004 | GAP            | P0         | tests de analytics não cobrem concorrência/interleaving causal                               |
| RT-COR-005 | GAP            | P0         | trace context disponível em `requestMeta` não é extraído/sanitizado para correlation         |
| RT-COR-006 | GAP            | P0         | summary `LIMIT 100000` pode ficar incompleto sem publicar incompletude                       |
| RT-COR-007 | GAP            | P0         | cohorts misturam instrumentation/runtime generations                                         |
| RT-COR-008 | SEMANTIC BUG   | P0         | `compressedRoundTrips` sugere contrafactual mais forte que `logicalOperations-calls` prova   |
| RT-COR-009 | BUG            | P0         | `terminal_exec.batch` não produz execution hint                                              |
| RT-COR-010 | GAP            | P0         | execution hint calculado pelo registry não é persistido no audit completion                  |
| RT-COR-011 | GAP            | P1         | histórico não possui batch-size/mode/saturation/truncation causal suficiente                 |
| RT-COR-012 | BUG            | P0         | validation guidance contraditória entre `tools-status`, `session-profile` e `meta`           |
| RT-COR-013 | ROOT-CAUSE GAP | P0         | workflow policy é duplicada manualmente em múltiplas superfícies                             |
| RT-COR-014 | BUG            | P0         | patch path-resolution bypassa failure semantics já implementada                              |
| RT-COR-015 | GAP            | P1         | known pre-engine errors (`ENOENT`, `EISDIR` etc.) não têm taxonomy transversal consistente   |
| RT-COR-016 | GAP            | P1         | payload duplication ainda não possui métrica semantic-unique/duplication explícita           |
| RT-COR-017 | GAP            | P1         | não existe métrica confiável repeat-after-unsaturated-complete-batch                         |
| RT-COR-018 | DOC/UX BUG     | P0         | labels “causal sequence”/recovery atuais superestimam a autoridade do summary global         |

## 16.2 Pressure signals — medir, não “corrigir” por suposição

- terminal→terminal = 22,586 h aggregate pressure / 7d;
- bulk→bulk = 2,992 h aggregate pressure / 7d;
- inspect↔inspect = ~9,56 h aggregate pressure / 7d;
- inspect→patch = ~5,13 h aggregate pressure / 7d;
- patch→inspect = ~1,84 h aggregate pressure / 7d;
- 706 recovery follow-up calls no algoritmo temporal 7d;
- search→read = 389 adjacências temporais / 7d;
- terminal session read possui 204 self-loops / 7d.

Nenhum desses números, sozinho, autoriza remover calls.

## 16.3 Upgrades candidatos — pertencem ao Roadmap II

| ID         | Upgrade                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| RT-UPG-001 | compact heavy structured result framing                                            |
| RT-UPG-002 | terminal bounded long-poll/output-or-exit                                          |
| RT-UPG-003 | machine outcome/follow-up contract transversal                                     |
| RT-UPG-004 | bounded search→read hydration                                                      |
| RT-UPG-005 | Working Set V3 evidence-driven                                                     |
| RT-UPG-006 | Shadow Round-Trip Advisor                                                          |
| RT-UPG-007 | explicit terminal batch execution intent se necessário                             |
| RT-UPG-008 | adaptive/reduced tool surface                                                      |
| RT-UPG-009 | evidence-driven cap/budget tuning                                                  |
| RT-UPG-010 | novos bounded composites apenas onde compressibilidade for provada                 |
| RT-UPG-011 | explicit workflow handle experimental apenas se trace propagation for insuficiente |

---

# 17. Estado-alvo após o Roadmap I

O Roadmap I não precisa ainda produzir a arquitetura final de otimização. Ele precisa produzir uma
base **confiável e coerente**:

```text
Tool call
  ↓
per-call identity íntegra
  ├─ callId start↔completion
  ├─ requestId somente como request identity
  └─ optional sanitized trace key quando fornecido
  ↓
execution accounting persistido
  ├─ logical operations
  ├─ batch mode
  ├─ failure/skip
  ├─ capacity/budget facts disponíveis
  └─ truncation/continuation facts disponíveis
  ↓
workflow guidance única
  ↓
known failure semantics consistentes
  ↓
lineage-aware / lineage-unknown analytics
  ↓
pressure ≠ causality ≠ counterfactual savings
```

Ao fim do Roadmap I devemos conseguir responder, com honestidade:

- esta call foi single ou batch?;
- quantas operações lógicas executou?;
- a batch estava saturada?;
- houve truncation/continuation?;
- start e completion pertencem à mesma call?;
- existe trace lineage observável?;
- se não existe, a métrica deixa isso explícito?;
- uma recovery sequence pertence ao mesmo trace/target, ou é apenas temporal pressure?;
- a janela analítica está completa?;
- qual generation/cohort está sendo comparada?;
- guidance enviada ao modelo é internamente consistente?

---

# 18. ROADMAP I — correções de bugs e gaps comprovados

> **Regra:** este roadmap deve ser concluído antes de qualquer implementação de upgrade do Roadmap
> II.
>
> **Estado final — 2026-08-27:** Roadmap I concluído. O baseline pré-rollout foi preservado; houve
> um primeiro rollout por restart externo e, após a revisão final, a source definitiva foi promovida
> pelo reload governado com `sourceBinding=controlled-promotion` e fingerprint
> `2c14dd7180a5b877f909233a54d40a5f861fdefdb309bbdf40e7f6d85c1077f6`.

## 18.0 Evidência consolidada deste checkpoint

### Baseline pré-rollout preservado

A captura imediatamente anterior ao rollout da implementação atual registrou:

| Evidência                                  |                                    Pré-rollout |
| ------------------------------------------ | ---------------------------------------------: |
| runtime epoch                              |         `ac665196-0ed2-4076-a3b5-404afef8f515` |
| source binding                             |                               `manual-unbound` |
| `mcp_latency_dashboard` calls              |                                            154 |
| errors                                     |                                              0 |
| logical operations                         |                                            384 |
| `terminal_exec` calls                      |                                             71 |
| `terminal_exec` batch accounting histórico |               ausente/incompleto na geração v3 |
| silent external gap p50                    |                                      11.898 ms |
| silent external gap p95                    |                                     116.894 ms |
| v3 `compressedRoundTrips`                  | 230 — **contrafactual, não saved round trips** |
| v3 `estimatedAmortizedSilentMsAtP50`       |  2.736.540 ms — **retirado do estado-alvo v4** |
| `tools/list` envelope                      |                      160.055 bytes / 131 tools |
| maior descriptor                           |                   `terminal_exec`, 9.206 bytes |

O recorte de sete dias reproduziu o pressure signal histórico principal:
`terminal_exec → terminal_exec` somou `81.886.363 ms`, aproximadamente **22,746 h**. Esse número
permanece classificado como **aggregate temporal pressure**, não como causalidade nem tempo
evitável.

### Gates source/unit/static já verdes

- suites causais principais: **112/112** testes verdes;
- registry/schema/public-cost: **35/35** testes verdes;
- rodada focada posterior de analytics + tool surface: **83/83** verdes;
- `typecheck:strict:src.copilot`: verde;
- `lint:copilot`: verde;
- arquitetura global strict: `hard=0`, `soft=0`;
- MCP public API cost: `78/78` aliases, `0` manifest violations, `0` cost violations, `0`
  import-purity violations;
- nova membrane `#copilot/mcp/public/workflow-policy`: 6 módulos / 45.180 bytes, tier `micro`,
  baseline com headroom 1,5× = 9 módulos / 67.770 bytes;
- scan de imports de `src/copilot/mcp`: 350 arquivos, 947 imports, `0` orphan imports;
- `git diff --check`: verde;
- Prettier aplicado aos arquivos JS/JSON alterados;
- nenhum `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` ou suppression novo na frente.

### Evidência pós-rollout e promoção final

O restart externo feito durante a implementação colocou inicialmente a geração
`ed9cef50-feff-49b1-935a-5f0991386f94` no ar. O conector recuperou sem reconexão manual e o smoke
remoto confirmou protocolo `2026-07-28`, OAuth funcional, subscription moderna e **131/131 tools**
com registry remoto idêntico ao local. Essa geração foi usada para as primeiras provas live do v4.

A revisão pós-rollout encontrou e corrigiu mais dois gaps antes da publicação:

1. `repo_search_text.batch` estava promovendo roots de busca a target identity exata, ao contrário
   da semântica correta do search single. Isso poderia contaminar `sameTarget` recovery. A
   correlação agora é fail-closed: search roots, single ou batch, nunca viram exact target apenas
   por serem batched;
2. `recovery` ainda carregava aliases top-level de compatibilidade sem consumidores. Eles foram
   removidos; o v4 expõe somente `temporalPressure` e `lineageBound`.

Após essas correções, a source runtime final foi certificada em 21 arquivos e promovida pelo reload
controlado:

| Evidência final                   | Valor                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| runtime epoch final               | `3af912b4-33da-40bc-bfd0-3ed812e7a391`                             |
| source binding                    | `controlled-promotion`                                             |
| source barrier fingerprint        | `2c14dd7180a5b877f909233a54d40a5f861fdefdb309bbdf40e7f6d85c1077f6` |
| source drift                      | `false`                                                            |
| connector smoke                   | `success=true`, readiness `ready=true`                             |
| remote/local registry             | `131/131`, missing `0`, unexpected `0`                             |
| runtime health final              | `status=ok`, warnings `0`, critical `0`                            |
| startup maintenance               | concluída com sucesso                                              |
| analytics schema/normalizer       | `4 / 4`                                                            |
| analytics completeness (1h final) | `336/336`, coverage `1`, not truncated                             |
| final terminal batch probe        | `2/2` attempted/succeeded, `0` failed/skipped                      |
| tools/list pós-rollout            | `160.319 bytes`, headroom `249.281 bytes`                          |

O accounting v4 registrou batches reais de `terminal_exec`, `repo_read_file` e
`repo_apply_patch_batch`, com histogramas, logical operations, failed/skipped e coalescing. No
cohort pós-primeiro-rollout, as falhas controladas conhecidas permaneceram classificadas e com
`inlineNextActionCoverage=1`; nenhum known code da amostra virou `failureClass=unknown`.

`lineageContext` também respondeu a pergunta empírica de I-2: o ChatGPT observado **não propagou
traceparent válido** nessas calls. As chamadas v4 aparecem como `absent`, com
`validTraceStartRate=0`; os rows `unknown` pertencem majoritariamente ao histórico anterior ao
campo. A ausência de trace não gera causalidade falsa nem degrada execução.

O dashboard pós-promoção apresentou `status=degraded` apenas por budgets de latência externa: o
smoke OAuth remoto (~5,7 s) domina a média da tool e o silent gap do cliente/orquestrador permanece
acima do budget. Os sinais controláveis ficaram verdes: error rate `0`, handler médio
`714 ms <= 750 ms`, authorization/result-size dentro do budget e `mcp_runtime_health status=ok`. O
`orphanStartCount=1` visto quando analytics/dashboard lê o próprio audit é transitório: a call atual
ainda está em voo no momento do snapshot; após sua completion não existe orphan persistente.

O volume natural pós-promoção ainda é pequeno e **não** justifica fingir um cohort de 24 horas
maduro. O requisito foi fechado pela separação explícita de cohorts/generations e pela declaração de
insuficiência amostral, não pela mistura com eras antigas.

### Gates globais vermelhos preexistentes e fora do escopo causal

Dois validadores globais continuam vermelhos por dívida anterior ao Roadmap I e **não são regressões
desta implementação**:

1. `check:copilot:fs-read-boundaries:strict`: acusa direct-read classifications/baseline stale em
   `infra`, `model-gateway`, `mcp/scripts/source-barrier.js` e outros owners não alterados
   causalmente nesta frente;
2. `analyze:events:ssot:strict`: acusa 25 strings preexistentes, majoritariamente eventos
   Node/domain (`spawn`, `connect`, `socket` etc.) e dois legacy emitters.

Esses gates devem permanecer documentados e não serão “resolvidos” expandindo artificialmente o
escopo do Roadmap I.

---

## FAIXA I-0 — Baseline e governança

### I-0.1 Documento

- [x] releitura integral das 2.406 linhas da revisão anterior;
- [x] reclassificação correção vs upgrade;
- [x] complementar auditoria de analytics/recovery;
- [x] identificar o gap de `MAX_SUMMARY_ROWS`;
- [x] confirmar `requestMeta` já disponível em `OperationContext`;
- [x] refinar framing como upgrade compat-gated, não bug de correctness;
- [x] instituir contrato de documento vivo;
- [x] separar formalmente Roadmap I e Roadmap II.

### I-0.2 Baseline preservado

- [x] manter snapshot 24h/7d/14d original reproduzível;
- [x] preservar 22,586 h somente como aggregate pressure;
- [x] capturar baseline novo sem substituir o congelado — dashboard, analytics 24h/7d/14d e payload
      audit registrados acima;
- [x] registrar source generation antes da primeira alteração **do runtime live** — a source já
      estava modificada, mas o processo conectado permanecia comprovadamente na geração antiga, com
      source drift explícito e epoch `ac665196-...`, antes de qualquer reload.

---

## FAIXA I-1 — Analytics v4: integridade temporal por call

### I-1.1 Normalizer/index schema

- [x] elevar versão do normalizer explicitamente para v4;
- [x] projetar `callId` sanitized/bounded para lifecycle events;
- [x] decidir `requestId`: **não persistido**, pois identifica request e não acrescenta autoridade
      de workflow além de `callId`/trace; evitar dado redundante;
- [x] adicionar colunas/migration idempotentes;
- [x] garantir replay correto de cursor de geração anterior;
- [x] garantir que raw source content, command text, patch text e secrets continuem fora do índice.

### I-1.2 Start↔completion correctness

- [x] casar start/terminal por `callId`;
- [x] reconhecer `completed`, `failed`, `auth_denied`, `rate_limited` e `result_rejected` como
      finais de call;
- [x] detectar orphan start/orphan terminal;
- [x] reconstruir active-call intervals e excluir overlap de quiescent transition evidence;
- [x] não usar uma única variável global como prova causal;
- [x] separar temporal adjacency de qualquer metric lineage-bound.

### I-1.3 Testes

- [x] duas calls intercaladas `A.start → B.start → A.complete → B.complete`;
- [x] completion/terminal sem start;
- [x] start sem completion;
- [x] calls concorrentes com tools iguais;
- [x] calls concorrentes com tools diferentes;
- [x] long idle boundary;
- [x] replay/migration v3→v4.

**Gate I-1:** `PASS` em source/unit — nenhuma métrica per-call depende de adjacência global quando
`callId` está disponível.

---

## FAIXA I-2 — Trace lineage sanitizada

### I-2.1 Investigação de `_meta`

- [x] observar, após reload/reconnect, o **estado sanitizado** do `requestMeta` real recebido do
      ChatGPT — calls v4 observadas como `absent`;
- [x] verificar no workload live se `traceparent` chega como `valid`, `absent`, `invalid` ou
      `unsupported-version` — observado `absent`, sem ler/persistir o valor raw;
- [x] não exigir trace do host;
- [x] manter `lineage=unknown` quando não houver evidência;
- [x] adicionar `lineageContext.traceContextStateCounts` e `validTraceStartRate` para tornar a
      verificação live possível sem violar privacy.

### I-2.2 Privacy boundary

- [x] validar formato W3C v00 antes de aceitar correlation;
- [x] correlacionar pelo trace-id, não pelo parent span id;
- [x] usar chave SHA-256 derivada/pseudonimizada e bounded;
- [x] não persistir `traceparent` raw;
- [x] não persistir `tracestate`;
- [x] não persistir `baggage`;
- [x] regression tests de data minimization, inclusive serializer de completion audit.

### I-2.3 Semântica

- [x] `lineageKnownRate` explícita;
- [x] lineage unknown não inferir same-workflow;
- [x] trace ausente não degradar execução das tools;
- [x] nenhum round trip adicional é criado para tracing.

**Gate I-2:** `PASS` source/unit/live — o host observado não propagou traceparent válido; ausência
permanece explicitamente unknown/absent e não cria causalidade.

---

## FAIXA I-3 — Recovery analytics correto

### I-3.1 Remover `pendingFailure` global como autoridade causal

- [x] modelar recovery candidates por lineage quando conhecida;
- [x] introduzir target identity sanitizada por fingerprint sem armazenar source/path raw no índice;
- [x] auditar batch failure e permitir narrowing target-correct de A+B→A na boundary scoped de
      audit;
- [x] impedir que narrowing amplie a autoridade original da invocação; tentativa inválida degrada
      para `targetPrecision=none`;
- [x] classificar evidência sem target/lineage suficiente como temporal recovery pressure, não trace
      causal.

### I-3.2 Métricas

- [x] `temporalRecoveryPressure` separado;
- [x] `lineageBoundRecoveryTraceCount` separado;
- [x] `sameTargetRecoveryTraceCount` somente quando comprovável;
- [x] `unknownRecoveryLineageCount` explícito;
- [x] inspection causal exige lineage; unrelated inspection não fecha recovery causal.

### I-3.3 Testes de interleaving

- [x] failure A → read B → patch B não fecha recovery A;
- [x] failure A → read A → patch A fecha somente quando lineage/target provam;
- [x] failures simultâneas de targets diferentes;
- [x] batch partial failure com independent target retry;
- [x] unknown lineage permanece unknown.

**Gate I-3:** `PASS` em source/unit.

---

## FAIXA I-4 — Completeness e cohort correctness do analytics

### I-4.1 Limite de 100k

- [x] impedir janela incompleta silenciosa;
- [x] estratégia escolhida: bounded newest-tail + fail-visible completeness metadata;
- [x] expor `rowsEligible`, `rowsAnalyzed`, `maxRows`, `coverageRatio`, `truncated` e selection
      mode;
- [x] testar janela acima do budget analítico;
- [x] garantir retenção do recorte mais recente, eliminando o antigo `ORDER BY ASC LIMIT`
      silencioso.

### I-4.2 Generation segmentation

- [x] definir event/analytics generation via runtime epoch/source fingerprint sanitizados;
- [x] aproveitar runtime source generation;
- [x] segmentar cohorts no analytics/dashboard;
- [x] detectar generation mix e evitar apresentar quality rate atual como cohort puro sem caveat.

### I-4.3 Naming

- [x] separar temporal transitions de lineage-bound transitions;
- [x] authority/caveats explícitos para gap/pressure;
- [x] distinguir global temporal pressure, lineage gap e futuro avoidable round trip;
- [x] remover do v4 a apresentação de `compressedRoundTrips` como saved round trips.

---

## FAIXA I-5 — Execution Accounting v2 persistente

### I-5.1 Registry audit

- [x] incluir execution hint sanitized em `tool_call_completed`;
- [x] persistir `logicalOperations`;
- [x] persistir failed/skipped logical ops;
- [x] persistir bounded `mode`;
- [x] preservar zero conteúdo sensível;
- [x] testes do serializer de audit confirmam somente fatos numéricos/bounded, sem payload raw.

### I-5.2 Corrigir nomenclatura de compressão

- [x] introduzir `coalescedLogicalOperations`;
- [x] fórmula documentada como `max(0, logicalOperations - calls)` — fato de agrupamento, não tempo
      salvo;
- [x] não criar compat alias novo porque o índice v4 é rebuildable e a surface nova pode ser
      explícita;
- [x] deprecar/retirar leitura de `compressedRoundTrips` como saved round trips no v4;
- [x] atualizar dashboard/tests/docs.

### I-5.3 Instrumentation de capacity/result

- [x] batch size/request count;
- [x] max/capacity relevante;
- [x] result budget quando aplicável;
- [x] result bytes quando já contabilizados;
- [x] truncation count/flag;
- [x] continuation flag quando explicitamente produzido;
- [x] sem inferir semantic dependency.

---

## FAIXA I-6 — `terminal_exec.batch` accounting

### I-6.1 Correção

- [x] usar `withResultExecutionHint` na tool;
- [x] batch `logicalOperations = requestCount`;
- [x] mapear failed/skipped conforme semântica real do runtime;
- [x] corrigir bug adicional descoberto: `new Array(n).map(...)` não materializava holes fail-fast,
      gerando `null` e confundindo failed/skipped; agora usa `Array.from`, `attemptedCount`,
      `failedCount` e `skippedCount` separados;
- [x] mode bounded com failure mode/concurrency;
- [x] single continua 1 op sem overhead extra relevante.

### I-6.2 Testes

- [x] batch 5 success => 5 logical ops;
- [x] best-effort com falha;
- [x] fail-fast sequencial materializa itens não executados como skips explícitos;
- [x] dashboard accounting;
- [x] confirmar materialização no audit **live pós-reload**;
- [x] no wire regression — schema inclui attempted/failed/skipped e suites passam.

### I-6.3 Critério

- [x] confirmar em batches reais da geração nova accounting coerente no audit derivado;
- [x] invariants/source/tests impedem uma call de 5 commands de ser reportada como 1 logical op.

---

## FAIXA I-7 — Workflow Policy SSOT e correção de guidance

### I-7.1 Correção imediata da contradição

- [x] remover `mcp_validation_plan` do happy path de `mcp_session_profile`;
- [x] remover “use ... by default” de `meta.js`;
- [x] manter `mcp_validation_plan` como escalation/preview-only;
- [x] summary/poll somente quando validator retornar estado que exige follow-up.

### I-7.2 Correção estrutural

- [x] criar owner canônico `src/copilot/mcp/workflow-policy/`;
- [x] evitar ciclo de inicialização descoberto durante testes: owner foi retirado de `tools/catalog`
      e recebeu membrane pública própria;
- [x] definir validation policy;
- [x] definir patch plan policy;
- [x] definir file-batch plan policy;
- [x] definir Git publication policy;
- [x] definir terminal batching guidance;
- [x] derivar `session-profile`, `tools-status` e `meta` da SSOT onde adequado;
- [x] governar nova membrane em package imports + public API cost manifest/baseline.

### I-7.3 Regression

- [x] semantic parity test entre tools-status/session-profile/meta;
- [x] happy path contém zero plan ritual;
- [x] inline completed contém zero poll ritual;
- [x] fallback/escalation continua documentado.

**Gate I-7:** `PASS`.

---

## FAIXA I-8 — Failure semantics transversal de patch

### I-8.1 Path resolution

- [x] `resolveWritePath` failures atravessam semantics comum;
- [x] `ERR_PATH_DENIED` recebe `failureClass=integrity`, `manual-decision`, `recoveryRequired=false`
      e nextAction coerente;
- [x] preservar retryability/recovery semantics;
- [x] nenhuma mudança/relaxamento em path safety.

### I-8.2 Known pre-engine codes

- [x] catalogar `ERR_PATH_DENIED`, `ERR_EMPTY_PATH`, `ERR_NULL_BYTE_PATH`, `ERR_INVALID_PATH`,
      `ENOENT`, `EISDIR`, `ENOTDIR`;
- [x] classificar somente códigos compreendidos;
- [x] unknown permanece unknown para código verdadeiramente desconhecido;
- [x] evitar mapping genérico que esconda defeitos.

### I-8.3 Single + batch consistency

- [x] single patch;
- [x] patch batch preflight;
- [x] patch batch per-target-fast;
- [x] same-file grouped failure;
- [x] audit aggregates + target narrowing;
- [x] nextAction coverage para known pre-engine codes.

### I-8.4 Meta pós-rollout

- [x] known error code → `failureClass=unknown` = 0 na amostra controlada do cohort pós-rollout;
- [x] falhas classificáveis com nextAction = 100% na amostra controlada do cohort pós-rollout;
- [x] comparar cohort pós-rollout separadamente; volume pequeno mantido explícito, sem misturar
      eras.

---

## FAIXA I-9 — Batch adoption e payload observability

Esta faixa **mede**; não implementa os upgrades do Roadmap II.

### I-9.1 Batch

Por hot tool, o v4 agora publica:

- [x] calls single;
- [x] calls batch;
- [x] batch-size histogram;
- [x] logical ops/call p50/p95;
- [x] saturation rate;
- [x] truncation rate;
- [x] continuation rate;
- [x] repeated call after saturated batch;
- [x] repeated call after unsaturated complete batch somente quando lineage conhecida.

### I-9.2 Payload

- [x] total/wire-result bytes quando já medidos pelo registry;
- [x] `textResultBytes`;
- [x] structured/non-text **proxy** via `nonTextResultBytes = totalResultBytes - textResultBytes`,
      deliberadamente evitando uma segunda serialização cara apenas para observabilidade;
- [x] duplication proxy para read/search/tree;
- [x] payload truncation;
- [x] baseline de reread/follow-up após heavy result ≥64 KiB em três níveis: temporal, mesma lineage
      e mesmo target+mesma tool;
- [x] caveat explícito: heavy-result follow-up é pressure observacional e não prova avoidability.

### I-9.3 Não fazer ainda

- [x] **não** compactar heavy framing nesta faixa;
- [x] **não** aumentar caps;
- [x] **não** adicionar hydration;
- [x] **não** criar long-poll;
- [x] **não** criar novos composites.

---

## FAIXA I-10 — Baseline pós-correção e encerramento

### I-10.1 Testes focados

- [x] round-trip analytics v4;
- [x] concurrency/interleaving;
- [x] execution accounting;
- [x] terminal batch;
- [x] workflow policy parity;
- [x] patch path semantics;
- [x] summary completeness acima do budget/100k-equivalent;
- [x] data minimization.

### I-10.2 Static gates

- [x] TS7 strict focado;
- [x] lint focado/`lint:copilot`;
- [x] formatting + `git diff --check`;
- [x] architecture/public membrane + public API cost governance;
- [x] sem suppressions proibidas novas;
- [x] registrar, sem mascarar, os gates globais preexistentes fora do escopo causal.

### I-10.3 Live gates

- [x] reload controlado da nova source generation;
- [x] reconnect não foi necessário: o host recuperou automaticamente após restart/reload;
- [x] connector smoke;
- [x] capturar runtime generation nova e source barrier binding;
- [x] gerar calls reais e sincronizar analytics v4;
- [x] verificar `lineageContext` real do ChatGPT;
- [x] verificar terminal batch accounting histórico live;
- [x] verificar patch failure cohort novo;
- [x] dashboard pós-correção;
- [x] cohort pós-rollout separado; volume ainda pequeno foi reportado explicitamente como
      insuficiente para uma janela natural de 24h, sem misturar eras;
- [x] confirmar ausência de regressão de handler/resource pressure — runtime health `ok`, sem
      critical;

### I-10.4 Documento

- [x] registrar baseline pré-rollout e source generation anterior;
- [x] registrar bugs adicionais descobertos durante implementação (Workflow Policy cycle e sparse
      terminal fail-fast rows);
- [x] registrar gates source/unit/static e dívidas globais externas;
- [x] registrar métricas pós-rollout e nova generation;
- [x] fechar checkboxes live e declarar estado final do Gate I→II.

---

# 19. Gate obrigatório entre Roadmap I e Roadmap II

O Roadmap II **não pode entrar em implementação** enquanto qualquer item crítico abaixo estiver
aberto:

- [x] start/terminal correlacionados por call identity;
- [x] analytics não chama adjacência global de causal;
- [x] recovery não usa `pendingFailure` global como prova causal;
- [x] unknown lineage permanece unknown;
- [x] window completeness é explícita;
- [x] cohorts/generations são distinguíveis;
- [x] execution accounting histórico está implementado no audit v4;
- [x] execution accounting histórico foi comprovado em geração live nova;
- [x] `terminal_exec.batch` accounting está correto em source/unit/wire;
- [x] `compressedRoundTrips` não é apresentado pelo v4 como saved round trips;
- [x] guidance de validação é coerente e possui SSOT;
- [x] path-resolution known failures atravessam failure semantics;
- [x] batch-size/saturation/truncation baseline está instrumentado;
- [x] payload duplication/heavy-followup baseline está instrumentado;
- [x] live connector/reload gates do Roadmap I estão verdes;
- [x] este documento contém a evidência final pós-rollout do Roadmap I.

**Gate state final:**
`ABERTO — Roadmap I concluído e provado. O Roadmap II pode ser iniciado em uma rodada futura, mas não foi iniciado nesta rodada.`

---

# 20. Estado-alvo de evolução

Depois do Roadmap I, a frente pode buscar um **Round-Trip Optimization Control Plane** mais
sofisticado:

```text
reliable lineage + execution facts
        ↓
classificação de follow-up
        ↓
experimentos bounded
        ↓
redução de calls comprovadamente mecânicas
        ↓
A/B de wall-clock / correctness / resource pressure
        ↓
promoção somente se ganho líquido
```

A unidade econômica correta será:

> **round trip comprovadamente evitável por objetivo**, não handler isolado nem self-loop bruto.

---

# 21. ROADMAP II — upgrades evidence-gated

> **Pré-condição:** Gate I→II aberto.
>
> Cada faixa começa por investigação própria. Nenhum upgrade é obrigatório apenas porque está
> listado; pode ser rejeitado se a evidência pós-Roadmap I não justificar benefício líquido.

## FAIXA II-0 — Rebaseline e priorização causal

- [x] reler integralmente este documento — 2.393 linhas na revisão 4.0, incluindo o fechamento
      pós-rollout;
- [x] usar somente cohorts pós-Roadmap I para priorização — boundary operacional
      `2026-08-27T04:15:01Z`;
- [x] ranquear `repeat-after-unsaturated-complete-batch` por hot tool — nenhum caso pós-I material
      foi observado na amostra pequena; não autoriza cap tuning;
- [x] ranquear continuation/poll/recovery causal — continuation/saturation pós-I = 0 na amostra;
      polling de terminal foi provado por EXP-04 controlado;
- [x] ranquear payload duplication por bytes e follow-up — EXP-03 controlado quantificou
      `repo_tree > repo_read_file > repo_search_text`;
- [x] escolher a primeira onda por ganho esperado × confiança × risco — **II-1 Heavy Framing → II-2
      Terminal Long-Poll**.

### II-0.1 Rebaseline pós-Roadmap I — 2026-08-27

O recorte começa no processo da promoção final do Roadmap I, `2026-08-27T04:15:01Z`. O restart
externo posterior preservou `HEAD=935eb58c4` e source bytes publicados, mas abriu o novo epoch
`b01903fb-dd8c-429c-94ad-2dee297be2e9` com `sourceBinding=manual-unbound`; `sourceDrift=false`,
runtime `status=ok`, worktree limpa. Para priorização, ambos são pós-Roadmap I; generations
continuam separáveis no índice v4.

A amostra natural pós-I ainda é pequena. Antes desta investigação havia somente 23 starts desde a
boundary. Logo, **não** há base honesta para aumentar caps/budgets, reduzir a tool surface, criar
novo composite ou promover Working Set V3. O Roadmap II deve usar experimentos controlados onde a
causalidade pode ser estabelecida agora e aguardar workload natural onde não pode.

### II-0.2 EXP-03 baseline — duplicação wire controlada

Inputs fixos executados no epoch `b01903fb-...` antes da mudança de framing:

| Tool / input controlado                                               | result bytes | text bytes | duplicate text bytes |        duplicação/result |
| --------------------------------------------------------------------- | -----------: | ---------: | -------------------: | -----------------------: |
| `repo_tree(src/copilot/mcp, recursive, depth=3, maxEntries=500)`      |      223.640 |    126.172 |              126.172 |                    56,4% |
| `repo_read_file(src/copilot/mcp/tools/repo-read.js, full)`            |       97.764 |     47.516 |               47.516 | 48,6% da call controlada |
| `repo_search_text(return, src/copilot/mcp, context=3, maxResults=80)` |       18.740 |      8.816 |                8.816 |                    47,0% |

As três calls somaram **182.504 bytes de texto semanticamente duplicado**. Os modos
`repo_read_file.batch`, `repo_search_text.batch` e `repo_bulk_inspect` já usam full
`structuredContent` + summary textual compacto nesta mesma integração ChatGPT, com sucesso. Isso é
compatibility evidence prévia forte para II-1, mas o rollout single continuará A/B e tool-scoped.

### II-0.3 EXP-04 baseline — polling terminal comprovadamente mecânico

Uma persistent pipe session foi aberta com output deliberadamente atrasado. Três chamadas
consecutivas de `terminal_session_read({afterSeq:0})` retornaram, cada uma:

- `status=running`;
- `returnedBytes=0`;
- `events=[]`;
- `hasMore=false`;
- `nextSeq=0`.

Logo, o contrato atual obriga o caller a fazer polling para descobrir output/exit futuro. A semana
anterior continha `430` starts de `terminal_session_read`, dos quais `206` eram self-loops temporais
imediatos (~47,9%). O experimento controlado fecha a causalidade que a telemetria histórica, sem
traceparent do host, não poderia provar sozinha.

### II-0.4 Decisão de priorização

**Onda A — II-1 / promover agora se A/B passar**

1. manter full payload em `structuredContent`;
2. compactar somente o texto legado de `repo_read_file`, `repo_search_text`, `repo_tree` e
   `repo_root_tree`;
3. não alterar globalmente `okResult`;
4. repetir exatamente EXP-03 após reload e comparar bytes/correctness/reread.

**Onda B — II-2 / promover agora se testes + EXP-04 passarem**

1. waiter event-driven por sessão;
2. `waitFor="output-or-exit"` + `waitMs` bounded;
3. immediate read permanece default e compatível;
4. cancellation cancela somente a espera, jamais mata a persistent session;
5. wake em output, failed/exit, close/forget/cancel/timeout; sem busy loop;
6. repetir EXP-04 com uma única read aguardando o evento.

**Investigação posterior, sem implementação nesta primeira onda:** II-3.

**Sem promoção por falta de evidência atual:** II-4, II-5, II-7, II-8, II-9, II-10 e II-11. Em
particular, `repo_working_set` teve apenas 26 starts na semana; `batchConcurrency=1 + fail-fast` já
expressa sequência terminal; nenhuma saturation/continuation pós-I material foi observada; e a
surface reduzida ainda não possui coverage ≥99% provado.

---

## FAIXA II-1 — Heavy Structured Result Framing

### Investigação

- [x] confirmar comportamento do ChatGPT atual com structuredContent completo + text summary — já
      comprovado pelos modos batch de read/search/bulk na mesma integração;
- [x] medir compatibilidade live em `repo_read_file`, `repo_search_text`, `repo_tree` após promoção
      da source single compacta — full structured payload permaneceu observável nas respostas
      ChatGPT;
- [x] medir bytes before/after — read `97.764→51.969 B` (-46,8%), search `18.740→10.006 B` (-46,6%),
      tree `223.640→86.844 B` (-61,2%);
- [x] verificar reread/wrong-answer regressions no A/B live — nenhum reread mecânico foi necessário
      no experimento controlado e o conteúdo completo permaneceu estruturado; lineage natural
      continua unknown porque o host não propaga traceparent;
- [x] confirmar output-schema parity — structured shapes não mudaram; read/search/tree não ganharam
      outputSchema novo.

### Implementação condicional

- [x] helper tool-local de heavy structured framing no adaptador `repo-read`;
- [x] full payload uma vez em structuredContent;
- [x] bounded deterministic summary em text, hard cap 2 KiB;
- [x] fallback apenas se compatibilidade exigir — nenhum fallback prévio adicionado; A/B live decide
      promoção/reversão;
- [x] rollout por tool, não big-bang — somente read-file/search-text/tree/root-tree, sem mudar
      `okResult` global.

### Promotion gate

- [x] redução material de wire bytes — ~47% em read/search e ~61% em tree nos inputs congelados;
- [x] zero perda de informação observável — full payload preservado em `structuredContent` e schemas
      estruturados inalterados;
- [x] zero aumento de reread mecânico no experimento controlado; telemetria natural não pode
      atribuir causalidade sem traceparent;
- [x] silent gap/turn time não mostrou regressão atribuível ao framing; runtime/handler health
      permaneceu saudável. O ganho provado desta faixa é wire/context, não alegação de wall-clock
      causal.

### II-1.1 Resultado final e correção de telemetria

A primeira promoção revelou um false positive somente na observabilidade: o estimator histórico de
`repo_tree` marcava qualquer TextContent como duplicado. O framing já estava correto, mas os 126 B
do novo summary foram classificados como duplication. O estimator foi restringido ao antigo
TextContent JSON-shaped contendo `entries`, com regression test. Na geração final
`d2153652-36dd-4af1-8162-2ea2050bfd6f`, fingerprint `ac6da4d07e7b...`, o mesmo tree controlado
registrou `resultBytes=86.844`, `textResultBytes=126`, `duplicateTextBytes=0`.

**Decisão II-1:** `PROMOVIDO`.

---

## FAIXA II-2 — Terminal Session Long-Poll

### Investigação

- [x] confirmar self-loop causal de polling pós-Roadmap I — EXP-04 produziu 3 reads vazias
      consecutivas; histórico 206/430 self-loops;
- [x] auditar event/buffer primitives do terminal runtime;
- [x] cancellation semantics — abort libera somente waiter; persistent process mantém lifecycle
      próprio;
- [x] close/exit races — waiter registra e revalida predicate para fechar lost-wakeup race;
      exit/failure notificam;
- [x] retention cursor correctness — cursor behind retention retorna imediatamente, sem esperar;
- [x] resource cost de waits concorrentes — waiter é event-driven, sem polling, bounded a 64 por
      sessão e 120s.

### Design candidato

```text
terminal_session_read({
  sessionId,
  afterSeq,
  waitFor: "output-or-exit",
  waitMs: bounded
})
```

### Implementação condicional

- [x] event-driven wait por sessão;
- [x] no busy loop — inclusive `waitForSessionExit` interno deixou polling de 25ms;
- [x] wake on output/exit/timeout/cancel;
- [x] specific output semantics com `waitOutcome`, `waitedMs`, `waitFor`, `waitMs`;
- [x] compatibility com read imediato — `waitFor` é opt-in; `readTerminalSession` síncrono foi
      preservado.

### Promotion gate

- [x] polling self-loop ↓ materialmente — EXP-04 protocol-level: baseline 3 reads/2 self-loops → 1
      read/0 self-loops, **100%** de redução controlada;
- [x] sem memory/session leak — waiters são removidos em settle/cancel/timeout, limite 64/session;
      sessão experimental foi fechada e runtime remoto permaneceu sem active sessions;
- [x] cancellation/close sem regressão — unit tests cobrem cancellation do waiter sem matar process
      e close/event wake;
- [x] wall-clock não piora no experimento controlado: uma única call aguardou ~710 ms pelo output
      que só existia ~700 ms depois, em vez de três respostas vazias; não há busy loop.

### II-2.1 Checkpoint source/unit antes do rollout

- terminal control contract elevado de v3 para v4;
- public membrane ganhou somente `readTerminalSessionWithWait`, permanecendo dentro do cost headroom
  existente;
- focused terminal tests: output, timeout, cancellation e lifecycle verdes;
- specific output-schema parity do long-poll: verde;
- TS7 strict: verde;
- lint/Prettier/diff check: verdes;
- public API cost governance: verde;
- nenhum cap de command batch/result foi ampliado.

### II-2.2 Evidência protocol-level e compatibilidade do host

Após a promoção final `ac6da4d07e7b8a7ec226bf2a1541a951b9b166ee9fdf1fcbe33fd86d25280a75`, o remote
smoke fechou 131/131 tools, OAuth/subscription/readiness verdes e runtime health `ok`. `tools/list`
do SDK real anuncia `waitFor`/`waitMs`. Um cliente MCP stdio canônico, em child efêmero com auth
local `none-dev/off` e **sem reutilizar credenciais**, executou open → read(waitFor) → close:
`waitOutcome=output`, `waitedMs=710`, client elapsed `717 ms`, `eventCount=1`, `returnedBytes=21`,
output esperado presente e sessão ainda `running` após a read.

A projeção de tools já carregada por **esta conversa ChatGPT** continuou exibindo o schema anterior
de `terminal_session_read`. Isso é cache/relist do host, não drift do servidor: remote/local
`tools/list` já contêm os novos argumentos. Como long-poll é opt-in, hosts com descriptor antigo
mantêm o read imediato anterior sem quebra. O A/B pelo próprio host do novo argumento exige
relist/reconexão em uma conversa/connector projection atualizada; não é requisito para correctness
do servidor.

O tools/list total passou de aproximadamente `160.319 B` para `161.381 B` (+1.062 B, +0,66%), ainda
com `248.219 B` de headroom. O descriptor de `terminal_session_read` passou a `8.822 B`.

**Decisão II-2:** `PROMOVIDO`.

---

## FAIXA II-3 — Machine Outcome Contract

Free text continua, mas pode ganhar resultado machine-readable transversal:

```text
completionState
followUp.required
followUp.class
preferredTool quando determinístico
```

### Investigação

- [x] listar families em que nextAction já é determinístico — 11 owner modules já expõem
      `nextAction`/`nextActions`/`waitOutcome`/`continuationRequired`; patch, validation, Git e
      terminal têm semantics locais mais ricas;
- [x] evitar criar taxonomy excessiva — as classes genéricas perderiam informação de `retryability`,
      `recoveryRequired`, validator status e terminal wait outcome;
- [x] verificar impacto de descriptor/schema bytes — tools/list já possui `20.110 B` de output
      schemas e `161.381 B` totais; um envelope transversal repetiria campos em resultados/schemas
      sem benefício mensurável;
- [x] definir versioning/compat — decisão: **não criar versão transversal nesta geração**; preservar
      contratos locais backward-compatible.

### Classes candidatas

- `complete-no-follow-up`;
- `continuation-required`;
- `retry-same-tool-safe`;
- `inspection-required`;
- `approval-required`;
- `semantic-decision-required`.

### Promotion gate

- [x] advice-adherence avaliada: pós-I `planCalls=0` e `validatorPoll=0`; não existe headroom
      mensurável para uma taxonomy transversal melhorar esses rituais;
- [x] poll/retry errado avaliado: nenhum poll ritual pós-I; patch new-cohort mantém nextAction
      coverage 100%; não há redução incremental demonstrável;
- [x] descriptor/result pressure avaliado e considerado custo líquido sem ganho observado.

**Decisão II-3:** `REJEITADO NESTA GERAÇÃO`. Reabrir somente se telemetria mostrar follow-up errado
material apesar dos contratos locais/Workflow Policy, idealmente com lineage suficiente para
atribuir o erro.

---

## FAIXA II-4 — Bounded Search→Read Hydration

### Investigação

- [x] medir fraction de `search→read` lineage-bound realmente mecânica — pós-I: 4 adjacências
      temporais <=5min e **0 lineage-bound**;
- [x] separar descoberta semântica de leitura previsível — impossível classificar causalmente com
      trace absent; manter unknown em vez de promover heurística;
- [x] medir arquivos pequenos vs grandes — short-circuit: sem cohort mecânico comprovado, hidratar
      qualquer faixa de tamanho aumentaria payload por especulação;
- [x] medir byte headroom — framing II-1 reduziu payload sem hydration; search já oferece
      contextLines/cursor/hash e batch/bulk bounded.

### Opções candidatas

- matched windows bounded;
- poucos matched file contents dentro de budget;
- outline/symbol envelope;
- exact candidate window + current hash.

### Restrições

- [x] max files — não foi criada hydration;
- [x] max bytes — não foi criada hydration;
- [x] sem uncontrolled fan-out — preservado;
- [x] sem fuzzy mutation acoplada — preservado;
- [x] não manter feature se payload cresce sem reduzir calls/turn time — candidato não promovido por
      falta de prova causal.

**Decisão II-4:** `DEPRIORITIZADO / NÃO IMPLEMENTADO`. Reabrir somente com cohort lineage-bound ou
experimento controlado que demonstre search→read mecanicamente previsível e ganho líquido de
calls/wall-clock.

---

## FAIXA II-5 — Working Set V3

Só executar se workflows pós-Roadmap I demonstrarem reuse substancial de subtree/context.

- [x] medir reuse real — `repo_working_set`: 0 starts pós-I e apenas 26 starts na janela histórica
      semanal;
- [x] revisar por que uso atual é baixo — workload dominante usa read/search/bulk/terminal diretos;
      o working set atual já cobre open/context/find/refresh, seeds, coverage selection e delta
      refresh;
- [x] manifest com hashes quando útil — nenhum gap de calls atual justificou ampliar o manifest;
- [x] delta refresh hints — capacidade atual já aceita `modifiedPaths` e invalidations conhecidas;
- [x] integração advisory com patch — não promovida sem reuse mensurável;
- [x] sem nova correctness authority — preservado;
- [x] sem duplicar content cache — preservado;
- [x] promoção somente após redução real de calls — redução não demonstrada, portanto sem promoção.

**Decisão II-5:** `DEPRIORITIZADO`. Reabrir se `repo_working_set` ou subtree reuse se tornar
material e um A/B mostrar redução real de read/search calls sem duplicar o read cache.

---

## FAIXA II-6 — Shadow Round-Trip Advisor

Começar offline/shadow, sem alterar execução:

- [x] reconstruir traces lineage-bound — 114 starts pós-I possuem `trace_context_state=absent`;
      nenhum trace natural reconstruível;
- [x] classificar calls provably batchable — somente experimentos controlados permitem classificação
      causal nesta geração; analytics natural permanece unknown;
- [x] separar semantic-dependent/unknown — analytics v4 já faz essa separação e não chama pressure
      de avoidable;
- [x] calcular counterfactual **call count**, não “horas salvas” — execution accounting/coalescing
      já fornece o fato de agrupamento; advisor novo não é necessário;
- [x] comparar prediction com experimentos reais — II-1/II-2 foram decididos por A/B direto, não por
      previsão shadow;
- [x] ranking por hot tool/workflow — concluído em II-0;
- [x] somente depois avaliar guidance automática — não promovida;
      `optimizationEvidence.newCompositeRecommendation=none-from-analytics-alone`.

**Decisão II-6:** `REJEITADO COMO NOVO COMPONENTE NESTA GERAÇÃO`. O analytics v4 já é o substrate
shadow seguro. Reabrir quando lineage natural existir em volume suficiente para validar prediction
vs actual.

---

## FAIXA II-7 — Terminal batch intent explícito

Hoje `batchConcurrency=1 + fail-fast` expressa sequência determinística. Avaliar se um enum
explícito melhora seleção/erros:

- [x] medir misuse atual — pós-I há 21 `terminal-batch:best-effort` e 1 `terminal-batch:fail-fast`;
      nenhuma evidência de seleção semântica errada ou skip induzido por falta de enum;
- [x] comparar descriptor cost — enum adicional aumentaria input schema e duplicaria semântica já
      expressa por `batchConcurrency` + `batchFailureMode`;
- [x] candidato `executionMode=parallel|sequential` somente se reduzir erro — redução não
      demonstrada;
- [x] não duplicar opções semanticamente equivalentes sem benefício — preservado pela não
      implementação.

**Decisão II-7:** `REJEITADO COMO REDUNDANTE`. Reabrir somente se telemetry/testes mostrarem erro de
seleção recorrente que não possa ser resolvido pela Workflow Policy atual.

---

## FAIXA II-8 — Adaptive Tool Surface

Somente após behavioral cleanup:

- [x] rerodar call coverage — 1.935 calls / 45 tools observadas em 24h;
- [x] exigir coverage alvo, preferencialmente ≥99% — melhor reduced mode (`latency`) ficou em
      **97,364%**, perdendo 15 tools observadas;
- [x] A/B tool selection errors — short-circuited: surface candidata falhou o gate de coverage antes
      de justificar exposição a seleção degradada;
- [x] A/B TTFT/host latency quando possível — não executado por segurança metodológica após falha do
      prerequisite de coverage; descriptor savings isolado não autoriza default change;
- [x] full fallback sempre disponível — `full` permanece default;
- [x] não depender de dynamic relist não provado — preservado; a própria conversa atual mostrou que
      schema projection pode permanecer cacheada após reload.

**Decisão II-8:** `REJEITAR MUDANÇA DE DEFAULT`. Full permanece a surface correta nesta geração.
Reabrir somente se uma reduced policy atingir ≥99% do workload normal e houver A/B host-side de
seleção/TTFT.

---

## FAIXA II-9 — Cap/Budget Tuning

- [x] aumentar cap somente se saturation causar repeat causal — pós-I: **0 saturated batches** nas
      hot tools observadas; nenhum aumento autorizado;
- [x] aumentar budget somente se truncation causar continuation material — **0 truncated
      operations**; única continuation foi `repo_bulk_inspect` 12/64, result 156.487 B sob budget 3
      MiB, logo não foi pressão do budget global;
- [x] medir memory/CPU/context pressure — runtime health permaneceu `ok`; não há razão para trocar
      headroom por caps maiores;
- [x] evitar maximizar batch utilization artificialmente — preservado;
- [x] manter resource headroom — preservado.

Nenhum aumento de `terminal_exec` 32, repo 64 ou patch 128/64 é aprovado. **Decisão II-9:**
`REJEITAR TUNING NESTA GERAÇÃO`; reabrir somente com saturation/truncation causal e repetível.

---

## FAIXA II-10 — Novos bounded composites

Somente criar composite quando telemetry provar sequência:

1. frequente;
2. mecanicamente determinística;
3. same-workflow;
4. sem decisão semântica intermediária necessária;
5. segura para executar sob uma única boundary.

Exemplos existentes mostram que o padrão funciona (`postValidate`, `git_publish_changes`), mas não
justificam uma mega-tool.

- [x] identificar candidato — nenhum candidato passa os cinco prerequisites; analytics retorna
      `newCompositeRecommendation=none-from-analytics-alone`;
- [x] shadow counterfactual — sem candidato/lineage, não fabricar counterfactual causal;
- [x] threat/correctness analysis — qualquer novo composite ampliaria authority/schema sem sequência
      same-workflow provada;
- [x] bounded schema — não criado por short-circuit do prerequisite;
- [x] A/B — não executado sem candidato válido;
- [x] rollback — desnecessário porque nenhum composite foi promovido;
- [x] remover/rejeitar composite se não reduzir wall-clock/calls de forma material — decisão de
      rejeição aplicada antes de adicionar código.

**Decisão II-10:** `REJEITADO NESTA GERAÇÃO`. Reabrir somente quando telemetry lineage-bound apontar
uma sequência frequente, mecânica e sem decisão semântica intermediária.

---

## FAIXA II-11 — Explicit Workflow Handle experimental

MCP 2026 permite aplicações stateful por handle explícito, mas isso **não é a primeira solução** de
tracing.

Somente considerar se:

- [x] ChatGPT não propagar trace context suficiente — confirmado: 114/114 starts pós-I observados
      com state `absent`;
- [x] analytics continuar incapaz de medir objetivos importantes — **não**: os upgrades
      materialmente justificáveis II-1/II-2 puderam ser decididos por experimentos controlados;
      ausência de lineage não bloqueia objetivo operacional atual;
- [x] handle puder ser threaded sem call extra — não há evidência host-side atual; exigir threading
      explícito adicionaria context/state e possivelmente novas falhas;
- [x] não criar state correctness escondido — preservado pela não implementação;
- [x] TTL/lifecycle forem claros — seriam nova complexidade sem benefício atual;
- [x] o benefício de attribution justificar descriptor/context cost — não justifica nesta geração.

**Decisão II-11:** `DEPRIORITIZADO / NÃO IMPLEMENTADO`. Reabrir somente se ausência de lineage
bloquear uma decisão de otimização material que não possa ser resolvida por experimento controlado e
se o host puder carregar o handle sem round trip adicional.

---

# 22. Experimentos controlados e indicadores

## 22.1 Golden experiments

### EXP-01 — Terminal commands conhecidos

```text
A = N terminal_exec single
B = 1 terminal_exec.batch
```

Medir:

- MCP calls;
- logical ops;
- coalesced logical ops;
- wall-clock;
- output bytes;
- correctness.

### EXP-02 — Repo inspection

```text
A = reads/searches singles
B = read/search batch ou repo_bulk_inspect
```

### EXP-03 — Heavy framing

```text
A = structured + duplicated text
B = structured + compact summary
```

### EXP-04 — Terminal polling

```text
A = repeated session_read
B = bounded long-poll
```

### EXP-05 — Search hydration

```text
A = search → read
B = bounded hydrated search
```

### EXP-06 — Patch wave

```text
A = patch singles + validator separado
B = patch batch + postValidate causal
```

### EXP-07 — Guidance

```text
A = legacy/mixed guidance
B = canonical Workflow Policy SSOT
```

## 22.2 Indicadores de validade

- `callPairingCoverage`;
- `orphanStartCount`;
- `orphanCompletionCount`;
- `lineageKnownRate`;
- `unknownLineageTransitionRate`;
- `temporalAdjacencyCount`;
- `lineageBoundTransitionCount`;
- `windowCoverageRatio`;
- `generationMixDetected`.

## 22.3 Batch indicators

- calls;
- logical operations;
- coalesced logical operations;
- logical ops/call;
- batch call rate;
- batch-size p50/p95;
- saturation rate;
- truncation rate;
- continuation rate;
- repeat-after-unsaturated-complete-batch;
- repeat-after-saturated-batch.

## 22.4 Decision quality

- routine plan rate;
- poll-after-inline-completion;
- advice violation rate;
- wrong-tool fallback quando classificável;
- granular-Git vs one-shot quando same intent.

## 22.5 Recovery

- known-code unknown-class rate;
- inline next-action coverage por cohort;
- exact anchor coverage/effectiveness;
- temporal recovery pressure;
- lineage-bound recovery traces;
- causal reread rate.

## 22.6 Payload

- structured bytes;
- text bytes;
- total wire bytes;
- duplication proxy;
- truncation;
- reread-after-result rate.

## 22.7 User-perceived

- origin external gap p50/p95;
- inter-tool gap p50/p95;
- client TTFT quando houver evidence;
- turn-complete quando houver evidence.

Não atribuir melhoria dessas métricas ao MCP sem cohort/A-B adequado.

---

# 23. Gates de validação, rollout e publicação

## 23.1 Unit/focused

Cada faixa deve executar os testes diretamente relacionados à mudança. Grandes suites não substituem
regressions focadas.

## 23.2 Static

Quando material:

- TS7 strict focado;
- lint;
- formatting;
- architecture/public membrane;
- import boundaries;
- nenhuma suppression proibida.

## 23.3 Live

Quando a mudança depende da geração runtime:

- reload MCP/Cloudflare quando necessário;
- reconnect do conector quando necessário;
- smoke;
- dashboard;
- source generation confirmation;
- workload controlado;
- resource health.

## 23.4 Publicação

Quando uma onda estiver pronta para publicação:

- documento atualizado;
- worktree revisada;
- paths explícitos;
- preferir `git_publish_changes` quando seu contrato se aplica;
- commit/push;
- `main == origin/main`;
- worktree limpa.

---

# 24. O que não fazer

- não chamar 22,586 h de tempo recuperável;
- não chamar `logicalOperations-calls` de saved round trips sem contrafactual;
- não usar requestId como workflow id;
- não recriar sessão protocolar no MCP 2026 para resolver tracing;
- não persistir `traceparent`, `tracestate` ou `baggage` crus sem necessidade comprovada;
- não inferir recovery causal com um único pending global;
- não deixar analytics truncar janela silenciosamente;
- não misturar cohorts incompatíveis como se fossem mesma geração;
- não aumentar batch caps por intuição;
- não compactar heavy framing sem compatibility A/B;
- não criar mega-tool universal;
- não criar workflow DAG genérica antes de bounded options simples;
- não substituir exact patch por fuzzy mutation automática;
- não retirar hash/preconditions/path policy;
- não aumentar validator concurrency sem resource proof;
- não transformar working set/cache em correctness authority;
- não forçar plan como ritual;
- não fazer poll quando a resposta já concluiu;
- não reduzir tool surface antes de behavioral cleanup;
- não otimizar tool rara antes das hot tools sem evidência superior;
- não marcar checkbox por intenção ou código não validado.

---

# 25. Definition of Done da frente

## 25.1 DoD Roadmap I

Roadmap I estará concluído somente quando:

- [x] call start/completion estiverem correlacionados por identidade;
- [x] adjacência temporal não for rotulada como causal;
- [x] recovery analytics não cruzar workflows/targets silenciosamente;
- [x] trace lineage, quando disponível, for sanitizada e privacy-bounded;
- [x] lineage ausente permanecer explicitamente unknown;
- [x] window completeness estiver provada ou explicitamente limitada;
- [x] cohorts/generations estiverem distinguíveis;
- [x] execution accounting estiver persistido;
- [x] terminal batch accounting estiver correto;
- [x] nomenclatura de compressão não prometer round trips contrafactuais;
- [x] validation guidance tiver uma SSOT sem contradição;
- [x] known path failures tiverem taxonomy/nextAction consistentes;
- [x] batch adoption/saturation/truncation baseline existir;
- [x] payload duplication baseline existir;
- [x] tests/static/live gates relevantes estiverem verdes;
- [x] este documento refletir o estado final real.

## 25.2 DoD Roadmap II

Roadmap II não precisa necessariamente implementar todo candidato; ele estará concluído quando todos
os candidatos tiverem sido **implementados e promovidos** ou **formalmente rejeitados/depriorizados
por evidência**, e:

- [x] round trips evitáveis forem métricas lineage/evidence-bound — analytics v4 preserva temporal
      pressure como não causal e exige lineage/evidência controlada para promoção;
- [x] hot workflows demonstrarem menor call count quando mecanicamente agrupáveis — terminal
      long-poll reduziu o EXP-04 de 3 reads/2 self-loops para 1 read/0 self-loops;
- [x] golden workflows mostrarem wall-clock menor ou igual com mesma correctness — EXP-03 preservou
      structured payload completo com wire menor e EXP-04 retornou output event-driven no tempo
      causal do processo;
- [x] polling mecânico tiver sido comprimido onde justificável — EXP-04: redução controlada de 100%
      dos self-loops;
- [x] payload wire tiver sido reduzido onde seguro — read −46,8%, search −46,6%, tree −61,2% nos
      inputs controlados, sem perda do structuredContent;
- [x] nenhum upgrade relaxar security/correctness boundaries — hashes/path
      policy/lifecycle/cancellation e read imediato permaneceram preservados;
- [x] resource health permanecer saudável — connector smoke 131/131, OAuth/subscription/health
      verdes e sem critical runtime findings;
- [x] docs, tests e runtime estiverem sincronizados — 98/98 testes focados + 19/19 round-trip, TS7
      strict, lint, docs-contract e architecture-contract verdes; source final promovida pelo
      barrier `9f0959731584...`, runtime epoch `e0079c8c-d81b-4ac4-8760-7c39a370e59c`, source drift
      `false` e smoke 131/131;
- [x] repo estiver publicado e limpo no encerramento final da frente — implementação publicada em
      `36006c8e19ee43d417aa6c7f2917062b39e27b0f`, `main == origin/main` e worktree limpa observados
      antes desta atualização documental de encerramento.

**Roadmap II encerrado.** Esta revisão 6.1 é somente a sincronização documental posterior ao
checkpoint limpo/publicado e deve ser publicada sem reabrir qualquer faixa técnica.

---

# 26. Registro de evolução do documento

Esta seção deve crescer ao longo da execução.

## 2026-08-26 — Revisão 1.0

- auditoria inicial criada;
- hot six identificadas;
- 22,586 h reproduzido e reinterpretado como aggregate pressure;
- primeiros bugs/gaps/upgrades inventariados.

## 2026-08-26 — Revisão 2.0

- releitura integral das 2.406 linhas;
- roadmap dividido em Correções e Upgrades;
- Roadmap II bloqueado por Gate I→II;
- documento transformado em referência viva obrigatória;
- confirmado que `OperationContext` já carrega `requestMeta` e `requestId`;
- identificado que requestId é per-request, não workflow lineage;
- identificado que recovery analytics usa `pendingFailure` global e pode cruzar workflows;
- identificado que testes não cobrem concurrency/interleaving do analytics;
- identificado gap latente de `MAX_SUMMARY_ROWS=100000` sem completeness marker;
- nomenclatura `compressedRoundTrips` reclassificada como semanticamente excessiva;
- heavy structured framing movido para Roadmap II por necessidade de compatibility A/B;
- privacy requirement de trace correlation refinado: não persistir W3C context cru por default.

## 2026-08-27 — Revisão 3.0

- implementação source/unit/static do Roadmap I concluída;
- analytics v4, execution accounting, Workflow Policy SSOT e failure semantics promovidos a estado
  candidato;
- baseline pré-rollout preservado e gates live mantidos abertos até restart/reload.

## 2026-08-27 — Revisão 4.0 — encerramento do Roadmap I

- restart externo confirmou primeiro rollout sem necessidade de reconexão manual;
- revisão pós-rollout encontrou e corrigiu correlation indevida de `repo_search_text.batch`;
- aliases recovery de compatibilidade sem consumidores foram removidos;
- source final certificada e promovida via controlled source barrier `2c14dd7180a5...`;
- runtime final `3af912b4-33da-40bc-bfd0-3ed812e7a391`, source drift `false`;
- connector smoke 131/131, runtime health `ok`, analytics v4 e batch accounting comprovados live;
- Gate I→II aberto; Roadmap II permanece não iniciado.

## 2026-08-27 — Revisão 5.0 — execução evidence-gated do Roadmap II

- II-0 rebaselineado sobre cohorts pós-Roadmap I;
- II-1 Heavy Structured Result Framing implementado e promovido: `repo_read_file` −46,8%,
  `repo_search_text` −46,6% e `repo_tree` −61,2% no EXP-03 controlado;
- false positive de `duplicateTextBytes` para tree summary identificado e corrigido;
- II-2 Terminal Session Long-Poll implementado com wait event-driven bounded, cancellation sem matar
  processo e zero busy loop;
- EXP-04 protocol-level reduziu 3 reads/2 self-loops para 1 read/0 self-loops (−100%);
- descriptor total permaneceu com ~248 KiB de headroom;
- II-3→II-11 auditados e formalmente rejeitados/depriorizados quando não havia benefício incremental
  provado, saturation/truncation causal ou coverage suficiente.

## 2026-08-27 — Revisão 6.0 — fechamento técnico e saneamento dos gates finais

- connector smoke renovado após restart: 131/131, OAuth, health e modern subscription verdes;
- gate focal final: 98/98 testes em cinco arquivos, incluindo public API cost governance;
- round-trip analytics adicional: 19/19;
- TS7 strict, lint, Prettier, `git diff --check` e docs-contract verdes;
- architecture-contract inicialmente revelou duas regressões herdadas já presentes no
  `HEAD 935eb58c4`: `workflow-policy` ausente do owner manifest e `summary.js` usando um `Set`
  mutável top-level apenas para lookup;
- dívida herdada saneada sem ampliar baseline: `workflow-policy` classificado como owner protegido
  com membrane pública e `summary.js` passou a usar diretamente a lista terminal canônica;
- architecture-contract repetido integralmente: verde (`owners=70`, mutable state `26/53`, zero
  violações);
- único gate ainda aberto: publicação final + comprovação de worktree limpa.

## 2026-08-27 — Revisão 6.1 — encerramento publicado do Roadmap II

- source final promovida por barrier `9f0959731584...` no runtime epoch
  `e0079c8c-d81b-4ac4-8760-7c39a370e59c`, source drift `false`;
- connector smoke pós-reload: 131/131, OAuth/health/subscription verdes;
- implementação, testes, governança arquitetural e revisão 6.0 publicados no commit
  `36006c8e19ee43d417aa6c7f2917062b39e27b0f`;
- após esse push, `main == origin/main` e worktree limpa foram comprovados;
- último checkbox do DoD Roadmap II fechado;
- esta revisão 6.1 é um commit documental de sincronização e não reabre nenhuma faixa técnica.

## Template obrigatório para próximas revisões

```text
DATE / REVISION
- faixa(s) trabalhada(s)
- novos achados
- bugs corrigidos
- upgrades investigados
- métricas before/after
- testes/gates
- hipóteses rejeitadas/reformuladas
- checkboxes alterados e evidência
- HEAD/commit de checkpoint quando publicado
- próximo gate
```

---

# 27. Fontes e arquivos auditados

## 27.1 Fontes oficiais MCP

- MCP Blog — The 2026-07-28 Specification: `https://blog.modelcontextprotocol.io/posts/2026-07-28/`
- documentação Tier-1 SDK/spec relacionada à era stateless e W3C trace context deve ser revalidada
  na rodada de implementação de tracing.

## 27.2 Código local principal

- `src/copilot/mcp/diagnostics/latency/round-trip/normalizer.js`
- `src/copilot/mcp/diagnostics/latency/round-trip/summary.js`
- `src/copilot/mcp/diagnostics/latency/round-trip/analytics.js`
- `src/copilot/mcp/diagnostics/latency/dashboard/runtime.js`
- `src/copilot/mcp/registry/runtime.js`
- `src/copilot/mcp/protocol/tools/contracts/operation-context.js`
- `src/copilot/mcp/protocol/tools/contracts/result.js`
- `src/copilot/mcp/tools/terminal.js`
- `src/copilot/mcp/process/terminal/runtime.js`
- `src/copilot/mcp/tools/repo-read.js`
- `src/copilot/mcp/workspace/repository/read-cache/runtime.js`
- `src/copilot/mcp/workspace/repository/read/navigation.js`
- `src/copilot/mcp/workspace/repository/patch/failure-semantics.js`
- `src/copilot/mcp/workspace/repository/patch/operations.js`
- `src/copilot/mcp/tools/session-profile.js`
- `src/copilot/mcp/tools/tools-status.js`
- `src/copilot/mcp/tools/meta.js`
- `tests/unit/copilot/mcp/test_mcp_round_trip_analytics.spec.js`

---

# 28. Conclusão

A principal mudança desta revisão é metodológica e operacional.

A frente não será executada como uma sequência indistinta de “otimizações”. Primeiro corrigiremos
aquilo que já sabemos estar errado ou incompleto:

```text
verdade temporal
lineage honesta
recovery correlation
window completeness
execution accounting
terminal batch accounting
guidance única
failure semantics
telemetry de batch/payload
```

Com essa fundação pronta, o Roadmap II foi executado como programa evidence-gated, não como lista
obrigatória de features. `compact framing` e `long-poll` foram promovidos porque passaram A/Bs
controlados; machine outcome transversal, hydration, Working Set V3, advisor separado, adaptive
surface, cap tuning e novos composites foram rejeitados/depriorizados nesta geração porque seus
prerequisites empíricos não foram satisfeitos.

Isso preserva a principal regra arquitetural desta frente: **não otimizar contra uma métrica que não
distingue pressão de causalidade e não adicionar features sem ganho incremental demonstrável**.

As hot tools já concentram 83,8% das calls do baseline de 7 dias e já possuem batching substancial.
Portanto, há espaço real para ganhos. Mas o objetivo não é simplesmente “menos calls”. O objetivo é:

> **menos calls quando a call intermediária não adiciona informação semântica necessária, com mesma
> ou melhor correctness, safety, observabilidade e resource health.**

Este documento passa a ser o registro obrigatório dessa evolução. Cada rodada futura deverá deixá-lo
mais verdadeiro, não apenas mais preenchido.
