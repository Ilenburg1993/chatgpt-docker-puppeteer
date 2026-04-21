# 01-TERMINAL-LLM-B — Auditoria do Módulo `terminal/`

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Módulo**: `src/copilot/terminal/` **Foco**:
Ponto de entrada `npm run terminal:llm-b`, toda a cadeia de boot, REPL, DI, wiring de eventos.
**Documentado em**: 2026-04-18

---

## 1. Cadeia de Inicialização Completa

> **Status de execução (2026-04-17): smoke test aprovado.** O task `shell: terminal:llm-b` subiu com
> sucesso, consumiu o boot prompt, entrou em `READY` e exibiu `LLM-B pronta — pode começar` no
> terminal.
>
> **Revalidação adicional do boot real (2026-04-17):**
>
> - a ausência opcional de `custom-tools.json` não gera mais `logSwallowed` de erro;
> - o terminal continua subindo em modo standalone com MCP ausente, mas sem o ruído anterior de
>   fallback ambíguo no registry de custom tools;
> - o log de `SessionKeepalive` agora explicita o motivo da parada (`dialog_loop_active`), deixando
>   claro que o stop durante o boot é intencional;
> - os falsos warnings de boot recovery F53 deixaram de aparecer quando a retomada da sessão ainda
>   está em `processing`.
> - o runtime do terminal/agent passou a usar `gpt-5-mini` com `reasoning=high` como defaults
>   canônicos.
> - o REPL agora constrói prompt dinâmico com `modelo/esforço` (e marcador `PLAN` quando aplicável),
>   reduzindo ambiguidade operacional.
> - o prompt dinâmico também passou a refletir o modo real do SDK (`MODE:PLAN`, `MODE:AUTOPILOT`,
>   etc.) quando ele diverge do estado local do terminal.
> - o terminal agora consome `tool.execution_partial_result`, `session.mode_changed`,
>   `session.plan_changed`, `session.info`, `session.warning`, `session.model_change`,
>   `session.context_changed` e `exit_plan_mode.completed` como sinais operacionais visíveis.

```
npm run terminal:llm-b
  → COPILOT_LOG_LEVEL=INFO node --strip-types src/copilot/terminal/bootstrap.js
    → bootCopilot()                         [src/copilot/bootstrap.js]
      Phase 1: initTelemetry(), configureNerv()
      Phase 2: loadLateDependencies(), container.validateRequired([8 tokens])
      Phase 3: wireTerminalDI(), startTerminalServer()
        → startTerminalServer()             [src/copilot/terminal/index.js ~380L]
          → startInjectServer()             [channel/inject-server.js]
          → startCopilotServer()            [server/app.js]  ← Promise armazenada, não awaited imediatamente
          → wireTerminalDI()                [terminal/di-wiring.js]
          → wireTerminalAgentEvents()       [terminal/terminal-agent-wiring.js]
          → startRepl()                     [terminal/repl.js]
          → agent.start()                   [agent/always-alive.js]
```

---

## 2. Arquivo: `terminal/bootstrap.js`

**Função**: Entry point para o script npm. **LOC**: 15

### Código Crítico

```js
bootCopilot().catch((err) => {
  console.error('[bootstrap] Falha crítica ao iniciar:', err);
  process.exitCode = 1;
});
```

### Achados

| ID              | Sev | Descrição                                                                                                                                                                                                                           |
| --------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-BOOT-05** | P2  | Define `process.exitCode = 1` mas NÃO chama `process.exit()`. O processo pode continuar em estado indeterminado se timers ou listeners estiverem ativos. Em Node.js, `exitCode` só é honrado se o event loop esvaziar naturalmente. |

> **Status de execução (2026-04-17): corrigido no código.**

### Recomendação

```js
bootCopilot().catch((err) => {
  console.error('[bootstrap] Falha crítica ao iniciar:', err);
  process.exitCode = 1;
  process.exit(1);
});
```

---

## 3. Arquivo: `bootstrap.js` (canônico)

**Função**: Orquestrador de boot em 3 fases. **LOC**: ~120

### Achados

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-BOOT-01** | P2  | `container.validateRequired([8 tokens])` é chamado no final da **Phase 2**, mas `wireTerminalDI()` só é executado na **Phase 3**. Tokens como `ALWAYS_ALIVE_AGENT` e `TERMINAL_SERVER_OPTIONS` são registrados _depois_ da validação. A validação na Phase 2 valida apenas tokens dos módulos core/infra/sdk, não os tokens do terminal — gap de cobertura, não falha imediata (desde que wireTerminalDI esteja OK). |
| **GAP-BOOT-04** | P3  | Flag `_booted` não tem mecanismo de reset. Em testes que chamam `bootCopilot()` múltiplas vezes, o segundo call é silenciosamente ignorado — dificulta testes de lifecycle.                                                                                                                                                                                                                                          |

