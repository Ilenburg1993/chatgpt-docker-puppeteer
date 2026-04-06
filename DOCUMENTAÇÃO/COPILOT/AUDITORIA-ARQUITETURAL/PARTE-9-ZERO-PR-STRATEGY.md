# PARTE 9 — Estratégia Zero-PR: Persistência de Dialog Loop Através de Reboots

**Data**: 2026-04-06  
**Escopo**: Investigação e implementação de mecanismos para NUNCA consumir Premium Requests
desnecessariamente  
**Dependências**: PARTE-7 (Session Deep Audit), PARTE-8 (SDK Session Internals)  
**Status**: Roadmap + Implementação

---

## 1. Análise do Mecanismo "Try Again" do VS Code (Zero-PR)

### 1.1 Por Que "Try Again" Não Consome PR

Quando o VS Code Copilot Chat mostra "Network Error → Try Again" e o usuário clica, **zero PR é
consumido**. O mecanismo funciona assim:

```
FLUXO NORMAL:
  User envia mensagem
    → Extension Host envia para CLI server (processo local, stdio/TCP localhost)
    → CLI server envia para API GitHub Copilot (internet)          ← 1 PR consumido aqui
    → Modelo processa e retorna resposta
    → CLI server envia session events para Extension Host
    → Extension Host renderiza no chat UI

CENÁRIO NETWORK ERROR:
  User envia mensagem → CLI recebe → API processa → MODELO RESPONDEU
  Porém:
    → Conexão de internet CAI no meio do streaming da resposta
    → O VS Code chat UI mostra "Network Error"
    → Mas o CLI server local pode ter recebido resposta parcial ou completa
    → Ask_user ficou pendente (Promise bloqueada no Extension Host)

  User clica "Try Again":
    → O Extension Host NÃO envia novo session.send()
    → Ele simplesmente RE-RENDERIZA a mensagem que já estava no pipeline
    → Ou reconecta ao CLI e recebe os events pendentes
    → Zero PR consumido

CENÁRIO REBOOT (máquina desliga e liga):
  → O CLI server morre junto com o PC
  → Porém: session-state foi persistido em disco (~/.copilot/session-state/{id}/)
  → workspace.yaml + checkpoints/ contêm todo o histórico
  → Ao reabrir VS Code:
    1. CLI server reinicia
    2. Extension Host chama client.resumeSession(savedId)  ← 0 PR
    3. Session é restaurada dos checkpoints
    4. User pode continuar a conversa
    5. Próximo session.send() é que consome 1 PR
```

### 1.2 Insight Fundamental

**O PR é consumido apenas no `session.send()` — não no create, resume, connect, ping, ou qualquer
outra operação.**

A chave para zero-PR é:

1. **Nunca fazer `session.send()` desnecessário** — incluindo keepalives
2. **Preservar o `ask_user` pendente** — a Promise local sobrevive a desconexões de rede
3. **Usar `resumeSession()` em vez de `createSession()` + boot prompt** quando possível
4. **Persistir estado suficiente** para retomar sem re-bootplay

### 1.3 Limitação: CLI Server Precisa Estar Vivo

O mecanismo zero-PR **depende fundamentalmente** do CLI server (processo local) estar vivo. Se o PC
reinicia:

- O CLI server morre
- A Promise do `ask_user` é destruída
- Ao reiniciar, `resumeSession()` restaura o histórico mas NÃO restaura o `onUserInputRequest`
  pendente
- É necessário um novo `session.send()` para reativar o dialog loop (1 PR)

**Porém**: se o CLI server estiver rodando em um container Docker que é reiniciado automaticamente,
ou via PM2 com restart, ele pode sobreviver a reboots do host.

---

## 2. Mapeamento Completo de Consumo de PR no LLM-B

### 2.1 Operações Que Consomem PR

| Operação                          | PR    | Quando Ocorre                                    |
| --------------------------------- | ----- | ------------------------------------------------ |
| `startDialogLoop()` (boot prompt) | **1** | Primeira inicialização do dialog loop            |
| `sendDialogTurn(message)`         | **0** | `answerPendingQuestion()` — não é session.send() |
| Watchdog restart                  | **1** | Boot prompt re-enviado após stall                |
| `resume()` Estratégia B           | **1** | ask_user não preservado → re-boot                |
| `sendMessage()` (task queue)      | **1** | Cada task na fila consome 1 PR                   |
| `keepalive` via `session.send()`  | **1** | Heartbeat quando idle (a cada 20min)             |
| Reconexão + dialog restart        | **1** | Se dialog loop precisa re-boot                   |

### 2.2 Operações Zero-PR

| Operação                  | PR  | Nota                                      |
| ------------------------- | --- | ----------------------------------------- |
| `createSession()`         | 0   | Apenas cria objeto local + RPC de criação |
| `resumeSession()`         | 0   | Restaura sessão do disco                  |
| `client.ping()`           | 0   | Health check                              |
| `session.abort()`         | 0   | Cancela mensagem pendente                 |
| `session.disconnect()`    | 0   | Libera recursos em memória                |
| `session.log()`           | 0   | Log no timeline                           |
| `answerPendingQuestion()` | 0   | Resposta ao ask_user pendente             |
| `resume()` Estratégia A   | 0   | ask_user preservado                       |
| `keepalive` via `ping()`  | 0   | M-02: já implementado                     |

### 2.3 Análise de Consumo Típico Diário

**Cenário atual (antes de otimizações):**

- Boot inicial: 1 PR
- ~6 keepalives/dia (a cada 20min quando idle): 6 PR
- ~1-2 watchdog restarts: 2 PR
- ~1 reconexão com dialog restart: 1 PR
- **Total overhead: ~10 PR/dia desperdiçado**

