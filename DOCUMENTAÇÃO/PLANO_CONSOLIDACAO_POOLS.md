# Plano de Consolidação e Otimização de Pools (Driver & Browser)

**Data:** 16 de fevereiro de 2026 **Autor:** GitHub Copilot **Status:** Implementado (v3.1)

## 1. Contexto e Objetivo

Atualmente, o sistema opera com duas camadas de gestão de recursos desconectadas:

1.  **Browser Pool (`src/infra/browser_pool/`):** Gerencia conexões Chrome e alocação de páginas
    (`Page`).
2.  **Driver Pool (`src/driver/factory.js`):** Gerencia instâncias de objetos `TargetDriver`.

**Problema:** A desconexão causa desalinhamento. O `DriverFactory` pode ter drivers disponíveis
(objetos JS) mas sem páginas alocadas, exigindo que o consumidor (Kernel/Task) faça a orquestração
manual de alocação de página e anexo ao driver (`attachContext`). Isso introduz latência no início
da tarefa ("cold start") e complexidade no Kernel.

**Objetivo:** Implementar um **"Hot Pool" de Drivers**. O `DriverFactory` deve manter um conjunto de
drivers **prontos para uso** (com página alocada, conectada e em estado `IDLE`), eliminando a
latência de inicialização e garantindo que, se um driver for adquirido do pool, ele é garantidamente
funcional.

---

## 2. Arquitetura Proposta

### A. Hierarquia de Dependência

O `DriverFactory` passará a ser um consumidor direto e privilegiado do `BrowserPool`.

- **Antes:** Kernel -> (pede Driver ao Factory) + (pede Página ao BrowserPool) -> (Une os dois).
- **Depois:** Kernel -> (pede Driver Pronto ao Factory). O Factory já gerenciou a interação com o
  BrowserPool internamente.

### B. Ciclo de Vida do "Hot Driver"

1.  **Warmup / Criação:**
    - Factory instancia `TargetDriver`.
    - Factory solicita `browserPool.allocate()`.
    - Factory executa `driver.attachContext(page)`.
    - Driver entra em estado `IDLE` (com página ativa) e é armazenado no pool.

2.  **Aquisição (`acquireFromPool`):**
    - Factory seleciona driver `IDLE`.
    - Valida se a página anexa ainda está viva (`!page.isClosed()`).
    - Retorna driver pronto.

3.  **Liberação (`releaseToPool`):**
    - Kernel devolve driver.
    - Factory executa rotina de **Higienização (Sanitization)** na página (ex:
      `await driver.resetSession()`).
    - Se higienização falhar -> Descarta driver e fecha página.
    - Se sucesso -> Driver volta para estado `IDLE` no pool.

---

## 3. Mudanças Necessárias (Passo a Passo)

### Passo 1: Injeção de Dependência no Factory

Alterar a inicialização do `DriverFactory` (provavelmente em `src/main.js` ou `src/nerv/nerv.js`
onde ele é criado) para receber a instância de `BrowserPool`.

**Arquivo:** `src/driver/factory.js`

- Atualizar `constructor` para aceitar `browserPool`.
- Armazenar referência interna.

### Passo 2: Implementar Lógica de "Hot Creation"

Criar método interno `_createHotDriver(target)` que encapsula a criação do objeto e alocação da
página.

**Arquivo:** `src/driver/factory.js`

```javascript
async _createHotDriver(target) {
    // 1. Instancia objeto (lógica atual)
    const driver = await this.createDriver(target);

    // 2. Aloca página
    const page = await this.browserPool.allocate(target);

    // 3. Anexa contexto
    await driver.attachContext(page);

    return driver;
}
```

### Passo 3: Atualizar `acquireFromPool`

Modificar para garantir que retorna apenas drivers com contexto válido. Se o pool estiver vazio (e
abaixo do limite), cria um _Hot Driver_ na hora.

### Passo 4: Implementar Estratégia de Reciclagem (`releaseToPool`)

Em vez de apenas marcar `busy=false`, o factory deve decidir se mantém o driver vivo.

- Adicionar lógica de `maxUses` (ex: reciclar driver após 50 tarefas para evitar vazamento de
  memória do Chrome).
- Chamar método de limpeza do driver (necessário padronizar `driver.reset()` ou
  `driver.clearContext()`).

### Passo 5: Sincronização de Capacidade

Garantir em `config.json` ou `src/core/config.js` que `DRIVER_POOL_MAX_SIZE` <= `BROWSER_POOL_SIZE`.
Se o Factory tentar criar mais drivers do que o pool de browsers suporta, haverá deadlock ou erro.

- Adicionar validação no startup.

---

## 4. Plano de Execução e Correções Imediatas

1.  **Refatorar `DriverFactory`**:
    - Remover lógica de criação "fria" (sem página) do caminho crítico de aquisição.
    - Integrar com `BrowserPool`.

2.  **Padronizar Interface de Driver**:
    - Garantir que todo `TargetDriver` tenha um método robusto de `resetSession()` ou `cleanup()`
      para permitir reuso seguro da página.

3.  **Ajuste de Testes**:
    - Atualizar testes unitários do Factory para mockar `BrowserPool`.

## 5. Benefícios Esperados

- **Zero Latência (Warm Start):** Tarefas iniciam imediatamente, sem aguardar launch/newContext do
  Chrome.
- **Simplificação do Kernel:** O Kernel não precisa mais saber sobre "Páginas Puppeteer", apenas
  sobre "Drivers de IA".
- **Maior Resiliência:** O Factory pode verificar a saúde da página antes de entregar o driver,
  reduzindo falhas em runtime na camada de execução.

---

_Aprovado para execução imediata._
