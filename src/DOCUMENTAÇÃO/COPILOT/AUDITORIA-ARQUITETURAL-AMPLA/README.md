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

| Ordem | Documento | Papel | | ----- |
---------------------------------------------------------------------- |
-------------------------------------------------------------------------------------------------------

| --- | --- | ------------------------------------------------------- |
-------------------------------------------------------------------------------------------- | | 00
| `00-PRE-AUDITORIA-PLANO-MESTRE.md` | documento central de pré-auditoria, hipóteses, escopo, método
e plano de investigação | | 01 | `01-INVENTARIO-ESTRUTURAL-MODULOS-E-ESCALA.md` | inventário de
módulos, pastas, subpastas, escala e árvore estrutural completa | | 02 |
`02-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-A.md` | inventário completo de arquivos, parte A | | 03 |
`03-INVENTARIO-COMPLETO-DE-ARQUIVOS-PARTE-B.md` | inventário completo de arquivos, parte B | | 04 |
`04-GRAFOS-E-FRONTEIRAS.md` | grafos de topologia, fluxo, fronteiras e plano da auditoria | | 05 |
`05-TAXONOMIA-ARQUITETURAL-POR-MODULO.md` | classificação arquitetural por módulo: missão atual,
missão ideal, risco e direção | | 06 | `06-COMPOSITION-ROOTS-E-BOOT.md` | análise dos entrypoints,
roots, boot phases, host terminal, host HTTP e runtime wiring | | 07 |
`07-SDK-E-FRONTEIRA-VANILLA.md` | auditoria da camada SDK como SSOT do vendor, boundary vanilla e
gaps funcionais | | 08 | `08-AGENT-RUNTIME-E-FRONTEIRAS.md` | auditoria do runtime vivo do agente,
`AgentContext`, registry e façades | | 09 | `09-HOOKS-E-POLICIES.md` | auditoria do módulo de hooks
como owner de callbacks, policies e composition do SDK | | 10 | `10-EVENTS-E-TRADUCAO-DE-SINAIS.md`
| auditoria do eixo `events/` + `event-handlers/` e da tradução do vanilla do SDK | | 11 |
`11-PRESENTATION-SHARED-EDGE-LAYER.md` | auditoria de `presentation/` como camada compartilhada de
projeções e accessors | | 12 | `12-SERVER-HTTP-SSE-SOCKET-BOUNDARY.md` | auditoria de `server/` como
borda HTTP/SSE/Socket e adapter de protocolo | | 13 | `13-TERMINAL-UX-E-CONSUMO-DO-RUNTIME.md` |
auditoria de `terminal/` como UX humana e consumidor do runtime | | 14 |
`14-CONVERSATION-HUB-E-PERSISTENCIA.md` | auditoria do domínio multi-sessão, store persistente e
sincronização conversacional | | 15 | `15-TOOLS-E-EXECUCAO-OPERACIONAL.md` | auditoria de `tools/`
como domínio de capabilities executáveis do runtime | | 16 | `16-BRIDGES-INFRA-CHANNEL-PLUGINS.md` |
auditoria do eixo `bridges/` + `infra/` + `channel/` + `plugins/` | | 17 |
`17-CONFIG-TYPES-DIALOG-E-ARTEFATOS.md` | auditoria de `config/`, `types/`, `dialog/` e dos
artefatos internos da árvore | | 18 | `18-OBSERVABILITY-AUDIT-E-LOGS.md` | auditoria do eixo
`observability/` + `audit/` + `logs/` | | 19 | `19-MATRIZ-DE-COMUNICACAO-CROSS-MODULE.md` | matriz
de comunicação entre módulos, seams, consumers e fluxos macro | | 20 |
`20-MATRIZ-DE-DUPLICACOES-E-SOBREPOSICOES.md` | owners concorrentes, overlaps e duplicações
arquiteturais críticas | | 21 | `21-MATRIZ-DE-FRONTEIRAS-E-DECISOES.md` | demarcação de soberania,
limites de módulo e decisões estruturais | | 22 | `22-SITUACAO-IDEAL-ALVO.md` | arquitetura TO-BE
consolidada para `src/copilot/` | | 23 | `23-ROADMAP-MACRO-FAIXAS-E-FASES.md` | programa macro da
revolução arquitetural em faixas e fases | | 24 | `24-ROADMAP-SUBFASES-E-ORDEM-DE-ATAQUE.md` |
backlog extenso de subfases, ondas e ordem de ataque | | 25 |
`25-SUMARIO-EXECUTIVO-E-DECISOES-ESTRUTURAIS.md` | síntese final da auditoria e das decisões
estruturais | | 26 | `26-SCORE-INICIAL-DE-MATURIDADE-POR-MODULO.md` | baseline quantitativa inicial
de maturidade arquitetural por módulo | | 27 | `27-CHECKLIST-DE-SEAMS-OFICIAIS-POR-MODULO.md` |
checklist canônico de seams oficiais, tolerados, proibidos e exceções por módulo | | 28 |
`28-INVENTARIO-DE-ANTI-OWNERS-E-ARTEFATOS.md` | inventário oficial de anti-owners e artefatos
arquiteturalmente perigosos | | 29 | `29-SUPERFICIES-PUBLICAS-CANONICAS-BASELINE.md` | baseline
inicial das superfícies públicas dos módulos mais críticos | | 30 |
`30-BASELINE-ARQUITETURAL-CONGELADA-BLOCO-A.md` | congelamento executivo da baseline arquitetural do
Bloco A | | 31 | `31-INVENTARIO-FINAL-DE-CAPABILITIES-SDK-PENDENTES.md` | inventário factual inicial
do Bloco B sobre capabilities SDK pendentes/parciais | | 32 |
`32-BLOCO-B-W10-W15-TRANSFORMACAO-INICIAL-SDK-BOUNDARY.md` | registro da primeira onda efetiva de
código do Bloco B no boundary SDK | | 33 | `33-BLOCO-B-W10-PROPAGACAO-LIFECYCLE-CONFIG.md` |
checkpoint da segunda subonda do Bloco B, focada em propagation por lifecycle/config | | 34 |
`34-BLOCO-B-W9-CLIENT-SIDE-SESSIONFS-SURFACE.md` | checkpoint da terceira subonda do Bloco B, focada
na surface client-side de SessionFs | | 35 | `35-POLITICA-DE-VALIDACAO-ESCOPADA-COPILOT.md` |
política operacional de validação focada em `src/copilot/` durante a revolução | | 36 |
`36-BLOCO-B-W10-SESSIONFS-RUNTIME-WIRING-INICIAL.md` | checkpoint da promoção inicial de SessionFs
ao runtime real | | 37 | `37-BLOCO-B-W11-SESSIONFS-OBSERVABILIDADE-E-SOBERANIA.md` | checkpoint da
observabilidade e da soberania estrutural de SessionFs | | 38 |
`38-BLOCO-B-W12-SDK-METRICAS-NO-EVENTBUS.md` | checkpoint da projeção das métricas do SDK no
EventBus canônico | | 39 | `39-BLOCO-B-W13-RECOVERY-POR-SDKERRORKIND.md` | checkpoint da política de
recovery por `SdkErrorKind` no client/boundary SDK | | 40 |
`40-BLOCO-B-W13-RECOVERY-NO-LIFECYCLE-E-UNIFICACAO-CLIENT-SESSION.md` | checkpoint da extensão do
recovery ao lifecycle e da unificação do singleton session wrapper | | 41 |
`41-BLOCO-B-W13-TAXONOMIA-RECONNECT-E-CONVERGENCIA.md` | checkpoint da taxonomia de reconnect e da
convergência entre SDK, agent e terminal | | 42 | `42-MAPEAMENTO-LIFECYCLE-AGENT-VS-SDK.md` |
mapeamento detalhado da fronteira de lifecycle entre SDK vanilla e runtime vivo do agent | | 43 |
`43-BLOCO-B-W13-WATCHDOG-ONLY-TURNS-E-RESUME-AUTO-SANITIZATION.md` | checkpoint da correção do
timeout de turno longo e do saneamento do resume com `model=auto` | | 44 |
`44-MAPEAMENTO-LIFECYCLE-ADJACENTE-KEEPALIVE-CLEANUP-BOOT.md` | mapeamento da família adjacente de
lifecycle e da nova fronteira semântica do keepalive | | 45 |
`45-MAPEAMENTO-HISTORY-CAPABILITY-AGENT-VS-SDK.md` | mapeamento da capability `getMessages` e
remoção da sondagem crua em `agent/session/*` | | 46 |
`46-MAPEAMENTO-RUNTIME-STATE-E-BOOT-SDK-BRIDGES.md` | mapeamento do runtime-state sem `state-io`
inline e das bridges semânticas de boot do SDK | | 47 |
`47-MAPEAMENTO-DIALOG-BOOT-RECOVERY-E-RUNTIME-STATE.md` | mapeamento da recuperação do dialog loop
sem `state-io` direto em `boot-steps.js` | | 48 |
`48-MAPEAMENTO-ALWAYSALIVE-RUNTIME-CONTROLS-E-DIALOG.md` | mapeamento da delegação de
`AlwaysAliveAgent` para `runtime-controls` e `dialog-runtime` | | 49 |
`49-MAPEAMENTO-ALWAYSALIVE-RUNTIME-GOVERNANCE-E-CAPABILITIES.md` | mapeamento da delegação de
governança/capabilities para `agent-runtime-controls` | | 50 |
`50-MAPEAMENTO-BOOTSTEPS-SHADOW-REAPER-RUNTIME-STATE.md` | mapeamento da extração do reaper de
shadow de `boot-steps` para `agent-runtime-state` | | 51 |
`51-BUGFIX-RECURSAO-ALWAYSALIVE-RUNTIME-CONTROLS-LLMB.md` | correção do stack overflow no boot da
LLM-B por recursão entre `AlwaysAliveAgent` e façades | | 52 |
`52-AUDITORIA-BOOT-LIFECYCLE-SHUTDOWN-LLMB.md` | auditoria profunda do ciclo `terminal:llm-b`, boot,
lifecycle, recursos e shutdown | | 53 | `53-ROADMAP-BOOT-LIFECYCLE-SHUTDOWN-LLMB.md` | roadmap por
faixas para transformar boot/lifecycle/shutdown em runtime lifecycle auditável | | 54 |
`54-MAPEAMENTO-CLEANUP-PROTECTED-SESSIONS-E-PROVIDER-BOUNDARY.md` | cleanup defensivo de sessões
protegidas e validação canônica de `provider` nas bordas | | 55 |
`55-MAPEAMENTO-LOOP-MANAGER-E-HEALTH-RUNTIME-STATE-BOUNDARY.md` | convergência de `loop-manager` e
`health-check` para façades semânticas de runtime-state | | 56 |
`56-MAPEAMENTO-TURN-EXECUTOR-RUNTIME-STATE-BOUNDARY.md` | convergência do `turn-executor` para a
fronteira semântica de runtime-state | | 57 |
`57-AUDITORIA-GERAL-SRC-COPILOT-AGENT-GRAFOS-ASIS-TOBE-ROADMAP.md` | auditoria geral de
`src/copilot/agent` com grafos AS-IS/TO-BE e roadmap consolidado | | 58 |
`58-AVALIACAO-FALTANTE-NOVA-ARQUITETURA-AGENT-E-INTEGRACAO-COPILOT.md` | avaliação consolidada do
faltante por faixas (A–G), checkpoints e critérios de conclusão | | 59 |
`59-MATRIZ-FACADES-CRITICAS-E-CONTRATOS-DE-BYPASS.md` | matriz de ownership das facades críticas e
mapa dos contratos anti-bypass | | 60 |
`60-MAPEAMENTO-ESTADO-GLOBAL-VIVO-E-REGISTRIES-MULTIRUNTIME.md` | inventário dos `Map`/`Set`
module-level e convergência de registries explícitos multi-runtime | | 61 |
`61-MAPEAMENTO-DESACOPLAMENTO-FACADES-E-SEAMS-INTERNOS.md` | redução de imports cruzados entre
facades e extração de seams internos neutros de runtime | | 62 |
`62-MAPEAMENTO-RATE-LIMIT-STATE-NO-RUNTIME-REGISTRY.md` | convergência do estado de rate limiting de
sessão para registry explícito em server/runtime-state | | 63 |
`63-VARREDURA-GERAL-FINAL-E-FECHAMENTO-METADATA-INFRA-SDK.md` | fechamento da metadata runtime em
fluxos infra de sessões SDK (401/400/429/500) | | 64 | `64-RODADA-OPERACIONAL-AMPLA-GATE-2.0-F.md` |
validação ampla final de strict/lint/madge/suíte copilot para evidência do Gate 2.0-F | | 65 |
`65-PRE-AUDITORIA-REBASE-ARQUITETURA-2.1-SRC-COPILOT.md` | pré-auditoria de rebase 2.1 com método,
hipóteses e grafos totais atualizados de `src/copilot` | | 66 |
`66-DIAGNOSTICO-AS-IS-ARQUITETURA-E-FLUXOS-SRC-COPILOT.md` | diagnóstico AS-IS pós-2.0, com
arquitetura atual e leitura dos fluxos críticos | | 67 | `67-SITUACAO-IDEAL-ALVO-2.1-SRC-COPILOT.md`
| situação ideal alvo 2.1 para evolução contínua de ownership, seams e multi-runtime | | 68 |
`68-ROADMAP-REVOLUCAO-CONTINUA-ARQUITETURA-2.1.md` | roadmap expandido (faixas/subfaixas/ondas
W85–W108) para novas transformações amplas e profundas | | 69 |
`69-BLOCO-K-W85-HOTSPOT-MAP-AGENT-COM-EVIDENCIA.md` | execução factual da W85 com hotspot map
profundo de `agent/*` baseado em análise automatizada | | 70 |
`70-BLOCO-K-W86-PLANO-DE-EXTRACAO-DE-SEAMS-AGENT.md` | plano profundo da W86 para extrair seams e
reduzir concentração estrutural em lifecycle/dialog/boot | | 71 |
`71-BLOCO-K-W86.2-CHECKPOINT-LIFECYCLE-TEARDOWN-SEAM.md` | checkpoint da extração do seam de
teardown no lifecycle com refatoração real em `agent-lifecycle` | | 72 |
`72-BLOCO-K-W86.3-CHECKPOINT-DIALOG-LOOP-RUNTIME-KIT.md` | checkpoint da extração do kit de runtime
do dialog loop para reduzir concentração no loop manager | | 73 |
`73-BLOCO-K-W86.4-CHECKPOINT-BOOT-STEPS-SEAMS.md` | checkpoint da extração de `boot-steps` em três
seams semânticos com critérios de conclusão validados | | 74 |
`74-BLOCO-K-W86.5-PLANO-HARDENING-STATE-IO.md` | plano contínuo da W86.5 para hardening de state-io
com critérios claros e anti-regressão | | 75 |
`75-BLOCO-K-W86.5.1-CHECKPOINT-STATE-IO-BYPASS-REDUCTION.md` | checkpoint da redução de bypass de
state-io com migração para façade e contrato de allowlist infra | | 76 |
`76-BLOCO-K-W86.5.2-CHECKPOINT-STATE-FILE-IO-SEAM.md` | checkpoint da extração do seam de IO bruto
(`state-file-io`) com manutenção da API pública | | 77 |
`77-BLOCO-K-W86.5.3-CHECKPOINT-METRICAS-E-FECHAMENTO-W86.5.md` | métricas residuais, contratos
finais e fechamento consolidado da W86.5 | | 78 |
`78-BLOCO-K-W86.6-CHECKPOINT-RUNTIME-PENDING-QUESTION-SEAM.md` | checkpoint da primeira decomposição
de `agent-runtime-state` com extração do sub-seam pending-question | | 79 |
`79-BLOCO-K-W86.6.1-CHECKPOINT-RUNTIME-DIALOG-STATE-SEAM.md` | checkpoint da extração do sub-seam de
dialog bootstrap/recovery com delegação estável na façade | | 80 |
`80-BLOCO-K-W86.6.2-PLANO-RUNTIME-SHUTDOWN-SNAPSHOT-SEAM.md` | plano contínuo da subonda W86.6.2
para extrair snapshot/shutdown state da façade principal | | 81 |
`81-BLOCO-K-W86.6.2-CHECKPOINT-RUNTIME-SHUTDOWN-SNAPSHOT-SEAM.md` | checkpoint da extração do
sub-seam de shutdown/snapshot com contrato anti-regressão e API preservada | | 82 |
`82-BLOCO-K-W86.6.3-PLANO-SESSION-STATUS-BOOTSTRAP-SEAM.md` | plano contínuo da W86.6.3 para extrair
session/status bootstrap fallback da façade principal | | 83 |
`83-BLOCO-K-W86.6.3-CHECKPOINT-SESSION-BOOTSTRAP-SEAM.md` | checkpoint da extração do sub-seam de
session-bootstrap com fallback síncrono e boot-state restore | | 84 |
`84-BLOCO-K-W86.7-PLANO-ANALISE-TURN-EXECUTOR.md` | plano contínuo da W86.7 para analisar e decompor
turn-executor (947 LOC) em seams semânticos | | 85 |
`85-BLOCO-K-W86.7.1-CHECKPOINT-TURN-INPUT-VALIDATION-SEAM.md` | checkpoint da extração do sub-seam
de turn-input-validation com 7 funções de normalização delegadas | | 86 |
`86-BLOCO-K-W86.7.2-CHECKPOINT-TURN-EXECUTION-CONTEXT-SEAM.md` | checkpoint da extração do sub-seam
de turn-execution-context com 5 funções de lifecycle manager | | 87 |
`87-BLOCO-K-W86.7.3-CHECKPOINT-TURN-RESULT-PERSISTENCE-SEAM.md` | checkpoint da extração do sub-seam
de turn-result-persistence e hardening de listeners de progresso | | 88 |
`88-BLOCO-K-W86.8-CHECKPOINT-DIALOG-BOOT-LIFECYCLE-SEAM.md` | checkpoint da extração do boot
lifecycle e circuit breaker do dialog loop para seams dedicados | | 89 |
`89-BLOCO-K-W87.1-CHECKPOINT-AGENT-LIFECYCLE-CORE-RUNTIME-PORT.md` | checkpoint inicial da W87
reduzindo imports diretos de core no lifecycle via porta agent-local | | 90 |
`90-BLOCO-K-W87.2-CHECKPOINT-SESSION-SNAPSHOT-STORE-SEAM.md` | checkpoint da extração do IO/schema
de snapshots para seam dedicada `snapshot-store.js` | | 91 |
`91-BLOCO-N-W109-TAXONOMIA-ORGANIZACAO-FISICA-AGENT-DIALOG.md` | checkpoint inicial da F9 com
README/module-map/contrato de organização física em `agent/dialog` | | 92 |
`92-BLOCO-N-W113-TAXONOMIA-ORGANIZACAO-FISICA-AGENT-SESSION.md` | checkpoint inicial da F9/W113 com
README/module-map/contrato de organização física em `agent/session` | | 93 |
`93-BLOCO-N-W113-TAXONOMIA-ORGANIZACAO-FISICA-AGENT-LIFECYCLE.md` | checkpoint inicial da F9/W113
com README/module-map/contrato de organização física em `agent/lifecycle` | | 100 |
`100-MAPEAMENTO-COMPLETO-FLUXOS-SRC-COPILOT-2026-05.md` | catálogo completo AS-IS de fluxos em
`src/copilot` com owners, estados e leitura consolidada | | 101 |
`101-MATRIZ-FLUXOS-CANONICOS-VS-PARALELOS-SRC-COPILOT.md` | matriz de classificação de fluxos
canônicos/paralelos com priorização objetiva de convergência | | 102 |
`102-SITUACAO-IDEAL-UNIFICADA-CANONICA-MULTIRUNTIME-MULTIAGENT.md` | situação ideal unificada para
canonicidade total e expansão multi-runtime/multi-agent | | 103 |
`103-PLANO-EXECUCAO-CONVERGENCIA-CANONICA-GERAL.md` | plano executivo por ondas para convergência
canônica geral com execução iniciada nesta rodada | | 104 |
`104-AUDITORIA-GERAL-SRC-COPILOT-2026-05-04.md` | auditoria geral atualizada, bug corrigido, gaps
remanescentes e próxima transformação recomendada | | 105 |
`105-CHECKPOINT-E3-TIMELINE-SYNC-LAZY-2026-05-04.md` | checkpoint da segunda transformação E3: cauda
viva da timeline sincronizada lazy no Hub | | 106 |
`106-FECHAMENTO-E3-TIMELINE-SEM-RESIDUOS-2026-05-04.md` | fechamento total dos resíduos associados à
timeline unificada E3 |

