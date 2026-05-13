# 2026-05-12 — Auditoria própria completa de `src/copilot/agent` + roadmap 2.1

**Data:** 2026-05-12 **Escopo:** `src/copilot/agent/**` **Objetivo:** consolidar diagnóstico técnico
atual, estado ideal arquitetural 2.0/2.1 e plano completo (faixas, fases e subfases) para eliminar
bugs/gaps e convergir o módulo `agent` para governança barrel-first robusta.

> **Delta de execução (rodada atual)**
>
> Foram aplicadas correções amplas diretamente no código, cobrindo parte substancial da Faixa A/B e
> início da Faixa C2:
>
> - `AgentContext`: remoção da dupla inicialização de `toolSessionContext`; setters harden para
>   `null|undefined`; `getQueueSnapshot` sem referência viva; `startKeepalive` semântico; FSM com
>   bloqueio efetivo de transições inválidas;
> - `DialogLoopManager`: remoção de dupla contagem de falha de boot e ajuste de `forceDeactivate`
>   para encerramento sem retry indevido;
> - `turn-executor`: cleanup defensivo adicional no caminho `stopped during retry`;
> - `initializer`: remoção de top-level await e lazy-load singleton para config de tools;
> - `state-io`: guardas extras anti-race antes da escrita em disco;
> - `hook-context`: sanitização ANSI expandida + deduplicação concorrente de
>   `buildHookSystemContextSafe`;
> - `runtime-contracts`: remoção de gate rígido por `setModel` no boundary;
> - `boot-dialog-recovery`: timer de recovery cancelável com registro no `unsubs` do pipeline de
>   boot;
> - `message-queue`: semântica de clonagem de erro por item clarificada;
> - `package.json` + `agent/runtime/index.js`: início da convergência barrel-first com aliases
>   explícitos por subdomínio e barrel `runtime` dedicado sem colisões de export.

> **Delta de execução — 2026-05-13 (onda de convergência ampla C2 em consumers reais)**
>
> Foi executada uma migração abrangente de imports em consumidores de alto tráfego para reduzir
> acoplamento ao root barrel `#copilot/agent`:
>
> - `channel/` (`client.js`, `client-dialog.js`) migrou para `#copilot/agent/facades`;
> - `conversation-hub/call-strategies.js` migrou para `#copilot/agent/facades`;
> - `presentation/runtime/*` (controls, dialog, health, models, overview, sdk-session, status,
>   tools, todos, ownership, webhooks, capabilities) migrou para `#copilot/agent/facades`;
> - `presentation/agent/http-errors.js` migrou para subpath explícito `#copilot/agent/error-policy`;
> - `presentation/agent/runtime/runtime-selection.js` migrou para subpaths explícitos
>   `#copilot/agent/runtime-registry` + `#copilot/agent/always-alive` + `#copilot/agent/facades`;
> - `runtime-wiring.js` manteve root apenas para composição/tokens e moveu leitura de estado para
>   `#copilot/agent/facades`.
>
> **Métrica objetiva pós-onda (src/copilot):**
>
> - imports exatos `from '#copilot/agent'`: **2**;
> - imports `from '#copilot/agent/facades'`: **17**.
>
> Interpretação: o root barrel deixou de ser rota default de consumo operacional e passou a ser
> majoritariamente composição/entrypoint, em linha com a diretriz 2.1 de superfícies explícitas por
> subdomínio.

> **Delta de execução — 2026-05-13 (strict + hardening de tipos pós-onda C2)**
>
> - `npm run typecheck:strict:src.copilot` executado e estabilizado em verde após correções;
> - Correções de tipagem aplicadas:
>   - `agent/infra/message-queue.js`: guarda explícita para `tasks[i]` sob
>     `noUncheckedIndexedAccess`;
>   - `observability/snapshots.js`: contrato de `queueOldest` alinhado ao snapshot serializável
>     (`{ id, enqueuedAt }`);
> - `runtime-wiring.js` deixou de importar `#copilot/agent` root e passou a consumir sub-superfícies
>   explícitas (`always-alive`, `di-tokens`, `ports`, `facades`);
> - `channel/index.js` (exemplo JSDoc) ajustado para não incentivar import do root barrel.
>
> **Métrica pós-hardening:** em `src/copilot`, imports exatos `from '#copilot/agent'` no código de
> produção: **0** (ocorrências remanescentes apenas em testes/documentação).

> **Delta de execução — 2026-05-13 (minimização final do root barrel + testes)**
>
> - `src/copilot/agent/index.js` deixou de usar `export *` e passou a expor surface 100% explícita
>   (dialog/infra/lifecycle/messaging/session/state);
> - consumidores de teste também migrados para subpaths explícitos (`always-alive`,
>   `runtime-registry`, `di-tokens`), removendo imports residuais de `#copilot/agent`;
> - `typecheck:strict:src.copilot` reexecutado em verde após a refatoração.
>
> **Métrica atualizada:**
>
> - `src/copilot`: imports `from '#copilot/agent'` = **0**;
> - `tests`: imports `from '#copilot/agent'` = **0**;
> - `src/copilot`: imports `from '#copilot/agent/facades'` = **17**.

