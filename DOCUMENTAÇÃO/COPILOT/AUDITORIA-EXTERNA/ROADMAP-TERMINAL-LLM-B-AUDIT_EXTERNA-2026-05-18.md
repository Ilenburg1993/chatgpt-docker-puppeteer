# Roadmap Mestre de Execução — `Terminal LLM-B - Análise: Bugs, Gaps e Oportunidades de Upgrade - AUDIT_EXTERNA.md`

> Documento-base: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/Terminal LLM-B - Análise: Bugs, Gaps e Oportunidades de Upgrade - AUDIT_EXTERNA.md`
>
> Documento complementar de validação: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/VALIDACAO-TERMINAL-LLM-B-AUDIT_EXTERNA-2026-05-18.md`
>
> Anexo temático desta rodada: `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/SESSION-EVENTS-TERMINAL-HARDENING-2026-05-18.md`
>
> Auditorias complementares desta rodada:
>
> - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/COPILOTCLIENT-AUDITORIA-AMPLA-2026-05-18.md`
> - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/SESSIONCONFIG-SUBAGENTES-AUDITORIA-AMPLA-2026-05-18.md`
>
> Data: `2026-05-18`
>
> Escopo operacional: `src/copilot/terminal/**` e integrações imediatas em `src/copilot/agent/**`, `src/copilot/presentation/**`, `src/copilot/sdk/**`, `src/copilot/event-handlers/**`

---

## 1. Objetivo deste roadmap mestre

Este roadmap mestre consolida em um só fluxo:

- a validação forense da auditoria externa;
- o hardening focado em `session-events.d.ts` e na cadeia `session → agent → terminal`;
- a trilha de confiabilidade de testes/runner/Vitest/typecheck;
- a execução contínua de bugs, gaps e upgrades até a LLM-B ter uma UX operacional canônica.

Ele substitui a leitura fragmentada por tema e passa a ser o **plano único de referência**, organizado em **faixas**, **fases** e **subfases**.

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
- **GAP-005** — `/sdk skills` agora expõe discovery de skills na superfície terminal via cadeia canônica do runtime
- **GAP-015** — `/sdk headers` + one-shot `requestHeaders` por turno já percorrem terminal → gateway → bridge → agent, com dispatch SDK direto e reanexo controlado do dialog loop
- **GAP-016** — `/attach blob <mime> <base64> [--name ...]` habilita blobs inline sem roundtrip obrigatório por disco

#### Confirmados e ainda pendentes

- **GAP-009** — adotar `convertMcpCallToolResult()` onde fizer sentido
- **GAP-012** — avaliar `session.rpc.instructions.getSources()` como fonte prioritária
- **GAP-013** — governança/mutação e projeção rica de skills por subagente/custom agent (contrato/config já endurecidos; superfície terminal avançou nesta rodada)

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
- **ACHADO-B** — `requestHeaders` por turno exigia um desvio arquitetural honesto; agora foi entregue via dispatch SDK direto com bounce controlado do dialog loop
- **ACHADO-C** — divergência de runner e warnings de teardown do Vitest foram confirmados, diagnosticados e corrigidos nesta rodada
- **ACHADO-D** — a fachada local do `CopilotClient` não estava em paridade full com o `client.d.ts` instalado; auditoria dedicada criada e correções desta rodada entregam `startClient`, `getClientSessionMetadata` e builder/options completos
- **ACHADO-E** — `SessionConfig`/`ResumeSessionConfig` e `CustomAgentConfig` não estavam totalmente parificados com o `types.d.ts` instalado; auditoria dedicada criada e correções desta rodada entregam builder dedicado de resume, sanitização estrutural, surface HTTP serializável full e hardening de subagentes (`skills`, `mcpServers`, `description?`, `tools=[]`)

---

## 4. Estratégia de execução por faixas, fases e subfases

## Faixa 0 — Governança documental, baseline e convergência de diagnóstico

### Fase 0.1 — Canonicalização documental

#### Subfase 0.1.1 — Formato canônico

- converter `.mds` → `.md`;
- remover referências residuais ao formato antigo;
- garantir que auditoria, validação e roadmap apontem para os mesmos artefatos.

