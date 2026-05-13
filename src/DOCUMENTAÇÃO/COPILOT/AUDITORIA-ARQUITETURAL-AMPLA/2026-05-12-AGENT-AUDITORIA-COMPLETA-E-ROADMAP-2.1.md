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
>
> - `npm run typecheck:strict:src.copilot`: **verde**;
> - `npm run test:copilot:unit`: **verde** (**2606/2606** testes; **874/874** suites).

---

## 1) Estado atual validado (AS-IS)

## 1.1 Maturidade estrutural

`agent/` já possui subdomínios reais (`dialog`, `lifecycle`, `session`, `messaging`, `ports`,
`facades`, `state`, `infra`, etc.), porém o domínio ainda apresenta:

1. **Superfície pública raiz já minimizada**, mas ainda com exports legados deliberados para
   compatibilidade.
2. **Mapeamento de imports explícito por subdomínio já criado**, mantendo `#copilot/agent/*` como
   compatibilidade temporária.
3. **Hotspots remanescentes** com múltiplas responsabilidades: `always-alive.js` (1162),
   `loop-manager.js` (719) e `agent-lifecycle.js` (664). `agent-context.js` deixou de ser hotspot
   crítico após C3.1 (815). `always-alive.js` já perdeu a responsabilidade de singleton/proxy em
   C3.2, mas ainda é o maior hotspot de fachada operacional.
4. **Riscos de governança/testes pós-C2**: contratos e mocks foram atualizados para seams 2.1; o
   risco residual agora é impedir regressão para import root/deep-import acidental.

## 1.2 Achados críticos próprios (confirmados)

### Bugs P0/P1 de maior impacto

- `forceDeactivate()` emite `authorized:false` e pode induzir wait/retry indevido (`loop-manager` +
  `turn-result-persistence`).
- Dupla inicialização de `toolSessionContext` em `AgentContext`.
- `top-level await` em `initializer.js` acopla toda a árvore de import à carga de config de tools.
- `state-io` ainda permite escrita stale em disco na janela `clearState()` vs `_doWriteState()`.
- FSM de status só avisa, não bloqueia transição inválida.
- `bootCircuit.recordFailure()` duplicado no fluxo de boot falho.

### Riscos P2/P3 relevantes

- Sanitização ANSI parcial em `hook-context`.
- Exposição por referência de task viva em `getQueueSnapshot()`.
- Timer de boot-recovery sem contrato explícito de cancelamento.
- `agent/index.js` barrel root com `export *` (risco de API drift).

## 1.3 Itens externos não confirmados integralmente

- `session.plan_changed` sem wiring: **não procede** (já existe wiring via `wireModeAndToolEvents`).
- `systemMessage customize` ausente: **não procede** para o caminho live atual.
- `Symbol.asyncDispose` incompatível: **não crítico no baseline Node>=24 do repositório**.

---

## 2) Estado ideal (TO-BE) para arquitetura 2.0/2.1 em `agent`

## 2.1 Princípios-alvo

1. **Barrel-first por subdomínio, não por arquivo solto**.
2. **Superfície pública explícita e mínima** (sem catch-all root).
3. **Lifecycle determinístico** (start/stop/reconnect/state persist sem ambiguidade de estado).
4. **Concorrência previsível** (I/O serializado com semântica anti-race completa).
5. **SDK boundary resiliente** (sem acoplamento a API transitória/deprecada).
6. **Guardrails automatizados** para evitar regressão arquitetural.

## 2.2 Topologia pública alvo (import map)

Adicionar superfícies explícitas (eliminando dependência de `#copilot/agent/*` como principal
contrato):

- `#copilot/agent`
- `#copilot/agent/context`
- `#copilot/agent/dialog`
- `#copilot/agent/lifecycle`
- `#copilot/agent/session`
- `#copilot/agent/messaging`
- `#copilot/agent/facades`
- `#copilot/agent/ports`
- `#copilot/agent/state`
- `#copilot/agent/infra`

## 2.3 Contrato do root barrel ideal

`agent/index.js` deve exportar apenas:

- API pública de runtime (`AlwaysAliveAgent`, `alwaysAliveAgent`, `getAgent`, `resetAgent`);
- tipos/contratos públicos estáveis;
- capabilities estritamente deliberadas.

Sem `export *` aberto de subdomínios internos.

---

## 3) Roadmap completo (faixas, fases e subfases)

## Faixa A — Estabilização crítica de runtime (P0/P1)

### Fase A1 — Turn lifecycle/shutdown correctness

#### Subfase A1.1 — `forceDeactivate` sem hang semântico

- Ajustar `forceDeactivate()` para sinalizar encerramento que não dispare retry indevido.
- Garantir rejeição explícita dos turns pendentes (sem depender de READY futuro).
- DoD: nenhum turno pendente permanece bloqueado indefinidamente após force stop.

#### Subfase A1.2 — Stop/restart contract unificado

