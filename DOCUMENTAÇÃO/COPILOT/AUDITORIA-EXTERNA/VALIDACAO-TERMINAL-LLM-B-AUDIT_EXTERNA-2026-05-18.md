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

| ID      | Veredito                                 | Decisão final                         | Evidência resumida                                                                                                                   |
| ------- | ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| BUG-001 | **Confirmado**                           | Prosseguir com correção completa      | `src/copilot/terminal/commands/sdk.js` contém múltiplas strings corrompidas (`executável`, `permissão`, `materialização`, etc.)      |
| BUG-002 | **Parcialmente confirmado**              | Corrigir hardening do cleanup         | o `/restart` já registra `dialog.ready` antes do stop, mas ainda havia fragilidade de cleanup em paths excepcionais                  |
| BUG-003 | **Confirmado**                           | Corrigir imediatamente                | `IDLE_TRANSITION_TIMEOUT_MS` dependia de `LLM_B_BOOT_TIMEOUT_MS` sem guard contra `NaN`                                              |
| BUG-004 | **Confirmado**                           | Corrigir por performance/escala       | `pruneCompletedInteractionMap()` faz poda + novo scan/sort linear evitável                                                           |
| BUG-005 | **Confirmado**                           | Corrigir imediatamente                | `printlnBlock()` re-reservava linha com `\n` extra a cada bloco, degradando layout                                                   |
| BUG-006 | **Parcialmente confirmado**              | Planejar persistência/backoff externo | `_timelineSyncFailures` é volátil e perde backoff entre reinícios                                                                    |
| BUG-007 | **Confirmado**                           | Corrigir imediatamente                | `renderReportIntentToolPayload()` era chamado antes dos checks de supressão                                                          |
| BUG-008 | **Confirmado**                           | Corrigir imediatamente                | dedup de I/O considerava só o alvo primário e ignorava operações multi-target                                                        |
| BUG-009 | **Confirmado**                           | Corrigir imediatamente                | `tryAnswerTerminalPendingQuestionInput()` era chamado duas vezes para a mesma linha em caminhos distintos                            |
| BUG-010 | **Parcialmente confirmado / remodelado** | Reclassificar                         | o código já não usa `setInterval` cru; hoje o risco remanescente é duplicação por re-registro do listener/timer em cenários anômalos |
| BUG-011 | **Confirmado**                           | Corrigir imediatamente                | faltava forma pública de inspecionar `terminalShutdownSignalsRegistered`                                                             |
| BUG-012 | **Refutado / obsoleto**                  | Não priorizar como bug atual          | o padrão descrito pela auditoria não corresponde ao `terminal-agent-wiring.js` atual                                                 |

### Observação importante sobre BUG-010

A auditoria descrevia um `setInterval` clássico. O código atual usa `registerInterval()` + `cancelTimer()`. Portanto, o **texto da auditoria ficou desatualizado**, embora a família de risco (“duplicação em re-registro”) continue relevante.

---

## 4. Gaps SDK 0.3.0 — veredito item a item