> **Delta de execução — 2026-05-13 (C3.1 retomada e concluída em `AgentContext`)**
>
> A subfase C3.1 havia ficado parcialmente iniciada: os módulos `src/copilot/agent/context/*`
> existiam, mas `agent-context.js` ainda concentrava praticamente toda a implementação. A retomada
> desta rodada concluiu a virada:
>
> - `agent-context.js` passou de **~1.956 linhas** para **815 linhas**, abaixo do DoD de 900 linhas;
> - a classe ficou restrita a composition root, estado vivo, factories/managers, accessors de
>   compatibilidade e delegação;
> - regras foram movidas/ativadas por domínio:
>   - `agent-context-fsm.js` para status/FSM;
>   - `agent-context-session-ops.js` para sessão/client/reconnect/context-window;
>   - `agent-context-runtime-ops.js` para timers, observers, quota e reports;
>   - `agent-context-metrics-ops.js` para cache de snapshot, send count e PR info;
>   - `agent-context-dialog-ops.js` para pending question, shadow e elicitation;
>   - `agent-context-tool-ops.js` + `agent-context-helpers.js` para permissions/tools registry.
> - `npm run typecheck:strict:src.copilot` executado em verde após a decomposição.
>
> **Bug novo confirmado e corrigido durante a validação:** `vitest.copilot.config.js` gerava aliases
> exatos como string simples; após C2, aliases como `#copilot/agent/session` interceptavam deep
> imports de teste como `#copilot/agent/session/history/history-sync`. O alias builder agora ancora
> imports exatos com RegExp `^...$`, preservando o fallback `#copilot/agent/*`.
>
> **Gates pós-C3.1:**
>
> - `typecheck:strict:src.copilot`: **verde**;
> - `test:copilot:unit`: **verde** após atualizar mocks/contratos de terminal para os seams
>   explícitos 2.1 (`facades`, `runtime-registry`, `always-alive`, `error-policy`, `ports`,
>   `di-tokens`);
> - contratos arquiteturais rebaselined para a política 2.1 (`test_arch_contracts` +
>   `test_owner_sovereignty_block_a`): **79/79 verde**.

> **Delta de execução — 2026-05-13 (C3.2 iniciada em `always-alive`)**
>
> A subfase C3.2 avançou no mesmo padrão arquitetural já usado em `terminal` e `presentation`:
>
> - `always-alive.js` deixou de possuir o estado singleton lazy, proxy de compatibilidade e registro
>   do runtime default;
> - novo composition root explícito `always-alive-singleton.js` concentra `_alwaysAliveAgent`,
>   `getAgent()`, `resetAgent()`, proxy `alwaysAliveAgent`, registro em `runtime-registry` e wiring
>   lazy do EventBus;
> - `#copilot/agent/always-alive` agora aponta explicitamente para
>   `src/copilot/agent/always-alive-singleton.js`, preservando compatibilidade de API e separando
>   classe/fachada de runtime/composição;
> - leituras residuais de governance (`permissionPolicy`) e `ToolSessionContext` deixaram de acessar
>   `this.ctx` diretamente em `AlwaysAliveAgent` e passaram por readers canônicos em
>   `runtime/governance-readers.js`;
> - a root surface interna usada por `AlwaysAliveAgent` foi movida para o subdomínio
>   `agent/runtime/root-surface/index.js`; `agent-runtime-surface.js` ficou como barrel legado fino
>   de compatibilidade, e novos consumidores internos devem preferir o subdomínio `runtime`;
> - `always-alive-singleton.js` deixou de consumir `agent-runtime-surface.js` e passou a importar
>   explicitamente `event-bridge-wiring.js` e `runtime-registry.js`;
> - `agent/context/index.js` foi criado como barrel puro do subdomínio C3.1 e
>   `#copilot/agent/context` foi adicionado ao import map;
> - `agent/index.js` continua sem `export *` e passou a reexportar `AgentContext` pelo novo barrel.
>
> **Métrica pós-C3.2 parcial:**
>
> - `always-alive.js`: **1162 linhas** (antes 1248), agora sem singleton/proxy/registry logic, sem
>   acesso direto a `ctx` para governance/tool-session e importando a surface interna por
>   `runtime/root-surface`;
> - `agent-runtime-surface.js`: barrel legado fino;
> - `agent/runtime/root-surface/index.js`: barrel interno canônico da fachada viva;
> - `always-alive-singleton.js`: **105 linhas**, composition root nomeado;
> - `agent-context.js`: **815 linhas**;
> - `agent/context/index.js`: **107 linhas**, barrel explícito.
>
> **Gates pós-C3.2 parcial:**