**Status:** concluída.

#### Subfase 0.1.2 — Consolidação em roadmap mestre

- absorver no roadmap principal os achados de `VALIDACAO-TERMINAL-*` e `SESSION-EVENTS-*`;
- separar claramente o que é:
   - bug ativo;
   - gap funcional;
   - hardening latente;
   - upgrade oportunístico;
- incluir também a trilha de runner/testes/Vitest no mesmo roadmap, sem abrir plano paralelo.

**Status:** concluída nesta rodada, com saneamento do plano único e remoção das narrativas paralelas.

### Fase 0.2 — Baseline técnico reproduzível

#### Subfase 0.2.1 — Leitura integral e sincronização

- ler `package.json` completo;
- sincronizar com `origin/main`;
- rodar baseline mínimo de lint/typecheck/testes do escopo Copilot.

**Status:** concluída.

#### Subfase 0.2.2 — Convergência de diagnóstico

- confrontar auditoria externa, `session-events.d.ts`, README do SDK e código real;
- verificar se há arquiteturas paralelas ou owners concorrentes de eventos;
- consolidar o diagnóstico em uma única leitura sistêmica.

**Status:** concluída, com follow-up contínuo.

## Faixa 1 — Cadeia canônica session/agent/terminal e UX operacional

### Fase 1.1 — Robustez imediata do terminal

#### Subfase 1.1.1 — Fluxos críticos

- restart do dialog loop;
- timeout seguro;
- input pendente;
- dedup de I/O;
- dedup de tool lifecycle;
- sinalização mínima de bootstrap/teste.

**Status:** majoritariamente concluída.

#### Subfase 1.1.2 — Retrocompatibilidade e contratos internos

- manter helpers internos resilientes a call sites legados de teste e suporte;
- evitar regressões por drift de assinatura em utilitários do terminal.

**Status:** concluída nesta rodada, com retrocompatibilização dos contratos exercitados pelas suítes de teste.

### Fase 1.2 — UX durável e narrativa operacional

#### Subfase 1.2.1 — Remover “flashs” como portador único de informação

- promover snapshots duráveis de `tool.execution_progress`;
- tornar heartbeat de tool longa visível no histórico;
- garantir que `writeInlineStatus(...)` seja auxiliar, não exclusivo.

**Status:** concluída nesta rodada para os casos priorizados; backlog complementar permanece aberto para outras famílias efêmeras.

#### Subfase 1.2.2 — Notificações sistêmicas do agent

- promover `system.notification` relevantes para narrativa terminal:
   - background task completed/idle;
   - shell completed/detached completed;
- padronizar o owner terminal desses eventos.

**Status:** concluída nesta rodada para `agent.background.*` e `agent.shell.*`; demais famílias continuam no backlog complementar.

### Fase 1.3 — Cobertura explícita do recorte `session-events` 946–1828

#### Subfase 1.3.1 — Famílias já maduras

- `assistant.message`;
- `assistant.turn_*`;
- `tool.execution_start/complete`;
- `permission.*`;
- `user_input.*`;
- `elicitation.*`;
- `external_tool.*`.

**Status:** bom/canônico.

#### Subfase 1.3.2 — Famílias ainda parciais ou ausentes

- `assistant.usage` → endurecido via owner explícito em `pr.consumed` / `pr.fallback_model`;
- `hook.*` → exposto no terminal;
- `sampling.*` → exposto no terminal;
- `commands.changed` / `capabilities.changed` → expostos com narrativa terminal básica;
- `auto_mode_switch.*` → exposto no terminal;
- `exit_plan_mode.requested` → exposto no terminal;
- attachments `blob` → superfície mínima entregue via `/attach blob`.

**Status:** majoritariamente concluída; o residual principal aqui é aprofundar `command.*`/diffs ricos e manter a UX cada vez mais explicativa.

## Faixa 2 — Superfície SDK 0.3.0 sem duplicação arquitetural

### Fase 2.1 — RPCs operacionais mínimas

#### Subfase 2.1.1 — Já entregues

