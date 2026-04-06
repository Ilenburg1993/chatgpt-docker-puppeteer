# PARTE-10C — Roadmap de Refatoração: `src/copilot/agent/`

**Data**: 2026-03-15  
**Referência**: PARTE-10A (diagnóstico) + PARTE-10B (ideal)  
**Estratégia**: Fases incrementais, cada uma independentemente testável  

---

## Princípio de Execução

Cada fase:
1. Cria estrutura de diretório (se necessário)
2. Move/renomeia arquivos com `git mv`
3. Atualiza imports internos
4. Atualiza imports externos (consumidores fora de agent/)
5. Atualiza barrel exports
6. Roda `npm run lint` + `npm run test:unit`
7. Commit atômico

---

## Fase R1: Tipos Centralizados + Eliminar Circular Deps

**Objetivo**: Criar `types.js`, eliminar importações circulares de tipos via `import('./always-alive.js')`.

### R1.1 — Criar `agent/types.js`
- Extrair de `always-alive.js`: `AgentStatus`, `AgentStatusSnapshot`, `PendingQuestion`, `AgentTask`
- Extrair de `agent-contract.js`: `IAlwaysAliveAgent`
- O `agent-contract.js` será reduzido a re-export (deprecated) ou removido

### R1.2 — Atualizar imports dos consumidores de tipos
- `status-snapshot.js`: `import('./always-alive.js').X` → `import('./types.js').X`
- `dialog-loop-manager.js`: idem
- `session-event-wirer.js`: idem

### R1.3 — Remover `agent-contract.js` (agora vazio)
- Se for puro typedef, conteúdo migra 100% para `types.js`

**Teste**: `npm run lint && npm run test:unit`  
**Commit**: `refactor(agent): R1 — centralizar typedefs em types.js`

---

## Fase R2: Subdiretório `dialog/`

**Objetivo**: Agrupar os 5 arquivos dialog-* em `agent/dialog/`.

### R2.1 — Criar `agent/dialog/` 
- `git mv dialog-loop-manager.js dialog/loop-manager.js`
- `git mv dialog-turn-executor.js dialog/turn-executor.js`
- `git mv dialog-protocol.js dialog/protocol.js`
- `git mv dialog-watchdog.js dialog/watchdog.js`

### R2.2 — Absorver `dialog-loop-wirer.js` em `dialog/loop-manager.js`
- Copiar o corpo de `wireDialogLoopEvents()` como método estático ou função exportada de `loop-manager.js`
- Remover `dialog-loop-wirer.js`
- Atualizar `always-alive.js` para importar de `'./dialog/loop-manager.js'`

### R2.3 — Criar `dialog/index.js` (sub-barrel)
```js
export { DialogLoopManager, wireDialogLoopEvents } from './loop-manager.js';
export { DialogProtocol, ... } from './protocol.js';
export { executeTurnImpl, ... } from './turn-executor.js';
export { DialogWatchdog, WATCHDOG_THRESHOLDS } from './watchdog.js';
```

### R2.4 — Atualizar imports
- `always-alive.js`: `'./dialog-loop-manager.js'` → `'./dialog/loop-manager.js'`
- `always-alive.js`: `'./dialog-loop-wirer.js'` → removido (absorvido)
- `always-alive.js`: `'./dialog-protocol.js'` → `'./dialog/protocol.js'`
- `always-alive.js`: `'./dialog-watchdog.js'` → `'./dialog/watchdog.js'`
- `index.js` raiz: atualizar para importar de `'./dialog/index.js'`
- Consumidores externos que importem diretamente (verificar grep)

**Teste**: `npm run lint && npm run test:unit`  
**Commit**: `refactor(agent): R2 — criar subdiretório dialog/`

---

## Fase R3: Subdiretório `session/`

**Objetivo**: Agrupar os 6 arquivos session-* em `agent/session/`.

### R3.1 — Mover arquivos
- `git mv session-initializer.js session/initializer.js`
- `git mv session-event-wirer.js session/event-wirer.js`
- `git mv session-keepalive.js session/keepalive.js`
- `git mv session-cleanup.js session/cleanup.js`
- `git mv session-rotation.js session/rotation.js`
- `git mv session-snapshot.js session/snapshot.js`

### R3.2 — Criar `session/index.js` (sub-barrel)

### R3.3 — Atualizar imports (always-alive.js + index.js raiz + consumidores externos)

**Teste**: `npm run lint && npm run test:unit`  
**Commit**: `refactor(agent): R3 — criar subdiretório session/`

---

## Fase R4: Subdiretório `queue/`

**Objetivo**: Agrupar message-queue.js + task-executor.js.

### R4.1 — Mover arquivos
- `git mv message-queue.js queue/message-queue.js`
- `git mv task-executor.js queue/task-executor.js`