> **Delta de execução — 2026-05-13 (Onda 1 C1.3 executada: barrels estruturais no `agent`)**
>
> - foram criados `index.js` em **24 subpastas** do `agent` que ainda não tinham barrel;
> - cobertura estrutural passou para: diretórios com `.js` = **35**, sem `index.js` = **0**;
> - durante a execução, três barrels geraram colisão de `export *` no typecheck e foram corrigidos
>   para export em namespace (`dialog/boot`, `session/boot`, `session/state`);
> - `npm run typecheck:strict:src.copilot` reexecutado e estabilizado em verde após os ajustes.
>
> **Leitura pós-Onda 1:** infraestrutura de barrels fechada; próximo passo é Onda 2 (rewiring de
> imports folha para `index.js`) até eliminar deep-import relativo dentro do `agent`.

> **Delta de execução — 2026-05-13 (Onda 2 C1.3 parcial: rewiring de hotspots para barrels)**
>
> Foram migrados para consumo via `index.js` (sem compat/shim):
>
> - `lifecycle/orchestrators/agent-lifecycle.js`;
> - `context-factories.js`;
> - `lifecycle/entrypoints/entry.js`;
> - `session/boot/boot-runtime-bind.js`;
> - `dialog/orchestrators/loop-manager.js`;
> - `lifecycle/setup/session-setup.js`.
>
> Ajustes de barrel necessários durante a migração:
>
> - `session/boot/index.js`: exports diretos de `performBootWiring` e
>   `reapExpiredPendingQuestionShadow`;
> - `session/state/index.js`: export direto de `ownership` além dos namespaces;
> - `dialog/boot/index.js`: exports diretos de `DialogBootCircuit`, `runDialogLoopBoot` e
>   `createDialogLoopRuntimeKit`;
> - `facades/index.js`: exports adicionais para fechar surface consumida por boot/dialog.
>
> **Métrica pós-Onda 2 parcial (`src/copilot/agent`)**:
>
> - imports relativos totais: **238**;
> - via barrel (`index.js`): **43**;
> - via arquivo folha: **195**;
> - redução de imports folha: **251 → 195** (**-56**, ~22.3%).
>
> - `npm run typecheck:strict:src.copilot`: **verde**;
> - `npm run test:copilot:unit`: **verde** (**2606/2606** testes; **874/874** suites).

---

## 1) Estado atual validado (AS-IS)

## 1.1 Leitura estrutural real após a rodada de maio/2026

O diagnóstico ampliado mostra que o problema principal do domínio `agent` **já não é apenas tamanho
de arquivo ou falta de barrels**. O problema central agora é **sobreposição de superfícies e de
fluxos operacionais**.

Hoje o sistema tem avanços reais de 2.1:

1. **Boot canônico único já existe e está claro**:
   `terminal/bootstrap.js` → `boot/runtime-bootstrap.js` → `runtime-wiring.js` → `terminal/` +
   `server/`.
2. **`presentation/` já opera como camada compartilhada de borda**, evitando que `server/` e
   partes compartilhadas de `terminal/` importem detalhes internos do runtime diretamente.
3. **`agent/` já está materialmente modularizado** em `dialog/`, `lifecycle/`, `session/`,
   `messaging/`, `infra/`, `facades/`, `runtime/`, `ports/`, `state/` e `context/`.
4. **`AgentContext` e o singleton default já foram parcialmente saneados**, reduzindo acoplamento
   cru e removendo parte da ambiguidade antiga.

Mas o AS-IS ainda revela quatro classes de confusão arquitetural:

### Métrica objetiva (2026-05-13) — imports internos via barrel no `agent` (comparado ao padrão do `terminal`)

Para evitar avaliação subjetiva, foi aplicada a mesma régua nos dois domínios (`import` relativo para `.../index.js` vs
`import` relativo para arquivo folha):

| Domínio    | Imports relativos totais | Via barrel (`index.js`) | Via arquivo folha | % barrel relativo |
| ---------- | -----------------------: | ----------------------: | ----------------: | ----------------: |
| `agent`    |                      238 |                      36 |               202 |            15.13% |
| `terminal` |                      233 |                     153 |                80 |            65.66% |

Leitura: no critério “barrel-first interno”, o `agent` ainda está muito distante do padrão já praticado no `terminal`.

Gap estrutural de barrels no `agent` (atual):

- diretórios com `.js`: **35**;
- diretórios sem `index.js`: **0**.

### A) Múltiplas superfícies sobre o mesmo runtime

O runtime vivo do agent é exposto hoje por **cinco hubs/superfícies com escopo parcialmente
sobreposto**:

1. `agent/index.js` — barrel root público ainda largo demais;
2. `agent/facades/index.js` — surface pública operacional moderna;
3. `agent/runtime/root-surface/index.js` — surface interna de delegação da classe viva;
4. `agent/agent-runtime-surface.js` — barrel legado de compatibilidade;
5. `always-alive.js` — classe pública que ainda concentra delegação demais.

O resultado é que a topologia ficou mais barrel-first, mas **ainda não ficou mono-surface**.

### B) Múltiplos ingressos de interação para a mesma LLM/runtime

Hoje há mais de um caminho operacional legítimo para falar com a mesma sessão/runtime:

1. **fila direta de tarefa** via `sendMessage()`;
2. **dialog loop** via `sendDialogTurn()`;
3. **inject/intervention** via `presentation/agent/control/handlers.js`;
4. **hub conversacional** via `conversation-hub/send-pipeline.js`;
5. **bridge em-processo** via `channel/client.js`.

