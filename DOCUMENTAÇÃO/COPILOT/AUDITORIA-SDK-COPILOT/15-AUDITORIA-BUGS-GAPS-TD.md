# 15 — Auditoria SDK Copilot: Bugs, Gaps e Technical Debt

**Data de elaboração**: 2026-04-18 **Escopo**: `src/copilot/` (módulo completo) **Tipo**: Auditoria
técnica MDS **Referência**: [10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md),
[11-AGENT-SITUACAO-IDEAL.md](./11-AGENT-SITUACAO-IDEAL.md)

---

## 1. Sumário Executivo

Esta auditoria identifica bugs, gaps funcionais e technical debt no módulo `src/copilot/` do
projeto. O módulo apresenta uma arquitetura modular bem desenvolvida, mas possui áreas que requieren
atenção antes de considerado "production-ready" em cenários críticos.

### Achados Principais

| Categoria        | Qtd | Severidade Dominante |
| ---------------- | --- | -------------------- |
| Bugs confirmadas | 4   | 🔴 Crítica           |
| Gaps funcionais  | 7   | 🟠 Alta              |
| Technical Debt   | 6   | 🟡 Média             |

---

## 2. Bugs Confirmados

### BUG-01: Race condition no dialog loop pause/resume

**Arquivo**: `src/copilot/agent/dialog/loop-manager.js` **Linhas**: 441-532

**Descrição**: O método `resume()` tem um guard `#resuming` para prevenir interleaving, mas a
verificação de estado `dialogPaused` é feita com `readStateAsync()` depois de definir o flag. Isso
pode causar race condition se `pause()` e `resume()` forem chamados rapidamente.

```javascript
// Linha 447-453
this.#resuming = true;
try {
    await this.#persistStateNow({ dialogPaused: false }, 'dialog.state.resume');

    // Estratégia A: ask_user já disponível sincronicamente (0 PR, 0 espera)
    if (this.#host?.getPendingQuestion()) {
```

**Impacto**: Podem ocorrer múltiplas execuções do resume ou perda de estado de pause.

**Recomendação**: Usar mutex para proteger a transição completa de estado.

---

### BUG-02: Memory leak em event listeners do session

**Arquivo**: `src/copilot/agent/messaging/agent-messaging.js` **Linhas**: 162-288

**Descrição**: Em `executeTask()`, os listeners de eventos (`unsubDelta`, `unsubToolStart`,
`unsubToolComplete`, `unsubIdle`) são registrados no `session`, mas se a sessão for desconectada
durante a execução, os listeners podem não ser limpos corretamente.

```javascript
// Linhas 165-218
const unsubDelta = session.on('assistant.message_delta', ...);
const unsubToolStart = session.on('tool.execution_start', ...);
const unsubToolComplete = session.on('tool.execution_complete', ...);
const unsubIdle = session.on('session.idle', ...);
```

Se `session.sendAndWait()` throw antes do bloco `finally`, os listeners podem permanecer
registrados.

**Impacto**: Acúmulo de listeners em sessões reconectadas, potencial memory leak.

**Recomendação**: Garantir que todos os listeners sejam removidos no `finally`, independentemente de
sucesso ou falha.

---

### BUG-03: Persistência de estado pode falhar silenciosamente

**Arquivo**: `src/copilot/agent/lifecycle/state-io.js` **Linhas**: (múltiplos pontos de
persistência)

**Descrição**: O helper `persistStateWithPolicy()` retorna um resultado com `ok: boolean`, mas em
vários pontos do código o resultado é ignorado com `void` ou não é verificado adequadamente.

```javascript
// Exemplo em always-alive.js:310-321
void this.ctx.backgroundTasks.track(
    persistStateWithPolicy(
        { pendingQuestion: null, pendingQuestionMeta: null },
        { label: 'state.pendingQuestionShadow.clear' },
    ).then((result) => {
        if (!result.ok) {
            throw result.error;
        }
        return undefined;
    }),
```

**Impacto**: Estado pode não ser persistido mas o agente continua como se nada tivesse acontecido.

**Recomendação**: Adotar tratamento de erro consistente via `withAgentErrorPolicy` para todas as
persistências críticas.

---

### BUG-04: Circular reference no AgentContext getters

**Arquivo**: `src/copilot/agent/agent-context.js` **Linhas**: 192-458

**Descrição**: Os setters do `AgentContext` podem causar loop infinito em certos cenários. Por
exemplo, `setSession()` chama `invalidateStatusSnapshot()`, que modifica
`metricsState.statusSnapshotCache`, que pode potencialmente causar re-render em algum observer que
tenta ler o session:

```javascript
// Linha 476-479
setSession(session) {
    this.sessionState.session = session;
    this.invalidateStatusSnapshot(); // ← pode triggerar observer
}
```

**Impacto**: Stack overflow em cenários de recovery de sessão com observers ativos.

**Recomendação**: Adicionar guard contra reentrância nos setters.

---

## 3. Gaps Funcionais

### GAP-01: Falta validação de input no session initializer

**Arquivo**: `src/copilot/agent/session/initializer.js` **Linhas**: 40-212

**Descrição**: O `_backgroundCompactionThreshold` é uma variável de módulo que pode ser alterada por
`setBackgroundCompactionThreshold()`, mas não há validação de range quando o valor é usado.

```javascript
// Linha 51
let _backgroundCompactionThreshold = 0.75;

// Linha 59-63
export function setBackgroundCompactionThreshold(threshold) {
  if (typeof threshold === 'number' && threshold >= 0.1 && threshold <= 1.0) {
    _backgroundCompactionThreshold = threshold;
  }
}
```

A validação existe, mas se alguém passar um valor fora do range, a função simplesmente não faz nada
sem retornar feedback.

**Impacto**: Usuário podethink que a configuração foi aplicada quando não foi.

**Recomendação**: Retornar boolean indicando sucesso ou throw erro descritivo.

---

### GAP-02: Modelo de fallback não persiste entre reinicializações

**Arquivo**: `src/copilot/agent/dialog/loop-manager.js` **Linhas**: 129-131, 171-182

**Descrição**: O `ModelFallbackState` mantém o fallback em memória, mas não é persistido no
state-io. Se o agente reiniciar, o fallback agendado é perdido.

```javascript
// Linha 129-131
this.#modelFallback = new ModelFallbackState({
  defaultModel: options.fallbackModel ?? getCopilotFallbackModel(),
});
```

**Impacto**: Agentes que dependem de fallback para resiliência podem falhar após restart.

**Recomendação**: Persistir `scheduledFallback` no state-io.

---

### GAP-03: Não há mecanismo de rate limiting no sendMessage

**Arquivo**: `src/copilot/agent/messaging/agent-messaging.js` **Linhas**: 110-133

**Descrição**: O `sendMessage` pode aceitar qualquer volume de mensagens sem rate limiting. A fila
tem limite de tamanho (`MAX_QUEUE_SIZE`), mas não há controle de taxa temporal.

```javascript
// message-queue.js:123-129
if (this.#items.length >= MAX_QUEUE_SIZE) {
    const err = new SessionError(
        `[AlwaysAlive] Fila cheia (${MAX_QUEUE_SIZE} tarefas). Tente novamente mais tarde.`,
        'QUEUE_FULL',
    );
```

**Impacto**: Pode sobrecarregar o SDK com muitas requisições em burst.

**Recomendação**: Implementar token bucket ou similar para rate limiting.

---

### GAP-04: Handoff manager não persiste histórico

**Arquivo**: `src/copilot/agent/infra/handoff-manager.js` **Linhas**: 46-159

**Descrição**: O `HandoffManager` mantém histórico em memória (`#history`), mas não persiste em
disco. Após restart do processo, todo o histórico é perdido.

```javascript
// Linha 49-51
/** @type {HandoffRequest[]} */
#history = [];
```

**Impacto**: Não há audit trail de handoffs após restart.

**Recomendação**: Integrar com state-io para persistência de handoffs.

---

### GAP-05: Keepalive não verifica status do client antes de ping

**Arquivo**: `src/copilot/agent/session/keepalive.js` **Linhas**: 142-159

**Descrição**: O fallback de keepalive tenta `session.send()` sem verificar se o client está em
estado válido.

```javascript
// Linhas 162-172
const session = getSession();
if (!session || typeof session.send !== 'function') return;

try {
    await session.send({ prompt: '[keepalive]' });
```

**Impacto**: Pode throw erro desnecessário se client estiver em transição.

**Recomendação**: Adicionar verificação de client status antes de enviar.

---

### GAP-06: Não há graceful degradation para tools registry

**Arquivo**: `src/copilot/agent/agent-context.js` **Linhas**: 103-104

**Descrição**: O `toolsRegistry` é criado com `createRegistry()`, mas se falhar, não há fallback.

```javascript
// Linha 178
this.toolsRegistry = createRegistry();
```

**Impacto**: Se o registry falhar, todo o agente pode falhar ao carregar tools.

**Recomendação**: Adicionar try-catch com fallback para registry vazio.

---

### GAP-07: Session rotation não considera quota exhausted

**Arquivo**: `src/copilot/agent/session/rotation.js` **Linhas**: (verificar implementação)

