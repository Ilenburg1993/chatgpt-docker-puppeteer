# 76 — Bloco K / W86.5.2: checkpoint de extração do seam `state-file-io`

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/lifecycle/state-io.js` e novo `state-file-io.js`

---

## 1) Objetivo da subonda

Separar o IO bruto de filesystem (mkdir/read/write/rm/path) da lógica semântica de estado persistido
do runtime.

---

## 2) Transformações aplicadas

### 2.1 Novo seam infra

Criado `src/copilot/agent/lifecycle/state-file-io.js` com responsabilidades estritas de FS:

- `ensureStateDirReady()`
- `readStateFileIfExists()`
- `writeStateFileJson()`
- `removeStateFileIfExists()`
- `resetStateFileIoCache()`
- constantes `STATE_DIR` e `STATE_FILE`

### 2.2 `state-io.js` desconcentrado

`state-io.js` deixou de operar diretamente com `node:fs/promises` e path resolution de arquivo;
agora delega ao seam `state-file-io`.

Resultado: `state-io` fica focado em:

- cache in-process;
- serialização por mutex de escrita;
- parsing/schema validation;
- política de erro (`withAgentErrorPolicy`).

---

## 3) Critérios de conclusão da W86.5.2 (validados)

### Critério W86.5.2-A — separação IO bruto vs policy

- [x] funções de filesystem extraídas para módulo dedicado.
- [x] `state-io` sem import direto de `node:fs/promises`.

### Critério W86.5.2-B — API pública preservada

- [x] `state-io` mantém `readState`, `readStateAsync`, `writeStateAsync`, `persistStateWithPolicy`,
      `clearState`, `drainStateWrites`.

### Critério W86.5.2-C — integridade mínima

- [x] `node --check` verde em todos os arquivos alterados do eixo W86.4/W86.5.

---

## 4) Leitura arquitetural

A W86.5.2 reduz densidade e mistura de concerns no núcleo de persistência do runtime. O próximo
passo natural é consolidar governança de imports para garantir que novos consumidores usem façade em
vez de reabrir `state-io`.

---

## 5) Próxima subonda contínua

**W86.5.3** (proposta):

1. consolidar allowlist de `state-io` no contrato como matriz versionada;
2. medir hotspot residual de `state-io` e `agent-runtime-state` pós-extração;
3. fechar checkpoint da W86.5 completa.