Esses caminhos não são todos bugs — alguns são necessários —, porém **a política de quando usar
cada um está espalhada**, e não concentrada em um único orquestrador de interação.

### C) Root do `agent/` ainda está “barrel-first”, mas não “root-clean”

O diretório `src/copilot/agent/` ainda mantém **15 arquivos JS na raiz**:

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

Para a diretriz 2.1 pretendida pelo usuário, isso ainda é **excesso de arquivo solto no root**.

### D) `presentation/` já é boa borda, mas em alguns pontos ainda acumula policy demais

`presentation/runtime/*` está bem posicionada como camada de projection/access. Porém
`presentation/agent/control/handlers.js` hoje concentra política demais de:

- inject;
- timeout adaptativo;
- mailbox zero-PR;
- steer/intervene/abort/interrupt;
- pipeline;
- recovery;
- metrics/histórico.

Isso torna `presentation/` parcialmente **borda + orquestrador de interação**, em vez de apenas
camada compartilhada de acesso.

## 1.2 Fluxo real de ponta a ponta validado

### Fluxo canônico de boot

O boot real está consistente com a arquitetura 2.0/2.1 declarada:

1. `src/copilot/terminal/bootstrap.js`
2. `src/copilot/boot/runtime-bootstrap.js`
3. `src/copilot/runtime-wiring.js`
4. `src/copilot/terminal/runtime-root.js`
5. `src/copilot/server/index.js`
6. `src/copilot/terminal/repl/*`

Esse ponto é importante: **não existe mais confusão séria no boot owner**. A confusão está depois,
no runtime operacional e nos ingressos de interação.

### Fluxo operacional do runtime default

O runtime default segue hoje esta cadeia dominante:

1. `always-alive-singleton.js` cria/fornece o runtime default lazy;
2. `runtime-wiring.js` registra esse runtime em DI e injeta bridges (`channel`, `hub`, `tools`);
3. `presentation/agent/runtime/runtime-selection.js` resolve `runtimeId` e fallback;
4. `presentation/runtime/*` projeta leituras/controles compartilhados;
5. `server/routes/*` e `terminal/*` consomem essa camada compartilhada.

Esse fluxo é aceitável e já próximo do ideal. O desvio aparece quando, acima disso, surgem vários
“jeitos canônicos ao mesmo tempo” de interagir com a sessão.

### Fluxos de mensagem atualmente coexistentes

#### Fluxo 1 — task queue / simple chat

- `agent.sendMessage()`
- usado por `server/routes/copilot-api/tasks.js`
- usado por `channel/client.js#chat()`

#### Fluxo 2 — dialog loop canônico

- `agent.sendDialogTurn()`
- exposto por `agent/facades/agent-dialog-runtime.js`
- usado por `presentation/runtime/dialog.js`
- usado por `server/routes/copilot-api/dialog.js`
- usado por `channel/client-dialog.js`

#### Fluxo 3 — inject / intervention

- `presentation/agent/control/handlers.js#handleInject()`
- decide entre answer imediato, mailbox, steer, abort, interrupt, ou turn canônico

#### Fluxo 4 — hub conversacional

- `conversation-hub/send-pipeline.js`
- escolhe `callViaDialogLoop`, `callViaStructured` ou `callViaSimpleChat`

#### Fluxo 5 — terminal/watchdog/recovery

- `terminal/wiring/terminal-agent-wiring.js`
- aciona abort/recovery/restart e reage ao runtime por política local de UX

O problema não é a existência de todas essas capacidades; o problema é que **elas ainda não estão
reunidas sob uma taxonomia única de interação**.

## 1.3 Achados críticos ampliados

### Achados já confirmados e corrigidos ou parcialmente mitigados

- `forceDeactivate` / `pending_protocol_stopped`: corrigido no boundary para evitar hang semântico;
- race de state I/O: endurecida com guardas adicionais;
- `AgentContext`: grande avanço em coesão e decomposição;
- root barrel com `export *`: corrigido;
- imports root de produção: zerados em `src/copilot`.

### Achados centrais novos desta investigação ampliada

1. **Não há mais “arquitetura paralela de boot”, mas ainda há “arquitetura paralela de operação”.**
2. **`AlwaysAliveAgent` continua sendo um super-hub operacional**, mesmo após a retirada do
   singleton/proxy.
3. **`presentation/agent/control/handlers.js` virou um pseudo-orquestrador de interação**, e não só
   uma superfície compartilhada de borda.
4. **`conversation-hub` e `channel` ainda conseguem escolher estratégias de envio diferentes** sobre
   o mesmo runtime, o que preserva robustez, mas fragmenta a semântica do fluxo.
5. **O root do `agent/` ainda comunica “módulo em consolidação”, não “subdomínio estabilizado”.**

## 1.4 Itens externos reavaliados com a lente nova

- `session.plan_changed` sem wiring: **não procede**;
- `systemMessage customize` ausente: **não procede**;
- `Symbol.asyncDispose` incompatível: **não crítico**;
- claim de que o problema do `agent` é só barrel root largo: **insuficiente**. O problema maior
  agora é **multiplicidade de superfícies e de ingressos**.