| ID      | Veredito                 | Decisão final                   | Evidência resumida                                                                                                                          |
| ------- | ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-001 | **Refutado**             | Já implementado                 | `src/copilot/agent/session/initializers/initializer.js` passa `onPermissionRequest`                                                         |
| GAP-002 | **Parcial / latente**    | Hardening recomendado           | o terminal atual não sofre isso no fluxo padrão porque `includeSubAgentStreamingEvents: false`, mas a ponte local não preservava `agentId`  |
| GAP-003 | **Refutado**             | Já implementado                 | `excludedTools` já entra na configuração de sessão                                                                                          |
| GAP-004 | **Refutado**             | Já suportado                    | `sessionIdleTimeoutSeconds` já existe na configuração client-side                                                                           |
| GAP-005 | **Parcial / endurecido** | Superfície mínima entregue      | o terminal agora expõe discovery via `/sdk skills`; mutações/config de skills ainda merecem desenho dedicado                                |
| GAP-006 | **Confirmado**           | Implementar superfície terminal | o handler atual de OAuth MCP só narra; não aciona `session.rpc.mcp.oauthLogin()`                                                            |
| GAP-007 | **Refutado**             | Já migrado                      | o repositório já usa `createSessionFsHandler` e provider idiomático                                                                         |
| GAP-008 | **Refutado**             | Já migrado                      | o código usa `gitHubToken` corretamente                                                                                                     |
| GAP-009 | **Confirmado**           | Oportunidade de simplificação   | `convertMcpCallToolResult()` ainda não está incorporado                                                                                     |
| GAP-010 | **Confirmado**           | Expor no terminal               | `/sdk quota` ainda não usa `session.rpc.usage.getMetrics()`                                                                                 |
| GAP-011 | **Parcial / latente**    | Hardening recomendado           | ausência de `agentId` no terminal só importa se subagent streaming voltar a ser habilitado                                                  |
| GAP-012 | **Parcial / latente**    | Oportunidade válida             | a projeção atual é suficiente, mas não usa a RPC mais nova                                                                                  |
| GAP-013 | **Parcial / avançado**   | Surface terminal e mutação básica entregues | contrato/config/factory de skills por custom agent/subagente estão alinhados; `/sdk skills config|agents|disable|enable` já existe; permanecem pendentes persistência declarativa alinhada e correlação ainda mais rica com runtime |
| GAP-014 | **Refutado**             | Já implementado                 | `enableConfigDiscovery` já é configurado                                                                                                    |
| GAP-015 | **Corrigido nesta onda** | Superfície canônica entregue    | `/sdk headers` + store one-shot + `runTerminalDialogTurn` agora usam dispatch SDK direto com reanexo do dialog loop para turnos com headers |
| GAP-016 | **Parcial / endurecido** | Superfície mínima entregue      | `/attach blob <mime> <base64>` agora suporta blob inline no terminal; o caminho segue zero-PR via embed textual, não binário nativo         |
| GAP-017 | **Confirmado**           | Corrigir imediatamente          | o SDK já expõe `resetSessionApprovals` e o terminal não expunha a ação                                                                      |

### Decisão importante sobre GAP-002 / GAP-011

Minha palavra final aqui é:

- **não é um bug crítico ativo no fluxo padrão atual**;
- **é um gap de hardening legítimo**;
- a mitigação real hoje vem de `includeSubAgentStreamingEvents: false`, não da camada terminal em si.

Ou seja: a auditoria exagerou no impacto imediato, mas acertou no risco estrutural.

---

## 5. Oportunidades de upgrade — veredito item a item

| ID      | Veredito                                | Decisão final              | Observação                                                                            |
| ------- | --------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| UPG-001 | **Válido, mas não prioritário**         | Backlog arquitetural       | `EventTarget` pode simplificar alguns fluxos, mas não é prerequisite imediato         |
| UPG-002 | **Válido e relevante**                  | Planejar                   | `AsyncLocalStorage` pode reduzir vazamento semântico de `runtimeId`                   |
| UPG-003 | **Válido, mas experimental na prática** | Backlog controlado         | útil, porém não deve virar baseline prematuramente                                    |
| UPG-004 | **Válido**                              | Planejar                   | há ROI real em mover parte do polling para canal incremental                          |
| UPG-005 | **Não recomendado agora**               | Refutar como prioridade    | `WeakRef`/`FinalizationRegistry` aqui aumenta complexidade sem prova clara de ganho   |
| UPG-006 | **Válido, baixa prioridade**            | Backlog                    | SSE atual funciona; a troca é melhoria de infraestrutura                              |
| UPG-007 | **Válido, uso seletivo**                | Planejar com critério      | `structuredClone()` é bom, mas não deve substituir clones pequenos de forma dogmática |
| UPG-008 | **Válido**                              | Planejar / opportunistic   | `import.meta.dirname` simplifica código ESM                                           |
| UPG-009 | **Válido**                              | Planejar                   | tipagem mais forte de eventos combina com `@ts-check` do repo                         |
| UPG-010 | **Válido**                              | Planejar                   | `AbortSignal.timeout()` encaixa bem em handlers de tools                              |
| UPG-011 | **Válido**                              | Planejar                   | consolidar TTL maps reduz lógica duplicada                                            |
| UPG-012 | **Válido**                              | Aplicar oportunisticamente | `Promise.withResolvers()` já faz sentido em pontos específicos                        |
| UPG-013 | **Precisa validação funcional**         | Backlog investigativo      | não tratar como bug sem reproduzir contrato de `autopilot`                            |
| UPG-014 | **Não recomendado como baseline agora** | Refutar como prioridade    | `scheduler.wait()` ainda não é a escolha canônica aqui                                |
| UPG-015 | **Válido**                              | Planejar                   | vale verificar assinatura atual do hook no SDK 0.3.0                                  |
| UPG-016 | **Válido e imediato**                   | Corrigir                   | virou correção concreta via `/permission reset-approvals`                             |
| UPG-017 | **Refutado / já superado**              | Não priorizar              | o `cmdMenu` atual já recebe `executeCommandLine` injetado pelo router                 |
| UPG-018 | **Válido**                              | Planejar                   | persistência de display state melhora UX de longo prazo                               |
| UPG-019 | **Válido**                              | Planejar                   | tipagem explícita de `copilotServer` é hardening saudável                             |

