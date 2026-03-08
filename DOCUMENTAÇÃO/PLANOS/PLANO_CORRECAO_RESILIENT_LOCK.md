# Plano de Correção: Resilient Lock (No-Crash Policy)

**Data:** 16 de fevereiro de 2026 **Autor:** GitHub Copilot **Status:** Planejamento **Alvo:**
`src/infra/locks/resilient_lock.js`

## 1. Contexto e Problema

A biblioteca `ResilientLock` é responsável por gerenciar bloqueios distribuídos (baseados em
arquivo) para garantir exclusividade de recursos (ex: tarefas de fila).

**O Defeito Crítico:** Atualmente, ela intercepta eventos globais de erro (`uncaughtException`,
`unhandledRejection`) e força o encerramento do processo Node.js (`process.exit(1)`) após tentar
liberar locks.

```javascript
// CÓDIGO ATUAL (Problemático)
this._cleanupHandlers.uncaughtException = async (err) => {
  console.error('[ResilientLock] Uncaught exception...', err);
  await this.releaseAll();
  process.exit(1); // <--- DERRUBA O SERVIDOR
};
```

**Impacto:** Se qualquer biblioteca secundária lançar uma exceção não tratada (mesmo que trivial), o
`ResilientLock` intercepta e mata o servidor HTTP, o NERV e todos os drivers, impedindo _graceful
degradation_ ou resposta de erro adequada. Isso viola o princípio de resiliência da aplicação.

## 2. Objetivo da Correção

Transformar o `ResilientLock` em um "cidadão comportado" que:

1.  **Não sequestra** o ciclo de vida do processo global.
2.  **Não força o exit** do processo.
3.  Apenas realiza limpeza (release locks) quando instruído explicitamente ou nos sinais de
    terminação padrão (`SIGTERM`, `SIGINT`), mas permitindo que o `main.js` ou `server.js` decida
    quando sair.

## 3. Estratégia de Implementação

### A. Remover `process.exit(1)`

Os handlers de `uncaughtException` e `unhandledRejection` serão removidos ou modificados para
**apenas logar e limpar**, sem forçar a saída. A responsabilidade de sair (se necessário) é do
`main.js`.

### B. Manter `SIGTERM` / `SIGINT` (Graceful Shutdown)

Para sinais do SO (`SIGTERM`, `SIGINT`), a biblioteca deve continuar liberando locks, mas **não deve
chamar exit** ela mesma. O runtime Node.js terminará naturalmente ou será gerenciado pelo
orquestrador de boot.

### C. Refatoração do `_registerCleanupHandlers`

O método deve ser simplificado para focar estritamente na liberação de recursos, sem assumir o
controle do processo.

---

## 4. Código Proposto (Exemplo)

```javascript
// ANTES
this._cleanupHandlers.sigterm = async () => {
  await this.releaseAll();
  process.exit(0); // Força exit
};

// DEPOIS
this._cleanupHandlers.sigterm = async () => {
  log('INFO', '[ResilientLock] SIGTERM received, releasing locks...');
  await this.releaseAll();
  // NÃO chama process.exit(). Deixa o evento propagar ou o runtime finalizar.
};
```

## 5. Plano de Execução

1.  **Backup:** Criar backup do arquivo atual (via edição segura).
2.  **Refatorar `_registerCleanupHandlers`:**
    - Remover listeners de `uncaughtException` e `unhandledRejection` (perigosos em libs).
    - Ajustar `SIGINT`/`SIGTERM` para serem _async_ mas não bloqueantes ou terminadores.
3.  **Validação:** Verificar se o servidor inicia e para sem erros de "process.exit is not a
    function" ou hangs.

---

_Pronto para aplicação._
