# WORKSPACE MCP — ROUND-TRIP, PREFLIGHT, RECOVERY E AUTONOMIA

## Diagnóstico profundo do estado atual, estado-alvo e roadmap de transformação — 2026-08-18

> **Status:** CANÔNICO / ATIVO — roadmap especializado para redução de round-trips, convergência de tools, preflight adaptativo, recuperação de falhas e autonomia operacional do WORKSPACE MCP.
>
> **Workspace:** `/workspaces/chatgpt-docker-puppeteer`.
>
> **Branch:** `main`.
>
> **Baseline sincronizado antes desta investigação:** `HEAD = origin/main = c4f09836c1174f636f8a6cd03da5991660cfdca4`, worktree limpa.
>
> **Relação com documentos existentes:** este documento **não substitui** `WORKSPACE_MCP_IO_LATENCIA_LIBERDADE_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-17.md` nem `DEVCONTAINER_NETWORK_CONTROL_PLANE_DIAGNOSTICO_ESTADO_ALVO_ROADMAP_2026-08-18.md`. O primeiro continua sendo o roadmap mestre da onda MCP/I/O/autonomia; o segundo continua sendo a autoridade especializada do Interaction Latency Control Plane (ILCP), Network Control Plane, ChatGPT/OpenAI/Cloudflare e atribuição causal end-to-end. Este arquivo passa a ser a autoridade especializada para **round-trip economics, preflight/recovery semantics, tool-schema convergence e composição de workflows**.
>
> **Regra de precedência:** código + testes validados no `HEAD` vencem qualquer descrição histórica. Quando este documento divergir do código futuro, a divergência deve ser tratada como drift documental e corrigida no mesmo change-set.

---

# 1. Síntese executiva

A investigação atual parte de uma constatação que já foi demonstrada pelo ILCP e que muda a economia de toda a tool surface:

> **O custo dominante da interação não é, em geral, executar uma tool; é devolver o controle ao host/modelo e esperar a próxima tool começar.**

Na janela de 24 h reconstruída pelo audit do origin:

- p50 de gap inter-tool natural: aproximadamente **10,8 s**;
- p95: aproximadamente **32,9 s**;
- em janelas recentes lentas, p50 observado chegou a **15–17 s**;
- o tempo até o primeiro trabalho MCP discreto (`initialize`) representa tipicamente **~92–98%** do gap;
- `preHandler`/`postHandler` permanecem em poucos milissegundos;
- public MCP self-loop p50 permanece em ~**0,25 s**;
- OpenAI/ChatGPT endpoint TTFB visto do DevContainer permanece na ordem de **~0,1–0,4 s**.

Portanto, qualquer fluxo lógico que use cinco chamadas quando poderia usar uma paga potencialmente quatro impostos externos de vários segundos, mesmo que cada handler individual custe 5–50 ms.

A consequência não é simplesmente “criar batches maiores”. O problema observado é mais sutil:

1. já existem batches poderosos;
2. vários deles já são rápidos e bounded;
3. **falhas de precondition/contexto frequentemente devolvem evidência insuficiente**;
4. o modelo então precisa fazer `falha → read/search → novo patch`;
5. o servidor e o ChatGPT podem divergir sobre o schema/capacidade atual da tool;
6. o caller pode escolher `plan→apply` ou `global-preflight` por metadata antiga, embora o runtime já suporte caminho direto melhor;
7. uma falha causal em um target pode ser apresentada como várias operações falhas, dificultando priorização;
8. analytics históricos ainda não registram de forma first-class a classe causal do bloqueio e o custo de recuperação.

A prioridade desta frente é, portanto:

```text
não remover segurança
        ↓
identificar o bloqueio causal real
        ↓
falhar fechado para mutação
        ↓
falhar rico para diagnóstico
        ↓
resolver deterministicamente na mesma call quando seguro
        ↓
reduzir devoluções desnecessárias ao host/modelo
```

A regra arquitetural central deste roadmap é:

> **Preflight por risco; recovery por evidência; one-shot no caminho feliz; decomposição somente na exceção.**

---

# 2. Por que “preflight” é um rótulo amplo demais

Durante o trabalho recente ocorreram bloqueios que superficialmente pareciam todos “preflight”, mas tinham naturezas diferentes.

Exemplos reais da investigação:

- um batch de seis operações foi inteiramente bloqueado porque um exact-string de teste diferia por escaping;
- outro batch foi bloqueado porque a última âncora não existia;
- um batch foi bloqueado por uma operação no-op;
- chamadas rotuladas `global-preflight` no audit tinham `targetCount=1` e `preflightElided=true`: **não houve whole-batch preview**; a falha veio do compute-before-write atômico do próprio arquivo;
- em `per-target-fast`, vários batches de dois targets aplicaram um target e falharam no outro, preservando progresso independente;
- o host desta conversa continuou projetando um schema antigo de `repo_apply_patch_batch` mesmo depois de o servidor já aceitar limites e defaults novos.

Logo, o termo “preflight block” precisa ser decomposto ao menos nestas classes:

| classe | exemplo | deve bloquear mutação? | recovery ideal |
|---|---|---:|---|
| **integrity** | symlink escape, protected path, hash mismatch relevante | sim | evidência + decisão do caller |
| **stale-context** | exact anchor não existe mais | sim naquela âncora | candidate evidence / convergência |
| **ambiguous-context** | âncora aparece >1 vez | sim | occurrence lines + escolha explícita |
| **already-converged** | old ausente, new já presente exatamente | não deve virar erro operacional cego | sucesso idempotente ou no-op explícito |
| **shape/config** | `replace_all + occurrence_index` | sim | erro local completo, sem reread |
| **capacity/envelope** | ops/targets/bytes acima do hard bound | sim | limites reais + split plan automático |
| **risk-gate** | delete/overwrite | sim | preview/confirm somente para o subset de risco |
| **dependency-abort** | operação 2 falha e 3–8 dependem do estado virtual | sim no target | 1 causa + N dependentes, não N causas |
| **host-schema** | argumento válido no servidor não existe no schema projetado | bloqueia antes do MCP | schema convergence/reconnect |
| **host-approval** | ChatGPT pede aprovação/nega ação | depende do host | annotations/workflow alternativo |
| **external-state** | upstream Git mudou, tunnel/origin caiu | sim quando afeta precondition | refresh bounded + retry governado |

O objetivo não é reduzir o número de gates; é reduzir o número de **round-trips improdutivos causados por gates sem recovery suficiente**.

---

# 3. Baseline causal e econômico

## 3.1 Latência externa observada

No snapshot mais recente durante a investigação:

- `origin external gap p50 ≈ 15,5 s`;
- `origin external gap p95 ≈ 90 s` na janela curta contaminada por investigação pesada;
- `first discrete work delay p50 ≈ 14,2 s`;
- `firstDelay/external ≈ 0,92`;
- cobertura auxiliar ≈ `0,15%`;
- public self-loop p50 ≈ `246 ms`.

Na reconstrução natural de 24 h:

- n ≈ 2.317 gaps interativos;
- p25 ≈ 7,27 s;
- p50 ≈ 10,78 s;
- p95 ≈ 32,86 s;
- p99 ≈ 47,42 s.

O audit é grande (~19 MiB) e a attribution atual lê tail bounded de 4 MiB; logo alguns números históricos são **conservadores/truncados**.

## 3.2 Transições de maior custo em 24 h

| transição | n | gap acumulado | p50 |
|---|---:|---:|---:|
| `repo_read_file → repo_apply_patch_batch` | 101 | ~2.274 s | ~21,2 s |
| `repo_apply_patch_batch → repo_apply_patch_batch` | 69 | ~1.553 s | ~21,7 s |
| `repo_apply_patch → repo_apply_patch` | 121 | ~1.532 s | ~12,1 s |
| `repo_read_file → repo_apply_patch` | 75 | ~1.285 s | ~14,4 s |
| `repo_read_file → repo_search_text` | 83 | ~1.102 s | ~10,5 s |
| `repo_search_text → repo_read_file` | 131 | ~1.012 s | ~7,0 s |
| `repo_read_file → repo_read_file` | 94 | ~848 s | ~7,0 s |
| `repo_apply_patch_batch → run_copilot_validator` | 67 | ~826 s | ~11,5 s |
| `repo_search_text → repo_apply_patch_batch` | 32 | ~736 s | ~19,7 s |
| `repo_apply_patch_batch → repo_read_file` | 65 | ~721 s | ~8,6 s |
| `repo_apply_patch → run_copilot_validator` | 60 | ~682 s | ~10,4 s |
| `repo_search_text → repo_search_text` | 64 | ~647 s | ~8,0 s |
| `repo_bulk_inspect → repo_apply_patch_batch` | 21 | ~526 s | ~22,7 s |
| `repo_file_stats → repo_apply_patch` | 25 | ~523 s | ~20,1 s |
| `repo_file_stats → repo_apply_patch_batch` | 20 | ~395 s | ~17,9 s |