- reset de approvals;
- `mcp.oauth.login()`;
- `/sdk quota` via `usage.getMetrics()`.

**Status:** concluída.

#### Subfase 2.1.2 — Próxima expansão canônica

- `skills.*` na superfície terminal — **surface mínima entregue** por `/sdk skills`;
- `instructions.getSources()` como fonte de verdade preferencial — **já refletido** em `/sdk prompt`, ainda sem refinamento extra;
- correlação de `assistant.usage` com quota e sessão.

**Status:** parcialmente concluída.

### Fase 2.2 — Inputs avançados por turno

#### Subfase 2.2.1 — `requestHeaders` por turno

- expor contrato ponta-a-ponta no terminal/gateway/presentation/agent;
- evitar bypass lateral via camadas paralelas.

**Status:** concluída nesta rodada — a surface terminal foi entregue por `/sdk headers`, com armazenamento one-shot local, consumo no próximo turno do usuário e dispatch SDK direto com reanexo do dialog loop porque o caminho zero-PR de `ask_user` não carrega `requestHeaders` honestamente.

### Fase 2.3 — Paridade full de `CopilotClient`

#### Subfase 2.3.1 — Métodos do `client.d.ts`

- fechar lookup dedicado de metadata por sessão;
- validar a cobertura real de `start/stop/forceStop/create/resume/list/delete/foreground/lifecycle`;
- garantir que a superfície local use os métodos dedicados do SDK quando existirem.

**Status:** majoritariamente concluída nesta rodada (`startClient` explícito, `getClientSessionMetadata`, rota `/sessions/:id` endurecida).

#### Subfase 2.3.2 — Opções de `CopilotClientOptions`

- garantir builder fluente e suporte de env para todas as opções relevantes do pacote instalado;
- documentar explicitamente drift entre README e typings instalados (ex.: `copilotHome` fora do pacote local);
- manter `autoRestart` apenas como pass-through deprecated/no-op, sem fingir semântica inexistente.

**Status:** concluída nesta rodada para `cwd`, `isChildProcess`, `autoRestart`, `sessionFs` e `sessionIdleTimeoutSeconds`.

### Fase 2.4 — Paridade full de `SessionConfig`, `ResumeSessionConfig` e subagentes

#### Subfase 2.4.1 — `SessionConfig` / `ResumeSessionConfig`

- garantir builder dedicado para `ResumeSessionConfig` no lugar correto;
- impedir vazamento de campos exclusivos de create (`sessionId`) para resume;
- impedir vazamento de `disableResume` em `SessionConfig` normal;
- expor na rota HTTP toda a parte serializável restante de `SessionConfig`/`ResumeSessionConfig` (`modelCapabilities`, `enableConfigDiscovery`, `includeSubAgentStreamingEvents`, `defaultAgent`, `gitHubToken`).

**Status:** concluída nesta rodada.

#### Subfase 2.4.2 — `CustomAgentConfig` / subagentes

- alinhar typedefs/schemas/factories ao contrato oficial (`description?`, `mcpServers?`, `skills?`);
- parar de tratar `tools=[]` como erro estrutural quando o SDK aceita o contrato;
- validar preload de skills por subagente contra `skillDirectories` e `disabledSkills` reais da sessão.

**Status:** concluída nesta rodada na camada de contrato/config/factory; follow-up permanece apenas para UX/projeções mais ricas.

#### Subfase 2.2.2 — Blob attachments

- suportar `UserMessageAttachmentBlob` no terminal;
- evitar roundtrip forçado por filesystem quando não necessário.

**Status:** parcialmente concluída — `/attach blob` já atende o caso inline; o residual é eventual caminho binário nativo além do embed textual zero-PR.

## Faixa 3 — Confiabilidade de testes, runner e validação estrita

### Fase 3.1 — Verdade do runner

#### Subfase 3.1.1 — Diagnóstico de divergência

- explicar por que `npm test -- --run ...` mostrou problemas que `test:copilot:unit` não mostrou;
- separar erro real de erro causado por escopo/configuração errada.

**Diagnóstico consolidado:**

