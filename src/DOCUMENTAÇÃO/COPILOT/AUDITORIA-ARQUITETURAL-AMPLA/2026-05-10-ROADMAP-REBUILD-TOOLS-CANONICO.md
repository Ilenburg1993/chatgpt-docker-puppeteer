# Roadmap Canônico de Rebuild — `src/copilot/tools/`

> **Data**: 2026-05-10 **Base externa analisada**: `2026-05-10-AUDITORIA-TOOLS.md` (tratada como
> evidência externa, não fonte de verdade) **Status**: Plano mestre ativo (execução incremental;
> rodada ampla de 2026-05-12 consolidada)

---

## Objetivo

Reconstruir `src/copilot/tools/` como um subsistema canônico, com:

- fronteiras arquiteturais explícitas;
- observabilidade unificada (sem dupla contagem);
- estado isolável por sessão e testável;
- compatibilidade reversa progressiva;
- **máxima liberdade operacional da LLM-B** por padrão.

---

## Princípios de projeto (obrigatórios)

1. **LLM-B first**: por padrão, sem timeouts bloqueantes por tempo; usar sinais de saúde, watchdogs
   sem kill cego e circuit-breakers orientados a erro real.
2. **Timeouts são advisory**: quando existirem, servem telemetria/diagnóstico; cancelamento temporal
   só por política explícita de runtime.
3. **Configuração via ENV sem restrição padrão**: limites ficam configuráveis, com defaults voltados
   à liberdade.
4. **Evidência > documento externo**: cada item da auditoria externa deve ser validado no código
   antes da correção.
5. **Correção estrutural > patch ad hoc**: priorizar consolidação de contratos e boundaries.

---

## Resultado da validação inicial (auditoria externa x código real)

> **Nota de evolução**: esta seção captura o snapshot inicial de 2026-05-10. Parte dos itens abaixo
> já mudou de estado após o hardening e a revalidação de 2026-05-11. Ver
> `2026-05-11-VALIDACAO-CLAIMS-EXTERNAS-DELTA.md` para o delta pós-estabilização.

### Revalidação profunda consolidada (estado atual em 2026-05-12)

#### Já corrigidos / superados

- `BUG-02` — timeout RPC morto/ignorado → corrigido com semântica advisory explícita.
- `BUG-03` — fallback da factory sem schema → corrigido.
- `BUG-06` — race estrutural de cleanup em `request_user_input` → corrigido/mitigado fortemente.
- `BUG-07` — parse JSON inválido no fallback DDG → corrigido.
- `BUG-11` — pending input órfão no teardown → corrigido/mitigado fortemente.
- `SEC-01` — cache frágil de `safeEnv` → corrigido.
- `SEC-03` — checagem de capacidade após geração de ID → corrigido.
- `SDK-BUG-03` — overwrite silencioso no registry → corrigido.
- `SDK-BUG-04` — falta de reset de `_toolsConfig` para testes → corrigido.
- `OBS-BUG-03` / `SYS-GAP-04` — blind spot quantitativo de denies → **corrigido no runtime canônico
  do agent**.
- `BUG-24` — MCP bridge com state module-level mutável → **corrigido** com factory de instância
  (`createMcpToolBridge`) + singleton compatível.
- `BUG-25` / `SYS-GAP-15` — MCP bridge fora da factory canônica → **corrigido no eixo de factory**
  com convergência para `buildTool`.
- `BUG-04` / `BUG-10` — política canônica para `Infinity` em file tools → **formalizada** como
  policy por ENV com defaults unbounded e truncamento explícito apenas sob configuração finita.

#### Obsoletos / falso positivo no estado atual

- `BUG-01` — claim baseada numa topologia anterior do bootstrap de tools.
- `BUG-12` — stale import de `isToolDisabled` não se sustenta como bug real no fluxo atual.
- `SDK-BUG-06` — leitura antiga sobre dualidade de user-input ficou majoritariamente superada pela
  superfície atual baseada em `ToolSessionContext` + integração SDK.

#### Reescopados (o problema real mudou)

- `SDK-BUG-01` / `OBS-BUG-02`
  - **não** são mais lidos como “duas factories gerando dupla métrica automática em todo caminho”;
  - o gap real atual é **ownership fragmentado da telemetria de tools** e **drift de naming** entre
    planos (`tool-stats`, `defaultMetrics`, bridges e registros manuais).