Estes números não significam que toda transição possa ser removida. Eles definem **onde cada round-trip evitado tem maior ROI**.

## 3.3 Valor contrafactual de composição

Se `silent gap p50 = 10 s`, então:

```text
2 calls → 1 call   ≈ até 10 s de imposto evitável
5 calls → 1 call   ≈ até 40 s
10 calls → 1 call  ≈ até 90 s
```

Isso é contrafactual, não medição de economia garantida. Parte do tempo é reasoning necessário. Ainda assim, o audit mostra que ferramentas locais frequentemente terminam em milissegundos enquanto o origin permanece sem nova atividade por segundos.

---

# 4. Estado atual — o que já está bom e deve ser preservado

## 4.1 Patch engine exact-string

`src/copilot/infra/io/patch/text-patch.js` preserva garantias importantes:

- exact match;
- recusa de ambiguidade sem seleção explícita;
- `expected_occurrences` opcional;
- `occurrence_index` explícito;
- `replace_all` explícito;
- `expectedHash` opcional;
- cálculo virtual antes de publish;
- atomicidade por arquivo;
- erro before-write.

**Decisão:** não substituir por fuzzy patch mutante genérico.

## 4.2 Same-file patch batch

O batch same-file já suporta:

- uma leitura/lock;
- virtual state sequencial;
- baseline hash compartilhado;
- várias operações no mesmo arquivo;
- zero publicação parcial quando uma operação intermediária falha;
- localização da operação causal;
- dependentes marcados como abortados.

Esta é uma fundação correta.

## 4.3 `per-target-fast + best-effort`

O código atual de `repo_apply_patch_batch` já usa como default:

```text
applyMode = per-target-fast
failureMode = best-effort
```

Cada target é atômico; targets independentes podem progredir.

**Decisão:** este deve permanecer o caminho feliz padrão.

## 4.4 File batch adaptativo

`repo_apply_file_batch` já demonstra o padrão desejado:

- create;
- move sem overwrite;
- quarantine;
- set executable;

podem usar caminho sequencial direto;

- remove;
- overwrite move;

mantêm whole-batch preflight conservador por default.

**Decisão:** generalizar o princípio, não necessariamente a implementação.

## 4.5 Batches de leitura

Já existem:

- `repo_read_file.batch`;
- `repo_search_text.batch`;
- `repo_bulk_inspect`;
- `repo_working_set`;
- index/symbol/outline.

O problema é uso/convergência e capacidade anunciada, não ausência de primitives.

## 4.6 Validação serializada

O validator control plane já foi endurecido para:

- batch lógico;
- concorrência efetiva 1;
- maxActive global 1;
- anti-nesting em Vitest;
- `VITEST_MAX_WORKERS=2`;
- inline completion;
- post-validation opcional no patch server;
- resource telemetry.

Isso permite composição sem voltar a pressionar WSL.

## 4.7 Git one-shot

`git_publish_changes` já consegue agrupar:

```text
explicit path validation
→ stage
→ commit
→ optional push
→ final verification
```

As tools granulares continuam úteis para exceções/forense, mas não devem ser o default de rotina quando a worktree já está normalizada.

---

# 5. Descoberta P0 — capability real ≠ capability anunciada

Há dois níveis distintos de drift.

## 5.1 Drift dentro do próprio servidor

`src/copilot/mcp/tools/meta.js` ainda anuncia textos como:

- reads/searches em `2–32`;
- patch batch até `64 patches / 32 targets`.

O código validado no baseline já suporta aproximadamente:

- read/search/bulk até 64 operações em superfícies novas/atuais;
- patch batch até 128 operações;
- até 64 targets;
- input budget de 3 MiB;
- `per-target-fast` como default.

Logo, metadata interna stale pode ensinar o próprio modelo a subutilizar a tool.

## 5.2 Drift entre servidor e host ChatGPT

Na mesma conversa desta investigação, após reload/reconnect e servidor já em nova geração, o schema projetado pelo host para `repo_apply_patch_batch` ainda dizia:

```text
max 64 operations
max 32 targets
max 1.5 MiB
Default global-preflight
sem postValidate
```

Enquanto o código real no HEAD já dizia:

```text
max 128 operations
max 64 targets
max 3 MiB
Default per-target-fast
postValidate disponível no servidor
```

Isto é evidência direta de **schema projection stale**.

## 5.3 MCP `listChanged`

O servidor atual:

- usa protocolo `2025-11-25`;
- usa `@modelcontextprotocol/sdk 1.29.0`;
- calcula `descriptorFingerprint`;
- guarda `previousDescriptorFingerprint`;
- calcula `descriptorFingerprintChanged`;
- porém lê `COPILOT_MCP_SERVER_TOOLS_LIST_CHANGED` com default **false**;
- não existe chamada explícita a `sendToolListChanged()`.

A especificação MCP 2025-11-25 prevê `notifications/tools/list_changed` quando a capacidade é anunciada. A documentação atual do TypeScript SDK expõe `sendToolListChanged()` e atualização automática por handles de registration/update.

Fontes primárias consultadas:

- MCP tools, versão 2025-11-25: <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/server/tools.mdx>
- MCP TypeScript SDK — notifications: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/notifications.md>
- MCP schema 2026-07-28, para evolução futura/subscriptions: <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts>
- OpenAI — Developer mode e apps MCP em ChatGPT: <https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta>

A documentação pública da OpenAI consultada não estabelece garantia de que um restart do servidor force imediatamente um refresh de descriptors já projetados na conversa. Portanto:

> **Não devemos assumir que restart == schema refresh.**

O estado-alvo deve medir e testar explicitamente a convergência.

---

# 6. Descoberta P0 — `ERR_PATCH_NOT_FOUND` é pobre demais

O no-match exato atualmente retorna essencialmente:

```text
ERR_PATCH_NOT_FOUND
oldStringChars
```

Isto é seguro, mas insuficiente para recuperação.

Em contraste, outros erros já retornam evidência melhor:

- ambiguous match → occurrence count/lines;
- expected occurrence mismatch → linhas;
- hash mismatch → hashes;
- same-file abort → causal op + dependent ops.

Quando `old_string` não existe, o modelo frequentemente é obrigado a fazer:

```text
patch
→ erro
→ read/search
→ interpretar diferença
→ patch novamente
```

Com p50 inter-tool de 10–20 s, esta recuperação pode custar dezenas de segundos apesar de o engine local poder coletar diagnóstico bounded em milissegundos.

## 6.1 Recovery evidence desejada

Sem realizar fuzzy mutation, o erro pode retornar bounded evidence como:

- current file SHA-256 e bytes;
- newline profile (`LF/CRLF/mixed`);
- `new_string` já existe? quantas vezes? linhas?;
- anchor prefix/suffix parcial presente?;
- whitespace-normalized exact-equivalence candidate count;
- candidate windows limitadas;
- linhas candidatas mais próximas por token/substring, apenas como evidência;
- `alreadyConverged` quando provado;
- `retryClass`;
- `nextAction` realmente executável sem reread quando possível.

## 6.2 O que não fazer

Não:

- escolher fuzzy candidate automaticamente quando há ambiguidade;
- ignorar hash mismatch;
- fazer patch sem exact/structural proof;
- silenciar partial failure;
- transformar “parece parecido” em autorização de write.

---

# 7. Descoberta P0 — audit não mede causal failure corretamente

O audit atual registra eventos agregados de patch, mas não persiste de forma first-class uma distribuição sanitizada de códigos como:

- `ERR_PATCH_NOT_FOUND`;
- `ERR_PATCH_AMBIGUOUS_MATCH`;
- `EEXPECTEDHASH`;
- `ERR_PATCH_NOOP`;
- `ERR_PATCH_CONFLICTING_MODE`.

Além disso, generic `tool_call_completed` pode coexistir com `structuredContent.success=false`/partial workflow, pois o transporte da tool completou corretamente.

Logo, `tool errors` não são iguais a `workflow failures`.

O estado-alvo deve registrar:

```text
transportSuccess
workflowSuccess
semanticFailure
partialSuccess
causalFailureCount
abortedDependentOperationCount
failedTargetCount
recoveryRequiredTargetCount
failureClassCounts
```