## Rodada viva 2026-05-06

Documentos adicionados/atualizados nesta rodada:

- `2026-05-05-ROADMAP-PERMISSIONS-END-TO-END.md` — recebeu addendum pós-validação ampla.
- `2026-05-06-AUDITORIA-GERAL-SRC-COPILOT-FLUXOS-PARALELOS-E-GAPS.md` — auditoria geral atual com
  bugs/gaps corrigidos, fluxos paralelos remanescentes e evidência de validação.
- `2026-05-06-ROADMAP-CONVERGENCIA-GERAL-SRC-COPILOT-2.2.md` — roadmap 2.2 expandindo permissions
  para SDK RPC, system prompt, terminal, SSE, elicitation, `ask_user`, hotspots e multi-runtime.
- `2026-05-06-VALIDACAO-FLUXO-CANONICO-2.2-ELICITATION-E-USER-INPUT.md` — checkpoint factual da
  convergência de `elicitation` + `user_input` para surface canônica do SDK.
- `2026-05-06-VALIDACAO-LIVE-TERMINAL-LLM-B-COMUNICACAO.md` — validação live do `terminal:llm-b`,
  comandos REPL, health/config HTTP e limitação externa por rate limit.
- Rodada complementar sem hotspots: padronização de permission decision kinds pelo pacote direto
  `@github/copilot-sdk@0.3.0`, validação de `/permission respond`, remoção de duplicidade SSE em
  `permission.mode_changed` e poda de helpers paralelos de system prompt no adapter HTTP.