---

## 2) Estado ideal (TO-BE) para arquitetura 2.0/2.1 em `agent` e `src/copilot`

## 2.1 Princípios-alvo

1. **Um único owner de runtime**.
2. **Uma única política de seleção/acesso ao runtime**.
3. **Uma única taxonomia de interação** (task queue, dialog turn, inject/intervention, hub) com
   semântica explícita e não sobreposta.
4. **Barrel-first por subdomínio, sem arquivos soltos fora de lugar**.
5. **`presentation/` como projection/access layer, não como segundo cérebro operacional**.
6. **`agent/` como owner do runtime, não como root com múltiplas superfícies concorrentes**.
7. **Guardrails automatizados contra drift de superfície e drift de fluxo**.

## 2.2 Topologia pública alvo

### Superfícies públicas externas

Externamente, o ideal é reduzir o contrato público para três camadas nítidas:

1. `#copilot/agent` → API pública mínima e estável;
2. `#copilot/agent/facades` → capabilities públicas explícitas de runtime;
3. `#copilot/presentation/*` → projections/access compartilhados de borda.

### Superfícies internas do runtime

Internamente, o ideal é deixar apenas:

1. `agent/runtime/root-surface/index.js` → surface interna única da classe viva;
2. barrels por subdomínio (`context`, `dialog`, `lifecycle`, `session`, `messaging`, `infra`,
   `runtime`, `state`, `ports`).

O arquivo `agent-runtime-surface.js` deve permanecer no máximo como shim transitório, com plano de
remoção explícito.

## 2.3 Estrutura de root ideal para `src/copilot/agent`

O estado alvo é **root mínimo**, sem arquivos soltos de implementação. O root deve ficar restrito a
contratos/entrypoints deliberados, por exemplo:

- `index.js`
- `always-alive-singleton.js` (ou mover para `runtime/default-runtime.js`)
- `types.js`

Todo o resto deve migrar para subdomínios apropriados:

- `agent-context.js` → `context/`
- `health-check.js` → `state/` ou `runtime/health/`
- `error-policy.js` → `runtime/` ou `lifecycle/`
- `runtime-registry.js` → `runtime/`
- `runtime-contracts.js` → `runtime/`
- `event-bridge-*` → `runtime/event-bridge/`
- `context-factories.js` → `context/`
- `background-tasks.js` → `lifecycle/` ou `infra/`

## 2.4 Fluxo único ideal

### Fluxo único de runtime

1. boot canônico cria e compõe o runtime default;
2. `runtime-wiring.js` faz somente DI/bridges;
3. `presentation/agent/runtime/runtime-selection.js` resolve `runtimeId`;
4. `presentation/runtime/*` projeta leituras e controles;
5. `server/` e `terminal/` consomem apenas essas projections/accessors.

### Fluxo único de interação

Toda entrada de mensagem/comando deve ser classificada por uma **única orquestração de interação**:

1. **queue/send**
2. **dialog-turn**
3. **intervention**
4. **hub-send**

Mas a decisão e a política de fallback entre eles deve viver em **um único módulo orquestrador**,
em vez de ficar dividida entre `presentation/agent/control/handlers.js`, `conversation-hub` e
`channel/client`.

Em outras palavras: múltiplas capacidades podem continuar existindo, mas **o cérebro que escolhe o
caminho deve ser único**.

## 2.5 Contrato ideal do root barrel

`agent/index.js` deve exportar apenas:

- `AlwaysAliveAgent`
- `alwaysAliveAgent`
- `getAgent`
- `resetAgent`
- tipos/contratos públicos realmente estáveis
- alguns seams deliberados e pequenos (`runtime-registry`, `di-tokens`, no máximo)

Não deve continuar funcionando como “barrel de quase tudo”.

---

## 3) Roadmap completo (faixas, fases e subfases)

## Faixa A — Estabilização crítica de runtime (P0/P1)

### Fase A1 — Turn lifecycle/shutdown correctness

#### Subfase A1.1 — `forceDeactivate` sem hang semântico

- Ajustar `forceDeactivate()` para sinalizar encerramento que não dispare retry indevido.
- Garantir rejeição explícita dos turns pendentes (sem depender de READY futuro).
- Status 2026-05-13: **corrigida no boundary crítico**, mas ainda precisa cobertura de regressão
  específica do fluxo completo `loop-manager → turn-result-persistence → turn-executor`.

#### Subfase A1.2 — Stop/restart contract unificado

- Revisar contratos entre `EMITTER_LOOP_STOPPED`, `authorized`, `waitForRestartAndReply`.
- Consolidar semântica de `authorized_stop`, `force_deactivate`, `model_stopped`,
  `reconnect_restart`.
- DoD: matriz de estados/eventos sem ambiguidade e coberta por testes de integração.

### Fase A2 — State I/O race hardening

#### Subfase A2.1 — Anti-race completo em `_doWriteState`

- Introduzir guardas de geração antes de `writeStateFileJson`.
- Status 2026-05-13: **endurecida**, faltando observabilidade explícita de write descartado.