#### Ainda ativos e no backlog estrutural

- convergência final do MCP bridge para uso **injetado por runtime/sessão**, em vez de depender
  principalmente do singleton default exposto pelo wrapper compatível.
- contract tests e health-checks dedicados para a nova policy finita das file tools
  (content/search/list/diff) ainda merecem expansão.
- próxima onda ampla fora de `tools/`: reorganização barrel-first de `presentation/` como **shared
  edge layer**, sem repetir a topologia plana atual.

#### Gaps adicionais encontrados na investigação

- warnings recoverable do `tool-factory` ainda podem surgir em grafos SSR/mocks muito específicos,
  embora o caminho principal esteja hoje sem warnings na suíte Copilot consolidada;
- o MCP bridge já convergiu para a factory canônica, mas a injeção contextual por runtime ainda não
  substituiu totalmente o wrapper singleton default.

### Confirmados na base atual

- Dead code de timeout advisory em `session-rpc-tools` (parametrização ignorada).
- Risco de sobrescrita silenciosa no registry (`registerTool` sem warning).
- Fragilidade do cache de `safeEnv` acoplado a propriedade de função.
- Janela de inconsistência em `request_user_input` (geração de ID antes da checagem de capacidade).
- Ausência de teardown explícito para requests estruturados pendentes ao desmontar sessão.

### Parcialmente verdade / precisa recorte

- “Double wrapping” existe ao nível de logging, mas sem prova automática de double metric em todos
  os caminhos.
- “Limites Infinity = bug” precisa ser tratado à luz da diretriz LLM-B first (sem bloqueio default);
  solução deve ser **policy-driven** e não hard-cap cego.

### Falso-positivo identificado

- `bootstrapTools` chama `getAllTools(registry)` do SDK (`#copilot/sdk`), cujo contrato aceita
  `registry`; não é o `getAllTools()` local de `tools/index.js`.

---

## Arquitetura canônica alvo (v2)

###[A] Camadas

1. **Tools Surface** (`src/copilot/tools/**`): apenas definição de tools e adapters finos.
2. **Capabilities/Ports** (`src/copilot/tools/capabilities/**`): contratos de execução (shell, fs,
   rpc, policy, input).
3. **Domain Services** (`src/copilot/domain/tools/**`): regras de negócio (todo workflow, policies,
   resolução de estado).
4. **Infra Providers** (`src/copilot/infra/**`): IO, DB, índice, observabilidade concreta.
5. **SDK Bridge** (`src/copilot/sdk/**`): protocolo e integração com Copilot SDK.

###[B] Regras de dependência

- `tools/*` **não importa** `infra/*` direto (exceto adapters dedicados em
  `capabilities/providers`).
- `tools/*` conversa com `domain/*` e `capabilities/*`.
- `sdk/*` não depende de detalhes internos de `tools/*` além de contratos públicos.

###[C] Contratos canônicos

- `ToolDefinitionContract`
- `ToolExecutionTelemetryContract`
- `ToolPermissionDecisionContract`
- `UserInputBridgeContract`

---

## Backlog priorizado (execução)

### Fase 0 — Hardening imediato (P0/P1 curtos)

1. Corrigir timeout advisory em `session-rpc-tools` (sem timeout bloqueante).
2. Warning de overwrite no `ToolRegistry`.
3. Trocar cache `safeEnv` para estado privado de módulo.
4. Ajustar `request_user_input` para validar limite antes de emitir `requestId`.
5. Fechar pendências de `request_user_input` no teardown de sessão.

### Fase 1 — Unificação de observabilidade e factory

1. Definir **um único owner** de wrapping/logging/metrics (`sdk/tools/core` ou `tools/tool-factory`,
   não ambos).
2. Extrair converter Zod→JSON Schema para módulo único compartilhado.
3. Eliminar divergência de naming e padronizar metadados de tool.
4. Normalizar também o plano de telemetria entre `tool-stats`, `defaultMetrics` e registros manuais
   de bridges/tools.

### Fase 2 — Estado por sessão e input bridge único

1. Introduzir `ToolSessionContext` (estado por sessão).
2. Migrar `user-input-state` para adapter do fluxo canônico SDK (`session/user-input`).
3. Eliminar singletons mutáveis não necessários por módulo.

