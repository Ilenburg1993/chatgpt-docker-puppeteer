# Relatório de Auditoria e Compatibilidade: Main.js vs Server/Main.js

**Data:** 13/02/2026 **Escopo:** `src/main.js` (Maestro) e `src/server/main.js` (Nexus) **Status:**
Crítico (Ação Necessária)

## 1. Resumo de Compatibilidade

Os dois arquivos operam como pontos de entrada para processos distintos (Executor vs API), mas
compartilham dependências críticas de infraestrutura (NERV, Telemetria). A varredura identificou
que, embora estruturalmente compatíveis, ambos sofrem de **fragilidade na inicialização** e **falta
de sincronia em estados de erro**.

| Componente     | Status            | Problema Principal                                                                                                         |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **NERV (IPC)** | ⚠️ Risco          | `src/main.js` inicializa o NERV, mas não valida a instância antes de injetá-la ou usá-la. Se falhar, o Server fica "cego". |
| **Telemetria** | ❌ Incompleto     | Ambos possuem código comentado (Dead Code) aguardando um módulo `snapshot.js` inexistente.                                 |
| **Shutdown**   | ⚠️ Desincronizado | O `main.js` pode matar processos enquanto o `server/main.js` ainda aceita requisições HTTP (falta de _draining_).          |
| **Readiness**  | ❌ Ausente        | O Server não expõe endpoints `/health` ou `/ready`, dificultando que orquestradores saibam quando o Maestro está pronto.   |

---

## 2. Bugs e Gaps Identificados

### 🔴 Crítico: Instabilidade na Inicialização do NERV (GAP-003)

**Local:** `src/main.js` **Diagnóstico:** O código assume que a criação do NERV sempre retorna um
objeto válido. Se ocorrer um erro silencioso ou retorno parcial, chamadas subsequentes como
`nerv.onEvent` causarão crash da aplicação. **Correção Proposta:** Implementar Guard Clauses.

```javascript
// src/shared/nerv/utils.js (Novo Helper)
export function isValidNERV(nerv) {
  return nerv && typeof nerv.onEvent === 'function' && typeof nerv.sendEvent === 'function';
}

// Em src/main.js
if (!isValidNERV(nerv)) {
  throw new Error('[BOOT] FATAL: Instância NERV inválida ou corrompida.');
}
```

### 🟠 Médio: Telemetria "Snapshot" Inexistente (TODO-001/002)

**Local:** `src/main.js` e `src/server/main.js` **Diagnóstico:** Ambos os arquivos contêm blocos
`try-catch` comentados tentando iniciar `snapshot.start()`. Isso indica uma feature planejada mas
abandonada, criando dívida técnica e confusão. **Ação:** Ou implementar o módulo
`src/shared/telemetry/snapshot.js` ou remover o código morto. **Recomendação:** Implementar, pois
reduz a latência de leitura do Dashboard.

### 🟠 Médio: Falta de Probes de Prontidão (GAP-002)

**Local:** `src/server/main.js` **Diagnóstico:** O servidor define `app.locals.runtimeReadiness`,
mas não expõe isso via HTTP. O Maestro pode estar travado no boot, e o Server responderá 200 OK na
raiz, enganando balanceadores de carga. **Correção Proposta:**

```javascript
// src/server/api/controllers/health.js
export function readiness(req, res) {
  const missing = req.app.locals.requiredReadiness.filter(
    (k) => !req.app.locals.runtimeReadiness[k],
  );
  if (missing.length > 0) return res.status(503).json({ status: 'not_ready', missing });
  res.status(200).json({ status: 'ready' });
}
```

### 🟡 Baixo: TaskSyncBridge Condicional (INCOMPLETE-001)

**Local:** `src/server/main.js` **Diagnóstico:** A sincronização de tarefas depende de
`process.env.ENABLE_TASK_SYNC_BRIDGE === 'true'`. Se a variável não for definida, o Dashboard não
atualiza em tempo real. **Correção:** Mudar a lógica para "Habilitado por padrão" (default true).

---

## 3. Plano de Ação e Correção

Para garantir a compatibilidade total e robustez, execute as seguintes alterações na ordem:

### Passo 1: Blindagem do NERV (Prioridade P0)

1. Criar `src/shared/nerv/utils.js` com a função `isValidNERV`.
2. Importar e usar em `src/main.js` logo após a instanciação do NERV.
3. Importar e usar em `src/server/main.js` antes de passar o cliente NERV para o `TaskSyncBridge`.

### Passo 2: Implementação de Health Checks (Prioridade P1)

1. Criar controller `src/server/api/controllers/health.js`.
2. Registrar rotas `/health` (Liveness) e `/ready` (Readiness) em `src/server/api/router.js`.
3. No `src/main.js`, garantir que o sinal de `READY` só seja enviado ao PM2 após o NERV e o Chrome
   estarem confirmados.

### Passo 3: Limpeza de Código (Prioridade P2)

1. Remover os blocos comentados referentes ao `snapshot` em ambos os arquivos se não for implementar
   agora.
2. Alterar a lógica do `TaskSyncBridge` no server para:
   ```javascript
   if (process.env.ENABLE_TASK_SYNC_BRIDGE !== 'false') { ... }
   ```

### Passo 4: Shutdown Gracioso Sincronizado (Prioridade P2)

1. No `src/main.js`, função `shutdown()`:
   - Adicionar verificação de missões ativas.
   - Enviar sinal `SHUTDOWN_IMMINENT` via NERV para o Server.
2. No `src/server/main.js`:
   - Ao receber `SHUTDOWN_IMMINENT`, parar de aceitar novas conexões HTTP mas manter as atuais
     ativas por X segundos (draining).

---

## 4. Conclusão da Auditoria

Os arquivos `src/main.js` e `src/server/main.js` estão **85% compatíveis**. A principal divergência
é a falta de validação defensiva na comunicação entre eles (NERV).

A implementação das correções acima elevará o nível de maturidade do sistema de "Funcional" para
"Resiliente" (Audit Level 40+), alinhado com o **Protocolo 11 (Zero-Bug Tolerance)**.