Sem patch text, file content ou segredo.

---

# 8. Descoberta P0 — causal failure ≠ failed operations

Um same-file batch de 23 operações pode ter:

```text
1 operação causal falha
22 dependentes abortadas
```

Contar `failedCount=23` faz parecer que existem 23 bugs.

A unidade de priorização deve ser:

1. **causal failure**;
2. target afetado;
3. dependentes abortados;
4. targets independentes salvos.

Métricas futuras:

- `causalFailureRate`;
- `causalFailureByCode`;
- `dependentAbortAmplification`;
- `independentProgressSaved`;
- `recoveryRoundTrips`;
- `recoveryWallClockTaxMs`.

---

# 9. Hipóteses causais para bloqueios e round-trips

## H-RT-001 — preflight universal excessivo

**Estado:** fortemente enfraquecida.

O patch atual já usa fast mode por default. File batch é adaptativo. Muitos eventos chamados “global-preflight” eram single-target com preflight elidido.

## H-RT-002 — caller ainda força `global-preflight` por hábito/metadata stale

**Estado:** confirmada em exemplos recentes.

Mitigação: guidance canônica + schema convergence + policy lint.

## H-RT-003 — exact anchors longas são frágeis a escaping/whitespace

**Estado:** confirmada por incidentes recentes.

Mitigação: candidate evidence, anchor quality diagnostics, structural alternatives onde justificadas.

## H-RT-004 — `expected_occurrences` é usado quando unique-exact já seria suficiente

**Estado:** plausível.

Mitigação: caller guidance; não remover feature.

## H-RT-005 — `expectedHash` é usado reflexivamente e bloqueia edições independentes

**Estado:** plausível, não provada como dominante.

Mitigação: hash por risco/concurrency, não por ritual.

## H-RT-006 — no-op deve ser convergência, não falha, em workflows idempotentes

**Estado:** forte oportunidade.

Mitigação: `alreadyConverged`/`allowAlreadyApplied` com semântica explícita.

## H-RT-007 — erro de schema ocorre no host antes do MCP

**Estado:** confirmado historicamente e na projeção atual.

Mitigação: schema epoch/fingerprint + listChanged + compatibility envelopes + reconnect diagnostics.

## H-RT-008 — aumentar payload resolve o problema

**Estado:** rejeitada como causa central.

`tools/list` ~134 KiB está dentro do budget. Payload pode afetar context pressure, mas não explica bloqueios de anchor/schema.

## H-RT-009 — número de tools é a causa dos bloqueios

**Estado:** rejeitada como causa direta.

125 tools dentro do budget de 250. A principal falha é semântica/convergência.

## H-RT-010 — plan tools devem preceder todo write

**Estado:** rejeitada.

Apply tools revalidam. Plan separado só deve existir quando preview/human approval/forensics agrega informação.

## H-RT-011 — partial progress é perigoso demais e deve ser desativado

**Estado:** rejeitada para targets independentes.

Atomicidade deve ser por target/dependency group, não fingir transação cross-file inexistente.

## H-RT-012 — fuzzy auto-patch eliminaria round-trips

**Estado:** alto risco / não adotar genericamente.

Recovery evidence sim; mutation fuzzy automática não.

## H-RT-013 — search→read é inevitável

**Estado:** rejeitada em muitos casos.

Search pode devolver contexto/hash suficientes; bulk inspect/working set podem compor.

## H-RT-014 — stats→patch é inevitável

**Estado:** rejeitada em muitos casos.

Search/read podem carregar hash patch-ready.

## H-RT-015 — patch→validator é inevitavelmente duas calls

**Estado:** rejeitada para gates allowlisted curtos.

`postValidate` server-side existe; falta convergência de schema e rollout.

## H-RT-016 — validator start→poll→tail é inevitável

**Estado:** rejeitada no caminho comum.

Inline wait + failure tail já permite one-call completion.

## H-RT-017 — Git precisa de 6 calls

**Estado:** rejeitada no caminho feliz.

`git_publish_changes` já existe.

## H-RT-018 — whole audit JSONL pode ser grepado indefinidamente

**Estado:** rejeitada como arquitetura de analytics.

19 MiB e tail truncation já limitam atribuição longitudinal.

## H-RT-019 — descriptor change pode ser inferido só pelo restart

**Estado:** rejeitada.

Fingerprint existe; host projection pode permanecer stale.

## H-RT-020 — listChanged resolverá 100% do cache do ChatGPT

**Estado:** não provada.

Deve ser implementado/testado como mecanismo MCP correto, mas client behavior continua externo.

## H-RT-021 — approval prompts podem ser eliminados pelo servidor

**Estado:** rejeitada.

Annotations/guidance reduzem fricção; host policy permanece soberana.

## H-RT-022 — todo erro recuperável deve retry automaticamente

**Estado:** rejeitada.

Retry same-call somente quando preserva intent e safety proof.

## H-RT-023 — um grande mega-tool resolveria round-trip

**Estado:** rejeitada como estado-alvo.

Preferir composites estreitos, bounded e auditáveis.

## H-RT-024 — mais concurrency reduz wall-clock

**Estado:** condicional.

Útil para I/O independente; perigoso para validators/processos pesados. Resource class deve governar concurrency.

## H-RT-025 — result truncation pode gerar rereads

**Estado:** plausível e mensurável.

Need explicit truncation→follow-up analytics.

## H-RT-026 — diff preview default melhora segurança

**Estado:** rejeitada no caminho normal.

Preview textual grande deve ser opt-in; hashes/summary podem bastar.

## H-RT-027 — retries de transient FS devem sempre voltar ao modelo

**Estado:** oportunidade.

Lock/contention transient bounded pode receber internal retry com backoff pequeno.

## H-RT-028 — changes em paths independentes precisam compartilhar um hash global

**Estado:** rejeitada.

Preconditions devem ser target-scoped.

## H-RT-029 — all-or-nothing cross-file é garantia existente

**Estado:** rejeitada.

Não há transação cross-file real; não vender global-preflight como tal.

## H-RT-030 — richer errors necessariamente incham payload

**Estado:** rejeitada.

Evidence pode ser compacta e só aparecer em falha.

## H-RT-031 — erro de autorização é igual a erro de preflight

**Estado:** rejeitada.

OAuth scope/host approval/path policy precisam classes distintas.

## H-RT-032 — schema stable envelope reduz cache friction

**Estado:** provável.

Bounded string + server allowlist já foi usado com validator; princípio deve ser avaliado por tool.

## H-RT-033 — schema mais permissivo sempre é melhor

**Estado:** rejeitada.

Compatibility envelope deve continuar fechado/bounded e server-enforced.

## H-RT-034 — preflight pode usar evidence cache antiga

**Estado:** risco.

Mutating decision precisa revalidate current target.

## H-RT-035 — recovery diagnostics podem reutilizar current content já lido sob lock

**Estado:** forte oportunidade.

Evita segunda leitura e race de diagnóstico.

## H-RT-036 — batch split pode ser automático quando envelope excede

**Estado:** oportunidade condicional.

Somente quando operações são independentes e semantics permitem; caso contrário retornar split plan.

## H-RT-037 — host block deve cair automaticamente para plan tool

**Estado:** condicional.

Pode reduzir fricção se o block é approval/risk, mas não se schema está stale.

## H-RT-038 — runtime can detect projected schema directly

**Estado:** impossível integralmente.

Server conhece seu descriptor, não o schema já materializado no modelo. Precisa evidence do host/caller.

## H-RT-039 — tool description drift é apenas documentação

**Estado:** rejeitada.

Description influencia planning e portanto call count.

## H-RT-040 — round-trip budget deve ser critério de design de toda tool nova

**Estado:** confirmado como princípio de arquitetura.

---

# 10. Bugs identificados — B-RT-001 a B-RT-036

### B-RT-001 — metadata de I/O anuncia limits antigos

`meta.js` ainda informa 32 reads/searches e 64/32 patch em trechos que divergem do runtime.

### B-RT-002 — metadata pode induzir `global-preflight`/plan desnecessário

Guidance histórica e host schema stale ainda descrevem defaults superados.

### B-RT-003 — `ERR_PATCH_NOT_FOUND` retorna diagnóstico insuficiente

Força reread/search em muitos casos.

### B-RT-004 — no-match não detecta `new_string` já aplicada

Workflow idempotente pode falhar apesar de já convergido.

### B-RT-005 — no-match não informa newline/whitespace mismatch