---

## 6. Achados adicionais desta validação

### ACHADO-A — `sdk-responses.js` descartava `agentId`

Mesmo com a mitigação de sessão (`includeSubAgentStreamingEvents: false`), a ponte de eventos estava **jogando fora** `agentId` em `assistant.message`/`assistant.reasoning`.

**Decisão:** tratar como hardening necessário entre terminal e resto de `src/copilot`.

### ACHADO-B — `requestHeaders` por turno exigia um desvio honesto do zero-PR

A trilha atual é:

- `terminal/frontend/gateways/dialog.js`
- `channel/client-dialog.js`
- `channel/client.js`
- `agent/messaging/agent-messaging.js`

O achado real desta retomada foi mais sutil do que “falta passar um parâmetro”.

O caminho canônico zero-PR do dialog loop responde `ask_user` pendente; ele **não** carrega `requestHeaders` por turno de forma honesta. Portanto, para suportar BYOK/headers dinâmicos sem mentir sobre o contrato, foi necessário introduzir uma estratégia explícita:

1. armazenar headers one-shot no estado de apresentação;
2. consumi-los apenas no próximo turno do usuário;
3. no gateway de diálogo, fazer bounce controlado do dialog loop;
4. despachar o turno por `llmBridgeClient.chat(...)`, que já cai no caminho `sendMessage()`/SDK direto com `requestHeaders`;
5. reanexar o dialog loop com `resumeSessionAttach: true` ao final.

**Decisão:** gap confirmado e corrigido nesta rodada sem abrir arquitetura paralela nem fingir suporte dentro do caminho `ask_user`.

### ACHADO-C — divergência de runner e warnings de teardown do Vitest

O problema foi confirmado em duas camadas diferentes:

1. havia uma **divergência estrutural de runner** entre o que `test:unit` executava e o que `test:copilot:unit` executava;
2. havia também **warnings reais de workers do Vitest**, agravados pelo uso de `pool: 'forks'` e por concorrência alta demais para a carga do lote Copilot.

**Decisão:** tratar como trilha operacional obrigatória desta mesma rodada, não como dívida paralela.

### ACHADO-E — `SessionConfig`, `ResumeSessionConfig` e subagentes não estavam totalmente full

Uma auditoria dedicada a `node_modules/@github/copilot-sdk/dist/types.d.ts` confirmou quatro desvios estruturais relevantes:

1. `ResumeSessionConfig` ainda não tinha módulo dedicado no lugar correto;
2. `SessionConfigBuilder.buildForResume()` podia vazar `sessionId` para payloads de resume;
3. `SessionConfigBuilder.build()` podia vazar `disableResume` para payloads de create;
4. a camada local de subagentes ainda tinha drift em relação ao SDK oficial (`description?`, `skills?`, `mcpServers?`, `tools=[]`).

Além disso, a superfície HTTP de sessões ainda não expunha toda a parte serializável restante de `SessionConfig`/`ResumeSessionConfig` (`modelCapabilities`, `enableConfigDiscovery`, `includeSubAgentStreamingEvents`, `defaultAgent`, `gitHubToken`).

**Decisão:** tratar como trilha estrutural obrigatória e corrigir na mesma onda. O detalhamento completo está em `SESSIONCONFIG-SUBAGENTES-AUDITORIA-AMPLA-2026-05-18.md`.

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

### P2 — consolidar e endurecer

- BUG-006
- BUG-010 (na forma atual)
- GAP-011
- GAP-012
- GAP-013
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

E a auditoria complementar dedicada à superfície `CopilotClient` está em:

- `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/COPILOTCLIENT-AUDITORIA-AMPLA-2026-05-18.md`

E a auditoria complementar dedicada a `SessionConfig`, `ResumeSessionConfig` e subagentes está em:

- `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/SESSIONCONFIG-SUBAGENTES-AUDITORIA-AMPLA-2026-05-18.md`

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

Continuam merecendo tratamento dedicado ou aprofundamento, mas já houve endurecimento material nesta retomada para:

- `hook.start` / `hook.end`
- `sampling.requested` / `sampling.completed`
- `commands.changed`
- `capabilities.changed`
- `auto_mode_switch.requested` / `auto_mode_switch.completed`
- `exit_plan_mode.requested`
- `assistant.usage` via owner terminal explícito em `pr.consumed` / `pr.fallback_model`
- attachments `blob` no caminho terminal via `/attach blob`

### 10.4. Reclassificação operacional

#### Subir para P1

- durabilidade de UX para progresso e heartbeat de tools em `compact`
- surface terminal para `system.notification` já normalizada em `agent.background.*` e `agent.shell.*`

#### Permanecem P2/P3

- aprofundamento de `command.*` e diffs mais ricos para `commands.changed` / `capabilities.changed`
- governança de skills por subagente e mutações/config dedicadas
- eventual caminho binário nativo futuro além do embed textual zero-PR

### 10.6. Addendum desta retomada contínua

Após a estabilização da baseline de testes, esta retomada executou uma nova onda arquitetural que mudou o estado real do roadmap:

- `assistant.usage` deixou de ser apenas coleta/estado implícito e ganhou owner terminal explícito via `pr.consumed` e `pr.fallback_model` em `agent-runtime-events.js`;
- `hook.*`, `sampling.*`, `commands.changed`, `capabilities.changed`, `auto_mode_switch.*` e `exit_plan_mode.requested` passaram a ter wiring canônico até a UX terminal;
- `skills.discover` agora está exposto no terminal por `/sdk skills`, atravessando a cadeia canônica `agent → presentation → gateway → command`;
- a distinção canônica entre `custom agent` (definição em `SessionConfig.customAgents`) e `sub-agent` (manifestação runtime via `subagent.*`) foi formalizada em código e documentação;
- o terminal agora expõe governança mais rica de skills por `/sdk skills config`, `/sdk skills agents`, `/sdk skills disable <skill...>` e `/sdk skills enable <skill...>`, usando mutação server-scoped honesta para `disabledSkills`;
- o terminal passou a aceitar `blob` inline por `/attach blob <mime> <base64> [--name ...]`, com fila estruturada e embedding zero-PR via helper unificado de runtime.
- `requestHeaders` por turno agora estão expostos por `/sdk headers`, com store one-shot e dispatch SDK direto com reanexo do dialog loop no gateway quando necessário.

Com isso, o backlog remanescente ficou mais estreito e mais claramente concentrado em:

- governança/mutação avançada de skills (incluindo alinhamento entre estado server-scoped e persistência declarativa);
- aprofundamento de superfícies ricas para `command.*` e capacidades dinâmicas;
- eventual caminho binário nativo futuro além do embed textual do terminal.

### 10.5. Palavra final desta rodada adicional

O tema desta rodada não é “embelezar” o terminal.

É consolidar a ideia de que:

- informação operacional relevante não pode existir apenas como inline transient UI;
- eventos efêmeros do SDK podem continuar efêmeros no wire, mas a superfície terminal precisa promover snapshots duráveis quando isso for importante para a operação humana;
- o terminal da LLM-B é uma console operacional, então clareza narrativa e persistência visual fazem parte do contrato funcional.

## 11. Addendum — runner, Vitest, testes e typecheck estrito

### 11.1. Por que o comando anterior parecia muito pior do que `test:copilot:unit`

O comportamento anterior não era mero ruído. Havia uma combinação de fatores:

1. `npm test -- --run ...` **não era equivalente** a “rodar só alguns testes Copilot”; ele continuava expandindo para o pipeline padrão e alcançando mais escopo do que parecia na linha de comando;
2. `test:unit` usava `scripts/ci/run-mixed-tests.mjs`, que até então executava o lote Vitest híbrido inteiro sob uma única configuração base;
3. quando o lote misturava specs Copilot e specs genéricas, testes Copilot podiam acabar rodando sob `vitest.config.js`, sem a baseline própria do domínio Copilot;
4. além disso, havia **falhas reais** em testes stale fora da faixa terminal estrita, inclusive em mocks de SDK, contratos de barrel e parte da trilha `devcontainer`.

Portanto, o problema não era “cache ruim” ou “test:copilot:unit omitindo testes” em sentido simples. O que existia era:

- uma mistura inadequada de configurações no runner híbrido;
- warnings de workers mascarando a análise;
- e um conjunto real de testes e contratos envelhecidos que só apareceu quando a baseline correta foi rodada de ponta a ponta.

### 11.2. Correções definitivas aplicadas nesta rodada

#### Runner / Vitest

