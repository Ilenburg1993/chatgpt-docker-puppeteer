# WORKSPACE MCP — ROUND-TRIP, HOT TOOLS, BATCH E ORQUESTRAÇÃO

## Auditoria profunda, programa de correções, programa de upgrades e governança permanente — 2026-08-26

> **Auditoria suplementar independente da superfície de tools:**
> `WORKSPACE_MCP_TOOL_SURFACE_AUDITORIA_SUPLEMENTAR_RACIONALIZACAO_DESTINO_131_TOOLS_2026-08-27.md`.
> Ela audita separadamente o destino, consolidação e eventual retirada das 131 tools do baseline e
> **não substitui nem reordena os gates deste roadmap de round-trip**. Implementação suplementar já
> iniciou: W1/W2/W3 e SUP-2/W4/W5/W6 + SUP-3/W7/W8 levaram o catálogo source-side a **89 tools /
> 131.652 B**; os dois plan-batch owners também foram aposentados após preview parity em `dryRun`.
> `mcp_latency_pulse` e `mcp_client_latency_evidence` foram explicitamente preservados porque
> continuam sendo instrumentos do próprio programa de latência/round-trip.
>
> > SUP-1/W3 também preservou o maintenance composite por compressão real de round-trips e evitou
> > remover `mcp_cloudflare_edge_policy_plan` porque plan/apply ainda não têm policy parity.
> > SUP-2/W4 consolidou validation state, quarantine reads e Copilot session reads, além de retirar
> > o score sintético de autonomia. `llmb_live_runs` permanece separado para preservar a leitura
> > SQLite barata sem acionar readiness mais caro. SUP-2/W5 consolidou meta e connection locais:
> > capabilities agora possui views summary/session/status; connection readiness possui views
> > readiness/profile/url-check/current-url/auth-profile. Issuer diagnostics continua separado
> > `fixed-external`; readiness foi corrigido para authority local. Full source: **101 tools /
> > 138.558 B**; `mcp-fast`/`mcp-full` verdes com **748/748 testes MCP**. SUP-2/W6 absorveu
> > persisted runs em `llmb_live_readiness(view=runs)` com prova causal de zero readiness
> > fingerprint reads. `llmb_live_test_plan` foi preservado como preview read/local porque o run é
> > write/open-world/model-provider. Full source: **100 tools / 138.225 B**; 750/750 testes MCP
> > verdes. SUP-3/W7 consolidou nove reads Cloudflare `fixed-external` em
> > `mcp_cloudflare_edge_snapshot(view=...)`, preservando dispatch opt-in e remote compact. O edge
> > apply foi corrigido para criar backup apenas imediatamente antes de mutação real confirmada.
> > Full source: **91 tools / 132.741 B**; latency **53 / 96.461 B**; 754/754 testes MCP verdes.
> > SUP-3/W8 consolidou os dois mutation entry points em
> > `mcp_cloudflare_edge_policy_apply(target=...)` e metrics/benchmark-plan em
> > `mcp_cloudflare_metrics_snapshot(view=metrics|transport-plan)`, mantendo backup create/list e
> > read snapshot separados por recovery/authority. Full source: **89 tools / 131.652 B**; latency
> > **52 / 95.952 B**; 755/755 testes MCP verdes. SUP-3 está materialmente concluída.
>
> **Status do documento:** CANÔNICO / VIVO / REFERÊNCIA OBRIGATÓRIA.
>
> **Revisão operacional atual:** 9.7 — **III-B4-0 SOURCE CERTIFIED / III-B4-1 SOURCE INVESTIGATION CONCLUÍDA / III-B4-2 V11 SOURCE CERTIFIED +
> EFFECTIVE EXECUTION-POLICY CONTENT-FREE / RAW→DERIVED V11 PARITY EXATA / WIRE DESCRIPTORS INALTERADOS /
> BROAD GATES VERDES SOB SOURCE BARRIER ESTÁVEL; B4-3 CONTINUA BLOQUEADA ATÉ EVIDÊNCIA LIVE V11**. A revisão 9.2 permanece como investigação de
> entrada; 44.11 registra a implementação e 44.12 registra a certificação broad final e a decisão de
> avançar para B4-1. O runtime live conectado continua separado até rollout/reload explícito. O
> checkpoint de tool-surface permanece W8 (**89 tools / 131.652 B**); B4-0 não alterou advertisement
> nem semantic contracts da tool surface.
>
> **Revisão anterior:** 9.1 — **REAUDITORIA PÓS-III-B3 CONCLUÍDA / ROADMAP III-B REORDENADO POR NOVA
> EVIDÊNCIA / III-B4-0 DERIVED-INDEX SOURCE-GENERATION INTEGRITY É O PRÓXIMO GATE P0 / NENHUMA NOVA
> TRANSFORMAÇÃO DE CÓDIGO NESTA REVISÃO**. Roadmaps I e II permanecem concluídos e publicados; III-A
> permanece encerrado; III-B1 Recovery Recipe, III-B2 Exact Bounded Self-Repair e III-B3 Patch
> Target Groups V3 estão encerrados code+runtime live. O checkpoint técnico completo foi publicado
> em `4aec813148b5cc8fd5586733b47cef808fe5245d` com `main == origin/main` e worktree limpa antes
> desta investigação documental. A nova auditoria encontrou um bug P0 de duplicação cross-identity
> no derived round-trip index; por isso B4 passa a começar por integridade da authority, não por
> mudança de wire. III-A permanece congelado no baseline live da revisão 7.8. III-B1 permanece
> promovido na Source Barrier v2 fingerprint
> `ecbda618705f443083545ac6cfb36962cc7766a9f1234558d662f6fe6586115f`. III-B2 permanece promovido sob
> `25170022708eac9c642c23d8ba8d2d288c86c8e1aa0ada679b3b1fe2bca9baa6`. III-B3-A foi validado em
> `4e90979522010e8853bf86a7b927b1d7521fb35f8b26fb7593a8a6a3d72d6c65` e promovido sob a
> runtime-scoped barrier `e98a2b3b5b3ec71a3cbe7c972414a189ac7fabf4709e2f44fab096478bbf5942`, com
> `29` artefatos, `mcp-full` **743/743** em validation e promotion barrier, restart `quic`
> concluído, smoke remoto `131/131`, schema parity `131/131`, descriptor live
> `fa9401b0cb804a8cc270d0096575814363f5c72565ebb190f6a053ea4dfcf968` e `runtimeSourceDrift=false`. A
> B3-B V3-only foi depois certificada sob validation barrier
> `8c1c1a532067d62d24cfa1bdb7ce0714aeecd85f6484b3413aa05ade9d889058` e promovida sob a
> runtime-scoped barrier `3133d8ca651518ecf5e387c5adb76ce9f609d72d74705fcd9934ee51a8273475`:
> `mcp-full` **740/740**, restart `quic`, smoke remoto e schema parity `131/131`,
> `runtimeSourceDrift=false`, payload live `162586 B`, `repo_apply_patch_batch=4636 B` e
> `repo_patch_batch_plan=2908 B`. Uma chamada live `targets[]` com duas operações dependentes
> same-file passou em dry-run mantendo o arquivo físico inalterado, enquanto a forma flat V2 foi
> rejeitada por ausência de `targets`. O snapshot administrativo do ChatGPT pode ainda oscilar/stale
> independentemente da origem; isso é estado externo e não reabre compatibilidade V2 no runtime.
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
> **Escopo desta revisão 9.1:** fechamento publicado de III-B3 seguido de **releitura integral das
> 5.404 linhas físicas, investigação profunda, rebaseline raw e replanejamento documental**. Não
> executar novas transformações de código, testes, config ou runtime nesta fase de reauditoria. O
> baseline publicado de entrada é `HEAD 4aec813148b5cc8fd5586733b47cef808fe5245d`,
> `main == origin/main`, worktree limpa antes da investigação. A única mutação autorizada é este MD,
> que deve ser validado, commitado e publicado ao fim da rodada. A próxima implementação futura
> somente pode começar depois dessa publicação e deve iniciar em **III-B4-0 — Derived-index logical
> source-generation / physical-identity correctness**, porque a nova evidência invalida o uso
> irrestrito do derived index como authority até reparo, rebuild e parity raw↔derived comprovados.

---

# Índice