- Revisar contratos entre `EMITTER_LOOP_STOPPED`, `authorized`, `waitForRestartAndReply`.
- Consolidar semântica de `authorized_stop`, `force_deactivate`, `model_stopped`,
  `reconnect_restart`.
- DoD: matriz de estados/eventos sem ambiguidade e coberta por testes de integração.

### Fase A2 — State I/O race hardening

#### Subfase A2.1 — Anti-race completo em `_doWriteState`

- Introduzir guardas de geração antes de `writeStateFileJson`.
- Opcional: lock transacional por intent para impedir flush stale.
- DoD: `clearState()` durante write não restaura estado antigo em disco/cache.

#### Subfase A2.2 — Atomicidade e observabilidade de persistência

- Instrumentar métricas/eventos de conflitos de geração e descartes de write.
- DoD: diagnóstico explícito de write-cancel por geração.

### Fase A3 — AgentContext correctness

#### Subfase A3.1 — Corrigir setters null/undefined

- Tratar `null | undefined` de forma consistente em setters sensíveis.
- DoD: setters não propagam `undefined` para estado vivo.

#### Subfase A3.2 — FSM enforce

- Em dev/test: lançar erro em transição inválida.
- Em prod: no mínimo bloquear transição inválida com log de erro estruturado.
- DoD: transições inválidas deixam de ser aplicadas silenciosamente.

#### Subfase A3.3 — Encapsulamento de snapshot de fila

- Retornar shape serializável mínimo do `oldest` (sem callbacks vivos).
- DoD: API pública não expõe referências mutáveis de tarefas.

---

## Faixa B — Compatibilidade e robustez SDK

### Fase B1 — Model switch compatibility

#### Subfase B1.1 — Neutralizar dependência hard de `setModel`

- Revisar `trySetLiveSessionModel` para não depender de `Reflect.get(..., 'setModel')` como gate
  único.
- Centralizar fallback em wrapper SDK canônico.
- DoD: troca de modelo funciona (ou falha graciosamente) com mudanças de API do SDK.
- Status 2026-05-13: **corrigida**. `setSessionModel()` agora tenta `session.setModel()`, aceita
  `session.switchModel()` quando `setModel` não existe e cai para `rpc.model.switchTo()` como
  fallback final; `modelSwitchAvailable` também reconhece ambas APIs nativas.

#### Subfase B1.2 — Capacidades versionadas

- Expor capability map explícito para model switching no runtime.
- DoD: decisões de fallback orientadas por capability, não por tentativa ad-hoc.

### Fase B2 — Hook/system context hardening

#### Subfase B2.1 — Sanitização ANSI abrangente

- Expandir regex para classes ANSI/OSC/ST relevantes.
- DoD: briefing sanitizado sem sequências de controle remanescentes perigosas.

#### Subfase B2.2 — Deduplicação concorrente de build context

- Adicionar promise lock (`_buildContextPromise`) no `buildHookSystemContextSafe()`.
- DoD: chamadas concorrentes reaproveitam o mesmo trabalho em voo.

### Fase B3 — Timeout/cancel contracts

#### Subfase B3.1 — Boot recovery cancelável

- `scheduleDialogBootRecovery()` retorna cancel handle ou integra cancel ao lifecycle store.
- `agentStop`/teardown consomem cancel.
- DoD: nenhum timer de recovery órfão após stop.

---

## Faixa C — Convergência barrel-first 2.1 em `agent`

### Fase C1 — Surface minimization

#### Subfase C1.1 — Root barrel explícito

- Remover `export *` de `agent/index.js`.
- Reexportar somente API pública formal.
- DoD: root barrel pequeno, deliberado e estável.

#### Subfase C1.2 — Sub-barrels explícitos por domínio

- Garantir `index.js` por subdomínio com escopo claro.
- Definir "internal-only" x "public-by-design".
- DoD: deep-import não-canônico reduzido a casos de teste white-box.

### Fase C2 — Import map governado

#### Subfase C2.1 — Exports/imports explícitos em `package.json`

- Incluir `#copilot/agent/<subdomínio>`; manter compat legado temporário.
- Planejar depreciação de `#copilot/agent/*` com janela de migração.
- DoD: consumidores majoritários migram para aliases explícitos.

#### Subfase C2.2 — Rewiring de consumidores

- Migrar imports internos/externos para superfícies por subdomínio.
- DoD: queda mensurável de imports ambíguos/curinga.

### Fase C3 — Hotspot decomposition

#### Subfase C3.1 — `agent-context.js`

- Extrair API semântica, managers boundary, FSM e snapshots em módulos coesos.
- Status 2026-05-13: **concluída**.
- Evidência: `agent-context.js` = 815 linhas; módulos `agent/context/*` absorveram FSM, session ops,
  runtime ops, metrics ops, dialog ops e tool ops; `typecheck:strict:src.copilot` verde.
