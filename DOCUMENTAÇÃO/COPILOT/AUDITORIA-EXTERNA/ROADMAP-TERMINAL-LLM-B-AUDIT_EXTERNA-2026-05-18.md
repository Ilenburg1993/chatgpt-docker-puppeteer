# Roadmap de Execução — `Terminal LLM-B - Análise: Bugs, Gaps e Oportunidades de Upgrade - AUDIT_EXTERNA.md`

> Documento-base: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/Terminal LLM-B - Análise: Bugs, Gaps e Oportunidades de Upgrade - AUDIT_EXTERNA.md`
>
> Documento complementar de validação: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/VALIDACAO-TERMINAL-LLM-B-AUDIT_EXTERNA-2026-05-18.md`
>
> Anexo temático desta rodada: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/SESSION-EVENTS-TERMINAL-HARDENING-2026-05-18.md`
>
> Data: `2026-05-18`
>
> Escopo operacional: `src/copilot/terminal/**` e integrações imediatas em `src/copilot/agent/**`, `src/copilot/presentation/**`, `src/copilot/sdk/**`, `src/copilot/event-handlers/**`

---

## 1. Objetivo deste roadmap

Este roadmap existe para transformar a auditoria externa em execução real, sem tratar o documento original como verdade literal.

A regra aqui é simples:

1. **corrigir imediatamente o que foi confirmado e é de alto impacto**;
2. **não desperdiçar energia com achados já obsoletos**;
3. **endereçar também gaps pequenos e upgrades incrementais quando eles melhoram robustez, DX ou operação**;
4. **manter rastreabilidade total** — nenhum item fica “em branco”.

---

## 2. Estado atual consolidado

### Situação atual

O terminal já está em um patamar arquitetural bom:

- REPL multi-fase consistente;
- gateways/projections relativamente bem separados;
- integração com SDK 0.3.0 já parcialmente madura fora da superfície terminal;
- instrumentação e estado operacional acima da média para um terminal interno.

Mas ainda havia — e em parte ainda há — problemas de quatro naturezas:

1. **robustez de fluxo**: restart, timeout, dedup, input pendente, renderização de intents;
2. **lacunas da superfície terminal**: o SDK suporta mais do que o terminal expõe hoje;
3. **dívida de UX/legibilidade**: strings corrompidas, mensagens confusas, labels inconsistentes;
4. **débitos arquiteturais controlados**: persistência de estado, redução de polling, melhor tipagem e contratos de borda.

### Situação ideal

A situação ideal ao final deste roadmap é:

- terminal sem mojibake e com UX coerente;
- eventos SDK tratados sem duplicação, sem race evitável e sem perda de metadados relevantes;
- RPCs relevantes do SDK 0.3.0 acessíveis na superfície terminal quando fizer sentido operacional;
- estado de longa duração previsível em sessões extensas;
- backlog residual reduzido a upgrades conscientes, não a bugs escondidos.

---

## 3. Inventário executivo dos itens

### 3.1 Bugs confirmados

#### Já corrigidos nesta onda

- **BUG-001** — saneamento de encoding/mojibake em `src/copilot/terminal/commands/sdk.js`
- **BUG-002** — hardening do `/restart` em `src/copilot/terminal/repl/repl-command-router.js`
- **BUG-003** — guard contra `NaN` em `IDLE_TRANSITION_TIMEOUT_MS`
- **BUG-005** — reserva de linha/status em `printlnBlock`
- **BUG-007** — `renderReportIntentToolPayload` só após checks de supressão
- **BUG-008** — dedup de I/O agora respeita todos os `targets`
- **BUG-009** — remoção da dupla chamada de `tryAnswerTerminalPendingQuestionInput`
- **BUG-011** — export de `isTerminalShutdownSignalsRegistered()`

#### Corrigido parcialmente / com follow-up

- **BUG-004** — prune de interações otimizado, mas ainda cabe índice incremental dedicado se o volume crescer muito
- **BUG-006** — falta persistência de backoff de timeline entre reinícios
- **BUG-010** — risco original mudou de forma; ainda vale revisar re-registro em cenários de dev-watch extremos

#### Refutado como bug ativo

- **BUG-012** — descrição da auditoria não corresponde mais ao estado atual do `terminal-agent-wiring.js`

### 3.2 Gaps SDK 0.3.0

#### Já implementados ou já cobertos no repositório

- **GAP-001** — `onPermissionRequest`
- **GAP-003** — `defaultAgent.excludedTools`
- **GAP-004** — `sessionIdleTimeoutSeconds`
- **GAP-007** — `SessionFs`
- **GAP-008** — `gitHubToken`
- **GAP-014** — `enableConfigDiscovery`

#### Corrigidos nesta onda

- **GAP-017** — `/permission reset-approvals`
- **GAP-006** — fluxo terminal agora tenta iniciar `mcp.oauth.login()` via RPC quando o evento `mcp.oauth.required` ocorre
- **GAP-010** — `/sdk quota` agora consulta `usage.getMetrics()` em best-effort

#### Confirmados e ainda pendentes

- **GAP-005** — usar / integrar `session.rpc.skills.*` na superfície terminal
- **GAP-009** — adotar `convertMcpCallToolResult()` onde fizer sentido
- **GAP-012** — avaliar `session.rpc.instructions.getSources()` como fonte prioritária
- **GAP-013** — mapear skills por subagente
- **GAP-015** — suportar `requestHeaders` por turno
- **GAP-016** — suportar blob attachments sem roundtrip obrigatório em disco

#### Latentes / mitigados, mas merecem hardening

- **GAP-002** — subagent streaming e `agentId`
- **GAP-011** — identificação de subagente em deltas de streaming

### 3.3 Upgrades

#### Já executados parcialmente nesta onda

- `Promise.withResolvers()` em pontos do terminal
- superfícies adicionais para SDK 0.3.0 na cadeia terminal → presentation → agent → SDK
- saneamento de UX textual em `commands/sdk.js`

#### Mantidos no backlog arquitetural

- **UPG-002** — `AsyncLocalStorage` para `runtimeId`
- **UPG-004** — reduzir polling via `diagnostics_channel`
- **UPG-008** — `import.meta.dirname`
- **UPG-009** — tipagem mais forte de eventos
- **UPG-010** — `AbortSignal.timeout()` em handlers de tool
- **UPG-011** — utilitário compartilhado para TTL maps
- **UPG-018** — persistência de `displayState`
- **UPG-019** — tipagem mais explícita para `copilotServer`

#### Mantidos como baixa prioridade / não recomendados agora

- **UPG-001** — migração ampla para `EventTarget`
- **UPG-003** — `using` / explicit resource management como baseline
- **UPG-005** — `WeakRef`/`FinalizationRegistry` em timeline
- **UPG-006** — SSE com `ReadableStream`
- **UPG-014** — `scheduler.wait()` como estratégia base

#### Refutado / já superado

- **UPG-017** — crítica ao `cmdMenu` já não descreve corretamente a wiring atual

### 3.4 Achados adicionais desta validação

- **ACHADO-A** — a ponte de eventos descartava `agentId`; já corrigido nesta onda
- **ACHADO-B** — `requestHeaders` por turno é um gap real de integração, ainda pendente
- **ACHADO-C** — warnings de teardown do Vitest merecem trilha própria de confiabilidade operacional

---

## 4. Estratégia de execução por fases

## Fase 0 — Baseline e sincronização

### Subfase 0.1 — Higiene de branch e baseline do repo

- ler `package.json` completo;
- sincronizar local e `origin/main`;
- executar validações exigidas pelo usuário (`lint:copilot`, `typecheck:strict:src.copilot`, `test:copilot:unit`);
- consolidar commits pendentes e push inicial.

### Subfase 0.2 — Leitura integral e validação da auditoria

- ler integralmente o documento auditado;
- confrontar item a item com código real e documentação oficial;
- separar confirmado, latente, refutado e upgrade real.

**Status:** concluída nesta sessão.

---

## Fase 1 — Correções P0/P1 do terminal

### Subfase 1.1 — Fluxos de robustez imediata

#### Escopo

- restart do dialog loop;
- timeouts seguros;
- roteamento de input pendente;
- dedup de I/O;
- dedup de tool lifecycle;
- estado mínimo de bootstrap/teste.

#### Itens

- BUG-002
- BUG-003
- BUG-007
- BUG-008
- BUG-009
- BUG-011

**Status:** concluída nesta sessão.

### Subfase 1.2 — UX e integridade textual

#### Escopo

- corrigir o mojibake inteiro de `commands/sdk.js`;
- normalizar labels operacionais como `SDK→FS`, `FS→SDK`, `Permissões`, `Elicitation`, `Limitações`;
- melhorar clareza dos subcomandos `/workspace`, `/permission`, `/sdk`.

#### Itens

- BUG-001
- parte operacional de GAP-017

**Status:** concluída nesta sessão.

### Subfase 1.3 — Exposição mínima das RPCs mais úteis do SDK 0.3.0

#### Escopo

- reset de aprovações da sessão;
- login OAuth MCP via evento obrigatório;
- métricas session-scoped de uso no `/sdk quota`.

#### Itens

- GAP-006
- GAP-010
- GAP-017

**Status:** concluída nesta sessão.

---

## Fase 2 — Hardening de estado e sessão longa

### Subfase 2.1 — Interações SDK e retenção

#### Objetivo

Reduzir custo de retenção e poda das estruturas de UX do terminal em sessões longas.

#### Itens

- consolidar a melhora de **BUG-004** com:
  - índice incremental de latest quando houver evidência de volume alto;
  - microbenchmark local se o mapa crescer além do perfil atual.

**Status:** parcialmente concluída nesta sessão; falta decidir se o índice secundário é necessário agora.

### Subfase 2.2 — Timeline/backoff e reinicialização

#### Objetivo

Eliminar burst de resync após restart rápido do processo.

#### Itens

- BUG-006
- eventual persistência leve de backoff/retry state

**Status:** pendente.

### Subfase 2.3 — Re-registro defensivo de listeners/timers

#### Objetivo

Blindar cenários de recarga/boot repetido em dev-watch e recovery.

#### Itens

- BUG-010 (na forma atual do código, não na descrição obsoleta da auditoria)
- reavaliação dos listeners/timers do runtime do terminal

**Status:** pendente.

---

## Fase 3 — Gaps restantes de integração SDK ↔ terminal

### Subfase 3.1 — Skills e instruction sources

#### Objetivo

Reduzir divergência entre o que o SDK sabe e o que o terminal mostra.

#### Itens

- GAP-005 — `session.rpc.skills.discover()` / `skills.config`
- GAP-012 — `session.rpc.instructions.getSources()`
- GAP-013 — skills por subagente

**Status:** pendente.

### Subfase 3.2 — Streaming e subagentes

#### Objetivo

Tornar o terminal corretamente preparado para subagentes, sem depender apenas da mitigação `includeSubAgentStreamingEvents: false`.

#### Itens

- GAP-002
- GAP-011
- ACHADO-A (já iniciado/corrigido nesta sessão)

**Status:** parcialmente concluída; falta desenhar UX de identificação do subagente em streaming quando habilitado.

### Subfase 3.3 — Payloads avançados por turno

#### Objetivo

Expor capacidades avançadas por mensagem/turno no terminal.

#### Itens

- GAP-015 — `requestHeaders`
- GAP-016 — blob attachments

**Status:** pendente.

---

## Fase 4 — Refactors e upgrades arquiteturais de valor real

### Subfase 4.1 — Context propagation e contratos

#### Itens

- UPG-002 — `AsyncLocalStorage` para `runtimeId`
- UPG-009 — eventos tipados
- UPG-019 — tipagem de `copilotServer`

### Subfase 4.2 — Redução de polling e duplicação utilitária

#### Itens

- UPG-004 — `diagnostics_channel`
- UPG-011 — `createTtlMap(maxSize, ttlMs)` compartilhado
- UPG-018 — persistência de `displayState`

### Subfase 4.3 — Modernização oportunística e segura

#### Itens

- UPG-008 — `import.meta.dirname`
- UPG-010 — `AbortSignal.timeout()` em handlers selecionados
- expansão oportunística de `Promise.withResolvers()` onde realmente melhora legibilidade

**Status da Fase 4:** pendente, mas validada como desejável.

---

## Fase 5 — Itens explicitamente encerrados por decisão

Esta fase existe para garantir que nada fique “sumido”.

### Subfase 5.1 — Refutados / obsoletos

- BUG-012
- UPG-017
- itens do SDK já migrados (GAP-001, GAP-003, GAP-004, GAP-007, GAP-008, GAP-014)

### Subfase 5.2 — Baixa prioridade consciente

- UPG-001
- UPG-003
- UPG-005
- UPG-006
- UPG-014

### Subfase 5.3 — Dívida operacional paralela

- ACHADO-C — estabilidade/warnings do Vitest

**Status:** classificação concluída; documentação final ainda deve registrar a decisão definitiva ao encerrar o roadmap.

---

## 5. Onda executada nesta sessão

### Código já alterado

- `src/copilot/terminal/repl/repl-command-router.js`
- `src/copilot/terminal/repl/repl-lifecycle.js`
- `src/copilot/terminal/dialog/engine.js`
- `src/copilot/terminal/dialog/output.js`
- `src/copilot/terminal/events/tool-lifecycle-runtime.js`
- `src/copilot/terminal/events/io-activity-events.js`
- `src/copilot/terminal/bootstrap-lifecycle.js`
- `src/copilot/event-handlers/sdk-responses.js`
- `src/copilot/terminal/events/sdk-session-events.js`
- `src/copilot/agent/facades/sdk/ui-ops.js`
- `src/copilot/agent/facades/sdk/quota.js`
- `src/copilot/agent/always-alive.js`
- `src/copilot/presentation/runtime/sdk-session.js`
- `src/copilot/terminal/frontend/gateways/sdk-session.js`
- `src/copilot/terminal/frontend/gateways/index.js`
- `src/copilot/sdk/rpc/index.js`
- `src/copilot/sdk/index.js`
- `src/copilot/terminal/state/sdk-interactions.js`
- `src/copilot/terminal/commands/sdk.js`

### Documentação criada nesta sessão

- `VALIDACAO-TERMINAL-LLM-B-AUDIT_EXTERNA-2026-05-18.md`
- `ROADMAP-TERMINAL-LLM-B-AUDIT_EXTERNA-2026-05-18.md`
- `SESSION-EVENTS-TERMINAL-HARDENING-2026-05-18.md`

---

## 6. Próxima onda obrigatória

A próxima execução contínua deve seguir esta ordem:

1. **validar a onda atual**
   - `npm run lint:copilot`
   - `npm run typecheck:strict:src.copilot`
   - `npm run test:copilot:unit`

2. **se houver erro, corrigir imediatamente**
   - sem adiar regressão introduzida nesta onda;
   - sem empurrar problema para “fase futura” se ele nasceu agora.

3. **se a validação ficar verde, avançar para Fase 2 / Subfase 2.2**
   - timeline/backoff/persistência de falhas de sync;
   - e então seguir para Subfase 3.1 (`skills`/`instructionSources`).

---

## 7. Critério de pronto deste roadmap

O roadmap só pode ser considerado concluído quando:

1. todos os bugs confirmados estiverem corrigidos ou formalmente reclassificados com evidência;
2. todos os gaps validados tiverem uma destas situações:
   - implementado,
   - mitigado com documentação,
   - ou explicitamente refutado com base no código atual;
3. os upgrades restantes tiverem destino explícito;
4. lint, typecheck estrito e testes do escopo `src/copilot` estiverem verdes na última onda;
5. a documentação complementar apontar para o mesmo estado real do código.

---

## 8. Palavra final operacional

Este roadmap não é decorativo.

Ele organiza a execução em ondas curtas e verificáveis, mas mantém a exigência principal do usuário:

- **todos os itens validados serão tratados**;
- **nenhum será deixado sem decisão**;
- **o foco imediato permanece em `src/copilot/terminal` e nas integrações que o sustentam**.

### Addendum desta rodada — foco em `session-events.d.ts` (linhas 946–1828)

Esta rodada acrescenta uma trilha específica para a cadeia:

`session event vanilla → event-handlers → agent event normalizado → terminal explicit handler / passthrough / ignorado`.

Os achados centrais foram:

1. a cadeia session → agent → terminal já está conceitualmente boa;
2. o principal gap remanescente era de **surface canônica e UX durável**, não de wiring bruto;
3. o problema reportado pelo operador — mensagens operacionais que aparecem e somem — era real, sobretudo em `compact`, porque parte do progresso e do heartbeat existia apenas como inline status.

Isso implica a seguinte extensão prática da próxima onda obrigatória:

1. validar a leva de hardenings agora aplicada;
2. revisar `assistant.*` efêmero vs final;
3. revisar `system.notification` e sua promoção a `agent.background.*` / `agent.shell.*`;
4. revisar `hook.*`, `sampling.*`, `commands.changed`, `capabilities.changed`, `auto_mode_switch.*`, `exit_plan_mode.requested`;
5. garantir que nenhum evento relevante para operação contínua permaneça apenas como “flash” inline.
