# Auditoria Arquitetural Ampla — `src/copilot`

**Status**: pré-auditoria iniciada **Data-base**: 2026-04-27 **Escopo**: `src/copilot/` completo,
incluindo pastas-raiz, subpastas, arquivos, composition roots, fronteiras, camadas, seams de
comunicação, duplicações, drift arquitetural e aderência ao `@github/copilot-sdk`.

---

## Objetivo deste pacote documental

Esta pasta inaugura uma **nova trilha documental**, independente das auditorias históricas já
existentes em `DOCUMENTAÇÃO/`, com foco em responder de forma sistemática e crítica:

1. **o que cada pasta de `src/copilot` faz hoje**;
2. **o que cada pasta deveria fazer idealmente**;
3. **onde as fronteiras atuais estão confusas ou sobrepostas**;
4. **quais responsabilidades estão duplicadas, vazando ou mal posicionadas**;
5. **como reestruturar `src/copilot` em muitas fases, faixas e subfases sem perder
   compatibilidade**.

---

## Documentos já gerados nesta fase inicial

| Ordem | Documento                                                             | Papel                                                                                        |
| ----- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 00    | `00-PRE-AUDITORIA-PLANO-MESTRE.md`                                    | documento central de pré-auditoria, hipóteses, escopo, método e plano de investigação        |
| 01    | `01-INVENTARIO-ESTRUTURAL-MODULOS-E-ESCALA.md`                        | inventário de módulos, pastas, subpastas, escala e árvore estrutural completa                |
| 02    | `02-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-A.md`                       | inventário completo de arquivos, parte A                                                     |
| 03    | `03-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-B.md`                       | inventário completo de arquivos, parte B                                                     |
| 04    | `04-GRAFOS-E-FRONTEIRAS.md`                                           | grafos de topologia, fluxo, fronteiras e plano da auditoria                                  |
| 05    | `05-TAXONOMIA-ARQUITETURAL-POR-MODULO.md`                             | classificação arquitetural por módulo: missão atual, missão ideal, risco e direção           |
| 06    | `06-COMPOSITION-ROOTS-E-BOOT.md`                                      | análise dos entrypoints, roots, boot phases, host terminal, host HTTP e runtime wiring       |
| 07    | `07-SDK-E-FRONTEIRA-VANILLA.md`                                       | auditoria da camada SDK como SSOT do vendor, boundary vanilla e gaps funcionais              |
| 08    | `08-AGENT-RUNTIME-E-FRONTEIRAS.md`                                    | auditoria do runtime vivo do agente, `AgentContext`, registry e façades                      |
| 09    | `09-HOOKS-E-POLICIES.md`                                              | auditoria do módulo de hooks como owner de callbacks, policies e composition do SDK          |
| 10    | `10-EVENTS-E-TRADUCAO-DE-SINAIS.md`                                   | auditoria do eixo `events/` + `event-handlers/` e da tradução do vanilla do SDK              |
| 11    | `11-PRESENTATION-SHARED-EDGE-LAYER.md`                                | auditoria de `presentation/` como camada compartilhada de projeções e accessors              |
| 12    | `12-SERVER-HTTP-SSE-SOCKET-BOUNDARY.md`                               | auditoria de `server/` como borda HTTP/SSE/Socket e adapter de protocolo                     |
| 13    | `13-TERMINAL-UX-E-CONSUMO-DO-RUNTIME.md`                              | auditoria de `terminal/` como UX humana e consumidor do runtime                              |
| 14    | `14-CONVERSATION-HUB-E-PERSISTENCIA.md`                               | auditoria do domínio multi-sessão, store persistente e sincronização conversacional          |
| 15    | `15-TOOLS-E-EXECUCAO-OPERACIONAL.md`                                  | auditoria de `tools/` como domínio de capabilities executáveis do runtime                    |
| 16    | `16-BRIDGES-INFRA-CHANNEL-PLUGINS.md`                                 | auditoria do eixo `bridges/` + `infra/` + `channel/` + `plugins/`                            |
| 17    | `17-CONFIG-TYPES-DIALOG-E-ARTEFATOS.md`                               | auditoria de `config/`, `types/`, `dialog/` e dos artefatos internos da árvore               |
| 18    | `18-OBSERVABILITY-AUDIT-E-LOGS.md`                                    | auditoria do eixo `observability/` + `audit/` + `logs/`                                      |
| 19    | `19-MATRIZ-DE-COMUNICACAO-CROSS-MODULE.md`                            | matriz de comunicação entre módulos, seams, consumers e fluxos macro                         |
| 20    | `20-MATRIZ-DE-DUPLICACOES-E-SOBREPOSICOES.md`                         | owners concorrentes, overlaps e duplicações arquiteturais críticas                           |
| 21    | `21-MATRIZ-DE-FRONTEIRAS-E-DECISOES.md`                               | demarcação de soberania, limites de módulo e decisões estruturais                            |
| 22    | `22-SITUACAO-IDEAL-ALVO.md`                                           | arquitetura TO-BE consolidada para `src/copilot/`                                            |
| 23    | `23-ROADMAP-MACRO-FAIXAS-E-FASES.md`                                  | programa macro da revolução arquitetural em faixas e fases                                   |
| 24    | `24-ROADMAP-SUBFASES-E-ORDEM-DE-ATAQUE.md`                            | backlog extenso de subfases, ondas e ordem de ataque                                         |
| 25    | `25-SUMARIO-EXECUTIVO-E-DECISOES-ESTRUTURAIS.md`                      | síntese final da auditoria e das decisões estruturais                                        |
| 26    | `26-SCORE-INICIAL-DE-MATURIDADE-POR-MODULO.md`                        | baseline quantitativa inicial de maturidade arquitetural por módulo                          |
| 27    | `27-CHECKLIST-DE-SEAMS-OFICIAIS-POR-MODULO.md`                        | checklist canônico de seams oficiais, tolerados, proibidos e exceções por módulo             |
| 28    | `28-INVENTARIO-DE-ANTI-OWNERS-E-ARTEFATOS.md`                         | inventário oficial de anti-owners e artefatos arquiteturalmente perigosos                    |
| 29    | `29-SUPERFICIES-PUBLICAS-CANONICAS-BASELINE.md`                       | baseline inicial das superfícies públicas dos módulos mais críticos                          |
| 30    | `30-BASELINE-ARQUITETURAL-CONGELADA-BLOCO-A.md`                       | congelamento executivo da baseline arquitetural do Bloco A                                   |
| 31    | `31-INVENTARIO-FINAL-DE-CAPABILITIES-SDK-PENDENTES.md`                | inventário factual inicial do Bloco B sobre capabilities SDK pendentes/parciais              |
| 32    | `32-BLOCO-B-W10-W15-TRANSFORMACAO-INICIAL-SDK-BOUNDARY.md`            | registro da primeira onda efetiva de código do Bloco B no boundary SDK                       |
| 33    | `33-BLOCO-B-W10-PROPAGACAO-LIFECYCLE-CONFIG.md`                       | checkpoint da segunda subonda do Bloco B, focada em propagation por lifecycle/config         |
| 34    | `34-BLOCO-B-W9-CLIENT-SIDE-SESSIONFS-SURFACE.md`                      | checkpoint da terceira subonda do Bloco B, focada na surface client-side de SessionFs        |
| 35    | `35-POLITICA-DE-VALIDACAO-ESCOPADA-COPILOT.md`                        | política operacional de validação focada em `src/copilot/` durante a revolução               |
| 36    | `36-BLOCO-B-W10-SESSIONFS-RUNTIME-WIRING-INICIAL.md`                  | checkpoint da promoção inicial de SessionFs ao runtime real                                  |
| 37    | `37-BLOCO-B-W11-SESSIONFS-OBSERVABILIDADE-E-SOBERANIA.md`             | checkpoint da observabilidade e da soberania estrutural de SessionFs                         |
| 38    | `38-BLOCO-B-W12-SDK-METRICAS-NO-EVENTBUS.md`                          | checkpoint da projeção das métricas do SDK no EventBus canônico                              |
| 39    | `39-BLOCO-B-W13-RECOVERY-POR-SDKERRORKIND.md`                         | checkpoint da política de recovery por `SdkErrorKind` no client/boundary SDK                 |
| 40    | `40-BLOCO-B-W13-RECOVERY-NO-LIFECYCLE-E-UNIFICACAO-CLIENT-SESSION.md` | checkpoint da extensão do recovery ao lifecycle e da unificação do singleton session wrapper |
| 41    | `41-BLOCO-B-W13-TAXONOMIA-RECONNECT-E-CONVERGENCIA.md`                | checkpoint da taxonomia de reconnect e da convergência entre SDK, agent e terminal           |
| 42    | `42-MAPEAMENTO-LIFECYCLE-AGENT-VS-SDK.md`                             | mapeamento detalhado da fronteira de lifecycle entre SDK vanilla e runtime vivo do agent     |
| 43    | `43-BLOCO-B-W13-WATCHDOG-ONLY-TURNS-E-RESUME-AUTO-SANITIZATION.md`    | checkpoint da correção do timeout de turno longo e do saneamento do resume com `model=auto`  |
| 44    | `44-MAPEAMENTO-LIFECYCLE-ADJACENTE-KEEPALIVE-CLEANUP-BOOT.md`         | mapeamento da família adjacente de lifecycle e da nova fronteira semântica do keepalive      |
| 45    | `45-MAPEAMENTO-HISTORY-CAPABILITY-AGENT-VS-SDK.md`                    | mapeamento da capability `getMessages` e remoção da sondagem crua em `agent/session/*`       |
| 46    | `46-MAPEAMENTO-RUNTIME-STATE-E-BOOT-SDK-BRIDGES.md`                   | mapeamento do runtime-state sem `state-io` inline e das bridges semânticas de boot do SDK    |
| 47    | `47-MAPEAMENTO-DIALOG-BOOT-RECOVERY-E-RUNTIME-STATE.md`               | mapeamento da recuperação do dialog loop sem `state-io` direto em `boot-steps.js`            |
| 48    | `48-MAPEAMENTO-ALWAYSALIVE-RUNTIME-CONTROLS-E-DIALOG.md`              | mapeamento da delegação de `AlwaysAliveAgent` para `runtime-controls` e `dialog-runtime`     |
| 49    | `49-MAPEAMENTO-ALWAYSALIVE-RUNTIME-GOVERNANCE-E-CAPABILITIES.md`      | mapeamento da delegação de governança/capabilities para `agent-runtime-controls`             |
| 50    | `50-MAPEAMENTO-BOOTSTEPS-SHADOW-REAPER-RUNTIME-STATE.md`              | mapeamento da extração do reaper de shadow de `boot-steps` para `agent-runtime-state`        |
| 51    | `51-BUGFIX-RECURSAO-ALWAYSALIVE-RUNTIME-CONTROLS-LLMB.md`             | correção do stack overflow no boot da LLM-B por recursão entre `AlwaysAliveAgent` e façades  |