### R4.2 — Criar `queue/index.js`
### R4.3 — Atualizar imports

**Teste**: `npm run lint && npm run test:unit`  
**Commit**: `refactor(agent): R4 — criar subdiretório queue/`

---

## Fase R5: Subdiretórios `resilience/`, `security/`, `tools/`, `features/`

### R5.1 — `resilience/`
- `git mv reconnect-policy.js resilience/reconnect-policy.js`
- `git mv state-io.js resilience/state-io.js`
- Criar `resilience/index.js`

### R5.2 — `security/`
- `git mv permission-controller.js security/permission-controller.js`
- `git mv tool-audit-logger.js security/tool-audit-logger.js`
- Criar `security/index.js`

### R5.3 — `tools/` (cuidado: nome pode conflitar com `src/copilot/tools/`)
- Renomear para `agent-tools/` para evitar confusão? Ou manter `tools/` pois está dentro de `agent/`
- `git mv tools-bootstrap.js tools/bootstrap.js`
- Criar `tools/index.js`

### R5.4 — `features/`
- `git mv webhook-manager.js features/webhook-manager.js`
- `git mv handoff-manager.js features/handoff-manager.js`
- `git mv status-snapshot.js features/status-snapshot.js`
- Criar `features/index.js`

### R5.5 — Atualizar todos os imports

**Teste**: `npm run lint && npm run test:unit`  
**Commit**: `refactor(agent): R5 — criar subdiretórios resilience, security, tools, features`

---

## Fase R6: Refatorar `index.js` (Barrel Raiz)

**Objetivo**: Substituir 30+ exports flat por sub-barrel imports estruturados.

### R6.1 — Reescrever `index.js`
```js
// agent/index.js — barrel estruturado
export { AlwaysAliveAgent, alwaysAliveAgent, getAgent } from './always-alive.js';
export { AGENT_EVENTS, DIALOG_LOOP_EVENTS, HIGH_FREQUENCY_EVENTS, PR_CONSUMING_EVENTS } from './events.js';
export * from './types.js';
export * from './dialog/index.js';
export * from './session/index.js';
export * from './queue/index.js';
export * from './resilience/index.js';
export * from './security/index.js';
export * from './tools/index.js';
export * from './features/index.js';
```

### R6.2 — Verificar que exports públicos são preservados (sem remoções)

**Teste**: `npm run lint && npm run test:unit`  
**Commit**: `refactor(agent): R6 — barrel raiz estruturado`

---

## Fase R7: Slim Down `always-alive.js`

**Objetivo**: Reduzir de 1605 → ~400-500 linhas. A fase mais delicada.

### R7.1 — Extrair método `#initializeSystems()` 
Mover blocos de inicialização de subsistemas de `start()` para um método dedicado.

### R7.2 — Extrair método `#wireAllEvents()`
Consolidar a wiring de eventos da sessão + dialog em um único ponto.

### R7.3 — Delegação explícita para subsistemas
Substituir código inline por chamadas a subsistemas já existentes.

### R7.4 — Mover typedefs restantes para `types.js`
Qualquer typedef que esteja em `always-alive.js` e seja importado por outros módulos.

### R7.5 — Cleanup de código morto e comentários obsoletos
Remover TODOs resolvidos, comentários de fases anteriores (F42, BUG-XX) que já foram implementados.

**Teste**: `npm run lint && npm run test:unit && npm run test:integration`  
**Commit**: `refactor(agent): R7 — slim down always-alive.js`

---

## Fase R8: Verificação Final e Documentação

### R8.1 — Rodar suite completa
```bash
npm run lint
npm run format:check
npm run test:unit
npm run test:integration (se disponível)
```

### R8.2 — Atualizar documentação
- Atualizar `DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL/` com resultado final
- Atualizar referências internas se necessário

### R8.3 — Commit final + Push
- `refactor(agent): R8 — verificação final e documentação`
- `git push`

---

## Resumo de Fases

| Fase | Descrição | Risco | Arquivos Afetados |
|------|-----------|-------|-------------------|
| R1 | Tipos centralizados | BAIXO | 4-5 |
| R2 | Subdiretório dialog/ | MÉDIO | 6 + imports |
| R3 | Subdiretório session/ | MÉDIO | 7 + imports |
| R4 | Subdiretório queue/ | BAIXO | 3 + imports |
| R5 | Subdiretórios restantes | BAIXO | 7 + imports |
| R6 | Barrel raiz | BAIXO | 1 |
| R7 | Slim down always-alive.js | ALTO | 1 (mas crítico) |
| R8 | Verificação + docs | BAIXO | 2-3 |

**Tempo estimado total**: Fases R1-R6 são mecânicas (move + import updates). R7 é a fase mais delicada pois modifica o god object.

**Ordem de dependência**: R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8 (sequencial)