- `npm test -- --run ...` não era equivalente a rodar apenas um subset Copilot; ele ainda expandia para `test:unit && test:integration && test:regression`;
- `test:unit` usava `run-mixed-tests.mjs`, que até aqui executava vitest híbrido inteiro sob uma única config;
- quando o lote continha arquivos Copilot e não-Copilot, os testes Copilot podiam rodar sob `vitest.config.js`, sem a baseline de `tests/support/setup.js` e sem a config específica do domínio.

#### Subfase 3.1.2 — Correção estrutural do runner

- separar o lote Vitest em:
   - specs Copilot → `vitest.copilot.config.js`
   - specs genéricas → `vitest.config.js`
- eliminar discrepância artificial entre `test:unit` e `test:copilot:unit`.

**Status:** concluída nesta rodada.

### Fase 3.2 — Correção de falhas reais expostas pelos testes

#### Subfase 3.2.1 — Drift de contratos e mocks

- mocks incompletos de `deps.js` em rotas SDK;
- mock parcial de `#copilot/core/error-handlers` quebrando `toError` no barrel;
- testes stale de `read-tools` assumindo exportações que já migraram para `search/`.

**Status:** concluída nesta rodada.

#### Subfase 3.2.2 — Contratos de retorno e filtros canônicos

- retrocompatibilizar `isDuplicateIoOperation(...)`;
- corrigir `filterIndexRowsByGlob(...)` para excluir segmentos como `node_modules`;
- completar retorno textual de `find_symbol_usages` para UX e contratos de teste.

**Status:** concluída nesta rodada.

### Fase 3.3 — Typecheck estrito de testes

#### Subfase 3.3.1 — Eliminar todos os erros de `typecheck:strict:tests.unit`

- narrowing em arrays/matches regex;
- mocks compatíveis com assinaturas atuais;
- parâmetros implicit `any`;
- handlers de tools com assinatura nova.

**Status:** concluída nesta rodada.

#### Subfase 3.3.2 — Padronizar validação final

- `npm run typecheck:strict:tests.unit`;
- `npm run test:unit`;
- `npm run test:copilot:unit`;
- `npm run typecheck:strict:src.copilot`;
- `npm run lint:copilot`.

**Status:** concluída nesta rodada; baseline inteira ficou verde.

### Fase 3.4 — Warning-zero no Vitest

#### Subfase 3.4.1 — Classificar warnings de workers

- verificar se a causa é `pool: 'forks'`, paralelismo excessivo, teardown ou algum leak real;
- distinguir warning infraestrutural de bug de teste.

#### Subfase 3.4.2 — Fix definitivo

- ajustar pool/concurrency/configuração até zerar os warnings;
- revalidar para garantir que `test:copilot:unit` não “passe verde com ruído escondido”.

**Status:** concluída nesta rodada; warnings zerados com o split correto do runner e `vitest.copilot.config.js` em `threads` com concorrência mais conservadora.

## Faixa 4 — Estado longo, persistência e hardening residual

### Fase 4.1 — Sessão longa

#### Subfase 4.1.1 — Interações e retenção

- consolidar otimização de poda das interações;
- considerar índice incremental apenas se o volume real justificar.

**Status:** parcial.

#### Subfase 4.1.2 — Timeline/backoff persistente

- persistir backoff/retry state onde fizer sentido;
- evitar bursts de resync após restart curto.

**Status:** pendente.

### Fase 4.2 — Re-registro defensivo de timers/listeners

#### Subfase 4.2.1 — Dev-watch e reinicializações anômalas

- revisar listeners/timers duplicáveis em cenários extremos;
- reduzir risco residual que substituiu o antigo BUG-010.

**Status:** pendente.

## Faixa 5 — Upgrades arquiteturais controlados

### Fase 5.1 — Upgrades de alto encaixe

#### Subfase 5.1.1 — Encaixe progressivo

- `AbortSignal.timeout()` em pontos adicionais;
- tipagem mais forte de eventos;
- utilitário compartilhado para TTL maps;
- `structuredClone()`/`Object.groupBy()`/`import.meta.dirname` onde agregarem valor claro.

