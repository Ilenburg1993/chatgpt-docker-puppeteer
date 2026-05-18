# Validação Forense — `Terminal LLM-B - Análise: Bugs, Gaps e Oportunidades de Upgrade - AUDIT_EXTERNA.md`

> Documento-alvo validado: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/Terminal LLM-B - Análise: Bugs, Gaps e Oportunidades de Upgrade - AUDIT_EXTERNA.md`
>
> Data desta validação: `2026-05-18`
>
> Escopo real validado: `src/copilot/terminal/**` e integrações imediatas em `src/copilot/agent/**`, `src/copilot/channel/**`, `src/copilot/presentation/runtime/**`, `src/copilot/sdk/**`, `src/copilot/event-handlers/**`

---

## 1. Conclusão executiva

A auditoria externa estava **substancialmente correta no diagnóstico macro**, mas **não pode ser aceita literalmente item a item** porque parte do material já ficou obsoleto com a evolução do código.

### Síntese do veredito

- **Bugs**: maioria válida; alguns já mudaram de forma; um foi efetivamente superado pelo código atual.
- **Gaps do SDK 0.3.0**: vários já foram incorporados fora do terminal; outros continuam reais na superfície do terminal.
- **Upgrades**: há boas oportunidades, mas nem toda sugestão é canônica ou prioritária para este repositório.

### Resultado consolidado

- **Confirmado**: há bugs reais no terminal e gaps reais na integração terminal ↔ SDK.
- **Refutado/obsoleto**: uma parcela relevante dos gaps já está coberta pela camada `agent/session/sdk`.
- **Latente/parcial**: alguns itens não quebram o fluxo atual porque outra camada já mitiga o risco, mas ainda merecem hardening.

### Batch de execução já iniciado nesta sessão

Já foram iniciadas correções concretas em código para:

- timeout inválido em `engine.js`
- race/cleanup em `/restart`
- dupla resposta pendente em `repl-lifecycle.js`
- dedup incorreta em `io-activity-events.js`
- renderização prematura de `report_intent` em `tool-lifecycle-runtime.js`
- acumulação visual em `printlnBlock`
- exposição de `/permission reset-approvals`
- preservação de `agentId` na ponte de eventos e supressão de `assistant.message` de subagentes no terminal
- inspeção do estado `terminalShutdownSignalsRegistered` para testes

---

## 2. Metodologia usada

### Leitura e inspeção direta

Foram lidos e inspecionados, entre outros, os seguintes arquivos:

- `src/copilot/terminal/repl/repl-command-router.js`
- `src/copilot/terminal/repl/repl-lifecycle.js`
- `src/copilot/terminal/dialog/engine.js`
- `src/copilot/terminal/dialog/output.js`
- `src/copilot/terminal/events/sdk-session-events.js`
- `src/copilot/terminal/events/tool-lifecycle-runtime.js`
- `src/copilot/terminal/events/io-activity-events.js`
- `src/copilot/terminal/events/agent-runtime-events.js`
- `src/copilot/terminal/bootstrap-lifecycle.js`
- `src/copilot/terminal/frontend/projections/timeline.js`
- `src/copilot/terminal/frontend/gateways/dialog.js`
- `src/copilot/terminal/frontend/gateways/sdk-session.js`
- `src/copilot/agent/session/initializers/initializer.js`
- `src/copilot/sdk/session/lifecycle.js`
- `src/copilot/sdk/session/session-fs.js`
- `src/copilot/sdk/session/client-options.js`
- `src/copilot/sdk/rpc/ops.js`
- `src/copilot/sdk/rpc/experimental.js`
- `src/copilot/channel/client-dialog.js`
- `src/copilot/presentation/runtime/dialog.js`
- `src/copilot/presentation/runtime/sdk-session.js`
- `src/copilot/agent/facades/sdk/ui-ops.js`
- `src/copilot/agent/always-alive.js`
- `src/copilot/event-handlers/sdk-responses.js`

### Validação externa oficial consultada

Foram confrontadas as conclusões com documentação oficial e/ou primária:

- release notes do `@github/copilot-sdk` `v0.3.0`
- documentação/API do Node.js 24
- documentação MDN para `Promise.withResolvers`, `AbortSignal.timeout`, `structuredClone`, `EventTarget`
- proposta TC39 de Explicit Resource Management

### Critério de decisão

Cada item foi classificado como:

- **Confirmado** — bug/gap real no estado atual
- **Parcial / latente** — problema existe, mas está mitigado por outra camada ou mudou de forma
- **Refutado / obsoleto** — auditoria descreve um estado que já não corresponde mais ao código atual
- **Upgrade válido** — melhoria coerente com a arquitetura atual
- **Upgrade não recomendado agora** — melhoria possível, mas de baixo ROI, risco alto ou desalinhamento com o repositório

---

## 3. Bugs confirmados — veredito item a item

| ID | Veredito | Decisão final | Evidência resumida |
| --- | --- | --- | --- |
| BUG-001 | **Confirmado** | Prosseguir com correção completa | `src/copilot/terminal/commands/sdk.js` contém múltiplas strings corrompidas (`executável`, `permissão`, `materialização`, etc.) |
| BUG-002 | **Parcialmente confirmado** | Corrigir hardening do cleanup | o `/restart` já registra `dialog.ready` antes do stop, mas ainda havia fragilidade de cleanup em paths excepcionais |
| BUG-003 | **Confirmado** | Corrigir imediatamente | `IDLE_TRANSITION_TIMEOUT_MS` dependia de `LLM_B_BOOT_TIMEOUT_MS` sem guard contra `NaN` |
| BUG-004 | **Confirmado** | Corrigir por performance/escala | `pruneCompletedInteractionMap()` faz poda + novo scan/sort linear evitável |
| BUG-005 | **Confirmado** | Corrigir imediatamente | `printlnBlock()` re-reservava linha com `\n` extra a cada bloco, degradando layout |
| BUG-006 | **Parcialmente confirmado** | Planejar persistência/backoff externo | `_timelineSyncFailures` é volátil e perde backoff entre reinícios |
| BUG-007 | **Confirmado** | Corrigir imediatamente | `renderReportIntentToolPayload()` era chamado antes dos checks de supressão |
| BUG-008 | **Confirmado** | Corrigir imediatamente | dedup de I/O considerava só o alvo primário e ignorava operações multi-target |
| BUG-009 | **Confirmado** | Corrigir imediatamente | `tryAnswerTerminalPendingQuestionInput()` era chamado duas vezes para a mesma linha em caminhos distintos |
| BUG-010 | **Parcialmente confirmado / remodelado** | Reclassificar | o código já não usa `setInterval` cru; hoje o risco remanescente é duplicação por re-registro do listener/timer em cenários anômalos |
| BUG-011 | **Confirmado** | Corrigir imediatamente | faltava forma pública de inspecionar `terminalShutdownSignalsRegistered` |
| BUG-012 | **Refutado / obsoleto** | Não priorizar como bug atual | o padrão descrito pela auditoria não corresponde ao `terminal-agent-wiring.js` atual |

### Observação importante sobre BUG-010

A auditoria descrevia um `setInterval` clássico. O código atual usa `registerInterval()` + `cancelTimer()`. Portanto, o **texto da auditoria ficou desatualizado**, embora a família de risco (“duplicação em re-registro”) continue relevante.

---

## 4. Gaps SDK 0.3.0 — veredito item a item

| ID | Veredito | Decisão final | Evidência resumida |
| --- | --- | --- | --- |
| GAP-001 | **Refutado** | Já implementado | `src/copilot/agent/session/initializers/initializer.js` passa `onPermissionRequest` |
| GAP-002 | **Parcial / latente** | Hardening recomendado | o terminal atual não sofre isso no fluxo padrão porque `includeSubAgentStreamingEvents: false`, mas a ponte local não preservava `agentId` |
| GAP-003 | **Refutado** | Já implementado | `excludedTools` já entra na configuração de sessão |
| GAP-004 | **Refutado** | Já suportado | `sessionIdleTimeoutSeconds` já existe na configuração client-side |
| GAP-005 | **Confirmado** | Adicionar superfície/observabilidade | `session.rpc.skills.*` existe no SDK, mas o terminal não o consome |
| GAP-006 | **Confirmado** | Implementar superfície terminal | o handler atual de OAuth MCP só narra; não aciona `session.rpc.mcp.oauthLogin()` |
| GAP-007 | **Refutado** | Já migrado | o repositório já usa `createSessionFsHandler` e provider idiomático |
| GAP-008 | **Refutado** | Já migrado | o código usa `gitHubToken` corretamente |
| GAP-009 | **Confirmado** | Oportunidade de simplificação | `convertMcpCallToolResult()` ainda não está incorporado |
| GAP-010 | **Confirmado** | Expor no terminal | `/sdk quota` ainda não usa `session.rpc.usage.getMetrics()` |
| GAP-011 | **Parcial / latente** | Hardening recomendado | ausência de `agentId` no terminal só importa se subagent streaming voltar a ser habilitado |
| GAP-012 | **Parcial / latente** | Oportunidade válida | a projeção atual é suficiente, mas não usa a RPC mais nova |
| GAP-013 | **Confirmado** | Planejar | skills por subagente ainda não estão mapeadas como recurso de produto |
| GAP-014 | **Refutado** | Já implementado | `enableConfigDiscovery` já é configurado |
| GAP-015 | **Confirmado** | Planejar/refatorar | `runTerminalDialogTurn` e a pilha abaixo não expõem `requestHeaders` por turno |
| GAP-016 | **Confirmado** | Planejar | attachments blob em memória não estão suportados no terminal atual |
| GAP-017 | **Confirmado** | Corrigir imediatamente | o SDK já expõe `resetSessionApprovals` e o terminal não expunha a ação |

### Decisão importante sobre GAP-002 / GAP-011

Minha palavra final aqui é:

- **não é um bug crítico ativo no fluxo padrão atual**;
- **é um gap de hardening legítimo**;
- a mitigação real hoje vem de `includeSubAgentStreamingEvents: false`, não da camada terminal em si.

Ou seja: a auditoria exagerou no impacto imediato, mas acertou no risco estrutural.

---

## 5. Oportunidades de upgrade — veredito item a item

| ID | Veredito | Decisão final | Observação |
| --- | --- | --- | --- |
| UPG-001 | **Válido, mas não prioritário** | Backlog arquitetural | `EventTarget` pode simplificar alguns fluxos, mas não é prerequisite imediato |
| UPG-002 | **Válido e relevante** | Planejar | `AsyncLocalStorage` pode reduzir vazamento semântico de `runtimeId` |
| UPG-003 | **Válido, mas experimental na prática** | Backlog controlado | útil, porém não deve virar baseline prematuramente |
| UPG-004 | **Válido** | Planejar | há ROI real em mover parte do polling para canal incremental |
| UPG-005 | **Não recomendado agora** | Refutar como prioridade | `WeakRef`/`FinalizationRegistry` aqui aumenta complexidade sem prova clara de ganho |
| UPG-006 | **Válido, baixa prioridade** | Backlog | SSE atual funciona; a troca é melhoria de infraestrutura |
| UPG-007 | **Válido, uso seletivo** | Planejar com critério | `structuredClone()` é bom, mas não deve substituir clones pequenos de forma dogmática |
| UPG-008 | **Válido** | Planejar / opportunistic | `import.meta.dirname` simplifica código ESM |
| UPG-009 | **Válido** | Planejar | tipagem mais forte de eventos combina com `@ts-check` do repo |
| UPG-010 | **Válido** | Planejar | `AbortSignal.timeout()` encaixa bem em handlers de tools |
| UPG-011 | **Válido** | Planejar | consolidar TTL maps reduz lógica duplicada |
| UPG-012 | **Válido** | Aplicar oportunisticamente | `Promise.withResolvers()` já faz sentido em pontos específicos |
| UPG-013 | **Precisa validação funcional** | Backlog investigativo | não tratar como bug sem reproduzir contrato de `autopilot` |
| UPG-014 | **Não recomendado como baseline agora** | Refutar como prioridade | `scheduler.wait()` ainda não é a escolha canônica aqui |
| UPG-015 | **Válido** | Planejar | vale verificar assinatura atual do hook no SDK 0.3.0 |
| UPG-016 | **Válido e imediato** | Corrigir | virou correção concreta via `/permission reset-approvals` |
| UPG-017 | **Refutado / já superado** | Não priorizar | o `cmdMenu` atual já recebe `executeCommandLine` injetado pelo router |
| UPG-018 | **Válido** | Planejar | persistência de display state melhora UX de longo prazo |
| UPG-019 | **Válido** | Planejar | tipagem explícita de `copilotServer` é hardening saudável |

---

## 6. Achados adicionais desta validação

### ACHADO-A — `sdk-responses.js` descartava `agentId`

Mesmo com a mitigação de sessão (`includeSubAgentStreamingEvents: false`), a ponte de eventos estava **jogando fora** `agentId` em `assistant.message`/`assistant.reasoning`.

**Decisão:** tratar como hardening necessário entre terminal e resto de `src/copilot`.

### ACHADO-B — `requestHeaders` por turno continua sem superfície

A trilha atual é:

- `terminal/frontend/gateways/dialog.js`
- `channel/client-dialog.js`
- `presentation/runtime/dialog.js`
- `sendAgentDialogTurn(...)`

Nenhuma dessas camadas expõe `requestHeaders` por mensagem/turno na superfície do terminal.

**Decisão:** confirmar como gap real de integração, mas não forçar patch apressado sem desenhar contrato de ponta a ponta.

### ACHADO-C — warnings de teardown do Vitest

A suite `test:copilot:unit` passou, mas houve warnings de teardown de workers do Vitest no run padrão.

**Decisão:** registrar como debt operacional paralelo; não é um bug confirmado do terminal em si, mas afeta confiabilidade da validação contínua.

---

## 7. Situação atual x situação ideal

### Situação atual

O terminal já tem:

- arquitetura modular razoavelmente sólida;
- separação aceitável entre REPL, frontend/gateways, projections e runtime;
- boas bases de integração com o SDK 0.3.0 fora da camada terminal.

Mas ainda sofre com:

- algumas arestas de robustez no REPL e nos fluxos de dedup/intent;
- lacunas de superfície para RPCs novos do SDK;
- dívida de UX/texto em `commands/sdk.js` por corrupção de encoding;
- inconsistência entre o que o SDK já suporta e o que o terminal realmente expõe ao operador.

### Situação ideal

O terminal ideal deve:

- tratar corretamente todos os eventos sem duplicação ou vazamento de estado;
- expor ao operador as RPCs operacionais relevantes do SDK 0.3.0;
- manter dedup, intent, timeline e display state com comportamento previsível em sessões longas;
- preservar metadados como `agentId` sem depender de uma única mitigação externa;
- ter UX textual íntegra, consistente e sem mojibake.

---

## 8. Decisão final por prioridade

### P0 — corrigir agora

- BUG-001
- BUG-003
- BUG-005
- BUG-007
- BUG-008
- BUG-009
- BUG-011
- GAP-017

### P1 — corrigir nesta trilha de execução contínua

- BUG-002
- BUG-004
- GAP-002
- GAP-006
- GAP-010
- GAP-015

### P2 — consolidar e endurecer

- BUG-006
- BUG-010 (na forma atual)
- GAP-005
- GAP-011
- GAP-012
- GAP-013
- GAP-016
- UPG-002 / UPG-004 / UPG-008 / UPG-009 / UPG-010 / UPG-011 / UPG-012 / UPG-018 / UPG-019

---

## 9. Veredito final

**Minha conclusão final é favorável à auditoria externa como instrumento de triagem, mas não como verdade literal.**

Ela identificou corretamente a direção dos principais problemas, porém:

- superestimou alguns gaps já cobertos fora do terminal;
- descreveu pelo menos um bug já obsoleto;
- não distinguiu bem risco ativo de risco latente mitigado por outra camada.

Ainda assim, a auditoria foi útil e séria. A linha correta agora é:

1. **não descartar a auditoria**;
2. **não aceitá-la cegamente**;
3. **corrigir em ondas priorizadas tudo que foi efetivamente confirmado**.

O roadmap operacional desta validação está no arquivo complementar:

- `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/ROADMAP-TERMINAL-LLM-B-AUDIT_EXTERNA-2026-05-18.md`

O aprofundamento temático desta rodada está no anexo:

- `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/SESSION-EVENTS-TERMINAL-HARDENING-2026-05-18.md`

## 10. Addendum — validação focada em `session-events.d.ts` (linhas 946–1828)

### 10.1. Veredito geral desta rodada adicional

O recorte `946–1828` de `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts` confirma um ponto arquitetural importante:

- o SDK 0.3.0 diferencia claramente eventos finais/persistíveis, eventos efêmeros de streaming/progresso e eventos de coordenação/UI;
- a cadeia local já absorve boa parte disso corretamente;
- mas o terminal ainda não tratava todos esses sinais com a mesma qualidade de UX e de rastreabilidade.

Minha conclusão adicional é:

1. a cadeia `session → event-handlers → agent → terminal` está conceitualmente correta;
2. o principal gap remanescente não era mais de wiring bruto, e sim de **surface/UX canônica**;
3. o problema dos “flashs” reportado pelo operador era real e coerente com o desenho atual do terminal em modo `compact`.

### 10.2. Diagnóstico técnico do problema de UX reportado pelo operador

O comportamento descrito pelo usuário — mensagens operacionais aparecerem por segundos e sumirem quando o terminal atualiza o próximo status — foi confirmado como consequência de duas escolhas atuais:

1. `tool.execution_progress` em `compact` usava `writeInlineStatus(...)` como canal principal;
2. heartbeats de tools longas em `compact` também usavam apenas linha inline, sem snapshot textual durável.

Isso não era uma quebra de lógica do agent, mas um **bug de UX operacional**: a informação existia, porém o operador não conseguia reconstruir com clareza a narrativa do que a LLM-B fez ao longo do tempo.

### 10.3. Achados adicionais desta rodada

#### ACHADO-D — `system.notification` estava normalizado, mas subexposto no terminal

Os eventos `system.notification` já eram convertidos em:

- `agent.background.completed`
- `agent.background.idle`
- `agent.shell.completed`
- `agent.shell.detached_completed`

Porém o terminal não os promovia a UX explícita. Isso criava uma discrepância entre a cadeia canônica de eventos e a visibilidade operacional real.

**Decisão:** tratar como gap de surface do terminal, não do SDK.

#### ACHADO-E — há mais famílias ainda não promovidas à UX terminal explícita

Continuam merecendo tratamento dedicado ou decisão formal:

- `hook.start` / `hook.end`
- `sampling.requested` / `sampling.completed`
- `commands.changed`
- `capabilities.changed`
- `auto_mode_switch.requested` / `auto_mode_switch.completed`
- `exit_plan_mode.requested`
- `assistant.usage` como narrativa visível por evento/turno
- attachments `blob` no caminho terminal

### 10.4. Reclassificação operacional

#### Subir para P1

- durabilidade de UX para progresso e heartbeat de tools em `compact`
- surface terminal para `system.notification` já normalizada em `agent.background.*` e `agent.shell.*`

#### Permanecem P2/P3

- `hook.*`, `sampling.*`, `commands.changed`, `capabilities.changed`, `auto_mode_switch.*`
- narrativa explícita para `assistant.usage`
- suporte terminal para attachments `blob`

### 10.5. Palavra final desta rodada adicional

O tema desta rodada não é “embelezar” o terminal.

É consolidar a ideia de que:

- informação operacional relevante não pode existir apenas como inline transient UI;
- eventos efêmeros do SDK podem continuar efêmeros no wire, mas a superfície terminal precisa promover snapshots duráveis quando isso for importante para a operação humana;
- o terminal da LLM-B é uma console operacional, então clareza narrativa e persistência visual fazem parte do contrato funcional.
