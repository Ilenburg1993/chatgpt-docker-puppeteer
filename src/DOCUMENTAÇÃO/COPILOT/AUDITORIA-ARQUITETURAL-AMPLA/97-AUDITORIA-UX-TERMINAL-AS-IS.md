# 97 — Auditoria UX Terminal AS-IS (`src/copilot/terminal`)

**Data:** 2026-05-01  
**Escopo:** `src/copilot/terminal`, conexões com `presentation`, `agent`, `sdk`, `server`,
`conversation-hub`, `events` e testes associados.  
**Status:** diagnóstico inicial executável para a faixa UX/terminal.

---

## 1) Resumo executivo

`terminal/` já é uma borda funcional e relativamente bem instrumentada: possui REPL, comandos
modulares, camada `frontend/`, camada `dialog/`, adapters de eventos, `module-map.js` de raiz e
`module-map.js` em `handlers/`.

O problema principal não é falta de features; é densidade e mistura de papéis em alguns pontos
centrais de UX. A pasta ainda combina:

- boot/lifecycle local;
- recursos permanentes do terminal;
- rendering humano;
- projections de runtime;
- adapters de eventos;
- comandos de operação;
- fallback/recovery;
- bridge HTTP/SSE;
- decisões de experiência do usuário.

Isso torna a UX rica, mas difícil de auditar ao vivo quando algo falha.

---

## 2) Hotspots medidos

Arquivos mais densos na varredura atual:

| Arquivo                      | Linhas | Papel atual                                            | Risco      |
| ---------------------------- | -----: | ------------------------------------------------------ | ---------- |
| `frontend/llm-b-frontend.js` |  ~1014 | projections UX de status/metrics/config/session        | alto       |
| `frontend/llm-b-runtime.js`  |   ~772 | gateway runtime/hub/session/dialog                     | alto       |
| `commands/session.js`        |   ~570 | `/status`, `/now`, histórico, sessões, restore         | alto       |
| `index.js`                   |   ~536 | composition root + fases + recursos + shutdown         | alto       |
| `repl.js`                    |   ~502 | readline, banner, dispatcher, aliases, multiline, quit | alto       |
| `dialog/engine.js`           |   ~477 | loop de turno, boot do dialog, render, persistência    | alto       |
| `commands/sdk.js`            |   ~444 | múltiplas operações SDK em um comando                  | médio-alto |
| `commands/gh.js`             |   ~388 | GitHub CLI/API UX em um comando                        | médio      |
| `terminal-agent-wiring.js`   |   ~375 | SSE, watchdog/recovery, listeners agent                | médio-alto |
| `sdk-session-events.js`      |   ~359 | tradução de sinais vanilla SDK para UX                 | médio-alto |
| `agent-runtime-events.js`    |   ~334 | tradução de sinais runtime/agent para UX               | médio-alto |

O `module-map.js` da raiz ainda não possui `risk`, `scorecard` e governança de arquivos grandes como
`server/routes` já possui.

---

## 3) Achados de bug/gap validados

### A1 — Typecheck strict quebrado por mudanças de UX/model billing

Foram encontrados erros em:

- `terminal/commands/display.js`: preset não era estreitado para valor existente;
- `terminal/dialog/engine.js`: `lastPrInfo` passou a carregar `configuredModel` e `modelMismatch`,
  mas o acesso ainda estava tipado como shape antigo;
- `server/routes/sdk/session-core-routes.js`: snapshot runtime acessado por propriedade direta vinda
  de index signature;
- `event-handlers/usage.js`: leitura de `session.model`/`session.config.model` em tipo SDK estrito;
- testes novos de UX/model billing com mocks não tipados.

Correção aplicada nesta rodada: `typecheck:strict:src.copilot` e `typecheck:strict:tests.unit`
voltaram a passar.

### A2 — `/display preset` precisa ser contrato UX, não atalho solto

O comando já introduz presets (`default`, `minimal`, `verbose`, `debug`, `focus`), mas isso ainda
não está consolidado em documentação/roadmap nem em governança de UX. O risco é crescer como lista
ad hoc dentro do comando.

### A3 — `/status` e `/now` começam a expor divergência modelo configurado/cobrado

A UX foi ampliada para mostrar `configuredModel`, `billedModel`, mismatch e custo do último PR. Isso
é útil, mas deve virar projection canônica e narrativa consistente em `/status`, pós-turno,
`/usage`, `/metrics` e diagnóstico.

### A4 — pending question replay melhora UX, mas precisa de contrato de dedupe/visibilidade

`agent-runtime-events.js` reanuncia pergunta pendente viva ao registrar listeners. Isso corrige uma
falha operacional comum: terminal reiniciado enquanto uma pergunta do runtime já existia. Falta
formalizar:

- quando replay deve ser exibido;
- quando protocolo `READY` deve ser suprimido;
- como evitar reanúncio duplicado em reconexões rápidas.

### A5 — prompt/waiting prompt ganhou mais sinais, mas não há policy central de densidade

`buildWaitingPrompt()` agora mostra fila, pergunta pendente e shadow state. Isso é correto para
debug/live operation, mas precisa de uma política de densidade visual por preset ou contexto.

### A6 — `repl.js` ainda concentra dispatcher, banner, multiline, quit e lifecycle de input

O arquivo é funcional, mas tem responsabilidades distintas:

- catálogo/roteamento de comandos;
- banner e discoverability;
- multiline input;
- parsing de comandos;
- parsing de referências `@path`;
- lifecycle de readline;
- shutdown por `/quit`.

Ele deve ser fatiado sem alterar a superfície do REPL.

### A7 — `frontend/llm-b-frontend.js` é o maior hotspot do terminal

O arquivo mistura projections de status, diagnose, config, usage, metrics, SDK session e runtime
topology. A direção ideal é separar por projection family, mantendo `frontend/index.js` e
`llm-b-frontend.js` como compat/composition temporários até corte final.

### A8 — `terminal/index.js` é composition root, mas ainda carrega recursos demais

As fases de boot estão separadas, porém o arquivo ainda possui:

- banner standalone;
- reflection loop;
- pinned context bridge;
- conversation hub;
- HTTP server;
- runtime listeners;
- shutdown handlers;
- SIGHUP;
- terminal.started.

O risco é regressão de boot/shutdown ao mexer em UX.

### A9 — `module-map.js` da raiz do terminal não governa risco nem scorecard

Ao contrário de `server/routes`, o mapa de terminal ainda só declara papel/tier/public. Falta:

- `risk`;
- `listTerminalModulesByRisk`;
- `buildTerminalModuleScorecard`;
- contrato para arquivos acima de 300 linhas como hotspot;
- contrato para arquivos acima de 220 linhas como watch/hotspot.

### A10 — conexão terminal ↔ restante está melhor, mas ainda heterogênea

O terminal consome `presentation` para muita coisa, mas ainda há acesso direto legítimo e denso a:

- `#copilot/channel`;
- `#copilot/conversation-hub`;
- `#copilot/bridges`;
- `#copilot/events`;
- `core/timer-registry`;
- `PinnedFilesLoader`;
- `mcp-tool-bridge`.

Nem todo acesso direto é bug, mas cada um precisa estar documentado como edge/port/adaptor e não
como domínio escondido no terminal.

---

## 4) Conclusão AS-IS

`terminal/` está em bom estado funcional, mas não em estado ideal de navegação e manutenção. A
próxima etapa deve priorizar governança de risco e decomposição de hotspots de UX antes de novas
features. O ganho maior vem de reduzir entropia sem alterar endpoints, comandos ou comportamento
observável.