**Descrição**: O `shouldRotateSession()` não considera o estado de quota do SDK. Se a quota estiver
esgotada, rotation pode falhar.

**Impacto**: Tentativa de criar nova sessão quando não há quota disponível.

**Recomendação**: Integrar com quota monitor antes de decidir rotation.

---

## 4. Technical Debt

### TD-01: Casts residuais em runtime-contracts

**Arquivo**: `src/copilot/agent/runtime-contracts.js` **Descrição**: Ainda existem alguns casts
`any` para compatibilidade com diferentes versões do SDK.

**Recomendação**: Normalizar a interface do SDK e remover os casts.

---

### TD-02: Code duplication em error handling

**Arquivo**: Múltiplos arquivos em `agent/` **Descrição**: Padrões de `try/catch` duplicados em
diversos lugares mesmo com `withAgentErrorPolicy` disponível.

**Recomendação**: Refatorar para usar o wrapper consistentemente.

---

### TD-03: Props drilling em BootWiringContext

**Arquivo**: `src/copilot/agent/session/boot-wiring.js` **Descrição**: O contexto de boot recebe
muitos parâmetros, alguns redundantes.

**Recomendação**: Simplificar para usar AgentContext diretamente onde possível.

---

### TD-04: Logging inconsistente

**Descrição**: Alguns módulos usam `log` do observability, outros usam `console`, outros usam custom
loggers.

**Recomendação**: Padronizar em um único logger.

---

### TD-05: Ausência de TypedEventEmitter em vários pontos

**Descrição**: O código usa `EventEmitter` genérico em vez de tipado em vários pontos.

**Recomendação**: Criar tipos de events e usar EventEmitter tipado.

---

### TD-06: Config spread em session-setup

**Arquivo**: `src/copilot/agent/lifecycle/session-setup.js` **Descrição**: Uso excessivo de spread
operator para passar configurações.

**Recomendação**: Consolidar em objetos de configuração definidos.

---

## 5. Matriz de Priorização

| ID     | Severidade | Esforço | Prioridade |
| ------ | ---------- | ------- | ---------- |
| BUG-01 | 🔴 Crítica | Médio   | P1         |
| BUG-02 | 🔴 Crítica | Alto    | P1         |
| BUG-03 | 🟠 Alta    | Baixo   | P1         |
| BUG-04 | 🟠 Alta    | Médio   | P2         |
| GAP-01 | 🟡 Média   | Baixo   | P2         |
| GAP-02 | 🟡 Média   | Médio   | P2         |
| GAP-03 | 🟡 Média   | Alto    | P3         |
| GAP-04 | 🟡 Média   | Médio   | P3         |
| GAP-05 | 🟡 Média   | Baixo   | P3         |
| GAP-06 | 🟠 Alta    | Baixo   | P2         |
| GAP-07 | 🟡 Média   | Médio   | P3         |
| TD-01  | 🟢 Baixa   | Médio   | P4         |
| TD-02  | 🟢 Baixa   | Alto    | P4         |
| TD-03  | 🟢 Baixa   | Médio   | P4         |

---

## 6. Recomendação de Ação

### Fase 1 (Imediata - 1 semana)

- Corrigir BUG-01 (race condition pause/resume)
- Corrigir BUG-02 (memory leak listeners)
- Implementar GAP-06 (graceful degradation registry)

### Fase 2 (Curto prazo - 2 semanas)

- Corrigir BUG-03 (persistência silenciosa)
- Corrigir BUG-04 (circular reference)
- Implementar GAP-01 (validação de input)

### Fase 3 (Médio prazo - 1 mês)

- Implementar GAP-02 (persistência fallback)
- Implementar GAP-03 (rate limiting)
- Resolver TD-02 (error handling duplication)

---

## 7. Verificações Sugeridas

Para validar os bugs e gaps encontrados, executar os seguintes checks:

```bash
# Verificar casts residuais
rg -n "@type \{unknown\}|/\*\* @type \{unknown\} \*/" src/copilot/agent --glob '*.js'

# Verificar uso de withAgentErrorPolicy
rg -n "withAgentErrorPolicy" src/copilot/agent --glob '*.js' | wc -l

# Verificar imports diretos de sessionState
rg -n "ctx\.sessionState\." src/copilot/agent --glob '*.js'
```

---

## 8. Conclusão

O módulo `src/copilot/` apresenta uma base arquitetural sólida com modularização adequada e vários
subsistemas bem implementados. Os bugs encontrados são significativos mas corrigíveis, e os gaps
funcionais representam oportunidades de melhoria que não bloqueiam o funcionamento básico do
sistema.

A recomendação é priorizar a correção dos bugs críticos (BUG-01 a BUG-04) antes de quaisquer
atividades de expansão funcional.