Falhas triviais parecem anchors inexistentes genéricas.

### B-RT-006 — patch audit não persiste causal failure codes

Impossibilita ranking longitudinal confiável.

### B-RT-007 — generic tool completion não distingue workflow failure

Partial semantic failure pode aparecer como transport completion saudável.

### B-RT-008 — raw failed operation count amplifica causalidade

Dependentes abortados precisam métrica separada.

### B-RT-009 — server calcula descriptor fingerprint, mas não usa para convergence action

Fingerprint é observação passiva.

### B-RT-010 — `tools.listChanged` default false

Contradiz necessidade operacional de descriptors mutáveis durante desenvolvimento.

### B-RT-011 — ausência de emissão explícita de tools-list-changed

Não há caminho ativo para pedir refresh ao cliente quando fingerprint muda.

### B-RT-012 — runtime health não expõe schema convergence de forma compacta

Descriptor fingerprint não está no fluxo operacional principal.

### B-RT-013 — host schema stale não possui epoch handshake

Caller não consegue declarar/compare a versão projetada com a versão real.

### B-RT-014 — compatibility strategy varia por tool

Validator adotou bounded string; outras tools ainda dependem de enums/caps materializados no host.

### B-RT-015 — patch schema projetado pelo host pode contradizer runtime

Confirmado nesta conversa.

### B-RT-016 — `postValidate` implementado no servidor pode ficar invisível ao host

Bloqueia uma otimização de alto ROI.

### B-RT-017 — result hints não incluem recovery-round-trip tax

Falha não comunica custo esperado de nova call.

### B-RT-018 — preflight/partial events não distinguem true whole-batch preflight de single-target atomic failure

O nome `global-preflight` induz diagnóstico causal errado.

### B-RT-019 — audit JSONL grande exigia tail truncation

**estado:** `[x]` mitigado estruturalmente para round-trip analytics com índice incremental derivado. A attribution legacy ainda pode usar tail bounded para outras evidências, mas esta frente não depende mais de revarrer os 19+MiB para métricas longitudinais.

### B-RT-020 — audit schema histórico variou

Greps simples subcontam eventos antigos.

### B-RT-021 — plan/apply usage não tem waste metric

Não sabemos quantos plans foram informativos versus rituais.

### B-RT-022 — search truncation/follow-up não tem causal metric

Não mede `truncated → reread`.

### B-RT-023 — read→search e search→read continuam top transitions

Primitives existem, mas guidance/composition ainda não fecha o ciclo.

### B-RT-024 — stats→patch ainda ocorre

Hash/evidence nem sempre viaja junto do read/search que o produziu.

### B-RT-025 — patch→patch continua muito frequente

Indica fragmentação de edição ou recovery incompleto.

### B-RT-026 — patch_batch→patch_batch continua muito frequente

Pode representar ondas legítimas, mas também batch insuficiente/recovery.

### B-RT-027 — patch→validator ainda é fluxo comum

Composite existe no server, projection/UX ainda não converge.

### B-RT-028 — validator schema projetado pode ficar stale

Já observado anteriormente com enum.

### B-RT-029 — Git granular permanece fácil de escolher apesar de one-shot existir

Happy path ainda depende da disciplina do caller.

### B-RT-030 — host block não é automaticamente correlacionado a “reached MCP?”

Tool diagnóstica existe, mas evidence capture é manual.

### B-RT-031 — approval friction e semantic failure não compartilham taxonomy

Dashboards podem misturar naturezas distintas.

### B-RT-032 — input envelope error não produz split plan first-class

Caller precisa decompor manualmente.

### B-RT-033 — same-call recovery não tem política formal

Cada tool decide ad hoc.

### B-RT-034 — already-converged não é contrato transversal de mutation tools

Idempotência operacional inconsistente.

### B-RT-035 — `tools/list` descriptor bytes concentram-se em descriptions de inputSchema

Não é causa central, mas há ~29 KiB de descriptions dentro de schemas; compaction futura pode preservar semântica com menos contexto.

### B-RT-036 — docs index ainda não conhece este roadmap especializado

Deve ser atualizado após estabilização inicial.

---

# 11. Gaps arquiteturais — G-RT-001 a G-RT-030

### G-RT-001 — não existe `RoundTripRecoveryClass` canônico

### G-RT-002 — não existe `retryability` canônica

Valores alvo:

```text
same-call-safe
caller-refresh
manual-decision
host-refresh-required
non-retryable
```

### G-RT-003 — não existe `mutationState` canônico

```text
none
partial-independent-progress
fully-applied
already-converged
```

### G-RT-004 — não existe `failureScope` canônico

```text
operation
target
dependency-group
batch
host
external
```

### G-RT-005 — não existe recovery evidence budget comum

### G-RT-006 — não existe policy de same-call retry

### G-RT-007 — não existe already-converged contract comum

### G-RT-008 — não existe anchor-quality score/diagnóstico

### G-RT-009 — não existe split-plan para envelope overflow

### G-RT-010 — não existe schema epoch end-to-end

### G-RT-011 — não existe client-projected descriptor fingerprint evidence

### G-RT-012 — não existe list-changed verification test com ChatGPT

### G-RT-013 — não existe fallback strategy quando client ignora list-changed

### G-RT-014 — não existe compatibility envelope policy por estabilidade do campo

### G-RT-015 — não existe round-trip SLO por workflow

### G-RT-016 — não existe recovery-round-trip counter

### G-RT-017 — não existe failed-call wall-clock tax estimator persistido

### G-RT-018 — analytics incremental completo sobre audit JSONL

**estado:** `[x]` fechado na arquitetura atual: reader por byte offset/newline, file identity, SQLite derivado, idempotência por source offset, retention bounded, monitor non-blocking e testes de rotação/idempotência.

### G-RT-019 — não existe schema-version migration normalizer para audit histórico

**estado:** `[~]` legacy rows já recebem fallbacks `unknown-or-legacy`; falta migração mais rica se análises antigas exigirem semântica equivalente aos novos eventos causais.

### G-RT-020 — não existe plan-value metric

### G-RT-021 — não existe caller-policy lint para plan/global-preflight redundante

### G-RT-022 — não existe composite design checklist

### G-RT-023 — não existe resource-class concurrency contract geral

### G-RT-024 — não existe bounded recovery candidate algorithm compartilhado

### G-RT-025 — não existe target-local evidence envelope comum

### G-RT-026 — não existe workflow trace que conecte fail→inspect→retry causalmente

### G-RT-027 — não existe benchmark A/B “same logical objective, different call count” padronizado

### G-RT-028 — não existe cost model que inclua host silent gap em design reviews

### G-RT-029 — não existe publication policy que escolha `git_publish_changes` automaticamente no happy path

### G-RT-030 — não existe Definition of Done transversal para “zero avoidable follow-up”

---

# 12. Estado-alvo — Round-Trip Recovery Control Plane (RTRCP)

O estado-alvo não é uma nova mega-tool. É uma camada de contratos compartilhados entre tools.

```text
Intent
  ↓
Tool capability contract
  ↓
Risk classifier
  ↓
Precondition gate
  ↓
Mutation / computation
  ↓
Outcome classifier
  ├─ success
  ├─ already-converged
  ├─ partial-independent-progress
  └─ blocked
        ↓
Bounded recovery evidence
        ↓
Same-call deterministic recovery? ─ yes → revalidate → execute once
        │
        no
        ↓
Caller receives complete next action
```

## 12.1 Princípios

1. **Safety proof precede mutation.**
2. **Failure evidence is generated from the state already observed whenever possible.**
3. **No second read just to explain an error when the failing layer already has current content.**
4. **Same-call recovery requires proof, not heuristic confidence.**
5. **Independent targets progress independently.**
6. **Dependent operations preserve atomic group semantics.**
7. **Plan is an informational primitive, not a ritual prerequisite.**
8. **Schema changes are observable, versioned and convergent.**
9. **Happy path is one-shot; forensic path is decomposable.**
10. **Round-trip tax is a first-class architectural budget.**

---

# 13. Failure envelope v2

Proposta conceitual:

```json
{
  "success": false,
  "workflowSuccess": false,
  "failureClass": "stale-context",
  "code": "ERR_PATCH_NOT_FOUND",
  "scope": "target",
  "causal": true,
  "retryability": "caller-refresh",
  "mutationState": "none",
  "target": {
    "path": "...",
    "currentHash": "...",
    "bytes": 12345
  },
  "recoveryEvidence": {
    "desiredAlreadyPresent": false,
    "newlineStyle": "lf",
    "candidateCount": 1,
    "candidates": []
  },
  "nextAction": "...",
  "roundTripTaxEstimate": {
    "authority": "historical-inter-tool-gap-proxy",
    "p50Ms": 10000
  }
}
```

