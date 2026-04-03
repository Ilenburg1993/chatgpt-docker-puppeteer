# api/bridge-dialog.js — Auditoria

**Módulo**: `src/copilot/api/` **Arquivo**: `bridge-dialog.js` **LOC**: 151 | **Score**: 9.0/10

## Responsabilidade

Rotas do Dialog Loop (padrão §15.8):

- `POST /dialog/start` — inicia dialog loop com `bootPrompt` opcional
- `POST /dialog/turn` — envia um turno; rate limiting via `_turnInFlight`
- `POST /dialog/stop` — encerra loop; exige `{ force: true }` (DL-PERM policy)

## Achados

### P5 — `_turnInFlight` escopo de módulo: múltiplas instâncias do router não compartilham o flag

**Localização**: `bridge-dialog.js:36` — `let _turnInFlight = false` dentro de
`registerDialogRoutes`

**Descrição**: cada invocação de `registerDialogRoutes` cria um novo closure com `_turnInFlight`
independente. Em testes ou cenários de múltiplos routers, a proteção de concorrência por turno não é
compartilhada. Em produção há apenas uma invocação, portanto impacto é baixo.

---

### P5 — `/dialog/turn` sem timeout server-side na conexão HTTP

**Localização**: `bridge-dialog.js:95` —
`const reply = await agent.sendDialogTurn(message, { timeout })`

**Descrição**: O servidor aguarda até `timeout` ms (máx. 300s) na resposta do agente antes de
devolver HTTP. Se o processo Node.js cair ou a rede atrasar durante esse período, a conexão cliente
fica pendurada. O `timeout` é delegado ao agente sem um `AbortController` a nível de rota.

**Sugestão**: Encapsular com `Promise.race` + `AbortController` similar ao que `bridge-tasks.js` já
faz no modo `waitForResponse=true`.

---

## Destaques Positivos

- `G2-API-09`: flag `_turnInFlight` impede turnos concorrentes na camada HTTP — sem fila dupla
- `FLOW-UPG-04`: diferenciação de status HTTP (409 loop inativo, 429 fila cheia, 504 timeout, 500
  erro geral)
- `DL-PERM`: `POST /dialog/stop` exige `{ force: true }` — sem acidente
- Validação de `timeout` com intervalo 1_000–300_000ms
- Validação de `message` (string, not empty) e `bootPrompt` (optional)

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