- `scripts/ci/run-mixed-tests.mjs` passou a separar explicitamente:
	- specs Copilot → `vitest.copilot.config.js`
	- specs genéricas → `vitest.config.js`
- `vitest.copilot.config.js` foi endurecido para usar:
	- `pool: 'threads'` por default
	- `maxWorkers: '50%'` por default

Isso eliminou a discrepância artificial entre `test:unit` e `test:copilot:unit` e zerou os warnings de worker teardown na baseline final.

#### Testes / contratos / mocks

Foram corrigidos, entre outros:

- mocks stale em rotas e barrels do SDK/runtime;
- contratos desatualizados em `always-alive`, `loop-manager`, `snapshot`, `agent-integration` e testes de presentation/runtime;
- seams de infraestrutura como `url-validator` com `dnsResolver.lookup` explícito para teste robusto;
- filtros canônicos de glob em `index-search` para tratar corretamente segmentos como `node_modules`;
- expectativas stale da trilha `devcontainer`, que já não correspondiam ao comportamento real dos scripts atuais.

#### Typecheck estrito

Também foi fechado o lote de erros de `typecheck:strict:tests.unit`, incluindo:

- narrowing de regex/matches;
- mocks incompatíveis com assinaturas atuais;
- parâmetros implícitos `any`;
- assinaturas novas de handlers e refactors do domínio Copilot.

### 11.3. Resultado final reproduzível desta rodada

Ao final desta rodada, a baseline exigida ficou **integralmente verde**:

- `npm run lint:copilot` ✅
- `npm run typecheck:strict:src.copilot` ✅
- `npm run typecheck:strict:tests.unit` ✅
- `npm run test:copilot:unit` ✅
	- `2791/2791 testes`
	- `951/951 suites`
	- `warnings/errors unique=0 total=0`
- `npm run test:unit` ✅
	- `5069/5069 testes executados com sucesso` no lote ativo
	- `424 arquivos` com `406 passed | 18 skipped`
	- encerramento com `[test-runner] Mixed test run finished successfully.`

### 11.4. Palavra final desta trilha paralela

A resposta final para a dúvida do usuário é:

- **não**, `test:copilot:unit` não estava simplesmente “escondendo” um problema por cache;
- **sim**, havia um problema real de orquestração/configuração do runner híbrido;
- **sim**, havia também falhas reais em testes stale fora do recorte inicial;
- **agora**, a trilha de validação está convergente, warning-zero e pronta para a retomada contínua e profunda do roadmap funcional.

## 12. Addendum — auditoria ampla de `CopilotClient`

### 12.1. Escopo e fonte de verdade

Nesta rodada foi feita leitura integral de `node_modules/@github/copilot-sdk/dist/client.d.ts` e confronto com:

- `node_modules/@github/copilot-sdk/dist/types.d.ts`
- README oficial do SDK
- implementação local em `src/copilot/sdk/session/**`, `src/copilot/server/routes/sdk/**` e `src/copilot/boot/**`

A regra adotada foi: **o pacote tipado instalado vale mais do que o README quando houver drift**.

### 12.2. Principais achados

1. a cobertura local já era forte para quase todo o contrato do client;
2. faltava uma fachada explícita para `getSessionMetadata(sessionId)`;
3. o `ClientOptionsBuilder` ainda não cobria explicitamente `cwd`, `isChildProcess` e `autoRestart`;
4. havia drift documental local em torno de `provider` e do escopo real de `CopilotClientOptions`.

### 12.3. Correções aplicadas nesta rodada

- `src/copilot/sdk/session/client.js`
	- `startClient()` explícito como alias semântico de start/getClient
	- `getClientSessionMetadata()` com fallback compatível
- `src/copilot/server/routes/sdk/session-crud.js`
	- `GET /sessions/:id` passou a usar metadata dedicada do SDK
- `src/copilot/sdk/session/client-options.js`
	- builder fluente para `cwd`, `isChildProcess`, `autoRestart`
	- parsing de env correspondente
- `src/copilot/sdk/types.js`
	- SSOT documental atualizado
- `src/copilot/sdk/session/provider.js`
	- correção do comentário sobre `provider`
- `src/copilot/boot/contract.js` e `src/copilot/boot/surface-validation.js`
	- baseline declarativo ampliado para a paridade do client

### 12.4. Veredito final desta frente

Após essa leva, a avaliação final é:

- **métodos do `client.d.ts`: full**
- **options do `client.d.ts`: full**
- **surface lifecycle: full via helper layer já existente**
- **README drift (`copilotHome`)**: documentado como fora do contrato do pacote instalado localmente