**Cenário otimizado (com M-02 + roadmap PARTE-9):**

- Boot inicial: 1 PR
- Keepalives via ping(): 0 PR
- Reconexão sem dialog restart: 0 PR (se ask_user preservado)
- Watchdog com abort (M-04): 0 PR (se ask_user ainda vivo)
- **Total overhead: 1 PR/dia (apenas o boot inicial)**

---

## 3. Estratégia de Dialog Loop Resiliente a Reboot

### 3.1 O Problema Central

Quando o PC é desligado:

1. O CLI server morre
2. O processo Node.js do LLM-B morre
3. O container Docker para (ou é removido)
4. Todas as Promises são destruídas
5. O status `ask_user` pendente é perdido

Ao religar:

1. Docker reinicia o container
2. PM2 reinicia o processo Node.js
3. `AlwaysAliveAgent.start()` é chamado
4. `initOrResumeSession()` restaura a sessão
5. Mas o dialog loop precisa de um novo boot prompt → **1 PR consumido**

### 3.2 Solução: Zero-PR Boot Recovery

A ideia é: ao detectar que estamos retomando após um crash/reboot, em vez de enviar um boot prompt
normal (1 PR), tentar **reutilizar o estado do dialog** já persistido.

**Fluxo proposto:**

```
Boot Recovery (após reboot):
  1. readState() → dialogLoopActive=true && pendingQuestion existe
  2. resumeSession(savedId) → 0 PR
  3. Verificar se o CLI server ainda tem o ask_user pendente:
     a. Se SIM → responder diretamente → 0 PR total
     b. Se NÃO → aguardar SDK emitir novo ask_user (via session.resume event)
        → Se chegar em 5s → 0 PR
        → Se não chegar → boot prompt normal → 1 PR
```

### 3.3 Pre-requisito: Persistência do `pendingQuestion`

O `pendingQuestion` já é persistido em `sdk-always-alive.json` (via `writeStateAsync`). Porém, na
inicialização, precisamos identificar que deve ser restaurado.

---

## 4. Roadmap de Implementação

### F50 — Zero-PR Keepalive (M-02) ✅ IMPLEMENTADO

Keepalive com `client.ping()` em vez de `session.send()`.

### F51 — Zero-PR Post-Reconnect Health Check (M-01) ✅ IMPLEMENTADO

Ping de validação após reconexão.

### F52 — Zero-PR Watchdog Recovery

**F52.1**: Ao detectar stall, chamar `session.abort()` **antes** de reiniciar  
**F52.2**: Após abort, verificar se ask_user reaparece (timeout 5s)  
**F52.3**: Se ask_user reaparece → 0 PR (dialog loop continua)  
**F52.4**: Se não reaparece → boot prompt normal (1 PR, último recurso)

### F53 — Zero-PR Boot Recovery

**F53.1**: Detectar cenário de crash/reboot na inicialização  
**F53.2**: Se `dialogLoopActive=true` no state persistido:

- Tentar `resumeSession()` (0 PR)
- Aguardar `question.pending` por até 10s
- Se chegar → dialog loop ativo sem boot (0 PR)

**F53.3**: Flag `gracefulShutdown` no state:

- Set `false` no boot
- Set `true` no `stop()`
- Se boot detectar `gracefulShutdown=false` → crash recovery mode

**F53.4**: Emitir `dialog.boot_recovery` event para observabilidade

### F54 — Zero-PR Dialog Turn Optimization

**F54.1**: O `answerPendingQuestion()` nunca consome PR — é uma resposta ao RPC pendente  
**F54.2**: Verificar que `sendDialogTurn()` NÃO faz session.send() quando pending question existe  
**F54.3**: Garantir que a resolução do dialog turn é via `answerPendingQuestion()`, não via
`session.send()`

### F55 — PR Budget Tracking e Dashboard

**F55.1**: Contabilizar cada PR consumido com motivo (boot/resume/task/keepalive)  
**F55.2**: Endpoint `/api/pr-budget` para visualizar consumo  
**F55.3**: Alertas quando consumo excede threshold configurável  
**F55.4**: Meta: ≤ 1 PR/dia de overhead operacional

### F56 — Session Persistence Enhancement

**F56.1**: Persistir `gracefulShutdown` flag no state  
**F56.2**: Persistir timestamp do último ask_user recebido  
**F56.3**: Persistir modelo e configuração do dialog loop  
**F56.4**: Checkpoint de dialog loop antes de shutdown (snapshot completo)

---

## 5. Notas de Implementação

### 5.1 Prioridade de Implementação

1. **CRÍTICO**: F53 (Boot Recovery) — maior impacto em PR savings
2. **ALTO**: F52 (Watchdog Recovery) — evita PR em stalls
3. **MÉDIO**: F54 (Turn Optimization) — verificação/hardening
4. **BAIXO**: F55 (Dashboard) — observabilidade
5. **BAIXO**: F56 (Persistence) — infraestrutura para F53

### 5.2 Riscos

- **CLI server não restaura ask_user após resume**: Investigar se `session.resume` re-dispara o
  último `onUserInputRequest`. Evidência do SDK: `resumeSession()` envia `session.resume` RPC, e o
  CLI pode ou não reenviar o último ask_user pendente.
- **pendingQuestion corrompido**: Se o state persistido está desatualizado, a resposta pode não
  corresponder à pergunta real.
- **Race conditions**: Entre boot recovery e dialog loop resume, múltiplos sends podem ocorrer.