Não é necessário devolver todos os campos para toda tool. O envelope define semântica comum.

---

# 14. Recovery de patch — estado-alvo

## 14.1 Nível 0 — exact success

Sem mudança.

## 14.2 Nível 1 — already converged

Quando:

- `old_string` ausente;
- `new_string` presente exatamente na cardinalidade esperada;
- nenhum outro requisito conflita;

retornar resultado explicitamente convergido.

Possíveis policies:

```text
strict-error          # compat atual
recognize-only        # reporta converged, sem tratar como write
accept-converged      # workflowSuccess=true, mutationState=already-converged
```

Default inicial sugerido: `recognize-only` ou `accept-converged` apenas em batch/composite onde idempotência é explícita.

## 14.3 Nível 2 — bounded diagnostics

Para no-match:

- hash/bytes;
- line endings;
- desired text presence;
- candidate lines;
- common prefix/suffix;
- whitespace-normalized candidate count;
- optionally syntax-node candidate se parser já disponível e linguagem suportada.

## 14.4 Nível 3 — deterministic same-call recovery

Permitido apenas quando há equivalência provada, por exemplo:

- LF vs CRLF normalização determinística;
- BOM conhecido;
- exact desired state já presente;
- target path canonicalization já validada.

Não permitido para fuzzy semantic matching genérico.

---

# 15. Preflight adaptativo por risco

## 15.1 Classe R0 — read/compute

Sem preflight mutante.

## 15.2 Classe R1 — additive/idempotent bounded write

Exemplos:

- create onde target não existe;
- index invalidate;
- append de audit interno;
- exact patch em target único já revalidado.

Caminho: direct revalidate→apply.

## 15.3 Classe R2 — reversible mutation

Exemplos:

- move sem overwrite;
- quarantine;
- set executable.

Caminho: direct bounded apply + rollback metadata quando aplicável.

## 15.4 Classe R3 — destructive/overwrite/external publication

Exemplos:

- remove;
- overwrite move;
- Git push;
- Cloudflare mutation.

Caminho: explicit confirmation/preflight suficiente para o risco.

## 15.5 Regra

**Nunca promover R3 para R1 apenas para reduzir round-trip.**

O ganho deve vir de fundir preflight e apply dentro da mesma tool governada quando a plataforma permitir confirmação explícita no mesmo request, não de retirar o gate.

---

# 16. Schema Convergence Control Plane

## 16.1 Estado atual

Servidor sabe:

- descriptor fingerprint atual;
- fingerprint anterior;
- se mudou;
- surface state.

Host pode continuar stale.

## 16.2 Estado-alvo

Cada generation deve expor compactamente:

```text
serverSchemaEpoch
serverDescriptorFingerprint
serverToolCount
serverCapabilityVersion
listChangedAdvertised
listChangedSentCount
lastListChangedAt
lastToolsListObservedAt
lastToolsListClientProtocol
```

Quando houver evidence do caller:

```text
clientProjectedSchemaEpoch
clientProjectedDescriptorFingerprint? # se disponível
clientObservedToolShapeVersion
schemaConvergenceStatus
```

Estados:

```text
unknown
converged
server-changed-client-unverified
client-stale-observed
notification-sent-awaiting-refresh
host-refresh-required
```

## 16.3 Rollout MCP

1. validar comportamento SDK 1.29.0;
2. ativar `listChanged` em teste/control profile;
3. emitir notification em fingerprint change **somente em conexões que suportem**;
4. observar se ChatGPT refaz `tools/list`;
5. se sim, promover;
6. se não, manter notification correta mas orientar reconnect/schema refresh;
7. preparar futuro protocolo 2026-07-28 subscription-aware sem migrar prematuramente.

---

# 17. Stable compatibility envelopes

Campos que mudam com frequência não devem necessariamente virar enums rígidos no schema materializado pelo host.

Padrão já usado com validator:

```text
schema: bounded string
runtime: canonical allowlist
error: allowed values atuais
```

Aplicar seletivamente onde:

- novos valores são adicionados com frequência;
- host cache stale é comprovado;
- server validation continua fechada;
- não aumenta superfície de input arbitrário.

Não aplicar onde enum rígido agrega safety significativa e muda raramente.

---

# 18. Composição de workflows prioritários

## 18.1 inspect → patch

Objetivo:

```text
search/read/bulk result
+ patch-ready hash
+ enough bounded context
→ patch direto
```

Evitar `stats` separado.

## 18.2 patch → validate

Servidor já tem `postValidate`.

Estado-alvo:

- allowlist fixa;
- prevalidate config antes do write;
- max validators bounded;
- maxActive=1;
- failure semantics distinguem write de validation;
- schema visível/convergente.

## 18.3 plan → apply

Policy:

- default direct apply para bounded write;
- plan só se `previewRequired=true`, risco alto, user pediu preview ou caller ainda não tem intent suficiente.

## 18.4 validator → poll → tail

Default:

- inline wait;
- summary na mesma response;
- failure tail bounded na mesma response;
- polling apenas quando wait expirou.

## 18.5 Git publication

Happy path:

```text
status normalized
→ git_publish_changes(paths, message, optional push)
→ final clean/upstream proof
```

Fallback granular apenas para:

- staged index preexistente;
- merge/rebase state;
- upstream drift;
- dry-run/inspection explícita;
- erro parcial/forense.

## 18.6 restart → readiness

Avaliar composites estreitos:

```text
reload schedule
→ persisted runner completes
→ bounded readiness snapshot
```

Sem bloquear resposta que dispara restart e sem esconder failure epoch.

---

# 19. Result payload e truncation

`tools/list` atual:

- 125 tools;
- envelope ~134.075 bytes;
- budget 163.840;
- headroom ~29.765;
- p50 descriptor ~850 bytes;
- p95 ~2.482 bytes;
- maior descriptor: `repo_apply_patch_batch` ~4.927 bytes;
- maior família: `inputSchema` ~66,9 KiB;
- descriptions dentro de inputSchema ~29,3 KiB.

Conclusão:

- não culpar payload pela falha de preflight;
- evitar crescimento sem limite;
- compactar descriptions redundantes gradualmente;
- manter rich recovery **só em failure path**;
- medir truncation que gera follow-up.

---

# 20. Approval e host-block friction

O servidor não controla a política de aprovação do ChatGPT.

Estado-alvo:

1. annotations precisas;
2. mutation classes consistentes;
3. bounded direct tools preferidas;
4. plan fallback quando host bloqueia write e preview realmente ajuda;
5. `mcp_host_block_diagnostics` captura:
   - chegou ao MCP?;
   - houve schema error?;
   - houve OAuth challenge?;
   - houve tool result error?;
6. host block entra na mesma taxonomy, mas com `scope=host`.

Não confundir host denial com server preflight.

---

# 21. Analytics de round-trip — estado-alvo

Criar um analyzer incremental sobre o audit em vez de reprocessar JSONL gigante.

Métricas mínimas:

```text
callsByTool
transitionsByPair
transitionGapP50/P95/total
workflowTraceCount
failureClassCount
causalFailureByCode
recoveryRoundTrips
recoveryGapMs
planThenApplyCount
planWithoutApplyCount
failedThenInspectThenRetryCount
patchThenValidateCount
validatorPollCount
logTailAfterFailureCount
gitGranularPublishCount
gitOneShotPublishCount
resultTruncationFollowUpCount
schemaStaleObservedCount
hostBlockCount
```

Persistência sugerida:

- SQLite existente ou tabela dedicada no store operacional;
- incremental cursor/offset;
- schema version;
- no raw sensitive args;
- bounded retention.

---

# 22. Oportunidades priorizadas por ROI

## P0

1. `ERR_PATCH_NOT_FOUND` fail-rich.
2. already-converged detection.
3. causal failure taxonomy/audit.
4. metadata limits/defaults sync.
5. schema epoch/fingerprint surface.
6. MCP listChanged experiment.
7. postValidate projection/convergence.
8. remove default caller use of global-preflight.

## P1

9. recovery analyzer incremental.
10. plan-value analytics.
11. split-plan on envelope overflow.
12. target-local recovery evidence envelope.
13. search/read result contract patch-ready.
14. Git one-shot as recommended normal publish path.
15. validation one-call policy enforcement.
16. schema compatibility envelopes where justified.

## P2