---

## Próximos documentos previstos

Os artefatos planejados para a auditoria ampla estão listados no documento 00, mas a espinha dorsal
prevista é:

1. taxonomia arquitetural por módulo;
2. composition roots e boot/runtime wiring;
3. fronteiras `sdk ↔ agent ↔ hooks ↔ presentation ↔ server ↔ terminal`;
4. análise detalhada de `hooks/`, `event-handlers/`, `events/` e `observability/`;
5. análise detalhada de `tools/`, `bridges/`, `infra/`, `channel/` e `conversation-hub/`;
6. situação ideal alvo;
7. roadmap de migração em faixas, fases e subfases.

Na rodada atual, o pacote já cobre:

- taxonomia arquitetural por módulo;
- composition roots e boot;
- fronteira vanilla do SDK;
- runtime `agent/`;
- hooks/policies;
- events/tradução de sinais;
- `presentation/`, `server/` e `terminal/`;
- `conversation-hub/`;
- `tools/`;
- `bridges/`, `infra/`, `channel/`, `plugins/`;
- `config/`, `types/`, `dialog/`, artefatos internos;
- `observability/`, `audit/`, `logs/`;
- matrizes de comunicação, duplicação e fronteiras;
- situação ideal alvo;
- roadmap macro e roadmap extenso de subfases da revolução.