### Fase 3 — Boundary enforcement + refactor de domínios

1. Reestruturar `tools/file` em `io/`, `search/`, `scope/` com barrels de compatibilidade.
2. Separar `todo` em `domain`, `repository`, `tools-adapter`.
3. Adicionar lint rules de fronteira (import restrictions + validação em CI).

### Fase 4 — Governança contínua

1. Tool contract tests por categoria.
2. Health-checks granulares por subsistema (`file`, `todo`, `shell`, `registry`, `user-input`).
3. Dashboard de eventos bloqueados e tentativas negadas (observabilidade completa de permissão).

---

## Backlog ativo pós-revalidação + transformação desta rodada

### A. Fechado nesta rodada

1. **Blind spot de denies no runtime canônico**

- `withAgentRuntimeToolPolicy()` passou a registrar `recordBlockedToolCall(toolName)`;
- `tool-stats` agora expõe `blocked` / `lastBlockedIso` por tool;
- `get_tool_health` agora expõe `totalBlocked`.

### B. Fechado nesta rodada ampla (2026-05-12)

1. **Política canônica para `Infinity` em file tools formalizada**

- decisão adotada: **policy por ENV com defaults unbounded**;
- variáveis finitas ativam truncamento explícito e observável no boundary das tools;
- default preserva o princípio LLM-B first.

2. **Estado do MCP bridge encapsulado por instância/contexto**

- introduzida factory `createMcpToolBridge()`;
- wrapper singleton default preservado para backward compatibility;
- dependencies default ficaram lazy para reduzir acoplamento de import/mocks.

3. **MCP bridge trazido para a superfície canônica de factory**

- criação de tools MCP agora converge para `buildTool` via barrel canônico `#copilot/tools`;
- compatibilidade pública mantida (`buildMcpTools`, `listMcpTools`, `getMcpStatus`,
  `startMcpAutoReconnect`).

### C. Próximo lote de transformação ampla

1. **Consolidação barrel-first de `presentation/`**

- ✅ topologia física inicial aplicada (`agent`, `routing`, `runtime`, `state`, `files`, `system`,
  `conversation`, `sdk`, `contracts`);
- ✅ superfícies públicas explícitas em `package.json` adicionadas para `presentation/*` sem
  curingas;
- ✅ `server/` e `terminal/` religados para consumir sub-barrels dos novos subdomínios;
- ✅ sub-surface `agent/runtime/index.js` introduzida para quebrar ciclos e estreitar lookup/seleção
  de runtime;
- 🔄 próximo: continuar PBF-3/PBF-4/PBF-5 com minimização do root barrel, explicitação adicional de
  `runtime/index.js` e decomposição dos hotspots principais (`agent/control.js`,
  `state/ui-store.js`, `system/metrics.js`, `runtime/health.js`, `runtime/sdk-session.js`);
- 🔄 próximo: endurecer ainda mais a governança para impedir regressão de deep imports e reforçar a
  regra `presentation/`→`!terminal/!server`.

2. **Expandir ainda mais contract tests da policy finita das file tools**

- completar cobertura também para `search_in_files` e `workspace_symbol_search`;
- validar defaults unbounded explicitamente como contrato arquitetural.

3. **Reduzir ainda mais warnings TDZ-safe residuais fora do caminho principal**

- não é bug funcional no fluxo validado, mas continua relevante para robustez de grafos SSR/mocks
  extremos.

---

## Política de liberdade operacional da LLM-B

- Sem kill por timeout temporal como mecanismo primário.
- Detectar “hanging” por:
  - ausência de progresso observável;
  - watchdog de eventos (heartbeats de execução);
  - sinais de deadlock/state starvation;
  - critérios configuráveis por domínio.
- Timeout temporal só entra como fallback explícito de segurança operacional (opt-in).

---

## Estratégia de migração segura

1. **Compatibilidade reversa por barrels** durante 2 ciclos.
2. Flags internas para ativar nova pipeline gradualmente.
3. Métricas comparativas (antes/depois) sem regressão funcional.
4. Rollback simples por feature flag em pontos críticos.

---

## Critérios de pronto (Done)

- Nenhum P0 aberto validado.
- P1 críticos de estado/observabilidade mitigados.
- Um único fluxo canônico de instrumentação de tools.
- Fluxo único de user-input por sessão.
- Dependências entre camadas com enforcement automático.