#### Subfase A2.2 — Atomicidade e observabilidade de persistência

- Instrumentar métricas/eventos de conflitos de geração e descartes de write.
- DoD: diagnóstico explícito de write-cancel por geração.

### Fase A3 — AgentContext correctness

#### Subfase A3.1 — Corrigir setters null/undefined

- Status 2026-05-13: **corrigida**.

#### Subfase A3.2 — FSM enforce

- Status 2026-05-13: **corrigida**.

#### Subfase A3.3 — Encapsulamento de snapshot de fila

- Status 2026-05-13: **corrigida**.

#### Subfase A3.4 — Guardrail estrutural de C3.1

- Adicionar teste/contrato para impedir regressão de `agent-context.js` acima do threshold definido.
- DoD: C3.1 não regride por crescimento acidental.

---

## Faixa B — Compatibilidade e robustez SDK

### Fase B1 — Model switch compatibility

#### Subfase B1.1 — Neutralizar dependência hard de `setModel`

- Status 2026-05-13: **corrigida**.

#### Subfase B1.2 — Capacidades versionadas

- Expor capability map explícito para model switching no runtime.
- DoD: decisões de fallback orientadas por capability, não por tentativa ad-hoc.

### Fase B2 — Hook/system context hardening

#### Subfase B2.1 — Sanitização ANSI abrangente

- Status 2026-05-13: **endurecida**, revisar cobertura final de OSC/ST e regressão automatizada.

#### Subfase B2.2 — Deduplicação concorrente de build context

- Status 2026-05-13: **endurecida**, faltando guardrail/teste dedicado de concorrência.

### Fase B3 — Timeout/cancel contracts

#### Subfase B3.1 — Boot recovery cancelável

- Status 2026-05-13: **corrigida**, faltando apenas consolidação documental do contrato final.

---

## Faixa C — Unificação arquitetural e de fluxo (novo foco prioritário)

### Fase C0 — Arquitetura única / fluxo único

#### Subfase C0.1 — Declarar taxonomia única de interação

- Formalizar quatro modos canônicos de interação: `queue/send`, `dialog-turn`, `intervention`,
  `hub-send`.
- Proibir aliases conceituais sobrepostos sem dono claro.
- DoD: documentação e contratos usam a mesma taxonomia em `agent`, `presentation`, `server`,
  `terminal`, `channel` e `conversation-hub`.

#### Subfase C0.2 — Criar orquestrador único de interação

- Extrair a decisão operacional hoje espalhada entre `presentation/agent/control/handlers.js`,
  `conversation-hub/send-pipeline.js` e `channel/client.js` para uma única camada orquestradora.
- `presentation/` continua como borda/access layer; a policy central sai do handler-hub atual.
- DoD: decisão de caminho/fallback vive num único owner.

#### Subfase C0.3 — Eliminar superfícies concorrentes do runtime

- Tornar explícito que:
  - `agent/index.js` = root público mínimo;
  - `agent/facades/index.js` = API pública operacional;
  - `agent/runtime/root-surface/index.js` = API interna única;
  - `agent-runtime-surface.js` = shim transitório com plano de remoção.
- DoD: não há mais dúvida sobre “qual surface usar” em cada camada.

#### Subfase C0.4 — Root-clean do `agent/`

- Reduzir o root a arquivos deliberados; mover implementações soltas para subdomínios.
- DoD: root do `agent/` deixa de ser área de implementação difusa.

### Fase C1 — Surface minimization

#### Subfase C1.1 — Root barrel explícito e pequeno

- Status 2026-05-13: **parcialmente concluída**.
- Próximo passo: enxugar reexports amplos restantes do root.

#### Subfase C1.2 — Sub-barrels explícitos por domínio

- Garantir `index.js` por subdomínio com escopo claro.
- Definir "internal-only" x "public-by-design".
- DoD: deep-import não-canônico reduzido a casos de teste white-box.

#### Subfase C1.3 — Barrelização interna completa do `agent` (modelo operacional já praticado no `terminal`)

Objetivo desta subfase: tornar o `agent` **100% importável via barrel index** no consumo interno entre subdomínios,
eliminando imports relativos para arquivos folha como caminho padrão.

Escopo de ataque prioritário (por impacto medido):

1. `lifecycle/orchestrators/agent-lifecycle.js`;
2. `context-factories.js`;
3. `dialog/orchestrators/loop-manager.js`;
4. `session/boot/boot-runtime-bind.js`;
5. `agent-context.js`;
6. `lifecycle/entrypoints/entry.js`.

Critérios desta subfase:

- cada pasta de subdomínio com `.js` deve possuir `index.js` owner;
- imports relativos folha (`./foo.js`, `../x/y.js`) ficam proibidos entre subdomínios;
- política alvo: zero compat/shim/legacy para roteamento de import interno.

DoD C1.3:

- `relative_leaf_imports(agent)` = **0** no código de produção de `src/copilot/agent/**`;
- `relative_barrel_imports(agent)` torna-se o caminho dominante;
- nenhum novo diretório com `.js` sem `index.js`.