Na etapa atual, o Bloco A do roadmap já começou a ser materializado com:

- baseline quantitativa inicial de maturidade (`26`);
- checklist de seams oficiais (`27`);
- inventário formal de anti-owners (`28`);
- baseline de superfícies públicas canônicas (`29`);
- baseline arquitetural congelada do Bloco A (`30`);
- gate executável de seams oficiais (`scripts/check-copilot-official-seams.mjs`);
- testes estruturais do Bloco A em `tests/unit/copilot/contracts/`.

Na transição para o Bloco B, o pacote já passa a incluir também:

- inventário factual das capabilities do SDK ainda pendentes, parciais ou já promovidas (`31`), com
  destaque para os gaps mais concretos atuais: `sessionFs`, `createSessionFsHandler` e session-level
  `gitHubToken`.
- registro da primeira transformação efetiva do Bloco B (`32`), cobrindo endurecimento inicial de
  `sdk/session/permissions.js`, `sdk/session/provider.js`, expansão do `SessionConfigBuilder` e
  ampliação dos testes focados do boundary SDK.
- checkpoint complementar do Bloco B (`33`), cobrindo a propagação real de `gitHubToken` e
  `createSessionFsHandler` por `sdk/session/lifecycle.js` e `sdk/config.js`.
- checkpoint complementar do Bloco B (`34`), cobrindo a introdução explícita de `sessionFs()` e
  `sessionIdleTimeoutSeconds()` no `ClientOptionsBuilder`.
- checkpoint complementar do Bloco B (`37`), cobrindo métricas L1 por operação de SessionFs e o gate
  estrutural que impede deep-imports do owner interno fora de `sdk/`.