1. [Contrato de governança deste documento](#1-contrato-de-governança-deste-documento)
2. [Decisão arquitetural: gerações I→II→III](#2-decisão-arquitetural-gerações-iiiiiii)
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
28. [Conclusão da geração Roadmap I–II](#28-conclusão)
29. [Reabertura formal: autonomia confiável como próximo eixo](#29-reabertura-formal-autonomia-confiável-como-próximo-eixo)
30. [Baseline empírico da revisão 7.0](#30-baseline-empírico-da-revisão-70)
31. [Taxonomia canônica de semântica de opções](#31-taxonomia-canônica-de-semântica-de-opções)
32. [Auditoria lógica profunda de repo_apply_patch_batch](#32-auditoria-lógica-profunda-de-repo_apply_patch_batch)
33. [Auditoria lógica de terminal_exec e terminal sessions](#33-auditoria-lógica-de-terminal_exec-e-terminal-sessions)
34. [Auditoria lógica de read, search e bulk inspect](#34-auditoria-lógica-de-read-search-e-bulk-inspect)
35. [File batch, Git, validação e outras fronteiras de autonomia](#35-file-batch-git-validação-e-outras-fronteiras-de-autonomia)
36. [Arquitetura-alvo: Tool Autonomy Quality 3.0](#36-arquitetura-alvo-tool-autonomy-quality-30)
37. [ROADMAP III-A — correctness de opções e observabilidade](#37-roadmap-iii-a--correctness-de-opções-e-observabilidade)
38. [Gate obrigatório III-A → III-B](#38-gate-obrigatório-iii-a--iii-b)
39. [ROADMAP III-B — expansão bounded de autonomia](#39-roadmap-iii-b--expansão-bounded-de-autonomia)
40. [Experimentos, métricas e promotion gates do Roadmap III](#40-experimentos-métricas-e-promotion-gates-do-roadmap-iii)
41. [Definition of Done do Roadmap III](#41-definition-of-done-do-roadmap-iii)
42. [Conclusão histórica da revisão 7.1](#42-conclusão-histórica-da-revisão-71)
43. [Reauditoria pós-III-B3 e ordem normativa da revisão 9.1](#43-reauditoria-pós-iii-b3-e-ordem-normativa-da-revisão-91)

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
- respeitem os gates sequenciais vigentes. Na revisão 9.1, III-A e III-B1–B3 já estão encerrados;
  **III-B4-0 é o próximo gate obrigatório** e bloqueia decisões que dependam de analytics de janela
  longa até que raw↔derived parity e logical-generation/rebind correctness sejam provadas.

## 1.5 Ordem normativa

```text
AUDITORIA / DOCUMENTO
        ↓
ROADMAP I — CORREÇÕES DE VERDADE/OBSERVABILIDADE          [CONCLUÍDO]
        ↓
ROADMAP II — UPGRADES EVIDENCE-GATED                      [CONCLUÍDO]
        ↓
ROADMAP III-A — OPTION CORRECTNESS + OBSERVABILIDADE      [CONCLUÍDO LIVE]
        ↓
III-B1 RECOVERY RECIPE                                    [CONCLUÍDO LIVE]
        ↓
III-B2 EXACT BOUNDED SELF-REPAIR                          [CONCLUÍDO LIVE]
        ↓
III-B3 PATCH TARGET GROUPS V3                             [CONCLUÍDO LIVE]
        ↓
III-B4-0 DERIVED-INDEX LOGICAL SOURCE-GENERATION INTEGRITY [PRÓXIMO / P0 / OBRIGATÓRIO]
        ↓
III-B4-1 HIGH-COVERAGE STATIC SURFACE / PROGRESSIVE-DISCOVERY READINESS
        ↓
III-B4-2 EFFECTIVE EXECUTION-POLICY TELEMETRY
        ↓
III-B4-3 SEMANTIC EXECUTION PROFILES — somente se a evidência justificar
        ↓
III-B4-4 VALIDATOR SOURCE-STATE BINDING / DUPLICATE-WORK AUTHORITY
        ↓
III-B5+ BOUNDED AUTONOMY UPGRADES                         [EVIDENCE-GATED]
        ↓
DoD III / PUBLICAÇÃO
```

A ordem permanece evidence-gated, mas o novo achado P0 tem precedência sobre a ordem antiga.
Roadmaps I e II, III-A e III-B1–B3 são histórico concluído e não devem ser reabertos sem regressão
comprovada. A próxima implementação **não** é criar profiles: é restaurar a autoridade do derived
index separando physical identity de logical source generation. Somente depois B4-1 pode avaliar um
surface reduzido; B4-2 mede a política efetiva antes de B4-3 decidir se profiles realmente
simplificam o wire; B4-4 fecha a autoridade de duplicate validator work antes de qualquer claim de
waste/savings nesse domínio.

---

# 2. Decisão arquitetural: gerações I→II→III

A divisão I→II abaixo registra a decisão arquitetural que tornou possível corrigir a medição antes
de otimizar. A revisão 7.0 **não invalida** essa decisão; ela acrescenta uma terceira geração depois
que I e II foram concluídos.

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

**Estado histórico:** Roadmaps I e II estão concluídos e publicados.

## 2.3 Roadmap III — Tool Autonomy Quality

A terceira geração não nasce porque I/II falharam. Ela nasce porque, depois de corrigir a verdade
das métricas e promover framing/long-poll, o próximo limitante observado é diferente: **poder
nominal da tool não garante autonomia confiável**.

Roadmap III é dividido em:

- `III-A`: option correctness, result-code telemetry, continuation semantics, combinatorial tests e
  schema evolution contract;
- `III-B`: recovery recipes, exact bounded self-repair, target-grouped patch, semantic execution
  profiles, batch defaults, Bulk Inspect V2 e outras expansões evidence-gated.

A autoridade histórica da geração III está nas seções 29–42; a **seção 43 é o overlay normativo
corrente** da revisão 9.1 e prevalece quando houver conflito com formulações antigas.

---

# 3. Síntese executiva

> **Nota de leitura da revisão 9.1:** as seções 3–28 preservam o diagnóstico, as métricas e o
> registro de decisões que fundamentaram Roadmaps I/II; 29–42 preservam a evolução histórica do
> Roadmap III. Quando uma frase histórica usar tempo presente, o **estado corrente e normativo** é a
> seção 43 em conjunto com os checkboxes atualizados da seção 39. Não reinterpretar dívida já
> fechada de I/II/III-A/III-B1–B3 como pendência atual.

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
- qualquer mutation de produção, teste ou configuração.

A única mutação de conteúdo da rodada é este MD. **Commit/push documental é parte obrigatória do
fechamento**, para que a revisão normativa não fique separada do checkpoint técnico já publicado.

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

## 16.4 Novos achados da reauditoria pós-III-B3 — revisões 9.0–9.1

| ID         | Classe             | Severidade | Achado / decisão                                                                                                                                                                  |
| ---------- | ------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RT-III-001 | BUG DE AUTHORITY   | P0         | o derived round-trip index mantém rows de uma `source_identity` antiga e reingere o mesmo prefixo após mudança `dev:ino`, duplicando história                                     |
| RT-III-002 | TEST GAP           | P0         | o teste de rotation exige preservar old-identity history, mas não cobre rebind do mesmo conteúdo/prefixo sob device identity diferente                                            |
| RT-III-003 | GATE DE EVIDÊNCIA  | P0         | janelas longas e surface coverage não podem ser promotion authority enquanto raw↔derived parity não for revalidada após identity change                                           |
| RT-III-004 | DOC/GOVERNANCE BUG | P0         | topo normativo ainda dizia III-A em execução/III-B bloqueado apesar de III-B1–B3 já estarem live                                                                                  |
| RT-III-005 | DESIGN FINDING     | P1         | os três profiles B4 originais não cobrem o espaço semântico atual; o modo dominante observado é `per-target-fast + fail-fast`, não `independent-progress` nem `strict-sequential` |
| RT-III-006 | OBSERVABILITY GAP  | P1         | `executionMode` persiste apply/failure mode, mas não a classe de effective concurrency necessária para reconstruir a política usada                                               |
| RT-III-007 | OPPORTUNITY        | P1         | reduced static surface de alta cobertura é viável; snapshot 9.0 usou 76 tools/114009 B, mas a revisão 9.1 mede candidato mais enxuto de 75 tools/111100 B                         |
| RT-III-008 | PROTOCOL WATCH     | P1         | roadmap MCP oficial de agosto/2026 prioriza progressive discovery; usar como direção, não inventar protocolo dinâmico proprietário antes de standard/SEP suficiente               |
| RT-III-009 | VALIDATION GAP     | P1         | `duplicateValidationCount` não pode ser autoritativo sem source-state identity/fingerprint nos manifests de jobs                                                                  |
| RT-III-010 | PRIORITY FINDING   | P2         | Bulk Inspect V2 deve promover operações por demanda; em 24h `tree` teve 24 starts, outline/symbol 4, usages 2 e imports/diff 0                                                    |
| RT-III-011 | DESIGN BUG         | P0         | `source_identity` funde identity física `dev:ino` com geração lógica; isso explica rebind replay e torna truncation/copytruncate semanticamente perigosa                          |
| RT-III-012 | SURFACE FINDING    | P1         | candidate 75-tool cobre 98,26% raw/24h e 98,44% raw/7d com ~31,7% menos envelope; frontier deve ser recalculada por workload e não hardcoded eternamente                          |
| RT-III-013 | GOVERNANCE GAP     | P1         | validator manifests já medem wall time/resource, mas o owner `validation/jobs/runtime.js` não captura source-state identity; duplicate work continua não demonstrável             |

### Evidência causal de RT-III-001

No `data/copilot.sqlite`, a tabela `copilot_mcp_round_trip_events` contém duas identities
concorrentes:

- `2096:178412`: `22579` rows / `10975` starts, intervalo `2026-08-14 17:16:16Z` →
  `2026-08-19 01:57:58Z`;
- `2128:178412`: `56693` rows / `26253` starts no snapshot read-only mais recente;
- `22578` grupos têm a mesma combinação `source_offset,event,tool,ts_ms` entre identities, isto é,
  `22578` rows excedentes por replay cross-identity;
- total derived: `79272` rows / `37228` starts;
- raw JSONL direto mediu `26256` starts na janela móvel de 14 dias às `2026-08-27T23:10:57Z`,
  enquanto o derived global permanece materialmente inflado pelo prefixo duplicado;
- `fileIdentity` é `${dev}:${ino}`. O incidente real preservou `ino=178412` e mudou apenas
  `dev=2096→2128`, compatível com rebind/mount da mesma fonte;
- o branch `expectedIdentity !== fileIdentity` zera `offset` e reingere desde o início, mas preserva
  rows da identity anterior. O teste existente modela rotação lógica com eventos diferentes e exige
  preservar essa história; falta distinguir **rotação real** de **rebind/replay do mesmo prefixo**;
- o branch `resetRequired` usa apenas `requestedOffset > fileBytes` e, sob a mesma physical
  identity, apaga rows dessa `source_identity`. O writer atual não faz copytruncate/rotation, logo
  isso é risco latente externo, não incidente observado; ainda assim prova que `dev:ino` não pode
  continuar sendo simultaneamente physical identity e logical history generation.

**Consequência epistemológica:** os baselines 24h e 7d usados na revisão 9.0 permanecem úteis porque
a identity antiga termina em 19/08 e está fora desses cutoffs atuais. A visão 14d está contaminada e
é explicitamente inválida para promotion decisions até reparo + rebuild + parity raw↔derived.

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

## 2026-08-27 — Revisão 7.0 — reabertura para Tool Autonomy Quality / Roadmap III

- releitura integral das 2.655 linhas / 106.026 bytes da revisão 6.1;
- worktree inicial confirmada limpa em `main`, `HEAD 90191dedb`, `main == origin/main`;
- nenhuma transformação de código/config/teste realizada nesta revisão;
- nova auditoria aprofundada das opções e máquinas lógicas de `repo_apply_patch_batch`,
  `repo_apply_patch`, `terminal_exec`, terminal sessions, `repo_read_file`, `repo_search_text`,
  `repo_bulk_inspect`, `repo_apply_file_batch` e Git publication;
- identificado eixo novo: **tool autonomy quality**, distinguindo poder bruto de autonomia
  confiável;
- identificado que option errors não possuem telemetry de código/normalização suficiente no derived
  round-trip index;
- identificado conjunto de opções aceitas e silenciosamente ignoradas em terminal surfaces;
- identificada semântica implícita `confirmBatch=true` ⇒ apply quando `dryRun` é omitido;
- identificado que `fail-fast + concurrency>1` significa stop-scheduling, não strict sequential
  stop;
- identificado que `global-preflight` não é transação multi-target all-or-none;
- identificado que same-file patch hash mode é inferido implicitamente pela repetição/distinção de
  hashes;
- identificado que `continuationRequired` conflui `nextCursor/hasMore` com necessidade real de nova
  call;
- identificado que a superfície de testes de options é esparsa para várias interações críticas;
- propostos Option Contract SSOT, Option Outcome telemetry, explicit normalization, Patch Target
  Groups V3, Batch Defaults, machine-readable Recovery Recipe, exact bounded self-repair, Bulk
  Inspect V2, Unified Mutation Batch, safe hash-bound selectors, Git resume e MRTR experimental;
- criado Roadmap III em duas partes sequenciais: III-A correctness/observability e III-B autonomy
  expansion, com gate obrigatório entre ambas.

## 2026-08-27 — Revisão 7.1 — início do Roadmap III / III-A0 source-green

- releitura integral das 4.247 linhas do documento 7.0 antes de qualquer transformação;
- III-A0 escolhido como primeiro alvo por ser prerequisite mensurável de III-A1/A2;
- evidência pré-transformação no audit bruto: entre 1.264 `tool_call_completed` recentes, zero
  carregavam `code`, embora sete tivessem `isError=true`;
- evidência SQLite 24h: 2.015 `tool_call_completed`, oito `is_error=1`, zero rows com `code`;
- confirmado que `isError` sozinho é insuficiente: `terminal_exec` pode retornar
  `okResult({success:false, code:'ERR_TERMINAL_EXEC_SHAPE'})`;
- criado owner interno `registry/result-outcome.js`, content-free e fail-closed;
- completion audit passou a projetar `resultCode`, `resultState` e `resultClass` sem alterar o wire;
- analytics elevado a v5 com `result_code/result_state/result_class`, migration idempotente e novo
  cursor de replay;
- summary v5 passou a separar completions observadas de legado `unobserved`, com métricas por
  tool/cohort e denominadores que não diluem a geração nova;
- classificação deliberadamente não usa regex semântica ampla: códigos desconhecidos permanecem
  `domain-or-unknown`;
- requested/effective option policy não foi improvisada nesta onda; será derivada do Option Contract
  SSOT para evitar taxonomias duplicadas;
- validação source/unit/static desta etapa: 30/30 testes focados, ESLint verde, Prettier aplicado,
  `git diff --check` verde e strict typecheck focado verde;
- próximo gate: promover runtime, provar outcome telemetry live e só então fechar III-A0 ou avançar
  para III-A1.

## 2026-08-27 — Revisão 7.2 — encerramento live do III-A0

- source candidate inicial certificada por barrier
  `ef1106f3dd0f4343cff294b42e573098e9045f56c99699e061274efa8f18f4ce`, com 57/57 testes causais sob a
  mesma identidade;
- a primeira promoção foi acidentalmente agendada duas vezes durante a transição do conector; ambos
  os restarts foram controlados e bound ao mesmo fingerprint `ef1106f3...`, sem mudança de source
  identity. O segundo/latest request `mcp-reload-e841bab6-0c4c-457c-b5a1-48dfffc88e39` terminou com
  exit 0;
- primeira geração live relevante: epoch `53bc377d-ecea-4939-8812-2d07fc76a43d`, controlled
  promotion, source drift `false`; connector smoke pós-reload 131/131, OAuth, health e modern
  subscription verdes;
- chamada controlada e não mutante de `terminal_exec` com single+batch produziu
  `ERR_TERMINAL_EXEC_SHAPE`; o JSONL real registrou `isError=false`, `resultState=domain-failure`,
  `resultClass=option-config`, `resultCode=ERR_TERMINAL_EXEC_SHAPE`, epoch e source fingerprint
  corretos;
- primeiro live analytics confirmou schema/normalizer v5, mas revelou bug adicional: `summary.js`
  produzia `resultOutcomes` e a tool pública `mcp_round_trip_analytics` descartava essa seção ao
  projetar manualmente o report;
- wiring público corrigido em `tools/round-trip-analytics.js` e protegido por novo teste end-to-end
  no nível da tool canônica, para impedir owner interno verde com adapter público incompleto;
- validação final da source corrigida: 58/58 testes focados; TS7 strict, lint, docs-contract,
  architecture-contract, `git diff --check` e `mcp-full` verdes; architecture governance permaneceu
  em 70 owners, zero SCC/mismatches e mutable-state baseline 26 files / 53 declarations;
- source final recertificada por barrier de 10 arquivos
  `6d81cce7670a392e880bda4f0140b6c551ce3319247efbac9f5835132a1c385e`; 58/58 testes passaram
  novamente sob verificação before/after do mesmo fingerprint;
- promoção final `mcp-reload-73afaa68-a779-419e-857c-09168ef96233` terminou exit 0; runtime epoch
  `f6011af2-20a3-46e2-adf8-48b330b65868`, sourceBinding `controlled-promotion`, drift `false`,
  runtime health `ok` e connector smoke 131/131;
- prova live final pela própria `mcp_round_trip_analytics`: cohort `source:ef1106f3...` = 37/37
  outcomes observados e cohort final `source:6d81cce7...` = 5/5 observados, ambos com coverage 100%;
  o failure controlado aparece como `option-config`/`ERR_TERMINAL_EXEC_SHAPE` e completions antigas
  pré-v5 permanecem explicitamente `unobserved` fora do denominador de `optionErrorRate`;
- a taxa do micro-cohort final foi 20% somente porque 1 das 5 completions foi deliberadamente um
  teste de option failure; isso não é baseline de comportamento normal e não deve ser extrapolado;
- boundary de ownership refinada: III-A0 encerra outcome telemetry; requested/effective option
  policy, normalization/ignore/coercion telemetry e seus denominadores passam a ser produzidos
  exclusivamente pelo SSOT de III-A1;
- próximo alvo obrigatório: III-A1 Option Contract SSOT, com auditoria de ownership, schemas,
  descriptions, runtime normalization e descriptor pressure antes de qualquer enforcement de III-A2.

## 2026-08-27 — Revisão 7.3 — III-A1 source-green; promoção abrangente pendente

- ao retomar a frente foi detectada uma inconsistência de source identity: o barrier antigo
  `ef1106f3...` foi re-promovido enquanto o worktree já continha o adapter público final de III-A0 e
  source parcial de III-A1; o runtime continuou funcional, mas o manifest não descrevia toda a
  source causal carregada;
- decisão corretiva: nenhum barrier A0 antigo será reutilizado. III-A1 será concluído/validado e a
  próxima promoção usará **uma única barrier nova e abrangente A0+A1**, eliminando source binding
  parcial;
- III-A1 ganhou SSOT `tools/catalog/option-contracts.js` v1.1.0, com 10 tools / 101 options: 57
  `semantic`, 18 `tuning`, 10 `result`, 14 `safety`, 2 `recovery`;
- tools cobertas: `terminal_exec`, `terminal_session_control`, `terminal_session_read`,
  `repo_read_file`, `repo_read_file_chunks`, `repo_search_text`, `repo_bulk_inspect`,
  `repo_apply_patch`, `repo_apply_patch_batch` e `repo_apply_file_batch`;
- contratos descrevem mode activation, defaults, inactive policy (`ignore|reject`), requirements,
  alias precedence, coercion e inheritance; patch/file-batch dry-run/apply e terminal/read/search
  single/batch são explicitamente modelados;
- parity do catálogo agora exige correspondência exata entre options Zod e SSOT, description não
  vazia para toda option coberta, modes válidos e referências internas válidas; Workflow Policy é
  comparada declarativamente para `terminal_exec`, `repo_apply_patch_batch` e
  `repo_apply_file_batch`, sem duplicar happy-path authority;
- descriptions ausentes encontradas em 14 campos terminal/action-scoped foram corrigidas de forma
  curta e mode-aware; isso transforma documentação de opção em gate executável, não texto informal;
- projector requested/effective é content-free: emite somente versão, coverage, mode e counts; nunca
  option names, command, paths, env values ou outros argumentos;
- contadores foram tornados disjuntos: `ignored`, `rejected`, `coerced` e `conflict` não são
  inferidos como sinônimos; `effectiveRequested` usa requested minus ignored/rejected, sem o erro
  conceitual da primeira versão parcial;
- registry passa a projetar option policy no `tool_call_started`; normalizer/index sobe para v6 e
  ganha colunas bounded de
  contract/mode/requested/effective/defaulted/normalized/ignored/coerced/rejected/conflict;
- analytics v6 expõe `optionPolicies` com denominadores explícitos por call:
  normalized/ignored/coercion/rejection/conflict call rates e `ignoredRequestedOptionRate`,
  incluindo breakdown por tool, mode, contract version e runtime cohort;
- testes focados atuais: 55/55 em Option Contract + analytics v6 + public adapter + registry; TS7
  strict verde; lint focado verde; architecture-contract verde (`owners=70`, mutable state `26/53`,
  zero cycles/mismatch); public API cost verde sem rebaseline (`78` aliases, `0` violations);
- a própria implementação revelou novamente uma característica relevante de
  `repo_apply_patch_batch`: um patch literalmente no-op em um same-target group abortou atomicamente
  o grupo daquele arquivo sem impedir o target independente. Essa evidência será incorporada a
  III-A4/A2; não houve estado parcial dentro do arquivo abortado;
- descriptor baseline antes das descriptions A1: `tools/list=161381 B`, headroom `248219 B`,
  `inputSchemaBytes=76152`, `inputSchemaDescriptionBytes=33383`; after somente será fechado na
  geração promovida;
- próximo gate: format/diff final, mcp-full uma vez, source barrier abrangente A0+A1, focused tests
  under barrier, promoção única, option-policy calls controladas, analytics v6 + JSONL + payload
  audit + smoke/health.

## 2026-08-27 — Revisão 7.4 — III-A1 encerrado live; productivity/retry governance aberto

- source A0+A1 final certificada numa única barrier de 15 arquivos:
  `src/copilot/.ai/source-barriers/roadmap-iii-a0-a1-option-contract-v6.json`, fingerprint
  `3f279c4a299cda65a736344d2fffad816fffec7cc4cc3d5de39231afd6f22077`; 65/65 testes focados
  executaram sob verificação before/after da mesma fingerprint;
- gate amplo foi executado exatamente uma vez antes da promoção: `mcp-full` = 116398 ms, com
  typecheck 1283 ms, lint 28858 ms, docs 314 ms, architecture 20043 ms e unit MCP 65899 ms; 113/113
  test files e 667/667 tests verdes. Este custo vira baseline de promotion-gate, não rotina por
  onda;
- reload controlado único `mcp-reload-3cee14ef-da85-4bdc-8d83-90ed2c503055` terminou exit 0, runtime
  epoch `9473214a-2227-4608-826f-79d89e4305ed`, sourceBinding `controlled-promotion`, fingerprint
  `3f279c4a...`, source drift `false`; connector smoke remoto 131/131, OAuth e modern 2026-07-28
  subscription verdes;
- houve exatamente uma falha transitória de `mcp_reload_status` durante o restart
  (`UNKNOWN/ExceptionGroup`) e uma única repetição posterior bem-sucedida. Classificação:
  control-plane transient/restart-window; retry tax desta promoção = 1 call. Polling mecânico não
  foi usado;
- quatro probes live sem side effects fecharam a semântica A1: `terminal_exec` single + batch-only
  knob → ignore; `repo_read_file` single+batch → reject com `ERR_BATCH_CONFLICTING_MODE`;
  `repo_search_text` usando apenas `query` → normalize; `repo_apply_patch_batch` dry-run com
  `resultMode=compact` + nested `includeDiffPreview=true` → coerce para detailed, zero bytes
  escritos;
- analytics v6 sincronizou o tail em uma única execução incremental: 1 chunk, 9283 bytes, 14 events,
  9 indexed events, `complete=true`, `lagBytes=0`; cohort `source:3f279c4a...` apresentou
  option-policy telemetry observada com normalize/ignore/coerce/reject, e o reject apareceu também
  em result outcome;
- payload before/after: `tools/list` 161381 B → 162303 B, delta +922 B (+0,57%); todo o delta veio
  de descriptions (`33383` → `34305` B), enquanto `inputSchemaWithoutDescriptionsBytes` permaneceu
  42769 B. Headroom final = 247297 B;
- nova evidência de produtividade 1h: sete transições `mcp_reload_status→mcp_reload_status`, nove
  validator polls, 16 causal patch failures e cinco heavy-result→read follow-ups. Estes números são
  pressure targets, não prova automática de evitabilidade;
- o monitor background de round-trip apresentou uma execução de 14409 ms com `complete=false` e
  ~1,93 MiB de lag, enquanto a sincronização incremental subsequente consumiu apenas 9,3 KiB e
  fechou lag zero. A discrepância entra na investigação de custo de observabilidade/validação;
- novo princípio operacional: broad validation não é prova de rigor quando repetida mecanicamente.
  Cada onda deverá usar o menor gate causal capaz de detectar a classe de regressão introduzida;
  suites amplas ficam reservadas a source-barrier/promotion/publication gates.

## 2026-08-27 — Revisão 9.0 — reauditoria pós-III-B3 / reordenação evidence-gated

- III-B3 encerrado, publicado no commit `4aec813148b5cc8fd5586733b47cef808fe5245d` e confirmado com
  `main == origin/main` / worktree limpa antes da nova investigação;
- documento relido integralmente (`5316+` linhas) antes da reauditoria;
- nenhum código/config/teste/runtime transformado nesta revisão documental;
- descoberto RT-III-001: derived index com replay cross-identity (`2096:178412` e `2128:178412`),
  `22560` duplicate-offset groups; 14d surface/round-trip coverage deixa de ser authority até
  rebuild;
- identificado test gap de rotação versus same-content device rebind;
- rebaseline íntegro: 24h `1909` starts e 7d `12804` starts no SQLite atual, sem participação da
  identity antiga;
- candidato `latency-v2` somente in-memory: 76 tools, `114009 B`, `-48577 B / -29,88%` vs full;
  coverage atual `1878/1909 = 98,38%` (24h) e `12647/12804 = 98,77%` (7d);
- official MCP roadmap de 2026-08-22 incorporado: progressive discovery é direção upstream, ainda
  não contrato final a ser imitado com wire proprietário;
- profiles B4 originais reclassificados como provisórios: 133/136 patch-batch completions
  observáveis em 24h eram `patch-apply:per-target-fast:fail-fast`; effective concurrency ainda não é
  persistida na classe;
- validation productivity reavaliada: nos 120 jobs recentes, 8 broad suites consumiram ~`1012892 ms`
  e 68 focused runs ~`372094 ms`; duplicate classification continua corretamente `null` sem
  source-state binding;
- B6 reordenado por demanda natural: tree primeiro; outline/symbol/usages depois; imports/diff sem
  promoção sem nova evidência;
- próximo gate passa a ser III-B4-0, não semantic-profile mutation.

## 2026-08-27 — Revisão 9.1 — releitura integral final / plano executável pós-B3

- releitura integral repetida sobre a versão física de `5404` linhas antes da atualização final;
- RT-III-001 reproduzido novamente em SQLite read-only: `79272` rows, `37228` starts e `22578`
  duplicate-prefix groups/excess rows entre duas physical identities;
- identificado RT-III-011: physical `dev:ino` e logical audit generation precisam ser conceitos
  distintos; o mesmo erro de modelagem também deixa truncation/copytruncate semanticamente perigosa,
  embora o writer atual seja append-only e esse segundo cenário não tenha ocorrido live;
- B4 reescrito em B4-0→B4-4 com owners, invariants, test matrix e promotion gates;
- candidate static surface recalculada diretamente do raw JSONL: `75 tools / 111100 B`, cobertura
  `1865/1898 = 98,26%` em 24h e `12600/12800 = 98,44%` em 7d, mantendo full fallback;
- análise de frontier mostrou que coverage deve ser tratada como Pareto custo×uso e recalculada por
  workload; o snapshot 76-tool da revisão 9.0 permanece histórico, não policy hardcoded;
- B4 profiles continuam condicionais: primeiro persistir effective concurrency/policy class; os
  `133/136` modes `per-target-fast+fail-fast` permanecem evidência de que a taxonomia antiga era
  incompleta;
- B4-4 recebeu owner concreto para source-state binding de validators; até isso existir,
  `duplicateValidationCount=null` permanece a única resposta epistemicamente correta;
- B6 reescrito como promotion-per-op, com `tree` primeiro por demanda e zero promoção automática de
  imports/diff sem evidence;
- B12 reclassificado como lane transversal de descriptor economics;
- EXP-III-10→13 e DoD III foram ampliados para source-generation integrity, static-surface A/B,
  execution-policy census e validator duplicate-work authority;
- seção 43 materializada como overlay normativo corrente; seção 42 permanece histórica;
- nenhuma transformação de código/config/teste/runtime foi realizada; a única mutação é este MD, que
  deve ser publicado em commit documental após docs/diff gates.

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
- MCP Blog — The New MCP Roadmap (2026-08-22):
  `https://blog.modelcontextprotocol.io/posts/mcp-roadmap/` — referência upstream para improved
  primitives/progressive discovery; é roadmap, não spec final.
- TypeScript SDK — support 2026-07-28 / Multi-Round-Trip Requests:
  `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md`
- TypeScript SDK — `input_required` / `requestState`:
  `https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/input-required.md`
- MCP 2026 schema — `InputRequiredResult`, `inputResponses` e `requestState`:
  `https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts`
- documentação Tier-1 SDK/spec relacionada a tracing e MRTR deve ser revalidada novamente antes de
  qualquer implementação protocolar, porque esta revisão apenas prepara o roadmap.

## 27.2 Código local principal

- `src/copilot/mcp/diagnostics/latency/round-trip/normalizer.js`
- `src/copilot/mcp/diagnostics/latency/round-trip/summary.js`
- `src/copilot/mcp/diagnostics/latency/round-trip/analytics.js`
- `src/copilot/mcp/diagnostics/latency/dashboard/runtime.js`
- `src/copilot/mcp/observability/audit/service.js`
- `src/copilot/mcp/registry/runtime.js`
- `src/copilot/mcp/registry/surface-policy.js`
- `src/copilot/mcp/diagnostics/tool-payload/runtime.js`
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
- `src/copilot/mcp/validation/jobs/runtime.js`
- `src/copilot/mcp/validation/jobs/operations.js`
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

---

# 29. Reabertura formal: autonomia confiável como próximo eixo

Roadmaps I e II resolveram primeiro a verdade da medição e depois promoveram dois upgrades com A/B
positivo. A revisão 7.0 abre um terceiro problema, diferente: o MCP já possui **muito poder**, mas a
liberdade efetiva do caller é menor que a superfície nominal quando uma tool exige memorizar dezenas
de knobs, possui defaults condicionais, aceita campos sem efeito ou devolve recovery apenas em
texto.

A nova grandeza arquitetural é:

```text
AUTONOMIA ÚTIL
≈
(amplitude de ações válidas × previsibilidade semântica × capacidade de recuperação)
/
(custo de escolha + custo de correção + prompt/descriptor pressure)
```

Portanto, **mais opções não significam automaticamente mais autonomia**. Uma opção é boa quando:

1. representa decisão semântica que o caller realmente precisa tomar;
2. tem ativação, precedência e efeito claros;
3. não é silenciosamente ignorada;
4. não duplica um tuning que o runtime pode resolver melhor;
5. produz resultado que deixa explícito o estado efetivo;
6. quando falha, deixa uma próxima ação mecanicamente utilizável;
7. mantém safety/correctness invariants mesmo sob retry, concurrency e partial progress.

## 29.1 Poder bruto atual já é alto

A auditoria atual do MCP reportou:

- `131` tools;
- `30` bounded-write tools;
- `10` open-world tools;
- OAuth em perfil max-autonomy com scopes iniciais de read/write/validate/admin;
- `mcp_autonomy_power_score = 91/100`, grade `A`;
- blocker remanescente no score: prompt friction associado sobretudo às tools open-world.

Isso muda a estratégia. O próximo ganho não deve vir de “liberar qualquer coisa”. Deve vir de:

> **dar ao modelo mais liberdade dentro de gramáticas bounded que funcionem em uma call, com menos
> combinações inválidas e mais recuperação determinística.**

## 29.2 Padrão arquitetural preferido: micro-orquestradores de domínio

O caminho preferido não é uma tool genérica capaz de chamar qualquer outra tool. Esse desenho
criaria uma authority boundary difícil de auditar e poderia contornar risk annotations/approvals.

O padrão preferido é:

```text
read-only domain      → repo_bulk_inspect V2
exact mutation domain → patch target groups / file mutation batch
process domain        → terminal batch/session
validation domain     → validator batch/postValidate
publication domain    → git_publish_changes
```

Cada micro-orquestrador deve:

- possuir gramática fechada;
- manter a authority do domínio;
- ter hard caps;
- carregar cancellation;
- projetar execution accounting;
- não criar hidden correctness state;
- manter partial-progress semantics explícita.

---

# 30. Baseline empírico da revisão 7.0

## 30.1 Estado inicial da rodada documental

No início desta revisão:

```text
branch = main
HEAD = 90191dedb
main == origin/main
worktree = clean
```

A revisão é deliberadamente **document-only**.

## 30.2 Hot tools — starts nas 24 h observadas

Snapshot da nova auditoria:

| Tool                       | starts 24 h |
| -------------------------- | ----------: |
| `terminal_exec`            |         491 |
| `repo_read_file`           |         380 |
| `repo_search_text`         |         263 |
| `repo_apply_patch_batch`   |         188 |
| `terminal_session_read`    |         166 |
| `repo_apply_patch`         |         114 |
| `repo_bulk_inspect`        |          80 |
| `repo_status`              |          45 |
| `terminal_session_control` |          43 |
| `repo_file_stats`          |          26 |
| `repo_create_file`         |          20 |
| `repo_tree`                |          13 |
| `repo_patch_batch_plan`    |          12 |
| `repo_file_outline`        |           7 |
| `repo_apply_file_batch`    |           7 |

Isso reafirma que qualquer melhoria de option correctness em terminal/read/search/patch possui
multiplicador muito superior ao de tools raras.

## 30.3 Read-only adjacency pressure

Em 24 h, limitando a adjacências temporais ≤60 s, apareceram:

| Adjacência temporal | contagem |
| ------------------- | -------: |
| search → read       |      101 |
| read → read         |       81 |
| read → search       |       64 |
| search → search     |       55 |
| bulk → read         |       23 |
| read → bulk         |       22 |
| bulk → bulk         |       15 |
| bulk → search       |       15 |
| search → bulk       |        9 |

Esses dados **não são lineage-bound** e não provam round trip evitável. Eles servem para priorizar
experimentos. A hipótese de Bulk Inspect V2 é plausível justamente porque várias sequências
read-only mecanicamente compatíveis permanecem frequentes.

## 30.4 Uso semanal de auxiliares read-only

Na janela de 7 dias:

- `repo_read_file`: 1.438 starts;
- `repo_search_text`: 1.243;
- `repo_bulk_inspect`: 1.207;
- `repo_tree`: 72;
- `repo_file_outline`: 63;
- `repo_file_stats`: 52;
- `repo_symbol_search`: 17;
- `repo_find_symbol_usages`: 5;
- `repo_find_imports`: 4.

`repo_bulk_inspect` é muito usado, mas hoje sua gramática heterogênea cobre apenas
`read|search|stat`. A extensão para outras operações read-only deve ser investigada antes de criar
novas tools.

## 30.5 Descriptor pressure

`mcp_tool_payload_audit` atual:

```text
tools = 131
tools/list envelope ≈ 161381 B
headroom ≈ 248219 B
inputSchemaBytes ≈ 76152 B
inputSchemaDescriptionBytes ≈ 33383 B
```

`inputSchema` é a maior família do descriptor. `repo_apply_patch_batch` sozinho possui ~4,2 KiB de
input schema, dos quais ~2,4 KiB são descriptions. A superfície `latency` ainda cobre menos de 98%
do workload observado, logo remover tools continua sem promoção; **simplificar semanticamente os
schemas existentes** é mais promissor.

## 30.6 Cohort pós-Roadmap II ainda pequeno

Após o checkpoint publicado do Roadmap II, a amostra desta investigação contém apenas uma call de
patch batch e poucas dezenas de reads/searches/terminal calls. Ela não permite taxa de falha
estável. No entanto, há um sinal semântico importante:

```text
repo_search_text batch: 7 calls / 32 logical operations
continuation flag: 6/7 calls
```

O flag atual é acionado por `nextCursor|hasMore|payloadTruncated`. Em search, `nextCursor`
normalmente significa “mais resultados existem”, não “uma nova call é obrigatória”. Isso motiva
separar **continuation availability** de **transport-required continuation**.

## 30.7 Histórico de patch failures como catálogo, não taxa atual

O histórico de 7 dias mistura gerações anteriores, mas é útil para enumerar casos:

- `ERR_PATCH_NOT_FOUND` domina partial/preflight failures;
- `ERR_PATCH_EXPECTED_OCCURRENCES` é recorrente;
- `ERR_PATCH_NOOP` aparece materialmente;
- `ERR_PATCH_AMBIGUOUS_MATCH` e occurrence-index out-of-range aparecem;
- `EEXPECTEDHASH`, `ENOENT` e `EISDIR` aparecem em menor volume.

A telemetria pós-Roadmap I já classifica causal failure e recovery semantics, porém o **código do
resultado de uma tool genérica não é persistido no completion audit**. Assim, não conseguimos hoje
medir adequadamente option mistakes como `ERR_BATCH_CONFLICTING_MODE` ou
`ERR_BATCH_OPTIONS_WITHOUT_BATCH`.

---

# 31. Taxonomia canônica de semântica de opções

A próxima geração deve formalizar cada opção em uma destas classes.

## 31.1 Classes

### A. Selector semântico

Define **o que** fazer.

Exemplos:

- patch `occurrence_index`;
- `replace_all`;
- terminal `action`;
- file batch operation `type`.

### B. Execution policy

Define atomicidade/partial-progress/ordering observável.

Exemplos:

- `applyMode`;
- `failureMode`;
- strict sequential vs independent progress.

### C. Mechanical tuning

Define performance, não intenção.

Exemplos:

- concurrency;
- result budget bytes;
- max output bytes;
- diff line budget.

**Default desejado:** tuning deve ser runtime-owned sempre que possível. O caller deve escolher
semântica, não microgerenciar scheduler.

### D. Result projection

Controla o que volta ao modelo.

Exemplos:

- compact/detailed;
- diff preview;
- preflight details.

### E. Safety/precondition

Nunca deve ser autocorrigida silenciosamente.

Exemplos:

- expected hash;
- confirm flags;
- path policy;
- source barrier;
- upstream/head preconditions.

### F. Recovery policy

Autoriza comportamento bounded após failure.

Exemplos futuros:

- accept proven convergence;
- retry only exact proven recovery anchor;
- never retry automatically.

## 31.2 Estados de uma option

Toda opção visível deve produzir exatamente um destes estados:

```text
applied
inherited
normalized
coerced-bounded
ignored-with-explicit-reason
rejected
```

**Estado proibido:** accepted-but-silently-ignored.

## 31.3 Option Outcome Contract candidato

Sem transformar todo success result em um envelope pesado, hot tools podem projetar quando
relevante:

```text
optionOutcome:
  requestedPolicy
  effectivePolicy
  inheritedOptions[]
  normalizedOptions[]
  ignoredOptions[{name, reason}]
  warnings[]
```

Em failure/configuration error:

```text
recovery:
  class
  safeWithoutInspection
  retryScope
  correctedInvocation?   # somente se determinístico
  suggestedInvocation?   # advisory, exige decisão
```

## 31.4 Option Contract SSOT

Criar futuramente uma autoridade declarativa que descreva para cada hot tool:

- activation predicate;
- default;
- conflicts;
- precedence;
- inheritance;
- safety class;
- whether runtime may normalize;
- whether it may be ignored;
- output effect;
- critical pair/triple test cases.

Dessa SSOT devem ser derivados ou parity-checked:

- schema descriptions;
- runtime normalization;
- test matrix;
- `mcp_session_profile` guidance;
- option telemetry labels.

Isso replica o sucesso da Workflow Policy SSOT do Roadmap I, agora no nível das opções.

---

# 32. Auditoria lógica profunda de repo_apply_patch_batch

`repo_apply_patch_batch` é o melhor laboratório para a próxima arquitetura porque combina exact
mutation, grouping, concurrency, preflight, result shaping e post-validation.

## 32.1 Máquina de modo apply/preview

O comportamento atual de `dryRun` e `confirmBatch` é:

| dryRun  | confirmBatch  | resultado efetivo                       |
| ------- | ------------- | --------------------------------------- |
| `true`  | qualquer      | preview                                 |
| `false` | `true`        | apply                                   |
| `false` | omitido/false | erro `ERR_PATCH_BATCH_CONFIRM_REQUIRED` |
| omitido | `true`        | **apply**                               |
| omitido | omitido/false | preview                                 |

O caso “confirmBatch=true implica apply quando dryRun é omitido” foi criado para sobreviver a
adapters que omitem `false`, mas semanticamente transforma um acknowledgement em selector de modo.

**Proposta:** em uma futura revisão breaking/major, separar:

```text
intent = preview | apply
confirmation = explicit safety acknowledgement
```

ou manter o wire atual mas tornar `requested/effectiveMode` obrigatório no resultado e nos testes.

## 32.2 `applyMode`

### `per-target-fast`

- default atual;
- sem global preflight duplicado;
- cada target group faz compute-before-write atômico;
- targets independentes podem progredir mesmo quando outro falha;
- default failure mode = `best-effort`;
- default concurrency = 4.

### `global-preflight`

- com >1 target, preview de todos antes de qualquer write;
- default failure mode depois do gate = `fail-fast`;
- default apply concurrency = 1;
- com 1 target, o global preflight é **elidido** porque o próprio target já possui atomic
  compute-before-write.

### Limite semântico importante

`global-preflight` **não é transação multi-target all-or-none**. O preflight pode passar e um target
pode falhar no apply por drift ou erro posterior. Não existe commit atômico de múltiplos arquivos.

**Proposta de nomenclatura semântica:** preferir conceitos como:

```text
independent-progress
preflight-gated
strict-stop-scheduling
```

em vez de nomes que podem sugerir transação global.

## 32.3 `failureMode` × `targetConcurrency`

`fail-fast` com concurrency >1 não consegue “desexecutar” targets já in-flight. Ele significa
**parar de agendar novos grupos após a primeira falha observada**, não sequência estrita.

Matriz conceitual:

| failureMode | concurrency | semântica                                                |
| ----------- | ----------: | -------------------------------------------------------- |
| best-effort |          >1 | independent parallel progress                            |
| best-effort |           1 | sequential, continue on failure                          |
| fail-fast   |           1 | strict sequential stop                                   |
| fail-fast   |          >1 | stop-scheduling; alguns targets podem já estar in-flight |

A tool deveria devolver essa semântica como `effectivePolicy`, não obrigar o caller a inferi-la.

## 32.4 Result shaping

- `resultMode=compact` é default;
- `resultMode=detailed` preserva rows completos;
- **qualquer** operação com `includeDiffPreview=true` força detailed mode para o batch inteiro;
- `includePreflightDetails=true` só tem efeito se um preflight real ocorreu;
- em per-target-fast e single-target global-preflight, o preflight pode ser elidido, tornando a
  opção semanticamente inútil.

**Proposta:** separar `diffBudget`/`requestedDiffOperations` do detail level global. Um diff pedido
para um op não deveria obrigatoriamente inflar todos os outros rows.

## 32.5 `postValidate`

- config inválida bloqueia antes de writes;
- dry-run não inicia validators;
- partial apply, por default, pula validation;
- `postValidateOnPartial=true` permite validar o estado parcialmente aplicado;
- `postValidateOnPartial=true` sem `postValidate` é opção vazia;
- source barrier é capturada sobre targets aplicados antes das validations;
- validation failure não faz rollback automático.

Isso é correto, mas pede `optionWarnings` para combinações vazias/skipped.

## 32.6 `durability`

No wire do patch batch, durability é top-level e é copiada para cada operação. No executor same-file
a durability do group é lida da primeira operação. O wire atual preserva consistência porque todas
recebem o mesmo valor.

**Invariante:** qualquer futura gramática `targets[]` deve tornar durability explicitamente global
ou por-target; nunca inferida por “primeiro op”.

## 32.7 Matriz por-operação

### `replace_all` e `occurrence_index`

- ambos juntos: `ERR_PATCH_CONFLICTING_MODE`;
- em same-file group, uma operação conflitante aborta todo o grupo;
- os outros ops recebem `ERR_PATCH_BATCH_GROUP_ABORTED`.

### `expected_occurrences`

É **precondition de cardinalidade**, não selector. Pode coexistir com:

- `replace_all`: substitui tudo somente se cardinalidade bater;
- `occurrence_index`: seleciona uma ocorrência somente se cardinalidade total bater.

Isso é poderoso, mas precisa aparecer explicitamente na Option Contract.

### ambiguidade default

Se old string ocorre >1 vez e não há `replace_all` nem `occurrence_index`, a tool falha com
`ERR_PATCH_AMBIGUOUS_MATCH` e devolve occurrence evidence.

### `allowNoop`

- false/default: no-op intencional é erro;
- true: aceita convergência idempotente.

**Candidato futuro:** batch-level `convergencePolicy=strict|accept-proven`, sem mudar default de
safety.

### `expectedHash`

Protege o snapshot. Não deve ser autocorrigido ou ignorado automaticamente.

## 32.8 Hidden same-file hash mode

Flat operations são agrupadas por path. Para um same-file group:

- se o **primeiro** op tem hash e todo hash fornecido no grupo é igual, o runtime infere
  `group-baseline`;
- se hashes diferem, preserva `per-operation` virtual-state;
- em group-baseline, os expected hashes individuais são omitidos internamente e o hash vira
  precondition do baseline do arquivo.

Isso é correto mas pouco explícito. Repetir o mesmo hash “por hábito” muda a semântica.

### Proposta principal: Patch Target Groups V3

Forma conceitual:

```text
targets:
  - path
    baselineExpectedHash?
    durability?
    operations:
      - old_string
        new_string
        selector...
```

Benefícios:

- path/hash uma vez por target;
- atomicidade same-file explícita no wire;
- remove inferência `group-baseline/per-operation` pela coincidência de valores;
- recovery naturalmente target-scoped;
- menor input duplication;
- facilita per-target result/retry bundle.

## 32.9 Failure recovery atual já é avançado, mas textual

A failure semantics já distingue:

- stale-context;
- virtual-batch-context;
- exact-context-mismatch;
- already-converged(-candidate);
- ambiguous-context;
- integrity;
- target missing/kind;
- dependency abort.

`ERR_PATCH_NOT_FOUND` pode devolver:

- currentHash;
- candidateLines;
- normalized occurrence evidence;
- convergence candidate;
- até `recoveryOldString` quando um exact recovery anchor é provado único.

O gap é que a próxima call ainda precisa ser reconstruída pelo modelo a partir de texto.

## 32.10 Recovery Recipe candidato

Quando determinístico:

```text
recovery:
  kind: retry-exact
  safeWithoutInspection: true
  targetPath
  currentHash
  retryOperation
  affectedOperationIndices
```

Quando não determinístico:

```text
recovery:
  kind: decision-required
  safeWithoutInspection: false
  candidateLines
  suggestedReadWindow
```

## 32.11 Bounded self-repair candidato

Somente classes formalmente seguras poderão ser tentadas dentro da **mesma tools/call**:

1. primeira tentativa falha sem mutation;
2. runtime prova exact recovery anchor único no mesmo snapshot;
3. retry usa `currentHash` como precondition;
4. máximo 1 retry automático por target;
5. qualquer drift/ambiguity volta como failure normal;
6. nunca aplicar a `EEXPECTEDHASH`, ambiguous match, expected-occurrences mismatch ou fuzzy
   whitespace sem decisão explícita.

Isso pode realmente remover um round trip sem enfraquecer exactness.

---

# 33. Auditoria lógica de terminal_exec e terminal sessions

## 33.1 `terminal_exec`: liberdade alta, option correctness desigual

A tool já é open-world e arbitrária; portanto o problema não é falta de poder.

### Single mode

- `command` obrigatório;
- shell=true default;
- shell=false trata command como executable e args separadamente;
- `timeoutMs=0` desliga timeout;
- env ambient é projeção operacional segura, sem ambient credentials;
- stdout/stderr são bounded.

### Batch mode

- `batch` suporta até 32 comandos;
- default concurrency 4;
- failure mode best-effort;
- aggregate result budget bounded.

## 33.2 Silent ignored options — gap comprovado por código

Se `batch` é enviado junto com `command`, há erro explícito `ERR_TERMINAL_EXEC_SHAPE`.

Porém vários outros campos top-level de single mode podem coexistir com `batch` e **não são
aplicados aos itens**:

- cwd;
- env;
- inheritEnv;
- stdin;
- timeoutMs;
- maxOutputBytes;
- shell/shellPath/args, conforme combinação.

No sentido inverso, batch-only options podem ser enviados sem batch e não têm efeito:

- `batchConcurrency`;
- `batchFailureMode`;
- `batchResultBudgetBytes`.

Isso viola o novo invariante “no accepted-but-silently-ignored”.

## 33.3 Batch Defaults candidato

Em vez de simplesmente rejeitar tudo, vários campos fazem sentido como defaults compartilhados:

```text
batchDefaults:
  cwd
  shell
  shellPath
  env policy
  inheritEnv
  timeoutMs
  maxOutputBytes
```

Cada item pode override. `command/args/stdin` continuam item-specific.

Isso:

- reduz bytes repetidos;
- reduz option mistakes;
- deixa explícita a intenção;
- aumenta liberdade real sem ampliar process authority.

## 33.4 Fail-fast não é strict sequential em concurrency >1

Mesma regra do patch batch: já podem existir comandos in-flight.

Candidato de semântica:

```text
executionPolicy:
  independent-parallel
  strict-sequential
  stop-scheduling-on-failure
```

O modelo escolhe a política. Concurrency concreta pode ser runtime-owned.

## 33.5 Result budget atual pode desperdiçar headroom

O batch calcula share por stream/comando a partir do budget agregado. Uma call silenciosa não
transfere seu share para uma call muito verbosa. Resultado: um item pode truncar mesmo quando o
batch global não consumiu todo o budget.

**Candidato:** shared reclaimable budget:

- hard cap agregado permanece;
- cada stream recebe soft initial share;
- unused budget retorna ao pool;
- failures/status metadata têm prioridade;
- nenhuma expansão acima do hard registry ceiling.

Promotion gate: reduzir truncation/follow-up sem memory/context regression.

## 33.6 `terminal_session_control` é uma união lógica disfarçada de objeto amplo

`action=open|write|eof|resize|signal|close|forget` compartilha um schema com campos que só fazem
sentido para uma action. Hoje muitos campos irrelevantes simplesmente não participam do handler.

Estado-alvo:

- schema discriminado por `action`, ou
- Option Contract que rejeite/normalize explicitamente campos irrelevantes.

Não dividir automaticamente em sete tools, pois isso elevaria tool-selection cost e descriptor.

## 33.7 Schema staleness do host limita autonomia pós-reload

A auditoria anterior comprovou que o origin já podia anunciar `waitFor/waitMs`, enquanto a projeção
de tools carregada numa conversa ChatGPT permanecia antiga até relist/reconnect. Isso importa para
todos os upgrades futuros.

**Princípio:** evitar churn frequente do schema de hot tools. Sempre que possível, preferir profiles
semânticos estáveis e evolutivos a adicionar vários knobs a cada release.

---

# 34. Auditoria lógica de read, search e bulk inspect

## 34.1 `repo_read_file` / `repo_search_text`: single + batch no mesmo nome

Pontos positivos:

- uma única tool por domínio reduz selection cost;
- batch até 64;
- best-effort + bounded concurrency;
- aggregate result budget;
- structural metadata preservada quando payload textual precisa ser bounded.

## 34.2 Conflicts explícitos já existem

Se `batch` é fornecido junto com single-request fields, a tool retorna `ERR_BATCH_CONFLICTING_MODE`.

Se batch-only options são fornecidas sem `batch`, retorna `ERR_BATCH_OPTIONS_WITHOUT_BATCH`.

Esse comportamento é mais saudável que o silent-ignore encontrado em terminal.

## 34.3 Batch item schema é fraco no wire

O array de batch usa `record<string, unknown>` e valida cada item internamente. Isso mantém
flexibilidade, mas reduz host-side guidance/validation. O modelo pode montar item com field errado e
só descobrir no handler (`ERR_BATCH_INVALID_ITEM`).

Candidatos:

1. typed item schema com JSON Schema adequado;
2. `batchDefaults` + item schema menor;
3. manter record apenas se experimentos mostrarem que typed union aumenta demais descriptor/TTFT.

## 34.4 `pattern` e `query`

Search aceita os dois como alias e resolve:

```text
effectivePattern = pattern ?? query
```

Se ambos forem enviados com valores diferentes, `pattern` ganha. Não há erro de conflito.

Isso é outro caso de **implicit precedence**. Estado-alvo:

- ambos iguais → normalize explicitamente;
- ambos diferentes → reject ou option warning; não escolher silenciosamente.

## 34.5 Batch Defaults para read/search

Exemplos úteis:

```text
readBatchDefaults:
  hashMode

searchBatchDefaults:
  path
  isRegex
  caseSensitive
  includePattern
  excludePattern
  contextLines
  maxResults/resultProfile
```

Isso reduz repetição em batches homogêneos sem misturar single e batch fields.

## 34.6 `continuationRequired` está semanticamente largo demais

Hoje o helper conta como continuation:

- `payloadTruncated=true`;
- `hasMore=true`;
- `nextCursor` presente.

Esses estados não são equivalentes.

Estado-alvo:

```text
continuation:
  available        # há mais dados se o caller quiser
  transportRequired # resultado foi truncado e precisa nova call para recuperar o pedido original
  recommended       # policy considera follow-up provavelmente útil
  reason
```

Somente `transportRequired` deve entrar em métrica de round trip induzido pela tool.

## 34.7 Bulk Inspect V2

A gramática atual `read|search|stat` deve ser investigada para expansão read-only bounded com ops
como:

- outline;
- tree;
- symbol search;
- symbol usages;
- find imports;
- diff;
- index search/find symbol, se authority e result shape forem compatíveis.

### Regra de promoção

Não incluir operação apenas porque ela existe. Cada novo op precisa mostrar:

- frequência suficiente;
- sequência temporal/controlada que a call heterogênea consegue absorver;
- result budget administrável;
- mesma path/redaction policy;
- nenhum side effect.

## 34.8 Search → mutation sem read intermediária: safe selector research

Search em **arquivo único** já retorna hash do target (até 5 MiB). Search em diretório não retorna
hoje hash por arquivo matched.

Uma futura forma de reduzir search→read→patch é adicionar selector deterministicamente hash-bound:

```text
selector:
  lineRange: {start, end}
expectedHash: <required>
```

ou outra representação de range exato.

Invariantes:

- `expectedHash` obrigatório;
- range aplicado apenas ao snapshot exato;
- qualquer hash drift falha;
- nenhuma fuzzy location;
- preview/hash result obrigatório;
- primeira implementação, se houver, somente em file target ou com per-match file hash confiável.

Isso amplia a liberdade de mutation sem sacrificar optimistic concurrency.

---

# 35. File batch, Git, validação e outras fronteiras de autonomia

## 35.1 `repo_apply_file_batch`

A tool já possui uma boa arquitetura de policy adaptativa:

- safe create/move sem overwrite/quarantine → `sequential-fast`;
- remove/overwrite → default `global-preflight`;
- later operations podem depender de earlier operations;
- preflight usa virtual files para create→move dependencies.

### Mesmo trap `dryRun/confirmBatch`

Compartilha `resolveBatchDryRun`; portanto `confirmBatch=true` com dryRun omitido implica apply.

### Destructive confirmations

- top-level confirmBatch é necessário para apply;
- remove também exige `confirm=true` por operação;
- overwrite move exige `confirmOverwrite=true`.

A redundância é conservadora. Não deve ser removida sem threat model/approval study.

### Limite de atomicidade

`sequential-fast` pode deixar prefix aplicado quando operação posterior falha. `global-preflight`
reduz failures detectáveis antes do início, mas também não cria filesystem transaction global.

## 35.2 Unified Mutation Batch — candidato, não decisão

Em vez de nova mega-tool, investigar extensão da gramática ordered existente com:

```text
patch_file
```

E, somente se a autoridade continuar coerente:

```text
postValidate
postFormatTargets (allowlisted/deterministic)
```

A dificuldade central é o **virtual preflight**: um patch depois de create/move precisa operar sobre
o virtual content correspondente, não apenas sobre disco. Se isso não puder ser implementado com a
mesma exactness do patch engine, a expansão deve ser rejeitada.

## 35.3 Formatação como post-action bounded

Grande parte das ondas de código termina em Prettier separado via terminal. Um candidato é:

```text
postProcess:
  formatTouchedTargets: prettier
```

Somente se:

- formatter for allowlisted/pinned;
- targets forem exclusivamente os já modificados/explicitamente selecionados;
- diff/hashes pós-format forem devolvidos;
- source barrier usar o estado **após** formatter;
- failure semantics disser se mutation principal já ocorreu;
- nenhum formatter genérico/arbitrary command for aceito.

## 35.4 Git publication

`git_publish_changes` já é um bom micro-orquestrador:

```text
stage → commit → optional push
```

Gaps de autonomia remanescentes:

- exige clean initial index;
- se commit succeeds e push falha, workflow muda para granular push;
- failures retornam partial-state facts, mas não uma recipe uniforme de resume.

### Candidato: Git Resume Recipe

Em partial publish:

```text
recovery:
  kind: resume-push
  committedHead
  expectedUpstream
  safeWithoutRestaging: true
  suggestedTool: git_push
```

### Candidato mais agressivo: adopt exact staged set

Somente investigar se o staged set preexistente for **exatamente** o conjunto explicitamente
selecionado e source barrier for válida. Deve ser opt-in e jamais adotar staging extra.

## 35.5 Validation

Roadmap I já zerou ritual plan/poll no happy path. O upgrade mais promissor não é nova validator
tool, mas reutilizar a capability de post-validation em mutation batches.

Regras:

- validators continuam allowlisted;
- não adicionar broad validation como default;
- bounded wait primeiro;
- poll só se resultado disser `running`;
- validation failure nunca deve fingir rollback da mutation.

## 35.6 MRTR / `input_required` — experimental

MCP `2026-07-28` permite que `tools/call` devolva `resultType=input_required`; o cliente satisfaz o
input e refaz a mesma call. `requestState` pode carregar estado opaco entre rounds e deve ser
integrity-protected quando influencia lógica ou autorização.

O runtime local atualmente **não implementa** `inputRequired/requestState/inputResponses`.

Usos candidatos, somente após prova de host support:

- escolha genuinamente ambígua entre occurrences;
- confirmação adicional que não possa ser inferida;
- decisão de recovery quando duas alternativas são semanticamente válidas.

Não usar MRTR para:

- esconder option errors;
- fazer auto-fuzzy patch;
- transformar todo failure em conversa protocolar;
- alegar redução de requests físicos — MRTR é múltiplo round trip por definição.

O ganho potencial é reduzir **tool switching e reconstrução de contexto**, não contar menos
requests.

---

# 36. Arquitetura-alvo: Tool Autonomy Quality 3.0

O estado-alvo possui seis camadas.

## 36.1 Layer 1 — Semantic Intent

O caller escolhe:

- partial progress permitido ou não;
- ordering/strict stop;
- convergence acceptance;
- preview/apply;
- result richness;
- recovery policy.

## 36.2 Layer 2 — Runtime Mechanics

O runtime escolhe por default:

- concurrency;
- chunk size;
- scheduler details;
- soft per-item budget;
- cache strategy.

Advanced overrides só sobrevivem se houver workload que realmente precise deles.

## 36.3 Layer 3 — Option Normalization

Antes de qualquer side effect:

```text
requested → validate → normalize → effective policy → execute
```

A normalização deve ser observável.

## 36.4 Layer 4 — Domain Transaction Boundary

- patch atomic per file;
- file batch ordered;
- terminal process-group bounded;
- Git explicit path/upstream bounded;
- read-only bulk sem mutations.

Nenhum genérico tool-of-tools atravessa essas boundaries.

## 36.5 Layer 5 — Recovery

```text
failure → classify → hydrate → recipe → optional exact bounded retry
```

Recovery automática só ocorre quando provada semanticamente equivalente à intenção original.

## 36.6 Layer 6 — Evidence

Toda expansão mede:

- option error rate;
- ignored/coerced option rate;
- calls avoided em experimento controlado;
- partial-progress correctness;
- result bytes;
- descriptor bytes;
- prompt friction quando observável;
- resource health.

---

# 37. ROADMAP III-A — correctness de opções e observabilidade

**Roadmap III-B fica bloqueado até III-A encerrar.** Esta parte corrige a capacidade de medir e
entender a interface antes de adicionar liberdade nova.

## FAIXA III-A0 — Option Outcome telemetry

- [x] persistir `resultCode` sanitizado de completions no audit e no derived index — projector
      registry-local fail-closed + `result_code` no analytics v5;
- [x] distinguir `success`, `tool-error` (`CallToolResult.isError`) e `domain-failure`
      (`structuredContent.success=false` sem `isError`), classificando apenas códigos explicitamente
      catalogados como `option-config`/`precondition`;
- [x] fixar a boundary de requested/effective option policy: III-A0 persiste apenas outcome; o
      producer declarativo de policy pertence exclusivamente ao Option Contract SSOT de III-A1,
      evitando uma segunda taxonomia concorrente;
- [x] nunca persistir command, old/new strings, env values, paths crus, mensagens de erro ou
      payloads pela projeção de result outcome; código de máquina inválido/oversized é descartado,
      não truncado;
- [x] produzir `optionErrorRate` e `optionErrorShareOfFailures` por hot tool e runtime cohort sem
      diluição por completions históricas `unobserved`;
- [x] retirar `normalizedRate`, `ignoredRate` e `coercionRate` do escopo produtor de III-A0 e
      torná-las gates explícitos de III-A1, somente depois que requested/effective policy possuir
      owner declarativo;
- [x] cohort/generation segmentation preservada no analytics v5;
- [x] normalizer elevado de v4 para v5, com novo cursor `mcp-audit:v5`, migration idempotente e
      replay que mantém completions antigas sem outcome como `unobserved`;
- [x] testes de privacy/classification/migration/aggregation e projeção pública end-to-end verdes:
      58/58 em quatro arquivos focados; TS7 strict, lint, Prettier, `git diff --check`,
      docs-contract, architecture-contract e `mcp-full` verdes;
- [x] promover source e provar live: barrier final
      `6d81cce7670a392e880bda4f0140b6c551ce3319247efbac9f5835132a1c385e`, runtime epoch
      `f6011af2-20a3-46e2-adf8-48b330b65868`, drift `false`, smoke 131/131; cohorts v5 tiveram 100%
      de outcome coverage e o erro controlado foi classificado como
      `domain-failure/option-config/ERR_TERMINAL_EXEC_SHAPE` tanto no JSONL quanto na tool pública.

**III-A0 ENCERRADO.** Nenhuma policy requested/effective deve ser instrumentada fora do SSOT de
III-A1.

## FAIXA III-A1 — Option Contract SSOT

- [x] definir schema declarativo de activation/default/conflict/precedence/inheritance — SSOT
      v1.1.0;
- [x] classificar options semantic/tuning/result/safety/recovery — 10 tools / 101 options;
- [x] gerar ou parity-check descriptions — parity exige description não vazia para toda option
      coberta;
- [x] integrar Workflow Policy sem ciclo de ownership — parity declarativa de happyPath/defaults;
- [x] manter owner/public membrane canônica — `mcp.tools`, alias existente
      `#copilot/mcp/public/tools/catalog`, architecture/public-cost verdes;
- [x] emitir somente enums/booleans/counts seguros de requested/effective policy a partir do SSOT;
- [x] derivar `normalizedCallRate`, `ignoredCallRate`, `coercionCallRate`, `rejectionCallRate`,
      `conflictCallRate` e `ignoredRequestedOptionRate` com denominadores explícitos por
      tool/cohort;
- [x] adicionar testes de paridade end-to-end até a tool pública para qualquer projeção nova do SSOT
      — 55/55 focados neste checkpoint;
- [x] custo de descriptor medido before/after — 161.381 B → 162.303 B, delta +922 B (+0,57%),
      estrutural sem descriptions inalterado em 42.769 B;
- [x] promover barrier abrangente A0+A1 e comprovar JSONL/index/tool pública v6 live, sem source
      binding parcial — barrier `3f279c4a...`, epoch `9473214a...`, drift false, smoke 131/131 e
      probes normalize/ignore/coerce/reject observados.

**III-A1 ENCERRADO LIVE.** O SSOT passa a ser pré-requisito normativo para III-A2.

## FAIXA III-A-P — Validation / Retry Productivity Governance — transversal

Objetivo: reduzir wall time, validator churn, retries e round trips sem retirar cobertura funcional.
A unidade de decisão não é “quantas validações rodaram”, mas **risco causal coberto por unidade de
custo**.

### Baseline congelado

- broad `mcp-full`: 116398 ms;
- typecheck strict: 1283 ms;
- lint Copilot: 28858 ms;
- docs-contract: 314 ms;
- architecture-contract: 20043 ms;
- unit MCP: 65899 ms;
- analytics 1h: 9 validator polls, 7 `reload_status→reload_status`, 16 causal patch failures;
- restart desta geração: 1 transient status failure + 1 retry, sem polling loop.

### Validation budgets obrigatórios

- [x] **V0 — evidence-only/no code mutation:** nenhuma suite ampla; somente inspeção/audit
      necessário;
- [x] **V1 — localized source mutation:** testes causais focados + typecheck strict quando
      relevante; alvo operacional ≤ 15 s de wall time de validação por onda normal;
- [x] **V2 — boundary/public/architecture mutation:** V1 + checker estrutural específico/focused
      lint; broad architecture/lint somente quando a boundary realmente mudou;
- [x] **V3 — source-barrier/promotion/publication gate:** uma execução ampla por source candidate;
      `mcp-full` pode ser usado uma vez, seguido apenas de testes causais sob a barrier, sem repetir
      suite ampla se os bytes certificados permanecerem idênticos;
- [~] instrumentar validation wall time, validator starts/completions/polls, duplicate validation
  count e suite/tool breakdown no analytics/dashboard sem payload livre — dashboard agora resume
  manifests com `totalFinishedDurationMs`, broad/focused duration, per-validator runs e
  `repeatRunPressure`; duplicate permanece `null/requires-source-state-binding` até existir
  identidade causal da source;
- [~] definir `retryTaxCalls`, `retryTaxGapMs` e classes `transient`, `stale-context`,
  `already-converged`, `shape/config`, `manual-decision`, evitando chamar toda repetição de retry
  útil — analytics agora possui `retryTax` forte, com candidate lineage, temporal pressure separada,
  same-tool/target-overlap pressure e `retryTaxCalls/retryTaxGapMs` somente para mesma trace + mesmo
  tool + `exact-single` target coincidente; classes de patch são herdadas pelo `callId`,
  option-config vira `shape/config`, rate-limit/auth/result-rejected possuem sinais separados. Falta
  rebaseline live e source-state binding para validators/reload antes de marcar completo;
- [~] medir e reduzir polling de validators: producer já faz bounded inline wait e guidance só
  autoriza poll quando retorna `running`; falta ligar poll tax a job/source identity para distinguir
  polling legítimo;
- [x] eliminar `reload_status` polling mecânico do guidance — Workflow Policy v1.1.0 estabelece
      `mcp_connector_smoke_refresh` como convergência pós-reload e reserva status a falha/transição
      incerta;
- [x] investigar monitor round-trip de 14,4 s/`complete=false` e impedir monitor diagnóstico de
      competir desnecessariamente com trabalho interativo — background sync agora usa `maxChunks=1`;
      analytics explícito conserva budget completo de catch-up;
- [ ] medir no próximo promotion gate: broad-validation count, total validation wall time, retry
      tax, failed-tool-call share e round trips por mudança aceita.

### Invariant de produtividade

```text
mesma cobertura funcional + menor wall time + menos round trips/retries > mais validação mecânica
```

Nenhum budget permite pular um gate causal obrigatório; ele impede apenas repetição redundante e
broad validation sem relação com a mudança.

### Implementação/source checkpoint da faixa III-A-P

- `validation/jobs/operations.js`: cancelled deixou de ser tratado como failed; `failingJobIds`
  contém somente status `failed`, `cancelledJobIds` é separado e cancellation sem failure não
  recomenda log tail;
- dashboard ganhou `productivity` bounded sobre manifests já carregados:
  finished/passed/failed/cancelled, total wall time, broad/focused runs+duration, repeat-run
  pressure e breakdown por validator;
- `duplicateValidationCount` permanece deliberadamente `null`: duas execuções do mesmo validator não
  são chamadas de duplicadas sem source-state binding;
- analytics incremental ganhou `sync({maxChunks})`; background process-host usa exatamente 1
  chunk/ciclo, enquanto chamada explícita continua com o budget integral configurado;
- Workflow Policy v1.1.0 incorporou reload convergence e proibição de status polling mecânico;
- gate V1 causal desta onda: 49/49 testes em quatro arquivos = 7059 ms; TS7 strict = 2459 ms;
  conjunto funcional causal = **9518 ms**, dentro do alvo ≤15 s;
- experimento de custo adicional: focused ESLint nos nove arquivos tocados = 8350 ms; adicioná-lo
  mecanicamente a V1 elevaria a validação funcional de 9,52 s para 17,87 s (+87,7%). Decisão: lint
  focado entra quando há risco lint-specific/V2 ou no gate final, não em toda onda V1;
- Prettier desta onda = 1381 ms; formatação continua barata e pode ser agregada a uma única chamada;
- nenhum `mcp-full`, architecture-contract ou suite ampla foi repetido nesta onda;
- source candidate III-A-P certificada como superset A0+A1+productivity em barrier de 22 arquivos
  `src/copilot/.ai/source-barriers/roadmap-iii-a-productivity-v1.json`, fingerprint
  `fd7e5f23073923ccd66298c127c9958e3ee00090eb54557ddf215146aa03427b`; 49/49 testes causais passaram
  novamente sob verificação before/after em 8394 ms;
- promoção direta, sem `mcp_reload_plan`, request `mcp-reload-e31dcff7-5dfa-49e6-96de-4ab1235af62c`,
  epoch `60dd6a6b-770f-4507-8f8f-d245746a924c`, controlled-promotion, fingerprint `fd7e5f23...`,
  drift false; o primeiro smoke caiu na janela do restart e acionou legitimamente um único
  `mcp_reload_status` fallback; status confirmou exit 0 e o segundo/último smoke fechou 131/131;
- monitor live pós-restart: `lastDurationMs=6`, `complete=true`, `lagBytes=0`, contra 14409 ms/
  incomplete no replay anterior; a limitação de background a um chunk não reduziu o catch-up
  explícito;
- validation dashboard live agora retorna `recommendedNextAction=none`, `failingJobIds=[]` e separa
  o cancelado histórico em `cancelledJobIds`, eliminando a sugestão espúria de ler failure tail;
- produtividade observada nos 80 manifests recentes: 1475146 ms de wall time finalizado; 8 broad
  suites consumiram 1012892 ms (~68,7% do total), 45 unit-focused consumiram 247525 ms;
  `repeatRunPressure=73`, mas `duplicateValidationCount=null` até existir source-state binding. Este
  baseline reforça que reduzir broad validation redundante tem retorno muito maior do que
  micro-otimizar typecheck de ~1-2 s.

## FAIXA III-A2 — No silent ignore

Prioridade:

- [x] `terminal_exec` batch vs single fields;
- [x] terminal batch-only fields sem batch;
- [x] `terminal_session_control` irrelevant action fields;
- [x] `terminal_session_read` irrelevant action fields;
- [x] search `pattern` + `query` divergentes;
- [x] patch/file-batch options sem efeito em dry-run/postValidate absent.

Cada caso deve virar uma destas políticas:

```text
reject
inherit-explicitly
normalize-and-report
ignore-and-report (somente backward-compatible transition curta)
```

Silent ignore = zero no estado final.

### Implementação/source checkpoint da faixa III-A2

- Option Contract SSOT avançou até `1.5.0`; os 10 tools de maior fricção inscritos não possuem
  nenhum `inactivePolicy='ignore'`. A hardening de III-A4 tornou o próprio tipo/policy fail-closed:
  `inactivePolicy` corrente admite somente `reject`, alias divergence admite somente
  `reject-divergence`, e o projector usa `reject` como fallback defensivo. O campo histórico
  `optionIgnoredCount` permanece apenas para analytics de gerações passadas/compatibilidade
  observacional, não como política legítima de contratos novos;
- `terminal_exec` rejeita qualquer single-field junto de `batch` e qualquer batch-only knob sem
  `batch`, antes de adquirir terminal runtime;
- `terminal_session_control` usa um mapa canônico action→fields e rejeita options fora de
  `open|write|eof|resize|signal|close|forget` antes de tocar session state;
- `terminal_session_read` agora compartilha o mesmo mecanismo mode-scoped e rejeita
  `sessionId/afterSeq/maxBytes/limit` fora de `read|status|list|capabilities`; wait-specific
  invariants permanecem adicionais e explícitos;
- `repo_search_text` mantém `query` como alias: alias-only e valores iguais normalizam;
  `pattern/query` divergentes retornam `ERR_SEARCH_ALIAS_CONFLICT` antes de adquirir workspace
  authority;
- `repo_apply_patch_batch` rejeita em dry-run `confirmBatch`, `failureMode`,
  `includePreflightDetails`, `postValidateOnPartial` e `durability`; em apply,
  `postValidateOnPartial` também é rejeitado sem `postValidate`;
- `repo_apply_patch` rejeita `durability` em dry-run; `repo_apply_file_batch` rejeita `confirmBatch`
  e `includePreflightDetails` quando o modo efetivo é dry-run;
- todos os novos códigos são explicitamente classificados como `option-config` no bounded
  result-outcome catalog;
- gate III-A2.1 após patch semantics: 15/15 testes + strict = 6421 + 1700 = **8121 ms**;
- gate final da eliminação de terminal-session-read ignores: 17/17 testes + strict = 6531 + 1721 =
  **8252 ms**;
- falhas/repetições desta faixa foram registradas como taxonomia operacional, não escondidas: 1
  batch de search rejeitado por `contextLines>48` (`shape/config`), 2 patch batches com primeiro op
  já convergido/no-op (`already-converged`, target atomicamente abortado), 1 apply de testes
  acidentalmente executado como dry-run (`planning/shape`, zero mutation), 1 gate com assert de
  envelope incorreto (`test-surface`, código correto) e 1 strict failure JSDoc corrigido com retry
  apenas do strict (1463 ms). Em nenhum desses casos o pipeline completo foi rerodado mecanicamente;
- próximo passo quantitativo: transformar essas classes em `retryTaxCalls/retryTaxGapMs` apenas
  quando houver identidade causal suficiente; adjacency temporal isolada continuará sendo apenas
  pressure, nunca retry provado.

## FAIXA III-A3 — Continuation semantics

- [x] separar available / transportRequired / recommended;
- [x] corrigir execution hint para não chamar cursor opcional de required;
- [x] persistir também contagens por operação para distinguir 1 cursor opcional de N itens realmente
      truncados;
- [x] testes search/read/bulk com cursor sem follow-up obrigatório;
- [x] atualizar analytics para contar apenas transport-required como pressure induzida;
- [x] manter `continuation_required` v6 somente como `legacyContinuationRequired`, sem
      reinterpretá-lo;
- [x] rebaseline pós-rollout.

### Checkpoint source III-A3

- normalizer avançou `v6 → v7`, forçando replay rebuildable do audit sem confiar na semântica v6
  ambígua;
- `ResultExecutionHint` deixou de ter producer de `continuationRequired`; novos producers emitem
  `Available`, `TransportRequired` e `Recommended`, mais contagens por operação;
- `repo_search_text.batch` com `nextCursor` pode ser available/recommended sem ser
  transport-required;
- `payloadTruncated=true` é o sinal atual de transport-required: bytes solicitados não couberam no
  budget batch;
- `executionAccounting.repeatAfterBatch.transportRequired` substitui a categoria ambígua
  `continuation`;
- replay v6 preserva `legacyContinuationRequiredCalls`, excluído das métricas de continuation
  induzida;
- primeira validação com mega-suite: 103/103 + strict = 14413 + 2175 = **16588 ms**;
- os dois testes producer-level foram extraídos para `test_mcp_continuation_semantics.spec.js`; novo
  gate causal: 39/39 + strict = 6480 + 1130 = **7610 ms**, redução de **54,1%** sem perda de
  cobertura;
- rebaseline live encerrado na revisão 7.8: janela de 1h completa (`336/336`, coverage `1`), 5 calls
  com continuation available/recommended, **0** `continuationTransportRequired`, **0** operações
  truncadas e **0** repeat-after-batch induzido por transport-required. Os 12 sinais históricos v6
  permanecem isolados em `legacyContinuationRequiredCalls`, sem contaminar a semântica v7.

## FAIXA III-A4 — Combinatorial option tests

Não testar cartesiano infinito. Usar:

- pairwise coverage gerada;
- critical triples/quads definidos na SSOT;
- property tests de normalization idempotence;
- invariants de safety.

Cobertura obrigatória explícita para patch:

- [x] dryRun × confirmBatch;
- [x] applyMode × failureMode × concurrency;
- [x] resultMode × includeDiffPreview × preflight state;
- [x] postValidate × partial × postValidateOnPartial;
- [x] replace_all × occurrence_index × expected_occurrences;
- [x] same-file expectedHash modes;
- [x] allowNoop/convergence;
- [x] durability propagation.

### Checkpoint source III-A4

- foi criada `test_mcp_option_contract_matrix.spec.js`, derivada do próprio Option Contract SSOT,
  para gerar casos bounded de opções mode-scoped inativas, prerequisites `requires`,
  normalization/coercion idempotente e triples/quads críticos; não existe produto cartesiano
  explosivo;
- a matriz agora prova estruturalmente que toda opção com `activeIn` está em
  `inactivePolicy='reject'` e que alias divergence é `reject-divergence`; o SSOT avançou a `1.5.0` e
  removeu `ignore`/`ignore-alias` das políticas correntes, impedindo regressão futura para silent
  ignore por omissão humana;
- `replace_all × occurrence_index × expected_occurrences` ganhou assert wire-level explícito com
  `ERR_PATCH_CONFLICTING_MODE`; `postValidateOnPartial` sem `postValidate` é rejeitado antes de
  repository runtime;
- a auditoria do workflow encontrou um bug adicional: com `postValidateOnPartial=true`, uma execução
  com **zero** patches aplicados ainda iniciava validators. `resolveRepoPatchPostValidationPolicy()`
  agora distingue `none`, full apply, partial apply e zero mutation; zero mutation sempre faz skip
  `patch-not-applied`, evitando validator/job tax sem estado novo a validar;
- durability de patch batch foi extraída para `normalizePatchBatchOperationsForExecution()`: uma
  única policy top-level é copiada uniformemente para todas as operações, inclusive same-file
  groups, sem mutar o input;
- cobertura robusta já existente foi reutilizada em vez de duplicada: same-file
  baseline/per-operation expectedHash, atomic final-state validation e allowNoop/convergence
  permanecem nos lower-level/integration tests canônicos;
- gate causal final da faixa: **27/27 testes** em quatro arquivos = 6606 ms; TS7 strict = 1662 ms;
  total funcional = **8268 ms**, dentro de V1;
- gates V2 por mudança de membrane/public owner: `copilot:mcp:public-api-cost:check` verde (78
  aliases, 0 cost/import-purity/manifest violations), `architecture-contract-check.js` verde e
  `copilot:mcp:owner-governance:check` verde (70 owners, 870 local edges, 0 SCC/mismatch);
- nenhum `mcp-full` foi executado nesta faixa: broad validation fica reservada para a source
  candidate superset de promoção III-A2–III-A5.

O indicador histórico de cobertura superficial em `test_mcp_tools.spec.js` está, portanto, encerrado
para os casos críticos da faixa: a cobertura agora é combinada entre matriz contract-level gerada e
testes behavior/wire focados, sem transformar o mega-suite em gate de cada iteração.

## FAIXA III-A5 — Schema evolution / ChatGPT refresh contract

- [x] documentar descriptor revision por hot tool;
- [x] provar o caso desta revisão: fingerprint wire inalterada atravessa reload sem reconnect
      manual;
- [ ] provar em um schema change real se o snapshot administrativo do ChatGPT exige Refresh/review;
      experimento condicionado à primeira mudança wire real, não simulado artificialmente;
- [x] smoke local + remoto de schema parity;
- [x] evitar adicionar knobs que exigem schema churn frequente;
- [x] estudar semantic profile token estável para evoluções bounded;
- [x] não enfraquecer host validation apenas para evitar refresh sem A/B.

### Checkpoint source III-A5 — revisão 7.6

A investigação mostrou que o projeto já possuía uma autoridade global madura para geração/relist de
descriptors: `tools/list` wire fingerprint, `descriptorRevision`, observação por geração e bounded
`notifications/tools/list_changed`. O gap real era mais sutil: o smoke autenticado reduzia o
`tools/list` remoto a **nomes**, portanto `131/131` podia permanecer verde mesmo com schema antigo.
A correção aprofunda as autoridades existentes em vez de criar outro registry:

- `protocol/catalog/descriptor-fingerprint.js` é a autoridade pura para hash/parity de descriptors
  já projetados; registry continua dono de `McpToolDefinition → wire descriptor` e preservou
  byte-for-byte o fingerprint global
  `fd05bd239f57334c15934f9273f05ae610242e6118279c460d9e98225bb96512` (`tools-list-wire-sha256-v1`);
- snapshot/manifest agora possuem fingerprint + revision token por tool. Hot six nesta source
  candidate: `terminal_exec=wire-v1:5a5bcca61b439091`, `repo_read_file=wire-v1:0ef743dc7bc272f5`,
  `repo_bulk_inspect=wire-v1:838be4067ef0d7e6`, `repo_search_text=wire-v1:8c91682accdca0e2`,
  `repo_apply_patch_batch=wire-v1:c17da7de50393973`, `repo_apply_patch=wire-v1:10c5fca1fcc9ae35`;
- os dez tools cobertos pelo Option Contract possuem revision token wire estável; a identidade
  semântica é separada: `semanticProfileToken=option-contract:1.5.0`. Não foi criado input
  `semanticProfile` nem outro knob que por si só alterasse `tools/list`; evolução de policy pode
  avançar esse token sem schema churn artificial;
- OAuth/connector smoke reutiliza o **mesmo** `tools/list` autenticado já necessário. Quando
  fingerprints locais são fornecidos, nomes iguais não bastam: schema mismatch torna o gate falso e
  expõe apenas contagens/listas bounded, nunca descriptors ou payloads sensíveis no resumo compacto;
- o origin consegue provar `tools/list` recebido e `list_changed` enviado, mas não pode afirmar que
  o snapshot administrativo aprovado do ChatGPT mudou. `LIKELY_STALE_CHATGPT_ACTION_SNAPSHOT`
  permanece a classificação correta quando schema é rejeitado antes de chegar ao MCP; a prova live
  de Refresh/reconnect fica deliberadamente aberta;
- nenhum host validation foi relaxado. A5 acrescenta parity ao smoke; generic OAuth callers sem
  fingerprints locais preservam compatibilidade explícita (`schemaParity.required=false`) em vez de
  inventar sucesso de parity;
- gate causal A5: 27/27 no primeiro checkpoint e 17/17 após a decomposição de membranes/lazy
  loading; TS7 strict verde. Descriptor observation/cache-hints também permaneceram verdes no
  checkpoint de 27 testes;
- V2 final desta source candidate: public API cost = `81 aliases`, `0` manifest/cost/import-purity
  violations; architecture dynamic graph `declared=15/actual=15`, computed dynamic imports `0`;
  surface governance `0` violations; owner graph = `70` owners, `876` local edges, `0` SCC/mismatch.

#### Upgrade de custo encontrado durante A5

O primeiro desenho correto funcionalmente fez `#copilot/mcp/public/diagnostics/oauth-smoke`
ultrapassar o tier standard: `647215 B > 614400 B`. O checker foi usado como diagnóstico
arquitetural, **não** como motivo para elevar budget.

1. exact leaf de descriptor fingerprint: `647215 → 623167 B` (`-24048 B`);
2. parity tornou-se literal operation-lazy e foi declarada no dynamic graph: `623167 → 617219 B`;
3. extração/projeção de parity migrou para o owner protocol lazy: `617219 → 614393 B`;
4. closure breakdown revelou `auth/issuer/dev-oauth.js` (`170384 B`) entrando apenas porque
   `readMcpAuthConfig` vinha do barrel amplo `#copilot/mcp/public/auth`; uma exact membrane
   `#copilot/mcp/public/auth/config` removeu essa autoridade irrelevante do caminho e fechou em
   **`220095 B / 22 módulos`**, contra `647215 B` no estado problemático — redução de **`427120 B`
   (`66,0%`)** sem perda de funcionalidade, validação ou requests.

As leaves novas têm baselines versionadas com headroom `1,5×`; o ratchet global permaneceu intacto.
O custo de parity é pago somente no smoke autenticado que efetivamente precisa comparar schema,
enquanto imports genéricos do OAuth smoke deixam de carregar a closure desnecessária.

### Checkpoint live III-A3/III-A5 — revisão 7.8

A promoção final revelou e fechou dois detalhes que só podiam ser comprovados no runtime real:

- a primeira tentativa de promover diretamente a Source Barrier v2 foi recusada pelo runtime ainda
  antigo com `Unsupported repository source barrier schema/version`. O comportamento foi
  fail-closed. Como a candidate v2 possuía `68` entries e **zero tombstones**, foi gerada uma
  projeção bootstrap v1 byte-identical sobre os mesmos paths/hashes, fingerprint
  `4606bc5068641f41005bd107d7342cd85e30213541a12ba18036621b269d537c`. O reload
  `mcp-reload-61738bfa-a817-4f8e-a898-cb7d47f1eae4` concluiu exit `0`,
  `sourceBinding=controlled-promotion` e `driftDetected=false`; após esse bootstrap, v2 tornou-se
  nativamente verificável pelo runtime;
- o primeiro connector smoke pós-promoção ficou globalmente verde (`131/131` tools), mas expôs
  corretamente `schemaParity.required=false`. A investigação encontrou o wiring gap:
  `freezeToolCapabilities()` descartava `descriptorFingerprint`, `descriptorFingerprintKind`,
  `toolDescriptorFingerprints` e `toolDescriptorRevisionTokens` ao congelar o OperationContext,
  embora o registry os tivesse produzido. O fix preserva esses quatro campos e congela também os
  maps; gate causal = **20/20 testes** nos owners de context/smoke/fingerprint, TS7 strict verde e
  changed-lint verde;
- a micro-candidate foi capturada nativamente em Source Barrier v2, `69` entries, fingerprint
  `50bc90463f8b8649c2a0f4569b773609444cc69b21c9569f796c0f15006da87f`, e promovida pelo reload
  `mcp-reload-fbb89c52-ffc1-4608-b719-e3943c43d623`. O conector atual atravessou o restart sem
  reconnect manual;
- o smoke autenticado final fechou `protocolVersion=2026-07-28`, OAuth/health/subscription verdes,
  `tools=131`, `expectedLocalTools=131`, e principalmente
  `schemaParity={required:true, available:true, matches:true, comparedToolCount:131, matchingToolCount:131, mismatchedCount:0}`;
- o rebaseline analytics v7 de 1h ficou completo (`336/336`, coverage `1`), pairing
  `146/147 = 99,32%`, outcome coverage `143/143 = 100%`, Option Contract em `125` calls / `553`
  opções solicitadas / `549` efetivas, `ignoredOptions=0`, `rejectedOptions=4`. O retry tax causal
  ficou `0`; sem W3C lineage, `121765 ms` de same-tool post-failure adjacency permanecem
  corretamente apenas como temporal pressure;
- continuation semantics v7 ficou empiricamente alinhada: `continuationAvailableCalls=5`,
  `continuationRecommendedCalls=5`, `continuationTransportRequiredCalls=0`, `truncatedOperations=0`;
- custo wire final: `tools/list full = 162381 B / 409600 B`, headroom `247219 B`; nenhuma surface
  reduzida alcança `98%` de cobertura observada (`latency=95,94%` é a melhor). Portanto a decisão
  canônica permanece **full surface**, preservando funcionalidade; redução de surface não é
  recomendada sem novo A/B;
- limite epistemológico mantido: o origin prova descriptors remotos servidos e o fingerprint wire
  permaneceu estável nesta revisão. Ele não observa o snapshot administrativo aprovado do ChatGPT.
  Assim, “reload sem schema change não exigiu reconnect” é evidência real; “nova option wire exige
  Refresh?” continua experimento condicionado à primeira alteração wire genuína.

### Checkpoint de eficiência/eficácia da promoção — revisão 7.7

A própria promoção III-A revelou que o maior custo evitável não era um validator necessário, mas
**descobrir tarde um erro barato** e transportar output de sucesso excessivo. Nenhum gate foi
removido; a otimização altera ordem, granularidade de preflight, representação de evidence e volume
de sucesso:

- três tentativas amplas anteriores falharam progressivamente em lint, dependency graph e um assert
  rígido de public-API count. Os tempos medidos dos `mcp-full` interrompidos foram `30771 ms`,
  `39503 ms` e `117096 ms`: **`187370 ms` de broad retry tax observado** antes da candidate final.
  Esse número é custo efetivamente medido dessas três tentativas, não estimativa de economia futura;
- o assert `manifest.length === 78` foi removido em favor da invariância real: manifest não vazio,
  `manifest.length === packageAliases.length` e bijeção exata. O sistema agora possui `81` aliases
  deliberados sem duplicar um contador histórico em teste; o teste causal fechou `5/5`;
- foi criado `lint:copilot:changed`, que deriva staged + unstaged + untracked, filtra somente
  `src/copilot/**` e `tests/unit/copilot/**`, exclui `.ai` e usa o **mesmo ESLint/cache** do gate
  integral. Em cache quente, `54–56` arquivos alterados custaram `~1,06–1,25 s`; o full lint quente
  permaneceu em `19,126 s`. O full lint **não foi removido**;
- `mcp-full` passou de `typecheck → lint-full → docs → architecture → unit` para
  `typecheck → lint-changed → docs → architecture → lint-full → unit`. Assim, lint regressions da
  própria candidate aparecem cedo e dependency/architecture failures são testados antes de pagar o
  traversal integral do lint. O ganho em runs que falham cedo é contrafactual derivado dos tempos
  medidos; o caminho verde continua executando todos os validators;
- execução concorrente de changed-lint + Vitest + outro ESLint fez o mesmo changed-lint subir de
  `~1,1 s` para `~11,5 s`. Decisão de governança: reduzir **round trips MCP** por batch é desejável,
  mas subprocess validators CPU/FS-heavy não devem ser paralelizados mecanicamente; o safe-suite
  permanece sequencial para evitar contenção de CPU, filesystem e caches;
- `copilot:architecture:check` foi reordenado sem remover checker: core-extinction e dependency
  graph primeiro, depois architecture/package-imports, checks MCP-specific e, por fim, Infra-wide. O
  caminho verde medido continuou em `19661 ms`; o benefício é fail-fast mais cedo, não promessa de
  acelerar o caso sem falhas;
- `architecture-contract-check.js` agora emite somente `{success,checkCount,passedCount}` quando
  verde: **`65 B`** para `262/262`; em falha preserva o relatório completo. O Infra public-API cost
  aplica a mesma regra, com **`320 B`** no sucesso e detalhes integrais no failure. O umbrella verde
  completo produziu `2365 B` na medição atual;
- os units do safe-suite usam `--reporter=dot --silent=passed-only`: assertions/failures continuam
  diagnosticáveis, enquanto logs de testes aprovados deixam de atravessar o pipeline. Uma amostra
  `5/5` gerou `482 B` de stdout e `0 B` de stderr;
- manifests `src/copilot/.ai/source-barriers/*` foram classificados corretamente como memória
  operacional ignorada pelo Git, como audit/jobs/cloudflare/mcp. Continuam persistidos e
  utilizáveis, mas deixam de contaminar status, changed-lint e futuras candidates;
- Source Barrier evoluiu **v1 → v2** sem reinterpretar manifests antigos. V1 continua usando o
  domínio/fingerprint `copilot.repository-source-barrier.v1`; novas captures usam v2 e certificam
  `kind='file'` **ou** tombstone `kind='absent'`. `absent → file` é drift `unexpected-file`; file →
  absent continua drift. Isso fecha o gap em que uma deleção não podia pertencer à barrier;
- `source-barrier capture-worktree` deriva staged + unstaged + untracked pelo Git com NUL delimiters
  e `--no-renames`: um rename vira old-path tombstone + new-path file. Git apenas descobre o
  conjunto; a authority MCP resolve paths e a barrier continua sendo a autoridade de bytes/estado.
  Testes focused da barrier estão em **13/13** e comprovam v1 backward compatibility, tombstones,
  rename, staged/unstaged/untracked e fail-closed drift;
- a promoção/publicação continua semanticamente forte: `git_publish_changes` não repete validators;
  ele verifica a mesma source barrier antes de stage, antes de commit e depois do commit. Portanto,
  após um `mcp-full` verde sob uma fingerprint estável, repetir strict/lint/unit sem source mutation
  é custo duplicado e não acrescenta evidence.

**Política resultante para ondas futuras:** V1 causal focado → V2 apenas quando a boundary tocada
exigir → format agregado → `capture-worktree` v2 → um `mcp-full` superset sequencial sob a mesma
fingerprint → promoção/publicação verificando a mesma barrier. Qualquer failure deve rerodar
primeiro apenas seu gate causal; um novo broad só é necessário depois de source mutation.

---

# 38. Gate obrigatório III-A → III-B

III-B somente pode começar quando:

- [x] option result codes forem observáveis historicamente;
- [x] requested/effective option policy puder ser medida sem dados sensíveis;
- [x] silent ignored options das hot tools estiverem eliminadas ou explicitamente reportadas;
- [x] continuation semantics estiver correta;
- [x] Option Contract SSOT estiver ativa;
- [x] matriz crítica de patch/terminal/read estiver verde;
- [x] schema/descriptor cost estiver medido;
- [x] docs e runtime estiverem sincronizados;
- [x] baseline pós-III-A estiver congelado.

**Estado na revisão 7.8:**
`ABERTO — III-A concluído live; III-B pode começar em uma rodada posterior, usando este baseline como referência e sem reabrir os gates já certificados sem nova evidência de regressão.`

---

# 39. ROADMAP III-B — expansão bounded de autonomia

A ordem abaixo é candidata e deve ser reordenada pelos dados de III-A.

## FAIXA III-B1 — Machine-readable Recovery Recipe

- [x] contrato comum somente para failure/partial outcomes relevantes;
- [x] `retryInvocation` somente quando deterministicamente seguro;
- [x] suggested invocation separado de safe invocation;
- [x] target/group scope explícito;
- [x] Git partial publish também adota recipe compatível;
- [x] medir follow-up read/plan calls before/after.

### Checkpoint source III-B1 — revisão 7.9

- `protocol/tools/contracts/recovery.js` introduz Recovery Recipe `v1` como dado puro e imutável;
  nenhum recipe executa tools e nenhuma authority genérica `tool-of-tools` foi criada;
- dispositions canônicas: `retry-safe`, `suggested`, `manual` e `no-retry`; invocation segura e
  invocation apenas sugerida são campos distintos e mutuamente governados;
- patch `ERR_PATCH_NOT_FOUND` só recebe `retry-safe` quando existe `recoveryExactAnchor=true`,
  `recoveryOldString` e `currentHash` provados no mesmo snapshot, o target é independente e o caller
  não forneceu `expectedHash`, `replace_all`, `expected_occurrences` ou `occurrence_index` que
  seriam semanticamente alterados pelo retry;
- `EEXPECTEDHASH` permanece `suggested` para refresh hash-only; ambiguous/cardinality e same-file
  dependency failures permanecem `manual`; convergence/no-op é `no-retry`;
- Git publish pós-commit só recebe `retry-safe` quando a retomada pode ser expressa como `git_push`
  com `expectedHead=committedHead`, `expectedUpstream` capturado e a mesma policy de push dry-run;
  stage/commit jamais reaparecem no recipe de resume;
- o completion audit genérico extrai somente cinco contadores bounded — total, retry-safe,
  suggested, manual e no-retry. Invocation tool/args, paths, `old_string`, `new_string`,
  HEAD/upstream e reason text não entram no JSONL/SQLite por esse caminho;
- normalizer/derived index avançaram `v7 → v8`; `mcp_round_trip_analytics.recoveryRecipes` agrega as
  dispositions globalmente e por tool, sem reinterpretar histórico pré-v8 como se recipes já
  existissem;
- gate causal ampliado: **44/44 testes** em quatro arquivos = `5940 ms`; TS7 strict final =
  `1452 ms`; changed-lint verde. Um lint failure local anterior (`no-unsafe-optional-chaining`) foi
  corrigido por narrowing explícita e não exigiu rerun broad;
- a primeira forma importava Recovery Recipe pelo barrel amplo de protocol/tools e fez
  `#copilot/mcp/public/workspace/repository/patch` exceder budget (`137194 > 120234 B`). O budget
  não foi elevado: foi criada a exact membrane `#copilot/mcp/public/protocol/tools/recovery`,
  reduzindo a closure de patch para **`95449 B`** (`-41745 B`, `-30,4%`). A leaf mede
  `4222 B / 2 módulos`, com baseline próprio `6333 B / 3 módulos` a `1,5×`;
- gates V2 finais source: public API = `82 aliases`, `0` manifest/cost/import-purity violations;
  owner graph = `70 owners`, `879` local edges, `0` SCC e `0` mismatch; architecture contract =
  **263/263**, package imports/surface/cold-import/Infra gates todos verdes;
- a única checkbox source ainda aberta era deliberadamente live/quantitativa e foi encerrada na
  promoção controlada descrita abaixo.

### Checkpoint live III-B1 — revisão 8.0

- candidate final certificada por Source Barrier v2 em `23` entries, zero tombstones, fingerprint
  `ecbda618705f443083545ac6cfb36962cc7766a9f1234558d662f6fe6586115f`;
- a primeira tentativa broad chegou a `718/719` units e revelou somente um `deepEqual` de fixture
  que ainda esperava o `failureSummary` pré-recipe; o teste foi corrigido para afirmar
  explicitamente `recoveryRecipeTargetCount`, `retrySafeRecoveryRecipeTargetCount` e
  `suggestedRecoveryRecipeTargetCount`, ficando `8/8` no gate causal;
- broad superset final sob a mesma fingerprint: typecheck `982 ms`, changed-lint `1036 ms`, docs
  `213 ms`, architecture `19645 ms`, full lint `18856 ms`, units **`719/719`** em `67717 ms`, suite
  total `108451 ms`; a barrier verificou fingerprint idêntica antes/depois;
- reload controlado `mcp-reload-b79352c3-b2e4-42fd-8bf2-1572180fbf4d`, profile `quic`, exit `0`;
  `mcp_connector_smoke_refresh` pós-reload fechou MCP `2026-07-28`, OAuth/health/subscription
  verdes, `131/131` tools e
  `schemaParity={required:true,available:true,matches:true,matchingToolCount:131}`; nenhuma
  reconexão manual do ChatGPT foi necessária;
- baseline analytics v8 imediatamente antes do experimento: janela 1h completa, `451/451`, coverage
  `1`, e `recoveryRecipes={callsWithRecipe:0,recipeCount:0,retrySafeCount:0}`;
- experimento B: `repo_apply_patch(dryRun=true)` recebeu mismatch LF↔CRLF, falhou
  `ERR_PATCH_NOT_FOUND` e retornou `recoveryRecipe.disposition='retry-safe'` com anchor único
  provado e `currentHash`; a call imediatamente seguinte executou **exatamente** `retryInvocation` e
  passou em dry-run, `bytesWritten=0`, sem read/stat/plan intermediário — **2 MCP calls**;
- após B, analytics v8 mostrou exatamente `callsWithRecipe=1`, `recipeCount=1`, `retrySafeCount=1`,
  `byTool.repo_apply_patch=1`; o relatório contém apenas contagens/dispositions, sem path, source,
  hash ou invocation args;
- controle A deliberado na mesma classe: failure equivalente → `repo_file_stats(includeHash=true)` →
  corrected dry-run patch = **3 MCP calls**, também `bytesWritten=0`; analytics final registrou o
  segundo recipe e o único `repo_file_stats` do controle;
- comparação causal controlada: `3 → 2` calls, redução de **1/3 = 33,3%** para esta classe de
  exact-context mismatch. Isso não é extrapolado para failures ambíguos, hash conflicts, dependency
  groups ou para o tráfego global;
- a telemetria histórica sem W3C lineage continua epistemicamente separada: temporal adjacency segue
  como pressure, não prova de retry causal. O A/B acima é válido porque as sequências foram
  explicitamente construídas e observadas, não inferidas do histórico;
- **III-B1 está encerrada live.** A próxima faixa autorizada é III-B2, com o Recovery Recipe v1 como
  authority de elegibilidade e sem duplicar sua truth table em outro owner.

## FAIXA III-B2 — Exact bounded self-repair de patch

Primeiro candidato de auto-retry:

- [x] `ERR_PATCH_NOT_FOUND` com exact recovery anchor provado único;
- [x] retry uma vez com currentHash;
- [x] zero fuzzy matching;
- [x] zero bypass de expectedHash fornecido pelo caller;
- [x] target-independent only;
- [x] group-aware para same-file dependencies;
- [x] kill switch;
- [x] A/B call count e correctness live pós-promoção.

Candidato separado:

- [ ] `convergencePolicy=accept-proven` somente opt-in.

### Plano de implementação III-B2 — revisão 8.0

A investigação pré-código fixa as seguintes invariantes; qualquer implementação que as quebre deve
ser rejeitada:

1. **B1 é a authority de elegibilidade.** B2 não cria uma segunda truth table de “quando é seguro”.
   A primeira tentativa falha normalmente, a failure semantics constrói Recovery Recipe v1 e somente
   `disposition='retry-safe'` autoriza considerar self-repair.
2. **Uma única segunda tentativa.** Não existe loop, recursão nem cadeia de fallbacks. A execução é
   `attempt 0 → [optional attempt 1] → terminal outcome`.
3. **Hash-bound reacquire.** O primeiro `computeTextPatch` roda sob lock e a failure retorna
   `currentHash` da mesma snapshot; ao sair da call de IO o lock original é liberado. B2 reacquire o
   lock pela mesma `patchTextLocked`, mas a segunda tentativa obrigatoriamente envia
   `expectedHash=currentHash`. Qualquer race entre as duas tentativas vira `EEXPECTEDHASH` e falha
   closed antes de mutar.
4. **Zero fuzzy mutation.** O gerador Infra de `recoveryExactAnchor` só o emite para line-ending,
   quote-escape ou combinação dessas normalizações e, antes de emitir, comprova que o literal
   reconstruído já existe **exatamente uma vez no conteúdo original**. Whitespace/candidate
   fragments nunca autorizam self-repair.
5. **Caller intent inviolável.** Caller `expectedHash`, `replace_all`, `expected_occurrences` ou
   `occurrence_index` impedem `retry-safe`; B2 não remove nem substitui essas escolhas.
6. **Target-independent only.** Same-file groups continuam no `patchTextBatchLocked` e nunca fazem
   retry isolado. Distinct-file batch pode self-repair cada target independente sem mudar
   failureMode/concurrency do scheduler.
7. **Kill switch sem schema churn.** A policy será capturada na configuração process-scoped a partir
   de env e projetada no OperationContext; não será criado input knob na tool nem haverá leitura de
   `process.env` no domain owner.
8. **Mesmo engine e mesma validation.** A segunda tentativa reutiliza `patchResolvedTarget` e todas
   as opções de validation/durability/diff aplicáveis; não existe patch implementation paralela.
9. **Telemetry content-free.** Outcome/audit podem registrar attempted/succeeded/failed-closed e
   reason code bounded, mas nunca recovery anchor, source text ou hash bruto no índice analítico.
10. **Promotion gate:** false repair absoluto = `0`; race simulada deve produzir fail-closed; kill
    switch off deve reproduzir exatamente o comportamento B1 (failure + recipe, sem segunda IO).

Decisão arquitetural: **não** mover o self-repair para o Infra nesta faixa. Fazer isso duplicaria a
policy B1 dentro de uma camada que não conhece caller/tool semantics. O custo de uma segunda
lock/read local é aceito inicialmente porque o benefício alvo é eliminar um model→tool round trip;
se telemetry provar que o local retry é hot, uma futura otimização poderá mover apenas a execução
já-autorizada para dentro do lock sem mover a policy.

### Checkpoint source III-B2 — revisão 8.1

- `workspace/repository/patch/config.js` introduz `McpRepositoryPatchConfig v1`, imutável e
  capturado uma vez por processo. Default: `exactSelfRepairEnabled=true`, hard ceiling
  `exactSelfRepairMaxAttempts=1`; kill switch operacional:
  `COPILOT_MCP_PATCH_EXACT_SELF_REPAIR_DISABLED=true`;
- a config possui exact membrane `#copilot/mcp/public/workspace/repository/patch/config`; o wire
  schema das tools não mudou. `createMcpProcessConfig` mantém a mesma instância em `repositoryPatch`
  e `toolConfig.repositoryPatch`; `freezeToolConfig` foi atualizado explicitamente — um teste
  revelou que a allowlist anterior não projetava a policy, evitando propagação silenciosa;
- `RepoWriteRuntime` agora exige a config explicitamente, sem fallback legado. O único chamador de
  produção de `runRepositoryPatchTargetGroups` é o bridge de repository-write, portanto o contrato
  foi endurecido sem shim;
- `executeIndependentPatchTarget` centraliza tentativa 0 + optional tentativa 1 para plan/apply de
  targets independentes. A elegibilidade não é recalculada: somente Recovery Recipe v1 com
  `version=1`, `disposition='retry-safe'`, `scope='target'`,
  `reasonCode='patch-exact-anchor-same-snapshot'` e `tool='repo_apply_patch'` é consumida;
- o retry verifica novamente path/new_string, `dryRun`, literal `old_string`, SHA-256 de 64 hex e
  igualdade `retry.expectedHash === failure.details.currentHash`; recipe ou caller com
  `expectedHash`, `replace_all`, `expected_occurrences` ou `occurrence_index` sai do caminho;
- a tentativa 1 chama o mesmo `patchResolvedTarget`, reacquire o mesmo resource lock e envia
  `expectedHash=currentHash`. Race simulada entre os locks produz `EEXPECTEDHASH`,
  `failedClosed=true`, zero mutation e **nenhuma terceira tentativa**;
- same-file groups continuam integralmente em `patchTextBatchLocked`: teste owner prova
  `singleCalls=0`, `batchCalls=1`, recipe `manual/dependency-group` e ausência de self-repair;
- wire/audit expõem somente projeção bounded:
  `attempted/succeeded/failedClosed/attemptCount/reasonCode/failureCode`; batch agrega apenas
  attempted/succeeded/failedClosed counts. Recovery anchor, source text e hashes não fazem parte
  dessa projeção;
- gate config: **3/3**; gate Recovery Recipe + wire real: **7/7**, incluindo apply efetivo em
  arquivo temporário governado; gate patch batch: **8/8**; gate owner/security: **4/4**. Total
  causal local: **22/22**, além de TS7 strict e focused ESLint verdes;
- o teste compacto de 12 operações detectou regressão de payload: `3085 B` para SLO `<3 KiB`
  (`3072 B`). O SLO não foi relaxado: o objeto top-level `exactSelfRepair` agora é completamente
  omitido quando `attemptedCount=0`, restaurando `8/8` no batch suite;
- **false repair observado em testes causais = 0**;
- analytics foi promovida para **v9**: completion metadata persiste somente
  `exactSelfRepairAttemptedCount`, `exactSelfRepairSucceededCount` e
  `exactSelfRepairFailedClosedCount`; nenhuma recipe, path, hash, anchor, source text, reason string
  ou invocation arg entra no índice. Migration idempotente adiciona três INTEGERs e o cursor `v8→v9`
  força replay do audit source-of-record. Gates: audit boundary `12/12`, analytics `28/28`, wire
  `1/1` = **41/41**;
- consumers transversais permaneceram verdes: repository-write `32/32`, canonical tools `64/64` e
  OperationContext `3/3` = **99/99**. Somados aos 63 gates causais/analíticos, são **162 testes
  focados distintos verdes** nesta candidate;
- a nova membrane `#copilot/mcp/public/workspace/repository/patch/config` foi medida pelo analisador
  canônico em **2 módulos / 1911 B / zero external packages**. Baseline versionado recebeu somente
  essa entry, com headroom 1,5× (`maxModuleCount=3`, `maxSourceBytes=2867`);
- owner governance passou após declarar somente a edge
  `mcp.composition.process-config → mcp.workspace.repository.patch`: `402` parsed files, `881` local
  module edges, `70` owners, `230` direct owner dependencies, **0 SCC / 0 mismatch / 0 violation**;
- public API cost está verde em `83/83` aliases, `1011` closure files, **0 manifest / 0 cost / 0
  import-purity violations**; architecture umbrella fechou **264/264**, dependency graph `2285`
  files / `6157` edges com zero cycles/unresolved imports e surface governance com zero violations;
- formatação final foi aplicada somente ao worktree candidate e o regate pós-Prettier fechou strict,
  changed lint, docs, formatting check e `31/31` testes diretamente afetados;
- a **validation barrier v2** foi capturada por `capture-worktree` em `33` entries, `0` tombstones,
  fingerprint `93a41fed6cbbc3d81bc1a3935d8549cee396ec50af4fbd319832082eb5b8d1af`;
- sob essa mesma fingerprint, sem qualquer drift antes/depois, passaram: TS7 strict, changed lint,
  full `lint:copilot`, docs contract e architecture umbrella `264/264`;
- o único `mcp-full` da candidate também rodou sob `93a41f…d1af` e fechou **123 test files / 730/730
  tests**, com typecheck `983 ms`, changed lint `934 ms`, docs `208 ms`, architecture `19643 ms`,
  full lint `19038 ms`, unit MCP `69303 ms` e suite total `110110 ms`;
- a validation barrier inclui MD/testes e permanece a prova da candidate validada. Para promoção
  será criada uma **promotion barrier runtime-scoped** separada, contendo apenas `package.json` e
  produção alterada em `src/copilot/mcp/**`; isso evita que futuras atualizações legítimas deste MD
  façam o runtime promovido parecer source-drifted sem que bytes executáveis tenham mudado;
- a **promotion barrier runtime-scoped** foi capturada explicitamente sobre `package.json` + os `20`
  artefatos de produção alterados em `src/copilot/mcp/**`: `21` entries, `0` tombstones, fingerprint
  `25170022708eac9c642c23d8ba8d2d288c86c8e1aa0ada679b3b1fe2bca9baa6`;
- um novo `mcp-full` foi executado diretamente sob essa promotion barrier e preservou a fingerprint
  antes/depois: **123 test files / 730/730 tests**, typecheck `1001 ms`, changed lint `928 ms`, docs
  `213 ms`, architecture `19752 ms`, full lint `18978 ms`, unit MCP `63677 ms`, suite total
  `104549 ms`;
- reload controlado: request `mcp-reload-d8927a9c-25bd-4035-b868-7d55fc800817`, profile resolvido e
  executado `quic`, exit `0`; a conexão ChatGPT/AURELIN 4 se recuperou automaticamente e nenhuma
  reconexão manual foi necessária;
- smoke pós-reload: MCP `2026-07-28`, health `200`, OAuth protected-resource/authorization-server/
  challenge verdes, authenticated smoke verde, modern subscription verde, tools `131/131` e
  `schemaParity={required:true,available:true,matches:true,comparedToolCount:131,matchingToolCount:131}`;
- runtime generation pós-promoção: PID `130333`, `sourceBinding='controlled-promotion'`, mesmo
  promotion request id, `sourceBarrierFingerprint=251700…baa6` e `runtimeSourceDrift=false`;
- baseline analytics da nova geração: schema/normalizer **v9**, janela 1h completa `394/394`,
  coverage `1`, nova cohort já presente e
  `exactSelfRepair={callsWithAttempt:0,attemptedCount:0,succeededCount:0,failedClosedCount:0}`;
- fixture live descartável fora do source runtime: conteúdo CRLF de `38` bytes, hash física inicial
  `989b3b084615f6e2cd74fd7ef5097f9940bc0ed9ace89973148542382428061b`. Uma **única**
  `repo_apply_patch(dryRun=true)` recebeu `old_string` LF contra a linha CRLF e retornou diretamente
  `success=true`, `bytesWritten=0`,
  `exactSelfRepair={attempted:true,succeeded:true,failedClosed:false,attemptCount:1}`;
- a verificação física após a call manteve exatamente `38` bytes e a mesma hash `989b…061b`; o
  fixture foi então removido;
- analytics v9 pós-experimento passou exatamente para
  `exactSelfRepair={callsWithAttempt:1,attemptedCount:1,succeededCount:1,failedClosedCount:0,successRate:1,failedClosedRate:0}`,
  exclusivamente em `repo_apply_patch`; nenhuma path/hash/anchor/source/reason/invocation entrou no
  índice derivado;
- comparação causal final: fluxo III-B1 `failure → retryInvocation` = **2 patch-related MCP calls**;
  III-B2 = **1**. Redução `2→1`: **1 call / 50%** nessa classe exact-anchor. Contra o controle
  legado pré-B1 (`failure → file_stats → corrected patch`), a mesma classe passa `3→1`, redução de
  **2 calls / 66,7%**. Nenhum desses percentuais é extrapolado para failures ambíguos, conflicts,
  dependency groups ou tráfego global;
- **false repair observado permanece 0** nos gates causais; o experimento live também fechou com
  `failedClosed=0` e correctness física preservada;
- **III-B2 está encerrada live.** O candidato separado `convergencePolicy=accept-proven` permanece
  deliberadamente não implementado e não faz parte do gate desta faixa; qualquer implementação
  futura exige opt-in, auditoria e experimento próprios. A próxima faixa autorizada é III-B3.

### Checkpoint live III-B2 — revisão 8.4

Estado final da faixa:

- [x] source causal-green;
- [x] analytics v9 content-free;
- [x] public membrane/cost/owners/architecture verdes;
- [x] validation barrier v2 certificada;
- [x] promotion barrier runtime-scoped certificada;
- [x] `mcp-full` `730/730` sob a promotion barrier;
- [x] reload `quic` exit `0`;
- [x] connector smoke + OAuth + subscription + schema parity `131/131`;
- [x] runtime source binding/fingerprint comprovado e zero drift;
- [x] A/B live `2→1` com hash física inalterada e `bytesWritten=0`;
- [x] analytics v9 `attempted=1 / succeeded=1 / failedClosed=0`;
- [x] false repair observado = `0`.

## FAIXA III-B3 — Patch Target Groups V3

- [x] desenhar canonical `targets[]` shape;
- [x] path/hash/durability ownership explícito no contrato alvo;
- [x] operation list relativa ao target no contrato alvo;
- [x] remover inferência de hash mode por coincidência de valores da execução canônica;
- [x] reduzir input bytes no wire promovido — V3-only apply descriptor `4636 B`, abaixo do V2
      pré-migração `4892 B`;
- [x] comparar schema/payload bytes contra flat operations — ganhos multi-edit de `-42,7%` a
      `-67,4%` nos casos same-file controlados;
- [x] definir estratégia de migração **sem shim permanente**;
- [x] host refresh gate observado antes da remoção live; runtime final rejeita V2 e aceita
      `targets[]`.

### Investigação e contrato alvo III-B3 — revisão 8.5

Baseline live antes da transformação:

- `repo_apply_patch_batch` é o 4º maior descriptor do MCP: `4892 B` totais, `4200 B` de input
  schema, `2426 B` somente de descriptions e `1774 B` de schema sem descriptions;
- o wire V2 repete `path` e `expectedHash` em cada operation; o owner volta a agrupar por path e
  hoje infere `group-baseline` quando hashes fornecidas coincidem. Logo target identity/precondition
  não são explícitas: são reconstruídas por heurística a partir de operações flat;
- payload sintético representativo, mantendo a mesma informação: `1` edit same-file `277→291 B`
  (`+5,1%`, custo pequeno), `3` edits `661→379 B` (`-42,7%`), `12` edits `2393→779 B` (`-67,4%`),
  `4 targets × 3 edits` `2089→1304 B` (`-37,6%`). O uso live recente de patch batch tem p50≈`3` e
  p95≈`8`, portanto o ganho aparece no regime de uso relevante;
- o runtime já observa descriptor revisions e pode enviar `tools/listChanged`, mas a própria
  authority `descriptorObservation.chatgptActionSnapshot` classifica o snapshot do ChatGPT como
  `external-admin-state`: tools/list observado na origem **não prova** que o action snapshot
  aprovado pelo host foi atualizado. Isso impede remoção imediata da forma V2.

Contrato V3 canônico:

```text
targets: [
  {
    path,
    expectedHash?,
    durability?,
    operations: [
      { old_string, new_string, replace_all?, expected_occurrences?, occurrence_index?,
        allowNoop?, diffContextLines?, maxDiffLines?, includeDiffPreview? }
    ]
  }
]
```

Invariantes:

1. `path`, baseline `expectedHash` e `durability` pertencem ao target e não se repetem nas
   operations;
2. target paths são únicos no V3; same-file sequencing é expresso por uma única target com
   operations ordenadas, não inferido reagrupando paths repetidos;
3. `target.expectedHash` significa unicamente baseline da snapshot inicial. O caminho V3 não possui
   per-operation expectedHash e nunca infere hash mode por coincidência;
4. índices de resultado permanecem globais e determinísticos em ordem target-major, preservando a
   superfície de failure/applied rows e affectedOperationIndices;
5. limites permanecem `128` operations / `64` targets / `3 MiB`, calculados sobre o input wire real
   e não sobre uma expansão flat artificial;
6. top-level `durability` permanece **legacy-flat only** durante a migração; no V3 cada target
   possui sua própria durability opcional e omission conserva o default do engine;
7. `includeDiffPreview` em `targets.*.operations.*` continua forçando resultMode detailed e o Option
   Contract SSOT será estendido para representar esse nesting explicitamente;
8. audit target correlation aprende `targets[*].path`; nenhum path bruto novo entra na telemetria.

Migração em duas fases, sem shim permanente:

- **B3-A:** adicionar `targets[]` e torná-lo canonical internamente; manter `operations[]` apenas
  como adapter wire `legacy-flat-v2`, rejeitando calls que forneçam ambos. O adapter reproduz a
  semântica V2, inclusive o caso raro de hashes distintos por operation, mas toda inferência fica
  isolada nele; o patch owner passa a receber target groups explícitos e não reagrupa nem infere
  baseline;
- promover B3-A, medir descriptor/input bytes, executar smoke/schema parity e solicitar/observar o
  refresh administrativo do conector;
- **B3-B:** somente após host refresh comprovado, remover `operations[]`, top-level legacy
  durability, legacy per-operation hash support e o adapter inteiro na mesma mudança. Nenhum compat
  layer fica permanente.

Gate B3-A: V3 correctness igual ao V2, legacy parity verde, payload menor para batches `n>=2`,
schema medido, target-native owner sem hash inference e todos os gates arquiteturais/testes verdes.
Gate B3-B: host refresh explícito + nova descriptor observation + remoção integral do adapter
legado.

### Checkpoint source B3-A — revisão 8.6

Implementação já concluída na candidate, ainda **não promovida** neste checkpoint:

- `tools/repo-write/patch-input.js` tornou-se o único boundary de canonicalização. Ele exige
  exatamente um shape (`targets[]` ou `operations[]`), mede o envelope wire completo, normaliza
  paths, preserva índices globais target-major e aplica os limites `128 ops / 64 targets / 3 MiB`.
  `targets[] + durability` top-level e `targets[] + operations[]` falham closed;
- `workspace/repository/patch/contracts.js` passou a possuir o contrato estrutural de target. A
  execução abaixo do wire recebe target groups explícitos; `patch/operations.js` não possui mais
  `Map(path→ops)`, `buildLockedPatchBatchGroup`, `readPatchExpectedHash` nem qualquer inferência de
  baseline pela igualdade de hashes;
- single-operation target continua usando o mesmo caminho B2, preservando exact bounded self-repair.
  Multi-operation target entra diretamente em `patchTextBatchLocked`, mantendo one lock/read/write e
  proibindo retry isolado de dependency groups;
- `repo_patch_batch_plan` e `repo_apply_patch_batch` aceitam V3 e, **somente durante B3-A**, o shape
  V2. Ambos convergem para o mesmo `RepositoryPatchTarget[]` antes de criar/usar o domain runtime.
  Result/audit expõem somente `inputShape=targets-v3|legacy-flat-v2`, sem conteúdo;
- Option Contract SSOT avançou para `1.6.0`: `targets` é opção semântica declarada, top-level
  durability exige `operations` e a regra `nested-collection-boolean-forces-enum` representa
  `targets[].operations[].includeDiffPreview → resultMode=detailed` sem heurística no handler;
- audit correlation passou a extrair targets exatos de `targets[*].path` e continua persistindo
  apenas hashes opacos; guidance/meta/workflow policy agora indicam `targets[]` como happy path e
  proíbem escolher o V2 para calls novas;
- testes focados: canonicalizer V3 `7/7`, wire V3 `5/5`, legacy V2 parity `8/8`, B2 self-repair
  `4/4`, option semantics `3/3`, Option Contract/matrix/enforcement `24/24`, audit correlation
  `13/13`, registry `27/27`, repository-write `32/32` — superset central **123/123**.
  `test_mcp_tools` soma **64/64**; TS7 strict e focused ESLint estão verdes;
- governança: public API cost `83/83`, closure `1012`, zero cost/manifest/purity violations; owner
  graph `404` files / `883` edges / `70` owners / `230` direct owner dependencies, **0 SCC / 0
  mismatch**; architecture umbrella permanece **264/264**, dependency graph `2287` files / `6159`
  edges, sem cycles/unresolved imports;
- medição local B3-A: `repo_apply_patch_batch 4892→6413 B` (`+31,1%`) e
  `repo_patch_batch_plan 2447→4481 B` (`+83,1%`) porque os dois schemas coexistem. O envelope total
  `162381→165936 B`, somente `+3555 B / +2,19%`, ainda muito abaixo do teto `409600 B`. Esse aumento
  é **custo transitório de migração, não estado-alvo**;
- a economia de request payload do V3 permanece material: `3` edits same-file `-42,7%`, `12` edits
  `-67,4%`, `4×3` `-37,6%`. A redução do descriptor só pode ser julgada após B3-B remover o schema
  V2;
- dívida temporária explicitamente bounded: `legacy-group-baseline`/`legacy-per-operation` ainda são
  projetados pelo owner somente para preservar parity V2 durante B3-A. A heurística que decide esses
  modos existe **somente em `patch-input.js`** e esses branches serão removidos junto com o adapter
  em B3-B; não podem sobreviver ao encerramento da faixa;
- a authority de descriptor foi promovida conscientemente para fingerprint B3-A
  `fa9401b0cb804a8cc270d0096575814363f5c72565ebb190f6a053ea4dfcf968`, com asserts locais adicionais
  `repo_apply_patch_batch=wire-v1:1fac494610fcb473` e
  `repo_patch_batch_plan=wire-v1:dbc4f47bcc3837b6`;
- a validation barrier pós-fingerprint foi recapturada por `capture-worktree`: `46` entries, `0`
  tombstones, fingerprint `4e90979522010e8853bf86a7b927b1d7521fb35f8b26fb7593a8a6a3d72d6c65`. Sob
  ela o `mcp-full` fechou **125/125 test files / 743/743 tests**, além de strict, changed lint,
  docs, architecture e full lint, sem source drift;
- a promotion barrier runtime-scoped foi capturada explicitamente sobre `package.json` + `28`
  arquivos de produção alterados em `src/copilot/mcp/**`: `29` entries, `0` tombstones, fingerprint
  `e98a2b3b5b3ec71a3cbe7c972414a189ac7fabf4709e2f44fab096478bbf5942`. Um novo `mcp-full` executado
  diretamente sob essa barrier também fechou **125/125 / 743/743** e preservou o mesmo fingerprint
  antes/depois.

### Promoção live B3-A e host-refresh gate — revisão 8.7

- reload request `mcp-reload-172cc81e-a28e-4b85-b186-fd9b7e306a18`, profile `quic`, promovido
  diretamente da barrier `e98a2b3b…f5942`; a conexão AURELIN 4 recuperou-se automaticamente;
- smoke pós-reload: protocolo `2026-07-28`, health `200`, OAuth protected-resource/authorization
  metadata/challenge verdes, authenticated OAuth smoke verde, modern subscription verde, tools
  `131/131` e schema parity **131/131** sem mismatch;
- runtime generation live: PID `152391`, epoch `ef32a261-2fdd-4120-aeed-74eff95eb0e8`,
  `sourceBinding='controlled-promotion'`, promotion request id idêntico, barrier `e98a2b3b…f5942` e
  `runtimeSourceDrift=false`;
- descriptor observation live: `currentDescriptorFingerprint=fa9401b0…cf968`, `131` tools,
  `tools/list` observado em `2026-08-27T22:00:37.164Z`, protocol `2026-07-28`; o próprio runtime
  classifica `chatgptActionSnapshot` como `external-admin-state` e proíbe inferir refresh do host a
  partir da origem;
- payload audit live reproduziu a medição source: envelope `165936 B`, headroom `243664 B`,
  `repo_apply_patch_batch=6413 B` e `repo_patch_batch_plan=4481 B`;
- **host-refresh gate falhou de modo esperado e seguro**: uma nova introspecção do schema AURELIN 4
  feita pelo próprio host desta conversa, depois do reload e do smoke remoto verde, continuou
  anunciando somente `operations[]` para `repo_apply_patch_batch`/`repo_patch_batch_plan`, com a
  descrição V2 de repeated paths/group-baseline. Logo o snapshot ChatGPT permanece comprovadamente
  stale embora a origem esteja B3-A e 131/131;
- conclusão: B3-A está **promovido e saudável**, mas B3-B permanece bloqueado somente pela fronteira
  administrativa do ChatGPT. Remover V2 antes do Refresh/reconexão quebraria o cliente atual e
  violaria o gate definido na própria revisão 8.5.

O usuário executou novo Refresh/reconexão administrativa e reiniciou MCP/Cloudflare antes da revisão
8.8. A introspecção host-side desta própria conversa, porém, **continuou anunciando o descriptor
V2** (`operations[]` no top-level e ausência de `targets[]`). Portanto a tentativa externa não
satisfez o gate de promoção. Como a origem B3-A já estava estável e a dívida V2 era completamente
isolada, B3-B foi executada e validada **source-only**, sem reload da candidate V3-only. A remoção
live continua fail-closed até que uma action snapshot nova seja realmente observável pelo cliente.

### Checkpoint source B3-B V3-only — revisão 8.8

Estado da candidate V3-only:

- [x] `tools/repo-write/patch-input.js` aceita exclusivamente `targets[]`; ausência de targets,
      stale flat `operations[]` ou durability top-level falham como `ERR_PATCH_BATCH_INPUT_SHAPE` no
      boundary interno;
- [x] adapter `legacy-flat-v2` removido integralmente; não existe mais regrouping/inference de
      paths/hashes;
- [x] `RepositoryPatchExpectedHashMode` reduzido a `target-baseline | none`;
- [x] `legacy-group-baseline`, `legacy-per-operation`, per-operation `expectedHash` e respectivos
      branches removidos do patch owner;
- [x] `repo_apply_patch_batch` e `repo_patch_batch_plan` exigem `targets[]` no descriptor e não
      publicam mais `operations[]` nem durability top-level;
- [x] `inputShape`/`sourceShape` transitórios foram removidos de resultado/audit/presentation;
- [x] Option Contract SSOT avançou `1.6.0 → 1.7.0`, removendo a opção flat, inheritance de
      durability e a regra flat de diff preview; permanece apenas
      `targets[].operations[].includeDiffPreview → resultMode=detailed`;
- [x] audit correlation de patch batch usa exclusivamente `targets[*].path`, continuando
      content-free;
- [x] guidance/meta deixou de documentar qualquer input de migração;
- [x] teste histórico `test_mcp_patch_batch_v2.spec.js` foi aposentado/renomeado para
      `test_mcp_patch_target_groups.spec.js`; seus oito cenários reais foram migrados para ownership
      explícita de target;
- [x] descriptor-level test prova `required=['targets']` e ausência de `operations`/durability
      top-level nos dois patch-batch tools;
- [x] busca negativa em `src/copilot/mcp` + `tests/unit/copilot/mcp` retorna zero para
      `legacy-flat-v2`, `legacy-group-baseline`, `legacy-per-operation`,
      `legacyPatchBatchOperationSchema`, `inputShape` e `sourceShape`;
- [x] fingerprint source V3-only =
      `2449c418de55b14c51ac8760fe42612d521bc62d7c2e461a8a356942f739cfa7`;
- [x] revision tokens finais desta candidate: `repo_apply_patch_batch=wire-v1:345553b0bc26ad02` e
      `repo_patch_batch_plan=wire-v1:5394ee0968c76fdc`;
- [x] payload audit canônico `sdk-in-memory-tools/list` da candidate V3-only: envelope `162586 B`,
      headroom `247014 B`, `repo_apply_patch_batch=4636 B`, `repo_patch_batch_plan=2908 B`;
- [x] contra B3-A dual-shape: envelope `-3350 B / -2,02%`, apply descriptor `-1777 B / -27,71%`,
      plan descriptor `-1573 B / -35,10%`;
- [x] contra o baseline B2 pré-V3: envelope `+205 B / +0,13%`, apply descriptor `-256 B / -5,23%` e
      plan descriptor `+461 B / +18,84%`; portanto o custo fixo total ficou essencialmente neutro
      enquanto o request payload de batches reais mantém os ganhos medidos de `-42,7%` (3 edits
      same-file), `-67,4%` (12 edits same-file) e `-37,6%` (4×3);
- [x] focused causal/transversal gate final: **11 arquivos / 159/159 testes verdes**;
- [x] TS7 strict verde;
- [x] changed-lint verde (`44` files no gate broad final);
- [x] architecture umbrella `264/264`; dependency graph `2287 files / 6159 edges`, zero
      cycle/unresolved imports; owner graph
      `404 files / 883 edges / 70 owners / 230 declared owner dependencies`, zero SCC/mismatch;
      public API cost/manifest/purity zero violations;
- [x] validation Source Barrier B3-B capturada por `capture-worktree`: **50 entries / 1 tombstone**,
      fingerprint `8c1c1a532067d62d24cfa1bdb7ce0714aeecd85f6484b3413aa05ade9d889058`; o tombstone é
      deliberadamente o teste V2 aposentado;
- [x] `mcp-full` B3-B sob a mesma validation barrier: **125/125 test files / 740/740 tests**,
      strict, changed-lint, docs, architecture e full lint verdes, suite total `110600 ms`,
      fingerprint idêntica antes/depois. O primeiro attempt havia identificado exclusivamente uma
      matrix stale (`739/740`); ela foi migrada para `targets[].operations[]` e o segundo/necessário
      gate fechou integralmente sem qualquer mudança adicional de produção;
- [x] promotion barrier runtime-scoped B3-B capturada sobre **29 runtime files / 0 tombstones** e
      verificada byte-for-byte: `3133d8ca651518ecf5e387c5adb76ce9f609d72d74705fcd9934ee51a8273475`.
      Não foi executado um segundo `mcp-full` redundante sob essa subset barrier: os mesmos 29 bytes
      de produção são subconjunto imutável da validation candidate que acabou de fechar a suite; a
      decisão reduz custo de validação sem remover nenhum gate funcional;
- [x] **host action snapshot efetivamente expõe `targets[]` nesta conexão**: após a
      reconexão/restart do usuário, a primeira introspecção ainda projetou V2; uma introspecção
      host-side posterior passou a expor o descriptor B3-A dual-shape com `targets[]` em
      `repo_apply_patch_batch` e `repo_patch_batch_plan`. Esse é o critério necessário para promoção
      segura: o host já sabe formar chamadas V3, ainda que sua snapshot permaneça temporariamente
      mais permissiva que a runtime final;
- [x] reload/promoção B3-B V3-only concluída por request
      `mcp-reload-ed80ebea-3c5a-448c-bba9-a86ebd7e1e42`, profile `quic`, sob a promotion barrier
      `3133d8ca651518ecf5e387c5adb76ce9f609d72d74705fcd9934ee51a8273475`;
- [x] smoke remoto + schema parity V3-only + runtime source binding/drift verdes: OAuth/protocolo
      moderno `2026-07-28`, tools/list `131/131`, parity `131/131`,
      `sourceBinding=controlled-promotion`, `runtimeSourceDrift=false`;
- [x] payload audit live reproduziu exatamente a candidate: envelope `162586 B`, headroom
      `247014 B`, `repo_apply_patch_batch=4636 B`, `repo_patch_batch_plan=2908 B`;
- [x] prova live positiva V3: `targets[]` com 1 target e 2 operações dependentes same-file concluiu
      `success=true`, `failedCount=0`, `expectedHashMode=target-baseline`; como era dry-run, o
      SHA-256 físico permaneceu `e49c81e2d2f84e259d40e2fb8192f3bcd198b355184845d76d8f58807d0d78ee`;
- [x] prova live negativa V2: a forma flat antiga foi recusada pela validação da tool porque
      `targets` é obrigatório, demonstrando que o adapter legado também está extinto na runtime
      promovida;
- [x] analytics v9 reconheceu a cohort
      `source:3133d8ca651518ecf5e387c5adb76ce9f609d72d74705fcd9934ee51a8273475`; a chamada V3
      aparece sob Option Contract `1.7.0`, sem normalização/coerção/rejeição;
- [x] III-B3 encerrada code+runtime live e III-B4 liberada para investigação, **não para
      implementação automática nesta rodada**.

**Boundary administrativo remanescente, não gate de runtime:** o action snapshot do ChatGPT/AURELIN
4 é estado externo ao origin e foi observado oscilando entre projeções stale mesmo após a promoção.
Isso não invalida a evidência do servidor: smoke remoto obteve parity `131/131`, `targets[]`
funcionou live e a forma V2 foi rejeitada. Não reintroduzir compatibilidade V2 para acomodar
snapshot administrativo stale; futuras divergências devem ser tratadas via Refresh/review/reconexão
do host e diagnosticadas separadamente da verdade wire/runtime do origin.

## FAIXA III-B4 — Authority integrity, surface discovery e semantic execution policy

> **Reordenação normativa da revisão 9.1:** a lista antiga de três profiles era prematura. A nova
> auditoria descobriu primeiro um bug P0 na authority derivada e, depois, mostrou que a policy de
> patch realmente usada não cabe nos três nomes propostos. III-B4 passa a ser uma sequência de cinco
> subfaixas com gates próprios. **B4-0 bloqueia B4-1→B4-4 quando a decisão depender do derived
> index.** Nenhuma destas mudanças foi implementada nesta revisão documental.

### III-B4-0 — Derived-index logical source-generation integrity — P0 / primeiro alvo

#### Problema provado

`mcp_round_trip_analytics` persiste hoje `source_identity = dev:ino` e também usa esse valor como
identidade lógica da história ingerida. Quando o mesmo audit append-only é reexposto sob uma nova
identidade física — incidente observado `2096:178412 → 2128:178412` — o cursor detecta mudança, zera
`offset` e reingere desde byte zero, **preservando ao mesmo tempo as rows da identity antiga**. O
prefixo histórico passa a existir duas vezes.

Snapshot read-only reproduzido em 2026-08-27:

```text
source_identity=2128:178412  rows=56693  starts=26253
source_identity=2096:178412  rows=22579  starts=10975
duplicate groups por (source_offset,event,tool,ts_ms)=22578
excess rows=22578
total derived rows=79272
total derived starts=37228
```

O audit raw atual, lido diretamente, possui aproximadamente `26,2k` starts na janela de 14 dias.
Logo a inflação global do índice não é interpretação: é replay cross-identity comprovado.

#### Segundo risco arquitetural encontrado

O caminho `resetRequired` é acionado quando `requestedOffset > fileBytes`; para a mesma
`source_identity`, ele executa `DELETE` das rows dessa identity antes de reingestir. O writer atual
é append-only e não implementa rotação própria, portanto isso **não é um incidente live observado**.
Mas uma truncation/copytruncate externa preservando `dev:ino` poderia apagar história derivada
legítima. A causa comum é a mesma: **identidade física do inode e geração lógica da fonte foram
fundidas num único conceito**.

#### Estado-alvo

Separar explicitamente:

```text
physicalFileIdentity = dev:ino                 # diagnóstico de backing file atual
logicalSourceGeneration = opaque bounded id   # identidade da sequência lógica de audit
cursor = logical generation + physical identity + byte offset + continuity evidence
```

Invariantes obrigatórios:

1. mudança de `dev:ino` **não** implica automaticamente nova geração lógica;
2. rebind da mesma sequência append-only mantém `logicalSourceGeneration` e continua do offset já
   certificado, sem replay do prefixo;
3. rotação/replacement realmente novo cria nova `logicalSourceGeneration`, começa em zero e
   **preserva** a geração anterior dentro da retention;
4. truncation/rewrite não pode apagar silenciosamente gerações históricas anteriores;
5. dedupe global por `(ts,event,tool,...)` não é solução primária: eventos legitimamente iguais
   podem existir; continuity precisa ser provada na boundary da fonte;
6. continuity evidence deve ser content-free no índice público. Se for necessário fingerprint de
   checkpoint, usar hash bounded de bytes já lidos/âncora de newline, nunca payload/evento cru;
7. qualquer estado ambíguo deve falhar visível ou iniciar geração nova conservadora, nunca fundir
   histories por heurística frouxa;
8. o raw JSONL permanece source of record; SQLite continua rebuildable.

#### Arquivos/owners a investigar primeiro

- `src/copilot/mcp/observability/audit/service.js` — contrato de `readSlice`, physical identity e
  continuity evidence;
- `src/copilot/mcp/diagnostics/latency/round-trip/analytics.js` — cursor, generation ownership,
  schema/migration/rebuild;
- `tests/unit/copilot/mcp/test_mcp_round_trip_analytics.spec.js` — rotation/rebind/truncation
  matrix;
- tests do audit slice owner quando o contrato de slice mudar.

#### Plano de implementação futuro

- [ ] definir `logicalSourceGeneration` e o menor continuity token suficiente;
- [ ] não reutilizar `dev:ino` como generation id;
- [ ] modelar explicitamente `same-log-rebind`, `true-rotation`, `truncate/rewrite` e
      `normal-append`;
- [ ] tornar a decisão de transition uma função/testável antes de tocar SQLite;
- [ ] elevar normalizer/index generation se necessário — candidato natural `v10`, sem reinterpretar
      rows v9 contaminadas como authority;
- [ ] criar rebuild explícito a partir do raw source após a correção;
- [ ] garantir retention por geração sem duplicação de prefixo;
- [ ] preservar cursor incremental rápido no caso normal;
- [ ] publicar diagnóstico bounded de `sourceGenerationCount`, rebind/rotation/reset counts e
      parity, sem path/content;
- [ ] não usar a correção para mudar semantics de round-trip/recovery no mesmo commit, salvo
      dependência inevitável e documentada.

#### Test matrix obrigatória

- [ ] append normal, mesma physical identity;
- [ ] mesma sequência/prefixo sob novo `dev`/mesmo inode-like id — rebind;
- [ ] mesma sequência sob `dev:ino` totalmente novo — rebind;
- [ ] true rotation com conteúdo/eventos novos — história antiga preservada;
- [ ] replacement menor que cursor — nova geração sem apagar a anterior;
- [ ] copytruncate-like same physical identity — história anterior preservada e generation nova;
- [ ] restart no meio de chunk/newline;
- [ ] crash entre event insert e cursor update — transaction invariants;
- [ ] retention cruzando duas gerações;
- [ ] idempotent repeated sync após cada cenário.

#### Promotion gate B4-0

- [ ] `duplicatePrefixReplayCount = 0` em fixture de rebind;
- [ ] true-rotation test preserva ambas as histórias;
- [ ] truncation test não apaga geração histórica;
- [ ] raw↔derived start/terminal counts batem para 24h/7d/14d dentro do mesmo cutoff e filters;
- [ ] query read-only pós-rebuild não encontra duplicate prefix groups atribuíveis a identity
      rebind;
- [ ] completeness/pairing/outcome/option/execution aggregates permanecem semanticamente iguais ao
      raw reconstruído;
- [ ] performance incremental normal não sofre regressão material;
- [ ] source/unit/static + live sync gates verdes antes de usar novamente o derived 14d como
      promotion authority.

**Regra temporária enquanto B4-0 estiver aberto:** para decisões desta frente, usar audit raw direto
ou recortes derived comprovadamente fora da identity duplicada. A janela derived de 14 dias fica
**proibida como promotion authority** até rebuild/parity.

### III-B4-1 — High-coverage static surface / progressive-discovery readiness

O MCP upstream colocou **progressive discovery** entre as prioridades de improved primitives em seu
roadmap de agosto de 2026. Isso é direção arquitetural relevante para um servidor com `131` tools,
mas ainda não autoriza inventar um protocolo dinâmico proprietário nem assumir comportamento futuro
do ChatGPT.

A infraestrutura local já oferece surfaces estáticos e reversíveis via `surface-policy.js`. O
experimento correto é explorar primeiro a fronteira **coverage × descriptor bytes** usando essa
capacidade existente.

Baseline wire corrente:

```text
full:    131 tools / 162586 B
latency:  71 tools / 107458 B   (-33,91%)
```

Candidato in-memory simples medido nesta revisão:

```text
latency + {
  mcp_reload_status,
  mcp_reload_schedule,
  mcp_tool_payload_audit,
  mcp_connection_readiness
}
= 75 tools / 111100 B
≈ -51486 B / -31,7% vs full
```

Cobertura recalculada **diretamente do raw JSONL**, não do índice contaminado, às
`2026-08-27T23:10:57Z`:

```text
24h: 1865 / 1898 = 98,26%
7d:  12600 / 12800 = 98,44%
14d: 24959 / 26256 = 95,06%   # workload antigo diferente; não é política eterna
```

A lista de quatro additions é **snapshot candidato**, não estado-alvo hardcoded. A frontier deve ser
recalculada por custo/uso: por exemplo, `mcp_smoke_workspace`, `mcp_reload_plan` e
`repo_patch_batch_plan` também aparecem cedo na fronteira conforme se exige 99%+ de coverage.

Plano:

- [ ] só iniciar após B4-0 restaurar authority ou usar raw-direct tooling explícito durante o
      experimento;
- [ ] construir Pareto frontier 98% / 99% / 99,5% sobre 24h e 7d, por cohort/workload;
- [ ] medir total envelope, input-schema bytes, list serialization e descriptor ranking de cada
      candidato;
- [ ] exigir full fallback sempre disponível e trivialmente reversível;
- [ ] não remover implementação de tool; surface policy só controla advertisement;
- [ ] testar se misses são operações de exceção/escalation ou parte de workflows normais;
- [ ] fazer A/B host-side real de tool selection/TTFT/erro antes de qualquer mudança de default;
- [ ] verificar schema refresh/admin-snapshot behavior separadamente da origem;
- [ ] acompanhar o standard/SEP de progressive discovery e preferi-lo, quando estável, a protocolo
      local incompatível.

**Gate:** nenhuma reduced surface vira default só por economizar bytes. Coverage recente ≥99% é um
pré-requisito preferencial, não suficiente; correctness/selection e fallback precisam passar A/B.

### III-B4-2 — Effective execution-policy telemetry

A telemetria atual já persiste `executionMode`, mas não registra a classe de effective concurrency.
Isso é insuficiente para decidir profiles semanticamente honestos.

Evidência raw de 24h nesta revisão:

```text
repo_apply_patch_batch completions com executionMode = 136
patch-apply:per-target-fast:fail-fast = 133
patch-dry-run:best-effort = 3
```

O padrão `per-target-fast + fail-fast` aparece em várias runtime cohorts, inclusive `51/52` calls na
maior cohort observada. Portanto os três profiles originalmente propostos não descrevem a política
dominante: best-effort `independent-progress` não é o uso mais comum e `strict-sequential` também
não, porque fail-fast com concurrency >1 significa **stop-scheduling**, não stop estritamente
sequencial.

Plano content-free:

- [ ] persistir `effectiveExecutionPolicyClass`, derivada do estado efetivamente usado, não dos args
      crus;
- [ ] incluir pelo menos apply/preflight class, failure class e concurrency class
      (`sequential|parallel-bounded`) ou enum equivalente;
- [ ] decidir se número exato de concurrency acrescenta informação suficiente para justificar o
      cardinality; preferir classe pequena;
- [ ] segmentar por runtime cohort e dry-run/apply;
- [ ] medir override rate contra defaults;
- [ ] medir combinações semanticamente distintas realmente usadas;
- [ ] não persistir targets, paths, patch strings ou argumentos livres;
- [ ] rebaseline natural antes de desenhar profile tokens.

### III-B4-3 — Semantic execution profiles — condicional, não presumida

Os nomes antigos:

```text
independent-progress
preflight-gated
strict-sequential
```

passam a ser **hipóteses históricas**, não contrato alvo. A taxonomia final deve emergir de B4-2 e
precisa representar honestamente, se material, uma classe semelhante a “direct bounded
stop-scheduling-on-failure”, hoje dominante.

Somente se B4-2 mostrar concentração suficientemente forte:

- [ ] criar poucos intent profiles estáveis que cubram a maioria do uso sem perda de semantics;
- [ ] runtime deriva mechanics (`applyMode/failureMode/concurrency`) do profile;
- [ ] advanced custom policy sobrevive apenas se houver workload real que não caiba nos profiles;
- [ ] profile + explicit override contraditório deve ser rejeitado, nunca silently overridden;
- [ ] comparar descriptor/request bytes antes/depois;
- [ ] provar parity de atomicidade, partial progress, fail-fast e preflight;
- [ ] evitar schema churn frequente; preferir token semântico estável somente quando ele realmente
      reduz custo de escolha;
- [ ] rejeitar B4-3 formalmente se a distribuição real for diversa demais ou se o wire ficar maior.

### III-B4-4 — Validator source-state binding / duplicate-work authority

A faixa transversal III-A-P já mede custo dos validator jobs, mas deixa corretamente
`duplicateValidationCount=null` porque os manifests não carregam a identidade do source state
validado.

Baseline recente:

```text
120 finished jobs
8 broad-suite runs  ≈ 1012892 ms
68 focused runs     ≈ 372094 ms
repeatRunPressure   = 113
true duplicateValidationCount = unknown
```

Owner atual: `validation/jobs/runtime.js` cria o manifest com validator, command, timestamps,
runtime epoch e resource snapshots; `validation/jobs/operations.js` se recusa corretamente a chamar
duas execuções de “duplicadas” sem source binding.

Plano:

- [ ] definir uma identidade de source state barata, content-free e apropriada ao validator;
- [ ] evitar capturar uma Source Barrier completa em cada teste focado se o custo for maior que o
      próprio validator;
- [ ] incluir pelo menos source-state fingerprint + validator + focused scope/config equivalentes na
      chave de comparação;
- [ ] não expor paths/content do worktree no dashboard público por esse mecanismo;
- [ ] distinguir rerun após mutation de duplicate sobre bytes idênticos;
- [ ] distinguir rerun necessário após failure de repetition mecânica sem source change;
- [ ] ligar polling/retry de job à identidade do próprio job antes de chamar poll de redundante;
- [ ] só então preencher `duplicateValidationCount`, duplicate wall-time e possíveis savings;
- [ ] usar os dados para ajustar V1/V2/V3 budgets, nunca para pular gate causal obrigatório.

**Resultado esperado de III-B4:** authority derivada confiável, um caminho mensurável para reduzir
surface/context cost, policy de execução observável antes de ser simplificada e validação com
contabilidade causal. Só depois faz sentido avançar agressivamente para Batch Defaults/Bulk Inspect
ou outros autonomy upgrades.

## FAIXA III-B5 — Batch Defaults

### terminal

- [ ] cwd/shell/env-policy/timeout/output defaults;
- [ ] item override;
- [ ] stdin permanece item-scoped por default.

### search/read

- [ ] common path/filter/context/hash defaults;
- [ ] typed items;
- [ ] item override semantics explícita.

### promotion

- [ ] input bytes menores;
- [ ] zero silent ignore;
- [ ] same-result correctness;
- [ ] descriptor delta aceitável.

## FAIXA III-B6 — Bulk Inspect V2 — promotion por demanda, não por catálogo

A reauditoria raw de 24h encontrou, entre os candidatos extras:

```text
repo_tree               24 starts
repo_file_outline        4
repo_symbol_search       4
repo_find_symbol_usages  2
repo_find_imports        0
repo_diff_files           0
```

Enquanto isso, `repo_bulk_inspect=42`, `repo_read_file=333` e `repo_search_text=289`. Logo a ordem
antiga `outline→tree→symbol...` não possui base empírica. **Tree é o primeiro candidato de demanda;
os demais ficam bloqueados até sequência causal/controle mostrar ganho.**

Investigar/promover por op:

- [ ] `tree` primeiro, com workload controlado `stat/search/read/tree` quando semanticamente útil;
- [ ] outline somente se novas sequências mostrarem benefício;
- [ ] symbol search somente se chamadas separadas forem materiais;
- [ ] symbol usages somente com demanda suficiente;
- [ ] imports somente com evidência nova;
- [ ] diff somente com evidência nova.

Promotion por op, nunca all-or-nothing:

- [ ] mesma redaction/path policy;
- [ ] mesma read-only authority;
- [ ] typed per-op args sem criar union descriptor desproporcional;
- [ ] budget fairness entre result shapes heterogêneos;
- [ ] per-item failure isolation;
- [ ] execution accounting;
- [ ] A/B de call count, useful bytes e correctness;
- [ ] rejeitar op cujo descriptor/context cost exceda o ganho de coalescing observado.

## FAIXA III-B7 — Terminal autonomy V5

- [ ] semantic execution policy;
- [ ] shared reclaimable output budget;
- [ ] result truncation telemetry correta;
- [ ] session-control discriminated option contract;
- [ ] wait/output/exit/cancel invariants preservados;
- [ ] não aumentar open-world authority.

## FAIXA III-B8 — Unified Mutation Batch experimental

- [ ] estudar `patch_file` dentro de ordered file batch;
- [ ] virtual-state preflight para create/move→patch;
- [ ] same exact patch engine, sem duplicar implementation;
- [ ] postValidate reuse;
- [ ] formatter allowlisted sobre touched targets, se comprovado útil;
- [ ] nenhuma generic arbitrary subtool call;
- [ ] rollback/partial semantics explícita;
- [ ] rejeitar se virtual correctness não for simples e demonstrável.

## FAIXA III-B9 — Safe hash-bound selectors

- [ ] lineRange+expectedHash threat analysis;
- [ ] file-target search A/B;
- [ ] per-matched-file hash somente se barato/confiável;
- [ ] no fuzzy mutation;
- [ ] drift deve falhar closed;
- [ ] comparar search→patch vs search→read→patch.

## FAIXA III-B10 — Git resume/autonomy

- [ ] recovery recipe para commit-succeeded/push-failed;
- [ ] current upstream/head preconditions preservadas;
- [ ] estudar adopt-exact-staged-set opt-in;
- [ ] nunca aceitar staging fora de explicit paths;
- [ ] não permitir arbitrary remote/refspec/force.

## FAIXA III-B11 — MRTR experimental

- [ ] implementar suporte SDK 2026 em branch/onda isolada;
- [ ] `requestState` integrity-protected, TTL/principal/method bound;
- [ ] provar ChatGPT auto-fulfillment;
- [ ] medir rounds e UX;
- [ ] somente casos de ambiguidade genuína;
- [ ] rollback simples: feature off;
- [ ] não vender MRTR como redução física de round trips.

## FAIXA III-B12 — Descriptor simplification — lane transversal, não etapa terminal obrigatória

A reauditoria muda a posição conceitual desta faixa. Descriptor pressure deve ser medido **durante**
B4-1/B4-3/B5/B6, não apenas depois de todos eles. O maior ganho potencial pode vir de advertisement
mais seletivo, shared defaults ou remoção de tuning sem utilidade — mecanismos diferentes que devem
ser comparados no mesmo eixo custo×cobertura.

- [ ] manter baseline `full=131 tools / 162586 B` como referência da revisão 9.1;
- [ ] medir input-schema/output-schema/meta bytes em cada candidate;
- [ ] manter Pareto frontier de coverage × envelope bytes;
- [ ] medir request-input bytes separadamente de descriptor bytes;
- [ ] remover knobs tuning somente se B4-2/B5 provarem baixa utilidade e nenhuma semantic loss;
- [ ] não confundir reduzir advertisement com remover implementação/capacidade;
- [ ] full surface continua fallback obrigatório até standard/host evidence superior;
- [ ] não usar truncation de descriptions como substituto de simplificação semântica;
- [ ] objetivo: **mais autonomia útil e coverage por byte**, não simplesmente menos bytes.

---

# 40. Experimentos, métricas e promotion gates do Roadmap III

## 40.1 EXP-III-01 — Option mistake corpus

Gerar chamadas controladas com:

- conflicting fields;
- irrelevant fields;
- empty/no-effect options;
- wrong failure/concurrency assumptions.

Medir:

```text
rejected
normalized
ignored
coerced
side effects
retry count
```

Gate: silent ignore = 0.

## 40.2 EXP-III-02 — Patch policy truth table

Cobrir todos os estados semânticos relevantes da seção 32 com targets temporários.

Gate:

- requested/effective policy coincide com contrato;
- same-file atomicity preservada;
- partial-progress reproduzível;
- fail-fast semantics não overclaim strictness.

## 40.3 EXP-III-03 — Recovery Recipe

Cenários:

- stale exact anchor recoverable;
- stale non-recoverable;
- ambiguous;
- hash mismatch;
- virtual-batch context;
- already-converged.

Gate: recipe nunca autoriza auto-retry fora da safe class.

## 40.4 EXP-III-04 — Auto-retry exact

```text
A = failure → model retry
B = same call with bounded exact self-repair
```

Medir:

- calls;
- mutations;
- hash correctness;
- false repair count;
- wall-clock.

Gate inicial: `falseRepair=0` é absoluto.

## 40.5 EXP-III-05 — Batch Defaults

Mesma workload com e sem defaults.

Medir:

- input bytes;
- descriptor bytes;
- option errors;
- result equality;
- execution policy equality.

## 40.6 EXP-III-06 — Bulk Inspect V2

Comparar sequências concretas:

```text
search + outline + read
search + symbol + read
stat + read + outline
```

contra um heterogeneous batch.

Gate: menor MCP call count com mesmo conteúdo útil e budget controlado.

## 40.7 EXP-III-07 — Terminal shared budget

Workload com um comando chatty e vários quiet.

Gate:

- menor truncation;
- mesmo hard aggregate budget;
- memória dentro do baseline/headroom;
- sem starvation de failure metadata.

## 40.8 EXP-III-08 — Safe range selector

Gate absoluto:

- hash mismatch nunca escreve;
- range errado sob hash correto é totalmente determinístico/previewable;
- resultado idêntico ao equivalente exact operation definido no experimento.

## 40.9 EXP-III-09 — MRTR host support

Somente depois de suporte local:

- client SDK controlado;
- remote MCP;
- ChatGPT real após Refresh.

Medir:

- host support;
- rounds;
- cancel/decline;
- requestState expiry/tamper;
- tool switching evitado.

## 40.10 EXP-III-10 — Audit source rebind / rotation / truncation

Objetivo: provar B4-0 antes de reconstruir o índice real.

Casos controlados mínimos:

```text
A. append normal, mesma identity física
B. mesmo log/prefixo sob identity física diferente
C. true rotation com arquivo/eventos novos
D. replacement menor que cursor
E. copytruncate-like mantendo identity física
F. crash/restart entre insert e cursor commit
```

Medir:

- logical generation id;
- start offset efetivo;
- rows inseridas por sync;
- prefix replay count;
- history preserved count;
- raw↔derived count parity;
- idempotence em segundo sync;
- sync duration/catch-up throughput.

Gates absolutos:

- rebind não duplica prefixo;
- rotação real não apaga história anterior dentro da retention;
- truncation não reutiliza generation incorreta;
- repeated sync sem novos bytes insere zero rows;
- raw source continua a authority de rebuild.

## 40.11 EXP-III-11 — Static surface Pareto frontier

Comparar pelo menos:

```text
full
latency atual
candidate ≥98%
candidate ≥99%
candidate ≥99,5% quando alcançável sem custo desproporcional
```

Usar 24h e 7d por workload/cohort, preferencialmente raw-direct enquanto B4-0 estiver aberto.

Medir:

- tools advertised;
- envelope/input-schema bytes;
- list serialization;
- observed-call coverage;
- top missing tools e papel no workflow;
- host TTFT/selection error quando houver A/B real;
- fallback/recovery para tool não advertised.

Gate: nenhuma candidate vira default sem A/B host-side e full fallback. Um número de coverage
isolado não é suficiente.

## 40.12 EXP-III-12 — Effective patch execution-policy census

Após instrumentar B4-2:

- coletar distribuição por cohort de apply/preflight/failure/concurrency class;
- separar defaults de caller overrides;
- calcular quantas classes cobrem 90/95/99% do uso;
- reconstruir truth table observada;
- comparar descriptor/request cost de knobs atuais contra profile candidate.

Gate: profile só existe se comprimir escolha/bytes **sem** eliminar policy material. Se a
distribuição não for concentrada, B4-3 é rejeitada.

## 40.13 EXP-III-13 — Validator duplicate-work authority

Depois de B4-4:

```text
same validator + same scope + same source-state fingerprint + equivalent config
```

é candidato a duplicate; qualquer source/config change quebra equivalência.

Medir:

- duplicate jobs;
- duplicate wall time;
- broad vs focused duplication;
- poll/retry por job id;
- mutation-between-runs rate;
- custo de calcular a fingerprint.

Gate: source binding precisa custar pouco frente aos focused validators e não pode expor conteúdo ou
transformar repetição necessária após mutation em “waste”.

---

# 41. Definition of Done do Roadmap III

Roadmap III só poderá ser declarado concluído quando:

- [x] hot-tool options cobertas por III-A tiverem semântica declarada/derivável no Option Contract;
- [x] silent ignored options = 0 nos contratos alvo de III-A;
- [x] option/result code telemetry estiver historicamente observável nas gerações instrumentadas;
- [x] continuation availability não for confundida com required follow-up;
- [x] pairwise + critical option matrix de III-A estiver verde;
- [x] self-repair B2 estiver restrita a equivalência determinística provada;
- [x] patch exactness/hash/path policy de B1–B3 permanecerem intactos;
- [ ] **derived-index logical source generation estiver correta sob rebind/rotation/truncation**;
- [ ] **raw↔derived parity estiver provada após rebuild e duplicate prefix replay = 0**;
- [ ] nenhuma decisão de janela longa depender de identity-contaminated analytics;
- [ ] concurrency semantics forem historicamente observáveis em classe suficiente para decidir
      semantic profiles;
- [ ] semantic profiles, se implementados, forem derivados da distribuição real — ou formalmente
      rejeitados se não reduzirem custo sem perda de policy;
- [ ] qualquer reduced/default surface passar coverage + host-side selection/TTFT A/B e preservar
      full fallback; acompanhar progressive discovery upstream sem protocolo proprietário prematuro;
- [ ] validator duplicate-work metrics tiverem source-state binding antes de afirmar desperdício;
- [ ] pelo menos um novo autonomy/wire upgrade pós-B3 demonstrar redução real de calls, input ou
      context pressure **ou** ser formalmente rejeitado/depriorizado por evidência;
- [ ] Bulk Inspect V2 continuar promotion-per-op e não ampliar catálogo sem demanda/experimento;
- [ ] nenhuma expansão criar generic cross-authority tool-of-tools;
- [ ] descriptor pressure permanecer abaixo dos budgets com headroom e coverage explícita;
- [ ] resource health permanecer saudável;
- [ ] ChatGPT refresh/schema behavior estiver documentado e testado quando relevante, separado da
      verdade do origin;
- [ ] documento estiver atualizado na mesma rodada das implementações;
- [ ] repo final estiver publicado, limpo e `main == origin/main`.

**Estado da revisão 9.1:** DoD III permanece aberto. III-A e III-B1–B3 estão encerrados; o primeiro
checkbox bloqueante é a integridade de source generation do derived index em III-B4-0.

---

# 42. Conclusão histórica da revisão 7.1

A conclusão desta nova auditoria é deliberadamente diferente de “criar mais tools”.

O MCP já possui poder suficiente para operações extensas. O gargalo emergente é **fazer esse poder
ser fácil de exercer corretamente**. Hoje existem três fontes principais de round trip evitável ou
de liberdade aparente:

1. a tool aceita uma combinação que não faz o que o caller imagina;
2. a tool detecta corretamente o failure, mas deixa o caller reconstruir manualmente a recovery;
3. operações do mesmo domínio ainda estão fragmentadas em calls separadas apesar de poderem caber em
   uma gramática bounded comum.

O Roadmap III começa, portanto, por uma fase de correctness de opções e observabilidade. Só depois
expande autonomia.

A direção ideal é:

```text
menos knobs mecânicos
+ mais intents semânticos
+ batch defaults explícitos
+ domain micro-orchestration
+ recovery machine-readable
+ exact bounded self-repair
+ nenhuma fuzzy mutation
+ nenhuma autoridade genérica escondida
```

O upgrade mais promissor é fazer `repo_apply_patch_batch` evoluir de uma lista plana de operações
com semântica parcialmente inferida para uma interface target-aware, recovery-aware e
policy-explicit. Em paralelo, read/search/terminal devem remover silent option traps e ganhar
defaults/budgets mais inteligentes; `repo_bulk_inspect` é o candidato natural a concentrar novas
capacidades read-only.

MRTR é relevante como tecnologia MCP 2026 para ambiguidade genuína, mas não é prioridade até a
interface local estar semanticamente correta e o suporte ChatGPT ser comprovado.

A primeira fundação dessa direção já foi implementada nesta revisão: **III-A0 Option Outcome
Telemetry** está source/unit/static green e aguarda comprovação no runtime promovido. A escolha foi
intencionalmente conservadora: antes de corrigir option traps ou adicionar autonomia, o sistema
passa a registrar por completion apenas `resultCode/resultState/resultClass` bounded e content-free,
separando erros de configuração, preconditions e failures ainda não classificados sem inventar
causalidade.

O estado corrente já avançou além desse checkpoint histórico: **III-A0–III-A5 estão concluídos no
escopo aplicável desta revisão**, incluindo outcome/option telemetry live, Option Contract `1.5.0`
fail-closed, continuation semantics v7 rebaselined, matriz combinatória bounded, Source Barrier v2 e
schema parity remota `131/131`. O único experimento não artificialmente executado é o comportamento
do snapshot administrativo do ChatGPT diante de uma **mudança wire futura**; ele permanece
condicionado à primeira alteração real de schema, porque o origin não pode observá-lo nem esta
revisão deve criar churn apenas para testá-lo. O Gate III-A→III-B está aberto; III-B ainda não foi
iniciado.

---

# 43. Reauditoria pós-III-B3 e ordem normativa da revisão 9.1

> **Autoridade:** esta seção é o overlay normativo corrente. A seção 42 é preservada como conclusão
> histórica da revisão 7.1 e não descreve mais o estado atual. Em caso de conflito entre texto
> histórico e esta seção, prevalece esta seção junto com os checkboxes atualizados da seção 39.

## 43.1 Checkpoint de entrada e escopo efetivamente executado

A investigação começou depois do fechamento técnico completo de III-B3:

```text
technical checkpoint = 4aec813148b5cc8fd5586733b47cef808fe5245d
branch = main
upstream = origin/main
ahead/behind no checkpoint = 0/0
worktree = clean antes da reauditoria documental
```

Depois desse checkpoint:

- o documento foi lido integralmente uma primeira vez e atualizado para a revisão 9.0;
- a versão física resultante foi **releita integralmente novamente, 5.404/5.404 linhas**, antes
  desta revisão 9.1;
- nenhum arquivo de produção, teste ou configuração foi transformado;
- não houve reload/restart/reconnect;
- toda nova evidência operacional foi obtida por leitura do raw audit, SQLite read-only, source
  inspection ou diagnostics read-only/in-memory;
- a única mutação desta fase é este documento, a ser publicado no fechamento.

## 43.2 Descoberta principal: o próximo problema é authority integrity, não profiles

A prioridade imediatamente posterior a B3 mudou. A razão é RT-III-001/011:

```text
physical file identity != logical audit source generation
```

Hoje `dev:ino` é usado nas duas funções. No incidente real, o mesmo prefixo append-only reapareceu
sob novo `dev` e foi reingestado desde zero, enquanto a história da identity anterior foi mantida. O
SQLite derivado contém:

```text
2096:178412  = 22579 rows / 10975 starts
2128:178412  = 56693 rows / 26253 starts
excess duplicate-prefix rows = 22578
total derived = 79272 rows / 37228 starts
```

O raw JSONL direto continua íntegro como source of record. Consequentemente:

1. não corrigir analytics por dedupe temporal global;
2. não apagar old identity indiscriminadamente;
3. introduzir geração lógica explícita e continuity semantics;
4. reconstruir o índice a partir do raw após o fix;
5. provar parity antes de voltar a usar 14d como promotion authority.

A janela antiga de identity duplicada termina em 19/08, portanto recortes atuais de 24h/7d podem ser
usados quando o cutoff é comprovado; ainda assim a política preferida para esta reauditoria foi
recalcular decisões críticas diretamente do raw.

## 43.3 Rebaseline raw corrente e implicações para tool surface

O surface completo continua saudável e com amplo headroom:

```text
full = 131 tools / 162586 B
max envelope budget = 409600 B
headroom = 247014 B
```

O `latency` estático atual mede `71 tools / 107458 B`, mas não possui coverage suficiente para virar
default sem additions. Um candidate simples, construído **somente in-memory**, adiciona:

```text
mcp_reload_status
mcp_reload_schedule
mcp_tool_payload_audit
mcp_connection_readiness
```

e resulta em:

```text
75 tools / 111100 B
≈ 31,7% menor que full
```

Coverage raw-direct no snapshot `2026-08-27T23:10:57Z`:

```text
24h = 1865/1898 = 98,26%
7d  = 12600/12800 = 98,44%
14d = 24959/26256 = 95,06%
```

A queda em 14d mostra por que **surface não pode ser uma lista eterna inferida de um workload
antigo**. O desenho correto é uma frontier custo×coverage por workload/cohort. A análise marginal
mostrou que `mcp_smoke_workspace`, `mcp_reload_plan` e `repo_patch_batch_plan` são additions
naturais conforme o gate sobe de 98% para 99%+, mas o ponto ótimo deve ser decidido por A/B, não
pelo ranking isolado.

Decisão corrente:

- `full` permanece default;
- B4-1 investiga static high-coverage surface porque já é reversível e compatível com a arquitetura;
- nenhuma dynamic/proprietary discovery layer será criada agora;
- o trabalho upstream de progressive discovery deve ser acompanhado e adotado quando houver
  standard/SDK/host support suficientemente estável.

## 43.4 Execution policy: a taxonomia antiga foi falsificada pela própria telemetria

O plano antigo sugeria:

```text
independent-progress
preflight-gated
strict-sequential
```

Mas o raw audit recente mostra:

```text
136 patch-batch completions observáveis com executionMode
133 = patch-apply:per-target-fast:fail-fast
3   = patch-dry-run:best-effort
```

Esse padrão aparece em múltiplas source/runtime cohorts; na maior, `51/52` completions observáveis
seguem `per-target-fast + fail-fast`.

Isso importa porque:

- `independent-progress` sugere best-effort e não descreve o uso dominante;
- `strict-sequential` exige concurrency=1 e também não descreve necessariamente o uso dominante;
- `fail-fast + concurrency>1` é **stop-scheduling**, não transação ou stop sequencial perfeito;
- `executionMode` ainda não persiste a classe de concurrency, portanto a policy efetiva não pode ser
  reconstruída completamente.

Decisão: B4-2 instrumenta a classe efetiva primeiro. B4-3 somente cria profiles se a distribuição
mostrar compressão real de intent; os três nomes antigos deixam de ser specification target.

## 43.5 Validation productivity: repetir validator ainda não significa duplicação

A última amostra de manifests mostra:

```text
finished jobs = 120
broad runs = 8 / ~1012892 ms
focused runs = 68 / ~372094 ms
repeatRunPressure = 113
duplicateValidationCount = null
```

O `null` é correto. O owner de job não persiste source-state identity; portanto duas execuções do
mesmo validator podem ter validado bytes diferentes. Chamar isso de duplicate hoje seria o mesmo
erro epistemológico que chamar temporal adjacency de causalidade.

B4-4 deve anexar uma identidade barata/content-free do source state ao manifest e só então medir
true duplicate work. A solução não deve usar uma Source Barrier completa por focused test se o
próprio fingerprint custar mais que a validação curta.

## 43.6 Ordem normativa dos próximos passos

A ordem recomendada a partir desta revisão é:

### 1. III-B4-0 — P0: source-generation integrity

Implementar primeiro e isoladamente. Fechar rebind/rotation/truncation semantics, rebuild v10 ou
equivalente, raw↔derived parity e performance incremental. **Nenhuma otimização guiada por janela
longa deve pular esse gate.**

### 2. III-B4-1 — static high-coverage surface / progressive-discovery readiness

Com analytics íntegro — ou raw-direct explicitamente controlado — construir Pareto frontier 98/99/
99,5%, medir descriptor cost e fazer A/B host-side. `full` continua fallback e default até prova.

### 3. III-B4-2 — effective execution-policy telemetry

Persistir classe efetiva de apply/preflight/failure/concurrency, content-free, e medir distribuição
natural por cohort.

### 4. III-B4-3 — semantic profiles somente se B4-2 justificar

Não iniciar com enum pronto. Desenhar profiles a partir da distribuição observada, provar parity de
partial progress/atomicity/fail-fast/preflight e rejeitar a faixa se o ganho líquido não existir.

### 5. III-B4-4 — validator source-state binding

Fechar true duplicate-work authority e refinar V1/V2/V3 validation budgets com dados causais.

### 6. III-B5 — Batch Defaults / wire ergonomics

Investigar shared defaults principalmente onde reduzem request bytes repetidos. Mechanical tuning
deve tender a runtime-owned; semantic policy só sai do wire quando houver evidência de desuso.

### 7. III-B6 — Bulk Inspect V2 por op

`tree` é o primeiro candidato de demanda. Outline/symbol/usages ficam subordinados a experimento;
imports/diff não possuem demanda recente que justifique expansão hoje.

### 8. III-B7+ — demais autonomy upgrades

Terminal shared budget, Unified Mutation Batch, safe selectors, Git resume e MRTR permanecem
candidatos independentes. Cada um exige investigação própria e pode ser rejeitado. B12 descriptor
economics acompanha transversalmente B4–B7.

## 43.7 O que foi explicitamente rejeitado ou adiado por esta investigação

Não fazer na próxima rodada:

- não corrigir B4-0 com `DELETE old source_identity` em toda mudança de inode/device;
- não usar global row dedupe como substituto de source-generation semantics;
- não tratar derived 14d atual como authority;
- não implementar os três semantic profiles antigos por inércia documental;
- não tornar o candidate 75-tool default sem host A/B;
- não inventar progressive discovery proprietário antes do standard;
- não expandir Bulk Inspect para todas as read-only operations “porque cabem”;
- não chamar `repeatRunPressure` de duplicate validator work;
- não elevar caps/budgets — saturation/truncation continuam sem evidência material que justifique;
- não reintroduzir V2 patch compatibility para acomodar snapshot administrativo ChatGPT stale;
- não misturar em B4-0 refactors/otimizações independentes que dificultem provar a correção da
  authority.

## 43.8 Handoff operacional para a próxima rodada

Quem assumir a próxima implementação sem contexto prévio deve começar assim:

1. ler a revisão 9.1, principalmente 16.4, 39/B4-0 e esta seção 43;
2. confirmar Git clean/synced e reproduzir o P0 em SQLite **read-only** antes de mutar source;
3. ler integralmente `observability/audit/service.js`, `round-trip/analytics.js` e os testes de
   rotation/cursor;
4. desenhar primeiro a state machine `append|rebind|rotation|truncate/rewrite` e seus invariants;
5. escrever os testes que hoje faltam, inclusive same-content rebind e copytruncate-like;
6. só então alterar o cursor/schema/ingestion;
7. manter raw JSONL como authority e preparar rebuild explícito;
8. validar em gate causal focado, depois static/architecture conforme boundary tocada;
9. fazer um único broad/promotion gate sobre bytes estáveis quando a candidate estiver pronta;
10. atualizar este MD **na mesma rodada**, com before/after raw↔derived e decisão sobre B4-1.

O próximo objetivo não é “reduzir mais calls” em abstrato. É restaurar primeiro a propriedade que
permite saber se qualquer redução posterior é real:

> **uma fonte lógica de audit deve ser ingerida exatamente uma vez, independentemente de como o
> filesystem a reexpõe fisicamente; uma geração realmente nova deve permanecer distinguível e
> preservada.**

---

# 44. Revisão 9.2 — reentrada operacional e implementação III-B4-0

## 44.1 Escopo da reauditoria e contexto reconstruído

Esta revisão não parte do resumo da sessão anterior. Foram relidos integralmente, nesta rodada:

- este documento canônico, **6.136 linhas / 283.386 B**, SHA-256 de entrada
  `9245c72d8da72d917f3801505a6b8adf34057ef9815e389abed95b682cf94c6a`;
- `src/copilot/mcp/observability/audit/service.js`, **651 linhas**;
- `src/copilot/mcp/diagnostics/latency/round-trip/analytics.js`, **673 linhas**;
- `src/copilot/mcp/diagnostics/latency/round-trip/normalizer.js`, **207 linhas**;
- `tests/unit/copilot/mcp/test_mcp_round_trip_analytics.spec.js`, **1.317 linhas**;
- o fresh range snapshot de Application Infra e os consumidores/composition boundaries da capability
  de analytics.

A branch continua `main == origin/main` no commit `e1af41704`, mas o worktree contém a implementação
suplementar W1–W8 ainda não publicada e uma **W9 parcial não certificada**. A W9 havia removido os
três Git plan definitions de `git-write.js` antes de migrar semantic contracts/guidance/tests. O
resultado foi reproduzido diretamente no registry source-side:

```text
MCP semantic contract coverage mismatch:
missing=none
stale=git_stage_plan,git_commit_plan,git_push_plan
```

O strict typecheck isolado permanecia verde, provando que este é um invariant runtime/catalog e não
um erro de tipos. A ordem operacional desta revisão é, portanto:

1. restaurar **somente** a transação W9 incompleta para o boundary W8 certificado;
2. manter todo W1–W8 intacto;
3. executar III-B4-0 isoladamente como P0, conforme já determinado pela revisão 9.1;
4. só retomar SUP-4/W9 depois de a authority derivada estar corrigida e certificada.

Isso não rebaixa o roadmap suplementar: apenas impede que uma alteração independente e ainda
inconsistente contamine a prova causal de B4-0.

## 44.2 Reprodução atual do P0 — 2026-08-28

A reprodução read-only atual confirmou e ampliou o diagnóstico da revisão 9.1.

### Backing JSONL atual

```text
path = src/copilot/.ai/audit/mcp-tool-calls.jsonl
size = ~40,46 MB
dev:ino = 2128:178412
raw lines = 109.350
```

Sob cutoffs calculados na mesma rodada:

| janela | raw audit rows | raw `tool_call_started` | raw eventos indexáveis v9 |
| -----: | -------------: | ----------------------: | ------------------------: |
|     1d |         10.043 |                   2.181 |                     5.368 |
|     7d |         41.466 |                  12.786 |                    28.952 |
|    14d |         75.733 |              **26.829** |                **58.248** |

### Derived SQLite atual — ainda v9 e não confiável em 14d

```text
source_identity=2128:178412  rows=58.245  starts=26.827
source_identity=2096:178412  rows=22.579  starts=10.975
TOTAL                         rows=80.824  starts=37.802
```

A join por `(source_offset,event,tool,ts_ms)` encontrou **22.578 duplicate-prefix rows** entre as
duas physical identities. O cursor `mcp-audit:v9` estava em `2128:178412`, offset ~40,45 MB.

Com cutoff SQLite próprio no mesmo instante:

| janela | derived rows | derived starts | leitura                                           |
| -----: | -----------: | -------------: | ------------------------------------------------- |
|     1d |        5.366 |          2.180 | paridade efetiva; diferença transitória de cursor |
|     7d |       28.950 |         12.785 | paridade efetiva; diferença transitória de cursor |
|    14d |   **80.825** |     **37.803** | contaminado pelo prefixo histórico duplicado      |

A diferença 14d de starts é praticamente a geração antiga inteira. Isso confirma que o defeito não é
agregação estatística: é **identity/ingestion authority**.

## 44.3 Causa raiz confirmada no source

O source v9 usa `dev:ino` para duas funções que precisam ser distintas:

1. **physical backing identity** — detectar que o path passou a apontar para outro inode/device;
2. **logical source generation** — namespace de unicidade dos offsets ingeridos.

Quando o cursor possui identity A e `readSlice(offset)` devolve identity B, o `sync()` atual
executa:

```text
offset = 0
expectedIdentity = B
continue
```

mas mantém as rows de A. O mesmo prefixo reaparece então como `(B, source_offset)`, formando uma
segunda história lógica para os mesmos bytes.

O segundo ramo é igualmente perigoso: quando `resetRequired` ocorre sob a mesma physical identity, o
código faz `DELETE FROM events WHERE source_identity = currentIdentity`. Isso trata truncation/
copytruncate como autorização para apagar toda a história daquela geração.

O writer atual é append-only, mas o reader/index precisa continuar correto mesmo sob rebind,
replacement, restore, copytruncate ou filesystem remount. A correção não pode depender do
comportamento feliz do writer atual.

## 44.4 Invariants normativos B4-0

A implementação v10 deve obedecer simultaneamente aos seguintes invariants:

1. **JSONL é source of record; SQLite continua inteiramente rebuildable.**
2. `physicalFileIdentity` e `sourceGeneration` são conceitos e campos distintos.
3. um physical rebind só cria nova geração quando a continuidade de bytes não pode ser provada.
4. o caminho comum mantém um **boundary anchor** content-free: SHA-256 domain-separated de no máximo
   os últimos **4 KiB** imediatamente anteriores ao offset certificado. Esse anchor prova o
   boundary, **não o prefixo inteiro**.
5. paralelamente, o cursor mantém um SHA-256 **record hash-chain** content-free de todos os records
   JSONL newline-committed até o offset. O chain é atualizado incrementalmente no caminho comum.
6. se `dev:ino` mudar e o boundary anchor continuar igual, `rebind` só pode ser aceito após um
   **full-prefix proof** raro: recomputar o hash-chain de `[0,cursorOffset]` em um snapshot físico
   consistente e provar igualdade com o chain persistido. Boundary igual sem full-prefix equality é
   `new-generation:replacement`, não rebind.
7. os tokens incluem versão/domain/boundary ou record offsets/bytes conforme o primitive e nunca são
   devolvidos como conteúdo bruto ao caller; outputs públicos expõem apenas presença/versão.
8. file size < cursor offset => nova geração lógica; história antiga permanece.
9. boundary anchor divergente => nova geração lógica, seja o `dev:ino` igual ou diferente; história
   antiga permanece. Em physical rebind com boundary igual, o full-prefix chain decide.
10. physical identity igual **não** autoriza confiar no boundary: o anchor continua protegendo
    copytruncate/rewrite+regrow próximo ao cursor. O writer authority permanece append-only; provar
    arbitrariamente todo o prefixo sob o mesmo inode em todo append exigiria O(n) por sync e não é o
    contrato desta faixa.
11. source temporariamente ausente não deve destruir/avançar cursor existente.
12. nenhuma mudança de generation pode depender de global row dedupe.
13. insert de eventos + avanço do cursor/generation permanece uma transação SQLite única.
14. crash antes da transação pode repetir leitura, mas não pode duplicar rows; crash depois da
    transação deve retomar do novo cursor.
15. retention permanece temporal e cross-generation; nunca é usada como mecanismo de reset.
16. ambiguity/race entre range snapshots deve falhar de forma visível/conservadora, nunca ingerir
    bytes sob lineage não comprovada.

## 44.5 State machine fechada antes do código

| estado do cursor/source      | evidência atual                                                | decisão                               | efeito no histórico                           |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| sem cursor, arquivo presente | qualquer                                                       | `bootstrap g1 @ 0`                    | inicia geração                                |
| sem cursor, arquivo ausente  | n/a                                                            | `source-absent`                       | nenhuma mutação                               |
| cursor @ 0                   | arquivo presente                                               | mesma geração; physical pode rebinder | nenhuma reingestão                            |
| cursor > 0                   | `size >= offset` e anchor igual                                | `append/idle`                         | continua do offset                            |
| cursor > 0 + physical mudou  | `size >= offset`, boundary igual **e full-prefix chain igual** | `rebind`                              | **mesma geração**, atualiza physical identity |
| cursor > 0                   | `size < offset`                                                | `new-generation:truncated`            | preserva geração anterior; nova @ 0           |
| cursor > 0 + physical igual  | anchor divergente                                              | `new-generation:rewrite`              | preserva geração anterior; nova @ 0           |
| cursor > 0 + physical mudou  | boundary divergente **ou full-prefix chain divergente**        | `new-generation:replacement`          | preserva geração anterior; nova @ 0           |
| qualquer                     | source ausente                                                 | `source-absent`                       | cursor anterior intacto                       |
| qualquer                     | snapshot/boundary/prefix-proof race                            | `fail-visible`                        | nenhum ingest/cursor advance                  |

“True rotation” não precisa ser inferida de `dev:ino` por si. Se o novo backing contém exatamente o
mesmo prefixo certificado, ele é semanticamente a mesma fonte lógica para fins de ingestão; se não
contém, nasce nova geração. Isso é mais forte e mais portátil que tentar adivinhar a intenção do
filesystem.

## 44.6 Contrato do audit slice v10

`readSlice` deixa de decidir reset policy. Seu papel passa a ser somente fornecer uma observação
física consistente e bounded:

- `physicalFileIdentity`;
- `fileBytes`;
- `requestedOffset`, `startOffset`, `nextOffset`;
- `offsetPastEnd` em vez de reler silenciosamente offset zero;
- entries **somente newline-committed**; trailing partial line nunca avança cursor;
- `eventLimitReached` corta o byte cursor exatamente após o último event devolvido, sem skip;
- `continuityAtStart` / `continuityAtNext` como boundary anchors SHA-256;
- `sequenceAtStart` / `sequenceAtNext` como SHA-256 record chain incremental;
- `readPrefixProof({offset})` como caminho raro O(prefix) usado exclusivamente para certificar
  physical rebind quando o boundary local sozinho não prova o prefixo completo;
- nenhuma linha/raw payload dentro da continuity/sequence metadata; cursor público mostra apenas
  `tokenPresent`.

Para não criar race nova, boundary prefix + chunk + next boundary pertencem ao **mesmo range
snapshot**. No rebind, o prefix proof usa outro snapshot fisicamente consistente e sua
`physicalFileIdentity` deve ser idêntica à do slice observado; disagreement falha fechado em vez de
classificar lineage. Um record sem newline é pendente, não inválido/consumido. Um record maior que o
slice budget sem newline falha visivelmente (`EAUDITRECORDTOOLARGE`) em vez de produzir
zero-progress loop.

## 44.7 Estratégia de schema/rebuild v10

A revisão 9.2 rejeita reinterpretar as rows v9 contaminadas. O plano é:

- bump `MCP_ROUND_TRIP_NORMALIZER_VERSION` para **10**;
- introduzir metadata própria de schema do derived index; não usar `PRAGMA user_version` porque o
  SQLite é compartilhado por outros owners;
- ao primeiro owner mutável v10, reconstruir explicitamente as tabelas **derivadas** de round-trip;
  isso é permitido porque o JSONL permanece authority;
- o read-only snapshot deve reconhecer v9/metadata ausente como `rebuild-required` e **não**
  publicar a janela contaminada durante a transição;
- event rows v10 usam `source_generation + source_offset` como chave lógica e carregam
  `physical_file_identity` apenas como evidence diagnóstica;
- cursor v10 persiste geração lógica, sequence, physical identity atual, byte offset, file bytes,
  continuity token/window e counters bounded de rebind/new-generation;
- nenhuma tabela externa ao owner round-trip conhece hoje esses nomes; a busca source-wide confirmou
  que a migração está encapsulada em `analytics.js` + testes.

A troca de schema deve ser transacional. Não haverá compat shim de leitura v9: ou a derived index
está materializada como v10, ou o snapshot read-only informa indisponibilidade/rebuild requerido.

## 44.8 Test matrix causal — obrigatória antes da implementação principal

- [x] append normal, mesma physical identity e anchor contínuo;
- [x] idle/EOF repetido é idempotente;
- [x] mesmo conteúdo/prefixo sob novo `dev` e inode equivalente => **rebind sem replay**;
- [x] mesmo conteúdo/prefixo sob `dev:ino` totalmente diferente => **rebind sem replay**;
- [x] physical identity nova com prefixo divergente => nova geração, ambas preservadas;
- [x] replacement menor que cursor => nova geração, ambas preservadas;
- [x] copytruncate-like na mesma physical identity => nova geração, história anterior preservada;
- [x] rewrite+regrow acima do cursor com anchor divergente => nova geração;
- [x] restart em boundary de chunk/newline não perde nem duplica evento;
- [x] crash lógico entre rows e cursor é coberto pela transação única;
- [x] retention elimina somente por `ts_ms`, inclusive cross-generation;
- [x] source ausente preserva cursor e não inventa geração;
- [x] race cross-snapshot falha sem ingest;
- [x] repeated sync após rebind/rotation é idempotente;
- [x] read-only snapshot v9/sem meta não publica analytics contaminado.
- [x] physical rebind com **mesmos últimos 4 KiB mas byte antigo divergente** não é aceito como
      rebind;
- [x] `maxEvents` não avança o cursor além do último event realmente devolvido;
- [x] trailing JSONL sem newline permanece pendente e é consumido somente após commit por `\n`;
- [x] matching schema com normalizer generation stale é `rebuild-required`;
- [x] index parcialmente reconstruído é `materializing/catch-up-required`, nunca authority
      publicável;

## 44.9 Plano executável III-B4-0 — revisão 9.2

### Fase A — restaurar boundary certificado e congelar unrelated work

- [x] reverter somente a meia-W9 de `git-write.js` ao estado W8;
- [x] provar registry novamente construível em 89 tools e semantic coverage exata;
- [x] não prosseguir SUP-4/W9 durante B4-0.

### Fase B — continuity contract do raw reader

- [x] adicionar continuity anchor bounded/domain-separated ao audit slice;
- [x] separar `physicalFileIdentity` de qualquer conceito lógico;
- [x] remover reset-to-zero policy do reader; expor `offsetPastEnd`;
- [x] adicionar testes reais do audit capability para anchor, append, rebind e race-safe behavior.

### Fase C — derived index v10

- [x] bump normalizer/index generation para v10;
- [x] introduzir schema metadata próprio;
- [x] substituir `source_identity` por `source_generation` + `physical_file_identity` no schema v10;
- [x] implementar cursor v10 com continuity proof e generation counters;
- [x] implementar state machine da seção 44.5;
- [x] eliminar `DELETE source_identity` como reset mechanism;
- [x] manter rows + cursor atomicamente transacionais;
- [x] tornar snapshot read-only fail-closed para schema anterior.

### Fase D — causal/unit/static gates

- [x] fechar integralmente a matrix 44.8;
- [x] focused `test_mcp_audit` + `test_mcp_round_trip_analytics`;
- [x] strict typecheck;
- [ ] lint changed;
- [ ] architecture contract se boundary/import mudar;
- [x] `git diff --check`.

### Fase E — rebuild real isolado e raw↔derived authority gate

Para não mutar o SQLite live enquanto o MCP v9 conectado ainda pode executar seu monitor:

- [x] criar SQLite temporário isolado;
- [x] usar o **JSONL real atual** através do owner v10 para catch-up completo;
- [x] comparar raw vs derived sob o mesmo `now`, cutoff e filtro para 1d/7d/14d;
- [x] `duplicatePrefixReplayCount == 0`;
- [x] provar rebind testado sem replay e true new-generation preservando duas histórias;
- [x] medir bytes/chunks/duração do catch-up e do incremental EOF para regressão de performance.

### Fase F — broad source certification

- [x] `mcp-fast` sobre source estável;
- [x] `mcp-full` sobre os mesmos bytes;
- [x] registrar fingerprints/contagens finais relevantes;
- [x] atualizar esta seção com before/after real e decisão explícita sobre B4-1;
- [ ] somente depois preparar rollout/reload live de v10 e a acceptance runtime correspondente.

## 44.10 Critérios objetivos de fechamento B4-0

B4-0 **não** é concluída apenas porque os testes passam. O gate source exige:

1. nenhuma replay duplication em rebind causal;
2. duas gerações preservadas em replacement/rotation causal;
3. truncation/rewrite sem `DELETE` histórico;
4. snapshot fail-closed enquanto schema antigo não foi reconstruído;
5. JSONL real -> SQLite temporário v10 com paridade de starts/eventos indexáveis sob cutoffs iguais;
6. repeated catch-up idempotente;
7. custo incremental bounded e sem regressão material;
8. broad suite verde sobre bytes congelados.

O **gate live** permanece separado: o database conectado hoje continua v9 até restart/promotion. Ele
só volta a ser authority para janela longa após o runtime v10 materializar o novo index e repetir o
gate de paridade no processo promovido.

## 44.11 Checkpoint de implementação 9.3 — candidate pré-broad

### 44.11.1 Bugs/gaps adicionais encontrados e corrigidos durante B4-0

A implementação test-first expôs problemas que não estavam todos explícitos na revisão 9.2. Eles
foram corrigidos na mesma faixa porque afetam diretamente integridade ou publicabilidade da derived
authority:

1. **cross-inode prefix replay P0** — corrigido pela separação physical identity / logical
   generation;
2. **boundary anchor de 4 KiB era insuficiente como prova do prefixo inteiro** — reclassificado como
   boundary anchor; physical rebind agora exige full-prefix SHA-256 record chain;
3. **`maxEvents` podia causar data loss** — o reader devolvia só N eventos, mas avançava
   `nextOffset` por todo o chunk; agora byte cursor para exatamente após o último event devolvido;
4. **trailing partial JSONL podia ser consumido cedo demais** — newline virou commit marker
   explícito; fragmento sem `\n` permanece pendente sem contar como invalid line;
5. **record > slice sem newline podia criar zero-progress** — agora falha visivelmente com
   `EAUDITRECORDTOOLARGE`;
6. **schema v10 parcialmente materializado podia ser publicado** — monitor usa 1 chunk/ciclo;
   snapshots agora ficam `materializing/catch-up-required` até `byteOffset >= fileBytes`;
7. **generation validity considerava só schema version** — agora exige `schema_version` **e**
   `normalizer_version`;
8. **race no rebuild metadata check** — o check de generation é repetido dentro da write
   transaction, impedindo segundo processo de derrubar um v10 recém-reconstruído;
9. **shape do snapshot unavailable estava duplicado e incompleto** — agora deriva do summarizer
   canônico, incluindo `recoveryRecipes`, `exactSelfRepair`, `optionPolicies` e futuros campos;
10. **sync failure shape era parcial** — success/failure agora compartilham a estrutura de lineage,
    materialization e proof counters;
11. **full-prefix proof não tinha telemetry** — monitor/runtime-health retêm proof count/bytes, além
    de rebind/new-generation sequence/transition.

### 44.11.2 Prova causal final antes dos gates broad

Focused state atual:

- audit capability, analytics e source-generation filesystem E2E: **49/49 verdes**;
- monitor + wire tool + dashboard/tool integration: **70/70 verdes**;
- strict `src/copilot`: **verde**;
- `git diff --check`: **verde**.

Casos particularmente fortes:

- byte-identical `rename` para inode novo + append => uma única logical generation, sem replay;
- replacement com prefixo realmente divergente => geração nova, história anterior preservada;
- replacement >4 KiB que altera somente um record antigo e mantém **os mesmos últimos 4 KiB** =>
  boundary anchor coincide, full-prefix chain diverge, portanto `g2` é criado corretamente;
- copytruncate/rewrite+regrow => geração nova sem `DELETE` histórico;
- cursor insert abortado por trigger SQLite => event rows também fazem rollback;
- source ausente => cursor certificado permanece intacto;
- partial catch-up => rows podem existir internamente, mas `available=false` até materialização
  completa.

### 44.11.3 Full-prefix proof — custo observado no audit real

Contra o JSONL live com **40.613.830 B**, uma recomputação completa read-only de prefix proof
consumiu **40.613.830 B em ~359,6 ms**, com `sourcePresent=true`, `prefixAvailable=true`, boundary
window de 4 KiB e sequence proof v1. O arquivo permaneceu na mesma physical identity durante a
medição.

Esse O(prefix) não está no hot path: só ocorre quando `physicalFileIdentity` muda **e** o boundary
anchor ainda coincide. O append path continua incremental e atualiza o hash-chain apenas para
records novos.

### 44.11.4 Gate raw↔derived real final após todos os hardenings

Foi criado outro SQLite temporário isolado e usado um snapshot estável do **JSONL real**, sem tocar
`data/copilot.sqlite` do runtime v9 conectado.

```text
raw snapshot bytes       = 40.625.243
raw lines                = 109.590
raw invalid JSON lines   = 5
raw normalized events    = 80.371
v10 catch-up chunks      = 10 x ~4 MiB
v10 indexed events       = 80.371
full-prefix proofs build = 0
full-prefix proof bytes  = 0
catch-up duration        = ~10.476,95 ms
EOF next sync            = 1 chunk / 0 B / 0 events / ~5,22 ms
duplicatePrefixReplay    = 0
logical generations      = 1 (g1) no rebuild normal
schema/normalizer        = 10 / 10
sequence proof           = v1 / tokenPresent=true
```

Com **o mesmo `now`** para raw e derived:

| janela | raw rows | v10 rows | delta rows | raw starts | v10 starts | delta starts |
| -----: | -------: | -------: | ---------: | ---------: | ---------: | -----------: |
|     1d |    5.326 |    5.326 |      **0** |      2.181 |      2.181 |        **0** |
|     7d |   29.085 |   29.085 |      **0** |     12.842 |     12.842 |        **0** |
|    14d |   58.411 |   58.411 |      **0** |     26.900 |     26.900 |        **0** |

Portanto o candidate atual fecha simultaneamente a inflação histórica observada no v9 e a paridade
raw↔derived sob o owner v10 fortalecido. O custo de rebuild subiu modestamente em relação à medição
anterior (~9,75 s -> ~10,48 s) por causa do hash-chain por record; o hot EOF permaneceu na ordem de
milissegundos e o build normal executou **zero** full-prefix proofs.

### 44.11.5 Estado dos gates e próximos passos imediatos

Concluído:

- [x] Fase A — boundary W8 restaurado;
- [x] Fase B — raw continuity/sequence contract;
- [x] Fase C — derived v10 + state machine;
- [x] causal matrix expandida;
- [x] focused tests;
- [x] strict;
- [x] diff-check;
- [x] Fase E — rebuild real isolado e parity exata.

Ainda obrigatório antes de chamar B4-0 de source-certified:

- [x] `lint:copilot:changed`;
- [x] architecture contract/check;
- [x] `mcp-fast` sobre bytes estáveis;
- [x] `mcp-full` sobre os mesmos bytes;
- [x] fingerprint/contagens finais e atualização deste roadmap;
- [x] decisão explícita de avançar ou não para III-B4-1.

O SQLite/runtime **live** continua deliberadamente v9 até um rollout/reload posterior. Não usar o
live 14d como authority antes da promotion v10 e do gate runtime pós-restart.


## 44.12 Revisão 9.4 — certificação broad final de B4-0 e liberação de B4-1

### 44.12.1 Source barrier final

Após o primeiro broad gate revelar que os novos counters de source-generation faziam o payload compacto
normal de `mcp_runtime_health` ultrapassar 6 KiB, a observabilidade foi tornada **evidence-sparse**:

- `sourceTransition` só é publicado quando reset/rebind/new-generation/sequence/transition realmente
  existem;
- `prefixProof` só é publicado quando ao menos um full-prefix proof ocorreu;
- o monitor interno preserva os counters completos; nenhum diagnóstico raro foi perdido;
- o hot payload normal voltou ao budget anterior.

O focused regression correspondente fechou **10/10**. A candidate pós-correção foi congelada por
`source-barrier capture-worktree`:

```text
barrier schema         = copilot.repository-source-barrier v2
entries                = 95
absent/tombstone       = 11
candidate fingerprint  = cda30849d014a55f9f4f0a709b31d9ccc12b01829128c2fa793755e57abb2669
```

### 44.12.2 `mcp-fast` e `mcp-full` sobre exatamente os mesmos bytes

`mcp-fast`:

```text
success      = true
typecheck    = green
test files   = 127/127
tests        = 769/769
duration     = ~70,7 s
barrier end  = cda30849d014a55f9f4f0a709b31d9ccc12b01829128c2fa793755e57abb2669
```

`mcp-full`, sem qualquer source mutation entre os dois gates:

```text
success               = true
strict typecheck       = green
lint changed           = green (78 files)
docs contract          = green
architecture contract  = green
full Copilot lint      = green
unit MCP files         = 127/127
unit MCP tests         = 769/769
duration               = ~113,7 s
barrier end            = cda30849d014a55f9f4f0a709b31d9ccc12b01829128c2fa793755e57abb2669
```

Logo B4-0 não depende apenas de focused fixtures: a mesma árvore passou pelos broad gates completos sem
mudança de bytes durante nenhum deles.

### 44.12.3 Architecture ratchet encontrado no broad-prep

O primeiro architecture gate encontrou somente:

```text
#copilot/mcp/public/transport/http/stateful/router
closure = 620.878 B
standard tier limit = 614.400 B
```

Não havia cycle, unresolved import, alias mismatch, owner mismatch, import-purity finding ou mutable
state gap. A investigação mostrou que esse public surface:

- já é carregado por `await import(...)` no HTTP adapter;
- tinha baseline histórico individual de `608.791 B` e teto individual de `913.187 B`;
- portanto já era semanticamente um graph heavy/lazy quase no teto `standard` antes de B4-0.

A correção foi **reclassificar somente esse alias de `standard` para `heavy`**, sem elevar nenhum teto
global e mantendo o baseline individual como ratchet. O architecture contract final ficou integralmente
verde (`cycles=[]`, manifest/cost/import-purity/owners/mutable-state sem violations).

### 44.12.4 Fingerprints e surface source atuais

B4-0 não altera a tool surface. A árvore certificada mantém o boundary W8:

```text
full tools          = 89
full envelope       = 131.652 B
full fingerprint    = 19d1ec79ab66919609cec98d092e9a68b613ecfaf95b3c6872988a47958201ac
latency tools       = 52
latency envelope    = 95.952 B
latency fingerprint = 93ed1020a86ab6f1bb07ced9c04651ecae80feefe4197ba7278ae61aa62f290d
CAPABILITIES_VERSION = 71
```

Hashes dos principais owners B4-0 no checkpoint broad:

```text
audit/service.js                         29b0d26575a0f759c3d6825f978f4326bc0d065c989fac02d0a2507f5025382b
round-trip/analytics.js                  89f8439aa5dd706e9e12dc42968697c72147beffb6e03c6f856ffcaf044fb389
round-trip/monitor.js                    c38bbcb970dcdcc9253a10bf1f58d36c049f0402a871fd698f3ec108fea4cf4f
round-trip/normalizer.js                 94fb73000d7257be5c4befbe173dfcfb55cca70dd13d63c1235f0deebb72ec50
round-trip/summary.js                    a97cdded64bf75f0c62ea11bbab1270b55833fd3b0b44d595404c0f8ff335337
runtime-health/runtime.js                527cb3d928433f1092e563b439b344ffb6d5fe2bf6a7edbc3fb07ebe9d6ec889
```

### 44.12.5 Decisão de gate

**III-B4-0 está SOURCE CERTIFIED.** Os oito critérios de 44.10 foram satisfeitos no source candidate.
O gate live continua separado: o processo conectado ainda precisa de rollout/reload v10 e acceptance
runtime antes de a derived 14d live voltar a ser usada como promotion authority.

**III-B4-1 está liberado para investigação/experimento source-side.** A liberação não autoriza tornar
uma reduced surface default. O primeiro passo é recalcular toda a frontier usando a realidade pós-W8:
**89 tools full / 52 latency**, e não o antigo baseline 131/71. A frontier deve ser derivada novamente
do raw JSONL/current descriptors e manter `full` como fallback/default até A/B host-side real.

Checklist de transição:

- [x] B4-0 causal matrix;
- [x] raw↔derived parity real;
- [x] incremental/performance gate;
- [x] strict/lint/docs/architecture;
- [x] `mcp-fast` 769/769;
- [x] `mcp-full` 769/769;
- [x] stable source barrier durante ambos broad gates;
- [x] registrar fingerprints/source counts;
- [x] liberar B4-1 **somente para investigação e experimentação reversível**;
- [ ] recalcular B4-1 Pareto frontier 98% / 99% / 99,5% sobre o catálogo atual;
- [ ] medir descriptor/envelope/input-schema bytes dos candidates;
- [ ] classificar misses como normal-workflow vs escalation/exception;
- [ ] somente depois desenhar A/B host-side; nenhum default change nesta etapa inicial.


## 44.13 III-B4-1 — rebaseline pós-W8, frontier exata e decisão source-side

B4-1 foi reaberta somente depois da certificação source de B4-0. O baseline antigo `131 full / 71
latency` não é mais operacional: a racionalização suplementar W1→W8 reduziu o catálogo source para
**89 tools**, com `latency=52`.

### 44.13.1 Authority usada e normalização histórica

O runtime live conectado ainda pertence à geração anterior e, portanto, o raw JSONL recente contém
entry points já aposentados no source. Para não confundir “nome antigo” com “capacidade ausente”, a
medição source-side usou:

1. **raw JSONL direto** como authority de calls;
2. catálogo source W8 como authority de tools disponíveis;
3. ledger de migração W1→W8 para projetar nomes aposentados no owner atual;
4. duas retiradas sem call replacement (`repo_index_invalidate`, hoje coherence automática, e
   `mcp_golden_prompts`, hoje fixture/docs) tratadas separadamente em vez de virarem misses falsos.

Snapshot principal: aproximadamente `2026-08-28T04:16:51Z`.

```text
full source     = 89 tools / 131.652 B
latency source  = 52 tools / 95.952 B
full inputSchema bytes    = 66.595
latency inputSchema bytes = 49.578
```

### 44.13.2 Coverage raw normalizada da `latency`

```text
24h addressable starts = 2.163
latency covered        = 2.083 = 96,301%

7d addressable starts  = 12.893
latency covered        = 12.671 = 98,278%

14d addressable starts = 26.946
latency covered        = 25.523 = 94,720%
```

A janela 14d continua sendo **histórica/cohort-drift**, não alvo para decidir um default estático de
agosto: nela aparecem fluxos Git granulares, LLM-B e entry points de campanhas anteriores em volume
muito maior que no workload atual.

### 44.13.3 Pareto frontier exata — menor número de additions, depois menor descriptor cost

Foi resolvido um problema 0/1 bounded sobre as 37 tools fora de `latency`, exigindo simultaneamente o
threshold em 24h e 7d. O objetivo lexicográfico foi:

1. menor número de tools adicionadas;
2. em empate, menor soma de descriptor bytes.

| alvo simultâneo | tools | additions | envelope SDK | economia vs full | coverage 24h | coverage 7d |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 98% | 55 | 3 | 98.056 B | 33.596 B | 98,058% | 98,790% |
| 99% | 57 | 5 | 100.158 B | 31.494 B | 99,029% | 99,108% |
| 99,5% | 62 | 10 | 104.760 B | 26.892 B | 99,538% | 99,504% |

Candidate 98% exato:

```text
mcp_tool_payload_audit
mcp_smoke_workspace
mcp_reload_status
```

Candidate 99% exato:

```text
mcp_tool_payload_audit
mcp_smoke_workspace
mcp_reload_plan
mcp_reload_status
mcp_reload_schedule
```

Candidate 99,5% exato adiciona ainda:

```text
git_stage
git_commit
git_push
llmb_live_readiness
mcp_oauth_friction_audit
```

### 44.13.4 Por que a frontier bruta não deve virar mode/default

A decomposição dos **misses da `latency`** mostrou:

```text
24h misses = 80
51,3% admin-restart
20,0% measurement
12,5% admin-diagnostic
11,3% git-fallback
 2,5% repo-specialist
 2,5% llmb-workload

7d misses = 222
31,1% admin-restart
25,7% git-fallback
20,3% admin-diagnostic
 9,5% measurement
 5,9% llmb-workload
 3,6% repo-specialist
 3,6% admin-maintenance
 0,5% repo-maintenance
```

Logo o déficit de coverage global é predominantemente **cohort/campaign-specific**. No subconjunto
`core coding = latency + repo-specialist`, a própria `latency` cobre:

```text
24h = 99,9041%
7d  = 99,9369%
14d = 99,8123%
```

Isso falsifica a hipótese de que “faltam várias tools normais” no surface de baixa latência. O que
falta são principalmente controles de restart/admin, instrumentation da própria campanha, fallback
Git granular e workloads especializados.

### 44.13.5 Decisão source-side B4-1

**Não criar agora um novo static mode `high-coverage-99`/`99.5`.** Isso cristalizaria no contrato uma
lista dominada pela campanha atual de restart/payload/validation e transformaria telemetry recente em
arquitetura permanente.

A infraestrutura necessária para um A/B reversível **já existe**:

```text
COPILOT_MCP_TOOL_SURFACE=latency
COPILOT_MCP_TOOL_SURFACE_INCLUDE=<candidate additions>
```

Portanto:

- `full` continua default/fallback;
- `latency` continua candidate core-coding;
- additions serão fornecidas como configuração do experimento, não como novo enum permanente;
- o A/B host-side só deve ocorrer depois do rollout live da geração atual e com uma cohort que não
  misture artificialmente a própria campanha de instrumentação;
- misses devem ser reportados por classe de workload, não apenas por count agregado.

Checklist B4-1 source-side:

- [x] rebaseline sobre catálogo atual 89/52;
- [x] raw-direct + migration-aware coverage;
- [x] frontier 98/99/99,5 simultânea em 24h/7d;
- [x] envelope/input-schema medidos pelo SDK real;
- [x] misses classificados em core vs admin/recovery/integration;
- [x] full fallback permanece trivial;
- [x] rejeitado novo mode estático permanente neste checkpoint;
- [ ] rollout live da geração source atual;
- [ ] A/B host-side real com `latency + include`, usando cohort controlada;
- [ ] medir TTFT/selection error/fallback rate no host antes de qualquer mudança de default.

**Status:** investigação e preparação source-side de B4-1 concluídas; promotion/default change **não
aprovados**. O item live/A-B permanece aberto e não bloqueia a instrumentação observacional de B4-2,
desde que B4-2 não use o derived live v9 como authority.


## 44.14 III-B4-2 — plano normativo de effective execution-policy telemetry

A investigação B4-2 começa com uma distinção epistemológica: `executionMode` é útil como label
operacional, mas não prova separadamente qual preflight path, failure policy e classe de concurrency
**foram efetivamente executados**. Também não é correto reconstruir isso dos args, porque defaults e
branches mudam o run real.

### 44.14.1 Evidência raw antes da mudança

No raw JSONL dos últimos 14 dias existem `1.834` completions de `repo_apply_patch_batch`:

```text
1.690  executionMode ausente / geração histórica pré-telemetria
   99  patch-apply:per-target-fast:fail-fast | success
   27  patch-apply:per-target-fast:fail-fast | resultState legado/null
   14  patch-apply:per-target-fast:fail-fast | domain-failure
    3  patch-dry-run:best-effort | success
    1  patch-apply:global-preflight:fail-fast:post-validated | success
```

Entre os `144` completions que já possuem `executionMode`, **140** usam `per-target-fast + fail-fast`.
Esse padrão é materialmente diferente do default de schema `per-target-fast + best-effort`; portanto
B4-3 não pode desenhar profiles a partir do default documentado nem a partir dos args crus.

### 44.14.2 Owner da verdade efetiva

`workspace/repository/write/patch-batch/workflow.js` já calcula antes/ao executar:

```text
effectiveApplyMode
effectiveFailureMode
effectiveConcurrency
preflightElided
preflightElisionReason
run/preflight/applyRun.execution.concurrency
```

`protocol/tools/contracts/result.js` já possui o `ResultExecutionHint`, interno, non-enumerable e fora
do wire MCP. O registry lê esse hint somente depois do handler e projeta facts content-free no
`tool_call_completed`. Portanto esse é o menor owner correto para transportar a política efetiva até
a camada de audit, sem serializar `args` ou `structuredContent` arbitrário.

### 44.14.3 Taxonomia bounded

Adicionar ao internal execution hint três dimensões fechadas:

```text
executionPolicyClass:
  dry-run
  preflight-blocked
  direct-apply
  preflight-gated-apply
  atomic-preflight-elided-apply

executionFailurePolicyClass:
  best-effort
  fail-fast

executionConcurrencyClass:
  sequential
  parallel-bounded
```

A classe de concurrency é derivada do número **efetivamente usado** (`1 => sequential`, `>1 =>
parallel-bounded`). O número exato não será persistido nesta fase; ele acrescentaria cardinalidade e
não é necessário para responder a pergunta arquitetural de B4-3.

### 44.14.4 Matriz branch → telemetria

| branch efetivo | `executionPolicyClass` | failure policy registrada | concurrency registrada |
| --- | --- | --- | --- |
| patch dry-run | `dry-run` | `best-effort` do `run` real | `run.execution.concurrency` |
| global preflight bloqueou apply | `preflight-blocked` | `best-effort` do preflight real | `preflight.execution.concurrency` |
| `per-target-fast` apply | `direct-apply` | `effectiveFailureMode` do apply | `applyRun.execution.concurrency` |
| `global-preflight`, multi-target, preflight passou | `preflight-gated-apply` | `effectiveFailureMode` do apply | `applyRun.execution.concurrency` |
| `global-preflight`, single-target, preflight elidido por atomicidade | `atomic-preflight-elided-apply` | `effectiveFailureMode` do apply | `applyRun.execution.concurrency` |

O campo `executionMode` existente permanece para compatibilidade/diagnóstico; os novos enums são a
authority analítica para política efetiva.

### 44.14.5 Derived-index generation

A adição de colunas muda a forma sanitizada persistida. A geração será elevada de `10` para **`11`**:

- `MCP_ROUND_TRIP_NORMALIZER_VERSION = 11`;
- `MCP_ROUND_TRIP_INDEX_SCHEMA_VERSION = 11`;
- novo cursor `mcp-audit:v11`;
- rebuild continua explícito a partir do raw JSONL;
- toda a state machine de source-generation, boundary anchor e full-prefix proof criada em B4-0
  permanece semanticamente inalterada.

O rollout live ainda está v9; por isso a promoção futura pode legitimamente reconstruir direto para
v11, sem precisar materializar v10 em produção primeiro.

### 44.14.6 Summary esperado

O summary deve publicar um bloco bounded `executionPolicies` com:

- authority/version/caveat;
- `observedCalls` e coverage sobre completions elegíveis;
- counts por `executionPolicyClass`;
- counts por `executionFailurePolicyClass`;
- counts por `executionConcurrencyClass`;
- distribuição por tool e por runtime cohort, bounded por `top`/cohorts existentes;
- nenhuma persistência de target, path, patch text, args livres ou concurrency number.

Pre-v11 rows ficam explicitamente fora do denominador observado, nunca inferidas como default.

### 44.14.7 Plano executável e gates

- [x] localizar owner de política efetiva no patch workflow;
- [x] localizar transporte interno non-wire (`ResultExecutionHint`);
- [x] definir taxonomia bounded e matriz branch→fact;
- [x] adicionar enums sanitizados ao execution hint;
- [x] projetar enums no registry audit completion;
- [x] instrumentar todos os branches de `repo_apply_patch_batch` com valores do run real;
- [x] elevar normalizer/schema/cursor para v11 e persistir três colunas;
- [x] adicionar summary `executionPolicies` com coverage/caveat;
- [x] provar content-free em normalizer/index tests;
- [x] provar dry-run/preflight-blocked não herdam policy hipotética do apply;
- [x] provar single-target global-preflight como `atomic-preflight-elided-apply`;
- [x] provar direct/gated apply com failure/concurrency efetivos;
- [ ] strict + lint + architecture se boundary pública mudar;
- [x] verificar fingerprint/tool-count **inalterados** (B4-2 não deve alterar wire descriptor);
- [x] rebuild raw→derived isolado e medir distribuição natural v11;
- [ ] `mcp-fast` e `mcp-full` sob source barrier estável antes de encerrar B4-2;
- [ ] somente depois decidir B4-3; profile enum continua **não presumido**.


## 44.15 Checkpoint B4-2 v11 — candidate pré-broad

### 44.15.1 Implementação efetiva

A telemetria foi implementada no owner do **estado realmente executado**, não por inspeção de args:

- `ResultExecutionHint` interno/non-enumerable ganhou três enums fechados;
- `repo_apply_patch_batch` popula os enums a partir de `workflow.run`, `workflow.preflight` ou
  `workflow.applyRun`, conforme o branch que de fato executou;
- registry projeta apenas esses enums sanitizados no `tool_call_completed`;
- normalizer rejeita qualquer string fora da taxonomia;
- derived index passou de schema/normalizer 10 para **11**, rebuild-only;
- summary publica `executionPolicies` com eligibility/coverage e distribuições bounded;
- `mcp_round_trip_analytics` preserva o bloco completo;
- `mcp_latency_dashboard` preserva apenas uma projeção compacta da evidência global.

Taxonomia implementada:

```text
policy:
  dry-run
  preflight-blocked
  direct-apply
  preflight-gated-apply
  atomic-preflight-elided-apply

failure:
  best-effort
  fail-fast

concurrency:
  sequential
  parallel-bounded
```

Um teste causal capturou exatamente por que a policy não pode vir dos args: `targetConcurrency=4`
com apenas um target executou concurrency efetiva `1` e foi corretamente classificado como
`sequential`.

### 44.15.2 Gate focado

```text
capture layer: tools + audit correlation            = 80/80 green
analytics/source-generation/audit                    = 52/52 green
focused ampliado tool/audit/analytics/monitor/health = 143/143 green
projection tool + compact dashboard                  = 69/69 green
strict typecheck                                     = green
git diff --check                                     = green
```

Os cinco branches de patch-batch estão explicitamente cobertos. Strings open-ended como
`caller-defined-policy`, `retry-until-success` ou `c128` são descartadas pelo normalizer e não entram
no SQLite.

### 44.15.3 Gate real raw→derived v11

Snapshot estável do raw atual em `2026-08-28T04:30:57.045Z`:

```text
raw bytes                         = 41.037.277
invalid JSON lines                = 5
schema_version                    = 11
normalizer_version                = 11
source generation                 = mcp-audit:v11:g1
rebuild                           ≈ 3.401,6 ms
sourceIntegrity                   = materialized
lagBytes                          = 0
EOF incremental sync             ≈ 6,83 ms
EOF processed/indexed             = 0 / 0
```

Paridade com o mesmo cutoff de 14d:

```text
raw non-synthetic normalized rows = 58.283
derived indexedRows               = 58.283
delta                             = 0

raw starts                        = 27.019
derived starts                    = 27.019
delta                             = 0
```

Policy evidence no raw **pré-rollout v11**:

```text
repo_apply_patch_batch eligible completions = 1.834
raw completions com 3 enums v11             = 0
derived executionPolicies.observedCalls     = 0
persisted policy rows                       = 0
coverageRate                                = 0
```

Esse zero é o resultado correto e obrigatório: o runtime live atual ainda não produz a nova
telemetria. A implementação **não inferiu** policy histórica de `executionMode`, request args ou
defaults. Portanto B4-3 continua bloqueada até existir uma cohort live v11 suficiente.

### 44.15.4 Wire invariance

B4-2 não alterou input/output descriptors MCP:

```text
full tools               = 89
full fingerprint         = 19d1ec79ab66919609cec98d092e9a68b613ecfaf95b3c6872988a47958201ac
latency tools            = 52
latency fingerprint      = 93ed1020a86ab6f1bb07ced9c04651ecae80feefe4197ba7278ae61aa62f290d
repo_apply_patch_batch   = wire-v1:345553b0bc26ad02
```

Os novos facts viajam somente no hint interno e no audit result metadata.

### 44.15.5 Bugs/gaps adicionais corrigidos durante B4-2

1. duas authority strings de catch-up ainda hardcodavam `v10`; agora derivam da geração corrente e os
   testes exigem `v11-catch-up-required`;
2. um rebuild abortado podia deixar o snapshot JSONL temporário da investigação; o artefato foi
   removido e o gate real passou a usar cleanup em `finally`;
3. o summary interno calculava `executionPolicies`, mas `mcp_round_trip_analytics` o descartava na
   projeção wire — corrigido;
4. o dashboard compacto também descartava a nova policy — corrigido;
5. ao adicionar a policy descobriu-se que o dashboard **materializado** já podia exceder 6 KiB antes
   dela. A medição isolada encontrou `6.651 B`, dos quais a policy nova era somente `131 B`;
6. o compact view carregava caveats/authority/subtotais quase detalhados em `lineageContext`,
   `executionAccounting` e `payloadAccounting`. Esses blocos foram reduzidos a sinais decisórios,
   preservando a forma completa no modo detalhado/tool dedicada, sem elevar o SLO de 6 KiB.

### 44.15.6 Estado do gate e ordem seguinte

- [x] taxonomia efetiva bounded;
- [x] captura do run real, não dos args;
- [x] persistência/summary v11 content-free;
- [x] raw→derived v11 parity e zero retroactive inference;
- [x] wire fingerprint invariance;
- [x] projeções operacionais tool/dashboard;
- [x] compact dashboard novamente dentro de 6 KiB;
- [x] lint changed + docs + architecture sobre a candidate final;
- [x] `mcp-fast` sob source barrier estável;
- [x] `mcp-full` sob os mesmos bytes;
- [x] certificar B4-2 source-side;
- [ ] **não iniciar B4-3** sem rollout live e coverage v11 material;
- [ ] após certificar B4-2, investigar III-B4-4 como próximo trabalho source-side independente de
      B4-3, salvo se o rollout live for realizado antes.


### 44.15.7 Certificação source-side final — revisão 9.7

A candidate final foi congelada por `source-barrier capture-worktree` com:

```text
fingerprint = 7ff82ba158f02ee9ef72230ced02b9a41d9a064fa5f61d51f3f3348bd54e4426
entries     = 99
tombstones  = 11
```

Sobre **exatamente os mesmos bytes**:

```text
mcp-fast:
  typecheck = green
  127/127 test files
  778/778 tests
  duration ≈ 70,7 s

mcp-full:
  typecheck          = green
  lint-changed       = green (82 files)
  docs-contract      = green
  architecture       = green
  lint-full          = green
  127/127 test files
  778/778 tests
  duration ≈ 116,3 s (wall ≈ 118,3 s)
  source barrier     = unchanged
```

A duração do `mcp-full` atual não foi hang: o custo dominante medido foi `unit-mcp` (~72,9 s),
seguido de `lint-full` (~21,2 s) e `architecture-contract` (~19,8 s). O comando pode permanecer
silencioso por intervalos longos e depois emitir grande volume de logs de smoke/OAuth, o que produz
percepção de travamento no cliente. Para ciclos normais, não repetir `mcp-full` sem mutation de source;
usar focused/strict/changed-lint durante a onda e reservar o full para promotion barriers. Uma futura
faixa de performance do validation harness pode melhorar progress reporting e eliminar trabalho
redundante, sem enfraquecer o gate.

**Decisão:** III-B4-2 está `SOURCE CERTIFIED`. B4-3 permanece bloqueada até rollout live v11 e
coverage material de `executionPolicies`; o próximo trabalho source-side independente pode seguir
para B4-4.
