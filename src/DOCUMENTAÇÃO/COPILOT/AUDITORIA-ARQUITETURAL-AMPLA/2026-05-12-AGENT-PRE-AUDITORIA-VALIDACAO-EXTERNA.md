# 2026-05-12 — Pré-auditoria `src/copilot/agent`: validação factual da auditoria externa

**Data:** 2026-05-12 **Escopo:** `src/copilot/agent/**` (118 arquivos JS, ~21.5k linhas)
**Objetivo:** validar tecnicamente, com evidência direta de código, os achados da auditoria externa
(`AUDIT_EXTERNA_12-05-2026-23:35-CLAUDE-SONNET.md`) e preparar a auditoria própria + roadmap de
convergência arquitetural 2.0/2.1.

---

## Método de validação (sem achismo)

1. Leitura integral dos dois documentos solicitados:
   - `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/AUDIT_EXTERNA_12-05-2026-23:35-CLAUDE-SONNET.md`
   - `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-12-PRESENTATION-BARREL-FIRST-ARQUITETURA-2.1.md`
2. Leitura integral dos arquivos-fonte citados no relatório externo (hotspots P0/P1/P2/SDK/ARCH).
3. Extração de evidências por linha (grep + leitura direta), com classificação:
   - **CONFIRMADO**: problema/gap está presente no código atual.
   - **PARCIAL**: há fundamento, mas com nuances importantes (severidade/causa/escopo divergentes).
   - **NÃO CONFIRMADO**: o estado atual já mitigou ou contradiz o claim.

---

## Baseline estrutural atual do módulo

- Total observado: **118 arquivos JS** em `src/copilot/agent`.
- Volume aproximado: **21,538 linhas**.
- Hotspots de tamanho atuais (top):
  - `always-alive.js` (1162)
  - `agent-context.js` (815)
  - `types.js` (761)
  - `dialog/orchestrators/loop-manager.js` (720)
  - `lifecycle/orchestrators/agent-lifecycle.js` (664)
  - `messaging/agent-messaging.js` (545)

- Arquivos JS ainda presentes no root de `src/copilot/agent`: **15**
  - `agent-context.js`
  - `agent-runtime-surface.js`
  - `always-alive-singleton.js`
  - `always-alive.js`
  - `background-tasks.js`
  - `context-factories.js`
  - `di-tokens.js`
  - `error-policy.js`
  - `event-bridge-map.js`
  - `event-bridge-wiring.js`
  - `health-check.js`
  - `index.js`
  - `runtime-contracts.js`
  - `runtime-registry.js`
  - `types.js`

Leitura: o módulo já está bastante modularizado por subdomínios físicos, porém mantém **superfície
pública raiz larga**, hotspots de alta complexidade e alguns riscos de lifecycle/concorrência. Após
a retomada C3.1/C3.2 de 2026-05-13, `agent-context.js` deixou de ser o maior hotspot e
`always-alive.js` perdeu a responsabilidade de singleton/proxy, mas ainda concentra muitos métodos
delegadores da fachada viva.

Leitura ampliada desta rodada: o problema atual não é mais “ausência de arquitetura”, e sim
**sobreposição de superfícies e de fluxos operacionais**. O boot está canônico; a operação do
runtime ainda não.

---

## Matriz de validação dos pontos externos

## P0 (críticos)

1. **P0-1 forceDeactivate pendura turns** → **CONFIRMADO** Evidência:
   - `dialog/orchestrators/loop-manager.js:601` emite `stopped` com `authorized: false` em
     `forceDeactivate()`.
   - `dialog/seams/turn-result-persistence.js:118-132` (`onStopOuter`) com `authorized: false` entra
     em `waitForRestartAndReplyFn(...)`.
   - `dialog/executors/turn-executor.js:340-354` retry aguarda READY/REPLY; com loop desativado pode
     ficar aguardando até timeout `null`.

2. **P0-2 dupla inicialização de `toolSessionContext`** → **CONFIRMADO** Evidência:
   - `agent-context.js:153` (field initializer)
   - `agent-context.js:240` (nova criação no construtor)

3. **P0-3 top-level await em initializer bloqueia cadeia de import** → **CONFIRMADO** Evidência:
   - `session/initializers/initializer.js:58` (`await loadAgentSdkToolsConfigAsync();` no topo de
     módulo)