#### Subfase C1.4 — Taxonomia de barrels no `agent`

Padronizar dois tipos de barrel por subdomínio:

1. `index.js` público (consumo cross-domain);
2. `internal-index.js` opcional (uso interno especializado, sem export público).

DoD C1.4:

- todo import interno do `agent` aponta para `index.js` (ou `internal-index.js`);
- nenhum import novo para folhas.

### Fase C2 — Import map governado

#### Subfase C2.1 — Exports/imports explícitos em `package.json`

- Status 2026-05-13: **amplamente avançada**.

#### Subfase C2.2 — Rewiring de consumidores

- Status 2026-05-13: **amplamente avançada**, com `src/copilot` em zero imports root do agent.
- Próximo passo: manter governance e impedir regressão para bypass.

#### Subfase C2.3 — Migração em ondas para “imports só via barrel” dentro do `agent`

Plano de execução (seguro e incremental):

### Onda 1 — Infraestrutural (criar barrels faltantes)

- criar `index.js` nas 24 pastas sem barrel;
- começar por `dialog/*`, `lifecycle/*`, `session/*`, `facades/sdk/*`.

Gate de saída Onda 1:

- todas as pastas com `.js` em `agent` possuem `index.js`;
- typecheck e testes unitários verdes.

### Onda 2 — Migração dos hotspots

- rewiring dos 6 arquivos de maior concentração de imports folha;
- reduzir acoplamento direto a arquivos de baixo nível.

Gate de saída Onda 2:

- redução mensurável de `relative_leaf_imports(agent)` (meta intermediária: -60%);
- sem regressão de runtime/boot/reconnect/dialog.

### Onda 3 — Migração longa cauda

- migrar restantes arquivos do `agent` para barrels;
- eliminar rotas restantes de import folha sem introduzir fallback paralelo.

Gate de saída Onda 3:

- `relative_leaf_imports(agent)` = 0;
- lint arquitetural bloqueando regressão.

### Fase C3 — Hotspot decomposition

#### Subfase C3.1 — `agent-context.js`

- Status 2026-05-13: **concluída**, faltando guardrail estrutural de regressão.

#### Subfase C3.2 — `always-alive.js`

- Status 2026-05-13: **iniciada / parcialmente concluída**.
- Leitura nova desta auditoria: o objetivo já não é só “reduzir linhas”, e sim **retirar da classe
  o papel de super-hub operacional**.
- Próximo passo correto:
  1. continuar extraindo delegações em subfachadas;
  2. reduzir imports diretos da root surface interna;
  3. aproximar a classe de uma composition façade previsível.

#### Subfase C3.3 — `loop-manager.js`

- Extrair lifecycle/start-stop/resume e regras de protocolo em unidades menores.
- DoD: contratos de loop testáveis por unidade e integração.

### Fase C4 — Rebalanceamento `agent` ↔ `presentation`

#### Subfase C4.1 — Rebaixar `presentation/agent/control/handlers.js` para borda fina

- Remover policy operacional pesada do handler compartilhado.
- Manter em `presentation/` apenas parsing, projection e binding de borda.
- DoD: `presentation/` não decide mais política central de fluxo.

#### Subfase C4.2 — Consolidar `runtime-selection` como único access path

- Toda borda compartilha a mesma resolução de runtime;
- remover lookup paralelo espalhado por handlers/comandos;
- DoD: um único owner de targeting/runtime selection.

---

## Faixa D — Guardrails automáticos e governança contínua

### Fase D1 — Regras de arquitetura codificadas

#### Subfase D1.1 — Lint/checks arquiteturais

- Regras para barrar regressão de barrel root largo.
- Regras para barrar uso indevido de `agent-runtime-surface.js` fora da janela de transição.
- Regras para barrar imports proibidos e bypasses de fluxo.
- Regras para barrar import relativo folha dentro de `src/copilot/agent/**`.
- DoD: CI falha em regressão de superfície **e** de fluxo.

#### Subfase D1.2 — Thresholds de hotspot e root hygiene

- Definir limites por arquivo.
- Definir limite máximo de arquivos de implementação no root de subdomínios críticos.
- DoD: crescimento estrutural volta a ser governado.

### Fase D2 — Test strategy de regressão

#### Subfase D2.1 — Testes de estado/lifecycle

- Cobrir: force deactivate, reconnect, stop timeout, pending turns, persisted state races.

#### Subfase D2.2 — Testes de contrato público

- Validar API root/sub-barrels e import maps canônicos.

#### Subfase D2.3 — Testes de fluxo único

- Validar que `server`, `channel`, `hub` e `terminal` convergem para a taxonomia única de
  interação;
- detectar fallback silencioso e policy drift;
- DoD: nenhuma borda cria fluxo paralelo sem contrato deliberado.

---

## 4) Sequenciamento recomendado (ordem executiva)

1. **Fechar Faixa A/B residual** (stability + observability restante).
2. **Entrar imediatamente em C0** (arquitetura única / fluxo único).
3. **Só então aprofundar C3.2/C3.3**, para não decompor hotspot em cima de uma taxonomia ainda
   ambígua.
