# Proposta de Arquitetura 2.0

> **Data**: 2 de março de 2026 **Base**: Análise V1 (ARCHITECTURE_V1_ANALYSIS.md) **Objetivo**:
> Corrigir gaps, bugs e inconsistências identificados na V1

---

## 1. Resumo Executivo

A Arquitetura 2.0 mantém os **fundamentos sólidos** da V1 (NERV event bus, SSOT database-first, boot
determinístico) enquanto corrige **12 problemas identificados** organizados em 4 eixos:

1. **Resiliência**: Error handling consistente, NERV lifecycle completo
2. **Modularidade**: Bootstrap faseado extraído, módulos mortos removidos
3. **Consistência**: Padrões unificados de extensão, import, e logging
4. **Observabilidade**: Logging em catch blocks, health listener limits

## 2. Mudanças Propostas

### 2.1 — Logging em JSON.parse Catch Blocks (P0)

**Problema**: Erros de parse são silenciados, dificultando diagnóstico de dados corrompidos.

**Solução**: Adicionar logging estruturado antes do fallback.

**Arquivos afetados**:

- `src/infra/db/task_repo.js` (linhas 129-143)
- `src/server/api/controllers/dashboard_tasks.js`
- `src/server/api/controllers/dashboard_missions.js`

**Padrão proposto**:

```javascript
if (row.blocked_details_json) {
  try {
    task.state.blocked_details = JSON.parse(row.blocked_details_json);
  } catch (err) {
    log.warn(
      { taskId: task.id, field: 'blocked_details_json', error: err.message },
      '[task_repo] Fallback to raw string for malformed JSON'
    );
    task.state.blocked_details = row.blocked_details_json;
  }
}
```

### 2.2 — NERV Shutdown Lifecycle Completo (P0)

**Problema**: O shutdown do NERV só limpa transport/socket, ignorando health, telemetry, buffers.

**Solução**: Adicionar cleanup explícito para TODOS os subsistemas.

**Arquivo afetado**: `src/nerv/nerv.js`

**Proposta**:

```javascript
async shutdown() {
    // 1. Stop health monitoring
    if (health && health.shutdown) health.shutdown();
    // 2. Flush buffers
    if (buffers && buffers.shutdown) buffers.shutdown();
    // 3. Stop transports
    if (hybridTransport) hybridTransport.stop();
    if (transport && transport.stop) transport.stop();
    if (socketAdapter && socketAdapter.stop) socketAdapter.stop();
    // 4. Stop telemetry
    if (telemetry && telemetry.shutdown) telemetry.shutdown();
}
```

### 2.3 — Health Listener Safety (P2)

**Problema**: `listeners` Set cresce sem limite — potencial memory leak em processos longos.

**Solução**: Adicionar max listeners com warning e métricas.

**Arquivo afetado**: `src/nerv/health/health.js`

**Proposta**:

```javascript
const MAX_HEALTH_LISTENERS = 50;

function onChange(handler) {
  if (listeners.size >= MAX_HEALTH_LISTENERS) {
    telemetry.emit('nerv:health:listener_overflow', { count: listeners.size });
    // Não bloqueia, apenas avisa
  }
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
```

### 2.4 — Remoção de Módulo Morto `src/state/` (P1)

**Problema**: Módulo vazio (apenas README.md) polui a árvore de diretórios.

**Solução**: Remover o diretório. O state management é feito via SSOT no DB.

### 2.5 — Padronização de Extensões .mjs → .js (P2)

**Nota**: Mudança de baixo risco pois o projeto já é ESM (`"type": "module"`). Porém, como a
extensão .mjs é usada apenas em `src/integration/` e está mapeada nos aliases, esta mudança é
**deferida** para evitar quebras. Será documentada como guideline.

### 2.6 — Bootstrap Phase Documentation (P1)

**Problema**: main.js tem 17 imports e ~1200 LOC.

**Solução**: Em vez de refatorar (alto risco), documentar as fases como módulos lógicos e adicionar
comentários de seção mais claros. Futura extração em `src/boot/` como sprint separado.

## 3. Checklist de Implementação

- [ ] Fix P0-1: Logging em JSON.parse catch blocks (task_repo.js)
- [ ] Fix P0-2: NERV shutdown lifecycle completo (nerv.js)
- [ ] Fix P2-1: Health listener safety (health.js)
- [ ] Fix P1-2: Remover src/state/ módulo morto
- [ ] Documentar guidelines de extensão .mjs vs .js
- [ ] Criar ARCHITECTURE_V2.md com nova arquitetura documentada
- [ ] Validar: lint, format, test:unit passando

## 4. Riscos e Mitigações

| Risco                                 | Mitigação                                        |
| ------------------------------------- | ------------------------------------------------ |
| Logging adicional impacta performance | Usar nível `warn` (baixa frequência)             |
| NERV shutdown mais complexo           | Cada cleanup é try-catched isoladamente          |
| Health listener limit muito baixo     | 50 é 10x o uso normal; apenas warning, não block |
| Remoção de src/state/ quebra algo     | Grep confirmou: nenhum import referencia state/  |

## 5. Impacto Esperado

| Métrica                 | V1      | V2 (esperado) |
| ----------------------- | ------- | ------------- |
| Silent catch blocks     | 6+      | 0             |
| NERV subsystems cleaned | 3/7     | 7/7           |
| Dead modules            | 1       | 0             |
| Health listener safety  | Nenhuma | Max 50 + warn |
| Testes passando         | 798/800 | 798/800+      |

---

_Proposta aprovada para implementação. Referência: ARCHITECTURE_V1_ANALYSIS.md_