4. **P0-4 race `clearState()` vs `writeStateAsync()` gera state fantasma em disco** → **CONFIRMADO**
   Evidência:
   - `lifecycle/state/state-io.js:188-191`: escrita em disco ocorre antes de validar `_clearGen`.
   - `_clearGen` só protege cache, não impede persistência stale no arquivo.

## P1 (alto)

1. **Setters não tratam `undefined`** → **CONFIRMADO** Evidência: múltiplos setters checam apenas
   `value === null` (ex.: `agent-context.js:257`, `271`, `335`, `409`, `423`, `453`, `477`).

2. **`startKeepalive` usa `this.status` em vez de método semântico** → **CONFIRMADO** Evidência:
   `agent-context.js:1530`.

3. **Duplo `recordFailure()` no boot circuit** → **CONFIRMADO** Evidência:
   - `dialog/boot/loop-boot-runner.js` já registra falha em `markBootFailed()`.
   - `dialog/orchestrators/loop-manager.js:289` registra novamente no `catch` de `start()`.

4. **`waitForRestartAndReply` sem cleanup explícito no `onRetryStopped`** → **PARCIAL** Evidência:
   - `turn-executor.js:340-353`: `onRetryStopped` não remove `onRetryReply` inline.
   - Porém `settleReject()` chama `cleanup()` central (remove listeners), reduzindo risco de leak
     efetivo. Conclusão: problema principal aqui é **legibilidade/robustez defensiva**, não leak
     inevitável.

5. **FSM não enforce em `setStatus`** → **CONFIRMADO** Evidência: `agent-context.js:1936-1945`
   apenas loga warning e aplica transição inválida.

6. **P1-6 reconnect flag** → **NÃO CONFIRMADO (como bug atual)** Evidência:
   - `lifecycle/orchestrators/agent-lifecycle.js:631-662` já protege com `try/finally`
     (`setReconnectState(false)`). Observação: ainda vale documentação de contrato para usos diretos
     de `tryReconnect` fora do wrapper.

7. **P1-7 keepalive tick sem catch global** → **PARCIAL** Evidência:
   `session/lifecycle/keepalive.js` usa `try/finally` e `withAgentErrorPolicy` para
   `performKeepalive`, mas exceções em callbacks de estado podem sair sem log dedicado.

8. **P1-8 timer de boot recovery não cancelável explicitamente** → **CONFIRMADO** Evidência:
   `session/boot/boot-dialog-recovery.js:27-40` agenda timer e não retorna cancel handle.

## P2 (médio)

1. **`isBootTimeoutError` usa string match frágil** → **CONFIRMADO** Evidência:
   `dialog/boot/loop-boot-runner.js:55` usa `message.includes('Boot timeout')`.

2. **`MessageQueue.drain()` clona erro para todos quando `tasks.length > 1`** → **CONFIRMADO**
   Evidência: `infra/message-queue.js` usa condição global por lote, não por índice.

3. **Dual API `setRuntimeStatus` vs setter `status`** → **CONFIRMADO** Evidência: `agent-context.js`
   expõe setter `status` sem emissão de evento; risco de uso inconsistente.

4. **`hook-context` sem mutex de construção** → **CONFIRMADO** Evidência: não há
   `_buildContextPromise` ou lock em `buildHookSystemContextSafe()`.

5. **Regex ANSI parcial em `sanitizeBriefingContent`** → **CONFIRMADO** Evidência:
   `hook-context.js:41` cobre apenas sequência `ESC[` (CSI), não cobre todos os casos ANSI/VT100.

6. **`getQueueSnapshot` expõe `oldest` vivo** → **CONFIRMADO** Evidência: `agent-context.js:620-623`
   retorna `oldest: this.messageQueue.oldest`.

7. **`pruneSnapshotFilesAsync` race multiprocesso** → **PARCIAL** Evidência: algoritmo é lock-free
   (`session/state/snapshot-store.js`); em multiprocesso pode haver contagem inexata, mas remoção é
   idempotente (`rm force`).

8. **`DialogLoopManager.stop()` timer logic complexa** → **NÃO CONFIRMADO como bug** Evidência:
   cleanup existe em `finally`; ponto é de complexidade/manutenibilidade, não falha direta
   confirmada.

## P3 / qualidade