**Status:** backlog controlado.

### Fase 5.2 — Upgrades deliberadamente não-baseline

#### Subfase 5.2.1 — Não forçar por moda

- `EventTarget` amplo;
- `WeakRef`/`FinalizationRegistry`;
- `scheduler.wait()`;
- SSR/streaming alternativo sem necessidade operacional.

**Status:** backlog / não-prioritário.

## Faixa 6 — Critérios de saída desta trilha

### Fase 6.1 — Convergência funcional

#### Subfase 6.1.1 — Sem bugs ativos escondidos

- nenhum bug confirmado restante sem destino formal;
- nenhum warning recorrente do Vitest sem causa conhecida;
- nenhuma divergência artificial entre `test:unit` e `test:copilot:unit`.

### Fase 6.2 — Convergência de UX operacional

#### Subfase 6.2.1 — Terminal como console de operação contínua

- progresso importante deixa rastro durável;
- agent/background/shell/tool/session têm owners claros na narrativa;
- não há “flash” relevante que desaparece sem registro.

### Fase 6.3 — Convergência de documentação

#### Subfase 6.3.1 — Documentos contam a mesma história

- validação, anexo de session-events e roadmap mestre sem contradições;
- estado final narrado com o mesmo conjunto de prioridades e fases.

## 5. Estado resumido desta rodada

- **Faixa 0**: consolidada; este arquivo passa a ser o plano único limpo e sem duplicações narrativas.
- **Faixa 1**: além do hardening de progresso/heartbeat, a superfície terminal agora cobre explicitamente `assistant.usage` (via `pr.consumed`), `hook.*`, `sampling.*`, `commands.changed`, `capabilities.changed`, `auto_mode_switch.*` e `exit_plan_mode.requested`.
- **Faixa 2**: reset approvals, quota metrics e OAuth MCP já entregues; `skills` agora têm surface mais rica por `/sdk skills`, `/sdk skills config`, `/sdk skills agents` e mutação básica de `disabledSkills` via `/sdk skills disable|enable`; `instructions` já aparecem em `/sdk prompt`, blobs já têm surface mínima por `/attach blob`, `requestHeaders` por turno foram entregues via `/sdk headers` + dispatch SDK direto com reanexo controlado, e a paridade estrutural de `CopilotClient` + `SessionConfig`/`ResumeSessionConfig`/subagentes foi auditada e endurecida.
- **Faixa 3**: concluída nesta rodada — runner corrigido, warnings zerados, `typecheck` estrito verde e convergência entre `test:unit` e `test:copilot:unit` comprovada.
- **Faixa 4+**: permanecem como continuação natural agora que a baseline de validação está realmente verde e sem warnings.

## 6. Próxima sequência obrigatória de execução

1. consolidar `skills.*` com persistência/config declarativa alinhada ao estado server-scoped e correlação mais rica com eventos `subagent.*` (**GAP-013**);
2. enriquecer `command.*`, `commands.changed` e `capabilities.changed` com diffs/estado operacional mais ricos;
3. só depois voltar à **Faixa 4** para persistência longa, re-registro defensivo residual e upgrades arquiteturais controlados.

## 7. Observação de governança

Os anexos temáticos continuam úteis, mas deixam de ser o “plano principal”.

O **roadmap mestre canônico** passa a ser este arquivo.

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

- GAP-016 — blob attachments

**Status:** parcialmente concluída — `requestHeaders` já foram entregues com surface terminal e blobs já têm superfície mínima; o residual é eventual caminho binário nativo futuro além do embed textual zero-PR.

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
- `COPILOTCLIENT-AUDITORIA-AMPLA-2026-05-18.md`
- `SESSIONCONFIG-SUBAGENTES-AUDITORIA-AMPLA-2026-05-18.md`

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

3. **se a validação ficar verde, avançar para a continuação da Faixa 2**
   - governança/mutação de `skills.*` e projeção por subagente;
   - depois `instructions.getSources()` / `convertMcpCallToolResult()`;
   - e só então retomar timeline/backoff/persistência de falhas de sync.

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