---

## Registro de execução (início)

- ✅ Leitura integral e validação inicial da auditoria externa concluídas.
- ✅ Primeiro lote de correções P0/P1 iniciado em código.
- ✅ Lote P1-2 concluído: redução de double-wrapping em `tool-factory` (instrumentação delegada ao
  SDK).
- ✅ Lote P1-2 concluído: fallback da factory endurecido com normalização de parâmetros no caminho
  recoverable.
- ✅ Lote P1-2 concluído: `web_search` com tratamento explícito de payload JSON inválido no fallback
  DDG.
- ✅ Lote P1-2 concluído: isolamento de estado reforçado em `sdk/tools/state` (clones defensivos).
- ✅ Lote P1-2 concluído: boundary enforcement progressivo em `eslint.config.mjs` (modo `warn`) para
  `tools/`→`infra/db`.
- ✅ 2026-05-11: escopo `src/copilot` revalidado com `typecheck strict`, `eslint` e
  `npm run test:copilot` verdes.
- ✅ 2026-05-11: branch `main` sincronizada com `origin/main` após push do lote estrutural.
- ✅ 2026-05-11: claims externas revalidadas; parte do material original passou a estado
  **corrigido**, **obsoleto** ou **ainda ativo** com evidência objetiva
  (`2026-05-11-VALIDACAO-CLAIMS-EXTERNAS-DELTA.md`).
- ✅ 2026-05-11: blind spot quantitativo de denies fechado no runtime canônico do agent
  (`hook-port` + `tool-stats` + `get_tool_health`).
- ✅ 2026-05-11: `npm run typecheck:strict:tests.unit` voltou a verde após saneamento tipado das
  suítes de apoio no escopo Copilot.
- ✅ 2026-05-11: owner único da telemetria de tools consolidado (`tool-stats` canônico +
  `MetricsStore` delegado + remoção de writers duplicados em terminal/collectors/shell + UX do
  `/tools` alinhada).
- ✅ 2026-05-12: política de saída das file tools formalizada como ENV policy-driven com defaults
  unbounded (`COPILOT_FILE_TOOLS_MAX_*`).
- ✅ 2026-05-12: `src/copilot/bridges/mcp-tool-bridge.js` migrado para factory canônica
  (`buildTool`) e encapsulado por instância (`createMcpToolBridge`).
- ✅ 2026-05-12: dependências default do MCP bridge tornadas lazy para reduzir acoplamento com mocks
  e grafos de importação.
- ✅ 2026-05-12: runtime do agent passou a materializar uma capability MCP canônica por instância
  via `agent/ports/mcp-port.js`, consumida por `session-setup` e `boot-runtime-bind` sem fallbacks
  espalhados.
- ✅ 2026-05-12: contract tests finitos adicionados para a policy das file tools
  (`read_file_content`, `list_directory`, `diff_files`) com validação de metadados de truncamento.
- ✅ 2026-05-12: rodada ampla revalidada com `npm run test:copilot`, `npm run typecheck:strict:all`
  e `npm run lint` verdes.
- ✅ 2026-05-12: `main` sincronizada com `origin/main` após organização dos commits do lote
  estrutural em tooling, runtime MCP/file-tools e terminal/events.
- ✅ 2026-05-12: avaliação profunda da borda `terminal/` consolidada em
  `2026-05-12-TERMINAL-BARREL-FIRST-ARQUITETURA-2.1.md`, seguida de execução ampla da fase
  barrel-first (root barrels puros, barrels recursivos, minimização de surface, anti-bypass e
  boundary inversion do boot).
- ✅ 2026-05-12: provado por evidência que `src/copilot` fora de `terminal/` não depende mais do
  terminal; o boot canônico agora é `terminal/bootstrap.js -> boot/runtime-bootstrap.js` com host
  terminal injetado.
- ✅ 2026-05-12: investigação profunda de `presentation/` consolidada em
  `2026-05-12-PRESENTATION-BARREL-FIRST-ARQUITETURA-2.1.md`, definindo a próxima onda barrel-first
  adaptada ao papel de shared edge layer.
- 🔄 Próximo: executar a reorganização barrel-first de `presentation/`, completar a cobertura
  contratual da policy finita das file tools e reduzir warnings TDZ-safe residuais.