> **Status de execução (2026-04-17): `GAP-BOOT-01` mitigado no código.** O `bootstrap` agora chama
> `wireTerminalDI()` antes de `startTerminalServer()`, e o wiring ficou idempotente. Com isso, os
> tokens do stack terminal são registrados/validados antes do boot real do terminal, sem duplicar
> registros.

---

## 4. Arquivo: `terminal/index.js`

**Função**: Orquestrador principal de inicialização do terminal server. **LOC**: ~380

### Achados Críticos

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-BOOT-02** | P2  | `const copilotServerPromise = startCopilotServer(opts)` — Promise armazenada mas **não awaited imediatamente**. Outros passos de inicialização executam enquanto o servidor pode estar subindo. Se o servidor falhar nos primeiros 100ms, o erro é capturado muito tarde (potencialmente após `startRepl()` já estar ativo). Correto seria: `const copilotServer = await startCopilotServer(opts)` para falhar early. |
| **GAP-BOOT-03** | P2  | `pinnedLoader.on('changed', handler)` registrado na inicialização mas **nunca removido** no shutdown. O handler de cleanup (`registerShutdownHandler`) limpa apenas o bridge do EventBus, não o listener nativo do `pinnedLoader`. Risco de callbacks disparando após shutdown ou em testes que reutilizem a instância.                                                                                               |

> **Status de execução (2026-04-17): `GAP-BOOT-02` e `GAP-BOOT-03` corrigidos no código.**

### Positivos

- `registerTimer()` usado corretamente para `_reflectionTimer` e `todoCleanupTimer` — cleanup
  centralizado
- `registerShutdownHandler()` registrado para shutdown gracioso
- `SIGHUP` ignorado para manter inject server vivo quando painel VS Code é fechado (comportamento
  intencional documentado)
- Sequência de shutdown bem definida com `await` em cascata
- `custom-tools.json` opcional agora usa caminho canônico na raiz do workspace, com fallback de
  leitura para o caminho legado
- reexecução do boot não mostrou mais warning F53 espúrio nem
  `Evento SDK desconhecido: session.custom_agents_updated`

---

## 5. Arquivo: `terminal/di-wiring.js`

**Função**: Registra tokens de DI do stack terminal. **LOC**: ~100

### Tokens Registrados

```
ALWAYS_ALIVE_AGENT, PERMISSION_AGENT, FALLBACK_AGENT,
BRIDGE_AGENT, NERV_BRIDGE_AGENT, TERMINAL_SERVER_OPTIONS,
CONVERSATION_STORE (se não registrado)
```

### Achados

| ID            | Sev | Descrição                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-DI-01** | P3  | O `AlwaysAliveAgent` é registrado sob **5 tokens diferentes** (ALWAYS_ALIVE_AGENT, PERMISSION_AGENT, FALLBACK_AGENT, BRIDGE_AGENT, NERV_BRIDGE_AGENT) — mesma instância cumprindo múltiplos papéis. Isso não é um bug, mas dificulta substituição futura de um papel específico por outra implementação (violação do princípio de segregação de interfaces em DI). |

### Positivos

- `wireTerminalDI()` chama `container.validateRequired(tokens)` ao final — self-validating
- `wireLegacySetters()` chamado para compatibilidade retroativa com setters globais

---

## 6. Arquivo: `terminal/terminal-agent-wiring.js`

**Função**: Conecta eventos do `AlwaysAliveAgent` a SSE broadcasts e watchdog de recuperação.
**LOC**: ~300

### Mapeamento de Eventos Auditados

| Evento                                 | Ação                                                                            | Observações                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `dialog.stalled`                       | Zero-PR watchdog recovery: abort + wait `ask_user`, fallback a restart completo | Bem implementado (F52)                           |
| `dialog.reply`                         | Broadcast SSE + gravação no hub                                                 | OK                                               |
| `dialog.loop.changed`                  | Broadcast loop state change                                                     | OK                                               |
| `dialog.ready`                         | Broadcast ready event                                                           | OK                                               |
| `dialog.stopped`                       | Auto-restart do loop permanente                                                 | `logSwallowed` no catch — OK                     |
| `session.usage`                        | Broadcast token usage                                                           | OK                                               |
| `task.delta/completed/error/reasoning` | Streaming de tasks para SSE                                                     | OK                                               |
| Generic auto-wire                      | Loop sobre `AGENT_EVENTS` \ `handledEvents`                                     | Útil para futuros eventos sem handler específico |

### Achados

