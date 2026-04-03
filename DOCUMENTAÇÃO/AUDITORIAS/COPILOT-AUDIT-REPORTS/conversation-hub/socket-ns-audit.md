# Auditoria — `socket-ns.js`

**Módulo**: `src/copilot/conversation-hub/socket-ns.js` **LOC**: 446 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

Namespace Socket.io `/copilot` para streaming em tempo real do Conversation Hub. Permite que
clientes se conectem para observar conversas, injetar mensagens e consultar histórico. Gerencia:
autenticação JWT, rate limiting duplo (por socket + IP) e sanitização de conteúdo injetado.

---

## 2. Arquitetura

```
mountCopilotNamespace(io, orchestrator, store)
  ├── _parseAuthRequired() → instala middleware JWT se necessário
  ├── _setupConnectionHandlers()
  │   ├── join:session → _handleJoinSession (verifica existência)
  │   ├── leave:session → _handleLeaveSession
  │   ├── user:inject → _handleUserInject (rate limit + sanitização)
  │   ├── sessions:list → _handleSessionsList
  │   └── turns:history → _handleTurnsHistory
  └── _bridgeOrchestratorEvents() → reemite eventos do orchestrator para clientes
```

---

## 3. Achados

### FINDING-P4-1 — `turns:history` sem verificação de autorização por sessão

**Severidade**: P4 — Médio **Localização**: `_handleTurnsHistory()` linhas ~295-320

```js
socket.on('turns:history', (data) => {
    if (!data?.hubSession) return;
    const turns = store.readTurns(data.hubSession, {...});
    socket.emit('turns:history:result', { hubSession: data.hubSession, turns });
});
```

Qualquer cliente autenticado (ou unauthenticado se `AUTH_REQUIRED=false`) pode solicitar o histórico
de **qualquer** sessão sem ter feito `join:session`. A proteção por UUID é obscuridade, não
autenticação.

**Proposta**: verificar que o socket está na sala antes de retornar dados:

```js
if (!socket.rooms.has(data.hubSession)) {
  socket.emit('error:history', { reason: 'Você não está na sessão solicitada.' });
  return;
}
```

---

### FINDING-P4-2 — `sessions:list` retorna todas as sessões sem filtro de acesso **[FIXED — validação de status adicionada]**

**Severidade**: P4 — Médio **Localização**: `_handleSessionsList()` linhas ~270-285

```js
const sessions = store.listHubSessions({ limit, offset, status });
socket.emit('sessions:list:result', { sessions });
```

Qualquer cliente conectado recebe a lista completa de sessões (incluindo `closed`). Para terminais
multiusuário ou ambientes compartilhados, isso expõe metadados de outras conversas.

---

## 4. Pontos Positivos

- **JWT middleware** via `COPILOT_HUB_SOCKET_AUTH_REQUIRED` — auth por default.
- **BUG-P2-14**: validação do JWT secret na inicialização do namespace — fail-fast.
- **SEC-N09**: sanitização de conteúdo injetado (marcadores `[SYSTEM...]` → `[BLOCKED]`).
- **SEC-N04 + SEC-P2-06**: rate limit duplo por socket (10/min) e por IP (30/min).
- **SEC-05**: `join:session` verifica existência da sessão antes de entrar na sala.
- `_createInjectRateLimiter()` com cleanup automático de buckets expirados — sem memory leak.
- **ARCH-06**: `unmountCopilotNamespace()` desconecta todos os clients e limpa referência.
- `broadcastToSession` / `broadcastGlobal` — API limpa para broadcast de outros módulos.

---

## 5. Score

| Dimensão               | Nota       |
| ---------------------- | ---------- |
| Segurança de injeção   | 9.5/10     |
| Autorização de leitura | 6.5/10     |
| **Global**             | **8.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] C11-01 (P3) — turns:history verifica socket.rooms antes de retornar histórico

socket-ns.js: \_handleTurnsHistory agora verifica socket.rooms.has(hubSession). Socket não-membro
recebe error:history com reason 'not_in_session'. Previne leitura de histórico de sessões
não-autorizadas.

### NOTA: C11-02 e BUG-CHAN-001 são falsos positivos

- C11-02 (sessions:list filtrar por userId): sistema single-user, sem userId real no JWT local.
  Mitigation: auth JWT já garante que apenas clientes autenticados listam sessões.
- BUG-CHAN-001 (activeTaskId cross-contamination): activeTaskId já é variável local por invocação de
  chat().

**Pontuação atualizada: 8.8/10**
