# 🔄 ONDA 2: Migração para NERV Event Bus

**Status**: 📋 Planejado **Prioridade**: P2 (Non-blocking) **Milestone**: Post-documentação canônica
**Criado**: 2026-01-21

---

## 📝 Descrição

Migrar módulos que ainda usam broadcast direto (`ipc_client`) para a arquitetura NERV event-driven
zero-coupling.

---

## 🎯 Módulos Afetados

### 1. `src/core/forensics.js`

- **Linhas**: 17, 81
- **Dependência atual**: `ipc_client` (legado)
- **Migração necessária**:

  ```javascript
  // Antes (legado)
  ipc.broadcast(ActionCode.FORENSICS_DUMP, { dumpId, taskId });

  // Depois (NERV)
  nerv.emit('FORENSICS_DUMP', { dumpId, taskId });
  ```

- **Handler**: ServerNERVAdapter deve repassar para Socket.io
- **Issue tracking**:
  [#ONDA2-FORENSICS](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues/ONDA2-FORENSICS)

### 2. `src/core/infra_failure_policy.js`

- **Linhas**: 11, 85
- **Dependência atual**: `ipc_client` (legado)
- **Migração necessária**:

  ```javascript
  // Antes (legado)
  ipc.emitEvent(ActionCode.STALL_DETECTED, { type, severity, evidence }, correlationId);

  // Depois (NERV)
  nerv.emit('INFRA_EMERGENCY', { type, pid, action, severity: 'CRITICAL' }, { correlationId });
  ```

- **Handler**: ServerNERVAdapter deve repassar para Socket.io
- **Issue tracking**:
  [#ONDA2-INFRA-POLICY](https://github.com/Ilenburg1993/chatgpt-docker-puppeteer/issues/ONDA2-INFRA-POLICY)

---

## ✅ Tarefas

### Fase 1: Preparação

- [ ] Validar que DriverNERVAdapter está completo e testado
- [ ] Validar que ServerNERVAdapter está completo e testado
- [ ] Documentar novos eventos NERV:
  - [ ] `FORENSICS_DUMP` (payload: `{ dumpId, taskId }`)
  - [ ] `INFRA_EMERGENCY` (payload: `{ type, pid, action, severity }`)

### Fase 2: Migração de Forensics

- [ ] Remover comentário TODO de `forensics.js:17`
- [ ] Descomentar e adaptar código NERV em `forensics.js:81`
- [ ] Remover import de `ipc_client` (se não usado em outros lugares)
- [ ] Testar notificação de crash dump via NERV
- [ ] Validar que ServerNERVAdapter repassa para Socket.io
- [ ] Atualizar testes unitários

### Fase 3: Migração de InfraFailurePolicy

- [ ] Remover comentário TODO de `infra_failure_policy.js:11`
- [ ] Descomentar e adaptar código NERV em `infra_failure_policy.js:85`
- [ ] Remover import de `ipc_client` (se não usado em outros lugares)
- [ ] Testar notificação de emergência de infra via NERV
- [ ] Validar que ServerNERVAdapter repassa para Socket.io
- [ ] Atualizar testes unitários

### Fase 4: Limpeza

- [ ] Deprecar `ipc_client.js` se não houver mais usos
- [ ] Atualizar documentação (ARCHITECTURE.md, NERV_PROTOCOL.md)
- [ ] Atualizar diagramas de fluxo
- [ ] Code review completo
- [ ] Merge para main

---

## 🧪 Critérios de Aceitação

1. ✅ Forensics usa `nerv.emit()` em vez de `ipc.broadcast()`
2. ✅ InfraFailurePolicy usa `nerv.emit()` em vez de `ipc.emitEvent()`
3. ✅ Nenhum módulo CORE importa `ipc_client` diretamente
4. ✅ Notificações chegam ao dashboard via ServerNERVAdapter
5. ✅ Testes unitários passam (incluindo novos eventos NERV)
6. ✅ Zero regressão funcional (comportamento idêntico ao anterior)

---

## 📚 Referências

- **Arquitetura NERV**: [DOCUMENTAÇÃO/ARCHITECTURE.md](../DOCUMENTAÇÃO/ARCHITECTURE.md)
- **NERV Protocol**: [DOCUMENTAÇÃO/NERV_PROTOCOL.md](../DOCUMENTAÇÃO/NERV_PROTOCOL.md)
- **DriverNERVAdapter**:
  [src/driver/nerv_adapter/driver_nerv_adapter.js](../src/driver/nerv_adapter/driver_nerv_adapter.js)
- **ServerNERVAdapter**:
  [src/server/nerv_adapter/server_nerv_adapter.js](../src/server/nerv_adapter/server_nerv_adapter.js)

---

## ⚠️ Riscos

| Risco                                | Probabilidade | Impacto | Mitigação                                         |
| ------------------------------------ | ------------- | ------- | ------------------------------------------------- |
| Notificações não chegam ao dashboard | Baixa         | Alto    | Validar handlers no ServerNERVAdapter antes       |
| Correlation ID perdido               | Média         | Médio   | Testar propagação de correlationId via NERV       |
| Performance degradada                | Baixa         | Baixo   | NERV já é usado em DRIVER, não deve haver impacto |

---

## 🕐 Estimativa

- **Preparação**: 2h
- **Migração Forensics**: 1h
- **Migração InfraFailurePolicy**: 1h
- **Testes + Validação**: 2h
- **Limpeza + Docs**: 1h
- **Total**: ~7h

---

**Criado por**: Auditoria CORE (01_CORE_AUDIT.md) **Data**: 2026-01-21 **Versão**: 1.0