- **P3-2 (`agent/index.js` com `export *`)** → **CORRIGIDO na rodada 2026-05-13**: root barrel
  passou a usar reexports explícitos.
- **P3-3 Proxy chama `getAgent()` em toda operação** → **MITIGADO/ISOLADO na rodada 2026-05-13**: o
  proxy permanece por compatibilidade, mas foi movido para `always-alive-singleton.js`; a classe
  `AlwaysAliveAgent` não possui mais o estado singleton/proxy.
- **P3-4 leitura frequente de briefing/session sem cache TTL** → **CONFIRMADO** (`hook-context.js`).
- **P3-7 guarda redundante em `normalizeAgentError`** → **não revalidado nesta pré-fase** (vai para
  auditoria completa).

## SDK gaps

1. **SDK-1 setModel/switchModel** → **CORRIGIDO na rodada 2026-05-13** Evidência:
   - `sdk/session/wrapper.js` resolve `session.setModel()` e, quando ausente,
     `session.switchModel()`;
   - se nenhuma API nativa existir, o wrapper cai para `rpc.model.switchTo()`;
   - `agent/facades/sdk/client.js` considera `setModel` ou `switchModel` para
     `modelSwitchAvailable`.

2. **SDK-2 `systemMessage.mode: customize`** → **NÃO CONFIRMADO como gap atual** Evidência:
   `config/system-prompt/live-builders.js` já usa `customizeSystemMessage(...)` quando compatível.

3. **SDK-3 Symbol.asyncDispose vs Node** → **NÃO CONFIRMADO no contexto atual** Motivo: baseline do
   repositório e ambiente já estão em Node >= 24.

4. **SDK-6 plan_changed não subscrito** → **NÃO CONFIRMADO** Evidência:
   - `session/wiring/event-wirer.js:75` inclui `wireModeAndToolEvents`.
   - `event-handlers/mode-and-tools.js` já trata `SESSION_PLAN_CHANGED`.

## Déficit arquitetural 2.1

- **CONFIRMADO**: `agent/` ainda não atingiu o mesmo nível barrel-first de `presentation/`.
  - `agent/index.js` é amplo e reexporta via `export *`.
  - `package.json` ainda expõe `#copilot/agent/*` genérico (não superfícies subdomínio explícitas
    como em `presentation`).

---

## Resultado desta pré-auditoria

### Status pós-correção (rodada atual)

Após a validação inicial, uma rodada de correções amplas já foi aplicada no código-fonte do `agent`,
endereçando parte relevante dos itens confirmados (P0/P1/P2), com foco em lifecycle, state I/O, hook
context, boundary SDK e surface pública.

Itens com correção direta aplicada nesta rodada incluem:

- P0-2 (dupla inicialização `toolSessionContext`),
- P0-3 (top-level await em `initializer`),
- P0-4 (race de write em `state-io`, com guardas adicionais pré-write),
- P1-1 (setters com `undefined`),
- P1-3 (duplo `recordFailure`),
- P1-5 (FSM agora bloqueia transição inválida),
- P1-8 (timer de boot recovery agora cancelável no teardown via `unsubs`),
- P2-4/P2-5 (hardening em `hook-context`),
- P2-6 (`getQueueSnapshot` sem exposição de task viva).

Além disso, foi iniciado o eixo arquitetural 2.1 com aliases explícitos por subdomínio em
`package.json` e barrel dedicado em `agent/runtime/index.js`.

Na sequência, uma onda adicional de convergência C2 foi aplicada nos consumidores reais (`channel`,
`conversation-hub`, `presentation/runtime`), migrando consumo operacional de `#copilot/agent` para
`#copilot/agent/facades` e subpaths explícitos (`error-policy`, `runtime-registry`, `always-alive`).

Métrica observada em `src/copilot` após essa onda:

- imports exatos `from '#copilot/agent'`: **2**
- imports `from '#copilot/agent/facades'`: **17**

Isso confirmou redução material do root barrel como hub operacional e avanço concreto para o padrão
barrel-first 2.1.

Rodada adicional (2026-05-13) consolidou o hardening de tipagem no escopo `src/copilot`:

- `typecheck:strict:src.copilot` executado com sucesso (verde);
- correção de contrato entre `agent-context`/`agent-state` e `observability/snapshots` para
  `queueOldest` serializável;