- Rodada complementar seguinte: `hooks/elicitation.js` e `hooks/user-input.js` viraram compat
  layers; o owner semântico passou a ser `sdk/session/elicitation.js` e `sdk/session/user-input.js`.
- Rodada complementar atual: `terminal/sdk-interactions.js` alinhou taxonomia de `ask_user` ao
  `DialogProtocol` (`question|ready|reply|stopped`) e `agent/messaging/answerPendingQuestion()`
  passou a tratar `request_user_input` como fallback canônico sem abrir uma segunda borda HTTP.
- Rodada complementar atual (permissions P2): `/permission pending` passou a consultar listagem
  ativa via SDK RPC quando disponível, com fallback explícito para estado observado local quando o
  namespace `permissions` não expõe listagem.
- Rodada complementar atual (R3 runtime targeting): `/stream` e `/stream/tasks` passaram a rejeitar
  `runtimeId` explícito inexistente com `404` antes da abertura do SSE, removendo fallback
  silencioso em superfície operacional.
- Rodada complementar atual (R5 stream isolation): teste multi-runtime passou a provar isolamento
  real por `runtimeId` com dois streams SSE simultâneos (`default`/`audit`) sem bleed de eventos
  cross-runtime.
- Rodada complementar atual (R2 projection única): `config/system-prompt/projection.js` define
  envelope público canônico (`status`, `sdkCompatibility`, `binding`, `freshness`, `session`,
  `instructionSources`, `ownership`) e `runtime-sdk-session`/terminal/server passaram a consumir
  esse shape com compatibilidade legada.