| ID              | Sev | Descrição                                                                                                                                                                                                                                                      |
| --------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-WIRE-01** | P3  | `_agentListenersRegistered` é um `boolean` simples em closure, não atômico. Em cenário de hot-reload ou reinicialização rápida, dois calls concorrentes de `wireTerminalAgentEvents()` podem passar pela guarda — improvável em produção, relevante em testes. |
| **GAP-WIRE-02** | P3  | Ao fazer auto-wire genérico de `AGENT_EVENTS`, os eventos são apenas broadcast via SSE sem nenhum logging de debug. Se um evento novo for adicionado ao enum mas precisar de lógica especial, o auto-wire silencioso pode mascarar o gap.                      |

### Positivos

- Guarda `_agentListenersRegistered` evita duplicação em chamadas sucessivas
- Zero-PR watchdog (F52) bem implementado com fallback progressivo
- `writeTerminalHubSystemTurn()` em catches com `logSwallowed` — erro controlado sem crash

---

## 7. Arquivo: `terminal/repl.js`

**Função**: Interface REPL interativa com 40+ comandos. **LOC**: ~400+

### Estrutura

```js
const CMD_ROUTES = new Map([
  ['/help', _cmdHelp],
  ['/restart', _cmdRestart],
  ['/reset', _cmdEmergencyReset],
  ['/status', _cmdStatus],
  // ... 35+ mais
]);
```

### Achado Positivo — Race Condition Fix (FINDING-P4-1)

```js
// Correto: registra listener ANTES de parar o agente
agent.once(EMITTER_DIALOG_READY, onReady);
await stopTerminalDialogMode();
// Errado seria: await stopTerminalDialogMode(); agent.once(...)
```

### Achados

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                                           |
| --------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-REPL-01** | P3  | `_cmdEmergencyReset()` usa `process.exit(0)` via `setTimeout` — é um hard kill sem shutdown gracioso. Intencional para casos de emergência, mas se um estado corrompido ocorrer durante shutdown (ex: em meio a escrita de arquivo), pode perder dados. Documental apenas — comportamento esperado. |
| **GAP-REPL-02** | P3  | `dispatchCmd()` não tem rate limiting: um script externo ou usuário pode enviar 100 comandos/segundo ao REPL. Sem debounce ou fila. Baixo risco em uso normal.                                                                                                                                      |

### Positivos

- Timeout de 30s em `_cmdRestart()` com `rejectReady(new Error('Timeout aguardando restart'))` —
  correto
- `once()` vs `on()` usado corretamente para handlers one-shot em restart
- CMD_ROUTES Map evita switch-case frágil

---

## 8. Arquivo: `terminal/frontend/llm-b-runtime.js`

**Função**: Gateway centralizado para acesso a agent/channel/hub de módulos do terminal. **LOC**:
~120

### Funções Exportadas

```
getTerminalAgentRuntime()
readTerminalRuntimeState()
readTerminalSessionBinding()
pauseTerminalDialogLoop()
resumeTerminalDialogLoop()
stopTerminalAgentRuntime()
startTerminalDialogMode()
stopTerminalDialogMode()
```

### Achados

| ID                 | Sev | Descrição                                                                                                                                                                                                                                                               |
| ------------------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-RUNTIME-01** | P3  | `getTerminalAgentRuntime()` lança se o agente não estiver registrado no container. Módulos do terminal que chamam isso em inicialização prematura (ex: antes de `wireTerminalDI()` completar) vão lançar erros não descritivos do container, não da intenção do caller. |

### Positivos

- Facade pura: nenhum acesso direto ao container fora deste arquivo em módulos terminal
- Centraliza controle de `pause/resume/stop/start` do dialog loop

### Status adicional do `ask_user` / zero-PR (2026-04-18)

- o watchdog zero-PR do terminal deixou de tratar “qualquer `pendingQuestion`” como recuperação
  bem-sucedida;
- agora a recuperação zero-PR exige especificamente `pendingQuestionKind === 'ready'`;
- o runtime do terminal também passou a expor `pendingQuestionShadow` e `pendingQuestionShadowKind`,
  permitindo distinguir loop realmente pronto de sombra restaurada do disco.
- o terminal passou a usar `assistant.streaming_delta` como sinal operacional de progresso de
  resposta mesmo quando o texto incremental está oculto pela UX.
- o handler de `tool.execution_progress` foi alinhado ao payload real do SDK (`progressMessage`, com
  `progress` opcional), removendo a suposição de que sempre existiria percentual numérico.

---

## 9. Resumo de Achados do Módulo Terminal