17. anchor-quality diagnostics.
18. structural patch primitives para AST-safe narrow use cases.
19. restart/readiness composition.
20. approval-block evidence workflow.
21. tools/list description compaction.
22. automatic logical workflow benchmark.

## P3 / experimental

23. deterministic normalization retry.
24. dependency-aware batch auto-split.
25. caller policy hints based on current round-trip SLO.
26. schema-convergence canary in ChatGPT.

---

# 23. Roadmap — FAIXAS A a R

Legenda:

- `[x]` concluído/provado;
- `[~]` parcialmente implementado ou evidência parcial;
- `[ ]` pendente;
- `[!]` dependência externa/não controlável integralmente.

## FAIXA A — baseline e investigação

### A0 — sincronização

- [x] worktree classificada;
- [x] secret scan final;
- [x] focused tests;
- [x] typecheck;
- [x] lint;
- [x] explicit staging;
- [x] commit `c4f09836c`;
- [x] push;
- [x] `main == origin/main`;
- [x] worktree limpa antes da nova investigação.

### A1 — causalidade de round-trip

- [x] ILCP prova multi-second silent gap;
- [x] top transitions 24h;
- [x] patch engine lido;
- [x] file batch lido;
- [x] generic bulk executor lido;
- [x] Git publish lido;
- [x] host schema stale observado;
- [x] tool payload audit;
- [x] MCP listChanged spec/SDK investigados;
- [x] novo documento canônico criado.

## FAIXA B — taxonomy e contracts

### B0 — outcome model

- [~] `failureClass` implementado inicialmente para patch (`stale-context`, `ambiguous-context`, `integrity`, `dependency-abort`, `already-converged`, `shape-config`, `unknown`); falta promover a contrato transversal;
- [~] `failureScope` implementado em patch (`target`/`dependency-group`); falta generalização;
- [~] `retryability` implementado em patch; falta registry transversal;
- [~] `mutationState` implementado em patch (`none`, `already-converged-candidate`, `already-converged`, `fully-applied`); falta envelope comum;
- [~] `workflowSuccess` já existe/foi propagado nos paths principais de patch; falta transversalidade;
- [~] `alreadyConverged` reconhecido informacionalmente como candidato; promoção automática continua deliberadamente pendente.

### B1 — compatibility

- [ ] helper de envelope v2;
- [ ] projeção compat legacy;
- [ ] testes de semântica de partial/causal/dependent;
- [ ] docs do contrato.

## FAIXA C — patch fail-rich P0

### C0 — no-match diagnostics

- [x] hash/bytes current anexados a partir do mesmo estado locked/virtual que falhou, sem reread;
- [x] newline profile (`lf`/`crlf`/`cr`/`mixed`/`none`);
- [x] desired string presence/count/linhas bounded;
- [x] candidate line windows bounded por fragmentos do próprio `old_string`;
- [x] whitespace-normalized evidence;
- [x] scan/result budget estrito (scan rico apenas até 4 MiB de chars, linhas/ocorrências limitadas);
- [x] zero fuzzy mutation — heurísticas são somente evidência.

### C1 — convergence

- [x] detect desired already present exatamente e cardinalidade bounded;
- [x] `recognize-only` policy: `convergenceCandidate=true`, `mutationState=already-converged-candidate`, zero write;
- [ ] avaliar `accept-converged` em composite idempotente;
- [x] tests CRLF/BOM/whitespace;
- [~] hash do estado locked/virtual testado; stress específico de concurrent hash drift ainda pendente.

### C2 — batch propagation

- [x] preserve one causal row por target;
- [x] dependents separados como `dependency-abort`;
- [x] independent progress preservado em `per-target-fast` e provado durante a própria implementação;
- [x] `nextAction` usa currentHash/normalization/candidateLines e evita reread somente-diagnóstico quando possível.

## FAIXA D — audit e analytics

### D0 — sanitized failure analytics

- [x] `causalByCode` persistido nos eventos batch relevantes;
- [x] semantic/workflow success e partial propagados no audit de patch batch;
- [x] `recoveryRequiredTargetCount` persistido;
- [~] `mutationState` está nas responses/single failure audit; ampliar agregação histórica;
- [x] nenhum raw patch text é persistido nos novos eventos.

### D1 — incremental analyzer

- [x] schema version do índice derivado;
- [x] cursor por byte offset + identidade do arquivo, com ingestão idempotente por `(source_identity, source_offset)`;
- [x] SQLite compartilhado em WAL como índice reconstruível, mantendo JSONL append-only como source-of-record;
- [~] historical normalizer indexa schema legacy com fallbacks `unknown-or-legacy`; ampliar migração semântica quando necessário;
- [x] janelas configuráveis até 14 dias, com default 24h;
- [x] eliminada dependência estrutural do tail de 4MiB: primeiro backfill pode consumir chunks incrementais e ciclos seguintes apenas bytes novos;
- [x] eventos de fixtures `/.ai/jobs/` marcados `synthetic` e excluídos por default;
- [x] rotação/truncamento detectados sem continuidade silenciosa;
- [x] monitor non-blocking de baixa frequência implementado no lifecycle HTTP; readiness não depende dele.

### D2 — workflow traces

- [x] `fail→inspect→retry` reconstruído em janela bounded de recovery, com round-trips e wall-clock tax;
- [x] `plan→apply` contado para patch/file/Git pairs conhecidos;
- [ ] `patch→validate` ganha trace dedicado em vez de depender apenas de transition ranking;
- [x] validator polling/tail contado via `job_get_summary`/`job_get_output`;
- [x] Git granular vs `git_publish_changes` contado;
- [ ] truncation→follow-up;
- [x] top transitions passam a ser derivadas do índice incremental com total/p50/p95.

## FAIXA E — server guidance convergence

### E0 — metadata sync

- [x] 64 read/search e `contextLines<=48` derivados da SSOT;
- [x] 128/64/3MiB patch derivado da SSOT;
- [x] `per-target-fast + best-effort` default correto na guidance;
- [x] `postValidate` visível na projeção observada após reconvergência parcial do host;
- [x] guidance contraditória de validator concurrency=2 removida; guidance canônica agora diz cap=1;
- [x] teste prova limits/guidance principais contra a SSOT.

### E1 — single source of capability truth

- [x] `control-plane/tool-capabilities.js` criado e versionado;
- [x] `repo-read`, `repo-write`, validators e `meta.js` consomem as mesmas constants;
- [ ] payload audit passa a projetar explicitamente `executionLimitsVersion` quando útil;
- [ ] docs generator opcional.

## FAIXA F — schema convergence

### F0 — observability

- [x] process-local schema `runtimeEpoch`;
- [x] descriptor fingerprint em `mcp_runtime_health` e server factory status;
- [x] previous/current fingerprint + descriptor revision;
- [x] `listChanged` state e `tools/list` observed counters;
- [x] notification attempt/sent/error counters.

### F1 — MCP listChanged

- [x] comportamento do método `sendToolListChanged()` coberto com fake determinístico e envio live aceito pelo SDK/transport;
- [x] capability `tools.listChanged=true` habilitada por default com env rollback existente;
- [x] nudge bootstrap one-shot por descriptor revision, fire-and-forget e sem fan-out por session churn;
- [ ] verify tools/list refresh com inspector dedicado;
- [x] ChatGPT connector verificado live: notification enviada com sucesso, mas após 5 sessões `toolsListObservedCount=0`; host **não** relistou automaticamente nesta conversa;
- [x] rollback switch: `COPILOT_MCP_SERVER_TOOLS_LIST_CHANGED=false`.

**Prova live 2026-08-18:** runtime epoch `ab77be78-...`, descriptor revision 1, tool count 125, `listChangedAdvertised=true`, `listChangedAttemptCount=1`, `listChangedSentCount=1`, `listChangedErrorCount=0`, `toolsListObservedCount=0`, status `notification-sent-awaiting-refresh`. Antes do nudge, a geração anterior ficou `server-descriptor-unlisted` com 2 sessões e zero `tools/list`. Portanto notification correta é insuficiente para forçar o refresh do host; repetir/spammar notifications não é a estratégia alvo.

### F2 — client fallback

