# 94 — Bloco N / W114: taxonomia executável das bordas `server` e `terminal`

**Data:** 2026-05-01 **Escopo:** `src/copilot/server/`, `src/copilot/terminal/` **Status:**
checkpoint executável inicial da W114

---

## 1) Problema validado

Após a organização física de `agent/dialog`, `agent/session` e `agent/lifecycle`, as próximas áreas
com maior entropia visual são as bordas operacionais:

- `terminal/` mistura boot, REPL, listeners, adapters SSE/stdout, stores locais e sub-superfícies;
- `server/` mistura owner HTTP, app factory, router composition, handler bridge e subdiretórios de
  middleware/rotas/socket/runtime-state.

As duas bordas devem permanecer adapters finos, mas sem inventário executável fica fácil que um
handler ou listener passe a concentrar domínio do agent, SDK ou presentation.

---

## 2) Decisão arquitetural W114

Esta onda introduz uma taxonomia inicial sem mover arquivos:

1. `terminal/module-map.js` classifica a raiz do terminal por papel e tier;
2. `server/module-map.js` classifica a raiz do servidor por papel e tier;
3. `server/README.md` passa a documentar a ordem de leitura e a regra para novos arquivos;
4. `terminal/README.md` passa a apontar o mapa executável e os papéis da raiz;
5. `test_module_layout_governance.spec.js` cobre arquivos JS de raiz, subdiretórios esperados,
   documentação dos papéis e exports dos mapas.

Nenhum shim foi criado nesta etapa.

---

## 3) Taxonomia aplicada

### `terminal/`

| Papel              | Significado                                          |
| ------------------ | ---------------------------------------------------- |
| `entrypoint`       | execução da task terminal e inventário canônico      |
| `boot`             | lifecycle fatal de bootstrap                         |
| `orchestrator`     | composition root do terminal                         |
| `repl`             | loop readline e listeners da UX humana               |
| `event-adapter`    | tradução de eventos runtime/SDK/task para stdout/SSE |
| `wiring`           | ligação de alto nível entre terminal, agent e SSE    |
| `fallback`         | fallback SSE explicitamente interno                  |
| `sdk-adapter`      | interações humanas com elicitation/permissões SDK    |
| `state`            | estado local de activity/rate-limit                  |
| `store`            | persistência local do terminal                       |
| `command-surface`  | comandos REPL                                        |
| `dialog-surface`   | render/prompt/wait/send de turnos                    |
| `frontend-surface` | consumer layer do runtime                            |
| `handler-surface`  | handlers HTTP usados pelo terminal/inject            |

### `server/`

| Papel           | Significado                                   |
| --------------- | --------------------------------------------- |
| `entrypoint`    | owner HTTP/Socket.IO e inventário canônico    |
| `app-factory`   | factory Express e middleware base             |
| `router`        | composição de routers e subdiretório de rotas |
| `middleware`    | middleware Express                            |
| `runtime-state` | estado local de borda para stream/rate-limit  |
| `socket`        | Socket.IO e namespace do ConversationHub      |
| `compat`        | adapter compatível, sem ownership de domínio  |

---

## 4) Roadmap local

1. W114.1 — mapas executáveis de raiz para `terminal` e `server`: concluído.
2. W114.2 — contratos anti-órfão para arquivos JS de raiz: concluído.
3. W114.3 — documentar papéis nos READMEs locais: concluído.
4. W114.4 — próximo passo: aplicar mapas recursivos em `terminal/handlers` e `server/routes`.
5. W114.5 — depois: separar handlers/controllers/adapters em subpastas semânticas onde houver
   mistura funcional real.
6. W114.6 — por fim: contratos anti-adapter-gordo para impedir payload/projection ad hoc em bordas.

---

## 5) Critérios objetivos de conclusão da W114

- todo arquivo JS de raiz em `server/` e `terminal/` tem papel declarado;
- todo subdiretório de superfície esperado aparece no mapa de raiz;
- READMEs locais documentam os papéis;
- `index.js` de cada borda exporta o mapa sem alterar runtime;
- próximos movimentos físicos devem começar por `terminal/handlers` e `server/routes`, não por
  arquivos ainda não classificados.