- proteção de índice em `message-queue` sob strict;
- remoção do último import de produção ao root `#copilot/agent`;
- migração dos testes unitários para subpaths explícitos (`always-alive`, `runtime-registry`,
  `di-tokens`), zerando também os imports root em `tests`.

Estado consolidado atual:

- `src/copilot`: imports `from '#copilot/agent'` = **0**;
- `tests`: imports `from '#copilot/agent'` = **0**;
- `src/copilot`: imports `from '#copilot/agent/facades'` = **17**.

### Atualização factual — investigação ampliada de arquitetura/fluxo (2026-05-13)

A leitura cruzada entre `boot/`, `runtime-wiring.js`, `presentation/`, `server/`, `terminal/`,
`channel/` e `conversation-hub/` confirmou o seguinte quadro:

#### 1. Boot canônico: **confirmado e saudável**

O contrato declarado em `src/copilot/boot/contract.js` corresponde ao runtime real:

- `terminal/bootstrap.js`
- `boot/runtime-bootstrap.js`
- `runtime-wiring.js`
- `terminal/runtime-root.js`
- `server/index.js`

Conclusão: **não há mais arquitetura paralela relevante no boot**.

#### 2. Runtime access path: **quase canônico, mas ainda múltiplo na superfície**

Hoje convivem, para o mesmo runtime, ao menos quatro superfícies importantes:

- `agent/index.js` — root público ainda largo;
- `agent/facades/index.js` — surface pública operacional moderna;
- `agent/runtime/root-surface/index.js` — surface interna da classe viva;
- `agent/agent-runtime-surface.js` — shim/barrel legado de compatibilidade.

Conclusão: a convergência 2.1 avançou, porém **ainda não existe surface única plenamente nítida**.

#### 3. Fluxos de interação: **paralelos por capability, não ainda unificados por policy**

Foram confirmados múltiplos ingressos operacionais sobre o mesmo runtime:

- `sendMessage()` (queue/simple chat)
- `sendDialogTurn()` (dialog loop)
- `handleInject()` (intervention / zero-PR / steer / abort / interrupt)
- `conversation-hub/send-pipeline.js` (hub-send com múltiplas estratégias)
- `channel/client.js` (bridge em-processo)

Essas capabilities podem ser legítimas, mas a política de escolha/fallback entre elas ainda está
dispersa.

#### 4. Relação `agent` ↔ `presentation`: **boa direção, fronteira ainda vazando policy**

`presentation/runtime/*` está bem alinhada ao papel de projection/access layer. Porém
`presentation/agent/control/handlers.js` ainda concentra policy operacional demais, funcionando em
vários cenários como quase-orquestrador, e não apenas como adaptador de borda.

#### 5. Relação `agent` ↔ resto de `src/copilot`: **owner certo, gramática errada**

O owner do runtime está corretamente em `agent/`. O problema é que `server/`, `terminal/`,
`channel/` e `conversation-hub/` ainda chegam a esse owner por caminhos com gramáticas diferentes.

Em resumo:

- **boot único**: sim;
- **runtime owner único**: quase;
- **surface pública única**: ainda não;
- **fluxo único de interação**: ainda não.

### Atualização factual pós-retomada C3.1 (2026-05-13)

A retomada da subfase C3.1 confirmou que a execução anterior havia parado em estado intermediário:

- arquivos `src/copilot/agent/context/*` já estavam criados;
- porém `src/copilot/agent/agent-context.js` ainda não delegava para eles e permanecia com ~1.956
  linhas.

Correção aplicada nesta rodada:

- `agent-context.js` foi reescrito como composition root + camada de compatibilidade, delegando
  para:
  - `agent-context-fsm.js`;
  - `agent-context-session-ops.js`;
  - `agent-context-runtime-ops.js`;
  - `agent-context-metrics-ops.js`;
  - `agent-context-dialog-ops.js`;
  - `agent-context-tool-ops.js`;
  - `agent-context-helpers.js`.
- tamanho final de `agent-context.js`: **815 linhas**;
- `npm run typecheck:strict:src.copilot`: **verde**.

Bug/gap adicional descoberto durante validação:

- O gerador de aliases em `vitest.copilot.config.js` usava aliases exatos como string simples. Com
  os novos subpaths explícitos de C2, `#copilot/agent/session` passou a capturar indevidamente
  imports como `#copilot/agent/session/history/history-sync`, quebrando testes por
  `Cannot find module`.
- Correção aplicada: aliases exatos agora são RegExp ancoradas (`^specifier$`), preservando a
  resolução por wildcard `#copilot/agent/*` para deep imports de teste/white-box.

Status de gates após esta rodada:

- `typecheck:strict:src.copilot`: **verde**;
- `test:copilot:unit`: **verde** após atualização dos mocks de terminal para interceptarem os seams
  explícitos (`#copilot/agent/facades`, `#copilot/agent/runtime-registry`,
  `#copilot/agent/always-alive` e `#copilot/agent/error-policy`): **2606/2606** testes e **874/874**
  suites.
- contratos arquiteturais (`test_arch_contracts` + `test_owner_sovereignty_block_a`): **79/79
  verde**.

### Atualização factual pós-início C3.2 (2026-05-13)

Entrega aplicada:

- `always-alive.js` reduziu de **1248** para **1162** linhas;
- novo `always-alive-singleton.js` (**105** linhas) concentra `_alwaysAliveAgent`, `getAgent()`,
  `resetAgent()`, proxy `alwaysAliveAgent`, registro em `runtime-registry` e wiring lazy do
  EventBus;
- leituras de `permissionPolicy` e `ToolSessionContext` passaram a sair por
  `runtime/governance-readers.js`, eliminando acessos crus remanescentes de `AlwaysAliveAgent` ao
  `ctx` para governance/tool-session;
- a surface interna de `AlwaysAliveAgent` foi movida para `agent/runtime/root-surface/index.js`;
  `agent-runtime-surface.js` permanece apenas como barrel legado de compatibilidade;
- `always-alive-singleton.js` não depende mais de `agent-runtime-surface.js`, importando
  `event-bridge-wiring.js` e `runtime-registry.js` diretamente como composition root explícito;
- `#copilot/agent/always-alive` passou a apontar explicitamente para o composition root singleton,
  preservando API pública e separando classe/fachada de runtime/composição;
- novo `agent/context/index.js` (**107** linhas) formaliza `#copilot/agent/context` como barrel puro
  do subdomínio C3.1;
- `agent/index.js` reexporta `AgentContext` via esse barrel e segue sem `export *`.

Classificação adicional:

- P3-3 deixa de ser bug estrutural dentro de `always-alive.js`; permanece como custo de compat no
  composition root singleton.
- Déficit 2.1 de subpath `#copilot/agent/context` passa de **pendente** para **corrigido**.
- Próximo gap real de C3.2: a classe `AlwaysAliveAgent` ainda tem muitos delegadores; a próxima
  extração deve reduzir essa superfície sem perder tipagem da shape pública nem reabrir deep-imports
  dispersos.

Classificação atual dos achados externos reavaliados:

- P3-2 (`agent/index.js` com `export *`) permanece **corrigido**.
- Déficit C3.1 de `agent-context.js` passa de **confirmado/pendente** para **corrigido**.
- Gap de teste/infra C2 foi **corrigido** nesta rodada: mocks e contratos reconhecem subpaths
  explícitos como superfície pública deliberada.

### Atualização factual pós-ONDA 2 barrel-first (2026-05-13)

Retomada adicional da ONDA 2, antes de continuar a decomposição de `AlwaysAliveAgent`:

- `typecheck:strict:src.copilot` foi executado primeiro e falhou por barrels auto-referenciais criados na migração
  parcial anterior:
  - `agent/error/index.js`;
  - `agent/runtime/contracts/index.js`;
  - `agent/event-bridge/index.js`.
- Correção aplicada:
  - `agent/error/index.js` reexporta `error-policy.js`;
  - `agent/runtime/contracts/index.js` reexporta `runtime-contracts.js`;
  - `agent/event-bridge/index.js` reexporta `event-bridge-wiring.js` e `event-bridge-map.js`.
- Migração concluída de imports operacionais cross-folder em `agent` para barrels/superfícies públicas:
  - `#copilot/config` e `#copilot/config/agent`;
  - `#copilot/core`;
  - `#copilot/dialog`;
  - `#copilot/bridges`;
  - `#copilot/event-handlers`;
  - `#copilot/observability`;
  - `#copilot/sdk`;
  - sub-barrels internos `*/index.js`.