- checkpoint complementar do Bloco B (`38`), cobrindo a projeção de `SdkOperationMetric` no
  `EventBus` canônico por meio do bridge dedicado de observabilidade.
- checkpoint complementar do Bloco B (`39`), cobrindo a primeira integração executável entre
  `SdkErrorKind`, retry/backoff e o `CircuitBreaker` de conexão do SDK.
- checkpoint complementar do Bloco B (`40`), cobrindo a extensão do recovery para
  `session.create`/`session.resume` e a convergência de `createClientSession()`/
  `resumeClientSession()` para as wrappers canônicas de lifecycle.
- checkpoint complementar do Bloco B (`41`), cobrindo a taxonomia dos mecanismos de reconnect
  existentes e a convergência da elegibilidade de reconnect entre `sdk/`, `agent/` e
  `terminal/dialog`.
- checkpoint complementar do Bloco B (`42`), consolidando a regra geral de ownership do lifecycle:
  `sdk/` como owner das transições vanilla e `agent/` como owner da sessão viva, com uso de façades
  canônicas para `start/stop/ping/create/resume` no lifecycle do agent.
- checkpoint complementar do Bloco B (`43`), cobrindo a introdução do modo `watchdog-only` nos
  turnos interativos do terminal, o reset de timeout por progresso vindo do host vivo e o saneamento
  de `model="auto"` no `resumeSession()` com persistência do modelo efetivo.
- checkpoint complementar do Bloco B (`44`), cobrindo a família adjacente do lifecycle (`keepalive`,
  `cleanup`, `boot-steps`, `boot-wiring`) e a convergência do keepalive para uma ação semântica
  única do runtime, sem tocar handles crus do SDK.
- checkpoint complementar do Bloco B (`45`), cobrindo a capability de histórico da sessão
  (`getMessages`), a promoção de `canReadAgentSdkSessionMessages()` como descoberta canônica dessa
  surface e a remoção da sondagem crua em `initializer`/`history-sync`.
- checkpoint complementar do Bloco B / transição para o Bloco C (`46`), cobrindo a extração de
  `agent-runtime-state.js`, a remoção de `readState()`/`persistStateWithPolicy()` inline em
  `AlwaysAliveAgent` e `boot-steps`, e a adoção de bridges semânticas de boot do SDK em
  `boot-wiring.js`.
- checkpoint complementar do Bloco B / aprofundamento do Bloco C (`47`), cobrindo a remoção de
  `readStateAsync()`/`persistStateWithPolicy({ dialogPaused: true })` de `boot-steps.js` para o eixo
  de dialog boot recovery, agora delegado à façade semântica `agent-runtime-state.js`.
- checkpoint complementar do Bloco B / aprofundamento do Bloco C (`48`), cobrindo a delegação de
  `AlwaysAliveAgent` para `agent-runtime-controls` no eixo de status/interação e o alinhamento da
  cadeia de diálogo em `agent-dialog-runtime.js` / `presentation/runtime-dialog.js`.
- checkpoint complementar do Bloco B / aprofundamento do Bloco C (`49`), cobrindo a delegação do
  eixo de governança/capabilities de `AlwaysAliveAgent` para `agent-runtime-controls` (permission
  mode, permission/context capabilities e tool registry snapshots), com guardrail estrutural
  dedicado contra regressão para chamadas diretas em `ctx`.
- checkpoint complementar do Bloco B / aprofundamento do Bloco C (`50`), cobrindo a remoção da
  inspeção direta de `ctx` no reaper de `pendingQuestionShadow` em `boot-steps.js`, agora delegada
  para `shouldReapAgentRuntimePendingQuestionShadow()` na façade `agent-runtime-state`, com seam
  dedicada para impedir regressão.
- checkpoint complementar de bugfix live (`51`), cobrindo a recursão entre `AlwaysAliveAgent` e
  `agent-runtime-controls` que derrubava o boot de `terminal:llm-b`, além do endurecimento da
  preferência por métodos estáveis do `AgentContext` nas façades de runtime.

---

## Observação metodológica importante

Esta auditoria usa como insumo:

- o **filesystem vivo** de `src/copilot/`;
- a documentação canônica atual, especialmente `src/copilot/README.md` e READMEs de módulos;
- o documento anexo `DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`;
- os gates arquiteturais e de boundary já existentes
  (`scripts/check-copilot-global-architecture.mjs`, `check-copilot-sdk-boundary.mjs`,
  `check-copilot-crude-calls.mjs`);
- sinais históricos encontrados em auditorias antigas, mas **sem assumir que o histórico continua
  correto automaticamente**.

Em outras palavras: o pacote é **novo, crítico e independente**, embora aproveite evidências já
existentes.