- [~] estados `server-descriptor-unlisted`, `notification-sent-awaiting-refresh`, `converged-observed` e `server-changed-client-unverified` já existem; `mcp_host_block_diagnostics` agora aceita evidence explícita de schema rejection antes do MCP;
- [x] `mcp_host_block_diagnostics` classifica `LIKELY_STALE_CLIENT_SCHEMA_PROJECTION`, projeta capability truth e instrui a **não** inserir uma plan call apenas para contornar schema stale;
- [x] compatibility envelope live no validator: cliente stale pode pedir `batchConcurrency=2`, mas runtime normaliza para `effectiveConcurrency=1`, retorna `compatibilityNormalized=true` e preserva headroom;
- [~] compatibility envelope já usado em validator bounded-string/legacy concurrency; expandir seletivamente para outros campos high-churn onde safety permanecer server-enforced;
- [x] `mcp_tools_status` virou compact truth surface com `executionLimitsVersion`, limits reais, schema convergence e `planFirstWorkflows=[]`;
- [!] lifecycle/cache total da projeção de schema no ChatGPT host — externo e, no experimento live, não reativo a `tools/list_changed`.

## FAIXA G — preflight adaptativo

### G0 — patch caller policy

- [ ] default path nunca força global-preflight sem razão;
- [ ] caller guidance test;
- [ ] audit explicit `preflightActuallyRan`;
- [ ] distinguish mode label from real preview.

### G1 — risk matrix

- [ ] R0–R3 classifier;
- [ ] map mutation tools;
- [ ] preserve delete/overwrite gates;
- [ ] no safety regression.

## FAIXA H — envelope overflow recovery

- [ ] return actual limits;
- [ ] identify independent split groups;
- [ ] generate bounded split plan;
- [ ] optionally execute multiple independent chunks same call when safe;
- [ ] preserve same-file dependency group indivisibility;
- [ ] tests size/ops/targets thresholds.

## FAIXA I — inspect→patch compression

### I0 — search/read result

- [~] single-file search hash já implementado;
- [ ] standard patch-ready metadata;
- [ ] content window + hash + line range contract;
- [ ] avoid stats follow-up;
- [ ] test search→patch without read.

### I1 — working set

- [ ] use current hashes in selected manifest;
- [ ] delta refresh patch hints;
- [ ] batch mutation integration only if safety remains explicit.

## FAIXA J — patch→validate compression

- [x] server-side `postValidate` projetado e utilizável pelo host atual;
- [x] anti-nesting/capacity guards;
- [x] duas provas live via tool projetada: patch único + teste focado e batch 7 patches/2 targets + teste focado, ambos com validator concluído na mesma resposta;
- [x] `workflowSuccess` separa apply de post-validation e o resultado devolve job/status/tempo bounded;
- [~] analyzer incremental agora separa `patchThenValidatorTransitions` de `compositePostValidationCount`; acumular série pós-rollout;
- [x] prova de custo local: apply ~25–31ms; validator ~1,2–2,6s na mesma call, evitando um novo gap externo de vários segundos;
- [ ] fault injection específico: write aplicado + post-validation falha, confirmando semantics de não-retry do patch.

## FAIXA K — validation control plane

- [x] batch logical;
- [x] concurrency efetiva 1;
- [x] inline completion;
- [x] bounded failure tail;
- [x] guidance removeu validation plan do happy path; `run_copilot_validator` está em `directBatchWorkflows`;
- [x] `mcp_validation_plan` marcado como escalation-only no status compacto;
- [x] compatibility input `batchConcurrency<=2` é normalizado para 1, evitando rejeição por schema stale sem reabrir concorrência;
- [~] `validatorPollCount` já é mensurável no analyzer incremental; meta é fazê-lo tender a zero no caminho normal.

## FAIXA L — Git publication

- [x] `git_publish_changes` existe e cobre stage→commit→optional push→final verification com paths explícitos;
- [x] `mcp_tools_status.publicationWorkflow.preferred=git_publish_changes` torna one-shot o happy path explícito;
- [x] granular fallback matrix explicitada: staged index preexistente, merge/rebase, HEAD/upstream drift, preview/forensics ou partial publish failure;
- [x] preserve explicit paths, expected HEAD/upstream e proibição de force/refspec arbitrário;
- [x] analyzer decompõe `planThenApplyByPair` e `gitGranularByTool`;
- [x] baseline live 24h: 84 calls Git granulares vs 5 one-shot (ratio 16,8×); os 37 `plan→apply` são integralmente Git: stage 11, commit 13, push 13;
- [~] este próprio milestone será publicado por `git_publish_changes` para provar o caminho one-shot end-to-end;
- [ ] acompanhar queda longitudinal do ratio granular/one-shot após adoção.

## FAIXA M — host approval/block friction

- [~] annotations existem e continuam sendo refinadas;
- [x] `mcp_host_block_diagnostics` separa host-precall, schema projection stale, OAuth e server/tool result;
- [ ] stable host-block evidence record persistente (bloqueios precall não chegam ao audit MCP);
- [x] `reached-server` é discriminador first-class no diagnóstico manual;
- [x] schema-error vs generic approval/safety vs OAuth taxonomy disponível;
- [x] fallback por classe: schema stale usa capability truth/reprojection, e plan só é sugerido quando preview/risk boundary agrega informação;
- [x] A/B live: uma call de 4 exact patches/2 targets foi bloqueada precall pelo host; 3 operações no mesmo target e o patch único do segundo target passaram. Evidência sugere que shape/complexidade pode aumentar friction mesmo com risco material semelhante; não inferir threshold determinístico ainda;
- [!] host safety policy permanece externa.

## FAIXA N — payload/result pressure

- [x] tools/list measured ~134 KiB/125 tools;
- [x] within 160 KiB envelope;
- [ ] derive descriptor descriptions from compact reusable strings;
- [ ] trim redundant schema descriptions;
- [ ] maintain semantic clarity;
- [ ] truncation-follow-up metric;
- [ ] no payload optimization justified only by byte aesthetics.

## FAIXA O — composites estreitos

- [ ] define composite admission criteria;
- [ ] max logical operations;
- [ ] risk homogeneity rule;
- [ ] partial failure contract;
- [ ] rollback semantics explicit;
- [ ] no arbitrary shell;
- [ ] no mega-tool generic dispatcher.

Candidates:

- [ ] inspect+patch evidence;
- [~] patch+validate;
- [x] Git publish;
- [ ] reload+readiness;
- [ ] maintenance safe batch.

## FAIXA P — deterministic same-call recovery

- [ ] recovery policy registry;
- [ ] LF/CRLF normalization proof;
- [ ] BOM normalization proof;
- [ ] already-converged path;
- [ ] transient lock retry;
- [ ] maximum retry count = 1 initially;
- [ ] revalidate immediately before retry;
- [ ] audit retry cause/result.

## FAIXA Q — benchmarks e fault injection

### Q0 — patch failures

- [ ] missing exact anchor;
- [ ] ambiguous anchor;
- [ ] expected hash stale;
- [ ] already applied;
- [ ] CRLF mismatch;
- [ ] BOM;
- [ ] dependent operation fail;
- [ ] independent target fail;
- [ ] envelope overflow.

### Q1 — schema

- [ ] server descriptor changes while session active;
- [ ] notification sent;
- [ ] client tools/list refreshes;
- [ ] host ignores notification;
- [ ] reconnect restores convergence.

### Q2 — workflow A/B

For each logical objective:

```text
A = current multi-call workflow
B = compressed workflow
```

Measure:

- calls;
- logical operations;
- handler ms;
- silent gap total;
- wall-clock;
- bytes;
- failure semantics;
- human/host approvals.

## FAIXA R — publication e rollout

- [ ] focused tests green;
- [ ] typecheck;
- [ ] lint;
- [ ] no WSL resource regression;
- [ ] no secret/artifact drift;
- [ ] update `docs/INDEX.md`;
- [ ] update master Aug-17 roadmap where needed;
- [ ] update ILCP references if metrics/contracts changed;
- [ ] explicit staging or safe one-shot publish;
- [ ] commit;
- [ ] push;
- [ ] `HEAD == origin/main`;
- [ ] clean worktree.

---

# 24. Bugs e gaps que **não** devem ser “corrigidos” enfraquecendo safety

1. protected paths continuarem bloqueados;
2. `node_modules` continuar fora da surface de leitura do repo tool;
3. path traversal continuar bloqueado;
4. symlink escape continuar bloqueado;
5. delete exigir confirmação;
6. overwrite ter gate explícito;
7. Git push continuar sem force/arbitrary refspec;
8. arbitrary shell continuar indisponível;
9. validators continuarem allowlisted;
10. Cloudflare mutations continuarem plan/backup/governed;
11. OAuth scopes continuarem enforced;
12. hash mismatch continuar bloqueando quando o caller escolheu essa garantia.

A meta é remover **cerimônia sem informação**, não controles de integridade.

---