4. **Aplicar C4 em paralelo com D1/D2**, para travar a nova arquitetura antes de ela voltar a se
   dispersar.

Dependências críticas:

- C0 depende do diagnóstico já consolidado nesta auditoria.
- C3.2 e C3.3 devem seguir **depois** da definição de fluxo único.
- C4 depende de C0.1/C0.2.
- D1 e D2 entram já durante C0/C4 para impedir regressão na própria migração.

---

## 5) Critérios de “pronto” por faixa

- **A pronta:** zero hangs conhecidos de shutdown/turn/restart + races críticas saneadas.
- **B pronta:** boundary SDK resiliente + hook/system context robustos.
- **C pronta:** runtime com superfície única, fluxo único e root-clean.
- **C pronta:** runtime com superfície única, fluxo único, root-clean e imports internos do `agent` via barrel index.
- **D pronta:** CI/testes impedem retorno de superfícies paralelas e fluxos paralelos.

---

## 5.1) Atualização executiva — ONDA 2 barrel-first fechada (2026-05-13)

A ONDA 2 citada no artefato C3.2 foi retomada antes de avançar na decomposição de `AlwaysAliveAgent`. A validação
começou pelo gate solicitado:

- `npm run typecheck:strict:src.copilot`.

O primeiro strict falhou por problema estrutural da migração parcial anterior: três barrels novos estavam
auto-referenciais e, por isso, não exportavam os contratos que os consumidores já esperavam.

Correções:

- `src/copilot/agent/error/index.js` → reexporta `../error-policy.js`;
- `src/copilot/agent/runtime/contracts/index.js` → reexporta `../../runtime-contracts.js`;
- `src/copilot/agent/event-bridge/index.js` → reexporta `../event-bridge-wiring.js` e `../event-bridge-map.js`.

Depois disso, a ONDA 2 avançou para o padrão de `terminal`/`presentation`:

- todo `index.js` do `agent` permanece barrel puro;
- imports operacionais cross-folder dentro de `agent` passam por `*/index.js`;
- dependências externas a `agent` passam por superfícies públicas (`#copilot/config`, `#copilot/config/agent`, `#copilot/core`,
  `#copilot/dialog`, `#copilot/bridges`, `#copilot/event-handlers`, `#copilot/observability`, `#copilot/sdk`);
- same-folder privado continua permitido, conforme a política 2.1 já validada em `terminal`;
- reexports leaf dentro de `index.js` continuam permitidos por serem a própria função dos barrels.

Superfícies públicas ajustadas:

- `#copilot/dialog` formalizado no `package.json` e em `tsconfig.base.json`;
- `#copilot/bridges` exporta `createMcpToolBridge`;
- `#copilot/observability` exporta `buildStatusSnapshot`;
- `#copilot/config/agent` foi formalizado como sub-barrel público das constantes operacionais de `config/agent.js`,
  preservando o root `#copilot/config` mais estreito.

Métrica final da ONDA 2:

- relative module specs em `src/copilot/agent`: **369**;
- via barrel `*/index.js`: **184**;
- leaf total: **185**;
- `crossFolderLeafNonIndex`: **0**;
- `sameFolderLeafNonIndex`: **12**;
- `indexBarrelLeafExports`: **173**.

Novo guardrail:

- `tests/unit/copilot/contracts/test_agent_barrel_governance.spec.js`.

Gates executados:

- `npm run typecheck:strict:src.copilot`: **verde**;
- `npm run test:copilot:unit`: **2609/2609 verde**.

Impacto no roadmap:

- D1.1 deixa de ser apenas recomendação e passa a ter guardrail real para o padrão barrel-first do `agent`;
- C3.2 pode prosseguir sobre base de imports/exports estabilizada;
- `#copilot/agent/*` wildcard permanece como compatibilidade white-box/testes, ainda pendente para uma etapa futura de
  fechamento total de surface pública, mas sem bloquear a ONDA 2.

---

## 6) Decisão final desta auditoria própria

O módulo `agent` e sua relação com o restante de `src/copilot` **já não sofrem mais de ausência de
arquitetura**. O que existe hoje é mais sutil e mais perigoso: **arquitetura parcialmente correta,
porém ainda plural demais na operação**.

O boot canônico está resolvido. A modularização física avançou bastante. O barrel-first avançou de
verdade. Mas ainda falta o passo decisivo desta fase 2.1:

> **transformar a arquitetura “modular e robusta” em arquitetura “única, padronizada e sem fluxos
> paralelos”**.

**Diretriz executiva atualizada:** a prioridade já não deve ser apenas continuar quebrando
hotspots; a prioridade deve ser **unificar o fluxo operacional e a taxonomia de interação**, limpar
o root do `agent/`, reduzir superfícies concorrentes e devolver `presentation/` ao papel estrito de
camada compartilhada de borda.

Esse é o caminho para cumprir, de fato, a arquitetura 2.0/2.1 pretendida: **um runtime owner, uma
política de acesso, um fluxo único, um conjunto pequeno de superfícies explícitas e governança dura
contra regressão**.