- Rodada live atual: `/permission pending` também hidrata o estado local com requests vindos do RPC,
  preservando `/permission respond <id>` como borda única; `terminal:llm-b` bootou e respondeu
  `/status`, `/sdk waits`, `/permission pending`, `/health` e `/config` sob bloqueio externo de rate
  limit.
- Nova trilha read/write (investigação profunda):
  - `2026-05-06-AUDITORIA-READ-WRITE-AS-IS-SRC-COPILOT.md` — inventário factual AS-IS de
    leitura/escrita, gaps e riscos operacionais.
  - `2026-05-06-ARQUITETURA-ALVO-READ-WRITE-NODE24.md` — proposta TO-BE com contracts canônicos,
    cache/indexação e capacidades Node 24+.
  - `2026-05-06-ROADMAP-READ-WRITE-ULTRAFAST.md` — roadmap faseado (R0–R7) para convergência
    read/write robusta, segura e de alta performance.

## Rodada viva 2026-05-07 — Custom agents SDK-first

- `2026-05-07-ROADMAP-CUSTOM-AGENTS-SDK-FIRST.md` — revisão canônica do documento externo de custom
  agents, com AS-IS corrigido, bugs reais encontrados, decisões SDK-first, implementação aplicada e
  roadmap restante.
- Resultado de código associado: profile `production` agora carrega `agent-full`, `terminal_light`
  mantém maestro no terminal, contratos de agentes validam contra o registry real e o bootstrap de
  tools passou a registrar capabilities de índice/escopo de filesystem.

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
  cadeia de diálogo em `agent-dialog-runtime.js` / `presentation/runtime/dialog.js`.
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
- auditoria transversal do ciclo `terminal:llm-b` (`52`), cobrindo entrada via npm/PM2, boot
  canônico, wiring do runtime, terminal/server, ciclo do `AlwaysAliveAgent`, shutdown central e
  riscos de ownership/ordem.
- roadmap específico de lifecycle (`53`), cobrindo shutdown single-flight, cleanup em boot failure,
  fases explícitas de shutdown, ownership único de recursos, rollback de boot/agent start,
  observabilidade de lifecycle e matriz de sinais TTY/headless/PM2.
- checkpoint complementar de cleanup/provider (`54`), cobrindo a proteção de foreground/last-session
  em `cleanupStaleSessions()` e a validação/normalização canônica de `provider` no builder
  declarativo e nas rotas SDK.
- checkpoint complementar de runtime state/health (`55`), cobrindo a remoção de `state-io` direto em
  `dialog/loop-manager`, a promoção de capabilities semânticas em `agent-runtime-state` e a
  agregação canônica de sinais de health via `agent-health-access`.
- checkpoint complementar de `turn-executor` (`56`), cobrindo a remoção de `persistStateWithPolicy`
  direto do executor de turno e a promoção do marcador de pending turn para `agent-runtime-state`.

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