# 25. ADRs — decisões arquiteturais

### ADR-RTR-001 — round-trip é budget arquitetural

Toda nova tool/composite deve justificar quantas devoluções ao host/modelo exige para o objetivo lógico normal.

### ADR-RTR-002 — preflight é risk-adaptive

Não usar whole-batch preview universal.

### ADR-RTR-003 — apply revalida sua própria segurança

Plan separado não é precondition técnica automática.

### ADR-RTR-004 — exact patch permanece default

Fuzzy mutation genérica é rejeitada.

### ADR-RTR-005 — fail closed / fail rich

Mutation bloqueada pode e deve devolver evidence suficiente para recovery bounded.

### ADR-RTR-006 — causal failure é unidade de observação

Dependent aborts são consequência, não causas independentes.

### ADR-RTR-007 — independent progress é preservado

Atomicidade por target/dependency group; não fingir cross-file transaction.

### ADR-RTR-008 — already-converged é estado legítimo

Idempotent convergence não deve ser confundida com mutation failure.

### ADR-RTR-009 — same-call retry exige proof

Nenhum retry mutante baseado apenas em similaridade heurística.

### ADR-RTR-010 — schema convergence é control plane

Server capability e client-projected capability são estados distintos.

### ADR-RTR-011 — listChanged é mecanismo MCP, não garantia de ChatGPT behavior

Implementar corretamente e medir o cliente.

### ADR-RTR-012 — compatibility envelope continua server-enforced

Schema host-stable pode ser mais amplo apenas dentro de bounds rígidos.

### ADR-RTR-013 — one-shot no happy path

Granular tools são forensics/fallback, não ritual obrigatório.

### ADR-RTR-014 — rich failure é conditional payload

Não inflar successful hot path para melhorar errors raros.

### ADR-RTR-015 — analytics deve ser incremental

Não depender de tail/grep de JSONL crescente para decisões P0.

### ADR-RTR-016 — validator concurrency continua conservadora

Round-trip reduction não autoriza process fan-out.

### ADR-RTR-017 — host block e server block são taxonomias separadas

`reachedMcp` é discriminador causal.

### ADR-RTR-018 — payload não é causa presumida

Medir antes de compactar.

### ADR-RTR-019 — docs/guidance fazem parte do runtime de decisão

Metadata stale é bug operacional.

### ADR-RTR-020 — nenhuma transformação ampla antes do baseline/documento

Este documento cumpre o gate pedido para a nova rodada.

---

# 26. Protocolos experimentais obrigatórios

## EXP-RTR-01 — missing anchor

1. criar fixture;
2. aplicar anchor ausente;
3. medir evidence retornada;
4. verificar zero write;
5. verificar se nova call é necessária;
6. objetivo: recovery sem reread quando possível.

## EXP-RTR-02 — already converged

1. target já contém desired text;
2. chamar patch com old anterior;
3. provar convergência;
4. nenhuma mutation;
5. semantics explícitas.

## EXP-RTR-03 — independent partial progress

2 targets; 1 válido; 1 stale.

Esperado:

- target válido aplicado;
- 1 causal failure;
- 1 recovery target;
- nenhum abort artificial do target independente.

## EXP-RTR-04 — same-file dependency

N operações em um arquivo; op k falha.

Esperado:

- zero publish do arquivo;
- 1 causal failure;
- N-k dependent aborts;
- current-state evidence bounded.

## EXP-RTR-05 — global preflight verdadeiro

Usar >=2 targets e modo explicitamente global.

Medir separadamente de single-target preflight-elided.

## EXP-RTR-06 — schema projection

1. registrar descriptor fingerprint A;
2. mudar schema controladamente para B;
3. emitir listChanged;
4. observar `tools/list` remoto;
5. observar schema disponível na conversa;
6. classificar convergence.

## EXP-RTR-07 — plan vs direct apply

Mesma operação segura:

```text
A = plan → apply
B = direct apply
```

Comparar wall-clock e evidence.

## EXP-RTR-08 — patch+validate

```text
A = patch → validator
B = patch(postValidate)
```

Comparar calls, WSL resources e semantic feedback.

## EXP-RTR-09 — Git publication

```text
A = stage-plan → stage → commit-plan → commit → push-plan → push
B = git_publish_changes
```

Executar apenas em change-set de teste/real governado apropriado.

## EXP-RTR-10 — envelope overflow

Gerar operações acima de cap sem mutar e provar split plan.

## EXP-RTR-11 — host schema stale

Quando observado, registrar:

- server fingerprint;
- projected fields visíveis;
- reachedMcp=false quando schema block ocorre antes da call;
- ação necessária para convergir.

## EXP-RTR-12 — audit analyzer

Comparar incremental analyzer com reconstrução raw em janela pequena onde ambos são completos.

---

# 27. Definition of Done

A frente pode ser considerada madura quando:

- [ ] `ERR_PATCH_NOT_FOUND` raramente exige reread apenas para diagnóstico;
- [ ] already-converged é first-class;
- [ ] causal failure é separada de dependent abort;
- [ ] partial progress é semanticamente explícito;
- [ ] patch audit permite ranking causal por código;
- [ ] analytics não depende de tail truncado;
- [ ] metadata de limits/defaults deriva da mesma source que o runtime;
- [ ] server schema epoch/fingerprint aparece em health/status compacto;
- [ ] MCP listChanged foi testado end-to-end;
- [ ] fallback para host stale está documentado e automatizado quanto possível;
- [ ] `postValidate` está disponível na schema projetada ou possui fallback estável;
- [ ] plan tools são usadas apenas quando agregam informação;
- [ ] true global preflight é distinguido de single-target atomic failure;
- [ ] search/read→patch remove stats/read redundantes em workflows comuns;
- [ ] patch→validate pode ser one-call;
- [ ] validator polling é exceção;
- [ ] Git routine publication usa one-shot quando preconditions permitem;
- [ ] result truncation→follow-up é medido;
- [ ] host blocks são separados de server blocks;
- [ ] nenhuma safety boundary crítica foi relaxada;
- [ ] benchmark demonstra redução real de calls e wall-clock;
- [ ] WSL resource telemetry permanece saudável;
- [ ] focused tests/typecheck/lint verdes;
- [ ] docs index/master/ILCP coerentes;
- [ ] `main == origin/main` e worktree limpa após rollout.

---

# 28. Sequência de implementação recomendada

A execução deve seguir esta ordem, evitando abrir muitas frentes simultâneas:

```text
1. contracts/taxonomy
2. fail-rich ERR_PATCH_NOT_FOUND
3. already-converged
4. causal audit
5. metadata capability SSOT
6. schema epoch/fingerprint
7. listChanged experiment
8. postValidate projection
9. incremental round-trip analytics
10. inspect→patch compression
11. Git/validator happy-path guidance
12. envelope split/recovery
13. deterministic same-call retry
14. broader composites only after evidence
```

A razão desta ordem é simples: **primeiro reduzir falhas que desperdiçam calls; depois reduzir calls que já eram bem-sucedidas**.

---

# 29. Conclusão

O problema de round-trip no WORKSPACE MCP não é falta de poder bruto. O servidor já possui batches, locks, atomicidade por arquivo, bulk inspect, working sets, validators allowlisted, Git one-shot e uma extensa tool surface.

O gargalo arquitetural atual é a **convergência entre intenção, precondition, recovery evidence e schema efetivamente visto pelo host**.

A prioridade P0 não é criar um “super batch”. É fazer com que as tools existentes:

1. sejam anunciadas com a capacidade real;
2. escolham o preflight proporcional ao risco;
3. expliquem uma falha com o estado atual já observado;
4. reconheçam convergência idempotente;
5. preservem progresso independente;
6. distingam uma causa de vinte operações abortadas;
7. consigam, quando houver prova determinística, recuperar-se sem devolver o controle ao modelo;
8. forneçam analytics suficientes para provar quantos round-trips foram eliminados.

O estado-alvo é um MCP em que o caminho normal seja curto e o caminho excepcional seja informativo:

```text
happy path:
intent → one bounded call → result

recoverable path:
intent → one bounded call → rich failure/recovery → at most one justified follow-up

unsafe/ambiguous path:
intent → block → explicit evidence → human/model decision
```

Essa arquitetura é compatível com autonomia elevada **sem confundir autonomia com remoção de garantias**. Ela ataca exatamente o custo que o ILCP demonstrou ser dominante: cada devolução desnecessária ao host/modelo pode custar segundos ou dezenas de segundos, enquanto a correção local geralmente custa milissegundos.