- Gap residual: adicionar teste de contrato específico para impedir regressão de `agent-context.js`
  acima de 900 linhas e para garantir que módulos `agent/context/*` sejam efetivamente importados
  pela classe.

#### Subfase C3.2 — `always-alive.js`

- Reduzir papel de composition root operacional.
- Reavaliar proxy de compatibilidade e custo de `getAgent()` por acesso.
- DoD: menor acoplamento cross-subdomínio e menor complexidade ciclomática.
- Status 2026-05-13: **iniciada / parcialmente concluída**.
- Entrega já aplicada: proxy/singleton/registro default foram extraídos para
  `always-alive-singleton.js`; `#copilot/agent/always-alive` virou subpath explícito para esse
  composition root; `always-alive.js` preserva a classe `AlwaysAliveAgent` e compat re-export sem
  possuir estado singleton. Leituras de governance/tool-session agora passam por
  `runtime/governance-readers.js`, com guardrail impedindo retorno de acesso cru a `this.ctx`.
  `agent-runtime-surface.js` foi reduzido a barrel legado e a surface canônica passou para
  `runtime/root-surface/index.js`.
- Próximo passo C3.2: reduzir a superfície de métodos delegadores ainda concentrada na classe,
  extraindo famílias de delegação para herança/mixins tipáveis ou subfachadas sem perder a shape
  pública de `AlwaysAliveAgent`.

#### Subfase C3.3 — `loop-manager.js`

- Extrair lifecycle/start-stop/resume e regras de protocolo em unidades menores.
- DoD: contratos de loop testáveis por unidade e integração.

---

## Faixa D — Guardrails automáticos e governança contínua

### Fase D1 — Regras de arquitetura codificadas

#### Subfase D1.1 — Lint/checks arquiteturais

- Regras para barrar `export *` no root de `agent`.
- Regras para barrar imports proibidos e deep-imports fora da política.
- DoD: CI falha em regressão de superfície.
- Atualização 2026-05-13: contratos existentes precisam ser rebaselined para a política nova:
  `#copilot/agent/facades`, `#copilot/agent/runtime-registry`, `#copilot/agent/always-alive`,
  `#copilot/agent/error-policy`, `#copilot/agent/ports` e `#copilot/agent/di-tokens` são seams
  explícitos, não deep imports acidentais.

#### Subfase D1.2 — Thresholds de hotspot

- Definir limites por arquivo (ex.: > 600 linhas exige ADR/plano de decomposição).
- DoD: crescimento de hotspots torna-se governado, não acidental.

### Fase D2 — Test strategy de regressão

#### Subfase D2.1 — Testes de estado/lifecycle

- Cobrir: force deactivate, reconnect, stop timeout, pending turns, persisted state races.
- DoD: cenários P0/P1 reproduzíveis e protegidos.

#### Subfase D2.2 — Testes de contrato público

- Validar API root/sub-barrels e import maps canônicos.
- DoD: mudança acidental de surface pública detectada cedo.
- Gap novo: mocks de testes unitários do terminal ainda mockam apenas `#copilot/agent`; após a
  migração C2, os testes que atravessam `presentation/runtime/*` também precisam mockar
  `#copilot/agent/facades`, `#copilot/agent/runtime-registry`, `#copilot/agent/always-alive` e
  `#copilot/agent/error-policy`. **Status 2026-05-13:** corrigido; suíte unitária completa verde com
  2606/2606 testes.

---

## 4) Sequenciamento recomendado (ordem executiva)

1. **Faixa A** (sem isso, risco operacional continua alto).
2. **Faixa B** em paralelo parcial com A2/A3.
3. **Faixa C** após estabilidade mínima de runtime.
4. **Faixa D** entra incrementalmente desde C1 e fecha como governança contínua.

Dependências críticas:

- C1 depende de A1/A3 (não vale reduzir surface com runtime instável).
- C2 depende de C1.
- C3 pode começar em paralelo com C2 após contracts mínimos estabilizados.
- D1 deve entrar assim que C1 começar para evitar regressão durante a própria migração.

---

## 5) Critérios de “pronto” por faixa

- **A pronta:** zero hangs conhecidos de shutdown/turn/restart + races críticas saneadas.
- **B pronta:** boundary SDK resiliente a variação de capability + hook context robusto.
- **C pronta:** superfície pública explícita, barrels por domínio e hotspots decompostos.
- **D pronta:** guardrails e testes impedem regressão sistêmica.

---

## 6) Decisão final desta auditoria própria

O módulo `agent` está em um ponto de maturidade funcional elevado, mas ainda com dívida
arquitetural/lifecycle que impede considerar a migração 2.1 como encerrada.

**Diretriz executiva:** executar o roadmap acima de forma faseada, com foco imediato em Faixa A, e
já preparar C1/C2 para impedir novo crescimento desgovernado da superfície pública.

Isso alinha `agent` ao mesmo padrão estratégico já aplicado em `presentation`: **barrel-first com
governança explícita, contratos estáveis e prevenção ativa de regressão**.