| ID             | Severidade | Arquivo                              | Descrição                                                                                                                             |
| -------------- | ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-BOOT-05    | P2         | `terminal/bootstrap.js:13`           | `process.exitCode = 1` sem `process.exit()` — **corrigido em 2026-04-17**                                                             |
| GAP-BOOT-01    | P2         | `bootstrap.js`                       | DI validation do terminal antes ficava implícita/tardia — **mitigado em 2026-04-17 com `wireTerminalDI()` idempotente antes do boot** |
| GAP-BOOT-04    | P3         | `bootstrap.js`                       | `_booted` sem reset para testes                                                                                                       |
| GAP-BOOT-02    | P2         | `terminal/index.js`                  | `copilotServerPromise` não awaited imediatamente — **corrigido em 2026-04-17**                                                        |
| GAP-BOOT-03    | P2         | `terminal/index.js`                  | `pinnedLoader.on('changed')` listener não removido no shutdown — **corrigido em 2026-04-17**                                          |
| GAP-DI-01      | P3         | `terminal/di-wiring.js`              | AlwaysAliveAgent sob 5 tokens diferentes                                                                                              |
| GAP-WIRE-01    | P3         | `terminal/terminal-agent-wiring.js`  | `_agentListenersRegistered` não atômico                                                                                               |
| GAP-WIRE-02    | P3         | `terminal/terminal-agent-wiring.js`  | Auto-wire genérico silencioso                                                                                                         |
| GAP-REPL-01    | P3         | `terminal/repl.js`                   | Emergency reset usa process.exit sem graceful shutdown                                                                                |
| GAP-REPL-02    | P3         | `terminal/repl.js`                   | Sem rate limiting em `dispatchCmd()`                                                                                                  |
| GAP-RUNTIME-01 | P3         | `terminal/frontend/llm-b-runtime.js` | Container errors não descritivos em acesso prematuro                                                                                  |

### Severidade Geral do Módulo: **P2 (Médio)**

Nenhum bug P0/P1 encontrado no módulo terminal. Os gaps P2 afetam confiabilidade em falhas de boot e
shutdown, não o caminho normal de execução.

---

## 10. Diagnóstico de UX do terminal (2026-04-18)

Embora o runtime do terminal já tivesse boa cobertura funcional, a UX ainda estava primitiva em
relação à superfície real do sistema:

- havia eventos ricos de `assistant.intent`, `tool.execution_*`, `task.*`, `dialog.*` e
  `session.usage`;
- mas o operador ainda precisava inferir “o que a LLM-B está fazendo” a partir de linhas soltas,
  snapshots e blocos textuais pouco semânticos.

### Melhorias aplicadas nesta onda

- camada canônica de atividade (`activity-state.js`);
- novo comando `/activity [n]`;
- atividade integrada em `/status`, `/diagnose` e `/metrics`;
- broadcast SSE `terminal.activity` para dashboards/consumidores externos;
- correção do comportamento parcialmente enganoso do toggle `streaming`;
- toggles adicionais para `tools` e `intent`.
- prompt interativo dinâmico (`você[modelo/reasoning][MODE:<SDK>]›` quando a sessão sai de
  `interactive`).
- prompt interativo dinâmico também com `MODE:<SDK>` quando o runtime reporta modo não-interativo.
- `/status` enriquecido com metadata local do modelo (`cost`, `speed`, `contextWindow`) e timeline
  curta da atividade recente.
- `/status`, `/diagnose`, `/metrics` e `/usage now` agora refletem diretamente o `mode` e o `plan`
  vanilla observados do SDK, sem um plan mode local paralelo no terminal.
- o terminal passou a tratar `tool.execution_partial_result` como streaming incremental de saída de
  tool, em vez de depender só de `progress`/`complete`.
- o terminal passou a refletir também `session.task_complete`, `session.truncation`,
  `session.snapshot_rewind`, `session.shutdown`, `session.handoff` e
  `session.workspace_file_changed`, deixando a trilha vanilla do SDK mais observável para operador e
  dashboards.

### Estado atual

O terminal ainda tem backlog de evolução visual, mas já saiu do modelo “REPL com muitas features” e
começou a entrar no modelo “console operacional contínuo”.

---

## 11. Fluxo LLM-B — Estado Operacional

### Entrada Confirmada

```bash
npm run terminal:llm-b
# → COPILOT_LOG_LEVEL=INFO node --strip-types src/copilot/terminal/bootstrap.js
```

### Portas

| Serviço                                         | Porta   | Protocolo           |
| ----------------------------------------------- | ------- | ------------------- |
| Inject Server (LLM-B recebe mensagens de LLM-A) | 3009    | HTTP POST `/inject` |
| Copilot Server (API REST)                       | config  | HTTP                |
| SSE Stream                                      | /events | SSE                 |

### Comunicação LLM-A → LLM-B

```
LLM-A (este agente)
  → POST :3009/inject  [channel/inject.js]
    → AlwaysAliveAgent recebe via channel
      → SDK session.sendTurn(turn)
        → GPT/Copilot responde
          → SSE broadcast via terminal-agent-wiring
            → LLM-B REPL exibe resposta
```

---

_Próximo: [02-AGENT.md](./02-AGENT.md)_