- Superfícies corrigidas fora de `agent`:
  - `#copilot/dialog` adicionado ao import map e ao `tsconfig.base.json`;
  - `#copilot/bridges` exporta `createMcpToolBridge`;
  - `#copilot/observability` exporta `buildStatusSnapshot`;
  - `#copilot/config/agent` foi formalizado como sub-barrel público das constantes operacionais de `config/agent.js`,
    preservando o root `#copilot/config` mais estreito.
- Novo guardrail:
  - `tests/unit/copilot/contracts/test_agent_barrel_governance.spec.js` valida que todo `index.js` de `agent` é barrel
    puro e que imports internos cross-folder passam por barrels.

Métrica pós-ONDA 2:

- `crossFolderLeafNonIndex(agent)`: **0**;
- `sameFolderLeafNonIndex(agent)`: **12**;
- `indexBarrelLeafExports(agent)`: **173**.

Gates:

- `npm run typecheck:strict:src.copilot`: **verde**;
- `npm run test:copilot:unit`: **2609/2609 verde**.

Status reavaliado:

- ONDA 2 barrel-first operacional: **concluída**;
- Padrão `terminal`/`presentation` aplicado ao `agent` no escopo de imports cross-folder operacionais;
- wildcard `#copilot/agent/*` permanece como compatibilidade white-box/testes, ainda rastreado como dívida de surface
  pública futura, não como bloqueio da ONDA 2.

### Síntese objetiva

- A auditoria externa está **majoritariamente correta** nos problemas críticos e de governança
  arquitetural.
- Há **divergências pontuais** (itens já resolvidos/parcialmente mitigados), principalmente em
  eventos SDK e alguns itens de severidade.
- A investigação ampliada mostrou que o próximo salto de qualidade não é apenas continuar quebrando
  hotspots: é **unificar superfície e fluxo** entre `agent`, `presentation`, `server`, `terminal`,
  `channel` e `conversation-hub`.
- Há base factual suficiente para um roadmap ampliado em **faixas → fases → subfases**, cobrindo:
  1. correções de bugs e concorrência/lifecycle;
  2. convergência barrel-first 2.1 em `agent/`;
  3. limpeza do root e redução de superfícies concorrentes;
  4. criação de taxonomia/owner únicos para os fluxos de interação;
  5. guardrails automáticos contra regressão estrutural e regressão de fluxo.

---

## Próximo artefato

O próximo documento consolida:

- situação atual detalhada de `agent/`;
- situação ideal 2.1-alvo;
- backlog completo sem gaps;
- roadmap operacional com **faixas, fases e subfases**, com critérios de entrada/saída e
  dependências.

---

## Atualização factual adicional — acoplamento canônico externo (2026-05-13)

Além do fechamento barrel-first da ONDA 2, foi executada uma rodada ampla de consolidação do
acoplamento externo do runtime:

- criado `src/copilot/runtime/index.js` com alias `#copilot/runtime`;
- migrados para esse seam:
  - `channel/client-dialog.js`
  - `channel/client.js`
  - `conversation-hub/call-strategies.js`
  - `terminal/frontend/gateways/agent-runtime.js`
  - `runtime-wiring.js` (para leitura de estado)
- criado `src/copilot/event-handlers/contracts.js` para concentrar typedefs antes acoplados ao
  módulo concreto `agent/session/wiring/event-wirer.js`.

Métrica objetiva:

- referências externas diretas a `agent/*` caíram de **50** para **38** arquivos.

Leitura revisada:

- **ONDA 2** está realmente concluída;
- **ONDA 3 / C3.3** ainda não está concluída;
- o que mudou nesta rodada foi a clareza da fronteira: o acoplamento operacional fora do owner
  deixou de ser difuso e passou a ter seam nomeado e governado.

Bug arquitetural encontrado e sanado:

- `runtime-selection` importava `presentation/routing/index.js` e puxava `presentation/state/ui-store`
  por side-effect;
- a correção foi estreitar o import para `presentation/routing/targeting.js`.

Gates desta rodada:

- `npm run typecheck:strict:src.copilot`: **verde**
- `npm run typecheck:strict:tests.unit`: **verde**
- `npm run test:copilot:unit`: **2614/2614** verdes
