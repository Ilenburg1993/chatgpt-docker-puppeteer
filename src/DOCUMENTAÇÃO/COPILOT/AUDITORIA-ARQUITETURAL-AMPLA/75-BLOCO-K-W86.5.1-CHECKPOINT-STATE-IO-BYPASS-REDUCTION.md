# 75 — Bloco K / W86.5.1: checkpoint de redução de bypass em `state-io`

**Data:** 2026-04-30 **Escopo:** `agent-runtime-state`, `agent-state`, `agent-messaging`,
`session/initializer`, contratos arquiteturais

---

## 1) Objetivo desta subonda

Iniciar a W86.5 com transformação concreta: reduzir consumo direto de `lifecycle/state-io.js` em
camadas de domínio e mover esse acesso para façade canônica.

---

## 2) Transformações aplicadas

### 2.1 Façade expandida (`agent-runtime-state`)

Novos wrappers adicionados:

- `readAgentRuntimePersistedStateSync()`
- `readAgentRuntimePersistedStateAsync()`
- `persistAgentRuntimeStatePartial()`

### 2.2 Migrações de consumidores

- `agent/state/agent-state.js`
  - de `readState()` direto para `readAgentRuntimePersistedStateSync()`
- `agent/messaging/agent-messaging.js`
  - de `persistStateWithPolicy()` direto para `persistAgentRuntimeStatePartial()`
- `agent/session/initializer.js`
  - de `readStateAsync`/`persistStateWithPolicy` diretos para wrappers da façade

### 2.3 Contrato anti-regressão

`tests/unit/copilot/contracts/test_arch_contracts.spec.js` ganhou regra W86.5:

- import direto de `lifecycle/state-io.js` fica restrito a allowlist infra explícita.

---

## 3) Critérios de conclusão da W86.5.1 (validados)

### Critério W86.5.1-A — redução real de bypass

- [x] inventário inicial de imports diretos levantado.
- [x] consumidores de domínio quente migrados para façade.
- [x] pós-migração: imports diretos restantes de `state-io` no `agent/**`: **2** (`snapshot` e
      `facade`).

### Critério W86.5.1-B — proteção contínua

- [x] contrato executável criado para evitar regressão de bypass fora da allowlist.

### Critério W86.5.1-C — integridade mínima

- [x] `node --check` verde em todos os arquivos modificados da subonda.

---

## 4) O que falta para fechar a W86.5 completa

1. revisar se `session/snapshot.js` deve continuar como consumidor infra legítimo de `state-io` ou
   se migra para wrapper específico sem criar ciclo de dependência;
2. separar, dentro de `state-io`, núcleo de IO bruto vs concerns de fila/cache para reduzir
   densidade interna;
3. adicionar métrica comparativa de hotspot no fechamento final da W86.5.

---

## 5) Próxima subonda contínua

**W86.5.2**: extração interna de `state-io` em seam de IO bruto (filesystem/state-file) mantendo API
pública estável para não quebrar o runtime.
